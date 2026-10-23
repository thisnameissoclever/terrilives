//! Shifts across the browser boundary: issue 296,
//! `docs/specs/2026-10-18-shifts-and-careers.md`, [WS-shell] item 6.
use super::*;

/// Every living person's entity index, in sim id order.
fn people(handle: &SimHandle) -> Vec<u32> {
    let world = handle.sim.world();
    let mut people: Vec<(u32, u32)> = world
        .try_query::<(terri_core::Entity, &terri_core::Agent, &terri_core::SimId)>()
        .expect("registered")
        .iter(world)
        .map(|(person, _, id)| (id.0, person.index_u32()))
        .collect();
    people.sort_unstable();
    people.into_iter().map(|(_, index)| index).collect()
}

fn worker(handle: &SimHandle) -> u32 {
    people(handle)
        .into_iter()
        .find(|person| !handle.career_of(*person).is_empty())
        .expect("the shipped household has a worker")
}

fn unemployed(handle: &SimHandle) -> u32 {
    people(handle)
        .into_iter()
        .find(|person| handle.career_of(*person).is_empty())
        .expect("an unemployed housemate")
}

fn path(handle: &SimHandle, id: &str) -> u32 {
    handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .career_paths
        .iter()
        .position(|path| path.id == id)
        .expect("shipped") as u32
}

/// [WS-shell] item 6: the schedule adds the held shift's kind and index;
/// the shipped worker holds the office's standard day shift, and a night
/// watch worker reads kind 3.
#[test]
fn career_schedule_of_reports_the_held_shift_kind_and_index() {
    let mut handle = SimHandle::from_lot();
    let tim = worker(&handle);
    assert_eq!(handle.career_schedule_of(tim), [31, 360, 480, 0, 0]);
    let night = path(&handle, "night_watch");
    assert!(handle.assign_career_shift(tim, night, 0));
    handle.flush_commands();
    assert_eq!(handle.last_career_result(), vec![f64::from(tim), 0.0]);
    let schedule = handle.career_schedule_of(tim);
    assert_eq!(schedule.len(), 5);
    assert_eq!((schedule[1], schedule[3], schedule[4]), (1320, 3, 0));
    let cafe = path(&handle, "cafe");
    let first = handle.sim.world().resource::<Content>().0.career_paths[cafe as usize].levels[0];
    let late = handle.sim.world().resource::<Content>().0.careers[first as usize]
        .shift_index("late")
        .expect("listed") as u32;
    assert!(handle.assign_career_shift(tim, cafe, late));
    handle.flush_commands();
    let schedule = handle.career_schedule_of(tim);
    assert_eq!((schedule[1], schedule[3], schedule[4]), (780, 2, late));
    assert!(handle.career_schedule_of(unemployed(&handle)).is_empty());
}

/// [WS-shell] item 6: a path's first level's offered shifts, standard
/// first then authored order; the office offers two.
#[test]
fn career_path_shifts_lists_the_first_levels_offered_shifts() {
    let handle = SimHandle::from_lot();
    assert_eq!(
        handle.career_path_shifts(0),
        [0, 0, 360, 480, 31, 19, 1, 2, 720, 480, 31, 1]
    );
    let pack = handle.sim.world().resource::<Content>().0;
    for (index, path) in pack.career_paths.iter().enumerate() {
        // Read straight from the compiled level for comparison.
        let level = &pack.careers[path.levels[0] as usize];
        let offered: Vec<u32> = (0..level.shift_count())
            .filter_map(|index| level.shift(index))
            .filter(|shift| shift.weight > 0)
            .flat_map(|shift| {
                [
                    shift.index as u32,
                    u32::from(shift.kind),
                    shift.shift_start,
                    shift.shift_ticks,
                    u32::from(shift.working_days),
                    shift.weight,
                ]
            })
            .collect();
        assert_eq!(
            handle.career_path_shifts(index as u32),
            offered,
            "{}",
            path.id
        );
    }
}

#[test]
fn career_path_shifts_is_empty_for_an_unknown_path() {
    let handle = SimHandle::from_lot();
    let paths = handle.career_path_labels().len() as u32;
    for unknown in [paths, 99, u32::MAX] {
        assert!(handle.career_path_shifts(unknown).is_empty(), "{unknown}");
    }
}

/// [WS-shell] item 6: the person's current level's offered shifts, and
/// nothing for anyone without a job.
#[test]
fn career_shifts_of_lists_the_current_levels_offered_shifts() {
    let mut handle = SimHandle::from_lot();
    let tim = worker(&handle);
    assert_eq!(handle.career_shifts_of(tim), handle.career_path_shifts(0));
    let hospital = path(&handle, "hospital");
    assert!(handle.assign_career(tim, hospital));
    handle.flush_commands();
    assert_eq!(
        handle.career_shifts_of(tim),
        handle.career_path_shifts(hospital)
    );
    assert_eq!(handle.career_shifts_of(tim).len(), 18, "three shifts");
    assert!(handle.career_shifts_of(unemployed(&handle)).is_empty());
    assert!(handle.career_shifts_of(0).is_empty(), "a placed object");
    assert!(handle.career_shifts_of(u32::MAX).is_empty());
}

/// [WS-shell] item 6: both commands stage through the queue and the last
/// career result reports refusals 4 to 6.
#[test]
fn the_shift_command_exports_stage_and_report_refusals() {
    let mut handle = SimHandle::from_lot();
    let tim = worker(&handle);
    let bill = unemployed(&handle);
    let sequence = handle.career_result_sequence();
    assert!(handle.change_shift(tim, 1));
    assert_eq!(
        handle.career_result_sequence(),
        sequence,
        "staged, not yet applied"
    );
    handle.flush_commands();
    assert_eq!(handle.last_career_result(), vec![f64::from(tim), 0.0]);
    assert_eq!(handle.career_schedule_of(tim)[4], 1);
    for (agent, shift, refusal) in [(tim, 9, 4.0), (bill, 0, 5.0), (tim, 1, 6.0)] {
        assert!(handle.change_shift(agent, shift));
        handle.flush_commands();
        assert_eq!(
            handle.last_career_result(),
            vec![f64::from(agent), refusal],
            "{agent} {shift}"
        );
    }
    assert!(handle.assign_career_shift(tim, 0, 9));
    handle.flush_commands();
    assert_eq!(handle.last_career_result(), vec![f64::from(tim), 4.0]);
    assert_eq!(handle.career_result_sequence(), sequence + 5);
}

/// [WS-save]: a held shift other than the standard and the moved shift
/// stream cross `save_bytes` and `load_bytes` in schema twenty-one.
#[test]
fn schema_twenty_one_round_trips_through_the_save_bytes() {
    let mut source = SimHandle::from_lot();
    let tim = worker(&source);
    let bill = unemployed(&source);
    assert!(source.change_shift(tim, 1));
    assert!(source.assign_career(bill, path(&source, "cafe")));
    source.flush_commands();
    let bytes = source.save_bytes();
    assert_eq!(
        &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
        &21u16.to_le_bytes()
    );
    let snapshot = super::current_test_snapshot::decode_current(&bytes);
    assert!(snapshot.shifts.held.iter().any(|row| row.shift == "late"));
    assert_eq!(snapshot.shifts.draws, 1);
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(
        loaded.career_schedule_of(tim),
        source.career_schedule_of(tim)
    );
    assert_eq!(
        loaded.career_schedule_of(bill),
        source.career_schedule_of(bill)
    );
    assert_eq!(loaded.world_hash(), source.world_hash());
    assert_eq!(loaded.save_bytes(), bytes);
}
