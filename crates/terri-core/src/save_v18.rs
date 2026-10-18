//! Job search per person extends the published player-order save: issue
//! 297 (`docs/specs/2026-10-18-job-search-per-person.md`, [JS-save]).
use crate::SaveSnapshotV17;
use serde::{Deserialize, Serialize};

/// A settings command staged just before a save. The published saved
/// command records stay frozen, so these ride beside their queue positions
/// as schema seventeen carries confirmed orders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedQueuedSetting {
    /// `SimCommand::SetJobSearch`, by the entity index the person had.
    JobSearch { agent: u32, search: bool },
    /// `SimCommand::SetCareerChange`.
    CareerChange { change: bool },
}

/// Schema eighteen: the schema-seventeen envelope, then the people who do
/// not look for work on their own. Everyone else does, so a new game, and
/// every newcomer, saves nothing here. The older household field inside
/// the envelope, `SavedCareers::autonomous_search`, is always true in this
/// schema; a schema-seventeen or earlier payload that turned it off loads
/// with every living person's search off.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV18 {
    pub legacy: SaveSnapshotV17,
    /// Sim ids of living people, ascending, each once.
    pub job_search_off: Vec<u32>,
    /// Each queued settings command with its position in the whole command
    /// queue, positions ascending. The envelope's queues hold every other
    /// command in order.
    pub queued_settings: Vec<(u32, SavedQueuedSetting)>,
}
