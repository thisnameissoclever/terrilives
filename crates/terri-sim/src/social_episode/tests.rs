use super::*;
use crate::{test_content, Content, Sim};
use bevy_ecs::system::RunSystemOnce;
use terri_core::{
    CommandQueue, Hobbies, IntentQueue, Personality, Relationships, Reserved, SimCommand, SimId,
    SimIdAllocator,
};

fn chat_fixture() -> (Sim, Entity, Entity) {
    let pack = test_content::pack_with_social(
        vec![test_content::object("fridge", &[(NeedId::Hunger, 20.)], 60)],
        vec![test_content::interaction(
            "chat",
            &[(NeedId::Social, 30.)],
            40,
        )],
        test_content::tuning(),
    );
    let mut sim = test_content::sim_with(12, 8, pack);
    let mut create = |x| {
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        sim.world_mut()
            .spawn((
                Agent,
                id,
                terri_core::Position { x, y: 1. },
                Needs::all_at(90.),
                Relationships::default(),
            ))
            .id()
    };
    let a = create(1.);
    let b = create(7.);
    (sim, a, b)
}
fn talk(sim: &mut Sim, a: Entity, b: Entity) {
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkTo {
            agent: a.index_u32(),
            target: b.index_u32(),
            interaction: 0,
        });
}

#[test]
fn player_order_survives_critical_needs_on_either_participant() {
    for critical_recipient in [false, true] {
        let (mut sim, a, b) = chat_fixture();
        let critical = if critical_recipient { b } else { a };
        sim.world_mut()
            .get_mut::<Needs>(critical)
            .unwrap()
            .set(NeedId::Hunger, 5.);
        talk(&mut sim, a, b);
        sim.tick();
        let id = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
        for _ in 0..8 {
            sim.tick();
        }
        assert!(
            sim.world()
                .get::<IntentQueue>(a)
                .unwrap()
                .order(id)
                .is_some(),
            "critical need must not erase accepted order {id}; recipient={critical_recipient}"
        );
        assert_eq!(sim.world().get::<Target>(a).map(|t| t.object), Some(b));
    }
}

#[test]
fn repeated_reciprocal_and_competing_commands_all_execute_separately() {
    let (mut sim, a, b) = chat_fixture();
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::Position { x: 1., y: 4. },
            Needs::all_at(90.),
        ))
        .id();
    talk(&mut sim, c, b);
    talk(&mut sim, a, b);
    talk(&mut sim, b, a);
    talk(&mut sim, a, b);
    sim.flush_commands();
    for _ in 0..700 {
        sim.tick();
        if [a, b, c].into_iter().all(|p| {
            sim.world()
                .get::<IntentQueue>(p)
                .is_none_or(|q| q.is_empty())
        }) {
            break;
        }
    }
    let events = sim.action_events_since(0).events;
    let expected = vec![
        (c.index_u32(), 0),
        (a.index_u32(), 0),
        (b.index_u32(), 0),
        (a.index_u32(), 1),
    ];
    let starts: Vec<_> = events
        .iter()
        .filter(|event| event.phase == "started")
        .map(|event| (event.actor, event.order_id))
        .collect();
    let completed: Vec<_> = events
        .iter()
        .filter(|event| event.phase == "completed")
        .map(|event| (event.actor, event.order_id))
        .collect();
    assert_eq!(
        starts, expected,
        "accepted player orders each start separately: {events:#?}"
    );
    assert_eq!(
        completed, expected,
        "accepted player orders each finish in order: {events:#?}"
    );
    assert!(
        !events
            .iter()
            .any(|event| matches!(event.phase.as_str(), "failed" | "canceled")),
        "no order may vanish: {events:#?}"
    );
    assert!([a, b, c].into_iter().all(|p| sim
        .world()
        .get::<IntentQueue>(p)
        .is_none_or(|q| q.is_empty())));
}

#[test]
fn reciprocal_front_commands_in_one_paused_batch_finish_in_acceptance_order() {
    let (mut sim, a, b) = chat_fixture();
    for (actor, target) in [(a, b), (b, a)] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkToFirst {
                agent: actor.index_u32(),
                target: target.index_u32(),
                interaction: 0,
            });
    }
    sim.flush_commands();
    for _ in 0..400 {
        sim.tick();
        if [a, b]
            .into_iter()
            .all(|actor| sim.world().get::<IntentQueue>(actor).unwrap().is_empty())
        {
            break;
        }
    }
    let events = sim.action_events_since(0).events;
    let completed: Vec<_> = events
        .iter()
        .filter(|e| e.phase == "completed")
        .map(|e| (e.actor, e.order_id))
        .collect();
    assert_eq!(
        completed,
        vec![(a.index_u32(), 0), (b.index_u32(), 0)],
        "reciprocal front lifecycle: {events:#?}"
    );
    assert!([a, b].into_iter().all(|actor| sim
        .world()
        .get::<IntentQueue>(actor)
        .unwrap()
        .is_empty()));
}

#[test]
fn failed_approach_removes_only_its_exact_occurrence_among_repeated_orders() {
    let (mut sim, a, b) = chat_fixture();
    talk(&mut sim, a, b);
    talk(&mut sim, a, b);
    sim.tick();
    let ids: Vec<_> = sim
        .world()
        .get::<IntentQueue>(a)
        .unwrap()
        .entries()
        .iter()
        .map(|e| e.id)
        .collect();
    for y in 0..8 {
        sim.world_mut()
            .resource_mut::<terri_core::TileGrid>()
            .set_blocked(5, y, true);
    }
    sim.world_mut()
        .entity_mut(b)
        .insert(terri_core::Position { x: 9., y: 5. });
    maintain(sim.world_mut());
    assert!(sim
        .world()
        .get::<IntentQueue>(a)
        .unwrap()
        .order(ids[0])
        .is_none());
    assert!(sim
        .world()
        .get::<IntentQueue>(a)
        .unwrap()
        .order(ids[1])
        .is_some());
    let failed: Vec<_> = sim
        .action_events_since(0)
        .events
        .into_iter()
        .filter(|e| e.phase == "failed")
        .map(|e| e.order_id)
        .collect();
    assert_eq!(failed, vec![ids[0]]);
}
fn start(sim: &mut Sim, a: Entity, b: Entity, ticks: u32) {
    sim.world_mut().entity_mut(a).insert((
        Target {
            object: b,
            interaction: 0,
        },
        Socialising {
            partner: b,
            interaction: 0,
            remaining_ticks: ticks,
        },
    ));
    sim.world_mut().entity_mut(b).insert(Reserved);
}

#[test]
fn dislike_still_delivers_and_family_adds_an_independent_bonus() {
    let run = |family| {
        let (mut sim, a, b) = chat_fixture();
        let aid = *sim.world().get::<SimId>(a).unwrap();
        let bid = *sim.world().get::<SimId>(b).unwrap();
        sim.world_mut()
            .get_mut::<Relationships>(a)
            .unwrap()
            .bump(bid, -1.);
        sim.world_mut()
            .get_mut::<Relationships>(b)
            .unwrap()
            .bump(aid, 1.);
        if family {
            let mut ties = terri_core::layout::FamilyTies::default();
            ties.set(aid.0, bid.0, Some(terri_core::layout::Relation::Sibling));
            sim.world_mut().insert_resource(ties);
        }
        start(&mut sim, a, b, 2);
        sim.world_mut()
            .run_system_once(crate::systems::social::tick_social)
            .unwrap();
        (
            sim.world().get::<Needs>(a).unwrap().get(NeedId::Social) - 90.,
            sim.world().get::<Needs>(b).unwrap().get(NeedId::Social) - 90.,
        )
    };
    let (disliked, liked) = run(false);
    let (family_disliked, family_liked) = run(true);
    assert!(disliked > 0. && liked > disliked);
    assert!((family_disliked - disliked - 0.075).abs() < 0.00001);
    assert!((family_liked - liked - 0.075).abs() < 0.00001);
    assert_eq!(benefit(-1., 1., false), 0.25);
}

