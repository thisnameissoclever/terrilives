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

    #[test]
    fn hour_boundary_is_true_only_on_multiples_of_the_sim_hour() {
        // Nothing consumes `is_hour_boundary` yet - [D3]'s Tier 2 story
        // progression is the first thing that will - so until this test
        // existed, replacing the whole function with a constant `true`
        // or a constant `false` left the entire workspace green. Both
        // were surviving mutants for five milestones on that basis.
        //
        // Tick 0 IS a boundary, because tick 0 begins sim-hour 0. That
        // is deliberate rather than an off-by-one, and it is the half a
        // reader is most likely to "correct", so it is asserted first
        // and by itself.
        //
        // What this does NOT pin is the calling convention: whether a
        // consumer should ask before or after `advance()`. That is
        // undecidable without a consumer, and whichever task adds the
        // first one owes a test for it.
        let mut clock = SimClock::default();
        assert!(clock.is_hour_boundary(), "tick 0 begins sim-hour 0");

        clock.advance();
        assert!(!clock.is_hour_boundary(), "tick 1 is inside sim-hour 0");

        while clock.tick < TICKS_PER_SIM_HOUR {
            clock.advance();
        }
        assert_eq!(clock.tick, TICKS_PER_SIM_HOUR);
        assert!(clock.is_hour_boundary(), "tick 60 begins sim-hour 1");

        clock.advance();
        assert!(!clock.is_hour_boundary(), "tick 61 is inside sim-hour 1");
    }
}
