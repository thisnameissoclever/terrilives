//! The admin panel across the wasm boundary (issue 312, [AP-tests-wasm] in
//! `docs/specs/2026-11-20-admin-panel.md`): the shared wire fixture's bytes
//! decode through `admin_apply`, each read has the layout its doc comment
//! gives, a non-person reads empty, nothing an admin change does leaves a
//! command in the queue, and a save refused for a queued admin command is
//! an empty array rather than a panic.
//!
//! The release-wasm run of item 3 (open, one edit per tab, Undo twice,
//! close, save, reload, compare hashes) is `web/tests/admin-wasm.test.ts`,
//! which runs the built wasm through the bridge. These tests run natively;
//! `docs/testing-protocol.md` section 8 asks for `--release` so a
//! `debug_assert!` cannot stand in for a real check.
use super::*;
use terri_core::admin::{AdminChange, AdminEdit};
use terri_core::{Agent, Habituation, ObjectDefId, SimId};

const FIXTURE: &str = include_str!("../../terri-core/tests/fixtures/admin-wire.json");

fn admin_bytes(edits: Vec<AdminEdit>) -> Vec<u8> {
    postcard::to_allocvec(&SimCommand::Admin(Box::new(AdminChange { edits })))
        .expect("an admin change serializes")
}

/// Every case of the shared fixture: its name and its bytes.
fn fixture_cases() -> Vec<(String, Vec<u8>)> {
    let mut name = String::new();
    let mut cases = Vec::new();
    for line in FIXTURE.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("\"name\": \"") {
            name = rest.trim_end_matches(&['"', ','][..]).to_string();
        } else if let Some(rest) = line.strip_prefix("\"bytes\": [") {
            let bytes = rest
                .trim_end_matches(&[']', ','][..])
                .split(',')
                .map(|byte| byte.trim().parse::<u8>().expect("a byte"))
                .collect();
            cases.push((name.clone(), bytes));
        }
    }
    cases
}

fn opened() -> SimHandle {
    let mut handle = SimHandle::from_lot();
    assert_eq!(handle.admin_begin(), 0);
    handle
}

/// Every living person's `SimId`, ascending.
fn people(handle: &mut SimHandle) -> Vec<u32> {
    let mut ids: Vec<u32> = handle
        .sim
        .world_mut()
        .query::<(&Agent, &SimId)>()
        .iter(handle.sim.world())
        .map(|(_, id)| id.0)
        .collect();
    ids.sort_unstable();
    ids
}

fn queue_len(handle: &SimHandle) -> usize {
    handle.sim.world().resource::<CommandQueue>().len()
}

/// [AP-tests-wasm] item 1: the shared fixture's bytes, which the Rust and
/// TypeScript encoders are both held to, decode through `admin_apply` to the
/// change the ordinary decoder reads from them, and the world ends up as it
/// does when that change is applied directly.
#[test]
fn the_shared_fixtures_bytes_decode_through_admin_apply_to_the_same_changes() {
    let cases = fixture_cases();
    assert!(cases.len() > 26, "every edit code and a two edit change");
    for (name, bytes) in cases {
        let SimCommand::Admin(expected) =
            postcard::from_bytes::<SimCommand>(&bytes).expect("the fixture decodes")
        else {
            panic!("{name}: not an admin command");
        };
        assert_eq!(
            postcard::to_allocvec(&SimCommand::Admin(expected.clone())).unwrap(),
            bytes,
            "{name}: the bytes are the change's own encoding"
        );
        let mut through_wasm = opened();
        let mut direct = opened();
        let reported = through_wasm.admin_apply(&bytes);
        assert_ne!(reported[2], 19, "{name}: read as an admin change");
        match direct.sim.admin_apply(*expected) {
            Ok(depth) => assert_eq!(reported, vec![1, 0, 0, depth as u32], "{name}"),
            Err(refusal) => assert_eq!(
                reported,
                vec![0, refusal.edit, u32::from(refusal.reason.code()), 0],
                "{name}"
            ),
        }
        assert_eq!(
            through_wasm.sim.world_hash(),
            direct.sim.world_hash(),
            "{name}: the same world"
        );
        assert_eq!(queue_len(&through_wasm), 0, "{name}: nothing left queued");
    }
}

