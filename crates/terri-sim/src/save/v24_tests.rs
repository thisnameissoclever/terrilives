//! Schema twenty-four: the Career tab's score inputs and a queued Go to
//! work (`docs/specs/2026-11-19-career-tab.md`, [CT-save] and [CT-tests],
//! `v24_tests.rs` items 1 to 3 and 5).
use super::*;
use crate::careers::Week;
use crate::{Content, Sim};
use terri_core::{CommandQueue, SimClock, SimCommand, SimId};

/// The week the fixture's clock runs in; weeks before it can be reviewed.
const WEEK: u64 = 2;

fn day_ticks(pack: &ContentPack) -> u64 {
    u64::from(pack.tuning.day_ticks)
}

/// Gives the household's first two people, in id order, the first career
/// path through the player's command, which starts each a career record.
fn employ_two(sim: &mut Sim) {
    let mut people: Vec<(u32, u32)> = sim
        .world_mut()
        .query_filtered::<(bevy_ecs::entity::Entity, &SimId), bevy_ecs::query::With<terri_core::Agent>>()
        .iter(sim.world())
        .map(|(entity, id)| (id.0, entity.index_u32()))
        .collect();
    people.sort_unstable();
    for (_, agent) in people.into_iter().take(2) {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::AssignCareer { agent, path: 0 });
    }
    sim.flush_commands();
    assert_eq!(employed(sim).len(), 2, "two people hold a job");
}

/// The employed people of the household, in id order, with the career row
/// each holds.
fn employed(sim: &Sim) -> Vec<(SimId, u32)> {
    let careers = sim.world().resource::<Careers>();
    careers
        .records
        .keys()
        .filter_map(|id| {
            let entity = crate::edit::living_entity(sim.world(), id.0)?;
            let career = sim.world().get::<terri_core::Career>(entity)?.0;
            Some((*id, career))
        })
        .collect()
}

fn shift_inputs(fit: f32, attended: bool, missed: f32) -> ShiftInputs {
    ShiftInputs {
        fit,
        trait_fit: 0.0,
        social_capacity: 0.75,
        mastery: 0.5,
        mood: -0.5,
        missed_minutes: missed,
        attended,
    }
}

fn week_inputs(week: u64, career: u32, pay: u32) -> WeekInputs {
    WeekInputs {
        week,
        career,
        shifts: 5,
        attended: 4,
        fit: 0.25,
        trait_fit: 0.0,
        social_capacity: 0.75,
        mastery: 0.5,
        mood: -0.5,
        missed_minutes: 30.0,
        pay,
    }
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

/// Gives `id` reviewed weeks `0..weeks`, each with an input row, and two
/// scored shifts this week with their inputs.
fn fill(sim: &mut Sim, id: SimId, career: u32, weeks: u64) {
    let pay = sim.world().resource::<Careers>().records[&id].pay;
    edit(sim, id, |record| {
        record.history = (0..weeks)
            .map(|week| Week {
                week,
                performance: 60.0,
                event: 0,
            })
            .collect();
        record.input_weeks = (0..weeks)
            .map(|week| week_inputs(week, career, pay))
            .collect();
        record.shifts = vec![70.0, 40.0];
        record.shift_inputs = vec![
            shift_inputs(0.5, true, 0.0),
            shift_inputs(-0.25, false, 480.0),
        ];
        record.last_shift = Some(shift_inputs(-0.25, false, 480.0));
    });
}

/// The shipped household at the start of week [`WEEK`]: the first employed
/// person has two reviewed weeks of inputs and two scored shifts this week;
/// the second has only a last shift.
fn with_inputs() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    employ_two(&mut sim);
    let pack = sim.world().resource::<Content>().0;
    sim.world_mut().resource_mut::<SimClock>().tick = WEEK * 7 * day_ticks(pack);
    let people = employed(&sim);
    fill(&mut sim, people[0].0, people[0].1, WEEK);
    edit(&mut sim, people[1].0, |record| {
        record.last_shift = Some(shift_inputs(1.0, true, 0.0));
    });
    sim
}

/// One record's inputs: the person, the current week's shifts, the last
/// shift and the reviewed weeks.
type HeldInputs = (
    SimId,
    Vec<ShiftInputs>,
    Option<ShiftInputs>,
    Vec<WeekInputs>,
);

