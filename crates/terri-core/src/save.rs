//! Stable, engine-free data carried by versioned save files.
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
pub const SAVE_SCHEMA_VERSION: u16 = 5;

/// Current envelope - [RC-save] in `docs/specs/2026-09-22-colourways.md`: the
/// V4 envelope with each placed object's colourway appended, for the objects
/// not in the first, as drawn. Each entry is a saved entity index, ascending,
/// and a colourway id, so a save means the same colours when colourways are
/// added or reordered.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV5 {
    pub world: SaveSnapshotV1,
    pub layout: crate::layout::SavedLayout,
    pub object_facings: Vec<(u32, u8)>,
    pub retired_indices: Vec<u32>,
    pub object_colourways: Vec<(u32, String)>,
}

/// Previous envelope - [SL-save] in `docs/specs/2026-09-22-selling-furniture.md`:
/// the V3 envelope with the entity indices sales have retired appended. A
/// retired index belongs to no entity and is never handed out again, so the
/// loader must not free it the way it frees the other gaps in the numbering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV4 {
    pub world: SaveSnapshotV1,
    pub layout: crate::layout::SavedLayout,
    pub object_facings: Vec<(u32, u8)>,
    /// Every entity index a sale has retired, ascending, none of them an index
    /// a saved entity holds.
    pub retired_indices: Vec<u32>,
}

/// Previous envelope: frozen world and architecture, followed by required directions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV3 {
    pub world: SaveSnapshotV1,
    pub layout: crate::layout::SavedLayout,
    /// Missing entries use authored defaults; the list itself is required on the wire.
    pub object_facings: Vec<(u32, u8)>,
}

#[cfg(test)]
mod wire_tests {
    use super::*;

    fn wire(hex: &str) -> Vec<u8> {
        let hex: String = hex.split_whitespace().collect();
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }

    #[test]
    fn public_v1_world_record_is_frozen_byte_for_byte() {
        let bytes = wire(include_str!(
            "../../terri-wasm/tests/fixtures/pre-builder-600.hex"
        ));
        assert_eq!(&bytes[8..10], &[1, 0]);
        let (snapshot, rest) = postcard::take_from_bytes::<SaveSnapshotV1>(&bytes[10..])
            .expect("published V1 must decode without unpublished fields");
        assert!(rest.is_empty());
        assert_eq!(postcard::to_allocvec(&snapshot).unwrap(), &bytes[10..]);
    }

    #[test]
    fn public_v2_architecture_record_is_frozen_byte_for_byte() {
        let bytes = wire(include_str!(
            "../../terri-wasm/tests/fixtures/pre-front-door-schema2.hex"
        ));
        assert_eq!(&bytes[8..10], &[2, 0]);
        let (snapshot, rest) = postcard::take_from_bytes::<SaveSnapshotV2>(&bytes[10..])
            .expect("published V2 must decode its original embedded V1 layout");
        assert!(rest.is_empty());
        assert_eq!(postcard::to_allocvec(&snapshot).unwrap(), &bytes[10..]);
    }
}

/// Explicit architecture envelope. V1 remains a frozen embedded world record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV2 {
    pub world: SaveSnapshotV1,
    pub layout: crate::layout::SavedLayout,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SaveSnapshotV1 {
    /// Save-compatibility digest of numeric content rows and structural
    /// meanings this snapshot cannot validate by authored string id.
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
    /// `(entity index, ticks)` for every sim carrying sleep pressure.
    ///
    /// **Appended last, and sparse, both on purpose.** Postcard writes a
    /// struct as its fields back to back with no framing, so a payload
    /// written before this field existed is byte-identical to a prefix of
    /// one written after it. That is what lets `load_bytes` decode an old
    /// save by reading the prefix and defaulting the tail, instead of
    /// rejecting every save anybody had - which is what a schema-version
    /// bump would have done.
    ///
    /// Sparse rather than one entry per entity because most sims are not
    /// tired: absent means zero, so a rested household costs one byte,
    /// and nothing has to stay the same length as `entities`.
    #[serde(default)]
    pub sleep_pressure: Vec<(u32, u32)>,
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
    /// Which two voice clips an in-progress conversation is made of.
    ///
    /// Saved because the clips DECIDED the conversation's length: reloading
    /// mid-talk has to resume the same two clips, or the sound would restart
    /// from a different pair and finish at a different time from the talking.
    ///
    /// `None` for every agent not talking, and for every conversation started
    /// by a pack with no voice. **Last in this struct on purpose**, per the
    /// appending rule the pack's `lot` field documents.
    pub conversation_voice: Option<SavedConversationVoice>,
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

/// The clip pair behind an in-progress conversation.
///
/// Indices into the pack's `voice_clips`, not file names, for the same reason
/// every other saved reference is an index: a name would let a save disagree
/// with the pack it is loaded against without anything noticing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedConversationVoice {
    pub first: u32,
    pub second: u32,
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
    /// Appended after `TalkTo`, so a save written before front placement
    /// existed still decodes: postcard writes the variant index, and every
    /// earlier variant keeps its number.
    UseObjectFirst {
        agent: u32,
        object: u32,
        interaction: u32,
    },
    TalkToFirst {
        agent: u32,
        target: u32,
        interaction: u32,
    },
    PlaceObject {
        object: u32,
        x: u32,
        y: u32,
        facing: crate::Facing,
    },
    /// [WT-command]. A wall edit staged just before a save.
    SetWallEdge {
        axis: crate::layout::EdgeAxis,
        x: u32,
        y: u32,
        state: crate::layout::WallState,
    },
    /// [BM-buy]. A purchase staged just before a save. It names the object
    /// by id rather than by pack index: the save digest covers the object
    /// ids but not their order, so an index could name a different object
    /// once the content file is reordered. `None` for a command whose index
    /// named no object at all; it loads as one that still names none, and
    /// is refused when it drains exactly as it would have been.
    BuyObject {
        definition: Option<String>,
        x: u32,
        y: u32,
        facing: crate::Facing,
    },
    /// [RT-command]. A room staged just before a save.
    BuildRoom {
        x0: u32,
        y0: u32,
        x1: u32,
        y1: u32,
        doorway: Option<crate::layout::WallLine>,
    },
    /// [SL-command]. A sale staged just before a save, by entity index as
    /// `PlaceObject` names its object.
    SellObject {
        object: u32,
    },
    /// [RC-command]. A colourway change staged just before a save. The
    /// colourway is its id, as `BuyObject` records its object; `None` records
    /// an index the pack had no colourway for, which restores as one the
    /// drain refuses.
    SetColourway {
        object: u32,
        colourway: Option<String>,
    },
    /// [RC-slice-buy]. A purchase in a colourway staged just before a save,
    /// both recorded by id as `BuyObject` and `SetColourway` record them.
    BuyObjectInColourway {
        definition: Option<String>,
        x: u32,
        y: u32,
        facing: crate::Facing,
        colourway: Option<String>,
    },
}
