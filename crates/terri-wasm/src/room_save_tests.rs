use super::*;

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
