//! Issue 309: bounded lateness for critical needs and Bladder relief at
//! work. Every test drives the real tick and follows observable events,
//! not guessed ticks ([L-career-tests-follow-events-not-guessed-ticks]).
use super::*;
use crate::attendance::Attendance;
use crate::{Content, Sim};
use terri_core::{
    Agent, AtWork, Career, CommandQueue, Commuting, Eating, IntentQueue, Personality, Position,
    Relationships, Satisfaction, SimClock, SimCommand, SimId, SimIdAllocator,
};

/// The scheduled start of the fixture's shift.
const START: u64 = 60;

#[derive(Clone, Copy)]
enum Furniture {
    /// Hunger plus 60 over 15 ticks.
    Snack,
    /// Energy plus 60 over 200 ticks.
    Bed,
    /// An order a player can hold the worker with: Fun over 900 ticks.
    Hold,
    /// A weak remedy: Hunger plus 5 over 15 ticks.
    WeakSnack,
    /// A strong unrelated attraction: Fun plus 100 over 60 ticks.
    Tv,
}

/// A worker at (2, 4) with a shift at [`START`], no decay and no random
/// career events, so needs move only when something in the test moves them.
fn fixture(
    shift_ticks: u32,
    furniture: &[Furniture],
    tune: impl Fn(&mut terri_data::ContentPack),
) -> (Sim, Entity, Vec<Entity>) {
    let (mut sim, actor, defs) = fixture_without_furniture(shift_ticks, furniture, tune);
    let objects = defs
        .into_iter()
        .enumerate()
        .map(|(n, def)| place(&mut sim, n, def))
        .collect();
    (sim, actor, objects)
}

/// Spawns the `n`th of the fixture's objects at its own spot.
fn place(sim: &mut Sim, n: usize, def: terri_core::ObjectDefId) -> Entity {
    sim.spawn_object(
        Position {
            x: 4.0 + n as f32 * 2.0,
            y: 4.0,
        },
        def,
    )
}

/// The fixture with its furniture defined in the pack but not yet placed,
/// returning the definitions, for a test that adds the furniture later.
fn fixture_without_furniture(
    shift_ticks: u32,
    furniture: &[Furniture],
    tune: impl Fn(&mut terri_data::ContentPack),
) -> (Sim, Entity, Vec<terri_core::ObjectDefId>) {
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
    pack.careers[0].shift_ticks = shift_ticks;
    pack.careers[0].working_days = 0b1111111;
    let mut ids = Vec::new();
    for item in furniture {
        ids.push(terri_core::ObjectDefId(pack.objects.len() as u32));
        pack.objects.push(match item {
            Furniture::Snack => crate::test_content::object("snack", &[(NeedId::Hunger, 60.0)], 15),
            Furniture::Bed => crate::test_content::object("bed", &[(NeedId::Energy, 60.0)], 200),
            Furniture::Hold => crate::test_content::object("hold", &[(NeedId::Fun, 10.0)], 900),
            Furniture::WeakSnack => {
                crate::test_content::object("weak_snack", &[(NeedId::Hunger, 5.0)], 15)
            }
            Furniture::Tv => crate::test_content::object("tv", &[(NeedId::Fun, 100.0)], 60),
        });
    }
    tune(&mut pack);
    let content = Content(Box::leak(Box::new(pack)));
    let mut sim = Sim::new_with_lot_and_content(20, 20, content);
    let id = sim.world_mut().resource_mut::<SimIdAllocator>().issue();
    let actor = sim
        .world_mut()
        .spawn((
            Agent,
            id,
            Career(0),
            Position { x: 2.0, y: 4.0 },
            Needs::all_at(100.0),
            IntentQueue::default(),
            Personality::default(),
            Relationships::default(),
            Satisfaction::from_value(0.0),
        ))
        .id();
    command(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: false,
            search: false,
        },
    );
    (sim, actor, ids)
}

