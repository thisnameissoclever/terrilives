//! The Career tab's score inputs and a queued Go to work extend schema
//! twenty-three into schema twenty-four: issues 311 and 317
//! (`docs/specs/2026-11-19-career-tab.md`, [CT-save]).
use std::collections::VecDeque;

use super::SaveError;
use crate::careers::{Careers, Record, ShiftInputs, WeekInputs};
use crate::{Content, Sim};
use terri_core::save_v24::{
    SavedCareerInputs, SavedQueuedWorkCommand, SavedShiftInputs, SavedWeekInputs,
};
use terri_core::{CommandQueue, SaveSnapshotV24, SimCommand, SimId};
use terri_data::{CompiledCareer, ContentPack, Tuning};

/// The most scored shifts one reviewed week can hold ([CT-save-load] item
/// 4): two for each of a week's seven days, which leaves room for a review
/// deferred while the person was away from home.
pub(crate) const MAX_SHIFTS_IN_A_WEEK: u32 = 2 * terri_core::clock::WEEKDAY_COUNT as u32;

fn saved_shift(inputs: &ShiftInputs) -> SavedShiftInputs {
    SavedShiftInputs {
        fit: inputs.fit,
        trait_fit: inputs.trait_fit,
        social_capacity: inputs.social_capacity,
        mastery: inputs.mastery,
        mood: inputs.mood,
        missed_minutes: inputs.missed_minutes,
        attended: inputs.attended,
    }
}

fn live_shift(saved: &SavedShiftInputs) -> ShiftInputs {
    ShiftInputs {
        fit: saved.fit,
        trait_fit: saved.trait_fit,
        social_capacity: saved.social_capacity,
        mastery: saved.mastery,
        mood: saved.mood,
        missed_minutes: saved.missed_minutes,
        attended: saved.attended,
    }
}

fn saved_week(week: &WeekInputs) -> SavedWeekInputs {
    SavedWeekInputs {
        week: week.week,
        career: week.career,
        shifts: week.shifts,
        attended: week.attended,
        fit: week.fit,
        trait_fit: week.trait_fit,
        social_capacity: week.social_capacity,
        mastery: week.mastery,
        mood: week.mood,
        missed_minutes: week.missed_minutes,
        pay: week.pay,
    }
}

fn live_week(saved: &SavedWeekInputs) -> WeekInputs {
    WeekInputs {
        week: saved.week,
        career: saved.career,
        shifts: saved.shifts,
        attended: saved.attended,
        fit: saved.fit,
        trait_fit: saved.trait_fit,
        social_capacity: saved.social_capacity,
        mastery: saved.mastery,
        mood: saved.mood,
        missed_minutes: saved.missed_minutes,
        pay: saved.pay,
    }
}

/// Whether a record holds any input data, and so is written.
fn holds_inputs(record: &Record) -> bool {
    !record.shift_inputs.is_empty() || record.last_shift.is_some() || !record.input_weeks.is_empty()
}

/// Every record holding input data, ascending by person.
fn rows(world: &bevy_ecs::world::World) -> Vec<SavedCareerInputs> {
    world
        .get_resource::<Careers>()
        .map_or_else(Vec::new, |careers| {
            careers
                .records
                .iter()
                .filter(|(_, record)| holds_inputs(record))
                .map(|(sim, record)| SavedCareerInputs {
                    sim: sim.0,
                    current: record.shift_inputs.iter().map(saved_shift).collect(),
                    last_shift: record.last_shift.as_ref().map(saved_shift),
                    weeks: record.input_weeks.iter().map(saved_week).collect(),
                })
                .collect()
        })
}

/// Each queued Go to work with its position in the whole command queue.
fn queued_work_commands(sim: &Sim) -> Vec<(u32, SavedQueuedWorkCommand)> {
    sim.world()
        .resource::<CommandQueue>()
        .as_slice()
        .iter()
        .enumerate()
        .filter_map(|(position, command)| match *command {
            SimCommand::GoToWork { agent } => {
                Some((position as u32, SavedQueuedWorkCommand::GoToWork { agent }))
            }
            _ => None,
        })
        .collect()
}

fn live_command(command: SavedQueuedWorkCommand) -> SimCommand {
    match command {
        SavedQueuedWorkCommand::GoToWork { agent } => SimCommand::GoToWork { agent },
    }
}

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV24 {
    SaveSnapshotV24 {
        legacy: super::v23::capture(sim),
        career_inputs: rows(sim.world()),
        queued_work_commands: queued_work_commands(sim),
        replaced_shifts: crate::attendance::replaced_to_saved(sim.world()),
    }
}

