use bevy_ecs::prelude::*;
use terri_core::{NeedId, Needs};

/// Hunger lost per tick (one sim-minute). At this rate a sim goes from
/// full to empty in roughly 16 sim-hours, which leaves room for sleep.
pub const HUNGER_DECAY_PER_TICK: f32 = 0.104;

/// Only hunger decays. All seven needs now exist and are hashed, but
/// their decay rates come from the content pack, which does not exist
/// yet; giving the other six a hardcoded rate here would be the very
/// coupling this milestone removes. They hold at `NEED_MAX` until then,
/// which is also what keeps existing behaviour unchanged: a satisfied
/// need has zero deficit and scores zero against every advertisement.
pub fn decay_needs(mut query: Query<&mut Needs>) {
    for mut needs in &mut query {
        needs.drain(NeedId::Hunger, HUNGER_DECAY_PER_TICK);
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
            .spawn((
                Agent,
                Position { x: 0.0, y: 0.0 },
                Needs::with(NeedId::Hunger, 100.0),
            ))
            .id();

        for _ in 0..100 {
            sim.tick();
        }

        let needs = sim.world().get::<Needs>(id).unwrap();
        let hunger = needs.get(NeedId::Hunger);
        let expected = 100.0 - (HUNGER_DECAY_PER_TICK * 100.0);
        assert!(
            (hunger - expected).abs() < 0.001,
            "expected ~{expected}, got {hunger}"
        );
        // Decay must reach hunger and nothing else. Draining the whole
        // array would leave the assertion above green while silently
        // starving six needs nothing has decay rates for yet.
        for id in NeedId::ALL {
            if id != NeedId::Hunger {
                assert_eq!(
                    needs.get(id),
                    terri_core::NEED_MAX,
                    "{} decayed, but only hunger has a rate",
                    id.as_str()
                );
            }
        }

        // Covers the seam between the clock and the schedule. Without
        // this, dropping advance_clock from add_systems, or failing to
        // insert SimClock at all, would leave the whole workspace green.
        assert_eq!(sim.world().resource::<SimClock>().tick, 100);
    }

    #[test]
    fn hunger_never_goes_negative() {
        let mut sim = Sim::new();
        let id = sim
            .world_mut()
            .spawn((Agent, Needs::with(NeedId::Hunger, 1.0)))
            .id();

        for _ in 0..1000 {
            sim.tick();
        }

        assert_eq!(
            sim.world().get::<Needs>(id).unwrap().get(NeedId::Hunger),
            0.0
        );
    }
}
