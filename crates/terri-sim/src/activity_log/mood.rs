use std::collections::{btree_map::Entry, BTreeMap};

use terri_core::SimId;

use crate::mood::MoodBand;

use super::{LogKind, LogRecord, DETAILS, NONE};

const START_POINTS: f32 = 4.0;
const UPDATE_POINTS: f32 = 2.0;
const REVERSAL_POINTS: f32 = 0.75;
const QUIET_TICKS: u64 = 8;
const QUIET_PROGRESS: f32 = 0.1;

/// The cause codes are part of the Log wire format.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u32)]
pub(crate) enum CauseKind {
    Mixed = 0,
    Needs = 1,
    ComfortableCompany = 2,
    UneasyCompany = 3,
    Plants = 4,
    Aquarium = 5,
    BurntDinner = 6,
    Fight = 7,
    Promotion = 8,
    Raise = 9,
    Demotion = 10,
    Dismissal = 11,
    WorkSatisfaction = 12,
    OverdueBills = 13,
    Waiting = 14,
    Grief = 15,
    Condition = 16,
    Mess = 17,
    BedAssignment = 18,
    Repetition = 19,
    Chores = 20,
    DislikedObjectUse = 21,
    Hobby = 22,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct Cause {
    kind: CauseKind,
    other: Option<SimId>,
}

impl Cause {
    const MIXED: Self = Self::new(CauseKind::Mixed, None);

    pub(crate) const fn new(kind: CauseKind, other: Option<SimId>) -> Self {
        Self { kind, other }
    }
}

#[derive(Clone, Copy)]
struct Company {
    affinity: f32,
    proximity: f32,
}

#[derive(Clone, Default)]
pub(crate) struct Observation {
    pub(crate) tick: u64,
    pub(crate) score: f32,
    effects: BTreeMap<Cause, f32>,
    company: BTreeMap<SimId, Company>,
}

impl Observation {
    pub(crate) fn add(&mut self, cause: Cause, score: f32) {
        *self.effects.entry(cause).or_default() += score;
    }

    pub(crate) fn company(&mut self, other: SimId, affinity: f32, proximity: f32) {
        self.company.entry(other).or_insert(Company {
            affinity,
            proximity,
        });
    }

    fn effect(&self, cause: Cause) -> f32 {
        self.effects.get(&cause).copied().unwrap_or(0.0)
    }

    fn company_reached_limit(&self, previous: &Self) -> bool {
        self.company.iter().any(|(other, after)| {
            (after.proximity == 0.0 || after.proximity == 1.0)
                && previous
                    .company
                    .get(other)
                    .is_some_and(|before| after.proximity != before.proximity)
        })
    }

    fn distance_explains(&self, end: &Self, cause: Cause, change: f32) -> bool {
        let sign = match cause.kind {
            CauseKind::ComfortableCompany => 1.0,
            CauseKind::UneasyCompany => -1.0,
            _ => return false,
        };
        let Some(other) = cause.other else {
            return false;
        };
        let Some((before, after)) = self.company.get(&other).zip(end.company.get(&other)) else {
            return false;
        };
        let before_affinity = (before.affinity * sign).max(0.0);
        let after_affinity = (after.affinity * sign).max(0.0);
        // Split the change in affinity times proximity using the mean of each
        // factor. Distance must account for more of the change than affinity.
        let distance =
            sign * (after.proximity - before.proximity) * (before_affinity + after_affinity);
        let affinity = (after_affinity - before_affinity) * (before.proximity + after.proximity);
        distance * change.signum() > affinity.abs() + 1e-5
    }
}

#[derive(Clone, Default)]
pub(super) struct Journal(BTreeMap<SimId, Track>);

impl Journal {
    pub(super) fn observe(
        &mut self,
        actor: SimId,
        observation: Observation,
    ) -> [Option<LogRecord>; 2] {
        let tick = observation.tick;
        match self.0.entry(actor) {
            Entry::Vacant(entry) => {
                entry.insert(Track {
                    tick,
                    phase: Some(Phase::Waiting(observation)),
                });
                [None, None]
            }
            Entry::Occupied(mut entry) => {
                let track = entry.get_mut();
                track.tick = tick;
                let (phase, records) = track.phase.take().unwrap().observe(actor, observation);
                track.phase = Some(phase);
                records
            }
        }
    }

