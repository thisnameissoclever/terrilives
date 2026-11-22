//! The editable household and its accumulated mood from needs.
use crate::{save_v27::SavedNeedMood, SaveSnapshotV26};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV28 {
    pub editable: SaveSnapshotV26,
    /// Strictly ordered by actor. Missing actors have a zero balance.
    pub need_mood: Vec<SavedNeedMood>,
}

impl std::ops::Deref for SaveSnapshotV28 {
    type Target = SaveSnapshotV26;

    fn deref(&self) -> &Self::Target {
        &self.editable
    }
}

impl std::ops::DerefMut for SaveSnapshotV28 {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.editable
    }
}
