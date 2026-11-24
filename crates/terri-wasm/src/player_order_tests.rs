use super::*;

#[test]
fn typed_media_cause_preserves_the_nine_string_wire_and_can_emit_a_game_fixture() {
    use terri_core::{
        layout::{EdgeAxis, SavedLayout, WallEdge},
        TileGrid,
    };
    let mut handle = SimHandle::new(8, 8);
    assert!(handle.spawn_object(4., 4., "radio"));
    handle.spawn_agent(3., 4., 50.);
    let edges: Vec<_> = (0..8)
        .map(|y| WallEdge {
            axis: EdgeAxis::Vertical,
            x: 5,
            y,
            doorway: false,
        })
        .collect();
    {
        let mut grid = handle.sim.world_mut().resource_mut::<TileGrid>();
        for edge in &edges {
            let [a, b] = edge.cells();
            grid.set_edge_blocked(a, b, true);
        }
    }
    handle
        .sim
        .world_mut()
        .insert_resource(SavedLayout::EdgeWallsV1 { edges });
    assert!(handle.enqueue_command(
        &postcard::to_allocvec(&SimCommand::UseObjectFirst {
            agent: 1,
            object: 0,
            interaction: 0
        })
        .unwrap()
    ));
    handle.flush_commands();
    handle.tick();
    let raw = handle.order_events_since("0");
    assert_eq!((raw.len() - 2) % 9, 0);
    let failed = raw[2..]
        .chunks_exact(9)
        .find(|row| row[6] == "failed")
        .expect("actual media plan fails");
    assert_eq!(failed[7], "No reachable media position");
    assert_eq!(
        handle.order_failure_cause(&failed[0]),
        "no-reachable-media-position"
    );
    let saved = handle.save_bytes();
    for invalid in ["", "0", "-1", "+1", "1.5", "18446744073709551616"] {
        assert!(handle.order_failure_cause(invalid).is_empty());
    }
    assert_eq!(handle.order_events_since("0"), raw);
    assert_eq!(handle.save_bytes(), saved);
    let mut resumed = SimHandle::new(1, 1);
    assert!(resumed.load_bytes(&saved));
    assert_eq!(resumed.save_bytes(), saved);
    if let Ok(destination) = std::env::var("NC_ORDER_CAUSE_FIXTURE") {
        use std::io::Write;
        let path = std::path::PathBuf::from(destination);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let parent = path.parent().unwrap().canonicalize().unwrap();
        assert!(
            parent.starts_with(root.join(".superpowers")),
            "fixture output must stay in task scratch"
        );
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(parent.join(path.file_name().unwrap()))
            .unwrap();
        file.write_all(&saved).unwrap();
    }
}

#[test]
fn current_save_preserves_confirmed_orders_before_the_command_drain() {
    let mut handle = SimHandle::from_lot();
    let world = handle.sim.save_snapshot_v5().world;
    let actor = world.entities.iter().find(|e| e.agent).unwrap().index;
    let object = world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let command = SimCommand::UseObject {
        agent: actor,
        object,
        interaction: 0,
    };
    let bytes = postcard::to_allocvec(&command).unwrap();
    let token = handle.work_conflicts_of(&[actor])[0].clone();
    assert!(handle.enqueue_confirmed_order(&bytes, &token));
    let saved = handle.save_bytes();
    assert_eq!(
        u16::from_le_bytes([saved[8], saved[9]]),
        terri_core::SAVE_SCHEMA_VERSION
    );
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&saved));
    assert_eq!(saved, restored.save_bytes());
    assert!(matches!(
        restored
            .sim
            .world()
            .resource::<terri_core::CommandQueue>()
            .as_slice(),
        [SimCommand::ConfirmedOrder { .. }]
    ));
    handle.sim.flush_commands();
    restored.sim.flush_commands();
    assert_eq!(handle.sim.world_hash(), restored.sim.world_hash());
}

#[test]
fn confirmed_order_refuses_unrelated_commands_without_mutating_the_queue() {
    let mut handle = SimHandle::from_lot();
    let before = handle.save_bytes();
    let command = postcard::to_allocvec(&SimCommand::SetSpeed(3)).unwrap();
    assert!(!handle.enqueue_confirmed_order(&command, "0"));
    assert_eq!(before, handle.save_bytes());
}

