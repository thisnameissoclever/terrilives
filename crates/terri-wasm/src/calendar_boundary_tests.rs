//! The calendar's two boundary reads - [CAL-hud] and [CAL-evidence] item 5
//! in `docs/specs/2026-10-06-calendar.md`: the weekday of the current tick,
//! and the working days and hours of a person's career.

use super::*;
use terri_core::SimClock;

/// The entity index of the household member called `name`. The household
/// spawns after the placed objects, so a short scan past them finds it.
fn index_named(handle: &SimHandle, name: &str) -> u32 {
    let bound = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .lot
        .placements
        .len() as u32
        + 16;
    (0..bound)
        .find(|&index| handle.sim_name(index) == name)
        .unwrap_or_else(|| panic!("{name} is in the shipped household"))
}

#[test]
fn weekday_index_starts_on_monday_and_turns_over_with_the_day() {
    let mut handle = SimHandle::from_lot();
    let day_ticks = handle.day_ticks();
    assert_eq!(handle.weekday_index(), 0, "a new game starts on a Monday");

    // The last tick of day 1 is still Monday; the next one is Tuesday.
    for _ in 0..day_ticks - 1 {
        handle.tick();
    }
    assert_eq!(handle.sim_tick(), u64::from(day_ticks) - 1);
    assert_eq!(handle.weekday_index(), 0, "the last minute of day 1");
    handle.tick();
    assert_eq!(handle.sim_tick(), u64::from(day_ticks));
    assert_eq!(handle.weekday_index(), 1, "day 2 is a Tuesday");
}

#[test]
fn weekday_index_reaches_sunday_and_wraps_to_monday() {
    let mut handle = SimHandle::from_lot();
    let day = u64::from(handle.day_ticks());
    let bytes = handle.save_bytes();
    assert_eq!(handle.weekday_index(), 0);
    assert_eq!(
        handle.save_bytes(),
        bytes,
        "reading the weekday saves nothing"
    );

    let mut set_tick = |tick: u64| {
        handle.sim.world_mut().resource_mut::<SimClock>().tick = tick;
        handle.weekday_index()
    };
    assert_eq!(set_tick(6 * day), 6, "day 7 is a Sunday");
    assert_eq!(set_tick(7 * day - 1), 6, "the last minute of day 7");
    assert_eq!(set_tick(7 * day), 0, "day 8 is a Monday again");
    assert_eq!(
        set_tick(u64::MAX),
        u32::from(terri_core::clock::weekday(u64::MAX, day as u32, 0)),
        "the top of the tick range still names a weekday"
    );
}

#[test]
fn career_schedule_of_reports_working_days_and_hours() {
    let handle = SimHandle::from_lot();
    let pack = handle.sim.world().resource::<Content>().0;
    let office = pack
        .careers
        .iter()
        .find(|career| career.id == "office_job")
        .expect("the shipped office job");
    let tim = index_named(&handle, "Tim");
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();

    // Monday to Friday is bits 0 to 4; 06:00 for eight hours.
    assert_eq!(handle.career_schedule_of(tim), [31, 360, 480]);
    assert_eq!(
        handle.career_schedule_of(tim),
        [
            u32::from(office.working_days),
            office.shift_start,
            office.shift_ticks
        ],
        "the projection reads the compiled career"
    );
    let bill = index_named(&handle, "Bill");
    assert_eq!(handle.career_of(bill), "", "Bill holds no job");
    assert!(handle.career_schedule_of(bill).is_empty());

    assert_eq!(
        handle.save_bytes(),
        bytes,
        "reading a schedule saves nothing"
    );
    assert_eq!(handle.world_hash(), hash);
}

#[test]
fn career_schedule_of_rejects_non_people_in_release() {
    let handle = SimHandle::from_lot();
    let tim = index_named(&handle, "Tim");
    let object = 0;
    assert!(object < tim, "index 0 is a placed object");
    assert!(handle.sim_name(object).is_empty());
    let bytes = handle.save_bytes();
    let hash = handle.world_hash();
    for index in [object, u32::MAX, u32::MAX - 1] {
        assert!(handle.career_schedule_of(index).is_empty(), "{index}");
    }
    assert_eq!(handle.save_bytes(), bytes);
    assert_eq!(handle.world_hash(), hash);
}