/// [AP-tests-wasm] item 2: `admin_apply` drains what it stages, whether the
/// change applies or is refused, and refuses bytes that are not exactly one
/// admin change without staging anything.
#[test]
fn admin_apply_leaves_the_queue_empty_and_refuses_what_is_not_one_change() {
    let mut handle = opened();
    let first = people(&mut handle)[0];
    let hunger = |value| AdminEdit::SetNeed {
        sim: first,
        need: 0,
        value,
    };
    assert_eq!(
        handle.admin_apply(&admin_bytes(vec![hunger(42.0)])),
        vec![1, 0, 0, 1]
    );
    assert_eq!(queue_len(&handle), 0);
    // A refusal names the edit and the reason, and the depth stays.
    assert_eq!(
        handle.admin_apply(&admin_bytes(vec![
            hunger(40.0),
            AdminEdit::SetNeed {
                sim: u32::MAX,
                need: 1,
                value: 10.0,
            },
        ])),
        vec![0, 1, 2, 1],
        "the second edit names nobody: refusal 2 at edit 1"
    );
    assert_eq!(queue_len(&handle), 0);
    assert_eq!(handle.admin_undo_depth(), 1);

    let hash = handle.sim.world_hash();
    let good = admin_bytes(vec![hunger(30.0)]);
    let mut trailing = good.clone();
    trailing.push(0);
    let ordinary = postcard::to_allocvec(&SimCommand::Select(None)).unwrap();
    for (what, bytes) in [
        ("empty", Vec::new()),
        ("truncated", good[..good.len() - 1].to_vec()),
        ("trailing", trailing),
        ("an ordinary command", ordinary),
    ] {
        assert_eq!(handle.admin_apply(&bytes), vec![0, 0, 19, 1], "{what}");
        assert_eq!(queue_len(&handle), 0, "{what}");
    }
    assert_eq!(handle.sim.world_hash(), hash);
}

/// The ordinary entry point never admits admin bytes, even with the panel
/// open, and `admin_apply` with no panel open is refused as 1 and stages
/// nothing.
#[test]
fn only_admin_apply_admits_a_change_and_only_while_the_panel_is_open() {
    let mut handle = SimHandle::from_lot();
    let first = people(&mut handle)[0];
    let bytes = admin_bytes(vec![AdminEdit::SetFunds { cents: 100 }]);
    assert_eq!(handle.admin_apply(&bytes), vec![0, 0, 1, 0], "no session");
    assert_eq!(queue_len(&handle), 0);
    assert_eq!(handle.admin_begin(), 0);
    assert!(!handle.enqueue_command(&bytes), "open or not, refused here");
    assert_eq!(queue_len(&handle), 0);
    assert_eq!(handle.admin_apply(&bytes), vec![1, 0, 0, 1]);
    handle.admin_end();
    assert_eq!(handle.admin_undo_depth(), 0, "closed: no journal");
    assert_eq!(handle.admin_undo(), 1, "closed: nothing to undo");
    assert!(first < u32::MAX);
}

/// The session codes: 0 opened, 3 already open, 1 while Build is open, and
/// Build refuses to open during a session with its own failure 16.
#[test]
fn admin_begin_and_build_refuse_each_other() {
    let mut handle = SimHandle::from_lot();
    assert_eq!(handle.admin_begin(), 0);
    assert_eq!(handle.admin_begin(), 3);
    assert_eq!(handle.begin_build(), vec![1, 1, 16, 0], "AdminActive is 16");
    handle.admin_end();
    assert_eq!(
        handle.begin_build()[1],
        0,
        "Build opens once the panel is closed"
    );
    assert_eq!(handle.admin_begin(), 1);
}

/// Undo's codes: 1 with nothing to undo, 0 when it steps back, and the depth
/// follows the journal.
#[test]
fn admin_undo_steps_back_one_change_at_a_time() {
    let mut handle = opened();
    assert_eq!(handle.admin_undo(), 1);
    let baseline = handle.sim.world_hash();
    assert_eq!(
        handle.admin_apply(&admin_bytes(vec![AdminEdit::AdjustFunds { cents: 500 }])),
        vec![1, 0, 0, 1]
    );
    assert_eq!(
        handle.admin_apply(&admin_bytes(vec![AdminEdit::AdjustFunds { cents: 700 }])),
        vec![1, 0, 0, 2]
    );
    assert_eq!(handle.admin_undo_depth(), 2);
    assert_eq!(handle.admin_undo(), 0);
    assert_eq!(handle.admin_undo_depth(), 1);
    assert_eq!(handle.admin_undo(), 0);
    assert_eq!(handle.sim.world_hash(), baseline);
    assert_eq!(handle.admin_undo(), 1);
}

