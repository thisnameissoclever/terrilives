//! Historical seeds are interpreted only against their original source maps.
use super::*;
use std::collections::BTreeMap;
use terri_core::{
    chores::*,
    rooms::*,
    save::{SavedDining, SavedDomestic},
    CommandQueue, Position, SimCommand,
};

fn room_key(key: &ChoreKey) -> bool {
    key.kind == ChoreKind::Floors || key.kind.grouped()
}

fn retired(saved: &mut SavedRooms, label: String) -> Result<u32, RoomError> {
    let id = RoomId::new(saved.next_id).ok_or(RoomError::IdExhausted)?;
    saved.next_id = saved.next_id.checked_add(1).ok_or(RoomError::IdExhausted)?;
    saved.records.push(RoomRecord {
        id,
        name: label,
        anchor: None,
    });
    Ok(id.get())
}

pub(crate) fn migrate(sim: &mut crate::Sim) -> Result<(), crate::SaveError> {
    if stable(sim.world())
        || terri_data::is_pre_books_pack(sim.world().resource::<crate::Content>().0)
    {
        return Ok(());
    }
    migrate_inner(sim).map_err(|_| crate::SaveError::InvalidValue)
}

fn migrate_inner(sim: &mut crate::Sim) -> Result<(), RoomError> {
    let old = crate::room_regions::RoomRegions::legacy(sim.world());
    let (width, domestic) = crate::domestic::legacy_rooms(sim.world());
    if let Some(frame) = crate::lot_frame::frame(sim.world()) {
        sim.world_mut().insert_resource(frame);
    }
    initialize(sim.world_mut())?;
    let map = sim.world().resource::<RoomMap>().clone();
    let mut saved = sim.world().resource::<SavedRooms>().clone();
    let mut references = std::collections::BTreeSet::new();
    if let Some(state) = sim.world().get_resource::<SavedChores>() {
        references.extend(
            state
                .assignments
                .iter()
                .map(|a| a.key)
                .chain(state.episodes.iter().map(|e| e.key))
                .chain(state.tasks.iter().map(|t| t.key))
                .chain(state.orders.iter().map(|o| o.key))
                .filter(room_key)
                .map(|k| k.target),
        );
    }
    for command in sim.world().resource::<CommandQueue>().as_slice() {
        if let SimCommand::CleanChore { key, .. } | SimCommand::CleanChoreFirst { key, .. } =
            command
        {
            if room_key(key) {
                references.insert(key.target);
            }
        }
    }
    let mut translated = BTreeMap::new();
    for seed in references {
        let mut overlap = BTreeMap::<u32, usize>::new();
        for index in 0..map.topology.cells.len() {
            let tile = ((index % width) as i32, (index / width) as i32);
            if old.at(tile) == Some(seed) {
                if let Some(room) = map.selection_at((tile.0 as u32, tile.1 as u32)) {
                    *overlap.entry(room.key()).or_default() += 1;
                }
            }
        }
        let key = overlap
            .into_iter()
            .max_by(|(a, ac), (b, bc)| ac.cmp(bc).then_with(|| b.cmp(a)))
            .map(|(key, _)| key);
        translated.insert(
            seed,
            match key {
                Some(key) => key,
                None => retired(&mut saved, "Removed room".into())?,
            },
        );
    }
    let convert = |key: &mut ChoreKey| {
        if room_key(key) {
            key.target = translated[&key.target];
        }
    };
    if let Some(mut state) = sim.world_mut().get_resource_mut::<SavedChores>() {
        for assignment in &mut state.assignments {
            convert(&mut assignment.key);
        }
        for episode in &mut state.episodes {
            convert(&mut episode.key);
        }
        for task in &mut state.tasks {
            convert(&mut task.key);
        }
        for order in &mut state.orders {
            convert(&mut order.key);
        }
        state.assignments.sort_by_key(|a| a.key);
        state.assignments.dedup_by_key(|a| a.key);
    }
    let mut commands = sim.world().resource::<CommandQueue>().as_slice().to_vec();
    for command in &mut commands {
        if let SimCommand::CleanChore { key, .. } | SimCommand::CleanChoreFirst { key, .. } =
            command
        {
            convert(key);
        }
    }
    sim.world_mut()
        .insert_resource(CommandQueue::from_commands(commands));
    let positions: BTreeMap<_, _> = sim
        .world_mut()
        .query::<(bevy_ecs::entity::Entity, &Position)>()
        .iter(sim.world())
        .map(|(entity, p)| (entity.index_u32(), (p.x.round() as u32, p.y.round() as u32)))
        .collect();
    let mut history = BTreeMap::new();
    let mut visit = |person: u32, seed: &mut u32| -> Result<(), RoomError> {
        let current = positions.get(&person).and_then(|&(x, y)| {
            (x < map.topology.width
                && y < map.topology.height
                && domestic.get(y as usize * width + x as usize) == Some(seed))
            .then(|| map.selection_at((x, y)))
            .flatten()
        });
        *seed = if let Some(room) = current {
            room.key()
        } else if let Some(id) = history.get(seed) {
            *id
        } else {
            let id = retired(&mut saved, "Removed room".into())?;
            history.insert(*seed, id);
            id
        };
        Ok(())
    };
    if let Some(mut state) = sim.world_mut().get_resource_mut::<SavedDomestic>() {
        for row in &mut state.visits {
            visit(row.person, &mut row.room)?;
        }
    }
    if let Some(mut state) = sim.world_mut().get_resource_mut::<SavedDining>() {
        for row in &mut state.opportunities {
            visit(row.person, &mut row.room)?;
        }
    }
    sim.world_mut().insert_resource(saved);
    // Source work was validated before this conversion. Reconcile only its
    // physical eligibility after changing the reference namespace.
    crate::chores::reconcile_migrated_work(sim.world_mut());
    super::retain_referenced_history(sim.world_mut());
    Ok(())
}

