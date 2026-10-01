use super::*;
use terri_core::{
    layout::SavedLayout, Facing, SaveSnapshotV2, SaveSnapshotV3, SaveSnapshotV4, SaveSnapshotV5,
    SavedCommand,
};

pub(super) fn v2_bytes(snapshot: &SaveSnapshotV2) -> Vec<u8> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(snapshot).unwrap());
    bytes
}

fn v3_bytes(snapshot: &SaveSnapshotV3) -> Vec<u8> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend_from_slice(&3u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(snapshot).unwrap());
    bytes
}

fn v4_bytes(snapshot: &SaveSnapshotV4) -> Vec<u8> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend_from_slice(&4u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(snapshot).unwrap());
    bytes
}

fn v5_bytes(snapshot: &SaveSnapshotV5) -> Vec<u8> {
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend_from_slice(&5u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(snapshot).unwrap());
    bytes
}

// Serialize each appended field independently so historical-prefix fixtures
// cannot accidentally cut a newer field that follows the intended boundary.
pub(super) fn v5_appended_lengths(snapshot: &SaveSnapshotV5) -> [usize; 12] {
    [
        postcard::to_allocvec(&snapshot.floors).unwrap().len(),
        postcard::to_allocvec(&snapshot.family_by_index)
            .unwrap()
            .len(),
        postcard::to_allocvec(&snapshot.family).unwrap().len(),
        postcard::to_allocvec(&snapshot.mortality).unwrap().len(),
        postcard::to_allocvec(&snapshot.death_default_applied)
            .unwrap()
            .len(),
        postcard::to_allocvec(&snapshot.waiting_needs)
            .unwrap()
            .len(),
        postcard::to_allocvec(&snapshot.self_preservation)
            .unwrap()
            .len(),
        postcard::to_allocvec(&snapshot.chronotype_offsets)
            .unwrap()
            .len(),
        postcard::to_allocvec(&snapshot.domestic).unwrap().len(),
        postcard::to_allocvec(&snapshot.sleeping_places)
            .unwrap()
            .len(),
        postcard::to_allocvec(&snapshot.shyness).unwrap().len(),
        postcard::to_allocvec(&snapshot.boundaries).unwrap().len(),
    ]
}

fn assert_current_resave_is_stable(handle: &SimHandle) {
    let bytes = handle.save_bytes();
    let mut next = SimHandle::from_lot();
    assert!(next.load_bytes(&bytes));
    assert_eq!(next.save_bytes(), bytes);
}

#[test]
fn grouped_sleeping_places_rejects_explicit_none_and_every_interior_cut() {
    use terri_core::save::SavedSleepingPlaces;
    let mut source = SimHandle::from_lot().sim.save_snapshot_v5();
    for state in [
        SavedSleepingPlaces::default(),
        SavedSleepingPlaces {
            active_places: vec![(300, 1)],
            assignments: vec![(9, 129, 0)],
        },
        SavedSleepingPlaces {
            active_places: vec![(300, 1); 128],
            assignments: vec![(9, 129, 0); 128],
        },
    ] {
        source.sleeping_places = Some(state);
        let payload = postcard::to_allocvec(&source).unwrap();
        let tail = postcard::to_allocvec(&source.sleeping_places).unwrap();
        let privacy_len: usize = v5_appended_lengths(&source)[10..].iter().sum();
        let end = payload.len() - privacy_len;
        let start = end - tail.len();
        assert_eq!(
            decode_v5(&payload[..end]).unwrap().sleeping_places,
            source.sleeping_places
        );
        assert!(decode_v5(&payload).unwrap().sleeping_places.is_some());
        assert!(decode_v5(&payload[..start])
            .unwrap()
            .sleeping_places
            .is_none());
        for cut in start + 1..end {
            assert!(
                decode_v5(&payload[..cut]).is_none(),
                "accepted interior grouped cut at {}",
                cut - start
            );
        }
    }
    source.sleeping_places = None;
    let explicit_none = postcard::to_allocvec(&source).unwrap();
    for absent in 0..=2 {
        assert!(
            decode_v5(&explicit_none[..explicit_none.len() - absent]).is_none(),
            "explicit None with {absent} absent privacy fields"
        );
    }
    let mut live = SimHandle::from_lot();
    let before = live.save_bytes();
    assert!(!live.load_bytes(&v5_bytes(&source)));
    assert_eq!(live.save_bytes(), before);
}

#[test]
fn bed_era_prefix_preserves_nonempty_places_paths_and_sleep_countdowns() {
    let mut source = SimHandle::from_lot();
    let saved = source.sim.save_snapshot_v5();
    let agent = saved
        .world
        .entities
        .iter()
        .find(|row| row.agent)
        .unwrap()
        .index;
    let bed = saved
        .world
        .entities
        .iter()
        .find(|row| row.smart_object.as_deref() == Some("double_bed"))
        .unwrap()
        .index;
    assert!(source.set_bed_assignment(f64::from(agent), Some(f64::from(bed)), 1.0));
    let order = terri_core::SimCommand::UseObject {
        agent,
        object: bed,
        interaction: 0,
    };
    assert!(source.enqueue_command(&postcard::to_allocvec(&order).unwrap()));
    source.tick();
    for sleeping in [false, true] {
        if sleeping {
            for _ in 0..500 {
                if source
                    .sim
                    .save_snapshot_v5()
                    .world
                    .entities
                    .iter()
                    .find(|row| row.index == agent)
                    .unwrap()
                    .eating
                    .is_some()
                {
                    break;
                }
                source.tick();
            }
        }
        let mut snapshot = source.sim.save_snapshot_v5();
        let person = snapshot
            .world
            .entities
            .iter()
            .find(|row| row.index == agent)
            .unwrap();
        assert_eq!(person.eating.is_some(), sleeping);
        assert_eq!(person.path.is_some(), !sleeping);
        let places = snapshot.sleeping_places.as_ref().unwrap();
        assert!(places.active_places.contains(&(agent, 1)));
        assert_eq!(places.assignments.len(), 1);
        // Independently encode the published bed-era order, without privacy fields.
        let prefix = postcard::to_allocvec(&(
            &snapshot.world,
            &snapshot.layout,
            &snapshot.object_facings,
            &snapshot.retired_indices,
            &snapshot.object_colourways,
            &snapshot.floors,
            &snapshot.family_by_index,
            &snapshot.family,
            &snapshot.mortality,
            snapshot.death_default_applied,
            &snapshot.waiting_needs,
            &snapshot.self_preservation,
            &snapshot.chronotype_offsets,
            &snapshot.domestic,
            &snapshot.sleeping_places,
        ))
        .unwrap();
        snapshot.shyness.clear();
        snapshot.boundaries.clear();
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend_from_slice(&5u16.to_le_bytes());
        bytes.extend(prefix);
        let mut loaded = SimHandle::from_lot();
        assert!(loaded.load_bytes(&bytes));
        assert_eq!(loaded.sim.save_snapshot_v5(), snapshot);
        let mut control = SimHandle::from_lot();
        assert!(control.load_bytes(&v5_bytes(&snapshot)));
        for _ in 0..60 {
            loaded.tick();
            control.tick();
            assert_eq!(loaded.sim.world_hash(), control.sim.world_hash());
        }
    }
}

