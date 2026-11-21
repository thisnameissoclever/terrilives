//! The Housemate tab's career edits ([T5], [AP-e-job] to [AP-e-search]):
//! job, shift, pay, job satisfaction, good and poor weeks, and job search.
//! Every edit applies, refuses each of its listed refusal codes with the hash
//! unchanged, moves the hash, survives a save, draws no random number and
//! Undo takes it back. A job change settles a late-at-home shift exactly as
//! the Career tab's assignment does, and a shift change takes effect from the
//! next day as the Career tab's does ([AP-tests-sim] items 1, 3, 4, 5 and 10).
use crate::admin::AdminRefusal::{self, *};
use crate::admin_test_support::*;
use crate::attendance::Attendance;
use crate::careers::go_to_work_tests::{
    at, commuting, day_ticks, fixture, issue, now, order, outcomes, send, shift, start_with,
    status, window, work_the_shift, HOLD, LATE_START, SHIFT, START,
};
use crate::careers::{Careers, Record, WorkStatus};
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::admin::AdminEdit;
use terri_core::{AtWork, Career, Commuting, Funds, SimCommand, SimId};
use terri_data::ContentPack;

/// The go-to-work fixture's worker on a level with a second, late shift
/// offered, so a shift change has somewhere to go.
fn with_late_shift(pack: &mut ContentPack) {
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
}

/// The go-to-work fixture as a load leaves it, with the late shift offered.
/// The fixture as built assigns its bed only after a load (see
/// `loaded_fixture` in `go_to_work_tests.rs`), so a world that Undo rebuilds
/// or a save reloads would part from it on the next tick for a reason that
/// has nothing to do with the panel; starting from a loaded world keeps the
/// comparisons about the edits.
fn loaded_fixture(tune: impl Fn(&mut ContentPack)) -> (Sim, Entity, Vec<Entity>) {
    let (mut sim, actor, objects) = fixture(|pack| {
        with_late_shift(pack);
        tune(pack);
    });
    let id = id_of(&sim, actor);
    let snapshot = sim.save_snapshot_v24();
    sim.load_snapshot_v24(snapshot).expect("loads");
    let actor = crate::edit::living_entity(sim.world(), id).expect("the worker");
    (sim, actor, objects)
}

/// The worker's `SimId`.
fn id_of(sim: &Sim, actor: Entity) -> u32 {
    sim.world().get::<SimId>(actor).expect("a person").0
}

fn pack_of(sim: &Sim) -> &'static ContentPack {
    sim.world().resource::<Content>().0
}

/// The fixture with the late shift offered and the worker holding a fresh
/// record at the first career row, at home on tick 100, with the panel open.
fn job_world(tune: impl Fn(&mut ContentPack)) -> (Sim, Entity, u32) {
    let (mut sim, actor, _) = loaded_fixture(|pack| {
        // The fixture leaves firing impossible; the poor-week bound needs
        // the shipped chance unless a test tunes its own.
        pack.tuning.career_fire_base = terri_data::pack().tuning.career_fire_base;
        tune(pack);
    });
    at(&mut sim, 100);
    let id = id_of(&sim, actor);
    let job = pack_of(&sim).careers[0].clone();
    sim.world_mut()
        .resource_mut::<Careers>()
        .records
        .insert(SimId(id), Record::new(&job));
    sim.begin_admin().expect("opens");
    (sim, actor, id)
}

fn record_of(sim: &Sim, id: u32) -> Option<Record> {
    sim.world().resource::<Careers>().record(SimId(id)).cloned()
}

fn career_of(sim: &Sim, actor: Entity) -> Option<u32> {
    sim.world().get::<Career>(actor).map(|career| career.0)
}

fn attendance(sim: &Sim) -> Attendance {
    sim.world()
        .get_resource::<Attendance>()
        .cloned()
        .unwrap_or_default()
}

/// What an admin edit must never touch ([AP-cmd-drain]): the career command
/// count and result, and the lot edit result.
fn untouched(sim: &Sim) -> (u64, String, String) {
    let careers = sim.world().resource::<Careers>();
    let lot = sim
        .world()
        .get_resource::<crate::placement::LotEditState>()
        .map(|state| format!("{:?}", state.last_edit_result))
        .unwrap_or_default();
    (careers.commands, format!("{:?}", careers.last_result), lot)
}

/// The first row and shift index above 0 a level offers, and its path.
fn row_with_another_shift(pack: &ContentPack) -> (u32, u32) {
    pack.careers
        .iter()
        .enumerate()
        .find_map(|(row, job)| {
            (1..job.shift_count())
                .find(|&index| job.offers(index))
                .map(|index| (row as u32, index as u32))
        })
        .expect("some level offers a second shift")
}

/// The first shift index `row` offers.
fn first_offered(pack: &ContentPack, row: u32) -> u32 {
    let job = &pack.careers[row as usize];
    (0..job.shift_count())
        .find(|&index| job.offers(index))
        .expect("a level offers a shift") as u32
}