fn command(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
    sim.flush_commands();
}
fn now(sim: &Sim) -> u64 {
    sim.world().resource::<SimClock>().tick
}
fn commuting(sim: &Sim, actor: Entity) -> bool {
    sim.world().get::<Commuting>(actor).is_some()
}
fn need(sim: &Sim, actor: Entity, id: NeedId) -> f32 {
    sim.world().get::<Needs>(actor).unwrap().get(id)
}
fn shift(sim: &Sim, actor: Entity) -> Option<SavedScheduledShift> {
    let id = *sim.world().get::<SimId>(actor).unwrap();
    sim.world()
        .resource::<Attendance>()
        .shifts
        .get(&id)
        .cloned()
}
/// Sets the needs one tick before the shift starts, then runs that tick, so
/// the worker is in the state under test on the start tick itself.
fn start_with(sim: &mut Sim, actor: Entity, set: &[(NeedId, f32)]) {
    sim.world_mut().resource_mut::<SimClock>().tick = START - 1;
    for (id, level) in set {
        sim.world_mut()
            .get_mut::<Needs>(actor)
            .unwrap()
            .set(*id, *level);
    }
    sim.tick();
    assert_eq!(now(sim), START);
    assert!(
        shift(sim, actor).is_some(),
        "the shift registers on its start tick"
    );
}
/// Ticks until the worker is commuting and returns that tick, checking on
/// the way that the worker never left earlier than the caller's floor.
fn depart_tick(sim: &mut Sim, actor: Entity, budget: u64) -> Option<u64> {
    for _ in 0..budget {
        if commuting(sim, actor) {
            return Some(now(sim));
        }
        sim.tick();
    }
    commuting(sim, actor).then(|| now(sim))
}

/// [WL-depart]: a critically hungry worker deals with it first, finishes
/// the meal and then leaves, late but within the limit; the start tick
/// itself sees no departure.
#[test]
fn a_worker_in_a_hunger_crisis_at_shift_start_eats_then_leaves() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    assert!(!commuting(&sim, actor), "no departure on the start tick");
    let mut ate = false;
    let mut left = None;
    for _ in 0..100 {
        sim.tick();
        ate |= sim.world().get::<Eating>(actor).is_some();
        if commuting(&sim, actor) {
            left = Some(now(&sim));
            break;
        }
    }
    let left = left.expect("the worker leaves for work");
    assert!(ate, "the worker ate before leaving");
    assert!(
        left > START && left < START + 60,
        "late but inside the limit: left at {left}"
    );
    assert!(
        need(&sim, actor, NeedId::Hunger) > 20.0,
        "the meal finished before the departure"
    );
    assert!(
        sim.world().get::<Eating>(actor).is_none(),
        "nothing is left running at departure"
    );
}

/// The must-be-negative control ([L51]): with nothing critical the worker
/// leaves on the start tick, as before.
#[test]
fn a_worker_without_a_crisis_leaves_on_the_start_tick() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |_| {});
    start_with(&mut sim, actor, &[]);
    assert!(commuting(&sim, actor));
}

/// Owner decision of 2026-11-15: Bladder never delays a departure.
#[test]
fn a_bladder_crisis_never_delays_departure() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Bladder, 5.0)]);
    assert!(commuting(&sim, actor), "left on the start tick");
}

/// [WL-needs]: only Hunger and Energy count; a crisis of any other need
/// leaves on the start tick.
#[test]
fn other_critical_needs_do_not_delay_work() {
    for uncounted in [
        NeedId::Fun,
        NeedId::Social,
        NeedId::Hygiene,
        NeedId::Comfort,
        NeedId::Bladder,
    ] {
        let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |_| {});
        start_with(&mut sim, actor, &[(uncounted, 0.0)]);
        assert!(
            commuting(&sim, actor),
            "{uncounted:?} left on the start tick"
        );
    }
}

/// [WL-limit]: with no remedy at all the worker still leaves exactly at the
/// scheduled start plus the limit, and not a tick before.
#[test]
fn lateness_ends_at_the_limit_with_no_remedy_to_be_had() {
    let (mut sim, actor, _) = fixture(480, &[], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    let limit = u64::from(
        sim.world()
            .resource::<Content>()
            .0
            .tuning
            .work_lateness_limit_ticks,
    );
    assert_eq!(limit, 60, "the shipped limit");
    for _ in 1..limit {
        sim.tick();
        assert!(
            !commuting(&sim, actor),
            "tick {} is still inside the limit",
            now(&sim)
        );
    }
    sim.tick();
    assert_eq!(now(&sim), START + limit);
    assert!(commuting(&sim, actor), "leaves at the limit");
}

/// [WL-limit]: a remedy still running at the limit is cut off by the
/// ordinary departure, which clears it.
#[test]
fn lateness_ends_at_the_limit_even_mid_remedy() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Bed], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Energy, 10.0)]);
    let mut slept_at_the_end = false;
    let left = loop {
        sim.tick();
        if commuting(&sim, actor) {
            break now(&sim);
        }
        slept_at_the_end = sim.world().get::<Eating>(actor).is_some();
        assert!(now(&sim) < START + 100, "never left");
    };
    assert_eq!(left, START + 60, "leaves exactly at the limit");
    assert!(
        slept_at_the_end,
        "the worker was still sleeping a tick before"
    );
    assert!(
        need(&sim, actor, NeedId::Energy) > 20.0,
        "the need had recovered, so only the running remedy kept the worker"
    );
    assert!(
        sim.world().get::<Eating>(actor).is_none(),
        "the remedy is cleared"
    );
}

