//! The Career tab's score inputs and a queued Go to work extend schema
//! twenty-three into schema twenty-four: issues 311 and 317
//! (`docs/specs/2026-11-19-career-tab.md`, [CT-save]).
use std::collections::{BTreeMap, VecDeque};

use super::SaveError;
use crate::careers::{Careers, Record, ShiftInputs, ShiftSource, WeekInputs};
use crate::{Content, Sim};
use terri_core::save_v24::{
    SavedCareerInputs, SavedQueuedWorkCommand, SavedShiftInputs, SavedWeekInputs,
};
use terri_core::save_v26::{
    SavedCareerInputSources, SavedShiftSourceOverride, SavedSourcedCurrentInputs,
    SavedSourcedWeekInputs,
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
                    current: if record.current_input_sources.is_empty() {
                        record.shift_inputs.iter().map(saved_shift).collect()
                    } else {
                        Vec::new()
                    },
                    last_shift: record.last_shift.as_ref().map(saved_shift),
                    weeks: record.input_weeks.iter()
                        .filter(|week| !record.reviewed_input_sources.contains_key(&week.week))
                        .map(saved_week)
                        .collect(),
                })
                .collect()
        })
}

fn source_rows(sources: &BTreeMap<u32, ShiftSource>) -> Vec<SavedShiftSourceOverride> {
    sources.iter().map(|(&input_index, source)| SavedShiftSourceOverride {
        input_index,
        career: source.career,
        base_pay: source.base_pay,
    }).collect()
}

