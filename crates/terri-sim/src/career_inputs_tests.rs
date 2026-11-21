//! The seven score inputs kept per week for the review window:
//! `docs/specs/2026-11-19-career-tab.md`, [CT-save-memory], [CT-save-row]
//! and [CT-save-hash] ([CT-tests], `career_inputs_tests.rs` items 1 to 5).
//! Memory only: save formats are schema 24's work.
use super::*;
use crate::attendance::Attendance;
use crate::{Content, Sim};
use terri_core::{
    Agent, CommandQueue, IntentQueue, Needs, Personality, Position, Relationships, Satisfaction,
    SimClock, SimCommand, SimIdAllocator, TileGrid,
};

/// The fixture's shift starts at 10:00 and lasts eight hours.
const START: u64 = 600;
const SHIFT: u32 = 480;
const DAY: u64 = 1440;

/// One person at (2, 4) on a 20 by 20 lot with a street exit, holding the
/// first career row with a shift at [`START`] on every day, no decay and no
/// random career events, so nothing moves unless the test moves it.
fn fixture(tune: impl Fn(&mut terri_data::ContentPack)) -> (Sim, Entity, SimId) {
    let mut pack = terri_data::pack().clone();
    pack.decay_per_tick = [0.0; 7];
    pack.tuning.neglect_bleed_per_tick = 0.0;
    pack.tuning.satisfaction_mood_per_tick = 0.0;
    pack.tuning.career_search_chance = 0.0;
    pack.tuning.career_review_noise = 0.0;
    pack.tuning.career_fire_base = 0.0;
    pack.tuning.career_demote_base = 0.0;
    pack.tuning.career_promote_base = 0.0;
    pack.tuning.career_raise_base = 0.0;
    pack.tuning.career_change_chance = 0.0;
    pack.careers[0].shift_start = START as u32;
    pack.careers[0].shift_ticks = SHIFT;
    pack.careers[0].working_days = 0b111_1111;
    tune(&mut pack);
    let content = Content(Box::leak(Box::new(pack)));
    let mut sim = Sim::new_with_lot_and_content(20, 20, content);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let actor = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Position { x: 2.0, y: 4.0 },
            Needs::all_at(100.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
            Career(0),
        ))
        .id();
    let job = sim.world().resource::<Content>().0.careers[0].clone();
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .insert(id, Record::new(&job));
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetCareerAutonomy {
            change: false,
            search: false,
        });
    sim.flush_commands();
    (sim, actor, id)
}

fn pack(sim: &Sim) -> &'static ContentPack {
    sim.world().resource::<Content>().0
}

fn record(sim: &Sim, id: SimId) -> Record {
    sim.world().resource::<Careers>().records[&id].clone()
}

fn edit(sim: &mut Sim, id: SimId, change: impl FnOnce(&mut Record)) {
    change(
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .get_mut(&id)
            .unwrap(),
    );
}

fn inputs(seed: f32, attended: bool, missed: f32) -> ShiftInputs {
    ShiftInputs {
        fit: seed * 0.1,
        trait_fit: seed * 0.2,
        social_capacity: seed * 0.05,
        mastery: seed * 0.1,
        mood: seed * 0.15,
        missed_minutes: missed,
        attended,
    }
}

/// Settles scored shifts into this week as `settle` does, each with the
/// score its inputs give.
fn score_into_week(sim: &mut Sim, actor: Entity, shifts: &[ShiftInputs]) {
    let career = sim.world().get::<Career>(actor).unwrap().0;
    let now = sim.world().resource::<SimClock>().tick;
    let week = week_of(now, DAY as u32);
    for read in shifts {
        let score = shift_score(read.fit, read.mastery, read.mood);
        complete_attended_shift(
            sim.world_mut(),
            actor,
            career,
            0,
            1.0,
            Some((score, *read)),
            week,
        );
    }
}

fn run_review(sim: &mut Sim, week: u64) {
    let tick = (week + 1) * DAY * 7;
    sim.world_mut().resource_mut::<SimClock>().tick = tick;
    review(sim.world_mut(), week, tick);
}

fn tick_until_settled(sim: &mut Sim) {
    for _ in 0..START + u64::from(SHIFT) + 2 {
        sim.tick();
    }
    assert_eq!(
        sim.world().resource::<Attendance>().outcomes.len(),
        1,
        "the shift settled once"
    );
}

