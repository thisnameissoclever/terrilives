//! Burnt meals extend the frozen schema-ten envelope without changing its
//! records - issue 243.
use crate::SaveSnapshotV10;
use serde::{Deserialize, Serialize};

/// One cook's Burnt dinner moodlet: who, and the tick it ends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedBurntMeal {
    pub sim: u32,
    pub until_tick: u64,
}

/// Schema eleven: the schema-ten envelope, then the burnt meals, sorted by
/// person with one row each. A schema-ten payload is still read as schema
/// ten and loads with no burnt meals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV11 {
    pub legacy: SaveSnapshotV10,
    pub burnt_meals: Vec<SavedBurntMeal>,
}
