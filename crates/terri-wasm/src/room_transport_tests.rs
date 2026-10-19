use super::*;

fn assert_current_retains_exact_published_v16(current: &[u8], published: &[u8]) {
    assert_eq!(&published[..8], SAVE_MAGIC);
    assert_eq!(&published[8..10], &16u16.to_le_bytes());
    let (historical, tail) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV16>(&published[10..]).unwrap();
    assert!(tail.is_empty());
    assert_eq!(postcard::to_allocvec(&historical).unwrap(), published[10..]);
    let snapshot = decode_current(current).legacy.legacy;
    assert_eq!(snapshot.legacy, historical);
    let mut projected = SAVE_MAGIC.to_vec();
    projected.extend(16u16.to_le_bytes());
    projected.extend(postcard::to_allocvec(&snapshot.legacy).unwrap());
    assert_eq!(
        projected, published,
        "the complete frozen payload remains unchanged"
    );
    let mut migrated = SimHandle::from_lot();
    assert!(migrated.load_bytes(published));
    let migrated_bytes = migrated.save_bytes();
    let _ = decode_current(&migrated_bytes);
    let mut resumed = SimHandle::from_lot();
    assert!(resumed.load_bytes(&migrated_bytes));
    assert_eq!(resumed.save_bytes(), migrated_bytes);
}

#[test]
fn room_transport_leading_bom_is_literal_name_text() {
    let mut handle = SimHandle::from_lot();
    assert_eq!(handle.begin_build(), [1, 0]);
    assert_eq!(
        handle.stage_room_name(&[1, 0, 4, 239, 187, 191, 88]),
        [1, 0]
    );
    assert_eq!(handle.sim.build_rooms().unwrap()[0].name, "\u{feff}X");
    let review = handle.sim.prepare_build_commit(Default::default()).unwrap();
    assert_eq!(review.rooms[0].name, "\u{feff}X");
}

#[test]
fn room_transport_keeps_native_baseline_and_rejects_raw_controls_atomically() {
    let mut handle = SimHandle::from_lot();
    let baseline = handle.save_bytes();
    assert_eq!(handle.begin_build(), [1, 0]);
    assert_eq!(
        handle.stage_room_name(&[1, 0, 6, b'G', b'a', b'r', b'd', b'e', b'n']),
        [1, 0]
    );
    let review = handle.prepare_build_commit(&[1, 0, 0, 0, 0]);
    let ((version, status, token), _) =
        postcard::take_from_bytes::<(u8, u8, (u64, u64, u64))>(&review).unwrap();
    assert_eq!((version, status), (1, 0));
    let revision = handle.rooms_revision();
    assert_eq!(
        handle.stage_room_name(&[1, 0, 3, b' ', b'X', b'\n']),
        [1, 1, 6, 0]
    );
    assert_eq!(handle.rooms_revision(), revision);
    assert_eq!(handle.save_bytes(), baseline);
    assert_eq!(handle.commit_build(token.0, token.1, token.2), [1, 0]);
    assert!(handle.build_active());
    assert!(!handle.build_dirty());
    assert_ne!(handle.save_bytes(), baseline);
}

#[test]
fn room_transport_wide_token_literal_is_not_rounded() {
    use terri_sim::build_transaction::{BuildReview, BuildToken};
    let review = BuildReview {
        token: BuildToken {
            session: 9_007_199_254_740_993,
            revision: 9_007_199_254_740_995,
            preparation: u64::MAX,
        },
        groups: vec![],
        rooms: vec![terri_sim::build_transaction::BuildRoomReview {
            selection: terri_core::rooms::RoomSelection::Outside,
            anchor: None,
            name: "O".into(),
            previous_name: None,
            previous_area: 0,
            area: 0,
        }],
        retired_names: vec![],
        duties: Default::default(),
    };
    assert_eq!(
        super::browser_rooms::review_response(Ok(review)),
        [
            1, 0, 129, 128, 128, 128, 128, 128, 128, 16, 131, 128, 128, 128, 128, 128, 128, 16,
            255, 255, 255, 255, 255, 255, 255, 255, 255, 1, 0, 1, 0, 0, 1, 79, 0, 0, 0, 0, 0, 0, 0,
        ]
    );
}