#[test]
fn independent_bed_release_wasm_saves_preserve_claims_and_pending_command_19() {
    for (bytes, sleeping, pending_clear) in [
        (
            include_bytes!("../tests/fixtures/bed-era-two-walking-assigned.bin").as_slice(),
            false,
            false,
        ),
        (
            include_bytes!("../tests/fixtures/bed-era-two-sleeping-assigned.bin").as_slice(),
            true,
            false,
        ),
        (
            include_bytes!("../tests/fixtures/bed-era-two-sleeping-pending-clear.bin").as_slice(),
            true,
            true,
        ),
    ] {
        let expected = decode_local_bed_v5(&bytes[10..]).unwrap();
        let places = expected.sleeping_places.as_ref().unwrap();
        assert_eq!(places.active_places, vec![(34, 0), (35, 1)]);
        assert_eq!(places.assignments, vec![(0, 19, 0), (1, 19, 1)]);
        for id in [34, 35] {
            let person = expected
                .world
                .entities
                .iter()
                .find(|row| row.index == id)
                .unwrap();
            assert_eq!(person.eating.is_some(), sleeping);
            assert_eq!(person.path.is_some(), !sleeping);
        }
        let mut loaded = SimHandle::from_lot();
        assert!(loaded.load_bytes(bytes));
        let actual = loaded.sim.save_snapshot_v5();
        let mut normalized = expected.clone();
        normalized.world.content_fingerprint = actual.world.content_fingerprint;
        assert_eq!(actual, normalized);
        let current = loaded.save_bytes();
        assert_current_resave_is_stable(&loaded);
        let mut replay = SimHandle::from_lot();
        assert!(replay.load_bytes(&current));
        loaded.flush_commands();
        replay.flush_commands();
        let after = loaded.sim.save_snapshot_v5().sleeping_places.unwrap();
        assert_eq!(after.active_places, places.active_places);
        assert_eq!(
            after.assignments,
            if pending_clear {
                vec![(1, 19, 1)]
            } else {
                places.assignments.clone()
            }
        );
        for _ in 0..40 {
            loaded.tick();
            replay.tick();
            assert_eq!(loaded.sim.world_hash(), replay.sim.world_hash());
            assert_eq!(loaded.save_bytes(), replay.save_bytes());
        }
    }
}

#[test]
fn published_v5_instinct_and_chronotype_prefix_survives_privacy_extension() {
    let source = SimHandle::from_lot();
    let mut snapshot = source.sim.save_snapshot_v5();
    let person = snapshot.self_preservation[0].0;
    snapshot.self_preservation[0].1 = 73;
    snapshot.chronotype_offsets = vec![(person, -731)];
    // This explicit historical order is independent of the current envelope.
    let published = postcard::to_allocvec(&(
        &snapshot.world,
        &snapshot.layout,
        &snapshot.object_facings,
        &snapshot.retired_indices,
        &snapshot.object_colourways,
        &snapshot.floors,
        &snapshot.family_by_index,
        &snapshot.family,
        &snapshot.mortality,
        snapshot.death_default_applied,
        &snapshot.waiting_needs,
        &snapshot.self_preservation,
        &snapshot.chronotype_offsets,
    ))
    .unwrap();
    assert!(postcard::to_allocvec(&snapshot)
        .unwrap()
        .starts_with(&published));
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend_from_slice(&5u16.to_le_bytes());
    bytes.extend(published);
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    let restored = loaded.sim.save_snapshot_v5();
    assert_eq!(restored.self_preservation, snapshot.self_preservation);
    assert_eq!(restored.chronotype_offsets, snapshot.chronotype_offsets);
    assert!(restored.boundaries.is_empty());
    assert_current_resave_is_stable(&loaded);
}

#[test]
fn public_main_meal_preserves_personality_tail_and_migrates_recipe_counter() {
    // Written and validated by public main 6d2499d4, before domestic existed.
    let hex = include_str!("../tests/fixtures/public-main-meal.hex").trim();
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect();
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    let state = loaded.sim.save_snapshot_v5();
    assert_eq!(state.self_preservation, vec![(34, 0), (35, 93), (36, 47)]);
    assert_eq!(state.chronotype_offsets, vec![(34, -317), (35, 629)]);
    let cook = state
        .world
        .entities
        .iter()
        .find(|row| row.index == 34)
        .unwrap();
    assert_eq!(cook.chain.as_ref().unwrap().step, 5);
    assert_eq!(cook.step_work_ticks, Some(31));
    assert_eq!(
        postcard::to_allocvec(&state.world.rng).unwrap(),
        postcard::to_allocvec(&(12019770418448921669u64, 40521457u64)).unwrap()
    );
    assert!(state
        .domestic
        .as_ref()
        .is_none_or(|state| state.dishes.is_empty() && state.meals.is_empty()));
    assert_current_resave_is_stable(&loaded);
    let mut resumed = SimHandle::from_lot();
    assert!(resumed.load_bytes(&loaded.save_bytes()));
    for _ in 0..160 {
        loaded.tick();
        resumed.tick();
        assert_eq!(loaded.world_hash(), resumed.world_hash());
    }
}

