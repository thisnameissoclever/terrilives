use super::*;

#[test]
fn passive_conversation_listener_waits_for_the_active_owner_remaining_time() {
    let (mut sim, a, b) = chat_fixture();
    start(&mut sim, a, b, 80);
    assert_eq!(requests::remaining(sim.world(), a), Some(80));
    assert_eq!(
        requests::remaining(sim.world(), b),
        Some(80),
        "A passive listener is occupied for the same remaining conversation"
    );
}

#[test]
fn private_care_wait_stages_outside_before_use_and_keeps_its_explanation_on_reload() {
    let mut sim = Sim::new_from_shipped_lot_with_seed(42);
    let people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .map(|(e, id)| (id.0, e))
        .collect();
    let a = people.iter().find(|(id, _)| *id == 0).unwrap().1;
    let b = people.iter().find(|(id, _)| *id == 1).unwrap().1;
    let pack = sim.world().resource::<Content>().0;
    let toilet = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, o)| pack.object(o.0).id == "toilet")
        .unwrap()
        .0;
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::UseObject {
            agent: b.index_u32(),
            object: toilet.index_u32(),
            interaction: 0,
        });
    talk(&mut sim, a, b);
    sim.tick();
    assert!(
        sim.world().get::<Path>(b).is_some(),
        "Privacy protection begins while the recipient still travels to care"
    );
    let room = crate::room_regions::RoomRegions::from_world(sim.world());
    let at = *sim.world().get::<terri_core::Position>(toilet).unwrap();
    let private = room.at((at.x as i32, at.y as i32)).unwrap();
    let path = sim.world().get::<Path>(a).unwrap();
    assert!(path
        .steps
        .iter()
        .all(|tile| room.at(*tile) != Some(private)));
    let destination = *path.steps.last().unwrap();
    sim.world_mut().entity_mut(a).remove::<Path>().insert((
        terri_core::Position {
            x: destination.0 as f32,
            y: destination.1 as f32,
        },
        terri_core::Blocked,
    ));
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
    assert_eq!(loaded.activity_status_of(a.index_u32()).unwrap().code, 4);
}

#[test]
fn legacy_chat_migration_keeps_an_ambiguous_player_order_after_completion() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    start(&mut sim, a, b, 1);
    sim.world_mut()
        .entity_mut(a)
        .insert(IntentQueue::from_intents(vec![terri_core::Intent {
            object: b,
            interaction: 0,
            cleanup: None,
            chore: None,
        }]));
    let mut loaded = test_content::sim_with(12, 8, pack);
    loaded.load_snapshot_v14(sim.save_snapshot_v14()).unwrap();
    assert!(matches!(
        loaded
            .world()
            .resource::<requests::ConversationRequests>()
            .outgoing(a)
            .unwrap()
            .origin,
        requests::ConversationOrigin::LegacyUnattributed
    ));
    loaded
        .world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    assert_eq!(
        loaded.world().get::<IntentQueue>(a).unwrap().len(),
        1,
        "An ambiguous legacy chat must preserve the player's queued order"
    );
}

#[test]
fn current_save_replays_a_suspended_request_cycle_through_talking_and_completion() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::Position { x: 8., y: 1. },
            Needs::all_at(90.),
            Relationships::default(),
        ))
        .id();
    talk(&mut sim, a, b);
    talk(&mut sim, b, c);
    talk(&mut sim, c, a);
    let mut saw_suspended = false;
    let mut saw_talking = false;
    for _ in 0..100 {
        sim.tick();
        let snapshot = sim.save_snapshot_v15();
        saw_suspended |= snapshot
            .conversation_requests
            .requests
            .iter()
            .any(|r| r.phase == terri_core::save_v15::SavedConversationPhase::Suspended);
        saw_talking |= snapshot
            .conversation_requests
            .requests
            .iter()
            .any(|r| r.phase == terri_core::save_v15::SavedConversationPhase::Talking);
        let mut loaded = test_content::sim_with(12, 8, pack);
        loaded.load_snapshot_v15(snapshot).unwrap();
        assert_eq!(loaded.world_hash(), sim.world_hash());
        loaded.tick();
        sim.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash());
    }
    assert!(saw_suspended && saw_talking);
}

