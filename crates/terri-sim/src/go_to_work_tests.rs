//! Go to work: issues 311 and 317, `docs/specs/2026-11-19-career-tab.md`.
//! The first tests hold the plumbing of [CT-command]: its place in the
//! drain, its count and result, its queue hash and the way older save
//! writers leave it out. The rest hold the behavior of [CT-work]: each
//! state of the box, what the command does, lateness and pay, the guards
//! other code needs for a shift registered before its start, refusals and
//! saves taken mid-wait and determinism ([CT-tests], `go_to_work_tests.rs`
//! items 1 to 9).
use crate::attendance::Attendance;
use crate::careers::{CareerRefusal, CareerResult, Careers, ShiftTimes, WorkStatus};
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::save_v17::{SavedScheduledShift, SavedShiftOutcome};
use terri_core::save_v24::SavedQueuedWorkCommand;
use terri_core::{
    Agent, AtWork, Career, CommandQueue, Commuting, Eating, IntentQueue, NeedId, Needs,
    Personality, Position, Relationships, Satisfaction, SimClock, SimCommand, SimId,
    SimIdAllocator, Socialising, Target, TileGrid,
};

/// Every living person with their id, in id order.
fn household(sim: &mut Sim) -> Vec<(SimId, Entity)> {
    let mut people: Vec<(SimId, Entity)> = sim
        .world_mut()
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(sim.world())
        .map(|(entity, id)| (*id, entity))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    people
}

fn push(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
}

pub(crate) fn issue(sim: &mut Sim, command: SimCommand) {
    push(sim, command);
    sim.flush_commands();
}

/// [CT-command] items 3 and 4: the drain applies `GoToWork` as a career
/// command, so each one handled adds one to the count and sets the result,
/// whatever its outcome. The shipped household's first person is not due
/// when a new game starts, so the request is refused as `NotDue`, and the
/// refusal changes nothing else.
#[test]
fn go_to_work_is_counted_and_reported_like_a_career_command() {
    let mut sim = Sim::new_from_shipped_lot();
    let (_, entity) = household(&mut sim)[0];
    let agent = entity.index_u32();
    let commands = sim.world().resource::<Careers>().commands;
    issue(&mut sim, SimCommand::GoToWork { agent });
    let careers = sim.world().resource::<Careers>();
    assert_eq!(careers.commands, commands + 1);
    assert_eq!(
        careers.last_result,
        Some(CareerResult {
            agent,
            reason: Some(CareerRefusal::NotDue)
        })
    );
    // A refusal changes nothing else: the world hashes as it does after a
    // career command refused for naming no one.
    let mut twin = Sim::new_from_shipped_lot();
    issue(&mut twin, SimCommand::QuitCareer { agent: 99_999 });
    assert_eq!(sim.world_hash(), twin.world_hash());
    assert!(
        sim.world().resource::<CommandQueue>().is_empty(),
        "the drain consumed the command"
    );
    issue(&mut sim, SimCommand::GoToWork { agent });
    assert_eq!(sim.world().resource::<Careers>().commands, commands + 2);
}

/// [CT-command] item 4: the two new refusals are numbered 7 and 8 for the
/// shell, after the six that exist.
#[test]
fn the_new_refusals_are_numbered_for_the_shell() {
    assert_eq!(CareerRefusal::NotDue as u8, 7);
    assert_eq!(CareerRefusal::NoRoute as u8, 8);
    assert_eq!(CareerRefusal::SameShift as u8, 6);
}

/// [CT-command] item 2: a queued `GoToWork` is part of the world hash
/// (`queued-commands-v1`), by its code and by the person it names, and no
/// other career command's hash collides with it.
#[test]
fn a_queued_go_to_work_moves_the_hash_by_code_and_person() {
    let hash_with = |command: Option<SimCommand>| {
        let mut sim = Sim::new_from_shipped_lot();
        if let Some(command) = command {
            push(&mut sim, command);
        }
        sim.world_hash()
    };
    let empty = hash_with(None);
    let three = hash_with(Some(SimCommand::GoToWork { agent: 3 }));
    let four = hash_with(Some(SimCommand::GoToWork { agent: 4 }));
    assert_ne!(three, empty, "a queued command is hashed");
    assert_ne!(three, four, "the person is hashed");
    assert_ne!(
        three,
        hash_with(Some(SimCommand::QuitCareer { agent: 3 })),
        "the code is hashed"
    );
    assert_eq!(
        three,
        hash_with(Some(SimCommand::GoToWork { agent: 3 })),
        "the same queue hashes the same"
    );
}

