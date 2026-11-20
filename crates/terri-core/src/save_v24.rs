//! Frozen private continuation combines published shifts with the ordinary editable world.
use crate::save_editable_v22::SavedPoolEpisode;
use crate::save_editable_v23::SavedBathEpisode;
use crate::{SaveSnapshotV21, WorldSurfaces};
use serde::{Deserialize, Serialize};

/// Fixed positional order: published V21, surfaces, commutes, current pools, baths.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV24 {
    pub previous: SaveSnapshotV21,
    pub surfaces: WorldSurfaces,
    pub commutes: Vec<(u32, u8)>,
    pub pools: Vec<SavedPoolEpisode>,
    pub baths: Vec<SavedBathEpisode>,
}

impl SaveSnapshotV24 {
    pub fn gameplay_v20(&self) -> &crate::SaveSnapshotV20 {
        &self.previous.legacy
    }
    pub fn gameplay_v20_mut(&mut self) -> &mut crate::SaveSnapshotV20 {
        &mut self.previous.legacy
    }

    pub fn room_world_v16(&self) -> &crate::SaveSnapshotV16 {
        &self.gameplay_v20().legacy.legacy.legacy.legacy
    }

    pub fn room_world_v16_mut(&mut self) -> &mut crate::SaveSnapshotV16 {
        &mut self.gameplay_v20_mut().legacy.legacy.legacy.legacy
    }
}

/// Historical gameplay records retain the same schema-twenty field view.
impl std::ops::Deref for SaveSnapshotV24 {
    type Target = crate::SaveSnapshotV20;
    fn deref(&self) -> &Self::Target {
        self.gameplay_v20()
    }
}

impl std::ops::DerefMut for SaveSnapshotV24 {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.gameplay_v20_mut()
    }
}
