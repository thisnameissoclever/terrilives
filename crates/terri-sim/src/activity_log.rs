//! The session activity log - [AL-boundary] in the activity log
//! specification. Fixed-size numeric records of finished household events,
//! staged here for the shell to drain once a frame.
//!
//! Nothing in this module feeds back into the simulation. Emission copies
//! values the simulation has already computed; it draws nothing from
//! `SimRng`, inserts or removes no component, and keeps every piece of state
//! in the one resource below, keyed by `SimId`. `Sim::world_hash` and every
//! save leave that resource out, and `activity_log_never_changes_the_world`
//! is what fails if an emitter starts to matter.

use crate::relationship_effects::{RelationshipCause, RelationshipEffect};
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use std::sync::Mutex;
use terri_core::SimClock;
use terri_data::ContentPack;

/// Little-endian `u32` words in one record ([AL-record]).
pub const RECORD_WORDS: usize = 12;
/// Records the simulation holds before the oldest is overwritten. The shell
/// drains every frame and a frame runs at most five ticks; a household's
/// busiest frame stages under a third of the ring. A frame that stages
/// more, such as a stress page's day end with a feeling from each of a
/// hundred people, overwrites the oldest records and counts them in
/// `dropped`.
pub const STAGING_CAPACITY: usize = 256;
/// The "nobody" and "no label" value of the `other`, `label` and `label2`
/// words.
pub const NONE: u32 = u32::MAX;

/// Trigger mask bits. A line shows when an enabled filter's bit is set in
/// its record or in one of its children. Details and Time never trigger.
pub const ACTIONS: u32 = 1;
pub const CHORES: u32 = 2;
pub const SOCIAL: u32 = 4;
pub const SKILLS: u32 = 8;
pub const CAREER: u32 = 16;

/// Flags in bits 16 to 23 of word 2. Set when the actor's, or the other
/// person's, Social total began before any activity start this world saw,
/// after a Load, so Details omits that total ([AL-capture] item 4).
pub const PARTIAL: u32 = 1 << 16;
pub const OTHER_PARTIAL: u32 = 1 << 17;

/// Bit 8 of a [`LogKind::WeeklyReview`] record's `v0`, above the outcome
/// code: the person carries a warning, from the second poor week in a row.
pub const REVIEW_WARNED: i32 = 1 << 8;

/// Career change codes, the `v0` of a [`LogKind::CareerChange`] record.
pub const CHANGE_HIRED: i32 = 0;
pub const CHANGE_ASSIGNED: i32 = 1;
pub const CHANGE_LEFT: i32 = 2;

/// Chore outcome codes, the `v0` of a [`LogKind::ChoreOutcome`] record.
pub const OUTCOME_DONE: i32 = 0;
pub const OUTCOME_COVERED: i32 = 1;
pub const OUTCOME_SKIPPED: i32 = 2;
pub const OUTCOME_MISSED: i32 = 3;

const SEQ: usize = 0;
const TICK: usize = 1;
const KIND: usize = 2;
const ACTOR: usize = 3;
const OTHER: usize = 4;
const LABEL: usize = 5;
const LABEL2: usize = 6;
const PARENT: usize = 7;
const VALUES: usize = 8;

/// What a record describes. The numbers are the record's `kind` byte and
/// part of the boundary contract with the shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum LogKind {
    ActionDone = 1,
    ChatDone = 2,
    FightDone = 3,
    Annoyed = 4,
    ChoresThisWeek = 5,
    Duty = 6,
    ChoreOutcome = 7,
    Feeling = 8,
    SkillLevel = 9,
    WeeklyReview = 10,
    CareerChange = 11,
    Death = 12,
}

impl LogKind {
    pub const ALL: [Self; 12] = [
        Self::ActionDone,
        Self::ChatDone,
        Self::FightDone,
        Self::Annoyed,
        Self::ChoresThisWeek,
        Self::Duty,
        Self::ChoreOutcome,
        Self::Feeling,
        Self::SkillLevel,
        Self::WeeklyReview,
        Self::CareerChange,
        Self::Death,
    ];

    pub fn from_code(code: u8) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| *kind as u8 == code)
    }
}

/// One event as twelve words: `seq`, `tick`, kind and triggers, `actor`,
/// `other`, `label`, `label2`, `parent`, then four signed values whose
/// meaning depends on the kind ([AL-record]). Built with the `with_` methods
/// and given its `seq` when staged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogRecord(pub [u32; RECORD_WORDS]);

impl LogRecord {
    const EMPTY: Self = Self([0; RECORD_WORDS]);

    pub fn new(kind: LogKind, triggers: u32, tick: u64, actor: u32) -> Self {
        let mut words = [0; RECORD_WORDS];
        words[TICK] = u32::try_from(tick).unwrap_or(u32::MAX);
        words[KIND] = u32::from(kind as u8) | (triggers & 0xff) << 8;
        words[ACTOR] = actor;
        words[OTHER] = NONE;
        words[LABEL] = NONE;
        words[LABEL2] = NONE;
        Self(words)
    }

