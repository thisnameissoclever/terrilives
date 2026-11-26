//! Active hobby mood progress extends the public V32 payload shape.

use crate::{save_v17::SavedOrderActor, SaveSnapshotV31};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedHobbyMood {
    pub actor: SavedOrderActor,
    pub minutes: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV33 {
    pub previous: SaveSnapshotV31,
    /// Strictly ascending by actor. An omitted actor has zero progress.
    pub hobby_mood: Vec<SavedHobbyMood>,
}

impl std::ops::Deref for SaveSnapshotV33 {
    type Target = SaveSnapshotV31;

    fn deref(&self) -> &Self::Target {
        &self.previous
    }
}

impl std::ops::DerefMut for SaveSnapshotV33 {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.previous
    }
}
