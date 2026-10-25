//! Schema twenty-two and the pay migration: issue 298,
//! `docs/specs/2026-10-18-wages-and-bills.md`, [WB-save].
use super::*;
use crate::bills::{Bill, Bills, PreviousUsage, ELECTRICITY, RENT, WATER};
use crate::careers::Careers;
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::save_v22::{SavedBill, SavedBillCount};
use terri_core::{Agent, Career, SimClock, SimId};

const DAY: u64 = 1440;

/// The shipped household, Tuesday at 10:00, with Tim at work on his second
/// shift: his first, on Monday, made his career record.
fn at_work() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    for _ in 0..(DAY + 600) {
        sim.tick();
    }
    sim
}

/// The shipped worker's id.
fn worker(sim: &mut Sim) -> SimId {
    let mut people: Vec<(SimId, Entity)> = sim
        .world_mut()
        .query_filtered::<(Entity, &SimId), (With<Agent>, With<Career>)>()
        .iter(sim.world())
        .map(|(entity, id)| (*id, entity))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    people[0].0
}

fn pay_of(sim: &Sim, id: SimId) -> u32 {
    sim.world()
        .resource::<Careers>()
        .record(id)
        .expect("a record")
        .pay
}

fn open_shift_cents(sim: &Sim, id: SimId) -> Option<i64> {
    sim.world()
        .resource::<crate::attendance::Attendance>()
        .shifts
        .get(&id)
        .filter(|shift| !shift.settled)
        .map(|shift| shift.pay_cents)
}

/// A mid-month record with usage, trips, a last month with one bill paid
/// and one unpaid, and an overdue bill from the month before that, on day
/// index 16 (a Wednesday of the third month).
fn rich_bills() -> Bills {
    let tuning = &terri_data::pack().bills;
    let mut uses = vec![0; tuning.uses.len()];
    uses[tuning.uses.iter().position(|k| k.id == "shower").unwrap()] = 3;
    let mut daily = vec![0; tuning.daily.len()];
    daily[tuning.daily.iter().position(|k| k.id == "lamp").unwrap()] = 3;
    Bills {
        last_counted_day: Some(16),
        month_days: 3,
        indoor_tile_days: 192 * 3,
        outdoor_tile_days: 112 * 3,
        uses,
        daily,
        commutes: 2,
        previous: Some(PreviousUsage {
            electricity_cents: 1_098,
            water_cents: 1_965,
            commutes: 13,
        }),
        bills: vec![
            Bill {
                due_day: 7,
                kind: WATER,
                amount_cents: 3_965,
                late_fee_cents: 199 * 3,
                paid_day: None,
            },
            Bill {
                due_day: 14,
                kind: RENT,
                amount_cents: 29_360,
                late_fee_cents: 0,
                paid_day: Some(14),
            },
            Bill {
                due_day: 14,
                kind: ELECTRICITY,
                amount_cents: 4_098,
                late_fee_cents: 0,
                paid_day: None,
            },
        ],
    }
}

/// The shipped lot and furniture with nobody living there, on day index
/// 16 at 10:00, holding [`rich_bills`]. Nobody lives there, so moving the
/// clock leaves nothing else inconsistent.
fn rich() -> Sim {
    let pack = terri_data::pack();
    let mut sim = Sim::new_from_lot_and_content(&pack.lot, Content(pack));
    sim.world_mut().resource_mut::<SimClock>().tick = 16 * DAY + 600;
    sim.world_mut().insert_resource(rich_bills());
    sim
}

/// [WB-save]: a record with counts, trips, a last month and an overdue bill
/// round-trips exactly, and the two worlds go on identically.
#[test]
fn schema_twenty_two_round_trips_the_bills_record() {
    let mut source = rich();
    let snapshot = capture(&source);
    assert_eq!(snapshot.bills.bills.len(), 3);
    assert_eq!(
        snapshot.bills.uses,
        [SavedBillCount {
            kind: "shower".into(),
            count: 3
        }]
    );
    let mut restored = restore(
        snapshot.clone(),
        terri_data::pack(),
        super::super::Carried::for_load(source.world()),
    )
    .unwrap();
    assert_eq!(capture(&restored), snapshot);
    assert_eq!(restored.world.resource::<Bills>(), &rich_bills());
    assert_eq!(restored.world_hash(), source.world_hash());
    for step in 0..200 {
        source.tick();
        restored.tick();
        assert_eq!(restored.world_hash(), source.world_hash(), "step {step}");
    }
}

