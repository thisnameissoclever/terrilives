//! Saved affinity values - [OA-values] in
//! `docs/specs/2026-10-06-object-affinities.md`.
//!
//! A current save carries every value that is not exactly 0.0 as `(entity
//! index, kind id, value)` rows, and that field is authoritative even when
//! empty. A save written before affinities existed carries no field at
//! all; loading it draws every person's values once from the saved world
//! generator, in entity-index order.

use super::SaveError;
use bevy_ecs::prelude::*;
use terri_core::save::SavedAffinities;
use terri_core::{Affinities, Agent, SimRng, Traits};
use terri_data::ContentPack;

/// Every living person's values that are not exactly 0.0, ascending by
/// entity index and then kind id. Always `Some`, even when nobody holds a
/// value, so a current save is never mistaken for one written before
/// affinities existed.
pub(crate) fn capture(world: &World, pack: &ContentPack) -> Option<SavedAffinities> {
    let mut rows: Vec<(u32, String, f32)> = world
        .try_query::<(Entity, &Agent, &Affinities)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .flat_map(|(entity, _, affinities)| {
                    pack.affinities
                        .iter()
                        .zip(affinities.values())
                        .filter(|(_, value)| **value != 0.0)
                        .map(move |(kind, &value)| (entity.index_u32(), kind.id.clone(), value))
                })
                .collect()
        });
    rows.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    Some(SavedAffinities { rows })
}

/// Installs an `Affinities` component on every living person of a
/// restored candidate world.
///
/// `None` is a save written before affinities existed: every person's
/// values are drawn once ([`seed_everyone`]). `Some` is authoritative,
/// even when empty: every person holds 0.0 for every kind, then the rows
/// are applied, and nothing is drawn. A present field is checked whole
/// before anything is written: rows strictly ascending by entity index
/// then id, each naming a living person, a known kind id (an unknown one
/// is a content mismatch), and a finite value in -1.0..=1.0 that is not
/// exactly 0.0. Capture never writes a zero row, so one is refused as a
/// save no build wrote.
pub(crate) fn restore(
    world: &mut World,
    pack: &ContentPack,
    saved: Option<SavedAffinities>,
) -> Result<(), SaveError> {
    let Some(saved) = saved else {
        seed_everyone(world, pack);
        return Ok(());
    };
    if saved
        .rows
        .windows(2)
        .any(|pair| (pair[0].0, &pair[0].1) >= (pair[1].0, &pair[1].1))
    {
        return Err(SaveError::InvalidValue);
    }
    let mut checked: Vec<(Entity, usize, f32)> = Vec::with_capacity(saved.rows.len());
    for (index, id, value) in saved.rows {
        let person = bevy_ecs::entity::EntityIndex::from_raw_u32(index)
            .map(|index| world.entities().resolve_from_index(index))
            .filter(|&entity| world.get::<Agent>(entity).is_some())
            .ok_or(SaveError::InvalidValue)?;
        let kind = pack
            .affinities
            .iter()
            .position(|known| known.id == id)
            .ok_or(SaveError::InvalidContentReference)?;
        if !(value.is_finite() && (-1.0..=1.0).contains(&value) && value != 0.0) {
            return Err(SaveError::InvalidValue);
        }
        checked.push((person, kind, value));
    }
    let mut people = world.query_filtered::<Entity, With<Agent>>();
    let everyone: Vec<Entity> = people.iter(world).collect();
    let mut values: Vec<(Entity, Vec<f32>)> = everyone
        .into_iter()
        .map(|person| (person, vec![0.0; pack.affinities.len()]))
        .collect();
    for (person, kind, value) in checked {
        if let Some((_, held)) = values.iter_mut().find(|(entity, _)| *entity == person) {
            held[kind] = value;
        }
    }
    for (person, held) in values {
        world
            .entity_mut(person)
            .insert(Affinities::from_values(held));
    }
    Ok(())
}

/// The one-time draw for a save that holds no values: every living person,
/// in ascending entity-index order, takes [`crate::affinity::draw`] from the
/// saved world generator with their worn traits.
///
/// A person the save left without an instinct takes that draw first
/// (`self_preservation::migrate`), so a save older than both features
/// gets the very instincts it got before affinities existed, and its
/// affinity values come after them.
fn seed_everyone(world: &mut World, pack: &ContentPack) {
    super::self_preservation::migrate(world);
    let mut query = world.query_filtered::<(Entity, Option<&Traits>), With<Agent>>();
    let mut people: Vec<(Entity, Option<Traits>)> = query
        .iter(world)
        .map(|(person, worn)| (person, worn.cloned()))
        .collect();
    people.sort_unstable_by_key(|(person, _)| person.index_u32());
    for (person, worn) in people {
        let drawn = {
            let mut rng = world.resource_mut::<SimRng>();
            crate::affinity::draw(&mut rng, pack, worn.as_ref())
        };
        world.entity_mut(person).insert(drawn);
    }
}

#[cfg(test)]
#[path = "affinities_tests.rs"]
mod tests;
