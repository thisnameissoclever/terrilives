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

/// Saved skill practice: `(entity index, skill id, practice)` rows,
/// strictly ascending by entity index and then id, one per non-zero
/// practice a living person holds. The id is the content's authored skill
/// id, so adding or reordering skills never reinterprets a save.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SavedSkills {
    pub rows: Vec<(u32, String, f32)>,
}

#[derive(bevy_ecs::prelude::Resource, Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedDining {
    pub diners: Vec<SavedDiner>,
    /// Dish identity and exact table setting (0..4).
    pub settings: Vec<(u32, u8)>,
    pub opportunities: Vec<SavedCleanupOpportunity>,
    /// Dirty-setting complaints persist across interruptions, separately from seats.
    pub complaints: Vec<(u32, Vec<u32>)>,
    /// Batches whose shared eating interval started without a table.
    pub tableless: Vec<(u32, u64)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedDiner {
    pub person: u32,
    pub station: u32,
    pub chair: Option<u32>,
    pub setting: Option<u8>,
    pub endpoint: (i32, i32),
    /// Dishes which prevented a reachable, unoccupied chair being used.
    pub obstructing: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedCleanupOpportunity {
    pub person: u32,
    pub room: u32,
    pub known: Vec<u32>,
    pub pending: bool,
}

#[derive(bevy_ecs::prelude::Resource, Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedDomestic {
    pub cleanliness: Vec<(u32, f32)>,
    pub dishes: Vec<SavedDishes>,
    pub visits: Vec<SavedRoomVisit>,
    pub cleanup: Vec<SavedCleanup>,
    pub meals: Vec<SavedMeal>,
    pub next_dish: u32,
    /// Current cook's SimId and plating tick, distinct from older unclaimed meals.
    pub serving_meals: Vec<(u32, u64)>,
}

/// Frozen local V5 order, accepted only for its reviewed bed-era fingerprint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LocalBedSnapshotV5 {
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
    /// Absent only in historical payloads; current writers emit Some, even empty.
    pub sleeping_places: Option<SavedSleepingPlaces>,
    /// Stable SimId and nondefault shyness. Earlier payloads omit this tail.
    pub shyness: Vec<(u32, u8)>,
    pub boundaries: Vec<SavedBoundaryDecision>,
}