/// [CT-command] item 5: every writer before schema 24 leaves a queued
/// `GoToWork` out, with the positions it would count, so the rest of the
/// queue saves exactly as it does without it and loads in order. Schema 24
/// carries each one beside its position in the whole queue and loads the
/// queue back exactly.
#[test]
fn older_writers_leave_a_queued_go_to_work_out() {
    let mut with = Sim::new_from_shipped_lot();
    let mut without = Sim::new_from_shipped_lot();
    let agent = household(&mut with)[0].1.index_u32();
    let ordinary = [
        SimCommand::SetSpeed(2),
        SimCommand::SetJobSearch {
            agent,
            search: false,
        },
        SimCommand::ChangeShift { agent, shift: 1 },
        SimCommand::SetSpeed(1),
    ];
    for command in ordinary.iter().cloned() {
        push(&mut without, command);
    }
    for command in [
        ordinary[0].clone(),
        SimCommand::GoToWork { agent },
        ordinary[1].clone(),
        ordinary[2].clone(),
        SimCommand::GoToWork { agent },
        ordinary[3].clone(),
    ] {
        push(&mut with, command);
    }
    assert_eq!(with.save_snapshot_v14(), without.save_snapshot_v14());
    assert_eq!(with.save_snapshot_v15(), without.save_snapshot_v15());
    assert_eq!(with.save_snapshot_v16(), without.save_snapshot_v16());
    assert_eq!(with.save_snapshot_v17(), without.save_snapshot_v17());
    assert_eq!(with.save_snapshot_v18(), without.save_snapshot_v18());
    assert_eq!(with.save_snapshot_v19(), without.save_snapshot_v19());
    assert_eq!(with.save_snapshot_v20(), without.save_snapshot_v20());
    assert_eq!(with.save_snapshot_v21(), without.save_snapshot_v21());
    assert_eq!(with.save_snapshot_v22(), without.save_snapshot_v22());
    assert_eq!(with.save_snapshot_v23(), without.save_snapshot_v23());
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v23(with.save_snapshot_v23())
        .expect("loads");
    assert_eq!(
        loaded.world().resource::<CommandQueue>().as_slice(),
        ordinary.as_slice()
    );
    let current = with.save_snapshot_v24();
    assert_eq!(current.legacy, without.save_snapshot_v23());
    assert_eq!(
        current.queued_work_commands,
        vec![
            (1, SavedQueuedWorkCommand::GoToWork { agent }),
            (4, SavedQueuedWorkCommand::GoToWork { agent }),
        ]
    );
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v24(current).expect("loads");
    assert_eq!(
        loaded.world().resource::<CommandQueue>().as_slice(),
        with.world().resource::<CommandQueue>().as_slice()
    );
    assert_eq!(loaded.world_hash(), with.world_hash());
}

// ---- [CT-work]: the behavior ------------------------------------------

/// The fixture's standard shift: it starts at 10:00 and lasts eight hours.
pub(crate) const START: u64 = 600;
pub(crate) const SHIFT: u32 = 480;
/// The start of the fixture's second shift, offered for the shift change
/// test only.
pub(crate) const LATE_START: u32 = 840;

/// The fixture's objects, by index into what [`fixture`] returns.
const SNACK: usize = 0;
const BED: usize = 1;
pub(crate) const HOLD: usize = 2;

/// A worker at (2, 4) on a 20 by 20 lot with a street exit, holding the
/// first career row with a shift at [`START`] on every day, no decay and
/// no random career events, so nothing moves unless the test moves it. The
/// returned objects are a snack, a bed and a long Fun object an order can
/// hold the worker with ([`SNACK`], [`BED`], [`HOLD`]).
pub(crate) fn fixture(tune: impl Fn(&mut terri_data::ContentPack)) -> (Sim, Entity, Vec<Entity>) {
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
    pack.careers[0].shift_start = START as u32;
    pack.careers[0].shift_ticks = SHIFT;
    pack.careers[0].working_days = 0b111_1111;
    let first = pack.objects.len() as u32;
    pack.objects.extend([
        crate::test_content::object("snack", &[(NeedId::Hunger, 60.0)], 15),
        crate::test_content::object("bed", &[(NeedId::Energy, 60.0)], 200),
        crate::test_content::object("hold", &[(NeedId::Fun, 10.0)], 900),
    ]);
    tune(&mut pack);
    let content = Content(Box::leak(Box::new(pack)));
    let mut sim = Sim::new_with_lot_and_content(20, 20, content);
    let actor = person(&mut sim, Position { x: 2.0, y: 4.0 });
    sim.world_mut().entity_mut(actor).insert(Career(0));
    let objects = (0..3)
        .map(|n| {
            sim.spawn_object(
                Position {
                    x: 6.0 + n as f32 * 3.0,
                    y: 8.0,
                },
                terri_core::ObjectDefId(first + n),
            )
        })
        .collect();
    issue(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: false,
            search: false,
        },
    );
    (sim, actor, objects)
}

