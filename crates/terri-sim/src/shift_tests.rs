//! Drawing and holding a shift: issue 296,
//! `docs/specs/2026-10-18-shifts-and-careers.md`, [WS-choose].
use super::*;
use crate::careers::{CareerRefusal, Record};
use crate::{Content, Sim};
use std::collections::BTreeMap;
use terri_core::{Agent, Career, CommandQueue, SimClock, SimCommand, SimRng};
use terri_data::{CompiledShift, Tuning};

/// The shipped lot with its pack changed by `edit`, the search at
/// temperature 0 so a test's hire never depends on the path draw.
fn shipped_with(edit: impl FnOnce(&mut ContentPack)) -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    let mut pack = terri_data::pack().clone();
    pack.tuning.career_search_temperature = 0.0;
    edit(&mut pack);
    let pack: &'static ContentPack = Box::leak(Box::new(pack));
    sim.world_mut().insert_resource(Content(pack));
    sim
}

/// Every review chance pinned to impossible, so a review's outcome is the
/// one a test asks for.
fn pinned(pack: &mut ContentPack) {
    let t: &mut Tuning = &mut pack.tuning;
    t.career_review_noise = 0.0;
    t.career_fire_base = 0.0;
    t.career_demote_base = 0.0;
    t.career_promote_base = 0.0;
    t.career_raise_base = 0.0;
    t.career_change_chance = 0.0;
}

fn pack(sim: &Sim) -> &'static ContentPack {
    sim.world().resource::<Content>().0
}

fn path_index(pack: &ContentPack, id: &str) -> u32 {
    pack.career_paths
        .iter()
        .position(|path| path.id == id)
        .expect("shipped") as u32
}

/// The row of `path`'s level `level`.
fn row(pack: &ContentPack, path: &str, level: usize) -> usize {
    pack.career_paths[path_index(pack, path) as usize].levels[level] as usize
}

/// Sets one level's weights by shift id: `standard` and the ids the level
/// already lists.
fn weigh(pack: &mut ContentPack, row: usize, weights: &[(&str, u32)]) {
    let job = &mut pack.careers[row];
    let weights: BTreeMap<&str, u32> = weights.iter().copied().collect();
    job.standard_weight = weights.get("standard").copied().unwrap_or(0);
    for shift in &mut job.shifts {
        shift.weight = weights.get(shift.id.as_str()).copied().unwrap_or(0);
    }
}

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

/// The shipped worker, with a fresh record.
fn worker(sim: &mut Sim) -> (SimId, Entity) {
    let (id, entity) = household(sim)
        .into_iter()
        .find(|(_, entity)| sim.world().get::<Career>(*entity).is_some())
        .expect("the shipped household has a worker");
    let job = crate::careers::job_of(sim.world(), pack(sim), entity)
        .expect("employed")
        .clone();
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .entry(id)
        .or_insert_with(|| Record::new(&job));
    (id, entity)
}

fn held(sim: &Sim, id: SimId) -> u32 {
    sim.world()
        .resource::<Careers>()
        .record(id)
        .expect("a record")
        .shift
}

fn draws(sim: &Sim) -> (u64, u64) {
    let careers = sim.world().resource::<Careers>();
    (careers.draws, careers.shift_draws)
}

fn issue(sim: &mut Sim, command: SimCommand) {
    sim.world_mut().resource_mut::<CommandQueue>().push(command);
    sim.flush_commands();
}

/// The shift [`draw`] would take with `weights` (standard first) from a
/// fresh shift stream: the running-sum rule written out again, so a pinned
/// index is checked against the rule rather than only against itself.
fn first_draw(weights: &[u32]) -> u32 {
    let total: u32 = weights.iter().sum();
    let r = SimRng::from_seed(SHIFTS_SEED).range(total as usize) as u32;
    let mut running = 0;
    for (index, weight) in weights.iter().enumerate() {
        running += weight;
        if r < running {
            return index as u32;
        }
    }
    unreachable!("the draw is below the total")
}

/// [WS-choose] step 2: the job `content/household.toml` names starts on its
/// standard shift, and the morning's departure draws nothing.
#[test]
fn the_household_worker_holds_the_standard_shift_without_a_draw() {
    let mut sim = Sim::new_from_shipped_lot();
    let (_, tim) = household(&mut sim)
        .into_iter()
        .find(|(_, entity)| sim.world().get::<Career>(*entity).is_some())
        .expect("a worker");
    // Through 08:00 on Monday: the 06:00 shift has started and the 09:00
    // search has not run.
    for _ in 0..480 {
        sim.tick();
    }
    let shift = shift_of(sim.world(), pack(&sim), tim).expect("employed");
    assert_eq!((shift.index, shift.id), (0, "standard"));
    assert_eq!((shift.shift_start, shift.shift_ticks), (360, 480));
    assert_eq!(draws(&sim).1, 0);
}

/// [WS-choose] step 1: a search hire draws one shift from the hired level.
/// The shipped worker fits the library best; its first level here offers
/// the standard shift at weight 1 and the late shift at weight 3.
#[test]
fn a_search_hire_draws_one_shift_and_holds_the_pinned_result() {
    let mut sim = shipped_with(|pack| {
        pack.tuning.career_search_chance = 1.0;
        let library = row(pack, "library", 0);
        weigh(pack, library, &[("standard", 1), ("late", 3)]);
    });
    let (id, entity) = worker(&mut sim);
    sim.world_mut().entity_mut(entity).remove::<Career>();
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .remove(&id);
    for (other, _) in household(&mut sim) {
        if other != id {
            sim.world_mut()
                .resource_mut::<Careers>()
                .set_search(other, false);
        }
    }
    let mut attempts = 0;
    while sim.world().get::<Career>(entity).is_none() {
        crate::careers::search(sim.world_mut());
        attempts += 1;
        assert!(attempts < 40, "hired within forty working days");
    }
    let pack = pack(&sim);
    let best = crate::careers::best_path(sim.world(), pack, entity, None, f32::NEG_INFINITY);
    assert_eq!(best, Some(path_index(pack, "library")));
    assert_eq!(
        sim.world().get::<Career>(entity).map(|c| c.0 as usize),
        Some(row(pack, "library", 0))
    );
    assert_eq!(held(&sim, id), first_draw(&[1, 3]));
    assert_eq!(held(&sim, id), PINNED_SEARCH_SHIFT);
    assert_eq!(draws(&sim), PINNED_SEARCH_DRAWS);
}
/// The late shift, from the shift stream's first draw of 4; hired on the
/// third search, after six careers draws (apply and hire each day).
const PINNED_SEARCH_SHIFT: u32 = 1;
const PINNED_SEARCH_DRAWS: (u64, u64) = (6, 1);

/// [WS-choose] step 1: `AssignCareer` draws from the path's first level.
/// The cafe offers its standard, day and late shifts at 5, 3 and 2.
#[test]
fn an_assigned_path_draws_one_shift_and_holds_the_pinned_result() {
    let mut sim = Sim::new_from_shipped_lot();
    let (id, entity) = worker(&mut sim);
    let cafe = path_index(pack(&sim), "cafe");
    issue(
        &mut sim,
        SimCommand::AssignCareer {
            agent: entity.index_u32(),
            path: cafe,
        },
    );
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .map(|r| r.reason),
        Some(None)
    );
    assert_eq!(held(&sim, id), first_draw(&[5, 3, 2]));
    assert_eq!(held(&sim, id), PINNED_ASSIGNED_SHIFT);
    assert_eq!(draws(&sim), (0, 1));
    let shift = shift_of(sim.world(), pack(&sim), entity).expect("employed");
    assert_eq!(shift.index as u32, PINNED_ASSIGNED_SHIFT);
}
/// The cafe's day shift, from the shift stream's first draw of 10.
const PINNED_ASSIGNED_SHIFT: u32 = 1;