    pub fn with_other(mut self, other: u32) -> Self {
        self.0[OTHER] = other;
        self
    }

    pub fn with_label(mut self, label: u32) -> Self {
        self.0[LABEL] = label;
        self
    }

    pub fn with_label2(mut self, label: u32) -> Self {
        self.0[LABEL2] = label;
        self
    }

    pub fn with_value(mut self, slot: usize, value: i32) -> Self {
        self.0[VALUES + slot] = value as u32;
        self
    }

    pub fn with_triggers(mut self, triggers: u32) -> Self {
        self.0[KIND] |= (triggers & 0xff) << 8;
        self
    }

    pub fn with_flags(mut self, flags: u32) -> Self {
        self.0[KIND] |= flags & 0x00ff_0000;
        self
    }

    pub fn seq(&self) -> u32 {
        self.0[SEQ]
    }

    pub fn tick(&self) -> u32 {
        self.0[TICK]
    }

    pub fn kind(&self) -> Option<LogKind> {
        LogKind::from_code((self.0[KIND] & 0xff) as u8)
    }

    pub fn triggers(&self) -> u32 {
        (self.0[KIND] >> 8) & 0xff
    }

    /// [`PARTIAL`] and [`OTHER_PARTIAL`].
    pub fn flags(&self) -> u32 {
        self.0[KIND] & 0x00ff_0000
    }

    pub fn actor(&self) -> u32 {
        self.0[ACTOR]
    }

    pub fn other(&self) -> u32 {
        self.0[OTHER]
    }

    pub fn label(&self) -> u32 {
        self.0[LABEL]
    }

    pub fn label2(&self) -> u32 {
        self.0[LABEL2]
    }

    pub fn parent(&self) -> u32 {
        self.0[PARENT]
    }

    pub fn value(&self, slot: usize) -> i32 {
        self.0[VALUES + slot] as i32
    }

    fn involves(&self, person: u32) -> bool {
        self.actor() == person || self.other() == person
    }
}

/// Two signed sixteen-bit halves in one value word, `low` first: a chat's
/// two preferences, or its two Social gains.
pub fn pack_pair(low: i32, high: i32) -> i32 {
    let half = |value: i32| value.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16 as u16;
    (u32::from(half(low)) | u32::from(half(high)) << 16) as i32
}

/// An opinion change in the record's unit: ten-thousandths of the -1 to 1
/// feeling, so 100 units is one point as Details shows it ([AL-record]).
pub fn opinion_units(change: f32) -> i32 {
    (change * 10_000.0).round() as i32
}

/// The two halves [`pack_pair`] packed, `low` first.
pub fn unpack_pair(value: i32) -> (i32, i32) {
    let bits = value as u32;
    (
        i32::from(bits as u16 as i16),
        i32::from((bits >> 16) as u16 as i16),
    )
}

/// The label table: every string a record's `label` or `label2` can name,
/// in a fixed order built from the content pack, each once. The shell reads
/// it once and composes words from it ([AL-strings]); the simulation never
/// builds a string per event.
pub struct Labels {
    names: Vec<String>,
    index: BTreeMap<String, u32>,
}

impl Labels {
    fn build(pack: &ContentPack) -> Self {
        let mut labels = Self {
            names: Vec::new(),
            index: BTreeMap::new(),
        };
        for object in &pack.objects {
            for action in &object.interactions {
                labels.add(&action.label);
            }
        }
        for chain in &pack.chains {
            labels.add(&chain.label);
        }
        let day = pack.tuning.day_ticks.max(1);
        for hour in [0, 12, 18] {
            labels.add(crate::domestic::meal_label(u64::from(hour * day / 24), day));
        }
        for interaction in &pack.social {
            labels.add(&interaction.label);
        }
        labels.add("smalltalk");
        for (tag, _) in crate::social_episode::TOPIC_CODES {
            labels.add(tag);
        }
        for reason in crate::fights::Reason::all() {
            labels.add(crate::fights::Reason::tag(reason));
        }
        // Any other tag a preference can name is still a possible topic.
        for object in &pack.objects {
            for action in &object.interactions {
                action.tags.iter().for_each(|tag| labels.add(tag));
            }
        }
        for chain in &pack.chains {
            for step in &chain.steps {
                step.tags.iter().for_each(|tag| labels.add(tag));
            }
        }
        for definition in &pack.traits {
            labels.add(&definition.tag);
        }
        for member in &pack.household {
            member.hobbies.iter().for_each(|tag| labels.add(tag));
        }
        for skill in &pack.skills {
            labels.add(&skill.label);
        }
        for career in &pack.careers {
            labels.add(&career.label);
        }
        for kind in terri_core::chores::ChoreKind::ALL {
            labels.add(kind.label());
        }
        // A line names an object by its type, such as Toilet, never by its
        // model name.
        for object in &pack.objects {
            labels.add(object.display_name());
        }
        for kind in &pack.affinities {
            labels.add(&kind.label);
        }
        for cause in crate::relationship_effects::RelationshipCause::ALL {
            labels.add(cause.log_label());
        }
        labels
    }