/// A person with full needs at `position`, with no job.
fn person(sim: &mut Sim, position: Position) -> Entity {
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    sim.world_mut()
        .spawn((
            Agent,
            id,
            position,
            Needs::all_at(100.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id()
}

pub(crate) fn now(sim: &Sim) -> u64 {
    sim.world().resource::<SimClock>().tick
}

pub(crate) fn at(sim: &mut Sim, tick: u64) {
    sim.world_mut().resource_mut::<SimClock>().tick = tick;
}

pub(crate) fn day_ticks(sim: &Sim) -> u64 {
    u64::from(sim.world().resource::<Content>().0.tuning.day_ticks)
}

pub(crate) fn window(sim: &Sim) -> u64 {
    u64::from(
        sim.world()
            .resource::<Content>()
            .0
            .tuning
            .go_to_work_window_ticks,
    )
}

pub(crate) fn status(sim: &Sim, actor: Entity) -> WorkStatus {
    crate::careers::go_to_work_status(sim.world(), actor, now(sim))
}

fn times(start_tick: u64, ticks: u32) -> ShiftTimes {
    ShiftTimes {
        start_tick,
        end_tick: start_tick + u64::from(ticks),
    }
}

/// Sends `actor` to work and returns the drain's refusal, if any.
pub(crate) fn send(sim: &mut Sim, actor: Entity) -> Option<CareerRefusal> {
    let agent = actor.index_u32();
    issue(sim, SimCommand::GoToWork { agent });
    let result = sim
        .world()
        .resource::<Careers>()
        .last_result
        .expect("the drain reports every career command");
    assert_eq!(result.agent, agent);
    result.reason
}

pub(crate) fn order(sim: &mut Sim, actor: Entity, object: Entity) {
    issue(
        sim,
        SimCommand::UseObject {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        },
    );
}

pub(crate) fn shift(sim: &Sim, actor: Entity) -> Option<SavedScheduledShift> {
    let id = *sim.world().get::<SimId>(actor).unwrap();
    sim.world()
        .get_resource::<Attendance>()
        .and_then(|attendance| attendance.shifts.get(&id).cloned())
}

pub(crate) fn outcomes(sim: &Sim) -> usize {
    sim.world()
        .get_resource::<Attendance>()
        .map_or(0, |attendance| attendance.outcomes.len())
}

fn the_outcome(sim: &Sim) -> SavedShiftOutcome {
    sim.world().resource::<Attendance>().outcomes[0].clone()
}

pub(crate) fn commuting(sim: &Sim, actor: Entity) -> Option<Commuting> {
    sim.world().get::<Commuting>(actor).copied()
}

fn need(sim: &Sim, actor: Entity, need: NeedId) -> f32 {
    sim.world().get::<Needs>(actor).unwrap().get(need)
}

/// What the fixture's standard shift pays when registered, in cents.
fn standard_pay(sim: &Sim) -> i64 {
    let pack = sim.world().resource::<Content>().0;
    let job = &pack.careers[0];
    pack.tuning.shift_pay_cents(job.pay, job.standard_kind)
}

/// Ticks until the shift settles and returns the first tick seen at work.
pub(crate) fn work_the_shift(sim: &mut Sim, actor: Entity) -> u64 {
    let mut arrived = None;
    for _ in 0..START + u64::from(SHIFT) {
        if sim.world().get::<AtWork>(actor).is_some() {
            arrived.get_or_insert(now(sim));
        }
        if outcomes(sim) > 0 {
            break;
        }
        sim.tick();
    }
    assert_eq!(outcomes(sim), 1, "the shift settles once");
    arrived.expect("the worker reached work")
}

/// Ticks from one tick before the start to the start with `needs` set,
/// so the shift registers and the worker meets it in that state.
pub(crate) fn start_with(sim: &mut Sim, actor: Entity, needs: &[(NeedId, f32)]) {
    at(sim, START - 1);
    for (id, level) in needs {
        sim.world_mut()
            .get_mut::<Needs>(actor)
            .unwrap()
            .set(*id, *level);
    }
    sim.tick();
    assert_eq!(now(sim), START);
    assert!(shift(sim, actor).is_some(), "the shift registered");
}

// ---- Item 1: every state of the box ----

/// [CT-ws-none]: a person without a job has no box.
#[test]
fn status_without_a_job_is_none() {
    let (mut sim, actor, _) = fixture(|_| {});
    sim.world_mut().entity_mut(actor).remove::<Career>();
    assert_eq!(status(&sim, actor), WorkStatus::NoJob);
}

/// [CT-ws-due] and [CT-ws-early]: a start exactly `window` ticks away is
/// due; one tick further is too early, and names the same shift.
#[test]
fn status_at_the_window_edge() {
    let (mut sim, actor, _) = fixture(|_| {});
    assert_eq!(window(&sim), 120, "the shipped window");
    let tick = START - window(&sim);
    at(&mut sim, tick);
    assert_eq!(status(&sim, actor), WorkStatus::Due(times(START, SHIFT)));
    assert!(status(&sim, actor).can_go());
    let tick = START - window(&sim) - 1;
    at(&mut sim, tick);
    assert_eq!(
        status(&sim, actor),
        WorkStatus::Early(Some(times(START, SHIFT)))
    );
    assert!(!status(&sim, actor).can_go());
}

/// [CT-work-state]: tomorrow's early-morning shift, seen from late in the
/// evening, is due across midnight.
#[test]
fn status_sees_tomorrows_early_shift_from_late_evening() {
    let (mut sim, actor, _) = fixture(|pack| pack.careers[0].shift_start = 60);
    let day = day_ticks(&sim);
    at(&mut sim, day - 30);
    assert_eq!(status(&sim, actor), WorkStatus::Due(times(day + 60, SHIFT)));
    let tick = day + 60 - window(&sim) - 1;
    at(&mut sim, tick);
    assert_eq!(
        status(&sim, actor),
        WorkStatus::Early(Some(times(day + 60, SHIFT)))
    );
}

/// [CT-ws-early]: tomorrow is a day off, so the shift the evening before
/// is not due, and the box names the next working day's start.
#[test]
fn status_skips_a_day_off() {
    let tuning = &terri_data::pack().tuning;
    let tomorrow = terri_core::clock::weekday(
        u64::from(tuning.day_ticks),
        tuning.day_ticks,
        tuning.first_weekday,
    );
    let (mut sim, actor, _) = fixture(|pack| {
        pack.careers[0].shift_start = 60;
        pack.careers[0].working_days = 0b111_1111 & !(1 << tomorrow);
    });
    let day = day_ticks(&sim);
    at(&mut sim, day - 30);
    assert_eq!(
        status(&sim, actor),
        WorkStatus::Early(Some(times(2 * day + 60, SHIFT)))
    );
}

/// [CT-work-state]: on the day of a shift change the shift held when the
/// day began still runs, so its start is due and the new shift's start
/// that afternoon is not; the new shift's first start is tomorrow.
#[test]
fn status_on_the_day_of_a_shift_change_follows_the_old_shift() {
    let (mut sim, actor, _) = fixture(|pack| {
        let job = &mut pack.careers[0];
        job.standard_weight = 1;
        job.shifts = vec![terri_data::CompiledShift {
            id: "late".into(),
            kind: terri_data::SHIFT_LATE,
            shift_start: LATE_START,
            shift_ticks: SHIFT,
            working_days: 0b111_1111,
            weight: 1,
        }];
    });
    at(&mut sim, 100);
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: actor.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .unwrap()
            .reason,
        None,
        "the shift changed"
    );
    let tick = START - window(&sim);
    at(&mut sim, tick);
    assert_eq!(status(&sim, actor), WorkStatus::Due(times(START, SHIFT)));
    let tick = u64::from(LATE_START) - window(&sim);
    at(&mut sim, tick);
    let day = day_ticks(&sim);
    assert_eq!(
        status(&sim, actor),
        WorkStatus::Early(Some(times(day + u64::from(LATE_START), SHIFT)))
    );
}

/// [CT-ws-early]: after today's shift has settled, the next start is
/// tomorrow's, and the settled record is not an open shift.
#[test]
fn status_after_a_settled_shift_today_is_tomorrow() {
    let (mut sim, actor, _) = fixture(|_| {});
    let id = *sim.world().get::<SimId>(actor).unwrap();
    let end = START + u64::from(SHIFT);
    let pay_cents = standard_pay(&sim);
    sim.world_mut().insert_resource(Attendance {
        shifts: [(
            id,
            SavedScheduledShift {
                sim: id.0,
                career: 0,
                start_tick: START,
                end_tick: end,
                worked_ticks: u64::from(SHIFT),
                accounted_tick: end,
                pay_cents,
                settled: true,
                legacy: false,
            },
        )]
        .into(),
        outcomes: Vec::new(),
        replaced: Default::default(),
    });
    at(&mut sim, end + 10);
    let day = day_ticks(&sim);
    assert_eq!(
        status(&sim, actor),
        WorkStatus::Early(Some(times(day + START, SHIFT)))
    );
}

/// [CT-ws-late]: a worker kept home past the start by a critical need has
/// an open shift that has started.
#[test]
fn status_late_while_held_home() {
    let (mut sim, actor, _) = fixture(|_| {});
    start_with(&mut sim, actor, &[(NeedId::Hunger, 5.0)]);
    sim.tick();
    assert_eq!(commuting(&sim, actor), None, "held home by hunger");
    assert_eq!(status(&sim, actor), WorkStatus::Late(times(START, SHIFT)));
}

/// [CT-ws-out], [CT-ws-work] and [CT-ws-home]: on the way out, at work
/// until the scheduled end, and on the way home.
#[test]
fn status_while_away() {
    let (mut sim, actor, _) = fixture(|_| {});
    start_with(&mut sim, actor, &[]);
    assert_eq!(commuting(&sim, actor), Some(Commuting::Outbound));
    assert_eq!(status(&sim, actor), WorkStatus::Outbound);
    while sim.world().get::<AtWork>(actor).is_none() {
        assert!(now(&sim) < START + 200, "never arrived");
        sim.tick();
    }
    assert_eq!(
        status(&sim, actor),
        WorkStatus::AtWork {
            end_tick: START + u64::from(SHIFT)
        }
    );
    sim.world_mut()
        .entity_mut(actor)
        .remove::<AtWork>()
        .insert(Commuting::Inbound);
    assert_eq!(status(&sim, actor), WorkStatus::Inbound);
}

// ---- Items 2 and 3: due, before the start ----

/// [CT-work-effect] items 3 and 4 and [CT-work-time] items 1 to 3: the
/// command departs on the drain tick and registers the shift with its
/// scheduled times and the pay the start would record. The worker arrives
/// before the start, accrues nothing until it, and is paid in full with
/// no missed minutes and no deduction.
#[test]
fn a_worker_sent_before_the_start_leaves_now_and_is_paid_in_full() {
    let (mut sim, actor, _) = fixture(|_| {});
    let sent = START - window(&sim);
    at(&mut sim, sent);
    let funds = sim.funds();
    assert_eq!(send(&mut sim, actor), None);
    assert_eq!(now(&sim), sent);
    assert_eq!(
        commuting(&sim, actor),
        Some(Commuting::Outbound),
        "leaves on the drain tick"
    );
    let id = sim.world().get::<SimId>(actor).unwrap().0;
    assert_eq!(
        shift(&sim, actor),
        Some(SavedScheduledShift {
            sim: id,
            career: 0,
            start_tick: START,
            end_tick: START + u64::from(SHIFT),
            worked_ticks: 0,
            accounted_tick: START,
            pay_cents: standard_pay(&sim),
            settled: false,
            legacy: false,
        })
    );
    let mut arrived = None;
    while now(&sim) < START {
        sim.tick();
        if sim.world().get::<AtWork>(actor).is_some() {
            arrived.get_or_insert(now(&sim));
        }
        let open = shift(&sim, actor).unwrap();
        assert_eq!(
            (open.worked_ticks, open.accounted_tick),
            (0, START),
            "nothing accrues before the start, tick {}",
            now(&sim)
        );
    }
    let arrived = arrived.expect("arrived before the start");
    assert!(arrived < START, "arrived at {arrived}");
    work_the_shift(&mut sim, actor);
    let outcome = the_outcome(&sim);
    assert_eq!(
        (outcome.start_tick, outcome.end_tick),
        (START, START + u64::from(SHIFT))
    );
    assert_eq!(outcome.worked_minutes, SHIFT as f32);
    assert_eq!(outcome.missed_minutes, 0.0);
    assert_eq!(outcome.deduction, 0.0);
    assert_eq!(outcome.pay_cents, standard_pay(&sim));
    assert_eq!(
        sim.funds(),
        funds + standard_pay(&sim),
        "paid once, in full"
    );
}

/// [CT-c-legacy]: an early arrival is never paid as untracked legacy work,
/// a countdown of a full shift from the arrival paid through
/// `complete_shift`. Only the registered shift settles, at its scheduled
/// end, and the worker is home after it.
#[test]
fn an_early_arrival_is_not_paid_as_legacy_work() {
    let (mut sim, actor, _) = fixture(|_| {});
    let tick = START - window(&sim);
    at(&mut sim, tick);
    let funds = sim.funds();
    assert_eq!(send(&mut sim, actor), None);
    work_the_shift(&mut sim, actor);
    assert_eq!(now(&sim), START + u64::from(SHIFT), "settled at the end");
    assert_eq!(the_outcome(&sim).start_tick, START);
    assert!(
        sim.world().get::<AtWork>(actor).is_none(),
        "no countdown keeps them at work"
    );
    for _ in 0..SHIFT {
        sim.tick();
    }
    assert_eq!(sim.funds(), funds + standard_pay(&sim), "no second payment");
    assert_eq!(outcomes(&sim), 1);
}

// ---- Item 4: late ----

/// [CT-work-effect] item 5 and [CT-work-time] item 4: a worker held home
/// by a critical Hunger leaves on the drain tick with the need untouched,
/// and the minutes from the start to the arrival are missed, inside the
/// grace, so there is no deduction.
#[test]
fn a_late_worker_held_by_hunger_leaves_on_the_drain_tick() {
    let (mut sim, actor, objects) = fixture(|_| {});
    // Nothing to eat, so the need stays critical while they wait.
    sim.world_mut().despawn(objects[SNACK]);
    start_with(&mut sim, actor, &[(NeedId::Hunger, 5.0)]);
    for _ in 0..30 {
        sim.tick();
        assert_eq!(commuting(&sim, actor), None, "still held by hunger");
    }
    assert_eq!(need(&sim, actor, NeedId::Hunger), 5.0, "still critical");
    assert_eq!(send(&mut sim, actor), None);
    assert_eq!(commuting(&sim, actor), Some(Commuting::Outbound));
    assert_eq!(need(&sim, actor, NeedId::Hunger), 5.0, "needs untouched");
    let arrived = work_the_shift(&mut sim, actor);
    let outcome = the_outcome(&sim);
    assert_eq!(outcome.missed_minutes, (arrived - START) as f32);
    assert_eq!(outcome.deduction, 0.0, "inside the grace");
}

/// [CT-work-time] item 4: past the grace the deduction is the usual 10
/// points an hour; the order that kept the worker home is cancelled.
#[test]
fn a_very_late_worker_keeps_the_usual_deduction() {
    let (mut sim, actor, objects) = fixture(|_| {});
    at(&mut sim, START - 10);
    order(&mut sim, actor, objects[HOLD]);
    while now(&sim) < START + 200 {
        sim.tick();
        assert_eq!(commuting(&sim, actor), None, "held by the order");
    }
    assert_eq!(send(&mut sim, actor), None);
    assert_eq!(commuting(&sim, actor), Some(Commuting::Outbound));
    assert!(!crate::player_actions::has_player_work(sim.world(), actor));
    let arrived = work_the_shift(&mut sim, actor);
    let outcome = the_outcome(&sim);
    let missed = (arrived - START) as f32;
    assert!(missed > 200.0);
    assert_eq!(outcome.missed_minutes, missed);
    assert_eq!(outcome.deduction, (missed - 120.0) / 60.0 * 10.0);
}

// ---- Item 5: bypasses ----

/// Orders `object`, ticks until the worker is using it, then moves the
/// clock to the start of the window.
fn busy_with(sim: &mut Sim, actor: Entity, object: Entity) {
    at(sim, 0);
    order(sim, actor, object);
    for _ in 0..200 {
        if sim.world().get::<Eating>(actor).is_some() {
            break;
        }
        sim.tick();
    }
    assert!(sim.world().get::<Eating>(actor).is_some(), "in use");
    let start = START - window(sim);
    at(sim, start);
}

/// [CT-work-effect] items 4 and 5 and [CT-q-asleep]: a sleeping worker
/// with Energy at 0 wakes and leaves; the bed is released.
#[test]
fn a_sleeping_worker_wakes_and_leaves() {
    let (mut sim, actor, objects) = fixture(|_| {});
    busy_with(&mut sim, actor, objects[BED]);
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Energy, 0.0);
    assert_eq!(send(&mut sim, actor), None);
    assert_eq!(commuting(&sim, actor), Some(Commuting::Outbound));
    assert!(sim.world().get::<Eating>(actor).is_none(), "awake");
    assert!(sim.world().get::<Target>(actor).is_none());
    assert!(
        sim.world()
            .get::<terri_core::Reserved>(objects[BED])
            .is_none(),
        "the bed is free"
    );
}

/// [CT-work-effect] item 4: a meal in progress is dropped.
#[test]
fn a_worker_mid_meal_leaves() {
    let (mut sim, actor, objects) = fixture(|_| {});
    busy_with(&mut sim, actor, objects[SNACK]);
    assert_eq!(send(&mut sim, actor), None);
    assert_eq!(commuting(&sim, actor), Some(Commuting::Outbound));
    assert!(sim.world().get::<Eating>(actor).is_none());
    assert!(sim
        .world()
        .get::<terri_core::Reserved>(objects[SNACK])
        .is_none());
}

/// [CT-work-effect] item 4: a conversation ends, and the partner no
/// longer targets the worker.
#[test]
fn a_worker_in_a_conversation_leaves_and_the_partner_lets_go() {
    let (mut sim, actor, _) = fixture(|_| {});
    let partner = person(&mut sim, Position { x: 4.0, y: 4.0 });
    at(&mut sim, 0);
    issue(
        &mut sim,
        SimCommand::TalkTo {
            agent: actor.index_u32(),
            target: partner.index_u32(),
            interaction: 0,
        },
    );
    for _ in 0..200 {
        if sim.world().get::<Socialising>(actor).is_some() {
            break;
        }
        sim.tick();
    }
    assert!(sim.world().get::<Socialising>(actor).is_some(), "talking");
    let start = START - window(&sim);
    at(&mut sim, start);
    assert_eq!(send(&mut sim, actor), None);
    assert_eq!(commuting(&sim, actor), Some(Commuting::Outbound));
    assert!(sim.world().get::<Socialising>(actor).is_none());
    assert!(
        sim.world()
            .get::<Target>(partner)
            .is_none_or(|target| target.object != actor),
        "the partner no longer targets the worker"
    );
}

/// [CT-work-effect] item 1 and [CT-q-orders]: queued orders are cancelled
/// exactly as Cancel orders cancels them: a twin given `CancelIntents`
/// instead holds the same queue and the same player actions.
#[test]
fn queued_orders_are_cancelled_as_cancel_orders_does() {
    let build = || {
        let (mut sim, actor, objects) = fixture(|_| {});
        let start = START - window(&sim);
        at(&mut sim, start);
        order(&mut sim, actor, objects[HOLD]);
        order(&mut sim, actor, objects[SNACK]);
        assert!(crate::player_actions::has_player_work(sim.world(), actor));
        (sim, actor)
    };
    let (mut sent, actor) = build();
    let (mut twin, twin_actor) = build();
    assert_eq!(send(&mut sent, actor), None);
    issue(
        &mut twin,
        SimCommand::CancelIntents {
            agent: twin_actor.index_u32(),
        },
    );
    assert!(!crate::player_actions::has_player_work(sent.world(), actor));
    assert_eq!(
        sent.world().get::<IntentQueue>(actor),
        twin.world().get::<IntentQueue>(twin_actor)
    );
    let orders = |sim: &Sim| {
        sim.world()
            .get_resource::<crate::player_actions::PlayerActions>()
            .map(|actions| {
                (
                    actions.orders.keys().map(|(_, id)| *id).collect::<Vec<_>>(),
                    actions.next_acceptance,
                )
            })
    };
    assert_eq!(orders(&sent), orders(&twin));
}

// ---- Item 6: refusals change nothing ----

/// Builds two identical fixtures, prepares both with `setup`, sends one
/// to work and gives the twin a career command refused for naming no one,
/// then checks the refusal and that the two worlds hash the same.
fn refused(setup: impl Fn(&mut Sim, Entity, &[Entity]) -> u32, expected: CareerRefusal) {
    let (mut sim, actor, objects) = fixture(|_| {});
    let (mut twin, twin_actor, twin_objects) = fixture(|_| {});
    let agent = setup(&mut sim, actor, &objects);
    setup(&mut twin, twin_actor, &twin_objects);
    assert_eq!(sim.world_hash(), twin.world_hash(), "the same start");
    issue(&mut sim, SimCommand::GoToWork { agent });
    issue(&mut twin, SimCommand::QuitCareer { agent: 99_999 });
    assert_eq!(
        sim.world().resource::<Careers>().last_result,
        Some(CareerResult {
            agent,
            reason: Some(expected)
        })
    );
    assert_eq!(sim.world_hash(), twin.world_hash(), "{expected:?}");
}

/// Moves the clock to the start of the window.
fn due(sim: &mut Sim) {
    let start = START - window(sim);
    at(sim, start);
}

#[test]
fn refusal_not_a_person_changes_nothing() {
    refused(
        |sim, _, _| {
            due(sim);
            99_999
        },
        CareerRefusal::NotAPerson,
    );
}

#[test]
fn refusal_away_changes_nothing() {
    refused(
        |sim, actor, _| {
            due(sim);
            sim.world_mut().entity_mut(actor).insert(Commuting::Inbound);
            actor.index_u32()
        },
        CareerRefusal::AtWork,
    );
}

#[test]
fn refusal_no_job_changes_nothing() {
    refused(
        |sim, actor, _| {
            due(sim);
            sim.world_mut().entity_mut(actor).remove::<Career>();
            actor.index_u32()
        },
        CareerRefusal::NotEmployed,
    );
}

#[test]
fn refusal_not_due_changes_nothing() {
    refused(
        |sim, actor, objects| {
            let early = START - window(sim) - 1;
            at(sim, early);
            order(sim, actor, objects[HOLD]);
            actor.index_u32()
        },
        CareerRefusal::NotDue,
    );
}

/// Walled in with an order running: the order survives and no shift is
/// registered, because the route is checked before anything changes.
#[test]
fn refusal_no_route_changes_nothing() {
    refused(
        |sim, actor, objects| {
            due(sim);
            order(sim, actor, objects[HOLD]);
            let mut grid = sim.world_mut().resource_mut::<TileGrid>();
            for x in 1..=3 {
                for y in 3..=5 {
                    if (x, y) != (2, 4) {
                        grid.set_blocked(x, y, true);
                    }
                }
            }
            actor.index_u32()
        },
        CareerRefusal::NoRoute,
    );
}

// ---- Item 7: guards for a shift registered before its start ----

/// [CT-work-guards] item 2: a shift registered before its start and then
/// closed by a quit (the worker was sent home by an order first) is
/// removed, not scored as a fully missed shift.
#[test]
fn a_not_started_shift_closed_by_a_quit_is_removed() {
    let (mut sim, actor, objects) = fixture(|_| {});
    due(&mut sim);
    let funds = sim.funds();
    assert_eq!(send(&mut sim, actor), None);
    order(&mut sim, actor, objects[HOLD]);
    assert_eq!(
        commuting(&sim, actor),
        Some(Commuting::Inbound),
        "sent home"
    );
    sim.world_mut()
        .entity_mut(actor)
        .remove::<terri_core::Path>();
    crate::attendance::finish_tick(sim.world_mut());
    assert_eq!(commuting(&sim, actor), None, "home");
    assert!(shift(&sim, actor).is_some_and(|s| !s.settled));
    issue(
        &mut sim,
        SimCommand::QuitCareer {
            agent: actor.index_u32(),
        },
    );
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .unwrap()
            .reason,
        None,
        "quit"
    );
    assert_eq!(shift(&sim, actor), None, "removed");
    assert_eq!(outcomes(&sim), 0, "not scored");
    assert_eq!(sim.funds(), funds);
}

