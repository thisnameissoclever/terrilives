//! The Household tab's edits ([AP-e-house]): the funds and the bills. A bill
//! is named by its due day and kind. An unpaid bill can be edited, moved,
//! paid or marked paid; a paid one can only be deleted. The record keeps the
//! rules the loader checks (`bills::validate_saved`): ascending by due day
//! then kind, due on a month start at or before today, a late fee only after
//! the grace, and paid bills only from the last issued month.
use super::edits::Touched;
use super::AdminRefusal;
use crate::bills::{self, Bill, BillTerms, Bills};
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::admin::{AdminEdit, MAX_ADMIN_FUNDS_CENTS};
use terri_core::{Funds, SimClock};

fn today(world: &World) -> u32 {
    bills::day_index(
        world.resource::<SimClock>().tick,
        world.resource::<Content>().0.tuning.day_ticks,
    )
}

fn find(world: &World, due_day: u32, kind: u8) -> Option<Bill> {
    world
        .get_resource::<Bills>()?
        .bills
        .iter()
        .find(|bill| bill.due_day == due_day && bill.kind == kind)
        .copied()
}

/// The unpaid bill with this key: refused as not found, or as paid.
fn unpaid(world: &World, due_day: u32, kind: u8) -> Result<Bill, AdminRefusal> {
    let bill = find(world, due_day, kind).ok_or(AdminRefusal::NotFound)?;
    if bill.paid_day.is_some() {
        Err(AdminRefusal::BillPaid)
    } else {
        Ok(bill)
    }
}

/// A late fee the bill may hold today: none before its grace has passed, and
/// never more than its cap.
fn fee_allowed(bill: &Bill, fee_cents: i64, today: u32) -> Result<(), AdminRefusal> {
    if fee_cents > 0 && today < bill.overdue_from() {
        Err(AdminRefusal::LateFeeTooEarly)
    } else if fee_cents > bills::late_fee_cap(bill) {
        Err(AdminRefusal::LateFeeTooHigh)
    } else {
        Ok(())
    }
}

/// A due day a bill can have: a month start under the bill's own month
/// length, at most today. Bills are issued on that day, so a later one would
/// collide with the bill the game issues then ([AP-c-future]).
fn due_day_allowed(due_day: u32, terms: &BillTerms, today: u32) -> Result<(), AdminRefusal> {
    if due_day > today || !bills::is_month_start(due_day, terms.month_length) {
        Err(AdminRefusal::BadDueDay)
    } else {
        Ok(())
    }
}

pub(super) fn validate(world: &World, change: &AdminEdit) -> Result<(), AdminRefusal> {
    let today = today(world);
    match *change {
        AdminEdit::SetFunds { .. } => Ok(()),
        AdminEdit::AdjustFunds { cents } => world
            .resource::<Funds>()
            .0
            .checked_add(cents)
            .filter(|funds| funds.abs() <= MAX_ADMIN_FUNDS_CENTS)
            .map(|_| ())
            .ok_or(AdminRefusal::OutOfRange),
        AdminEdit::SetBill {
            due_day,
            kind,
            amount_cents,
            late_fee_cents,
        } => {
            let bill = unpaid(world, due_day, kind)?;
            let resized = Bill {
                amount_cents,
                ..bill
            };
            fee_allowed(&resized, late_fee_cents, today)
        }
        AdminEdit::MoveBill {
            due_day,
            kind,
            to_due_day,
        } => {
            let bill = unpaid(world, due_day, kind)?;
            due_day_allowed(to_due_day, &bill.terms, today)?;
            if find(world, to_due_day, kind).is_some() {
                return Err(AdminRefusal::BillExists);
            }
            Ok(())
        }
        AdminEdit::PayBill { due_day, kind } => {
            let bill = unpaid(world, due_day, kind)?;
            if world.resource::<Funds>().0 < bill.total_cents() {
                Err(AdminRefusal::CannotAfford)
            } else {
                Ok(())
            }
        }
        AdminEdit::MarkBillPaid { due_day, kind } => unpaid(world, due_day, kind).map(|_| ()),
        AdminEdit::DeleteBill { due_day, kind } => find(world, due_day, kind)
            .map(|_| ())
            .ok_or(AdminRefusal::NotFound),
        AdminEdit::AddBill {
            due_day,
            kind,
            amount_cents,
            late_fee_cents,
        } => {
            // Issued under the terms in force now, as the game issues one.
            let terms = BillTerms::of(&world.resource::<Content>().0.bills);
            due_day_allowed(due_day, &terms, today)?;
            if find(world, due_day, kind).is_some() {
                return Err(AdminRefusal::BillExists);
            }
            let new = Bill {
                due_day,
                kind,
                amount_cents,
                late_fee_cents: 0,
                paid_day: None,
                terms,
            };
            fee_allowed(&new, late_fee_cents, today)
        }
        _ => unreachable!("routed to the household edits by `group`"),
    }
}

