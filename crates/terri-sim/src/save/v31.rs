//! Remembered topic preferences extend schema thirty into schema thirty-one:
//! issue 359.
use super::{v28, Carried, SaveError};
use crate::topic_memory::{Memory, TopicMemory};
use crate::Sim;
use bevy_ecs::prelude::World;
use std::collections::BTreeSet;
use terri_core::{save_v31::SavedTopicMemory, SaveSnapshotV31, SimClock, SimId};

/// Every memory, strictly ascending by knower, other and tag, which is the
/// order the live list keeps.
pub(crate) fn rows(world: &World) -> Vec<SavedTopicMemory> {
    world
        .get_resource::<TopicMemory>()
        .map_or_else(Vec::new, |memory| {
            memory
                .entries()
                .iter()
                .map(|memory| SavedTopicMemory {
                    knower: memory.knower.0,
                    other: memory.other.0,
                    tag: memory.tag.clone(),
                    preference: memory.preference,
                    tick: memory.tick,
                })
                .collect()
        })
}

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV31 {
    SaveSnapshotV31 {
        current: v28::capture(sim),
        topic_memory: rows(sim.world()),
    }
}

/// Capture a transaction baseline while leaving the live input queue intact.
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV31 {
    SaveSnapshotV31 {
        current: v28::capture_without_commands(sim),
        topic_memory: rows(sim.world()),
    }
}

/// The loader's checks on the rows alone: no more than the list cap,
/// strictly ascending by knower, other and tag (so no duplicates), nobody
/// remembering themselves, a tag of at most the text cap that is not
/// smalltalk (which teaches nothing), and a finite preference from -1 to 1.
pub(crate) fn validate_rows(rows: &[SavedTopicMemory]) -> Result<(), SaveError> {
    if rows.len() > super::MAX_LIST_ENTRIES
        || rows.windows(2).any(|pair| {
            (pair[0].knower, pair[0].other, &pair[0].tag)
                >= (pair[1].knower, pair[1].other, &pair[1].tag)
        })
        || rows.iter().any(|row| {
            row.knower == row.other
                || row.tag.is_empty()
                || row.tag.len() > super::MAX_TEXT_BYTES
                || row.tag == crate::social_episode::SMALLTALK_TAG
                || !row.preference.is_finite()
                || !(-1.0..=1.0).contains(&row.preference)
        })
    {
        return Err(SaveError::InvalidValue);
    }
    Ok(())
}

/// Installs the rows into a restored world: both people must be alive in
/// it, and no memory may be learned after its tick.
fn install(world: &mut World, rows: Vec<SavedTopicMemory>) -> Result<(), SaveError> {
    let now = world.resource::<SimClock>().tick;
    let mut memories = Vec::with_capacity(rows.len());
    for row in rows {
        if crate::edit::living_entity(world, row.knower).is_none()
            || crate::edit::living_entity(world, row.other).is_none()
        {
            return Err(SaveError::InvalidEntityReference);
        }
        if row.tick > now {
            return Err(SaveError::InvalidValue);
        }
        memories.push(Memory {
            knower: SimId(row.knower),
            other: SimId(row.other),
            tag: row.tag,
            preference: row.preference,
            tick: row.tick,
        });
    }
    world.insert_resource(TopicMemory::from_sorted(memories));
    Ok(())
}

/// [AP-cmd-post]: the rows a save would write for the live world pass every
/// check a load makes of them.
pub(crate) fn validate_live(world: &World) -> Result<(), SaveError> {
    let rows = rows(world);
    validate_rows(&rows)?;
    let now = world.resource::<SimClock>().tick;
    for row in &rows {
        if crate::edit::living_entity(world, row.knower).is_none()
            || crate::edit::living_entity(world, row.other).is_none()
        {
            return Err(SaveError::InvalidEntityReference);
        }
        if row.tick > now {
            return Err(SaveError::InvalidValue);
        }
    }
    Ok(())
}

/// Restore the current save shape, including shared pool continuations.
pub(crate) fn restore(
    snapshot: SaveSnapshotV31,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    restore_with(snapshot, content, carried, v28::restore_shared)
}

/// The published V31 header retains the exclusive pool phase meanings.
pub(crate) fn restore_published(
    snapshot: SaveSnapshotV31,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    restore_with(snapshot, content, carried, v28::restore_current)
}

pub(crate) fn validate_exclusive_pools(
    snapshot: &SaveSnapshotV31,
    content: &'static terri_data::ContentPack,
) -> Result<(), SaveError> {
    if snapshot
        .pools
        .iter()
        .any(|row| row.phase > crate::pool::CANCELED_LANDING)
    {
        return Err(SaveError::InvalidValue);
    }
    let entities = &snapshot
        .room_world_v16()
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .world
        .entities;
    let pools: BTreeSet<_> = entities
        .iter()
        .filter_map(|row| {
            let id = content.find(row.smart_object.as_deref()?)?;
            crate::pool::has_pool(content.object(id)).then_some(row.index)
        })
        .collect();
    let mut occupied = BTreeSet::new();
    for target in entities.iter().filter_map(|row| row.target.as_ref()) {
        if pools.contains(&target.object) && !occupied.insert(target.object) {
            return Err(SaveError::InvalidValue);
        }
    }
    Ok(())
}

fn restore_with(
    snapshot: SaveSnapshotV31,
    content: &'static terri_data::ContentPack,
    carried: Carried,
    restore_world: fn(
        terri_core::SaveSnapshotV30,
        &'static terri_data::ContentPack,
        Carried,
    ) -> Result<Sim, SaveError>,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV31 {
        current,
        topic_memory,
    } = snapshot;
    validate_rows(&topic_memory)?;
    let mut candidate = restore_world(current, content, carried)?;
    install(candidate.world_mut(), topic_memory)?;
    Ok(candidate)
}

#[cfg(test)]
#[path = "v31_tests.rs"]
mod tests;