/// Registering tomorrow's shift for Go to work replaces the person's one
/// attendance record, so removing it on a quit must give back the shift
/// settled today. Without it the one-paid-shift-a-day rule loses its
/// history and a shift later the same day would start and be paid twice.
#[test]
fn removing_a_not_started_shift_keeps_the_record_of_the_one_settled_today() {
    let (mut sim, actor, objects) = fixture(|_| {});
    work_the_shift(&mut sim, actor);
    for _ in 0..400 {
        if commuting(&sim, actor).is_none() && sim.world().get::<AtWork>(actor).is_none() {
            break;
        }
        sim.tick();
    }
    let settled = shift(&sim, actor).expect("today's shift is on record");
    assert!(settled.settled);
    let tomorrow = day_ticks(&sim) + START - window(&sim);
    at(&mut sim, tomorrow);
    assert_eq!(send(&mut sim, actor), None);
    assert!(shift(&sim, actor).is_some_and(|s| !s.settled && s.start_tick > START + 100));
    order(&mut sim, actor, objects[HOLD]);
    sim.world_mut()
        .entity_mut(actor)
        .remove::<terri_core::Path>();
    crate::attendance::finish_tick(sim.world_mut());
    assert_eq!(commuting(&sim, actor), None, "home");
    issue(
        &mut sim,
        SimCommand::QuitCareer {
            agent: actor.index_u32(),
        },
    );
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .unwrap()
            .reason,
        None,
        "quit"
    );
    // The record the registration replaced comes back exactly, its shift
    // pay included, whatever the outcome paid
    // (`go_to_work_removal_tests.rs` holds the saves).
    assert_eq!(shift(&sim, actor), Some(settled), "today's record is back");
    assert_eq!(outcomes(&sim), 1, "nothing scored by the removal");
    // One paid shift a day: no other shift starts on the day that record
    // began, whatever its start time.
    let pack = sim.world().resource::<Content>().0;
    let id = *sim.world().get::<SimId>(actor).unwrap();
    let later = terri_data::ShiftView {
        index: 0,
        id: "standard",
        kind: 0,
        shift_start: (START + 50) as u32,
        shift_ticks: SHIFT,
        working_days: 0b111_1111,
        weight: 1,
    };
    assert!(!crate::shifts::starts_at(
        sim.world(),
        pack,
        id,
        0,
        &later,
        START + 50
    ));
}

