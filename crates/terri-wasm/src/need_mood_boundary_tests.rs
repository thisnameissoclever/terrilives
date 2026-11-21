use super::*;
use terri_core::{save_v17::SavedOrderActor, save_v26::SavedNeedMood};
use terri_sim::need_mood::{NeedMood, MAX_UNITS};

fn set_balance(handle: &mut SimHandle, id: u32, units: i32) -> u32 {
    let actor = terri_sim::edit::living_entity(handle.sim.world(), id).unwrap();
    handle
        .sim
        .world_mut()
        .entity_mut(actor)
        .insert(NeedMood(units));
    actor.index_u32()
}

#[test]
fn saved_need_mood_resumes_exactly_and_v23_starts_at_zero() {
    let mut uninterrupted = SimHandle::from_lot();
    set_balance(&mut uninterrupted, 0, -17_381);
    set_balance(&mut uninterrupted, 1, 42_518);
    let current = uninterrupted.save_bytes();
    let snapshot = decode_current(&current);
    assert_eq!(snapshot.need_mood[0].units, -17_381);
    assert_eq!(snapshot.need_mood[1].units, 42_518);

    let mut resumed = SimHandle::from_lot();
    assert!(resumed.load_bytes(&current));
    assert_eq!(resumed.save_bytes(), current);
    assert_eq!(resumed.world_hash(), uninterrupted.world_hash());
    for _ in 0..120 {
        uninterrupted.tick();
        resumed.tick();
        assert_eq!(resumed.world_hash(), uninterrupted.world_hash());
    }
    assert_eq!(resumed.save_bytes(), uninterrupted.save_bytes());

    let mut historical = SAVE_MAGIC.to_vec();
    historical.extend(23u16.to_le_bytes());
    historical.extend(postcard::to_allocvec(&snapshot.legacy).unwrap());
    assert!(resumed.load_bytes(&historical));
    let migrated = decode_current(&resumed.save_bytes());
    assert!(migrated.need_mood.is_empty());
    assert_eq!(migrated.legacy, snapshot.legacy);
}

#[test]
fn malformed_need_mood_rows_leave_the_loaded_world_unchanged() {
    let mut live = SimHandle::from_lot();
    let named_index = set_balance(&mut live, 0, 1);
    set_balance(&mut live, 1, -1);
    let original = live.save_bytes();
    let digest = live.world_hash();
    let saved = decode_current(&original);
    let first = saved.need_mood[0];
    let second = saved.need_mood[1];
    let bad_cases = [
        vec![SavedNeedMood { units: 0, ..first }],
        vec![SavedNeedMood {
            units: -MAX_UNITS - 1,
            ..first
        }],
        vec![SavedNeedMood {
            units: MAX_UNITS + 1,
            ..first
        }],
        vec![SavedNeedMood {
            actor: SavedOrderActor::Sim(u32::MAX),
            ..first
        }],
        vec![SavedNeedMood {
            actor: SavedOrderActor::Entity(named_index),
            ..first
        }],
        vec![first, first],
        vec![second, first],
    ];
    for rows in bad_cases {
        let mut bad = saved.clone();
        bad.need_mood = rows;
        let mut bytes = SAVE_MAGIC.to_vec();
        bytes.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
        bytes.extend(postcard::to_allocvec(&bad).unwrap());
        assert!(!live.load_bytes(&bytes), "{:?}", bad.need_mood);
        assert_eq!(live.save_bytes(), original);
        assert_eq!(live.world_hash(), digest);
    }
}

#[test]
fn reserved_save_versions_leave_the_live_world_unchanged() {
    let mut live = SimHandle::from_lot();
    set_balance(&mut live, 0, 1_417);
    let original = live.save_bytes();
    let digest = live.world_hash();
    for version in [24u16, 25] {
        let mut bytes = original.clone();
        bytes[8..10].copy_from_slice(&version.to_le_bytes());
        assert!(!live.load_bytes(&bytes), "schema {version}");
        assert_eq!(live.save_bytes(), original);
        assert_eq!(live.world_hash(), digest);
    }
}