fn inputs_of(sim: &Sim) -> Vec<HeldInputs> {
    sim.world()
        .resource::<Careers>()
        .records
        .iter()
        .map(|(id, record)| {
            (
                *id,
                record.shift_inputs.clone(),
                record.last_shift,
                record.input_weeks.iter().copied().collect(),
            )
        })
        .collect()
}

/// Item 1: schema twenty-four carries every record's inputs and every
/// queued Go to work at its position; the load hashes as the source does
/// and captures the same snapshot. Schema twenty-three of the same world
/// loads with no inputs and no Go to work, and hashes differently.
#[test]
fn schema_twenty_four_round_trips_inputs_and_queued_go_to_work() {
    let mut sim = with_inputs();
    let people = employed(&sim);
    let agent = crate::edit::living_entity(sim.world(), people[0].0 .0)
        .unwrap()
        .index_u32();
    for command in [
        SimCommand::SetSpeed(2),
        SimCommand::GoToWork { agent },
        SimCommand::ChangeShift { agent, shift: 0 },
        SimCommand::GoToWork { agent },
    ] {
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
    }
    let snapshot = sim.save_snapshot_v24();
    assert_eq!(
        snapshot
            .career_inputs
            .iter()
            .map(|row| row.sim)
            .collect::<Vec<_>>(),
        vec![people[0].0 .0, people[1].0 .0],
        "only records holding inputs, ascending"
    );
    assert_eq!(snapshot.career_inputs[0].current.len(), 2);
    assert_eq!(snapshot.career_inputs[0].weeks.len(), WEEK as usize);
    assert!(snapshot.career_inputs[1].current.is_empty());
    assert!(snapshot.career_inputs[1].last_shift.is_some());
    assert_eq!(
        snapshot.queued_work_commands,
        vec![
            (1, SavedQueuedWorkCommand::GoToWork { agent }),
            (3, SavedQueuedWorkCommand::GoToWork { agent }),
        ],
        "positions in the whole queue"
    );

    let mut restored = Sim::new_from_shipped_lot();
    restored.load_snapshot_v24(snapshot.clone()).expect("loads");
    assert_eq!(inputs_of(&restored), inputs_of(&sim));
    assert_eq!(
        restored.world().resource::<CommandQueue>().as_slice(),
        sim.world().resource::<CommandQueue>().as_slice()
    );
    assert_eq!(restored.world_hash(), sim.world_hash());
    assert_eq!(restored.save_snapshot_v24(), snapshot);

    let older = sim.save_snapshot_v23();
    assert_eq!(older, snapshot.legacy, "schema 23 is the inner envelope");
    let mut none = Sim::new_from_shipped_lot();
    none.load_snapshot_v23(older).expect("loads");
    assert!(none.save_snapshot_v24().career_inputs.is_empty());
    assert!(!none
        .world()
        .resource::<CommandQueue>()
        .as_slice()
        .iter()
        .any(|command| matches!(command, SimCommand::GoToWork { .. })));
    assert_ne!(none.world_hash(), sim.world_hash(), "the inputs are hashed");
}

/// The inputs are part of the build baseline, so opening Build mode and
/// leaving it again keeps them.
#[test]
fn entering_and_leaving_build_keeps_the_inputs() {
    let mut sim = with_inputs();
    let before = sim.save_snapshot_v26();
    let rows = &before.previous.career_inputs;
    assert!(!rows.is_empty());
    sim.begin_build().expect("build opens");
    assert_eq!(sim.save_snapshot_v26(), before, "in Build");
    sim.cancel_build().expect("cancel");
    sim.end_build().expect("leave");
    assert_eq!(sim.save_snapshot_v26(), before, "after Build");
    assert_eq!(inputs_of(&sim), inputs_of(&with_inputs()));
}

/// Loads `snapshot` into a copy of the fixture and checks the load is
/// refused with the world, its inputs and its queue untouched.
fn assert_refused(name: &str, snapshot: SaveSnapshotV24) {
    let mut target = with_inputs();
    let hash = target.world_hash();
    let inputs = inputs_of(&target);
    assert_eq!(
        target.load_snapshot_v24(snapshot),
        Err(SaveError::InvalidValue),
        "{name}"
    );
    assert_eq!(target.world_hash(), hash, "{name}: world unchanged");
    assert_eq!(inputs_of(&target), inputs, "{name}: inputs unchanged");
}

