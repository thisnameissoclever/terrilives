//! Schema-23 saves from before the Career tab's score inputs
//! (`docs/specs/2026-11-19-career-tab.md`, [CT-save-migrate] and
//! [CT-tests] `v24_tests.rs` item 4): they load with no inputs, save as
//! the current schema and continue, and the first full week after the load writes
//! a row.
use super::current_test_snapshot::decode_current;
use super::*;
use terri_sim::careers::Careers;

const THURSDAY: &[u8] =
    include_bytes!("../tests/fixtures/career-inputs-v23/new-game-thursday-noon.sav");
const TWO_WEEKS: &[u8] =
    include_bytes!("../tests/fixtures/career-inputs-v23/two-reviewed-weeks-tuesday-noon.sav");

fn fixtures() -> [(&'static str, &'static [u8]); 2] {
    [
        ("thursday noon", THURSDAY),
        ("two reviewed weeks", TWO_WEEKS),
    ]
}

/// Every schema-23 fixture loads with no inputs and no queued Go to work,
/// keeps Career, attendance and bills state while adopting explicit world geometry,
/// then continues tick for tick after a current-envelope reload.
#[test]
fn schema_twenty_three_saves_load_with_no_inputs_and_continue() {
    for (name, bytes) in fixtures() {
        assert_eq!(&bytes[8..10], &23u16.to_le_bytes(), "{name}");
        let original: terri_core::SaveSnapshotV23 =
            postcard::from_bytes(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        let mut migrated = SimHandle::from_lot();
        assert!(migrated.load_bytes(bytes), "{name}");
        let current = migrated.save_bytes();
        assert_eq!(
            &current[8..10],
            &SAVE_SCHEMA_VERSION.to_le_bytes(),
            "{name}"
        );
        let saved = decode_current(&current);
        assert!(saved.editable.previous.career_inputs.is_empty(), "{name}");
        assert!(
            saved.editable.previous.queued_work_commands.is_empty(),
            "{name}"
        );
        assert!(saved.editable.previous.replaced_shifts.is_empty(), "{name}");
        assert_eq!(
            saved.editable.previous.legacy.presence_fade, original.presence_fade,
            "{name}"
        );
        assert_eq!(
            saved.editable.previous.legacy.legacy.bills, original.legacy.bills,
            "{name}"
        );
        assert_eq!(
            saved.editable.previous.legacy.legacy.legacy.shifts, original.legacy.legacy.shifts,
            "{name}"
        );
        assert_eq!(
            saved
                .editable
                .previous
                .legacy
                .legacy
                .legacy
                .queued_shift_commands,
            original.legacy.legacy.queued_shift_commands,
            "{name}"
        );
        let before = &original.legacy.legacy.legacy.legacy.legacy.legacy;
        let after = &saved.gameplay_v20().legacy.legacy.legacy;
        assert_eq!(after.attendance, before.attendance, "{name}");
        assert_eq!(
            after.legacy.legacy.legacy.careers, before.legacy.legacy.legacy.careers,
            "{name}"
        );

        let mut resumed = SimHandle::from_lot();
        assert!(resumed.load_bytes(&current), "{name}");
        assert_eq!(resumed.save_bytes(), current, "{name}");
        for tick in 0..120 {
            migrated.tick();
            resumed.tick();
            assert_eq!(
                migrated.world_hash(),
                resumed.world_hash(),
                "{name}: diverged {tick} ticks after load"
            );
        }
        assert_eq!(migrated.save_bytes(), resumed.save_bytes(), "{name}");
    }
}

/// [CT-save-migrate]: the week a schema-23 save was taken in already holds
/// scores without inputs, so its review writes no row; the next week's
/// shifts all settle after the load, so its review writes one.
#[test]
fn the_first_full_week_after_a_mid_week_load_writes_a_row() {
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(THURSDAY));
    let reviewed = |handle: &SimHandle, week: u64| -> Vec<(bool, bool)> {
        handle
            .sim
            .world()
            .resource::<Careers>()
            .records
            .values()
            .filter(|record| record.history.iter().any(|w| w.week == week))
            .map(|record| (true, record.input_weeks.iter().any(|row| row.week == week)))
            .collect()
    };
    let day = u64::from(
        handle
            .sim
            .world()
            .resource::<terri_sim::Content>()
            .0
            .tuning
            .day_ticks,
    );
    let week_ticks = 7 * day;
    // Through the end of week 1 and a day more, for a review deferred while
    // the worker is away.
    let last = 2 * week_ticks + day;
    while handle.sim_tick() < last && reviewed(&handle, 1).is_empty() {
        handle.tick();
    }
    let first = reviewed(&handle, 0);
    assert!(!first.is_empty(), "the loaded week was reviewed");
    assert!(
        first.iter().all(|(_, row)| !row),
        "the loaded week has no input row"
    );
    let next = reviewed(&handle, 1);
    assert!(!next.is_empty(), "the next week was reviewed");
    assert!(
        next.iter().all(|(_, row)| *row),
        "the first full week after the load has a row"
    );
}
