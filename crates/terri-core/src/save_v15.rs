//! Stable room identities extend the unchanged schema-fourteen payload.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV15 {
    pub legacy: crate::SaveSnapshotV14,
    pub rooms: crate::rooms::SavedRooms,
}
