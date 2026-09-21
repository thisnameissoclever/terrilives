use super::*;
use terri_core::{layout::SavedLayout, Facing, SaveSnapshotV2, SaveSnapshotV3, SavedCommand};

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

#[test]
fn v3_required_tail_rejects_every_truncation_trailing_data_and_a_v2_body() {
    let source = SimHandle::new(4, 4);
    let valid = source.save_bytes();
    assert_eq!(&valid[8..10], &[3, 0]);
    assert_eq!(&valid[valid.len() - 3..], &[1, 0, 0]);
    let mut restored = SimHandle::from_lot();
    assert!(
        restored.load_bytes(&valid),
        "an empty required facing list is valid"
    );
    assert_eq!(restored.save_bytes(), valid);
    let mut mislabeled = v2_bytes(&source.sim.save_snapshot_v2());
    mislabeled[8] = 3;
    let mut trailing = valid.clone();
    trailing.push(0);
    let mut future = valid.clone();
    future[8] = 4;
    let mut cases = vec![mislabeled, trailing, future];
    cases.extend((SAVE_HEADER_BYTES..valid.len()).map(|cut| valid[..cut].to_vec()));
    let mut with_facing = SimHandle::new(4, 4);
    assert!(with_facing.spawn_object(1.0, 1.0, "reading_chair"));
    let faced = with_facing.save_bytes();
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