pub(crate) fn capture_sources(world: &bevy_ecs::world::World) -> Vec<SavedCareerInputSources> {
    let Some(careers) = world.get_resource::<Careers>() else {
        return Vec::new();
    };
    careers.records.iter().filter_map(|(sim, record)| {
        let current = (!record.current_input_sources.is_empty()).then(|| SavedSourcedCurrentInputs {
            inputs: record.shift_inputs.iter().map(saved_shift).collect(),
            sources: source_rows(&record.current_input_sources),
        });
        let weeks: Vec<_> = record.input_weeks.iter().filter_map(|week| {
            let sources = record.reviewed_input_sources.get(&week.week)?;
            Some(SavedSourcedWeekInputs { inputs: saved_week(week), sources: source_rows(sources) })
        }).collect();
        (current.is_some() || !weeks.is_empty()).then_some(SavedCareerInputSources {
            sim: sim.0,
            current,
            weeks,
        })
    }).collect()
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

fn valid_sources(
    pack: &ContentPack,
    rows: &[SavedShiftSourceOverride],
    count: usize,
    default: ShiftSource,
) -> Result<BTreeMap<u32, ShiftSource>, SaveError> {
    if rows.is_empty() || rows.len() > count
        || rows.windows(2).any(|pair| pair[0].input_index >= pair[1].input_index)
    {
        return Err(SaveError::InvalidValue);
    }
    rows.iter().map(|row| {
        let source = ShiftSource { career: row.career, base_pay: row.base_pay };
        let job = pack.careers.get(source.career as usize).ok_or(SaveError::InvalidValue)?;
        if row.input_index as usize >= count
            || source == default
            || source.base_pay.is_some_and(|pay| !(job.pay..=job.pay_max).contains(&pay))
        {
            return Err(SaveError::InvalidValue);
        }
        Ok((row.input_index, source))
    }).collect()
}

/// Compare means and sums using the source for each shift and the same
/// ordered f32 accumulation used by review.
fn valid_week(
    pack: &ContentPack,
    week: &SavedWeekInputs,
    sources: &BTreeMap<u32, ShiftSource>,
) -> bool {
    let Some(job) = pack.careers.get(week.career as usize) else {
        return false;
    };
    if !(1..=MAX_SHIFTS_IN_A_WEEK).contains(&week.shifts)
        || week.attended > week.shifts
        || !(job.pay..=job.pay_max).contains(&week.pay)
    {
        return false;
    }
    let count = week.shifts;
    let mut trait_min = 0.0_f32;
    let mut trait_max = 0.0_f32;
    let mut missed_max = 0.0_f32;
    for index in 0..count {
        let source_job = sources.get(&index).map_or(job, |source| &pack.careers[source.career as usize]);
        let bounds = ShiftBounds::of(source_job);
        trait_min += bounds.trait_fit.low;
        trait_max += bounds.trait_fit.high;
        missed_max += bounds.missed_minutes.high;
    }
    let trait_bounds = Bounds { low: trait_min / count as f32, high: trait_max / count as f32 };
    Bounds::SIGNED_UNIT.mean_of(count).holds(week.fit)
        && Bounds::SIGNED_UNIT.mean_of(count).holds(week.mood)
        && Bounds::UNIT.mean_of(count).holds(week.social_capacity)
        && Bounds::UNIT.mean_of(count).holds(week.mastery)
        && trait_bounds.holds(week.trait_fit)
        && (Bounds { low: 0.0, high: missed_max }).holds(week.missed_minutes)
}

fn validated(
    world: &bevy_ecs::world::World,
    rows: &[SavedCareerInputs],
    sourced: &[SavedCareerInputSources],
    pack: &ContentPack,
) -> Result<Vec<(SimId, Record)>, SaveError> {
    use SaveError::InvalidValue;
    if rows.len() > super::MAX_LIST_ENTRIES
        || sourced.len() > super::MAX_LIST_ENTRIES
        || rows.windows(2).any(|pair| pair[0].sim >= pair[1].sim)
        || sourced.windows(2).any(|pair| pair[0].sim >= pair[1].sim)
    {
        return Err(InvalidValue);
    }
    let mut by_sim: BTreeMap<_, _> = rows.iter().map(|row| (row.sim, (Some(row), None))).collect();
    for row in sourced {
        if row.current.is_none() && row.weeks.is_empty() {
            return Err(InvalidValue);
        }
        by_sim.entry(row.sim).or_default().1 = Some(row);
    }
    if by_sim.len() > super::MAX_LIST_ENTRIES {
        return Err(InvalidValue);
    }

    let careers = world.resource::<Careers>();
    let all_jobs = ShiftBounds::any(pack);
    let mut installed = Vec::with_capacity(by_sim.len());
    for (person, (ordinary, sourced)) in by_sim {
        let id = SimId(person);
        let record = careers.record(id).ok_or(InvalidValue)?;
        let entity = crate::edit::living_entity(world, person).ok_or(InvalidValue)?;
        let career = world.get::<terri_core::Career>(entity).ok_or(InvalidValue)?.0;
        let job = pack.careers.get(career as usize).ok_or(InvalidValue)?;
        let default = ShiftSource { career, base_pay: Some(record.pay) };

        let ordinary_current = ordinary.map_or(&[][..], |row| row.current.as_slice());
        let (current, current_sources) = if let Some(row) = sourced.and_then(|row| row.current.as_ref()) {
            if !ordinary_current.is_empty() || row.inputs.len() > record.shifts.len() {
                return Err(InvalidValue);
            }
            (row.inputs.as_slice(), valid_sources(pack, &row.sources, row.inputs.len(), default)?)
        } else {
            (ordinary_current, BTreeMap::new())
        };
        let default_bounds = ShiftBounds::of(job);
        let last = ordinary.and_then(|row| row.last_shift.as_ref());
        if current.len() > record.shifts.len()
            || !current.iter().enumerate().all(|(index, inputs)| {
                current_sources.get(&(index as u32)).map_or_else(
                    || default_bounds.hold(inputs),
                    |source| ShiftBounds::of(&pack.careers[source.career as usize]).hold(inputs),
                )
            })
            || !last.is_none_or(|inputs| all_jobs.hold(inputs))
        {
            return Err(InvalidValue);
        }

        let ordinary_weeks = ordinary.map_or(&[][..], |row| row.weeks.as_slice());
        let sourced_weeks = sourced.map_or(&[][..], |row| row.weeks.as_slice());
        let count = ordinary_weeks.len().saturating_add(sourced_weeks.len());
        if count > Tuning::MAX_CAREER_INPUT_HISTORY_WEEKS as usize
            || ordinary_weeks.windows(2).any(|pair| pair[0].week >= pair[1].week)
            || sourced_weeks.windows(2).any(|pair| pair[0].inputs.week >= pair[1].inputs.week)
        {
            return Err(InvalidValue);
        }
        let mut weeks: BTreeMap<_, _> = ordinary_weeks.iter()
            .map(|row| (row.week, (row, BTreeMap::new())))
            .collect();
        for row in sourced_weeks {
            let inputs = &row.inputs;
            let default = ShiftSource { career: inputs.career, base_pay: Some(inputs.pay) };
            let sources = valid_sources(pack, &row.sources, inputs.shifts as usize, default)?;
            if weeks.insert(inputs.week, (inputs, sources)).is_some() {
                return Err(InvalidValue);
            }
        }
        if !weeks.values().all(|(row, sources)| {
            record.history.binary_search_by_key(&row.week, |week| week.week).is_ok()
                && valid_week(pack, row, sources)
        }) {
            return Err(InvalidValue);
        }

        let keep = pack.tuning.career_input_history_weeks as usize;
        let mut record = record.clone();
        record.shift_inputs = current.iter().map(live_shift).collect();
        record.current_input_sources = current_sources;
        record.last_shift = last.map(live_shift);
        record.input_weeks = VecDeque::new();
        record.reviewed_input_sources = BTreeMap::new();
        for (week, (row, sources)) in weeks.into_iter().skip(count.saturating_sub(keep)) {
            record.input_weeks.push_back(live_week(row));
            if !sources.is_empty() {
                record.reviewed_input_sources.insert(week, sources);
            }
        }
        installed.push((id, record));
    }
    Ok(installed)
}

/// [AP-cmd-post]: the live career inputs pass the checks a load makes of
/// the rows a save would write for them.
pub(crate) fn validate_live_inputs(world: &bevy_ecs::world::World) -> Result<(), SaveError> {
    let pack = world.resource::<Content>().0;
    validated(world, &rows(world), &capture_sources(world), pack).map(|_| ())
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
    restore_with_sources(snapshot, content, carried, Vec::new())
}

pub(crate) fn restore_with_sources(
    snapshot: SaveSnapshotV24,
    content: &'static ContentPack,
    mut carried: super::Carried,
    sourced: Vec<SavedCareerInputSources>,
) -> Result<Sim, SaveError> {
    carried.pre_registered_shifts = true;
    let mut candidate = super::v23::restore(snapshot.legacy, content, carried)?;
    let pack = candidate.world().resource::<Content>().0;
    let records = validated(candidate.world(), &snapshot.career_inputs, &sourced, pack)?;
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
