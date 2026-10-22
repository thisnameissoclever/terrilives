//! Schema 21 selects ordinary geometry before any nested physical validation.
use crate::{
    world_geometry::{WaitingToReturn, WorldSurfaces},
    SaveError, Sim,
};
use bevy_ecs::prelude::*;
use terri_core::{Agent, Commuting, SaveSnapshotV21, TileGrid};

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
pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV21 {
    SaveSnapshotV21 {
        previous: super::v20::capture(sim),
        surfaces: sim.world().resource::<WorldSurfaces>().clone(),
        commutes: commutes(sim.world()),
    }
}
pub(crate) fn capture_without_commands(sim: &Sim) -> SaveSnapshotV21 {
    SaveSnapshotV21 {
        previous: super::v20::capture_without_commands(sim),
        surfaces: sim.world().resource::<WorldSurfaces>().clone(),
        commutes: commutes(sim.world()),
    }
}
pub(crate) fn restore(
    snapshot: SaveSnapshotV21,
    content: &'static terri_data::ContentPack,
    mut carried: super::Carried,
) -> Result<Sim, SaveError> {
    let registry = &snapshot.previous.legacy.legacy.legacy.legacy;
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
    let s = &snapshot.surfaces;
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
    carried.surfaces = Some(s.clone());
    carried.commutes = Some(snapshot.commutes);
    let sim = super::v20::restore(snapshot.previous, content, carried)?;
    let grid = sim.world().resource::<TileGrid>();
    if grid.width() != s.width as usize || grid.height() != s.height as usize {
        return Err(SaveError::InvalidGrid);
    }
    Ok(sim)
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
                || world.get::<terri_core::AtWork>(entity).is_none()
                || world.get::<terri_core::Path>(entity).is_some()
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