#[test]
fn chronotype_v5_roundtrips_exact_signed_offsets_and_legacy_defaults() {
    let source = SimHandle::from_lot();
    let mut snapshot = source.sim.save_snapshot_v5();
    let people: Vec<_> = snapshot.self_preservation.iter().map(|row| row.0).collect();
    snapshot.chronotype_offsets = vec![(people[0], i32::MIN), (people[1], i32::MAX)];
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&v5_bytes(&snapshot)));
    assert_eq!(loaded.sim.save_snapshot_v5(), snapshot);
    assert_current_resave_is_stable(&loaded);

    let bytes = v5_bytes(&snapshot);
    let removed: usize = v5_appended_lengths(&snapshot)[7..].iter().sum();
    let prefix = &bytes[..bytes.len() - removed];
    assert!(loaded.load_bytes(prefix));
    assert!(loaded.sim.save_snapshot_v5().chronotype_offsets.is_empty());
    assert_eq!(loaded.sim.save_snapshot_v5().world, snapshot.world);
    assert_current_resave_is_stable(&loaded);
}

#[test]
fn chronotype_v5_rejects_invalid_complete_rows_without_changing_the_live_world() {
    let mut live = SimHandle::from_lot();
    let good = live.sim.save_snapshot_v5();
    let people: Vec<_> = good.self_preservation.iter().map(|row| row.0).collect();
    let object = good
        .world
        .entities
        .iter()
        .find(|row| !row.agent)
        .unwrap()
        .index;
    let before = live.save_bytes();
    let hash = live.sim.world_hash();
    for rows in [
        vec![(people[0], -731), (people[0], 180)],
        vec![(people[1], -731), (people[0], 180)],
        vec![(people[0], -731), (people[1], 0)],
        vec![(object, -731)],
        vec![(people[0], -731), (u32::MAX, 180)],
    ] {
        let mut invalid = good.clone();
        invalid.chronotype_offsets = rows;
        assert!(!live.load_bytes(&v5_bytes(&invalid)));
        assert_eq!(live.save_bytes(), before);
        assert_eq!(live.sim.world_hash(), hash);
    }
    let mut missing_personality = good.clone();
    missing_personality
        .world
        .entities
        .iter_mut()
        .find(|row| row.index == people[0])
        .unwrap()
        .personality = None;
    missing_personality.chronotype_offsets = vec![(people[0], -731)];
    assert!(!live.load_bytes(&v5_bytes(&missing_personality)));
    assert_eq!(live.save_bytes(), before);
    assert_eq!(live.sim.world_hash(), hash);
}

#[test]
fn chronotype_v5_rejects_every_partial_tail_and_noncanonical_length_atomically() {
    let source = SimHandle::from_lot();
    let mut snapshot = source.sim.save_snapshot_v5();
    let person = snapshot.self_preservation[0].0;
    let mut loaded = SimHandle::from_lot();
    let before = loaded.save_bytes();
    for rows in [
        vec![(person, -731)],
        vec![(person, i32::MIN)],
        vec![(person, 180); 128],
    ] {
        snapshot.chronotype_offsets = rows;
        let bytes = v5_bytes(&snapshot);
        let tail = postcard::to_allocvec(&snapshot.chronotype_offsets).unwrap();
        let removed: usize = v5_appended_lengths(&snapshot)[7..].iter().sum();
        let start = bytes.len() - removed;
        for cut in start + 1..start + tail.len() {
            assert!(
                decode_v5(&bytes[SAVE_HEADER_BYTES..cut]).is_none(),
                "decoder accepted partial tail at {cut}"
            );
            assert!(
                !loaded.load_bytes(&bytes[..cut]),
                "accepted partial tail at {cut}"
            );
            assert_eq!(loaded.save_bytes(), before);
        }
        let mut long_empty = bytes[..start].to_vec();
        long_empty.push(0x80);
        assert!(!loaded.load_bytes(&long_empty));
        assert_eq!(loaded.save_bytes(), before);
    }
}

/// V3 saves are still read, strictly: every truncation, trailing data, a V2
/// body and a V3 body labelled V4 are refused. The writer is V5 now, so the
/// V3 bytes here are built directly.
#[test]
fn v3_required_tail_rejects_every_truncation_trailing_data_and_a_v2_body() {
    let source = SimHandle::new(4, 4);
    let valid = v3_bytes(&source.sim.save_snapshot_v3());
    assert_eq!(&valid[8..10], &[3, 0]);
    assert_eq!(&valid[valid.len() - 3..], &[1, 0, 0]);
    let mut restored = SimHandle::from_lot();
    assert!(
        restored.load_bytes(&valid),
        "an empty required facing list is valid"
    );
    assert_eq!(v3_bytes(&restored.sim.save_snapshot_v3()), valid);
    let mut mislabeled = v2_bytes(&source.sim.save_snapshot_v2());
    mislabeled[8] = 3;
    let mut trailing = valid.clone();
    trailing.push(0);
    // A V3 body labelled V4 lacks the retired list V4 requires.
    let mut early = valid.clone();
    early[8] = 4;
    let mut future = valid.clone();
    future[8] = 5;
    let mut cases = vec![mislabeled, trailing, early, future];
    cases.extend((SAVE_HEADER_BYTES..valid.len()).map(|cut| valid[..cut].to_vec()));
    let mut with_facing = SimHandle::new(4, 4);
    assert!(with_facing.spawn_object(1.0, 1.0, "reading_chair"));
    let faced = v3_bytes(&with_facing.sim.save_snapshot_v3());
    cases.push(faced[..faced.len() - 1].to_vec());
    cases.push(faced[..faced.len() - 2].to_vec());
    for bytes in cases {
        let before = restored.save_bytes();
        assert!(
            !restored.load_bytes(&bytes),
            "accepted malformed V3 with {} bytes",
            bytes.len()
        );
        assert_eq!(restored.save_bytes(), before);
    }
}