/// Item 2, [CT-save-load] items 1 and 2: rows out of order or repeated,
/// too many, naming someone with no career record, or holding more current
/// inputs than the week's scores, refuse the whole load.
#[test]
fn rows_out_of_order_unknown_or_overfull_refuse_the_load() {
    let clean = with_inputs().save_snapshot_v24();
    let first = clean.career_inputs[0].clone();
    let second = clean.career_inputs[1].clone();
    let cases: Vec<(&str, Vec<SavedCareerInputs>)> = vec![
        ("people out of order", vec![second.clone(), first.clone()]),
        ("a person twice", vec![first.clone(), first.clone()]),
        (
            "nobody with a career record",
            vec![SavedCareerInputs {
                sim: 9_999,
                ..second.clone()
            }],
        ),
        (
            "more current inputs than scores",
            vec![SavedCareerInputs {
                current: [first.current.clone(), first.current[..1].to_vec()].concat(),
                ..first.clone()
            }],
        ),
        (
            "more rows than any list may hold",
            (0..=super::super::MAX_LIST_ENTRIES as u32)
                .map(|sim| SavedCareerInputs {
                    sim,
                    current: Vec::new(),
                    last_shift: None,
                    weeks: Vec::new(),
                })
                .collect(),
        ),
    ];
    for (name, rows) in cases {
        let mut snapshot = clean.clone();
        snapshot.career_inputs = rows;
        assert_refused(name, snapshot);
    }
}

/// Item 2, [CT-save-load] item 3: weeks out of order, repeated, or not a
/// week the record reviewed refuse the load.
#[test]
fn weeks_out_of_order_or_unreviewed_refuse_the_load() {
    let clean = with_inputs().save_snapshot_v24();
    let weeks = clean.career_inputs[0].weeks.clone();
    let unreviewed = SavedWeekInputs {
        week: WEEK,
        ..weeks[1]
    };
    let cases: Vec<(&str, Vec<SavedWeekInputs>)> = vec![
        ("weeks out of order", vec![weeks[1], weeks[0]]),
        ("a week twice", vec![weeks[0], weeks[0]]),
        ("a week never reviewed", vec![weeks[0], unreviewed]),
    ];
    for (name, rows) in cases {
        let mut snapshot = clean.clone();
        snapshot.career_inputs[0].weeks = rows;
        assert_refused(name, snapshot);
    }
}

/// Item 2, [CT-save-load] item 3: more weeks than the knob's maximum
/// refuse the load even when every week was reviewed; exactly the maximum
/// loads.
#[test]
fn more_weeks_than_the_knobs_maximum_refuse_the_load() {
    let most = u64::from(terri_data::Tuning::MAX_CAREER_INPUT_HISTORY_WEEKS);
    let build = |weeks: u64| {
        let mut sim = Sim::new_from_shipped_lot();
        employ_two(&mut sim);
        let pack = sim.world().resource::<Content>().0;
        sim.world_mut().resource_mut::<SimClock>().tick = (weeks + 1) * 7 * day_ticks(pack);
        let (id, career) = employed(&sim)[0];
        fill(&mut sim, id, career, weeks);
        sim
    };
    let over = build(most + 1).save_snapshot_v24();
    let mut target = build(most + 1);
    let hash = target.world_hash();
    assert_eq!(target.load_snapshot_v24(over), Err(SaveError::InvalidValue));
    assert_eq!(target.world_hash(), hash);
    // Exactly the maximum loads, keeping the shipped knob's newest weeks.
    let at = build(most);
    let mut target = Sim::new_from_shipped_lot();
    target
        .load_snapshot_v24(at.save_snapshot_v24())
        .expect("loads");
    let kept = u64::from(terri_data::pack().tuning.career_input_history_weeks);
    let id = employed(&at)[0].0;
    let weeks: Vec<u64> = target.world().resource::<Careers>().records[&id]
        .input_weeks
        .iter()
        .map(|row| row.week)
        .collect();
    assert_eq!(weeks, (most - kept..most).collect::<Vec<_>>());
}

