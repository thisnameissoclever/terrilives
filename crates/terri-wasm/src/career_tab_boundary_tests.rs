//! The Career tab across the browser boundary:
//! `docs/specs/2026-11-19-career-tab.md`, [CT-web] items 1 to 4 and [T6]
//! (the Go to work command and status, the weekly score inputs and the
//! last shift's inputs).
use super::*;
use terri_core::{AtWork, Commuting, NeedId, Needs, SimClock};
use terri_sim::careers::{Careers, Record, ShiftInputs, Week, WeekInputs};

/// The shipped household's worker holds the office's standard day shift,
/// Monday to Friday, starting at tick 360 of the day and lasting 480.
const START: u64 = 360;

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

/// An entity index that names an object, not a person.
fn furniture(handle: &SimHandle) -> u32 {
    let world = handle.sim.world();
    let people = people(handle);
    world
        .try_query::<(terri_core::Entity, &terri_core::Position)>()
        .expect("registered")
        .iter(world)
        .map(|(entity, _)| entity.index_u32())
        .find(|index| !people.contains(index))
        .expect("the shipped lot has objects")
}

fn entity_of(handle: &SimHandle, index: u32) -> terri_core::Entity {
    let world = handle.sim.world();
    world
        .try_query::<(terri_core::Entity, &terri_core::Agent)>()
        .expect("registered")
        .iter(world)
        .map(|(person, _)| person)
        .find(|person| person.index_u32() == index)
        .expect("a living person")
}

fn sim_id_of(handle: &SimHandle, index: u32) -> terri_core::SimId {
    *handle
        .sim
        .world()
        .get::<terri_core::SimId>(entity_of(handle, index))
        .expect("a person has an id")
}

/// The worker's career record, made on first use: a new game's worker has
/// not worked a shift, so none exists yet.
fn record_of(handle: &mut SimHandle, id: terri_core::SimId) -> &mut Record {
    let job = handle.sim.world().resource::<Content>().0.careers[0].clone();
    handle
        .sim
        .world_mut()
        .resource_mut::<Careers>()
        .into_inner()
        .records
        .entry(id)
        .or_insert_with(|| Record::new(&job))
}

/// Puts the shared clock on Monday of the first week at `tick`.
fn at(handle: &mut SimHandle, tick: u64) {
    handle.sim.world_mut().resource_mut::<SimClock>().tick = tick;
}

/// [CT-web] item 1: `go_to_work` stages the command, and the drain gives
/// the result and the world the native path gives: a worker due in the
/// window leaves at once, and the same ticks follow.
#[test]
fn go_to_work_matches_the_native_drain() {
    let mut handle = SimHandle::from_lot();
    let mut native = Sim::new_from_shipped_lot();
    let tim = worker(&handle);
    let window = u64::from(handle.go_to_work_window_ticks());
    assert_eq!(window, 120, "the shipped window");
    at(&mut handle, START - window);
    native.world_mut().resource_mut::<SimClock>().tick = START - window;
    assert_eq!(handle.go_to_work_status(tim), [1.0, 360.0, 840.0, 240.0]);

    assert!(handle.go_to_work(tim));
    handle.flush_commands();
    native
        .world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .push(SimCommand::GoToWork { agent: tim });
    native.flush_commands();

    assert_eq!(handle.last_career_result(), vec![f64::from(tim), 0.0]);
    let result = native
        .world()
        .resource::<Careers>()
        .last_result
        .expect("reported");
    assert_eq!((result.agent, result.reason), (tim, None));
    assert_eq!(handle.sim.world_hash(), native.world_hash());
    assert_eq!(
        handle.go_to_work_status(tim),
        [5.0, 0.0, 0.0, 0.0],
        "on the way to work"
    );
    for _ in 0..60 {
        handle.tick();
        native.tick();
    }
    assert_eq!(handle.sim.world_hash(), native.world_hash());
}

