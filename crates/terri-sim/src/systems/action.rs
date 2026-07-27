use bevy_ecs::prelude::*;
use terri_core::{Agent, Eating, Hunger, Path, Position, Reserved, SmartObject, Target, TileGrid};

use super::advertise::score_advertisement;

/// Below this score nothing is worth doing, so the agent stays idle.
const ACTION_THRESHOLD: f32 = 0.05;

/// Idle agents scan advertisements, pick the best, reserve it, and path
/// to it. Serialized on purpose: reservation is contended state, so it
/// runs in deterministic entity order per [D4].
///
/// The type_complexity allow is unavoidable: the filter tuple that keeps
/// busy agents out of selection is exactly what pushes the query type
/// past clippy's threshold, and a type alias would only move the same
/// type somewhere less readable.
#[allow(clippy::type_complexity)]
pub fn select_action(
    mut commands: Commands,
    grid: Res<TileGrid>,
    agents: Query<(Entity, &Position, &Hunger), (With<Agent>, Without<Target>, Without<Eating>)>,
    objects: Query<(Entity, &Position, &SmartObject), Without<Reserved>>,
) {
    // Collect and sort so iteration order cannot vary between runs.
    let mut idle: Vec<(Entity, Position, f32)> = agents
        .iter()
        .map(|(e, pos, hunger)| (e, *pos, hunger.deficit()))
        .collect();
    idle.sort_by_key(|(e, _, _)| e.index());

    let mut claimed: Vec<Entity> = Vec::new();

    for (agent, agent_pos, deficit) in idle {
        let mut best: Option<(Entity, Position, f32)> = None;

        for (object, object_pos, advert) in &objects {
            if claimed.contains(&object) {
                continue;
            }
            // Euclidean straight-line distance, deliberately, not A*
            // path length. Scoring runs against every candidate object
            // every tick, so pathing each one first would be far too
            // expensive. The cost is that an object one tile away
            // through a wall scores as near and is then walked around.
            // Acceptable in M0's single open room; revisit when [D7]'s
            // room and portal graph lands and walls become common.
            let dx = object_pos.x - agent_pos.x;
            let dy = object_pos.y - agent_pos.y;
            let distance = (dx * dx + dy * dy).sqrt();
            let score = score_advertisement(
                deficit,
                advert.hunger_delta,
                advert.duration_ticks,
                distance,
            );
            let better = match best {
                // Tiebreak on entity index so equal scores resolve
                // identically every run.
                Some((best_e, _, best_score)) => {
                    score > best_score || (score == best_score && object.index() < best_e.index())
                }
                None => true,
            };
            if score > ACTION_THRESHOLD && better {
                best = Some((object, *object_pos, score));
            }
        }

        let Some((object, object_pos, _)) = best else {
            continue;
        };

        let from = (agent_pos.x.round() as i32, agent_pos.y.round() as i32);
        let to = (object_pos.x.round() as i32, object_pos.y.round() as i32);
        let Some(steps) = grid.find_path(from, to) else {
            continue;
        };

        claimed.push(object);
        commands.entity(object).insert(Reserved);
        commands
            .entity(agent)
            .insert((Target(object), Path { steps, cursor: 0 }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Sim;

    #[test]
    fn contention_resolves_by_entity_order_not_iteration_order() {
        // Three identical agents contend for one single-slot fridge.
        // Exactly one may win, and which one must not depend on
        // interaction history.
        //
        // This is a GOLDEN assertion: it names the winning entity. That
        // is deliberate. Do NOT "simplify" it into a two-run comparison.
        // Running the sim twice in one process compares two identical
        // answers, because bevy's iteration is deterministic for a fixed
        // archetype layout and spawn order, so a broken tiebreak would
        // simply be broken the same way twice. The same trap is
        // documented at terri-core's
        // `tie_breaking_pins_one_specific_path_among_equals`.
        //
        // The churn below is what makes `idle.sort_by_key` load-bearing.
        // An agent changes archetype every time `Target`, `Path` or
        // `Eating` is added or removed, and leaving an archetype
        // swap-removes the agent from its table while re-entering
        // appends it at the end. So after a few meals `agents.iter()`
        // yields agents in an order set by who ate last rather than by
        // spawn order. Adding and removing one component reproduces in
        // two lines what a handful of meals does naturally. Without the
        // sort, who wins a contended object becomes a function of
        // interaction history.
        let mut sim = Sim::new_with_lot(16, 16);

        // Spawn agents first so entity index ascends with spawn order.
        let agents: Vec<Entity> = (0..3)
            .map(|_| {
                sim.world_mut()
                    .spawn((Agent, Position { x: 1.0, y: 1.0 }, Hunger(20.0)))
                    .id()
            })
            .collect();
        let fridge = sim
            .world_mut()
            .spawn((
                Position { x: 5.0, y: 5.0 },
                SmartObject {
                    hunger_delta: 40.0,
                    duration_ticks: 15,
                    slots: 1,
                },
            ))
            .id();

        // Archetype churn. Moves the lowest-index agent to the back of
        // the table, so iteration order and index order now disagree.
        sim.world_mut().entity_mut(agents[0]).insert(Eating {
            remaining_ticks: 1,
            delta_per_tick: 0.0,
        });
        sim.world_mut().entity_mut(agents[0]).remove::<Eating>();

        sim.tick();

        let holders: Vec<Entity> = agents
            .iter()
            .copied()
            .filter(|e| sim.world().get::<Target>(*e).is_some())
            .collect();

        // Assert non-emptiness explicitly, per lessons-learned [L3]:
        // "exactly one" must not be satisfiable by "none at all".
        assert_eq!(
            holders.len(),
            1,
            "exactly one agent may claim a single-slot object; got {holders:?}"
        );
        assert_eq!(
            holders[0], agents[0],
            "the lowest entity index must win regardless of table order; \
             a different winner means the deterministic sort is gone"
        );
        assert_eq!(
            sim.world().get::<Target>(holders[0]).unwrap().0,
            fridge,
            "the winner must target the fridge"
        );
        assert!(
            sim.world().get::<Reserved>(fridge).is_some(),
            "the winner must have reserved the fridge"
        );
    }

    #[test]
    fn tied_scores_resolve_by_object_index_not_archetype_order() {
        // One agent, two objects whose scores are exactly equal. Which
        // one wins is decided entirely by the second half of the `better`
        // expression in `select_action`:
        //
        //     score == best_score && object.index() < best_e.index()
        //
        // That clause is what makes the argmax unique. The `objects`
        // query iterates UNSORTED, which is only safe because this
        // tiebreak leaves no room for iteration order to matter. Delete
        // the clause and the winner becomes whichever tied object the
        // archetype happened to yield first, and archetype order shifts
        // as objects gain and lose `Reserved`.
        //
        // GOLDEN assertion, for the same reason as the contention test
        // above: do NOT rewrite this as a two-run comparison. Two runs in
        // one process share one archetype layout, so they would agree
        // with each other while both being wrong.
        let mut sim = Sim::new_with_lot(16, 16);

        let advert = SmartObject {
            hunger_delta: 40.0,
            duration_ticks: 15,
            slots: 1,
        };
        // Mirrored about the agent at x = 8, so both are exactly 3 tiles
        // away. Spawned before the agent so object index ascends with
        // spawn order.
        let left = sim
            .world_mut()
            .spawn((Position { x: 5.0, y: 8.0 }, advert))
            .id();
        let right = sim
            .world_mut()
            .spawn((Position { x: 11.0, y: 8.0 }, advert))
            .id();
        let agent = sim
            .world_mut()
            .spawn((Agent, Position { x: 8.0, y: 8.0 }, Hunger(20.0)))
            .id();

        // Archetype churn on the objects, which is how it happens for
        // real: an object leaves and re-enters the unreserved archetype
        // every time it is claimed and released. Leaving swap-removes it
        // from its table and re-entering appends it at the end, so the
        // lower-index object now iterates LAST.
        sim.world_mut().entity_mut(left).insert(Reserved);
        sim.world_mut().entity_mut(left).remove::<Reserved>();

        sim.tick();

        // The precondition this whole test rests on: the two scores must
        // be BIT-identical, not merely close. If they differed in the
        // last bit, `score > best_score` would settle the winner and the
        // tiebreak would never fire, leaving the test decorative.
        // `decay_needs` runs before `select_action` within a tick and
        // nothing else touches hunger on a tick where the agent only
        // starts walking, so the post-tick level is exactly the one
        // scoring saw.
        let deficit = sim.world().get::<Hunger>(agent).unwrap().deficit();
        let distance = |ox: f32| {
            let dx = ox - 8.0;
            let dy = 8.0f32 - 8.0;
            (dx * dx + dy * dy).sqrt()
        };
        let score_left = score_advertisement(deficit, 40.0, 15, distance(5.0));
        let score_right = score_advertisement(deficit, 40.0, 15, distance(11.0));
        assert_eq!(
            score_left.to_bits(),
            score_right.to_bits(),
            "the two objects must score bitwise identically or this test \
             pins nothing; got {score_left} and {score_right}"
        );
        assert!(
            score_left > ACTION_THRESHOLD,
            "the tied score must clear the action threshold; got {score_left}"
        );

        let target = sim
            .world()
            .get::<Target>(agent)
            .expect("the agent must have chosen one of the tied objects");
        assert_eq!(
            target.0, left,
            "the lower object index must win a tied score regardless of \
             archetype order; a different winner means the score tiebreak \
             is gone"
        );
        assert!(
            sim.world().get::<Reserved>(left).is_some(),
            "the winning object must be reserved"
        );
        assert!(
            sim.world().get::<Reserved>(right).is_none(),
            "the losing object must stay free"
        );
    }
}
