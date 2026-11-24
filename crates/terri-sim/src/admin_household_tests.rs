//! The Household tab's edits ([T7], [AP-e-house]): funds and bills. Every
//! edit applies, refuses each of its listed refusal codes with the hash
//! unchanged, moves the hash, survives a save, draws no random number and
//! Undo takes it back ([AP-tests-sim] items 1, 3, 4, 5 and 11).
use crate::admin::AdminRefusal::{self, *};
use crate::admin_test_support::*;
use crate::bills::{self, Bill, Bills};
use crate::{Content, Sim};
use terri_core::admin::{AdminEdit, MAX_ADMIN_FUNDS_CENTS};
use terri_core::{Funds, SimClock};

const DAY: u64 = 1440;

fn pack() -> &'static terri_data::ContentPack {
    terri_data::pack()
}

/// The shipped lot with nobody living there and no funds, at its first tick
/// and with the panel open.
fn empty() -> Sim {
    let mut sim = Sim::new_from_lot_and_content(&pack().lot, Content(pack()));
    sim.begin_admin().expect("opens");
    sim
}

/// The same lot at the start of day 15, with two months of bills issued and
/// nobody having paid them, as `bills_tests` builds its months: bills due on
/// day 7 are past their grace (five days) and carry a late fee, bills due on
/// day 14 are inside theirs and carry none. The record is written directly,
/// since running fifteen days to get there is minutes of debug ticks. It is a
/// state the loader accepts: the panel's `begin_admin` test-restores it. The
/// panel is open.
fn house() -> Sim {
    let mut sim = Sim::new_from_lot_and_content(&pack().lot, Content(pack()));
    sim.world_mut().resource_mut::<SimClock>().tick = 15 * DAY;
    let terms = bills::BillTerms::of(&pack().bills);
    let mut record = Vec::new();
    for (due_day, fee_percent) in [(7u32, 20i64), (14, 0)] {
        for kind in 0..bills::BILL_KINDS {
            let amount_cents = 10_000 + 1_000 * i64::from(kind) + i64::from(due_day);
            record.push(Bill {
                due_day,
                kind,
                amount_cents,
                late_fee_cents: amount_cents * fee_percent / 100,
                paid_day: None,
                terms,
            });
        }
    }
    *sim.world_mut().resource_mut::<Bills>() = Bills {
        last_counted_day: Some(14),
        month_days: 1,
        month_length: 7,
        month_start: 14,
        bills: record,
        ..Bills::default()
    };
    sim.begin_admin().expect("opens");
    sim
}

fn today(sim: &Sim) -> u32 {
    bills::day_index(
        sim.world().resource::<SimClock>().tick,
        pack().tuning.day_ticks,
    )
}

fn record(sim: &Sim) -> Vec<Bill> {
    sim.world().resource::<Bills>().bills.clone()
}

fn bill(sim: &Sim, due_day: u32, kind: u8) -> Option<Bill> {
    record(sim)
        .into_iter()
        .find(|bill| bill.due_day == due_day && bill.kind == kind)
}

fn funds(sim: &Sim) -> i64 {
    sim.world().resource::<Funds>().0
}

fn set_funds(sim: &mut Sim, cents: i64) {
    sim.admin_apply(change(vec![AdminEdit::SetFunds { cents }]))
        .expect("funds apply");
}

fn set_bill(due_day: u32, kind: u8, amount_cents: i64, late_fee_cents: i64) -> AdminEdit {
    AdminEdit::SetBill {
        due_day,
        kind,
        amount_cents,
        late_fee_cents,
    }
}

fn add_bill(due_day: u32, kind: u8, amount_cents: i64, late_fee_cents: i64) -> AdminEdit {
    AdminEdit::AddBill {
        due_day,
        kind,
        amount_cents,
        late_fee_cents,
    }
}

