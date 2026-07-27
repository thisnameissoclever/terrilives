use bevy_ecs::prelude::*;
use terri_core::Hunger;

/// Hunger lost per tick (one sim-minute). At this rate a sim goes from
/// full to empty in roughly 16 sim-hours, which leaves room for sleep.
pub const HUNGER_DECAY_PER_TICK: f32 = 0.104;

pub fn decay_needs(mut query: Query<&mut Hunger>) {
    for mut hunger in &mut query {
        hunger.drain(HUNGER_DECAY_PER_TICK);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;
    use terri_core::{Agent, Position, SimClock};

    #[test]
    fn hunger_decays_over_ticks() {
        let mut sim = Sim::new();
        let id = sim
            .world_mut()
            .spawn((Agent, Position { x: 0.0, y: 0.0 }, Hunger(100.0)))
            .id();

        for _ in 0..100 {
            sim.tick();
        }

        let hunger = sim.world().get::<Hunger>(id).unwrap();
        let expected = 100.0 - (HUNGER_DECAY_PER_TICK * 100.0);
        assert!(
            (hunger.0 - expected).abs() < 0.001,
            "expected ~{expected}, got {}",
            hunger.0
        );

        // Covers the seam between the clock and the schedule. Without
        // this, dropping advance_clock from add_systems, or failing to
        // insert SimClock at all, would leave the whole workspace green.
        assert_eq!(sim.world().resource::<SimClock>().tick, 100);
    }

    #[test]
    fn hunger_never_goes_negative() {
        let mut sim = Sim::new();
        let id = sim.world_mut().spawn((Agent, Hunger(1.0))).id();

        for _ in 0..1000 {
            sim.tick();
        }

        assert_eq!(sim.world().get::<Hunger>(id).unwrap().0, 0.0);
    }
}
