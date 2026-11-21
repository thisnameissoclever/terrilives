use super::*;

const FIXTURES: [(&str, &[u8]); 4] = [
    (
        "shipped-household",
        include_bytes!("../tests/fixtures/published-v21/shipped-household.sav"),
    ),
    (
        "held-and-changed-today",
        include_bytes!("../tests/fixtures/published-v21/held-and-changed-today.sav"),
    ),
    (
        "mixed-queued-commands",
        include_bytes!("../tests/fixtures/published-v21/mixed-queued-commands.sav"),
    ),
    (
        "active-attendance",
        include_bytes!("../tests/fixtures/published-v21/active-attendance.sav"),
    ),
];

#[test]
fn authentic_published_v21_preserves_shifts_queues_and_current_continuation() {
    for (name, bytes) in FIXTURES {
        assert_eq!(&bytes[..8], SAVE_MAGIC, "{name}");
        assert_eq!(&bytes[8..10], &21u16.to_le_bytes(), "{name}");
        let (original, tail) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV21>(&bytes[10..]).unwrap();
        assert!(tail.is_empty());
        let mut loaded = SimHandle::from_lot();
        assert!(
            loaded.load_bytes(bytes),
            "authentic published {name} must load"
        );
        let current = loaded.save_bytes();
        let decoded = decode_current(&current);
        assert_eq!(
            decoded.previous.legacy.legacy.legacy.shifts, original.shifts,
            "{name}: exact held shift, stream and same-day ownership"
        );
        assert_eq!(
            decoded.previous.legacy.legacy.legacy.queued_shift_commands, original.queued_shift_commands,
            "{name}: exact mixed-queue positions"
        );
        assert_eq!(
            decoded.gameplay_v20().legacy.legacy.queued_settings,
            original.legacy.legacy.legacy.queued_settings,
            "{name}: household commands retain their positions"
        );
        let mut resumed = SimHandle::from_lot();
        assert!(
            resumed.load_bytes(&current),
            "{name}: current continuation loads"
        );
        assert_eq!(resumed.save_bytes(), current);
        for malformed in [bytes[..bytes.len() - 1].to_vec(), [bytes, &[0]].concat()] {
            assert!(
                !resumed.load_bytes(&malformed),
                "{name}: complete source decoding required"
            );
            assert_eq!(
                resumed.save_bytes(),
                current,
                "{name}: rejected import is transactional"
            );
        }
        for _ in 0..100 {
            loaded.tick();
            resumed.tick();
        }
        assert_eq!(loaded.world_hash(), resumed.world_hash(), "{name}");
        assert_eq!(loaded.save_bytes(), resumed.save_bytes(), "{name}");
    }
}

#[test]
fn authentic_published_v21_controls_exercise_nondefault_state() {
    let decode =
        |bytes: &[u8]| postcard::from_bytes::<terri_core::SaveSnapshotV21>(&bytes[10..]).unwrap();
    let held = decode(FIXTURES[1].1);
    assert_eq!(held.shifts.held.len(), 1);
    assert_eq!(held.shifts.changed_today.len(), 1);
    assert_eq!(held.shifts.held[0].shift, "late");
    let queued = decode(FIXTURES[2].1);
    assert_eq!(queued.queued_shift_commands.len(), 2);
    assert_eq!(queued.legacy.legacy.legacy.queued_settings.len(), 1);
}

#[test]
fn published_v21_rejects_invalid_same_day_shift_ownership_transactionally() {
    let original =
        postcard::from_bytes::<terri_core::SaveSnapshotV21>(&FIXTURES[1].1[10..]).unwrap();
    let mut unknown = original.clone();
    unknown.shifts.changed_today[0].from = "missing-shift".into();
    let mut wrong_day = original.clone();
    wrong_day.shifts.changed_today[0].day += 1;
    let mut duplicate = original;
    duplicate
        .shifts
        .changed_today
        .push(duplicate.shifts.changed_today[0].clone());
    let mut live = SimHandle::from_lot();
    let before = live.save_bytes();
    for malformed in [unknown, wrong_day, duplicate] {
        let mut encoded = SAVE_MAGIC.to_vec();
        encoded.extend(21u16.to_le_bytes());
        encoded.extend(postcard::to_allocvec(&malformed).unwrap());
        assert!(!live.load_bytes(&encoded));
        assert_eq!(live.save_bytes(), before);
    }
}