/// Capture a transaction baseline while leaving the live input queue intact.
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV24 {
    SaveSnapshotV24 {
        legacy: super::v23::capture_without_commands(sim),
        career_inputs: rows(sim.world()),
        queued_work_commands: Vec::new(),
        replaced_shifts: crate::attendance::replaced_to_saved(sim.world()),
    }
}

/// The inclusive range one value read at a shift may take.
#[derive(Clone, Copy)]
struct Bounds {
    low: f32,
    high: f32,
}

impl Bounds {
    const SIGNED_UNIT: Self = Self {
        low: -1.0,
        high: 1.0,
    };
    const UNIT: Self = Self {
        low: 0.0,
        high: 1.0,
    };

    fn holds(self, value: f32) -> bool {
        value.is_finite() && (self.low..=self.high).contains(&value)
    }

    /// The range of the mean of `count` values each inside `self`, computed
    /// as a week's row computes its means: summed in order in `f32` and
    /// divided by the count. Rounding is monotone, so the mean of values
    /// inside the range never leaves the mean of its ends.
    fn mean_of(self, count: u32) -> Self {
        Self {
            low: repeated_sum(self.low, count) / count as f32,
            high: repeated_sum(self.high, count) / count as f32,
        }
    }

    /// The range of the sum of `count` values each inside `self`, summed in
    /// order in `f32`.
    fn sum_of(self, count: u32) -> Self {
        Self {
            low: repeated_sum(self.low, count),
            high: repeated_sum(self.high, count),
        }
    }
}

fn repeated_sum(value: f32, count: u32) -> f32 {
    (0..count).fold(0.0, |sum, _| sum + value)
}

/// What one shift's inputs may hold for a holder of any of `rows`: the
/// widest trait fit and the longest listed shift among them.
struct ShiftBounds {
    trait_fit: Bounds,
    missed_minutes: Bounds,
}

impl ShiftBounds {
    /// A row's trait fit lies between the sum of its negative weights and
    /// the sum of its positive weights, each summed in the order
    /// `careers::trait_fit` sums them; its missed minutes from none to its
    /// longest listed shift.
    fn of(row: &CompiledCareer) -> Self {
        let (low, high) = row
            .trait_fit
            .iter()
            .fold((0.0_f32, 0.0_f32), |(low, high), (_, weight)| {
                (low + weight.min(0.0), high + weight.max(0.0))
            });
        let longest = (0..row.shift_count())
            .filter_map(|index| row.shift(index))
            .map(|shift| shift.shift_ticks)
            .max()
            .unwrap_or(row.shift_ticks);
        Self {
            trait_fit: Bounds { low, high },
            missed_minutes: Bounds {
                low: 0.0,
                high: longest as f32,
            },
        }
    }

    /// The widest bounds over every row: a person's last shift is kept
    /// across a promotion or a path change, so it may have been read under
    /// any of them.
    fn any(pack: &ContentPack) -> Self {
        pack.careers.iter().map(Self::of).fold(
            Self {
                trait_fit: Bounds {
                    low: 0.0,
                    high: 0.0,
                },
                missed_minutes: Bounds {
                    low: 0.0,
                    high: 0.0,
                },
            },
            |wide, row| Self {
                trait_fit: Bounds {
                    low: wide.trait_fit.low.min(row.trait_fit.low),
                    high: wide.trait_fit.high.max(row.trait_fit.high),
                },
                missed_minutes: Bounds {
                    low: 0.0,
                    high: wide.missed_minutes.high.max(row.missed_minutes.high),
                },
            },
        )
    }

    fn hold(&self, inputs: &SavedShiftInputs) -> bool {
        Bounds::SIGNED_UNIT.holds(inputs.fit)
            && Bounds::SIGNED_UNIT.holds(inputs.mood)
            && Bounds::UNIT.holds(inputs.social_capacity)
            && Bounds::UNIT.holds(inputs.mastery)
            && self.trait_fit.holds(inputs.trait_fit)
            && self.missed_minutes.holds(inputs.missed_minutes)
    }
}

/// [CT-save-load] item 4: a reviewed week names a known career row, holds
/// from one to [`MAX_SHIFTS_IN_A_WEEK`] shifts with no more attended, pay
/// inside the row's range, and means and a sum that values inside the
/// row's ranges can make.
fn valid_week(pack: &ContentPack, week: &SavedWeekInputs) -> bool {
    let Some(row) = pack.careers.get(week.career as usize) else {
        return false;
    };
    if !(1..=MAX_SHIFTS_IN_A_WEEK).contains(&week.shifts)
        || week.attended > week.shifts
        || !(row.pay..=row.pay_max).contains(&week.pay)
    {
        return false;
    }
    let shift = ShiftBounds::of(row);
    let count = week.shifts;
    Bounds::SIGNED_UNIT.mean_of(count).holds(week.fit)
        && Bounds::SIGNED_UNIT.mean_of(count).holds(week.mood)
        && Bounds::UNIT.mean_of(count).holds(week.social_capacity)
        && Bounds::UNIT.mean_of(count).holds(week.mastery)
        && shift.trait_fit.mean_of(count).holds(week.trait_fit)
        && shift
            .missed_minutes
            .sum_of(count)
            .holds(week.missed_minutes)
}