/// [CT-work-guards] items 3 and 4: before the start the order preflight
/// never reports more minutes remaining than the shift has, and the
/// attendance line reports nothing worked and nothing missed.
#[test]
fn preflight_and_report_before_the_start() {
    let (mut sim, actor, _) = fixture(|_| {});
    due(&mut sim);
    assert_eq!(send(&mut sim, actor), None);
    let agent = [actor.index_u32()];
    while now(&sim) <= START {
        let preflight = crate::attendance::work_conflicts(sim.world(), &agent);
        let conflict = &preflight.conflicts[0];
        assert_eq!(conflict.total_minutes, SHIFT as f32);
        assert_eq!(
            conflict.remaining_minutes,
            SHIFT as f32,
            "tick {}",
            now(&sim)
        );
        let report = crate::attendance::report(sim.world(), actor);
        assert_eq!(
            (report[0], report[1], report[2]),
            (SHIFT as f32, 0.0, 0.0),
            "tick {}",
            now(&sim)
        );
        sim.tick();
    }
}

/// [CT-work-guards] item 5: `starts_at` lets the registered start pass,
/// and the start tick keeps the registered shift rather than registering
/// it again.
#[test]
fn the_start_tick_keeps_the_registered_shift() {
    let (mut sim, actor, _) = fixture(|_| {});
    due(&mut sim);
    assert_eq!(send(&mut sim, actor), None);
    let registered = shift(&sim, actor).unwrap();
    let pack = sim.world().resource::<Content>().0;
    let id = *sim.world().get::<SimId>(actor).unwrap();
    let standard = pack.careers[0].shift(0).unwrap();
    assert!(crate::shifts::starts_at(
        sim.world(),
        pack,
        id,
        0,
        &standard,
        START
    ));
    while now(&sim) < START {
        sim.tick();
    }
    assert_eq!(shift(&sim, actor), Some(registered), "kept as registered");
}