    fn add(&mut self, text: &str) {
        if !self.index.contains_key(text) {
            self.index.insert(text.to_owned(), self.names.len() as u32);
            self.names.push(text.to_owned());
        }
    }

    pub fn names(&self) -> &[String] {
        &self.names
    }

    /// The label's index, or [`NONE`] for a string the content never
    /// names, which the shell shows as a generic word.
    pub fn index(&self, text: &str) -> u32 {
        self.index.get(text).copied().unwrap_or(NONE)
    }
}

/// The label table for `pack`, built on first use and kept for the life of
/// the process. Packs are `'static` and few, one per test fixture at most,
/// so each table is built once rather than once per world: a Build
/// transaction restores a fresh world for every command.
pub fn labels(pack: &'static ContentPack) -> &'static Labels {
    static TABLES: Mutex<Vec<(usize, &'static Labels)>> = Mutex::new(Vec::new());
    let key = pack as *const ContentPack as usize;
    let mut tables = TABLES.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some(&(_, table)) = tables.iter().find(|(owner, _)| *owner == key) {
        return table;
    }
    let table: &'static Labels = Box::leak(Box::new(Labels::build(pack)));
    tables.push((key, table));
    table
}

/// The staging ring and the scratch state emitters accumulate across ticks.
/// Never saved, never hashed, never read by a simulation system. A Load
/// builds a fresh world and with it an empty log; a Build transaction
/// carries this resource across its world swaps in `copy_feedback`.
#[derive(Resource)]
pub struct ActivityLog {
    ring: Box<[LogRecord]>,
    head: usize,
    len: usize,
    next_seq: u32,
    dropped: u32,
    enabled: bool,
    /// The first `seq` the end-of-tick link pass has not yet seen.
    unlinked: u32,
    scratch: Scratch,
    /// The records the last [`ActivityLog::take_export`] moved, which the
    /// wasm bridge points the shell at ([AL-bridge]). Preallocated for a full
    /// ring, so a take never allocates.
    export: Vec<u32>,
}

/// Values emitters accumulate across ticks, keyed by `SimId` so no ECS
/// layout ever reaches them ([AL-boundary] rule 2).
#[derive(Clone, Default)]
struct Scratch {
    /// What each person's current activity has delivered so far.
    company: BTreeMap<u32, Company>,
    /// Open disliked-object episodes by affected and responsible person.
    nuisances: BTreeMap<(u32, u32), Nuisance>,
    /// This pass's chat and fight feelings, waiting for the record of the
    /// conversation that caused them.
    feelings: Vec<HeldFeeling>,
}

#[derive(Clone, Copy)]
struct Nuisance {
    last_tick: u64,
    change: f32,
    object: u32,
}

/// What one person's current activity has delivered: Social in need
/// points, the opinion change from sharing the activity, and the first
/// companion seen. `partial` when no activity start reset it in this world.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Company {
    pub social: f32,
    pub opinion: f32,
    pub companion: Option<u32>,
    pub partial: bool,
}

impl Company {
    const UNSEEN: Self = Self {
        social: 0.0,
        opinion: 0.0,
        companion: None,
        partial: true,
    };

    /// Social in tenths of a point, the record's unit.
    pub fn social_tenths(&self) -> i32 {
        (self.social * 10.0).round() as i32
    }
}

/// The skill an action practiced and where it stands afterwards.
pub(crate) struct Practiced {
    label: &'static str,
    level: i32,
    percent: i32,
}

/// The first of the pack's skills that `tags` train, read from `skills`
/// after practice has been added. Reads only.
pub(crate) fn practiced(
    skills: Option<&terri_core::Skills>,
    pack: &'static ContentPack,
    tags: &[String],
) -> Option<Practiced> {
    let skills = skills?;
    let ladder = crate::skills::Ladder::from_tuning(&pack.tuning);
    let (index, skill) = pack
        .skills
        .iter()
        .enumerate()
        .find(|(_, skill)| tags.contains(&skill.tag))?;
    let standing = crate::skills::standing(&ladder, skill.levels, skills.practice(index as u32));
    Some(Practiced {
        label: &skill.label,
        level: i32::from(standing.level),
        percent: (standing.progress * 100.0).floor() as i32,
    })
}

/// One opinion change held for the record that explains it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HeldFeeling {
    pub cause: RelationshipCause,
    pub affected: u32,
    pub responsible: u32,
    pub change: f32,
}