/// The fixture is what the tests below say it is.
#[test]
fn the_fixture_holds_two_months_of_unpaid_bills() {
    let sim = house();
    assert_eq!(today(&sim), 15);
    let held = record(&sim);
    assert!(held.iter().any(|bill| bill.due_day == 7));
    assert!(held.iter().any(|bill| bill.due_day == 14));
    assert!(held.iter().all(|bill| bill.paid_day.is_none()));
    assert!(
        held.iter()
            .filter(|bill| bill.due_day == 7)
            .all(|bill| bill.late_fee_cents > 0),
        "past their grace, the first month's bills carry a fee"
    );
    assert!(
        held.iter()
            .filter(|bill| bill.due_day == 14)
            .all(|bill| bill.late_fee_cents == 0),
        "inside their grace, the second month's bills carry none"
    );
}

/// [AP-e-funds], [AP-e-zero]: any amount within the bound, either sign;
/// one cent past it is refused.
#[test]
fn funds_set_within_the_bound_and_refuse_past_it() {
    let mut sim = empty();
    for cents in [
        123_456,
        -50,
        MAX_ADMIN_FUNDS_CENTS,
        -MAX_ADMIN_FUNDS_CENTS,
        0,
    ] {
        if funds(&sim) == cents {
            continue;
        }
        applied(&mut sim, AdminEdit::SetFunds { cents });
        assert_eq!(funds(&sim), cents);
    }
    for cents in [MAX_ADMIN_FUNDS_CENTS + 1, -MAX_ADMIN_FUNDS_CENTS - 1] {
        refused(&mut sim, AdminEdit::SetFunds { cents }, OutOfRange);
        refused(&mut sim, AdminEdit::AdjustFunds { cents }, OutOfRange);
    }
}

/// [AP-e-fundbtn]: an adjustment adds to the funds and is refused when the
/// result would pass the bound in either direction.
#[test]
fn an_adjustment_is_refused_when_it_would_pass_the_bound() {
    let mut sim = empty();
    set_funds(&mut sim, 1);
    applied(&mut sim, AdminEdit::AdjustFunds { cents: 100_000 });
    assert_eq!(funds(&sim), 100_001);
    applied(&mut sim, AdminEdit::AdjustFunds { cents: -300_000 });
    assert_eq!(funds(&sim), -199_999, "funds may go negative");
    set_funds(&mut sim, MAX_ADMIN_FUNDS_CENTS);
    refused(&mut sim, AdminEdit::AdjustFunds { cents: 1 }, OutOfRange);
    applied(&mut sim, AdminEdit::AdjustFunds { cents: -1 });
    set_funds(&mut sim, -MAX_ADMIN_FUNDS_CENTS);
    refused(&mut sim, AdminEdit::AdjustFunds { cents: -1 }, OutOfRange);
    applied(&mut sim, AdminEdit::AdjustFunds { cents: 1 });
}