/// [WS-choose] step 1: a review's change of path draws from the new path's
/// first level, after the careers stream's review draws.
#[test]
fn a_change_of_path_draws_from_the_new_level() {
    let mut sim = shipped_with(|pack| {
        pinned(pack);
        pack.tuning.career_change_fit = 2.0;
        pack.tuning.career_change_gap = 0.0;
        pack.tuning.career_change_chance = 1.0;
    });
    let (id, entity) = worker(&mut sim);
    let pack = pack(&sim);
    let chatterbox = pack
        .traits
        .iter()
        .position(|t| t.id == "chatterbox")
        .expect("shipped") as u32;
    sim.world_mut().entity_mut(entity).insert((
        terri_core::Traits::from_entries(vec![(chatterbox, 1.0)]),
        terri_core::Shyness::new(1).expect("in range"),
    ));
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .get_mut(&id)
        .unwrap()
        .shifts
        .extend([50.0; 5]);
    crate::careers::review(sim.world_mut(), 0, 1440 * 7);
    let cafe = row(pack, "cafe", 0);
    assert_eq!(
        sim.world().get::<Career>(entity).map(|c| c.0 as usize),
        Some(cafe),
        "the chatterbox moves to the cafe"
    );
    assert_eq!(held(&sim, id), first_draw(&[5, 3, 2]));
    assert_eq!(draws(&sim), (3, 1), "noise, outcome and change; one shift");
}

/// [WS-choose] step 4: a level offering one shift takes it without a draw,
/// whether it is the standard shift or another.
#[test]
fn a_level_with_one_offered_shift_draws_nothing() {
    for (weights, expected) in [
        (&[("standard", 1), ("late", 0)][..], 0),
        (&[("standard", 0), ("late", 5)][..], 1),
    ] {
        let mut sim = shipped_with(|pack| {
            let office = row(pack, "office", 0);
            weigh(pack, office, weights);
        });
        let (id, entity) = worker(&mut sim);
        issue(
            &mut sim,
            SimCommand::AssignCareer {
                agent: entity.index_u32(),
                path: 0,
            },
        );
        assert_eq!(held(&sim, id), expected, "{weights:?}");
        assert_eq!(draws(&sim), (0, 0), "{weights:?}");
    }
}

/// [WS-choose] step 3: a promotion keeps the held shift's id when the next
/// level offers it, with the next level's times, and draws from the next
/// level when it does not.
#[test]
fn a_promotion_keeps_an_offered_shift_and_draws_otherwise() {
    let promoted = |edit: &dyn Fn(&mut ContentPack), held_id: &str| {
        let mut sim = shipped_with(|pack| {
            pinned(pack);
            pack.tuning.career_promote_base = 1.0;
            edit(pack);
        });
        let (id, entity) = worker(&mut sim);
        let pack = pack(&sim);
        let cafe = row(pack, "cafe", 0);
        sim.world_mut()
            .entity_mut(entity)
            .insert(Career(cafe as u32));
        let held_index = pack.careers[cafe].shift_index(held_id).expect("listed") as u32;
        sim.world_mut().resource_mut::<Careers>().records.insert(
            id,
            Record {
                consecutive_good: 10,
                shift: held_index,
                shifts: vec![100.0; 5],
                ..Record::new(&pack.careers[cafe])
            },
        );
        crate::careers::review(sim.world_mut(), 0, 1440 * 7);
        assert_eq!(
            sim.world().get::<Career>(entity).map(|c| c.0 as usize),
            Some(row(pack, "cafe", 1)),
            "promoted"
        );
        (sim, id, entity)
    };

    let (sim, id, entity) = promoted(&|_| {}, "late");
    let next = &pack(&sim).careers[row(pack(&sim), "cafe", 1)];
    assert_eq!(held(&sim, id) as usize, next.shift_index("late").unwrap());
    assert_eq!(draws(&sim), (2, 0), "kept: no shift draw");
    let shift = shift_of(sim.world(), pack(&sim), entity).unwrap();
    assert_eq!((shift.id, shift.shift_start), ("late", 780));

    let (sim, id, _) = promoted(
        &|pack| {
            let next = row(pack, "cafe", 1);
            weigh(pack, next, &[("standard", 5), ("day", 3), ("late", 0)]);
        },
        "late",
    );
    assert_eq!(held(&sim, id), first_draw(&[5, 3]));
    assert_eq!(draws(&sim), (2, 1), "not offered: one shift draw");
}

/// [WS-choose] step 5: over 10,000 draws on a level weighted 5, 3 and 2,
/// each shift's share is within 1.5 percentage points of its weight.
#[test]
fn shift_draws_follow_the_weights() {
    let job = terri_data::CompiledCareer {
        standard_weight: 5,
        shifts: vec![
            CompiledShift {
                id: "second".to_string(),
                kind: terri_data::SHIFT_LATE,
                shift_start: 600,
                shift_ticks: 480,
                working_days: 0b0011111,
                weight: 3,
            },
            CompiledShift {
                id: "third".to_string(),
                kind: terri_data::SHIFT_NIGHT,
                shift_start: 1320,
                shift_ticks: 480,
                working_days: 0b0011111,
                weight: 2,
            },
        ],
        ..terri_data::pack().careers[0].clone()
    };
    let mut careers = Careers::default();
    let mut counts = [0u32; 3];
    for _ in 0..10_000 {
        counts[draw(&mut careers, &job) as usize] += 1;
    }
    assert_eq!(careers.shift_draws, 10_000);
    assert_eq!(careers.draws, 0, "the careers stream is never drawn");
    for (count, expected) in counts.iter().zip([0.5, 0.3, 0.2]) {
        let share = f64::from(*count) / 10_000.0;
        assert!((share - expected).abs() <= 0.015, "{counts:?}");
    }
}

/// [WS-determinism] item 1: shift draws never touch the careers stream, so
/// a review and a search draw exactly the careers numbers they draw on the
/// same pack with every alternative shift removed.
#[test]
fn reviews_draw_the_same_careers_numbers_with_shifts_present() {
    let run = |strip: bool| {
        let mut sim = shipped_with(|pack| {
            pack.tuning.career_search_chance = 1.0;
            pack.tuning.career_raise_base = 1.0;
            if strip {
                for job in &mut pack.careers {
                    job.shifts.clear();
                    job.standard_weight = 1;
                }
            }
        });
        let (id, _) = worker(&mut sim);
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .get_mut(&id)
            .unwrap()
            .shifts
            .extend([90.0; 5]);
        crate::careers::review(sim.world_mut(), 0, 1440 * 7);
        crate::careers::search(sim.world_mut());
        let careers = sim.world().resource::<Careers>();
        (careers.rng.clone(), careers.draws, careers.shift_draws)
    };
    let (with, with_draws, with_shifts) = run(false);
    let (without, without_draws, without_shifts) = run(true);
    assert_eq!((with, with_draws), (without, without_draws));
    assert_eq!(with_draws, PINNED_REVIEW_AND_SEARCH_DRAWS);
    assert!(with_shifts > 0, "the shipped shifts were drawn");
    assert_eq!(without_shifts, 0, "one offered shift draws nothing");
}
/// Noise and outcome for the review, then apply and hire for each of the
/// two unemployed housemates.
const PINNED_REVIEW_AND_SEARCH_DRAWS: u64 = 6;

