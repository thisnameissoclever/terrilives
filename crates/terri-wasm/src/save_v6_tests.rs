use super::*;

#[test]
fn current_bytes_are_strict_v8() {
    let source = SimHandle::from_lot();
    let bytes = source.save_bytes();
    assert_eq!(&bytes[8..10], &[8, 0]);
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&bytes));
    assert_eq!(restored.save_bytes(), bytes);
    let before = restored.save_bytes();
    for length in 10..bytes.len() {
        assert!(!restored.load_bytes(&bytes[..length]));
        assert_eq!(restored.save_bytes(), before);
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(!restored.load_bytes(&trailing));
    assert_eq!(restored.save_bytes(), before);
}

#[test]
fn authentic_v5_households_migrate_once_without_charges_or_rng_draws() {
    for bytes in [
        include_bytes!("../../terri-data/tests/fixtures/pre-books/household-0.sav").as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books/household-100.sav").as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books/household-1000.sav").as_slice(),
        include_bytes!("../../terri-data/tests/fixtures/pre-books/household-2000.sav").as_slice(),
    ] {
        let old = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        let mut handle = SimHandle::from_lot();
        assert_eq!(handle.sim.book_copies().len(), 3);
        assert!(
            handle.load_bytes(bytes),
            "fixture at tick {}",
            old.world.tick
        );
        let migrated = handle.sim.save_snapshot_v6();
        assert_eq!(migrated.legacy.world.funds, old.world.funds);
        assert_eq!(migrated.legacy.world.rng, current_v5(old.clone()).world.rng);
        assert_eq!(migrated.legacy.world.tick, old.world.tick);
        assert_eq!(
            migrated.legacy.world.issued_sim_ids,
            old.world.issued_sim_ids
        );
        assert_eq!(migrated.books.copies.len(), 5);
        assert!(migrated.books.migration_granted);
        let titles: std::collections::BTreeSet<_> = migrated
            .books
            .copies
            .iter()
            .map(|copy| copy.title_id.as_str())
            .collect();
        assert_eq!(titles.len(), 5);
        let current = handle.save_bytes();
        assert!(handle.load_bytes(&current));
        assert_eq!(handle.save_bytes(), current);
        assert_eq!(handle.sim.save_snapshot_v6().books.copies.len(), 5);
    }
}

#[test]
fn invalid_v6_books_and_mapping_leave_the_complete_live_world_untouched() {
    let mut handle = SimHandle::from_lot();
    let bytes = include_bytes!("../../terri-data/tests/fixtures/pre-books/household-100.sav");
    assert!(handle.load_bytes(bytes));
    let snapshot = handle.sim.save_snapshot_v6();
    let before = handle.save_bytes();
    let hash = handle.world_hash();
    let mut cases = Vec::new();
    let mut bad = snapshot.clone();
    bad.books.copies[0].home.as_mut().unwrap().shelf.0 = u64::MAX;
    cases.push(bad);
    let mut bad = snapshot.clone();
    bad.books.copies.push(bad.books.copies[0].clone());
    cases.push(bad);
    let mut bad = snapshot.clone();
    bad.actions.objects[0]
        .interactions
        .push("unknown-action".into());
    cases.push(bad);
    let mut bad = snapshot.clone();
    bad.actions.objects.push(bad.actions.objects[0].clone());
    cases.push(bad);
    let mut bad = snapshot.clone();
    bad.actions.objects.pop();
    cases.push(bad);
    for candidate in cases {
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&candidate).unwrap());
        assert!(!handle.load_bytes(&bytes));
        assert_eq!(handle.save_bytes(), before);
        assert_eq!(handle.world_hash(), hash);
    }
    let mut bad_legacy = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
    bad_legacy.world.content_fingerprint = 0;
    assert!(!handle.load_bytes(&super::save_v3_tests::raw_v5_bytes(&bad_legacy)));
    assert_eq!(handle.save_bytes(), before);
    assert_eq!(handle.world_hash(), hash);
}

