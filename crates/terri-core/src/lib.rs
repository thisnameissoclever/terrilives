//! Pure simulation core. No web dependencies, ever.

pub mod clock;
pub mod command;
pub mod components;
pub mod grid;
pub mod hash;
pub mod ids;
pub mod needs;

pub use clock::{SimClock, TICKS_PER_SIM_HOUR, TICK_HZ};
pub use command::{CommandQueue, SimCommand};
pub use components::{Agent, Eating, Path, Position, Reserved, SmartObject, Target};
pub use grid::TileGrid;
pub use hash::FnvHasher;
pub use ids::ObjectDefId;
pub use needs::{NeedId, Needs, NEED_COUNT, NEED_MAX, NEED_MIN};