/// A death drops the held shift with the person's record.
#[test]
fn a_death_drops_the_held_shift() {
    let mut sim = Sim::new_from_shipped_lot();
    let (id, entity) = worker(&mut sim);
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .get_mut(&id)
        .unwrap()
        .shift = 1;
    crate::mortality::remove_person(sim.world_mut(), entity);
    sim.world_mut().despawn(entity);
    assert!(sim.world().resource::<Careers>().record(id).is_none());
}

// Choosing and changing a shift by command: [WS-select].

fn result(sim: &Sim) -> Option<crate::careers::CareerResult> {
    sim.world().resource::<Careers>().last_result
}

fn reason(sim: &Sim) -> Option<Option<CareerRefusal>> {
    result(sim).map(|result| result.reason)
}

/// [WS-select] item 1: `AssignCareerShift` assigns the path as
/// `AssignCareer` does and holds the chosen shift, drawing nothing.
#[test]
fn assigning_with_a_shift_holds_it_without_a_draw() {
    let mut sim = Sim::new_from_shipped_lot();
    let (id, entity) = worker(&mut sim);
    let pack = pack(&sim);
    let cafe = path_index(pack, "cafe");
    let first = row(pack, "cafe", 0);
    let late = pack.careers[first].shift_index("late").expect("listed") as u32;
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: cafe,
            shift: late,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert_eq!(
        sim.world().get::<Career>(entity).map(|c| c.0 as usize),
        Some(first)
    );
    let record = sim
        .world()
        .resource::<Careers>()
        .record(id)
        .cloned()
        .unwrap();
    assert_eq!(
        record,
        Record {
            shift: late,
            ..Record::new(&pack.careers[first])
        }
    );
    assert_eq!(draws(&sim), (0, 0));
    let shift = shift_of(sim.world(), pack, entity).unwrap();
    assert_eq!(
        (shift.id, shift.shift_start, shift.shift_ticks),
        ("late", 780, 420)
    );
}

/// [WS-select] item 3: a change of shift resets the good-week streak and
/// changes nothing else: pay, level, job satisfaction, the poor-week streak,
/// the week's scores and the history stay.
#[test]
fn changing_shift_costs_only_the_good_week_streak() {
    let mut sim = Sim::new_from_shipped_lot();
    let (id, entity) = worker(&mut sim);
    let before = Record {
        pay: 140,
        job_satisfaction: 71.5,
        consecutive_poor: 1,
        consecutive_good: 2,
        shifts: vec![61.0, 64.5],
        history: vec![crate::careers::Week {
            week: 0,
            performance: 66.0,
            event: crate::careers::EVENT_RAISE,
        }],
        ..Record::new(&pack(&sim).careers[0])
    };
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .insert(id, before.clone());
    let job = sim.world().get::<Career>(entity).copied();
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: entity.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert_eq!(
        sim.world().resource::<Careers>().record(id),
        Some(&Record {
            consecutive_good: 0,
            shift: 1,
            ..before
        })
    );
    assert_eq!(sim.world().get::<Career>(entity).copied(), job);
    assert_eq!(draws(&sim), (0, 0));
}

/// A worker at home during their scheduled shift, kept there by a player
/// order, as `attendance`'s own tests build one: the one job starts at tick
/// 60 and offers its standard shift and a late one.
fn kept_home() -> (Sim, Entity) {
    use terri_core::{IntentQueue, NeedId, Needs, Position, Satisfaction, SmartObject};
    let base = crate::test_content::pack(vec![crate::test_content::object(
        "long_action",
        &[(NeedId::Fun, 10.0)],
        1000,
    )]);
    let mut job = terri_data::pack().careers[0].clone();
    job.shift_start = 60;
    job.shift_ticks = 480;
    job.pay = 130;
    job.pay_max = 200;
    job.working_days = 0b1111111;
    job.standard_weight = 1;
    job.shifts = vec![CompiledShift {
        id: "late".to_string(),
        kind: terri_data::SHIFT_LATE,
        shift_start: 900,
        shift_ticks: 300,
        working_days: 0b1111111,
        weight: 1,
    }];
    let pack = Box::leak(Box::new(ContentPack {
        careers: vec![job],
        portals: vec![terri_data::CompiledPortal {
            position: (15, 2),
            inward: (15, 3),
            facing: terri_data::CompiledSocketFacing::PositiveX,
            hinge: terri_data::CompiledPortalHinge::Left,
            frame_sprite: 41,
            closed_sprite: 42,
            ajar_sprite: 43,
            open_sprite: 44,
        }],
        ..base.clone()
    }));
    let mut sim = crate::test_content::sim_with(16, 12, pack);
    let actor = sim
        .world_mut()
        .spawn((
            Agent,
            SimId(1),
            Position { x: 15.0, y: 2.0 },
            Needs::all_at(80.0),
            Career(0),
            IntentQueue::default(),
            Satisfaction::from_value(0.0),
        ))
        .id();
    let object = sim
        .world_mut()
        .spawn((
            SmartObject(terri_core::ObjectDefId(0)),
            Position { x: 14.0, y: 2.0 },
        ))
        .id();
    issue(
        &mut sim,
        SimCommand::UseObject {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        },
    );
    sim.world_mut().resource_mut::<SimClock>().tick = 60;
    crate::attendance::start_tick(sim.world_mut());
    assert!(crate::attendance::has_open_shift(sim.world(), actor));
    assert!(sim.world().get::<terri_core::Commuting>(actor).is_none());
    (sim, actor)
}

/// [WS-select] item 3: a scheduled shift still open while the person is at
/// home settles, as a career change settles it, before the change.
#[test]
fn changing_shift_settles_an_open_shift_at_home() {
    let (mut sim, actor) = kept_home();
    sim.world_mut().resource_mut::<SimClock>().tick = 120;
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: actor.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert!(!crate::attendance::has_open_shift(sim.world(), actor));
    let attendance = sim.world().resource::<crate::attendance::Attendance>();
    assert_eq!(attendance.outcomes.len(), 1, "settled once");
    assert_eq!(attendance.outcomes[0].worked_minutes, 0.0);
    assert_eq!(held(&sim, SimId(1)), 1);
    let shift = shift_of(sim.world(), pack(&sim), actor).unwrap();
    assert_eq!((shift.id, shift.shift_start), ("late", 900));
}

/// The career state a refusal must leave alone beyond what the world hash
/// covers: every record, held shifts included, and the shift stream with
/// its draw count.
fn career_state(sim: &Sim) -> (BTreeMap<SimId, Record>, SimRng, u64) {
    let careers = sim.world().resource::<Careers>();
    (
        careers.records.clone(),
        careers.shift_rng.clone(),
        careers.shift_draws,
    )
}