#[test]
fn v6_rejects_legacy_markers_without_clearing_existing_bed_assignments() {
    let mut handle = SimHandle::from_lot();
    let world = handle.sim.save_snapshot_v5().world;
    let people: Vec<_> = world
        .entities
        .iter()
        .filter(|entity| entity.agent)
        .map(|entity| entity.index)
        .collect();
    let bed = world
        .entities
        .iter()
        .find(|entity| entity.smart_object.as_deref() == Some("double_bed"))
        .unwrap()
        .index;
    assert!(handle.set_bed_assignment(f64::from(people[0]), Some(f64::from(bed)), 0.0));
    assert!(handle.set_death_enabled(false));
    handle.flush_commands();
    let snapshot = handle.sim.save_snapshot_v6();
    assert!(!snapshot
        .legacy
        .sleeping_places
        .as_ref()
        .unwrap()
        .assignments
        .is_empty());
    assert!(!handle.death_enabled());
    let before = handle.save_bytes();
    let hash = handle.world_hash();
    let mut cases = Vec::new();
    let mut absent_affinities = snapshot.clone();
    absent_affinities.legacy.affinities = None;
    cases.push(("current authoritative affinity marker", absent_affinities));
    let mut missing_sleep = snapshot.clone();
    missing_sleep.legacy.sleeping_places = None;
    cases.push(("absent modern sleeping places", missing_sleep));
    let mut unapplied_default = snapshot.clone();
    unapplied_default.legacy.death_default_applied = false;
    cases.push(("legacy death default marker", unapplied_default));
    let mut indexed_family = snapshot.clone();
    assert!(indexed_family.legacy.family_by_index.set(
        people[0],
        people[1],
        Some(terri_core::layout::Relation::Parent)
    ));
    cases.push(("legacy indexed family", indexed_family));
    for (reason, invalid) in cases {
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend(7u16.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&invalid).unwrap());
        assert!(!handle.load_bytes(&bytes), "accepted {reason}");
        assert_eq!(
            handle.save_bytes(),
            before,
            "{reason} changed the live save"
        );
        assert_eq!(handle.world_hash(), hash);
        assert!(!handle.death_enabled());
    }
    // These sparse options legitimately encode empty current state.
    let empty = SimHandle::new(4, 4);
    let saved = empty.sim.save_snapshot_v6();
    assert!(saved.legacy.domestic.is_none() && saved.legacy.dining.is_none());
    assert!(snapshot.legacy.mortality.is_none());
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&empty.save_bytes()));
    assert!(restored.load_bytes(&before));
    assert_eq!(restored.save_bytes(), before);
}

#[test]
fn current_v6_rejects_two_readers_on_one_physical_chair() {
    let mut source = SimHandle::new(10, 10);
    assert!(source.spawn_object(4.0, 4.0, "reading_chair"));
    source.spawn_agent(5.0, 4.0, 100.0);
    source.spawn_agent(5.0, 4.0, 100.0);
    let people: Vec<_> = source
        .sim
        .world_mut()
        .query::<(terri_core::Entity, &terri_core::Agent)>()
        .iter(source.sim.world())
        .map(|(e, _)| e)
        .collect();
    let chair = source
        .sim
        .world_mut()
        .query::<(terri_core::Entity, &terri_core::SmartObject)>()
        .iter(source.sim.world())
        .next()
        .unwrap()
        .0;
    super::boundary_tests::start_owned_reading(&mut source, people[0], chair);
    let shelf = source.sim.book_copies()[0].home.unwrap().shelf.0 as u32;
    let title = source.sim.book_copies()[0].title_id.clone();
    assert!(source.buy_book(title, Some(f64::from(shelf))));
    source.sim.flush_commands();
    let saved = source.sim.save_snapshot_v6();
    let mut loaded = SimHandle::new(10, 10);
    let bytes = source.save_bytes();
    assert!(loaded.load_bytes(&bytes));
    let before = loaded.save_bytes();
    let hash = loaded.world_hash();
    let mut bad = saved.clone();
    let mut journey = bad.reading[0].clone();
    journey.owner = people[1].index_u32();
    journey.copy = terri_core::books::BookCopyId(1);
    journey.order = None;
    bad.reading.push(journey);
    let mut seat = bad.seats[0].clone();
    seat.person = people[1].index_u32();
    bad.seats.push(seat);
    let owner = *source
        .sim
        .world()
        .get::<terri_core::SimId>(people[1])
        .unwrap();
    bad.books.copies[1].borrower = Some(owner);
    bad.books.copies[1].location = terri_core::books::BookLocation::Carried(owner);
    let first = bad
        .legacy
        .world
        .entities
        .iter()
        .find(|e| e.index == people[0].index_u32())
        .unwrap()
        .clone();
    let second = bad
        .legacy
        .world
        .entities
        .iter_mut()
        .find(|e| e.index == people[1].index_u32())
        .unwrap();
    second.target = first.target;
    second.path = first.path;
    second.eating = None;
    second.position = first.position;
    let mut corrupted = SAVE_MAGIC.to_vec();
    corrupted.extend_from_slice(&8u16.to_le_bytes());
    corrupted.extend(postcard::to_allocvec(&bad).unwrap());
    assert!(!loaded.load_bytes(&corrupted));
    assert_eq!(loaded.save_bytes(), before);
    assert_eq!(loaded.world_hash(), hash);
}