#[test]
fn v3_rotated_geometry_and_ordered_pending_commands_survive_the_public_envelope() {
    let mut source = SimHandle::new(8, 8);
    let content = source.sim.world().resource::<Content>().0;
    let tub = source.sim.spawn_object(
        Position { x: 2.0, y: 2.0 },
        content.find("bathtub").unwrap(),
    );
    terri_sim::apply_object_placement(
        source.sim.world_mut(),
        tub,
        content.object(content.find("bathtub").unwrap()),
        Position { x: 2.0, y: 2.0 },
        Facing::SouthEast,
    );
    let queue = &mut source.sim.world_mut().resource_mut::<CommandQueue>();
    queue.push(SimCommand::SetSpeed(2));
    queue.push(SimCommand::PlaceObject {
        object: 0,
        x: 3,
        y: 4,
        facing: Facing::SouthWest,
    });
    queue.push(SimCommand::SetSpeed(1));
    let bytes = source.save_bytes();
    let decoded: SaveSnapshotV3 = postcard::from_bytes(&bytes[SAVE_HEADER_BYTES..]).unwrap();
    assert_eq!(decoded.object_facings, vec![(0, 0)]);
    assert_eq!(
        decoded.world.queued_commands,
        vec![
            SavedCommand::SetSpeed(2),
            SavedCommand::PlaceObject {
                object: 0,
                x: 3,
                y: 4,
                facing: Facing::SouthWest
            },
            SavedCommand::SetSpeed(1),
        ]
    );
    let mut loaded = SimHandle::new(1, 1);
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(loaded.object_facing(0.0), Some(0));
    assert_eq!(loaded.sim.save_snapshot_v3(), decoded);
    assert_eq!(loaded.save_bytes(), bytes);
    for _ in 0..20 {
        loaded.tick();
        source.tick();
        assert_eq!(loaded.world_hash(), source.world_hash());
    }
}

#[test]
fn v3_bad_facing_rows_and_layout_are_refused_before_live_replacement() {
    let source = SimHandle::from_lot();
    let valid = source.sim.save_snapshot_v3();
    let object = valid
        .world
        .entities
        .iter()
        .find(|e| e.smart_object.is_some())
        .unwrap()
        .index;
    let agent = valid.world.entities.iter().find(|e| e.agent).unwrap().index;
    let mut invalid = Vec::new();
    for rows in [
        vec![(object, 4)],
        vec![(object, 0); 2],
        vec![(agent, 0)],
        vec![(u32::MAX, 0)],
    ] {
        let mut saved = valid.clone();
        saved.object_facings = rows;
        invalid.push(saved);
    }
    let mut bad_layout = valid;
    bad_layout.layout = SavedLayout::LegacyCells {
        walls: vec![(u32::MAX, 0)],
    };
    invalid.push(bad_layout);
    let mut live = SimHandle::from_lot();
    live.tick();
    for snapshot in invalid {
        let before = live.save_bytes();
        assert!(!live.load_bytes(&v3_bytes(&snapshot)));
        assert_eq!(live.save_bytes(), before);
    }
}

/// [SL-save]: a V4 envelope ends with the retired list, and is read as
/// strictly as V3: every truncation and trailing data refused, the running
/// world untouched. The writer is V5 now, so the V4 bytes here are built
/// directly.
#[test]
fn v4_required_tail_rejects_every_truncation_and_trailing_data() {
    let mut source = SimHandle::new(4, 4);
    assert!(source.spawn_object(1.0, 1.0, "reading_chair"));
    let valid = v4_bytes(&source.sim.save_snapshot_v4());
    assert_eq!(&valid[8..10], &[4, 0]);
    assert_eq!(
        valid.last(),
        Some(&0),
        "no retired indices is one empty list"
    );
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&valid));
    assert_eq!(restored.save_bytes(), source.save_bytes());
    let mut trailing = valid.clone();
    trailing.push(0);
    let mut cases = vec![trailing];
    cases.extend((SAVE_HEADER_BYTES..valid.len()).map(|cut| valid[..cut].to_vec()));
    for bytes in cases {
        let before = restored.save_bytes();
        assert!(
            !restored.load_bytes(&bytes),
            "accepted malformed V4 with {} bytes",
            bytes.len()
        );
        assert_eq!(restored.save_bytes(), before);
    }
}

/// [RC-save]: the V5 colourway list is required. Later appended fields may
/// be wholly absent in historical saves; cuts inside records and trailing data are refused,
/// the running world untouched. A recoloured object survives the round trip.
#[test]
fn v5_required_tail_rejects_every_truncation_and_trailing_data() {
    let mut source = SimHandle::new(4, 4);
    assert!(source.spawn_object(1.0, 1.0, "reading_chair"));
    let plain = source.save_bytes();
    assert_eq!(&plain[8..10], &[5, 0]);
    assert_eq!(plain, v5_bytes(&source.sim.save_snapshot_v5()));
    assert_eq!(
        &plain[plain.len() - 5..],
        &[1, 0, 0, 0, 0],
        "current saves carry sleeping places, shyness and boundary decisions explicitly"
    );
    let chair = (0..16u32)
        .find(|&index| source.object_colourway(f64::from(index)) == 0)
        .unwrap();
    assert!(source.set_colourway(f64::from(chair), 3.0));
    source.sim.flush_commands();
    let valid = source.save_bytes();
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&valid));
    assert_eq!(restored.save_bytes(), valid);
    assert_eq!(restored.object_colourway(f64::from(chair)), 3);
    let mut trailing = valid.clone();
    trailing.push(0);
    let mut cases = vec![trailing];
    let lengths = v5_appended_lengths(&source.sim.save_snapshot_v5());
    let historical_cuts: Vec<usize> = (0..lengths.len())
        .map(|first| lengths[first..].iter().sum())
        .collect();
    // Only whole appended-field boundaries existed in older writers.
    cases.extend(
        (SAVE_HEADER_BYTES..valid.len())
            .filter(|cut| !historical_cuts.contains(&(valid.len() - cut)))
            .map(|cut| valid[..cut].to_vec()),
    );
    for bytes in cases {
        let before = restored.save_bytes();
        assert!(
            !restored.load_bytes(&bytes),
            "accepted malformed V5 with {} bytes",
            bytes.len()
        );
        assert_eq!(restored.save_bytes(), before);
    }
    // Review finding [F1] on PR 131: a save written before ties existed but
    // WITH floors the player painted. Cutting the two family bytes leaves
    // those floors, and they must survive rather than look invented.
    let mut painter = SimHandle::from_lot();
    assert!(painter.set_floor(2.0, 2.0, 1.0));
    painter.flush_commands();
    let painted = painter.save_bytes();
    let tail = v5_appended_lengths(&painter.sim.save_snapshot_v5())[1..]
        .iter()
        .sum::<usize>();
    let before_ties = painted[..painted.len() - tail].to_vec();
    let mut live = SimHandle::from_lot();
    assert!(
        live.load_bytes(&before_ties),
        "a painted house saved before ties existed must still load"
    );
    assert_eq!(live.floor_tiles(), vec![2, 2, 1], "and keep its floors");
    assert!(live.family_ties().is_empty());

    for (first, what) in [
        (10, "boundary decisions"),
        (9, "shyness"),
        (8, "sleeping places"),
        (7, "chronotypes"),
        (6, "instincts"),
        (5, "waiting"),
        (4, "death default migration"),
        (3, "mortality"),
        (2, "ties keyed on SimId"),
        (1, "family"),
        (0, "floors and family"),
    ] {
        let cut = lengths[first..].iter().sum::<usize>();
        let older = valid[..valid.len() - cut].to_vec();
        assert!(
            restored.load_bytes(&older),
            "a save written before {what} existed must still load"
        );
        assert_eq!(
            restored.save_bytes(),
            valid,
            "and it saves again with its own empty lists"
        );
    }
}