/// [WS-select] item 3: the open shift a change settles is forfeited, not
/// scored, so the week's scores stay exactly as they were. An assignment
/// starts a new record and is not affected.
#[test]
fn a_shift_change_leaves_the_weeks_scores_unchanged() {
    let (mut sim, actor) = kept_home();
    let job = pack(&sim).careers[0].clone();
    sim.world_mut().resource_mut::<Careers>().records.insert(
        SimId(1),
        Record {
            shifts: vec![61.0, 64.5],
            ..Record::new(&job)
        },
    );
    sim.world_mut().resource_mut::<SimClock>().tick = 120;
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: actor.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert_eq!(
        sim.world()
            .resource::<crate::attendance::Attendance>()
            .outcomes
            .len(),
        1,
        "the open shift settled"
    );
    let record = sim
        .world()
        .resource::<Careers>()
        .record(SimId(1))
        .cloned()
        .expect("a record");
    assert_eq!(record.shifts, vec![61.0, 64.5], "the forfeit is not scored");
    assert_eq!(record.shift, 1);
}

/// [WS-select] item 4: each refusal leaves the world as it was apart from
/// the command count, and reports its number. The held shifts and the
/// shift stream are compared directly as well as through the world hash.
#[test]
fn the_shift_commands_refuse_each_case_without_changing_the_world() {
    let refused = |sim: &mut Sim, command: SimCommand, expected: CareerRefusal| {
        let before = sim.world_hash();
        let careers_before = career_state(sim);
        let commands = sim.world().resource::<Careers>().commands;
        issue(sim, command.clone());
        assert_eq!(reason(sim), Some(Some(expected)), "{command:?}");
        {
            let mut careers = sim.world_mut().resource_mut::<Careers>();
            assert_eq!(careers.commands, commands + 1, "{command:?} is counted");
            careers.commands = commands;
        }
        assert_eq!(sim.world_hash(), before, "{command:?} changes nothing");
        assert_eq!(
            career_state(sim),
            careers_before,
            "{command:?} changes no record or shift stream"
        );
    };
    // The numbers the shell reads continue the career refusals.
    assert_eq!(
        [
            CareerRefusal::ShiftNotOffered as u8,
            CareerRefusal::NotEmployed as u8,
            CareerRefusal::SameShift as u8
        ],
        [4, 5, 6]
    );
    let mut sim = shipped_with(|pack| {
        let office = row(pack, "office", 0);
        weigh(pack, office, &[("standard", 19), ("late", 0)]);
    });
    let (_, tim) = worker(&mut sim);
    let people = household(&mut sim);
    let bill = people
        .iter()
        .find(|(_, entity)| sim.world().get::<Career>(*entity).is_none())
        .expect("an unemployed housemate")
        .1;
    let furniture = sim
        .world_mut()
        .query_filtered::<Entity, Without<Agent>>()
        .iter(sim.world())
        .next()
        .expect("the lot has furniture")
        .index_u32();
    let agent = tim.index_u32();
    let cafe = path_index(pack(&sim), "cafe");
    for command in [
        SimCommand::AssignCareerShift {
            agent: furniture,
            path: cafe,
            shift: 0,
        },
        SimCommand::ChangeShift {
            agent: 99_999,
            shift: 0,
        },
    ] {
        refused(&mut sim, command, CareerRefusal::NotAPerson);
    }
    refused(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent,
            path: 99,
            shift: 0,
        },
        CareerRefusal::UnknownPath,
    );
    for command in [
        SimCommand::AssignCareerShift {
            agent,
            path: cafe,
            shift: 3,
        },
        SimCommand::ChangeShift { agent, shift: 2 },
        // The office's late shift is listed with weight 0 here: held by
        // nobody new, offered to nobody.
        SimCommand::ChangeShift { agent, shift: 1 },
        SimCommand::AssignCareerShift {
            agent,
            path: 0,
            shift: 1,
        },
    ] {
        refused(&mut sim, command, CareerRefusal::ShiftNotOffered);
    }
    refused(
        &mut sim,
        SimCommand::ChangeShift {
            agent: bill.index_u32(),
            shift: 0,
        },
        CareerRefusal::NotEmployed,
    );
    refused(
        &mut sim,
        SimCommand::ChangeShift { agent, shift: 0 },
        CareerRefusal::SameShift,
    );
    for away in [0, 1] {
        if away == 0 {
            sim.world_mut().entity_mut(tim).insert(terri_core::AtWork {
                remaining_ticks: 100,
            });
        } else {
            sim.world_mut()
                .entity_mut(tim)
                .remove::<terri_core::AtWork>()
                .insert(terri_core::Commuting::Outbound);
        }
        for command in [
            SimCommand::AssignCareerShift {
                agent,
                path: cafe,
                shift: 1,
            },
            SimCommand::ChangeShift { agent, shift: 0 },
        ] {
            refused(&mut sim, command, CareerRefusal::AtWork);
        }
    }
}

/// [WS-select] item 5: both commands are career commands, applied or
/// refused: each handled one adds one to the count and sets the result.
#[test]
fn the_shift_commands_count_as_career_commands() {
    let mut sim = Sim::new_from_shipped_lot();
    let (_, entity) = worker(&mut sim);
    let agent = entity.index_u32();
    let count = |sim: &Sim| sim.world().resource::<Careers>().commands;
    issue(&mut sim, SimCommand::ChangeShift { agent, shift: 1 });
    assert_eq!(count(&sim), 1);
    assert_eq!(
        result(&sim),
        Some(crate::careers::CareerResult {
            agent,
            reason: None
        })
    );
    issue(&mut sim, SimCommand::ChangeShift { agent, shift: 1 });
    assert_eq!(count(&sim), 2);
    assert_eq!(reason(&sim), Some(Some(CareerRefusal::SameShift)));
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent,
            path: 1,
            shift: 0,
        },
    );
    assert_eq!(count(&sim), 3);
    assert_eq!(reason(&sim), Some(None));
}

/// [WS-choose] step 3 after [WS-select] item 1: a chosen shift is kept by a
/// promotion to a level that offers it, with no draw.
#[test]
fn a_promotion_after_a_chosen_shift_keeps_it_when_offered() {
    let mut sim = shipped_with(|pack| {
        pinned(pack);
        pack.tuning.career_promote_base = 1.0;
    });
    let (id, entity) = worker(&mut sim);
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: 0,
            shift: 1,
        },
    );
    {
        let mut careers = sim.world_mut().resource_mut::<Careers>();
        let record = careers.records.get_mut(&id).unwrap();
        record.consecutive_good = 10;
        record.shifts = vec![100.0; 5];
    }
    crate::careers::review(sim.world_mut(), 0, 1440 * 7);
    let pack = pack(&sim);
    assert_eq!(
        sim.world().get::<Career>(entity).map(|c| c.0 as usize),
        Some(row(pack, "office", 1))
    );
    let shift = shift_of(sim.world(), pack, entity).unwrap();
    assert_eq!((shift.id, shift.shift_start), ("late", 720));
    assert_eq!(draws(&sim).1, 0);
}

// Reading the held shift wherever hours are read: [WS-systems].

