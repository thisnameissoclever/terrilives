use super::*;

#[test]
fn immutable_v14_pending_order_settles_before_active_build_load_baseline() {
    let bytes = include_bytes!("../tests/fixtures/room-identities-v14/floor-order-queued.sav");
    let mut expected = SimHandle::from_lot();
    assert!(expected.load_bytes(bytes));
    assert!(expected
        .sim
        .world()
        .resource::<terri_core::CommandQueue>()
        .as_slice()
        .iter()
        .any(|command| matches!(command, terri_core::SimCommand::CleanChoreFirst { .. })));
    let tick = expected.sim.world().resource::<terri_core::SimClock>().tick;
    expected.sim.flush_commands();
    assert_eq!(expected.sim.take_build_error(), None);
    let settled = expected.sim.save_snapshot_v15();
    let mut live = SimHandle::from_lot();
    live.sim.begin_build().unwrap();
    live.sim
        .stage_room_name(terri_core::rooms::RoomSelection::Outside, "Old yard".into())
        .unwrap();
    let old = live
        .sim
        .prepare_build_commit(terri_sim::rooms::RoomChoices::default())
        .unwrap()
        .token;
    assert!(live.load_bytes(bytes));
    assert!(live.sim.build_active());
    assert!(live
        .sim
        .world()
        .resource::<terri_core::CommandQueue>()
        .is_empty());
    assert_eq!(
        live.sim.world().resource::<terri_core::SimClock>().tick,
        tick
    );
    assert_eq!(live.sim.save_snapshot_v15(), settled);
    assert_eq!(live.sim.build_revision(), Some(0));
    let review = live
        .sim
        .prepare_build_commit(terri_sim::rooms::RoomChoices::default())
        .unwrap();
    assert_ne!(review.token.session, old.session);
    assert!(live.sim.validate_build_token(old).is_err());
    live.sim.commit_build(review.token).unwrap();
    assert_eq!(live.sim.save_snapshot_v15(), settled);
}

#[test]
fn immutable_v14_rooms_preserve_source_state_and_current_continuation() {
    for (name, bytes) in [
        (
            "fresh",
            include_bytes!("../tests/fixtures/room-identities-v14/fresh.sav").as_slice(),
        ),
        (
            "lived",
            include_bytes!("../tests/fixtures/room-identities-v14/lived.sav").as_slice(),
        ),
        (
            "outdoor",
            include_bytes!("../tests/fixtures/room-identities-v14/outdoor-boards.sav").as_slice(),
        ),
        (
            "queued",
            include_bytes!("../tests/fixtures/room-identities-v14/floor-order-queued.sav")
                .as_slice(),
        ),
        (
            "active",
            include_bytes!("../tests/fixtures/room-identities-v14/floor-work-active.sav")
                .as_slice(),
        ),
        (
            "surface",
            include_bytes!("../tests/fixtures/room-identities-v14/surface-work-active.sav")
                .as_slice(),
        ),
        (
            "suspended",
            include_bytes!("../tests/fixtures/room-identities-v14/floor-work-preempted.sav")
                .as_slice(),
        ),
        (
            "west-south-career",
            include_bytes!("../tests/fixtures/room-identities-v14/purchased-land-career.sav")
                .as_slice(),
        ),
        (
            "north-west-career",
            include_bytes!("../tests/fixtures/room-identities-v14/north-west-land-career.sav")
                .as_slice(),
        ),
    ] {
        assert_eq!(&bytes[8..10], &14u16.to_le_bytes());
        let (original, tail) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV14>(&bytes[10..]).unwrap();
        assert!(tail.is_empty());
        let mut game = SimHandle::from_lot();
        assert!(game.load_bytes(bytes), "{name}");
        assert_eq!(
            game.sim.try_save_snapshot_v14().unwrap(),
            original,
            "source state changed: {name}"
        );
        let current = game.save_bytes();
        assert_eq!(&current[8..10], &15u16.to_le_bytes());
        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&current), "current adoption: {name}");
        assert_eq!(
            resumed.save_bytes(),
            current,
            "current save changed: {name}"
        );
        assert_eq!(resumed.world_hash(), game.world_hash());
        for _ in 0..10 {
            game.tick();
            resumed.tick();
            assert_eq!(
                resumed.world_hash(),
                game.world_hash(),
                "continuation: {name}"
            );
        }
    }
}

