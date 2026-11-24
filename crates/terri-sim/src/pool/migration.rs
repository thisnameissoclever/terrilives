//! Translate only the coordinates whose meaning the frozen V22 envelope owns.
use super::*;
use crate::{SaveError, beds::navigation::Route};
use crate::seating::{EndpointUse, UseKind};
use std::collections::BTreeMap;
use terri_core::TileGrid;

struct Move {
    actor: Entity,
    endpoint: (i32, i32),
    active: bool,
    path: Option<Path>,
    claims: bool,
}

fn occupied_cell(position: Position, cell: (i32, i32)) -> bool {
    [position.x.floor() as i32, position.x.ceil() as i32].contains(&cell.0)
        && [position.y.floor() as i32, position.y.ceil() as i32].contains(&cell.1)
}

/// The caller must validate the complete historical source before invoking this migration.
pub(crate) fn migrate_v22(world: &mut World) -> Result<bool, SaveError> {
    let mut actors: Vec<_> = world.query::<(Entity, &Target)>().iter(world).filter_map(|(actor, target)| {
        let object=world.get::<SmartObject>(target.object)?;
        world.resource::<Content>().0.object(object.0).interactions.get(target.interaction as usize)
            .is_some_and(is_swimming).then_some(actor)
    }).collect();
    actors.sort_by_key(|actor| actor.index_u32());
    if actors.is_empty() { return Ok(false); }
    let mut moves=Vec::new();
    let mut claims=BTreeMap::new();
    for actor in actors {
        let target=*world.get::<Target>(actor).ok_or(SaveError::InvalidValue)?;
        let object=world.get::<SmartObject>(target.object).ok_or(SaveError::InvalidValue)?;
        let definition=world.resource::<Content>().0.object(object.0);
        let origin=*world.get::<Position>(target.object).ok_or(SaveError::InvalidValue)?;
        if origin.x.fract()!=0. || origin.y.fract()!=0. { return Err(SaveError::InvalidValue); }
        let origin=(origin.x as i32,origin.y as i32);
        let facing=world.get::<ObjectFacing>(target.object).map_or(definition.base_facing,|value|value.0);
        let endpoint=approach(definition,origin,facing);
        let grid=world.resource::<TileGrid>();
        if !grid.is_walkable(endpoint.0,endpoint.1)
            || !grid.can_interact_with_rect(endpoint,origin,definition.footprint_at(facing))
            || !crate::seating::endpoint_available(world,EndpointUse { owner:actor,endpoint,kind:UseKind::Standing })
        { return Err(SaveError::InvalidValue); }
        let episode=world.get::<PoolEpisode>(actor);
        let active=episode.is_some_and(|episode|episode.phase>0);
        let owns=episode.is_some();
        if owns && claims.insert(endpoint,actor).is_some() { return Err(SaveError::InvalidValue); }
        let path=if active { None } else {
            let position=*world.get::<Position>(actor).ok_or(SaveError::InvalidValue)?;
            let route=Route::Exact(endpoint);
            let steps=route.path(grid,(position.x.round() as i32,position.y.round() as i32))
                .and_then(|steps|route.bind_path(grid,(position.x,position.y),steps))
                .ok_or(SaveError::InvalidValue)?;
            Some(Path { steps,cursor:0 })
        };
        moves.push(Move { actor,endpoint,active,path,claims:owns });
    }
    // Test final anchors together; an old anchor may itself be moving away.
    let active_positions:BTreeMap<_,_>=moves.iter().filter(|change|change.active)
        .map(|change|(change.actor,Position { x:change.endpoint.0 as f32,y:change.endpoint.1 as f32 })).collect();
    let people:Vec<_>=world.query_filtered::<(Entity,&Position),With<Agent>>().iter(world)
        .filter(|(actor,_)|!crate::world_geometry::hidden_away(world,*actor))
        .map(|(actor,position)|(actor,active_positions.get(&actor).copied().unwrap_or(*position))).collect();
    for change in moves.iter().filter(|change|change.active) {
        if people.iter().any(|(actor,position)|*actor!=change.actor&&occupied_cell(*position,change.endpoint)) {
            return Err(SaveError::InvalidValue);
        }
    }
    for change in moves {
        if change.active {
            world.entity_mut(change.actor).insert(Position { x:change.endpoint.0 as f32,y:change.endpoint.1 as f32 });
        } else if let Some(path)=change.path {
            world.entity_mut(change.actor).insert(path);
        }
        if change.claims { world.get_mut::<PoolEpisode>(change.actor).unwrap().approach=change.endpoint; }
    }
    super::persistence::validate_legacy_clock_at_current_coordinates(world)?;
    Ok(true)
}
