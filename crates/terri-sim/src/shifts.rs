//! Shifts - issue 296 (`docs/specs/2026-10-18-shifts-and-careers.md`). A
//! person holds one shift of their level, by index into the level's
//! shifts: 0 is the level's own standard shift. A hire draws it from the
//! level's weights on the shift stream, which nothing else draws, so a
//! player's shift choices never move a later search or review; a level
//! change keeps it when the new level offers it. Every reader of a job's
//! hours asks [`shift_of`].
use bevy_ecs::prelude::*;
use bevy_ecs::system::SystemParam;
use terri_core::{Career, SimId};
use terri_data::{CompiledCareer, ContentPack, ShiftView, Tuning};

use crate::careers::{job_of, Careers, Record};
use crate::Content;

/// The seed the shift stream starts from in a new game and in a save from
/// before shifts.
pub const SHIFTS_SEED: u64 = 0x5348_4946_5453_3031;

/// The shift a hire at `job` takes ([WS-choose] steps 4 and 5): with one
/// shift offered, that shift and no draw; otherwise one `range(total)` on
/// the shift stream over the offered shifts' weights, standard first, and
/// the first shift whose running sum of weights exceeds the draw.
pub fn draw(careers: &mut Careers, job: &CompiledCareer) -> u32 {
    let offered = offered(job);
    let Some(first) = offered.first() else {
        // The compiler refuses a level that offers nothing; a hand-built
        // one holds its standard shift.
        return 0;
    };
    if offered.len() == 1 {
        return first.index as u32;
    }
    let total: u32 = offered.iter().map(|shift| shift.weight).sum();
    careers.shift_draws += 1;
    let draw = careers.shift_rng.range(total as usize) as u32;
    let mut running = 0;
    let mut chosen = first.index;
    for shift in &offered {
        chosen = shift.index;
        running += shift.weight;
        if draw < running {
            break;
        }
    }
    chosen as u32
}

/// Whether `shift`, worked by `sim` at career row `career`, starts at tick
/// `now`: its start time of day on a day it works, and one paid shift a day
/// (the owner's rulings of 2026-10-24 in [WS-rulings]). No shift starts on
/// a day another shift of the person's already started, and none starts on
/// the day their last shift ended unless it repeats that shift's schedule
/// on the same path, as consecutive nights on one job do; a changed shift
/// or a new job therefore starts on a day after the last shift ended. The
/// attendance register and the order preflight both ask this, so a prompt
/// never warns of a start that will not happen.
pub(crate) fn starts_at(
    world: &World,
    pack: &ContentPack,
    sim: SimId,
    career: u32,
    shift: &ShiftView<'_>,
    now: u64,
) -> bool {
    let tuning = &pack.tuning;
    let day_ticks = u64::from(tuning.day_ticks);
    if now % day_ticks != u64::from(shift.shift_start)
        || !crate::systems::career::works_today(shift, &crate::SimClock { tick: now }, tuning)
    {
        return false;
    }
    let Some(last) = world
        .get_resource::<crate::attendance::Attendance>()
        .and_then(|attendance| attendance.shifts.get(&sim))
    else {
        return true;
    };
    let today = now / day_ticks;
    // The start being registered this very tick never blocks itself.
    if last.start_tick == now {
        return true;
    }
    if last.start_tick / day_ticks == today {
        return false;
    }
    // The last shift's scheduled end counts, so a forfeited night shift
    // still holds its morning until the time it was due to end.
    if last.end_tick / day_ticks < today {
        return true;
    }
    // On the day the last shift ended, only the same schedule on the same
    // path starts again, as consecutive nights do. An older save's legacy
    // record began at an arrival rather than a scheduled start; older saves
    // held only standard shifts, so its scheduled start is its job's
    // standard start.
    let path = |row: u32| pack.careers.get(row as usize).map(|job| job.path);
    let last_start = if last.legacy {
        pack.careers
            .get(last.career as usize)
            .and_then(|job| job.shift(0))
            .map(|standard| u64::from(standard.shift_start))
    } else {
        Some(last.start_tick % day_ticks)
    };
    path(last.career) == path(career)
        && last_start == Some(u64::from(shift.shift_start))
        && last.end_tick - last.start_tick == u64::from(shift.shift_ticks)
}

/// The shift whose schedule `entity` works on the day of tick `now`: on the
/// day they changed shift, the one they held when the day began (the
/// owner's ruling of 2026-10-24), and otherwise their held shift. `None`
/// for the unemployed.
pub(crate) fn shift_today<'a>(
    world: &World,
    pack: &'a ContentPack,
    entity: Entity,
    now: u64,
) -> Option<ShiftView<'a>> {
    let job = job_of(world, pack, entity)?;
    let before = world
        .get::<SimId>(entity)
        .zip(world.get::<Career>(entity))
        .zip(world.get_resource::<Careers>())
        .and_then(|((sim, career), careers)| {
            careers.shift_before_change(*sim, now / u64::from(pack.tuning.day_ticks), career.0)
        })
        .and_then(|from| job.shift(from as usize));
    before.or_else(|| Some(held_at(world, job, entity)))
}

/// Whether any shift `job` lists, weight 0 included, starts at tick `tick`:
/// its start time of day on a day it works. The reading system's saved
/// deferral of a departure is checked this way ([WS-systems] item 4).
pub(crate) fn a_listed_shift_starts_at(job: &CompiledCareer, tuning: &Tuning, tick: u64) -> bool {
    let clock = crate::SimClock { tick };
    (0..job.shift_count())
        .filter_map(|index| job.shift(index))
        .any(|shift| {
            tick % u64::from(tuning.day_ticks) == u64::from(shift.shift_start)
                && crate::systems::career::works_today(&shift, &clock, tuning)
        })
}