#[test]
fn current_room_corruption_and_bad_envelopes_do_not_replace_the_household() {
    let game = SimHandle::from_lot();
    let original = game.sim.save_snapshot_v15();
    let mut candidates = vec![];
    let mut bad = original.clone();
    bad.rooms.records.push(bad.rooms.records[0].clone());
    candidates.push(bad);
    let mut bad = original.clone();
    bad.rooms.records.remove(0);
    candidates.push(bad);
    let mut bad = original.clone();
    bad.rooms.records[0].anchor = Some((999, 999));
    candidates.push(bad);
    let mut bad = original.clone();
    bad.rooms.next_id = 1;
    candidates.push(bad);
    let mut bad = original.clone();
    bad.rooms.next_default_name = 0;
    candidates.push(bad);
    for snapshot in candidates {
        let mut live = SimHandle::from_lot();
        let before = live.save_bytes();
        let mut bytes = Vec::from(SAVE_MAGIC);
        bytes.extend(15u16.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&snapshot).unwrap());
        assert!(!live.load_bytes(&bytes));
        assert_eq!(live.save_bytes(), before);
    }
    let current = game.save_bytes();
    let mut trailing = current.clone();
    trailing.push(0);
    let mut truncated = current.clone();
    truncated.pop();
    let mut future = current.clone();
    future[8..10].copy_from_slice(&16u16.to_le_bytes());
    for bad in [trailing, truncated, future] {
        let mut live = SimHandle::from_lot();
        let before = live.save_bytes();
        assert!(!live.load_bytes(&bad));
        assert_eq!(live.save_bytes(), before);
    }
}

#[test]
fn blank_current_lots_do_not_inherit_authored_architecture_or_portals() {
    for (width, height) in [(1, 1), (6, 4), (20, 16)] {
        let source = SimHandle::new(width, height);
        let saved = source.sim.save_snapshot_v15();
        assert_eq!(saved.legacy.legacy.lot_frame, None);
        assert!(saved.rooms.records.is_empty());
        let bytes = source.save_bytes();
        let mut restored = SimHandle::from_lot();
        assert!(restored.load_bytes(&bytes), "blank {width}x{height}");
        assert_eq!(restored.save_bytes(), bytes);
        assert_eq!(restored.world_hash(), source.world_hash());
        assert_eq!(restored.portal_count(), 0);
    }
}

#[test]
fn renaming_an_authentic_active_floor_task_preserves_its_exact_physical_state() {
    let mut game = SimHandle::from_lot();
    assert!(game.load_bytes(include_bytes!(
        "../tests/fixtures/room-identities-v14/floor-work-active.sav"
    )));
    let before = terri_sim::chores::RoomChangeContext::capture(game.sim.world()).unwrap();
    let chores = game
        .sim
        .world()
        .resource::<terri_core::chores::SavedChores>()
        .clone();
    let grime = game
        .sim
        .world()
        .resource::<terri_core::grime::SavedGrime>()
        .clone();
    assert!(chores
        .tasks
        .iter()
        .any(|task| task.completed_units > 0 && task.remaining > 0));
    let proposal = terri_sim::rooms::match_rooms(&before.map, &before.map.topology, (0, 0));
    let mut choices = terri_sim::rooms::RoomChoices::default();
    choices.names.insert(
        before.map.topology.components[0].anchor,
        "Clean kitchen".into(),
    );
    let resolved = terri_sim::rooms::resolve_rooms(
        &proposal,
        &choices,
        game.sim.world().resource::<terri_core::rooms::SavedRooms>(),
    )
    .unwrap();
    let report =
        terri_sim::chores::reconcile_committed_rooms(&mut game.sim, &before, &resolved).unwrap();
    assert!(report.replanned_people.is_empty());
    assert!(report.unavailable_people.is_empty());
    assert_eq!(
        game.sim
            .world()
            .resource::<terri_core::chores::SavedChores>(),
        &chores
    );
    assert_eq!(
        game.sim.world().resource::<terri_core::grime::SavedGrime>(),
        &grime
    );
    let bytes = game.save_bytes();
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&bytes));
    assert_eq!(restored.save_bytes(), bytes);
}