/// [AP-e-amount]: the amount and the late fee, within the bill's cap and
/// not before its grace has passed.
#[test]
fn a_bill_takes_a_new_amount_and_fee_within_its_rules() {
    let mut sim = house();
    let old = bill(&sim, 7, bills::RENT).expect("rent due on 7");
    let cap = bills::late_fee_cap(&old);
    applied(&mut sim, set_bill(7, bills::RENT, 5_000, 0));
    assert_eq!(bill(&sim, 7, bills::RENT).unwrap().late_fee_cents, 0);
    let new_cap = bills::late_fee_cap(&Bill {
        amount_cents: 5_000,
        ..old
    });
    applied(&mut sim, set_bill(7, bills::RENT, 5_000, new_cap));
    assert_eq!(bill(&sim, 7, bills::RENT).unwrap().late_fee_cents, new_cap);
    refused(
        &mut sim,
        set_bill(7, bills::RENT, 5_000, new_cap + 1),
        LateFeeTooHigh,
    );
    // Lowering the amount under a fee that no longer fits is refused.
    refused(
        &mut sim,
        set_bill(7, bills::RENT, 1_000, new_cap),
        LateFeeTooHigh,
    );
    applied(&mut sim, set_bill(7, bills::RENT, 1, 0));
    applied(
        &mut sim,
        set_bill(7, bills::RENT, MAX_ADMIN_FUNDS_CENTS, cap.max(1)),
    );
    for amount in [0, -1, MAX_ADMIN_FUNDS_CENTS + 1] {
        refused(&mut sim, set_bill(7, bills::RENT, amount, 0), OutOfRange);
    }
    refused(&mut sim, set_bill(7, bills::RENT, 100, -1), OutOfRange);
    refused(
        &mut sim,
        set_bill(7, bills::RENT, 100, MAX_ADMIN_FUNDS_CENTS + 1),
        OutOfRange,
    );
    // Inside its grace a bill takes no fee.
    refused(
        &mut sim,
        set_bill(14, bills::WATER, 100, 1),
        LateFeeTooEarly,
    );
    applied(&mut sim, set_bill(14, bills::WATER, 100, 0));
    refused(&mut sim, set_bill(21, bills::RENT, 100, 0), NotFound);
    refused(
        &mut sim,
        set_bill(7, bills::RENT + 7, 100, 0),
        UnknownContent,
    );
}

/// [AP-e-due]: a bill moves to another month start at or before today, onto
/// a day and kind no bill holds; a move that leaves its fee before the new
/// grace clears the fee.
#[test]
fn a_bill_moves_to_a_month_start_and_keeps_the_record_in_order() {
    let mut sim = house();
    let earlier = bill(&sim, 7, bills::WATER).unwrap();
    assert!(earlier.late_fee_cents > 0);
    // Onto a taken day and kind, to a day that is no month start, to the
    // future, and to its own day.
    refused(
        &mut sim,
        AdminEdit::MoveBill {
            due_day: 7,
            kind: bills::WATER,
            to_due_day: 14,
        },
        BillExists,
    );
    // A move onto its own day is no move: admission refuses the edit for
    // touching one bill twice, and the panel never offers it.
    refused(
        &mut sim,
        AdminEdit::MoveBill {
            due_day: 7,
            kind: bills::WATER,
            to_due_day: 7,
        },
        Malformed,
    );
    for to_due_day in [3, 13, 15] {
        refused(
            &mut sim,
            AdminEdit::MoveBill {
                due_day: 7,
                kind: bills::WATER,
                to_due_day,
            },
            BadDueDay,
        );
    }
    refused(
        &mut sim,
        AdminEdit::MoveBill {
            due_day: 7,
            kind: bills::WATER,
            to_due_day: 21,
        },
        BadDueDay,
    );
    refused(
        &mut sim,
        AdminEdit::MoveBill {
            due_day: 28,
            kind: bills::WATER,
            to_due_day: 0,
        },
        NotFound,
    );
    // Earlier keeps its fee, since the grace had passed there too.
    applied(
        &mut sim,
        AdminEdit::MoveBill {
            due_day: 7,
            kind: bills::WATER,
            to_due_day: 0,
        },
    );
    let moved = bill(&sim, 0, bills::WATER).expect("now due on day 0");
    assert_eq!(moved.late_fee_cents, earlier.late_fee_cents);
    assert!(bill(&sim, 7, bills::WATER).is_none());
    let order: Vec<(u32, u8)> = record(&sim).iter().map(|b| (b.due_day, b.kind)).collect();
    assert!(
        order.windows(2).all(|pair| pair[0] < pair[1]),
        "the record stays ascending by due day then kind: {order:?}"
    );
    // Later than today minus its grace clears a fee it could no longer hold.
    applied(
        &mut sim,
        AdminEdit::DeleteBill {
            due_day: 14,
            kind: bills::RENT,
        },
    );
    let rent = bill(&sim, 7, bills::RENT).unwrap();
    assert!(rent.late_fee_cents > 0);
    applied(
        &mut sim,
        AdminEdit::MoveBill {
            due_day: 7,
            kind: bills::RENT,
            to_due_day: 14,
        },
    );
    let later = bill(&sim, 14, bills::RENT).expect("now due on day 14");
    assert_eq!(later.late_fee_cents, 0, "a fee inside the grace is cleared");
    assert_eq!(later.amount_cents, rent.amount_cents);
}