#[test]
fn busy_recipient_finishes_while_initiator_approaches_then_waits_beside_them() {
    let (mut sim, a, b) = chat_fixture();
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(
        terri_core::Position { x: 8., y: 1. },
        pack.find("fridge").unwrap(),
    );
    sim.world_mut().entity_mut(b).insert((
        Target {
            object: fridge,
            interaction: 0,
        },
        Eating {
            object: pack.find("fridge").unwrap(),
            interaction: 0,
            remaining_ticks: 55,
        },
    ));
    sim.world_mut().entity_mut(fridge).insert(Reserved);
    talk(&mut sim, a, b);
    for _ in 0..35 {
        sim.tick();
    }
    assert_eq!(sim.world().get::<Target>(a).unwrap().object, b);
    assert!(sim.world().get::<terri_core::Position>(a).unwrap().x > 1.);
    assert!(sim.world().get::<Eating>(b).is_some());
    assert!(sim.world().get::<Socialising>(a).is_none());
    assert!(
        sim.world().get::<Path>(a).is_none(),
        "an arrived waiter stands rather than retaining a walk"
    );
    assert!(sim.world().get::<terri_core::Blocked>(a).is_some());
    assert_eq!(sim.world().get::<terri_core::Position>(b).unwrap().x, 7.);
    let history = sim.action_events_since(0);
    let phases: Vec<_> = history
        .events
        .iter()
        .filter(|event| event.actor == a.index_u32() && event.order_id == 0)
        .map(|event| event.phase.as_str())
        .collect();
    assert_eq!(phases, vec!["accepted", "approaching", "waiting"]);
    let cursor = history.next_cursor;
    let waiting_position = *sim.world().get::<terri_core::Position>(a).unwrap();
    for _ in 0..8 {
        sim.tick();
        assert!(
            sim.world().get::<Eating>(b).is_some(),
            "the stationary blocker is still performing its current activity"
        );
        assert!(sim.world().get::<Path>(a).is_none());
        assert_eq!(
            *sim.world().get::<terri_core::Position>(a).unwrap(),
            waiting_position
        );
        assert!(
            sim.action_events_since(cursor)
                .events
                .iter()
                .all(|event| event.actor != a.index_u32() || event.order_id != 0),
            "an unchanged wait emits no repeated approach or waiting transition"
        );
    }
    for _ in 0..40 {
        sim.tick();
        if sim.world().get::<Socialising>(a).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<Socialising>(a).is_some());
    assert!(sim.world().get::<Eating>(b).is_none());
}

#[test]
fn waiting_claim_round_trips_mid_approach_and_cancellation_releases_it() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    talk(&mut sim, a, b);
    sim.tick();
    assert!(sim.world().get::<Path>(a).is_some());
    let hash = sim.world_hash();
    let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    restored.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
    assert_eq!(restored.world_hash(), hash);
    sim.tick();
    restored.tick();
    assert_eq!(restored.world_hash(), sim.world_hash());
    restored
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: a.index_u32(),
        });
    restored.flush_commands();
    assert!(restored
        .world()
        .resource::<SocialEpisodes>()
        .rendezvous
        .is_empty());
    assert!(restored.world().get::<Reserved>(b).is_none());
    let cancelled = restored.save_snapshot_v15();
    let mut paused = test_content::sim_with(12, 8, restored.world().resource::<Content>().0);
    paused.load_snapshot_v15(cancelled).unwrap();
    assert!(paused
        .world()
        .resource::<SocialEpisodes>()
        .rendezvous
        .is_empty());
}

#[test]
fn newcomer_waits_for_running_conversation_without_stealing_the_partner() {
    let (mut sim, a, b) = chat_fixture();
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::Position { x: 1., y: 5. },
            Needs::all_at(90.),
        ))
        .id();
    talk(&mut sim, a, b);
    for _ in 0..100 {
        sim.tick();
        if sim.world().get::<Socialising>(a).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<Socialising>(a).is_some());
    talk(&mut sim, c, b);
    sim.tick();
    assert!(sim.world().get::<Socialising>(a).is_some());
    assert_eq!(sim.world().get::<Target>(c).unwrap().object, b);
    assert!(sim.world().get::<Socialising>(c).is_none());
    for _ in 0..100 {
        sim.tick();
        if sim.world().get::<Socialising>(c).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<Socialising>(c).is_some());
    assert!(sim.world().get::<Socialising>(a).is_none());
}

#[test]
fn recipient_player_talk_preempts_inbound_waiter_and_preserves_unrelated_orders() {
    let (mut sim, a, b) = chat_fixture();
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::Position { x: 8., y: 1. },
            Needs::all_at(90.),
        ))
        .id();
    talk(&mut sim, a, b);
    sim.tick();
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(
        terri_core::Position { x: 2., y: 5. },
        pack.find("fridge").unwrap(),
    );
    sim.world_mut()
        .get_mut::<IntentQueue>(a)
        .unwrap()
        .push(terri_core::Intent {
            object: fridge,
            interaction: 0,
            cleanup: None,
            chore: None,
        });
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkToFirst {
            agent: b.index_u32(),
            target: c.index_u32(),
            interaction: 0,
        });
    sim.tick();
    assert_eq!(sim.world().get::<Target>(b).unwrap().object, c);
    assert_eq!(sim.world().get::<Target>(a).map(|t| t.object), Some(b));
    let orders: Vec<_> = sim
        .world()
        .get::<IntentQueue>(a)
        .unwrap()
        .intents()
        .map(|i| i.object)
        .collect();
    assert_eq!(orders, vec![b, fridge]);
    assert!(!sim
        .world()
        .resource::<SocialEpisodes>()
        .rendezvous
        .values()
        .any(|&i| i == a));
}

#[test]
fn same_tick_conversation_redirect_chooses_the_new_listeners_preference() {
    let (mut sim, a, b) = chat_fixture();
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::Position { x: 2., y: 1. },
            Needs::all_at(90.),
        ))
        .id();
    sim.world_mut()
        .entity_mut(a)
        .insert(Hobbies(vec!["reading".into()]));
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.objects[0].interactions[0].tags = vec!["reading".into()];
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    sim.world_mut()
        .entity_mut(b)
        .insert(Personality::with_dispositions(
            [1.; 7],
            [1.; 7],
            vec![(pack.find("fridge").unwrap(), 0, 0.)],
        ));
    sim.world_mut()
        .entity_mut(c)
        .insert(Hobbies(vec!["reading".into()]));
    talk(&mut sim, a, b);
    for _ in 0..100 {
        sim.tick();
        if sim.world().get::<Socialising>(a).is_some() {
            break;
        }
    }
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().topics[&a].listener_preference,
        -1.
    );
    let position = *sim.world().get::<terri_core::Position>(a).unwrap();
    sim.world_mut().entity_mut(c).insert(terri_core::Position {
        x: position.x + 1.,
        y: position.y,
    });
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkToFirst {
            agent: a.index_u32(),
            target: c.index_u32(),
            interaction: 0,
        });
    sim.tick();
    assert_eq!(sim.world().get::<Socialising>(a).unwrap().partner, c);
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().topics[&a].listener_preference,
        0.5
    );
}

