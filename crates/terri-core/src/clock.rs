use bevy_ecs::prelude::Resource;

/// Simulation ticks per sim-hour. One tick is one sim-minute at 1x speed.
/// See ARCHITECTURE.md [D2]. Speed controls run MORE TICKS; they never
/// change dt, because variable dt would destroy determinism.
pub const TICKS_PER_SIM_HOUR: u64 = 60;

/// Ticks per real second at 1x speed.
pub const TICK_HZ: f64 = 10.0;

#[derive(Resource, Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimClock {
    pub tick: u64,
}

impl SimClock {
    pub fn advance(&mut self) {
        self.tick += 1;
    }

    pub fn sim_minutes(&self) -> u64 {
        self.tick
    }

    pub fn sim_hours(&self) -> u64 {
        self.tick / TICKS_PER_SIM_HOUR
    }

    /// True on the tick that begins a new sim-hour. Tier 2 story
    /// progression will hang off this later.
    pub fn is_hour_boundary(&self) -> bool {
        self.tick.is_multiple_of(TICKS_PER_SIM_HOUR)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sixty_ticks_is_one_sim_hour() {
        let mut clock = SimClock::default();
        for _ in 0..60 {
            clock.advance();
        }
        assert_eq!(clock.sim_minutes(), 60);
        assert_eq!(clock.sim_hours(), 1);
    }

    #[test]
    fn clock_starts_at_zero() {
        let clock = SimClock::default();
        assert_eq!(clock.tick, 0);
        assert_eq!(clock.sim_hours(), 0);
    }
}