/// [AP-e-pay]: pay from funds takes the bill and its fee, marks it paid
/// today, refuses when funds fall short, and an older month's bill leaves
/// the record once paid.
#[test]
fn paying_from_funds_takes_the_total_and_drops_an_older_month() {
    let mut sim = house();
    let older = bill(&sim, 7, bills::RENT).unwrap();
    let last = bill(&sim, 14, bills::RENT).unwrap();
    refused(
        &mut sim,
        AdminEdit::PayBill {
            due_day: 7,
            kind: bills::RENT,
        },
        CannotAfford,
    );
    set_funds(&mut sim, older.total_cents() + last.total_cents() - 1);
    applied(
        &mut sim,
        AdminEdit::PayBill {
            due_day: 7,
            kind: bills::RENT,
        },
    );
    assert_eq!(funds(&sim), last.total_cents() - 1);
    assert!(
        bill(&sim, 7, bills::RENT).is_none(),
        "an older month's paid bill leaves the record"
    );
    refused(
        &mut sim,
        AdminEdit::PayBill {
            due_day: 14,
            kind: bills::RENT,
        },
        CannotAfford,
    );
    applied(&mut sim, AdminEdit::AdjustFunds { cents: 1 });
    applied(
        &mut sim,
        AdminEdit::PayBill {
            due_day: 14,
            kind: bills::RENT,
        },
    );
    assert_eq!(funds(&sim), 0);
    assert_eq!(
        bill(&sim, 14, bills::RENT).and_then(|bill| bill.paid_day),
        Some(today(&sim)),
        "the last issued month's paid bill stays, paid today"
    );
    refused(
        &mut sim,
        AdminEdit::PayBill {
            due_day: 14,
            kind: bills::RENT,
        },
        BillPaid,
    );
    refused(
        &mut sim,
        AdminEdit::PayBill {
            due_day: 99,
            kind: bills::RENT,
        },
        NotFound,
    );
}

/// [AP-e-free]: mark paid leaves funds alone; a paid bill takes no more
/// edits; deleting removes a bill whether or not it is paid.
#[test]
fn marking_paid_is_free_and_a_paid_bill_takes_no_edits() {
    let mut sim = house();
    set_funds(&mut sim, 777);
    applied(
        &mut sim,
        AdminEdit::MarkBillPaid {
            due_day: 14,
            kind: bills::WATER,
        },
    );
    assert_eq!(funds(&sim), 777);
    assert_eq!(
        bill(&sim, 14, bills::WATER).and_then(|bill| bill.paid_day),
        Some(15)
    );
    for edit in [
        AdminEdit::MarkBillPaid {
            due_day: 14,
            kind: bills::WATER,
        },
        AdminEdit::PayBill {
            due_day: 14,
            kind: bills::WATER,
        },
        set_bill(14, bills::WATER, 100, 0),
        AdminEdit::MoveBill {
            due_day: 14,
            kind: bills::WATER,
            to_due_day: 0,
        },
    ] {
        refused(&mut sim, edit, BillPaid);
    }
    applied(
        &mut sim,
        AdminEdit::DeleteBill {
            due_day: 14,
            kind: bills::WATER,
        },
    );
    assert!(bill(&sim, 14, bills::WATER).is_none());
    refused(
        &mut sim,
        AdminEdit::DeleteBill {
            due_day: 14,
            kind: bills::WATER,
        },
        NotFound,
    );
}

