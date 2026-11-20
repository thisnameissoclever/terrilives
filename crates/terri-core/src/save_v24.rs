//! The Career tab's score inputs and a queued Go to work extend schema
//! twenty-three: issues 311 and 317
//! (`docs/specs/2026-11-19-career-tab.md`, [CT-save]).
use crate::SaveSnapshotV23;
use serde::{Deserialize, Serialize};

/// What one scored shift read: the values its score used and the minutes
/// it missed ([CT-save-memory] item 1).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SavedShiftInputs {
    pub fit: f32,
    pub trait_fit: f32,
    pub social_capacity: f32,
    pub mastery: f32,
    pub mood: f32,
    /// Scheduled minus worked minutes, before the grace period.
    pub missed_minutes: f32,
    /// Whether any minutes were worked.
    pub attended: bool,
}

/// One reviewed week's inputs ([CT-save-memory] item 3): the means of the
/// week's shifts, the sum of their missed minutes, and the career row and
/// pay held during the week.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SavedWeekInputs {
    pub week: u64,
    /// The career row held during the week.
    pub career: u32,
    pub shifts: u32,
    pub attended: u32,
    pub fit: f32,
    pub trait_fit: f32,
    pub social_capacity: f32,
    pub mastery: f32,
    pub mood: f32,
    pub missed_minutes: f32,
    /// Whole dollars per shift, before the review's outcome.
    pub pay: u32,
}

/// One person's kept inputs: the current week's scored shifts in order,
/// the most recent scored shift and the reviewed weeks, oldest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedCareerInputs {
    /// The person's `SimId`.
    pub sim: u32,
    pub current: Vec<SavedShiftInputs>,
    pub last_shift: Option<SavedShiftInputs>,
    pub weeks: Vec<SavedWeekInputs>,
}

/// A queued career command no older schema can record. The published
/// command records stay frozen, so it rides beside its queue position, as
/// schema twenty-one's `SavedQueuedShiftCommand` does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedQueuedWorkCommand {
    /// `SimCommand::GoToWork`, by the entity index the person had.
    GoToWork { agent: u32 },
}

/// Schema twenty-four: the schema-twenty-three envelope, then each person's
/// score inputs that hold any data, strictly ascending by person, then
/// every queued Go to work with its position in the whole command queue,
/// positions ascending. A save from before schema twenty-four has none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV24 {
    pub legacy: SaveSnapshotV23,
    pub career_inputs: Vec<SavedCareerInputs>,
    pub queued_work_commands: Vec<(u32, SavedQueuedWorkCommand)>,
}