#[test]
fn review_queued_outside_commands_load_and_unknown_room_commands_refuse_atomically() {
    for first in [false, true] {
        let mut source = SimHandle::from_lot();
        let mut floors = terri_core::layout::SavedFloors::default();
        floors.set(17, 13, 4);
        source.sim.world_mut().insert_resource(floors);
        let agent = source
            .sim
            .save_snapshot()
            .entities
            .iter()
            .find(|person| person.agent)
            .unwrap()
            .index;
        let key = terri_core::chores::ChoreKey {
            kind: terri_core::chores::ChoreKind::Floors,
            target: 0,
        };
        let command = if first {
            terri_core::SimCommand::CleanChoreFirst { agent, key }
        } else {
            terri_core::SimCommand::CleanChore { agent, key }
        };
        source
            .sim
            .world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(command);
        let bytes = source.save_bytes();
        let mut live = SimHandle::from_lot();
        assert!(live.load_bytes(&bytes));
        assert_eq!(live.save_bytes(), bytes);
        let mut bad = source.sim.save_snapshot_v15();
        let commands = &mut bad
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .world
            .queued_commands;
        match &mut commands[0] {
            terri_core::SavedCommand::CleanChore { key, .. }
            | terri_core::SavedCommand::CleanChoreFirst { key, .. } => key.target = u32::MAX,
            _ => unreachable!(),
        }
        let mut bad_bytes = Vec::from(SAVE_MAGIC);
        bad_bytes.extend(15u16.to_le_bytes());
        bad_bytes.extend(postcard::to_allocvec(&bad).unwrap());
        assert!(!live.load_bytes(&bad_bytes));
        assert_eq!(live.save_bytes(), bytes);
    }
}

#[test]
fn review_frozen_source_work_preconditions() {
    for (name, bytes) in [
        (
            "surface-work-active",
            include_bytes!("../tests/fixtures/room-identities-v14/surface-work-active.sav")
                .as_slice(),
        ),
        (
            "floor-work-preempted",
            include_bytes!("../tests/fixtures/room-identities-v14/floor-work-preempted.sav")
                .as_slice(),
        ),
    ] {
        assert_eq!(&bytes[8..10], &14u16.to_le_bytes());
        let (saved, tail) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV14>(&bytes[10..]).unwrap();
        assert!(tail.is_empty());
        let chores = &saved.legacy.legacy.legacy.legacy.legacy.legacy.chores;
        let task = &chores.as_ref().unwrap().tasks[0];
        assert!(task.remaining > 0 && task.completed_units > 0);
        if name == "surface-work-active" {
            assert_eq!(task.key.kind, terri_core::chores::ChoreKind::Surfaces);
            assert!(!task.suspended);
        } else {
            assert_eq!(task.key.kind, terri_core::chores::ChoreKind::Floors);
            assert!(task.suspended);
            let world = &saved.legacy.legacy.legacy.legacy.legacy.legacy.world;
            let person = world
                .entities
                .iter()
                .find(|person| person.index == task.person)
                .unwrap();
            assert!(!person.path.as_ref().unwrap().steps.is_empty());
            let target = person.target.unwrap();
            assert_eq!(
                world
                    .entities
                    .iter()
                    .find(|object| object.index == target.object)
                    .unwrap()
                    .smart_object
                    .as_deref(),
                Some("moving_box")
            );
        }
    }
}

#[test]
fn review_authentic_explicit_surface_migration_preserves_work() {
    let bytes = include_bytes!("../tests/fixtures/room-identities-v14/surface-work-active.sav");
    let (source, tail) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV14>(&bytes[10..]).unwrap();
    assert!(tail.is_empty());
    let chores = source
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .chores
        .as_ref()
        .unwrap();
    assert!(chores.tasks.iter().any(|task| task.key.kind
        == terri_core::chores::ChoreKind::Surfaces
        && task.completed_units > 0
        && task.remaining > 0));
    let mut game = SimHandle::from_lot();
    assert!(game.load_bytes(bytes));
    let projected = game.sim.try_save_snapshot_v14().unwrap();
    assert_eq!(
        projected
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .chores
            .as_ref()
            .unwrap()
            .tasks,
        chores.tasks
    );
    assert_eq!(projected, source);
}

