//! Explicit world surfaces and commute direction. Earlier envelopes remain frozen.
use crate::SaveSnapshotV20;
use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

/// Row-major base surface: 0 is interior floor, 1 grass, 2 street.
/// Player floor coverings remain in SavedFloors and override this base.
#[derive(Resource, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldSurfaces {
    pub width: u32,
    pub height: u32,
    pub tiles: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV21 {
    pub previous: SaveSnapshotV20,
    pub surfaces: WorldSurfaces,
    /// Entity index and direction: 0 outbound, 1 inbound, 2 waiting to return.
    pub commutes: Vec<(u32, u8)>,
}
impl std::ops::Deref for SaveSnapshotV21 {
    type Target = SaveSnapshotV20;
    fn deref(&self) -> &Self::Target {
        &self.previous
    }
}
impl std::ops::DerefMut for SaveSnapshotV21 {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.previous
    }
}
