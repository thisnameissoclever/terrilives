use super::*;
use crate::rooms::RoomChoices;
use terri_core::rooms::RoomSelection;

fn exercise(sim: &mut Sim) {
    let baseline = sim.save_snapshot_v16();
    let runtime = requests::runtime::capture(sim.world());
    sim.begin_build().unwrap();
    assert!(!sim.build_dirty());
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    sim.discard_build_review().unwrap();
    assert!(sim.validate_build_token(review.token).is_err());
    sim.stage_room_name(RoomSelection::Outside, "Pending garden".into())
        .unwrap();
    assert!(sim.build_dirty());
    sim.stage_room_name(RoomSelection::Outside, baseline.rooms.outside_name.clone())
        .unwrap();
    assert!(!sim.build_dirty());
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    sim.commit_build(review.token).unwrap();
    assert_eq!(sim.save_snapshot_v16(), baseline);
    assert_eq!(requests::runtime::capture(sim.world()), runtime);
    sim.stage_room_name(RoomSelection::Outside, "Confirmed garden".into())
        .unwrap();
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    sim.commit_build(review.token).unwrap();
    let confirmed = sim.save_snapshot_v16();
    assert_eq!(confirmed.legacy, baseline.legacy);
    assert_eq!(requests::runtime::capture(sim.world()), runtime);
    sim.stage_room_name(RoomSelection::Outside, "Cancelled garden".into())
        .unwrap();
    let token = sim
        .prepare_build_commit(RoomChoices::default())
        .unwrap()
        .token;
    let draft = crate::save::v16::capture(sim);
    let mut bad = confirmed.clone();
    bad.legacy.conversation_requests.next_id = 0;
    assert!(!bad.legacy.conversation_requests.requests.is_empty());
    assert!(sim.load_snapshot_v16(bad).is_err());
    assert_eq!(crate::save::v16::capture(sim), draft);
    assert_eq!(sim.save_snapshot_v16(), confirmed);
    assert_eq!(sim.validate_build_token(token), Ok(()));
    assert_eq!(requests::runtime::capture(sim.world()), runtime);
    sim.cancel_build().unwrap();
    assert_eq!(sim.save_snapshot_v16(), confirmed);
    assert_eq!(requests::runtime::capture(sim.world()), runtime);
    sim.load_snapshot_v16(baseline.clone()).unwrap();
    let loaded_runtime = requests::runtime::capture(sim.world());
    assert_eq!(sim.save_snapshot_v16(), baseline);
    sim.stage_room_name(RoomSelection::Outside, "Discard after load".into())
        .unwrap();
    sim.cancel_build().unwrap();
    assert_eq!(requests::runtime::capture(sim.world()), loaded_runtime);
    sim.end_build().unwrap();
    assert!(!sim.build_active());
    assert_eq!(sim.save_snapshot_v16(), baseline);
}

#[test]
fn native_waiting_request_mixed_growth_translates_once_and_cancel_restores() {
    let mut sim = Sim::new_from_shipped_lot_with_seed(42);
    let people: Vec<_> = sim
        .world_mut()
        .query::<(Entity, &SimId)>()
        .iter(sim.world())
        .map(|(person, id)| (id.0, person))
        .collect();
    let a = people.iter().find(|(id, _)| *id == 0).unwrap().1;
    let b = people.iter().find(|(id, _)| *id == 1).unwrap().1;
    let c = people.iter().find(|(id, _)| *id == 2).unwrap().1;
    sim.world_mut().entity_mut(c).insert(Reserved);
    let pack = sim.world().resource::<Content>().0;
    let toilet = sim
        .world_mut()
        .query::<(Entity, &terri_core::SmartObject)>()
        .iter(sim.world())
        .find(|(_, object)| pack.object(object.0).id == "toilet")
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
    sim.world_mut().entity_mut(c).remove::<Reserved>();
    sim.world_mut()
        .insert_resource(terri_core::Funds::from_dollars(1_000_000));
    let baseline = sim.save_snapshot_v16();
    let runtime = requests::runtime::capture(sim.world());
    assert!(baseline
        .legacy
        .conversation_requests
        .requests
        .iter()
        .any(
            |r| r.phase == terri_core::save_v15::SavedConversationPhase::Waiting
                && r.waiting_tile.is_some()
        ));
    let start = crate::lot_frame::origin(sim.world());
    sim.begin_build().unwrap();
    for command in [
        SimCommand::SetFloor {
            x: 17,
            y: 13,
            covering: 4,
        },
        SimCommand::BuyLand { side: 0 },
        SimCommand::BuyLand { side: 2 },
    ] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
        sim.flush_commands();
        assert_eq!(sim.take_build_error(), None);
    }
    let end = crate::lot_frame::origin(sim.world());
    assert!(end.0 > start.0 && end.1 > start.1);
    let mut expected = baseline.legacy.conversation_requests.clone();
    for request in &mut expected.requests {
        if let Some((x, y)) = &mut request.waiting_tile {
            *x += (end.0 - start.0) as i32;
            *y += (end.1 - start.1) as i32;
        }
    }
    assert_eq!(
        crate::save::v16::capture(&sim).legacy.conversation_requests,
        expected
    );
    let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
    sim.commit_build(review.token).unwrap();
    let grown = sim.save_snapshot_v16();
    assert_eq!(grown.legacy.conversation_requests, expected);
    assert_eq!(requests::runtime::capture(sim.world()), runtime);
    sim.load_snapshot_v16(grown.clone()).unwrap();
    assert_eq!(sim.save_snapshot_v16(), grown);
    sim.load_snapshot_v16(baseline.clone()).unwrap();
    for side in [0, 2] {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::BuyLand { side });
        sim.flush_commands();
        assert_eq!(sim.take_build_error(), None);
    }
    sim.cancel_build().unwrap();
    assert_eq!(sim.save_snapshot_v16(), baseline);
}

#[test]
fn native_build_conserves_real_approaching_talking_and_suspended_requests() {
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
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..100 {
        sim.tick();
        let phases: Vec<_> = sim
            .world()
            .resource::<requests::ConversationRequests>()
            .requests
            .values()
            .map(|r| r.phase as u8)
            .collect();
        if phases.iter().any(|phase| !seen.contains(phase)) {
            seen.extend(phases);
            exercise(&mut sim);
        }
    }
    for phase in [
        requests::RequestPhase::Approaching,
        requests::RequestPhase::Talking,
        requests::RequestPhase::Suspended,
    ] {
        assert!(
            seen.contains(&(phase as u8)),
            "missing real phase {phase:?}"
        );
    }
}

#[test]
fn native_build_conserves_an_arrived_waiter_and_queue_free_projection() {
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
    assert!(sim
        .world()
        .resource::<requests::ConversationRequests>()
        .requests
        .values()
        .any(|r| r.phase == requests::RequestPhase::Waiting && r.waiting_tile.is_some()));
    let saved = sim.save_snapshot_v16();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetFloor {
            x: 11,
            y: 7,
            covering: 1,
        });
    let projected = crate::save::v16::capture_without_commands(&sim);
    assert_eq!(
        projected.legacy.conversation_requests,
        saved.legacy.conversation_requests
    );
    let admitted =
        crate::save::v16::restore(projected, pack, crate::save::Carried::for_load(sim.world()))
            .unwrap();
    assert_eq!(admitted.save_snapshot_v16(), saved);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .drain()
        .for_each(drop);
    exercise(&mut sim);
}