#[test]
fn room_transport_summary_literal_is_pure_and_outside_zero_is_valid() {
    let handle = SimHandle::new(2, 1);
    let before = handle.save_bytes();
    let revision = handle.rooms_revision();
    assert_eq!(
        handle.room_summaries(),
        [1, 0, 2, 1, 1, 0, 0, 7, b'O', b'u', b't', b's', b'i', b'd', b'e', 2]
    );
    assert_eq!(handle.room_tiles(0.), [1, 0, 2, 0, 0, 1, 0]);
    assert_eq!(handle.room_tiles(f64::NAN), [1, 1, 13, 0]);
    assert_eq!(handle.room_tiles(1.), [1, 1, 5, 0]);
    assert_eq!(handle.save_bytes(), before);
    assert_eq!(handle.rooms_revision(), revision);
}

#[test]
fn room_transport_hostile_lengths_utf8_and_options_preserve_preparation() {
    let mut handle = SimHandle::from_lot();
    assert_eq!(handle.begin_build(), [1, 0]);
    let review = handle.sim.prepare_build_commit(Default::default()).unwrap();
    let baseline = handle.save_bytes();
    for bytes in [
        vec![],
        vec![2],
        vec![1, 2],
        vec![1, 0, 255, 255, 255, 255, 15],
        vec![1, 0, 0, 0, 0, 0],
        vec![1, 1, 128, 0],
    ] {
        assert_eq!(&handle.prepare_build_commit(&bytes)[..3], [1, 1, 13]);
        assert_eq!(handle.sim.validate_build_token(review.token), Ok(()));
        assert_eq!(handle.save_bytes(), baseline);
    }
    for bytes in [vec![1, 0, 1, 255], vec![1, 0, 2, 0xc0, 0x80]] {
        assert_eq!(handle.stage_room_name(&bytes), [1, 1, 13, 0]);
    }
    let mut long = vec![1, 0];
    let raw = format!("{}X{}", " ".repeat(2000), " ".repeat(2000));
    long.extend(postcard::to_allocvec(&raw).unwrap());
    assert_eq!(handle.stage_room_name(&long), [1, 0]);
    assert_eq!(handle.sim.build_rooms().unwrap()[0].name, "X");
}

#[test]
fn room_transport_duplicate_choices_and_stale_wide_tokens_leave_review_usable() {
    let mut handle = SimHandle::from_lot();
    assert_eq!(handle.begin_build(), [1, 0]);
    assert_eq!(
        handle.stage_room_name(&[1, 0, 7, b'P', b'e', b'n', b'd', b'i', b'n', b'g']),
        [1, 0]
    );
    assert!(handle.set_floor(17., 13., 4.));
    handle.flush_commands();
    let review = handle.sim.prepare_build_commit(Default::default()).unwrap();
    let token = (
        review.token.session,
        review.token.revision,
        review.token.preparation,
    );
    let baseline = handle.save_bytes();
    let hash = handle.world_hash();
    let names = handle.sim.build_rooms().unwrap();
    let revision = handle.rooms_revision();
    let request = |inheritance: Vec<((u32, u32), Option<u32>)>,
                   names: Vec<((u32, u32), String)>| {
        postcard::to_allocvec(&(1u8, Some(token), inheritance, names, Option::<String>::None))
            .unwrap()
    };
    for bytes in [
        request(vec![((1, 1), None), ((1, 1), None)], vec![]),
        request(vec![], vec![((1, 1), "A".into()), ((1, 1), "B".into())]),
        request(vec![((1, 1), Some(0))], vec![]),
    ] {
        assert_eq!(handle.prepare_build_commit(&bytes), [1, 1, 13, 0]);
        assert_eq!(handle.sim.validate_build_token(review.token), Ok(()));
    }
    for expected in [
        (u64::MAX, token.1, token.2),
        (token.0, 9_007_199_254_740_993, token.2),
        (token.0, token.1, u64::MAX),
    ] {
        let bytes = postcard::to_allocvec(&(
            1u8,
            Some(expected),
            Vec::<((u32, u32), Option<u32>)>::new(),
            Vec::<((u32, u32), String)>::new(),
            Option::<String>::None,
        ))
        .unwrap();
        assert_eq!(handle.prepare_build_commit(&bytes), [1, 1, 11, 0]);
    }
    assert_eq!(handle.save_bytes(), baseline);
    assert_eq!(handle.world_hash(), hash);
    assert_eq!(handle.sim.build_rooms().unwrap(), names);
    assert_eq!(handle.rooms_revision(), revision);
    assert_eq!(handle.commit_build(token.0, token.1, token.2), [1, 0]);
}

