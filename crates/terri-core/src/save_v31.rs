//! Remembered topic preferences extend schema thirty: issue 359.
use crate::SaveSnapshotV30;
use serde::{Deserialize, Serialize};

/// What one person remembers about how another feels about one topic.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedTopicMemory {
    /// The `SimId` of the person who remembers.
    pub knower: u32,
    /// The `SimId` of the person the memory is about.
    pub other: u32,
    /// The topic tag, as a saved chat names it.
    pub tag: String,
    /// The other person's preference for the topic, finite and from -1 to 1.
    pub preference: f32,
    /// The tick the memory was learned or last refreshed, never after the
    /// saved tick.
    pub tick: u64,
}

/// Schema thirty-one: the schema-thirty envelope, then every remembered
/// topic preference, strictly ascending by knower, other and tag, one row
/// each. A save from before schema thirty-one remembers nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV31 {
    pub current: SaveSnapshotV30,
    pub topic_memory: Vec<SavedTopicMemory>,
}

impl std::ops::Deref for SaveSnapshotV31 {
    type Target = SaveSnapshotV30;

    fn deref(&self) -> &Self::Target {
        &self.current
    }
}

impl std::ops::DerefMut for SaveSnapshotV31 {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.current
    }
}