#[test]
fn death_tick_prunes_topic_owners_and_communal_peer_references_before_save() {
    for dying_initiator in [false, true] {
        let (mut sim, a, b) = chat_fixture();
        let mut pack = sim.world().resource::<Content>().0.clone();
        pack.reading = terri_data::pack().reading;
        pack.tuning.death_after_ticks = 1;
        let pack = Box::leak(Box::new(pack));
        sim.world_mut().insert_resource(Content(pack));
        let dead = if dying_initiator { a } else { b };
        sim.world_mut()
            .entity_mut(dead)
            .insert(terri_core::SimName("Departing".into()));
        sim.world_mut()
            .get_mut::<Needs>(dead)
            .unwrap()
            .set(NeedId::Energy, 0.);
        start(&mut sim, a, b, 10);
        begin_topics(sim.world_mut());
        sim.tick();
        assert!(sim.world().get::<Agent>(dead).is_none());
        assert!(sim.world().resource::<SocialEpisodes>().topics.is_empty());
        let saved = sim.save_snapshot_v10();
        let mut loaded = test_content::sim_with(12, 8, pack);
        loaded.load_snapshot_v10(saved.clone()).unwrap();
        assert_eq!(loaded.save_snapshot_v10(), saved);
    }
    let (mut sim, p, def) = shared_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.tuning.death_after_ticks = 1;
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    arrive(&mut sim, p[0], def, 100);
    arrive(&mut sim, p[1], def, 100);
    sim.world_mut()
        .entity_mut(p[1])
        .insert(terri_core::SimName("Departing".into()));
    sim.world_mut()
        .get_mut::<Needs>(p[1])
        .unwrap()
        .set(NeedId::Energy, 0.);
    sim.tick();
    assert!(sim.world().get::<Agent>(p[1]).is_none());
    let episodes = sim.world().resource::<SocialEpisodes>();
    assert!(!episodes.communal.contains_key(&p[1]));
    assert!(episodes
        .communal
        .values()
        .all(|e| !e.participants.contains(&p[1])));
    let saved = sim.save_snapshot_v10();
    let mut loaded = Sim::new_with_lot_and_content(12, 8, Content(pack));
    loaded.load_snapshot_v10(saved.clone()).unwrap();
    assert_eq!(loaded.save_snapshot_v10(), saved);
}

#[test]
fn topics_replay_and_listener_dislike_is_directional_once_at_completion() {
    let (mut sim, a, b) = chat_fixture();
    // A hobby gives a positive authored interest even without object dispositions.
    sim.world_mut()
        .entity_mut(a)
        .insert(Hobbies(vec!["reading".into()]));
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.objects[0].interactions[0].tags = vec!["reading".into()];
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    sim.world_mut()
        .entity_mut(b)
        .insert(Personality::with_dispositions(
            [1.; 7],
            [1.; 7],
            vec![(pack.find("fridge").unwrap(), 0, 0.)],
        ));
    start(&mut sim, a, b, 3);
    begin_topics(sim.world_mut());
    let topic = &sim.world().resource::<SocialEpisodes>().topics[&a];
    assert_eq!(
        (
            topic.code,
            topic.initiator_preference,
            topic.listener_preference
        ),
        (8, 0.5, -1.)
    );
    let before_a = sim
        .world()
        .get::<Relationships>(a)
        .unwrap()
        .feeling(*sim.world().get::<SimId>(b).unwrap());
    let before_b = sim
        .world()
        .get::<Relationships>(b)
        .unwrap()
        .feeling(*sim.world().get::<SimId>(a).unwrap());
    for _ in 0..2 {
        sim.world_mut()
            .run_system_once(crate::systems::social::tick_social)
            .unwrap();
    }
    assert_eq!(
        sim.world()
            .get::<Relationships>(b)
            .unwrap()
            .feeling(*sim.world().get::<SimId>(a).unwrap()),
        before_b
    );
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    let after_b = sim
        .world()
        .get::<Relationships>(b)
        .unwrap()
        .feeling(*sim.world().get::<SimId>(a).unwrap());
    assert!((after_b - before_b + 0.02).abs() < 0.000001);
    assert!(
        sim.world()
            .get::<Relationships>(a)
            .unwrap()
            .feeling(*sim.world().get::<SimId>(b).unwrap())
            > before_a
    );
    sim.sync_render_buffer();
    assert!(sim
        .render_buffer()
        .conversation_topics
        .iter()
        .all(|&t| t == 0));
}

#[test]
fn social_capacity_increases_shared_interest_weight_without_admitting_dislike() {
    assert_eq!(topic_weight(0.5, 1., 0.), 0.5);
    assert_eq!(topic_weight(0.5, 1., 1.), 2.5);
    assert_eq!(topic_weight(0.5, -1., 1.), 0.5);
    assert_eq!(topic_weight(-1., 1., 1.), 0.);
    let (mut sim, a, b) = chat_fixture();
    start(&mut sim, a, b, 3);
    begin_topics(sim.world_mut());
    let t = &sim.world().resource::<SocialEpisodes>().topics[&a];
    assert_eq!(
        (t.code, t.tag.as_str(), t.initiator_preference),
        (4, "smalltalk", 0.)
    );
    assert!(sim.world().get::<IntentQueue>(a).is_none());
}

#[test]
fn topic_sampler_uses_social_capacity_across_fixed_seeds_and_excludes_own_dislikes() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.objects[0].interactions[0].tags = vec!["exercise".into()];
    let mut cooking = test_content::object("cooking_interest", &[(NeedId::Fun, 1.)], 10);
    cooking.interactions[0].tags = vec!["cooking".into()];
    pack.objects.push(cooking);
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    sim.world_mut()
        .entity_mut(a)
        .insert(Hobbies(vec!["reading".into(), "exercise".into()]));
    sim.world_mut().entity_mut(b).insert((
        Hobbies(vec!["reading".into()]),
        Personality::with_dispositions([1.; 7], [1.; 7], vec![(terri_core::ObjectDefId(0), 0, 0.)]),
    ));
    start(&mut sim, a, b, 100);
    let mut shared_counts = Vec::new();
    for inclination in [1., 3.] {
        let mut satisfaction = [1.; 7];
        satisfaction[NeedId::Social.index()] = inclination;
        sim.world_mut()
            .entity_mut(a)
            .insert(Personality::with_dispositions(
                [1.; 7],
                satisfaction,
                vec![(terri_core::ObjectDefId(1), 0, 0.)],
            ));
        let mut shared = 0;
        for seed in 0..256 {
            sim.world_mut()
                .insert_resource(SimRng::from_seed(seed + 1000));
            sim.world_mut()
                .resource_mut::<SocialEpisodes>()
                .topics
                .clear();
            begin_topics(sim.world_mut());
            let topic = &sim.world().resource::<SocialEpisodes>().topics[&a];
            assert!(topic.initiator_preference > 0.);
            assert_ne!(topic.tag, "cooking");
            shared += u32::from(topic.tag == "reading");
        }
        shared_counts.push(shared);
    }
    assert!(
        shared_counts[0] > 70 && shared_counts[0] < 180,
        "fixed seeds exercise both topics: {shared_counts:?}"
    );
    assert!(
        shared_counts[1] > shared_counts[0] + 40,
        "actual draws favor shared interests with social inclination: {shared_counts:?}"
    );
}

#[test]
fn lonely_disliked_company_and_family_are_scored_as_the_benefit_delivered() {
    let run = |level, family| {
        let (mut sim, a, b) = chat_fixture();
        sim.world_mut()
            .get_mut::<Needs>(a)
            .unwrap()
            .set(NeedId::Social, level);
        let aid = *sim.world().get::<SimId>(a).unwrap();
        let bid = *sim.world().get::<SimId>(b).unwrap();
        sim.world_mut()
            .get_mut::<Relationships>(a)
            .unwrap()
            .bump(bid, -1.);
        if family {
            let mut ties = terri_core::layout::FamilyTies::default();
            ties.set(aid.0, bid.0, Some(terri_core::layout::Relation::Sibling));
            sim.world_mut().insert_resource(ties);
        }
        sim.tick();
        sim.world()
            .resource::<crate::systems::autonomy::DecisionTelemetry>()
            .0
            .iter()
            .find(|d| d.agent == a.index_u32())
            .unwrap()
            .choices
            .iter()
            .find(|c| c.0 == b.index_u32() && c.1 == 0)
            .unwrap()
            .2
    };
    let ordinary = run(50., false);
    let lonely = run(0., false);
    let family = run(50., true);
    assert!(ordinary > 0. && lonely > ordinary);
    // At full dislike, family contributes the same additional authored need
    // value to selection that the delivery test observes.
    let strength = test_content::tuning().relationship_delta_scale;
    assert!(
        (family / ordinary - benefit(-1., strength, true) / benefit(-1., strength, false)).abs()
            < 0.001
    );
}