/// [CT-work-guards] item 1: a save taken while a registered shift waits
/// for its start validates; one whose start is past the window, whose
/// accounting moved, which holds worked time or which names another
/// career does not.
#[test]
fn a_saved_shift_registered_before_its_start_validates() {
    let (mut sim, actor, _) = fixture(|_| {});
    due(&mut sim);
    assert_eq!(send(&mut sim, actor), None);
    let saved = crate::attendance::to_saved(sim.world());
    assert_eq!(
        crate::attendance::validate_saved(sim.world(), &saved),
        Ok(())
    );
    let refuses = |change: &dyn Fn(&mut SavedScheduledShift)| {
        let mut bad = saved.clone();
        change(&mut bad.shifts[0]);
        crate::attendance::validate_saved(sim.world(), &bad).is_err()
    };
    assert!(refuses(&|s| s.accounted_tick -= 1), "accounting moved back");
    assert!(refuses(&|s| s.worked_ticks = 1), "worked time");
    assert!(refuses(&|s| s.career = 1), "not the current career");
    // The same shift seen one tick earlier starts one tick past the window,
    // and is valid in every other way.
    let sent = now(&sim);
    at(&mut sim, sent - 1);
    assert!(
        crate::attendance::validate_saved(sim.world(), &saved).is_err(),
        "a start one tick past the window"
    );
    at(&mut sim, sent);
    // The real load path reaches the same check: waiting at work before
    // the start, the world saves and loads back to the same hash.
    while sim.world().get::<AtWork>(actor).is_none() {
        assert!(now(&sim) < START, "arrived before the start");
        sim.tick();
    }
    let hash = sim.world_hash();
    let snapshot = sim.save_snapshot_v24();
    sim.load_snapshot_v24(snapshot).expect("loads");
    assert_eq!(sim.world_hash(), hash);
}