/// Item 2, [CT-save-load] item 4: each impossible value in a reviewed week
/// refuses the load.
#[test]
fn an_impossible_week_refuses_the_load() {
    let clean = with_inputs().save_snapshot_v24();
    let pack = terri_data::pack();
    let good = clean.career_inputs[0].weeks[0];
    let row = &pack.careers[good.career as usize];
    let positive: f32 = row.trait_fit.iter().map(|(_, w)| w.max(0.0)).sum();
    let longest = (0..row.shift_count())
        .filter_map(|index| row.shift(index))
        .map(|shift| shift.shift_ticks)
        .max()
        .unwrap() as f32;
    let cases: Vec<(&str, SavedWeekInputs)> = vec![
        (
            "an unknown career row",
            SavedWeekInputs {
                career: pack.careers.len() as u32,
                ..good
            },
        ),
        (
            "no shifts",
            SavedWeekInputs {
                shifts: 0,
                attended: 0,
                ..good
            },
        ),
        (
            "more shifts than a week holds",
            SavedWeekInputs {
                shifts: MAX_SHIFTS_IN_A_WEEK + 1,
                ..good
            },
        ),
        (
            "more attended than shifts",
            SavedWeekInputs {
                attended: good.shifts + 1,
                ..good
            },
        ),
        (
            "pay under the row's",
            SavedWeekInputs {
                pay: row.pay - 1,
                ..good
            },
        ),
        (
            "pay over the row's",
            SavedWeekInputs {
                pay: row.pay_max + 1,
                ..good
            },
        ),
        (
            "fit not a number",
            SavedWeekInputs {
                fit: f32::NAN,
                ..good
            },
        ),
        ("fit over 1", SavedWeekInputs { fit: 1.01, ..good }),
        (
            "mood under -1",
            SavedWeekInputs {
                mood: -1.01,
                ..good
            },
        ),
        (
            "social capacity under 0",
            SavedWeekInputs {
                social_capacity: -0.01,
                ..good
            },
        ),
        (
            "mastery over 1",
            SavedWeekInputs {
                mastery: f32::INFINITY,
                ..good
            },
        ),
        (
            "trait fit past the row's positive weights",
            SavedWeekInputs {
                trait_fit: positive + 0.01,
                ..good
            },
        ),
        (
            "negative missed minutes",
            SavedWeekInputs {
                missed_minutes: -1.0,
                ..good
            },
        ),
        (
            "more missed minutes than the shifts last",
            SavedWeekInputs {
                missed_minutes: longest * good.shifts as f32 + 1.0,
                ..good
            },
        ),
    ];
    for (name, week) in cases {
        let mut snapshot = clean.clone();
        snapshot.career_inputs[0].weeks[0] = week;
        assert_refused(name, snapshot);
    }
    // The ends of each range load. A week's mean is summed in shift order
    // and divided by the count in f32, so the most trait fit a week can show
    // is that mean of the row's positive weights, not the sum itself.
    let most_trait_fit = (0..MAX_SHIFTS_IN_A_WEEK).fold(0.0_f32, |sum, _| sum + positive)
        / MAX_SHIFTS_IN_A_WEEK as f32;
    let mut edges = clean;
    edges.career_inputs[0].weeks[0] = SavedWeekInputs {
        shifts: MAX_SHIFTS_IN_A_WEEK,
        attended: MAX_SHIFTS_IN_A_WEEK,
        fit: -1.0,
        mood: 1.0,
        social_capacity: 0.0,
        mastery: 1.0,
        trait_fit: most_trait_fit,
        missed_minutes: longest * MAX_SHIFTS_IN_A_WEEK as f32,
        pay: row.pay_max,
        ..good
    };
    let mut target = Sim::new_from_shipped_lot();
    assert_eq!(target.load_snapshot_v24(edges), Ok(()));
}

