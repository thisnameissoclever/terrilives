//! Shared ordinary-world validation selected before nested save reconstruction.
use crate::{
    world_geometry::{WaitingToReturn, WorldSurfaces},
    SaveError, Sim,
};
use bevy_ecs::prelude::*;
use terri_core::{Agent, AtWork, Commuting, Path, Position, SaveSnapshotV20, Target, TileGrid};

pub(crate) fn commutes(world: &World) -> Vec<(u32, u8)> {
    let mut rows = Vec::new();
    if let Some(mut query) = world.try_query::<EntityRef>() {
        for row in query.iter(world) {
            let direction = if row.contains::<WaitingToReturn>() {
                Some(2)
            } else {
                row.get::<Commuting>()
                    .map(|c| if *c == Commuting::Inbound { 1 } else { 0 })
            };
            if let Some(direction) = direction {
                rows.push((row.id().index_u32(), direction));
            }
        }
    }
    rows.sort_unstable();
    rows
}

pub(crate) fn prepare_geometry(
    previous: &SaveSnapshotV20,
    surfaces: &WorldSurfaces,
    commutes: Vec<(u32, u8)>,
    carried: &mut super::Carried,
) -> Result<(), SaveError> {
    let registry = &previous.legacy.legacy.legacy.legacy;
    let architecture = &registry
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy;
    let base = &architecture.world;
    if !architecture.layout.has_edges() {
        return Err(SaveError::InvalidGrid);
    }
    let facing_owners: std::collections::BTreeSet<_> = architecture
        .object_facings
        .iter()
        .map(|row| row.0)
        .collect();
    if base
        .entities
        .iter()
        .any(|entity| entity.smart_object.is_some() && !facing_owners.contains(&entity.index))
    {
        return Err(SaveError::InvalidValue);
    }
    let s = surfaces;
    if s.width != base.grid_width || s.height != base.grid_height {
        return Err(SaveError::InvalidGrid);
    }
    if s.width == 0
        || s.height == 0
        || u64::from(s.width) * u64::from(s.height) != s.tiles.len() as u64
        || s.tiles.len() > 1_048_576
        || s.tiles.iter().any(|v| *v > 2)
    {
        return Err(SaveError::InvalidGrid);
    }
    carried.surfaces = Some(surfaces.clone());
    carried.commutes = Some(commutes);
    Ok(())
}

pub(crate) fn validate_restored(sim: &Sim, surfaces: &WorldSurfaces) -> Result<(), SaveError> {
    let grid = sim.world().resource::<TileGrid>();
    if grid.width() != surfaces.width as usize || grid.height() != surfaces.height as usize {
        return Err(SaveError::InvalidGrid);
    }
    crate::world_geometry::validate_occupied_objects(sim.world())?;
    Ok(())
}

pub(crate) enum CommuteEndpoints {
    DepartureOnly,
    DepartureAndHome,
}

pub(crate) fn validate_commutes(world: &World, endpoints: CommuteEndpoints) -> Result<(), SaveError> {
    let Some(mut actors) = world.try_query::<EntityRef>() else {
        return Ok(());
    };
    let grid = world.resource::<TileGrid>();
    let mut exits = None;
    let mut home_targets = None;
    for actor in actors.iter(world) {
        let Some(direction) = actor.get::<Commuting>() else {
            continue;
        };
        if actor.contains::<AtWork>() || actor.contains::<Target>() {
            return Err(SaveError::InvalidValue);
        }
        let position = actor.get::<Position>().ok_or(SaveError::InvalidValue)?;
        let path = actor.get::<Path>();
        if *direction == Commuting::Outbound {
            let endpoint = crate::world_geometry::route_endpoint(*position, path)
                .ok_or(SaveError::InvalidGrid)?;
            if exits.get_or_insert_with(|| crate::world_geometry::boundary_tiles(world, grid))
                .binary_search(&endpoint).is_err()
            {
                return Err(SaveError::InvalidGrid);
            }
        } else if path.is_some() && matches!(endpoints, CommuteEndpoints::DepartureAndHome) {
            let (x, y) = crate::world_geometry::route_endpoint(*position, path)
                .ok_or(SaveError::InvalidGrid)?;
            let targets = home_targets
                .get_or_insert_with(|| crate::world_geometry::home_targets(world, grid))
                .as_ref()
                .ok_or(SaveError::InvalidGrid)?;
            if !grid.is_walkable(x, y) || !targets[y as usize * grid.width() + x as usize] {
                return Err(SaveError::InvalidGrid);
            }
        }
    }
    Ok(())
}

pub(crate) fn restore_commutes(world: &mut World, rows: Vec<(u32, u8)>) -> Result<(), SaveError> {
    if rows.len() > 100_000 || rows.windows(2).any(|pair| pair[0].0 >= pair[1].0) {
        return Err(SaveError::InvalidValue);
    }
    let mut seen = std::collections::BTreeSet::new();
    for (index, direction) in rows {
        if !seen.insert(index) || direction > 2 {
            return Err(SaveError::InvalidValue);
        }
        let entity =
            crate::dining::entity(world, index).ok_or(SaveError::InvalidEntityReference)?;
        if world.get::<Agent>(entity).is_none() {
            return Err(SaveError::InvalidEntityReference);
        }
        if direction == 2 {
            if world.get::<Commuting>(entity).is_some()
                || world.get::<AtWork>(entity).is_none_or(|work| work.remaining_ticks != 1)
                || world.get::<Path>(entity).is_some()
            {
                return Err(SaveError::InvalidValue);
            }
            world.entity_mut(entity).insert(WaitingToReturn);
        } else {
            if world.get::<Commuting>(entity).is_none() {
                return Err(SaveError::InvalidValue);
            }
            world.entity_mut(entity).insert(if direction == 1 {
                Commuting::Inbound
            } else {
                Commuting::Outbound
            });
        }
    }
    if world
        .query::<(Entity, &Commuting)>()
        .iter(world)
        .any(|(e, _)| !seen.contains(&e.index_u32()))
    {
        return Err(SaveError::InvalidValue);
    }
    Ok(())
}
