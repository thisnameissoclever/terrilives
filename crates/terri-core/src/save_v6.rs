//! Strict current envelope. Published positional records remain unchanged.

use crate::save::{
    SavedBoundaryDecision, SavedDining, SavedDomestic, SavedMortality, SavedSkills,
    SavedSleepingPlaces,
};
use crate::{books::SavedBookLibrary, SaveSnapshotV1, SaveSnapshotV5};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV6 {
    #[serde(with = "current_legacy")]
    pub legacy: SaveSnapshotV5,
    pub actions: SavedActionManifest,
    pub books: SavedBookLibrary,
    pub seats: Vec<SavedPhysicalSeat>,
    pub queues: Vec<SavedOrderQueue>,
    pub reading: Vec<SavedReadingJourney>,
    pub pending_shifts: Vec<SavedPendingShift>,
    /// None consumes the next frozen ordinary command; Some runs a V6 book command.
    pub command_order: Vec<Option<crate::command::BookCommand>>,
    pub chain_origins: Vec<SavedChainOrigin>,
    pub recipe_orders: Vec<(u32, u64)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChainOrigin {
    Action {
        model: String,
        action: String,
        recipe: String,
        selected_step: u32,
    },
    Internal {
        recipe: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedChainOrigin {
    pub person: u32,
    pub origin: ChainOrigin,
    pub selected_use: SavedSelectedUse,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedSelectedUse {
    Station(u32),
    LegacyPending,
    Complete,
}

/// Each vector preserves its source index space; IDs resolve destination rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedActionManifest {
    pub objects: Vec<SavedObjectActions>,
    pub social: Vec<String>,
    pub chains: Vec<SavedChainActions>,
    pub voices: Vec<(String, u32)>,
    pub traits: Vec<(String, u8)>,
    pub portal_structure: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedObjectActions {
    pub model: String,
    pub structure: u64,
    /// Added station roles are compatible; every saved role must remain available.
    pub required_roles: Vec<String>,
    pub interactions: Vec<String>,
    /// Flyout rows follow interactions, in this object's advertised chain order.
    pub advertised_chains: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedChainActions {
    pub id: String,
    /// Active programs retain their exact step semantics. Inactive rows only map IDs.
    pub structure: Option<u64>,
}

/// People and furniture use the envelope's saved entity-index space.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedPhysicalSeat {
    pub person: u32,
    pub furniture: u32,
    pub seat: String,
    pub target: u32,
    pub action: String,
    pub all: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedOrderQueue {
    pub owner: u32,
    pub next_id: u64,
    pub orders: Vec<SavedOrder>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedOrder {
    pub id: u64,
    pub target: u32,
    pub action: String,
    pub title: Option<String>,
}

/// Stage discriminants are part of the unpublished V6 contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReadingStage {
    Fetch,
    Travel,
    Read,
    Return,
    WaitingReturn,
    Pickup,
    Shelve,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ReadingOutcome {
    Success,
    Fumbled(f32),
}

/// One uninterrupted reward context over actual reading work. Edits do not
/// rewrite earlier contexts or create rows while the simulation is paused.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadingRewardContext {
    pub start_tick: u32,
    pub end_tick: u32,
    pub start_work: f32,
    pub end_work: f32,
    pub disposition: f32,
    pub traits: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedReadingJourney {
    pub owner: u32,
    pub origin: u32,
    pub action: String,
    pub order: Option<u64>,
    pub copy: crate::books::BookCopyId,
    pub shelf: u32,
    pub transfer_contact: Option<(i32, i32)>,
    pub reach_remaining: u32,
    pub seat: Option<(u32, String)>,
    pub stage: ReadingStage,
    pub elapsed: u32,
    pub work: f32,
    pub earned_satisfaction: f32,
    pub destination: (i32, i32),
    pub outcome: Option<ReadingOutcome>,
    pub reward_contexts: Vec<ReadingRewardContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedPendingShift {
    pub owner: u32,
    pub scheduled_tick: u64,
    pub career: String,
}

/// Immutable embedded V5 record written by the unpublished owned-book build.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrozenPreAffinityV5 {
    pub world: SaveSnapshotV1,
    pub layout: crate::layout::SavedLayout,
    pub object_facings: Vec<(u32, u8)>,
    pub retired_indices: Vec<u32>,
    pub object_colourways: Vec<(u32, String)>,
    /// What the player has laid on each floor tile - [FL-save] in
    /// `docs/specs/2026-09-22-floors.md`.
    ///
    /// **Appended last, and sparse, both on purpose**, for the reason
    /// `sleep_pressure` is: postcard writes a struct's fields back to back,
    /// so a payload written before this field existed is a prefix of one
    /// written after it, and the loader reads the prefix and defaults the
    /// tail. A house nobody has painted costs one byte.
    #[serde(default)]
    pub floors: crate::layout::SavedFloors,
    /// Who the household were to each other, keyed on entity index, as the
    /// first build with ties wrote it ([FM-identity]) - [FM-save] in
    /// `docs/specs/2026-09-22-family.md`. Appended after the floors, for the
    /// same reason: an older payload is a prefix of a newer one, so a save
    /// written before ties existed loads with nobody related.
    ///
    /// **Read, never written.** A save now writes this empty and the ties
    /// in `family` below; the loader turns a non-empty one into SimIds,
    /// which it can because a load rebuilds every entity index exactly.
    #[serde(default)]
    pub family_by_index: crate::layout::FamilyTies,
    /// Who the household are to each other, keyed on SimId - [FM-save].
    /// Appended last, so a save written with the entity-index list above is
    /// a prefix of this one and loads through it.
    #[serde(default)]
    pub family: crate::layout::FamilyTies,
    /// Appended optional death state. Old saves supply one zero byte.
    pub mortality: Option<SavedMortality>,
    /// Older worlds adopt the enabled default once. Later saved choices win.
    pub death_default_applied: bool,
    /// Person index, occupied item index, and the activity's relevant need bits.
    pub waiting_needs: Vec<(u32, u32, u8)>,
    /// Living person index and instinct, in ascending entity order.
    pub self_preservation: Vec<(u32, u8)>,
    /// Person index and exact nonzero sleep-schedule offset, ascending by index.
    /// Missing entries retain the historical zero; never infer them from content.
    pub chronotype_offsets: Vec<(u32, i32)>,
    /// Food, dishes, cleanup claims and room visits. Older saves append None.
    pub domestic: Option<SavedDomestic>,
    /// Absent only in historical payloads; current writers emit Some, even empty.
    pub sleeping_places: Option<SavedSleepingPlaces>,
    /// Stable SimId and nondefault shyness. Earlier payloads omit this tail.
    pub shyness: Vec<(u32, u8)>,
    pub boundaries: Vec<SavedBoundaryDecision>,
    /// Exact dining claims and deferred room cleanup opportunities. Optional tail
    /// preserves the published domestic record's positional wire layout.
    pub dining: Option<SavedDining>,
    /// Each person's skill practice - [SK-save] in
    /// `docs/specs/2026-10-05-skills.md`. Current writers emit Some, even
    /// empty, and a present field is authoritative. None appears only in a
    /// payload written before skills existed, and the loader then seeds
    /// practice once from each worn capability trait's saved state.
    pub skills: Option<SavedSkills>,
}
impl FrozenPreAffinityV5 {
    pub fn into_current(self) -> SaveSnapshotV5 {
        SaveSnapshotV5 {
            world: self.world,
            layout: self.layout,
            object_facings: self.object_facings,
            retired_indices: self.retired_indices,
            object_colourways: self.object_colourways,
            floors: self.floors,
            family_by_index: self.family_by_index,
            family: self.family,
            mortality: self.mortality,
            death_default_applied: self.death_default_applied,
            waiting_needs: self.waiting_needs,
            self_preservation: self.self_preservation,
            chronotype_offsets: self.chronotype_offsets,
            domestic: self.domestic,
            sleeping_places: self.sleeping_places,
            shyness: self.shyness,
            boundaries: self.boundaries,
            dining: self.dining,
            skills: self.skills,
            affinities: None,
            targeted_cleanup: None,
            chores: None,
            grime: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrozenSaveSnapshotV6 {
    pub legacy: FrozenPreAffinityV5,
    pub actions: SavedActionManifest,
    pub books: SavedBookLibrary,
    pub seats: Vec<SavedPhysicalSeat>,
    pub queues: Vec<SavedOrderQueue>,
    pub reading: Vec<SavedReadingJourney>,
    pub pending_shifts: Vec<SavedPendingShift>,
    /// None consumes the next frozen ordinary command; Some runs a V6 book command.
    pub command_order: Vec<Option<crate::command::BookCommand>>,
    pub chain_origins: Vec<SavedChainOrigin>,
}
impl FrozenSaveSnapshotV6 {
    pub fn into_current(self) -> SaveSnapshotV6 {
        SaveSnapshotV6 {
            legacy: self.legacy.into_current(),
            actions: self.actions,
            books: self.books,
            seats: self.seats,
            queues: self.queues,
            reading: self.reading,
            pending_shifts: self.pending_shifts,
            command_order: self.command_order,
            chain_origins: self.chain_origins,
            recipe_orders: Vec::new(),
        }
    }
}

/// Exact schema-7 embedded record. Later V5 additions cannot shift its boundary.
#[derive(Serialize, Deserialize)]
struct FrozenCurrentV5 {
    prefix: FrozenPreAffinityV5,
    affinities: Option<crate::save::SavedAffinities>,
    targeted_cleanup: Option<crate::save::SavedTargetedCleanup>,
    chores: Option<crate::chores::SavedChores>,
    grime: Option<crate::grime::SavedGrime>,
}
mod current_legacy {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &SaveSnapshotV5,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        FrozenCurrentV5 {
            prefix: FrozenPreAffinityV5 {
                world: value.world.clone(),
                layout: value.layout.clone(),
                object_facings: value.object_facings.clone(),
                retired_indices: value.retired_indices.clone(),
                object_colourways: value.object_colourways.clone(),
                floors: value.floors.clone(),
                family_by_index: value.family_by_index.clone(),
                family: value.family.clone(),
                mortality: value.mortality.clone(),
                death_default_applied: value.death_default_applied,
                waiting_needs: value.waiting_needs.clone(),
                self_preservation: value.self_preservation.clone(),
                chronotype_offsets: value.chronotype_offsets.clone(),
                domestic: value.domestic.clone(),
                sleeping_places: value.sleeping_places.clone(),
                shyness: value.shyness.clone(),
                boundaries: value.boundaries.clone(),
                dining: value.dining.clone(),
                skills: value.skills.clone(),
            },
            affinities: value.affinities.clone(),
            targeted_cleanup: value.targeted_cleanup.clone(),
            chores: value.chores.clone(),
            grime: value.grime.clone(),
        }
        .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<SaveSnapshotV5, D::Error> {
        let value = FrozenCurrentV5::deserialize(deserializer)?;
        let mut current = value.prefix.into_current();
        current.affinities = value.affinities;
        current.targeted_cleanup = value.targeted_cleanup;
        current.chores = value.chores;
        current.grime = value.grime;
        Ok(current)
    }
}