/// [AP-tests-sim] item 3 for a world built on its own content: a save loads
/// into a world of the same content and hashes as the live one.
fn assert_survives_save_on_own_content(sim: &Sim, what: &str) {
    let snapshot = sim
        .try_save_snapshot_v24()
        .unwrap_or_else(|error| panic!("{what}: nothing admin is queued ({error:?})"));
    let mut loaded = Sim::new_with_lot_and_content(20, 20, Content(pack_of(sim)));
    loaded
        .load_snapshot_v24(snapshot)
        .unwrap_or_else(|error| panic!("{what}: the save loads ({error:?})"));
    assert_eq!(
        loaded.world_hash(),
        sim.world_hash(),
        "{what}: the loaded world hashes as the live one"
    );
}

/// The worker sent to work at the start, at work for an hour, then sent home
/// by a player order and back home before the shift ends: an open shift
/// that has started, with time worked, while the worker is at home.
fn worked_then_home() -> (Sim, Entity, u32) {
    let (mut sim, actor, objects) = loaded_fixture(|_| {});
    start_with(&mut sim, actor, &[]);
    while sim.world().get::<AtWork>(actor).is_none() {
        assert!(now(&sim) < START + 200, "never arrived");
        sim.tick();
    }
    for _ in 0..60 {
        sim.tick();
    }
    order(&mut sim, actor, objects[HOLD]);
    assert_eq!(commuting(&sim, actor), Some(Commuting::Inbound));
    sim.world_mut()
        .entity_mut(actor)
        .remove::<terri_core::Path>();
    crate::attendance::finish_tick(sim.world_mut());
    assert_eq!(commuting(&sim, actor), None, "home");
    let open = shift(&sim, actor).expect("the shift is open");
    assert!(!open.settled && open.worked_ticks > 0, "{open:?}");
    assert!(matches!(status(&sim, actor), WorkStatus::Late(_)));
    let id = id_of(&sim, actor);
    (sim, actor, id)
}

/// The worker after today's shift settled at home, sent to work for
/// tomorrow's shift before its start (registering it replaces today's
/// record), then sent home by an order: a pre-registered shift and the
/// replaced record waiting beside it.
fn pre_registered_at_home() -> (Sim, Entity, u32) {
    let (mut sim, actor, objects) = loaded_fixture(|_| {});
    work_the_shift(&mut sim, actor);
    for _ in 0..400 {
        if commuting(&sim, actor).is_none() && sim.world().get::<AtWork>(actor).is_none() {
            break;
        }
        sim.tick();
    }
    let tomorrow = day_ticks(&sim) + START - window(&sim);
    at(&mut sim, tomorrow);
    assert_eq!(send(&mut sim, actor), None);
    order(&mut sim, actor, objects[HOLD]);
    sim.world_mut()
        .entity_mut(actor)
        .remove::<terri_core::Path>();
    crate::attendance::finish_tick(sim.world_mut());
    assert_eq!(commuting(&sim, actor), None, "home");
    let id = id_of(&sim, actor);
    assert!(
        attendance(&sim).replaced.contains_key(&SimId(id)),
        "registering replaced the settled record"
    );
    (sim, actor, id)
}

/// One edit of every career kind, ordered so each changes what the one
/// before left: job satisfaction first, so installing a fresh record at the
/// level already held still changes the record.
fn every_career_kind(sim: u32, row: u32, other_shift: u32) -> Vec<AdminEdit> {
    vec![
        AdminEdit::SetJobSatisfaction { sim, value: 12.0 },
        AdminEdit::SetJob {
            sim,
            job: Some(row),
            shift: 0,
        },
        AdminEdit::SetShift {
            sim,
            shift: other_shift,
        },
        AdminEdit::SetPay { sim, dollars: 0 },
        AdminEdit::SetGoodWeeks { sim, weeks: 1 },
        AdminEdit::SetPoorWeeks { sim, weeks: 2 },
        AdminEdit::SetJobSearch { sim, on: true },
        AdminEdit::SetJob {
            sim,
            job: None,
            shift: 0,
        },
    ]
}

/// The edits of [`every_career_kind`] with the pay set to the top of the
/// level the job edit installs and the job search turned the other way.
fn every_kind_in(sim: &Sim, id: u32) -> Vec<AdminEdit> {
    let (row, other) = row_with_another_shift(pack_of(sim));
    let top = pack_of(sim).careers[row as usize].pay_max;
    let searches = sim.world().resource::<Careers>().searches(SimId(id));
    every_career_kind(id, row, other)
        .into_iter()
        .map(|edit| match edit {
            AdminEdit::SetPay { sim, .. } => AdminEdit::SetPay { sim, dollars: top },
            AdminEdit::SetJobSearch { sim, .. } => AdminEdit::SetJobSearch { sim, on: !searches },
            edit => edit,
        })
        .collect()
}

// ---- Item 1: refusals ----

/// [AP-e-job] to [AP-e-search]: every career edit refuses someone who is not
/// a living member of the household with 2.
#[test]
fn every_career_edit_refuses_someone_who_is_not_a_person() {
    let (mut sim, _, _) = job_world(|_| {});
    for edit in every_career_kind(99_999, 0, 1) {
        refused(&mut sim, edit, NotAPerson);
    }
}