#[test]
fn combined_v25_preserves_activity_and_household_state_across_build() {
    use terri_core::{CommandQueue, Funds, SimClock, SimId};
    let mut source = SimHandle::new(20, 20);
    let lot = &source.sim.world().resource::<Content>().0.lot;
    source.sim.world_mut().insert_resource(terri_sim::lot_frame::LotFrame {
        origin: (0, 0),
        purchased_area: 400 - lot.width * lot.height,
    });
    source.sim.world_mut().insert_resource(Funds(100_000));
    assert!(source.spawn_object(4., 4., "pool"));
    source.spawn_agent(3., 5., 50.);
    assert!(source.spawn_object(10., 4., "bathtub"));
    source.spawn_agent(9., 4., 50.);
    let path = (0..source.career_path_labels().len() as u32)
        .find(|path| source.career_path_shifts(*path).len() >= 12)
        .unwrap();
    assert!(source.assign_career(1, path));
    source.flush_commands();
    assert!(source.assign_career_shift(1, path, 0));
    source.flush_commands();
    assert!(source.change_shift(1, 1));
    source.flush_commands();
    let issue = |handle: &mut SimHandle, command| {
        handle
            .sim
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(command);
        handle.flush_commands();
    };
    issue(
        &mut source,
        SimCommand::SetFloor {
            x: 18,
            y: 18,
            covering: 1,
        },
    );
    issue(
        &mut source,
        SimCommand::UseObjectFirst {
            agent: 1,
            object: 0,
            interaction: 0,
        },
    );
    let pack = source.sim.world().resource::<Content>().0;
    let bath = pack
        .object(pack.find("bathtub").unwrap())
        .interactions
        .iter()
        .position(|action| action.id == "soak")
        .unwrap() as u32;
    issue(
        &mut source,
        SimCommand::UseObjectFirst {
            agent: 3,
            object: 2,
            interaction: bath,
        },
    );
    for _ in 0..150 {
        let snapshot = source.sim.save_snapshot_v26();
        if !snapshot.pools.is_empty() && !snapshot.baths.is_empty() {
            break;
        }
        source.tick();
    }
    let now = source.sim.world().resource::<SimClock>().tick;
    let plants = u32::try_from(pack.affinities.iter().position(|kind| kind.id == "plants").unwrap())
        .unwrap();
    source
        .sim
        .world_mut()
        .resource_mut::<terri_sim::presence_fade::PresenceFade>()
        .refresh(SimId(0), plants, now, 60);
    let before = source.save_bytes();
    let baseline = decode_current(&before);
    assert_eq!(
        baseline.pools.len(),
        1,
        "ordinary pool order reaches its activity"
    );
    assert_eq!(
        baseline.baths.len(),
        1,
        "ordinary bath order reaches its activity"
    );
    assert_eq!(baseline.previous.legacy.legacy.legacy.shifts.held.len(), 1);
    assert_eq!(baseline.previous.legacy.legacy.legacy.shifts.changed_today.len(), 1);
    assert!(
        baseline.previous.legacy.legacy.legacy.shifts.draws > 0,
        "actual hire advances the independent shift stream"
    );
    assert_eq!(baseline.previous.legacy.presence_fade.len(), 1);
    assert!(baseline.previous.legacy.legacy.bills.last_counted_day.is_some());
    assert_eq!(source.sim.current_v5_view().floors.covering(18, 18), 1);
    source.sim.begin_build().unwrap();
    issue(
        &mut source,
        SimCommand::SetFloor {
            x: 18,
            y: 18,
            covering: 2,
        },
    );
    assert_eq!(
        source.save_bytes(),
        before,
        "Save during Build retains complete committed continuation"
    );
    source.sim.end_build().unwrap();
    assert_eq!(
        source.save_bytes(),
        before,
        "discard restores shifts, geometry, toy, progress and random streams exactly"
    );
    source.sim.begin_build().unwrap();
    issue(
        &mut source,
        SimCommand::SetFloor {
            x: 18,
            y: 18,
            covering: 2,
        },
    );
    let review = source.sim.prepare_build_commit(Default::default()).unwrap();
    source.sim.commit_build(review.token).unwrap();
    source.sim.end_build().unwrap();
    assert_eq!(source.sim.current_v5_view().floors.covering(18, 18), 2);
    assert_eq!(source.sim_tick(), now);
    let committed = source.save_bytes();
    let saved = decode_current(&committed);
    assert_eq!(saved.previous.legacy.legacy.bills, baseline.previous.legacy.legacy.bills);
    assert_eq!(saved.previous.legacy.presence_fade, baseline.previous.legacy.presence_fade);
    assert_eq!(saved.previous.legacy.legacy.legacy.shifts, baseline.previous.legacy.legacy.legacy.shifts);
    assert_eq!(saved.pools, baseline.pools);
    assert_eq!(saved.baths, baseline.baths);

    let mut resumed = SimHandle::new(1, 1);
    assert!(resumed.load_bytes(&committed));
    assert_eq!(resumed.save_bytes(), committed);
    for handle in [&mut source, &mut resumed] {
        issue(handle, SimCommand::CancelIntents { agent: 1 });
        issue(handle, SimCommand::CancelIntents { agent: 3 });
    }
    assert_eq!(
        source.save_bytes(),
        resumed.save_bytes(),
        "paused cancellation owns the same exact continuation"
    );
    assert!(decode_current(&source.save_bytes()).baths.is_empty());
    for _ in 0..100 {
        source.tick();
        resumed.tick();
    }
    assert_eq!(
        source.save_bytes(),
        resumed.save_bytes(),
        "canceled pool exit and later autonomy remain deterministic"
    );
}