/// A Build transaction clones the log into its candidate world. A derived
/// clone would copy only the export buffer's contents, so the clone's next
/// take would allocate; this one keeps room for a full ring.
impl Clone for ActivityLog {
    fn clone(&self) -> Self {
        let mut export = Vec::with_capacity(STAGING_CAPACITY * RECORD_WORDS);
        export.extend_from_slice(&self.export);
        Self {
            ring: self.ring.clone(),
            head: self.head,
            len: self.len,
            next_seq: self.next_seq,
            dropped: self.dropped,
            enabled: self.enabled,
            unlinked: self.unlinked,
            scratch: self.scratch.clone(),
            export,
        }
    }
}

impl Default for ActivityLog {
    fn default() -> Self {
        Self {
            ring: vec![LogRecord::EMPTY; STAGING_CAPACITY].into_boxed_slice(),
            head: 0,
            len: 0,
            next_seq: 1,
            dropped: 0,
            enabled: true,
            unlinked: 1,
            scratch: Scratch::default(),
            export: Vec::with_capacity(STAGING_CAPACITY * RECORD_WORDS),
        }
    }
}

impl ActivityLog {
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// Turns emission on or off for the disabled performance baseline.
    pub(crate) fn set_enabled(&mut self, on: bool) {
        self.enabled = on;
        if !on {
            self.scratch = Scratch::default();
        }
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Records overwritten in the ring before anything drained them.
    pub fn dropped(&self) -> u32 {
        self.dropped
    }

    /// The export buffer's capacity in words, for the allocation tests.
    #[cfg(test)]
    pub(crate) fn export_capacity(&self) -> usize {
        self.export.capacity()
    }

    /// Entries the scratch area holds: Social totals by person, open
    /// nuisance episodes by pair, and the held-feeling buffer's capacity.
    /// Diagnostic only, for the bounded-state measurement of [AL-perf].
    pub fn scratch_sizes(&self) -> (usize, usize, usize) {
        (
            self.scratch.company.len(),
            self.scratch.nuisances.len(),
            self.scratch.feelings.capacity(),
        )
    }

    /// The `seq` the next staged record receives.
    pub fn next_seq(&self) -> u32 {
        self.next_seq
    }

    /// Staged records, oldest first.
    pub fn records(&self) -> impl Iterator<Item = &LogRecord> + '_ {
        (0..self.len).map(move |offset| self.at(offset))
    }

    /// Stages `record` with the next `seq` and returns that `seq`, or 0 when
    /// the log is disabled. A full ring overwrites its oldest record and
    /// counts it as dropped.
    pub fn push(&mut self, mut record: LogRecord) -> u32 {
        if !self.enabled {
            return 0;
        }
        let seq = self.next_seq;
        record.0[SEQ] = seq;
        record.0[PARENT] = 0;
        if self.len == STAGING_CAPACITY {
            self.ring[self.head] = record;
            self.head = (self.head + 1) % STAGING_CAPACITY;
            self.dropped = self.dropped.saturating_add(1);
        } else {
            self.ring[(self.head + self.len) % STAGING_CAPACITY] = record;
            self.len += 1;
        }
        self.next_seq = self.next_seq.wrapping_add(1).max(1);
        seq
    }

    /// Appends every staged record to `out`, oldest first, and empties the
    /// ring. Returns how many records it moved.
    pub fn take_into(&mut self, out: &mut Vec<u32>) -> u32 {
        let count = self.len;
        out.reserve(count * RECORD_WORDS);
        for record in self.records() {
            out.extend_from_slice(&record.0);
        }
        self.head = 0;
        self.len = 0;
        count as u32
    }

    /// Moves every staged record into the export buffer, replacing what the
    /// previous take left there, and returns how many it moved. The shell
    /// copies the buffer out before its next boundary call ([AL-bridge]).
    pub fn take_export(&mut self) -> u32 {
        let mut export = std::mem::take(&mut self.export);
        export.clear();
        let count = self.take_into(&mut export);
        self.export = export;
        count
    }

    /// The records the last [`ActivityLog::take_export`] moved, twelve words
    /// each, oldest first.
    pub fn exported(&self) -> &[u32] {
        &self.export
    }

    /// The label's index in `pack`'s table, or [`NONE`].
    pub fn label(&self, pack: &'static ContentPack, text: &str) -> u32 {
        labels(pack).index(text)
    }

    /// One annoyance as its own line: the affected person, who caused it,
    /// the cause, the object when one is known, and the opinion change
    /// ([AL-sources]).
    pub(crate) fn annoyed(
        &mut self,
        pack: &'static ContentPack,
        effect: &RelationshipEffect,
        object: Option<&str>,
    ) {
        let labels = labels(pack);
        self.push(
            LogRecord::new(LogKind::Annoyed, SOCIAL, effect.tick, effect.affected.0)
                .with_other(effect.responsible.0)
                .with_label(labels.index(effect.cause.log_label()))
                .with_label2(object.map_or(NONE, |name| labels.index(name)))
                .with_value(2, opinion_units(effect.actual)),
        );
    }

