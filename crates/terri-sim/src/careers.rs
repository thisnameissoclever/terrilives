//! Careers - issue 249 (`docs/specs/2026-10-17-careers.md`). Every job is
//! a level of a path; a shift is scored from how the job fits the person,
//! their skill and their mood; the week's scores are reviewed on the first
//! tick of the next week and decide a promotion, a raise, a demotion or,
//! after three poor weeks in a row, a dismissal; an unemployed person looks
//! for work and an employed one may change path, each behind a setting.
//! Job search is each person's own setting (issue 297,
//! `docs/specs/2026-10-18-job-search-per-person.md`); changing path is one
//! household setting. The rabbit-hole shift itself stays in
//! `systems::career`.
use std::collections::{BTreeMap, BTreeSet};

use bevy_ecs::prelude::*;
use terri_core::save_v21::{SavedHeldShift, SavedShiftChange, SavedShifts};
use terri_core::{
    save_v14::{SavedCareerMoodlet, SavedCareerRecord, SavedCareerWeek, SavedCareers},
    Agent, AtWork, Career, Commuting, FnvHasher, Funds, Satisfaction, SimClock, SimId, SimRng,
    Skills, Traits,
};
use terri_data::{CompiledCareer, ContentPack};

use crate::moodlet_timers::MoodletTimers;
use crate::Content;

/// The event a reviewed week records.
pub const EVENT_NONE: u8 = 0;
pub const EVENT_PROMOTION: u8 = 1;
pub const EVENT_RAISE: u8 = 2;
pub const EVENT_DEMOTION: u8 = 3;
pub const EVENT_FIRED: u8 = 4;
pub const EVENT_CHANGED_PATH: u8 = 5;

/// The kinds of career event moodlet, as the save numbers them.
pub const MOODLET_PROMOTED: u8 = 1;
pub const MOODLET_RAISE: u8 = 2;
pub const MOODLET_DEMOTED: u8 = 3;
pub const MOODLET_FIRED: u8 = 4;

/// The seed the careers stream starts from in a new game.
const CAREERS_SEED: u64 = 0x4341_5245_4552_5331;

/// The trait ids rule 3 reads for social capacity.
const CHATTERBOX: &str = "chatterbox";
const PRIVATE_PERSON: &str = "private_person";
const ISOLATED: &str = "isolated";

/// Why a career command was refused, numbered for the shell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CareerRefusal {
    NotAPerson = 1,
    AtWork = 2,
    UnknownPath = 3,
    /// Issue 296, [WS-select]: the level does not offer that shift.
    ShiftNotOffered = 4,
    /// The person has no job whose shift could change.
    NotEmployed = 5,
    /// The person already holds that shift.
    SameShift = 6,
}

/// What the drain did with the last career command: the person it named
/// and the refusal, if any.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CareerResult {
    pub agent: u32,
    pub reason: Option<CareerRefusal>,
}

/// One reviewed week.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Week {
    pub week: u64,
    pub performance: f32,
    pub event: u8,
}

/// One person's standing in their job.
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    /// Whole dollars per shift, inside the level's range.
    pub pay: u32,
    pub job_satisfaction: f32,
    pub consecutive_poor: u32,
    pub consecutive_good: u32,
    /// The current week's shift scores.
    pub shifts: Vec<f32>,
    pub history: Vec<Week>,
    /// The week whose review waits for the person to come home: a person
    /// at work or commuting when a week ends is reviewed on their return.
    pub review_due: Option<u64>,
    /// The shift the person holds, as an index into their level's shifts:
    /// 0 is the level's standard shift (issue 296, [WS-choose] in
    /// `docs/specs/2026-10-18-shifts-and-careers.md`).
    pub shift: u32,
}

impl Record {
    /// A fresh record for a job just taken: starting pay, middling job
    /// satisfaction, nothing reviewed.
    pub fn new(job: &CompiledCareer) -> Self {
        Self {
            pay: job.pay,
            job_satisfaction: 50.0,
            consecutive_poor: 0,
            consecutive_good: 0,
            shifts: Vec::new(),
            history: Vec::new(),
            review_due: None,
            shift: 0,
        }
    }

    /// Whether the person carries a warning: two poor weeks in a row.
    pub fn warned(&self) -> bool {
        self.consecutive_poor >= 2
    }
}

/// Everything careers keep between ticks. Saved in schema fourteen, with
/// the people whose job search is off in schema eighteen; in the world hash
/// whenever it differs from a new game's.
#[derive(Resource, Clone, Debug, PartialEq)]
pub struct Careers {
    pub autonomous_change: bool,
    /// The living people who do not look for work on their own. Everyone
    /// else does, so a new game and every newcomer start with the search on.
    pub search_off: BTreeSet<SimId>,
    pub rng: SimRng,
    /// How often the stream was drawn, so a world whose draws left no other
    /// trace still hashes differently from one with none.
    pub draws: u64,
    pub records: BTreeMap<SimId, Record>,
    pub promoted: MoodletTimers,
    pub raised: MoodletTimers,
    pub demoted: MoodletTimers,
    pub fired: MoodletTimers,
    /// How many career commands the drain has handled, applied or
    /// refused: a quit that leaves no other trace still changes the world.
    pub commands: u64,
    /// What the drain did with the last career command. Not saved.
    pub last_result: Option<CareerResult>,
    /// The shift stream (issue 296, [WS-determinism]): drawn only for a
    /// shift, so a player's shift choices never move a search or a review.
    pub shift_rng: SimRng,
    /// How often the shift stream was drawn.
    pub shift_draws: u64,
    /// The day of each person's last shift change, by day number. A changed
    /// shift takes effect from the next day (the owner's ruling of
    /// 2026-10-23 in [WS-rulings]), so no shift of theirs starts on this
    /// day. A day before today means nothing and is neither hashed nor saved.
    pub shift_changed: BTreeMap<SimId, u64>,
}

impl Default for Careers {
    fn default() -> Self {
        Self {
            autonomous_change: true,
            search_off: BTreeSet::new(),
            rng: SimRng::from_seed(CAREERS_SEED),
            draws: 0,
            records: BTreeMap::new(),
            promoted: MoodletTimers::default(),
            raised: MoodletTimers::default(),
            demoted: MoodletTimers::default(),
            fired: MoodletTimers::default(),
            commands: 0,
            last_result: None,
            shift_rng: SimRng::from_seed(crate::shifts::SHIFTS_SEED),
            shift_draws: 0,
            shift_changed: BTreeMap::new(),
        }
    }
}

impl Careers {
    /// Whether anything here differs from a new game's: the condition for
    /// hashing and the reason an untouched world hashes as it always did.
    pub fn is_pristine(&self) -> bool {
        self.autonomous_change
            && self.search_off.is_empty()
            && self.draws == 0
            && self.shift_draws == 0
            && self.commands == 0
            && self.records.is_empty()
            && self.promoted.entries().is_empty()
            && self.raised.entries().is_empty()
            && self.demoted.entries().is_empty()
            && self.fired.entries().is_empty()
    }

    fn draw(&mut self) -> f32 {
        self.draws += 1;
        self.rng.next_f32()
    }

    pub fn record(&self, sim: SimId) -> Option<&Record> {
        self.records.get(&sim)
    }

    /// Whether `sim` changed shift on day `day`, which keeps every shift of
    /// theirs from starting that day.
    pub fn changed_shift_on(&self, sim: SimId, day: u64) -> bool {
        self.shift_changed.get(&sim) == Some(&day)
    }

    /// Whether `sim` looks for work on their own while unemployed.
    pub fn searches(&self, sim: SimId) -> bool {
        !self.search_off.contains(&sim)
    }

    /// Turns one person's job search on or off.
    pub fn set_search(&mut self, sim: SimId, search: bool) {
        if search {
            self.search_off.remove(&sim);
        } else {
            self.search_off.insert(sim);
        }
    }

    /// Drops the person's record and timers, as death drops every other
    /// per-person record.
    pub fn forget(&mut self, sim: SimId) {
        self.records.remove(&sim);
        self.search_off.remove(&sim);
        self.promoted.forget(sim);
        self.raised.forget(sim);
        self.demoted.forget(sim);
        self.fired.forget(sim);
    }

    /// The timers of one moodlet kind.
    pub fn timers(&self, kind: u8) -> Option<&MoodletTimers> {
        match kind {
            MOODLET_PROMOTED => Some(&self.promoted),
            MOODLET_RAISE => Some(&self.raised),
            MOODLET_DEMOTED => Some(&self.demoted),
            MOODLET_FIRED => Some(&self.fired),
            _ => None,
        }
    }

    fn timers_mut(&mut self, kind: u8) -> &mut MoodletTimers {
        match kind {
            MOODLET_PROMOTED => &mut self.promoted,
            MOODLET_RAISE => &mut self.raised,
            MOODLET_DEMOTED => &mut self.demoted,
            _ => &mut self.fired,
        }
    }

    pub fn expire(&mut self, now: u64) {
        self.promoted.expire(now);
        self.raised.expire(now);
        self.demoted.expire(now);
        self.fired.expire(now);
    }

    /// The saved form: records in person order, moodlets by kind then
    /// person. The older household search field is written on; a writer
    /// with the world sets it from `household_search`.
    pub fn to_saved(&self) -> SavedCareers {
        let mut moodlets = Vec::new();
        for kind in [
            MOODLET_PROMOTED,
            MOODLET_RAISE,
            MOODLET_DEMOTED,
            MOODLET_FIRED,
        ] {
            for (sim, until) in self.timers(kind).expect("a listed kind").entries() {
                moodlets.push(SavedCareerMoodlet {
                    sim: sim.0,
                    kind,
                    until_tick: *until,
                });
            }
        }
        SavedCareers {
            autonomous_change: self.autonomous_change,
            autonomous_search: true,
            rng: self.rng.clone(),
            draws: self.draws,
            records: self
                .records
                .iter()
                .map(|(sim, record)| SavedCareerRecord {
                    sim: sim.0,
                    pay: record.pay,
                    job_satisfaction: record.job_satisfaction,
                    consecutive_poor: record.consecutive_poor,
                    consecutive_good: record.consecutive_good,
                    shifts: record.shifts.clone(),
                    history: record
                        .history
                        .iter()
                        .map(|week| SavedCareerWeek {
                            week: week.week,
                            performance: week.performance,
                            event: week.event,
                        })
                        .collect(),
                    review_due: record.review_due,
                })
                .collect(),
            moodlets,
            commands: self.commands,
        }
    }

    /// The live form of a saved one; the caller has validated it. The older
    /// household search field is not read here: `install_saved` gives it
    /// to every living person.
    pub fn from_saved(saved: SavedCareers) -> Self {
        let mut careers = Self {
            autonomous_change: saved.autonomous_change,
            rng: saved.rng,
            draws: saved.draws,
            commands: saved.commands,
            ..Self::default()
        };
        for record in saved.records {
            careers.records.insert(
                SimId(record.sim),
                Record {
                    pay: record.pay,
                    job_satisfaction: record.job_satisfaction,
                    consecutive_poor: record.consecutive_poor,
                    consecutive_good: record.consecutive_good,
                    shifts: record.shifts,
                    history: record
                        .history
                        .into_iter()
                        .map(|week| Week {
                            week: week.week,
                            performance: week.performance,
                            event: week.event,
                        })
                        .collect(),
                    review_due: record.review_due,
                    shift: 0,
                },
            );
        }
        for moodlet in saved.moodlets {
            careers
                .timers_mut(moodlet.kind)
                .record(SimId(moodlet.sim), moodlet.until_tick);
        }
        careers
    }

    pub fn hash_into(&self, hash: &mut FnvHasher) {
        hash.write_u64(u64::from(self.autonomous_change));
        // Where the household search setting was written: true while
        // everyone looks for work, so such a world hashes as it did before
        // the setting moved to each person. The people who are off are
        // written after the moodlet timers.
        hash.write_u64(u64::from(self.search_off.is_empty()));
        self.rng.hash_into(hash);
        hash.write_u64(self.draws);
        hash.write_u64(self.commands);
        hash.write_u64(self.records.len() as u64);
        for (sim, record) in &self.records {
            hash.write_u64(u64::from(sim.0));
            hash.write_u64(u64::from(record.pay));
            hash.write_u64(u64::from(record.job_satisfaction.to_bits()));
            hash.write_u64(u64::from(record.consecutive_poor));
            hash.write_u64(u64::from(record.consecutive_good));
            hash.write_u64(record.shifts.len() as u64);
            for score in &record.shifts {
                hash.write_u64(u64::from(score.to_bits()));
            }
            hash.write_u64(record.history.len() as u64);
            for week in &record.history {
                hash.write_u64(week.week);
                hash.write_u64(u64::from(week.performance.to_bits()));
                hash.write_u64(u64::from(week.event));
            }
            hash.write_u64(record.review_due.map_or(0, |week| week + 1));
        }
        for kind in [
            MOODLET_PROMOTED,
            MOODLET_RAISE,
            MOODLET_DEMOTED,
            MOODLET_FIRED,
        ] {
            self.timers(kind)
                .expect("a listed kind")
                .hash_into(hash, &[b'c', b'a', b'r', b'e', b'e', b'r', kind]);
        }
        if !self.search_off.is_empty() {
            hash.write_bytes(b"job-search-off");
            hash.write_u64(self.search_off.len() as u64);
            for sim in &self.search_off {
                hash.write_u64(u64::from(sim.0));
            }
        }
    }
}

/// Installs a validated saved careers block. A save from before job search
/// was each person's setting carries one household value; every living
/// person takes it, so a household that had the search off keeps it off.
pub(crate) fn install_saved(world: &mut World, saved: SavedCareers) {
    let search = saved.autonomous_search;
    let mut careers = Careers::from_saved(saved);
    if !search {
        careers.search_off = people(world).into_iter().map(|(sim, _)| sim).collect();
    }
    world.insert_resource(careers);
}

