use bevy_ecs::prelude::*;
use terri_core::{Eating, Hunger, Reserved, Target};

/// Advances in-progress interactions. When one finishes, the agent
/// releases its reservation and becomes idle again.
pub fn tick_interactions(
    mut commands: Commands,
    mut agents: Query<(Entity, &mut Eating, &mut Hunger, &Target)>,
) {
    for (entity, mut eating, mut hunger, target) in &mut agents {
        hunger.fill(eating.delta_per_tick);
        eating.remaining_ticks = eating.remaining_ticks.saturating_sub(1);

        if eating.remaining_ticks == 0 {
            commands
                .entity(entity)
                .remove::<Eating>()
                .remove::<Target>();
            // try_remove, not remove: `Commands::entity` deliberately
            // does not validate, so a `Target` pointing at an entity
            // that no longer exists routes the queued removal to the
            // command error handler. `try_remove` silences it instead,
            // which keeps the failure a no-op rather than something
            // whose severity depends on the configured handler.
            //
            // Nothing in M0 despawns entities, so this is unreachable
            // today. Reservation leaks that remain UNHANDLED, and must
            // be revisited when despawning or component removal arrives:
            //   - the agent is despawned mid-interaction, so this system
            //     never runs for it and `Reserved` is never removed;
            //   - the target loses its `SmartObject` mid-walk, so
            //     `follow_path` drops `Path` and `Target` without
            //     releasing the reservation;
            //   - `Hunger` is removed from an eating agent, dropping it
            //     out of this query with `Eating` and `Target` intact.
            // Reclaiming those needs a dedicated system, which is a
            // later milestone, not a patch here.
            commands.entity(target.0).try_remove::<Reserved>();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::Sim;
    use terri_core::{Agent, Eating, Hunger, Position, Reserved, SmartObject, Target};

    #[test]
    fn hungry_sim_walks_to_the_fridge_and_eats() {
        // Event-driven, not tick-counted, on purpose. Ticking a fixed
        // number of times and then asserting `Eating` is none proves
        // nothing: it passes just as well if the meal never started, the
        // "test that can pass on empty input" pattern from
        // lessons-learned [L3]. It is also phase-dependent, because the
        // agent oscillates between hunger and satiety forever, so any
        // change to the decay rate, walk speed, meal duration, action
        // threshold or spawn geometry moves which tick lands in an idle
        // window.
        let mut sim = Sim::new_with_lot(16, 16);

        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 10.0, y: 8.0 },
                SmartObject {
                    hunger_delta: 40.0,
                    duration_ticks: 15,
                    slots: 1,
                },
            ))
            .id();

        let sim_entity = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, Hunger(20.0)))
            .id();

        // Drive until the meal starts. Bounded, and the bound failing is
        // a real failure.
        let mut started = false;
        for _ in 0..400 {
            sim.tick();
            if sim.world().get::<Eating>(sim_entity).is_some() {
                started = true;
                break;
            }
        }
        assert!(started, "agent must reach the fridge and begin eating");
        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "fridge must be reserved during the meal"
        );

        let pos = sim.world().get::<Position>(sim_entity).unwrap();
        let dist = ((pos.x - 10.0).powi(2) + (pos.y - 8.0).powi(2)).sqrt();
        assert!(dist < 2.0, "sim should be at the fridge; distance {dist}");

        let before = sim.world().get::<Hunger>(sim_entity).unwrap().0;

        // Break on completion rather than counting ticks: counting
        // exactly duration_ticks lands on the re-target tick, where
        // Eating is re-inserted in the same tick because the path is
        // empty.
        let mut finished = false;
        for _ in 0..64 {
            sim.tick();
            if sim.world().get::<Eating>(sim_entity).is_none() {
                finished = true;
                break;
            }
        }
        assert!(finished, "meal must terminate");
        assert!(
            sim.world().get::<Target>(sim_entity).is_none(),
            "target must clear on completion"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_none(),
            "reservation must be released"
        );

        let after = sim.world().get::<Hunger>(sim_entity).unwrap().0;
        assert!(
            after > before + 30.0,
            "meal must deliver most of hunger_delta; {before} -> {after}"
        );
    }

    #[test]
    fn satisfied_sim_does_not_seek_food() {
        let mut sim = Sim::new_with_lot(16, 16);
        sim.world_mut().spawn((
            Position { x: 10.0, y: 8.0 },
            SmartObject {
                hunger_delta: 40.0,
                duration_ticks: 15,
                slots: 1,
            },
        ));
        let sim_entity = sim
            .world_mut()
            .spawn((Agent, Position { x: 1.0, y: 1.0 }, Hunger(100.0)))
            .id();

        for _ in 0..5 {
            sim.tick();
        }

        assert!(
            sim.world().get::<Target>(sim_entity).is_none(),
            "a full sim should not target the fridge"
        );
    }
}