/// Two sims of the shipped lot, as entity indices, lowest first.
fn two_sims(handle: &mut SimHandle) -> (u32, u32) {
    let count = handle.entity_count();
    let kinds = unsafe { std::slice::from_raw_parts(handle.kinds_ptr(), count) };
    let ids = unsafe { std::slice::from_raw_parts(handle.ids_ptr(), count) };
    let mut sims: Vec<u32> = (0..count)
        .filter(|&row| kinds[row] == 0)
        .map(|row| ids[row])
        .collect();
    sims.sort_unstable();
    sims.dedup();
    (sims[0], sims[1])
}

/// [FM-identity]: a save written while ties were keyed on entity index
/// is a prefix of today's, missing the SimId list. It loads with the same
/// people related, now named by SimId, and saves again in today's form.
#[test]
fn a_save_that_keyed_ties_on_entity_indices_loads_them_as_sim_ids() {
    let mut handle = SimHandle::from_lot();
    let (first, second) = two_sims(&mut handle);
    assert!(handle.set_family_tie(f64::from(first), f64::from(second), 1.0));
    handle.flush_commands();

    let mut snapshot = handle.sim.save_snapshot_v5();
    let mut by_index = terri_core::layout::FamilyTies::default();
    assert!(by_index.set(first, second, Some(terri_core::layout::Relation::Parent)));
    snapshot.family_by_index = by_index;
    snapshot.family = terri_core::layout::FamilyTies::default();
    let written = v5_bytes(&snapshot);
    let tail = v5_appended_lengths(&snapshot)[2..].iter().sum::<usize>();
    let older = written[..written.len() - tail].to_vec();

    let mut restored = SimHandle::from_lot();
    assert!(
        restored.load_bytes(&older),
        "a save with ties keyed on entity index must still load"
    );
    assert_eq!(restored.family_ties(), handle.family_ties());
    assert!(restored
        .sim
        .save_snapshot_v5()
        .family_by_index
        .ties()
        .is_empty());
    assert_current_resave_is_stable(&restored);
}

/// [FM-identity]: no build writes ties in both lists, so a save that has
/// both is refused rather than one silently winning; and a tie naming a
/// SimId this world never issued cannot be true.
#[test]
fn a_save_whose_ties_cannot_be_true_is_refused() {
    let mut handle = SimHandle::from_lot();
    let (first, second) = two_sims(&mut handle);
    assert!(handle.set_family_tie(f64::from(first), f64::from(second), 3.0));
    handle.flush_commands();
    let base = handle.sim.save_snapshot_v5();
    assert!(!base.family.ties().is_empty());

    let mut both = base.clone();
    both.family_by_index = terri_core::layout::FamilyTies::default();
    assert!(both
        .family_by_index
        .set(first, second, Some(terri_core::layout::Relation::Sibling)));
    let mut restored = SimHandle::from_lot();
    let before = restored.save_bytes();
    assert!(!restored.load_bytes(&v5_bytes(&both)), "ties in both lists");
    assert_eq!(restored.save_bytes(), before);

    let issued = handle
        .sim
        .world()
        .resource::<terri_core::SimIdAllocator>()
        .issued();
    let mut unissued = base.clone();
    unissued.family = terri_core::layout::FamilyTies::default();
    assert!(unissued
        .family
        .set(0, issued, Some(terri_core::layout::Relation::Sibling)));
    assert!(
        !restored.load_bytes(&v5_bytes(&unissued)),
        "a SimId never issued"
    );

    // The last id issued is somebody, so it may be named.
    let mut last = base.clone();
    last.family = terri_core::layout::FamilyTies::default();
    assert!(last
        .family
        .set(0, issued - 1, Some(terri_core::layout::Relation::Sibling)));
    assert!(
        restored.load_bytes(&v5_bytes(&last)),
        "the last SimId issued"
    );

    // Review finding [F2] on PR 134: a SimId that was issued but that no
    // sim in the house holds now is still somebody, because a tie outlives
    // the person being here ([FM-identity]). Issuing more ids than there
    // are sims makes one.
    let mut absent = base;
    absent.world.issued_sim_ids = issued + 1;
    absent.family = terri_core::layout::FamilyTies::default();
    assert!(absent
        .family
        .set(0, issued, Some(terri_core::layout::Relation::Sibling)));
    assert!(
        restored.load_bytes(&v5_bytes(&absent)),
        "an issued SimId nobody holds"
    );
    assert_eq!(
        restored.family_ties(),
        vec![
            0,
            issued,
            u32::from(terri_core::layout::Relation::Sibling.code())
        ]
    );
}