/// [CT-command] item 4 across the boundary: the two new refusals reach the
/// shell as codes 7 and 8's neighbours do, beside the ones that existed.
#[test]
fn go_to_work_refusals_reach_the_shell_as_codes() {
    let mut handle = SimHandle::from_lot();
    let tim = worker(&handle);
    let idle = unemployed(&handle);
    at(&mut handle, 0);
    // The next shift is six hours away: not due.
    assert!(handle.go_to_work(tim));
    handle.flush_commands();
    assert_eq!(handle.last_career_result(), vec![f64::from(tim), 7.0]);
    assert!(handle.go_to_work(idle));
    handle.flush_commands();
    assert_eq!(handle.last_career_result(), vec![f64::from(idle), 5.0]);
    let object = furniture(&handle);
    assert!(handle.go_to_work(object));
    handle.flush_commands();
    assert_eq!(handle.last_career_result(), vec![f64::from(object), 1.0]);
    // Each refusal counted once.
    assert_eq!(handle.career_result_sequence(), 3);
}

/// [CT-web] item 2: `[state, start_tick, end_tick, opens_tick]` for each
/// state, and empty for anything but a living person.
#[test]
fn go_to_work_status_reports_each_state() {
    let mut handle = SimHandle::from_lot();
    let tim = worker(&handle);
    // No job: state 0 and nothing else.
    assert_eq!(handle.go_to_work_status(unemployed(&handle)), [0.0; 4]);
    // Early: more than the window away; opens at the window's start.
    at(&mut handle, 0);
    assert_eq!(handle.go_to_work_status(tim), [3.0, 360.0, 840.0, 240.0]);
    // Due at the window's edge; one tick before it is early.
    at(&mut handle, START - 120);
    assert_eq!(handle.go_to_work_status(tim), [1.0, 360.0, 840.0, 240.0]);
    at(&mut handle, START - 120 - 1);
    assert_eq!(handle.go_to_work_status(tim)[0], 3.0, "one tick early");
    // Late: held home past the start by a critical need.
    at(&mut handle, START - 1);
    let entity = entity_of(&handle, tim);
    handle
        .sim
        .world_mut()
        .get_mut::<Needs>(entity)
        .expect("needs")
        .set(NeedId::Hunger, 5.0);
    handle.tick();
    handle.tick();
    assert_eq!(handle.go_to_work_status(tim), [2.0, 360.0, 840.0, 240.0]);
    // Away: outbound, at work (until the end), inbound.
    let mut away = SimHandle::from_lot();
    let tim = worker(&away);
    at(&mut away, 100);
    let entity = entity_of(&away, tim);
    away.sim
        .world_mut()
        .entity_mut(entity)
        .insert(Commuting::Outbound);
    assert_eq!(away.go_to_work_status(tim), [5.0, 0.0, 0.0, 0.0]);
    away.sim
        .world_mut()
        .entity_mut(entity)
        .remove::<Commuting>()
        .insert(AtWork {
            remaining_ticks: 50,
        });
    assert_eq!(away.go_to_work_status(tim), [4.0, 0.0, 150.0, 0.0]);
    away.sim
        .world_mut()
        .entity_mut(entity)
        .remove::<AtWork>()
        .insert(Commuting::Inbound);
    assert_eq!(away.go_to_work_status(tim), [6.0, 0.0, 0.0, 0.0]);
    // Anything but a living person has none.
    assert!(handle.go_to_work_status(furniture(&handle)).is_empty());
    assert!(handle.go_to_work_status(u32::MAX).is_empty());
}

fn week(week: u64, career: u32, mood: f32, pay: u32) -> WeekInputs {
    WeekInputs {
        week,
        career,
        shifts: 5,
        attended: 4,
        fit: 0.5,
        trait_fit: 0.25,
        social_capacity: 0.75,
        mastery: 0.125,
        mood,
        missed_minutes: 30.0,
        pay,
    }
}

