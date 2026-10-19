//! Attributable grievances and chore reconciliation wrap frozen schema nineteen.
use crate::{chores::ChoreKey, save_v17::SavedOrderActor, SaveSnapshotV19};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ChoreObligation {
    pub key: ChoreKey,
    pub owner: u32,
    pub actionable_since: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum GrievanceKind {
    PrivacyEntry,
    PrivacyStart,
    Nuisance,
    NeedInterruption,
    Chore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum NuisanceKind {
    Television,
    Music,
    Exercise,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum GrievanceSubject {
    None,
    Chore(ChoreObligation),
    Nuisance { object: u32, kind: NuisanceKind },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedGrievance {
    pub id: u64,
    pub affected: u32,
    pub responsible: u32,
    pub kind: GrievanceKind,
    pub subject: GrievanceSubject,
    pub occurred_at: u64,
    pub last_seen: u64,
    pub active_until: u64,
    pub forget_at: u64,
    pub severity: f32,
    pub last_fought: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedFightContext {
    pub initiator: SavedOrderActor,
    pub recipient: SavedOrderActor,
    pub grievance: Option<u64>,
    pub autonomous: bool,
    pub started_at: u64,
    pub topic_code: u8,
    pub topic_tag: String,
    /// Only historical source adoption may create an unattributed old fight.
    pub legacy: bool,
    pub order_id: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedChoreRepair {
    pub recipient: u32,
    pub initiator: u32,
    pub obligation: ChoreObligation,
    pub fought_at: u64,
    pub deadline: u64,
    pub accepted: bool,
    pub attempted: bool,
    pub working: bool,
    pub witnesses: Vec<u32>,
    /// Real positive dish units washed by this recipient after the argument.
    pub contributed_units: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedDishContribution {
    pub obligation: ChoreObligation,
    pub person: u32,
    pub units: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedConflictState {
    pub next_id: u64,
    pub grievances: Vec<SavedGrievance>,
    pub fights: Vec<SavedFightContext>,
    pub repairs: Vec<SavedChoreRepair>,
    pub dish_contributions: Vec<SavedDishContribution>,
}
impl Default for SavedConflictState {
    fn default() -> Self {
        Self {
            next_id: 1,
            grievances: Vec::new(),
            fights: Vec::new(),
            repairs: Vec::new(),
            dish_contributions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV20 {
    pub legacy: SaveSnapshotV19,
    pub conflicts: SavedConflictState,
}