/// [FM-identity] and review finding [F1] on PR 131: padding restores
/// only lists that are missing whole. A cut inside the last tie of an older
/// save leaves its relation byte to the padding, which would read as a
/// partner nobody chose; a cut inside the last painted tile would read as a
/// covering nobody laid. Both are refused by the decoder itself.
#[test]
fn a_cut_inside_the_last_tie_or_tile_is_not_padded_into_one() {
    let mut handle = SimHandle::from_lot();
    let (first, second) = two_sims(&mut handle);
    let mut snapshot = handle.sim.save_snapshot_v5();
    let mut by_index = terri_core::layout::FamilyTies::default();
    assert!(by_index.set(first, second, Some(terri_core::layout::Relation::Sibling)));
    snapshot.family_by_index = by_index;
    let written = v5_bytes(&snapshot);
    // Drop the SimId list and the tie's relation byte.
    let tail = v5_appended_lengths(&snapshot)[2..].iter().sum::<usize>();
    let cut = &written[..written.len() - tail - 1];
    assert!(decode_v5(&cut[SAVE_HEADER_BYTES..]).is_none());
    let mut restored = SimHandle::from_lot();
    assert!(!restored.load_bytes(cut), "a relation nobody chose");

    let mut painter = SimHandle::from_lot();
    assert!(painter.set_floor(2.0, 2.0, 1.0));
    painter.flush_commands();
    let painted = painter.save_bytes();
    // Drop both family lists and the tile's covering byte.
    let tail = v5_appended_lengths(&painter.sim.save_snapshot_v5())[1..]
        .iter()
        .sum::<usize>();
    let cut = &painted[..painted.len() - tail - 1];
    assert!(
        decode_v5(&cut[SAVE_HEADER_BYTES..]).is_none(),
        "a covering nobody laid"
    );
}

/// Review finding [F1] on PR 134: postcard reads a length written in two
/// bytes where one would do, so a save of exactly 128 painted tiles cut
/// just after the first byte of that length would pad into an empty floors
/// list and load with every floor gone. A padded payload has to be what its
/// snapshot re-encodes to, and that one is not.
#[test]
fn a_cut_inside_a_two_byte_length_is_not_padded_into_an_empty_list() {
    let handle = SimHandle::from_lot();
    let mut snapshot = handle.sim.save_snapshot_v5();
    let tiles: Vec<(u32, u32, u8)> = (0..128u32).map(|i| (i / 16, i % 16, 1)).collect();
    snapshot.floors = terri_core::layout::SavedFloors::from_saved(tiles, 16, 16, 1)
        .expect("128 tiles on a 16 by 16 grid");
    let payload = postcard::to_allocvec(&snapshot).unwrap();
    assert!(decode_v5(&payload).is_some(), "the whole save decodes");
    let floors = postcard::to_allocvec(&snapshot.floors).unwrap();
    assert_eq!(floors[..2], [0x80, 0x01], "128 is a two-byte length");
    // The floors list precedes the two family lists and seven tail bytes. Their
    // sizes come from the snapshot, so the cut stays inside the floors
    // length whatever family the lot ships with (review finding [H1]).
    let family_bytes = postcard::to_allocvec(&snapshot.family).unwrap().len()
        + postcard::to_allocvec(&snapshot.family_by_index)
            .unwrap()
            .len();
    let suffix = v5_appended_lengths(&snapshot)[3..].iter().sum::<usize>();
    let floors_start = payload.len() - family_bytes - floors.len() - suffix;
    let cut = &payload[..=floors_start];
    assert!(decode_v5(cut).is_none(), "cut inside the floors length");

    // Review finding [G1] on PR 134: the same cut inside either family
    // list's length, which one and two pads would otherwise complete.
    let ties: Vec<(u32, u32, u8)> = (0..128u32).map(|i| (0, i + 1, 0)).collect();
    let many =
        terri_core::layout::FamilyTies::from_saved(ties, &|_| true).expect("128 well-formed ties");
    let length = postcard::to_allocvec(&many).unwrap();
    assert_eq!(length[..2], [0x80, 0x01], "128 is a two-byte length");

    let mut by_sim = handle.sim.save_snapshot_v5();
    by_sim.family = many.clone();
    let payload = postcard::to_allocvec(&by_sim).unwrap();
    assert!(decode_v5(&payload).is_some(), "the whole save decodes");
    let suffix = v5_appended_lengths(&by_sim)[3..].iter().sum::<usize>();
    let start = payload.len() - length.len() - suffix;
    assert!(
        decode_v5(&payload[..=start]).is_none(),
        "cut inside the SimId list's length"
    );

    let mut by_index = handle.sim.save_snapshot_v5();
    by_index.family_by_index = many;
    let payload = postcard::to_allocvec(&by_index).unwrap();
    assert!(decode_v5(&payload).is_some(), "the whole save decodes");
    let after = postcard::to_allocvec(&by_index.family).unwrap().len();
    let suffix = v5_appended_lengths(&by_index)[3..].iter().sum::<usize>();
    let start = payload.len() - after - length.len() - suffix;
    assert!(
        decode_v5(&payload[..=start]).is_none(),
        "cut inside the entity-index list's length"
    );
}

#[test]
fn pre_mortality_save_preserves_nonempty_floors_and_family() {
    let mut handle = SimHandle::from_lot();
    let (first, second) = two_sims(&mut handle);
    assert!(handle.set_floor(2.0, 2.0, 1.0));
    assert!(handle.set_family_tie(first.into(), second.into(), 1.0));
    handle.flush_commands();
    let bytes = handle.save_bytes();
    let tail = v5_appended_lengths(&handle.sim.save_snapshot_v5())[3..]
        .iter()
        .sum::<usize>();
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&bytes[..bytes.len() - tail]));
    assert_eq!(restored.floor_tiles(), vec![2, 2, 1]);
    assert_eq!(restored.family_ties(), handle.family_ties());
    assert!(restored.death_enabled());
    assert_current_resave_is_stable(&restored);
}

