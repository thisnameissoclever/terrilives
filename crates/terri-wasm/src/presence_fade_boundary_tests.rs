//! The lingering lift of liked furniture across the
//! browser boundary: issue 344, [OA-presence] in
//! `docs/specs/2026-10-06-object-affinities.md`.
use super::*;
use terri_core::{SaveSnapshotV22, SimClock, SimId};
use terri_sim::presence_fade::PresenceFade;

const NOON: &[u8] = include_bytes!("../tests/fixtures/presence-v22/new-game-day-one-noon.sav");
const EVENING: &[u8] =
    include_bytes!("../tests/fixtures/presence-v22/new-game-two-days-evening.sav");
const PUBLISHED_V23: &[u8] = include_bytes!("../tests/fixtures/published-v23/day-two.sav");

/// Main's schema-22 saves, which have no place for a fading lift, load
/// with none, preserve bills and shifts in the current envelope, load again
/// without change and go on identically.
#[test]
fn main_schema_twenty_two_saves_load_with_no_fade_and_save_current() {
    for (name, bytes) in [("noon", NOON), ("evening", EVENING)] {
        assert_eq!(&bytes[8..10], &22u16.to_le_bytes(), "{name}");
        let (original, tail) =
            postcard::take_from_bytes::<SaveSnapshotV22>(&bytes[SAVE_HEADER_BYTES..]).unwrap();
        assert!(tail.is_empty(), "{name}");
        let mut migrated = SimHandle::from_lot();
        assert!(migrated.load_bytes(bytes), "{name}");
        assert!(
            migrated
                .sim
                .world()
                .resource::<PresenceFade>()
                .entries()
                .is_empty(),
            "{name}: an older save has nothing fading"
        );
        let current = migrated.save_bytes();
        assert_eq!(&current[8..10], &SAVE_SCHEMA_VERSION.to_le_bytes(), "{name}");
        let saved = decode_current(&current);
        assert!(saved.previous.career_inputs.is_empty(), "{name}");
        assert!(saved.previous.legacy.presence_fade.is_empty(), "{name}");
        assert_eq!(saved.previous.legacy.legacy.bills, original.bills, "{name}");
        assert_eq!(saved.previous.legacy.legacy.legacy.shifts, original.legacy.shifts, "{name}");
        assert_eq!(
            saved.previous.legacy.legacy.legacy.queued_shift_commands,
            original.legacy.queued_shift_commands,
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

#[test]
fn authentic_published_twenty_two_keeps_open_shift_pay_and_refuses_pre_bill_pay() {
    let mut original = postcard::from_bytes::<SaveSnapshotV22>(&NOON[SAVE_HEADER_BYTES..]).unwrap();
    let attendance = &mut original.legacy.legacy.legacy.legacy.legacy.attendance;
    let open = attendance.shifts.iter_mut().find(|shift| shift.sim == 0 && !shift.settled).unwrap();
    assert_eq!(open.pay_cents, 18_000);
    assert!(open.worked_ticks > 0);
    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(NOON));
    let current = handle.save_bytes();
    let migrated = decode_current(&current);
    let restored = &migrated.gameplay_v20().legacy.legacy.legacy.attendance;
    assert_eq!(restored.shifts.iter().find(|shift| shift.sim == 0), Some(&*open));
    assert!(handle.load_bytes(&current));
    assert_eq!(handle.save_bytes(), current);

    open.pay_cents = 12_000;
    let mut bad = NOON[..SAVE_HEADER_BYTES].to_vec();
    bad.extend(postcard::to_allocvec(&original).unwrap());
    assert!(!handle.load_bytes(&bad));
    assert_eq!(handle.save_bytes(), current);
}

#[test]
fn authentic_published_twenty_three_keeps_bills_wages_and_fade() {
    assert_eq!(&PUBLISHED_V23[..SAVE_MAGIC.len()], SAVE_MAGIC);
    assert_eq!(&PUBLISHED_V23[8..10], &23u16.to_le_bytes());
    let payload = &PUBLISHED_V23[SAVE_HEADER_BYTES..];
    let (original, tail) = postcard::take_from_bytes::<terri_core::SaveSnapshotV23>(payload).unwrap();
    assert!(tail.is_empty());
    assert_eq!(postcard::to_allocvec(&original).unwrap(), payload);
    assert_eq!(original.legacy.bills.last_counted_day, Some(1));
    assert_eq!(original.legacy.bills.month_days, 2);
    assert_eq!(original.presence_fade.len(), 1);
    let fade = &original.presence_fade[0];
    assert_eq!((fade.sim, fade.kind.as_str(), fade.end_tick), (1, "aquarium", 1457));

    let mut handle = SimHandle::from_lot();
    assert!(handle.load_bytes(PUBLISHED_V23));
    assert_eq!(handle.sim_tick(), 1441);
    let current = handle.save_bytes();
    let snapshot = decode_current(&current);
    assert_eq!(snapshot.previous.legacy.legacy.bills, original.legacy.bills);
    assert_eq!(snapshot.previous.legacy.presence_fade, original.presence_fade);
    let before = &original.legacy.legacy;
    let after = &snapshot.previous.legacy.legacy.legacy;
    assert_eq!(after.shifts, before.shifts);
    assert_eq!(after.queued_shift_commands, before.queued_shift_commands);
    let before = &before.legacy.legacy.legacy.legacy;
    let after = &after.legacy.legacy.legacy.legacy;
    assert_eq!(after.attendance, before.attendance);
    let before = &before.legacy.legacy.legacy.careers;
    let after = &after.legacy.legacy.legacy.careers;
    assert!(!before.records.is_empty());
    assert_eq!(after, before);
    assert!(handle.load_bytes(&current));
    assert_eq!(handle.save_bytes(), current);

    for bad in [PUBLISHED_V23[..PUBLISHED_V23.len() - 1].to_vec(), [PUBLISHED_V23, &[0]].concat()] {
        assert!(!handle.load_bytes(&bad));
        assert_eq!(handle.save_bytes(), current);
    }
}

/// A fading lift crosses a save and a load byte for byte and keeps the world
/// digest, and every kind of bad row refuses the load and leaves the running
/// handle exactly as it was.
#[test]
fn current_schema_carries_the_fades_and_refuses_bad_rows() {
    let mut source = SimHandle::from_lot();
    let now = source.sim.world().resource::<SimClock>().tick;
    {
        let mut fade = source.sim.world_mut().resource_mut::<PresenceFade>();
        fade.refresh(SimId(1), 0, now, 120);
        fade.refresh(SimId(1), 1, now, 60);
        fade.refresh(SimId(2), 0, now, 30);
    }
    let bytes = source.save_bytes();
    assert_eq!(&bytes[8..10], &SAVE_SCHEMA_VERSION.to_le_bytes());
    let saved = decode_current(&bytes);
    let rows: Vec<(u32, &str, u64)> = saved
        .previous.legacy
        .presence_fade
        .iter()
        .map(|row| (row.sim, row.kind.as_str(), row.end_tick))
        .collect();
    assert_eq!(
        rows,
        vec![
            (1, "aquarium", now + 60),
            (1, "plants", now + 120),
            (2, "plants", now + 30)
        ]
    );

    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(loaded.save_bytes(), bytes);
    assert_eq!(loaded.world_hash(), source.world_hash());
    assert_ne!(
        loaded.world_hash(),
        SimHandle::from_lot().world_hash(),
        "the fades are in the digest"
    );

    let mut bad_rows = Vec::new();
    for edit in [
        (|rows: &mut Vec<terri_core::save_v23::SavedPresenceFade>| rows[2].sim = 99)
            as fn(&mut Vec<terri_core::save_v23::SavedPresenceFade>),
        |rows| rows[1].kind = "television".into(),
        |rows| rows[0].kind = "gardens".into(),
        |rows| rows[0].end_tick = 0,
        |rows| rows[0].end_tick = u64::MAX,
        |rows| rows.swap(0, 1),
        |rows| rows.push(rows[0].clone()),
    ] {
        let mut bad = saved.clone();
        edit(&mut bad.previous.legacy.presence_fade);
        let mut payload = SAVE_MAGIC.to_vec();
        payload.extend(SAVE_SCHEMA_VERSION.to_le_bytes());
        payload.extend(postcard::to_allocvec(&bad).unwrap());
        bad_rows.push(payload);
    }
    let before = loaded.save_bytes();
    let hash = loaded.world_hash();
    for (index, bad) in bad_rows.iter().enumerate() {
        assert!(!loaded.load_bytes(bad), "bad row case {index}");
        assert_eq!(loaded.save_bytes(), before, "bad row case {index}");
        assert_eq!(loaded.world_hash(), hash, "bad row case {index}");
    }
}

/// A save the game itself makes, while a fade is aging, loads and goes on
/// exactly as the world that was never reloaded, and the fade runs out.
///
/// The shipped lot is ticked until some row stops being refreshed (its end
/// tick is the same as a tick earlier, so the person has left the furniture)
/// with more than one tick still to run. That is saved and loaded into a
/// second handle, and both are ticked until the row's end tick has passed
/// (at most 228 ticks for the largest shipped lift, 19 points * 60 / 5 points
/// an hour) and for at least 250 ticks, with the world hash compared every
/// tick and the saved bytes at the end. The row must be gone, or refreshed
/// to a later end, once its end tick is reached. Saves taken along the way
/// must also pass load validation.
#[test]
fn a_fade_in_a_game_made_save_survives_a_reload_and_runs_out_identically() {
    let rows = |handle: &SimHandle| {
        handle
            .sim
            .world()
            .resource::<PresenceFade>()
            .entries()
            .to_vec()
    };
    let now = |handle: &SimHandle| handle.sim.world().resource::<SimClock>().tick;
    let mut original = SimHandle::from_lot();
    let mut earlier = rows(&original);
    let mut aging = None;
    for ticks in 0..20_000 {
        original.tick();
        let current = rows(&original);
        aging = current
            .iter()
            .find(|row| earlier.contains(row) && row.2 > now(&original) + 1)
            .copied();
        if aging.is_some() {
            break;
        }
        earlier = current;
        assert!(ticks < 19_999, "no fade was ever left running down");
    }
    let (person, kind, end) = aging.unwrap();
    let saved_at = now(&original);
    assert!(end > saved_at + 1, "the row is aging, with time left");
    let bytes = original.save_bytes();
    assert!(decode_current(&bytes)
        .previous.legacy
        .presence_fade
        .iter()
        .any(|row| row.sim == person.0 && row.end_tick == end));
    let mut reloaded = SimHandle::from_lot();
    assert!(reloaded.load_bytes(&bytes));
    assert_eq!(reloaded.world_hash(), original.world_hash());
    let mut scratch = SimHandle::from_lot();
    let run = (end - saved_at + 5).max(250);
    let mut expired = false;
    for tick in 1..=run {
        original.tick();
        reloaded.tick();
        assert_eq!(
            reloaded.world_hash(),
            original.world_hash(),
            "diverged {tick} ticks after the reload"
        );
        let this_tick = now(&original);
        let still_listed = rows(&original).contains(&(person, kind, end));
        if this_tick < end {
            assert!(
                still_listed,
                "the aging row vanished {tick} ticks in, before its end"
            );
        } else {
            assert!(
                !still_listed,
                "the row outlived its end tick, {tick} ticks in"
            );
            expired = true;
        }
        if tick % 10 == 0 {
            assert!(
                scratch.load_bytes(&original.save_bytes()),
                "the game's own save was refused {tick} ticks after the reload"
            );
        }
    }
    assert!(expired, "the loop never reached the row's end tick");
    assert_eq!(reloaded.save_bytes(), original.save_bytes());
}
