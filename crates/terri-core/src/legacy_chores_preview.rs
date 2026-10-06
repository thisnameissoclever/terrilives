//! Frozen unpublished chore-preview records from commit 14b1d3fc.
//! Command order and envelope field order must never follow the current schema.
use crate::{save::*, SimRng};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreviewSnapshotV5 {
    pub world: PreviewWorld,
    pub layout: crate::layout::SavedLayout,
    pub object_facings: Vec<(u32, u8)>,
    pub retired_indices: Vec<u32>,
    pub object_colourways: Vec<(u32, String)>,
    pub floors: crate::layout::SavedFloors,
    pub family_by_index: crate::layout::FamilyTies,
    pub family: crate::layout::FamilyTies,
    pub mortality: Option<SavedMortality>,
    pub death_default_applied: bool,
    pub waiting_needs: Vec<(u32, u32, u8)>,
    pub self_preservation: Vec<(u32, u8)>,
    pub chronotype_offsets: Vec<(u32, i32)>,
    pub domestic: Option<SavedDomestic>,
    pub sleeping_places: Option<SavedSleepingPlaces>,
    pub shyness: Vec<(u32, u8)>,
    pub boundaries: Vec<SavedBoundaryDecision>,
    pub dining: Option<SavedDining>,
    pub targeted_cleanup: Option<SavedTargetedCleanup>,
    pub chores: Option<crate::chores::SavedChores>,
    pub grime: Option<crate::grime::SavedGrime>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreviewWorld {
    pub content_fingerprint: u64,
    pub tick: u64,
    pub rng: SimRng,
    pub funds: i64,
    pub issued_sim_ids: u32,
    pub grid_width: u32,
    pub grid_height: u32,
    pub blocked_tiles: Vec<bool>,
    pub entities: Vec<SavedEntity>,
    pub queued_commands: Vec<PreviewCommand>,
    pub sleep_pressure: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PreviewCommand {
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
    SetWallEdge {
        axis: crate::layout::EdgeAxis,
        x: u32,
        y: u32,
        state: crate::layout::WallState,
    },
    BuyObject {
        definition: Option<String>,
        x: u32,
        y: u32,
        facing: crate::Facing,
    },
    BuildRoom {
        x0: u32,
        y0: u32,
        x1: u32,
        y1: u32,
        doorway: Option<crate::layout::WallLine>,
    },
    SellObject {
        object: u32,
    },
    SetColourway {
        object: u32,
        colourway: Option<String>,
    },
    BuyObjectInColourway {
        definition: Option<String>,
        x: u32,
        y: u32,
        facing: crate::Facing,
        colourway: Option<String>,
    },
    AddHousemate {
        name: String,
        personality: Option<String>,
        traits: Vec<Option<String>>,
    },
    SetFloor {
        x: u32,
        y: u32,
        covering: u8,
    },
    SetFamilyTie {
        who: u32,
        to: u32,
        relation: Option<crate::layout::Relation>,
    },
    SetDeathEnabled(bool),
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
    FitWindow {
        axis: crate::layout::EdgeAxis,
        x: u32,
        y: u32,
        model: crate::windows::WindowModel,
    },
    RemoveWindow {
        axis: crate::layout::EdgeAxis,
        x: u32,
        y: u32,
    },
    CleanDishes {
        agent: u32,
        surface: u32,
        dishes: Option<Vec<u32>>,
    },
    CleanDishesFirst {
        agent: u32,
        surface: u32,
        dishes: Option<Vec<u32>>,
    },
    CleanChore {
        agent: u32,
        key: crate::chores::ChoreKey,
    },
    CleanChoreFirst {
        agent: u32,
        key: crate::chores::ChoreKey,
    },
    SetChoreProfile {
        agent: u32,
        responsibility: u8,
        preferences: [i8; 4],
    },
    SetChoreBoard {
        enabled: bool,
    },
}

impl From<PreviewCommand> for SavedCommand {
    fn from(command: PreviewCommand) -> Self {
        match command {
            PreviewCommand::Select(value) => SavedCommand::Select(value),
            PreviewCommand::UseObject {
                agent,
                object,
                interaction,
            } => SavedCommand::UseObject {
                agent,
                object,
                interaction,
            },
            PreviewCommand::CancelIntents { agent } => SavedCommand::CancelIntents { agent },
            PreviewCommand::SetSpeed(value) => SavedCommand::SetSpeed(value),
            PreviewCommand::TalkTo {
                agent,
                target,
                interaction,
            } => SavedCommand::TalkTo {
                agent,
                target,
                interaction,
            },
            PreviewCommand::UseObjectFirst {
                agent,
                object,
                interaction,
            } => SavedCommand::UseObjectFirst {
                agent,
                object,
                interaction,
            },
            PreviewCommand::TalkToFirst {
                agent,
                target,
                interaction,
            } => SavedCommand::TalkToFirst {
                agent,
                target,
                interaction,
            },
            PreviewCommand::PlaceObject {
                object,
                x,
                y,
                facing,
            } => SavedCommand::PlaceObject {
                object,
                x,
                y,
                facing,
            },
            PreviewCommand::SetWallEdge { axis, x, y, state } => {
                SavedCommand::SetWallEdge { axis, x, y, state }
            }
            PreviewCommand::BuyObject {
                definition,
                x,
                y,
                facing,
            } => SavedCommand::BuyObject {
                definition,
                x,
                y,
                facing,
            },
            PreviewCommand::BuildRoom {
                x0,
                y0,
                x1,
                y1,
                doorway,
            } => SavedCommand::BuildRoom {
                x0,
                y0,
                x1,
                y1,
                doorway,
            },
            PreviewCommand::SellObject { object } => SavedCommand::SellObject { object },
            PreviewCommand::SetColourway { object, colourway } => {
                SavedCommand::SetColourway { object, colourway }
            }
            PreviewCommand::BuyObjectInColourway {
                definition,
                x,
                y,
                facing,
                colourway,
            } => SavedCommand::BuyObjectInColourway {
                definition,
                x,
                y,
                facing,
                colourway,
            },
            PreviewCommand::AddHousemate {
                name,
                personality,
                traits,
            } => SavedCommand::AddHousemate {
                name,
                personality,
                traits,
            },
            PreviewCommand::SetFloor { x, y, covering } => {
                SavedCommand::SetFloor { x, y, covering }
            }
            PreviewCommand::SetFamilyTie { who, to, relation } => {
                SavedCommand::SetFamilyTie { who, to, relation }
            }
            PreviewCommand::SetDeathEnabled(value) => SavedCommand::SetDeathEnabled(value),
            PreviewCommand::AddHousemateWithInstinct {
                name,
                personality,
                traits,
                instinct,
            } => SavedCommand::AddHousemateWithInstinct {
                name,
                personality,
                traits,
                instinct,
            },
            PreviewCommand::SetBedAssignment { agent, place } => {
                SavedCommand::SetBedAssignment { agent, place }
            }
            PreviewCommand::FitWindow { axis, x, y, model } => {
                SavedCommand::FitWindow { axis, x, y, model }
            }
            PreviewCommand::RemoveWindow { axis, x, y } => {
                SavedCommand::RemoveWindow { axis, x, y }
            }
            PreviewCommand::CleanDishes {
                agent,
                surface,
                dishes,
            } => SavedCommand::CleanDishes {
                agent,
                surface,
                dishes,
            },
            PreviewCommand::CleanDishesFirst {
                agent,
                surface,
                dishes,
            } => SavedCommand::CleanDishesFirst {
                agent,
                surface,
                dishes,
            },
            PreviewCommand::CleanChore { agent, key } => SavedCommand::CleanChore { agent, key },
            PreviewCommand::CleanChoreFirst { agent, key } => {
                SavedCommand::CleanChoreFirst { agent, key }
            }
            PreviewCommand::SetChoreProfile {
                agent,
                responsibility,
                preferences,
            } => SavedCommand::SetChoreProfile {
                agent,
                responsibility,
                preferences,
            },
            PreviewCommand::SetChoreBoard { enabled } => SavedCommand::SetChoreBoard { enabled },
        }
    }
}

impl From<PreviewWorld> for SaveSnapshotV1 {
    fn from(world: PreviewWorld) -> Self {
        Self {
            content_fingerprint: world.content_fingerprint,
            tick: world.tick,
            rng: world.rng,
            funds: world.funds,
            issued_sim_ids: world.issued_sim_ids,
            grid_width: world.grid_width,
            grid_height: world.grid_height,
            blocked_tiles: world.blocked_tiles,
            entities: world.entities,
            queued_commands: world
                .queued_commands
                .into_iter()
                .map(SavedCommand::from)
                .collect(),
            sleep_pressure: world.sleep_pressure,
        }
    }
}

impl From<PreviewSnapshotV5> for SaveSnapshotV5 {
    fn from(snapshot: PreviewSnapshotV5) -> Self {
        Self {
            world: snapshot.world.into(),
            layout: snapshot.layout,
            object_facings: snapshot.object_facings,
            retired_indices: snapshot.retired_indices,
            object_colourways: snapshot.object_colourways,
            floors: snapshot.floors,
            family_by_index: snapshot.family_by_index,
            family: snapshot.family,
            mortality: snapshot.mortality,
            death_default_applied: snapshot.death_default_applied,
            waiting_needs: snapshot.waiting_needs,
            self_preservation: snapshot.self_preservation,
            chronotype_offsets: snapshot.chronotype_offsets,
            domestic: snapshot.domestic,
            sleeping_places: snapshot.sleeping_places,
            shyness: snapshot.shyness,
            boundaries: snapshot.boundaries,
            dining: snapshot.dining,
            targeted_cleanup: snapshot.targeted_cleanup,
            chores: snapshot.chores,
            grime: snapshot.grime,
            skills: None,
        }
    }
}
