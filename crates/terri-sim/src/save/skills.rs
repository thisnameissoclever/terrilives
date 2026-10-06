//! Saved skill practice - [SK-save] in `docs/specs/2026-10-05-skills.md`.
//!
//! A current save carries every non-zero practice as `(entity index, skill
//! id, practice)` rows, and that field is authoritative even when empty. A
//! save written before skills existed carries no field at all; loading it
//! seeds each person's practice once from their worn capability traits'
//! saved states.

use super::SaveError;
use crate::skills::{seed_from_states, Ladder};
use bevy_ecs::prelude::*;
use terri_core::save::SavedSkills;
use terri_core::{Agent, Skills, Traits};
use terri_data::ContentPack;

/// Every living person's non-zero practice, ascending by entity index and
/// then skill id. Always `Some`, even when nobody holds any practice, so a
/// current save is never mistaken for one written before skills existed.
pub(crate) fn capture(world: &World, pack: &ContentPack) -> Option<SavedSkills> {
    let mut rows: Vec<(u32, String, f32)> = world
        .try_query::<(Entity, &Agent, &Skills)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .flat_map(|(entity, _, skills)| {
                    skills
                        .entries()
                        .iter()
                        .filter(|(_, practice)| *practice != 0.0)
                        .map(move |&(skill, practice)| {
                            let id = pack.skills[skill as usize].id.clone();
                            (entity.index_u32(), id, practice)
                        })
                })
                .collect()
        });
    rows.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    Some(SavedSkills { rows })
}

/// Installs a `Skills` component on every living person of a restored
/// candidate world.
///
/// `None` is a save written before skills existed: each person is seeded
/// from their worn capabilities' saved states, and a person wearing none
/// gets empty practice. `Some` is authoritative, even when empty: a person
/// with no rows gets empty practice and nothing is seeded. A present field
/// is checked whole before anything is written: rows strictly ascending by
/// entity index then id, each naming a living person, a known skill id
/// (an unknown one is a content mismatch), and a finite practice above
/// zero. Capture never writes a zero row, so one is refused as a save no
/// build wrote. Practice above the top of the skill's current ladder loads
/// as that top: the ladder and the levels are tuning, outside the content
/// fingerprint, so lowering them caps saved practice rather than refusing
/// every save that holds more.
pub(crate) fn restore(
    world: &mut World,
    pack: &ContentPack,
    saved: Option<SavedSkills>,
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
    let ladder = Ladder::from_tuning(&pack.tuning);
    let mut checked: Vec<(Entity, Vec<(u32, f32)>)> = Vec::new();
    for (index, id, practice) in saved.rows {
        let person = bevy_ecs::entity::EntityIndex::from_raw_u32(index)
            .map(|index| world.entities().resolve_from_index(index))
            .filter(|&entity| world.get::<Agent>(entity).is_some())
            .ok_or(SaveError::InvalidValue)?;
        let skill = pack
            .skills
            .iter()
            .position(|known| known.id == id)
            .ok_or(SaveError::InvalidContentReference)?;
        if !(practice.is_finite() && practice > 0.0) {
            return Err(SaveError::InvalidValue);
        }
        let top = ladder.max_practice(pack.skills[skill].levels);
        let entry = (skill as u32, practice.min(top));
        match checked.last_mut() {
            Some((last, entries)) if *last == person => entries.push(entry),
            _ => checked.push((person, vec![entry])),
        }
    }
    let mut people = world.query_filtered::<Entity, With<Agent>>();
    let everyone: Vec<Entity> = people.iter(world).collect();
    for person in everyone {
        world.entity_mut(person).insert(Skills::default());
    }
    for (person, entries) in checked {
        world
            .entity_mut(person)
            .insert(Skills::from_entries(entries));
    }
    Ok(())
}

/// The one-time seed for a save that holds no practice: every person's
/// practice reaches the mastery each worn capability's saved state names
/// ([`seed_from_states`]); a person wearing none holds no practice.
fn seed_everyone(world: &mut World, pack: &ContentPack) {
    let mut people = world.query_filtered::<(Entity, Option<&Traits>), With<Agent>>();
    let seeded: Vec<(Entity, Skills)> = people
        .iter(world)
        .map(|(person, worn)| {
            let mut skills = Skills::default();
            if let Some(worn) = worn {
                seed_from_states(&mut skills, worn, pack);
            }
            (person, skills)
        })
        .collect();
    for (person, skills) in seeded {
        world.entity_mut(person).insert(skills);
    }
}

#[cfg(test)]
#[path = "skills_tests.rs"]
mod tests;
