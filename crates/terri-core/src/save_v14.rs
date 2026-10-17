//! Careers extend the frozen schema-thirteen envelope without changing its
//! records - issue 249 (`docs/specs/2026-10-17-careers.md`, rule 16).
use crate::SaveSnapshotV13;
use serde::{Deserialize, Serialize};

/// One reviewed week of a person's job: the week number, the performance
/// the review read, and the event it produced (0 none, 1 promotion, 2
/// raise, 3 demotion, 4 dismissal, 5 a change of path).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SavedCareerWeek {
    pub week: u64,
    pub performance: f32,
    pub event: u8,
}

/// One person's standing in their job, sorted by person with one row each.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedCareerRecord {
    pub sim: u32,
    /// Whole dollars per shift, inside the level's range.
    pub pay: u32,
    /// 0 to 100.
    pub job_satisfaction: f32,
    pub consecutive_poor: u32,
    pub consecutive_good: u32,
    /// The current week's shift scores, 0 to 100 each, in order.
    pub shifts: Vec<f32>,
    /// Reviewed weeks in week order.
    pub history: Vec<SavedCareerWeek>,
    /// The week whose review waits for the person to come home from the
    /// shift they were on when it ended, if any.
    pub review_due: Option<u64>,
}

/// A career event moodlet: who, which kind (1 promoted, 2 got a raise, 3
/// demoted, 4 fired) and the tick it ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedCareerMoodlet {
    pub sim: u32,
    pub kind: u8,
    pub until_tick: u64,
}

/// Everything the careers keep between ticks: the two autonomy settings,
/// the careers stream and how often it was drawn, the records, the event
/// moodlets and how many career commands the drain has handled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedCareers {
    pub autonomous_change: bool,
    pub autonomous_search: bool,
    pub rng: crate::SimRng,
    pub draws: u64,
    pub records: Vec<SavedCareerRecord>,
    pub moodlets: Vec<SavedCareerMoodlet>,
    pub commands: u64,
}

/// Schema fourteen: the schema-thirteen envelope, then the careers. A
/// schema-thirteen payload is still read as schema thirteen and loads with
/// the settings on, an empty history, starting pay and job satisfaction 50.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV14 {
    pub legacy: SaveSnapshotV13,
    pub careers: SavedCareers,
}
