//! The lingering lift of liked furniture extends schema twenty-two: issue 344
//! (`docs/specs/2026-10-06-object-affinities.md`, [OA-presence]).
use crate::SaveSnapshotV22;
use serde::{Deserialize, Serialize};

/// One person's lift from one presence kind of furniture, which fades until
/// `end_tick`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedPresenceFade {
    /// The person's `SimId`.
    pub sim: u32,
    /// The affinity kind's id, as the saved affinity values name it; always
    /// a kind with `presence` reach.
    pub kind: String,
    /// The tick the lift reaches zero.
    pub end_tick: u64,
}

/// Schema twenty-three: the schema-twenty-two envelope, then every lift
/// that is still fading, strictly ascending by person and then kind id,
/// one row each. A save from before schema twenty-three has none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV23 {
    pub legacy: SaveSnapshotV22,
    pub presence_fade: Vec<SavedPresenceFade>,
}
