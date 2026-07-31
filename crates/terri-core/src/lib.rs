//! Pure simulation core. No web dependencies, ever.

pub mod clock;
pub mod command;
pub mod components;
pub mod grid;
pub mod hash;
pub mod ids;
pub mod needs;
pub mod rng;

/// Re-exported because it appears in this crate's own public API -
/// `Target::object`, `Intent::object` - so a consumer that names those
/// fields' type should not need `bevy_ecs` in its manifest to do it.
/// `terri-wasm` is the consumer that matters: it is the boundary crate,
/// and its dependency list is kept as short as [D1] can make it.
pub use bevy_ecs::prelude::Entity;
pub use clock::{SimClock, TICKS_PER_SIM_HOUR, TICK_HZ};
pub use command::{CommandQueue, SimCommand};
pub use components::{
    Agent, Eating, Habituation, Intent, IntentQueue, Path, Personality, Position, Relationships,
    Reserved, Restless, Selected, SimId, SimIdAllocator, SimName, SmartObject, Target, Wander,
};
pub use grid::{Footprint, TileGrid};
pub use hash::FnvHasher;
pub use ids::ObjectDefId;
pub use needs::{NeedId, Needs, NEED_COUNT, NEED_MAX, NEED_MIN};
pub use rng::SimRng;
