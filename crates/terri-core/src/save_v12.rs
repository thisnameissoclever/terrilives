//! Fights extend the frozen schema-eleven envelope without changing its
//! records - issue 248.
use crate::SaveSnapshotV11;
use serde::{Deserialize, Serialize};

/// One person's Had a fight moodlet: who, and the tick it ends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedFight {
    pub sim: u32,
    pub until_tick: u64,
}

/// Schema twelve: the schema-eleven envelope, then the fights, sorted by
/// person with one row each. A schema-eleven payload is still read as
/// schema eleven and loads with no fights.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV12 {
    pub legacy: SaveSnapshotV11,
    pub fights: Vec<SavedFight>,
}