/// [WS-systems]: the search runs at 09:00 before shifts start in that tick,
/// so a person hired then onto a shift starting at 09:00 starts it at once.
/// The hired path's first level here offers one shift, `morning`, from
/// 09:00 every day, so the hire draws nothing and holds it.
#[test]
fn a_hire_at_the_search_tick_starts_a_shift_due_that_tick() {
    let mut probe = shipped_with(|_| {});
    let (bill_id, bill) = household(&mut probe)
        .into_iter()
        .find(|(_, entity)| probe.world().get::<Career>(*entity).is_none())
        .expect("an unemployed housemate");
    let path =
        crate::careers::best_path(probe.world(), pack(&probe), bill, None, f32::NEG_INFINITY)
            .expect("a path fits");
    let mut sim = shipped_with(|pack| {
        pack.tuning.career_search_chance = 1.0;
        let start = pack.tuning.career_search_tick;
        let first = pack.career_paths[path as usize].levels[0] as usize;
        let job = &mut pack.careers[first];
        job.standard_weight = 0;
        job.shifts = vec![CompiledShift {
            id: "morning".to_string(),
            kind: terri_data::SHIFT_DAY,
            shift_start: start,
            shift_ticks: 480,
            working_days: 0b1111111,
            weight: 1,
        }];
    });
    for (other, _) in household(&mut sim) {
        if other != bill_id {
            sim.world_mut()
                .resource_mut::<Careers>()
                .set_search(other, false);
        }
    }
    let mut ticks = 0;
    while sim.world().get::<Career>(bill).is_none() {
        sim.tick();
        ticks += 1;
        assert!(ticks < 1440 * 14, "hired within two weeks");
    }
    let now = sim.world().resource::<SimClock>().tick;
    assert_eq!(now % 1440, 540, "hired by the 09:00 search");
    assert_eq!(held(&sim, bill_id), 1);
    assert_eq!(draws(&sim).1, 0, "one offered shift draws nothing");
    let shift = sim
        .world()
        .resource::<crate::attendance::Attendance>()
        .shifts
        .get(&bill_id)
        .cloned()
        .expect("the 09:00 shift registered in the hiring tick");
    assert_eq!((shift.start_tick, shift.end_tick), (now, now + 480));
}

/// [WS-systems] item 4: a departure that a reading order deferred is
/// validated against the start of any shift the row lists, whichever is
/// held, as saved attendance is, because a save restores the held shifts
/// after this check; a time no listed shift starts at is refused.
#[test]
fn a_pending_shift_is_validated_against_any_listed_shift() {
    let (mut sim, actor) = kept_home();
    sim.world_mut().resource_mut::<SimClock>().tick = 1000;
    let valid = |sim: &mut Sim, scheduled_tick: u64| {
        sim.world_mut()
            .entity_mut(actor)
            .insert(crate::reading::PendingShift {
                scheduled_tick,
                career: 0,
            });
        let world = sim.world();
        let valid =
            crate::reading::persistence::validate(world, world.resource::<terri_core::TileGrid>())
                .is_ok();
        sim.world_mut()
            .entity_mut(actor)
            .remove::<crate::reading::PendingShift>();
        valid
    };
    assert!(valid(&mut sim, 60), "the standard shift starts at 60");
    assert!(valid(&mut sim, 900), "the late shift starts at 900");
    assert!(!valid(&mut sim, 500), "no listed shift starts at 500");
    let job = pack(&sim).careers[0].clone();
    sim.world_mut().resource_mut::<Careers>().records.insert(
        SimId(1),
        Record {
            shift: 1,
            ..Record::new(&job)
        },
    );
    assert!(
        valid(&mut sim, 60),
        "holding the late shift still lists the standard one"
    );
    assert!(valid(&mut sim, 900));
    assert!(!valid(&mut sim, 500));
}

// Sleeping around a shift: [WS-sleep].

/// A sleep-tagged bed and an equally restful couch, a rhythm whose pull
/// toward bed peaks at midnight (4) and bottoms at noon (0.25), the shipped
/// shift offsets, and one job whose standard shift is of `kind`, worked
/// only on Sundays from 22:00, so the tests below fall on days off.
fn rhythm_pack(kind: u8) -> &'static ContentPack {
    let mut sleeping =
        crate::test_content::interaction("use_it", &[(terri_core::NeedId::Energy, 40.0)], 15);
    sleeping.tags = vec!["sleep".to_string()];
    let objects = vec![
        crate::test_content::object("couch", &[(terri_core::NeedId::Energy, 40.0)], 15),
        crate::test_content::object_offering("bed", vec![sleeping]),
    ];
    // Decisive, as the circadian choice tests in `systems::action` are, so
    // each pick is about scoring rather than one roll of the dice.
    let tuning = Tuning {
        choice_temperature: 0.0001,
        duration_variance: 0.0,
        ..crate::test_content::tuning()
    };
    let base = crate::test_content::pack_with_circadian(
        objects,
        tuning,
        "sleep",
        vec![(0, 4.0), (720, 0.25)],
    );
    let mut job = terri_data::pack().careers[0].clone();
    job.standard_kind = kind;
    job.standard_weight = 1;
    job.shifts = Vec::new();
    job.shift_start = 1320;
    job.working_days = 0b1000000;
    Box::leak(Box::new(ContentPack {
        careers: vec![job],
        career_paths: Vec::new(),
        ..base.clone()
    }))
}

/// Whether a tired person deciding at `tick` picks the bed over the couch.
/// `kind` is the kind of shift they hold; `None` is no job.
fn picks_bed(kind: Option<u8>, tick: u64) -> bool {
    use terri_core::{NeedId, Needs, Position, SmartObject, Target};
    let pack = rhythm_pack(kind.unwrap_or(terri_data::SHIFT_DAY));
    let mut sim = crate::test_content::sim_with(16, 16, pack);
    sim.world_mut().resource_mut::<SimClock>().tick = tick;
    let couch = sim
        .world_mut()
        .spawn((
            Position { x: 5.0, y: 8.0 },
            SmartObject(terri_core::ObjectDefId(0)),
        ))
        .id();
    let bed = sim
        .world_mut()
        .spawn((
            Position { x: 11.0, y: 8.0 },
            SmartObject(terri_core::ObjectDefId(1)),
        ))
        .id();
    let mut needs = Needs::all_at(100.0);
    needs.set(NeedId::Energy, 20.0);
    let agent = sim
        .world_mut()
        .spawn((Agent, SimId(1), Position { x: 8.0, y: 8.0 }, needs))
        .id();
    if kind.is_some() {
        sim.world_mut().entity_mut(agent).insert(Career(0));
    }
    for _ in 0..40 {
        sim.tick();
        match sim.world().get::<Target>(agent).map(|target| target.object) {
            Some(object) if object == bed => return true,
            Some(object) if object == couch => return false,
            _ => {}
        }
    }
    panic!("the person never chose either");
}

/// The shift offset `select_action` adds for each person, read through the
/// system parameter it uses.
fn rhythm_offset(sim: &mut Sim, entity: Entity) -> i32 {
    let mut state = bevy_ecs::system::SystemState::<ShiftRhythm>::new(sim.world_mut());
    state.get(sim.world()).offset(entity)
}

/// [WS-sleep]: a night worker's rhythm puts midnight at 11:00, so the bed
/// wins at 10:00 and loses at 22:00, the reverse of a person with no job.
#[test]
fn a_night_shift_moves_the_beds_appeal_to_the_morning() {
    let morning = 600;
    let evening = 1320;
    assert!(!picks_bed(None, morning), "no job: the couch at 10:00");
    assert!(picks_bed(None, evening), "no job: the bed at 22:00");
    let night = Some(terri_data::SHIFT_NIGHT);
    assert!(
        picks_bed(night, morning),
        "a night worker: the bed at 10:00"
    );
    assert!(
        !picks_bed(night, evening),
        "a night worker: the couch at 22:00"
    );
}

