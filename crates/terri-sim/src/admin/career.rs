//! The Housemate tab's career edits ([AP-e-job] to [AP-e-search]): the job,
//! the shift, the pay, job satisfaction, the good and poor weeks and the job
//! search. A person is named by `SimId` and must be a living member of the
//! household ([`AdminRefusal::NotAPerson`]).
//!
//! A job change and a shift change go through the Career tab's own paths
//! (`careers::install_job`, `careers::leave_job`, `careers::change_held_shift`),
//! so an open scheduled shift settles exactly as the Career tab settles it
//! and a new shift takes effect from the next day. Neither counts a career
//! command, sets the career result or writes the Career tab's log line; the
//! other fields write the person's record directly.
use super::edits::Touched;
use super::housemate::person;
use super::AdminRefusal;
use crate::careers::{self, Careers, Record};
use crate::{attendance, save, Content};
use bevy_ecs::prelude::*;
use terri_core::admin::AdminEdit;
use terri_core::{AtWork, Commuting, SimId};
use terri_data::CompiledCareer;

/// Whether the person is at work or on the way there or back, when a job
/// or shift change is refused as the Career tab refuses it.
fn away(world: &World, entity: Entity) -> bool {
    world.get::<AtWork>(entity).is_some() || world.get::<Commuting>(entity).is_some()
}

/// The level the person holds, or [`AdminRefusal::NotFound`]: without a job
/// there is no shift, pay, satisfaction or weeks to set.
fn held_job(world: &World, entity: Entity) -> Result<&'static CompiledCareer, AdminRefusal> {
    careers::job_of(world, world.resource::<Content>().0, entity).ok_or(AdminRefusal::NotFound)
}

fn at_most(value: u32, top: u32) -> Result<(), AdminRefusal> {
    if value <= top {
        Ok(())
    } else {
        Err(AdminRefusal::OutOfRange)
    }
}

pub(super) fn validate(world: &World, change: &AdminEdit) -> Result<(), AdminRefusal> {
    let pack = world.resource::<Content>().0;
    match *change {
        AdminEdit::SetJob { sim, job, shift } => {
            let entity = person(world, sim)?;
            if away(world, entity) {
                return Err(AdminRefusal::AtWork);
            }
            let offered = match job {
                Some(row) => pack
                    .careers
                    .get(row as usize)
                    .is_some_and(|job| job.offers(shift as usize)),
                // No job holds no shift; the shell sends the standard one.
                None => shift == 0,
            };
            if offered {
                Ok(())
            } else {
                Err(AdminRefusal::UnknownContent)
            }
        }
        AdminEdit::SetShift { sim, shift } => {
            let entity = person(world, sim)?;
            if away(world, entity) {
                return Err(AdminRefusal::AtWork);
            }
            if held_job(world, entity)?.offers(shift as usize) {
                Ok(())
            } else {
                Err(AdminRefusal::UnknownContent)
            }
        }
        AdminEdit::SetPay { sim, dollars } => {
            let job = held_job(world, person(world, sim)?)?;
            if (job.pay..=job.pay_max).contains(&dollars) {
                Ok(())
            } else {
                Err(AdminRefusal::OutOfRange)
            }
        }
        AdminEdit::SetJobSatisfaction { sim, .. } => {
            // Admission has held the value to 0 to 100.
            held_job(world, person(world, sim)?).map(|_| ())
        }
        AdminEdit::SetGoodWeeks { sim, weeks } => {
            let job = held_job(world, person(world, sim)?)?;
            at_most(weeks, job.advance_weeks)
        }
        AdminEdit::SetPoorWeeks { sim, weeks } => {
            held_job(world, person(world, sim)?)?;
            // With no chance of firing no count makes it certain, so there
            // is no range to set within ([AP-e-poor]).
            let top = careers::certain_fire_weeks(&pack.tuning).ok_or(AdminRefusal::OutOfRange)?;
            at_most(weeks, top)
        }
        AdminEdit::SetJobSearch { sim, .. } => person(world, sim).map(|_| ()),
        _ => unreachable!("routed to the career edits by `group`"),
    }
}

/// The person's record, made fresh at their level if they hold none yet (a
/// household worker before their first shift), as a completed shift makes
/// it.
fn record_mut<'w>(world: &'w mut World, sim: u32, entity: Entity) -> Mut<'w, Careers> {
    let job = careers::job_of(world, world.resource::<Content>().0, entity).expect("validated");
    let mut careers = world.resource_mut::<Careers>();
    careers
        .records
        .entry(SimId(sim))
        .or_insert_with(|| Record::new(job));
    careers
}

/// Writes one field of the person's record.
fn set_record(world: &mut World, sim: u32, write: impl FnOnce(&mut Record)) {
    let entity = person(world, sim).expect("validated");
    let mut careers = record_mut(world, sim, entity);
    write(careers.records.get_mut(&SimId(sim)).expect("made above"));
}

pub(super) fn apply(world: &mut World, change: &AdminEdit) {
    match *change {
        AdminEdit::SetJob { sim, job, shift } => {
            let entity = person(world, sim).expect("validated");
            match job {
                Some(row) => careers::install_job(world, entity, row, Some(shift)),
                None => {
                    careers::leave_job(world, entity);
                }
            }
        }
        AdminEdit::SetShift { sim, shift } => {
            let entity = person(world, sim).expect("validated");
            let held = world
                .resource::<Careers>()
                .record(SimId(sim))
                .map_or(0, |record| record.shift);
            // The shift already held: nothing to change, nothing to settle.
            if held != shift {
                // A refusal here comes from a review the settlement ran, which
                // changed the job under the change; the settlement stands, as
                // it does on the Career tab.
                let _ = careers::change_held_shift(world, entity, SimId(sim), shift);
            }
        }
        AdminEdit::SetPay { sim, dollars } => set_record(world, sim, |r| r.pay = dollars),
        AdminEdit::SetJobSatisfaction { sim, value } => {
            set_record(world, sim, |r| r.job_satisfaction = value);
        }
        AdminEdit::SetGoodWeeks { sim, weeks } => {
            set_record(world, sim, |r| r.consecutive_good = weeks);
        }
        AdminEdit::SetPoorWeeks { sim, weeks } => {
            set_record(world, sim, |r| r.consecutive_poor = weeks);
        }
        AdminEdit::SetJobSearch { sim, on } => {
            // The Career tab's own change, without counting a career command.
            world.resource_mut::<Careers>().set_search(SimId(sim), on);
        }
        _ => unreachable!("routed to the career edits by `group`"),
    }
}

/// [AP-cmd-post]: the loader's own checks of careers and attendance, run on
/// the live values when a change touched someone's career: the careers
/// block, the held shifts and the day's shift changes, the score inputs, and
/// the attendance register with the records Go to work replaced.
pub(super) fn post_condition(world: &World, touched: &Touched) -> Result<(), ()> {
    if touched.careers.is_empty() {
        return Ok(());
    }
    let careers = world.resource::<Careers>();
    careers::validate_saved(world, &careers.to_saved()).map_err(|_| ())?;
    careers::validate_live_shifts(world, touched.careers.iter().copied()).map_err(|_| ())?;
    save::v24::validate_live_inputs(world).map_err(|_| ())?;
    attendance::validate_saved(world, &attendance::to_saved(world)).map_err(|_| ())?;
    attendance::validate_replaced(world, &attendance::replaced_to_saved(world)).map_err(|_| ())
}
