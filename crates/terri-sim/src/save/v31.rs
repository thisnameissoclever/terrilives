//! Remembered topic preferences extend schema thirty into schema thirty-one:
//! issue 359.
use super::{v28, Carried, SaveError};
use crate::topic_memory::{Memory, TopicMemory};
use crate::Sim;
use bevy_ecs::prelude::World;
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

/// Restores a schema-thirty-one save: the schema-thirty world with the
/// current pool clock, then the memories. Any bad row refuses the whole save
/// before the live world is touched.
pub(crate) fn restore(
    snapshot: SaveSnapshotV31,
    content: &'static terri_data::ContentPack,
    carried: Carried,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV31 {
        current,
        topic_memory,
    } = snapshot;
    validate_rows(&topic_memory)?;
    let mut candidate = v28::restore_current(current, content, carried)?;
    install(candidate.world_mut(), topic_memory)?;
    Ok(candidate)
}

#[cfg(test)]
#[path = "v31_tests.rs"]
mod tests;