/// The live record a refusal must leave untouched, and its tick.
fn refused(edit: impl FnOnce(&mut terri_core::save_v22::SavedBills)) {
    let mut live = rich();
    let before = live.save_snapshot_v22();
    let hash = live.world_hash();
    let rng = live.world.resource::<terri_core::SimRng>().clone();
    let mut bad = before.clone();
    edit(&mut bad.bills);
    assert_ne!(bad, before, "the edit must change the save");
    assert!(live.load_snapshot_v22(bad).is_err(), "the save is refused");
    assert_eq!(live.save_snapshot_v22(), before);
    assert_eq!(live.world_hash(), hash);
    assert_eq!(live.world.resource::<terri_core::SimRng>(), &rng);
}

fn bill(due_day: u32, kind: u8) -> SavedBill {
    SavedBill {
        due_day,
        kind,
        amount_cents: 1_000,
        late_fee_cents: 0,
        paid_day: None,
    }
}

#[test]
fn refuses_a_last_counted_day_ahead_of_the_clock() {
    refused(|b| b.last_counted_day = Some(17));
}

#[test]
fn refuses_more_month_days_than_a_month_or_than_have_passed() {
    refused(|b| b.month_days = 8);
    refused(|b| b.month_days = 4);
    refused(|b| {
        b.last_counted_day = None;
    });
}

#[test]
fn refuses_tile_days_beyond_the_grid_for_the_days_counted() {
    refused(|b| b.indoor_tile_days = 3 * 320 + 1);
    refused(|b| b.outdoor_tile_days = 3 * 320 + 1);
}

#[test]
fn refuses_a_count_above_the_limit() {
    refused(|b| b.uses[0].count = crate::bills::MAX_SAVED_COUNT + 1);
    refused(|b| b.commutes = crate::bills::MAX_SAVED_COUNT + 1);
    refused(|b| b.daily[0].count = 3 * 320 + 1);
}

#[test]
fn refuses_a_count_list_out_of_order_repeated_or_zero() {
    refused(|b| {
        b.uses.push(SavedBillCount {
            kind: "bath".into(),
            count: 1,
        })
    });
    refused(|b| {
        let row = b.uses[0].clone();
        b.uses.push(row);
    });
    refused(|b| b.uses[0].count = 0);
}

#[test]
fn refuses_a_bill_due_after_today_or_not_on_a_first_day() {
    refused(|b| b.bills.push(bill(21, RENT)));
    refused(|b| b.bills.insert(0, bill(6, RENT)));
}

#[test]
fn refuses_bills_out_of_order_or_repeated() {
    refused(|b| b.bills.swap(1, 2));
    refused(|b| {
        let first = b.bills[0];
        b.bills.insert(0, first);
    });
}

#[test]
fn refuses_a_bad_amount_or_fee() {
    refused(|b| b.bills[2].amount_cents = 0);
    refused(|b| b.bills[2].amount_cents = -5);
    refused(|b| b.bills[0].late_fee_cents = -1);
    // The water bill's cap is 50 percent of 3965 cents, rounded down.
    refused(|b| b.bills[0].late_fee_cents = 1_983);
    // The electricity bill, due on day index 14, is in its grace on day 16.
    refused(|b| b.bills[2].late_fee_cents = 1);
}

#[test]
fn refuses_a_bad_paid_day() {
    refused(|b| b.bills[1].paid_day = Some(13));
    refused(|b| b.bills[1].paid_day = Some(17));
    // A paid bill older than the last issued month.
    refused(|b| b.bills[0].paid_day = Some(10));
}

/// The refusals above start from a record that loads, so each one is a
/// refusal of its own edit.
#[test]
fn the_refusal_baseline_loads() {
    let mut live = rich();
    let snapshot = live.save_snapshot_v22();
    let mut other = rich();
    assert!(other.load_snapshot_v22(snapshot).is_ok());
    let fee_at_cap = {
        let mut snapshot = live.save_snapshot_v22();
        snapshot.bills.bills[0].late_fee_cents = 1_982;
        snapshot
    };
    assert!(
        live.load_snapshot_v22(fee_at_cap).is_ok(),
        "a fee at the cap loads"
    );
}