#[test]
fn shared_activity_selection_values_company_at_the_future_endpoint() {
    let (mut sim, p, def) = shared_fixture();
    // Only one incumbent and one idle chooser. The chooser starts outside the
    // company radius, but the chosen exercise station is inside it.
    for person in [p[2], p[3]] {
        sim.world_mut().entity_mut(person).remove::<Agent>();
    }
    arrive(&mut sim, p[0], def, 1000);
    sim.world_mut()
        .entity_mut(p[1])
        .remove::<Target>()
        .insert(terri_core::Position { x: 9., y: 7. });
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.decay_per_tick = [0.; 7];
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    sim.world_mut()
        .entity_mut(p[1])
        .insert(Needs::with(NeedId::Social, 0.));
    let id = *sim.world().get::<SimId>(p[0]).unwrap();
    sim.world_mut()
        .get_mut::<Relationships>(p[1])
        .unwrap()
        .bump(id, -1.);
    sim.tick();
    let choices = &sim
        .world()
        .resource::<crate::systems::autonomy::DecisionTelemetry>()
        .0
        .iter()
        .find(|d| d.agent == p[1].index_u32())
        .unwrap()
        .choices;
    let score = choices
        .iter()
        .filter(|c| c.0 != p[0].index_u32() && c.0 != p[1].index_u32() && c.1 == 0)
        .map(|c| c.2)
        .fold(0.0f32, f32::max);
    assert!(
        score > 0.02,
        "actual nearby company is worth walking to, even disliked: {choices:?}"
    );
}

#[test]
fn urgent_waiting_recipient_preserves_both_directed_and_unrelated_orders() {
    let (mut sim, a, b) = chat_fixture();
    talk(&mut sim, a, b);
    sim.tick();
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(
        terri_core::Position { x: 2., y: 5. },
        pack.find("fridge").unwrap(),
    );
    sim.world_mut()
        .get_mut::<IntentQueue>(a)
        .unwrap()
        .push(terri_core::Intent {
            object: fridge,
            interaction: 0,
            cleanup: None,
            chore: None,
        });
    sim.world_mut()
        .get_mut::<Needs>(b)
        .unwrap()
        .set(NeedId::Bladder, 0.);
    maintain(sim.world_mut());
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().rendezvous.get(&b),
        Some(&a)
    );
    assert_eq!(sim.world().get::<Target>(a).map(|t| t.object), Some(b));
    assert_eq!(
        sim.world()
            .get::<IntentQueue>(a)
            .unwrap()
            .intents()
            .map(|intent| intent.object)
            .collect::<Vec<_>>(),
        vec![b, fridge]
    );
    assert!(sim.world().get::<Reserved>(b).is_some());
}

#[test]
fn waiting_talker_follows_cooking_stations_and_waits_for_the_entire_recipe() {
    let mut sim = Sim::new_with_lot(24, 16);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.decay_per_tick = [0.; 7];
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let mut objects = vec![];
    for (i, kind) in ["fridge", "counter", "stove", "dining_table"]
        .iter()
        .enumerate()
    {
        objects.push(sim.spawn_object(
            terri_core::Position {
                x: 5. + i as f32 * 4.,
                y: 4.,
            },
            pack.find(kind).unwrap(),
        ));
    }
    let mut create = |x| {
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        sim.world_mut()
            .spawn((
                Agent,
                id,
                terri_core::Position { x, y: 5. },
                Needs::all_at(90.),
                Personality::neutral(),
                Relationships::default(),
                IntentQueue::default(),
            ))
            .id()
    };
    let a = create(1.);
    let b = create(5.);
    let c = create(9.);
    let recipe = pack
        .chains
        .iter()
        .position(|c| c.id == "cook_dinner")
        .unwrap() as u32;
    let row = pack
        .object(pack.find("fridge").unwrap())
        .interactions
        .iter()
        .position(|a| a.id == "cook_dinner")
        .unwrap() as u32;
    let (mut progress, mut origin, activity) = crate::recipe_actions::begin(
        pack,
        pack.find("fridge").unwrap(),
        row,
        recipe as usize,
        objects[0],
    );
    progress.step = 1;
    origin.1 = crate::recipe_actions::SelectedUse::Complete;
    sim.world_mut().entity_mut(c).insert((
        progress,
        origin,
        activity,
        Target {
            object: objects[1],
            interaction: crate::systems::chain::CHAIN_STEP,
        },
        terri_core::StepWork {
            remaining_ticks: 50,
        },
        terri_core::Carrying(
            pack.item_kinds
                .iter()
                .position(|i| i == "ingredients")
                .unwrap() as u32,
        ),
    ));
    sim.world_mut().entity_mut(objects[1]).insert(Reserved);
    sim.world_mut().entity_mut(b).insert((
        crate::recipe_actions::begin(
            pack,
            pack.find("fridge").unwrap(),
            row,
            recipe as usize,
            objects[0],
        ),
        Target {
            object: objects[0],
            interaction: crate::systems::chain::CHAIN_STEP,
        },
        terri_core::StepWork { remaining_ticks: 2 },
    ));
    sim.world_mut().entity_mut(objects[0]).insert(Reserved);
    talk(&mut sim, a, b);
    let mut stations = std::collections::BTreeSet::new();
    let mut spoke = false;
    let mut saved_busy = false;
    let mut counter_wait_seen = false;
    for _ in 0..1400 {
        sim.tick();
        if sim.world().get::<terri_core::ChainState>(b).is_some() {
            counter_wait_seen |=
                sim.world().get::<Target>(b).is_none() && sim.world().get::<Path>(b).is_none();
            assert!(
                sim.world().get::<Socialising>(a).is_none(),
                "a recipe transition is still busy"
            );
            if let Some(target) = sim.world().get::<Target>(b) {
                stations.insert(target.object);
            }
            if !saved_busy && stations.len() >= 2 && sim.world().get::<Path>(b).is_some() {
                let saved = sim.save_snapshot_v10();
                let mut loaded = Sim::new_with_lot_and_content(24, 16, Content(pack));
                loaded.load_snapshot_v10(saved.clone()).unwrap();
                assert_eq!(loaded.save_snapshot_v10(), saved);
                saved_busy = true;
            }
        }
        if sim.world().get::<Socialising>(a).is_some() {
            spoke = true;
            break;
        }
    }
    assert!(
        stations.len() >= 3,
        "the busy recipient really moved between recipe stations"
    );
    assert!(saved_busy, "the moving busy claim round-tripped");
    assert!(
        counter_wait_seen,
        "a blocked station leaves a Target-less but unfinished recipe"
    );
    assert!(
        spoke,
        "the waiting initiator spoke after the complete recipe"
    );
}

