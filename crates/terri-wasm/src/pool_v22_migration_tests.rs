use super::*;
use crate::current_test_snapshot::CurrentV5View;

macro_rules! frozen {
    ($name:literal) => {
        (
            $name,
            include_bytes!(concat!("../tests/fixtures/pool-v22/", $name)) as &[u8],
        )
    };
}
const CONTROLS: &[(&str, &[u8])] = &[
    frozen!("pool-f0-masculine-neutral-entry.bin"),
    frozen!("pool-f0-masculine-neutral-entry-step.bin"),
    frozen!("pool-f0-masculine-neutral-swim.bin"),
    frozen!("pool-f0-masculine-neutral-exit.bin"),
    frozen!("pool-f0-masculine-neutral-cancel-entry.bin"),
    frozen!("pool-f0-masculine-neutral-cancel-swim.bin"),
    frozen!("pool-f0-feminine-short-wide-entry.bin"),
    frozen!("pool-f0-feminine-short-wide-swim.bin"),
    frozen!("pool-f0-feminine-short-wide-exit.bin"),
    frozen!("pool-f0-feminine-tall-wide-entry.bin"),
    frozen!("pool-f0-masculine-tall-narrow-entry.bin"),
    frozen!("pool-f1-masculine-neutral-entry.bin"),
    frozen!("pool-f1-feminine-short-wide-entry.bin"),
    frozen!("pool-f1-feminine-tall-wide-entry.bin"),
    frozen!("pool-f1-masculine-tall-narrow-entry.bin"),
    frozen!("pool-f2-masculine-neutral-entry.bin"),
    frozen!("pool-f2-feminine-short-wide-entry.bin"),
    frozen!("pool-f2-feminine-tall-wide-entry.bin"),
    frozen!("pool-f2-masculine-tall-narrow-entry.bin"),
    frozen!("pool-f3-masculine-neutral-entry.bin"),
    frozen!("pool-f3-feminine-short-wide-entry.bin"),
    frozen!("pool-f3-feminine-tall-wide-entry.bin"),
    frozen!("pool-f3-masculine-tall-narrow-entry.bin"),
    frozen!("pool-idle-approach.bin"),
    frozen!("pool-two-people-two-pools-idle.bin"),
];

fn historical(bytes: &[u8]) -> terri_core::LegacyEditableWorldSnapshotV22 {
    assert_eq!(&bytes[8..10], &22u16.to_le_bytes());
    let (snapshot, tail) = postcard::take_from_bytes(&bytes[SAVE_HEADER_BYTES..]).unwrap();
    assert!(tail.is_empty());
    snapshot
}
fn envelope(version: u16, payload: Vec<u8>) -> Vec<u8> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(version.to_le_bytes());
    bytes.extend(payload);
    bytes
}

#[test]
fn frozen_v22_pool_controls_preserve_every_field_except_owned_coordinates() {
    for &(name, bytes) in CONTROLS {
        let source = historical(bytes);
        let mut handle = SimHandle::new(12, 12);
        assert!(
            handle.load_bytes(bytes),
            "unchanged historical control must load: {name}"
        );
        let actual = CurrentV5View(terri_core::SaveSnapshotV34 {
            previous: terri_core::SaveSnapshotV33 {
                previous: terri_core::SaveSnapshotV31 {
                    current: handle.sim.save_snapshot_v28(),
                    topic_memory: vec![],
                },
                hobby_mood: vec![],
            },
            walk_steps: vec![],
        });
        let mut expected = CurrentV5View(terri_core::SaveSnapshotV34 {
            previous: terri_core::SaveSnapshotV33 {
                previous: terri_core::SaveSnapshotV31 {
                    current: terri_core::SaveSnapshotV28 {
                        editable: terri_core::SaveSnapshotV26 {
                            previous: terri_core::SaveSnapshotV24 {
                                career_inputs: vec![],
                                queued_work_commands: vec![],
                                replaced_shifts: vec![],
                                legacy: terri_core::SaveSnapshotV23 {
                                    legacy: terri_core::SaveSnapshotV22 {
                                        legacy: terri_core::SaveSnapshotV21 {
                                            legacy: source.previous.previous.clone(),
                                            shifts: terri_core::save_v21::SavedShifts {
                                                rng: terri_core::SimRng::from_seed(
                                                    terri_sim::shifts::SHIFTS_SEED,
                                                ),
                                                draws: 0,
                                                held: vec![],
                                                changed_today: vec![],
                                            },
                                            queued_shift_commands: vec![],
                                        },
                                        bills: Default::default(),
                                    },
                                    presence_fade: vec![],
                                },
                            },
                            surfaces: source.previous.surfaces.clone(),
                            commutes: source.previous.commutes.clone(),
                            pools: source.pools.clone(),
                            baths: vec![],
                            manual_work_trips: vec![],
                            open_shift_base_pay: vec![],
                            career_input_sources: vec![],
                        },
                        need_mood: vec![],
                    },
                    topic_memory: vec![],
                },
                hobby_mood: vec![],
            },
            walk_steps: vec![],
        });
        assert_eq!(expected.world.content_fingerprint, 0x7229_9218_57a2_e3ae);
        expected.world.content_fingerprint = current_test_snapshot::CURRENT_CATALOGUE_FINGERPRINT;
        for row in &mut expected.0.pools {
            let migrated = actual
                .0
                .pools
                .iter()
                .find(|entry| entry.actor == row.actor)
                .unwrap();
            assert_ne!(
                row.approach, migrated.approach,
                "frozen coordinate meaning must change: {name}"
            );
            row.approach = migrated.approach;
        }
        for row in &source.pools {
            let after = actual
                .world
                .entities
                .iter()
                .find(|entity| entity.index == row.actor)
                .unwrap();
            let before = expected
                .world
                .entities
                .iter_mut()
                .find(|entity| entity.index == row.actor)
                .unwrap();
            if row.phase == 0 {
                assert!(
                    before.position == after.position,
                    "approach must preserve exact position: {name}"
                );
            } else {
                let point = after.position.unwrap();
                let endpoint = actual
                    .0
                    .pools
                    .iter()
                    .find(|entry| entry.actor == row.actor)
                    .unwrap()
                    .approach;
                assert_eq!((point.x, point.y), (endpoint.0 as f32, endpoint.1 as f32));
            }
            before.position = after.position;
            before.path = after.path.clone();
        }
        assert!(
            actual == expected,
            "migration changed non-coordinate progress or ownership: {name}"
        );
        let current = handle.save_bytes();
        assert_eq!(&current[8..10], &SAVE_SCHEMA_VERSION.to_le_bytes());
        assert!(
            handle.load_bytes(&current),
            "current continuation must load: {name}"
        );
        assert!(
            handle.save_bytes() == current,
            "current reload must not migrate again: {name}"
        );
        if !source.pools.is_empty() {
            assert!(handle.sim.try_save_snapshot_editable_world_v22().is_err());
        }
    }
}