/// [WB-save]: a count for a usage kind the content no longer defines is
/// dropped on load, and the rest of the record loads.
#[test]
fn drops_counts_for_a_usage_kind_content_no_longer_defines() {
    let mut live = rich();
    let mut snapshot = live.save_snapshot_v22();
    snapshot.bills.uses.push(SavedBillCount {
        kind: "steam_room".into(),
        count: 9,
    });
    assert!(live.load_snapshot_v22(snapshot).is_ok());
    assert_eq!(live.world.resource::<Bills>(), &rich_bills());
}

/// A schema-twenty-one save of the shipped household at work with its pay
/// written back to the wages before issue 298: the worker's $180 as $120
/// and the open shift's 18000 cents as 12000.
fn before_the_raise(sim: &mut Sim) -> terri_core::SaveSnapshotV21 {
    let id = worker(sim);
    assert_eq!(pay_of(sim, id), 180);
    assert_eq!(open_shift_cents(sim, id), Some(18_000));
    let mut snapshot = sim.save_snapshot_v21();
    let careers = &mut snapshot
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .careers;
    careers
        .records
        .iter_mut()
        .find(|record| record.sim == id.0)
        .unwrap()
        .pay = 120;
    let attendance = &mut snapshot.legacy.legacy.legacy.legacy.attendance;
    attendance
        .shifts
        .iter_mut()
        .find(|shift| shift.sim == id.0)
        .unwrap()
        .pay_cents = 12_000;
    snapshot
}

/// [WB-save]: a schema-twenty-one load raises the worker's pay by 1.5 and
/// the open shift to the raised pay, and starts the bills empty.
#[test]
fn loading_schema_twenty_one_migrates_pay_and_open_shift_cents() {
    let mut source = at_work();
    let snapshot = before_the_raise(&mut source);
    let id = worker(&mut source);
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v21(snapshot)
        .expect("an older save loads");
    assert_eq!(pay_of(&loaded, id), 180);
    assert_eq!(open_shift_cents(&loaded, id), Some(18_000));
    assert!(loaded.world.resource::<Bills>().is_pristine());
}

/// [WB-save]: settled shift records and outcomes keep the pay they were
/// paid, which the household already received.
#[test]
fn settled_shift_records_keep_their_settled_pay() {
    let mut source = Sim::new_from_shipped_lot();
    for _ in 0..(14 * 60 + 30) {
        source.tick();
    }
    let id = worker(&mut source);
    let attendance = source
        .world
        .resource::<crate::attendance::Attendance>()
        .clone();
    let settled = attendance.shifts.get(&id).expect("a shift").clone();
    assert!(settled.settled, "Monday's shift is paid by 14:30");
    // What that shift paid at the old $120, by the settlement's own rule.
    let worked = settled.worked_ticks as i64;
    let old_paid = 12_000 * worked / (settled.end_tick - settled.start_tick) as i64;
    let mut snapshot = source.save_snapshot_v21();
    snapshot
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .careers
        .records
        .iter_mut()
        .find(|record| record.sim == id.0)
        .unwrap()
        .pay = 120;
    let rows = &mut snapshot.legacy.legacy.legacy.legacy.attendance;
    let shift = rows.shifts.iter_mut().find(|s| s.sim == id.0).unwrap();
    shift.pay_cents = 12_000;
    let outcome = rows.outcomes.iter_mut().find(|o| o.sim == id.0).unwrap();
    outcome.pay_cents = old_paid;
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v21(snapshot)
        .expect("an older save loads");
    let after = loaded.world.resource::<crate::attendance::Attendance>();
    assert_eq!(after.shifts.get(&id).unwrap().pay_cents, 12_000);
    assert_eq!(
        after
            .outcomes
            .iter()
            .find(|o| o.sim == id.0)
            .unwrap()
            .pay_cents,
        old_paid
    );
    assert_eq!(pay_of(&loaded, id), 180, "the pay itself is raised");
}

/// [WB-save]: only a pay the old range could hold is raised: a saved $100,
/// below the office clerk's old $120, lands below the new range when raised
/// and is still refused, as it was before the raise.
#[test]
fn a_pay_no_old_range_held_is_still_refused() {
    assert_eq!(super::super::wage_migration::raised(85), 128);
    assert_eq!(super::super::wage_migration::raised(150), 225);
    let mut source = at_work();
    let id = worker(&mut source);
    for bad in [0, 100, 151] {
        let mut snapshot = before_the_raise(&mut source);
        snapshot
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .careers
            .records
            .iter_mut()
            .find(|record| record.sim == id.0)
            .unwrap()
            .pay = bad;
        let mut loaded = Sim::new_from_shipped_lot();
        assert!(loaded.load_snapshot_v21(snapshot).is_err(), "pay {bad}");
    }
}