/// [AP-e-add]: a new bill on a month start at or before today, on a day and
/// kind no bill holds, with a fee only after its grace, inserted in order.
#[test]
fn a_new_bill_needs_a_month_start_a_free_slot_and_a_fee_it_may_hold() {
    let mut sim = house();
    refused(&mut sim, add_bill(14, bills::RENT, 100, 0), BillExists);
    for due_day in [3, 15, 21, 70] {
        refused(&mut sim, add_bill(due_day, bills::RENT, 100, 0), BadDueDay);
    }
    refused(&mut sim, add_bill(0, bills::RENT, 0, 0), OutOfRange);
    refused(&mut sim, add_bill(0, 9, 100, 0), UnknownContent);
    let cap = bills::late_fee_cap(&Bill {
        amount_cents: 1_000,
        terms: bills::BillTerms::of(&pack().bills),
        due_day: 0,
        kind: bills::RENT,
        late_fee_cents: 0,
        paid_day: None,
    });
    refused(
        &mut sim,
        add_bill(0, bills::RENT, 1_000, cap + 1),
        LateFeeTooHigh,
    );
    applied(&mut sim, add_bill(0, bills::RENT, 1_000, cap));
    let added = bill(&sim, 0, bills::RENT).expect("added");
    assert_eq!(
        (added.amount_cents, added.late_fee_cents, added.paid_day),
        (1_000, cap, None)
    );
    assert_eq!(added.terms, bills::BillTerms::of(&pack().bills));
    let order: Vec<(u32, u8)> = record(&sim).iter().map(|b| (b.due_day, b.kind)).collect();
    assert!(order.windows(2).all(|pair| pair[0] < pair[1]), "{order:?}");
    assert_eq!(order[0], (0, bills::RENT), "inserted first, by due day");
    // A bill inside its grace takes no fee: the grace is five days from 14.
    let mut sim = house();
    applied(
        &mut sim,
        AdminEdit::DeleteBill {
            due_day: 14,
            kind: bills::WATER,
        },
    );
    refused(
        &mut sim,
        add_bill(14, bills::WATER, 100, 1),
        LateFeeTooEarly,
    );
    applied(&mut sim, add_bill(14, bills::WATER, 100, 0));
}

/// An added bill past the last issued month would leave an earlier month's
/// paid bills in a record the loader refuses; the record keeps only the last
/// issued month's paid bills, as paying does.
#[test]
fn the_record_keeps_only_the_last_issued_months_paid_bills() {
    let mut sim = house();
    let all_of_14: Vec<AdminEdit> = (0..bills::BILL_KINDS)
        .filter(|&kind| bill(&sim, 14, kind).is_some())
        .map(|due_kind| AdminEdit::DeleteBill {
            due_day: 14,
            kind: due_kind,
        })
        .collect();
    applied_change(&mut sim, all_of_14);
    // Day 7 is the last issued month now; one of its bills is paid.
    applied(
        &mut sim,
        AdminEdit::MarkBillPaid {
            due_day: 7,
            kind: bills::RENT,
        },
    );
    assert_eq!(
        bill(&sim, 7, bills::RENT).and_then(|b| b.paid_day),
        Some(15),
        "paid on the last issued month, it stays"
    );
    // A bill due on day 14 makes 14 the last issued month: the paid bill of
    // day 7 leaves the record.
    applied(&mut sim, add_bill(14, bills::RENT, 5_000, 0));
    assert!(
        record(&sim).iter().all(|bill| bill.paid_day.is_none()),
        "no paid bill outside the last issued month survives"
    );
    assert!(bill(&sim, 7, bills::RENT).is_none());
    assert_survives_save(&sim, "the record after the last issued month moved");
}

fn applied_change(sim: &mut Sim, edits: Vec<AdminEdit>) {
    let before = sim.world_hash();
    sim.admin_apply(change(edits)).expect("applies");
    assert_ne!(sim.world_hash(), before);
}