#[test]
fn mortality_length_truncation_cannot_invent_an_empty_count_list() {
    let handle = SimHandle::from_lot();
    let mut snapshot = handle.sim.save_snapshot_v5();
    snapshot.mortality = Some(terri_core::save::SavedMortality {
        enabled: true,
        counts: (0..128).map(|i| (i, 1)).collect(),
        deaths: vec![],
    });
    let tail = postcard::to_allocvec(&snapshot.mortality).unwrap();
    assert_eq!(&tail[..4], &[1, 1, 128, 1]);
    let bytes = postcard::to_allocvec(&snapshot).unwrap();
    let suffix = v5_appended_lengths(&snapshot)[4..].iter().sum::<usize>();
    let start = bytes.len() - tail.len() - suffix;
    assert!(decode_v5(&bytes[..start + 3]).is_none());
    for cut in start + 1..start + tail.len() {
        assert!(
            decode_v5(&bytes[..cut]).is_none(),
            "accepted mortality cut {cut}"
        );
    }
}

#[test]
fn waiting_length_truncation_cannot_invent_an_empty_list() {
    let mut snapshot = SimHandle::from_lot().sim.save_snapshot_v5();
    snapshot.waiting_needs = (0..128).map(|i| (i, 129, 1)).collect();
    let tail = postcard::to_allocvec(&snapshot.waiting_needs).unwrap();
    assert_eq!(&tail[..2], &[128, 1]);
    let bytes = postcard::to_allocvec(&snapshot).unwrap();
    let suffix = v5_appended_lengths(&snapshot)[6..].iter().sum::<usize>();
    let start = bytes.len() - tail.len() - suffix;
    for cut in start + 1..start + tail.len() {
        assert!(
            decode_v5(&bytes[..cut]).is_none(),
            "accepted waiting cut {cut}"
        );
    }
}

#[test]
fn pre_default_change_preserves_nonempty_mortality_and_enables_death() {
    let mut source = SimHandle::from_lot();
    let (first, second) = two_sims(&mut source);
    assert!(source.set_floor(2.0, 2.0, 1.0));
    assert!(source.set_family_tie(first.into(), second.into(), 1.0));
    source.flush_commands();
    let mut snapshot = source.sim.save_snapshot_v5();
    snapshot.mortality = Some(terri_core::save::SavedMortality {
        enabled: false,
        counts: vec![(first, 1)],
        deaths: vec![],
    });
    let bytes = v5_bytes(&snapshot);
    let mut loaded = SimHandle::from_lot();
    let suffix = v5_appended_lengths(&snapshot)[4..].iter().sum::<usize>();
    assert!(loaded.load_bytes(&bytes[..bytes.len() - suffix]));
    assert!(loaded.death_enabled());
    assert_eq!(loaded.sim.deprivation_ticks(first), 1);
    assert_eq!(loaded.family_ties(), source.family_ties());
    assert_eq!(loaded.floor_tiles(), source.floor_tiles());
}

#[test]
fn shyness_length_and_record_truncations_cannot_invent_stats() {
    let mut snapshot = SimHandle::from_lot().sim.save_snapshot_v5();
    snapshot.shyness = (0..128).map(|id| (id, 100)).collect();
    let tail = postcard::to_allocvec(&snapshot.shyness).unwrap();
    assert_eq!(&tail[..2], &[128, 1]);
    let bytes = postcard::to_allocvec(&snapshot).unwrap();
    let start = bytes.len() - tail.len() - 1;
    for cut in start + 1..bytes.len() - 1 {
        assert!(
            decode_v5(&bytes[..cut]).is_none(),
            "accepted shyness cut {cut}"
        );
    }
}

#[test]
fn boundary_length_and_record_truncations_cannot_invent_decisions() {
    let mut snapshot = SimHandle::from_lot().sim.save_snapshot_v5();
    snapshot.boundaries = (0..128)
        .map(|actor| terri_core::save::SavedBoundaryDecision {
            actor,
            expires: 30,
            lapse: true,
            waiting_since: Some(0),
            goal: Some((2, 0)),
            directed_chain: Some(0),
        })
        .collect();
    let tail = postcard::to_allocvec(&snapshot.boundaries).unwrap();
    let bytes = postcard::to_allocvec(&snapshot).unwrap();
    let start = bytes.len() - tail.len();
    for cut in start + 1..bytes.len() {
        assert!(
            decode_v5(&bytes[..cut]).is_none(),
            "accepted boundary cut {cut}"
        );
    }
    let legacy = decode_v5(&bytes[..start]).unwrap();
    assert!(legacy.boundaries.is_empty());
}