/// [WL-limit] and [Q4]: a remedy that has lifted the need above critical
/// still finishes before the departure when it ends inside the limit.
#[test]
fn a_running_remedy_finishes_before_departure() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    let mut above_while_eating = false;
    let left = loop {
        sim.tick();
        let eating = sim.world().get::<Eating>(actor).is_some();
        if eating && need(&sim, actor, NeedId::Hunger) > 20.0 {
            above_while_eating = true;
            assert!(
                !commuting(&sim, actor),
                "left mid-meal at tick {} with hunger above critical",
                now(&sim)
            );
        }
        if commuting(&sim, actor) {
            break now(&sim);
        }
        assert!(now(&sim) < START + 100, "never left");
    };
    assert!(above_while_eating, "the meal lifted hunger before it ended");
    assert!(left < START + 60);
}

/// [WL-depart] item 1: finishing a meal or a sleep holds a worker back only
/// after a critical need has kept them home. A worker who is not critical
/// but happens to be mid-meal or asleep when the shift starts is pulled out
/// on the start tick, as before.
#[test]
fn a_worker_who_is_not_critical_leaves_on_the_start_tick_even_mid_meal() {
    let (mut sim, actor, objects) = fixture(480, &[Furniture::Snack], |_| {});
    let snack = sim
        .world()
        .get::<terri_core::SmartObject>(objects[0])
        .unwrap()
        .0;
    sim.world_mut().resource_mut::<SimClock>().tick = START - 1;
    sim.world_mut().entity_mut(actor).insert(Eating {
        object: snack,
        interaction: 0,
        remaining_ticks: 10,
    });
    sim.tick();
    assert_eq!(now(&sim), START);
    assert!(commuting(&sim, actor), "left on the start tick");
    assert!(sim.world().get::<Eating>(actor).is_none());
}

/// [WL-limit]: a limit of 0 restores leaving on time.
#[test]
fn limit_zero_leaves_on_time() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |pack| {
        pack.tuning.work_lateness_limit_ticks = 0;
    });
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    assert!(commuting(&sim, actor));
}