/// [AP-e-nofees], [AP-e-allpaid]: the panel's two bulk buttons are one
/// change of per-bill edits, one Undo step; behind-on-bills ends once
/// nothing is overdue.
#[test]
fn removing_every_fee_and_marking_every_bill_paid_are_one_change_each() {
    let mut sim = house();
    assert!(
        bills::any_overdue(sim.world()),
        "the day-7 bills are overdue"
    );
    let unpaid: Vec<Bill> = record(&sim);
    let no_fees: Vec<AdminEdit> = unpaid
        .iter()
        .filter(|bill| bill.late_fee_cents > 0)
        .map(|bill| set_bill(bill.due_day, bill.kind, bill.amount_cents, 0))
        .collect();
    assert!(!no_fees.is_empty());
    applied_change(&mut sim, no_fees);
    assert!(record(&sim).iter().all(|bill| bill.late_fee_cents == 0));
    assert!(
        bills::any_overdue(sim.world()),
        "overdue is the due day and the grace, not the fee"
    );
    assert_eq!(sim.admin_undo_depth(), 1);
    let all_paid: Vec<AdminEdit> = unpaid
        .iter()
        .map(|bill| AdminEdit::MarkBillPaid {
            due_day: bill.due_day,
            kind: bill.kind,
        })
        .collect();
    applied_change(&mut sim, all_paid);
    assert_eq!(sim.admin_undo_depth(), 2);
    assert!(
        !bills::any_overdue(sim.world()),
        "behind on bills ends once nothing is overdue"
    );
    assert!(
        record(&sim).iter().all(|bill| bill.due_day == 14),
        "only the last issued month's paid bills remain"
    );
    sim.admin_undo().expect("undoes");
    assert!(bills::any_overdue(sim.world()));
    assert_eq!(record(&sim).len(), unpaid.len());
}

/// Every kind survives a save, in a world with unpaid and paid bills.
#[test]
fn every_household_edit_kind_moves_the_hash_and_survives_a_save() {
    let mut sim = house();
    for edit in [
        AdminEdit::SetFunds { cents: 987_654 },
        AdminEdit::AdjustFunds { cents: -4_321 },
        set_bill(7, bills::ELECTRICITY, 4_000, 100),
        AdminEdit::MoveBill {
            due_day: 7,
            kind: bills::WATER,
            to_due_day: 0,
        },
        AdminEdit::PayBill {
            due_day: 14,
            kind: bills::RENT,
        },
        AdminEdit::MarkBillPaid {
            due_day: 14,
            kind: bills::WATER,
        },
        AdminEdit::DeleteBill {
            due_day: 14,
            kind: bills::ELECTRICITY,
        },
        add_bill(0, bills::TRANSPORTATION, 2_500, 0),
    ] {
        let what = format!("{edit:?}");
        applied(&mut sim, edit);
        assert_survives_save(&sim, &what);
    }
}

/// [AP-tests-sim] item 2 for these kinds: a refused edit refuses the whole
/// change.
#[test]
fn a_change_with_a_refused_bill_edit_changes_nothing() {
    let mut sim = house();
    let hash = sim.world_hash();
    assert_eq!(
        sim.admin_apply(change(vec![
            AdminEdit::SetFunds { cents: 5 },
            AdminEdit::DeleteBill {
                due_day: 7,
                kind: bills::RENT
            },
            AdminEdit::DeleteBill {
                due_day: 99,
                kind: bills::RENT
            },
        ])),
        Err(crate::admin::AdminApplyRefusal {
            edit: 2,
            reason: AdminRefusal::NotFound
        })
    );
    assert_eq!(sim.world_hash(), hash);
    assert_eq!(sim.admin_undo_depth(), 0);
}