#[test]
fn stale_confirmation_reports_a_rejection_and_never_adds_an_order() {
    let mut handle = SimHandle::from_lot();
    let world = handle.sim.save_snapshot_v5().world;
    let actor = world.entities.iter().find(|e| e.agent).unwrap().index;
    let object = world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let bytes = postcard::to_allocvec(&SimCommand::UseObject {
        agent: actor,
        object,
        interaction: 0,
    })
    .unwrap();
    let token = handle.work_conflicts_of(&[actor])[0].clone();
    assert!(handle.enqueue_confirmed_order(&bytes, &token));
    handle
        .sim
        .world_mut()
        .resource_mut::<terri_core::SimClock>()
        .tick += 1;
    handle.sim.flush_commands();
    assert_eq!(handle.sim.queued_orders_of(actor), 0);
    assert!(handle
        .sim
        .action_events_since(0)
        .events
        .iter()
        .any(|event| event.phase == "rejected"));
}

#[test]
fn stale_social_confirmation_reports_the_initiator_even_when_the_recipient_has_a_lower_index() {
    let mut handle = SimHandle::from_lot();
    let world = handle.sim.save_snapshot_v5().world;
    let people: Vec<_> = world
        .entities
        .iter()
        .filter(|e| e.agent)
        .map(|e| e.index)
        .collect();
    let actor = *people.last().unwrap();
    let recipient = people[0];
    let bytes = postcard::to_allocvec(&SimCommand::TalkTo {
        agent: actor,
        target: recipient,
        interaction: 0,
    })
    .unwrap();
    let token = handle.work_conflicts_of(&[actor, recipient])[0].clone();
    assert!(handle.enqueue_confirmed_order(&bytes, &token));
    handle
        .sim
        .world_mut()
        .resource_mut::<terri_core::SimClock>()
        .tick += 1;
    handle.sim.flush_commands();
    let events = handle.sim.action_events_since(0).events;
    let rejected = events.iter().find(|e| e.phase == "rejected").unwrap();
    assert_eq!(
        rejected.actor, actor,
        "the rejected command belongs to its initiator"
    );
}

#[test]
fn confirmed_chore_initializes_its_state_before_the_first_simulation_tick() {
    let mut handle = SimHandle::from_lot();
    let world = handle.sim.save_snapshot_v5().world;
    let actor = world.entities.iter().find(|e| e.agent).unwrap().index;
    let key = terri_core::chores::ChoreKey {
        kind: terri_core::chores::ChoreKind::Dishes,
        target: 0,
    };
    let bytes = postcard::to_allocvec(&SimCommand::CleanChore { agent: actor, key }).unwrap();
    let token = handle.work_conflicts_of(&[actor])[0].clone();
    assert!(handle.enqueue_confirmed_order(&bytes, &token));
    handle.sim.flush_commands();
    assert!(
        handle
            .sim
            .action_events_since(0)
            .events
            .iter()
            .any(|e| e.actor == actor && e.phase == "accepted"),
        "confirmed first-tick chores use the same admission as unwrapped chores"
    );
}

#[test]
fn malformed_confirmed_save_references_refuse_without_replacing_the_live_world() {
    use terri_core::command::PlayerOrder;
    let mut handle = SimHandle::from_lot();
    let world = handle.sim.save_snapshot_v5().world;
    let people: Vec<_> = world
        .entities
        .iter()
        .filter(|e| e.agent)
        .map(|e| e.index)
        .collect();
    let actor = people[0];
    let object = world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let command = postcard::to_allocvec(&SimCommand::UseObject {
        agent: actor,
        object,
        interaction: 0,
    })
    .unwrap();
    let token = handle.work_conflicts_of(&[actor])[0].clone();
    assert!(handle.enqueue_confirmed_order(&command, &token));
    let original = handle.sim.current_v17_view();
    let hash = handle.sim.world_hash();
    for malformed in [
        PlayerOrder::UseObject {
            agent: u32::MAX,
            object,
            interaction: 0,
            front: false,
        },
        PlayerOrder::UseObject {
            agent: actor,
            object: u32::MAX,
            interaction: 0,
            front: false,
        },
        PlayerOrder::UseObject {
            agent: actor,
            object,
            interaction: u32::MAX,
            front: false,
        },
        PlayerOrder::TalkTo {
            agent: actor,
            target: people[1],
            interaction: u32::MAX,
            front: false,
        },
        PlayerOrder::ReadBook {
            agent: actor,
            object,
            action: "missing-action".into(),
            title: "missing-title".into(),
            front: false,
        },
    ] {
        let mut corrupted = original.clone();
        corrupted.confirmed_commands[0].2 = malformed;
        assert!(
            handle.sim.load_current_v17_view(corrupted).is_err(),
            "invalid pending references must refuse Load"
        );
        assert_eq!(handle.sim.world_hash(), hash);
        assert_eq!(handle.sim.current_v17_view(), original);
    }
}