// ---- Item 8: saves mid-wait ----

/// The fixture as a load leaves it. The fixture as built never assigns its
/// bed to the worker, while the same world after a load does on its next
/// tick (measured: the saved bed assignments differ one tick after the
/// load, with equal hashes at the load). That difference comes from how the
/// fixture places its objects, not from Go to work, so both sides of the
/// comparison below start from a loaded world.
fn loaded_fixture() -> (Sim, Entity, Vec<Entity>) {
    let (mut sim, actor, objects) = fixture(|_| {});
    let snapshot = sim.save_snapshot_v24();
    sim.load_snapshot_v24(snapshot).expect("loads");
    (sim, actor, objects)
}

/// Saves `sim` with the current schema, loads it into a fresh fixture and
/// ticks both until the shift settles, comparing the world hash on every
/// tick, then once more after the settlement.
fn assert_reload_continues(mut sim: Sim) {
    let (mut loaded, _, _) = fixture(|_| {});
    loaded
        .load_snapshot_v24(sim.save_snapshot_v24())
        .expect("loads");
    assert_eq!(loaded.world_hash(), sim.world_hash(), "after the load");
    let last = START + u64::from(SHIFT) + window(&sim);
    while outcomes(&sim) == 0 {
        assert!(now(&sim) <= last, "the shift settles by its end");
        sim.tick();
        loaded.tick();
        assert_eq!(loaded.world_hash(), sim.world_hash(), "tick {}", now(&sim));
    }
    assert_eq!(outcomes(&loaded), 1);
    sim.tick();
    loaded.tick();
    assert_eq!(loaded.world_hash(), sim.world_hash(), "after settling");
    assert_eq!(
        sim.save_snapshot_v24().career_inputs.len(),
        1,
        "the settled shift's inputs are kept"
    );
    assert_eq!(
        loaded.save_snapshot_v24().career_inputs,
        sim.save_snapshot_v24().career_inputs
    );
}

