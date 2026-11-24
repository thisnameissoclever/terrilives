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

    let historical = include_bytes!("../tests/fixtures/published-v23/day-two.sav");
    assert!(resumed.load_bytes(historical));
    let migrated = decode_current(&resumed.save_bytes());
    assert!(migrated.need_mood.is_empty());
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
        assert_eq!(snapshot.previous.career_inputs, career.career_inputs);
        assert_eq!(snapshot.previous.queued_work_commands, career.queued_work_commands);
        assert_eq!(snapshot.previous.replaced_shifts, career.replaced_shifts);
        assert_eq!(snapshot.previous.legacy.presence_fade, career.legacy.presence_fade);
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
fn wrong_save_envelopes_leave_the_live_world_unchanged() {
    let mut live = SimHandle::from_lot();
    set_balance(&mut live, 0, 1_417);
    let original = live.save_bytes();
    let digest = live.world_hash();
    for version in [24u16, 25, 26, 27] {
        let mut bytes = original.clone();
        bytes[8..10].copy_from_slice(&version.to_le_bytes());
        if version == 24 {
            let (_, tail) = postcard::take_from_bytes::<u64>(&original[SAVE_HEADER_BYTES..]).unwrap();
            let end = original.len() - tail.len();
            let private_digest = postcard::to_allocvec(&0x7229_9218_57a2_e3ae_u64).unwrap();
            bytes.splice(SAVE_HEADER_BYTES..end, private_digest);
        }
        assert!(!live.load_bytes(&bytes), "schema {version}");
        assert_eq!(live.save_bytes(), original);
        assert_eq!(live.world_hash(), digest);
    }
}

#[test]
fn v28_preserves_the_private_editable_payload_and_admits_published_v27() {
    use terri_core::{SaveSnapshotV26, SaveSnapshotV27};

    let mut live = SimHandle::from_lot();
    assert!(live.load_bytes(include_bytes!("../tests/fixtures/private-editable/bath-v25.sav")));
    set_balance(&mut live, 0, 1_417);
    let current = live.save_bytes();
    let snapshot = decode_current(&current);
    assert_eq!(snapshot.baths.len(), 1);
    let (editable, tail) = postcard::take_from_bytes::<SaveSnapshotV26>(
        &current[SAVE_HEADER_BYTES..],
    )
    .unwrap();
    assert_eq!(editable, snapshot.editable);
    assert_eq!(tail, postcard::to_allocvec(&snapshot.need_mood).unwrap());

    use terri_core::admin::{AdminChange, AdminEdit};
    live.sim.begin_admin().unwrap();
    assert_eq!(
        live.sim.admin_apply(AdminChange {
            edits: vec![AdminEdit::AdjustFunds { cents: 500 }],
        }),
        Ok(1)
    );
    live.sim.admin_undo().unwrap();
    assert_eq!(live.save_bytes(), current);
    live.sim.end_admin();

    let mut private = SAVE_MAGIC.to_vec();
    private.extend(26u16.to_le_bytes());
    private.extend(postcard::to_allocvec(&editable).unwrap());
    assert!(live.load_bytes(&private));
    let migrated = decode_current(&live.save_bytes());
    assert_eq!(migrated.editable, editable);
    assert!(migrated.need_mood.is_empty());

    let published_career = include_bytes!("../tests/fixtures/published-v24/day-two.sav");
    let (legacy, trailing) = postcard::take_from_bytes(&published_career[SAVE_HEADER_BYTES..])
        .unwrap();
    assert!(trailing.is_empty());
    let published = SaveSnapshotV27 {
        legacy,
        need_mood: snapshot.need_mood,
    };
    let mut bytes = SAVE_MAGIC.to_vec();
    bytes.extend(27u16.to_le_bytes());
    bytes.extend(postcard::to_allocvec(&published).unwrap());
    assert!(live.load_bytes(&bytes));
    let migrated = decode_current(&live.save_bytes());
    assert_eq!(migrated.need_mood, published.need_mood);
    assert!(migrated.baths.is_empty());
    assert_eq!(live.sim.save_snapshot_v28(), migrated);
}
