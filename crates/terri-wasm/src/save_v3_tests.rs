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
    // Three truncations are not malformed and must load: cutting the final
    // one, two or three bytes takes off the empty family lists and the
    // floors, which makes the payload byte for byte a save written before
    // those lists existed ([FL-save], [FM-save], [FM-identity]). That is
    // the price of growing a postcard struct by appending, and it is the
    // price the sleep-pressure list already pays.
    cases.extend((SAVE_HEADER_BYTES..valid.len() - 3).map(|cut| valid[..cut].to_vec()));
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
    let before_ties = painted[..painted.len() - 2].to_vec();
    let mut live = SimHandle::from_lot();
    assert!(
        live.load_bytes(&before_ties),
        "a painted house saved before ties existed must still load"
    );
    assert_eq!(live.floor_tiles(), vec![2, 2, 1], "and keep its floors");
    assert!(live.family_ties().is_empty());

    for (cut, what) in [
        (1, "ties keyed on SimId"),
        (2, "family"),
        (3, "floors and family"),
    ] {
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
    handle.tick();
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
    let today = handle.save_bytes();

    let mut snapshot = handle.sim.save_snapshot_v5();
    let mut by_index = terri_core::layout::FamilyTies::default();
    assert!(by_index.set(first, second, Some(terri_core::layout::Relation::Parent)));
    snapshot.family_by_index = by_index;
    snapshot.family = terri_core::layout::FamilyTies::default();
    let written = v5_bytes(&snapshot);
    // The last byte is the empty SimId list, which that build did not write.
    let older = written[..written.len() - 1].to_vec();

    let mut restored = SimHandle::from_lot();
    assert!(
        restored.load_bytes(&older),
        "a save with ties keyed on entity index must still load"
    );
    assert_eq!(restored.family_ties(), handle.family_ties());
    assert_eq!(restored.save_bytes(), today, "and it saves in today's form");
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
    let cut = &written[..written.len() - 2];
    assert!(decode_v5(&cut[SAVE_HEADER_BYTES..]).is_none());
    let mut restored = SimHandle::from_lot();
    assert!(!restored.load_bytes(cut), "a relation nobody chose");

    let mut painter = SimHandle::from_lot();
    assert!(painter.set_floor(2.0, 2.0, 1.0));
    painter.flush_commands();
    let painted = painter.save_bytes();
    // Drop both family lists and the tile's covering byte.
    let cut = &painted[..painted.len() - 3];
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
    // The floors list, then the two family lists, end the payload. Their
    // sizes come from the snapshot, so the cut stays inside the floors
    // length whatever family the lot ships with (review finding [H1]).
    let family_bytes = postcard::to_allocvec(&snapshot.family).unwrap().len()
        + postcard::to_allocvec(&snapshot.family_by_index)
            .unwrap()
            .len();
    let floors_start = payload.len() - family_bytes - floors.len();
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
    let start = payload.len() - length.len();
    assert!(
        decode_v5(&payload[..=start]).is_none(),
        "cut inside the SimId list's length"
    );

    let mut by_index = handle.sim.save_snapshot_v5();
    by_index.family_by_index = many;
    let payload = postcard::to_allocvec(&by_index).unwrap();
    assert!(decode_v5(&payload).is_some(), "the whole save decodes");
    let after = postcard::to_allocvec(&by_index.family).unwrap().len();
    let start = payload.len() - after - length.len();
    assert!(
        decode_v5(&payload[..=start]).is_none(),
        "cut inside the entity-index list's length"
    );
}