/// [WS-sleep]: the shipped day offset is 0, so a day worker chooses as a
/// person with no job does at every hour tried, and the offset each kind
/// adds is its tuning knob.
#[test]
fn a_day_shift_leaves_the_sleep_drive_unchanged() {
    for tick in [0, 360, 600, 720, 1080, 1320] {
        assert_eq!(
            picks_bed(Some(terri_data::SHIFT_DAY), tick),
            picks_bed(None, tick),
            "tick {tick}"
        );
    }
    let tuning = &terri_data::pack().tuning;
    for (kind, expected) in [
        (None, 0),
        (Some(terri_data::SHIFT_DAY), tuning.shift_sleep_offset_day),
        (
            Some(terri_data::SHIFT_EARLY),
            tuning.shift_sleep_offset_early,
        ),
        (Some(terri_data::SHIFT_LATE), tuning.shift_sleep_offset_late),
        (
            Some(terri_data::SHIFT_NIGHT),
            tuning.shift_sleep_offset_night,
        ),
    ] {
        let mut sim =
            crate::test_content::sim_with(8, 8, rhythm_pack(kind.unwrap_or(terri_data::SHIFT_DAY)));
        let person = sim.world_mut().spawn((Agent, SimId(1))).id();
        if kind.is_some() {
            sim.world_mut().entity_mut(person).insert(Career(0));
        }
        assert_eq!(rhythm_offset(&mut sim, person), expected, "{kind:?}");
    }
    assert_eq!(
        (
            tuning.shift_sleep_offset_day,
            tuning.shift_sleep_offset_early,
            tuning.shift_sleep_offset_late,
            tuning.shift_sleep_offset_night
        ),
        (0, -60, 120, 660),
        "the shipped offsets"
    );
}

/// [WS-sleep]: the offset follows the held shift's kind on days off too.
/// The job works Sunday nights only; on a Wednesday and a Saturday the
/// night worker still sleeps by day.
#[test]
fn the_offset_holds_on_days_off() {
    let night = Some(terri_data::SHIFT_NIGHT);
    for day in [2u64, 5] {
        let tick = day * 1440 + 600;
        assert!(picks_bed(night, tick), "day {day} at 10:00");
        assert!(!picks_bed(None, tick), "day {day} at 10:00 with no job");
    }
}

/// [WS-content]: the five new paths' labels and every level's id, title,
/// pay, pay maximum and promotion weeks, as the spec's tables give them.
#[test]
fn the_five_new_paths_match_the_spec_tables() {
    type Level = (&'static str, &'static str, u32, u32, u32);
    let paths: [(&str, &str, [Level; 4]); 5] = [
        (
            "hospital",
            "Hospital",
            [
                ("hospital_orderly", "Ward orderly", 95, 120, 2),
                (
                    "hospital_nursing_assistant",
                    "Nursing assistant",
                    125,
                    160,
                    3,
                ),
                ("hospital_ward_nurse", "Ward nurse", 170, 220, 3),
                ("hospital_charge_nurse", "Charge nurse", 235, 300, 4),
            ],
        ),
        (
            "warehouse",
            "Warehouse",
            [
                ("warehouse_picker", "Warehouse picker", 90, 110, 2),
                ("warehouse_forklift_driver", "Forklift driver", 110, 140, 2),
                ("warehouse_team_leader", "Team leader", 150, 190, 3),
                ("warehouse_manager", "Warehouse manager", 210, 270, 4),
            ],
        ),
        (
            "library",
            "Library",
            [
                ("library_assistant", "Library assistant", 85, 105, 2),
                ("library_librarian", "Librarian", 105, 130, 3),
                ("library_senior_librarian", "Senior librarian", 140, 175, 3),
                ("library_head_librarian", "Head librarian", 190, 240, 4),
            ],
        ),
        (
            "restaurant_kitchen",
            "Restaurant kitchen",
            [
                ("kitchen_porter", "Kitchen porter", 75, 95, 2),
                ("kitchen_line_cook", "Line cook", 100, 130, 2),
                ("kitchen_sous_chef", "Sous chef", 150, 195, 3),
                ("kitchen_head_chef", "Head chef", 230, 300, 4),
            ],
        ),
        (
            "buses",
            "Buses",
            [
                ("buses_relief_driver", "Relief bus driver", 110, 135, 2),
                ("buses_driver", "Bus driver", 130, 165, 3),
                ("buses_senior_driver", "Senior bus driver", 165, 205, 3),
                ("buses_route_supervisor", "Route supervisor", 205, 255, 4),
            ],
        ),
    ];
    let pack = terri_data::pack();
    for (id, label, levels) in paths {
        let path = &pack.career_paths[path_index(pack, id) as usize];
        assert_eq!(path.label, label, "{id}");
        let actual: Vec<Level> = path
            .levels
            .iter()
            .map(|row| {
                let job = &pack.careers[*row as usize];
                (
                    job.id.as_str(),
                    job.label.as_str(),
                    job.pay,
                    job.pay_max,
                    job.advance_weeks,
                )
            })
            .collect();
        // The top level's advance_weeks is never read; the table still names it.
        assert_eq!(actual, levels.to_vec(), "{id}");
    }
}

// One paid shift a day: the owner's rulings of 2026-10-24.

/// The shipped household with review chances pinned and no search, its
/// worker hired onto the hospital's day shift (07:00 to 15:00, Monday to
/// Friday) at Monday 00:00, run until that shift has settled and the worker
/// is home.
fn worked_hospital_day(edit: impl FnOnce(&mut ContentPack)) -> (Sim, SimId, Entity) {
    let mut sim = shipped_with(|pack| {
        pinned(pack);
        pack.tuning.career_search_chance = 0.0;
        edit(pack);
    });
    let (id, entity) = worker(&mut sim);
    let hospital = path_index(pack(&sim), "hospital");
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: hospital,
            shift: 0,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    while sim
        .world()
        .resource::<crate::attendance::Attendance>()
        .outcomes
        .is_empty()
        || sim.world().get::<terri_core::AtWork>(entity).is_some()
        || sim.world().get::<terri_core::Commuting>(entity).is_some()
    {
        sim.tick();
        assert!(
            sim.world().resource::<SimClock>().tick < 1200,
            "the day shift settles"
        );
    }
    (sim, id, entity)
}

fn starts(sim: &Sim, id: SimId) -> Vec<u64> {
    let attendance = sim.world().resource::<crate::attendance::Attendance>();
    let mut starts: Vec<u64> = attendance
        .outcomes
        .iter()
        .filter(|o| o.sim == id.0)
        .map(|o| o.start_tick)
        .collect();
    if let Some(open) = attendance.shifts.get(&id).filter(|s| !s.settled) {
        starts.push(open.start_tick);
    }
    starts
}

/// Runs to `tick` and returns the starts of every shift so far.
fn starts_through(sim: &mut Sim, id: SimId, tick: u64) -> Vec<u64> {
    while sim.world().resource::<SimClock>().tick < tick {
        sim.tick();
    }
    starts(sim, id)
}

