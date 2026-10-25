//! Frozen private editable-world envelope, distinct from published shifts V21.
use crate::{SaveSnapshotV20, WorldSurfaces};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegacyEditableWorldSnapshotV21 {
    pub previous: SaveSnapshotV20,
    pub surfaces: WorldSurfaces,
    /// Entity index and direction: 0 outbound, 1 inbound, 2 waiting to return.
    pub commutes: Vec<(u32, u8)>,
}

impl std::ops::Deref for LegacyEditableWorldSnapshotV21 {
    type Target = SaveSnapshotV20;
    fn deref(&self) -> &Self::Target { &self.previous }
}

impl std::ops::DerefMut for LegacyEditableWorldSnapshotV21 {
    fn deref_mut(&mut self) -> &mut Self::Target { &mut self.previous }
}