/// [WB-save]: after loading an older save the bills start empty, the first
/// tick counts the load day as the month's first, and the next first of a
/// month bills only the days lived after loading.
#[test]
fn loading_schemas_fourteen_to_twenty_one_starts_an_empty_prorated_month() {
    let mut source = Sim::new_from_shipped_lot();
    for _ in 0..(2 * DAY + 600) {
        source.tick();
    }
    // The newest older schema, and schema seventeen, whose loader restores
    // attendance itself; the loaders between share their paths.
    let loads: [(
        &str,
        Box<dyn Fn(&Sim, &mut Sim) -> Result<(), crate::SaveError>>,
    ); 2] = [
        (
            "schema 21",
            Box::new(|s, l| l.load_snapshot_v21(s.save_snapshot_v21())),
        ),
        (
            "schema 17",
            Box::new(|s, l| l.load_snapshot_v17(s.save_snapshot_v17())),
        ),
    ];
    for (name, load) in loads {
        let mut loaded = Sim::new_from_shipped_lot();
        load(&source, &mut loaded).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert!(loaded.world.resource::<Bills>().is_pristine(), "{name}");
        loaded.tick();
        let bills = loaded.world.resource::<Bills>();
        assert_eq!(bills.last_counted_day, Some(2), "{name}");
        assert_eq!(bills.month_days, 1, "{name}: the load day is day one");
        while loaded.world.resource::<SimClock>().tick < 7 * DAY {
            loaded.tick();
        }
        let issued = &loaded.world.resource::<Bills>().bills;
        let rent = issued.iter().find(|b| b.kind == RENT).expect("rent");
        // Days 2 to 6, five of seven: (6000 * 5 + 110 * 960 + 20 * 560) / 7.
        assert_eq!(
            rent.amount_cents,
            (30_000 + 105_600 + 11_200 + 6) / 7,
            "{name}"
        );
        assert_eq!(rent.due_day, 7, "{name}");
    }
}

/// [WB-save]: a schema-twenty-two save already pays the new wages, so it
/// is never migrated: the raised pay loads as saved, and a pay below the
/// new range is refused rather than raised again.
#[test]
fn a_schema_twenty_two_save_is_not_migrated_twice() {
    let mut source = at_work();
    let id = worker(&mut source);
    let snapshot = source.save_snapshot_v22();
    let mut loaded = Sim::new_from_shipped_lot();
    loaded.load_snapshot_v22(snapshot.clone()).unwrap();
    assert_eq!(pay_of(&loaded, id), 180);
    assert_eq!(open_shift_cents(&loaded, id), Some(18_000));
    let mut low = snapshot;
    low.legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .careers
        .records
        .iter_mut()
        .find(|record| record.sim == id.0)
        .unwrap()
        .pay = 120;
    assert!(
        loaded.load_snapshot_v22(low).is_err(),
        "schema twenty-two never raises pay"
    );
}

/// [WB-save]: a build session's baseline is the current schema and is never
/// migrated: entering and cancelling Build leaves pay and bills exactly as
/// they were, and only the older loaders select the migration.
#[test]
fn a_build_session_never_migrates_its_baseline() {
    let mut sim = at_work();
    let id = worker(&mut sim);
    let before = sim.save_snapshot_v22();
    sim.begin_build().expect("Build opens");
    sim.cancel_build().expect("cancel");
    sim.end_build().expect("leave");
    assert_eq!(sim.save_snapshot_v22(), before);
    assert_eq!(pay_of(&sim, id), 180);
    assert!(!super::super::Carried::for_load(sim.world()).wage_migration);
    assert!(super::super::Carried::for_older_load(sim.world()).wage_migration);
    let _ = Content(terri_data::pack());
}

/// [WB-save]: schema fourteen, the first with careers, raises pay through
/// its own loader too.
#[test]
fn loading_schema_fourteen_migrates_pay() {
    let mut source = at_work();
    let id = worker(&mut source);
    let mut snapshot = source
        .try_save_snapshot_v14()
        .expect("the shipped house fits schema fourteen");
    snapshot
        .careers
        .records
        .iter_mut()
        .find(|record| record.sim == id.0)
        .unwrap()
        .pay = 120;
    let mut loaded = Sim::new_from_shipped_lot();
    loaded
        .load_snapshot_v14(snapshot)
        .expect("schema fourteen loads");
    assert_eq!(pay_of(&loaded, id), 180);
}