/// Item 2, [CT-save-load] item 4: an impossible value in a current shift
/// or the last shift refuses the load.
#[test]
fn an_impossible_shift_refuses_the_load() {
    let clean = with_inputs().save_snapshot_v24();
    let good = clean.career_inputs[0].current[0];
    let bad: Vec<(&str, SavedShiftInputs)> = vec![
        (
            "mood not a number",
            SavedShiftInputs {
                mood: f32::NAN,
                ..good
            },
        ),
        ("fit under -1", SavedShiftInputs { fit: -1.5, ..good }),
        (
            "social capacity over 1",
            SavedShiftInputs {
                social_capacity: 1.5,
                ..good
            },
        ),
        (
            "mastery under 0",
            SavedShiftInputs {
                mastery: -0.5,
                ..good
            },
        ),
        (
            "trait fit past every row's weights",
            SavedShiftInputs {
                trait_fit: 1.0e6,
                ..good
            },
        ),
        (
            "missed minutes longer than any shift",
            SavedShiftInputs {
                missed_minutes: 1.0e6,
                ..good
            },
        ),
    ];
    for (name, shift) in bad {
        let mut current = clean.clone();
        current.career_inputs[0].current[0] = shift;
        assert_refused(&format!("current: {name}"), current);
        let mut last = clean.clone();
        last.career_inputs[1].last_shift = Some(shift);
        assert_refused(&format!("last: {name}"), last);
    }
}

/// Item 2, [CT-save-load] item 5: a queued Go to work outside the queue or
/// repeating a position refuses the load.
#[test]
fn a_misplaced_queued_go_to_work_refuses_the_load() {
    let mut sim = with_inputs();
    let agent = crate::edit::living_entity(sim.world(), employed(&sim)[0].0 .0)
        .unwrap()
        .index_u32();
    sim.world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::SetSpeed(2));
    let clean = sim.save_snapshot_v24();
    let go = SavedQueuedWorkCommand::GoToWork { agent };
    let cases: Vec<(&str, Vec<(u32, SavedQueuedWorkCommand)>)> = vec![
        ("past the queue's end", vec![(2, go)]),
        ("a position twice", vec![(0, go), (0, go)]),
        ("positions out of order", vec![(1, go), (0, go)]),
    ];
    for (name, rows) in cases {
        let mut snapshot = clean.clone();
        snapshot.queued_work_commands = rows;
        assert_refused(name, snapshot);
    }
    // Before or after the one queued command loads in that place.
    for position in [0, 1] {
        let mut snapshot = clean.clone();
        snapshot.queued_work_commands = vec![(position, go)];
        let mut target = Sim::new_from_shipped_lot();
        target.load_snapshot_v24(snapshot).expect("loads");
        assert_eq!(
            target.world().resource::<CommandQueue>().as_slice()[position as usize],
            SimCommand::GoToWork { agent }
        );
    }
}

/// Item 3: a save holding more weeks than the knob now keeps loads with
/// the newest knob's worth, and the hash after the load is the trimmed
/// world's.
#[test]
fn a_lowered_knob_keeps_the_newest_weeks_on_load() {
    const KEPT: u32 = 3;
    let mut pack = terri_data::pack().clone();
    pack.tuning.career_input_history_weeks = KEPT;
    let content = Content(Box::leak(Box::new(pack)));
    let seed = content.0.tuning.rng_seed;
    let weeks = u64::from(KEPT) + 2;
    let mut sim = Sim::new_household_with_content(content, seed);
    employ_two(&mut sim);
    sim.world_mut().resource_mut::<SimClock>().tick = (weeks + 1) * 7 * day_ticks(content.0);
    let (id, career) = employed(&sim)[0];
    fill(&mut sim, id, career, weeks);
    let snapshot = sim.save_snapshot_v24();
    assert_eq!(snapshot.career_inputs[0].weeks.len(), weeks as usize);

    let mut target = Sim::new_household_with_content(content, seed);
    target.load_snapshot_v24(snapshot).expect("loads");
    let kept: Vec<u64> = target.world().resource::<Careers>().records[&id]
        .input_weeks
        .iter()
        .map(|row| row.week)
        .collect();
    assert_eq!(kept, (weeks - u64::from(KEPT)..weeks).collect::<Vec<_>>());
    edit(&mut sim, id, |record| {
        let drop = record.input_weeks.len() - KEPT as usize;
        record.input_weeks.drain(..drop);
    });
    assert_eq!(target.world_hash(), sim.world_hash(), "the trimmed world");
}