impl LocalBedSnapshotV5 {
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
            sleeping_places: self.sleeping_places,
            shyness: self.shyness,
            boundaries: self.boundaries,
            domestic: None,
            dining: None,
            skills: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedDishes {
    pub id: u32,
    pub surface: u32,
    pub owner: u32,
    pub units: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedRoomVisit {
    pub person: u32,
    pub room: u32,
    pub seen: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedCleanup {
    pub person: u32,
    pub dishes: Vec<u32>,
    pub collected: Vec<u32>,
    pub directed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedMeal {
    pub cook: u32,
    pub counter: u32,
    pub table: Option<u32>,
    pub guests: Vec<u32>,
    pub claimed: Vec<u32>,
    pub collected: Vec<u32>,
    pub eaten: Vec<u32>,
    pub scale: f32,
    pub tick: u64,
    pub dining_started: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedSleepingPlaces {
    /// Agent entity index and physical place ordinal, ascending by agent.
    pub active_places: Vec<(u32, u8)>,
    /// Stable SimId, bed entity index and ordinal, ascending by SimId.
    pub assignments: Vec<(u32, u32, u8)>,
}

/// Sparse autonomous boundary decisions. Actor uses stable identity; goal uses entity index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedBoundaryDecision {
    pub actor: u32,
    pub expires: u64,
    pub lapse: bool,
    pub waiting_since: Option<u64>,
    pub goal: Option<(u32, u32)>,
    pub directed_chain: Option<u32>,
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

    #[test]
    fn every_historical_saved_command_keeps_its_golden_vector() {
        use crate::{
            layout::{EdgeAxis, Relation, WallState},
            Facing,
        };
        let cases: Vec<(SavedCommand, Vec<u8>)> = vec![
            (SavedCommand::Select(Some(7)), vec![0, 1, 7]),
            (
                SavedCommand::UseObject {
                    agent: 1,
                    object: 2,
                    interaction: 3,
                },
                vec![1, 1, 2, 3],
            ),
            (SavedCommand::CancelIntents { agent: 4 }, vec![2, 4]),
            (SavedCommand::SetSpeed(200), vec![3, 200]),
            (
                SavedCommand::TalkTo {
                    agent: 1,
                    target: 2,
                    interaction: 3,
                },
                vec![4, 1, 2, 3],
            ),
            (
                SavedCommand::UseObjectFirst {
                    agent: 1,
                    object: 2,
                    interaction: 3,
                },
                vec![5, 1, 2, 3],
            ),
            (
                SavedCommand::TalkToFirst {
                    agent: 1,
                    target: 2,
                    interaction: 3,
                },
                vec![6, 1, 2, 3],
            ),
            (
                SavedCommand::PlaceObject {
                    object: 1,
                    x: 2,
                    y: 3,
                    facing: Facing::NorthWest,
                },
                vec![7, 1, 2, 3, 2],
            ),
            (
                SavedCommand::SetWallEdge {
                    axis: EdgeAxis::Horizontal,
                    x: 2,
                    y: 3,
                    state: WallState::Window,
                },
                vec![8, 1, 2, 3, 3],
            ),
            (
                SavedCommand::BuyObject {
                    definition: Some("a".into()),
                    x: 2,
                    y: 3,
                    facing: Facing::NorthWest,
                },
                vec![9, 1, 1, b'a', 2, 3, 2],
            ),
            (
                SavedCommand::BuildRoom {
                    x0: 1,
                    y0: 2,
                    x1: 3,
                    y1: 4,
                    doorway: None,
                },
                vec![10, 1, 2, 3, 4, 0],
            ),
            (SavedCommand::SellObject { object: 7 }, vec![11, 7]),
            (
                SavedCommand::SetColourway {
                    object: 7,
                    colourway: Some("b".into()),
                },
                vec![12, 7, 1, 1, b'b'],
            ),
            (
                SavedCommand::BuyObjectInColourway {
                    definition: Some("a".into()),
                    x: 2,
                    y: 3,
                    facing: Facing::NorthWest,
                    colourway: Some("b".into()),
                },
                vec![13, 1, 1, b'a', 2, 3, 2, 1, 1, b'b'],
            ),
            (
                SavedCommand::AddHousemate {
                    name: "a".into(),
                    personality: Some("b".into()),
                    traits: vec![Some("c".into())],
                },
                vec![14, 1, b'a', 1, 1, b'b', 1, 1, 1, b'c'],
            ),
            (
                SavedCommand::SetFloor {
                    x: 2,
                    y: 3,
                    covering: 200,
                },
                vec![15, 2, 3, 200],
            ),
            (
                SavedCommand::SetFamilyTie {
                    who: 2,
                    to: 3,
                    relation: Some(Relation::Parent),
                },
                vec![16, 2, 3, 1, 1],
            ),
            (SavedCommand::SetDeathEnabled(true), vec![17, 1]),
            (
                SavedCommand::AddHousemateWithInstinct {
                    name: "a".into(),
                    personality: Some("b".into()),
                    traits: vec![Some("c".into())],
                    instinct: 100,
                },
                vec![18, 1, b'a', 1, 1, b'b', 1, 1, 1, b'c', 100],
            ),
            (
                SavedCommand::EditHousemate {
                    sim: 3,
                    name: "Ann".to_string(),
                    personality: Some(Some("the_settled".to_string())),
                    traits: vec![Some("bookworm".to_string()), None],
                    ties: vec![(5, Some(Relation::Parent)), (7, None)],
                },
                vec![
                    22, 3, 3, b'A', b'n', b'n', 1, 1, 11, b't', b'h', b'e', b'_', b's', b'e', b't',
                    b't', b'l', b'e', b'd', 2, 1, 8, b'b', b'o', b'o', b'k', b'w', b'o', b'r',
                    b'm', 0, 2, 5, 1, 1, 7, 0,
                ],
            ),
        ];
        assert_eq!(cases.len(), 20);
        for (command, bytes) in cases {
            assert_eq!(
                postcard::to_allocvec(&command).unwrap(),
                bytes,
                "{command:?}"
            );
            assert_eq!(
                postcard::from_bytes::<SavedCommand>(&bytes).unwrap(),
                command
            );
        }
    }

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
    /// [CS-save]. A move-in staged just before a save, its personality and
    /// traits recorded by id as a staged purchase records its object.
    AddHousemate {
        name: String,
        personality: Option<String>,
        traits: Vec<Option<String>>,
    },
    /// [FL-command]. A floor laid or lifted just before a save. The covering
    /// is its id rather than a name, because the ids are the content's own
    /// order and a covering the pack no longer has restores as one the drain
    /// refuses, which is what a missing id already does elsewhere.
    SetFloor {
        x: u32,
        y: u32,
        covering: u8,
    },
    /// [FM-tie]. A family tie set or taken away just before a save, by the
    /// entity indices the sims had, as `PlaceObject` names its object.
    SetFamilyTie {
        who: u32,
        to: u32,
        relation: Option<crate::layout::Relation>,
    },
    SetDeathEnabled(bool),
    /// A move-in with a chosen integer instinct. Earlier wire variants stay fixed.
    AddHousemateWithInstinct {
        name: String,
        personality: Option<String>,
        traits: Vec<Option<String>>,
        instinct: u8,
    },
    SetBedAssignment {
        agent: u32,
        place: Option<(u32, u8)>,
    },
    /// One complete typed window edit staged before a save.
    FitWindow {
        axis: crate::layout::EdgeAxis,
        x: u32,
        y: u32,
        model: crate::windows::WindowModel,
    },
    /// Restore the solid wall under the window owning this segment.
    RemoveWindow {
        axis: crate::layout::EdgeAxis,
        x: u32,
        y: u32,
    },
    /// Saved form of `SimCommand::EditHousemate`: authored IDs instead of
    /// pack indices. `personality` is `None` to keep, `Some(Some(id))` to
    /// adopt an archetype, and `Some(None)` when the index was unknown at
    /// capture, which the drain then refuses. Wire code 22, append-only.
    EditHousemate {
        sim: u32,
        name: String,
        personality: Option<Option<String>>,
        traits: Vec<Option<String>>,
        ties: Vec<(u32, Option<crate::layout::Relation>)>,
    },
}

/// One permanent record, ordered by death tick then SimId.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeathRecord {
    pub sim_id: u32,
    pub name: String,
    pub tick: u64,
    pub cause: DeathCause,
    /// Ids below this bound existed at death; later newcomers do not grieve.
    pub issued_sim_ids: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeathCause {
    Deprivation,
}

/// Counts are sparse, positive and ordered by living entity index.
#[derive(
    bevy_ecs::prelude::Resource, Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize,
)]
pub struct SavedMortality {
    pub enabled: bool,
    pub counts: Vec<(u32, u32)>,
    pub deaths: Vec<DeathRecord>,
}
