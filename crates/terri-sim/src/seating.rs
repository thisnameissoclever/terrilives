//! Physical-place ownership shared by meal and media interactions.
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::{
    save::{SavedDiner, SavedDining},
    SmartObject, Target,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UseKind {
    Meal,
    TableSeat,
    Media,
}

pub(crate) fn media_activity(
    pack: &terri_data::ContentPack,
    object: terri_core::ObjectDefId,
    interaction: u32,
) -> Option<u32> {
    let definition = pack.objects.get(object.0 as usize)?;
    let action = definition.interactions.get(interaction as usize)?;
    match (definition.id.as_str(), action.id.as_str()) {
        ("television", "watch_tv") => Some(crate::render_buffer::activity::WATCHING_TV),
        ("radio", "listen") => Some(crate::render_buffer::activity::LISTENING_RADIO),
        _ => None,
    }
}

pub(crate) fn ordinary_projection(
    world: &World,
    person: Entity,
) -> Option<crate::SocketActionProjection> {
    let target = world.get::<Target>(person)?;
    let object = world.get::<SmartObject>(target.object)?;
    let eating = world.get::<terri_core::Eating>(person)?;
    if eating.object != object.0
        || eating.interaction != target.interaction
        || world.get::<terri_core::Path>(person).is_some()
        || world.get::<terri_core::StepWork>(person).is_some()
    {
        return None;
    }
    let pack = world.resource::<Content>().0;
    let definition = pack.object(object.0);
    let interaction = definition.interactions.get(target.interaction as usize)?;
    if definition.id != "sofa" || interaction.id != "lounge" || interaction.visual.is_some() {
        return None;
    }
    let position = *world.get::<terri_core::Position>(target.object)?;
    let facing = world
        .get::<terri_core::ObjectFacing>(target.object)
        .map_or(definition.base_facing, |f| f.0);
    let (dx, dy) = facing.rotate_axis(0, 1);
    Some(crate::SocketActionProjection {
        x: position.x,
        y: position.y,
        facing: match (dx, dy) {
            (1, 0) => 1,
            (-1, 0) => 2,
            (0, 1) => 3,
            _ => 4,
        },
        target_entity: target.object.index_u32(),
        visual_action: crate::render_buffer::visual_action::SIT,
        activity: crate::render_buffer::activity::SITTING,
    })
}

pub(crate) fn claim(world: &World, person: u32) -> Option<&SavedDiner> {
    world
        .get_resource::<SavedDining>()?
        .diners
        .iter()
        .find(|d| d.person == person)
}

pub(crate) fn kind(world: &World, lease: &SavedDiner) -> Option<UseKind> {
    let person = crate::dining::entity(world, lease.person)?;
    world.get::<terri_core::Agent>(person)?;
    if let Some(target) = world.get::<Target>(person) {
        if target.object.index_u32() != lease.station {
            return None;
        }
        if crate::dining::ordinary_sitting(world, person) == Some(target.object) {
            return Some(UseKind::TableSeat);
        }
        if target.interaction != crate::systems::chain::CHAIN_STEP {
            let object = world.get::<SmartObject>(target.object)?;
            return media_activity(world.resource::<Content>().0, object.0, target.interaction)
                .map(|_| UseKind::Media);
        }
    }
    crate::dining::terminal(world, person).then_some(UseKind::Meal)
}

pub(crate) fn object_in_use(world: &World, object: u32) -> bool {
    world.get_resource::<SavedDining>().is_some_and(|s| {
        s.diners
            .iter()
            .any(|d| d.station == object || d.chair == Some(object))
    })
}

pub(crate) fn release(world: &mut World, person: u32) -> Option<SavedDiner> {
    let mut state = world.get_resource_mut::<SavedDining>()?;
    let index = state.diners.iter().position(|d| d.person == person)?;
    Some(state.diners.remove(index))
}

/// A stale release cannot remove the physical place of a replacement target.
pub(crate) fn release_exact(world: &mut World, owner: Entity, expected: Target) {
    if claim(world, owner.index_u32()).is_some_and(|d| d.station == expected.object.index_u32())
        && world
            .get::<Target>(owner)
            .is_none_or(|current| *current == expected)
    {
        release(world, owner.index_u32());
    }
}

pub(crate) fn replace(world: &mut World, owner: Entity, lease: Option<SavedDiner>) {
    release(world, owner.index_u32());
    if let Some(lease) = lease {
        let mut state = world.get_resource_or_insert_with(terri_core::save::SavedDining::default);
        assert!(
            !state
                .diners
                .iter()
                .any(|d| d.chair == lease.chair || d.endpoint == lease.endpoint),
            "Physical seat claims must be exclusive before commit"
        );
        state.diners.push(lease);
        state.diners.sort_by_key(|d| d.person);
    }
}

pub(crate) fn occupancy(world: &mut World) -> crate::beds::Occupancy {
    let targets: Vec<_> = world
        .query::<(
            Entity,
            &Target,
            Option<&terri_core::SleepPlace>,
            Has<terri_core::Agent>,
        )>()
        .iter(world)
        .map(|(owner, target, place, agent)| (owner, *target, place.copied().filter(|_| agent)))
        .collect();
    let markers: Vec<_> = world
        .query_filtered::<Entity, With<terri_core::Reserved>>()
        .iter(world)
        .collect();
    let mut result = crate::beds::Occupancy::new(targets.into_iter(), markers.into_iter());
    if let Some(state) = world.get_resource::<SavedDining>() {
        for lease in &state.diners {
            let Some(owner) = crate::dining::entity(world, lease.person) else {
                continue;
            };
            let Some(chair) = lease.chair.and_then(|id| crate::dining::entity(world, id)) else {
                continue;
            };
            if world
                .get::<Target>(owner)
                .is_some_and(|t| t.object.index_u32() == lease.station)
            {
                result.physical_claim(owner, chair);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests;
