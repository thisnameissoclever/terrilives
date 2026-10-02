//! Restore sleep ownership only at the version boundary that establishes its meaning.

use std::collections::{BTreeMap, HashSet};

use bevy_ecs::prelude::*;
use terri_core::{
    save::SavedSleepingPlaces, Agent, CommandQueue, Eating, Path, SimCommand, SimId, SleepPlace,
    SmartObject, Target,
};

use super::SaveError;
use crate::{
    beds::{BedAssignments, BedPlace},
    Content,
};

pub(crate) fn capture(world: &World) -> SavedSleepingPlaces {
    let mut active_places =
        world
            .try_query::<(Entity, &SleepPlace)>()
            .map_or_else(Vec::new, |mut query| {
                query
                    .iter(world)
                    .map(|(agent, place)| (agent.index_u32(), place.0))
                    .collect()
            });
    active_places.sort_unstable_by_key(|row| row.0);
    let assignments = world
        .resource::<BedAssignments>()
        .iter()
        .map(|(person, place)| (person.0, place.bed.index_u32(), place.ordinal))
        .collect();
    SavedSleepingPlaces {
        active_places,
        assignments,
    }
}

fn resolve(world: &World, index: u32) -> Result<Entity, SaveError> {
    bevy_ecs::entity::EntityIndex::from_raw_u32(index)
        .map(|index| world.entities().resolve_from_index(index))
        .filter(|entity| world.get_entity(*entity).is_ok())
        .ok_or(SaveError::InvalidValue)
}

fn sleep_targets(world: &World) -> BTreeMap<u32, (Entity, Target)> {
    let pack = world.resource::<Content>().0;
    world
        .try_query::<(Entity, &Agent, &Target)>()
        .map_or_else(BTreeMap::new, |mut query| {
            query
                .iter(world)
                .filter_map(|(agent, _, target)| {
                    let object = world.get::<SmartObject>(target.object)?;
                    let interaction = pack
                        .objects
                        .get(object.0 .0 as usize)?
                        .interactions
                        .get(target.interaction as usize)?;
                    (!pack.sleep_tag.is_empty() && interaction.tags.contains(&pack.sleep_tag))
                        .then_some((agent.index_u32(), (agent, *target)))
                })
                .collect()
        })
}

pub(crate) fn restore(world: &mut World, saved: SavedSleepingPlaces) -> Result<(), SaveError> {
    if saved
        .active_places
        .windows(2)
        .any(|pair| pair[0].0 >= pair[1].0)
        || saved
            .assignments
            .windows(2)
            .any(|pair| pair[0].0 >= pair[1].0)
    {
        return Err(SaveError::InvalidValue);
    }
    let expected = sleep_targets(world);
    if saved.active_places.len() != expected.len() {
        return Err(SaveError::InvalidValue);
    }
    let leased_beds: HashSet<_> = expected.values().map(|(_, target)| target.object).collect();
    if world
        .query::<(Entity, &Target)>()
        .iter(world)
        .any(|(owner, target)| {
            leased_beds.contains(&target.object) && !expected.contains_key(&owner.index_u32())
        })
    {
        return Err(SaveError::InvalidValue);
    }
    let pack = world.resource::<Content>().0;
    let mut occupied = HashSet::new();
    let mut checked = Vec::new();
    for (index, ordinal) in saved.active_places {
        let &(agent, target) = expected.get(&index).ok_or(SaveError::InvalidValue)?;
        let object = world.get::<SmartObject>(target.object).unwrap();
        let definition = pack.object(object.0);
        if ordinal >= crate::beds::capacity(pack, definition)
            || !occupied.insert((target.object, ordinal))
            || world.get::<terri_core::Socialising>(agent).is_some()
            || world.get::<terri_core::StepWork>(agent).is_some()
            || world.get::<terri_core::AtWork>(agent).is_some()
            || world.get::<terri_core::Commuting>(agent).is_some()
        {
            return Err(SaveError::InvalidValue);
        }
        match world.get::<Eating>(agent) {
            Some(action)
                if action.object == object.0
                    && action.interaction == target.interaction
                    && world.get::<Path>(agent).is_none() => {}
            None if world.get::<Path>(agent).is_some() => {}
            _ => return Err(SaveError::InvalidValue),
        }
        checked.push((agent, SleepPlace(ordinal)));
    }
    let living: HashSet<_> = world
        .try_query::<(&Agent, &SimId)>()
        .map_or_else(HashSet::new, |mut query| {
            query.iter(world).map(|(_, person)| person.0).collect()
        });
    let mut assignments = BedAssignments::default();
    for (person, bed, ordinal) in saved.assignments {
        let bed = resolve(world, bed)?;
        let definition = world
            .get::<SmartObject>(bed)
            .ok_or(SaveError::InvalidValue)?;
        if !living.contains(&person)
            || ordinal >= crate::beds::capacity(pack, pack.object(definition.0))
            || !assignments.set(SimId(person), Some(BedPlace { bed, ordinal }))
        {
            return Err(SaveError::InvalidValue);
        }
    }
    for (agent, place) in checked {
        world.entity_mut(agent).insert(place);
    }
    world.insert_resource(assignments);
    Ok(())
}

pub(crate) fn migrate_legacy(world: &mut World) -> Result<(), SaveError> {
    if world
        .resource::<CommandQueue>()
        .as_slice()
        .iter()
        .any(|command| matches!(command, SimCommand::SetBedAssignment { .. }))
    {
        return Err(SaveError::InvalidValue);
    }
    let active_places = sleep_targets(world)
        .keys()
        .map(|index| (*index, 0))
        .collect();
    restore(
        world,
        SavedSleepingPlaces {
            active_places,
            assignments: Vec::new(),
        },
    )
}