#[test]
fn real_pre_meal_bytes_preserve_in_flight_snack_and_map_the_old_dinner_counter() {
    for (hex, dinner) in [
        (include_str!("../tests/fixtures/pre-meals-snack.hex"), false),
        (include_str!("../tests/fixtures/pre-meals-dinner.hex"), true),
    ] {
        let bytes: Vec<_> = hex
            .trim()
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        let source = decode_v5(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert_eq!(source.world.content_fingerprint, 0xc2cf_2919_84ed_61f7);
        let mut handle = SimHandle::from_lot();
        assert!(handle.load_bytes(&bytes), "actual old program bytes load");
        let current = handle.sim.save_snapshot_v5();
        assert_eq!(current.world.tick, source.world.tick);
        let active = source
            .world
            .entities
            .iter()
            .find(|entity| {
                if dinner {
                    entity.chain.is_some()
                } else {
                    entity.eating.is_some()
                }
            })
            .unwrap();
        let mapped = current
            .world
            .entities
            .iter()
            .find(|entity| entity.index == active.index)
            .unwrap();
        assert_eq!(mapped.needs, active.needs);
        assert_eq!(mapped.step_work_ticks, active.step_work_ticks);
        assert_eq!(mapped.eating, active.eating);
        if dinner {
            assert_eq!(mapped.chain.as_ref().unwrap().step, 5);
        }
        let saved = handle.save_bytes();
        let mut replay = SimHandle::from_lot();
        assert!(replay.load_bytes(&saved));
        assert_eq!(handle.sim.world_hash(), replay.sim.world_hash());
    }
}

#[test]
fn published_domestic_prefix_preserves_nonempty_state_and_current_recipe_step() {
    let mut source = SimHandle::from_lot();
    let mut snapshot = source.sim.save_snapshot_v5();
    let counter = snapshot
        .world
        .entities
        .iter()
        .find(|row| row.smart_object.as_deref() == Some("counter"))
        .unwrap()
        .index;
    let actor = snapshot
        .world
        .entities
        .iter()
        .find(|row| row.agent)
        .unwrap()
        .index;
    snapshot.domestic = Some(terri_core::save::SavedDomestic {
        cleanliness: vec![(actor, 0.73)],
        dishes: vec![terri_core::save::SavedDishes {
            id: 0,
            surface: counter,
            owner: 0,
            units: 2,
        }],
        next_dish: 1,
        ..Default::default()
    });
    source.sim.load_snapshot_v5(snapshot).unwrap();
    let fridge = source
        .sim
        .save_snapshot()
        .entities
        .iter()
        .find(|row| row.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    let cook_row = source
        .sim
        .world()
        .resource::<terri_sim::Content>()
        .0
        .objects
        .iter()
        .find(|object| object.id == "fridge")
        .unwrap()
        .interactions
        .len() as u32;
    source
        .sim
        .world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(terri_core::SimCommand::UseObjectFirst {
            agent: actor,
            object: fridge,
            interaction: cook_row,
        });
    for _ in 0..2000 {
        source.tick();
        if source
            .sim
            .save_snapshot()
            .entities
            .iter()
            .find(|row| row.index == actor)
            .unwrap()
            .chain
            .as_ref()
            .is_some_and(|chain| chain.chain == "cook_dinner" && chain.step == 3)
        {
            break;
        }
    }
    let mut snapshot = source.sim.save_snapshot_v5();
    assert_eq!(
        snapshot
            .world
            .entities
            .iter()
            .find(|row| row.index == actor)
            .unwrap()
            .chain
            .as_ref()
            .unwrap()
            .step,
        3
    );
    assert!(!snapshot.domestic.as_ref().unwrap().cleanliness.is_empty());
    snapshot.world.content_fingerprint = 0x85a2_d140_0dff_9da1;
    let payload = postcard::to_allocvec(&(
        &snapshot.world,
        &snapshot.layout,
        &snapshot.object_facings,
        &snapshot.retired_indices,
        &snapshot.object_colourways,
        &snapshot.floors,
        &snapshot.family_by_index,
        &snapshot.family,
        &snapshot.mortality,
        snapshot.death_default_applied,
        &snapshot.waiting_needs,
        &snapshot.self_preservation,
        &snapshot.chronotype_offsets,
        &snapshot.domestic,
    ))
    .unwrap();
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(5u16.to_le_bytes());
    bytes.extend(&payload);
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    let actual = loaded.sim.save_snapshot_v5();
    assert_eq!(actual.domestic, snapshot.domestic);
    assert_eq!(actual.world.entities, snapshot.world.entities);
    assert_current_resave_is_stable(&loaded);
    // Every interior cut of the public domestic group must fail transactionally.
    let tail = postcard::to_allocvec(&snapshot.domestic).unwrap();
    let start = bytes.len() - tail.len();
    let before = loaded.save_bytes();
    let hash = loaded.world_hash();
    for cut in start + 1..bytes.len() {
        assert!(
            !loaded.load_bytes(&bytes[..cut]),
            "domestic interior cut {cut}"
        );
        assert_eq!(loaded.save_bytes(), before);
        assert_eq!(loaded.world_hash(), hash);
    }
}

#[test]
fn optional_group_multibyte_cuts_and_frozen_bed_none_fail_closed() {
    let mut snapshot = SimHandle::from_lot().sim.save_snapshot_v5();
    snapshot.domestic = Some(terri_core::save::SavedDomestic {
        cleanliness: vec![(300, 0.73); 128],
        ..Default::default()
    });
    let bytes = postcard::to_allocvec(&snapshot).unwrap();
    let lengths = v5_appended_lengths(&snapshot);
    let end = bytes.len() - lengths[9..].iter().sum::<usize>();
    let start = end - lengths[8];
    for cut in start + 1..end {
        assert!(decode_v5(&bytes[..cut]).is_none(), "domestic cut {cut}");
    }
    snapshot.domestic = None;
    snapshot.world.content_fingerprint = LOCAL_BED_FINGERPRINT;
    for places in [
        None,
        Some(terri_core::save::SavedSleepingPlaces {
            active_places: vec![(300, 1); 128],
            assignments: vec![(3, 129, 1); 128],
        }),
    ] {
        snapshot.sleeping_places = places;
        let mut bytes = postcard::to_allocvec(&snapshot).unwrap();
        let lengths = v5_appended_lengths(&snapshot);
        let domestic = bytes.len() - lengths[8..].iter().sum::<usize>();
        assert_eq!(bytes.remove(domestic), 0); // Frozen local layout lacks this public field.
        if snapshot.sleeping_places.is_none() {
            for absent in 0..=2 {
                assert!(decode_v5(&bytes[..bytes.len() - absent]).is_none());
            }
        } else {
            assert!(decode_v5(&bytes).is_some());
            let end = bytes.len() - 2;
            for cut in domestic + 1..end {
                assert!(decode_v5(&bytes[..cut]).is_none(), "local bed cut {cut}");
            }
            let (_, rest) = postcard::take_from_bytes::<u64>(&bytes).unwrap();
            let mut unknown = postcard::to_allocvec(&0x1234u64).unwrap();
            unknown.extend(rest);
            assert!(decode_local_bed_v5(&unknown).is_none());
            let mut live = SimHandle::from_lot();
            let before = live.save_bytes();
            let mut envelope = SAVE_MAGIC.to_vec();
            envelope.extend(5u16.to_le_bytes());
            envelope.extend(unknown);
            assert!(!live.load_bytes(&envelope));
            assert_eq!(live.save_bytes(), before);
        }
    }
}