#[test]
fn conversation_fun_relief_matches_actual_disliked_company_delivery() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.social[0].advertises = vec![(NeedId::Fun.index() as u8, 10.05)];
    pack.social[0].duration_ticks = 67;
    pack.tuning.duration_variance = 0.;
    let mut personality = Personality::default();
    personality.satisfaction[NeedId::Fun.index()] = 0.5;
    let mut needs = Needs::all_at(90.);
    needs.set(NeedId::Fun, 10.);
    let bid = *sim.world().get::<SimId>(b).unwrap();
    sim.world_mut()
        .get_mut::<Relationships>(a)
        .unwrap()
        .bump(bid, -1.);
    sim.world_mut()
        .entity_mut(a)
        .insert((personality, needs, terri_core::Restless));
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    requests::before_choices(sim.world_mut());
    sim.world_mut()
        .run_system_once(crate::systems::action::select_action)
        .unwrap();
    let telemetry = sim
        .world()
        .resource::<crate::systems::autonomy::DecisionTelemetry>();
    let d = telemetry
        .0
        .iter()
        .find(|d| d.agent == a.index_u32())
        .unwrap();
    let row = d
        .choices
        .iter()
        .position(|c| c.0 == b.index_u32() && c.1 == 0)
        .unwrap();
    assert_eq!(
        d.relief_masks[row], 0,
        "Chatting cannot promise Fun relief when its actual reward loses to decay"
    );
    start(&mut sim, a, b, 67);
    let before = sim.world().get::<Needs>(a).unwrap().get(NeedId::Fun);
    sim.world_mut()
        .run_system_once(crate::systems::needs::decay_needs)
        .unwrap();
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    assert!(sim.world().get::<Needs>(a).unwrap().get(NeedId::Fun) < before);
}

#[test]
fn paused_current_reload_reconstructs_a_work_wait_without_mutating_the_world() {
    let mut sim = Sim::new_from_shipped_lot_with_seed(42);
    let people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .map(|(e, id)| (id.0, e))
        .collect();
    let a = people.iter().find(|(id, _)| *id == 0).unwrap().1;
    let b = people.iter().find(|(id, _)| *id == 1).unwrap().1;
    let door = sim.world().resource::<Content>().0.lot.front_door.unwrap();
    sim.world_mut().entity_mut(b).insert((
        terri_core::Career(0),
        terri_core::AtWork {
            remaining_ticks: 1000,
        },
        terri_core::Position {
            x: door.0 as f32,
            y: door.1 as f32,
        },
    ));
    talk(&mut sim, a, b);
    sim.tick();
    assert_eq!(sim.activity_status_of(a.index_u32()).unwrap().code, 3);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
    let hash = loaded.world_hash();
    assert_eq!(loaded.activity_status_of(a.index_u32()).unwrap().code, 3);
    assert_eq!(
        loaded.world_hash(),
        hash,
        "Status reconstruction is read-only while paused"
    );
}

#[test]
fn unreachable_oldest_request_does_not_hold_the_recipient_or_block_reachable_chat() {
    let (mut sim, a, b) = chat_fixture();
    sim.world_mut()
        .entity_mut(b)
        .insert(terri_core::Wander { pause_ticks: 100 });
    for neighbor in [(0, 1), (2, 1), (1, 0), (1, 2)] {
        sim.world_mut()
            .resource_mut::<terri_core::TileGrid>()
            .set_edge_blocked((1, 1), neighbor, true);
    }
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::Position { x: 10., y: 1. },
            Needs::all_at(90.),
            Relationships::default(),
            terri_core::Wander { pause_ticks: 100 },
        ))
        .id();
    talk(&mut sim, a, b);
    sim.tick();
    assert!(
        sim.world().get::<Reserved>(b).is_none(),
        "An unreachable initiator cannot reserve the listener"
    );
    assert_eq!(sim.activity_status_of(a.index_u32()).unwrap().code, 5);
    talk(&mut sim, c, b);
    sim.tick();
    let blocked_id = sim
        .world()
        .resource::<requests::ConversationRequests>()
        .outgoing(a)
        .unwrap()
        .id;
    // A retained staging tile can remain reachable after geometry changes cut
    // off the final contact. It must not revoke somebody else's admission.
    sim.world_mut()
        .resource_mut::<requests::ConversationRequests>()
        .requests
        .get_mut(&blocked_id)
        .unwrap()
        .waiting_tile = Some((1, 1));
    for _ in 0..6 {
        requests::before_choices(sim.world_mut());
        assert_eq!(
            sim.world().resource::<SocialEpisodes>().rendezvous.get(&b),
            Some(&c),
            "An older pending request cannot revoke a reachable approach already admitted"
        );
        sim.tick();
    }
    for _ in 0..8 {
        sim.tick();
    }
    assert!(
        sim.world()
            .get::<Socialising>(c)
            .is_some_and(|s| s.partner == b),
        "The later reachable request must proceed while the old route is blocked"
    );
    assert!(sim
        .world()
        .resource::<requests::ConversationRequests>()
        .requests
        .values()
        .any(|r| r.initiator == a && r.phase == requests::RequestPhase::Waiting));
}

