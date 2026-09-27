//! Colourways - [RC-command] in `docs/specs/2026-09-22-colourways.md`.
//!
//! A colourway changes how an object is drawn and nothing else: no tile,
//! reservation or route. So it is not refused while the object is in use,
//! and it costs nothing.
use super::{object_definition, LotEditState, PlacementRefusal};
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::Colourway;

/// What the drain did with the most recent colourway change: the entity
/// index and colourway it named, and why not when it did not apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColourwayResult {
    pub object: u32,
    pub colourway: u32,
    pub reason: Option<PlacementRefusal>,
}

/// The object's entity when `colourway` can be applied to it. No mutation.
/// An unknown object is refused before an unknown colourway.
pub fn validate_colourway(
    world: &World,
    object: u32,
    colourway: u32,
) -> Result<Entity, PlacementRefusal> {
    let (entity, _, _) = object_definition(world, object).ok_or(PlacementRefusal::UnknownObject)?;
    if colourway as usize >= world.resource::<Content>().0.colourways.len() {
        return Err(PlacementRefusal::UnknownColourway);
    }
    Ok(entity)
}

/// Applies one colourway change, wholly or not at all. The first colourway,
/// the art as drawn, is stored as no component, so the world hash and the
/// save of an object in it match an object never recoloured.
pub(crate) fn commit(world: &mut World, object: u32, colourway: u32) {
    let result = validate_colourway(world, object, colourway);
    let reason = result.as_ref().err().copied();
    if let Ok(entity) = result {
        let mut target = world.entity_mut(entity);
        if colourway == 0 {
            target.remove::<Colourway>();
        } else {
            target.insert(Colourway(colourway));
        }
        let mut state = world.resource_mut::<LotEditState>();
        state.revision = state.revision.saturating_add(1);
    }
    world.resource_mut::<LotEditState>().last_colourway_result = Some(ColourwayResult {
        object,
        colourway,
        reason,
    });
}

#[cfg(test)]
#[path = "colourway_tests.rs"]
mod tests;
