//! Pure simulation core. No web dependencies, ever.

pub mod clock;
pub mod components;
pub mod grid;
pub mod hash;

pub use clock::{SimClock, TICKS_PER_SIM_HOUR, TICK_HZ};
pub use components::{
    Agent, Eating, Hunger, Path, Position, Reserved, SmartObject, Target, NEED_MAX, NEED_MIN,
};
pub use grid::TileGrid;
pub use hash::FnvHasher;