/// Validates every row against the careers the older envelope restored
/// and returns each person's inputs, the weeks trimmed to the newest
/// `career_input_history_weeks` ([CT-save-load]).
fn validated(
    world: &bevy_ecs::world::World,
    rows: &[SavedCareerInputs],
    pack: &ContentPack,
    tuning: &Tuning,
) -> Result<Vec<(SimId, Record)>, SaveError> {
    use SaveError::InvalidValue;
    let careers = world.resource::<Careers>();
    let any = ShiftBounds::any(pack);
    let mut installed = Vec::with_capacity(rows.len());
    for row in rows {
        let id = SimId(row.sim);
        // Item 1: a career record to hold the inputs.
        let record = careers.record(id).ok_or(InvalidValue)?;
        let entity = crate::edit::living_entity(world, row.sim).ok_or(InvalidValue)?;
        let job = crate::careers::job_of(world, pack, entity).ok_or(InvalidValue)?;
        let current = ShiftBounds::of(job);
        // Item 2: no more current inputs than the week's scores.
        if row.current.len() > record.shifts.len()
            || !row.current.iter().all(|inputs| current.hold(inputs))
            || !row
                .last_shift
                .as_ref()
                .is_none_or(|inputs| any.hold(inputs))
        {
            return Err(InvalidValue);
        }
        // Item 3: reviewed weeks, ascending, at most the knob's maximum.
        if row.weeks.len() > Tuning::MAX_CAREER_INPUT_HISTORY_WEEKS as usize
            || row
                .weeks
                .windows(2)
                .any(|pair| pair[0].week >= pair[1].week)
            || !row.weeks.iter().all(|week| {
                record
                    .history
                    .iter()
                    .any(|reviewed| reviewed.week == week.week)
                    && valid_week(pack, week)
            })
        {
            return Err(InvalidValue);
        }
        let keep = tuning.career_input_history_weeks as usize;
        let skip = row.weeks.len().saturating_sub(keep);
        let mut record = record.clone();
        record.shift_inputs = row.current.iter().map(live_shift).collect();
        record.last_shift = row.last_shift.as_ref().map(live_shift);
        record.input_weeks = row.weeks[skip..]
            .iter()
            .map(live_week)
            .collect::<VecDeque<_>>();
        installed.push((id, record));
    }
    Ok(installed)
}

/// [AP-cmd-post]: the live career inputs pass the checks a load makes of
/// the rows a save would write for them.
pub(crate) fn validate_live_inputs(world: &bevy_ecs::world::World) -> Result<(), SaveError> {
    let pack = world.resource::<Content>().0;
    validated(world, &rows(world), pack, &pack.tuning).map(|_| ())
}

/// The schema-twenty-three part restores first, so each row can be checked
/// against the restored careers; any bad row refuses the whole save before
/// the live world is touched. The queued Go to work commands then return
/// to their positions among the commands it restored. A save holding more
/// weeks than the current knob keeps keeps the newest ones. Each replaced
/// attendance record is checked against the restored register and its
/// outcomes before it is kept ([CT-work-guards] item 2).
pub(crate) fn restore(
    snapshot: SaveSnapshotV24,
    content: &'static ContentPack,
    carried: super::Carried,
) -> Result<Sim, SaveError> {
    let rows = snapshot.career_inputs;
    if rows.len() > super::MAX_LIST_ENTRIES
        || rows.windows(2).any(|pair| pair[0].sim >= pair[1].sim)
    {
        return Err(SaveError::InvalidValue);
    }
    let mut candidate = super::v23::restore(snapshot.legacy, content, carried)?;
    let pack = candidate.world().resource::<Content>().0;
    let records = validated(candidate.world(), &rows, pack, &pack.tuning)?;
    crate::attendance::validate_replaced(candidate.world(), &snapshot.replaced_shifts)?;
    crate::attendance::restore_replaced(candidate.world_mut(), snapshot.replaced_shifts);
    {
        let mut careers = candidate.world_mut().resource_mut::<Careers>();
        for (id, record) in records {
            careers.records.insert(id, record);
        }
    }
    super::v18::place_by_position(
        &mut candidate,
        snapshot
            .queued_work_commands
            .into_iter()
            .map(|(position, command)| (position, live_command(command)))
            .collect(),
        content,
    )?;
    Ok(candidate)
}

#[cfg(test)]
#[path = "v24_tests.rs"]
mod tests;
