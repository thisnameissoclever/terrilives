//! Player order ownership and scheduled attendance extend the published room-identity save.
use crate::SaveSnapshotV16;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SavedPlayerOrders {
    pub next_acceptance: u64,
    pub orders: Vec<SavedPlayerOrder>,
}

/// Named people use persistent identity; bare agents use the frozen entity mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum SavedOrderActor {
    Sim(u32),
    Entity(u32),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedPlayerOrder {
    pub actor: SavedOrderActor,
    pub order_id: u64,
    pub acceptance: u64,
    pub phase: u8,
    pub active: bool,
    pub started: bool,
    pub explicit_front: bool,
    pub served: bool,
    pub target: u32,
    pub interaction: u32,
    pub cleanup: Option<u32>,
    pub chore: Option<u32>,
    pub chore_key: Option<crate::chores::ChoreKey>,
    pub title_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SavedAttendance {
    pub shifts: Vec<SavedScheduledShift>,
    pub outcomes: Vec<SavedShiftOutcome>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedScheduledShift {
    pub sim: u32,
    pub career: u32,
    pub start_tick: u64,
    pub end_tick: u64,
    pub worked_ticks: u64,
    pub accounted_tick: u64,
    pub pay_cents: i64,
    pub settled: bool,
    /// Older saves counted a shift from arrival rather than its authored start.
    pub legacy: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedShiftOutcome {
    pub sim: u32,
    pub career: u32,
    pub start_tick: u64,
    pub end_tick: u64,
    pub scheduled_minutes: f32,
    pub worked_minutes: f32,
    pub missed_minutes: f32,
    pub base_score: f32,
    pub deduction: f32,
    pub score: f32,
    pub pay_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV17 {
    pub legacy: SaveSnapshotV16,
    pub player_orders: SavedPlayerOrders,
    pub attendance: SavedAttendance,
    /// Staging positions preserve confirmation order relative to older commands.
    pub confirmed_commands: Vec<(u32, u64, crate::command::PlayerOrder)>,
    pub social_executions: Vec<SavedSocialExecution>,
    pub system_social_orders: Vec<(u32, u64)>,
    /// Only retained recipes in the background; omitted actors remain foreground.
    pub background_recipes: Vec<SavedOrderActor>,
}

/// Entity indices use the frozen world's reference mapping, including unnamed people.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedSocialExecution {
    pub initiator: u32,
    pub recipient: u32,
    pub interaction: u32,
    pub provenance: u8,
    pub order_id: Option<u64>,
    pub running: bool,
    pub admitted: bool,
}