/// Item 1: a settled shift keeps exactly what its score used. Recomputing
/// the base score from the stored inputs gives the outcome's base score,
/// the stored missed minutes are the outcome's, and the same inputs are the
/// record's last shift.
#[test]
fn settlement_records_the_inputs_the_score_used() {
    let (mut sim, actor, id) = fixture(|_| {});
    tick_until_settled(&mut sim);
    let outcome = sim.world().resource::<Attendance>().outcomes[0].clone();
    let held = record(&sim, id);
    assert_eq!(held.shifts.len(), 1);
    assert_eq!(held.shift_inputs.len(), held.shifts.len(), "one per score");
    let read = held.shift_inputs[0];
    assert_eq!(
        shift_score(read.fit, read.mastery, read.mood),
        outcome.base_score
    );
    assert_eq!(read.missed_minutes, outcome.missed_minutes);
    assert!(read.missed_minutes > 0.0, "the worker walked in late");
    assert!(read.attended);
    let job = &pack(&sim).careers[0];
    assert_eq!(read.fit, fit(sim.world(), pack(&sim), job, actor));
    assert_eq!(read.trait_fit, trait_fit(sim.world(), job, actor));
    assert_eq!(
        read.social_capacity,
        social_capacity(sim.world(), pack(&sim), actor)
    );
    assert_eq!(held.shifts[0], outcome.score);
    assert_eq!(held.last_shift, Some(read), "the last shift read these");
}

/// A shift never worked is a shift not attended, with every minute missed.
#[test]
fn a_shift_with_no_minutes_worked_is_not_attended() {
    let (mut sim, _, id) = fixture(|_| {});
    {
        let mut grid = sim.world_mut().resource_mut::<TileGrid>();
        for x in 1..=3 {
            for y in 3..=5 {
                if (x, y) != (2, 4) {
                    grid.set_blocked(x, y, true);
                }
            }
        }
    }
    tick_until_settled(&mut sim);
    assert_eq!(
        sim.world().resource::<Attendance>().outcomes[0].worked_minutes,
        0.0
    );
    let read = record(&sim, id).shift_inputs[0];
    assert!(!read.attended);
    assert_eq!(read.missed_minutes, SHIFT as f32);
}

/// Item 2: a review writes one row with the means in shift order, the
/// missed sum, the attended count, the career row held and the pay held
/// before the outcome; the shift inputs clear with the scores and the last
/// shift stays ([CT-c-mood]).
#[test]
fn a_review_writes_one_row_with_the_means_and_the_pay_held() {
    let (mut sim, actor, id) = fixture(|pack| pack.tuning.career_raise_base = 1.0);
    let before = record(&sim, id).pay;
    let a = inputs(20.0, true, 30.0);
    let b = inputs(30.0, false, 480.0);
    let c = inputs(40.0, true, 0.0);
    score_into_week(&mut sim, actor, &[a, b, c]);
    run_review(&mut sim, 0);
    let held = record(&sim, id);
    assert_eq!(held.history.len(), 1);
    assert_eq!(
        held.history[0].event, EVENT_RAISE,
        "the outcome changed pay"
    );
    assert_ne!(held.pay, before);
    assert!(held.shift_inputs.is_empty() && held.shifts.is_empty());
    assert_eq!(
        held.last_shift,
        Some(c),
        "the last shift survives the review"
    );
    let mean = |pick: fn(&ShiftInputs) -> f32| (pick(&a) + pick(&b) + pick(&c)) / 3.0;
    assert_eq!(
        held.input_weeks.into_iter().collect::<Vec<_>>(),
        vec![WeekInputs {
            week: 0,
            career: 0,
            shifts: 3,
            attended: 2,
            fit: mean(|x| x.fit),
            trait_fit: mean(|x| x.trait_fit),
            social_capacity: mean(|x| x.social_capacity),
            mastery: mean(|x| x.mastery),
            mood: mean(|x| x.mood),
            missed_minutes: 510.0,
            pay: before,
        }]
    );
}

