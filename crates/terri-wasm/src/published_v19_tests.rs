//! Original schema-nineteen bytes from the receipt-bound published WASM build.
use super::*;

const INITIAL: &[u8] = include_bytes!("../tests/fixtures/published-v19/initial.sav");
const RUNNING: &[u8] = include_bytes!("../tests/fixtures/published-v19/running-fight.sav");

#[test]
fn issue314_authentic_v19_loads_without_invented_incidents_or_repairs() {
    for (bytes, length, tick, context_count) in [(INITIAL, 5380, 0, 0), (RUNNING, 6020, 49, 1)] {
        assert_eq!(bytes.len(), length);
        assert_eq!(&bytes[..8], &SAVE_MAGIC);
        assert_eq!(&bytes[8..10], &19u16.to_le_bytes());
        let (published, tail) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV19>(&bytes[SAVE_HEADER_BYTES..])
                .unwrap();
        assert!(tail.is_empty());
        assert_eq!(
            postcard::to_allocvec(&published).unwrap(),
            &bytes[SAVE_HEADER_BYTES..]
        );
        let mut migrated = SimHandle::from_lot();
        assert!(
            migrated.load_bytes(bytes),
            "cold public nineteen admission at source tick {tick}"
        );
        let mut native_control = SimHandle::from_lot();
        let view = super::current_test_snapshot::CurrentV5View(
            super::current_test_snapshot::current_from_v20(terri_core::SaveSnapshotV20 {
                legacy: published.clone(),
                conflicts: Default::default(),
            }),
        );
        assert_eq!(
            view.world.content_fingerprint,
            native_control
                .sim
                .current_v5_view()
                .world
                .content_fingerprint,
            "authentic fixture content shape"
        );
        native_control
            .sim
            .load_snapshot_v19(published.clone())
            .unwrap_or_else(|error| {
                panic!("separate typed nineteen admission at source tick {tick}: {error:?}")
            });
        assert_eq!(native_control.save_bytes(), migrated.save_bytes());
        assert_eq!(migrated.sim_tick(), tick);
        let current = migrated.sim.save_snapshot_v20();
        assert_eq!(
            current.legacy, published,
            "published fields retain their exact state"
        );
        assert_eq!(current.conflicts.next_id, 1);
        assert!(current.conflicts.grievances.is_empty());
        assert!(current.conflicts.repairs.is_empty());
        assert!(current.conflicts.dish_contributions.is_empty());
        assert_eq!(current.conflicts.fights.len(), context_count);
        for context in &current.conflicts.fights {
            assert!(context.legacy);
            assert!(!context.autonomous);
            assert!(context.grievance.is_none());
            assert_eq!(context.topic_code, 26);
        }
        let encoded = migrated.save_bytes();
        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&encoded));
        assert_eq!(resumed.save_bytes(), encoded);
        for _ in 0..100 {
            migrated.tick();
            resumed.tick();
            assert_eq!(migrated.world_hash(), resumed.world_hash());
            assert_eq!(migrated.save_bytes(), resumed.save_bytes());
        }
    }
}

#[test]
fn issue314_current_running_old_topic_still_requires_its_saved_context() {
    let mut source = SimHandle::from_lot();
    assert!(
        source.load_bytes(RUNNING),
        "cold public running nineteen admission"
    );
    let mut invalid = source.sim.save_snapshot_v20();
    assert_eq!(invalid.conflicts.fights.len(), 1);
    invalid.conflicts.fights.clear();
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(20u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&invalid).unwrap());
    let before = source.save_bytes();
    assert!(!source.load_bytes(&bytes));
    assert_eq!(source.save_bytes(), before);
}

#[test]
fn issue314_published_player_fight_requires_its_exact_execution_witness() {
    let (published, _) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV19>(&RUNNING[SAVE_HEADER_BYTES..])
            .unwrap();
    let mut live = SimHandle::from_lot();
    live.sim
        .load_snapshot_v19(published.clone())
        .expect("positive published fight control");
    let before = live.save_bytes();
    for corruption in 0..6 {
        let mut view = super::current_test_snapshot::CurrentV17View(
            super::current_test_snapshot::current_from_v20(terri_core::SaveSnapshotV20 {
                legacy: published.clone(),
                conflicts: Default::default(),
            }),
        );
        assert_eq!(view.social_executions.len(), 1);
        assert_eq!(view.legacy.legacy.conversation_requests.requests.len(), 1);
        match corruption {
            0 => view.social_executions.clear(),
            1 => view.social_executions[0].provenance = 2,
            2 => view.social_executions[0].order_id = Some(999),
            3 => view.social_executions[0].admitted = false,
            4 => {
                view.legacy.legacy.conversation_requests.requests[0].origin =
                    terri_core::save_v15::SavedConversationOrigin::Autonomous
            }
            5 => {
                view.legacy.legacy.conversation_requests.requests[0].phase =
                    terri_core::save_v15::SavedConversationPhase::Waiting
            }
            _ => unreachable!(),
        }
        assert!(
            live.sim
                .load_snapshot_v19(view.0.legacy.legacy.legacy)
                .is_err(),
            "corruption {corruption}"
        );
        assert_eq!(
            live.save_bytes(),
            before,
            "corruption {corruption} is atomic"
        );
    }
}