#[test]
fn chosen_chat_survives_initiator_critical_physical_needs() {
    for need in [NeedId::Hunger, NeedId::Energy, NeedId::Bladder] {
        let (mut sim, a, b) = chat_fixture();
        sim.world_mut().get_mut::<Needs>(a).unwrap().set(need, 10.);
        talk(&mut sim, a, b);
        for _ in 0..8 {
            sim.tick();
            assert_eq!(
                sim.world().get::<Target>(a).map(|t| t.object),
                Some(b),
                "A chosen conversation must not be canceled because {need:?} is critical"
            );
        }
    }
}

#[test]
fn arrived_conversation_wait_is_reported_as_waiting() {
    let (mut sim, a, b) = chat_fixture();
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(
        terri_core::Position { x: 7., y: 2. },
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
    assert!(sim.world().get::<Eating>(b).is_some());
    assert!(sim.world().get::<Path>(a).is_none());
    sim.sync_render_buffer();
    let render = sim.render_buffer();
    let row = render
        .ids
        .iter()
        .position(|id| *id == a.index_u32())
        .unwrap();
    assert_eq!(
        render.activities[row],
        crate::render_buffer::activity::WAITING
    );
}

#[test]
fn a_reserved_listener_keeps_the_real_waiting_activity_instead_of_idle_context() {
    let (mut sim, a, b) = chat_fixture();
    talk(&mut sim, a, b);
    sim.tick();
    assert!(sim.world().get::<Reserved>(b).is_some());
    assert_eq!(
        sim.activity_status_of(b.index_u32()).unwrap().code,
        0,
        "The context must preserve the render activity of the reserved listener"
    );
}

#[test]
fn autonomous_chat_completion_preserves_a_later_matching_player_order() {
    let (mut sim, a, b) = chat_fixture();
    start(&mut sim, a, b, 1);
    let mut queue = IntentQueue::default();
    queue.push(terri_core::Intent {
        object: b,
        interaction: 0,
        cleanup: None,
        chore: None,
    });
    sim.world_mut().entity_mut(a).insert(queue);
    sim.world_mut()
        .run_system_once(crate::systems::social::tick_social)
        .unwrap();
    assert_eq!(
        sim.world().get::<IntentQueue>(a).unwrap().len(),
        1,
        "An autonomous conversation cannot consume a player order issued after it started"
    );
}

#[test]
fn four_critical_needs_leave_at_most_one_percent_for_unrelated_choices() {
    let mut sim = Sim::new_from_shipped_lot_with_seed(42);
    let a = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .find(|(_, id)| id.0 == 0)
        .unwrap()
        .0;
    let mut needs = Needs::all_at(60.);
    for id in [NeedId::Hunger, NeedId::Energy, NeedId::Social, NeedId::Fun] {
        needs.set(id, 10.);
    }
    needs.set(NeedId::Hygiene, 40.);
    sim.world_mut()
        .entity_mut(a)
        .insert((needs, terri_core::SelfPreservation(0)));
    sim.tick();
    let unrelated: std::collections::BTreeSet<_> = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .filter(|(_, o)| {
            matches!(
                terri_data::pack().object(o.0).id.as_str(),
                "sink" | "kitchen_sink" | "toilet" | "shower" | "bathtub"
            )
        })
        .map(|(e, _)| e.index_u32())
        .chain([a.index_u32()])
        .collect();
    let telemetry = sim
        .world()
        .resource::<crate::systems::autonomy::DecisionTelemetry>();
    let decision = telemetry
        .0
        .iter()
        .find(|d| d.agent == a.index_u32())
        .unwrap();
    let mass: f64 = decision
        .choices
        .iter()
        .filter(|c| unrelated.contains(&c.0))
        .map(|c| c.4)
        .sum();
    assert!(
        mass <= 0.010000001,
        "Unrelated actions retain {mass:.4} probability despite four reachable critical remedies"
    );
}

#[test]
fn random_creation_reserves_extreme_instinct_values_for_explicit_player_choices() {
    for seed in 0..64 {
        let mut sim = Sim::new_from_shipped_lot_with_seed(seed);
        for value in sim
            .world_mut()
            .query::<&terri_core::SelfPreservation>()
            .iter(sim.world())
        {
            assert!(
                (11..=95).contains(&value.0),
                "Random creation produced player-only instinct {} for seed {seed}",
                value.0
            );
        }
    }
}

#[test]
fn receiver_finishes_critical_food_while_the_initiator_keeps_one_request() {
    let (mut sim, a, b) = chat_fixture();
    let pack = sim.world().resource::<Content>().0;
    let fridge = sim.spawn_object(
        terri_core::Position { x: 7., y: 2. },
        pack.find("fridge").unwrap(),
    );
    sim.world_mut()
        .get_mut::<Needs>(a)
        .unwrap()
        .set(NeedId::Hunger, 10.);
    sim.world_mut()
        .get_mut::<Needs>(b)
        .unwrap()
        .set(NeedId::Hunger, 10.);
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
    let mut request = None;
    for elapsed in 1..=50 {
        sim.tick();
        let state = sim
            .world()
            .resource::<crate::social_episode::requests::ConversationRequests>();
        let r = state
            .outgoing(a)
            .expect("The chosen chat remains committed");
        if let Some(id) = request {
            assert_eq!(r.id, id);
        } else {
            request = Some(r.id);
        }
        assert!(
            sim.world().get::<Eating>(b).is_some(),
            "Food must finish before chatting at {elapsed}"
        );
        assert!(
            sim.world().get::<Reserved>(b).is_none(),
            "The incoming request cannot seize the busy eater"
        );
    }
    let mut started = false;
    for _ in 0..90 {
        sim.tick();
        if sim.world().get::<Socialising>(a).is_some() {
            started = true;
            break;
        }
    }
    assert!(started, "The queued chat must start after care completes");
}

#[test]
fn reciprocal_player_requests_finish_as_two_distinct_conversations() {
    let (mut sim, a, b) = chat_fixture();
    for (person, partner) in [(a, b), (b, a)] {
        sim.world_mut()
            .entity_mut(person)
            .insert(IntentQueue::from_intents(vec![terri_core::Intent {
                object: partner,
                interaction: 0,
                cleanup: None,
                chore: None,
            }]));
        crate::social_episode::requests::enqueue(
            sim.world_mut(),
            person,
            partner,
            0,
            crate::social_episode::requests::ConversationOrigin::Player { order_id: 0 },
        )
        .unwrap();
    }
    let mut owners = std::collections::BTreeSet::new();
    for _ in 0..200 {
        sim.tick();
        for person in [a, b] {
            if sim.world().get::<Socialising>(person).is_some() {
                owners.insert(person.index_u32());
            }
        }
        if [a, b]
            .iter()
            .all(|p| sim.world().get::<IntentQueue>(*p).unwrap().is_empty())
        {
            break;
        }
    }
    assert_eq!(
        owners.len(),
        2,
        "Each opposite player order starts its own conversation"
    );
    assert!([a, b]
        .iter()
        .all(|p| sim.world().get::<IntentQueue>(*p).unwrap().is_empty()));
}

#[test]
fn three_person_request_cycle_cannot_deadlock() {
    let (mut sim, a, b) = chat_fixture();
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let c = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            terri_core::Position { x: 4., y: 4. },
            Needs::all_at(90.),
            Relationships::default(),
        ))
        .id();
    for (person, partner) in [(a, b), (b, c), (c, a)] {
        sim.world_mut()
            .entity_mut(person)
            .insert(IntentQueue::from_intents(vec![terri_core::Intent {
                object: partner,
                interaction: 0,
                cleanup: None,
                chore: None,
            }]));
        crate::social_episode::requests::enqueue(
            sim.world_mut(),
            person,
            partner,
            0,
            crate::social_episode::requests::ConversationOrigin::Player { order_id: 0 },
        )
        .unwrap();
    }
    for _ in 0..300 {
        sim.tick();
        if [a, b, c]
            .iter()
            .all(|p| sim.world().get::<IntentQueue>(*p).unwrap().is_empty())
        {
            break;
        }
    }
    assert!(
        [a, b, c]
            .iter()
            .all(|p| sim.world().get::<IntentQueue>(*p).unwrap().is_empty()),
        "The oldest ready request must break the cycle without losing the other orders"
    );
}