fn shared_fixture() -> (Sim, Vec<Entity>, terri_core::ObjectDefId) {
    let mut sim = Sim::new_with_lot(12, 8);
    let pack = sim.world().resource::<Content>().0;
    let def = pack.find("moving_box").unwrap();
    let mut people = vec![];
    for i in 0..4 {
        let object = sim.spawn_object(
            terri_core::Position {
                x: 2. + i as f32,
                y: 2.,
            },
            def,
        );
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        let e = sim
            .world_mut()
            .spawn((
                Agent,
                id,
                terri_core::Position {
                    x: 2. + i as f32,
                    y: 3.,
                },
                Needs::all_at(90.),
                Target {
                    object,
                    interaction: 0,
                },
                Personality::neutral(),
                Relationships::default(),
            ))
            .id();
        people.push(e);
    }
    (sim, people, def)
}
fn arrive(sim: &mut Sim, person: Entity, def: terri_core::ObjectDefId, ticks: u32) {
    sim.world_mut()
        .entity_mut(person)
        .remove::<Path>()
        .insert(Eating {
            object: def,
            interaction: 0,
            remaining_ticks: ticks,
        });
}

#[test]
fn actual_newcomer_arrivals_extend_each_participant_at_most_twice() {
    let (mut sim, p, def) = shared_fixture();
    arrive(&mut sim, p[0], def, 1);
    sim.world_mut().entity_mut(p[1]).insert(Path {
        steps: vec![(3, 3)],
        cursor: 0,
    });
    crate::social_company::extend_episodes(sim.world_mut());
    assert_eq!(
        sim.world().get::<Eating>(p[0]).unwrap().remaining_ticks,
        2,
        "hold preserves overlap before arrival"
    );
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().communal[&p[0]].extensions,
        0,
        "travel is not an extension"
    );
    arrive(&mut sim, p[1], def, 100);
    crate::social_company::extend_episodes(sim.world_mut());
    assert_eq!(
        sim.world().get::<Eating>(p[0]).unwrap().remaining_ticks,
        100
    );
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().communal[&p[0]].extensions,
        1
    );
    arrive(&mut sim, p[2], def, 120);
    crate::social_company::extend_episodes(sim.world_mut());
    assert_eq!(
        sim.world().get::<Eating>(p[0]).unwrap().remaining_ticks,
        120
    );
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().communal[&p[0]].extensions,
        2
    );
    arrive(&mut sim, p[3], def, 140);
    crate::social_company::extend_episodes(sim.world_mut());
    assert_eq!(
        sim.world().get::<Eating>(p[0]).unwrap().remaining_ticks,
        120
    );
    assert_eq!(
        sim.world().get::<Eating>(p[1]).unwrap().remaining_ticks,
        140
    );
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().communal[&p[1]].extensions,
        2
    );
    assert_eq!(
        sim.world().get::<Eating>(p[2]).unwrap().remaining_ticks,
        140
    );
    sim.world_mut()
        .get_mut::<Eating>(p[0])
        .unwrap()
        .remaining_ticks = 1;
    sim.world_mut()
        .entity_mut(p[3])
        .remove::<Eating>()
        .insert(Path {
            steps: vec![(5, 3)],
            cursor: 0,
        });
    crate::social_company::extend_episodes(sim.world_mut());
    assert_eq!(
        sim.world().get::<Eating>(p[0]).unwrap().remaining_ticks,
        1,
        "cap prevents further approach holds"
    );
}

#[test]
fn same_tick_arrivals_use_original_durations_and_cancelled_approaches_release_holds() {
    let (mut sim, p, def) = shared_fixture();
    arrive(&mut sim, p[0], def, 20);
    crate::social_company::extend_episodes(sim.world_mut());
    arrive(&mut sim, p[1], def, 100);
    arrive(&mut sim, p[2], def, 80);
    crate::social_company::extend_episodes(sim.world_mut());
    assert_eq!(
        sim.world().get::<Eating>(p[0]).unwrap().remaining_ticks,
        100
    );
    assert_eq!(
        sim.world().get::<Eating>(p[2]).unwrap().remaining_ticks,
        80,
        "newcomer does not inherit another arrival's extended clock"
    );
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().communal[&p[0]].extensions,
        1
    );
    let (mut sim, p, def) = shared_fixture();
    arrive(&mut sim, p[0], def, 1);
    sim.world_mut().entity_mut(p[1]).insert(Path {
        steps: vec![(3, 3)],
        cursor: 0,
    });
    crate::social_company::extend_episodes(sim.world_mut());
    sim.world_mut().entity_mut(p[1]).remove::<(Path, Target)>();
    sim.world_mut()
        .get_mut::<Eating>(p[0])
        .unwrap()
        .remaining_ticks = 1;
    crate::social_company::extend_episodes(sim.world_mut());
    assert_eq!(sim.world().get::<Eating>(p[0]).unwrap().remaining_ticks, 1);
}

#[test]
fn liked_stranger_company_keeps_the_independent_disliked_family_bonus() {
    let (mut sim, p, def) = shared_fixture();
    for &person in &p[..3] {
        arrive(&mut sim, person, def, 100);
    }
    let aid = *sim.world().get::<SimId>(p[0]).unwrap();
    let friend = *sim.world().get::<SimId>(p[1]).unwrap();
    let family = *sim.world().get::<SimId>(p[2]).unwrap();
    sim.world_mut()
        .get_mut::<Relationships>(p[0])
        .unwrap()
        .bump(friend, 1.);
    sim.world_mut()
        .get_mut::<Relationships>(p[0])
        .unwrap()
        .bump(family, -1.);
    let mut ties = terri_core::layout::FamilyTies::default();
    ties.set(aid.0, family.0, Some(terri_core::layout::Relation::Sibling));
    sim.world_mut().insert_resource(ties);
    sim.world_mut()
        .get_mut::<Needs>(p[0])
        .unwrap()
        .set(NeedId::Social, 30.);
    crate::social_company::refresh(sim.world_mut());
    let company = sim
        .world()
        .resource::<crate::social_company::SocialCompany>();
    let feelings = sim.world().get::<Relationships>(p[0]).unwrap();
    let target = *sim.world().get::<Target>(p[0]).unwrap();
    assert_eq!(company.active_scale(p[0], feelings), 1.6);
    assert_eq!(
        company.proposed_scale(p[0], target.object, 0, feelings, (2, 3)),
        1.6
    );
    crate::need_interactions::tick(sim.world_mut());
    assert!(
        (sim.world().get::<Needs>(p[0]).unwrap().get(NeedId::Social) - 30.192).abs() < 0.00001,
        "family adds once even when a stranger is more liked"
    );
}

#[test]
fn paused_talk_flush_saves_only_physical_admission_and_round_trips() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    talk(&mut sim, a, b);
    sim.flush_commands();
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().rendezvous.get(&b),
        Some(&a)
    );
    assert_eq!(sim.world().get::<Target>(a).map(|t| t.object), Some(b));
    assert_eq!(execution_order(sim.world(), a), Some(0));
    let snapshot = sim.save_snapshot_v15();
    let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    restored.load_snapshot_v15(snapshot.clone()).unwrap();
    assert_eq!(restored.save_snapshot_v15(), snapshot);
    assert_eq!(restored.world_hash(), sim.world_hash());
    for _ in 0..100 {
        sim.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), sim.world_hash());
    }
}

#[test]
fn autonomous_same_pair_does_not_complete_the_later_player_request() {
    let (mut sim, a, b) = chat_fixture();
    start(&mut sim, a, b, 3);
    maintain(sim.world_mut());
    talk(&mut sim, a, b);
    sim.flush_commands();
    assert_eq!(execution_order(sim.world(), a), None);
    let id = sim.world().get::<IntentQueue>(a).unwrap().entries()[0].id;
    for _ in 0..3 {
        sim.tick();
    }
    assert!(sim
        .world()
        .get::<IntentQueue>(a)
        .unwrap()
        .order(id)
        .is_some());
    assert!(!sim
        .action_events_since(0)
        .events
        .iter()
        .any(|e| e.phase == "completed"));
    for _ in 0..160 {
        sim.tick();
    }
    let events = sim.action_events_since(0).events;
    assert_eq!(
        events
            .iter()
            .filter(|e| e.actor == a.index_u32() && e.order_id == id && e.phase == "completed")
            .count(),
        1
    );
}