/// Re-assigned on the same path after working today's shift, a worker
/// starts the newly assigned shift the next day: the hospital's night shift
/// at 23:00 does not start on Monday, and does on Tuesday.
#[test]
fn reassignment_on_the_same_path_after_a_worked_shift_starts_tomorrow() {
    let (mut sim, id, entity) = worked_hospital_day(|_| {});
    let hospital = path_index(pack(&sim), "hospital");
    let first = row(pack(&sim), "hospital", 0);
    let night = pack(&sim).careers[first]
        .shift_index("night")
        .expect("listed") as u32;
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: hospital,
            shift: night,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert_eq!(
        starts_through(&mut sim, id, 1439),
        vec![420],
        "one shift on Monday"
    );
    assert_eq!(
        starts_through(&mut sim, id, 1440 + 1381),
        vec![420, 1440 + 1380],
        "the night shift starts on Tuesday"
    );
}

/// Assigned a different path after working today's shift, a worker starts
/// the new job the next day: the night watch's 22:00 shift does not start
/// on Monday, and does on Tuesday.
#[test]
fn a_new_path_after_a_worked_shift_starts_tomorrow() {
    let (mut sim, id, entity) = worked_hospital_day(|_| {});
    let night_watch = path_index(pack(&sim), "night_watch");
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: night_watch,
            shift: 0,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert_eq!(
        starts_through(&mut sim, id, 1439),
        vec![420],
        "one shift on Monday"
    );
    assert_eq!(
        starts_through(&mut sim, id, 1440 + 1321),
        vec![420, 1440 + 1320],
        "the night watch starts on Tuesday"
    );
}

/// A worker home in week 1 whose Friday shift of week 0 (the office's
/// 06:00 start) was never settled: changing shift settles it, and that
/// settlement runs the review that waited for them.
fn waiting_review(
    edit: impl FnOnce(&mut ContentPack),
    record: impl FnOnce(&mut Record),
) -> (Sim, SimId, Entity) {
    let mut sim = shipped_with(|pack| {
        pinned(pack);
        pack.tuning.career_search_chance = 0.0;
        edit(pack);
    });
    let (id, entity) = worker(&mut sim);
    let career = sim.world().get::<Career>(entity).expect("employed").0;
    let start = 4 * 1440 + 360;
    sim.world_mut().resource_mut::<SimClock>().tick = 7 * 1440 + 60;
    sim.world_mut()
        .resource_mut::<crate::attendance::Attendance>()
        .shifts
        .insert(
            id,
            terri_core::save_v17::SavedScheduledShift {
                sim: id.0,
                career,
                start_tick: start,
                end_tick: start + 480,
                worked_ticks: 0,
                accounted_tick: start,
                pay_cents: 12_000,
                settled: false,
                legacy: false,
            },
        );
    record(
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .get_mut(&id)
            .expect("a record"),
    );
    (sim, id, entity)
}

/// The world saves and loads into a fresh game on the same pack.
fn reloads(sim: &Sim) {
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.world_mut().insert_resource(Content(pack(sim)));
    let saved = sim.save_snapshot_v21();
    assert_eq!(
        loaded.load_snapshot_v21(saved),
        Ok(()),
        "the world still saves and loads"
    );
}

/// Review of 2026-10-24, F1: settling the open shift runs a waiting review
/// that fires the worker. The change is then refused as for anyone without
/// a job, creates no record and no change marker, and the world still
/// saves and loads.
#[test]
fn a_change_that_settles_a_firing_review_is_refused() {
    let (mut sim, id, entity) = waiting_review(
        |pack| pack.tuning.career_fire_base = 1.0,
        |record| {
            record.consecutive_poor = 3;
            record.shifts = vec![5.0, 5.0];
        },
    );
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: entity.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(reason(&sim), Some(Some(CareerRefusal::NotEmployed)));
    assert!(sim.world().get::<Career>(entity).is_none(), "fired");
    let careers = sim.world().resource::<Careers>();
    assert!(
        careers.record(id).is_none(),
        "no record for someone without a job"
    );
    assert!(careers.shift_changed.is_empty(), "no change marker");
    reloads(&sim);
}

/// A waiting review that promotes the worker: the change applies at the
/// new level, which offers the same shifts, and the world saves and loads.
#[test]
fn a_change_that_settles_a_promoting_review_applies_at_the_new_level() {
    let (mut sim, id, entity) = waiting_review(
        // Certain whatever the settled shift scores: the chance is clamped.
        |pack| pack.tuning.career_promote_base = 100.0,
        |record| {
            record.consecutive_good = 10;
            record.shifts = vec![100.0, 100.0];
        },
    );
    let before = sim.world().get::<Career>(entity).expect("employed").0;
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: entity.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    let after = sim.world().get::<Career>(entity).expect("employed").0;
    assert_ne!(after, before, "promoted");
    let careers = sim.world().resource::<Careers>();
    assert_eq!(careers.record(id).map(|r| r.shift), Some(1));
    assert_eq!(
        careers.shift_changed.get(&id).map(|c| c.career),
        Some(after)
    );
    reloads(&sim);
}

/// A waiting review that moves the worker to another path: the change is
/// judged against the new job, and whatever the outcome the held shift is
/// one that job offers and the world saves and loads.
#[test]
fn a_change_that_settles_a_path_change_is_judged_against_the_new_job() {
    let (mut sim, id, entity) = waiting_review(
        |pack| {
            pack.tuning.career_change_chance = 1.0;
            pack.tuning.career_change_fit = 2.0;
            pack.tuning.career_change_gap = -100.0;
        },
        |record| record.shifts = vec![55.0, 55.0],
    );
    let before = sim.world().get::<Career>(entity).expect("employed").0;
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: entity.index_u32(),
            shift: 1,
        },
    );
    let after = sim.world().get::<Career>(entity).expect("employed").0;
    assert_ne!(
        pack(&sim).careers[after as usize].path,
        pack(&sim).careers[before as usize].path,
        "the path changed"
    );
    // The index named a shift of the old path, so it is refused rather
    // than read as the new path's shift.
    assert_eq!(reason(&sim), Some(Some(CareerRefusal::ShiftNotOffered)));
    let careers = sim.world().resource::<Careers>();
    let held = careers.record(id).expect("a record").shift;
    assert!(pack(&sim).careers[after as usize].offers(held as usize));
    assert!(careers.shift_changed.is_empty(), "no change marker");
    // [WS-select] item 4: the refusal does not undo the settlement. The
    // open shift ended unscored, and the waiting review ran.
    let attendance = sim.world().resource::<crate::attendance::Attendance>();
    assert!(attendance
        .shifts
        .get(&id)
        .is_some_and(|shift| shift.settled));
    assert_eq!(
        attendance.outcomes.iter().filter(|o| o.sim == id.0).count(),
        1
    );
    assert_eq!(
        careers
            .record(id)
            .map(|r| r.history.iter().map(|w| w.week).collect::<Vec<_>>()),
        Some(vec![0]),
        "the review of week 0 ran"
    );
    reloads(&sim);
}

