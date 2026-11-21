//! What the admin panel reads, as flat lists of numbers ([AP-wasm] in
//! `docs/specs/2026-11-20-admin-panel.md`). Every read names a person by
//! `SimId`, takes the world as it stands and changes nothing, and answers
//! with an empty list for anyone who is not a living member of the household.
//! `f64` carries every value exactly: the largest is a bill amount in cents,
//! at most 10^12.
//!
//! The layouts are the contract with the shell's `web/src/admin/` readers and
//! with `terri-wasm`'s `admin_boundary_tests.rs`.
use super::housemate;
use crate::bills::{self, Bills};
use crate::careers::{self, Careers, Record};
use crate::mood::{self, MoodSource};
use crate::{edit, Content};
use bevy_ecs::prelude::*;
use terri_core::admin::ADMIN_TIMER_COUNT;
use terri_core::{Affinities, Career, Habituation, NeedId, Needs, Satisfaction, SimClock, SimId};
use terri_data::CompiledTraitKind;

/// How many numbers [`person`] returns.
pub const PERSON_LEN: usize = NeedId::ALL.len() + 1 + 10;

/// How many numbers each bill takes in [`bills`].
pub const BILL_ROW_LEN: usize = 7;

/// How many numbers [`limits`] returns.
pub const LIMITS_LEN: usize = 5;

fn living(world: &World, sim: u32) -> Option<Entity> {
    edit::living_entity(world, sim)
}

/// `[needs x7 in NeedId order, satisfaction, career row or -1, shift, pay,
/// job satisfaction, good weeks, poor weeks, job search on (1 or 0),
/// advance_weeks, pay minimum, pay maximum]`.
///
/// Without a job the row is -1 and the shift, pay, satisfaction, weeks and
/// the level's three numbers are 0; the job search flag is the person's own
/// either way. A worker who has not yet finished a shift has no record, and
/// reads as the one a new job starts with.
pub fn person(world: &World, sim: u32) -> Vec<f64> {
    let Some(entity) = living(world, sim) else {
        return Vec::new();
    };
    let pack = world.resource::<Content>().0;
    let mut row = Vec::with_capacity(PERSON_LEN);
    let needs = world.get::<Needs>(entity);
    row.extend(
        NeedId::ALL
            .into_iter()
            .map(|need| needs.map_or(0.0, |needs| f64::from(needs.get(need)))),
    );
    row.push(
        world
            .get::<Satisfaction>(entity)
            .map_or(0.0, |ledger| f64::from(ledger.value())),
    );
    let careers = world.get_resource::<Careers>();
    let search = careers.is_none_or(|careers| careers.searches(SimId(sim)));
    match (
        world.get::<Career>(entity),
        careers::job_of(world, pack, entity),
    ) {
        (Some(&Career(held)), Some(job)) => {
            let fresh;
            let record = match careers.and_then(|careers| careers.record(SimId(sim))) {
                Some(record) => record,
                None => {
                    fresh = Record::new(job);
                    &fresh
                }
            };
            row.extend([
                f64::from(held),
                f64::from(record.shift),
                f64::from(record.pay),
                f64::from(record.job_satisfaction),
                f64::from(record.consecutive_good),
                f64::from(record.consecutive_poor),
                f64::from(u8::from(search)),
                f64::from(job.advance_weeks),
                f64::from(job.pay),
                f64::from(job.pay_max),
            ]);
        }
        _ => row.extend([
            -1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            f64::from(u8::from(search)),
            0.0,
            0.0,
            0.0,
        ]),
    }
    row
}

/// `[object, row, value, food]` for every repetition entry the person holds,
/// in the entries' (object, row) order. `food` is 1 for a row that advertises
/// Hunger, the rows that make a person Feeling sick at `sick_threshold`, and
/// 0 for any other.
pub fn repetition(world: &World, sim: u32) -> Vec<f64> {
    let Some(entity) = living(world, sim) else {
        return Vec::new();
    };
    let pack = world.resource::<Content>().0;
    world
        .get::<Habituation>(entity)
        .into_iter()
        .flat_map(Habituation::entries)
        .flat_map(|&(object, row, value)| {
            [
                f64::from(object.0),
                f64::from(row),
                f64::from(value),
                f64::from(u8::from(mood::is_food(pack, object, row))),
            ]
        })
        .collect()
}

/// `[timer code, ends tick]` for every timed moodlet running for the person,
/// by ascending code: 0 burnt dinner, 1 had a fight, 2 promoted, 3 got a
/// raise, 4 demoted, 5 fired.
pub fn timers(world: &World, sim: u32) -> Vec<f64> {
    if living(world, sim).is_none() {
        return Vec::new();
    }
    (0..ADMIN_TIMER_COUNT)
        .filter_map(|timer| {
            housemate::timer_end(world, SimId(sim), timer)
                .map(|ends| [f64::from(timer), ends as f64])
        })
        .flatten()
        .collect()
}