/// The older household search setting, as schemas fourteen to seventeen
/// carry it: off only while every living person's search is off, the one
/// state that field and `install_saved` reproduce exactly. A household
/// with some people on writes it on.
pub(crate) fn household_search(world: &World) -> bool {
    let Some(careers) = world.get_resource::<Careers>() else {
        return true;
    };
    let Some(mut query) = world.try_query_filtered::<&SimId, With<Agent>>() else {
        return true;
    };
    let mut living = query.iter(world).peekable();
    living.peek().is_none() || living.any(|sim| careers.searches(*sim))
}

/// The living people whose job search is off, in id order, for schema
/// eighteen.
pub(crate) fn saved_search_off(world: &World) -> Vec<u32> {
    world
        .get_resource::<Careers>()
        .map_or_else(Vec::new, |careers| {
            careers
                .search_off
                .iter()
                .filter(|sim| crate::edit::living_entity(world, sim.0).is_some())
                .map(|sim| sim.0)
                .collect()
        })
}

/// Validates and installs schema eighteen's list over a world whose
/// careers the older envelope has already restored: each id a living
/// person, ascending, once.
pub(crate) fn restore_search_off(world: &mut World, off: Vec<u32>) -> Result<(), crate::SaveError> {
    if off.windows(2).any(|pair| pair[0] >= pair[1])
        || off
            .iter()
            .any(|sim| crate::edit::living_entity(world, *sim).is_none())
    {
        return Err(crate::SaveError::InvalidValue);
    }
    world.resource_mut::<Careers>().search_off = off.into_iter().map(SimId).collect();
    Ok(())
}

/// The week a tick falls in, as the chore board counts it.
pub fn week_of(tick: u64, day_ticks: u32) -> u64 {
    tick / u64::from(day_ticks) / 7
}

/// The job `entity` holds, if any.
pub fn job_of<'a>(
    world: &World,
    pack: &'a ContentPack,
    entity: Entity,
) -> Option<&'a CompiledCareer> {
    world
        .get::<Career>(entity)
        .and_then(|career| pack.careers.get(career.0 as usize))
}

/// Rule 3: how far a person can face other people, 0 to 1.
pub fn social_capacity(world: &World, pack: &ContentPack, entity: Entity) -> f32 {
    let shyness = crate::shyness::of(world, entity).value();
    let mut capacity = 1.0 - f32::from(shyness) / 100.0;
    if let Some(traits) = world.get::<Traits>(entity) {
        for (index, _) in traits.entries() {
            let Some(definition) = pack.traits.get(*index as usize) else {
                continue;
            };
            capacity += match definition.id.as_str() {
                CHATTERBOX => 0.2,
                PRIVATE_PERSON => -0.2,
                ISOLATED => -0.3,
                _ => 0.0,
            };
        }
    }
    capacity.clamp(0.0, 1.0)
}

/// The sum of the job's fit weights over the traits the person wears.
pub fn trait_fit(world: &World, job: &CompiledCareer, entity: Entity) -> f32 {
    let Some(traits) = world.get::<Traits>(entity) else {
        return 0.0;
    };
    job.trait_fit
        .iter()
        .filter(|(index, _)| traits.state(*index).is_some())
        .map(|(_, weight)| *weight)
        .sum()
}

/// Rule 4: how well `job` suits the person, -1 to 1.
pub fn fit(world: &World, pack: &ContentPack, job: &CompiledCareer, entity: Entity) -> f32 {
    let gap = (job.social_demand - social_capacity(world, pack, entity)).max(0.0);
    (trait_fit(world, job, entity) - 2.0 * gap).clamp(-1.0, 1.0)
}

/// The person's mastery in the job's skill, 0.5 when the job names none.
pub fn mastery(world: &World, pack: &ContentPack, job: &CompiledCareer, entity: Entity) -> f32 {
    job.skill_tag
        .as_deref()
        .and_then(|tag| crate::skills::mastery_for_tag(world.get::<Skills>(entity), pack, tag))
        .unwrap_or(0.5)
}

/// The person's mood on a scale of -1 to 1, 0 without a readable mood.
pub fn mood_term(world: &World, entity: Entity) -> f32 {
    crate::mood::overall_score(world, entity.index_u32())
        .map_or(0.0, |score| (score / 50.0).clamp(-1.0, 1.0))
}

/// Rule 5: what a shift scores, 0 to 100.
pub fn shift_score(fit: f32, mastery: f32, mood: f32) -> f32 {
    (50.0 + 20.0 * fit + 20.0 * (mastery - 0.5) + 10.0 * mood).clamp(0.0, 100.0)
}

/// The factors behind a person's score, as the Career tab explains
/// them: fit, trait fit, social capacity, the job's social demand, mastery
/// and the mood term.
pub fn factors(world: &World, pack: &ContentPack, entity: Entity) -> Option<[f32; 6]> {
    let job = job_of(world, pack, entity)?;
    Some([
        fit(world, pack, job, entity),
        trait_fit(world, job, entity),
        social_capacity(world, pack, entity),
        job.social_demand,
        mastery(world, pack, job, entity),
        mood_term(world, entity),
    ])
}

/// The shift's return (rule 5 and rule 10): pays the pay the person held
/// while working the shift into the household, credits the level's
/// satisfaction, applies a review that waited for this return (rule 6),
/// scores the shift into the week, and moves job satisfaction toward what
/// the fit deserves, with a hated job costing life satisfaction on top.
/// Called by `commute_and_work` on the tick the worker reappears.
pub(crate) fn complete_shift(world: &mut World, worker: Entity) {
    let pack = world.resource::<Content>().0;
    let Some(job) = job_of(world, pack, worker) else {
        return;
    };
    let Some(sim) = world.get::<SimId>(worker).copied() else {
        // A hand-built worker with no id (a fixture) is paid the level's
        // pay and credited its reward, and has no week to score.
        world.resource_mut::<Funds>().0 += i64::from(job.pay) * Funds::CENTS_PER_DOLLAR;
        if let Some(mut satisfaction) = world.get_mut::<Satisfaction>(worker) {
            satisfaction.reward(job.satisfaction);
        }
        return;
    };
    let fit = fit(world, pack, job, worker);
    let score = shift_score(
        fit,
        mastery(world, pack, job, worker),
        mood_term(world, worker),
    );
    let tuning = &pack.tuning;
    let (pay, due) = {
        let mut careers = world.resource_mut::<Careers>();
        let record = careers
            .records
            .entry(sim)
            .or_insert_with(|| Record::new(job));
        (record.pay, record.review_due.take())
    };
    world.resource_mut::<Funds>().0 += i64::from(pay) * Funds::CENTS_PER_DOLLAR;
    if let Some(mut satisfaction) = world.get_mut::<Satisfaction>(worker) {
        satisfaction.reward(job.satisfaction);
    }
    if let Some(ended_week) = due {
        // The week ended while this person was at work: its review runs
        // now, before this shift's score joins the week that followed.
        let tick = world.resource::<SimClock>().tick;
        let mut careers = world.remove_resource::<Careers>().unwrap_or_default();
        review_person(world, &mut careers, pack, sim, worker, ended_week, tick);
        world.insert_resource(careers);
    }
    // A dismissal just applied leaves no record to score into.
    let fit = job_of(world, pack, worker).map_or(fit, |job| self::fit(world, pack, job, worker));
    let miserable = {
        let mut careers = world.resource_mut::<Careers>();
        let Some(record) = careers.records.get_mut(&sim) else {
            return;
        };
        record.shifts.push(score);
        let target = 50.0 + 40.0 * fit;
        let step = tuning.career_satisfaction_rate;
        record.job_satisfaction = if record.job_satisfaction < target {
            (record.job_satisfaction + step).min(target)
        } else {
            (record.job_satisfaction - step).max(target)
        };
        record.job_satisfaction < tuning.career_job_misery
    };
    if miserable {
        if let Some(mut satisfaction) = world.get_mut::<Satisfaction>(worker) {
            satisfaction.reward(-tuning.career_misery_satisfaction);
        }
    }
}

/// Settle a scheduled shift once, with its captured pay and actual
/// attendance. `score` joins the week's scores; `None` is a shift a shift
/// change forfeited, which pays and rewards its minutes but is not scored.
pub(crate) fn complete_attended_shift(
    world: &mut World,
    worker: Entity,
    career: u32,
    pay_cents: i64,
    ratio: f32,
    score: Option<f32>,
    scheduled_week: u64,
) {
    let pack = world.resource::<Content>().0;
    let job = &pack.careers[career as usize];
    world.resource_mut::<Funds>().0 += pay_cents;
    if let Some(mut satisfaction) = world.get_mut::<Satisfaction>(worker) {
        satisfaction.reward(job.satisfaction * ratio);
    }
    let Some(sim) = world.get::<SimId>(worker).copied() else {
        return;
    };
    let fit = fit(world, pack, job, worker);
    let miserable = {
        let mut careers = world.resource_mut::<Careers>();
        let record = careers
            .records
            .entry(sim)
            .or_insert_with(|| Record::new(job));
        record.shifts.extend(score);
        let target = 50.0 + 40.0 * fit;
        let step = pack.tuning.career_satisfaction_rate * ratio;
        record.job_satisfaction = if record.job_satisfaction < target {
            (record.job_satisfaction + step).min(target)
        } else {
            (record.job_satisfaction - step).max(target)
        };
        record.job_satisfaction < pack.tuning.career_job_misery
    };
    if miserable {
        if let Some(mut satisfaction) = world.get_mut::<Satisfaction>(worker) {
            satisfaction.reward(-pack.tuning.career_misery_satisfaction * ratio);
        }
    }
    let now = world.resource::<SimClock>().tick;
    if scheduled_week < week_of(now, pack.tuning.day_ticks) {
        world
            .resource_mut::<Careers>()
            .records
            .get_mut(&sim)
            .unwrap()
            .review_due = Some(scheduled_week);
        settle_due_review(world, worker);
    }
}

/// Applies a review that fell due while the person was away, if one
/// waits (rule 6): called at the end of the walk home, for a week that
/// ended during the walk. A review due at the shift's end is applied by
/// `complete_shift` before the walk begins.
pub(crate) fn settle_due_review(world: &mut World, worker: Entity) {
    let pack = world.resource::<Content>().0;
    let Some(sim) = world.get::<SimId>(worker).copied() else {
        return;
    };
    let due = world.get_resource_mut::<Careers>().and_then(|mut careers| {
        careers
            .records
            .get_mut(&sim)
            .and_then(|r| r.review_due.take())
    });
    let Some(ended_week) = due else {
        return;
    };
    let tick = world.resource::<SimClock>().tick;
    let mut careers = world.remove_resource::<Careers>().unwrap_or_default();
    review_person(world, &mut careers, pack, sim, worker, ended_week, tick);
    world.insert_resource(careers);
}

/// Every living person with their id, in id order.
fn people(world: &mut World) -> Vec<(SimId, Entity)> {
    let mut people: Vec<(SimId, Entity)> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .map(|(entity, id)| (*id, entity))
        .collect();
    people.sort_by_key(|(id, _)| *id);
    people
}