#[test]
fn autonomous_object_completion_does_not_spend_matching_unserved_player_order() {
    let (mut sim, a, _) = chat_fixture();
    let def = sim.world().resource::<Content>().0.find("fridge").unwrap();
    let object = sim.spawn_object(terri_core::Position { x: 2., y: 1. }, def);
    sim.world_mut().entity_mut(a).insert((
        Target {
            object,
            interaction: 0,
        },
        Eating {
            object: def,
            interaction: 0,
            remaining_ticks: 2,
        },
    ));
    sim.world_mut().entity_mut(object).insert(Reserved);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: a.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        });
    sim.flush_commands();
    assert!(sim
        .world()
        .get::<crate::player_actions::ServedOrder>(a)
        .is_none());
    sim.tick();
    sim.tick();
    assert_eq!(sim.world().get::<IntentQueue>(a).unwrap().len(), 1);
    assert!(!sim
        .action_events_since(0)
        .events
        .iter()
        .any(|event| event.phase == "completed"));
    for _ in 0..120 {
        sim.tick();
    }
    let events = sim.action_events_since(0).events;
    assert_eq!(
        events
            .iter()
            .filter(|event| event.actor == a.index_u32()
                && event.order_id == 0
                && event.phase == "completed")
            .count(),
        1
    );
}

#[test]
fn frozen_social_save_adopts_only_the_matching_front_execution() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    talk(&mut sim, a, b);
    talk(&mut sim, a, b);
    for _ in 0..100 {
        sim.tick();
        if sim.world().get::<Socialising>(a).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<Socialising>(a).is_some());
    let frozen = sim.save_snapshot_v9();
    let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    restored.load_snapshot_v9(frozen).unwrap();
    assert_eq!(execution_order(restored.world(), a), Some(0));
    for _ in 0..180 {
        restored.tick();
    }
    let completed: Vec<_> = restored
        .action_events_since(0)
        .events
        .into_iter()
        .filter(|event| event.phase == "completed")
        .map(|event| (event.actor, event.order_id))
        .collect();
    assert_eq!(completed, vec![(a.index_u32(), 0), (a.index_u32(), 1)]);
}

#[test]
fn every_competing_social_boundary_has_one_physical_owner_and_round_trips() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let identity = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            identity,
            terri_core::Position { x: 1., y: 4. },
            Needs::all_at(90.),
        ))
        .id();
    let definition = sim.world().resource::<Content>().0.find("fridge").unwrap();
    let object = sim.spawn_object(terri_core::Position { x: 8., y: 1. }, definition);
    sim.world_mut().entity_mut(object).insert(Reserved);
    sim.world_mut().entity_mut(b).insert((
        Target {
            object,
            interaction: 0,
        },
        Eating {
            object: definition,
            interaction: 0,
            remaining_ticks: 55,
        },
    ));
    talk(&mut sim, c, b);
    talk(&mut sim, a, b);
    talk(&mut sim, b, a);
    talk(&mut sim, a, b);
    sim.flush_commands();
    for _ in 0..320 {
        let state = sim.world().resource::<SocialEpisodes>();
        let mut participants = BTreeSet::new();
        for (&actor, execution) in &state.executions {
            assert_eq!(
                sim.world()
                    .get::<Target>(actor)
                    .map(|t| (t.object, t.interaction)),
                Some((execution.recipient, execution.interaction))
            );
            if execution.admitted {
                assert!(participants.insert(actor));
                assert!(participants.insert(execution.recipient));
                assert!(!state.executions.contains_key(&execution.recipient));
                assert!(sim.world().get::<Target>(execution.recipient).is_none());
                assert!(sim.world().get::<Path>(execution.recipient).is_none());
                assert!(sim.world().get::<Reserved>(execution.recipient).is_some());
            }
        }
        for (&recipient, &actor) in &state.rendezvous {
            let execution = state.executions.get(&actor).unwrap();
            assert!(execution.admitted);
            assert_eq!(execution.phase, ExecutionPhase::Approaching);
            assert_eq!(execution.recipient, recipient);
        }
        let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
        restored.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
        assert_eq!(restored.world_hash(), sim.world_hash());
        sim.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), sim.world_hash());
    }
}

#[test]
fn autonomous_approach_keeps_its_exact_claim_through_maintenance_and_save() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    sim.world_mut()
        .get_mut::<Needs>(a)
        .unwrap()
        .set(NeedId::Social, 0.);
    sim.tick();
    assert_eq!(sim.world().get::<Target>(a).map(|t| t.object), Some(b));
    assert_eq!(execution_order(sim.world(), a), None);
    assert_eq!(
        sim.world().resource::<SocialEpisodes>().rendezvous.get(&b),
        Some(&a)
    );
    maintain(sim.world_mut());
    maintain(sim.world_mut());
    assert!(sim.world().get::<Reserved>(b).is_some());
    let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    restored.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
    assert_eq!(restored.world_hash(), sim.world_hash());
    for _ in 0..100 {
        sim.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), sim.world_hash());
    }
}

#[test]
fn frozen_object_save_adopts_its_original_front_without_repeating_it() {
    let (mut sim, a, _) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let definition = sim.world().resource::<Content>().0.find("fridge").unwrap();
    let object = sim.spawn_object(terri_core::Position { x: 2., y: 1. }, definition);
    for _ in 0..2 {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObject {
                agent: a.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            });
    }
    for _ in 0..100 {
        sim.tick();
        if sim.world().get::<Eating>(a).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<Eating>(a).is_some());
    let frozen = sim.save_snapshot_v5();
    let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    restored.load_snapshot_v5(frozen).unwrap();
    assert_eq!(
        restored
            .world()
            .get::<crate::player_actions::ServedOrder>(a)
            .map(|owner| owner.0),
        Some(0)
    );
    for _ in 0..200 {
        restored.tick();
    }
    let completed: Vec<_> = restored
        .action_events_since(0)
        .events
        .into_iter()
        .filter(|event| event.phase == "completed")
        .map(|event| (event.actor, event.order_id))
        .collect();
    assert_eq!(completed, vec![(a.index_u32(), 0), (a.index_u32(), 1)]);
}

#[test]
fn pending_and_running_system_fights_keep_provenance_through_v15() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    let mut fight = test_content::interaction("fight", &[], 40);
    fight.tags = vec![crate::fights::FIGHT_TAG.into()];
    pack.social.push(fight);
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let mut queue = IntentQueue::default();
    let id = queue
        .insert_order(
            terri_core::Intent {
                object: b,
                interaction: 1,
                cleanup: None,
                chore: None,
            },
            None,
            false,
        )
        .unwrap();
    sim.world_mut().entity_mut(a).insert(queue);
    sim.world_mut()
        .resource_mut::<crate::fights::Fights>()
        .restore_order(a, id);
    let pending = sim.save_snapshot_v15();
    assert!(pending.player_orders.orders.is_empty());
    assert!(pending.social_executions.is_empty());
    assert_eq!(pending.system_social_orders, vec![(a.index_u32(), id)]);
    let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    restored.load_snapshot_v15(pending).unwrap();
    assert_eq!(restored.world_hash(), sim.world_hash());
    for _ in 0..120 {
        sim.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), sim.world_hash());
        assert!(sim.save_snapshot_v15().player_orders.orders.is_empty());
        let mut checkpoint = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
        checkpoint
            .load_snapshot_v15(sim.save_snapshot_v15())
            .unwrap();
        assert_eq!(checkpoint.world_hash(), sim.world_hash());
    }
    assert!(sim.world().get::<IntentQueue>(a).unwrap().is_empty());
    assert!(sim.action_events_since(0).events.is_empty());
}