#[test]
fn current_save_preserves_the_exact_order_completed_by_a_chat() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    talk(&mut sim, a, b);
    sim.tick();
    let mut restored = test_content::sim_with(12, 8, sim.world().resource::<Content>().0);
    restored.load_snapshot_v15(sim.save_snapshot_v15()).unwrap();
    for _ in 0..100 {
        sim.tick();
        restored.tick();
        if sim.world().get::<IntentQueue>(a).unwrap().is_empty() {
            break;
        }
    }
    assert!(sim.world().get::<IntentQueue>(a).unwrap().is_empty());
    assert!(
        restored.world().get::<IntentQueue>(a).unwrap().is_empty(),
        "Reloading a current save must retain exact order ownership through completion"
    );
}

#[test]
fn request_lifecycle_staggered_reciprocal_orders_keep_the_earlier_one_first() {
    let (mut sim, a, b) = chat_fixture();
    for (created, person, partner) in [(1, a, b), (2, b, a)] {
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = created;
        sim.world_mut()
            .entity_mut(person)
            .insert(IntentQueue::from_intents(vec![terri_core::Intent {
                object: partner,
                interaction: 0,
                cleanup: None,
                chore: None,
            }]));
        requests::enqueue(
            sim.world_mut(),
            person,
            partner,
            0,
            requests::ConversationOrigin::Player { order_id: 0 },
        )
        .unwrap();
    }
    let mut first = None;
    for _ in 0..100 {
        sim.tick();
        first = [a, b]
            .into_iter()
            .find(|p| sim.world().get::<Socialising>(*p).is_some());
        if first.is_some() {
            break;
        }
    }
    assert_eq!(
        first,
        Some(a),
        "A later opposite player order must not jump the earlier request"
    );
}

