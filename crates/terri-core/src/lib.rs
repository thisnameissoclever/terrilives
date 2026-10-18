//! Pure simulation core. No web dependencies, ever.

pub mod appearance;
pub mod books;
pub mod character;
pub mod character_catalog;
pub mod character_hash;
pub mod cleanliness;
pub mod clock;
pub mod command;
pub mod components;
pub mod facing;
pub mod grid;
pub mod hash;
pub mod ids;
pub mod layout;
pub mod needs;
pub mod player_order_hash;
pub mod rng;
pub mod save;
pub mod save_v6;
pub use save_v6::SaveSnapshotV6;
pub mod save_v7;
pub mod save_v8;
pub use save_v8::SaveSnapshotV8;
pub mod save_v9;
pub use save_v9::SaveSnapshotV9;
pub mod save_v10;
pub use save_v10::SaveSnapshotV10;
pub mod save_v11;
pub use save_v11::SaveSnapshotV11;
pub mod save_v12;
pub use save_v12::SaveSnapshotV12;
pub mod save_v13;
pub use save_v13::SaveSnapshotV13;
pub mod save_v14;
pub use save_v14::SaveSnapshotV14;
pub mod save_v15;
pub use save_v15::SaveSnapshotV15;
mod save_before_voice;
pub mod windows;

/// Re-exported because it appears in this crate's own public API -
/// `Target::object`, `Intent::object` - so a consumer that names those
/// fields' type should not need `bevy_ecs` in its manifest to do it.
/// `terri-wasm` is the consumer that matters: it is the boundary crate,
/// and its dependency list is kept as short as [D1] can make it.
pub use bevy_ecs::prelude::Entity;
pub use clock::{SimClock, TICKS_PER_SIM_HOUR, TICK_HZ};
pub use command::{CommandQueue, SimCommand};
pub use components::ObjectFacing;
pub use components::{
    Affinities, Agent, AtWork, Blocked, Career, Carrying, ChainState, Commuting, ConversationVoice,
    Eating, Fumbled, Funds, Habituation, Hobbies, Intent, IntentQueue, Path, Personality, Position,
    Relationships, Reserved, Restless, Satisfaction, Selected, SimId, SimIdAllocator, SimName,
    Skills, SleepPlace, SleepPressure, SmartObject, Socialising, SpriteVariant, StepWork,
    StepWorkTotal, Target, Traits, Wander,
};
pub use components::{Colourway, SelfPreservation};
pub use facing::Facing;
pub use grid::{Footprint, TileDistanceField, TileGrid};
pub use hash::FnvHasher;
pub use ids::ObjectDefId;
pub use needs::{NeedId, Needs, NEED_COUNT, NEED_MAX, NEED_MIN};
pub use rng::SimRng;
pub mod chores;
pub mod grime;
pub mod legacy_chores_preview;
mod shyness;
pub use save::{
    SaveSnapshotV1, SaveSnapshotV2, SaveSnapshotV3, SaveSnapshotV4, SaveSnapshotV5,
    SavedChainState, SavedCommand, SavedConversationVoice, SavedEating, SavedEntity,
    SavedHabituation, SavedIntent, SavedPath, SavedPersonality, SavedPosition, SavedSocialising,
    SavedTarget, SavedTraitState, SAVE_MAGIC, SAVE_SCHEMA_VERSION,
};

pub use save_before_voice::SaveSnapshotV1BeforeVoice;
pub use shyness::Shyness;
pub use windows::{WindowModel, WindowPlacement};