    /// One tick of a disliked object in use. The pass that finds the pair
    /// absent for a whole tick, or the last pass of the day, closes the
    /// episode as one line ([AL-group] rule 2).
    pub(crate) fn nuisance(
        &mut self,
        pack: &'static ContentPack,
        effect: &RelationshipEffect,
        object: Option<&str>,
    ) {
        let object = object.map_or(NONE, |name| labels(pack).index(name));
        let episode = self
            .scratch
            .nuisances
            .entry((effect.affected.0, effect.responsible.0))
            .or_insert(Nuisance {
                last_tick: effect.tick,
                change: 0.0,
                object,
            });
        episode.last_tick = effect.tick;
        episode.change += effect.actual;
        episode.object = object;
    }

    /// A chore feeling, staged as a child the link pass attaches to the
    /// chore outcome it answers.
    pub(crate) fn feeling(&mut self, pack: &'static ContentPack, effect: &RelationshipEffect) {
        self.push(
            LogRecord::new(LogKind::Feeling, 0, effect.tick, effect.affected.0)
                .with_other(effect.responsible.0)
                .with_label(labels(pack).index(effect.cause.log_label()))
                .with_value(2, opinion_units(effect.actual)),
        );
    }

    /// A diner's appreciation of the cook, staged under Social as a child
    /// the link pass attaches to the eater's finished meal.
    pub(crate) fn appreciation(&mut self, pack: &'static ContentPack, effect: &RelationshipEffect) {
        self.push(
            LogRecord::new(LogKind::Feeling, SOCIAL, effect.tick, effect.affected.0)
                .with_other(effect.responsible.0)
                .with_label(labels(pack).index(effect.cause.log_label()))
                .with_value(2, opinion_units(effect.actual)),
        );
    }

    /// Holds a chat or fight feeling until that conversation's record is
    /// staged in the same tick.
    pub(crate) fn hold_feeling(&mut self, effect: &RelationshipEffect) {
        self.scratch.feelings.push(HeldFeeling {
            cause: effect.cause,
            affected: effect.affected.0,
            responsible: effect.responsible.0,
            change: effect.actual,
        });
    }

    /// Starts a fresh Social total where an activity begins: a meal
    /// gathering, a chat, an object interaction, a recipe's first step or a
    /// reading session ([AL-capture] item 4).
    pub(crate) fn begin_activity(&mut self, person: u32) {
        if self.enabled {
            self.scratch.company.insert(person, Company::default());
        }
    }

    /// Social delivered to `person` this tick, and who they had company of.
    pub(crate) fn social(&mut self, person: u32, delivered: f32, companion: Option<u32>) {
        if !self.enabled || delivered == 0.0 {
            return;
        }
        let company = self.company_of(person);
        company.social += delivered;
        company.companion = company.companion.or(companion);
    }

    /// A shared-activity opinion change, summed into the activity it
    /// belongs to rather than logged on its own.
    pub(crate) fn shared(&mut self, effect: &RelationshipEffect) {
        let company = self.company_of(effect.affected.0);
        company.opinion += effect.actual;
        company.companion = company.companion.or(Some(effect.responsible.0));
    }

    /// The person's current total, without changing it.
    pub fn company(&self, person: u32) -> Company {
        self.scratch
            .company
            .get(&person)
            .copied()
            .unwrap_or(Company::UNSEEN)
    }

    fn company_of(&mut self, person: u32) -> &mut Company {
        self.scratch
            .company
            .entry(person)
            .or_insert(Company::UNSEEN)
    }

    /// Reads the total an activity delivered and starts the next one fresh.
    fn take_company(&mut self, person: u32) -> Company {
        self.scratch
            .company
            .insert(person, Company::default())
            .unwrap_or(Company::UNSEEN)
    }

    /// Removes and sums the held feelings of `affected` about `responsible`.
    fn take_feeling(&mut self, cause: RelationshipCause, affected: u32, responsible: u32) -> f32 {
        let mut change = 0.0;
        self.scratch.feelings.retain(|held| {
            let claimed =
                held.cause == cause && held.affected == affected && held.responsible == responsible;
            if claimed {
                change += held.change;
            }
            !claimed
        });
        change
    }

    /// Kind 1: an object interaction, a recipe or a book finished. Carries
    /// the Social and shared opinion its company delivered and the skill it
    /// practiced ([AL-record]).
    pub(crate) fn action_done(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        actor: u32,
        label: &str,
        skill: Option<Practiced>,
    ) {
        if !self.enabled {
            return;
        }
        let company = self.take_company(actor);
        self.push_action(pack, tick, actor, label, skill, company);
    }

