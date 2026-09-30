//! Frozen Save V1 records from before recorded conversation voices.
//!
//! Adding a field to each row of a serialized list shifts every later row;
//! the old wire shape must decode separately before adding the absent field.

use crate::save::*;
use crate::{SimRng, NEED_COUNT};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV1BeforeVoice {
    pub content_fingerprint: u64,
    pub tick: u64,
    pub rng: SimRng,
    pub funds: i64,
    pub issued_sim_ids: u32,
    pub grid_width: u32,
    pub grid_height: u32,
    pub blocked_tiles: Vec<bool>,
    pub entities: Vec<SavedEntityBeforeVoice>,
    pub queued_commands: Vec<SavedCommand>,
    #[serde(default)]
    pub sleep_pressure: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedEntityBeforeVoice {
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

impl SaveSnapshotV1BeforeVoice {
    pub fn into_current(self) -> SaveSnapshotV1 {
        SaveSnapshotV1 {
            content_fingerprint: self.content_fingerprint,
            tick: self.tick,
            rng: self.rng,
            funds: self.funds,
            issued_sim_ids: self.issued_sim_ids,
            grid_width: self.grid_width,
            grid_height: self.grid_height,
            blocked_tiles: self.blocked_tiles,
            entities: self
                .entities
                .into_iter()
                .map(SavedEntityBeforeVoice::into_current)
                .collect(),
            queued_commands: self.queued_commands,
            sleep_pressure: self.sleep_pressure,
        }
    }
}

impl SavedEntityBeforeVoice {
    fn into_current(self) -> SavedEntity {
        SavedEntity {
            index: self.index,
            position: self.position,
            agent: self.agent,
            smart_object: self.smart_object,
            reserved: self.reserved,
            path: self.path,
            target: self.target,
            eating: self.eating,
            restless: self.restless,
            blocked: self.blocked,
            wander_pause_ticks: self.wander_pause_ticks,
            selected: self.selected,
            intents: self.intents,
            needs: self.needs,
            habituation: self.habituation,
            sim_id: self.sim_id,
            sim_name: self.sim_name,
            personality: self.personality,
            relationships: self.relationships,
            socialising: self.socialising,
            satisfaction: self.satisfaction,
            hobbies: self.hobbies,
            traits: self.traits,
            fumbled_delta_scale: self.fumbled_delta_scale,
            career: self.career,
            commuting: self.commuting,
            at_work_ticks: self.at_work_ticks,
            chain: self.chain,
            carrying: self.carrying,
            step_work_ticks: self.step_work_ticks,
            conversation_voice: None,
        }
    }
}
