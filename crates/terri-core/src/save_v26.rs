//! Current continuation adds world and activity state to the published Career format.
use crate::save_editable_v22::SavedPoolEpisode;
use crate::save_editable_v23::SavedBathEpisode;
use crate::save_v24::{SavedShiftInputs, SavedWeekInputs};
use crate::{SaveSnapshotV24, WorldSurfaces};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedOpenShiftBasePay {
    pub sim: u32,
    pub start_tick: u64,
    /// None means the historical record cannot establish the base pay.
    pub base_pay: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedShiftSourceOverride {
    pub input_index: u32,
    pub career: u32,
    /// None means the historical record cannot establish the base pay.
    pub base_pay: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedSourcedCurrentInputs {
    pub inputs: Vec<SavedShiftInputs>,
    pub sources: Vec<SavedShiftSourceOverride>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedSourcedWeekInputs {
    pub inputs: SavedWeekInputs,
    pub sources: Vec<SavedShiftSourceOverride>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedCareerInputSources {
    pub sim: u32,
    pub current: Option<SavedSourcedCurrentInputs>,
    pub weeks: Vec<SavedSourcedWeekInputs>,
}

/// Published Career state followed by editable-world and activity records.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV26 {
    pub previous: SaveSnapshotV24,
    pub surfaces: WorldSurfaces,
    pub commutes: Vec<(u32, u8)>,
    pub pools: Vec<SavedPoolEpisode>,
    pub baths: Vec<SavedBathEpisode>,
    /// Sim ID and shift start for each current manual work trip.
    pub manual_work_trips: Vec<(u32, u64)>,
    pub open_shift_base_pay: Vec<SavedOpenShiftBasePay>,
    pub career_input_sources: Vec<SavedCareerInputSources>,
}

impl SaveSnapshotV26 {
    pub fn gameplay_v20(&self) -> &crate::SaveSnapshotV20 {
        &self.previous.legacy.legacy.legacy.legacy
    }
    pub fn gameplay_v20_mut(&mut self) -> &mut crate::SaveSnapshotV20 {
        &mut self.previous.legacy.legacy.legacy.legacy
    }

    pub fn room_world_v16(&self) -> &crate::SaveSnapshotV16 {
        &self.gameplay_v20().legacy.legacy.legacy.legacy
    }

    pub fn room_world_v16_mut(&mut self) -> &mut crate::SaveSnapshotV16 {
        &mut self.gameplay_v20_mut().legacy.legacy.legacy.legacy
    }
}

/// Historical gameplay records retain the same schema-twenty field view.
impl std::ops::Deref for SaveSnapshotV26 {
    type Target = crate::SaveSnapshotV20;
    fn deref(&self) -> &Self::Target {
        self.gameplay_v20()
    }
}

impl std::ops::DerefMut for SaveSnapshotV26 {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.gameplay_v20_mut()
    }
}