/// Historical writers refuse current state whose meaning cannot be represented.
pub(crate) fn project(
    world: &bevy_ecs::world::World,
    snapshot: &mut terri_core::SaveSnapshotV5,
) -> Result<(), crate::SaveError> {
    if !stable(world) {
        return Ok(());
    }
    let map = world.resource::<RoomMap>();
    let old = crate::room_regions::RoomRegions::legacy(world);
    let (width, domestic) = crate::domestic::legacy_rooms(world);
    let targets = representable_chore_targets(world, &old);
    let key = |key: &mut ChoreKey| -> Result<(), crate::SaveError> {
        if room_key(key) {
            key.target = *targets
                .get(&key.target)
                .ok_or(crate::SaveError::InvalidValue)?;
        }
        Ok(())
    };
    if let Some(state) = &mut snapshot.chores {
        for row in &mut state.assignments {
            key(&mut row.key)?;
        }
        for row in &mut state.episodes {
            key(&mut row.key)?;
        }
        for row in &mut state.tasks {
            key(&mut row.key)?;
        }
        for row in &mut state.orders {
            key(&mut row.key)?;
        }
        for &(cell, _) in &state.floors {
            if old
                .at((
                    (cell as usize % width) as i32,
                    (cell as usize / width) as i32,
                ))
                .is_none()
            {
                return Err(crate::SaveError::InvalidValue);
            }
        }
    }
    let visit = |person: u32, room: u32| -> Result<u32, crate::SaveError> {
        let position = crate::dining::entity(world, person)
            .and_then(|entity| world.get::<Position>(entity))
            .ok_or(crate::SaveError::InvalidValue)?;
        let tile = (position.x.round() as u32, position.y.round() as u32);
        if map
            .selection_at(tile)
            .is_none_or(|current| current.key() != room)
        {
            return Err(crate::SaveError::InvalidValue);
        }
        domestic
            .get(tile.1 as usize * width + tile.0 as usize)
            .copied()
            .ok_or(crate::SaveError::InvalidValue)
    };
    if let Some(state) = &mut snapshot.domestic {
        for row in &mut state.visits {
            row.room = visit(row.person, row.room)?;
        }
    }
    if let Some(state) = &mut snapshot.dining {
        for row in &mut state.opportunities {
            row.room = visit(row.person, row.room)?;
        }
    }
    for command in &mut snapshot.world.queued_commands {
        if let terri_core::SavedCommand::CleanChore { key: row, .. }
        | terri_core::SavedCommand::CleanChoreFirst { key: row, .. } = command
        {
            key(row)?;
        }
    }
    Ok(())
}

fn representable_chore_targets(
    world: &bevy_ecs::world::World,
    old: &crate::room_regions::RoomRegions,
) -> BTreeMap<u32, u32> {
    let map = world.resource::<RoomMap>();
    let tile = |cell: u32| {
        (
            (cell % map.topology.width) as i32,
            (cell / map.topology.width) as i32,
        )
    };
    let mut counts = BTreeMap::<u32, usize>::new();
    for cell in 0..map.topology.cells.len() {
        if let Some(seed) = old.at(tile(cell as u32)) {
            *counts.entry(seed).or_default() += 1;
        }
    }
    map.topology
        .components
        .iter()
        .zip(&map.component_ids)
        .filter_map(|(component, id)| {
            let seed = old.at((component.anchor.0 as i32, component.anchor.1 as i32))?;
            // Equal cardinality plus complete membership proves both directions:
            // no extension cell is dropped and no other legacy area is added.
            (counts.get(&seed) == Some(&component.cells.len())
                && component
                    .cells
                    .iter()
                    .all(|&cell| old.at(tile(cell)) == Some(seed)))
            .then_some((id.get(), seed))
        })
        .collect()
}

pub(crate) fn project_commands(
    world: &bevy_ecs::world::World,
    commands: &mut [terri_core::SavedCommand],
) -> Result<(), crate::SaveError> {
    if !stable(world) {
        return Ok(());
    }
    let old = crate::room_regions::RoomRegions::legacy(world);
    let targets = representable_chore_targets(world, &old);
    for command in commands {
        if let terri_core::SavedCommand::CleanChore { key, .. }
        | terri_core::SavedCommand::CleanChoreFirst { key, .. } = command
        {
            if room_key(key) {
                key.target = *targets
                    .get(&key.target)
                    .ok_or(crate::SaveError::InvalidValue)?;
            }
        }
    }
    Ok(())
}