/// `admin_person`: needs, satisfaction and the job fields, in the order its
/// doc comment gives.
#[test]
fn admin_person_reads_needs_satisfaction_and_the_job() {
    let mut handle = opened();
    let ids = people(&mut handle);
    let first = ids[0];
    let applied = handle.admin_apply(&admin_bytes(vec![
        AdminEdit::SetNeed {
            sim: first,
            need: 3,
            value: 61.0,
        },
        AdminEdit::SetSatisfaction {
            sim: first,
            value: 44.0,
        },
    ]));
    assert_eq!(applied[0], 1);
    let row = handle.admin_person(first);
    assert_eq!(row.len(), 18);
    assert_eq!(row[3], 61.0, "Bladder is the fourth need");
    assert_eq!(row[7], 44.0, "satisfaction follows the seven needs");
    let index = terri_sim::edit::living_entity(handle.sim.world(), first)
        .unwrap()
        .index_u32();
    for (need, value) in handle.needs_of(index).iter().enumerate() {
        assert_eq!(
            row[need],
            f64::from(*value),
            "need {need} agrees with needs_of"
        );
    }
    // The shipped household already works: row 0 at the standard shift.
    assert_eq!(row[8], 0.0, "career row 0");
    assert_eq!(row[9], 0.0, "the standard shift");
    assert!(row[10] > 0.0, "pay");
    assert!(row[16] <= row[10] && row[10] <= row[17], "pay in its range");

    let applied = handle.admin_apply(&admin_bytes(vec![AdminEdit::SetJob {
        sim: first,
        job: None,
        shift: 0,
    }]));
    assert_eq!(applied[0], 1, "{applied:?}");
    assert_eq!(
        handle.admin_person(first)[8..],
        [-1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
        "no job: row -1, nothing else, the job search on"
    );

    // A job: the level's row, the standard shift, the level's starting pay,
    // middling satisfaction and the range the pay and weeks take.
    let applied = handle.admin_apply(&admin_bytes(vec![AdminEdit::SetJob {
        sim: first,
        job: Some(0),
        shift: 0,
    }]));
    assert_eq!(applied[0], 1, "{applied:?}");
    let row = handle.admin_person(first);
    assert_eq!(row[8], 0.0, "career row 0");
    assert_eq!(row[9], 0.0, "the standard shift");
    assert!(row[10] > 0.0, "pay");
    assert_eq!(row[11], 50.0, "job satisfaction starts middling");
    assert_eq!((row[12], row[13]), (0.0, 0.0), "no weeks yet");
    assert_eq!(row[14], 1.0, "job search on");
    assert!(row[15] >= 1.0, "advance_weeks");
    assert!(row[16] <= row[10] && row[10] <= row[17], "pay in its range");
    // Setting each field reads back. The three career counters share one
    // unit, so each is its own change.
    for edit in [
        AdminEdit::SetJobSatisfaction {
            sim: first,
            value: 12.5,
        },
        AdminEdit::SetGoodWeeks {
            sim: first,
            weeks: 1,
        },
        AdminEdit::SetPoorWeeks {
            sim: first,
            weeks: 2,
        },
        AdminEdit::SetJobSearch {
            sim: first,
            on: false,
        },
    ] {
        let applied = handle.admin_apply(&admin_bytes(vec![edit.clone()]));
        assert_eq!(applied[0], 1, "{edit:?}: {applied:?}");
    }
    let row = handle.admin_person(first);
    assert_eq!(&row[11..15], &[12.5, 1.0, 2.0, 0.0]);
}

/// Anyone but a living housemate reads empty from every per-person read:
/// a `SimId` nobody has.
#[test]
fn reads_are_empty_for_anyone_who_is_not_a_living_housemate() {
    let handle = opened();
    for nobody in [u32::MAX, 987_654] {
        assert!(handle.admin_person(nobody).is_empty());
        assert!(handle.admin_repetition(nobody).is_empty());
        assert!(handle.admin_moodlets(nobody).is_empty());
        assert!(handle.admin_timers(nobody).is_empty());
        assert!(handle.admin_affinities(nobody).is_empty());
    }
}

/// `admin_repetition`: `[object, row, value, food]` per entry, and a set value
/// reads back.
#[test]
fn admin_repetition_lists_each_entry() {
    let mut handle = opened();
    let first = people(&mut handle)[0];
    assert!(handle.admin_repetition(first).is_empty(), "none yet");
    let pack = handle.sim.world().resource::<terri_sim::Content>().0;
    let (object, row) = (0..pack.objects.len() as u32)
        .find(|&object| !terri_sim::action_rows::rows(pack, ObjectDefId(object)).is_empty())
        .map(|object| (object, 0))
        .expect("an object with an action row");
    let entity = terri_sim::edit::living_entity(handle.sim.world(), first).unwrap();
    // A person carries the component only once they have done something.
    if handle.sim.world().get::<Habituation>(entity).is_none() {
        handle
            .sim
            .world_mut()
            .entity_mut(entity)
            .insert(Habituation::default());
    }
    handle
        .sim
        .world_mut()
        .get_mut::<Habituation>(entity)
        .expect("inserted above")
        .bump(ObjectDefId(object), row, 1.5, pack.tuning.habituation_max);
    let held = handle.admin_repetition(first);
    assert_eq!(held[..3], [f64::from(object), f64::from(row), 1.5]);
    let food = held[3];
    assert!(food == 0.0 || food == 1.0, "a flag: {food}");
    assert_eq!(held.len(), 4);
    let applied = handle.admin_apply(&admin_bytes(vec![AdminEdit::SetRepetition {
        sim: first,
        object,
        row,
        value: 2.25,
    }]));
    assert_eq!(applied[0], 1, "{applied:?}");
    assert_eq!(
        handle.admin_repetition(first),
        vec![f64::from(object), f64::from(row), 2.25, food]
    );
}

/// `admin_repetition`'s food flag marks exactly the rows that make a person
/// Feeling sick at `sick_threshold`: the moodlet appears for a food row at
/// the threshold and for no other.
#[test]
fn admin_repetition_flags_the_food_rows_that_make_a_person_sick() {
    let mut handle = opened();
    let first = people(&mut handle)[0];
    let entity = terri_sim::edit::living_entity(handle.sim.world(), first).unwrap();
    let index = entity.index_u32();
    let pack = handle.sim.world().resource::<terri_sim::Content>().0;
    let sick_at = pack.tuning.sick_threshold;
    let max = pack.tuning.habituation_max;
    let mut food_rows = 0;
    let mut other_rows = 0;
    for object in 0..pack.objects.len() as u32 {
        for action in terri_sim::action_rows::rows(pack, ObjectDefId(object)) {
            // A fresh component each time, so this row is the only entry.
            handle
                .sim
                .world_mut()
                .entity_mut(entity)
                .insert(Habituation::default());
            handle
                .sim
                .world_mut()
                .get_mut::<Habituation>(entity)
                .unwrap()
                .bump(ObjectDefId(object), action.row, sick_at.min(max), max);
            let held = handle.admin_repetition(first);
            if held.is_empty() {
                continue;
            }
            let sick = handle
                .mood_summary_of(index)
                .iter()
                .any(|label| label == "Feeling sick");
            assert_eq!(
                held[3] == 1.0,
                sick,
                "object {object} row {}: the flag and the moodlet agree",
                action.row
            );
            if sick {
                food_rows += 1;
            } else {
                other_rows += 1;
            }
        }
    }
    assert!(food_rows > 0, "the shipped pack has a food row");
    assert!(other_rows > 0, "and rows that are not food");
}

/// `admin_timers` and `admin_moodlets`: a fight timer is code 1 with the tick
/// it ends, the moodlet read says where each moodlet comes from, and its
/// rows line up with the mood read's labels.
#[test]
fn admin_timers_and_moodlets_say_what_runs_and_where_it_comes_from() {
    let mut handle = opened();
    let ids = people(&mut handle);
    let first = ids[0];
    assert!(handle.admin_timers(first).is_empty());
    let until = handle.sim.world().resource::<terri_core::SimClock>().tick + 500;
    handle
        .sim
        .world_mut()
        .resource_mut::<terri_sim::fights::Fights>()
        .timers
        .record(SimId(first), until);
    assert_eq!(handle.admin_timers(first), vec![1.0, until as f64]);

    // Mood from needs: the accumulated balance (issue 355), whose label says
    // where it comes from, so it carries no source.
    let index = terri_sim::edit::living_entity(handle.sim.world(), first)
        .unwrap()
        .index_u32();
    let entity = terri_sim::edit::living_entity(handle.sim.world(), first).unwrap();
    handle
        .sim
        .world_mut()
        .entity_mut(entity)
        .insert(terri_sim::need_mood::NeedMood(-30_000));
    let rows = handle.admin_moodlets(first);
    let labels = handle.mood_summary_of(index);
    assert_eq!(rows.len() % 4, 0);
    assert_eq!(
        rows.len() / 4 + 1,
        labels.len(),
        "overall label, then one per row"
    );
    let scores = handle.mood_snapshot_of(index);
    let row_of = |label: &str| {
        let at = labels.iter().position(|l| l == label).expect(label) - 1;
        &rows[at * 4..at * 4 + 4]
    };
    let from_needs = row_of("Mood from needs");
    assert_eq!(from_needs[0], 0.0, "no short explanation");
    assert_eq!(from_needs[1], 0.0);
    assert_eq!(from_needs[2], -5.0);
    assert_eq!(
        from_needs[2],
        f64::from(scores[labels.iter().position(|l| l == "Mood from needs").unwrap()])
    );
    assert_eq!(from_needs[3], -1.0, "the balance has no end");
    assert!(
        rows.chunks(4).all(|row| !(10.0..=26.0).contains(&row[0])),
        "no row names a need below a mood band"
    );
    let fight = row_of("Had a fight");
    assert_eq!(
        (fight[0], fight[3]),
        (41.0, until as f64),
        "timer 1 ends at its tick"
    );
}

/// `admin_bills`: the count, each bill's seven numbers, then the due days.
#[test]
fn admin_bills_lists_each_bill_and_the_due_days() {
    let mut handle = opened();
    let empty = handle.admin_bills();
    let first_count = empty[0] as usize;
    let first_options = empty.len() - 1 - first_count * 7;
    assert!(
        first_options >= 1,
        "today's month start is always an option"
    );
    let applied = handle.admin_apply(&admin_bytes(vec![AdminEdit::AddBill {
        due_day: 0,
        kind: 3,
        amount_cents: 12_345,
        late_fee_cents: 0,
    }]));
    assert_eq!(applied[0], 1, "{applied:?}");
    let rows = handle.admin_bills();
    let count = rows[0] as usize;
    assert_eq!(count, first_count + 1);
    assert_eq!(
        rows.len() - 1 - count * 7,
        first_options,
        "options are not rows"
    );
    let bill = rows[1..1 + count * 7]
        .chunks(7)
        .find(|bill| bill[0] == 0.0 && bill[1] == 3.0)
        .expect("the added bill");
    assert_eq!(bill[2], 12_345.0, "amount");
    assert_eq!(bill[3], 0.0, "no fee");
    assert_eq!(bill[4], -1.0, "unpaid");
    assert!(bill[5] >= 0.0, "fee cap");
    assert!(bill[6] >= bill[0], "overdue from at or after due");
    let options = &rows[1 + count * 7..];
    assert_eq!(
        options[0],
        options.iter().cloned().fold(f64::MIN, f64::max),
        "newest first"
    );
    assert!(options.windows(2).all(|pair| pair[0] > pair[1]));
    assert!(options.contains(&0.0), "day 0 is a month start");
}

/// `skill_practice_for`: what comes back reads as the level and fraction
/// asked for, and nonsense is -1.
#[test]
fn skill_practice_for_reads_back_as_the_level_and_fraction() {
    let mut handle = SimHandle::from_lot();
    let first = people(&mut handle)[0];
    let index = terri_sim::edit::living_entity(handle.sim.world(), first)
        .unwrap()
        .index_u32();
    let levels = handle.skill_levels();
    assert!(!levels.is_empty());
    let mut panel = opened();
    for (skill, top) in levels.iter().enumerate() {
        for level in 0..=*top {
            for fraction in [0.0f32, 0.25, 0.5, 0.99] {
                if level == *top && fraction != 0.0 {
                    assert_eq!(
                        handle.skill_practice_for(skill as u32, level, fraction),
                        -1.0
                    );
                    continue;
                }
                let practice = handle.skill_practice_for(skill as u32, level, fraction);
                assert!(
                    practice >= 0.0,
                    "skill {skill} level {level} fraction {fraction}"
                );
                let applied = panel.admin_apply(&admin_bytes(vec![AdminEdit::SetSkillPractice {
                    sim: first,
                    skill: skill as u32,
                    practice,
                }]));
                assert_eq!(
                    applied[0], 1,
                    "{applied:?}: the practice is within the ladder"
                );
                let standing = &panel.skills_of(index)[skill * 3..skill * 3 + 3];
                assert_eq!(
                    standing[0], level as f32,
                    "skill {skill} level {level} fraction {fraction}"
                );
                assert!(
                    (standing[1] - fraction).abs() < 1e-3,
                    "skill {skill} level {level}: {} for {fraction}",
                    standing[1]
                );
            }
        }
        assert_eq!(handle.skill_practice_for(skill as u32, top + 1, 0.0), -1.0);
    }
    assert_eq!(
        handle.skill_practice_for(levels.len() as u32, 0, 0.0),
        -1.0,
        "no such skill"
    );
    assert_eq!(
        handle.skill_practice_for(0, 0, 1.0),
        -1.0,
        "fraction 1 is the next level"
    );
    assert_eq!(handle.skill_practice_for(0, 0, -0.1), -1.0);
    assert_eq!(handle.skill_practice_for(0, 0, f32::NAN), -1.0);
}

/// [AP-save-queue] item 3 at the wasm save path: a queue that holds an admin
/// command is refused as an empty array, not a panic, nothing is written
/// and the same world saves once the queue is clear.
#[test]
fn a_save_with_an_admin_command_queued_is_refused_cleanly() {
    let mut handle = SimHandle::from_lot();
    let saved = handle.save_bytes();
    assert!(!saved.is_empty());
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::Admin(Box::new(AdminChange {
            edits: vec![AdminEdit::SetFunds { cents: 1 }],
        })));
    assert!(handle.save_bytes().is_empty(), "refused, not written");
    assert!(
        !handle.load_bytes(&handle.save_bytes()),
        "empty is not a save"
    );
    handle
        .sim
        .world_mut()
        .resource_mut::<CommandQueue>()
        .drain()
        .for_each(drop);
    assert_eq!(
        handle.save_bytes(),
        saved,
        "saves again once the queue is clear"
    );
}

