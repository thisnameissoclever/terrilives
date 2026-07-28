use bevy_ecs::prelude::*;
use terri_core::{NeedId, Needs};

use crate::Content;

/// Only hunger decays, at the rate `content/needs.toml` declares for it.
///
/// The rate used to be a `HUNGER_DECAY_PER_TICK` constant here as well as
/// a row in the content file: two copies of one number with nothing
/// asserting they agreed. The content file is now the only copy.
///
/// The other six needs hold at their spawn level. All seven have decay
/// rates in content already, and Task 7 is where the loop widens to use
/// them; keeping this to hunger is what makes the `SmartObject` migration
/// a behaviour-preserving change on its own, with the world-hash golden
/// vectors as the evidence.
pub fn decay_needs(content: Res<Content>, mut query: Query<&mut Needs>) {
    let hunger = content.0.decay_per_tick[NeedId::Hunger.index()];
    for mut needs in &mut query {
        needs.drain(NeedId::Hunger, hunger);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_content::hunger_decay_per_tick;
    use crate::Sim;
    use terri_core::{Agent, Position, SimClock};

    #[test]
    fn hunger_decays_at_the_rate_content_declares() {
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
        // Read from the pack rather than restated as a literal. The
        // rate has one home now, and a test that spelled 0.104 out again
        // would recreate the duplication this task removed - and would
        // pass while the simulation used a different number.
        let rate = hunger_decay_per_tick();
        assert!(rate > 0.0, "a zero rate would make this test vacuous");
        let expected = 100.0 - (rate * 100.0);
        assert!(
            (hunger - expected).abs() < 0.001,
            "expected ~{expected}, got {hunger}"
        );
        // Decay must reach hunger and nothing else. Draining the whole
        // array would leave the assertion above green while silently
        // starving six needs the simulation does not yet apply rates to,
        // and would move both world-hash golden vectors. Task 7 is where
        // that becomes intended; until then it is a regression.
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
