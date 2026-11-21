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

/// The loader's checks on the rows alone: no more rows than entities,
/// strictly ordered by actor, and every balance nonzero and within the
/// ledger's bound. Shared with the admin panel's post-condition
/// ([AP-cmd-post] in `docs/specs/2026-11-20-admin-panel.md`).
fn validate_rows(rows: &[SavedNeedMood]) -> Result<(), SaveError> {
    let limit = crate::need_mood::MAX_UNITS;
    if rows.len() > super::MAX_ENTITIES
        || rows.windows(2).any(|pair| pair[0].actor >= pair[1].actor)
        || rows
            .iter()
            .any(|row| row.units == 0 || !(-limit..=limit).contains(&row.units))
    {
        return Err(SaveError::InvalidValue);
    }
    Ok(())
}

/// The entity each row names: a person with needs in `world`. A row naming
/// anyone else refuses the save. Shared with the admin panel's
/// post-condition, as [`validate_rows`] is.
fn resolve(world: &World, rows: &[SavedNeedMood]) -> Result<Vec<Entity>, SaveError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = world
        .try_query::<(Entity, &Needs)>()
        .ok_or(SaveError::InvalidEntityReference)?;
    let actors: BTreeMap<_, _> = query
        .iter(world)
        .filter_map(|(entity, _)| Some((saved_actor(world, entity)?, entity)))
        .collect();
    rows.iter()
        .map(|row| {
            actors
                .get(&row.actor)
                .copied()
                .ok_or(SaveError::InvalidEntityReference)
        })
        .collect()
}

/// [AP-cmd-post]: the rows a save would write for the live world pass every
/// check a load makes of them.
pub(crate) fn validate_live(world: &World) -> Result<(), SaveError> {
    let rows = rows(world);
    validate_rows(&rows)?;
    resolve(world, &rows).map(|_| ())
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV27,
    content: &'static terri_data::ContentPack,
    carried: super::Carried,
) -> Result<Sim, SaveError> {
    let rows = snapshot.need_mood;
    validate_rows(&rows)?;

    let mut candidate = super::v24::restore(snapshot.legacy, content, carried)?;
    let entities = resolve(candidate.world(), &rows)?;
    let world = candidate.world_mut();
    for (row, entity) in rows.iter().zip(entities) {
        world.entity_mut(entity).insert(NeedMood(row.units));
    }
    Ok(candidate)
}

#[cfg(test)]
#[path = "v27_tests.rs"]
mod tests;