/// Item 2: a promotion's row carries the level held during the week, and
/// the rows stay with the person through it.
#[test]
fn a_promotions_row_carries_the_old_level_and_the_rows_stay() {
    let (mut sim, actor, id) = fixture(|pack| pack.tuning.career_promote_base = 1.0);
    let job = pack(&sim).careers[0].clone();
    let next = pack(&sim).career_paths[job.path as usize].levels[1];
    edit(&mut sim, id, |r| r.consecutive_good = job.advance_weeks);
    score_into_week(&mut sim, actor, &[inputs(40.0, true, 0.0); 2]);
    run_review(&mut sim, 0);
    assert_eq!(
        sim.world().get::<Career>(actor).unwrap().0,
        next,
        "promoted"
    );
    let rows = record(&sim, id).input_weeks;
    assert_eq!(rows.len(), 1, "a promotion keeps the rows");
    assert_eq!(rows[0].career, 0, "the level held during the week");
}

/// Item 3: a forfeited shift is not scored and so gets no inputs and is not
/// the last shift. A record migrated mid-week, whose scores have no inputs,
/// gets no row for that week and a row the next week.
#[test]
fn a_forfeited_shift_gets_no_inputs_and_a_migrated_week_no_row() {
    let (mut sim, actor, id) = fixture(|_| {});
    complete_attended_shift(sim.world_mut(), actor, 0, 0, 1.0, None, 0);
    let held = record(&sim, id);
    assert!(held.shifts.is_empty() && held.shift_inputs.is_empty());
    assert_eq!(held.last_shift, None);
    // A save from before inputs: two scores and no inputs.
    edit(&mut sim, id, |r| r.shifts.extend([60.0, 70.0]));
    score_into_week(&mut sim, actor, &[inputs(3.0, true, 0.0)]);
    let held = record(&sim, id);
    assert_eq!((held.shifts.len(), held.shift_inputs.len()), (3, 1));
    run_review(&mut sim, 0);
    let held = record(&sim, id);
    assert_eq!(held.history.len(), 1, "the week still scores");
    assert!(held.input_weeks.is_empty(), "but has no row");
    assert!(held.shift_inputs.is_empty(), "inputs clear with the scores");
    score_into_week(&mut sim, actor, &[inputs(3.0, true, 0.0); 2]);
    run_review(&mut sim, 1);
    let rows = record(&sim, id).input_weeks;
    assert_eq!(rows.len(), 1);
    assert_eq!((rows[0].week, rows[0].shifts), (1, 2));
}

/// Item 4: the history keeps the newest `career_input_history_weeks` rows,
/// oldest dropped first.
#[test]
fn the_history_keeps_the_newest_weeks_the_knob_allows() {
    let (mut sim, actor, id) = fixture(|pack| pack.tuning.career_input_history_weeks = 2);
    for week in 0..4 {
        score_into_week(&mut sim, actor, &[inputs(1.0 + week as f32, true, 0.0)]);
        run_review(&mut sim, week);
    }
    let weeks: Vec<u64> = record(&sim, id)
        .input_weeks
        .iter()
        .map(|w| w.week)
        .collect();
    assert_eq!(weeks, vec![2, 3]);
}

/// Item 4: a dismissal drops the record and its rows with it.
#[test]
fn firing_drops_the_rows() {
    let (mut sim, actor, id) = fixture(|pack| pack.tuning.career_fire_base = 1.0);
    edit(&mut sim, id, |r| r.consecutive_poor = 5);
    score_into_week(&mut sim, actor, &[inputs(0.0, true, 0.0)]);
    edit(&mut sim, id, |r| r.shifts = vec![0.0]);
    run_review(&mut sim, 0);
    assert!(sim.world().get::<Career>(actor).is_none(), "fired");
    assert!(!sim.world().resource::<Careers>().records.contains_key(&id));
}

/// Item 4: a player assignment starts a fresh record with nothing in it.
#[test]
fn an_assignment_starts_with_no_inputs() {
    let (mut sim, actor, id) = fixture(|_| {});
    score_into_week(&mut sim, actor, &[inputs(1.0, true, 0.0)]);
    run_review(&mut sim, 0);
    assert_eq!(record(&sim, id).input_weeks.len(), 1);
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::AssignCareer {
            agent: actor.index_u32(),
            path: 0,
        });
    sim.flush_commands();
    let held = record(&sim, id);
    assert!(
        held.input_weeks.is_empty() && held.shift_inputs.is_empty() && held.last_shift.is_none()
    );
}

