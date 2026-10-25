//! The activity log's boundary ([AL-bridge] in
//! docs/specs/2026-10-18-activity-log.md): a take moves staged records into
//! an export buffer the shell reads through one pointer, the label table
//! crosses once as one string, and the disabled baseline stages nothing.

use super::*;
use terri_sim::activity_log::{ActivityLog, LogKind, LogRecord, ACTIONS, RECORD_WORDS};

/// The words a take left in the export buffer, read through the pointer
/// exactly as JavaScript reads them.
fn exported(handle: &SimHandle, count: u32) -> Vec<u32> {
    let words = count as usize * RECORD_WORDS;
    if words == 0 {
        return Vec::new();
    }
    // SAFETY: the pointer addresses the export buffer, which holds exactly
    // `count` records after the take that returned `count`, and nothing
    // mutates the handle while this slice is alive.
    unsafe { std::slice::from_raw_parts(handle.activity_log_ptr(), words) }.to_vec()
}

fn stage(handle: &mut SimHandle, tick: u64) -> u32 {
    handle
        .sim
        .world_mut()
        .resource_mut::<ActivityLog>()
        .push(LogRecord::new(LogKind::ActionDone, ACTIONS, tick, 7))
}

/// Ticks the shipped household until a take returns records, and returns
/// them as words. Gives up after `limit` ticks.
fn tick_until_records(handle: &mut SimHandle, limit: u32) -> Vec<u32> {
    for _ in 0..limit {
        handle.tick();
        let count = handle.activity_log_take();
        if count > 0 {
            return exported(handle, count);
        }
    }
    Vec::new()
}

#[test]
fn activity_log_take_returns_records_in_sequence_and_empties_staging() {
    let mut handle = SimHandle::from_lot();
    let staged: Vec<u32> = (0..3).map(|tick| stage(&mut handle, 100 + tick)).collect();
    assert_eq!(staged, vec![1, 2, 3]);

    let count = handle.activity_log_take();
    assert_eq!(count, 3);
    let words = exported(&handle, count);
    for (index, record) in words.chunks_exact(RECORD_WORDS).enumerate() {
        assert_eq!(record[0], index as u32 + 1, "seq");
        assert_eq!(record[1], 100 + index as u32, "tick");
        assert_eq!(record[2] & 0xff, LogKind::ActionDone as u32, "kind");
        assert_eq!((record[2] >> 8) & 0xff, ACTIONS, "triggers");
        assert_eq!(record[3], 7, "actor");
    }
    assert_eq!(handle.activity_log_take(), 0, "a take empties staging");
    assert_eq!(handle.activity_log_dropped(), 0);

    // The household's own events continue the sequence.
    let words = tick_until_records(&mut handle, 1_440);
    assert!(!words.is_empty(), "the shipped household logs within a day");
    let seqs: Vec<u32> = words.chunks_exact(RECORD_WORDS).map(|r| r[0]).collect();
    let expected: Vec<u32> = (4..4 + seqs.len() as u32).collect();
    assert_eq!(seqs, expected);
}

#[test]
fn activity_log_disabled_emits_nothing() {
    let mut handle = SimHandle::from_lot();
    handle.set_activity_log_enabled(false);
    assert_eq!(stage(&mut handle, 1), 0, "a disabled log stages nothing");
    assert!(tick_until_records(&mut handle, 1_440).is_empty());
    assert_eq!(handle.activity_log_dropped(), 0);

    // The choice survives a Load, which otherwise starts an empty log.
    let saved = handle.save_bytes();
    assert!(handle.load_bytes(&saved));
    assert!(tick_until_records(&mut handle, 720).is_empty());

    handle.set_activity_log_enabled(true);
    assert_eq!(stage(&mut handle, 2), 1, "the fresh world starts at seq 1");
    assert_eq!(handle.activity_log_take(), 1);
}

#[test]
fn activity_log_labels_cross_as_one_line_each() {
    let handle = SimHandle::from_lot();
    let names = handle.sim.activity_log_labels();
    assert!(names.iter().all(|name| !name.contains('\n')));
    let text = handle.activity_log_labels();
    let lines: Vec<&str> = text.split('\n').collect();
    assert_eq!(lines, names.iter().map(String::as_str).collect::<Vec<_>>());
}

#[test]
fn a_load_starts_the_next_take_at_seq_one() {
    let mut handle = SimHandle::from_lot();
    stage(&mut handle, 1);
    stage(&mut handle, 2);
    let saved = handle.save_bytes();
    assert!(handle.load_bytes(&saved));
    assert_eq!(
        handle.activity_log_take(),
        0,
        "staged records do not survive"
    );
    assert_eq!(stage(&mut handle, 3), 1);
    let count = handle.activity_log_take();
    assert_eq!(exported(&handle, count)[0], 1);
}

#[test]
fn reaction_bands_are_the_likes_and_dislikes_edges() {
    let handle = SimHandle::from_lot();
    let tuning = &handle.sim.world().resource::<Content>().0.tuning;
    assert_eq!(
        handle.activity_log_reaction_bands(),
        vec![tuning.affinity_band_loves, tuning.affinity_band_likes]
    );
}
