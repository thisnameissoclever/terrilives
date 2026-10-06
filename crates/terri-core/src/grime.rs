//! Optional continuation data for usage-driven grime and floor patches.
use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

#[derive(Resource, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedGrime {
    pub rng: crate::SimRng,
    pub patches: Vec<FloorPatch>,
    pub legacy_floors: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FloorPatch {
    pub person: u32,
    pub center: u32,
    pub cells: Vec<u32>,
}

impl SavedGrime {
    pub fn hash_into(&self, hash: &mut crate::FnvHasher) {
        hash.write_bytes(b"usage-grime-v1");
        self.rng.hash_into(hash);
        hash.write_u64(self.patches.len() as u64);
        for patch in &self.patches {
            hash.write_u64(patch.person as u64);
            hash.write_u64(patch.center as u64);
            hash.write_u64(patch.cells.len() as u64);
            for cell in &patch.cells {
                hash.write_u64(*cell as u64);
            }
        }
        hash.write_u64(self.legacy_floors.len() as u64);
        for person in &self.legacy_floors {
            hash.write_u64(*person as u64);
        }
    }
}