#[test]
fn request_lifecycle_canceling_an_active_request_releases_its_exact_pair() {
    let (mut sim, a, b) = chat_fixture();
    let id = requests::enqueue(
        sim.world_mut(),
        a,
        b,
        0,
        requests::ConversationOrigin::Autonomous,
    )
    .unwrap();
    for _ in 0..100 {
        sim.tick();
        if sim.world().get::<Socialising>(a).is_some() {
            break;
        }
    }
    assert!(sim.world().get::<Socialising>(a).is_some());
    requests::cancel_request(sim.world_mut(), id);
    assert!(
        sim.world().get::<Socialising>(a).is_none(),
        "The canceled request cannot keep delivering conversation rewards"
    );
    assert!(
        sim.world().get::<Reserved>(b).is_none(),
        "The other person must be released after active cancellation"
    );
    assert!(sim.world().get::<Target>(a).is_none());
}

#[test]
fn request_lifecycle_canceling_a_suspended_duplicate_preserves_the_active_order() {
    let (mut sim, a, b) = chat_fixture();
    let intent = terri_core::Intent {
        object: b,
        interaction: 0,
        cleanup: None,
        chore: None,
    };
    let mut queue = IntentQueue::default();
    queue.push(intent);
    queue.push_front(intent);
    sim.world_mut().entity_mut(a).insert(queue);
    let old = requests::enqueue(
        sim.world_mut(),
        a,
        b,
        0,
        requests::ConversationOrigin::Player { order_id: 0 },
    )
    .unwrap();
    let current = requests::enqueue(
        sim.world_mut(),
        a,
        b,
        0,
        requests::ConversationOrigin::Player { order_id: 1 },
    )
    .unwrap();
    requests::cancel_request(sim.world_mut(), old);
    assert!(sim
        .world()
        .resource::<requests::ConversationRequests>()
        .requests
        .contains_key(&current));
    assert_eq!(
        sim.world().get::<Target>(a).map(|t| t.object),
        Some(b),
        "Canceling an older identical order cannot release the current request's target"
    );
}

