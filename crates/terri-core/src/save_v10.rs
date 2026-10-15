//! Appearance extends the frozen schema-eight world without changing its records.
use crate::{appearance::CharacterAppearanceV1, command::CharacterCommand, SaveSnapshotV8};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedCharacterAppearance {
    pub sim: u32,
    pub appearance: CharacterAppearanceV1,
    pub pronouns: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegacyCharacterSnapshotV9 {
    pub legacy: SaveSnapshotV8,
    pub characters: Vec<SavedCharacterAppearance>,
    /// None consumes the next schema-eight command; Some keeps a creator command.
    pub command_order: Vec<Option<CharacterCommand>>,
}

/// Combined social and character state. Earlier envelopes retain their exact layouts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV10 {
    pub legacy: SaveSnapshotV8,
    pub social: crate::save_v9::SavedSocialEpisodes,
    pub characters: Vec<SavedCharacterAppearance>,
    pub command_order: Vec<Option<CharacterCommand>>,
}
