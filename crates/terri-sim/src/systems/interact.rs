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
            commands.entity(target.0).remove::<Reserved>();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::Sim;
    use terri_core::{Agent, Eating, Hunger, Position, SmartObject, Target};

    #[test]
    fn hungry_sim_walks_to_the_fridge_and_eats() {
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

        // Long enough to path across the lot and finish the meal.
        for _ in 0..400 {
            sim.tick();
        }

        let hunger = sim.world().get::<Hunger>(sim_entity).unwrap().0;
        assert!(
            hunger > 40.0,
            "sim should have eaten and recovered; hunger is {hunger}"
        );

        let pos = sim.world().get::<Position>(sim_entity).unwrap();
        let dist = ((pos.x - 10.0).powi(2) + (pos.y - 8.0).powi(2)).sqrt();
        assert!(dist < 2.0, "sim should be at the fridge; distance {dist}");

        assert!(
            sim.world().get::<Eating>(sim_entity).is_none(),
            "interaction should have completed"
        );
        let _ = fridge;
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
