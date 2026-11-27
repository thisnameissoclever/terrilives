//! The previous render position of a walker whose samples differed.

use crate::SaveSnapshotV33;
use serde::{Deserialize, Serialize};

/// One walker's previous displayed position.
///
/// `person` is the saved entity index. `x` and `y` are the render position
/// from the sample before the one that was saved. The path's next step is
/// already the outgoing leg once the walker is standing on a corner, so this
/// position is what a load uses to keep the direction they were walking.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SavedWalkStep {
    pub person: u32,
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV34 {
    pub previous: SaveSnapshotV33,
    /// Strictly ascending by person. A walker whose samples were equal is omitted.
    pub walk_steps: Vec<SavedWalkStep>,
}

impl std::ops::Deref for SaveSnapshotV34 {
    type Target = SaveSnapshotV33;

    fn deref(&self) -> &Self::Target {
        &self.previous
    }
}

impl std::ops::DerefMut for SaveSnapshotV34 {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.previous
    }
}