#[test]
fn object_order_rows_include_their_target_identity() {
    let mut handle = SimHandle::from_lot();
    let snapshot = handle.sim.save_snapshot_v5().world;
    let actor = snapshot
        .entities
        .iter()
        .find(|entity| entity.agent)
        .unwrap()
        .index;
    let object = snapshot
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let bytes = postcard::to_allocvec(&SimCommand::UseObject {
        agent: actor,
        object,
        interaction: 0,
    })
    .unwrap();
    let token = handle.work_conflicts_of(&[actor])[0].clone();
    assert!(handle.enqueue_confirmed_order(&bytes, &token));
    handle.sim.flush_commands();
    let rows = handle.sim.action_queue_rows_of(actor, 10);
    let order = rows.iter().find(|row| row.order_id.is_some()).unwrap();
    assert_eq!(order.counterpart, Some(object));
}

#[test]
fn removed_object_failure_retains_the_original_target_identity() {
    let mut handle = SimHandle::from_lot();
    let snapshot = handle.sim.save_snapshot_v5().world;
    let actor = snapshot.entities.iter().find(|e| e.agent).unwrap().index;
    let object = snapshot
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let bytes = postcard::to_allocvec(&SimCommand::UseObject {
        agent: actor,
        object,
        interaction: 0,
    })
    .unwrap();
    let token = handle.work_conflicts_of(&[actor])[0].clone();
    assert!(handle.enqueue_confirmed_order(&bytes, &token));
    handle.sim.flush_commands();
    let target = {
        let world = handle.sim.world();
        let mut queues = world
            .try_query::<(&Agent, &terri_core::IntentQueue)>()
            .unwrap();
        queues
            .iter(world)
            .find_map(|(_, queue)| queue.front().map(|intent| intent.object))
            .unwrap()
    };
    handle.sim.world_mut().despawn(target);
    handle.sim.flush_commands();
    let events = handle.sim.action_events_since(0).events;
    let failure = events
        .iter()
        .find(|event| event.actor == actor && event.phase == "failed")
        .unwrap();
    assert_eq!(
        failure.counterpart,
        Some(object),
        "removed targets must remain identifiable in diagnostics"
    );
}

#[test]
fn a_target_removed_before_admission_reports_rejection_instead_of_disappearing() {
    let mut handle = SimHandle::from_lot();
    let world = handle.sim.save_snapshot_v5().world;
    let actor = world
        .entities
        .iter()
        .find(|entity| entity.agent)
        .unwrap()
        .index;
    let object = world
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let bytes = postcard::to_allocvec(&SimCommand::UseObject {
        agent: actor,
        object,
        interaction: 0,
    })
    .unwrap();
    let token = handle.work_conflicts_of(&[actor])[0].clone();
    assert!(handle.enqueue_confirmed_order(&bytes, &token));
    let target = {
        let world = handle.sim.world();
        let mut objects = world
            .try_query::<(terri_core::Entity, &terri_core::SmartObject)>()
            .unwrap();
        objects
            .iter(world)
            .find(|(entity, _)| entity.index_u32() == object)
            .unwrap()
            .0
    };
    handle.sim.world_mut().despawn(target);
    handle.sim.flush_commands();
    let events = handle.sim.action_events_since(0).events;
    assert!(events.iter().any(|event|event.actor==actor && event.phase=="rejected" && event.reason.is_some()),
        "an admitted staging command must leave an explicit rejected outcome when its target disappears");
    assert_eq!(handle.sim.queued_orders_of(actor), 0);
}

#[test]
fn refused_reading_admission_is_retained_in_the_order_history() {
    let mut handle = SimHandle::from_lot();
    let world = handle.sim.save_snapshot_v5().world;
    let actor = world
        .entities
        .iter()
        .find(|entity| entity.agent)
        .unwrap()
        .index;
    let object = world
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let bytes = postcard::to_allocvec(&SimCommand::Book(terri_core::command::BookCommand::Read {
        agent: actor,
        object,
        action: "reading".into(),
        title: "missing-title".into(),
        front: false,
    }))
    .unwrap();
    let token = handle.work_conflicts_of(&[actor])[0].clone();
    assert!(handle.enqueue_confirmed_order(&bytes, &token));
    handle.sim.flush_commands();
    let events = handle.sim.action_events_since(0).events;
    assert!(
        events.iter().any(|event| event.actor == actor
            && event.phase == "rejected"
            && event.reason.is_some()),
        "a typed reading refusal must survive beyond transient book feedback"
    );
    assert_eq!(handle.sim.queued_orders_of(actor), 0);
}
