//! [ES-atomic]: editing a living person in place. One command carries the
//! complete new identity; it is checked whole before anything is written,
//! and the person keeps their SimId, needs, position, career, hobbies,
//! satisfaction, relationships, instinct and mortality records.

use bevy_ecs::prelude::*;
use terri_core::layout::{FamilyTies, Relation};
use terri_core::save::SavedDomestic;
use terri_core::{Agent, Personality, SimId, SimName, Traits};

use crate::household::{
    authored_trait_state, personality_from, validate_name, validate_traits, HousemateRefusal,
};
use crate::placement::LotEditState;
use crate::Content;

/// Why an edit was refused. `validate` checks the person, the name, the
/// personality, the traits, and then each tie in submitted order; within one
/// tie it checks for a self-tie, then an unknown relative, then a repeated
/// relative. The numbers are the codes the boundary reports, so the tie
/// codes do not follow that order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum EditRefusal {
    UnknownPerson = 1,
    BadName = 2,
    UnknownPersonality = 3,
    TooManyTraits = 4,
    UnknownTrait = 5,
    RepeatedTrait = 6,
    UnknownRelative = 7,
    RepeatedRelative = 8,
    SelfTie = 9,
}

impl From<HousemateRefusal> for EditRefusal {
    fn from(refusal: HousemateRefusal) -> Self {
        match refusal {
            HousemateRefusal::BadName => Self::BadName,
            HousemateRefusal::UnknownPersonality => Self::UnknownPersonality,
            HousemateRefusal::TooManyTraits => Self::TooManyTraits,
            HousemateRefusal::UnknownTrait => Self::UnknownTrait,
            HousemateRefusal::RepeatedTrait => Self::RepeatedTrait,
            // The shared helpers never return these; the edit path does not
            // run arrival or capacity checks.
            HousemateRefusal::HouseholdFull
            | HousemateRefusal::NoWayIn
            | HousemateRefusal::BadInstinct => Self::UnknownPerson,
        }
    }
}

/// The drain's answer to one edit. `sim` is the edited person's entity
/// index when accepted. `handled` numbers every answer so the shell can
/// tell its own edit's answer from an older one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditResult {
    pub sim: Option<u32>,
    pub reason: Option<EditRefusal>,
    pub handled: u32,
}

/// One edit as the drain sees it; borrowed from the command.
#[derive(Debug, Clone, Copy)]
pub struct Edit<'a> {
    pub sim: u32,
    pub name: &'a str,
    pub personality: Option<u32>,
    pub traits: &'a [u32],
    pub ties: &'a [(u32, Option<Relation>)],
}

/// The living person with this permanent SimId, if there is one. The dead
/// keep their SimId in records but have no `Agent` entity.
pub fn living_entity(world: &World, sim_id: u32) -> Option<Entity> {
    let mut query = world.try_query::<(Entity, &Agent, &SimId)>()?;
    query
        .iter(world)
        .find(|(_, _, id)| id.0 == sim_id)
        .map(|(entity, _, _)| entity)
}

/// Checks the whole edit in [ES-atomic]'s order. Writes nothing.
pub fn validate(world: &World, edit: &Edit) -> Result<(Entity, String), EditRefusal> {
    let content = world.resource::<Content>().0;
    let entity = living_entity(world, edit.sim).ok_or(EditRefusal::UnknownPerson)?;
    let name = validate_name(content, edit.name)?;
    if let Some(personality) = edit.personality {
        if personality as usize >= content.personalities.len() {
            return Err(EditRefusal::UnknownPersonality);
        }
    }
    validate_traits(content, edit.traits)?;
    for (at, (relative, _)) in edit.ties.iter().enumerate() {
        if *relative == edit.sim {
            return Err(EditRefusal::SelfTie);
        }
        if living_entity(world, *relative).is_none() {
            return Err(EditRefusal::UnknownRelative);
        }
        if edit.ties[..at]
            .iter()
            .any(|(earlier, _)| earlier == relative)
        {
            return Err(EditRefusal::RepeatedRelative);
        }
    }
    Ok((entity, name))
}

/// Applies an accepted edit: the trimmed name, the kept or replaced
/// personality, the new trait set with retained states, and the submitted
/// tie pairs. Everything else about the person is untouched.
fn apply(world: &mut World, entity: Entity, name: String, edit: &Edit) {
    let content = world.resource::<Content>().0;
    if let Some(mut current) = world.get_mut::<SimName>(entity) {
        current.0 = name;
    } else {
        world.entity_mut(entity).insert(SimName(name));
    }
    if let Some(index) = edit.personality {
        let compiled = &content.personalities[index as usize];
        world.entity_mut(entity).insert(personality_from(compiled));
        if let Some(mut domestic) = world.get_resource_mut::<SavedDomestic>() {
            if let Some(row) = domestic
                .cleanliness
                .iter_mut()
                .find(|(index, _)| *index == entity.index_u32())
            {
                row.1 = compiled.cleanliness;
            }
        }
    }
    let current = world.get::<Traits>(entity).cloned().unwrap_or_default();
    let entries = edit
        .traits
        .iter()
        .map(|&index| {
            let state = current
                .state(index)
                .unwrap_or_else(|| authored_trait_state(&content.traits[index as usize]));
            (index, state)
        })
        .collect();
    world
        .entity_mut(entity)
        .insert(Traits::from_entries(entries));
    if !edit.ties.is_empty() {
        if world.get_resource::<FamilyTies>().is_none() {
            world.insert_resource(FamilyTies::default());
        }
        let mut family = world.resource_mut::<FamilyTies>();
        for (relative, relation) in edit.ties {
            family.set(edit.sim, *relative, *relation);
        }
    }
}

/// Validates, applies when valid, and records the numbered answer.
pub(crate) fn commit(world: &mut World, edit: &Edit) {
    let result = match validate(world, edit) {
        Err(reason) => EditResult {
            sim: None,
            reason: Some(reason),
            handled: 0,
        },
        Ok((entity, name)) => {
            apply(world, entity, name, edit);
            EditResult {
                sim: Some(entity.index_u32()),
                reason: None,
                handled: 0,
            }
        }
    };
    let mut state = world.resource_mut::<LotEditState>();
    let handled = state
        .last_edit_result
        .map_or(0, |last| last.handled)
        .saturating_add(1);
    if result.reason.is_none() {
        state.revision = state.revision.saturating_add(1);
    }
    state.last_edit_result = Some(EditResult { handled, ..result });
}

/// Every person's personality effects, ascending by entity index. Shared by
/// the world hash and nothing else; names are deliberately absent.
pub(crate) fn personality_rows(world: &World) -> Vec<(u32, Personality)> {
    let mut rows = world
        .try_query::<(Entity, &Agent, &Personality)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .map(|(entity, _, personality)| (entity.index_u32(), personality.clone()))
                .collect()
        });
    rows.sort_unstable_by_key(|row| row.0);
    rows
}

/// [ES-personality]: the one archetype whose complete current effects equal
/// this person's. `None` when the person is custom, legacy (historical zero
/// chronotype), rebalanced away from content, ambiguous, or not a person.
pub fn archetype_of(world: &World, entity: Entity) -> Option<u32> {
    let personality = world.get::<Personality>(entity)?;
    world.get::<Agent>(entity)?;
    let content = world.resource::<Content>().0;
    let mut matches = content
        .personalities
        .iter()
        .enumerate()
        .filter(|(_, compiled)| &personality_from(compiled) == personality)
        .map(|(index, _)| index as u32);
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

#[cfg(test)]
#[path = "edit_tests.rs"]
mod tests;
