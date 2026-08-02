//! Stable, engine-free data carried by a version 1 save file.
//!
//! These are wire types, not ECS components. Entity references use saved
//! entity indices and content references use authored string ids. Neither a
//! Bevy `Entity` nor a compiled-pack index is meaningful in a different world.

use crate::{SimRng, NEED_COUNT};
use serde::{Deserialize, Serialize};

/// Raw prefix written before the postcard payload.
pub const SAVE_MAGIC: [u8; 8] = *b"TERRISAV";

/// The current payload schema. The prefix is decoded before postcard so an
/// incompatible future payload is reported as incompatible, not merely corrupt.
pub const SAVE_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV1 {
    /// Hash of the compiled content bytes this simulation is using.
    pub content_fingerprint: u64,
    pub tick: u64,
    pub rng: SimRng,
    pub funds: i64,
    pub issued_sim_ids: u32,
    pub grid_width: u32,
    pub grid_height: u32,
    pub blocked_tiles: Vec<bool>,
    pub entities: Vec<SavedEntity>,
    pub queued_commands: Vec<SavedCommand>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedEntity {
    pub index: u32,
    pub position: Option<SavedPosition>,
    pub agent: bool,
    pub smart_object: Option<String>,
    pub reserved: bool,
    pub path: Option<SavedPath>,
    pub target: Option<SavedTarget>,
    pub eating: Option<SavedEating>,
    pub restless: bool,
    pub blocked: bool,
    pub wander_pause_ticks: Option<u32>,
    pub selected: bool,
    pub intents: Option<Vec<SavedIntent>>,
    pub needs: Option<[f32; NEED_COUNT]>,
    pub habituation: Option<Vec<SavedHabituation>>,
    pub sim_id: Option<u32>,
    pub sim_name: Option<String>,
    pub personality: Option<SavedPersonality>,
    pub relationships: Option<Vec<(u32, f32)>>,
    pub socialising: Option<SavedSocialising>,
    pub satisfaction: Option<f32>,
    pub hobbies: Option<Vec<String>>,
    pub traits: Option<Vec<SavedTraitState>>,
    pub fumbled_delta_scale: Option<f32>,
    pub career: Option<String>,
    pub commuting: bool,
    pub at_work_ticks: Option<u32>,
    pub chain: Option<SavedChainState>,
    pub carrying: Option<String>,
    pub step_work_ticks: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SavedPosition {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedPath {
    pub steps: Vec<(i32, i32)>,
    pub cursor: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedTarget {
    pub object: u32,
    pub interaction: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedEating {
    pub object: String,
    pub interaction: u32,
    pub remaining_ticks: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedIntent {
    pub object: u32,
    pub interaction: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedHabituation {
    pub object: String,
    pub interaction: u32,
    pub value: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedPersonality {
    pub drain: [f32; NEED_COUNT],
    pub satisfaction: [f32; NEED_COUNT],
    pub dispositions: Vec<SavedHabituation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedSocialising {
    pub interaction: u32,
    pub partner: u32,
    pub remaining_ticks: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedTraitState {
    pub id: String,
    pub state: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedChainState {
    pub chain: String,
    pub step: u32,
    pub fumble_scale: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedCommand {
    Select(Option<u32>),
    UseObject {
        agent: u32,
        object: u32,
        interaction: u32,
    },
    CancelIntents {
        agent: u32,
    },
    SetSpeed(u8),
    TalkTo {
        agent: u32,
        target: u32,
        interaction: u32,
    },
}