#[test]
fn current_save_keeps_an_arrived_waiter_without_reserving_the_busy_recipient() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    let pack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    let fridge = sim.spawn_object(
        terri_core::Position { x: 7., y: 2. },
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
            remaining_ticks: 70,
        },
    ));
    sim.world_mut().entity_mut(fridge).insert(Reserved);
    talk(&mut sim, a, b);
    for _ in 0..35 {
        sim.tick();
    }
    assert!(sim.world().get::<Path>(a).is_none());
    let hash = sim.world_hash();
    let saved = sim.save_snapshot_v15();
    let mut restored = test_content::sim_with(12, 8, pack);
    restored.load_snapshot_v15(saved).unwrap();
    assert_eq!(restored.world_hash(), hash);
    assert!(restored.world().get::<Reserved>(b).is_none());
    assert_eq!(restored.activity_status_of(a.index_u32()).unwrap().code, 2);
    for _ in 0..90 {
        sim.tick();
        restored.tick();
        assert_eq!(sim.world_hash(), restored.world_hash());
    }
}

#[test]
fn invalid_current_request_records_refuse_without_replacing_the_live_world() {
    let (mut sim, a, b) = chat_fixture();
    let mut pack = sim.world().resource::<Content>().0.clone();
    pack.reading = terri_data::pack().reading;
    sim.world_mut()
        .insert_resource(Content(Box::leak(Box::new(pack))));
    talk(&mut sim, a, b);
    sim.tick();
    let saved = sim.save_snapshot_v15();
    assert_eq!(saved.conversation_requests.requests.len(), 1);
    for case in 0..10 {
        let mut bad = saved.clone();
        let row = &mut bad.conversation_requests.requests[0];
        let duplicate = row.clone();
        match case {
            0 => row.recipient = u32::MAX,
            1 => row.recipient = row.initiator,
            2 => row.interaction = "missing-social-action".into(),
            3 => {
                row.origin = terri_core::save_v15::SavedConversationOrigin::Player { order_id: 999 }
            }
            4 => row.created = sim.world().resource::<terri_core::SimClock>().tick + 1,
            5 => row.waiting_tile = Some((99, 99)),
            6 => bad.conversation_requests.next_id = 0,
            7 => bad.conversation_requests.requests.push(duplicate),
            8 => {
                bad.legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .social
                    .rendezvous
                    .clear();
                row.phase = terri_core::save_v15::SavedConversationPhase::Waiting;
                row.target_owned = false;
            }
            _ => {
                bad.legacy
                    .legacy
                    .legacy
                    .legacy
                    .legacy
                    .social
                    .rendezvous
                    .clear();
                bad.conversation_requests.requests.clear();
            }
        }
        let hash = sim.world_hash();
        assert!(sim.load_snapshot_v15(bad).is_err(), "case {case}");
        assert_eq!(
            sim.world_hash(),
            hash,
            "failed load case {case} must be transactional"
        );
    }
}

#[test]
fn final_walking_step_keeps_its_gait_until_the_actual_motion_finishes() {
    let (mut sim, a, b) = chat_fixture();
    sim.world_mut().entity_mut(b).insert(Reserved);
    sim.world_mut().entity_mut(a).insert((
        terri_core::Position { x: 1.75, y: 1. },
        Path {
            steps: vec![(2, 1)],
            cursor: 0,
        },
        terri_core::Wander { pause_ticks: 20 },
        terri_core::Restless,
    ));
    sim.sync_render_buffer();
    sim.tick();
    sim.sync_render_buffer();
    let render = sim.render_buffer();
    let row = render
        .ids
        .iter()
        .position(|id| *id == a.index_u32())
        .unwrap();
    assert_eq!(
        (render.prev_positions[row * 2], render.positions[row * 2]),
        (1.75, 2.)
    );
    assert_eq!(
        (render.visual_actions[row], render.facings[row]),
        (
            crate::render_buffer::visual_action::WALK,
            crate::render_buffer::facing::POSITIVE_X
        ),
        "Consuming the final path step must not turn a moving body into an idle slide"
    );
    for _ in 0..2 {
        sim.tick();
        sim.sync_render_buffer();
        let render = sim.render_buffer();
        let row = render
            .ids
            .iter()
            .position(|id| *id == a.index_u32())
            .unwrap();
        assert_eq!(render.prev_positions[row * 2], render.positions[row * 2]);
        assert_ne!(
            render.visual_actions[row],
            crate::render_buffer::visual_action::WALK
        );
    }
}
