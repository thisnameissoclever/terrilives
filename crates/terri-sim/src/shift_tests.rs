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

/// [WS-select] item 4: each refusal leaves the world as it was apart from
/// the command count, and reports its number.
#[test]
fn the_shift_commands_refuse_each_case_without_changing_the_world() {
    let refused = |sim: &mut Sim, command: SimCommand, expected: CareerRefusal| {
        let before = sim.world_hash();
        let commands = sim.world().resource::<Careers>().commands;
        issue(sim, command.clone());
        assert_eq!(reason(sim), Some(Some(expected)), "{command:?}");
        {
            let mut careers = sim.world_mut().resource_mut::<Careers>();
            assert_eq!(careers.commands, commands + 1, "{command:?} is counted");
            careers.commands = commands;
        }
        assert_eq!(sim.world_hash(), before, "{command:?} changes nothing");
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

/// Until schema nineteen carries them (plan Task 9), the current
/// schema-eighteen writer leaves queued shift commands out, and every other
/// queued command, a setting placed by position among them, loads in order.
#[test]
fn schema_eighteen_leaves_queued_shift_commands_out_until_schema_nineteen() {
    let mut sim = Sim::new_from_shipped_lot();
    let (_, entity) = worker(&mut sim);
    let agent = entity.index_u32();
    for command in [
        SimCommand::SetSpeed(2),
        SimCommand::ChangeShift { agent, shift: 1 },
        SimCommand::SetJobSearch {
            agent,
            search: false,
        },
        SimCommand::AssignCareerShift {
            agent,
            path: 1,
            shift: 0,
        },
        SimCommand::SetSpeed(1),
    ] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    }
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v18(sim.save_snapshot_v18())
        .expect("loads");
    assert_eq!(
        loaded.world().resource::<CommandQueue>().as_slice(),
        [
            SimCommand::SetSpeed(2),
            SimCommand::SetJobSearch {
                agent,
                search: false
            },
            SimCommand::SetSpeed(1),
        ]
    );
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
/// validated against the held shift's start, not the standard shift's.
#[test]
fn a_pending_shift_is_validated_against_the_held_shift() {
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
    assert!(!valid(&mut sim, 900));
    let job = pack(&sim).careers[0].clone();
    sim.world_mut().resource_mut::<Careers>().records.insert(
        SimId(1),
        Record {
            shift: 1,
            ..Record::new(&job)
        },
    );
    assert!(!valid(&mut sim, 60), "the held late shift starts at 900");
    assert!(valid(&mut sim, 900));
}
