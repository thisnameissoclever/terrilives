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
fn at_work(mut sim: Sim) -> Sim {
    for _ in 0..(DAY + 600) {
        sim.tick();
    }
    sim
}

fn historical_shipped_household() -> Sim {
    let mut sim = Sim::new_from_shipped_lot();
    sim.world_mut().remove_resource::<terri_core::WorldSurfaces>();
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
        month_length: 7,
        month_start: 14,
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
                terms: crate::bills::BillTerms::of(&terri_data::pack().bills),
            },
            Bill {
                due_day: 14,
                kind: RENT,
                amount_cents: 29_360,
                late_fee_cents: 0,
                paid_day: Some(14),
                terms: crate::bills::BillTerms::of(&terri_data::pack().bills),
            },
            Bill {
                due_day: 14,
                kind: ELECTRICITY,
                amount_cents: 4_098,
                late_fee_cents: 0,
                paid_day: None,
                terms: crate::bills::BillTerms::of(&terri_data::pack().bills),
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

/// A named change to the bills tuning.
type TuningEdit = (&'static str, fn(&mut terri_data::BillsTuning));

/// [WB-save]: a later change to the month length, the grace, the late fee
/// or its cap leaves a schema-22 save loadable, on the day of the change
/// and on every day after it. Each bill keeps the terms it was issued
/// under, so its fees and overdue day do not change, and the open month
/// keeps the month length it is counted under.
#[test]
fn a_save_loads_after_each_bills_tuning_change() {
    let snapshot = rich().save_snapshot_v22();
    let edits: [TuningEdit; 8] = [
        ("a longer month", |b| b.days_per_month = 30),
        ("a ten-day month", |b| b.days_per_month = 10),
        ("an eight-day month", |b| b.days_per_month = 8),
        ("a six-day month", |b| b.days_per_month = 6),
        ("a shorter month", |b| {
            b.days_per_month = 3;
            b.grace_days = 2;
        }),
        ("less grace", |b| b.grace_days = 1),
        ("a lower fee", |b| b.late_fee_percent = 1),
        ("a lower cap", |b| b.late_fee_cap_percent = 1),
    ];
    for (name, edit) in edits {
        let mut pack = terri_data::pack().clone();
        edit(&mut pack.bills);
        let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
        let mut loaded = Sim::new_from_lot_and_content(&pack.lot, Content(pack));
        assert_eq!(loaded.load_snapshot_v22(snapshot.clone()), Ok(()), "{name}");
        assert_eq!(
            loaded.save_snapshot_v22().bills,
            snapshot.bills,
            "{name}: the record is kept as saved"
        );
        // Each day's first tick for a month and a half, so the open month
        // and the bills go on under the new tuning; every day's save loads.
        for day in 17..40u64 {
            loaded.world_mut().resource_mut::<SimClock>().tick = day * DAY - 1;
            loaded.tick();
            let resaved = loaded.save_snapshot_v22();
            let mut again = Sim::new_from_lot_and_content(&pack.lot, Content(pack));
            assert_eq!(
                again.load_snapshot_v22(resaved),
                Ok(()),
                "{name}: day index {day}"
            );
        }
    }
}

/// Review of 2026-10-25, S1: a save made on day 12 under seven-day months
/// and loaded under another month length goes on saving, loading and
/// entering Build on every day after. The month it was saved in runs to its
/// own end on day index 14 under its own length of seven, issues there, and
/// the next month opens under the new length on day index 14, short unless
/// 14 is a multiple of it ([WB-calendar]).
#[test]
fn a_save_from_mid_month_keeps_loading_and_building_after_a_month_length_change() {
    for (length, grace) in [
        (4u32, 3u32),
        (5, 4),
        (6, 5),
        (8, 5),
        (9, 5),
        (10, 5),
        (30, 5),
    ] {
        let shipped = terri_data::pack();
        let mut sim = Sim::new_from_lot_and_content(&shipped.lot, Content(shipped));
        for day in 0..=12u64 {
            sim.world_mut().resource_mut::<SimClock>().tick = day * DAY;
            crate::bills::tick(sim.world_mut());
        }
        let snapshot = sim.save_snapshot_v22();
        let mut pack = shipped.clone();
        pack.bills.days_per_month = length;
        pack.bills.grace_days = grace;
        let pack: &'static terri_data::ContentPack = Box::leak(Box::new(pack));
        let mut loaded = Sim::new_from_lot_and_content(&pack.lot, Content(pack));
        assert_eq!(
            loaded.load_snapshot_v22(snapshot),
            Ok(()),
            "length {length}"
        );
        let next_end = 14 - 14 % length + length;
        for day in 13..45u64 {
            loaded.world_mut().resource_mut::<SimClock>().tick = day * DAY;
            crate::bills::tick(loaded.world_mut());
            let bills = loaded.world().resource::<Bills>();
            assert!(
                bills.month_days <= bills.month_length,
                "length {length}, day index {day}: {} days counted under {}",
                bills.month_days,
                bills.month_length
            );
            if day == 13 {
                assert_eq!(
                    bills.month_length, 7,
                    "length {length}: the open month keeps its own"
                );
                assert!(
                    bills.bills.iter().all(|bill| bill.due_day <= 7),
                    "length {length}: nothing new is issued before day 14"
                );
            }
            if day == 14 {
                let issued: Vec<_> = bills
                    .bills
                    .iter()
                    .filter(|bill| bill.due_day == 14)
                    .collect();
                assert!(
                    !issued.is_empty(),
                    "length {length}: the saved month is issued on day 14"
                );
                assert!(
                    issued.iter().all(|bill| bill.terms.month_length == 7),
                    "length {length}: it is issued under its own length of seven"
                );
                assert_eq!(
                    bills.month_length, length,
                    "length {length}: the next month's own"
                );
                assert_eq!(
                    crate::bills::overview(loaded.world()).unwrap().next_due_day,
                    next_end,
                    "length {length}: the next bills are due when the new month ends"
                );
            }
            let resaved = loaded.save_snapshot_v22();
            let mut again = Sim::new_from_lot_and_content(&pack.lot, Content(pack));
            assert_eq!(
                again.load_snapshot_v22(resaved),
                Ok(()),
                "length {length}, day index {day}: the save loads"
            );
            assert!(
                loaded.begin_build().is_ok(),
                "length {length}, day index {day}: Build opens"
            );
            loaded.cancel_build().unwrap();
            loaded.end_build().unwrap();
        }
    }
}

/// [WB-save]: a record with counts, trips, a last month and an overdue bill
/// round-trips exactly, and the two worlds go on identically.
#[test]
fn schema_twenty_two_round_trips_the_bills_record() {
    let mut source = rich();
    source.world_mut().remove_resource::<terri_core::WorldSurfaces>();
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
        month_length: 7,
        grace_days: 5,
        late_fee_percent: 5,
        late_fee_cap_percent: 50,
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
    // Three days counted, all passed, but more than a two-day month holds.
    refused(|b| b.month_length = 2);
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
fn refuses_an_open_month_outside_the_compiler_range() {
    refused(|b| b.month_length = 366);
    refused(|b| b.month_length = 0);
    refused(|b| b.month_start = 17);
}

/// The open month's end is fixed by its start and length: a save counted at
/// or past that end is refused ([WB-save]). The record is on day index 16
/// with its month begun on 14 under seven, so it ends on 21.
#[test]
fn refuses_a_month_counted_to_or_past_its_own_end() {
    // Under a length of two it ended on 16, and the last counted day may
    // not be that day.
    refused(|b| b.month_length = 2);
    // Under three it ended on 15: day 16 is past it.
    refused(|b| b.month_length = 3);
    // Begun on 12 under four it ends on 16: day 16 is not before its end.
    refused(|b| {
        b.month_start = 12;
        b.month_length = 4;
        b.month_days = 4;
    });
}

/// Review of 2026-11-15, 2, as redesigned: a month length of 365 after
/// seven-day months. The seven-day month ends at its own boundary, the next
/// month opens under 365 on that day, and it is short or full by where that
/// day falls in 365, so every save on every day near the change loads.
#[test]
fn a_month_length_of_365_after_seven_day_months_issues_at_its_own_boundary() {
    let shipped = terri_data::pack();
    let mut long_pack = shipped.clone();
    long_pack.bills.days_per_month = 365;
    let long_pack: &'static terri_data::ContentPack = Box::leak(Box::new(long_pack));
    for save_day in [363u64, 364, 365, 371] {
        let mut sim = Sim::new_from_lot_and_content(&shipped.lot, Content(shipped));
        for day in 0..=save_day {
            sim.world_mut().resource_mut::<SimClock>().tick = day * DAY;
            crate::bills::tick(sim.world_mut());
        }
        let snapshot = sim.save_snapshot_v22();
        // The seven-day month the save is in ends on the next multiple of 7.
        let own_end = (save_day as u32) - (save_day as u32) % 7 + 7;
        let mut loaded = Sim::new_from_lot_and_content(&long_pack.lot, Content(long_pack));
        assert_eq!(loaded.load_snapshot_v22(snapshot), Ok(()), "day {save_day}");
        // The unsaved world goes on under the longer month from the same day.
        sim.world_mut().insert_resource(Content(long_pack));
        for day in save_day + 1..own_end as u64 + 3 {
            sim.world_mut().resource_mut::<SimClock>().tick = day * DAY;
            crate::bills::tick(sim.world_mut());
            loaded.world_mut().resource_mut::<SimClock>().tick = day * DAY;
            crate::bills::tick(loaded.world_mut());
            assert_same_as_twin(&loaded, &sim, day as u32);
            let bills = loaded.world().resource::<Bills>();
            if day < own_end as u64 {
                assert_eq!(bills.month_length, 7, "saved on {save_day}, day {day}");
                assert!(bills.bills.iter().all(|b| b.due_day < own_end));
            } else if day == own_end as u64 {
                // The new month opened on the day the seven-day one ended.
                assert_eq!(bills.month_length, 365, "saved on {save_day}, day {day}");
                assert_eq!(bills.month_start, own_end, "saved on {save_day}");
                assert!(
                    bills
                        .bills
                        .iter()
                        .any(|b| b.due_day == own_end && b.terms.month_length == 7),
                    "saved on {save_day}: the seven-day month issued at its own boundary"
                );
                let next = crate::bills::overview(loaded.world()).unwrap().next_due_day;
                assert_eq!(next, own_end - own_end % 365 + 365, "saved on {save_day}");
            }
            let mut again = Sim::new_from_lot_and_content(&long_pack.lot, Content(long_pack));
            assert_eq!(
                again.load_snapshot_v22(loaded.save_snapshot_v22()),
                Ok(()),
                "saved on {save_day}, loaded again on day index {day}"
            );
        }
    }
}

/// The world a save and a load rebuilt matches the twin that never left
/// memory: the same bills record, the same saved bills, the same Funds and
/// the same world hash.
fn assert_same_as_twin(reloaded: &Sim, twin: &Sim, day: u32) {
    assert_eq!(
        reloaded.world().resource::<Bills>(),
        twin.world().resource::<Bills>(),
        "day index {day}: the bills record differs from the unsaved twin's"
    );
    assert_eq!(
        reloaded.save_snapshot_v22().bills,
        twin.save_snapshot_v22().bills,
        "day index {day}: the saved bills differ from the unsaved twin's"
    );
    assert_eq!(
        reloaded.world().resource::<terri_core::Funds>().0,
        twin.world().resource::<terri_core::Funds>().0,
        "day index {day}: Funds differ from the unsaved twin's"
    );
    assert_eq!(
        reloaded.world_hash(),
        twin.world_hash(),
        "day index {day}: the world hash differs from the unsaved twin's"
    );
}

/// Runs bills alone for `days` days with the tuning's month length given
/// by `length_on` for each day, saving and loading into a world under that
/// day's tuning every day. Every load succeeds, the open month never counts
/// more days than its length and its length never passes 365, no issued
/// transportation base charge exceeds a full month, and on every counted day
/// the panel's expected transportation is the month's whole base pro rata,
/// so on a month's last counted day it equals what is issued next. Returns
/// the number of months issued.
fn exercise_month_lengths(length_on: &dyn Fn(u32) -> u32, days: u32) -> u32 {
    let shipped = terri_data::pack();
    let base = shipped.bills.transportation_base_cents;
    let mut packs: std::collections::BTreeMap<u32, &'static terri_data::ContentPack> =
        Default::default();
    for day in 0..days {
        packs.entry(length_on(day)).or_insert_with_key(|length| {
            let mut pack = shipped.clone();
            pack.bills.days_per_month = *length;
            pack.bills.grace_days = 2;
            Box::leak(Box::new(pack))
        });
    }
    let first = packs[&length_on(0)];
    let mut sim = Sim::new_from_lot_and_content(&first.lot, Content(first));
    // A twin under the same tuning each day that is never saved or loaded.
    let mut twin = Sim::new_from_lot_and_content(&first.lot, Content(first));
    let mut issued_months = 0;
    let mut expected_at_end = None;
    for day in 0..days {
        let pack = packs[&length_on(day)];
        let snapshot = sim.save_snapshot_v22();
        sim = Sim::new_from_lot_and_content(&pack.lot, Content(pack));
        assert_eq!(
            sim.load_snapshot_v22(snapshot),
            Ok(()),
            "day index {day}: the save loads"
        );
        sim.world_mut().resource_mut::<SimClock>().tick = u64::from(day) * DAY;
        crate::bills::tick(sim.world_mut());
        twin.world_mut().insert_resource(Content(pack));
        twin.world_mut().resource_mut::<SimClock>().tick = u64::from(day) * DAY;
        crate::bills::tick(twin.world_mut());
        assert_same_as_twin(&sim, &twin, day);
        let bills = sim.world().resource::<Bills>().clone();
        assert!(
            bills.month_days >= 1 && bills.month_days <= bills.month_length,
            "day index {day}: {} days under {}",
            bills.month_days,
            bills.month_length
        );
        assert!(bills.month_length <= 365, "day index {day}");
        let issued: Vec<_> = bills.bills.iter().filter(|b| b.due_day == day).collect();
        if !issued.is_empty() {
            issued_months += 1;
            for bill in issued {
                assert_eq!(bill.due_day % bill.terms.month_length, 0, "day index {day}");
                if bill.kind == crate::bills::TRANSPORTATION {
                    assert!(
                        bill.amount_cents <= base,
                        "day index {day}: {} over a full month",
                        bill.amount_cents
                    );
                    if let Some(expected) = expected_at_end.take() {
                        assert_eq!(
                            bill.amount_cents, expected,
                            "day index {day}: issued as expected the day before"
                        );
                    }
                }
            }
        }
        // The panel projects the open month to its fixed end.
        let end = crate::bills::month_end(bills.month_start, bills.month_length);
        let whole = i64::from(end - bills.month_start);
        let length = i64::from(bills.month_length);
        let expected = crate::bills::next_bills(sim.world())
            .into_iter()
            .find(|next| next.kind == crate::bills::TRANSPORTATION)
            .map_or(0, |next| next.expected_cents);
        assert_eq!(
            expected,
            (base * whole + length - 1) / length,
            "day index {day}: expected follows the month's own end"
        );
        if day == end - 1 {
            expected_at_end = Some(expected);
        }
    }
    issued_months
}

/// Review of 2026-11-15, M2, as redesigned: month lengths changed on fixed
/// days, including 7, then 365 on day 6, then 300, then 365, then 300.
#[test]
fn the_month_length_sequence_7_365_300_365_300_keeps_every_save_and_projection_right() {
    let issued = exercise_month_lengths(
        &|day| match day {
            0..=5 => 7,
            6..=39 => 365,
            40..=299 => 300,
            300..=339 => 365,
            340..=499 => 300,
            500..=589 => 365,
            _ => 300,
        },
        1000,
    );
    // Months end on days 7, 365, 600 and 900.
    assert_eq!(issued, 4);
}

/// Month lengths changing every few days among short and long ones: many
/// short months, each charged pro rata, every save loads.
#[test]
fn month_lengths_changing_every_few_days_keep_every_save_and_projection_right() {
    let lengths = [7u32, 3, 10, 5, 30, 4, 1, 9];
    let issued = exercise_month_lengths(&|day| lengths[(day as usize / 3) % lengths.len()], 150);
    assert!(issued >= 20, "the run issued {issued} months");
}

/// Each edit below makes only the bill's own terms invalid: the electricity
/// bill is in its grace, so its fee and due day stay valid, and an unpaid
/// bill due on day index 0 is due on the first day of a month of any
/// length.
#[test]
fn refuses_a_bill_with_terms_the_compiler_would_refuse() {
    refused(|b| b.bills[2].late_fee_percent = 101);
    refused(|b| b.bills[2].late_fee_cap_percent = 101);
    refused(|b| b.bills[2].grace_days = 365);
    let mut live = rich();
    // A bill issued before the tuning shortened months keeps a grace longer
    // than the month it charges: grace only has to stay under 365 days.
    let mut long_grace = live.save_snapshot_v22();
    long_grace.bills.bills[2].grace_days = 20;
    assert!(
        live.load_snapshot_v22(long_grace).is_ok(),
        "a grace longer than the month loads"
    );
    let mut live = rich();
    let mut oldest = live.save_snapshot_v22();
    oldest.bills.bills.insert(0, bill(0, RENT));
    assert!(
        live.load_snapshot_v22(oldest).is_ok(),
        "an unpaid bill due on day index 0 loads"
    );
    refused(|b| {
        let mut old = bill(0, RENT);
        old.month_length = 366;
        b.bills.insert(0, old);
    });
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
    let mut source = at_work(historical_shipped_household());
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
    let mut source = at_work(historical_shipped_household());
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
    let mut source = historical_shipped_household();
    for _ in 0..(2 * DAY + 600) {
        source.tick();
    }
    // The newest older schema, and schema seventeen, whose loader restores
    // attendance itself; the loaders between share their paths.
    type Load = Box<dyn Fn(&Sim, &mut Sim) -> Result<(), crate::SaveError>>;
    let loads: [(&str, Load); 2] = [
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
        // Days 2 to 6, five of seven: (6000 * 5 + 90 * 960 + 20 * 560) / 7.
        assert_eq!(
            rent.amount_cents,
            (30_000 + 86_400 + 11_200 + 6) / 7,
            "{name}"
        );
        assert_eq!(rent.due_day, 7, "{name}");
    }
}

/// [WB-save]: a build session's baseline is the current schema and is never
/// migrated: entering and cancelling Build leaves pay and bills exactly as
/// they were, and only the older loaders select the migration.
#[test]
fn a_build_session_never_migrates_its_baseline() {
    let mut sim = at_work(Sim::new_from_shipped_lot());
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

/// [WB-save]: an open shift whose person has no career record is raised
/// from its own whole dollars when they land in the row's new range, and
/// left alone otherwise; a settled shift keeps its pay.
#[test]
fn migrate_attendance_raises_an_open_shift_with_no_record_from_its_own_pay() {
    let sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let office = pack
        .careers
        .iter()
        .position(|c| c.id == "office_job")
        .unwrap() as u32;
    let shift =
        |sim: u32, pay_cents: i64, settled: bool| terri_core::save_v17::SavedScheduledShift {
            sim,
            career: office,
            start_tick: 360,
            end_tick: 840,
            worked_ticks: 0,
            accounted_tick: 360,
            pay_cents,
            settled,
            legacy: false,
        };
    let mut attendance = terri_core::save_v17::SavedAttendance {
        shifts: vec![
            shift(0, 12_000, false),
            shift(1, 11_950, false),
            shift(2, 12_000, true),
            shift(3, 12_050, false),
        ],
        ..Default::default()
    };
    let careers = terri_core::save_v14::SavedCareers {
        records: Vec::new(),
        ..sim.save_snapshot_v14().careers
    };
    super::super::wage_migration::migrate_attendance(sim.world(), &mut attendance, &careers);
    assert_eq!(
        attendance
            .shifts
            .iter()
            .map(|s| s.pay_cents)
            .collect::<Vec<_>>(),
        // $120 raised to $180; cents that are not whole dollars stay; a
        // settled shift stays; $120.50 is not whole dollars either.
        [18_000, 11_950, 12_000, 12_050]
    );
}

/// [WB-save]: an open shift takes the pay of its own person's career record,
/// not another person's.
#[test]
fn migrate_attendance_raises_each_open_shift_to_its_own_persons_record() {
    let sim = Sim::new_from_shipped_lot();
    let pack = sim.world().resource::<Content>().0;
    let office = pack
        .careers
        .iter()
        .position(|c| c.id == "office_job")
        .unwrap() as u32;
    let shift = |sim: u32| terri_core::save_v17::SavedScheduledShift {
        sim,
        career: office,
        start_tick: 360,
        end_tick: 840,
        worked_ticks: 0,
        accounted_tick: 360,
        pay_cents: 12_000,
        settled: false,
        legacy: false,
    };
    let mut attendance = terri_core::save_v17::SavedAttendance {
        shifts: vec![shift(0), shift(1)],
        ..Default::default()
    };
    let record = |sim: u32, pay: u32| terri_core::save_v14::SavedCareerRecord {
        sim,
        pay,
        job_satisfaction: 50.0,
        consecutive_poor: 0,
        consecutive_good: 0,
        shifts: Vec::new(),
        history: Vec::new(),
        review_due: None,
    };
    let careers = terri_core::save_v14::SavedCareers {
        records: vec![record(0, 190), record(1, 200)],
        ..sim.save_snapshot_v14().careers
    };
    super::super::wage_migration::migrate_attendance(sim.world(), &mut attendance, &careers);
    assert_eq!(
        attendance
            .shifts
            .iter()
            .map(|s| s.pay_cents)
            .collect::<Vec<_>>(),
        [19_000, 20_000]
    );
}

/// [WB-save]: schema fourteen, the first with careers, raises pay through
/// its own loader too.
#[test]
fn loading_schema_fourteen_migrates_pay() {
    let mut source = at_work(historical_shipped_household());
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
