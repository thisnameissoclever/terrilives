//! Household neglect timing extends the frozen schema-eighteen envelope.
use crate::{chores::ChoreKey, SaveSnapshotV18};
use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum NeglectSource {
    Floor(u32),
    Surface(u32),
    Dish(u32),
    Bin(u32),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NeglectTimer {
    pub source: NeglectSource,
    pub actionable_since: u64,
    pub maximum_since: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DutyTimer {
    pub maximum_since: Option<u64>,
    pub key: ChoreKey,
    pub owner: u32,
    pub actionable_since: u64,
}

#[derive(Resource, Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedNeglect {
    /// Unsettled chore episodes observed after their grace expired.
    pub matured_episodes: Vec<u32>,
    pub sources: Vec<NeglectTimer>,
    pub duties: Vec<DutyTimer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV19 {
    pub legacy: SaveSnapshotV18,
    pub neglect: SavedNeglect,
}
