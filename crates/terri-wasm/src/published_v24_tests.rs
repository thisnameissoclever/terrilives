//! Original public Career saves and private water saves share one current loader.
use super::*;

const PUBLIC_DAY: &[u8] = include_bytes!("../tests/fixtures/published-v24/day-two.sav");
const PUBLIC_WEEK: &[u8] = include_bytes!("../tests/fixtures/published-v24/week-two.sav");
const PRIVATE_BATH: &[u8] = include_bytes!("../tests/fixtures/private-editable/bath-v25.sav");

fn assert_current_continuation(source: &mut SimHandle) {
    let bytes = source.save_bytes();
    assert_eq!(&bytes[8..10], &SAVE_SCHEMA_VERSION.to_le_bytes());
    let mut resumed = SimHandle::new(1, 1);
    assert!(resumed.load_bytes(&bytes));
    assert_eq!(resumed.save_bytes(), bytes);
    for _ in 0..100 {
        source.tick();
        resumed.tick();
        assert_eq!(source.world_hash(), resumed.world_hash());
    }
    assert_eq!(source.save_bytes(), resumed.save_bytes());
}

#[test]
fn authentic_public_v24_preserves_career_inputs_and_continues() {
    for bytes in [PUBLIC_DAY, PUBLIC_WEEK] {
        assert_eq!(&bytes[8..10], &24u16.to_le_bytes());
        let (original, tail) =
            postcard::take_from_bytes::<terri_core::SaveSnapshotV24>(&bytes[SAVE_HEADER_BYTES..])
                .unwrap();
        assert!(tail.is_empty());
        assert_eq!(
            postcard::take_from_bytes::<u64>(&bytes[SAVE_HEADER_BYTES..])
                .unwrap()
                .0,
            0x5111_16ef_ac94_ae24
        );
        if bytes == PUBLIC_WEEK {
            assert!(
                !original.career_inputs.is_empty(),
                "the actual producer recorded a review"
            );
        }
        let mut source = SimHandle::from_lot();
        assert!(source.load_bytes(bytes));
        let saved = decode_current(&source.save_bytes());
        assert_eq!(saved.previous.career_inputs, original.career_inputs);
        assert_eq!(
            saved.previous.queued_work_commands,
            original.queued_work_commands
        );
        assert_eq!(saved.previous.replaced_shifts, original.replaced_shifts);
        assert_eq!(
            saved.previous.legacy.presence_fade,
            original.legacy.presence_fade
        );
        assert_eq!(
            saved.previous.legacy.legacy.bills,
            original.legacy.legacy.bills
        );
        assert_eq!(
            saved.previous.legacy.legacy.legacy.shifts,
            original.legacy.legacy.legacy.shifts
        );
        assert_current_continuation(&mut source);
        let before = source.save_bytes();
        for bad in [bytes[..bytes.len() - 1].to_vec(), [bytes, &[0]].concat()] {
            assert!(!source.load_bytes(&bad));
            assert_eq!(source.save_bytes(), before);
        }
    }
}

#[test]
fn authentic_private_v25_preserves_world_and_bath_continuation() {
    assert_eq!(&PRIVATE_BATH[8..10], &25u16.to_le_bytes());
    let (original, tail) = postcard::take_from_bytes::<terri_core::SaveSnapshotV25>(
        &PRIVATE_BATH[SAVE_HEADER_BYTES..],
    )
    .unwrap();
    assert!(tail.is_empty());
    assert_eq!(original.baths.len(), 1);
    assert_eq!(original.baths[0].toy, 3);
    let mut source = SimHandle::from_lot();
    assert!(source.load_bytes(PRIVATE_BATH));
    let saved = decode_current(&source.save_bytes());
    // A save records the content it was written with, so the resave carries
    // the current fingerprint, which moves whenever content changes. Every
    // other field must survive unchanged.
    let mut expected = original.previous.clone();
    expected
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .world
        .content_fingerprint = current_test_snapshot::CURRENT_CATALOGUE_FINGERPRINT;
    assert_eq!(saved.previous.legacy, expected);
    assert!(saved.previous.career_inputs.is_empty());
    assert_eq!(saved.surfaces, original.surfaces);
    assert_eq!(saved.commutes, original.commutes);
    assert_eq!(saved.pools, original.pools);
    assert_eq!(saved.baths, original.baths);
    assert_current_continuation(&mut source);
}