    /// Kind 1 for finished chore work, which is never company: the line
    /// carries no Social total, shared opinion or companion, whatever an
    /// activity interrupted before it left in the scratch area.
    pub(crate) fn chore_done(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        actor: u32,
        label: &str,
    ) {
        if !self.enabled {
            return;
        }
        self.push_action(pack, tick, actor, label, None, Company::default());
    }

    fn push_action(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        actor: u32,
        label: &str,
        skill: Option<Practiced>,
        company: Company,
    ) {
        let labels = labels(pack);
        let mut record = LogRecord::new(LogKind::ActionDone, ACTIONS, tick, actor)
            .with_other(company.companion.unwrap_or(NONE))
            .with_label(labels.index(label))
            .with_value(0, company.social_tenths())
            .with_value(3, opinion_units(company.opinion));
        if company.social_tenths() > 0 && company.companion.is_some() {
            record = record.with_triggers(SOCIAL);
        }
        if company.partial {
            record = record.with_flags(PARTIAL);
        }
        if let Some(skill) = skill {
            record = record
                .with_label2(labels.index(skill.label))
                .with_value(1, skill.level)
                .with_value(2, skill.percent);
        }
        self.push(record);
    }

    /// Kind 5 with kind 6 children: each owner's duties for the week, one
    /// header per owner in id order. A duty carries its kind's code in
    /// `ChoreKind::ALL` and its target, which the shell turns into the
    /// current room name through `chore_location` ([AL-compose]).
    pub(crate) fn chore_week(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        week: u64,
        assignments: &[terri_core::chores::ChoreAssignment],
        owners: &std::collections::BTreeSet<u32>,
    ) {
        if !self.enabled {
            return;
        }
        let labels = labels(pack);
        for &owner in owners {
            self.push(
                LogRecord::new(LogKind::ChoresThisWeek, CHORES, tick, owner)
                    .with_value(0, i32::try_from(week).unwrap_or(i32::MAX)),
            );
            for duty in assignments.iter().filter(|duty| duty.owner == owner) {
                self.push(
                    LogRecord::new(LogKind::Duty, 0, tick, owner)
                        .with_label(labels.index(duty.key.kind.label()))
                        .with_value(0, chore_kind_code(duty.key.kind))
                        .with_value(1, duty.key.target as i32),
                );
            }
        }
    }

    /// Kind 7: a chore's outcome. `actor` performed it, or owns it when
    /// nobody did; `owner` becomes the other person when someone covered.
    /// The link pass attaches Done and Covered to the performer's action
    /// in the same tick, and the outcome's feelings to the outcome.
    pub(crate) fn chore_outcome(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        (actor, owner): (u32, u32),
        kind: terri_core::chores::ChoreKind,
        outcome: i32,
    ) {
        if !self.enabled {
            return;
        }
        let mut record = LogRecord::new(LogKind::ChoreOutcome, CHORES, tick, actor)
            .with_label(labels(pack).index(kind.label()))
            .with_value(0, outcome);
        if owner != actor {
            record = record.with_other(owner);
        }
        self.push(record);
    }

    /// Kind 10: one weekly review. `review` is the outcome code with
    /// [`REVIEW_WARNED`], the performance, and the factors the Career tab
    /// shows (`careers::factors`), read before the review changed anything;
    /// `title` is the job held afterwards, none after a dismissal.
    pub(crate) fn weekly_review(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        actor: u32,
        review: (i32, f32, [f32; 6]),
        title: Option<&str>,
    ) {
        if !self.enabled {
            return;
        }
        let (outcome, performance, factors) = review;
        let hundredths = |value: f32| (value * 100.0).round() as i32;
        self.push(
            LogRecord::new(LogKind::WeeklyReview, CAREER, tick, actor)
                .with_label(title.map_or(NONE, |title| labels(pack).index(title)))
                .with_value(0, outcome)
                .with_value(1, performance.round() as i32)
                .with_value(2, hundredths(factors[0]))
                .with_value(3, pack_pair(hundredths(factors[4]), hundredths(factors[5]))),
        );
    }

    /// Kind 11: a hire by job search, a career the player assigned, or a
    /// job the player made someone leave, with the level's title.
    pub(crate) fn career_change(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        actor: u32,
        title: Option<&str>,
        change: i32,
    ) {
        if !self.enabled {
            return;
        }
        self.push(
            LogRecord::new(LogKind::CareerChange, CAREER, tick, actor)
                .with_label(title.map_or(NONE, |title| labels(pack).index(title)))
                .with_value(0, change),
        );
    }

    /// Kind 12: a death, under Social ([R3]).
    pub(crate) fn death(&mut self, tick: u64, actor: u32) {
        self.push(LogRecord::new(LogKind::Death, SOCIAL, tick, actor));
    }

