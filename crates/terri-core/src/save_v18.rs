//! Job search per person extends the published player-order save: issue
//! 297 (`docs/specs/2026-10-18-job-search-per-person.md`, [JS-save]).
use crate::SaveSnapshotV17;
use serde::{Deserialize, Serialize};

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
}
