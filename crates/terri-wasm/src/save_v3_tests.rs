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

/// V3 saves are still read, strictly: every truncation, trailing data, a V2
/// body and a V3 body labelled V4 are refused. The writer is V4 now, so the
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

/// [RC-save]: the public writer's V5 envelope ends with the colourway list,
/// and is read as strictly as V4: every truncation and trailing data refused,
/// the running world untouched. A recoloured object survives the round trip.
#[test]
fn v5_required_tail_rejects_every_truncation_and_trailing_data() {
    let mut source = SimHandle::new(4, 4);
    assert!(source.spawn_object(1.0, 1.0, "reading_chair"));
    let plain = source.save_bytes();
    assert_eq!(&plain[8..10], &[5, 0]);
    assert_eq!(plain, v5_bytes(&source.sim.save_snapshot_v5()));
    assert_eq!(plain.last(), Some(&0), "no colourways is one empty list");
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
    // Two truncations are not malformed and must load: cutting the final one
    // or two bytes takes off the empty family and floors lists, which makes
    // the payload byte for byte a save written before those lists existed
    // ([FL-save], [FM-save]). That is the price of growing a postcard struct
    // by appending, and it is the price the sleep-pressure list already pays.
    cases.extend((SAVE_HEADER_BYTES..valid.len() - 2).map(|cut| valid[..cut].to_vec()));
    for bytes in cases {
        let before = restored.save_bytes();
        assert!(
            !restored.load_bytes(&bytes),
            "accepted malformed V5 with {} bytes",
            bytes.len()
        );
        assert_eq!(restored.save_bytes(), before);
    }
    for (cut, what) in [(1, "family"), (2, "floors and family")] {
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
