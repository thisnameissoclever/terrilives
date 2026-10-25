//! Bath continuation and current pool coordinates use the frozen V22 inner layout.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedBathEpisode {
    pub actor: u32,
    pub tub: u32,
    pub interaction: u32,
    /// 1 rubber duck, 2 toy boat, 3 toy submarine.
    pub toy: u8,
    pub total: u32,
    pub elapsed: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV23 {
    pub previous: crate::SaveSnapshotV22,
    pub baths: Vec<SavedBathEpisode>,
}
impl std::ops::Deref for SaveSnapshotV23 {
    type Target = crate::SaveSnapshotV22;
    fn deref(&self) -> &Self::Target { &self.previous }
}
impl std::ops::DerefMut for SaveSnapshotV23 {
    fn deref_mut(&mut self) -> &mut Self::Target { &mut self.previous }
}
