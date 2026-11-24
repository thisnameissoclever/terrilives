//! [CT-work-guards] item 2 and [CT-save]: removing a shift Go to work
//! registered before its start gives back, exactly, the settled record the
//! registration replaced, and a save taken at any stage of that sequence
//! loads and runs on as the same world. Review finding F1: the record used
//! to be rebuilt from the latest outcome, which set its pay to the pay
//! settled and dropped the legacy flag, so every later save of a partly
//! worked or legacy shift failed to load.
use super::*;

/// How the shift settled before Go to work registered tomorrow's.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Today {
    /// Worked in full, so the settled pay equals the shift pay.
    Full,
    /// Arrived late, so the settled pay is less than the shift pay.
    Late,
    /// An older save's countdown, migrated to a legacy record.
    Legacy,
}

/// What removes the registered shift before its start.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Removal {
    Quit,
    Reassign,
    ShiftChange,
}

/// When the subject saves and loads.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Stage {
    PreRegistered,
    Home,
    Removed,
}

const STAGES: [Stage; 3] = [Stage::PreRegistered, Stage::Home, Stage::Removed];
const REMOVALS: [Removal; 3] = [Removal::Quit, Removal::Reassign, Removal::ShiftChange];

/// The fixture with a second shift offered, so a shift change has one to
/// move to, as a load leaves it (see `loaded_fixture`).
fn two_shift_fixture() -> (Sim, Entity, Vec<Entity>) {
    let (mut sim, actor, objects) = fixture(|pack| {
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
    reload(&mut sim);
    (sim, actor, objects)
}

fn reload(sim: &mut Sim) {
    let snapshot = sim.save_snapshot_v28();
    sim.load_snapshot_v28(snapshot).expect("loads");
}

fn home(sim: &Sim, actor: Entity) -> bool {
    commuting(sim, actor).is_none() && sim.world().get::<AtWork>(actor).is_none()
}

/// Ticks until `actor` is home, within `limit` ticks.
fn tick_home(sim: &mut Sim, actor: Entity, limit: u64) {
    for _ in 0..limit {
        if home(sim, actor) {
            return;
        }
        sim.tick();
    }
    assert!(home(sim, actor), "home by tick {}", now(sim));
}

/// Settles today's shift as `today` says and brings the worker home; the
/// settled record is left on the register.
fn settle_today(sim: &mut Sim, actor: Entity, objects: &[Entity], today: Today) {
    match today {
        Today::Full => {
            // Sent before the start, so the walk ends before it.
            due(sim);
            assert_eq!(send(sim, actor), None);
            work_the_shift(sim, actor);
        }
        Today::Late => {
            at(sim, START - 10);
            order(sim, actor, objects[HOLD]);
            while now(sim) < START + 60 {
                sim.tick();
            }
            issue(
                sim,
                SimCommand::CancelIntents {
                    agent: actor.index_u32(),
                },
            );
            work_the_shift(sim, actor);
        }
        Today::Legacy => {
            at(sim, START + 30);
            sim.world_mut().entity_mut(actor).insert(AtWork {
                remaining_ticks: 400,
            });
            crate::attendance::migrate_legacy(sim.world_mut());
            assert!(shift(sim, actor).is_some_and(|s| s.legacy && !s.settled));
            for _ in 0..SHIFT {
                if outcomes(sim) > 0 {
                    break;
                }
                sim.tick();
            }
            assert_eq!(outcomes(sim), 1, "the legacy shift settles");
        }
    }
    tick_home(sim, actor, 400);
    let settled = shift(sim, actor).expect("today's record");
    assert!(settled.settled);
    assert_eq!(settled.legacy, today == Today::Legacy);
    let paid = the_outcome(sim).pay_cents;
    if today == Today::Late {
        assert!(paid < settled.pay_cents, "a partial shift is paid in part");
    } else {
        assert_eq!(paid, settled.pay_cents, "paid in full");
    }
}

/// Moves to tomorrow's window and sends the worker, registering
/// tomorrow's shift in place of today's record.
fn pre_register(sim: &mut Sim, actor: Entity) {
    let tick = day_ticks(sim) + START - window(sim);
    at(sim, tick);
    assert_eq!(send(sim, actor), None);
    assert!(shift(sim, actor).is_some_and(|s| !s.settled && s.start_tick > now(sim)));
}

/// An order brings the worker home before the start.
fn ordered_home(sim: &mut Sim, actor: Entity, objects: &[Entity]) {
    order(sim, actor, objects[HOLD]);
    tick_home(sim, actor, 100);
    let open = shift(sim, actor).expect("the registered shift");
    assert!(
        !open.settled && now(sim) < open.start_tick,
        "before the start"
    );
}

fn remove(sim: &mut Sim, actor: Entity, removal: Removal) {
    let agent = actor.index_u32();
    let command = match removal {
        Removal::Quit => SimCommand::QuitCareer { agent },
        Removal::Reassign => SimCommand::AssignCareer { agent, path: 1 },
        Removal::ShiftChange => SimCommand::ChangeShift { agent, shift: 1 },
    };
    issue(sim, command);
    assert_eq!(
        sim.world()
            .resource::<Careers>()
            .last_result
            .unwrap()
            .reason,
        None,
        "{removal:?} applies"
    );
}

/// Each person's outcomes by the day their shift began, so no day pays
/// twice.
fn assert_one_paid_shift_a_day(sim: &Sim) {
    let day = day_ticks(sim);
    let mut days = std::collections::BTreeSet::new();
    for outcome in &sim.world().resource::<Attendance>().outcomes {
        assert!(
            days.insert((outcome.sim, outcome.start_tick / day)),
            "a second paid shift on day {}",
            outcome.start_tick / day
        );
    }
}

/// Runs the whole sequence. With `save` the world saves and loads at that
/// stage; without, it is the uninterrupted twin. Returns the world hash
/// after each step and every hour until the following day's shift, had it
/// run, would have ended.
fn run(today: Today, removal: Removal, save: Option<Stage>) -> Vec<u64> {
    let (mut sim, actor, objects) = two_shift_fixture();
    let mut hashes = Vec::new();
    settle_today(&mut sim, actor, &objects, today);
    let settled = shift(&sim, actor).unwrap();
    hashes.push(sim.world_hash());
    pre_register(&mut sim, actor);
    if save == Some(Stage::PreRegistered) {
        reload(&mut sim);
    }
    hashes.push(sim.world_hash());
    ordered_home(&mut sim, actor, &objects);
    if save == Some(Stage::Home) {
        reload(&mut sim);
    }
    hashes.push(sim.world_hash());
    remove(&mut sim, actor, removal);
    assert_eq!(
        shift(&sim, actor),
        Some(settled.clone()),
        "{today:?} {removal:?} {save:?}: the replaced record is back exactly"
    );
    if save == Some(Stage::Removed) {
        reload(&mut sim);
    }
    hashes.push(sim.world_hash());
    let end = day_ticks(&sim) + START + u64::from(SHIFT) + window(&sim);
    while now(&sim) < end {
        sim.tick();
        if now(&sim).is_multiple_of(60) {
            hashes.push(sim.world_hash());
        }
    }
    assert_one_paid_shift_a_day(&sim);
    // Every later save loads, and loads to the same world.
    let hash = sim.world_hash();
    reload(&mut sim);
    assert_eq!(sim.world_hash(), hash, "{today:?} {removal:?} {save:?}");
    hashes.push(hash);
    hashes
}

/// Every stage's save against the uninterrupted twin, for each way of
/// removing the registered shift.
fn assert_every_stage_reloads(today: Today) {
    for removal in REMOVALS {
        let twin = run(today, removal, None);
        for stage in STAGES {
            assert_eq!(
                run(today, removal, Some(stage)),
                twin,
                "{today:?} {removal:?} saved {stage:?}"
            );
        }
    }
}

#[test]
fn removal_after_a_partly_worked_shift_reloads_at_every_stage() {
    assert_every_stage_reloads(Today::Late);
}

#[test]
fn removal_after_a_fully_worked_shift_reloads_at_every_stage() {
    assert_every_stage_reloads(Today::Full);
}

#[test]
fn removal_after_a_legacy_shift_reloads_at_every_stage() {
    assert_every_stage_reloads(Today::Legacy);
}

/// Build mode captures and restores the current save on entry, so a world
/// that could not load could not enter Build mode either.
#[test]
fn build_mode_opens_after_the_removal() {
    for today in [Today::Full, Today::Late, Today::Legacy] {
        let (mut sim, actor, objects) = two_shift_fixture();
        settle_today(&mut sim, actor, &objects, today);
        pre_register(&mut sim, actor);
        ordered_home(&mut sim, actor, &objects);
        remove(&mut sim, actor, Removal::Quit);
        assert_eq!(sim.begin_build(), Ok(()), "{today:?}");
        assert_eq!(sim.cancel_build(), Ok(()), "{today:?}");
    }
}

/// The one-paid-shift-a-day rule holds while the shift is registered, and
/// again once the replaced record is back: no second shift starts on the
/// day the settled record began.
#[test]
fn the_restored_record_keeps_one_paid_shift_a_day() {
    let (mut sim, actor, objects) = two_shift_fixture();
    settle_today(&mut sim, actor, &objects, Today::Late);
    let funds = sim.funds();
    pre_register(&mut sim, actor);
    ordered_home(&mut sim, actor, &objects);
    remove(&mut sim, actor, Removal::Reassign);
    reload(&mut sim);
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
    assert_eq!(sim.funds(), funds, "the removal pays nothing");
    assert_eq!(outcomes(&sim), 1, "nor scores anything");
}

/// [CT-save]: the replaced record rides in schema 24 only while the shift
/// that replaced it waits for its start, and the load refuses one that is
/// open, whose pay or worked time does not match its outcome,
/// that names no one waiting, or that repeats.
#[test]
fn a_saved_replaced_record_is_validated() {
    let (mut sim, actor, objects) = two_shift_fixture();
    settle_today(&mut sim, actor, &objects, Today::Late);
    let settled = shift(&sim, actor).unwrap();
    assert!(sim.save_snapshot_v24().replaced_shifts.is_empty());
    let unregistered = sim.save_snapshot_v24();
    pre_register(&mut sim, actor);
    let good = sim.save_snapshot_v24();
    assert_eq!(good.replaced_shifts, vec![settled]);
    let refuses = |base: &terri_core::SaveSnapshotV24,
                   change: &dyn Fn(&mut terri_core::SaveSnapshotV24)| {
        let mut bad = base.clone();
        change(&mut bad);
        let (mut fresh, _, _) = two_shift_fixture();
        fresh.load_snapshot_v24(bad).is_err()
    };
    assert!(!refuses(&good, &|_| {}), "the save as taken loads");
    assert!(
        refuses(&good, &|s| s.replaced_shifts[0].settled = false),
        "open"
    );
    assert!(
        refuses(&good, &|s| s.replaced_shifts[0].pay_cents -= 1),
        "pay"
    );
    assert!(
        refuses(&good, &|s| s.replaced_shifts[0].worked_ticks -= 1),
        "worked time"
    );
    assert!(
        refuses(&good, &|s| s.replaced_shifts[0].sim += 1),
        "names no one"
    );
    assert!(
        refuses(&good, &|s| s
            .replaced_shifts
            .push(s.replaced_shifts[0].clone())),
        "repeated"
    );
    // Today's record is on the register itself, not replaced by a shift
    // waiting for its start, so it cannot also ride as a replaced record.
    let replaced = good.replaced_shifts.clone();
    assert!(
        refuses(&unregistered, &move |s| s.replaced_shifts =
            replaced.clone()),
        "nothing waiting"
    );
    // Nor can a later settled record: the shift on the register settled
    // the next day, so nothing waits for its start, though the earlier
    // record and its outcome still match.
    let (mut later, person, things) = two_shift_fixture();
    settle_today(&mut later, person, &things, Today::Late);
    let earlier = shift(&later, person).unwrap();
    let tick = day_ticks(&later) + START - 1;
    at(&mut later, tick);
    let end = tick + 1 + u64::from(SHIFT);
    while now(&later) < end + 1 {
        later.tick();
    }
    let next = shift(&later, person).unwrap();
    assert!(next.settled && next.start_tick > earlier.start_tick);
    let settled_later = later.save_snapshot_v24();
    assert!(
        refuses(&settled_later, &move |s| s.replaced_shifts =
            vec![earlier.clone()]),
        "a settled record on the register"
    );
}

/// The replaced record is held only while the registered shift waits:
/// once it starts it settles rather than being removed, so the record is
/// dropped, and a save taken during that shift loads. While it is held,
/// the world hash covers it.
#[test]
fn the_replaced_record_is_dropped_when_the_shift_starts() {
    let (mut sim, actor, objects) = two_shift_fixture();
    settle_today(&mut sim, actor, &objects, Today::Late);
    pre_register(&mut sim, actor);
    let id = *sim.world().get::<SimId>(actor).unwrap();
    let held = sim.world_hash();
    sim.world_mut()
        .resource_mut::<Attendance>()
        .replaced
        .get_mut(&id)
        .expect("held while waiting")
        .pay_cents += 1;
    assert_ne!(sim.world_hash(), held, "the hash covers the held record");
    sim.world_mut()
        .resource_mut::<Attendance>()
        .replaced
        .get_mut(&id)
        .unwrap()
        .pay_cents -= 1;
    assert_eq!(sim.world_hash(), held);
    let start = shift(&sim, actor).unwrap().start_tick;
    while now(&sim) < start {
        sim.tick();
    }
    assert!(
        sim.world().resource::<Attendance>().replaced.is_empty(),
        "dropped at the start"
    );
    sim.tick();
    let hash = sim.world_hash();
    reload(&mut sim);
    assert_eq!(sim.world_hash(), hash, "a save during the shift loads");
}
