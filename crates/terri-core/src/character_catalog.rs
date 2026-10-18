//! Content projections used by the creator; authored identifiers remain stable.
use crate::appearance::F32Bits;
use crate::character::DispositionDraft;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterCatalog {
    pub version: u8,
    pub name_limit: u32,
    pub max_traits: u32,
    pub max_household: u32,
    pub traits: Vec<CreatorTrait>,
    pub affinities: Vec<CreatorPreference>,
    pub skills: Vec<CreatorSkill>,
    pub hobbies: Vec<CreatorHobby>,
    pub activities: Vec<CreatorActivity>,
    pub personalities: Vec<CreatorPersonality>,
    pub self_preservation_bands: Vec<CreatorInstinctBand>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorInstinctBand {
    pub min: u8,
    pub max: u8,
    pub weight: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorWeight {
    pub tag: String,
    pub value: F32Bits,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorTrait {
    pub id: String,
    pub label: String,
    pub description: String,
    pub kind: String,
    pub initial_state: F32Bits,
    pub weights: Vec<CreatorWeight>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorPreference {
    pub id: String,
    pub label: String,
    pub description: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorSkill {
    pub id: String,
    pub label: String,
    pub description: String,
    pub thresholds: Vec<F32Bits>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorHobby {
    pub id: String,
    pub label: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorActivity {
    pub object: String,
    pub action: String,
    pub label: String,
    pub tags: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorPersonality {
    pub id: String,
    pub label: String,
    pub description: String,
    pub values: CreatorPresetValues,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorPresetValues {
    pub cleanliness: F32Bits,
    pub chronotype_offset_ticks: i32,
    pub drain: [F32Bits; crate::NEED_COUNT],
    pub recovery: [F32Bits; crate::NEED_COUNT],
    pub dispositions: Vec<DispositionDraft>,
}