/// [WL-limit]: lateness never outlasts the shift. A shift shorter than the
/// limit is never left for after its end, and settles once with no pay.
#[test]
fn lateness_never_outlasts_the_shift_end() {
    let (mut sim, actor, _) = fixture(30, &[], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    let end = shift(&sim, actor).unwrap().end_tick;
    assert_eq!(end, START + 30);
    for _ in 0..40 {
        sim.tick();
        assert!(
            !commuting(&sim, actor) || now(&sim) < end,
            "departed at {} after the shift ended at {end}",
            now(&sim)
        );
    }
    let attendance = sim.world().resource::<Attendance>();
    assert_eq!(attendance.outcomes.len(), 1, "settled once");
    assert_eq!(attendance.outcomes[0].pay_cents, 0);
    assert_eq!(attendance.outcomes[0].worked_minutes, 0.0);
    assert!(sim.world().get::<AtWork>(actor).is_none());
}

/// Player orders come first and delay departure without limit; once the
/// order is gone, the allowance is over, so the worker leaves at once even
/// though the need is still critical.
#[test]
fn a_player_order_still_delays_departure_past_the_limit() {
    let (mut sim, actor, objects) = fixture(480, &[Furniture::Hold], |_| {});
    sim.world_mut().resource_mut::<SimClock>().tick = START - 1;
    command(
        &mut sim,
        SimCommand::UseObject {
            agent: actor.index_u32(),
            object: objects[0].index_u32(),
            interaction: 0,
        },
    );
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    for _ in 0..80 {
        sim.tick();
        assert!(
            !commuting(&sim, actor),
            "the order holds the worker at {}",
            now(&sim)
        );
    }
    assert!(now(&sim) > START + 60, "well past the limit");
    command(
        &mut sim,
        SimCommand::CancelIntents {
            agent: actor.index_u32(),
        },
    );
    let left = depart_tick(&mut sim, actor, 5).expect("leaves once the order is gone");
    assert!(left <= now(&sim));
    assert!(need(&sim, actor, NeedId::Hunger) <= 20.0, "still critical");
}

/// [WL-depart] item 5: a worker already commuting or at work is never
/// turned around by a crisis that begins after the departure.
#[test]
fn a_worker_on_the_way_to_work_or_at_work_is_not_turned_back_by_a_crisis() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |_| {});
    start_with(&mut sim, actor, &[]);
    assert!(commuting(&sim, actor));
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Hunger, 5.0);
    let mut arrived = false;
    for _ in 0..200 {
        sim.tick();
        assert_ne!(
            sim.world().get::<Commuting>(actor),
            Some(&Commuting::Inbound),
            "turned back at {}",
            now(&sim)
        );
        let at_work = sim.world().get::<AtWork>(actor).is_some();
        if !at_work {
            assert!(need(&sim, actor, NeedId::Hunger) <= 5.0);
        }
        assert!(sim.world().get::<Eating>(actor).is_none());
        arrived |= at_work;
    }
    assert!(arrived, "reached work");
    assert!(sim.world().get::<AtWork>(actor).is_some(), "still at work");
    assert!(
        need(&sim, actor, NeedId::Hunger) > 5.0,
        "work refills critical Hunger after arrival"
    );
}

/// The state is derived from saved facts, so a save taken mid-lateness
/// continues identically through the meal and the departure.
#[test]
fn a_save_mid_lateness_continues_identically() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    for _ in 0..8 {
        sim.tick();
    }
    assert!(!commuting(&sim, actor), "saved while still home and late");
    let saved = sim.current_v19_view();
    let content = sim.world().resource::<Content>().0;
    let mut loaded = Sim::new_with_lot_and_content(20, 20, Content(content));
    loaded
        .load_current_v19_view(saved.clone())
        .expect("a mid-lateness save loads");
    assert_eq!(loaded.world_hash(), sim.world_hash());
    let mut left = false;
    for step in 0..120 {
        sim.tick();
        loaded.tick();
        assert_eq!(
            loaded.world_hash(),
            sim.world_hash(),
            "diverged at step {step}"
        );
        left |= commuting(&sim, actor);
    }
    assert!(left, "the run covered the departure");
}