#[test]
fn a_later_explicit_reciprocal_front_redirects_an_already_served_front() {
    for running in [false, true] {
        let (mut sim, a, b) = chat_fixture();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkToFirst {
                agent: a.index_u32(),
                target: b.index_u32(),
                interaction: 0,
            });
        sim.flush_commands();
        if running {
            for _ in 0..100 {
                sim.tick();
                if sim.world().get::<Socialising>(a).is_some() {
                    break;
                }
            }
        }
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkToFirst {
                agent: b.index_u32(),
                target: a.index_u32(),
                interaction: 0,
            });
        sim.flush_commands();
        assert_eq!(
            execution_order(sim.world(), b),
            Some(0),
            "a later explicit front redirects the recipient, running={running}"
        );
        assert!(sim.world().get::<Target>(a).is_none());
        assert!(sim
            .world()
            .get::<IntentQueue>(a)
            .unwrap()
            .order(0)
            .is_some());
        for _ in 0..250 {
            sim.tick();
        }
        let completed: Vec<_> = sim
            .action_events_since(0)
            .events
            .into_iter()
            .filter(|event| event.phase == "completed")
            .map(|event| (event.actor, event.order_id))
            .collect();
        assert_eq!(completed, vec![(b.index_u32(), 0), (a.index_u32(), 0)]);
    }
}

#[test]
fn system_cancel_at_ordinary_command_boundary_removes_exact_execution() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    let mut fight = test_content::interaction("fight", &[], 40);
    fight.tags = vec![crate::fights::FIGHT_TAG.into()];
    pack.social.push(fight);
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    let mut queue = IntentQueue::default();
    let id = queue
        .insert_order(
            terri_core::Intent {
                object: b,
                interaction: 1,
                cleanup: None,
                chore: None,
            },
            None,
            false,
        )
        .unwrap();
    sim.world_mut().entity_mut(a).insert(queue);
    sim.world_mut()
        .resource_mut::<crate::fights::Fights>()
        .restore_order(a, id);
    sim.flush_commands();
    assert!(sim
        .world()
        .resource::<SocialEpisodes>()
        .executions
        .contains_key(&a));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CancelIntents {
            agent: a.index_u32(),
        });
    sim.world_mut()
        .run_system_once(crate::systems::command::drain_ordinary_commands)
        .unwrap();
    assert!(sim.world().get::<IntentQueue>(a).unwrap().is_empty());
    assert!(!sim.world().resource::<SocialEpisodes>().executions.contains_key(&a),"the ordinary command boundary must release the exact system execution without whole-world arbitration");
    assert!(sim.world().get::<Reserved>(b).is_none());
    let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    restored.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
    assert_eq!(restored.world_hash(), sim.world_hash());
}

#[test]
fn explicit_talk_front_suspends_recipe_and_resumes_original_order_identity() {
    let mut sim = Sim::new_with_lot(24, 16);
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.decay_per_tick = [0.; 7];
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let mut objects = Vec::new();
    for (i, kind) in ["fridge", "counter", "stove", "dining_table"]
        .into_iter()
        .enumerate()
    {
        objects.push(sim.spawn_object(
            terri_core::Position {
                x: 5. + i as f32 * 4.,
                y: 4.,
            },
            pack.find(kind).unwrap(),
        ));
    }
    fn create(sim: &mut Sim, x: f32) -> Entity {
        let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
        sim.world_mut()
            .spawn((
                Agent,
                id,
                terri_core::Position { x, y: 5. },
                Needs::all_at(90.),
                Personality::neutral(),
                Relationships::default(),
                IntentQueue::default(),
            ))
            .id()
    }
    let actor = create(&mut sim, 4.);
    let row = pack
        .object(pack.find("fridge").unwrap())
        .interactions
        .iter()
        .position(|action| action.id == "cook_dinner")
        .unwrap() as u32;
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: actor.index_u32(),
            object: objects[0].index_u32(),
            interaction: row,
        });
    for _ in 0..300 {
        sim.tick();
        if sim.world().get::<terri_core::StepWork>(actor).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<terri_core::StepWork>(actor).is_some());
    assert_eq!(
        sim.world()
            .get::<crate::recipe_actions::RecipeOrder>(actor)
            .map(|owner| owner.0),
        Some(0)
    );
    // Create the listener only after cooking begins, so no autonomous activity is interrupted by fixture setup.
    let recipient = create(&mut sim, 1.);
    assert!(sim.world().get::<Target>(recipient).is_none());
    assert!(sim.world().get::<Path>(recipient).is_none());
    assert!(sim
        .world()
        .get::<terri_core::ChainState>(recipient)
        .is_none());
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkToFirst {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        });
    let mut interrupted = false;
    let mut interruption_cursor = 0;
    for _ in 0..150 {
        sim.tick();
        if sim.world().get::<Socialising>(actor).is_some() {
            assert!(
                sim.world().get::<terri_core::ChainState>(actor).is_some(),
                "the original recipe remains suspended while the explicit front runs"
            );
            assert_eq!(
                sim.world()
                    .get::<crate::recipe_actions::RecipeOrder>(actor)
                    .map(|owner| owner.0),
                Some(0)
            );
            assert!(sim
                .world()
                .get::<IntentQueue>(actor)
                .unwrap()
                .order(0)
                .is_some());
            let history = sim.action_events_since(0);
            let last = history
                .events
                .iter()
                .rev()
                .find(|event| event.actor == actor.index_u32() && event.order_id == 0)
                .unwrap();
            assert_eq!(
                last.phase, "waiting",
                "the retained recipe waits while the newer social order runs"
            );
            interruption_cursor = history.next_cursor;
            let mut restored = Sim::new_with_lot_and_content(24, 16, Content(pack));
            restored.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
            assert_eq!(restored.world_hash(), sim.world_hash());
            interrupted = true;
            break;
        }
    }
    assert!(
        interrupted,
        "the new explicit front must run before the retained recipe finishes; actor target={:?} chain={:?} path={:?} execution={:?}; recipient target={:?} chain={:?} path={:?}; recent={:?}",
        sim.world().get::<Target>(actor),sim.world().get::<terri_core::ChainState>(actor),sim.world().get::<Path>(actor),sim.world().resource::<SocialEpisodes>().executions.get(&actor),
        sim.world().get::<Target>(recipient),sim.world().get::<terri_core::ChainState>(recipient),sim.world().get::<Path>(recipient),sim.action_events_since(0).events.iter().rev().take(6).collect::<Vec<_>>()
    );
    assert_interrupted_work_resumes_once(&mut sim, actor, interruption_cursor, |sim, person| {
        sim.world()
            .get::<terri_core::StepWork>(person)
            .map(|work| work.remaining_ticks)
    });
    for _ in 0..2200 {
        sim.tick();
        if sim.world().get::<IntentQueue>(actor).unwrap().is_empty() {
            break;
        }
    }
    let completed: Vec<_> = sim
        .action_events_since(0)
        .events
        .into_iter()
        .filter(|event| event.actor == actor.index_u32() && event.phase == "completed")
        .map(|event| event.order_id)
        .collect();
    assert_eq!(completed, vec![1, 0]);
}