/// The shifts `job` offers: those with a weight above 0, the standard
/// shift first and then the level's other shifts in authored order.
pub fn offered(job: &CompiledCareer) -> Vec<ShiftView<'_>> {
    (0..job.shift_count())
        .filter_map(|index| job.shift(index))
        .filter(|shift| shift.weight > 0)
        .collect()
}

/// The shift a person holding shift `held` of `from` takes at `to` on a
/// promotion or a demotion ([WS-choose] step 3): the same id when `to`
/// offers it, with `to`'s times, and otherwise a draw from `to`.
pub fn keep_or_draw(
    careers: &mut Careers,
    from: &CompiledCareer,
    held: u32,
    to: &CompiledCareer,
) -> u32 {
    let kept = from
        .shift(held as usize)
        .and_then(|shift| to.shift_index(shift.id))
        .filter(|index| to.offers(*index));
    match kept {
        Some(index) => index as u32,
        None => draw(careers, to),
    }
}

/// The shift `entity` works: the held shift of their level, or the
/// standard shift when they hold no record (a hand-built world, or a
/// household worker before their first shift). `None` for the unemployed.
pub fn shift_of<'a>(world: &World, pack: &'a ContentPack, entity: Entity) -> Option<ShiftView<'a>> {
    let job = job_of(world, pack, entity)?;
    Some(held_at(world, job, entity))
}

/// The shift `entity` works at `row`: their held shift when `row` is the
/// level they hold, and otherwise `row`'s standard shift. For a reader
/// whose record names a row of its own, such as a departure a reading
/// order deferred; `None` for a row the pack does not have.
pub(crate) fn shift_at<'a>(
    world: &World,
    pack: &'a ContentPack,
    entity: Entity,
    row: u32,
) -> Option<ShiftView<'a>> {
    let job = pack.careers.get(row as usize)?;
    if world
        .get::<Career>(entity)
        .is_some_and(|career| career.0 == row)
    {
        Some(held_at(world, job, entity))
    } else {
        job.shift(0)
    }
}

/// The shift `entity` holds at `job`, their own level.
fn held_at<'a>(world: &World, job: &'a CompiledCareer, entity: Entity) -> ShiftView<'a> {
    let record = world
        .get::<SimId>(entity)
        .and_then(|sim| world.get_resource::<Careers>()?.record(*sim));
    held_shift(job, record)
}

/// The shift `record` holds at `job`: the record's index, or the standard
/// shift without a record or past the level's list.
fn held_shift<'a>(job: &'a CompiledCareer, record: Option<&Record>) -> ShiftView<'a> {
    let held = record.map_or(0, |record| record.shift);
    job.shift(held as usize)
        .or_else(|| job.shift(0))
        .expect("every level has its standard shift")
}

/// What one shift pays `entity` with the night premium, in cents, when the
/// shift they hold is of the night kind ([WB-panel] and [WB-wages] in
/// `docs/specs/2026-10-18-wages-and-bills.md`): the Career tab's night pay
/// line. `None` for anyone not holding a night shift.
pub fn night_pay_cents(world: &World, entity: Entity) -> Option<i64> {
    let pack = world.get_resource::<Content>()?.0;
    let shift = shift_of(world, pack, entity)?;
    if shift.kind != terri_data::SHIFT_NIGHT {
        return None;
    }
    let job = job_of(world, pack, entity)?;
    let pay = world
        .get::<SimId>(entity)
        .and_then(|sim| world.get_resource::<Careers>()?.record(*sim))
        .map_or(job.pay, |record| record.pay);
    Some(pack.tuning.shift_pay_cents(pay, terri_data::SHIFT_NIGHT))
}

/// The ticks a shift of `kind` adds to its holder's sleep rhythm
/// ([WS-sleep]); a kind past the four named ones counts as day.
pub fn kind_offset(tuning: &Tuning, kind: u8) -> i32 {
    match kind {
        terri_data::SHIFT_EARLY => tuning.shift_sleep_offset_early,
        terri_data::SHIFT_LATE => tuning.shift_sleep_offset_late,
        terri_data::SHIFT_NIGHT => tuning.shift_sleep_offset_night,
        _ => tuning.shift_sleep_offset_day,
    }
}

/// The sleep rhythm each person's held shift adds ([WS-sleep] in
/// `docs/specs/2026-10-18-shifts-and-careers.md`), read once per person
/// per decision by `select_action`. One parameter, so the selection
/// system's own query and parameter lists do not grow.
#[derive(SystemParam)]
pub struct ShiftRhythm<'w, 's> {
    content: Res<'w, Content>,
    careers: Option<Res<'w, Careers>>,
    people: Query<'w, 's, (Option<&'static SimId>, &'static Career)>,
}

impl ShiftRhythm<'_, '_> {
    /// The ticks `entity`'s held shift adds to their rhythm, on working
    /// days and days off alike; 0 without a job.
    pub fn offset(&self, entity: Entity) -> i32 {
        let Ok((sim, career)) = self.people.get(entity) else {
            return 0;
        };
        let pack = self.content.0;
        let Some(job) = pack.careers.get(career.0 as usize) else {
            return 0;
        };
        let record = sim.and_then(|sim| self.careers.as_ref()?.record(*sim));
        kind_offset(&pack.tuning, held_shift(job, record).kind)
    }
}

#[cfg(test)]
#[path = "shift_tests.rs"]
mod shift_tests;
