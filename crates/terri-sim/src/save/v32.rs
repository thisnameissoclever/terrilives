use std::collections::BTreeMap;

use bevy_ecs::prelude::World;
use terri_core::{save_v32::SavedHobbyMood, Agent, Entity, SaveSnapshotV32, SimClock};

use super::{v31, Carried, SaveError};
use crate::{hobby_mood, hobby_mood::HobbyMood, player_actions::saved_actor, Sim};

fn rows(world: &World) -> Vec<SavedHobbyMood> {
    hobby_mood::rows(world)
        .into_iter()
        .map(|(actor, minutes)| SavedHobbyMood { actor, minutes })
        .collect()
}

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV32 {
    SaveSnapshotV32 {
        previous: v31::capture(sim),
        hobby_mood: rows(sim.world()),
    }
}

pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV32 {
    SaveSnapshotV32 {
        previous: v31::capture_without_commands(sim),
        hobby_mood: rows(sim.world()),
    }
}

fn validate_rows(rows: &[SavedHobbyMood]) -> Result<(), SaveError> {
    if rows.len() > super::MAX_ENTITIES
        || rows.windows(2).any(|pair| pair[0].actor >= pair[1].actor)
        || rows
            .iter()
            .any(|row| !(1..=hobby_mood::MAX_MINUTES).contains(&row.minutes))
    {
        return Err(SaveError::InvalidValue);
    }
    Ok(())
}

fn resolve(
    world: &World,
    rows: &[SavedHobbyMood],
) -> Result<Vec<(Entity, Option<hobby_mood::HobbyActivity>)>, SaveError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = world
        .try_query::<(Entity, &Agent)>()
        .ok_or(SaveError::InvalidEntityReference)?;
    let actors: BTreeMap<_, _> = query
        .iter(world)
        .filter_map(|(entity, _)| Some((saved_actor(world, entity)?, entity)))
        .collect();
    rows.iter()
        .map(|row| {
            let actor = actors
                .get(&row.actor)
                .copied()
                .ok_or(SaveError::InvalidEntityReference)?;
            let (activity, loved) =
                hobby_mood::activity(world, actor).ok_or(SaveError::InvalidValue)?;
            // A content update may retire a hobby tag from an ongoing action.
            Ok((actor, loved.then_some(activity)))
        })
        .collect()
}

pub(crate) fn validate_live(world: &World) -> Result<(), SaveError> {
    let rows = rows(world);
    validate_rows(&rows)?;
    resolve(world, &rows).map(|_| ())
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV32,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV32 {
        previous,
        hobby_mood,
    } = snapshot;
    validate_rows(&hobby_mood)?;
    let mut candidate = v31::restore(previous, content, carried)?;
    let world = candidate.world_mut();
    let entities = resolve(world, &hobby_mood)?;
    let tick = world.resource::<SimClock>().tick;
    for (row, (actor, activity)) in hobby_mood.into_iter().zip(entities) {
        if let Some(activity) = activity {
            world.entity_mut(actor).insert(HobbyMood {
                minutes: row.minutes,
                tick,
                activity,
            });
        }
    }
    Ok(candidate)
}
