//! Social episode state outside the frozen world records.
use crate::{SaveSnapshotV6, SavedTarget};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV9 {
    pub legacy: SaveSnapshotV6,
    pub social: SavedSocialEpisodes,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedSocialEpisodes {
    pub rendezvous: Vec<(u32, u32)>,
    pub topics: Vec<SavedTopic>,
    pub communal: Vec<SavedCommunalEpisode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedTopic {
    pub initiator: u32,
    pub code: u32,
    pub tag: String,
    pub initiator_preference: f32,
    pub listener_preference: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedCommunalEpisode {
    pub owner: u32,
    pub target: SavedTarget,
    pub extensions: u8,
    pub participants: Vec<u32>,
    pub remaining: u32,
    pub completed_novelty: Option<f32>,
}