/// The outcome a review draw picks (rule 7).
fn outcome(
    tuning: &terri_data::Tuning,
    job: &CompiledCareer,
    path_top: bool,
    path_bottom: bool,
    record: &Record,
    performance: f32,
    draw: f32,
) -> u8 {
    let poor = performance < tuning.career_poor_threshold;
    let fire = if record.consecutive_poor >= 3 {
        (tuning.career_fire_base * (record.consecutive_poor - 2) as f32).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let demote = if poor && !path_bottom && tuning.career_poor_threshold > 0.0 {
        (tuning.career_demote_base * (tuning.career_poor_threshold - performance)
            / tuning.career_poor_threshold)
            .clamp(0.0, 1.0)
    } else {
        0.0
    };
    let above = ((performance - 50.0) / 50.0).clamp(0.0, 1.0);
    let promote = if !path_top && record.consecutive_good >= job.advance_weeks {
        (tuning.career_promote_base * above).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let raise = if record.pay < job.pay_max {
        (tuning.career_raise_base * above).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let mut cumulative = 0.0;
    for (chance, event) in [
        (fire, EVENT_FIRED),
        (demote, EVENT_DEMOTION),
        (promote, EVENT_PROMOTION),
        (raise, EVENT_RAISE),
    ] {
        cumulative += chance;
        if draw < cumulative {
            return event;
        }
    }
    EVENT_NONE
}

/// A raise within the level (rule 8): a quarter of the range, at least a
/// dollar, never past the top.
fn raised_pay(job: &CompiledCareer, pay: u32) -> u32 {
    let step = (job.pay_max - job.pay).div_ceil(4).max(1);
    pay.saturating_add(step).min(job.pay_max)
}

/// Rule 6, rule 7, rule 8, rule 9 and rule 14 for the week that ended at
/// `tick`: every employed person who completed a shift in it is reviewed,
/// in id order. A person at work or commuting when the week ends is
/// reviewed when they come home instead (`complete_shift` at the shift's
/// end, or `settle_due_review` at the end of the walk), so no outcome
/// changes a job while its shift is being worked.
pub(crate) fn review(world: &mut World, ended_week: u64, tick: u64) {
    let pack = world.resource::<Content>().0;
    let mut careers = world.remove_resource::<Careers>().unwrap_or_default();
    for (sim, entity) in people(world) {
        if world.get::<Career>(entity).is_none() {
            continue;
        }
        let Some(record) = careers.records.get_mut(&sim) else {
            continue;
        };
        if crate::attendance::scheduled_week(world, entity) == Some(ended_week) {
            record.review_due = Some(ended_week);
            continue;
        }
        if record.shifts.is_empty() {
            continue;
        }
        if world.get::<AtWork>(entity).is_some() || world.get::<Commuting>(entity).is_some() {
            record.review_due = Some(ended_week);
            continue;
        }
        review_person(world, &mut careers, pack, sim, entity, ended_week, tick);
    }
    world.insert_resource(careers);
}

/// One person's review of `ended_week`, applied at `tick`: the caller has
/// taken the careers out of the world and checked that the person holds
/// a job with at least one shift scored.
fn review_person(
    world: &mut World,
    careers: &mut Careers,
    pack: &'static ContentPack,
    sim: SimId,
    entity: Entity,
    ended_week: u64,
    tick: u64,
) {
    let tuning = &pack.tuning;
    let Some(job) = job_of(world, pack, entity) else {
        return;
    };
    let Some(record) = careers.records.get(&sim) else {
        return;
    };
    if record.shifts.is_empty() {
        return;
    }
    let mean = record.shifts.iter().sum::<f32>() / record.shifts.len() as f32;
    let noise = (careers.draw() * 2.0 - 1.0) * tuning.career_review_noise;
    let performance = (mean + noise).clamp(0.0, 100.0);
    // A hand-built pack may carry a job with no path list; such a job is
    // reviewed as the only level of its path: nowhere to rise or fall to.
    let levels: &[u32] = pack
        .career_paths
        .get(job.path as usize)
        .map_or(&[], |path| path.levels.as_slice());
    let path_top = job.level as usize + 1 >= levels.len();
    let path_bottom = job.level == 0 || levels.is_empty();
    let record = careers.records.get_mut(&sim).expect("present above");
    if performance < tuning.career_poor_threshold {
        record.consecutive_poor += 1;
        record.consecutive_good = 0;
    } else if performance >= tuning.career_good_threshold {
        record.consecutive_good += 1;
        record.consecutive_poor = 0;
    } else {
        record.consecutive_poor = 0;
        record.consecutive_good = 0;
    }
    let draw = careers.draw();
    let record = careers.records.get_mut(&sim).expect("present above");
    let mut event = outcome(
        tuning,
        job,
        path_top,
        path_bottom,
        record,
        performance,
        draw,
    );
    record.shifts.clear();
    match event {
        EVENT_PROMOTION => {
            let row = levels[(job.level + 1) as usize];
            let next = &pack.careers[row as usize];
            record.pay = next.pay.max(record.pay.saturating_add(1)).min(next.pay_max);
            record.consecutive_good = 0;
            record.consecutive_poor = 0;
            let held = record.shift;
            let shift = crate::shifts::keep_or_draw(careers, job, held, next);
            careers.records.get_mut(&sim).expect("present above").shift = shift;
            world.entity_mut(entity).insert(Career(row));
            careers.promoted.record(
                sim,
                tick.saturating_add(u64::from(tuning.career_mood_promoted_ticks)),
            );
        }
        EVENT_RAISE => {
            record.pay = raised_pay(job, record.pay);
            careers.raised.record(
                sim,
                tick.saturating_add(u64::from(tuning.career_mood_promoted_ticks)),
            );
        }
        EVENT_DEMOTION => {
            let row = levels[(job.level - 1) as usize];
            let below = &pack.careers[row as usize];
            record.pay = record.pay.clamp(below.pay, below.pay_max);
            record.consecutive_good = 0;
            record.consecutive_poor = 0;
            let held = record.shift;
            let shift = crate::shifts::keep_or_draw(careers, job, held, below);
            careers.records.get_mut(&sim).expect("present above").shift = shift;
            world.entity_mut(entity).insert(Career(row));
            careers.demoted.record(
                sim,
                tick.saturating_add(u64::from(tuning.career_mood_demoted_ticks)),
            );
        }
        EVENT_FIRED => {
            careers.fired.record(
                sim,
                tick.saturating_add(u64::from(tuning.career_mood_fired_ticks)),
            );
        }
        _ => {
            // Rule 14: a review with no outcome may change path.
            if careers.autonomous_change {
                let here = fit(world, pack, job, entity);
                if here < tuning.career_change_fit {
                    let better = best_path(
                        world,
                        pack,
                        entity,
                        Some(job.path),
                        here + tuning.career_change_gap,
                    );
                    if let Some(path_index) = better {
                        if careers.draw() < tuning.career_change_chance {
                            event = EVENT_CHANGED_PATH;
                            let row = pack.career_paths[path_index as usize].levels[0];
                            let first = &pack.careers[row as usize];
                            let shift = crate::shifts::draw(careers, first);
                            let record = careers.records.get_mut(&sim).expect("present above");
                            record.pay = first.pay;
                            record.consecutive_good = 0;
                            record.consecutive_poor = 0;
                            record.job_satisfaction = 50.0;
                            record.shift = shift;
                            world.entity_mut(entity).insert(Career(row));
                        }
                    }
                }
            }
        }
    }
    let record = careers.records.get_mut(&sim).expect("present above");
    record.history.push(Week {
        week: ended_week,
        performance,
        event,
    });
    if event == EVENT_FIRED {
        // Unemployed: the job and its record go together, as rule 16
        // keeps a record only for an employed person.
        careers.records.remove(&sim);
        world
            .entity_mut(entity)
            .remove::<Career>()
            .remove::<crate::reading::PendingShift>();
    }
}

/// The path whose first level fits the person best among those with fit
/// at least `floor`, leaving out `except`; ties go to the lower index.
pub(crate) fn best_path(
    world: &World,
    pack: &ContentPack,
    entity: Entity,
    except: Option<u32>,
    floor: f32,
) -> Option<u32> {
    let mut best: Option<(u32, f32)> = None;
    for (index, path) in pack.career_paths.iter().enumerate() {
        if except == Some(index as u32) {
            continue;
        }
        let Some(&row) = path.levels.first() else {
            continue;
        };
        let fit = fit(world, pack, &pack.careers[row as usize], entity);
        if fit < floor {
            continue;
        }
        if best.is_none_or(|(_, held)| fit > held) {
            best = Some((index as u32, fit));
        }
    }
    best.map(|(index, _)| index)
}

/// The path an applicant tries ([WS-search] in
/// `docs/specs/2026-10-18-shifts-and-careers.md`): at a search temperature
/// of 0, the best fit with no draw, as before issue 296; above 0, one draw
/// on the careers stream through the softmax over every path's first-level
/// fit, so a better fit is likelier but not certain.
pub(crate) fn search_path(
    world: &World,
    pack: &ContentPack,
    entity: Entity,
    careers: &mut Careers,
) -> Option<u32> {
    let temperature = pack.tuning.career_search_temperature;
    if temperature <= 0.0 {
        return best_path(world, pack, entity, None, f32::NEG_INFINITY);
    }
    let candidates: Vec<(u32, f32)> = pack
        .career_paths
        .iter()
        .enumerate()
        .filter_map(|(index, path)| {
            let row = *path.levels.first()?;
            Some((
                index as u32,
                fit(world, pack, &pack.careers[row as usize], entity),
            ))
        })
        .collect();
    if candidates.is_empty() {
        return None;
    }
    let scores: Vec<f32> = candidates.iter().map(|(_, fit)| *fit).collect();
    careers.draws += 1;
    let chosen = crate::systems::action::sample_softmax(&scores, temperature, &mut careers.rng);
    Some(candidates[chosen].0)
}

/// Rule 13: an unemployed person whose search is on looks for work on a
/// working day. A person whose search is off is passed over before any
/// draw, so the stream sees exactly the people who look. An applicant
/// draws apply, then the path ([WS-search]), then hire, all on the careers
/// stream.
pub(crate) fn search(world: &mut World) {
    let pack = world.resource::<Content>().0;
    let tuning = &pack.tuning;
    let mut careers = world.remove_resource::<Careers>().unwrap_or_default();
    for (sim, entity) in people(world) {
        if !careers.searches(sim)
            || world.get::<Career>(entity).is_some()
            || world.get::<AtWork>(entity).is_some()
            || world.get::<Commuting>(entity).is_some()
        {
            continue;
        }
        if careers.draw() >= tuning.career_search_chance {
            continue;
        }
        let Some(path) = search_path(world, pack, entity, &mut careers) else {
            continue;
        };
        let row = pack.career_paths[path as usize].levels[0];
        let fit = fit(world, pack, &pack.careers[row as usize], entity);
        let hired = (0.5 + 0.5 * fit).clamp(0.1, 0.95);
        if careers.draw() < hired {
            let job = &pack.careers[row as usize];
            let shift = crate::shifts::draw(&mut careers, job);
            careers.records.insert(
                sim,
                Record {
                    shift,
                    ..Record::new(job)
                },
            );
            world.entity_mut(entity).insert(Career(row));
        }
    }
    world.insert_resource(careers);
}

/// Runs each tick after the clock advances: expires the event moodlets,
/// reviews the week that ended on this tick, and sends the unemployed
/// looking for work at the search tick of a weekday.
pub(crate) fn tick(world: &mut World) {
    crate::attendance::account_and_settle(world);
    let tick = world.resource::<SimClock>().tick;
    let (day_ticks, search_tick, first_weekday) = {
        let tuning = &world.resource::<Content>().0.tuning;
        (
            tuning.day_ticks,
            tuning.career_search_tick,
            tuning.first_weekday,
        )
    };
    if let Some(mut careers) = world.get_resource_mut::<Careers>() {
        careers.expire(tick);
    }
    let week_ticks = u64::from(day_ticks) * 7;
    if tick > 0 && tick.is_multiple_of(week_ticks) {
        review(world, tick / week_ticks - 1, tick);
    }
    let day = u64::from(day_ticks);
    if tick % day == u64::from(search_tick) % day
        && terri_core::clock::weekday(tick, day_ticks, first_weekday) < 5
    {
        search(world);
    }
}

/// Rule 12: the player puts `agent` on `path`, drawing the shift.
pub(crate) fn assign(world: &mut World, agent: u32, path: u32) {
    let reason = assign_or_refuse(world, agent, Some(path), None);
    record_command(world, agent, reason);
}

/// [WS-select] item 1: the player puts `agent` on `path` holding shift
/// index `shift` of its first level, with no draw.
pub(crate) fn assign_with_shift(world: &mut World, agent: u32, path: u32, shift: u32) {
    let reason = assign_or_refuse(world, agent, Some(path), Some(shift));
    record_command(world, agent, reason);
}

/// Rule 12: the player makes `agent` unemployed.
pub(crate) fn quit(world: &mut World, agent: u32) {
    let reason = assign_or_refuse(world, agent, None, None);
    record_command(world, agent, reason);
}

/// [WS-select] items 2 and 3: the employed `agent` holds shift index
/// `shift` of their level from now on. Any scheduled shift still open at
/// home settles first, as a career change settles it, and the good-week
/// streak starts again; nothing else about the job changes.
pub(crate) fn change_shift(world: &mut World, agent: u32, shift: u32) {
    let reason = change_shift_or_refuse(world, agent, shift);
    record_command(world, agent, reason);
}

/// Every career command, applied or refused, is counted and reported.
fn record_command(world: &mut World, agent: u32, reason: Option<CareerRefusal>) {
    let mut careers = world.resource_mut::<Careers>();
    careers.commands += 1;
    careers.last_result = Some(CareerResult { agent, reason });
}

/// The living person at entity index `agent` who is at home, or why not.
fn person_at_home(world: &World, agent: u32) -> Result<(Entity, SimId), CareerRefusal> {
    // `agent` is an entity index, as every per-person command names one.
    let entity = crate::family::sim_id_at(world, agent)
        .and_then(|sim| crate::edit::living_entity(world, sim))
        .ok_or(CareerRefusal::NotAPerson)?;
    if world.get::<AtWork>(entity).is_some() || world.get::<Commuting>(entity).is_some() {
        return Err(CareerRefusal::AtWork);
    }
    let sim = *world
        .get::<SimId>(entity)
        .expect("a living person has an id");
    Ok((entity, sim))
}

fn change_shift_or_refuse(world: &mut World, agent: u32, shift: u32) -> Option<CareerRefusal> {
    let pack = world.resource::<Content>().0;
    let (entity, sim) = match person_at_home(world, agent) {
        Ok(person) => person,
        Err(reason) => return Some(reason),
    };
    let Some(job) = job_of(world, pack, entity) else {
        return Some(CareerRefusal::NotEmployed);
    };
    if !job.offers(shift as usize) {
        return Some(CareerRefusal::ShiftNotOffered);
    }
    let held = world
        .resource::<Careers>()
        .record(sim)
        .map_or(0, |record| record.shift);
    if held == shift {
        return Some(CareerRefusal::SameShift);
    }
    crate::attendance::close_for_shift_change(world, entity);
    // A departure a reading order deferred belongs to the old shift, as an
    // assignment drops it for the old job.
    world
        .entity_mut(entity)
        .remove::<crate::reading::PendingShift>();
    let today = world.resource::<SimClock>().tick / u64::from(pack.tuning.day_ticks);
    let mut careers = world.resource_mut::<Careers>();
    let record = careers
        .records
        .entry(sim)
        .or_insert_with(|| Record::new(job));
    record.consecutive_good = 0;
    record.shift = shift;
    // The owner's ruling of 2026-10-23: the change takes effect from the
    // next day, so a shift worked today is the day's only one.
    careers.shift_changed.insert(sim, today);
    None
}

fn assign_or_refuse(
    world: &mut World,
    agent: u32,
    path: Option<u32>,
    chosen: Option<u32>,
) -> Option<CareerRefusal> {
    let pack = world.resource::<Content>().0;
    let (entity, sim) = match person_at_home(world, agent) {
        Ok(person) => person,
        Err(reason) => return Some(reason),
    };
    match path {
        Some(path) => {
            let Some(&row) = pack
                .career_paths
                .get(path as usize)
                .and_then(|path| path.levels.first())
            else {
                return Some(CareerRefusal::UnknownPath);
            };
            let job = &pack.careers[row as usize];
            if chosen.is_some_and(|shift| !job.offers(shift as usize)) {
                return Some(CareerRefusal::ShiftNotOffered);
            }
            crate::attendance::close_for_career_change(world, entity);
            let mut careers = world.resource_mut::<Careers>();
            // A new job starts as it always has; the next-day rule is a
            // shift change's.
            careers.shift_changed.remove(&sim);
            let shift = match chosen {
                Some(shift) => shift,
                None => crate::shifts::draw(&mut careers, job),
            };
            careers.records.insert(
                sim,
                Record {
                    shift,
                    ..Record::new(job)
                },
            );
            world
                .entity_mut(entity)
                .insert(Career(row))
                .remove::<crate::reading::PendingShift>();
        }
        None => {
            crate::attendance::close_for_career_change(world, entity);
            let mut careers = world.resource_mut::<Careers>();
            careers.records.remove(&sim);
            careers.shift_changed.remove(&sim);
            world
                .entity_mut(entity)
                .remove::<Career>()
                .remove::<crate::reading::PendingShift>();
        }
    }
    None
}

/// The older household command (rule 15 before issue 297), which a save
/// can still hold queued: the change setting, and every living person's
/// job search.
pub(crate) fn set_autonomy(world: &mut World, change: bool, search: bool) {
    let living = people(world);
    let mut careers = world.resource_mut::<Careers>();
    careers.autonomous_change = change;
    for (sim, _) in living {
        careers.set_search(sim, search);
    }
}

/// Whether people change path on their own: one household setting.
pub(crate) fn set_change(world: &mut World, change: bool) {
    world.resource_mut::<Careers>().autonomous_change = change;
}

/// Turns the job search of the person carrying entity index `agent` on or
/// off. An index that names no living person changes nothing; like the
/// other settings, the command is not counted with the career commands.
pub(crate) fn set_search(world: &mut World, agent: u32, search: bool) {
    let Some(sim) = crate::family::sim_id_at(world, agent) else {
        return;
    };
    world
        .resource_mut::<Careers>()
        .set_search(SimId(sim), search);
}

/// The careers' part of the world hash: written only once the resource
/// differs from a new game's, with every employed person's job, so an
/// untouched world hashes as it always did.
pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    let Some(careers) = world.get_resource::<Careers>() else {
        return;
    };
    if careers.is_pristine() {
        return;
    }
    hash.write_bytes(b"careers-v1");
    careers.hash_into(hash);
    hash_shifts(world, careers, hash);
    hash_shift_changes(world, hash);
    let mut jobs: Vec<(u32, u32)> = world
        .try_query_filtered::<(&SimId, &Career), With<Agent>>()
        .map(|mut query| {
            query
                .iter(world)
                .map(|(sim, career)| (sim.0, career.0))
                .collect()
        })
        .unwrap_or_default();
    jobs.sort_unstable();
    hash.write_u64(jobs.len() as u64);
    for (sim, career) in jobs {
        hash.write_u64(u64::from(sim));
        hash.write_u64(u64::from(career));
    }
}

/// Issue 296, [WS-determinism] item 3: after the people whose search is
/// off, the shift stream, its draw count and every held shift other than
/// the standard one, by sim id and shift id; written only once the stream
/// has been drawn or someone holds another shift, so a world of standard
/// shifts hashes as it did before shifts existed.
fn hash_shifts(world: &World, careers: &Careers, hash: &mut FnvHasher) {
    let held = held_shifts(world);
    if careers.shift_draws == 0 && held.is_empty() {
        return;
    }
    hash.write_bytes(b"career-shifts-v1");
    careers.shift_rng.hash_into(hash);
    hash.write_u64(careers.shift_draws);
    hash.write_u64(held.len() as u64);
    for row in &held {
        hash.write_u64(u64::from(row.sim));
        hash.write_u64(row.shift.len() as u64);
        hash.write_bytes(row.shift.as_bytes());
    }
}

/// The people who changed shift today, by sim id with the day; written only
/// when someone did, so every other world hashes as before the rule.
fn hash_shift_changes(world: &World, hash: &mut FnvHasher) {
    let changes = shift_changes_today(world);
    if changes.is_empty() {
        return;
    }
    hash.write_bytes(b"career-shift-changes-v1");
    hash.write_u64(changes.len() as u64);
    for change in &changes {
        hash.write_u64(u64::from(change.sim));
        hash.write_u64(change.day);
    }
}

/// Every living person who changed shift on the current day, in sim id
/// order: the only changes that still keep a shift from starting.
pub(crate) fn shift_changes_today(world: &World) -> Vec<SavedShiftChange> {
    let Some(careers) = world.get_resource::<Careers>() else {
        return Vec::new();
    };
    let pack = world.resource::<Content>().0;
    let today = world.resource::<SimClock>().tick / u64::from(pack.tuning.day_ticks);
    careers
        .shift_changed
        .iter()
        .filter(|(sim, day)| **day == today && crate::edit::living_entity(world, sim.0).is_some())
        .map(|(sim, day)| SavedShiftChange {
            sim: sim.0,
            day: *day,
        })
        .collect()
}

/// Every living person whose held shift is not their level's standard
/// one, in sim id order, with the shift's id ([WS-save]). A held index past
/// the level's list works the standard shift (`shifts::shift_of`), so it is
/// left out, as the standard shift is.
pub(crate) fn held_shifts(world: &World) -> Vec<SavedHeldShift> {
    let Some(careers) = world.get_resource::<Careers>() else {
        return Vec::new();
    };
    let pack = world.resource::<Content>().0;
    careers
        .records
        .iter()
        .filter(|(_, record)| record.shift != 0)
        .filter_map(|(sim, record)| {
            let entity = crate::edit::living_entity(world, sim.0)?;
            let shift = job_of(world, pack, entity)?.shift(record.shift as usize)?;
            Some(SavedHeldShift {
                sim: sim.0,
                shift: shift.id.to_string(),
            })
        })
        .collect()
}

/// Schema twenty-one's shift block: the stream, its draw count and the
/// held shifts other than the standard ones.
pub(crate) fn saved_shifts(world: &World) -> SavedShifts {
    let (rng, draws) = world.get_resource::<Careers>().map_or_else(
        || (SimRng::from_seed(crate::shifts::SHIFTS_SEED), 0),
        |careers| (careers.shift_rng.clone(), careers.shift_draws),
    );
    SavedShifts {
        rng,
        draws,
        held: held_shifts(world),
        changed_today: shift_changes_today(world),
    }
}

/// Validates and installs schema twenty-one's shift block over a world
/// whose careers the older envelope restored, every held shift standard:
/// each listed person living, holding a job and a career record, listed
/// once in ascending order, with a shift id other than `standard` that
/// their level lists ([WS-save]).
pub(crate) fn restore_shifts(
    world: &mut World,
    saved: SavedShifts,
) -> Result<(), crate::SaveError> {
    use crate::SaveError::InvalidValue;
    let pack = world.resource::<Content>().0;
    if saved.held.windows(2).any(|pair| pair[0].sim >= pair[1].sim) {
        return Err(InvalidValue);
    }
    let mut indices = Vec::with_capacity(saved.held.len());
    for row in &saved.held {
        let entity = crate::edit::living_entity(world, row.sim).ok_or(InvalidValue)?;
        let job = job_of(world, pack, entity).ok_or(InvalidValue)?;
        if world.resource::<Careers>().record(SimId(row.sim)).is_none()
            || row.shift == terri_data::STANDARD_SHIFT_ID
        {
            return Err(InvalidValue);
        }
        let index = job.shift_index(&row.shift).ok_or(InvalidValue)?;
        indices.push((SimId(row.sim), index as u32));
    }
    let today = world.resource::<SimClock>().tick / u64::from(pack.tuning.day_ticks);
    if saved
        .changed_today
        .windows(2)
        .any(|pair| pair[0].sim >= pair[1].sim)
    {
        return Err(InvalidValue);
    }
    for change in &saved.changed_today {
        crate::edit::living_entity(world, change.sim).ok_or(InvalidValue)?;
        if change.day != today
            || world
                .resource::<Careers>()
                .record(SimId(change.sim))
                .is_none()
        {
            return Err(InvalidValue);
        }
    }
    let mut careers = world.resource_mut::<Careers>();
    careers.shift_rng = saved.rng;
    careers.shift_draws = saved.draws;
    for (sim, index) in indices {
        careers.records.get_mut(&sim).expect("checked above").shift = index;
    }
    careers.shift_changed = saved
        .changed_today
        .iter()
        .map(|change| (SimId(change.sim), change.day))
        .collect();
    Ok(())
}

/// Validates a saved careers block against the loaded world (rule 16):
/// every record names a living employed person once, in id order, with pay
/// inside their level's range, scores and job satisfaction inside 0 to
/// 100, history in week order and no week ahead of the clock; every
/// moodlet names a living person and ends within a week of now.
pub(crate) fn validate_saved(world: &World, saved: &SavedCareers) -> Result<(), crate::SaveError> {
    use crate::SaveError::InvalidValue;
    let pack = world.resource::<Content>().0;
    let now = world.resource::<SimClock>().tick;
    let week = week_of(now, pack.tuning.day_ticks);
    if saved.records.len() > 100_000
        || saved
            .records
            .windows(2)
            .any(|pair| pair[0].sim >= pair[1].sim)
    {
        return Err(InvalidValue);
    }
    let in_range = |value: f32| value.is_finite() && (0.0..=100.0).contains(&value);
    for record in &saved.records {
        let Some(entity) = crate::edit::living_entity(world, record.sim) else {
            return Err(InvalidValue);
        };
        let Some(job) = job_of(world, pack, entity) else {
            return Err(InvalidValue);
        };
        if !(job.pay..=job.pay_max).contains(&record.pay)
            || !in_range(record.job_satisfaction)
            || record.shifts.len() > 100_000
            || record.shifts.iter().any(|score| !in_range(*score))
            || record.history.len() > 100_000
            || record
                .history
                .iter()
                .any(|w| !in_range(w.performance) || w.event > EVENT_CHANGED_PATH || w.week >= week)
            || record
                .history
                .windows(2)
                .any(|pair| pair[0].week >= pair[1].week)
            || record.consecutive_poor > 100_000
            || record.consecutive_good > 100_000
            // A review waits only for a person away from home, with the
            // week's scores to review, for a week after the last one
            // reviewed and before the one running.
            || record.review_due.is_some_and(|due| {
                due >= week
                    || (record.shifts.is_empty() && crate::attendance::scheduled_week(world,entity)!=Some(due))
                    || record.history.last().is_some_and(|last| last.week >= due)
                    || (world.get::<AtWork>(entity).is_none()
                        && world.get::<Commuting>(entity).is_none()
                        && crate::attendance::scheduled_week(world,entity)!=Some(due))
            })
        {
            return Err(InvalidValue);
        }
    }
    if saved.moodlets.len() > 100_000 {
        return Err(InvalidValue);
    }
    let mut seen = std::collections::BTreeSet::new();
    for moodlet in &saved.moodlets {
        if !(MOODLET_PROMOTED..=MOODLET_FIRED).contains(&moodlet.kind)
            || moodlet.until_tick > now.saturating_add(10_080)
            || crate::edit::living_entity(world, moodlet.sim).is_none()
            || !seen.insert((moodlet.kind, moodlet.sim))
        {
            return Err(InvalidValue);
        }
    }
    Ok(())
}

/// The Career tab's numbers for `entity`, or `None` for the
/// unemployed: `[path, level, levels, pay, pay_min, pay_max, shifts this
/// week, mean so far, last performance, consecutive poor, consecutive good,
/// advance weeks, job satisfaction, warned, trend, poor threshold, good
/// threshold]`, where trend is 1 when the last three reviews were all
/// good, -1 when all poor, else 0, and the thresholds are the tuning's.
pub fn report(world: &World, entity: Entity) -> Option<Vec<f32>> {
    let pack = world.resource::<Content>().0;
    let job = job_of(world, pack, entity)?;
    let sim = *world.get::<SimId>(entity)?;
    let tuning = &pack.tuning;
    let careers = world.get_resource::<Careers>()?;
    let fresh = Record::new(job);
    let record = careers.record(sim).unwrap_or(&fresh);
    let levels = pack
        .career_paths
        .get(job.path as usize)
        .map_or(1, |path| path.levels.len());
    let mean = if record.shifts.is_empty() {
        -1.0
    } else {
        record.shifts.iter().sum::<f32>() / record.shifts.len() as f32
    };
    let last = record.history.last().map_or(-1.0, |w| w.performance);
    let recent: Vec<f32> = record
        .history
        .iter()
        .rev()
        .take(3)
        .map(|w| w.performance)
        .collect();
    let trend = if recent.len() == 3 && recent.iter().all(|p| *p >= tuning.career_good_threshold) {
        1.0
    } else if recent.len() == 3 && recent.iter().all(|p| *p < tuning.career_poor_threshold) {
        -1.0
    } else {
        0.0
    };
    Some(vec![
        job.path as f32,
        job.level as f32,
        levels as f32,
        record.pay as f32,
        job.pay as f32,
        job.pay_max as f32,
        record.shifts.len() as f32,
        mean,
        last,
        record.consecutive_poor as f32,
        record.consecutive_good as f32,
        job.advance_weeks as f32,
        record.job_satisfaction,
        if record.warned() { 1.0 } else { 0.0 },
        trend,
        tuning.career_poor_threshold,
        tuning.career_good_threshold,
    ])
}

/// The reviewed weeks of `entity` as `[week, performance, event]` triples.
pub fn history(world: &World, entity: Entity) -> Vec<f32> {
    let Some(sim) = world.get::<SimId>(entity) else {
        return Vec::new();
    };
    world
        .get_resource::<Careers>()
        .and_then(|careers| careers.record(*sim))
        .map(|record| {
            record
                .history
                .iter()
                .flat_map(|w| [w.week as f32, w.performance, f32::from(w.event)])
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "job_search_tests.rs"]
mod job_search_tests;

#[cfg(test)]
#[path = "search_tests.rs"]
mod search_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::{CommandQueue, Funds, NeedId, Needs, SimCommand, SimRng};
    use terri_data::Tuning;

    /// The shipped lot with its pack's tuning changed by `edit`: the same
    /// content, so the household and its jobs are the shipped ones, with
    /// the knobs a test needs pinned.
    fn shipped_with(edit: impl FnOnce(&mut Tuning)) -> Sim {
        let mut sim = Sim::new_from_shipped_lot();
        let mut pack = terri_data::pack().clone();
        edit(&mut pack.tuning);
        let pack: &'static ContentPack = Box::leak(Box::new(pack));
        sim.world_mut().insert_resource(Content(pack));
        sim
    }

    /// The shipped lot with every chance pinned to certain or impossible,
    /// so a review's outcome is the one a test asks for.
    fn pinned(edit: impl FnOnce(&mut Tuning)) -> Sim {
        shipped_with(|t| {
            t.career_review_noise = 0.0;
            t.career_fire_base = 0.0;
            t.career_demote_base = 0.0;
            t.career_promote_base = 0.0;
            t.career_raise_base = 0.0;
            t.career_change_chance = 0.0;
            edit(t);
        })
    }

    /// The shipped worker and their id.
    fn worker(sim: &mut Sim) -> (SimId, Entity) {
        let mut query = sim
            .world_mut()
            .query_filtered::<(Entity, &SimId), (With<Agent>, With<Career>)>();
        let (entity, id) = query
            .iter(sim.world())
            .next()
            .expect("the shipped household has a worker");
        let (id, entity) = (*id, entity);
        let job = pack(sim).careers[sim.world().get::<Career>(entity).unwrap().0 as usize].clone();
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .entry(id)
            .or_insert_with(|| Record::new(&job));
        (id, entity)
    }

    fn pack(sim: &Sim) -> &'static ContentPack {
        sim.world().resource::<Content>().0
    }

    fn level_of(sim: &Sim, entity: Entity) -> (u32, u32) {
        let job = job_of(sim.world(), pack(sim), entity).expect("employed");
        (job.path, job.level)
    }

    fn record_of(sim: &Sim, sim_id: SimId) -> Record {
        sim.world()
            .resource::<Careers>()
            .record(sim_id)
            .cloned()
            .expect("a record")
    }

    /// Gives the worker a week of `score` and reviews it.
    fn review_week(sim: &mut Sim, sim_id: SimId, week: u64, score: f32) {
        let pack = pack(sim);
        let world = sim.world_mut();
        let job = {
            let entity = crate::edit::living_entity(world, sim_id.0).expect("alive");
            job_of(world, pack, entity).expect("employed").clone()
        };
        world
            .resource_mut::<Careers>()
            .records
            .entry(sim_id)
            .or_insert_with(|| Record::new(&job))
            .shifts
            .extend([score; 5]);
        let tick = (week + 1) * u64::from(pack.tuning.day_ticks) * 7;
        review(world, week, tick);
    }

    #[test]
    fn the_shift_score_reads_fit_mastery_and_mood_and_stays_inside_the_scale() {
        assert_eq!(shift_score(0.0, 0.5, 0.0), 50.0);
        assert_eq!(shift_score(1.0, 1.0, 1.0), 90.0);
        assert_eq!(shift_score(-1.0, 0.0, -1.0), 10.0);
        assert_eq!(shift_score(0.5, 0.5, 0.0), 60.0);
        assert_eq!(shift_score(0.0, 1.0, 0.0), 60.0);
        assert_eq!(shift_score(0.0, 0.5, 0.5), 55.0);
        assert_eq!(shift_score(3.0, 3.0, 3.0), 100.0);
        assert_eq!(shift_score(-3.0, -3.0, -3.0), 0.0);
    }

    #[test]
    fn social_capacity_reads_shyness_and_the_three_social_traits() {
        let mut sim = Sim::new_from_shipped_lot();
        let pack = pack(&sim);
        let chatterbox = pack
            .traits
            .iter()
            .position(|t| t.id == CHATTERBOX)
            .expect("shipped") as u32;
        let private = pack
            .traits
            .iter()
            .position(|t| t.id == PRIVATE_PERSON)
            .expect("shipped") as u32;
        let person = sim
            .world_mut()
            .spawn((Agent, Traits::from_entries(vec![(chatterbox, 1.0)])))
            .id();
        let shyness = f32::from(crate::shyness::of(sim.world(), person).value());
        let expected = (1.0 - shyness / 100.0 + 0.2).clamp(0.0, 1.0);
        assert_eq!(social_capacity(sim.world(), pack, person), expected);
        sim.world_mut()
            .entity_mut(person)
            .insert(Traits::from_entries(vec![(private, 1.0)]));
        let expected = (1.0 - shyness / 100.0 - 0.2).clamp(0.0, 1.0);
        assert_eq!(social_capacity(sim.world(), pack, person), expected);
    }

    #[test]
    fn fit_sums_the_worn_trait_weights_and_charges_the_social_gap_twice() {
        let mut sim = Sim::new_from_shipped_lot();
        let pack = pack(&sim);
        let person = sim
            .world_mut()
            .spawn((Agent, Traits::from_entries(vec![])))
            .id();
        let capacity = social_capacity(sim.world(), pack, person);
        let mut job = pack.careers[0].clone();
        job.trait_fit = vec![];
        job.social_demand = 1.0;
        let gap = (1.0 - capacity).max(0.0);
        assert_eq!(
            fit(sim.world(), pack, &job, person),
            (-2.0 * gap).clamp(-1.0, 1.0)
        );
        job.social_demand = 0.0;
        job.trait_fit = vec![(0, 0.4), (1, -0.9)];
        sim.world_mut()
            .entity_mut(person)
            .insert(Traits::from_entries(vec![(0, 1.0)]));
        assert_eq!(fit(sim.world(), pack, &job, person), 0.4);
        sim.world_mut()
            .entity_mut(person)
            .insert(Traits::from_entries(vec![(0, 1.0), (1, 0.5)]));
        assert!((fit(sim.world(), pack, &job, person) - -0.5).abs() < 1e-6);
    }

    /// Rule 7's order and clamps, with the draw given.
    #[test]
    fn the_outcome_is_the_first_chance_the_draw_falls_under_in_rule_order() {
        let tuning = Tuning {
            career_poor_threshold: 40.0,
            career_good_threshold: 65.0,
            career_fire_base: 0.5,
            career_demote_base: 0.5,
            career_promote_base: 0.5,
            career_raise_base: 0.5,
            ..terri_data::pack().tuning
        };
        let job = CompiledCareer {
            advance_weeks: 2,
            pay: 100,
            pay_max: 200,
            ..terri_data::pack().careers[0].clone()
        };
        let mut record = Record::new(&job);
        // A poor third week: fire 0.5, then demote 0.5 * 20 / 40 = 0.25.
        record.consecutive_poor = 3;
        let perf = 20.0;
        assert_eq!(
            outcome(&tuning, &job, false, false, &record, perf, 0.49),
            EVENT_FIRED
        );
        assert_eq!(
            outcome(&tuning, &job, false, false, &record, perf, 0.51),
            EVENT_DEMOTION
        );
        assert_eq!(
            outcome(&tuning, &job, false, false, &record, perf, 0.76),
            EVENT_NONE
        );
        // At the path's bottom there is no demotion to fall to.
        assert_eq!(
            outcome(&tuning, &job, false, true, &record, perf, 0.51),
            EVENT_NONE
        );
        // A good week: promote 0.5 * (90 - 50) / 50 = 0.4 once the good
        // streak reaches advance_weeks, then raise 0.4 while pay is below
        // the top.
        let mut record = Record::new(&job);
        record.consecutive_good = 2;
        let perf = 90.0;
        assert_eq!(
            outcome(&tuning, &job, false, false, &record, perf, 0.39),
            EVENT_PROMOTION
        );
        assert_eq!(
            outcome(&tuning, &job, false, false, &record, perf, 0.41),
            EVENT_RAISE
        );
        assert_eq!(
            outcome(&tuning, &job, false, false, &record, perf, 0.81),
            EVENT_NONE
        );
        record.consecutive_good = 1;
        assert_eq!(
            outcome(&tuning, &job, false, false, &record, perf, 0.39),
            EVENT_RAISE
        );
        assert_eq!(
            outcome(&tuning, &job, true, false, &record, perf, 0.0),
            EVENT_RAISE
        );
        record.consecutive_good = 2;
        record.pay = 200;
        assert_eq!(
            outcome(&tuning, &job, true, false, &record, perf, 0.0),
            EVENT_NONE
        );
        // Performance moves the chances: a higher week needs a larger
        // draw to escape an event.
        record.pay = 100;
        let events_at = |perf: f32| {
            (0..100)
                .filter(|d| {
                    outcome(
                        &tuning,
                        &job,
                        false,
                        false,
                        &record,
                        perf,
                        *d as f32 / 100.0,
                    ) != EVENT_NONE
                })
                .count()
        };
        assert!(events_at(90.0) > events_at(60.0));
        assert_eq!(events_at(50.0), 0);
    }

    #[test]
    fn firing_is_impossible_before_the_third_poor_week_and_grows_after_it() {
        let tuning = Tuning {
            career_poor_threshold: 40.0,
            career_fire_base: 0.1,
            ..terri_data::pack().tuning
        };
        let job = terri_data::pack().careers[0].clone();
        let mut record = Record::new(&job);
        for poor in [0, 1, 2] {
            record.consecutive_poor = poor;
            assert_eq!(
                outcome(&tuning, &job, false, true, &record, 0.0, 0.0),
                EVENT_NONE,
                "no dismissal with {poor} poor weeks"
            );
        }
        let fired_draws = |poor: u32| {
            let mut record = Record::new(&job);
            record.consecutive_poor = poor;
            (0..1000)
                .filter(|d| {
                    outcome(&tuning, &job, false, true, &record, 0.0, *d as f32 / 1000.0)
                        == EVENT_FIRED
                })
                .count()
        };
        assert_eq!(fired_draws(3), 100);
        assert_eq!(fired_draws(4), 200);
        assert_eq!(fired_draws(13), 1000, "clamped to certain");
    }

    #[test]
    fn a_review_promotes_and_the_promotion_always_raises_pay() {
        let mut sim = pinned(|t| t.career_promote_base = 1.0);
        let (id, entity) = worker(&mut sim);
        let pack = pack(&sim);
        let path = &pack.career_paths[level_of(&sim, entity).0 as usize];
        let mut week = 0;
        for level in 0..path.levels.len() - 1 {
            let before = record_of(&sim, id).pay;
            let job = &pack.careers[path.levels[level] as usize];
            for _ in 0..job.advance_weeks {
                review_week(&mut sim, id, week, 100.0);
                week += 1;
            }
            let after = record_of(&sim, id);
            let next = &pack.careers[path.levels[level + 1] as usize];
            assert_eq!(
                level_of(&sim, entity).1,
                level as u32 + 1,
                "promoted after {} good weeks",
                job.advance_weeks
            );
            assert!(after.pay > before, "{} > {before}", after.pay);
            assert!(after.pay >= next.pay && after.pay <= next.pay_max);
            assert_eq!(after.history.last().map(|w| w.event), Some(EVENT_PROMOTION));
            assert_eq!((after.consecutive_good, after.consecutive_poor), (0, 0));
        }
        // At the top of the path there is nowhere to go.
        review_week(&mut sim, id, week, 100.0);
        review_week(&mut sim, id, week + 1, 100.0);
        review_week(&mut sim, id, week + 2, 100.0);
        review_week(&mut sim, id, week + 3, 100.0);
        assert_eq!(level_of(&sim, entity).1 as usize, path.levels.len() - 1);
        assert!(sim.world().resource::<Careers>().promoted.active(id, 0));
    }

    #[test]
    fn a_raise_adds_a_quarter_of_the_range_and_stops_at_the_top() {
        let mut sim = pinned(|t| t.career_raise_base = 1.0);
        let (id, _) = worker(&mut sim);
        let job = pack(&sim).careers[0].clone();
        let step = (job.pay_max - job.pay).div_ceil(4).max(1);
        let mut expected = job.pay;
        for week in 0..8 {
            review_week(&mut sim, id, week, 100.0);
            let record = record_of(&sim, id);
            let event = record.history.last().map(|w| w.event);
            if expected < job.pay_max {
                expected = (expected + step).min(job.pay_max);
                assert_eq!(event, Some(EVENT_RAISE));
            } else {
                assert_eq!(event, Some(EVENT_NONE), "nothing to raise at the top");
            }
            assert_eq!(record.pay, expected);
            assert!(record.pay <= job.pay_max);
        }
        assert_eq!(record_of(&sim, id).pay, job.pay_max);
        assert_eq!(raised_pay(&job, job.pay_max), job.pay_max);
        let flat = CompiledCareer {
            pay: 100,
            pay_max: 100,
            ..job.clone()
        };
        assert_eq!(raised_pay(&flat, 100), 100);
        let tiny = CompiledCareer {
            pay: 100,
            pay_max: 101,
            ..job
        };
        assert_eq!(
            raised_pay(&tiny, 100),
            101,
            "at least a dollar, never past the top"
        );
    }

    #[test]
    fn a_review_demotes_and_clamps_pay_into_the_lower_level_and_fires_after_three_poor_weeks() {
        let mut sim = pinned(|t| {
            t.career_demote_base = 1.0;
            t.career_fire_base = 1.0;
        });
        let (id, entity) = worker(&mut sim);
        let pack = pack(&sim);
        let path = &pack.career_paths[0];
        let upper = &pack.careers[path.levels[1] as usize];
        sim.world_mut()
            .entity_mut(entity)
            .insert(Career(path.levels[1]));
        sim.world_mut().resource_mut::<Careers>().records.insert(
            id,
            Record {
                pay: upper.pay_max,
                ..Record::new(upper)
            },
        );
        review_week(&mut sim, id, 0, 0.0);
        let lower = &pack.careers[path.levels[0] as usize];
        assert_eq!(level_of(&sim, entity).1, 0, "demoted");
        let record = record_of(&sim, id);
        assert_eq!(record.pay, lower.pay_max, "clamped into the lower range");
        assert_eq!(record.history.last().map(|w| w.event), Some(EVENT_DEMOTION));
        assert_eq!(record.consecutive_poor, 0, "the streak resets");
        assert!(sim.world().resource::<Careers>().demoted.active(id, 0));
        // At the bottom there is nothing to demote to; the third poor
        // week in a row dismisses.
        review_week(&mut sim, id, 1, 10.0);
        review_week(&mut sim, id, 2, 10.0);
        assert!(sim.world().get::<Career>(entity).is_some());
        assert!(
            record_of(&sim, id).warned(),
            "two poor weeks carry a warning"
        );
        review_week(&mut sim, id, 3, 10.0);
        assert!(sim.world().get::<Career>(entity).is_none(), "fired");
        assert!(sim.world().resource::<Careers>().record(id).is_none());
        assert!(sim.world().resource::<Careers>().fired.active(id, 0));
    }

    #[test]
    fn a_review_with_no_completed_shift_leaves_the_counters_alone() {
        let mut sim = pinned(|t| t.career_fire_base = 1.0);
        let (id, _) = worker(&mut sim);
        review_week(&mut sim, id, 0, 10.0);
        assert_eq!(record_of(&sim, id).consecutive_poor, 1);
        let world = sim.world_mut();
        review(world, 1, 2 * 1440 * 7);
        assert_eq!(record_of(&sim, id).consecutive_poor, 1);
        assert_eq!(record_of(&sim, id).history.len(), 1);
    }

    /// The balance the shipped bases promise: a person performing at the
    /// middle of the good range, returned to the first level at its
    /// starting pay after each event so that an outcome is always on
    /// offer, sees one event every four to six weeks over two hundred
    /// weeks, is never fired, and every reviewed week lies within the
    /// noise of the mean.
    #[test]
    fn the_shipped_bases_give_a_good_performer_an_event_every_four_to_six_weeks() {
        let mut sim = shipped_with(|t| t.career_change_chance = 0.0);
        let (id, entity) = worker(&mut sim);
        let pack = pack(&sim);
        let tuning = &pack.tuning;
        let middle = (tuning.career_good_threshold + 100.0) / 2.0;
        let first = pack.career_paths[0].levels[0];
        let mut events = [0u32; 6];
        for week in 0..200 {
            review_week(&mut sim, id, week, middle);
            let week_record = record_of(&sim, id)
                .history
                .last()
                .copied()
                .expect("reviewed");
            assert!(
                (week_record.performance - middle).abs() <= tuning.career_review_noise + 1e-3,
                "the noise is bounded: {}",
                week_record.performance
            );
            events[week_record.event as usize] += 1;
            if week_record.event != EVENT_NONE {
                sim.world_mut().entity_mut(entity).insert(Career(first));
                let fresh = Record::new(&pack.careers[first as usize]);
                let mut careers = sim.world_mut().resource_mut::<Careers>();
                // The streaks are the game's own: a promotion already reset
                // them and a raise leaves them running.
                let record = careers.records.get_mut(&id).expect("employed");
                record.pay = fresh.pay;
            }
        }
        let total: u32 = events[1..].iter().sum();
        assert!(
            (200 / 6..=200 / 4).contains(&total),
            "one event every four to six weeks: {events:?}"
        );
        assert_eq!(events[EVENT_FIRED as usize], 0, "never fired: {events:?}");
        assert!(events[EVENT_PROMOTION as usize] > 0 && events[EVENT_RAISE as usize] > 0);
    }

    #[test]
    fn a_completed_shift_pays_the_current_pay_scores_the_week_and_moves_job_satisfaction() {
        let mut sim = shipped_with(|t| t.career_satisfaction_rate = 4.0);
        let (id, entity) = worker(&mut sim);
        let job = pack(&sim).careers[0].clone();
        sim.world_mut().resource_mut::<Careers>().records.insert(
            id,
            Record {
                pay: 140,
                ..Record::new(&job)
            },
        );
        let before = sim.world().resource::<Funds>().0;
        complete_shift(sim.world_mut(), entity);
        assert_eq!(sim.world().resource::<Funds>().0 - before, 140 * 100);
        let record = record_of(&sim, id);
        assert_eq!(record.shifts.len(), 1);
        let pack = pack(&sim);
        let job = &pack.careers[0];
        let expected = shift_score(
            fit(sim.world(), pack, job, entity),
            mastery(sim.world(), pack, job, entity),
            mood_term(sim.world(), entity),
        );
        assert_eq!(record.shifts[0], expected);
        let target = 50.0 + 40.0 * fit(sim.world(), pack, job, entity);
        let moved = if target > 50.0 {
            54.0_f32.min(target)
        } else {
            46.0_f32.max(target)
        };
        assert_eq!(record.job_satisfaction, moved);
    }

    #[test]
    fn a_hated_job_costs_life_satisfaction_on_top_of_the_reward() {
        let mut sim = shipped_with(|t| {
            t.career_job_misery = 50.0;
            t.career_misery_satisfaction = 2.0;
            t.career_satisfaction_rate = 0.0;
        });
        let (id, entity) = worker(&mut sim);
        let job = pack(&sim).careers[0].clone();
        let life = |sim: &Sim| sim.world().get::<Satisfaction>(entity).unwrap().value();
        sim.world_mut().resource_mut::<Careers>().records.insert(
            id,
            Record {
                job_satisfaction: 49.0,
                ..Record::new(&job)
            },
        );
        let before = life(&sim);
        complete_shift(sim.world_mut(), entity);
        let miserable = life(&sim) - before;
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .get_mut(&id)
            .unwrap()
            .job_satisfaction = 51.0;
        let before = life(&sim);
        complete_shift(sim.world_mut(), entity);
        let content = life(&sim) - before;
        assert!(
            (content - job.satisfaction * Satisfaction::REWARD_SCALE).abs() < 1e-6,
            "{content}"
        );
        assert!(
            (miserable - (job.satisfaction - 2.0) * Satisfaction::REWARD_SCALE).abs() < 1e-6,
            "{miserable}"
        );
    }

    #[test]
    fn the_week_is_reviewed_on_its_first_tick_through_the_schedule() {
        let mut sim = pinned(|t| t.career_raise_base = 1.0);
        let (id, _) = worker(&mut sim);
        let week_ticks = 1440 * 7;
        let job = pack(&sim).careers[0].clone();
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .entry(id)
            .or_insert_with(|| Record::new(&job))
            .shifts
            .push(100.0);
        sim.world_mut().resource_mut::<SimClock>().tick = week_ticks - 2;
        sim.tick();
        assert!(record_of(&sim, id).history.is_empty());
        sim.tick();
        let record = record_of(&sim, id);
        assert_eq!(
            record.history,
            vec![Week {
                week: 0,
                performance: 100.0,
                event: EVENT_RAISE
            }]
        );
        assert!(record.shifts.is_empty());
    }

    #[test]
    fn commands_hire_and_fire_and_the_refusals_are_reported() {
        let mut sim = Sim::new_from_shipped_lot();
        let (id, entity) = worker(&mut sim);
        let pack = pack(&sim);
        let cafe = pack
            .career_paths
            .iter()
            .position(|p| p.id == "cafe")
            .expect("shipped") as u32;
        let agent = entity.index_u32();
        let push = |sim: &mut Sim, command: SimCommand| {
            sim.world_mut().resource_mut::<CommandQueue>().push(command);
            sim.tick();
        };
        push(&mut sim, SimCommand::AssignCareer { agent, path: cafe });
        assert_eq!(level_of(&sim, entity), (cafe, 0));
        let record = record_of(&sim, id);
        assert_eq!(
            record.pay,
            pack.careers[pack.career_paths[cafe as usize].levels[0] as usize].pay
        );
        assert_eq!(record.job_satisfaction, 50.0);
        assert!(record.history.is_empty() && record.shifts.is_empty());
        let result = |sim: &Sim| sim.world().resource::<Careers>().last_result;
        assert_eq!(
            result(&sim),
            Some(CareerResult {
                agent,
                reason: None
            })
        );

        push(&mut sim, SimCommand::AssignCareer { agent, path: 99 });
        assert_eq!(
            result(&sim).and_then(|r| r.reason),
            Some(CareerRefusal::UnknownPath)
        );
        assert_eq!(
            level_of(&sim, entity),
            (cafe, 0),
            "a refused command changes nothing"
        );

        let object = sim
            .world_mut()
            .query_filtered::<Entity, With<terri_core::SmartObject>>()
            .iter(sim.world())
            .next()
            .expect("furniture")
            .index_u32();
        push(&mut sim, SimCommand::QuitCareer { agent: object });
        assert_eq!(
            result(&sim).and_then(|r| r.reason),
            Some(CareerRefusal::NotAPerson)
        );

        sim.world_mut().entity_mut(entity).insert(AtWork {
            remaining_ticks: 100,
        });
        push(&mut sim, SimCommand::QuitCareer { agent });
        assert_eq!(
            result(&sim).and_then(|r| r.reason),
            Some(CareerRefusal::AtWork)
        );
        sim.world_mut().entity_mut(entity).remove::<AtWork>();
        sim.world_mut()
            .entity_mut(entity)
            .insert(Commuting::Outbound);
        push(&mut sim, SimCommand::AssignCareer { agent, path: 0 });
        assert_eq!(
            result(&sim).and_then(|r| r.reason),
            Some(CareerRefusal::AtWork)
        );
        // A commuter with no walk clocks in on that tick, so both marks go.
        sim.world_mut()
            .entity_mut(entity)
            .remove::<Commuting>()
            .remove::<AtWork>();

        push(&mut sim, SimCommand::QuitCareer { agent });
        assert_eq!(
            result(&sim),
            Some(CareerResult {
                agent,
                reason: None
            })
        );
        assert!(sim.world().get::<Career>(entity).is_none());
        assert!(sim.world().resource::<Careers>().record(id).is_none());
    }

    #[test]
    fn the_search_hires_the_unemployed_only_while_the_setting_is_on() {
        // At search temperature 0, the best-fit rule from before issue 296:
        // this test's subject is the setting, not the choice of path.
        let mut sim = shipped_with(|t| {
            t.career_search_chance = 1.0;
            t.career_search_temperature = 0.0;
        });
        let (id, entity) = worker(&mut sim);
        sim.world_mut().entity_mut(entity).remove::<Career>();
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .remove(&id);
        set_autonomy(sim.world_mut(), true, false);
        for _ in 0..20 {
            search(sim.world_mut());
        }
        assert!(
            sim.world().get::<Career>(entity).is_none(),
            "no search while off"
        );
        set_autonomy(sim.world_mut(), true, true);
        let mut hired_after = None;
        for attempt in 0..40 {
            search(sim.world_mut());
            if sim.world().get::<Career>(entity).is_some() {
                hired_after = Some(attempt);
                break;
            }
        }
        assert!(hired_after.is_some(), "hired within forty working days");
        let pack = pack(&sim);
        let best = best_path(sim.world(), pack, entity, None, f32::NEG_INFINITY).expect("a path");
        assert_eq!(
            level_of(&sim, entity),
            (best, 0),
            "the best fitting path's first level"
        );
        assert_eq!(
            record_of(&sim, id).pay,
            pack.careers[pack.career_paths[best as usize].levels[0] as usize].pay
        );
        // The employed are not searched for.
        let draws = sim.world().resource::<Careers>().draws;
        search(sim.world_mut());
        assert_eq!(sim.world().resource::<Careers>().draws, draws);
    }

    #[test]
    fn the_search_runs_at_the_search_tick_of_a_weekday_only() {
        let mut sim = shipped_with(|t| {
            t.career_search_chance = 1.0;
            t.career_search_tick = 100;
        });
        let (id, entity) = worker(&mut sim);
        sim.world_mut().entity_mut(entity).remove::<Career>();
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .remove(&id);
        let draws = |sim: &Sim| sim.world().resource::<Careers>().draws;
        // Day 5 is a Saturday: nothing is drawn at its search tick.
        sim.world_mut().resource_mut::<SimClock>().tick = 5 * 1440 + 99;
        sim.tick();
        assert_eq!(draws(&sim), 0);
        // Monday of the next week, the tick before and the tick itself.
        sim.world_mut().resource_mut::<SimClock>().tick = 7 * 1440 + 98;
        sim.tick();
        assert_eq!(draws(&sim), 0);
        sim.tick();
        assert!(draws(&sim) > 0, "the search draws on a weekday");
    }

    /// A chatterbox with no shyness fits the cafe (0.6) far better than
    /// the office (-0.1), so a review with no outcome moves them there;
    /// the same person stays when fit is never below the change line or
    /// while the setting is off.
    #[test]
    fn a_poorly_fitted_person_changes_path_and_a_well_fitted_one_stays() {
        let chatty = |sim: &mut Sim| {
            let (id, entity) = worker(sim);
            let pack = pack(sim);
            let chatterbox = pack
                .traits
                .iter()
                .position(|t| t.id == CHATTERBOX)
                .expect("shipped") as u32;
            sim.world_mut().entity_mut(entity).insert((
                Traits::from_entries(vec![(chatterbox, 1.0)]),
                terri_core::Shyness::new(1).expect("in range"),
            ));
            (id, entity)
        };
        let moving = |t: &mut Tuning| {
            t.career_change_fit = 2.0;
            t.career_change_gap = 0.0;
            t.career_change_chance = 1.0;
        };
        let mut sim = pinned(moving);
        let (id, entity) = chatty(&mut sim);
        let pack = pack(&sim);
        let cafe = pack
            .career_paths
            .iter()
            .position(|p| p.id == "cafe")
            .expect("shipped") as u32;
        let barista = &pack.careers[pack.career_paths[cafe as usize].levels[0] as usize];
        let office = pack.careers[0].path;
        sim.world_mut().resource_mut::<Careers>().records.insert(
            id,
            Record {
                pay: 150,
                consecutive_good: 1,
                job_satisfaction: 70.0,
                ..Record::new(&pack.careers[0])
            },
        );
        let here = fit(sim.world(), pack, &pack.careers[0], entity);
        let there = fit(sim.world(), pack, barista, entity);
        assert!(there > here, "{there} > {here}");
        review_week(&mut sim, id, 0, 50.0);
        assert_eq!(
            level_of(&sim, entity),
            (cafe, 0),
            "moved to the cafe's first level"
        );
        let record = record_of(&sim, id);
        assert_eq!(
            record.history.last().map(|w| w.event),
            Some(EVENT_CHANGED_PATH)
        );
        assert_eq!(record.pay, barista.pay);
        assert_eq!(
            (record.consecutive_good, record.job_satisfaction),
            (0, 50.0)
        );

        let mut sim = pinned(|t| {
            moving(t);
            t.career_change_fit = -1.0;
        });
        let (id, entity) = chatty(&mut sim);
        review_week(&mut sim, id, 0, 50.0);
        assert_eq!(
            level_of(&sim, entity).0,
            office,
            "a well fitted person stays"
        );
        assert_eq!(
            record_of(&sim, id).history.last().map(|w| w.event),
            Some(EVENT_NONE)
        );

        let mut sim = pinned(moving);
        let (id, entity) = chatty(&mut sim);
        set_autonomy(sim.world_mut(), false, true);
        review_week(&mut sim, id, 0, 50.0);
        assert_eq!(
            level_of(&sim, entity).0,
            office,
            "no change while the setting is off"
        );
    }

    #[test]
    fn every_setting_combination_leaves_the_review_running() {
        for (change, search_on) in [(true, true), (true, false), (false, true), (false, false)] {
            let mut sim = pinned(|t| t.career_raise_base = 1.0);
            set_autonomy(sim.world_mut(), change, search_on);
            let settings = sim.world().resource::<Careers>();
            assert_eq!(
                (settings.autonomous_change, settings.search_off.is_empty()),
                (change, search_on)
            );
            let (id, _) = worker(&mut sim);
            let before = record_of(&sim, id).pay;
            review_week(&mut sim, id, 0, 100.0);
            assert!(
                record_of(&sim, id).pay > before,
                "reviewed with {change} {search_on}"
            );
        }
    }

    #[test]
    fn schema_fourteen_round_trips_and_schema_thirteen_loads_with_the_defaults() {
        let mut sim = pinned(|t| t.career_raise_base = 1.0);
        set_autonomy(sim.world_mut(), false, true);
        let (id, _) = worker(&mut sim);
        review_week(&mut sim, id, 0, 100.0);
        review_week(&mut sim, id, 1, 30.0);
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .get_mut(&id)
            .unwrap()
            .shifts
            .push(77.0);
        sim.world_mut().resource_mut::<SimClock>().tick = 3 * 1440 * 7 + 5;
        let saved = sim.save_snapshot_v14();
        assert_eq!(saved.careers.records.len(), 1);
        assert!(!saved.careers.autonomous_change);
        assert_eq!(
            saved.careers.moodlets.len(),
            1,
            "the raise moodlet rides along"
        );
        let mut restored = Sim::new_from_shipped_lot();
        restored.load_snapshot_v14(saved.clone()).expect("loads");
        assert_eq!(
            restored.world().resource::<Careers>().to_saved(),
            saved.careers
        );
        assert_eq!(restored.world_hash(), sim.world_hash());
        assert_eq!(restored.save_snapshot_v14(), saved);

        let mut old = Sim::new_from_shipped_lot();
        old.load_snapshot_v13(sim.save_snapshot_v13())
            .expect("loads");
        let careers = old.world().resource::<Careers>();
        assert!(careers.autonomous_change && careers.search_off.is_empty());
        assert!(careers.records.is_empty());
        let (_, entity) = worker(&mut old);
        let report = report(old.world(), entity).expect("employed");
        assert_eq!(report[3], report[4], "pay at the level's starting pay");
        assert_eq!(report[12], 50.0, "job satisfaction 50");
    }

    #[test]
    fn schema_fourteen_refuses_what_the_world_cannot_account_for() {
        let mut sim = pinned(|t| t.career_raise_base = 1.0);
        let (id, _) = worker(&mut sim);
        review_week(&mut sim, id, 0, 100.0);
        sim.world_mut().resource_mut::<SimClock>().tick = 2 * 1440 * 7;
        let clean = sim.save_snapshot_v14();
        type Change = Box<dyn Fn(&mut terri_core::SaveSnapshotV14)>;
        let cases: Vec<(&str, Change)> = vec![
            (
                "nobody with that id",
                Box::new(|s| s.careers.records[0].sim = 999),
            ),
            (
                "pay above the level",
                Box::new(|s| s.careers.records[0].pay = 10_000),
            ),
            (
                "pay below the level",
                Box::new(|s| s.careers.records[0].pay = 0),
            ),
            (
                "a score past the scale",
                Box::new(|s| s.careers.records[0].shifts.push(101.0)),
            ),
            (
                "a week ahead of the clock",
                Box::new(|s| s.careers.records[0].history[0].week = 5),
            ),
            (
                "history out of order",
                Box::new(|s| {
                    let week = s.careers.records[0].history[0];
                    s.careers.records[0].history.push(week);
                }),
            ),
            (
                "an unknown event",
                Box::new(|s| s.careers.records[0].history[0].event = 9),
            ),
            (
                "job satisfaction past the scale",
                Box::new(|s| s.careers.records[0].job_satisfaction = -1.0),
            ),
            (
                "a moodlet for nobody",
                Box::new(|s| s.careers.moodlets[0].sim = 999),
            ),
            (
                "a moodlet of no kind",
                Box::new(|s| s.careers.moodlets[0].kind = 0),
            ),
            (
                "a moodlet past a week",
                Box::new(|s| s.careers.moodlets[0].until_tick = u64::MAX),
            ),
            (
                "a record for the unemployed",
                Box::new(|s| {
                    let mut other = s.careers.records[0].clone();
                    other.sim += 1;
                    s.careers.records.push(other);
                }),
            ),
            (
                "the same moodlet twice",
                Box::new(|s| {
                    let moodlet = s.careers.moodlets[0];
                    s.careers.moodlets.push(moodlet);
                }),
            ),
            (
                "a review due for a person at home",
                Box::new(|s| {
                    s.careers.records[0].review_due = Some(1);
                    s.careers.records[0].shifts.push(50.0);
                }),
            ),
        ];
        for (case, change) in cases {
            let mut invalid = clean.clone();
            change(&mut invalid);
            let mut live = Sim::new_from_shipped_lot();
            let before = live.world_hash();
            assert!(
                live.load_snapshot_v14(invalid).is_err(),
                "{case} must refuse"
            );
            assert_eq!(live.world_hash(), before, "{case} changes nothing");
        }

        // The week rules, checked on a person at work so that the at-home
        // rule cannot refuse for them; the same person with a due week
        // between the last reviewed and the running one loads.
        let (_, entity) = worker(&mut sim);
        sim.world_mut().entity_mut(entity).insert(AtWork {
            remaining_ticks: 50,
        });
        let mut away = sim.save_snapshot_v14();
        away.careers.records[0].shifts.push(50.0);
        away.careers.records[0].review_due = Some(1);
        let mut live = Sim::new_from_shipped_lot();
        live.load_snapshot_v14(away.clone())
            .expect("a review due while at work loads");
        let away_cases: Vec<(&str, Change)> = vec![
            (
                "a review due for a week still running",
                Box::new(|s| s.careers.records[0].review_due = Some(2)),
            ),
            (
                "a review due for a week already reviewed",
                Box::new(|s| s.careers.records[0].review_due = Some(0)),
            ),
            (
                "a review due with nothing scored",
                Box::new(|s| s.careers.records[0].shifts.clear()),
            ),
        ];
        for (case, change) in away_cases {
            let mut invalid = away.clone();
            change(&mut invalid);
            let mut live = Sim::new_from_shipped_lot();
            let before = live.world_hash();
            assert!(
                live.load_snapshot_v14(invalid).is_err(),
                "{case} must refuse"
            );
            assert_eq!(live.world_hash(), before, "{case} changes nothing");
        }
    }

    #[test]
    fn the_hash_is_silent_for_a_new_game_and_sees_every_career_change() {
        let sim = Sim::new_from_shipped_lot();
        let mut quiet = FnvHasher::default();
        hash(sim.world(), &mut quiet);
        assert_eq!(quiet.finish(), FnvHasher::default().finish());
        let base = sim.world_hash();
        let mut changed = Sim::new_from_shipped_lot();
        set_autonomy(changed.world_mut(), true, false);
        let settings = changed.world_hash();
        assert_ne!(settings, base);
        let (_, entity) = worker(&mut changed);
        let agent = entity.index_u32();
        assign(changed.world_mut(), agent, 1);
        let assigned = changed.world_hash();
        assert_ne!(assigned, settings);
        changed.world_mut().resource_mut::<Careers>().rng = SimRng::from_seed(7);
        assert_ne!(changed.world_hash(), assigned);
        // A quit before any shift leaves no record and no draw; the
        // command count is what tells that world from a new game.
        let mut quit_only = Sim::new_from_shipped_lot();
        let employed = quit_only
            .world_mut()
            .query_filtered::<Entity, (With<Agent>, With<Career>)>()
            .iter(quit_only.world())
            .next()
            .expect("the shipped worker");
        quit(quit_only.world_mut(), employed.index_u32());
        assert!(quit_only.world().get::<Career>(employed).is_none());
        assert_ne!(quit_only.world_hash(), base, "a quit is in the hash");
    }

    #[test]
    fn the_report_reads_the_record_and_the_trend() {
        let mut sim = pinned(|_| {});
        let (id, entity) = worker(&mut sim);
        let fresh = report(sim.world(), entity).expect("employed");
        assert_eq!(fresh[7], -1.0, "no mean before a shift");
        assert_eq!(fresh[8], -1.0, "no last review");
        assert_eq!(fresh[14], 0.0);
        for week in 0..3 {
            review_week(&mut sim, id, week, 90.0);
        }
        let good = report(sim.world(), entity).expect("employed");
        assert_eq!(good[14], 1.0, "three good weeks");
        assert_eq!(good[8], 90.0);
        assert_eq!(good[10], 3.0);
        for week in 3..6 {
            review_week(&mut sim, id, week, 10.0);
        }
        let poor = report(sim.world(), entity).expect("employed");
        assert_eq!(poor[14], -1.0, "three poor weeks");
        assert_eq!(poor[13], 1.0, "warned");
        let triples = history(sim.world(), entity);
        assert_eq!(triples.len(), 18);
        assert_eq!(&triples[..6], &[0.0, 90.0, 0.0, 1.0, 90.0, 0.0]);
        assert_eq!(&triples[15..], &[5.0, 10.0, 0.0]);
        let unemployed = sim.world_mut().spawn(Agent).id();
        assert!(report(sim.world(), unemployed).is_none());
        assert!(history(sim.world(), unemployed).is_empty());
    }

    #[test]
    fn the_job_moodlets_follow_the_record_and_the_timers() {
        let mut sim = shipped_with(|t| {
            t.career_job_misery = 35.0;
            t.career_job_joy = 65.0;
        });
        let (id, entity) = worker(&mut sim);
        let labels = |sim: &Sim| -> Vec<String> {
            sim.mood_of(entity.index_u32())
                .expect("a person")
                .moodlets
                .into_iter()
                .map(|m| m.label)
                .collect()
        };
        let job = pack(&sim).careers[0].clone();
        let with = |sim: &mut Sim, record: Record| {
            sim.world_mut()
                .resource_mut::<Careers>()
                .records
                .insert(id, record);
        };
        with(
            &mut sim,
            Record {
                job_satisfaction: 20.0,
                ..Record::new(&job)
            },
        );
        assert!(labels(&sim).iter().any(|l| l == crate::mood::HATES_THE_JOB));
        with(
            &mut sim,
            Record {
                job_satisfaction: 80.0,
                consecutive_poor: 2,
                ..Record::new(&job)
            },
        );
        let now = labels(&sim);
        assert!(now.iter().any(|l| l == crate::mood::ENJOYS_THE_JOB));
        assert!(now.iter().any(|l| l == crate::mood::WARNED_AT_WORK));
        let tick = sim.world().resource::<SimClock>().tick;
        sim.world_mut()
            .resource_mut::<Careers>()
            .fired
            .record(id, tick + 10);
        assert!(labels(&sim).iter().any(|l| l == crate::mood::FIRED));
        sim.world_mut().resource_mut::<SimClock>().tick = tick + 10;
        tick_expire(&mut sim);
        assert!(!labels(&sim).iter().any(|l| l == crate::mood::FIRED));
    }

    fn tick_expire(sim: &mut Sim) {
        let now = sim.world().resource::<SimClock>().tick;
        sim.world_mut().resource_mut::<Careers>().expire(now);
    }

    /// A week that ends while a person is at work is reviewed when they
    /// come home: the shift they were on is paid at the pay they held, the
    /// review's outcome lands, and the shift's score opens the new week.
    /// A dismissal that fell due the same way leaves them home and
    /// unemployed, paid for the last shift.
    #[test]
    fn a_review_due_while_at_work_is_applied_on_the_return() {
        let week_ticks = 1440 * 7;
        let mut sim = pinned(|t| t.career_raise_base = 1.0);
        let (id, entity) = worker(&mut sim);
        let job = pack(&sim).careers[0].clone();
        {
            let mut careers = sim.world_mut().resource_mut::<Careers>();
            let record = careers.records.get_mut(&id).unwrap();
            record.shifts.extend([100.0; 5]);
        }
        sim.world_mut()
            .entity_mut(entity)
            .insert(AtWork { remaining_ticks: 3 });
        sim.world_mut().resource_mut::<SimClock>().tick = week_ticks;
        review(sim.world_mut(), 0, week_ticks);
        let waiting = record_of(&sim, id);
        assert!(waiting.history.is_empty(), "nothing applied at work");
        assert_eq!(waiting.review_due, Some(0));
        assert_eq!(waiting.shifts.len(), 5);
        assert_eq!(waiting.pay, job.pay);
        sim.world_mut().entity_mut(entity).remove::<AtWork>();
        let funds = sim.world().resource::<Funds>().0;
        complete_shift(sim.world_mut(), entity);
        let reviewed = record_of(&sim, id);
        assert_eq!(
            reviewed.history,
            vec![Week {
                week: 0,
                performance: 100.0,
                event: EVENT_RAISE
            }]
        );
        assert_eq!(reviewed.review_due, None);
        assert_eq!(reviewed.pay, raised_pay(&job, job.pay));
        assert_eq!(
            reviewed.shifts.len(),
            1,
            "the returning shift opens the new week"
        );
        assert_eq!(
            sim.world().resource::<Funds>().0 - funds,
            i64::from(job.pay) * Funds::CENTS_PER_DOLLAR,
            "paid at the pay held while working"
        );

        let mut sim = pinned(|t| t.career_fire_base = 1.0);
        let (id, entity) = worker(&mut sim);
        {
            let mut careers = sim.world_mut().resource_mut::<Careers>();
            let record = careers.records.get_mut(&id).unwrap();
            record.consecutive_poor = 2;
            record.shifts.extend([0.0; 5]);
        }
        sim.world_mut()
            .entity_mut(entity)
            .insert(AtWork { remaining_ticks: 3 });
        sim.world_mut().resource_mut::<SimClock>().tick = week_ticks;
        review(sim.world_mut(), 0, week_ticks);
        assert!(
            sim.world().get::<Career>(entity).is_some(),
            "still employed at work"
        );
        sim.world_mut().entity_mut(entity).remove::<AtWork>();
        let funds = sim.world().resource::<Funds>().0;
        complete_shift(sim.world_mut(), entity);
        assert!(
            sim.world().get::<Career>(entity).is_none(),
            "dismissed on the return"
        );
        assert!(sim.world().resource::<Careers>().record(id).is_none());
        assert!(sim
            .world()
            .resource::<Careers>()
            .fired
            .active(id, week_ticks));
        assert_eq!(
            sim.world().resource::<Funds>().0 - funds,
            i64::from(job.pay) * Funds::CENTS_PER_DOLLAR,
            "the last shift is paid"
        );
    }

    /// A dismissal applied on the return still brings the person home
    /// through the whole tick loop and the shipped door: the walk from
    /// the door ends with the marker off, so the player can hire them
    /// again.
    #[test]
    fn a_person_dismissed_on_the_return_arrives_home_and_can_be_rehired() {
        let week_ticks = 1440 * 7;
        let mut sim = pinned(|t| t.career_fire_base = 1.0);
        set_autonomy(sim.world_mut(), false, false);
        let (id, entity) = worker(&mut sim);
        {
            let mut careers = sim.world_mut().resource_mut::<Careers>();
            let record = careers.records.get_mut(&id).unwrap();
            record.consecutive_poor = 2;
            record.shifts.extend([0.0; 5]);
        }
        sim.world_mut().resource_mut::<SimClock>().tick = week_ticks - 1;
        sim.world_mut()
            .entity_mut(entity)
            .insert(AtWork { remaining_ticks: 2 });
        sim.tick();
        assert_eq!(record_of(&sim, id).review_due, Some(0), "the review waits");
        sim.tick();
        sim.tick();
        assert!(
            sim.world().get::<Career>(entity).is_none(),
            "dismissed on the return"
        );
        assert!(
            sim.world().get::<Commuting>(entity).is_some()
                && sim.world().get::<terri_core::Path>(entity).is_some(),
            "still walking home with the marker on"
        );
        for _ in 0..80 {
            sim.tick();
        }
        assert!(sim.world().get::<Career>(entity).is_none(), "dismissed");
        assert!(
            sim.world().get::<AtWork>(entity).is_none()
                && sim.world().get::<Commuting>(entity).is_none(),
            "home with every marker off"
        );
        assert!(sim.world().resource::<Careers>().record(id).is_none());
        assign(sim.world_mut(), entity.index_u32(), 0);
        assert_eq!(
            sim.world()
                .resource::<Careers>()
                .last_result
                .and_then(|r| r.reason),
            None,
            "hired again"
        );
    }

    /// A week that ends during the walk home is reviewed when the walk
    /// ends, so the next shift is paid at the reviewed pay.
    #[test]
    fn a_review_due_during_the_walk_home_is_applied_on_arrival() {
        let week_ticks = 1440 * 7;
        let mut sim = pinned(|t| t.career_raise_base = 1.0);
        set_autonomy(sim.world_mut(), false, false);
        let (id, entity) = worker(&mut sim);
        let job = pack(&sim).careers[0].clone();
        {
            let mut careers = sim.world_mut().resource_mut::<Careers>();
            let record = careers.records.get_mut(&id).unwrap();
            record.shifts.extend([100.0; 5]);
        }
        let landing = crate::portals::front_portal(pack(&sim))
            .expect("the shipped lot has a door")
            .inward;
        sim.world_mut().resource_mut::<SimClock>().tick = week_ticks - 1;
        sim.world_mut().entity_mut(entity).insert((
            terri_core::Position {
                x: landing.0 as f32,
                y: landing.1 as f32 - 1.0,
            },
            Commuting::Inbound,
            terri_core::Path {
                steps: vec![(landing.0 as i32, landing.1 as i32)],
                cursor: 0,
            },
        ));
        sim.tick();
        assert_eq!(record_of(&sim, id).review_due, Some(0), "the review waits");
        for _ in 0..20 {
            sim.tick();
        }
        assert!(sim.world().get::<Commuting>(entity).is_none(), "home");
        let record = record_of(&sim, id);
        assert_eq!(record.review_due, None);
        assert_eq!(record.history.len(), 1, "reviewed on arrival");
        assert_eq!(record.history[0].event, EVENT_RAISE);
        assert_eq!(record.pay, raised_pay(&job, job.pay));
    }

    /// Death drops the person's record and timers with their other
    /// records, so the next save names only the living.
    #[test]
    fn a_death_drops_the_record_and_the_next_save_still_loads() {
        let mut sim = Sim::new_from_shipped_lot();
        let (id, entity) = worker(&mut sim);
        complete_shift(sim.world_mut(), entity);
        let tick = sim.world().resource::<SimClock>().tick;
        sim.world_mut()
            .resource_mut::<Careers>()
            .fired
            .record(id, tick + 100);
        assert!(sim.world().resource::<Careers>().record(id).is_some());
        crate::mortality::remove_person(sim.world_mut(), entity);
        sim.world_mut().despawn(entity);
        let careers = sim.world().resource::<Careers>();
        assert!(careers.record(id).is_none());
        assert!(!careers.fired.active(id, tick));
        let saved = sim.save_snapshot_v14();
        assert!(saved.careers.records.is_empty() && saved.careers.moodlets.is_empty());
        let mut restored = Sim::new_from_shipped_lot();
        restored
            .load_snapshot_v14(saved)
            .expect("loads without the dead");
        assert_eq!(restored.world_hash(), sim.world_hash());
    }

    /// One week of the shipped household with every working day covered:
    /// Tim keeps the office job and Casey takes the night watch, with the
    /// autonomy off so the week is the same every run. The household is
    /// paid for observed office time, both workers are reviewed against
    /// their scheduled week, nobody dies, and needs retain time to recover.
    #[test]
    fn the_shipped_household_keeps_living_around_its_jobs() {
        let mut sim = Sim::new_from_shipped_lot();
        set_autonomy(sim.world_mut(), false, false);
        let pack = pack(&sim);
        let night = pack
            .careers
            .iter()
            .position(|c| c.id == "night_watch_guard")
            .expect("shipped") as u32;
        let (tim_id, _) = worker(&mut sim);
        let casey = crate::edit::living_entity(sim.world(), 2).expect("alive");
        let casey_id = *sim.world().get::<SimId>(casey).unwrap();
        sim.world_mut().entity_mut(casey).insert(Career(night));
        sim.world_mut()
            .resource_mut::<Careers>()
            .records
            .insert(casey_id, Record::new(&pack.careers[night as usize]));
        let people: Vec<Entity> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        let start = sim.world().resource::<Funds>().0;
        let week_ticks = u64::from(pack.tuning.day_ticks) * 7;
        let mut sums = vec![[0.0_f64; 7]; people.len()];
        let mut observed_work = BTreeMap::<(SimId, u64), u64>::new();
        // Through Monday noon: Sunday's fixed night shift has settled,
        // and Monday's office shift is still running. Count office
        // intervals independently of the saved attendance counter.
        for _ in 0..(week_ticks + 720) {
            for person in &people {
                if sim.world().get::<AtWork>(*person).is_some() {
                    let id = *sim.world().get::<SimId>(*person).unwrap();
                    if let Some(shift) = sim
                        .world()
                        .resource::<crate::attendance::Attendance>()
                        .shifts
                        .get(&id)
                        .filter(|shift| !shift.settled)
                    {
                        *observed_work.entry((id, shift.start_tick)).or_default() += 1;
                    }
                }
            }
            sim.tick();
            for (slot, person) in people.iter().enumerate() {
                let needs = sim.world().get::<Needs>(*person).expect("alive");
                for (need_slot, need) in NeedId::ALL.into_iter().enumerate() {
                    sums[slot][need_slot] += f64::from(needs.get(need));
                }
            }
        }
        let attendance = sim.world().resource::<crate::attendance::Attendance>();
        assert_eq!(
            attendance.outcomes.len(),
            10,
            "five office and five night shifts settle once"
        );
        let mut expected = 0;
        let mut schedules = std::collections::BTreeSet::new();
        for outcome in &attendance.outcomes {
            let id = SimId(outcome.sim);
            assert!(
                schedules.insert((id, outcome.start_tick)),
                "one outcome per scheduled shift"
            );
            assert_eq!(week_of(outcome.start_tick, pack.tuning.day_ticks), 0);
            let worked = observed_work
                .get(&(id, outcome.start_tick))
                .copied()
                .unwrap_or(0);
            assert_eq!(
                outcome.worked_minutes, worked as f32,
                "attendance follows observed office intervals"
            );
            let job = &pack.careers[outcome.career as usize];
            assert_eq!(
                outcome.end_tick - outcome.start_tick,
                u64::from(job.shift_ticks)
            );
            let pay = i64::from(job.pay) * Funds::CENTS_PER_DOLLAR * worked as i64
                / i64::from(job.shift_ticks);
            assert_eq!(
                outcome.pay_cents, pay,
                "commute and time at home earn no pay"
            );
            expected += pay;
        }
        assert_eq!(
            sim.world().resource::<Funds>().0 - start,
            expected,
            "household receives exactly the prorated payments"
        );
        for id in [tim_id, casey_id] {
            assert_eq!(
                attendance
                    .outcomes
                    .iter()
                    .filter(|outcome| outcome.sim == id.0)
                    .count(),
                5
            );
            let record = record_of(&sim, id);
            assert_eq!(
                record.history.len(),
                1,
                "reviewed at the week's end or on the return"
            );
            assert_eq!(record.review_due, None);
            assert_eq!(record.history[0].week, 0);
            assert!(
                record.shifts.is_empty(),
                "Sunday's night shift belongs to its scheduled week"
            );
        }
        for (slot, person) in people.iter().enumerate() {
            assert!(sim.world().get::<Agent>(*person).is_some(), "alive");
            for (need_slot, need) in NeedId::ALL.into_iter().enumerate() {
                let mean = sums[slot][need_slot] / (week_ticks + 720) as f64;
                assert!(mean > 10.0, "{need:?} of person {slot} averaged {mean:.1}");
            }
            let life = sim.world().get::<Satisfaction>(*person).unwrap().value();
            assert!(life > -1.0, "life satisfaction holds: {life}");
        }
    }
}