    /// Kind 9: each skill `actor` took to a new level. The link pass makes
    /// it a child of the action or chat in the same tick that crossed it; a
    /// recipe step's level-up before its recipe finishes stays its own line.
    pub(crate) fn levels(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        actor: u32,
        rises: crate::skills::LevelUps,
    ) {
        if !self.enabled || rises.is_empty() {
            return;
        }
        let labels = labels(pack);
        for (skill, level) in rises.iter() {
            let label = pack
                .skills
                .get(skill as usize)
                .map_or(NONE, |skill| labels.index(&skill.label));
            self.push(
                LogRecord::new(LogKind::SkillLevel, SKILLS, tick, actor)
                    .with_label(label)
                    .with_value(1, i32::from(level)),
            );
        }
    }

    /// Kind 2 or 3: a finished chat or fight with its topic and both
    /// opinion changes. A chat adds both reactions to the topic, as
    /// preferences times 100, and both Social totals ([AL-record]).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn conversation_done(
        &mut self,
        pack: &'static ContentPack,
        tick: u64,
        initiator: u32,
        listener: u32,
        interaction: &str,
        topic: Option<&crate::social_episode::Topic>,
        fight: bool,
    ) {
        if !self.enabled {
            return;
        }
        let (kind, cause) = if fight {
            (LogKind::FightDone, RelationshipCause::Fight)
        } else {
            (LogKind::ChatDone, RelationshipCause::Conversation)
        };
        let mine = self.take_company(initiator);
        let theirs = self.take_company(listener);
        let spoke = self.take_feeling(cause, initiator, listener);
        let heard = self.take_feeling(cause, listener, initiator);
        let labels = labels(pack);
        let mut record = LogRecord::new(kind, ACTIONS | SOCIAL, tick, initiator)
            .with_other(listener)
            .with_label(labels.index(interaction))
            .with_label2(topic.map_or(NONE, |topic| labels.index(&topic.tag)))
            .with_value(2, opinion_units(spoke))
            .with_value(3, opinion_units(heard));
        if !fight {
            let reaction = |preference: f32| (preference * 100.0).round() as i32;
            record = record
                .with_value(
                    0,
                    topic.map_or(0, |topic| {
                        pack_pair(
                            reaction(topic.initiator_preference),
                            reaction(topic.listener_preference),
                        )
                    }),
                )
                .with_value(1, pack_pair(mine.social_tenths(), theirs.social_tenths()));
            if mine.partial {
                record = record.with_flags(PARTIAL);
            }
            if theirs.partial {
                record = record.with_flags(OTHER_PARTIAL);
            }
        }
        self.push(record);
    }

    /// The feelings held this pass, oldest first.
    pub fn held_feelings(&self) -> &[HeldFeeling] {
        &self.scratch.feelings
    }

    /// The end-of-tick pass ([AL-boundary] rule 4): closes finished
    /// episodes, links every record staged since the last pass to its
    /// parent from the same pass, and forgets feelings nothing claimed.
    pub(crate) fn finish(&mut self, pack: &'static ContentPack, tick: u64, day_ticks: u32) {
        if self.next_seq == self.unlinked && self.scratch.nuisances.is_empty() {
            // Nothing staged and no episode open: nothing to close or link.
            self.scratch.feelings.clear();
            return;
        }
        self.close_nuisances(pack, tick, day_ticks);
        self.link(labels(pack).index(RelationshipCause::MealShared.log_label()));
        self.unlinked = self.next_seq;
        self.scratch.feelings.clear();
    }

    fn close_nuisances(&mut self, pack: &'static ContentPack, tick: u64, day_ticks: u32) {
        let day_ends = (tick + 1).is_multiple_of(u64::from(day_ticks.max(1)));
        let cause = labels(pack).index(RelationshipCause::Nuisance.log_label());
        // Closed in key order, as before, without collecting them into a
        // vector first: the pass runs every tick an episode is open.
        let mut open = std::mem::take(&mut self.scratch.nuisances);
        open.retain(|&(affected, responsible), episode| {
            if !day_ends && episode.last_tick >= tick {
                return true;
            }
            self.push(
                LogRecord::new(LogKind::Annoyed, SOCIAL, episode.last_tick, affected)
                    .with_other(responsible)
                    .with_label(cause)
                    .with_label2(episode.object)
                    .with_value(2, opinion_units(episode.change)),
            );
            false
        });
        self.scratch.nuisances = open;
    }

    /// Children name their parent's `seq`; a child with no parent in its
    /// pass stays a parent itself. Kept to the records staged since the last
    /// pass, so a child never attaches to an earlier tick's event. The
    /// nearest earlier candidate wins, then the nearest later one, so two
    /// chore outcomes in one tick each keep the feelings staged after them.
    ///
    /// A chore feeling no outcome adopts, such as the appreciation of each
    /// washed batch of dishes, joins the appreciated person's own action
    /// line instead; with neither it stays a line of its own. Every feeling
    /// shows under Social, so none is a line no filter shows.
    fn link(&mut self, meal: u32) {
        // Sequence numbers rise through the ring, so this pass's records
        // are its tail.
        let first = (0..self.len)
            .find(|&offset| self.at(offset).seq() >= self.unlinked)
            .unwrap_or(self.len);
        for child in first..self.len {
            let record = *self.at(child);
            let Some(kind) = record.kind() else {
                continue;
            };
            let nearest = |rule: &dyn Fn(&LogRecord) -> bool| {
                (first..child)
                    .rev()
                    .chain(child + 1..self.len)
                    .map(|offset| *self.at(offset))
                    .find(|candidate| rule(candidate))
            };
            let parent =
                nearest(&|candidate| adopts(candidate, kind, &record, meal)).or_else(|| {
                    (kind == LogKind::Feeling && record.label() != meal)
                        .then(|| nearest(&|candidate| adopts_unclaimed_feeling(candidate, &record)))
                        .flatten()
                });
            let slot = (self.head + child) % STAGING_CAPACITY;
            if let Some(parent) = parent {
                self.ring[slot].0[PARENT] = parent.seq();
            }
            if kind == LogKind::Feeling {
                self.ring[slot].0[KIND] |= SOCIAL << 8;
            }
        }
    }

    fn at(&self, offset: usize) -> &LogRecord {
        &self.ring[(self.head + offset) % STAGING_CAPACITY]
    }
}