/// Item 4: an autonomous path change keeps the rows, as it keeps the score
/// history.
#[test]
fn a_path_change_keeps_the_rows() {
    let (mut sim, actor, id) = fixture(|pack| {
        pack.tuning.career_change_fit = 2.0;
        pack.tuning.career_change_gap = -3.0;
        pack.tuning.career_change_chance = 1.0;
    });
    sim.world_mut().resource_mut::<Careers>().autonomous_change = true;
    score_into_week(&mut sim, actor, &[inputs(1.0, true, 0.0)]);
    run_review(&mut sim, 0);
    let held = record(&sim, id);
    assert_eq!(held.history[0].event, EVENT_CHANGED_PATH, "changed path");
    assert_eq!(held.input_weeks.len(), 1, "the row stays");
    assert_eq!(held.input_weeks[0].career, 0, "and names the old row");
}

/// The fixture's world hash on the tree before [CT-save-hash] existed. The
/// block writes nothing while no record holds inputs.
const NO_INPUTS_HASH: u64 = 18140227346257973163;

/// Item 5: a world with no inputs hashes as it did before the block.
#[test]
fn a_world_with_no_inputs_hashes_as_before() {
    let (sim, _, _) = fixture(|_| {});
    assert_eq!(sim.world_hash(), NO_INPUTS_HASH);
}

/// Item 5: a world with inputs hashes the block, and every stored field
/// moves the hash.
#[test]
fn every_stored_input_field_moves_the_hash() {
    let (mut sim, actor, id) = fixture(|_| {});
    score_into_week(&mut sim, actor, &[inputs(2.0, true, 5.0)]);
    run_review(&mut sim, 0);
    score_into_week(&mut sim, actor, &[inputs(3.0, true, 5.0)]);
    let pristine = record(&sim, id);
    let with = sim.world_hash();
    type Flip = fn(&mut Record);
    let flips: [(&str, Flip); 22] = [
        ("current fit", |r| r.shift_inputs[0].fit += 0.5),
        ("current trait", |r| r.shift_inputs[0].trait_fit += 0.5),
        ("current social", |r| {
            r.shift_inputs[0].social_capacity += 0.5
        }),
        ("current mastery", |r| r.shift_inputs[0].mastery += 0.5),
        ("current mood", |r| r.shift_inputs[0].mood += 0.5),
        ("current missed", |r| {
            r.shift_inputs[0].missed_minutes += 1.0
        }),
        ("current attended", |r| r.shift_inputs[0].attended ^= true),
        ("last fit", |r| r.last_shift.as_mut().unwrap().fit += 0.5),
        ("last attended", |r| {
            r.last_shift.as_mut().unwrap().attended ^= true
        }),
        ("last cleared", |r| r.last_shift = None),
        ("week", |r| r.input_weeks[0].week += 1),
        ("career", |r| r.input_weeks[0].career += 1),
        ("shifts", |r| r.input_weeks[0].shifts += 1),
        ("attended", |r| r.input_weeks[0].attended += 1),
        ("mean fit", |r| r.input_weeks[0].fit += 0.5),
        ("mean trait", |r| r.input_weeks[0].trait_fit += 0.5),
        ("mean social", |r| r.input_weeks[0].social_capacity += 0.5),
        ("mean mastery", |r| r.input_weeks[0].mastery += 0.5),
        ("mean mood", |r| r.input_weeks[0].mood += 0.5),
        ("missed sum", |r| r.input_weeks[0].missed_minutes += 1.0),
        ("pay", |r| r.input_weeks[0].pay += 1),
        ("row dropped", |r| {
            r.input_weeks.pop_front();
        }),
    ];
    for (name, flip) in flips {
        edit(&mut sim, id, flip);
        assert_ne!(sim.world_hash(), with, "{name} moves the hash");
        edit(&mut sim, id, |r| *r = pristine.clone());
        assert_eq!(sim.world_hash(), with, "{name} undone");
    }
    // Without any inputs the block writes nothing at all.
    edit(&mut sim, id, |r| {
        r.shift_inputs.clear();
        r.last_shift = None;
        r.input_weeks.clear();
    });
    let mut hasher = terri_core::FnvHasher::default();
    hash_inputs(sim.world(), &mut hasher);
    assert_eq!(hasher.finish(), terri_core::FnvHasher::default().finish());
}
