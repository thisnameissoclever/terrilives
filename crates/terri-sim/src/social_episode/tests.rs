use super::*;
use crate::{test_content, Content, Sim};
use bevy_ecs::system::RunSystemOnce;
use terri_core::{
    CommandQueue, Hobbies, IntentQueue, Personality, Relationships, Reserved, SimCommand, SimId,
    SimIdAllocator,
};

mod decision_tests;

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
fn recipient_player_talk_defers_inbound_waiter_and_preserves_all_orders() {
    let (mut sim, a, b) = chat_fixture();
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Reserved,
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
    sim.world_mut().entity_mut(c).remove::<Reserved>();
    talk(&mut sim, b, c);
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
    // This test isolates listener identity; C must stay uncommitted during setup.
    sim.world_mut().entity_mut(c).insert(Reserved);
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
    sim.world_mut()
        .entity_mut(c)
        .remove::<Reserved>()
        .insert(terri_core::Position {
            x: position.x + 1.,
            y: position.y,
        });
    assert!(sim
        .world()
        .resource::<requests::ConversationRequests>()
        .outgoing(c)
        .is_none());
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::TalkToFirst {
            agent: a.index_u32(),
            target: c.index_u32(),
            interaction: 0,
        });
    sim.tick();
    assert!(sim.world().get::<Socialising>(a).is_some(),
        "Redirect: target={:?}, path={:?}, receiver target={:?}, receiver path={:?}, receiver reserved={}, requests={:?}",
        sim.world().get::<Target>(a),sim.world().get::<Path>(a),sim.world().get::<Target>(c),sim.world().get::<Path>(c),
        sim.world().get::<Reserved>(c).is_some(),
        sim.world().resource::<requests::ConversationRequests>().requests.values().collect::<Vec<_>>());
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
fn critical_need_values_preserve_the_chosen_chat_and_unrelated_orders() {
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
    assert!(!sim
        .world()
        .resource::<SocialEpisodes>()
        .rendezvous
        .is_empty());
    assert_eq!(sim.world().get::<Target>(a).map(|t| t.object), Some(b));
    assert_eq!(
        sim.world()
            .get::<IntentQueue>(a)
            .unwrap()
            .front()
            .unwrap()
            .object,
        b
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
    let (mut progress, mut origin) = crate::recipe_actions::begin(
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
            pack.object(pack.find("fridge").unwrap())
                .interactions
                .iter()
                .position(|a| a.id == "cook_dinner")
                .unwrap() as u32,
            recipe as usize,
            objects[0],
        )
        .0,
        crate::recipe_actions::begin(
            pack,
            pack.find("fridge").unwrap(),
            pack.object(pack.find("fridge").unwrap())
                .interactions
                .iter()
                .position(|a| a.id == "cook_dinner")
                .unwrap() as u32,
            recipe as usize,
            objects[0],
        )
        .1,
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
