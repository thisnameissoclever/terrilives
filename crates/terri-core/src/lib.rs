//! Pure simulation core. No web dependencies, ever.

pub mod clock;
pub mod command;
pub mod components;
pub mod grid;
pub mod hash;
pub mod ids;
pub mod needs;
pub mod rng;

pub use clock::{SimClock, TICKS_PER_SIM_HOUR, TICK_HZ};
pub use command::{CommandQueue, SimCommand};
pub use components::{
    Agent, Eating, Path, Position, Reserved, Restless, SmartObject, Target, Wander,
};
pub use grid::TileGrid;
pub use hash::FnvHasher;
pub use ids::ObjectDefId;
pub use needs::{NeedId, Needs, NEED_COUNT, NEED_MAX, NEED_MIN};
pub use rng::SimRng;
