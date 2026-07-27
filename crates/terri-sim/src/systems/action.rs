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