    pub(super) fn retain_observed(&mut self, tick: u64) {
        self.0.retain(|_, track| track.tick == tick);
    }
}

#[derive(Clone)]
struct Track {
    tick: u64,
    phase: Option<Phase>,
}

#[derive(Clone)]
enum Phase {
    Waiting(Observation),
    Moving(Episode),
}

impl Phase {
    fn observe(self, actor: SimId, now: Observation) -> (Self, [Option<LogRecord>; 2]) {
        match self {
            Self::Waiting(previous) if now.score == previous.score => {
                (Self::Waiting(now), [None, None])
            }
            Self::Waiting(previous) => Self::start(actor, previous, now, None),
            Self::Moving(mut episode) => {
                let progress = episode.direction * (now.score - episode.extreme.score);
                if progress <= -REVERSAL_POINTS {
                    let last = episode.finish(actor);
                    return Self::start(actor, episode.extreme, now, last);
                }
                if progress > 0.0 {
                    let at_company_limit = now.company_reached_limit(&episode.extreme);
                    episode.advance(now);
                    let row = episode.publish(actor, at_company_limit);
                    if episode.quiet(episode.extreme.tick) {
                        let final_row = episode.finish(actor);
                        return (Self::Waiting(episode.extreme), [row, final_row]);
                    }
                    (Self::Moving(episode), [row, None])
                } else if episode.quiet(now.tick) {
                    let last = episode.finish(actor);
                    (Self::Waiting(now), [last, None])
                } else {
                    (Self::Moving(episode), [None, None])
                }
            }
        }
    }

    fn start(
        actor: SimId,
        previous: Observation,
        now: Observation,
        last: Option<LogRecord>,
    ) -> (Self, [Option<LogRecord>; 2]) {
        let direction = (now.score - previous.score).signum();
        let mut episode = Episode {
            start: previous,
            progress_tick: now.tick,
            progress_score: now.score,
            extreme: now,
            direction,
            last_sent: None,
        };
        let next = episode.publish(actor, false);
        (Self::Moving(episode), [last, next])
    }
}

#[derive(Clone)]
struct Episode {
    start: Observation,
    extreme: Observation,
    direction: f32,
    progress_tick: u64,
    progress_score: f32,
    last_sent: Option<(u64, f32)>,
}

impl Episode {
    fn advance(&mut self, now: Observation) {
        // An unpublished trend can accumulate even a tiny move in the same
        // direction. A published trend needs enough movement to keep its row active.
        if self.last_sent.is_none() || (now.score - self.progress_score).abs() >= QUIET_PROGRESS {
            self.progress_tick = now.tick;
            self.progress_score = now.score;
        }
        self.extreme = now;
    }

    fn quiet(&self, tick: u64) -> bool {
        tick.saturating_sub(self.progress_tick) >= QUIET_TICKS
    }

    fn publish(&mut self, actor: SimId, at_company_limit: bool) -> Option<LogRecord> {
        let (threshold, reference) = self
            .last_sent
            .map_or((START_POINTS, self.start.score), |(_, score)| {
                (UPDATE_POINTS, score)
            });
        if (self.extreme.score - reference).abs() >= threshold {
            return self.emit(actor);
        }
        if self.last_sent.is_some() && at_company_limit {
            let (cause, change) = self.main_cause();
            if self.start.distance_explains(&self.extreme, cause, change) {
                return self.emit(actor);
            }
        }
        None
    }

    fn finish(&mut self, actor: SimId) -> Option<LogRecord> {
        let (tick, _) = self.last_sent?;
        (tick != self.extreme.tick)
            .then(|| self.emit(actor))
            .flatten()
    }

    fn emit(&mut self, actor: SimId) -> Option<LogRecord> {
        let (primary, change) = self.main_cause();
        let distant = self.start.distance_explains(&self.extreme, primary, change);
        let band = MoodBand::for_score(self.extreme.score);
        self.last_sent = Some((self.extreme.tick, self.extreme.score));
        Some(
            LogRecord::new(LogKind::MoodChange, DETAILS, self.extreme.tick, actor.0)
                .with_other(primary.other.map_or(NONE, |id| id.0))
                .with_label(primary.kind as u32)
                .with_label2((band as u32) << 8 | u32::from(distant))
                .with_value(0, hundredths(self.extreme.score - self.start.score))
                .with_value(1, hundredths(self.extreme.score))
                .with_value(2, u32::try_from(self.start.tick).unwrap_or(u32::MAX) as i32)
                .with_value(3, hundredths(change)),
        )
    }

    fn main_cause(&self) -> (Cause, f32) {
        let mut best = (Cause::MIXED, 0.0_f32);
        let mut contributing = 0.0;
        let effects = self.start.effects.keys().chain(
            self.extreme
                .effects
                .keys()
                .filter(|cause| !self.start.effects.contains_key(*cause)),
        );
        for &cause in effects {
            let change = self.extreme.effect(cause) - self.start.effect(cause);
            if change * self.direction <= 0.0 {
                continue;
            }
            if change.abs() > best.1.abs() {
                best = (cause, change);
            }
            contributing += change.abs();
        }
        if best.1.abs() * 2.0 > contributing {
            best
        } else {
            (Cause::MIXED, 0.0)
        }
    }
}

fn hundredths(points: f32) -> i32 {
    (points * 100.0).round() as i32
}