/// [AP-e-job] and [AP-e-shift]: a job or shift change is refused with 6
/// while the person is on the way to work and while at work. The other
/// career fields are not about where the person is, so they still apply.
#[test]
fn a_job_or_shift_change_is_refused_on_the_way_and_at_work() {
    let (mut sim, actor, _) = loaded_fixture(|_| {});
    let id = id_of(&sim, actor);
    start_with(&mut sim, actor, &[]);
    assert_eq!(commuting(&sim, actor), Some(Commuting::Outbound));
    let check = |sim: &mut Sim, value: f32| {
        sim.begin_admin().expect("opens");
        for edit in [
            AdminEdit::SetJob {
                sim: id,
                job: Some(1),
                shift: 0,
            },
            AdminEdit::SetJob {
                sim: id,
                job: None,
                shift: 0,
            },
            AdminEdit::SetShift { sim: id, shift: 1 },
        ] {
            refused(sim, edit, AdminRefusal::AtWork);
        }
        applied(sim, AdminEdit::SetJobSatisfaction { sim: id, value });
        sim.end_admin();
    };
    check(&mut sim, 3.0);
    while sim.world().get::<AtWork>(actor).is_none() {
        assert!(now(&sim) < START + 200, "never arrived");
        sim.tick();
    }
    check(&mut sim, 4.0);
}

/// [AP-e-job]: an unknown career row is refused with 4, as is a shift the
/// row does not offer, and No job with a shift named.
#[test]
fn a_job_change_refuses_an_unknown_row_or_shift() {
    let (mut sim, _, id) = job_world(|_| {});
    let pack = pack_of(&sim);
    refused(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: Some(pack.careers.len() as u32),
            shift: 0,
        },
        UnknownContent,
    );
    let last = pack.careers[0].shift_count() as u32;
    refused(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: Some(0),
            shift: last,
        },
        UnknownContent,
    );
    refused(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: None,
            shift: 1,
        },
        UnknownContent,
    );
}

/// [AP-e-job]: a shift the level lists with weight 0 is not offered, so it is
/// refused with 4 as the Career tab refuses it.
#[test]
fn a_job_change_refuses_a_shift_with_no_weight() {
    let (mut sim, _, id) = job_world(|pack| pack.careers[0].shifts[0].weight = 0);
    refused(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: Some(0),
            shift: 1,
        },
        UnknownContent,
    );
    refused(
        &mut sim,
        AdminEdit::SetShift { sim: id, shift: 1 },
        UnknownContent,
    );
}

/// [AP-e-shift]: an unknown shift is refused with 4; a person with no job has
/// no shift, pay, job satisfaction or weeks to set, so those are refused with
/// 5. The job search is everyone's, so it applies.
#[test]
fn career_fields_need_a_job_and_a_shift_the_level_offers() {
    let (mut sim, actor, id) = job_world(|_| {});
    let last = pack_of(&sim).careers[0].shift_count() as u32;
    refused(
        &mut sim,
        AdminEdit::SetShift {
            sim: id,
            shift: last,
        },
        UnknownContent,
    );
    applied(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: None,
            shift: 0,
        },
    );
    assert_eq!(career_of(&sim, actor), None);
    for edit in [
        AdminEdit::SetShift { sim: id, shift: 0 },
        AdminEdit::SetPay {
            sim: id,
            dollars: 1,
        },
        AdminEdit::SetJobSatisfaction {
            sim: id,
            value: 1.0,
        },
        AdminEdit::SetGoodWeeks { sim: id, weeks: 0 },
        AdminEdit::SetPoorWeeks { sim: id, weeks: 0 },
    ] {
        refused(&mut sim, edit, NotFound);
    }
    applied(&mut sim, AdminEdit::SetJobSearch { sim: id, on: true });
}

// ---- Item 10: the career cases ----

/// [AP-e-job]: any level of any path installs with that level's starting
/// pay, job satisfaction 50, nothing reviewed and the chosen shift, and
/// changes neither the career command count nor its result.
#[test]
fn any_level_of_any_path_installs_at_its_starting_pay() {
    let (mut sim, actor, id) = job_world(|_| {});
    let pack = pack_of(&sim);
    let before = untouched(&sim);
    for (row, job) in pack.careers.iter().enumerate() {
        for shift in (0..job.shift_count()).filter(|&index| job.offers(index)) {
            let edit = AdminEdit::SetJob {
                sim: id,
                job: Some(row as u32),
                shift: shift as u32,
            };
            assert!(sim.admin_apply(change(vec![edit])).is_ok(), "{row} {shift}");
            assert_eq!(career_of(&sim, actor), Some(row as u32));
            let record = record_of(&sim, id).expect("a record");
            assert_eq!(
                record,
                Record {
                    shift: shift as u32,
                    ..Record::new(job)
                }
            );
            assert_eq!(record.pay, job.pay, "the level's starting pay");
            assert_eq!(record.job_satisfaction, 50.0);
        }
    }
    assert_eq!(untouched(&sim), before, "no career command was counted");
}

