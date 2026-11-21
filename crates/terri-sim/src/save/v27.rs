use std::collections::BTreeMap;

use bevy_ecs::prelude::World;
use terri_core::{save_v27::SavedNeedMood, Entity, Needs, SaveSnapshotV27};

use crate::{need_mood, need_mood::NeedMood, player_actions::saved_actor, Sim};

use super::SaveError;

fn rows(world: &World) -> Vec<SavedNeedMood> {
    need_mood::rows(world)
        .into_iter()
        .map(|(actor, units)| SavedNeedMood { actor, units })
        .collect()
}

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV27 {
    SaveSnapshotV27 {
        legacy: super::v24::capture(sim),
        need_mood: rows(sim.world()),
    }
}

pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV27 {
    SaveSnapshotV27 {
        legacy: super::v24::capture_without_commands(sim),
        need_mood: rows(sim.world()),
    }
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV27,
    content: &'static terri_data::ContentPack,
    carried: super::Carried,
) -> Result<Sim, SaveError> {
    let rows = snapshot.need_mood;
    let limit = crate::need_mood::MAX_UNITS;
    if rows.len() > super::MAX_ENTITIES
        || rows.windows(2).any(|pair| pair[0].actor >= pair[1].actor)
        || rows
            .iter()
            .any(|row| row.units == 0 || !(-limit..=limit).contains(&row.units))
    {
        return Err(SaveError::InvalidValue);
    }

    let mut candidate = super::v24::restore(snapshot.legacy, content, carried)?;
    if rows.is_empty() {
        return Ok(candidate);
    }
    let world = candidate.world_mut();
    let mut query = world.query::<(Entity, &Needs)>();
    let actors: BTreeMap<_, _> = query
        .iter(world)
        .filter_map(|(entity, _)| Some((saved_actor(world, entity)?, entity)))
        .collect();
    for row in rows {
        let entity = actors
            .get(&row.actor)
            .ok_or(SaveError::InvalidEntityReference)?;
        world.entity_mut(*entity).insert(NeedMood(row.units));
    }
    Ok(candidate)
}

#[cfg(test)]
#[path = "v27_tests.rs"]
mod tests;