/// `[kind, arg, score, ends tick or -1]` for every moodlet, in the order
/// the mood read lists them (`mood_summary_of` after its overall label), so
/// a label and its row share an index.
///
/// `kind` says where the moodlet comes from, when that has a short
/// explanation ([AP-c-sources]): 0 none; 10 to 16 a need at or below the low
/// level, 20 to 26 at or below the critical level (the kind minus 10 or 20 is
/// the `NeedId` order, `arg` the level); 30 job satisfaction; 31 a feeling
/// about someone close by (`arg` their `SimId`); 32 an overdue bill; 40 to 45
/// a timed moodlet (the kind minus 40 is its timer code, `ends` the tick it
/// ends). `arg` is 0 otherwise.
pub fn moodlets(world: &World, sim: u32) -> Vec<f64> {
    let Some(entity) = living(world, sim) else {
        return Vec::new();
    };
    let Some(snapshot) = mood::derive_mood(world, entity.index_u32()) else {
        return Vec::new();
    };
    snapshot
        .moodlets
        .iter()
        .zip(&snapshot.sources)
        .flat_map(|(moodlet, source)| {
            let (kind, arg, ends) = match *source {
                MoodSource::Other => (0.0, 0.0, -1.0),
                MoodSource::Need {
                    need,
                    critical,
                    level,
                } => (
                    f64::from(need) + if critical { 20.0 } else { 10.0 },
                    f64::from(level),
                    -1.0,
                ),
                MoodSource::JobSatisfaction => (30.0, 0.0, -1.0),
                MoodSource::Feeling { sim } => (31.0, f64::from(sim), -1.0),
                MoodSource::BillsOverdue => (32.0, 0.0, -1.0),
                MoodSource::Timer { timer } => (
                    40.0 + f64::from(timer),
                    0.0,
                    housemate::timer_end(world, SimId(sim), timer).map_or(-1.0, |ends| ends as f64),
                ),
            };
            [kind, arg, f64::from(moodlet.score), ends]
        })
        .collect()
}

/// `[bill count n, n rows of [due day, kind, amount cents, late fee cents,
/// paid day or -1, fee cap cents, overdue from day], then the due days a
/// bill can take]`.
///
/// The due days are the billing month starts under today's terms from
/// today's month back `admin_bill_due_months` months, newest first, and none
/// before day 0. A day index `d` is the day the HUD shows as `Day d + 1`.
pub fn bills(world: &World) -> Vec<f64> {
    let pack = world.resource::<Content>().0;
    let held: &[bills::Bill] = world
        .get_resource::<Bills>()
        .map_or(&[], |record| record.bills.as_slice());
    let mut out = vec![held.len() as f64];
    for bill in held {
        out.extend([
            f64::from(bill.due_day),
            f64::from(bill.kind),
            bill.amount_cents as f64,
            bill.late_fee_cents as f64,
            bill.paid_day.map_or(-1.0, f64::from),
            bills::late_fee_cap(bill) as f64,
            f64::from(bill.overdue_from()),
        ]);
    }
    let today = bills::day_index(world.resource::<SimClock>().tick, pack.tuning.day_ticks);
    let length = bills::BillTerms::of(&pack.bills).month_length;
    let newest = today - today % length;
    let months = pack.tuning.admin_bill_due_months;
    out.extend(
        (0..months)
            .map_while(|back| newest.checked_sub(back.checked_mul(length)?))
            .map(f64::from),
    );
    out
}

/// The practice the panel sends for skill `skill` at `level` whole levels and
/// `fraction` of the next one: the value `skills::standing` reads back as
/// exactly that. `None` for an unknown skill, a level past its top or a
/// fraction outside `[0, 1)`.
pub fn skill_practice_for(world: &World, skill: u32, level: u32, fraction: f32) -> Option<f32> {
    let pack = world.resource::<Content>().0;
    let definition = pack.skills.get(skill as usize)?;
    crate::skills::practice_for_standing(
        &crate::skills::Ladder::from_tuning(&pack.tuning),
        definition.levels,
        u8::try_from(level).ok()?,
        fraction,
    )
}

/// One affinity value per `[[affinity]]` kind in pack order, -1 to 1; empty
/// for anyone but a living housemate. A person who holds no affinities reads
/// 0 for every kind, as the simulation treats them.
pub fn affinities(world: &World, sim: u32) -> Vec<f64> {
    let Some(entity) = living(world, sim) else {
        return Vec::new();
    };
    let pack = world.resource::<Content>().0;
    let held = world.get::<Affinities>(entity);
    (0..pack.affinities.len() as u32)
        .map(|kind| held.map_or(0.0, |held| f64::from(held.value(kind))))
        .collect()
}

/// For each pack trait in pack order, the index of the skill a capability
/// trains (the skill whose tag the trait carries), or -1 for a disposition, a
/// condition, or a capability whose tag names no skill. The Traits panel
/// shows a capability as that skill's mastery ([AP-c-capability]), so the
/// shell edits the skill.
pub fn trait_skills(world: &World) -> Vec<f64> {
    let pack = world.resource::<Content>().0;
    pack.traits
        .iter()
        .map(|definition| match definition.kind {
            CompiledTraitKind::Capability { .. } => {
                crate::skills::skill_for_tag(pack, &definition.tag)
                    .map_or(-1.0, |(index, _)| f64::from(index))
            }
            _ => -1.0,
        })
        .collect()
}

/// `[path, level, career row]` for every level of every career path, in path
/// then level order. The row is what `SetJob` takes: a path's levels name
/// rows of the pack's career list, which need not be consecutive.
pub fn job_options(world: &World) -> Vec<f64> {
    let pack = world.resource::<Content>().0;
    pack.career_paths
        .iter()
        .enumerate()
        .flat_map(|(path, definition)| {
            definition
                .levels
                .iter()
                .enumerate()
                .flat_map(move |(level, &row)| [path as f64, level as f64, f64::from(row)])
        })
        .collect()
}

/// `[habituation_max, overdoing_threshold, sick_threshold,
/// housemate_max_traits, most poor weeks the panel sets]`: the tuning the
/// panel's ranges and words come from, so the shell keeps no copy.
pub fn limits(world: &World) -> Vec<f64> {
    let tuning = &world.resource::<Content>().0.tuning;
    vec![
        f64::from(tuning.habituation_max),
        f64::from(tuning.overdoing_threshold),
        f64::from(tuning.sick_threshold),
        f64::from(tuning.housemate_max_traits),
        f64::from(careers::certain_fire_weeks(tuning).unwrap_or(careers::POOR_WARNING_WEEKS)),
    ]
}
