//! Stable room identities extend the unchanged published schema-fifteen payload.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV16 {
    pub legacy: crate::SaveSnapshotV15,
    pub rooms: crate::rooms::SavedRooms,
}