#[test]
fn explicit_talk_front_suspends_chore_and_resumes_original_order_identity() {
    use terri_core::chores::{ChoreKey, ChoreKind, SavedChores};
    let mut sim = Sim::new_with_lot(16, 8);
    let pack = sim.world().resource::<Content>().0;
    let mut create = |name: &str, x: f32| {
        let person = crate::household::spawn_member(
            sim.world_mut(),
            &pack.personalities,
            &pack.traits,
            crate::household::Member {
                name: name.into(),
                personality: 0,
                position: terri_core::Position { x, y: 1. },
                needs: [100.; 7],
                hobbies: vec![],
                traits: &[],
                career: None,
                instinct: Some(50),
            },
        );
        sim.world_mut()
            .get_mut::<Personality>(person)
            .unwrap()
            .drain = [0.; 7];
        person
    };
    let actor = create("Sweeper", 7.);
    let recipient = create("Talker", 1.);
    crate::chores::ensure(sim.world_mut());
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target: crate::room_regions::RoomRegions::from_world(sim.world())
            .at((7, 1))
            .unwrap(),
    };
    crate::chores::add(
        &mut sim.world_mut().resource_mut::<SavedChores>().floors,
        23,
        700,
    );
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CleanChoreFirst {
            agent: actor.index_u32(),
            key,
        });
    for _ in 0..100 {
        sim.tick();
        if sim
            .world()
            .get::<terri_core::chores::ChoreWork>(actor)
            .is_some()
        {
            break;
        }
    }
    assert!(sim
        .world()
        .get::<terri_core::chores::ChoreWork>(actor)
        .is_some());
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkToFirst {
            agent: actor.index_u32(),
            target: recipient.index_u32(),
            interaction: 0,
        });
    let mut interrupted = false;
    let mut interruption_cursor = 0;
    for _ in 0..150 {
        sim.tick();
        if sim.world().get::<Socialising>(actor).is_some() {
            let task = sim
                .world()
                .resource::<SavedChores>()
                .tasks
                .iter()
                .find(|task| task.person == actor.index_u32())
                .expect("the original chore remains retained during the explicit front");
            assert!(task.suspended);
            assert!(task.remaining > 0);
            let history = sim.action_events_since(0);
            let last = history
                .events
                .iter()
                .rev()
                .find(|event| event.actor == actor.index_u32() && event.order_id == 0)
                .unwrap();
            assert_eq!(
                last.phase, "waiting",
                "the retained chore waits while the newer social order runs"
            );
            interruption_cursor = history.next_cursor;
            let mut restored = Sim::new_with_lot(16, 8);
            restored.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
            assert_eq!(restored.world_hash(), sim.world_hash());
            interrupted = true;
            break;
        }
    }
    assert!(
        interrupted,
        "the explicit front must interrupt the unfinished chore"
    );
    assert_interrupted_work_resumes_once(&mut sim, actor, interruption_cursor, |sim, person| {
        sim.world().get::<terri_core::chores::ChoreWork>(person)?;
        sim.world()
            .resource::<SavedChores>()
            .tasks
            .iter()
            .find(|task| task.person == person.index_u32() && !task.suspended)
            .map(|task| task.remaining)
    });
    for _ in 0..1800 {
        sim.tick();
        if sim.action_events_since(0).events.iter().any(|event| {
            event.actor == actor.index_u32() && event.order_id == 0 && event.phase == "completed"
        }) {
            break;
        }
    }
    let completed: Vec<_> = sim
        .action_events_since(0)
        .events
        .into_iter()
        .filter(|event| event.actor == actor.index_u32() && event.phase == "completed")
        .map(|event| event.order_id)
        .collect();
    assert_eq!(completed, vec![1, 0]);
}

fn assert_interrupted_work_resumes_once(
    sim: &mut Sim,
    actor: Entity,
    cursor: u64,
    work_ticks: fn(&Sim, Entity) -> Option<u32>,
) {
    let mut resumed = false;
    for _ in 0..400 {
        sim.tick();
        let batch = sim.action_events_since(cursor);
        let completion = batch.events.iter().find(|event| {
            event.actor == actor.index_u32() && event.order_id == 1 && event.phase == "completed"
        });
        let resumptions: Vec<_> = batch
            .events
            .iter()
            .filter(|event| {
                event.actor == actor.index_u32() && event.order_id == 0 && event.phase == "resumed"
            })
            .collect();
        if let Some(first) = resumptions.first() {
            assert!(
                completion.is_some_and(|completion| completion.sequence < first.sequence),
                "the interrupted order resumes only after the social front completes"
            );
        }
        if let Some(remaining) = work_ticks(sim, actor).filter(|_| !resumptions.is_empty()) {
            assert_eq!(
                resumptions.len(),
                1,
                "one actual return to work emits one resumption"
            );
            let steady_ticks = remaining.saturating_sub(1).min(8);
            assert!(
                steady_ticks >= 2,
                "the fixture provides several unchanged work ticks"
            );
            let steady_cursor = batch.next_cursor;
            for _ in 0..steady_ticks {
                sim.tick();
                assert!(work_ticks(sim, actor).is_some());
                assert!(
                    !sim.action_events_since(steady_cursor)
                        .events
                        .iter()
                        .any(|event| event.actor == actor.index_u32()
                            && event.order_id == 0
                            && matches!(event.phase.as_str(), "started" | "resumed")),
                    "unchanged work ticks cannot repeat start/resume records"
                );
            }
            resumed = true;
            break;
        }
    }
    assert!(
        resumed,
        "the interrupted order must resume real work with its original identity"
    );
}

#[test]
fn a_front_request_branching_into_another_cycle_yields_without_losing_orders() {
    let (mut sim, a, b) = chat_fixture();
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::Position { x: 8., y: 4. },
            Needs::all_at(90.),
        ))
        .id();
    for (actor, target) in [(a, b), (b, c), (c, b)] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::TalkToFirst {
                agent: actor.index_u32(),
                target: target.index_u32(),
                interaction: 0,
            });
    }
    sim.flush_commands();
    for _ in 0..500 {
        sim.tick();
        if [a, b, c]
            .into_iter()
            .all(|person| sim.world().get::<IntentQueue>(person).unwrap().is_empty())
        {
            break;
        }
    }
    let completed: Vec<_> = sim
        .action_events_since(0)
        .events
        .into_iter()
        .filter(|event| event.phase == "completed")
        .map(|event| (event.actor, event.order_id))
        .collect();
    assert_eq!(
        completed,
        vec![(b.index_u32(), 0), (a.index_u32(), 0), (c.index_u32(), 0)]
    );
}

#[test]
fn autonomous_busy_recipient_refuses_before_any_physical_claim_or_random_draw() {
    for physical_work in [false, true] {
        let (mut sim, a, b) = chat_fixture();
        if physical_work {
            sim.world_mut()
                .entity_mut(b)
                .insert(terri_core::chores::ChoreWork);
        } else {
            let key = terri_core::chores::ChoreKey {
                kind: terri_core::chores::ChoreKind::Floors,
                target: crate::room_regions::RoomRegions::from_world(sim.world())
                    .at((7, 1))
                    .unwrap(),
            };
            // A retained next-cell plan is busy before its next contact or work marker exists.
            sim.world_mut()
                .insert_resource(terri_core::chores::SavedChores {
                    floors: vec![(19, 500)],
                    tasks: vec![terri_core::chores::ChoreTask {
                        person: b.index_u32(),
                        key,
                        cells: vec![19],
                        cursor: 0,
                        endpoint: None,
                        remaining: 0,
                        directed: true,
                        suspended: false,
                        started_day: 0,
                        completed_units: 0,
                    }],
                    ..Default::default()
                });
            assert!(sim.world().get::<Target>(b).is_none());
            assert!(sim.world().get::<Path>(b).is_none());
            assert!(sim
                .world()
                .get::<terri_core::chores::ChoreWork>(b)
                .is_none());
        }
        let random = sim.world().resource::<SimRng>().clone();
        commit_autonomous(sim.world_mut(), a, b, 0, vec![]);
        assert!(sim.world().get::<Target>(a).is_none());
        assert!(sim.world().get::<Path>(a).is_none());
        assert!(sim.world().get::<Reserved>(b).is_none());
        assert_eq!(
            sim.world()
                .get::<terri_core::chores::ChoreWork>(b)
                .is_some(),
            physical_work
        );
        assert!(sim
            .world()
            .resource::<SocialEpisodes>()
            .executions
            .is_empty());
        assert!(sim
            .world()
            .resource::<SocialEpisodes>()
            .rendezvous
            .is_empty());
        assert_eq!(sim.world().resource::<SimRng>(), &random);
    }
}