/// [CT-web] item 3: fourteen numbers a row, `[week, career, path, level,
/// shifts, attended, fit, trait_fit, social_capacity, social_demand,
/// mastery, mood, missed_minutes, pay]`; the path, level and social demand
/// come from the career row the week was held at, oldest week first.
#[test]
fn career_input_history_has_fourteen_numbers_a_row() {
    let mut handle = SimHandle::from_lot();
    let tim = worker(&handle);
    assert!(handle.career_input_history(tim).is_empty(), "nothing yet");
    let id = sim_id_of(&handle, tim);
    let pack = handle.sim.world().resource::<Content>().0;
    let row = pack.career_paths[1].levels[1];
    record_of(&mut handle, id).input_weeks.extend([
        week(3, 0, -0.5, pack.careers[0].pay),
        week(4, row, 0.5, pack.careers[row as usize].pay),
    ]);
    let expected = |week: f64, row: u32, mood: f64| {
        let career = &pack.careers[row as usize];
        [
            week,
            f64::from(row),
            f64::from(career.path),
            f64::from(career.level),
            5.0,
            4.0,
            0.5,
            0.25,
            0.75,
            f64::from(career.social_demand),
            0.125,
            mood,
            30.0,
            f64::from(career.pay),
        ]
    };
    let rows = handle.career_input_history(tim);
    assert_eq!(rows.len(), 28);
    assert_eq!(rows[..14], expected(3.0, 0, -0.5));
    assert_eq!(rows[14..], expected(4.0, row, 0.5));
    // Anything but a living person has none.
    assert!(handle.career_input_history(unemployed(&handle)).is_empty());
    assert!(handle.career_input_history(u32::MAX).is_empty());
}

/// [CT-web] item 4: the seven `ShiftInputs` numbers, `[fit, trait_fit,
/// social_capacity, mastery, mood, missed_minutes, attended]`, or empty
/// before a shift has been scored and for anything but a living person.
#[test]
fn career_last_shift_has_the_seven_inputs() {
    let mut handle = SimHandle::from_lot();
    let tim = worker(&handle);
    assert!(handle.career_last_shift(tim).is_empty(), "no shift yet");
    let id = sim_id_of(&handle, tim);
    record_of(&mut handle, id).last_shift = Some(ShiftInputs {
        fit: -0.25,
        trait_fit: 0.5,
        social_capacity: 0.75,
        mastery: 0.125,
        mood: 0.5,
        missed_minutes: 45.0,
        attended: true,
    });
    assert_eq!(
        handle.career_last_shift(tim),
        [-0.25, 0.5, 0.75, 0.125, 0.5, 45.0, 1.0]
    );
    assert!(handle.career_last_shift(unemployed(&handle)).is_empty());
    assert!(handle.career_last_shift(u32::MAX).is_empty());
}

/// [CT-tests] wasm boundary item 3: a save written through the wasm save
/// path at schema 24 reloads with the rows and the last shift, and the
/// hash agrees.
#[test]
fn schema_twenty_four_saves_reload_with_the_rows() {
    let mut handle = SimHandle::from_lot();
    let tim = worker(&handle);
    let id = sim_id_of(&handle, tim);
    let pack = handle.sim.world().resource::<Content>().0;
    // A reviewed week is one before the current week: stand in the fourth.
    let day = u64::from(handle.day_ticks());
    at(&mut handle, 21 * day);
    {
        let record = record_of(&mut handle, id);
        let pay = pack.careers[0].pay;
        record.history.push(Week {
            week: 1,
            performance: 70.0,
            event: 0,
        });
        record.input_weeks.push_back(week(1, 0, 0.25, pay));
        record.last_shift = Some(ShiftInputs {
            fit: 0.25,
            trait_fit: 0.0,
            social_capacity: 0.5,
            mastery: 0.5,
            mood: -0.25,
            missed_minutes: 0.0,
            attended: false,
        });
    }
    let rows = handle.career_input_history(tim);
    let last = handle.career_last_shift(tim);
    assert_eq!(rows.len(), 14);
    assert_eq!(last.len(), 7);
    let saved = handle.save_bytes();
    assert_eq!(&saved[8..10], &24u16.to_le_bytes());
    let mut reloaded = SimHandle::from_lot();
    assert!(reloaded.load_bytes(&saved));
    assert_eq!(reloaded.career_input_history(tim), rows);
    assert_eq!(reloaded.career_last_shift(tim), last);
    assert_eq!(reloaded.sim.world_hash(), handle.sim.world_hash());
    assert_eq!(reloaded.save_bytes(), saved);
}
