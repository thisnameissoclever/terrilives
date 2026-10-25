//! The one-time pay migration of issue 298
//! (`docs/specs/2026-10-18-wages-and-bills.md`, [WB-save] older saves item
//! 1). Every wage in `content/careers.toml` became 1.5 times what it was,
//! rounded half up to the dollar, so a save from schema twenty-one or
//! earlier holds pay the current ranges would refuse. Only the loaders of
//! those schemas select this, through [`super::Carried::wage_migration`],
//! and it changes only pay below the level's new starting pay, which every
//! pay such a save can hold is. A world that already pays the new wages is
//! left alone.
//!
//! The factor is the historical size of the change, not a tunable: a later
//! wage change in content does not repeat it.
use bevy_ecs::prelude::*;
use terri_core::save_v14::SavedCareers;
use terri_core::save_v17::SavedAttendance;
use terri_core::Funds;
use terri_data::CompiledCareer;

use crate::Content;

/// Old whole-dollar pay to new: `pay * 1.5`, rounded half up.
pub(crate) fn raised(pay: u32) -> u32 {
    u32::try_from((u64::from(pay) * 3).div_ceil(2)).unwrap_or(u32::MAX)
}

/// The raised pay at `job` of a pay below its starting pay, when the old
/// range could have held it: raised, it lands in the job's new range. For
/// every shipped level that is exactly the pay of the level's old range. A
/// pay that does not land there was no valid pay before the raise either,
/// and is left for the validator to refuse.
fn migrated(pay: u32, job: &CompiledCareer) -> Option<u32> {
    let raised = raised(pay);
    (pay < job.pay && (job.pay..=job.pay_max).contains(&raised)).then_some(raised)
}

/// Raises every saved career record whose pay is below the starting pay of
/// the level its person holds in the restored world and lands in its range
/// when raised. A record the world cannot place, or a pay no old range
/// held, is left for the careers validator to refuse.
pub(crate) fn migrate_careers(world: &World, careers: &mut SavedCareers) {
    let pack = world.resource::<Content>().0;
    for record in &mut careers.records {
        let Some(job) = crate::edit::living_entity(world, record.sim)
            .and_then(|entity| crate::careers::job_of(world, pack, entity))
        else {
            continue;
        };
        if let Some(pay) = migrated(record.pay, job) {
            record.pay = pay;
        }
    }
}

/// Raises every open scheduled shift whose pay is below its row's starting
/// pay: to the person's migrated record pay, or the shift's own whole
/// dollars raised when the person has no record and they land in the row's
/// range. A migrated night shift does not
/// gain the premium; the next shift registered does. Settled records keep
/// the pay they were settled at, which their outcome must match.
pub(crate) fn migrate_attendance(
    world: &World,
    attendance: &mut SavedAttendance,
    careers: &SavedCareers,
) {
    let pack = world.resource::<Content>().0;
    for shift in attendance.shifts.iter_mut().filter(|shift| !shift.settled) {
        let Some(job) = pack.careers.get(shift.career as usize) else {
            continue;
        };
        if shift.pay_cents >= i64::from(job.pay) * Funds::CENTS_PER_DOLLAR {
            continue;
        }
        let record = careers
            .records
            .iter()
            .find(|record| record.sim == shift.sim)
            .map(|record| record.pay)
            .filter(|pay| (job.pay..=job.pay_max).contains(pay));
        let own = (shift.pay_cents >= 0 && shift.pay_cents % Funds::CENTS_PER_DOLLAR == 0)
            .then(|| u32::try_from(shift.pay_cents / Funds::CENTS_PER_DOLLAR).ok())
            .flatten()
            .and_then(|dollars| migrated(dollars, job));
        if let Some(pay) = record.or(own) {
            shift.pay_cents = i64::from(pay) * Funds::CENTS_PER_DOLLAR;
        }
    }
}
