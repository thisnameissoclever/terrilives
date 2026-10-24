//! Shifts extend schema twenty: issue 296
//! (`docs/specs/2026-10-18-shifts-and-careers.md`, [WS-save]).
use crate::{SaveSnapshotV20, SimRng};
use serde::{Deserialize, Serialize};

/// One person whose held shift is not their level's standard shift.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedHeldShift {
    pub sim: u32,
    /// The shift's id at the person's level; never `standard`.
    pub shift: String,
}

/// The shift stream and every held shift other than the standard one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedShifts {
    pub rng: SimRng,
    pub draws: u64,
    /// Ascending by sim id, each person once. Everyone not listed holds
    /// their level's standard shift, so a new game saves an empty list.
    pub held: Vec<SavedHeldShift>,
    /// The people who changed shift on the saved day, ascending by sim id:
    /// none of their shifts starts that day (the owner's ruling of
    /// 2026-10-23). A change on an earlier day no longer matters and is not
    /// saved.
    pub changed_today: Vec<SavedShiftChange>,
}

/// One person's shift change on the saved day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedShiftChange {
    pub sim: u32,
    /// The day number, tick divided by the day's ticks.
    pub day: u64,
}

/// A shift command staged just before a save. The published saved command
/// records stay frozen, so these ride beside their queue positions, as
/// schema eighteen's `SavedQueuedSetting` does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedQueuedShiftCommand {
    /// `SimCommand::AssignCareerShift`, by the entity index the person had.
    AssignCareerShift { agent: u32, path: u32, shift: u32 },
    /// `SimCommand::ChangeShift`, by the entity index the person had.
    ChangeShift { agent: u32, shift: u32 },
}

/// Schema twenty-one: the schema-twenty envelope, then the shifts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV21 {
    pub legacy: SaveSnapshotV20,
    pub shifts: SavedShifts,
    /// Each queued shift command with its position in the whole command
    /// queue, positions ascending. The envelope holds every other command
    /// in order, its settings among them by their own positions.
    pub queued_shift_commands: Vec<(u32, SavedQueuedShiftCommand)>,
}