/// [AP-e-job]: No job goes through the quit path: the job, the record and a
/// shift change made today all go, and no career command is counted.
#[test]
fn no_job_leaves_the_job_as_quitting_does() {
    let (mut sim, actor, id) = job_world(|_| {});
    applied(&mut sim, AdminEdit::SetShift { sim: id, shift: 1 });
    assert!(sim
        .world()
        .resource::<Careers>()
        .shift_changed
        .contains_key(&SimId(id)));
    let before = untouched(&sim);
    applied(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: None,
            shift: 0,
        },
    );
    assert_eq!(career_of(&sim, actor), None);
    assert_eq!(record_of(&sim, id), None);
    assert!(!sim
        .world()
        .resource::<Careers>()
        .shift_changed
        .contains_key(&SimId(id)));
    assert_eq!(untouched(&sim), before);
}

/// [AP-e-job]: a late-at-home open shift with time worked settles and is
/// paid when the job changes, exactly as the Career tab's assignment settles
/// it: a twin assigned the same level and shift through the Career tab ends
/// with the same attendance register, record, job and funds.
#[test]
fn a_job_change_settles_a_late_shift_as_the_career_tab_does() {
    let (mut live, actor, id) = worked_then_home();
    let (mut twin, twin_actor, _) = worked_then_home();
    let pack = pack_of(&live);
    let path = pack
        .career_paths
        .iter()
        .position(|path| path.levels[0] != 0)
        .expect("a second path") as u32;
    let row = pack.career_paths[path as usize].levels[0];
    let chosen = first_offered(pack, row);
    let funds = live.funds();
    let settled = outcomes(&live);
    live.begin_admin().expect("opens");
    applied(
        &mut live,
        AdminEdit::SetJob {
            sim: id,
            job: Some(row),
            shift: chosen,
        },
    );
    assert_eq!(outcomes(&live), settled + 1, "the open shift settled");
    let paid = attendance(&live).outcomes.last().unwrap().pay_cents;
    assert!(paid > 0, "the hour worked is paid");
    assert_eq!(live.funds(), funds + paid);
    issue(
        &mut twin,
        SimCommand::AssignCareerShift {
            agent: twin_actor.index_u32(),
            path,
            shift: chosen,
        },
    );
    assert_eq!(
        twin.world()
            .resource::<Careers>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    assert_eq!(attendance(&live), attendance(&twin));
    assert_eq!(record_of(&live, id), record_of(&twin, id));
    assert_eq!(career_of(&live, actor), career_of(&twin, twin_actor));
    assert_eq!(live.funds(), twin.funds());
}

/// [AP-e-job]: No job settles a late-at-home open shift as the Career tab's
/// quit does: a twin that quits through the Career tab ends with the same
/// register, no record, no job and the same funds.
#[test]
fn no_job_settles_a_late_shift_as_quitting_does() {
    let (mut live, actor, id) = worked_then_home();
    let (mut twin, twin_actor, _) = worked_then_home();
    let settled = outcomes(&live);
    live.begin_admin().expect("opens");
    applied(
        &mut live,
        AdminEdit::SetJob {
            sim: id,
            job: None,
            shift: 0,
        },
    );
    assert_eq!(outcomes(&live), settled + 1, "the open shift settled");
    issue(
        &mut twin,
        SimCommand::QuitCareer {
            agent: twin_actor.index_u32(),
        },
    );
    assert_eq!(
        twin.world()
            .resource::<Careers>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    assert_eq!(attendance(&live), attendance(&twin));
    assert_eq!(record_of(&live, id), None);
    assert_eq!(record_of(&twin, id), None);
    assert_eq!(career_of(&live, actor), None);
    assert_eq!(live.funds(), twin.funds());
}

/// [AP-e-shift]: a shift change settles a late-at-home open shift as the
/// Career tab's shift change does, forfeiting its score: a twin changed
/// through the Career tab ends with the same register, record and funds.
#[test]
fn a_shift_change_settles_a_late_shift_as_the_career_tab_does() {
    let (mut live, _, id) = worked_then_home();
    let (mut twin, twin_actor, _) = worked_then_home();
    let settled = outcomes(&live);
    let funds = live.funds();
    live.begin_admin().expect("opens");
    applied(&mut live, AdminEdit::SetShift { sim: id, shift: 1 });
    assert_eq!(outcomes(&live), settled + 1, "the open shift settled");
    assert!(live.funds() > funds, "the hour worked is paid");
    issue(
        &mut twin,
        SimCommand::ChangeShift {
            agent: twin_actor.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(
        twin.world()
            .resource::<Careers>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    assert_eq!(attendance(&live), attendance(&twin));
    assert_eq!(record_of(&live, id), record_of(&twin, id));
    assert_eq!(
        live.world().resource::<Careers>().shift_changed,
        twin.world().resource::<Careers>().shift_changed
    );
    assert_eq!(live.funds(), twin.funds());
    assert_survives_save_on_own_content(&live, "a shift change that settled");
}

/// [AP-e-shift]: setting the held shift while a late shift is open settles
/// nothing.
#[test]
fn setting_the_held_shift_leaves_an_open_shift_open() {
    let (mut sim, actor, id) = worked_then_home();
    sim.begin_admin().expect("opens");
    let (hash, settled) = (sim.world_hash(), outcomes(&sim));
    assert!(sim
        .admin_apply(change(vec![AdminEdit::SetShift { sim: id, shift: 0 }]))
        .is_ok());
    assert_eq!(outcomes(&sim), settled);
    assert!(shift(&sim, actor).is_some_and(|open| !open.settled));
    assert_eq!(sim.world_hash(), hash);
}

/// [AP-tests-sim] item 5, the job case: Undo after a job change that settled
/// and paid a late-at-home shift restores the career record, the job, the
/// attendance register and the funds.
#[test]
fn undoing_a_job_change_restores_the_record_the_register_and_the_funds() {
    let (mut sim, actor, id) = worked_then_home();
    sim.begin_admin().expect("opens");
    let before = (
        sim.world_hash(),
        record_of(&sim, id),
        career_of(&sim, actor),
        attendance(&sim),
        sim.funds(),
    );
    applied(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: Some(1),
            shift: 0,
        },
    );
    assert_ne!(sim.funds(), before.4, "the settled shift was paid");
    sim.admin_undo().expect("undoes");
    let actor = crate::edit::living_entity(sim.world(), id).unwrap_or(actor);
    assert_eq!(
        (
            sim.world_hash(),
            record_of(&sim, id),
            career_of(&sim, actor),
            attendance(&sim),
            sim.funds(),
        ),
        before
    );
}

/// [AP-tests-sim] item 5, the job case with a pre-registered shift: the job
/// change removes the shift Go to work registered before its start and gives
/// back the record it replaced; Undo puts the registration and the replaced
/// record back exactly.
#[test]
fn undoing_a_job_change_restores_a_replaced_attendance_record() {
    let (mut sim, actor, id) = pre_registered_at_home();
    sim.begin_admin().expect("opens");
    let before = (sim.world_hash(), attendance(&sim), record_of(&sim, id));
    let replaced = before.1.replaced[&SimId(id)].clone();
    applied(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: Some(1),
            shift: 0,
        },
    );
    assert!(attendance(&sim).replaced.is_empty());
    assert_eq!(
        shift(&sim, actor),
        Some(replaced),
        "the replaced record is back"
    );
    assert_survives_save_on_own_content(&sim, "after the removal");
    sim.admin_undo().expect("undoes");
    assert_eq!(
        (sim.world_hash(), attendance(&sim), record_of(&sim, id)),
        before
    );
}

/// [AP-e-shift]: a shift change takes effect from the next day, through the
/// Career tab's own change: the schedule held when the day began still runs
/// today, the good-week streak starts again, and the record and the day's
/// change match a twin changed through the Career tab.
#[test]
fn a_shift_change_takes_effect_tomorrow_as_the_career_tabs_does() {
    let (mut live, actor, id) = job_world(|_| {});
    let (mut twin, twin_actor, _) = job_world(|_| {});
    for sim in [&mut live, &mut twin] {
        applied(sim, AdminEdit::SetGoodWeeks { sim: id, weeks: 1 });
    }
    applied(&mut live, AdminEdit::SetShift { sim: id, shift: 1 });
    twin.end_admin();
    issue(
        &mut twin,
        SimCommand::ChangeShift {
            agent: twin_actor.index_u32(),
            shift: 1,
        },
    );
    assert_eq!(
        twin.world()
            .resource::<Careers>()
            .last_result
            .unwrap()
            .reason,
        None
    );
    let record = record_of(&live, id).unwrap();
    assert_eq!(record.shift, 1);
    assert_eq!(record.consecutive_good, 0, "the streak starts again");
    assert_eq!(record_of(&live, id), record_of(&twin, id));
    assert_eq!(
        live.world().resource::<Careers>().shift_changed,
        twin.world().resource::<Careers>().shift_changed
    );
    let pack = pack_of(&live);
    let today = crate::shifts::shift_today(live.world(), pack, actor, now(&live)).unwrap();
    assert_eq!(today.index, 0, "today keeps the shift the day began with");
    let tomorrow = now(&live) + day_ticks(&live);
    let next = crate::shifts::shift_today(live.world(), pack, actor, tomorrow).unwrap();
    assert_eq!(next.index, 1, "tomorrow runs the new shift");
    assert_survives_save_on_own_content(&live, "a shift changed today");
}

/// [AP-e-shift]: setting the shift the person already holds changes nothing:
/// it neither settles an open shift nor restarts the streak.
#[test]
fn setting_the_held_shift_changes_nothing() {
    let (mut sim, _, id) = job_world(|_| {});
    applied(&mut sim, AdminEdit::SetGoodWeeks { sim: id, weeks: 1 });
    let hash = sim.world_hash();
    assert!(sim
        .admin_apply(change(vec![AdminEdit::SetShift { sim: id, shift: 0 }]))
        .is_ok());
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(record_of(&sim, id).unwrap().consecutive_good, 1);
}

/// [AP-e-pay]: pay applies at both ends of the level's range, in whole
/// dollars, and one dollar past either end is refused with 3. The range is
/// the level's own: moving it in the content moves the bounds.
#[test]
fn pay_follows_the_levels_range_from_content() {
    for widen in [0u32, 7] {
        let (mut sim, _, id) = job_world(|pack| {
            pack.careers[0].pay += widen;
            pack.careers[0].pay_max += 3 * widen;
        });
        let job = &pack_of(&sim).careers[0];
        applied(
            &mut sim,
            AdminEdit::SetPay {
                sim: id,
                dollars: job.pay_max,
            },
        );
        assert_eq!(record_of(&sim, id).unwrap().pay, job.pay_max);
        applied(
            &mut sim,
            AdminEdit::SetPay {
                sim: id,
                dollars: job.pay,
            },
        );
        refused(
            &mut sim,
            AdminEdit::SetPay {
                sim: id,
                dollars: job.pay_max + 1,
            },
            OutOfRange,
        );
        if job.pay > 0 {
            refused(
                &mut sim,
                AdminEdit::SetPay {
                    sim: id,
                    dollars: job.pay - 1,
                },
                OutOfRange,
            );
        }
    }
}

/// [AP-e-jsat]: job satisfaction applies at 0 and 100; past them the change
/// is refused with 3 before it is staged.
#[test]
fn job_satisfaction_applies_from_zero_to_one_hundred() {
    let (mut sim, _, id) = job_world(|_| {});
    for value in [0.0, 100.0] {
        applied(&mut sim, AdminEdit::SetJobSatisfaction { sim: id, value });
        assert_eq!(record_of(&sim, id).unwrap().job_satisfaction, value);
    }
    for value in [-0.01, 100.01, f32::NAN] {
        refused(
            &mut sim,
            AdminEdit::SetJobSatisfaction { sim: id, value },
            OutOfRange,
        );
    }
}

/// [AP-e-good]: good weeks apply from 0 to the level's `advance_weeks`, and
/// one more is refused with 3. Moving `advance_weeks` in the content moves
/// the bound.
#[test]
fn good_weeks_reach_the_levels_advance_weeks_from_content() {
    for weeks in [2u32, 9] {
        let (mut sim, _, id) = job_world(|pack| pack.careers[0].advance_weeks = weeks);
        applied(&mut sim, AdminEdit::SetGoodWeeks { sim: id, weeks });
        assert_eq!(record_of(&sim, id).unwrap().consecutive_good, weeks);
        applied(&mut sim, AdminEdit::SetGoodWeeks { sim: id, weeks: 0 });
        refused(
            &mut sim,
            AdminEdit::SetGoodWeeks {
                sim: id,
                weeks: weeks + 1,
            },
            OutOfRange,
        );
    }
}

/// [AP-e-job]: the job options read names each level's first offered shift,
/// the one a job change sends, since a level's standard shift may have
/// weight 0, and -1 for a level that offers no shift at all. Sending the
/// shift it names applies.
#[test]
fn job_options_name_each_levels_first_offered_shift() {
    let (mut sim, _, id) = job_world(|pack| {
        // The late shift stays offered on the first level.
        pack.careers[0].standard_weight = 0;
        let second = &mut pack.careers[1];
        second.standard_weight = 0;
        for shift in &mut second.shifts {
            shift.weight = 0;
        }
    });
    let pack = pack_of(&sim);
    let options = crate::admin::reads::job_options(sim.world());
    assert!(!options.is_empty() && options.len().is_multiple_of(4));
    let first_shift = |row: u32| {
        options
            .chunks(4)
            .find(|quad| quad[2] == f64::from(row))
            .map(|quad| quad[3])
            .expect("every career row is listed")
    };
    for quad in options.chunks(4) {
        let job = &pack.careers[quad[2] as usize];
        let expected = (0..job.shift_count())
            .find(|&index| job.offers(index))
            .map_or(-1.0, |index| index as f64);
        assert_eq!(quad[3], expected, "row {}", quad[2]);
    }
    assert_eq!(
        first_shift(0),
        1.0,
        "the late shift, past a standard of weight 0"
    );
    assert_eq!(first_shift(1), -1.0, "a level that offers no shift");
    applied(
        &mut sim,
        AdminEdit::SetJob {
            sim: id,
            job: Some(0),
            shift: first_shift(0) as u32,
        },
    );
    assert_eq!(
        sim.world().resource::<Careers>().records[&SimId(id)].pay,
        pack.careers[0].pay
    );
}

/// [AP-e-poor]: poor weeks apply from 0 to the count at which firing becomes
/// certain, `2 + ceil(1 / career_fire_base)`, and one more is refused with 3.
/// The bound follows the tuning; with no chance of firing there is no such
/// count, so the range is 0 to 2 (the warning threshold) and 3 is refused.
#[test]
fn poor_weeks_reach_the_count_where_firing_is_certain() {
    for (base, top) in [(0.08f32, 15u32), (0.5, 4), (1.0, 3), (0.3, 6)] {
        let (mut sim, _, id) = job_world(|pack| pack.tuning.career_fire_base = base);
        assert_eq!(
            crate::careers::certain_fire_weeks(&pack_of(&sim).tuning),
            Some(top)
        );
        applied(
            &mut sim,
            AdminEdit::SetPoorWeeks {
                sim: id,
                weeks: top,
            },
        );
        assert_eq!(record_of(&sim, id).unwrap().consecutive_poor, top);
        applied(&mut sim, AdminEdit::SetPoorWeeks { sim: id, weeks: 0 });
        refused(
            &mut sim,
            AdminEdit::SetPoorWeeks {
                sim: id,
                weeks: top + 1,
            },
            OutOfRange,
        );
    }
}

/// With `career_fire_base` at 0 nothing can lead to firing, so the control
/// still works up to the warning threshold: 0 and 2 apply, 3 is refused.
#[test]
fn poor_weeks_with_no_chance_of_firing_stop_at_the_warning_count() {
    let (mut sim, _, id) = job_world(|pack| pack.tuning.career_fire_base = 0.0);
    assert_eq!(
        crate::careers::certain_fire_weeks(&pack_of(&sim).tuning),
        None
    );
    for weeks in [2, 0] {
        applied(&mut sim, AdminEdit::SetPoorWeeks { sim: id, weeks });
        assert_eq!(record_of(&sim, id).unwrap().consecutive_poor, weeks);
    }
    refused(
        &mut sim,
        AdminEdit::SetPoorWeeks { sim: id, weeks: 3 },
        OutOfRange,
    );
}

/// A fire chance so small, though legal, that no count the review can hold
/// makes firing certain, or that the count would not load: the search stays
/// bounded, and the panel's range runs to the loader's own cap on poor weeks,
/// since firing is still possible from 3 weeks and 0 to 2 would say it is
/// not. The limits read and `SetPoorWeeks` validation agree.
#[test]
fn poor_weeks_with_a_tiny_fire_chance_stop_at_the_loaders_cap() {
    let cap = crate::careers::MAX_SAVED_STREAK_WEEKS;
    for (base, certain) in [
        (2.0e-10f32, false),
        (1.0e-12, false),
        (f32::MIN_POSITIVE, false),
        (1.0e-6, true),
    ] {
        let (mut sim, _, id) = job_world(|pack| pack.tuning.career_fire_base = base);
        let found = crate::careers::certain_fire_weeks(&pack_of(&sim).tuning);
        assert_eq!(found.is_some(), certain, "base {base}: {found:?}");
        assert!(found.is_none_or(|weeks| weeks > cap), "base {base}");
        assert_eq!(
            crate::admin::reads::limits(sim.world())[4],
            f64::from(cap),
            "base {base}: the most poor weeks the panel sets"
        );
        applied(
            &mut sim,
            AdminEdit::SetPoorWeeks {
                sim: id,
                weeks: cap,
            },
        );
        assert_eq!(record_of(&sim, id).unwrap().consecutive_poor, cap);
        refused(
            &mut sim,
            AdminEdit::SetPoorWeeks {
                sim: id,
                weeks: cap + 1,
            },
            OutOfRange,
        );
    }
}

/// The certain count is the first poor-week count at which the review's own
/// fire chance reaches 1, so the bound agrees with `outcome` in `f32`.
#[test]
fn the_certain_count_is_where_the_reviews_fire_chance_reaches_one() {
    let mut tuning = terri_data::pack().tuning;
    for step in 1..=100 {
        tuning.career_fire_base = step as f32 / 100.0;
        let top = crate::careers::certain_fire_weeks(&tuning).unwrap();
        let chance = |poor: u32| tuning.career_fire_base * (poor - 2) as f32;
        assert!(chance(top) >= 1.0, "base {}", tuning.career_fire_base);
        assert!(
            top == 3 || chance(top - 1) < 1.0,
            "base {}",
            tuning.career_fire_base
        );
    }
}

/// [AP-e-search]: the job search turns off and on as the Career tab turns it,
/// and no career command is counted.
#[test]
fn the_job_search_turns_off_and_on() {
    let (mut sim, _, id) = job_world(|_| {});
    let before = untouched(&sim);
    // The fixture turns everyone's search off.
    assert!(!sim.world().resource::<Careers>().searches(SimId(id)));
    applied(&mut sim, AdminEdit::SetJobSearch { sim: id, on: true });
    assert!(sim.world().resource::<Careers>().searches(SimId(id)));
    applied(&mut sim, AdminEdit::SetJobSearch { sim: id, on: false });
    assert!(!sim.world().resource::<Careers>().searches(SimId(id)));
    assert_eq!(untouched(&sim), before);
}

// ---- Items 3, 4, 5 and 9 for every career kind ----

/// [AP-tests-sim] items 3 and 4: after each career kind a save loads and
/// hashes as the live one, each kind moved the hash, and none touched the
/// career command count or result or the lot edit result.
#[test]
fn every_career_edit_kind_moves_the_hash_and_survives_a_save() {
    let (mut sim, _, id) = job_world(|_| {});
    let before = untouched(&sim);
    for edit in every_kind_in(&sim, id) {
        let what = format!("{edit:?}");
        applied(&mut sim, edit);
        assert_survives_save_on_own_content(&sim, &what);
        assert_eq!(untouched(&sim), before, "{what}");
    }
}

/// The same on the shipped lot, whose worker has a job but no record yet:
/// the first career field set gives them one.
#[test]
fn career_edits_apply_to_the_shipped_worker() {
    let mut sim = opened();
    let worker = people(&mut sim)
        .into_iter()
        .find(|&id| sim.world().get::<Career>(entity_of(&sim, id)).is_some())
        .expect("the shipped household has a worker");
    for edit in every_kind_in(&sim, worker) {
        let what = format!("{edit:?}");
        applied(&mut sim, edit);
        assert_survives_save(&sim, &what);
    }
}

/// [AP-tests-sim] item 9: no career edit draws from any random stream, and
/// two worlds given the same changes hash equal.
#[test]
fn career_edits_draw_nothing_and_are_deterministic() {
    let (mut a, _, id) = job_world(|_| {});
    let (mut b, _, _) = job_world(|_| {});
    let before = streams(&a);
    for edit in every_kind_in(&a, id) {
        a.admin_apply(change(vec![edit.clone()])).expect("applies");
        b.admin_apply(change(vec![edit])).expect("applies");
        assert_eq!(streams(&a), before, "no stream moved");
        assert_eq!(a.world_hash(), b.world_hash());
    }
}

/// [AP-tests-sim] item 9: a world with career edits applied, saved and
/// reloaded continues identically to the live one for two game days.
#[test]
fn a_career_edited_world_saved_and_reloaded_continues_identically() {
    let (mut live, _, id) = job_world(|_| {});
    let edits = every_kind_in(&live, id);
    // Everything but the last edit, which leaves the job.
    for edit in &edits[..edits.len() - 1] {
        live.admin_apply(change(vec![edit.clone()]))
            .expect("applies");
    }
    let snapshot = live.try_save_snapshot_v24().expect("saves");
    live.end_admin();
    let mut loaded = Sim::new_with_lot_and_content(20, 20, Content(pack_of(&live)));
    loaded.load_snapshot_v24(snapshot).expect("loads");
    assert_eq!(loaded.world_hash(), live.world_hash());
    for tick in 0..2 * day_ticks(&live) {
        live.tick();
        loaded.tick();
        assert_eq!(live.world_hash(), loaded.world_hash(), "tick {tick}");
    }
}

/// [AP-tests-sim] item 5 for the career kinds: every kind in one session,
/// then Undo back through them; after each Undo the hash, the record, the
/// job, the day's shift change and the job search equal those before the
/// undone change.
#[test]
fn undo_takes_back_every_career_edit_exactly() {
    let (mut sim, _, id) = job_world(|_| {});
    let read = |sim: &Sim| {
        let careers = sim.world().resource::<Careers>();
        let entity = entity_of(sim, id);
        (
            sim.world_hash(),
            format!("{:?}", careers.record(SimId(id))),
            sim.world().get::<Career>(entity).map(|career| career.0),
            format!("{:?}", careers.shift_changed.get(&SimId(id))),
            careers.searches(SimId(id)),
            sim.world().resource::<Funds>().0,
        )
    };
    let baseline = read(&sim);
    let mut before = Vec::new();
    for edit in every_kind_in(&sim, id) {
        before.push(read(&sim));
        applied(&mut sim, edit);
    }
    while let Some(expected) = before.pop() {
        assert_eq!(sim.admin_undo(), Ok(()));
        assert_eq!(sim.admin_undo_depth(), before.len());
        assert_eq!(read(&sim), expected, "undo to depth {}", before.len());
    }
    assert_eq!(read(&sim), baseline);
}

/// A change with a refused career edit after valid ones changes nothing.
#[test]
fn a_change_with_a_refused_career_edit_changes_nothing() {
    let (mut sim, _, id) = job_world(|_| {});
    let hash = sim.world_hash();
    let top = pack_of(&sim).careers[0].pay_max;
    let others = people(&mut sim);
    assert_eq!(others, vec![id], "the fixture's one worker");
    assert_eq!(
        sim.admin_apply(change(vec![
            AdminEdit::SetJobSatisfaction {
                sim: id,
                value: 1.0
            },
            AdminEdit::SetPay {
                sim: 99_999,
                dollars: top
            },
        ])),
        Err(crate::admin::AdminApplyRefusal {
            edit: 1,
            reason: AdminRefusal::NotAPerson
        })
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.admin_undo_depth(), 0);
}

/// The coordinator's ruling: Undo of a job change that settled a shift
/// leaves the live activity log as a never-undone twin's.
#[test]
fn undo_keeps_the_activity_log_of_a_never_undone_twin() {
    let build = || {
        let (mut sim, _, _) = worked_then_home();
        sim.begin_admin().expect("opens");
        sim
    };
    let (probe, _, id) = worked_then_home();
    drop(probe);
    assert_undo_keeps_the_activity_log_of_a_twin(
        build,
        vec![
            change(vec![AdminEdit::SetJobSatisfaction {
                sim: id,
                value: 20.0,
            }]),
            change(vec![AdminEdit::SetJob {
                sim: id,
                job: Some(1),
                shift: 0,
            }]),
        ],
        "career edits",
    );
}
