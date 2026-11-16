//! Issue 309: bounded lateness for critical needs and Bladder relief at
//! work. Every test drives the real tick and follows observable events,
//! not guessed ticks ([L-career-tests-follow-events-not-guessed-ticks]).
use super::*;
use crate::attendance::Attendance;
use crate::{Content, Sim};
use terri_core::{
    Agent, AtWork, Career, CommandQueue, Commuting, Eating, IntentQueue, Personality,
    Position, Relationships, Satisfaction, SimClock, SimCommand, SimId, SimIdAllocator,
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
}

/// A worker at (2, 4) with a shift at [`START`], no decay and no random
/// career events, so needs move only when something in the test moves them.
fn fixture(
    shift_ticks: u32,
    furniture: &[Furniture],
    tune: impl Fn(&mut terri_data::ContentPack),
) -> (Sim, Entity, Vec<Entity>) {
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
            Furniture::Snack => {
                crate::test_content::object("snack", &[(NeedId::Hunger, 60.0)], 15)
            }
            Furniture::Bed => crate::test_content::object("bed", &[(NeedId::Energy, 60.0)], 200),
            Furniture::Hold => crate::test_content::object("hold", &[(NeedId::Fun, 10.0)], 900),
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
    let objects = ids
        .into_iter()
        .enumerate()
        .map(|(n, def)| sim.spawn_object(Position { x: 4.0 + n as f32 * 2.0, y: 4.0 }, def))
        .collect();
    command(
        &mut sim,
        SimCommand::SetCareerAutonomy {
            change: false,
            search: false,
        },
    );
    (sim, actor, objects)
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
    sim.world().resource::<Attendance>().shifts.get(&id).cloned()
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
    assert!(shift(sim, actor).is_some(), "the shift registers on its start tick");
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
        assert!(commuting(&sim, actor), "{uncounted:?} left on the start tick");
    }
}

/// [WL-limit]: with no remedy at all the worker still leaves exactly at the
/// scheduled start plus the limit, and not a tick before.
#[test]
fn lateness_ends_at_the_limit_with_no_remedy_to_be_had() {
    let (mut sim, actor, _) = fixture(480, &[], |_| {});
    start_with(&mut sim, actor, &[(NeedId::Hunger, 10.0)]);
    let limit = u64::from(sim.world().resource::<Content>().0.tuning.work_lateness_limit_ticks);
    assert_eq!(limit, 60, "the shipped limit");
    for _ in 1..limit {
        sim.tick();
        assert!(!commuting(&sim, actor), "tick {} is still inside the limit", now(&sim));
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
    assert!(slept_at_the_end, "the worker was still sleeping a tick before");
    assert!(
        need(&sim, actor, NeedId::Energy) > 20.0,
        "the need had recovered, so only the running remedy kept the worker"
    );
    assert!(sim.world().get::<Eating>(actor).is_none(), "the remedy is cleared");
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
        assert!(!commuting(&sim, actor), "the order holds the worker at {}", now(&sim));
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
        arrived |= sim.world().get::<AtWork>(actor).is_some();
    }
    assert!(arrived, "reached work");
    assert!(sim.world().get::<AtWork>(actor).is_some(), "still at work");
    assert!(need(&sim, actor, NeedId::Hunger) <= 5.0, "no meal was eaten");
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
    assert_eq!(report(&mut sim, START, 10.0, 100.0).map(|l| l.progress), Some(0.0));
    assert_eq!(report(&mut sim, START + 15, 10.0, 100.0).map(|l| l.progress), Some(0.5));
    assert_eq!(report(&mut sim, START + 30, 10.0, 100.0).map(|l| l.progress), Some(1.0));
    assert_eq!(report(&mut sim, START + 59, 10.0, 100.0).map(|l| l.progress), Some(1.0));
    let late = report(&mut sim, START, 10.0, 100.0).unwrap();
    assert_eq!(late.counted, counted_mask());
    assert_eq!(late.remedy_share, 0.99);
    assert_eq!(report(&mut sim, START + 60, 10.0, 100.0), None, "the limit has passed");
    assert_eq!(report(&mut sim, START - 1, 10.0, 100.0), None, "before the start");
    assert_eq!(report(&mut sim, START + 5, 80.0, 100.0), None, "nothing critical");
    assert_eq!(
        report(&mut sim, START + 5, 80.0, 5.0),
        None,
        "Bladder does not count"
    );
}

/// [WL-bladder]: a worker at work is relieved of Bladder below the
/// threshold, to full, and not at the threshold itself.
#[test]
fn a_worker_at_work_is_relieved_of_bladder_below_the_threshold() {
    let (mut sim, actor, _) = fixture(480, &[], |_| {});
    start_with(&mut sim, actor, &[]);
    let mut worked = false;
    for _ in 0..200 {
        sim.tick();
        if sim.world().get::<AtWork>(actor).is_some() {
            worked = true;
            break;
        }
    }
    assert!(worked, "the worker reaches the office");
    let threshold = sim
        .world()
        .resource::<Content>()
        .0
        .tuning
        .work_bladder_relief_threshold;
    assert_eq!(threshold, 50.0);
    for (level, relieved) in [(50.0, false), (49.9, true), (0.0, true), (75.0, false)] {
        sim.world_mut()
            .get_mut::<Needs>(actor)
            .unwrap()
            .set(NeedId::Bladder, level);
        sim.world_mut()
            .get_mut::<Needs>(actor)
            .unwrap()
            .set(NeedId::Hunger, 30.0);
        sim.tick();
        assert!(sim.world().get::<AtWork>(actor).is_some());
        let expected = if relieved { terri_core::NEED_MAX } else { level };
        assert_eq!(need(&sim, actor, NeedId::Bladder), expected, "from {level}");
        assert_eq!(
            need(&sim, actor, NeedId::Hunger),
            30.0,
            "Bladder is the only need relieved at work"
        );
    }
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

/// [WL-bladder]: with the real decay rates, Bladder never falls below the
/// threshold during a shift, while without the relief it does.
#[test]
fn bladder_never_falls_below_the_threshold_during_a_shift() {
    let lowest_at_work = |threshold: f32| {
        let (mut sim, actor, _) = fixture(480, &[], |pack| {
            pack.decay_per_tick = terri_data::pack().decay_per_tick;
            pack.tuning.work_bladder_relief_threshold = threshold;
        });
        start_with(&mut sim, actor, &[(NeedId::Bladder, 60.0)]);
        let mut lowest = f32::INFINITY;
        let mut ticks_at_work = 0;
        for _ in 0..520 {
            sim.tick();
            // Keep the other needs out of the way of the sleep and meal
            // choices the real decay would otherwise provoke.
            for other in NeedId::ALL {
                if other != NeedId::Bladder {
                    sim.world_mut().get_mut::<Needs>(actor).unwrap().set(other, 100.0);
                }
            }
            if sim.world().get::<AtWork>(actor).is_some() {
                ticks_at_work += 1;
                lowest = lowest.min(need(&sim, actor, NeedId::Bladder));
            }
        }
        assert!(ticks_at_work > 300, "a real stretch at work");
        lowest
    };
    assert!(
        lowest_at_work(50.0) >= 50.0,
        "relieved whenever it falls below the threshold"
    );
    assert!(
        lowest_at_work(0.0) < 50.0,
        "with the relief off the shift does drain it below the threshold"
    );
}
