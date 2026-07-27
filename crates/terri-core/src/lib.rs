//! Pure simulation core. No web dependencies, ever.

pub mod clock;
pub mod components;
pub mod grid;

pub use clock::{SimClock, TICKS_PER_SIM_HOUR, TICK_HZ};
pub use components::{Agent, Hunger, Position, Reserved, SmartObject, NEED_MAX, NEED_MIN};
pub use grid::TileGrid;

/// Trivial value used only to prove the Rust -> WASM -> JS path works.
/// Deleted once real state crosses the boundary.
pub fn smoke_value() -> u32 {
    42
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_value_is_42() {
        assert_eq!(smoke_value(), 42);
    }
}
