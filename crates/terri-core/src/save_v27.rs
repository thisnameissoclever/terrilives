//! The needs mood balance extends schema twenty-four.
use crate::{save_v17::SavedOrderActor, SaveSnapshotV24};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedNeedMood {
    pub actor: SavedOrderActor,
    pub units: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV27 {
    pub legacy: SaveSnapshotV24,
    /// Strictly ordered by actor. Missing actors have a zero balance.
    pub need_mood: Vec<SavedNeedMood>,
}