/// A save taken while the panel is open holds the edits applied so far and
/// no session: it loads as an ordinary game with the panel closed, and the
/// loaded world hashes as the live one.
#[test]
fn a_save_taken_with_the_panel_open_loads_with_the_edits_and_no_session() {
    let mut handle = opened();
    let first = people(&mut handle)[0];
    for edit in [
        AdminEdit::SetNeed {
            sim: first,
            need: 2,
            value: 17.0,
        },
        AdminEdit::SetFunds { cents: 123_456 },
        AdminEdit::SetFeeling {
            from: first,
            to: people(&mut handle)[1],
            value: -0.5,
        },
    ] {
        assert_eq!(handle.admin_apply(&admin_bytes(vec![edit]))[0], 1);
    }
    let bytes = handle.save_bytes();
    let mut loaded = SimHandle::from_lot();
    assert!(loaded.load_bytes(&bytes));
    assert_eq!(loaded.sim.world_hash(), handle.sim.world_hash());
    assert_eq!(loaded.admin_undo_depth(), 0);
    assert_eq!(
        loaded.admin_begin(),
        0,
        "the loaded game opens a fresh session"
    );
}

/// `admin_affinities`: one value per kind in pack order, and a set value
/// reads back.
#[test]
fn admin_affinities_lists_each_kind_and_reads_a_set_value_back() {
    let mut handle = opened();
    let first = people(&mut handle)[0];
    let kinds = handle.affinity_labels().len();
    assert!(kinds >= 2, "the shipped pack has several affinity kinds");
    let before = handle.admin_affinities(first);
    assert_eq!(before.len(), kinds);
    assert!(before.iter().all(|value| (-1.0..=1.0).contains(value)));
    let applied = handle.admin_apply(&admin_bytes(vec![AdminEdit::SetAffinity {
        sim: first,
        kind: 1,
        value: -0.75,
    }]));
    assert_eq!(applied[0], 1, "{applied:?}");
    let after = handle.admin_affinities(first);
    assert_eq!(after[1], -0.75);
    assert_eq!(after[0], before[0], "the other kinds are untouched");
}