/// Review of 2026-10-24, R1: a hospital night worker changes to the day
/// shift on Monday at 12:00. Monday's night shift, 23:00 to Tuesday 07:00,
/// still runs on the old schedule; the day shift does not also start at
/// 07:00 on Tuesday, the day that night shift ended, and starts on
/// Wednesday.
#[test]
fn a_change_from_nights_starts_after_the_last_night_ends() {
    let mut sim = shipped_with(|pack| {
        pinned(pack);
        pack.tuning.career_search_chance = 0.0;
    });
    let (id, entity) = worker(&mut sim);
    let hospital = path_index(pack(&sim), "hospital");
    let first = row(pack(&sim), "hospital", 0);
    let night = pack(&sim).careers[first]
        .shift_index("night")
        .expect("listed") as u32;
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: hospital,
            shift: night,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    while sim.world().resource::<SimClock>().tick < 720 {
        sim.tick();
    }
    issue(
        &mut sim,
        SimCommand::ChangeShift {
            agent: entity.index_u32(),
            shift: 0,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert_eq!(
        starts_through(&mut sim, id, 2 * 1440 + 421),
        vec![1380, 2 * 1440 + 420],
        "Monday's night shift, then the day shift on Wednesday"
    );
}

/// Review of 2026-10-24, R1: a night watch worker works Monday 22:00 to
/// Tuesday 06:00 and is assigned the office late shift on Tuesday morning.
/// The new job starts on Wednesday, not at 12:00 on the day the night
/// shift ended.
#[test]
fn a_new_job_after_a_night_shift_starts_the_day_after_it_ends() {
    let mut sim = shipped_with(|pack| {
        pinned(pack);
        pack.tuning.career_search_chance = 0.0;
    });
    let (id, entity) = worker(&mut sim);
    let night_watch = path_index(pack(&sim), "night_watch");
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: night_watch,
            shift: 0,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    while sim.world().resource::<SimClock>().tick < 1440 + 400
        || sim.world().get::<terri_core::AtWork>(entity).is_some()
        || sim.world().get::<terri_core::Commuting>(entity).is_some()
    {
        sim.tick();
        assert!(
            sim.world().resource::<SimClock>().tick < 1440 + 700,
            "home on Tuesday morning"
        );
    }
    let office = path_index(pack(&sim), "office");
    let first = row(pack(&sim), "office", 0);
    let late = pack(&sim).careers[first]
        .shift_index("late")
        .expect("listed") as u32;
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: office,
            shift: late,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert_eq!(
        starts_through(&mut sim, id, 2 * 1440 + 721),
        vec![1320, 2 * 1440 + 720],
        "the night shift, then the office late shift on Wednesday"
    );
}

/// Consecutive nights on one job are not two shifts in a day: a night
/// watch worker starts at 22:00 on Monday and again on Tuesday, the day the
/// first night ended.
#[test]
fn consecutive_nights_on_one_job_each_start() {
    let mut sim = shipped_with(|pack| {
        pinned(pack);
        pack.tuning.career_search_chance = 0.0;
    });
    let (id, entity) = worker(&mut sim);
    let night_watch = path_index(pack(&sim), "night_watch");
    issue(
        &mut sim,
        SimCommand::AssignCareerShift {
            agent: entity.index_u32(),
            path: night_watch,
            shift: 0,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert_eq!(
        starts_through(&mut sim, id, 1440 + 1321),
        vec![1320, 1440 + 1320],
        "Monday and Tuesday nights"
    );
}

/// Review of 2026-10-24, F9: after a new job is assigned, the attendance
/// line no longer reports the old job's last shift and pay.
#[test]
fn the_attendance_report_describes_only_the_current_job() {
    let (mut sim, _, entity) = worked_hospital_day(|_| {});
    let report = crate::attendance::report(sim.world(), entity);
    assert_eq!(
        report.last(),
        Some(&1.0),
        "the settled day shift is reported"
    );
    let library = path_index(pack(&sim), "library");
    issue(
        &mut sim,
        SimCommand::AssignCareer {
            agent: entity.index_u32(),
            path: library,
        },
    );
    assert_eq!(reason(&sim), Some(None));
    assert!(
        crate::attendance::report(sim.world(), entity).is_empty(),
        "the hospital shift is not the library job's"
    );
}

// The one-shift-a-day rule, case by case through `starts_at`.

/// Whether the standard shift of `path`'s first level starts at `now` for
/// the shipped worker whose last registered shift is `last`.
fn starts_after(last: terri_core::save_v17::SavedScheduledShift, path: &str, now: u64) -> bool {
    let mut sim = shipped_with(|_| {});
    let (id, _) = worker(&mut sim);
    let pack = pack(&sim);
    let career = row(pack, path, 0) as u32;
    let shift = pack.careers[career as usize].shift(0).expect("standard");
    sim.world_mut()
        .resource_mut::<crate::attendance::Attendance>()
        .shifts
        .insert(
            id,
            terri_core::save_v17::SavedScheduledShift { sim: id.0, ..last },
        );
    crate::shifts::starts_at(sim.world(), pack, id, career, &shift, now)
}

/// A last shift on `path`'s first level from `start` to `end`.
fn last_shift(
    path: &str,
    start: u64,
    end: u64,
    legacy: bool,
) -> terri_core::save_v17::SavedScheduledShift {
    terri_core::save_v17::SavedScheduledShift {
        sim: 0,
        career: row(terri_data::pack(), path, 0) as u32,
        start_tick: start,
        end_tick: end,
        worked_ticks: end - start,
        accounted_tick: end,
        pay_cents: 0,
        settled: true,
        legacy,
    }
}

/// Review of 2026-10-24, F1: an older save's legacy record of Monday's
/// office shift still makes it Monday's shift, so a night watch job
/// assigned that afternoon does not start at 22:00.
#[test]
fn a_legacy_record_still_blocks_a_second_shift_that_day() {
    assert!(!starts_after(
        last_shift("office", 360, 840, true),
        "night_watch",
        1320
    ));
    assert!(starts_after(
        last_shift("office", 360, 840, true),
        "night_watch",
        1440 + 1320
    ));
}

/// A legacy night recorded from its arrival (22:20) lets the next night of
/// the same job start, though its start and length differ from the
/// schedule's.
#[test]
fn a_legacy_night_lets_the_next_night_of_the_job_start() {
    assert!(starts_after(
        last_shift("night_watch", 1340, 1800, true),
        "night_watch",
        1440 + 1320
    ));
    assert!(
        !starts_after(
            last_shift("night_watch", 1340, 1800, false),
            "night_watch",
            1440 + 1320
        ),
        "a scheduled record with another start is another schedule"
    );
}

/// On the day a night ended, a shift with the same start and length starts
/// only on the same path.
#[test]
fn the_same_schedule_on_another_path_waits_a_day() {
    assert!(starts_after(
        last_shift("night_watch", 1320, 1800, false),
        "night_watch",
        1440 + 1320
    ));
    let mut other_path = last_shift("night_watch", 1320, 1800, false);
    other_path.career = row(terri_data::pack(), "office", 0) as u32;
    assert!(!starts_after(other_path, "night_watch", 1440 + 1320));
}

/// On the day a night ended, a shift on the same path with the same start
/// but another length waits a day.
#[test]
fn another_shift_length_on_the_same_path_waits_a_day() {
    assert!(!starts_after(
        last_shift("night_watch", 1320, 1740, false),
        "night_watch",
        1440 + 1320
    ));
    assert!(starts_after(
        last_shift("night_watch", 1320, 1740, false),
        "night_watch",
        2 * 1440 + 1320
    ));
}
