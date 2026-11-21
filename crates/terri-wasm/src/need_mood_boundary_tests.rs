use super::*;
use terri_core::{save_v17::SavedOrderActor, save_v27::SavedNeedMood};
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
    historical.extend(postcard::to_allocvec(&snapshot.legacy.legacy).unwrap());
    assert!(resumed.load_bytes(&historical));
    let migrated = decode_current(&resumed.save_bytes());
    assert!(migrated.need_mood.is_empty());
    assert_eq!(migrated.legacy.legacy, snapshot.legacy.legacy);
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
fn published_career_v24_saves_keep_the_whole_payload_and_start_need_mood_at_zero() {
    let day_two = include_bytes!("../tests/fixtures/published-v24/day-two.sav").as_slice();
    let week_two = include_bytes!("../tests/fixtures/published-v24/week-two.sav").as_slice();
    for (original, expects_career_inputs) in [(day_two, false), (week_two, true)] {
        assert_eq!(&original[..SAVE_MAGIC.len()], &SAVE_MAGIC);
        assert_eq!(&original[8..10], &24u16.to_le_bytes());
        let payload = &original[SAVE_HEADER_BYTES..];
        assert!(matches!(
            postcard::take_from_bytes::<u64>(payload),
            Ok((0x5111_16ef_ac94_ae24, _))
        ));
        let (career, tail) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV24>(payload).unwrap();
        assert!(tail.is_empty());
        if expects_career_inputs {
            assert!(!career.career_inputs.is_empty());
        }
        let mut migrated = SimHandle::from_lot();
        set_balance(&mut migrated, 0, -8_700);
        assert!(migrated.load_bytes(original));
        let current = migrated.save_bytes();
        let snapshot = decode_current(&current);
        assert_eq!(snapshot.legacy, career);
        assert!(snapshot.need_mood.is_empty());

        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&current));
        assert_eq!(resumed.save_bytes(), current);
        for _ in 0..12 {
            migrated.tick();
            resumed.tick();
            assert_eq!(resumed.world_hash(), migrated.world_hash());
        }
        assert_eq!(resumed.save_bytes(), migrated.save_bytes());
    }
}

#[test]
fn reserved_save_versions_leave_the_live_world_unchanged() {
    let mut live = SimHandle::from_lot();
    set_balance(&mut live, 0, 1_417);
    let original = live.save_bytes();
    let digest = live.world_hash();
    for version in [24u16, 25, 26] {
        let mut bytes = original.clone();
        bytes[8..10].copy_from_slice(&version.to_le_bytes());
        if version == 24 {
            let prefix = postcard::to_allocvec(&0x7229_9218_57a2_e3ae_u64).unwrap();
            bytes[SAVE_HEADER_BYTES..][..prefix.len()].copy_from_slice(&prefix);
        }
        assert!(!live.load_bytes(&bytes), "schema {version}");
        assert_eq!(live.save_bytes(), original);
        assert_eq!(live.world_hash(), digest);
    }
}