/// Whether `parent` takes a `kind` record as its child: a duty to its week,
/// a performed chore to the action that did it, a feeling to the chore
/// outcome it answers, a diner's appreciation of the cook to the meal the
/// diner finished, and a skill level to the action or chat that crossed it
/// ([AL-record]). `meal` is the label of the meal appreciation cause.
fn adopts(parent: &LogRecord, kind: LogKind, child: &LogRecord, meal: u32) -> bool {
    match (kind, parent.kind()) {
        (LogKind::Duty, Some(LogKind::ChoresThisWeek)) => parent.actor() == child.actor(),
        (LogKind::ChoreOutcome, Some(LogKind::ActionDone)) => {
            matches!(child.value(0), OUTCOME_DONE | OUTCOME_COVERED)
                && parent.actor() == child.actor()
        }
        (LogKind::Feeling, Some(LogKind::ChoreOutcome)) => {
            child.label() != meal && parent.involves(child.other())
        }
        (LogKind::Feeling, Some(LogKind::ActionDone)) => {
            child.label() == meal && parent.actor() == child.actor()
        }
        (LogKind::SkillLevel, Some(LogKind::ActionDone)) => parent.actor() == child.actor(),
        (LogKind::SkillLevel, Some(LogKind::ChatDone)) => parent.involves(child.actor()),
        _ => false,
    }
}

/// Whether `parent` takes a chore feeling no chore outcome adopted: the
/// appreciated person's own finished action in the same pass.
fn adopts_unclaimed_feeling(parent: &LogRecord, child: &LogRecord) -> bool {
    parent.kind() == Some(LogKind::ActionDone) && parent.actor() == child.other()
}

/// A chore kind's position in `ChoreKind::ALL`, the number the shell's
/// `chore_location` takes.
fn chore_kind_code(kind: terri_core::chores::ChoreKind) -> i32 {
    terri_core::chores::ChoreKind::ALL
        .iter()
        .position(|candidate| *candidate == kind)
        .map_or(-1, |code| code as i32)
}

/// Adds Social delivered to `person` by company this tick, naming the
/// lowest-numbered companion the company resource sees.
pub(crate) fn add_social(world: &mut World, person: Entity, delivered: f32) {
    let enabled = world
        .get_resource::<ActivityLog>()
        .is_some_and(ActivityLog::enabled);
    if delivered == 0.0 || !enabled {
        return;
    }
    let Some(id) = world.get::<terri_core::SimId>(person).copied() else {
        return;
    };
    let companion = world
        .get_resource::<crate::social_company::SocialCompany>()
        .and_then(|company| company.companion(person))
        .map(|other| other.0);
    if let Some(mut log) = world.get_resource_mut::<ActivityLog>() {
        log.social(id.0, delivered, companion);
    }
}

/// Runs the end-of-tick pass. Called by `Sim::tick` and
/// `Sim::flush_commands` after their schedules, never as a scheduled system,
/// so it cannot change the order any system runs in.
pub(crate) fn finish_tick(world: &mut World) {
    let tick = world
        .get_resource::<SimClock>()
        .map_or(0, |clock| clock.tick);
    let Some(pack) = world
        .get_resource::<crate::Content>()
        .map(|content| content.0)
    else {
        return;
    };
    if let Some(mut log) = world.get_resource_mut::<ActivityLog>() {
        if log.enabled {
            log.finish(pack, tick, pack.tuning.day_ticks);
        }
    }
}