/// The system parameter `select_action` reads reports the lateness: none
/// before the start, the ramp from the start to the ramp length, and none
/// once the limit has passed, nothing critical counts, or the shift ended.
#[test]
fn the_choice_parameter_reports_lateness_along_the_ramp() {
    let (mut sim, actor, _) = fixture(480, &[], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    let mut state =
        bevy_ecs::system::SystemState::<crate::shifts::ShiftRhythm>::new(sim.world_mut());
    let mut report = |sim: &mut Sim, tick: u64, hunger: f32, bladder: f32| {
        sim.world_mut().resource_mut::<SimClock>().tick = tick;
        let mut needs = Needs::all_at(100.0);
        needs.set(NeedId::Hunger, hunger);
        needs.set(NeedId::Bladder, bladder);
        state.get(sim.world()).lateness(actor, &needs, tick)
    };
    assert_eq!(
        report(&mut sim, START, 10.0, 100.0).map(|l| l.progress),
        Some(0.0)
    );
    assert_eq!(
        report(&mut sim, START + 15, 10.0, 100.0).map(|l| l.progress),
        Some(0.5)
    );
    assert_eq!(
        report(&mut sim, START + 30, 10.0, 100.0).map(|l| l.progress),
        Some(1.0)
    );
    assert_eq!(
        report(&mut sim, START + 59, 10.0, 100.0).map(|l| l.progress),
        Some(1.0)
    );
    let late = report(&mut sim, START, 10.0, 100.0).unwrap();
    assert_eq!(late.counted, counted_mask());
    assert_eq!(late.remedy_share, 0.99);
    assert_eq!(
        report(&mut sim, START + 60, 10.0, 100.0),
        None,
        "the limit has passed"
    );
    assert_eq!(
        report(&mut sim, START - 1, 10.0, 100.0),
        None,
        "before the start"
    );
    assert_eq!(
        report(&mut sim, START + 5, 80.0, 100.0),
        None,
        "nothing critical"
    );
    assert_eq!(
        report(&mut sim, START + 5, 80.0, 5.0),
        None,
        "Bladder does not count"
    );
}

/// [WL-bladder]: relief belongs to work. A worker still at home with a low
/// Bladder is not relieved by it.
#[test]
fn bladder_is_not_relieved_away_from_work() {
    let (mut sim, actor, _) = fixture(480, &[], |_| {});
    sim.world_mut().resource_mut::<SimClock>().tick = 10;
    sim.world_mut()
        .get_mut::<Needs>(actor)
        .unwrap()
        .set(NeedId::Bladder, 5.0);
    sim.tick();
    assert_eq!(need(&sim, actor, NeedId::Bladder), 5.0);
}

/// [WL-limit]: the allowance is a window from the scheduled start to the
/// start plus the limit, cut at the shift's end and closed once the shift
/// has settled, whatever the limit is. The departure also stops at a shift's
/// end through `start_tick`'s own open-shift test; this pins the predicate on
/// its own, so the two cannot drift apart unnoticed.
#[test]
fn the_allowance_is_a_window_that_ends_at_the_limit_or_the_shift_end() {
    let shift = |end_tick, settled| terri_core::save_v17::SavedScheduledShift {
        sim: 1,
        career: 0,
        start_tick: START,
        end_tick,
        worked_ticks: 0,
        accounted_tick: START,
        pay_cents: 0,
        settled,
        legacy: false,
    };
    let mut tuning = terri_data::pack().tuning;
    tuning.work_lateness_limit_ticks = 720;
    let short = shift(START + 30, false);
    assert_eq!(
        late_ticks(&short, START - 1, &tuning),
        None,
        "before the start"
    );
    assert_eq!(late_ticks(&short, START, &tuning), Some(0));
    assert_eq!(late_ticks(&short, START + 29, &tuning), Some(29));
    assert_eq!(
        late_ticks(&short, START + 30, &tuning),
        None,
        "the shift's end closes the allowance well inside the limit"
    );
    assert_eq!(
        late_ticks(&shift(START + 480, true), START + 5, &tuning),
        None
    );
    tuning.work_lateness_limit_ticks = 60;
    let long = shift(START + 480, false);
    assert_eq!(late_ticks(&long, START + 59, &tuning), Some(59));
    assert_eq!(late_ticks(&long, START + 60, &tuning), None, "the limit");
    tuning.work_lateness_limit_ticks = 0;
    assert_eq!(late_ticks(&long, START, &tuning), None, "a limit of 0");
}

/// The share of `actor`'s last decision that went to `target`, as
/// `select_action` recorded it, or `None` when `target` was not a candidate.
fn recorded_share(sim: &Sim, actor: Entity, target: Entity) -> Option<f64> {
    let telemetry = &sim
        .world()
        .resource::<crate::systems::autonomy::DecisionTelemetry>()
        .0;
    let decision = telemetry.iter().find(|d| d.agent == actor.index_u32())?;
    let shares: Vec<f64> = decision
        .choices
        .iter()
        .filter(|choice| choice.0 == target.index_u32())
        .map(|choice| choice.4)
        .collect();
    (!shares.is_empty()).then(|| shares.iter().sum())
}

/// A critically hungry worker with a weak snack that relieves Hunger and a
/// television that scores far higher, so the cap on unrelated choices is what
/// decides the shares. The furniture is placed now or left to the test.
struct Crisis {
    sim: Sim,
    actor: Entity,
    defs: Vec<terri_core::ObjectDefId>,
    placed: Vec<Entity>,
}

fn crisis_with_a_tempting_television(place_now: bool) -> Crisis {
    let (mut sim, actor, defs) =
        fixture_without_furniture(480, &[Furniture::WeakSnack, Furniture::Tv], |_| {});
    let placed = if place_now {
        defs.iter()
            .enumerate()
            .map(|(n, def)| place(&mut sim, n, *def))
            .collect()
    } else {
        Vec::new()
    };
    start_with(
        &mut sim,
        actor,
        &[(NeedId::Hunger, 10.0), (NeedId::Fun, 30.0)],
    );
    Crisis {
        sim,
        actor,
        defs,
        placed,
    }
}

/// The join between a late worker and the choice: `select_action` hands
/// `ShiftRhythm::lateness` to the probabilities, so the same decision gives
/// the remedy 95 percent on the start tick and 99 percent from 30 minutes in.
/// With `None` passed instead, both would be 95 percent.
#[test]
fn select_action_gives_a_late_worker_the_ramped_remedy_share() {
    // The start tick, progress 0: the autonomy cap, 5 percent unrelated.
    let early = crisis_with_a_tempting_television(true);
    let early_share = recorded_share(&early.sim, early.actor, early.placed[0])
        .expect("the snack was a candidate on the start tick");
    assert!(
        (early_share - 0.95).abs() < 1e-6,
        "progress 0 keeps today's cap: {early_share}"
    );
    // The same worker 45 minutes in, past the 30 minute ramp, inside the
    // 60 minute limit: nothing was in reach before, then the furniture
    // appears and the worker decides.
    let mut late = crisis_with_a_tempting_television(false);
    late.sim.world_mut().resource_mut::<SimClock>().tick = START + 44;
    let placed: Vec<Entity> = late
        .defs
        .iter()
        .enumerate()
        .map(|(n, def)| place(&mut late.sim, n, *def))
        .collect();
    late.sim.tick();
    assert_eq!(now(&late.sim), START + 45);
    assert!(
        !commuting(&late.sim, late.actor),
        "still inside the allowance"
    );
    let late_share = recorded_share(&late.sim, late.actor, placed[0])
        .expect("the snack was a candidate 45 minutes in");
    assert!(
        (late_share - 0.99).abs() < 1e-6,
        "past the ramp the remedy takes the lateness share: {late_share}"
    );
}

/// A housemate with no job is never late for anything: the parameter reports
/// nothing, and the same critical decision keeps today's cap exactly.
#[test]
fn a_housemate_without_a_job_gets_no_lateness_and_todays_share() {
    let (mut sim, actor, defs) =
        fixture_without_furniture(480, &[Furniture::WeakSnack, Furniture::Tv], |_| {});
    let placed: Vec<Entity> = defs
        .iter()
        .enumerate()
        .map(|(n, def)| place(&mut sim, n, *def))
        .collect();
    sim.world_mut().entity_mut(actor).remove::<Career>();
    sim.world_mut().resource_mut::<SimClock>().tick = START + 44;
    let mut needs = Needs::all_at(100.0);
    needs.set(NeedId::Hunger, 10.0);
    needs.set(NeedId::Fun, 30.0);
    sim.world_mut().entity_mut(actor).insert(needs);
    let mut state =
        bevy_ecs::system::SystemState::<crate::shifts::ShiftRhythm>::new(sim.world_mut());
    assert_eq!(
        state.get(sim.world()).lateness(actor, &needs, START + 44),
        None
    );
    sim.tick();
    assert!(shift(&sim, actor).is_none(), "no job, no scheduled shift");
    let share = recorded_share(&sim, actor, placed[0]).expect("the snack was a candidate");
    assert!(
        (share - 0.95).abs() < 1e-6,
        "a jobless critical decision keeps today's cap, not the lateness share: {share}"
    );
}

/// Hunger and Bladder both critical on the start tick: Hunger keeps the
/// worker home, Bladder is not the reason, and the departure comes once
/// Hunger is dealt with, whatever Bladder still is.
#[test]
fn hunger_and_bladder_both_critical_keep_the_worker_home_for_hunger_only() {
    let (mut sim, actor, _) = fixture(480, &[Furniture::Snack], |_| {});
    start_with(
        &mut sim,
        actor,
        &[(NeedId::Hunger, 10.0), (NeedId::Bladder, 5.0)],
    );
    assert!(!commuting(&sim, actor), "Hunger holds the worker back");
    let left = depart_tick(&mut sim, actor, 100).expect("leaves once fed");
    assert!(left > START && left < START + 60, "left at {left}");
    assert!(need(&sim, actor, NeedId::Hunger) > 20.0, "fed first");
    assert_eq!(
        need(&sim, actor, NeedId::Bladder),
        5.0,
        "Bladder was never the reason and nothing relieved it at home"
    );
}