/// [AP-tests-sim] item 9: no household edit draws from a stream, and two
/// worlds given the same changes hash equal.
#[test]
fn household_edits_draw_nothing_and_are_deterministic() {
    let mut a = house();
    let mut b = house();
    let before = streams(&a);
    for edit in [
        AdminEdit::SetFunds { cents: 700_000 },
        AdminEdit::PayBill {
            due_day: 7,
            kind: bills::RENT,
        },
        add_bill(0, bills::WATER, 10, 0),
    ] {
        a.admin_apply(change(vec![edit.clone()])).expect("applies");
        b.admin_apply(change(vec![edit])).expect("applies");
        assert_eq!(streams(&a), before);
    }
    assert_eq!(a.world_hash(), b.world_hash());
}

/// A world with bill edits applied, saved and reloaded, continues
/// identically to the live one for two game days, across a month's end.
#[test]
fn an_edited_world_saved_and_reloaded_continues_identically_for_two_days() {
    let mut live = house();
    for edit in [
        AdminEdit::SetFunds { cents: 3_000_000 },
        set_bill(7, bills::RENT, 9_000, 0),
        AdminEdit::MoveBill {
            due_day: 14,
            kind: bills::WATER,
            to_due_day: 0,
        },
        add_bill(0, bills::TRANSPORTATION, 700, 0),
    ] {
        live.admin_apply(change(vec![edit])).expect("applies");
    }
    let snapshot = live.try_save_snapshot_v28().expect("saves");
    live.end_admin();
    let mut loaded = Sim::new_from_lot_and_content(&pack().lot, Content(pack()));
    loaded.load_snapshot_v28(snapshot).expect("loads");
    assert_eq!(loaded.world_hash(), live.world_hash());
    for tick in 0..2 * 1440 {
        live.tick();
        loaded.tick();
        assert_eq!(live.world_hash(), loaded.world_hash(), "tick {tick}");
    }
}

/// [AP-tests-sim] item 5, the bill case: Undo after paying an older month's
/// bill restores the bill and the funds; every other kind undoes in order.
#[test]
fn undo_takes_back_every_household_edit_exactly() {
    let mut sim = house();
    set_funds(&mut sim, 5_000_000);
    let start = (sim.world_hash(), funds(&sim), record(&sim));
    let mut steps = Vec::new();
    for edit in [
        AdminEdit::PayBill {
            due_day: 7,
            kind: bills::RENT,
        },
        set_bill(14, bills::WATER, 1_234, 0),
        AdminEdit::MoveBill {
            due_day: 14,
            kind: bills::RENT,
            to_due_day: 0,
        },
        AdminEdit::DeleteBill {
            due_day: 7,
            kind: bills::WATER,
        },
        add_bill(7, bills::WATER, 700, 0),
        AdminEdit::MarkBillPaid {
            due_day: 14,
            kind: bills::ELECTRICITY,
        },
        AdminEdit::AdjustFunds { cents: -250 },
    ] {
        steps.push((sim.world_hash(), funds(&sim), record(&sim)));
        applied(&mut sim, edit);
    }
    while let Some(expected) = steps.pop() {
        sim.admin_undo().expect("undoes");
        assert_eq!(
            (sim.world_hash(), funds(&sim), record(&sim)),
            expected,
            "undo to depth {}",
            steps.len()
        );
    }
    assert_eq!((sim.world_hash(), funds(&sim), record(&sim)), start);
}

/// The coordinator's ruling, for edits of the household's money and bills.
#[test]
fn undo_keeps_the_activity_log_of_a_never_undone_twin() {
    assert_undo_keeps_the_activity_log_of_a_twin(
        house,
        vec![
            change(vec![AdminEdit::SetFunds { cents: 123_456 }]),
            change(vec![AdminEdit::PayBill {
                due_day: 7,
                kind: bills::RENT,
            }]),
            change(vec![AdminEdit::MarkBillPaid {
                due_day: 14,
                kind: bills::RENT,
            }]),
        ],
        "household edits",
    );
}