#[test]
fn review_authentic_land_careers_and_money_keep_their_actual_source_values() {
    let (fresh, _) = postcard::take_from_bytes::<terri_core::SaveSnapshotV14>(
        &include_bytes!("../tests/fixtures/room-identities-v14/fresh.sav")[10..],
    )
    .unwrap();
    let original_job = &fresh
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .world
        .entities
        .iter()
        .find(|person| person.sim_id == Some(0))
        .unwrap()
        .career;
    for (bytes, origin) in [
        (
            include_bytes!("../tests/fixtures/room-identities-v14/purchased-land-career.sav")
                .as_slice(),
            (10, 0),
        ),
        (
            include_bytes!("../tests/fixtures/room-identities-v14/north-west-land-career.sav")
                .as_slice(),
            (10, 10),
        ),
    ] {
        let (source, tail) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV14>(&bytes[10..]).unwrap();
        assert!(tail.is_empty());
        let frame = source.legacy.lot_frame.unwrap();
        assert_eq!((frame.origin_x, frame.origin_y), origin);
        assert_eq!(frame.purchased_area, 460);
        assert_eq!(source.legacy.funds_cents, 2_380_000);
        let world = &source.legacy.legacy.legacy.legacy.legacy.legacy.world;
        assert_eq!((world.grid_width, world.grid_height), (30, 26));
        let current_job = &world
            .entities
            .iter()
            .find(|person| person.sim_id == Some(0))
            .unwrap()
            .career;
        assert!(current_job.is_some());
        assert_ne!(current_job, original_job);
        assert_eq!(
            source
                .careers
                .records
                .iter()
                .find(|person| person.sim == 0)
                .unwrap()
                .pay,
            80
        );
        let mut game = SimHandle::from_lot();
        assert!(game.load_bytes(bytes));
        let projected = game.sim.try_save_snapshot_v14().unwrap();
        assert_eq!(projected, source);
        let current = game.save_bytes();
        let mut loaded = SimHandle::from_lot();
        assert!(loaded.load_bytes(&current));
        assert_eq!(loaded.save_bytes(), current);
    }
}

#[test]
fn review_rename_before_first_tick_preserves_migrated_unassigned_duties_and_rng() {
    let mut game = SimHandle::from_lot();
    assert!(game.load_bytes(include_bytes!(
        "../tests/fixtures/room-identities-v14/outdoor-boards.sav"
    )));
    let original = game
        .sim
        .world()
        .resource::<terri_core::chores::SavedChores>()
        .clone();
    let outside = terri_core::chores::ChoreKey {
        kind: terri_core::chores::ChoreKind::Floors,
        target: 0,
    };
    assert!(original.board_enabled);
    assert!(terri_sim::chores::keys(game.sim.world()).contains(&outside));
    assert!(!original.assignments.iter().any(|row| row.key == outside));
    let before = terri_sim::chores::RoomChangeContext::capture(game.sim.world()).unwrap();
    let proposal = terri_sim::rooms::match_rooms(&before.map, &before.map.topology, (0, 0));
    let mut choices = terri_sim::rooms::RoomChoices::default();
    choices.names.insert(
        before.map.topology.components[0].anchor,
        "Renamed while paused".into(),
    );
    let resolved = terri_sim::rooms::resolve_rooms(
        &proposal,
        &choices,
        game.sim.world().resource::<terri_core::rooms::SavedRooms>(),
    )
    .unwrap();
    terri_sim::chores::reconcile_committed_rooms(&mut game.sim, &before, &resolved).unwrap();
    assert_eq!(
        game.sim
            .world()
            .resource::<terri_core::chores::SavedChores>(),
        &original,
        "rename must not run deferred ordinary assignment policy"
    );
}
