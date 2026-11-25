//! A toy belongs to one occupied bath; ordinary interactions retain the clock and effects.
use crate::{Content, SaveError};
use bevy_ecs::prelude::*;
use terri_core::save_editable_v23::SavedBathEpisode;
use terri_core::{
    Agent, AtWork, Commuting, Eating, Path, SimRng, SmartObject, Socialising, StepWork, Target,
};

#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub(crate) struct BathEpisode {
    pub tub: Entity,
    pub interaction: u32,
    pub toy: u8,
    pub total: u32,
    pub elapsed: u32,
}

fn occupied(world: &World, actor: Entity) -> Option<(Entity, u32, u32)> {
    if world.get::<Agent>(actor).is_none()
        || world.get::<Path>(actor).is_some()
        || world.get::<AtWork>(actor).is_some()
        || world.get::<Commuting>(actor).is_some()
        || world.get::<Socialising>(actor).is_some()
        || world.get::<StepWork>(actor).is_some()
        || world.get::<crate::pool::PoolEpisode>(actor).is_some()
    {
        return None;
    }
    let target = world.get::<Target>(actor)?;
    let eating = world.get::<Eating>(actor)?;
    let object = world.get::<SmartObject>(target.object)?;
    if eating.object != object.0
        || eating.interaction != target.interaction
        || eating.remaining_ticks == 0
    {
        return None;
    }
    let definition = world.resource::<Content>().0.object(object.0);
    let action = definition.interactions.get(target.interaction as usize)?;
    (action.activity == Some(terri_data::CompiledActivity::Bathing)).then_some((
        target.object,
        target.interaction,
        eating.remaining_ticks,
    ))
}

pub(crate) fn current(world: &World, actor: Entity) -> Option<&BathEpisode> {
    let episode = world.get::<BathEpisode>(actor)?;
    let (tub, interaction, remaining) = occupied(world, actor)?;
    (episode.tub == tub
        && episode.interaction == interaction
        && (1..=3).contains(&episode.toy)
        && episode.elapsed.checked_add(remaining) == Some(episode.total))
    .then_some(episode)
}

/// Paused maintenance removes retired ownership without advancing time or drawing randomness.
pub(crate) fn maintain(world: &mut World) {
    let rows: Vec<_> = world
        .query::<(Entity, &BathEpisode)>()
        .iter(world)
        .map(|(actor, episode)| (actor, episode.clone()))
        .collect();
    for (actor, episode) in rows {
        let elapsed = occupied(world, actor).and_then(|(tub, interaction, remaining)| {
            (tub == episode.tub && interaction == episode.interaction)
                .then(|| episode.total.checked_sub(remaining))
                .flatten()
        });
        if let Some(elapsed) = elapsed {
            world.get_mut::<BathEpisode>(actor).unwrap().elapsed = elapsed;
        } else {
            world.entity_mut(actor).remove::<BathEpisode>();
        }
    }
}

/// Ordinary arrivals draw from the live simulation stream.
pub(crate) fn begin(world: &mut World) {
    begin_with_draw(world, |world, bound| {
        world.resource_mut::<SimRng>().range(bound)
    });
}

/// Give older active baths deterministic toys while preserving the saved stream.
pub(crate) fn adopt_legacy(world: &mut World) {
    let mut rng = world.resource::<SimRng>().clone();
    begin_with_draw(world, |_, bound| rng.range(bound));
}

fn begin_with_draw(world: &mut World, mut draw: impl FnMut(&mut World, usize) -> usize) {
    maintain(world);
    let mut actors: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    actors.sort_by_key(|actor| actor.index_u32());
    for actor in actors {
        if world.get::<BathEpisode>(actor).is_some() {
            continue;
        }
        let Some((tub, interaction, total)) = occupied(world, actor) else {
            continue;
        };
        let toy = draw(world, 3) as u8 + 1;
        world.entity_mut(actor).insert(BathEpisode {
            tub,
            interaction,
            toy,
            total,
            elapsed: 0,
        });
    }
}

pub(crate) fn capture(world: &World) -> Vec<SavedBathEpisode> {
    let Some(mut query) = world.try_query::<(Entity, &BathEpisode)>() else {
        return Vec::new();
    };
    let mut rows: Vec<_> = query
        .iter(world)
        .filter_map(|(actor, _)| {
            let episode = current(world, actor)?;
            Some(SavedBathEpisode {
                actor: actor.index_u32(),
                tub: episode.tub.index_u32(),
                interaction: episode.interaction,
                toy: episode.toy,
                total: episode.total,
                elapsed: episode.elapsed,
            })
        })
        .collect();
    rows.sort_by_key(|row| row.actor);
    rows
}

pub(crate) fn restore(world: &mut World, rows: Vec<SavedBathEpisode>) -> Result<(), SaveError> {
    if rows.len() > 100_000 || rows.windows(2).any(|pair| pair[0].actor >= pair[1].actor) {
        return Err(SaveError::InvalidValue);
    }
    let actors: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    for actor in actors {
        if occupied(world, actor).is_some()
            && rows
                .binary_search_by_key(&actor.index_u32(), |row| row.actor)
                .is_err()
        {
            return Err(SaveError::InvalidValue);
        }
    }
    for row in &rows {
        let actor =
            crate::dining::entity(world, row.actor).ok_or(SaveError::InvalidEntityReference)?;
        let tub = crate::dining::entity(world, row.tub).ok_or(SaveError::InvalidEntityReference)?;
        let (actual_tub, interaction, remaining) =
            occupied(world, actor).ok_or(SaveError::InvalidValue)?;
        if tub != actual_tub
            || interaction != row.interaction
            || !(1..=3).contains(&row.toy)
            || row.total == 0
            || row.elapsed.checked_add(remaining) != Some(row.total)
        {
            return Err(SaveError::InvalidValue);
        }
        world.entity_mut(actor).insert(BathEpisode {
            tub,
            interaction,
            toy: row.toy,
            total: row.total,
            elapsed: row.elapsed,
        });
    }
    let actors: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    for actor in actors {
        if occupied(world, actor).is_some() && current(world, actor).is_none() {
            return Err(SaveError::InvalidValue);
        }
    }
    Ok(())
}

pub(crate) fn hash(world: &World, hash: &mut terri_core::FnvHasher) {
    let rows = capture(world);
    if rows.is_empty() {
        return;
    }
    hash.write_bytes(b"bath-episodes-v23");
    hash.write_u64(rows.len() as u64);
    for row in rows {
        for value in [
            u64::from(row.actor),
            u64::from(row.tub),
            u64::from(row.interaction),
            u64::from(row.toy),
            u64::from(row.total),
            u64::from(row.elapsed),
        ] {
            hash.write_u64(value);
        }
    }
}

#[cfg(test)]
mod tests;