#[test]
fn version_selects_pool_coordinate_meaning_without_a_fallback_decoder() {
    let bytes = CONTROLS[0].1;
    let old = historical(bytes);
    let mut handle = SimHandle::new(12, 12);
    assert!(handle.load_bytes(bytes), "historical positive control");
    let current = handle.sim.save_snapshot_editable_world_v23();
    let retained = handle.save_bytes();
    let hash = handle.world_hash();
    let old_coordinates_in_current = terri_core::LegacyEditableWorldSnapshotV23 {
        previous: old,
        baths: vec![],
    };
    assert!(!handle.load_bytes(&envelope(
        23,
        postcard::to_allocvec(&old_coordinates_in_current).unwrap()
    )));
    assert!(handle.save_bytes() == retained);
    assert_eq!(handle.world_hash(), hash);
    // This is intentionally mislabeled current data, never a historical fixture.
    assert!(!handle.load_bytes(&envelope(
        22,
        postcard::to_allocvec(&current.previous).unwrap()
    )));
    assert!(handle.save_bytes() == retained);
    assert_eq!(handle.world_hash(), hash);
    let mut trailing = bytes.to_vec();
    trailing.push(0);
    assert!(!handle.load_bytes(&trailing));
    assert!(handle.save_bytes() == retained);
    assert_eq!(handle.world_hash(), hash);
}

#[test]
fn private_bath_saves_keep_their_exact_toy_and_progress() {
    let v23 = include_bytes!("../tests/fixtures/private-editable/bath-v23.sav");
    let v24 = include_bytes!("../tests/fixtures/private-editable/bath-v24.sav");
    let (old23, tail) = postcard::take_from_bytes::<terri_core::LegacyEditableWorldSnapshotV23>(
        &v23[SAVE_HEADER_BYTES..],
    )
    .unwrap();
    assert!(tail.is_empty());
    let (old24, tail) = postcard::take_from_bytes::<terri_core::LegacyEditableWorldSnapshotV24>(
        &v24[SAVE_HEADER_BYTES..],
    )
    .unwrap();
    assert!(tail.is_empty());

    for (version, original, baths) in [(23, &v23[..], old23.baths), (24, &v24[..], old24.baths)] {
        assert_eq!(baths.len(), 1);
        assert_eq!(baths[0].toy, 2);
        let mut imported = SimHandle::from_lot();
        assert!(imported.load_bytes(original), "private version {version}");
        let current = imported.save_bytes();
        assert_eq!(decode_current(&current).baths, baths);
        assert!(imported.load_bytes(&current));
        assert_eq!(imported.save_bytes(), current);

        for malformed in [
            original[..original.len() - 1].to_vec(),
            [original, &[0]].concat(),
        ] {
            assert!(!imported.load_bytes(&malformed));
            assert_eq!(imported.save_bytes(), current);
        }
    }
}