#[test]
fn historical_constructors_match_the_retained_initial_household() {
    let source = published_household();
    let actual = decode_v5(
        &include_bytes!("../../terri-data/tests/fixtures/pre-books/household-0.sav")
            [SAVE_HEADER_BYTES..],
    )
    .unwrap();
    assert_eq!(source.sim.save_snapshot_v5(), actual);
    let empty = published_empty(7, 9);
    assert_eq!(
        empty.sim.save_snapshot().rng,
        terri_core::SimRng::from_seed(Content::pre_books().0.tuning.rng_seed)
    );
}

#[test]
fn published_v5_rejects_duplicate_exclusive_readers_before_reading_cleanup() {
    for content in [Content::pre_books(), Content::published_pre_books()] {
        let mut source = SimHandle {
            sim: Sim::new_with_lot_and_content(10, 10, content),
        };
        assert!(source.spawn_object(4., 4., "reading_chair"));
        source.spawn_agent(5., 4., 100.);
        source.spawn_agent(5., 4., 100.);
        let mut saved = source.sim.save_snapshot_v5();
        let chair = saved
            .world
            .entities
            .iter()
            .find(|e| e.smart_object.as_deref() == Some("reading_chair"))
            .unwrap()
            .index;
        let people: Vec<_> = saved
            .world
            .entities
            .iter()
            .filter(|e| e.agent)
            .map(|e| e.index)
            .collect();
        saved
            .world
            .entities
            .iter_mut()
            .find(|e| e.index == chair)
            .unwrap()
            .reserved = true;
        let reader = saved
            .world
            .entities
            .iter_mut()
            .find(|e| e.index == people[0])
            .unwrap();
        reader.target = Some(terri_core::SavedTarget {
            object: chair,
            interaction: 0,
        });
        reader.eating = Some(terri_core::SavedEating {
            object: "reading_chair".into(),
            interaction: 0,
            remaining_ticks: 20,
        });
        let mut loaded = SimHandle::from_lot();
        assert!(
            loaded.load_bytes(&super::save_v3_tests::v5_bytes(&saved)),
            "valid historical single-reader source loads"
        );
        let before = loaded.save_bytes();
        let hash = loaded.world_hash();
        let first = saved
            .world
            .entities
            .iter()
            .find(|e| e.index == people[0])
            .unwrap()
            .clone();
        let second = saved
            .world
            .entities
            .iter_mut()
            .find(|e| e.index == people[1])
            .unwrap();
        second.target = first.target;
        second.eating = first.eating;
        second.position = first.position;
        assert!(!loaded.load_bytes(&super::save_v3_tests::v5_bytes(&saved)));
        assert_eq!(loaded.save_bytes(), before);
        assert_eq!(loaded.world_hash(), hash);
    }
}

#[test]
fn published_active_recline_retains_its_exact_perimeter_position_and_countdown() {
    let mut source = published_empty(10, 10);
    assert!(source.spawn_object(4., 4., "long_sofa"));
    source.spawn_agent(3., 4., 100.);
    let mut saved = source.sim.save_snapshot_v5();
    let sofa = saved
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("long_sofa"))
        .unwrap()
        .index;
    saved
        .world
        .entities
        .iter_mut()
        .find(|e| e.index == sofa)
        .unwrap()
        .reserved = true;
    let actor = saved.world.entities.iter_mut().find(|e| e.agent).unwrap();
    let person = actor.index;
    actor.target = Some(terri_core::SavedTarget {
        object: sofa,
        interaction: 0,
    });
    actor.eating = Some(terri_core::SavedEating {
        object: "long_sofa".into(),
        interaction: 0,
        remaining_ticks: 47,
    });
    let expected = current_v5(saved.clone());
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&super::save_v3_tests::v5_bytes(&saved)));
    assert_eq!(loaded.sim.save_snapshot_v5(), expected);
    let current = loaded.sim.save_snapshot_v6();
    assert_eq!(current.seats.len(), 1);
    assert!(current.seats[0].all);
    assert_eq!(current.seats[0].person, person);
    let bytes = loaded.save_bytes();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(loaded.save_bytes(), bytes);
}