/// `admin_trait_skills`: one entry per pack trait, a skill index only for a
/// capability whose tag names a skill.
#[test]
fn admin_trait_skills_names_the_skill_each_capability_trains() {
    let handle = SimHandle::from_lot();
    let skills = handle.admin_trait_skills();
    let kinds = handle.trait_kinds();
    assert_eq!(skills.len(), kinds.len());
    let skill_count = handle.skill_levels().len() as f64;
    let mut capabilities = 0;
    for (trait_kind, skill) in kinds.iter().zip(&skills) {
        if trait_kind == "capability" {
            capabilities += 1;
            assert!(
                *skill == -1.0 || (0.0..skill_count).contains(skill),
                "a skill index or none: {skill}"
            );
        } else {
            assert_eq!(*skill, -1.0, "only a capability trains a skill");
        }
    }
    assert!(capabilities > 0, "the shipped pack has capabilities");
    assert!(
        skills.iter().any(|skill| *skill >= 0.0),
        "at least one capability trains a skill"
    );
}

/// `admin_job_options`: a `[path, level, row, first shift]` quad per career
/// level, and every row is one `SetJob` accepts with the shift it names.
#[test]
fn admin_job_options_lists_every_level_and_each_row_is_a_job() {
    let mut handle = opened();
    let first = people(&mut handle)[0];
    let options = handle.admin_job_options();
    assert!(!options.is_empty() && options.len().is_multiple_of(4));
    let paths = handle.career_path_labels().len() as f64;
    let mut previous: Option<(f64, f64)> = None;
    for quad in options.chunks(4) {
        let (path, level, row, shift) = (quad[0], quad[1], quad[2], quad[3]);
        assert!(shift >= 0.0, "every shipped level offers a shift");
        assert!((0.0..paths).contains(&path));
        match previous {
            Some((p, l)) if p == path => assert_eq!(level, l + 1.0, "levels count up"),
            _ => assert_eq!(level, 0.0, "each path starts at level 0"),
        }
        previous = Some((path, level));
        let applied = handle.admin_apply(&admin_bytes(vec![AdminEdit::SetJob {
            sim: first,
            job: Some(row as u32),
            shift: shift as u32,
        }]));
        assert_eq!(applied[0], 1, "row {row}: {applied:?}");
        assert_eq!(handle.admin_person(first)[8], row, "the person holds it");
    }
}