pub(super) fn apply(world: &mut World, change: &AdminEdit) {
    let today = today(world);
    match *change {
        AdminEdit::SetFunds { cents } => world.resource_mut::<Funds>().0 = cents,
        AdminEdit::AdjustFunds { cents } => world.resource_mut::<Funds>().0 += cents,
        AdminEdit::SetBill {
            due_day,
            kind,
            amount_cents,
            late_fee_cents,
        } => {
            let mut record = world.resource_mut::<Bills>();
            let bill = bill_mut(&mut record, due_day, kind);
            bill.amount_cents = amount_cents;
            bill.late_fee_cents = late_fee_cents;
        }
        AdminEdit::MoveBill {
            due_day,
            kind,
            to_due_day,
        } => {
            let mut record = world.resource_mut::<Bills>();
            let at = record
                .bills
                .iter()
                .position(|bill| bill.due_day == due_day && bill.kind == kind)
                .expect("validated");
            let mut bill = record.bills.remove(at);
            bill.due_day = to_due_day;
            // A fee a bill cannot hold before its new grace has passed goes
            // with the move, so the record keeps the loader's fee rule.
            if today < bill.overdue_from() {
                bill.late_fee_cents = 0;
            }
            bills::insert_sorted(&mut record.bills, bill);
            bills::retain_last_issued_paid(&mut record.bills);
        }
        AdminEdit::PayBill { due_day, kind } => {
            let total = bill_mut(&mut world.resource_mut::<Bills>(), due_day, kind).total_cents();
            world.resource_mut::<Funds>().0 -= total;
            mark_paid(world, due_day, kind, today);
        }
        AdminEdit::MarkBillPaid { due_day, kind } => mark_paid(world, due_day, kind, today),
        AdminEdit::DeleteBill { due_day, kind } => {
            // An earlier edit of the change can have dropped a paid bill
            // from the record already, so a missing bill is not an error.
            let mut record = world.resource_mut::<Bills>();
            record
                .bills
                .retain(|bill| !(bill.due_day == due_day && bill.kind == kind));
            bills::retain_last_issued_paid(&mut record.bills);
        }
        AdminEdit::AddBill {
            due_day,
            kind,
            amount_cents,
            late_fee_cents,
        } => {
            let terms = BillTerms::of(&world.resource::<Content>().0.bills);
            let mut record = world.get_resource_or_insert_with(Bills::default);
            bills::insert_sorted(
                &mut record.bills,
                Bill {
                    due_day,
                    kind,
                    amount_cents,
                    late_fee_cents,
                    paid_day: None,
                    terms,
                },
            );
            bills::retain_last_issued_paid(&mut record.bills);
        }
        _ => unreachable!("routed to the household edits by `group`"),
    }
}

fn bill_mut(record: &mut Bills, due_day: u32, kind: u8) -> &mut Bill {
    record
        .bills
        .iter_mut()
        .find(|bill| bill.due_day == due_day && bill.kind == kind)
        .expect("validated")
}

/// Pays the bill today, then drops what the record does not keep: only the
/// last issued month's paid bills, as paying from funds does.
fn mark_paid(world: &mut World, due_day: u32, kind: u8, today: u32) {
    let mut record = world.resource_mut::<Bills>();
    bill_mut(&mut record, due_day, kind).paid_day = Some(today);
    bills::retain_last_issued_paid(&mut record.bills);
}

/// [AP-cmd-post]: the funds within the bound, and the bills as the loader
/// checks them.
pub(super) fn post_condition(world: &World, touched: &Touched) -> Result<(), ()> {
    if touched.funds && world.resource::<Funds>().0.abs() > MAX_ADMIN_FUNDS_CENTS {
        return Err(());
    }
    if touched.bills {
        bills::validate_saved(world, &bills::saved(world)).map_err(|_| ())?;
    }
    Ok(())
}