#[test]
fn pinned_affinity_chore_calendar_v5_saves_preserve_authoritative_state() {
    for (name, bytes) in [
        (
            "initial",
            include_bytes!("../tests/fixtures/published-89040f82/initial.bin").as_slice(),
        ),
        (
            "played",
            include_bytes!("../tests/fixtures/published-89040f82/played.bin").as_slice(),
        ),
        (
            "table-seat",
            include_bytes!("../tests/fixtures/published-89040f82/table-seat.bin").as_slice(),
        ),
        (
            "chores-cleanup",
            include_bytes!("../tests/fixtures/published-89040f82/chores-cleanup.bin").as_slice(),
        ),
    ] {
        let old = decode_v5(&bytes[SAVE_HEADER_BYTES..]).expect("actual published V5 bytes");
        assert!(old.affinities.is_some());
        let mut handle = SimHandle::from_lot();
        assert!(
            handle.load_bytes(bytes),
            "pinned published source {name} restores"
        );
        let saved = handle.sim.save_snapshot_v6();
        assert_eq!(saved.legacy.affinities, old.affinities);
        assert_eq!(saved.legacy.targeted_cleanup, old.targeted_cleanup);
        assert_eq!(saved.legacy.chores, old.chores);
        assert_eq!(saved.legacy.grime, old.grime);
        assert_eq!(saved.legacy.world.rng, old.world.rng);
        let current = handle.save_bytes();
        assert!(handle.load_bytes(&current));
        assert_eq!(handle.save_bytes(), current);
    }
}

#[test]
fn commands_twenty_three_through_twenty_nine_roundtrip_in_one_pending_stream() {
    use terri_core::{
        chores::{ChoreKey, ChoreKind},
        command::BookCommand,
        CommandQueue, SimCommand,
    };
    let mut source = SimHandle::from_lot();
    let state = source.sim.save_snapshot_v5();
    let agent = state
        .world
        .entities
        .iter()
        .find(|person| person.agent)
        .unwrap()
        .index;
    let table = state
        .world
        .entities
        .iter()
        .find(|item| item.smart_object.as_deref() == Some("dining_table"))
        .unwrap()
        .index;
    let bin = state
        .world
        .entities
        .iter()
        .find(|item| item.smart_object.as_deref() == Some("trashcan"))
        .unwrap()
        .index;
    let key = ChoreKey {
        kind: ChoreKind::Bins,
        target: bin,
    };
    let title = source.sim.world().resource::<Content>().0.books[0]
        .id
        .clone();
    let commands = vec![
        SimCommand::CleanDishes {
            agent,
            surface: table,
            dishes: None,
        },
        SimCommand::CleanDishesFirst {
            agent,
            surface: table,
            dishes: None,
        },
        SimCommand::CleanChore { agent, key },
        SimCommand::CleanChoreFirst { agent, key },
        SimCommand::SetChoreProfile {
            agent,
            responsibility: 80,
            preferences: [-10, 20, 0, 40],
        },
        SimCommand::SetChoreBoard { enabled: true },
        SimCommand::Book(BookCommand::Purchase { title, shelf: None }),
    ];
    for (index, command) in commands.iter().enumerate() {
        let bytes = postcard::to_allocvec(command).unwrap();
        assert_eq!(bytes[0], 23 + index as u8);
        source
            .sim
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command.clone());
    }
    let bytes = source.save_bytes();
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(
        loaded.sim.world().resource::<CommandQueue>().as_slice(),
        commands.as_slice()
    );
    assert_eq!(loaded.save_bytes(), bytes);
    source.flush_commands();
    loaded.flush_commands();
    assert_eq!(source.save_bytes(), loaded.save_bytes());
}

#[test]
fn pinned_affinity_prefix_preserves_values_and_retires_only_old_false_table_sit() {
    for (name, bytes) in [
        (
            "initial",
            include_bytes!("../tests/fixtures/published-f3cb7a1c/initial.bin").as_slice(),
        ),
        (
            "old-table",
            include_bytes!("../tests/fixtures/published-f3cb7a1c/old-table.bin").as_slice(),
        ),
    ] {
        let old = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert!(old.affinities.is_some());
        assert!(postcard::to_allocvec(&old).unwrap().len() >= bytes.len() - SAVE_HEADER_BYTES + 3);
        let mut handle = SimHandle::from_lot();
        assert!(
            handle.load_bytes(bytes),
            "{name} affinity-prefix source restores"
        );
        let saved = handle.sim.save_snapshot_v6();
        assert_eq!(saved.legacy.affinities, old.affinities);
        assert_eq!(saved.legacy.world.rng, old.world.rng);
        let table = old
            .world
            .entities
            .iter()
            .find(|row| row.smart_object.as_deref() == Some("dining_table"))
            .unwrap()
            .index;
        assert!(saved.legacy.world.entities.iter().all(|row| row
            .target
            .is_none_or(|target| target.object != table || target.interaction != 0)));
        assert_eq!(saved.books.copies.len(), 5);
        let current = handle.save_bytes();
        assert!(handle.load_bytes(&current));
        assert_eq!(handle.save_bytes(), current);
    }
}