#[test]
fn room_transport_current_person_fixture_has_real_work_and_distinct_identity() {
    use terri_core::{
        chores::{ChoreKey, ChoreKind, SavedChores},
        SimId, SimName,
    };
    // Reconstruct the frozen V16 producer with its authored need rates.
    // The real cleanup tick must still match every saved physical field.
    let mut handle = SimHandle {
        sim: Sim::new_with_lot_and_content(
            10,
            8,
            super::published_v15_tests::pre_balance_content(),
        ),
    };
    for x in [2, 3] {
        handle
            .sim
            .world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetFloor {
                x,
                y: 2,
                covering: 4,
            });
        handle.sim.flush_commands();
    }
    let _retained = handle.sim.world_mut().spawn_empty().id();
    let hole = handle.sim.world_mut().spawn_empty().id();
    handle.sim.world_mut().despawn(hole);
    let person = handle.sim.spawn_agent(Position { x: 1., y: 2. }, 80.);
    handle
        .sim
        .world_mut()
        .entity_mut(person)
        .insert(SimName("Index witness".into()));
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetChoreBoard { enabled: false });
    handle.sim.flush_commands();
    {
        let mut chores = handle.sim.world_mut().resource_mut::<SavedChores>();
        chores.board_enabled = false;
        chores.floors = vec![(22, 800), (23, 800)];
    }
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::CleanChore {
            agent: person.index_u32(),
            key: ChoreKey {
                kind: ChoreKind::Floors,
                target: 0,
            },
        });
    handle.sim.flush_commands();
    for _ in 0..20 {
        if !handle
            .sim
            .world()
            .resource::<SavedChores>()
            .tasks
            .is_empty()
        {
            break;
        }
        handle.sim.tick();
    }
    assert_eq!(
        handle.sim.world().resource::<SavedChores>().tasks[0].cells,
        vec![22, 23]
    );
    assert_eq!(person.index_u32(), 1);
    assert_eq!(handle.sim.world().get::<SimId>(person).unwrap().0, 0);
    let baseline = handle.save_bytes();
    assert_current_retains_exact_published_v16(
        &baseline,
        include_bytes!("../tests/fixtures/room-transport-v16/sparse-person-active.sav"),
    );
    assert_eq!(handle.begin_build(), [1, 0]);
    assert_eq!(handle.save_bytes(), baseline);
    let mut roundtrip = SimHandle::new(10, 8);
    assert!(roundtrip.load_bytes(&baseline));
    assert_eq!(roundtrip.save_bytes(), baseline);
}

#[test]
fn room_transport_selection_and_predecessors_follow_both_land_offsets() {
    let mut handle = SimHandle::from_lot();
    handle
        .sim
        .world_mut()
        .insert_resource(terri_core::Funds::from_dollars(100000));
    let baseline = handle.save_bytes();
    assert_current_retains_exact_published_v16(
        &baseline,
        include_bytes!("../tests/fixtures/room-transport-v16/funded-fresh.sav"),
    );
    let original = handle
        .sim
        .world()
        .resource::<terri_sim::rooms::RoomMap>()
        .clone();
    assert_eq!(handle.begin_build(), [1, 0]);
    for side in [0, 2] {
        assert!(handle.buy_land(side));
        handle.flush_commands();
        assert_eq!(handle.sim.take_build_error(), None);
    }
    let map = handle.sim.world().resource::<terri_sim::rooms::RoomMap>();
    assert_eq!(map.component_ids, original.component_ids);
    for (old, new) in original
        .topology
        .components
        .iter()
        .zip(&map.topology.components)
    {
        assert_eq!(new.anchor, (old.anchor.0 + 10, old.anchor.1 + 10));
    }
    assert_eq!(handle.save_bytes(), baseline);
    let review = handle.sim.prepare_build_commit(Default::default()).unwrap();
    for room in review.rooms.iter().filter(|room| room.anchor.is_some()) {
        assert_eq!(
            handle
                .sim
                .build_component_predecessors(review.token, room.anchor.unwrap())
                .unwrap(),
            vec![match room.selection {
                terri_core::rooms::RoomSelection::Room(id) => id,
                _ => unreachable!(),
            }]
        );
    }
}