/// `admin_limits`: the tuning the panel's ranges come from.
#[test]
fn admin_limits_reads_the_tuning_the_panel_ranges_come_from() {
    let handle = SimHandle::from_lot();
    let limits = handle.admin_limits();
    assert_eq!(limits.len(), terri_sim::admin::reads::LIMITS_LEN);
    let tuning = &handle.sim.world().resource::<terri_sim::Content>().0.tuning;
    assert_eq!(limits[0], f64::from(tuning.habituation_max));
    assert_eq!(limits[1], f64::from(tuning.overdoing_threshold));
    assert_eq!(limits[2], f64::from(tuning.sick_threshold));
    assert_eq!(limits[3], f64::from(tuning.housemate_max_traits));
    assert_eq!(
        limits[4],
        f64::from(terri_sim::careers::most_poor_weeks(tuning)),
        "the most poor weeks the panel sets"
    );
    assert_eq!(limits[5], f64::from(tuning.admin_skip_max_hours));
    assert_eq!(limits[6], f64::from(tuning.admin_skip_default_hours));
    assert_eq!(limits[7], f64::from(tuning.admin_skip_ticks_per_frame));
    assert_eq!(
        limits[5..],
        [168.0, 8.0, 300.0],
        "the shipped Skip ahead knobs"
    );
}