/// [CT-tests] item 8: a save taken while a worker sent before the start
/// waits at work, and one taken with Go to work still queued, both reload
/// and run on with the same world hash on every tick to the shift's
/// settlement.
#[test]
fn saves_while_waiting_at_work_or_with_go_to_work_queued_continue_identically() {
    let (mut sim, actor, _) = loaded_fixture();
    due(&mut sim);
    assert_eq!(send(&mut sim, actor), None);
    while sim.world().get::<AtWork>(actor).is_none() {
        assert!(now(&sim) < START, "arrives before the start");
        sim.tick();
    }
    assert_reload_continues(sim);

    let (mut sim, actor, _) = loaded_fixture();
    due(&mut sim);
    let agent = actor.index_u32();
    push(&mut sim, SimCommand::GoToWork { agent });
    assert_eq!(
        sim.save_snapshot_v24().queued_work_commands,
        vec![(0, SavedQueuedWorkCommand::GoToWork { agent })]
    );
    assert_reload_continues(sim);
}

// ---- Item 9: determinism ----

/// [CT-command] item 6: the command draws nothing, and two runs with the
/// same commands hash the same on every tick to the shift's settlement.
#[test]
fn go_to_work_is_deterministic_and_draws_nothing() {
    let run = || {
        let (mut sim, actor, objects) = fixture(|_| {});
        due(&mut sim);
        order(&mut sim, actor, objects[HOLD]);
        let draws = |sim: &Sim| {
            let careers = sim.world().resource::<Careers>();
            (careers.draws, careers.shift_draws)
        };
        let before = draws(&sim);
        assert_eq!(send(&mut sim, actor), None);
        assert_eq!(draws(&sim), before, "no draw");
        let mut hashes = Vec::new();
        for _ in 0..window(&sim) + u64::from(SHIFT) + 1 {
            hashes.push(sim.world_hash());
            sim.tick();
        }
        assert_eq!(outcomes(&sim), 1);
        hashes
    };
    assert_eq!(run(), run());
}

#[path = "go_to_work_removal_tests.rs"]
mod removal;
