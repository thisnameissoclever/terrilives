//! Frozen private pool continuation with its original editable-world inner layout.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedPoolEpisode {
    pub actor: u32,
    pub pool: u32,
    /// 0 approach, 1 entry, 2 paddle, 3 exit, 4 reverse interrupted entry.
    pub phase: u8,
    pub elapsed: u32,
    /// Paddle elapsed at the start of exit; the rendered transition starts there.
    pub exit_origin: u32,
    pub interrupted: bool,
    pub approach: (i32, i32),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegacyEditableWorldSnapshotV22 {
    pub previous: crate::LegacyEditableWorldSnapshotV21,
    pub pools: Vec<SavedPoolEpisode>,
}
impl std::ops::Deref for LegacyEditableWorldSnapshotV22 {
    type Target = crate::LegacyEditableWorldSnapshotV21;
    fn deref(&self) -> &Self::Target { &self.previous }
}
impl std::ops::DerefMut for LegacyEditableWorldSnapshotV22 {
    fn deref_mut(&mut self) -> &mut Self::Target { &mut self.previous }
}
