use super::{RoomError, RoomMap, RoomTopology};
use bevy_ecs::prelude::*;
use terri_core::{
    rooms::{RoomId, RoomRecord, RoomSelection, SavedRooms},
    TileGrid,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Resource)]
pub enum RoomReferenceMode {
    #[default]
    Legacy,
    Stable,
}

pub fn stable(world: &World) -> bool {
    world.get_resource::<RoomReferenceMode>() == Some(&RoomReferenceMode::Stable)
}

pub fn install(world: &mut World, saved: SavedRooms) -> Result<(), RoomError> {
    let map = RoomMap::from_saved(RoomTopology::from_world(world)?, &saved)?;
    world.insert_resource(saved);
    world.insert_resource(map);
    world.insert_resource(RoomReferenceMode::Stable);
    Ok(())
}

/// Seed names only once, before any current room references exist.
pub fn initialize(world: &mut World) -> Result<(), RoomError> {
    let topology = RoomTopology::from_world(world)?;
    let legacy = crate::room_regions::RoomRegions::legacy(world);
    let names = crate::chores::legacy_room_labels(world, &legacy);
    let mut overlaps = std::collections::BTreeMap::<(u32, usize), usize>::new();
    for (index, component) in topology.components.iter().enumerate() {
        for &cell in &component.cells {
            if let Some(old) = legacy.at((
                (cell % topology.width) as i32,
                (cell / topology.width) as i32,
            )) {
                *overlaps.entry((old, index)).or_default() += 1;
            }
        }
    }
    let mut pairs: Vec<_> = overlaps.into_iter().collect();
    pairs.sort_by(|(ak, ac), (bk, bc)| bc.cmp(ac).then_with(|| ak.cmp(bk)));
    let mut used = std::collections::BTreeSet::new();
    let mut inherited = std::collections::BTreeMap::new();
    for ((old, index), _) in pairs {
        if !used.contains(&old) && !inherited.contains_key(&index) {
            used.insert(old);
            inherited.insert(index, names[&old].clone());
        }
    }
    let mut reserved: std::collections::BTreeSet<_> = names.values().cloned().collect();
    let mut saved = SavedRooms::default();
    for (index, component) in topology.components.iter().enumerate() {
        let id = RoomId::new(saved.next_id).ok_or(RoomError::IdExhausted)?;
        saved.next_id = saved.next_id.checked_add(1).ok_or(RoomError::IdExhausted)?;
        let name = if let Some(name) = inherited.remove(&index) {
            name
        } else {
            loop {
                let name = format!("Room {}", saved.next_default_name);
                saved.next_default_name = saved
                    .next_default_name
                    .checked_add(1)
                    .ok_or(RoomError::DefaultNameExhausted)?;
                if reserved.insert(name.clone()) {
                    break name;
                }
            }
        };
        saved.records.push(RoomRecord {
            id,
            name,
            anchor: Some(component.anchor),
        });
    }
    install(world, saved)
}

pub(crate) fn reference_valid(world: &World, key: u32) -> bool {
    if !stable(world) {
        let grid = world.resource::<TileGrid>();
        return (key as usize) < grid.width() * grid.height();
    }
    key == 0
        || RoomId::new(key).is_some_and(|id| world.resource::<SavedRooms>().record(id).is_some())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CleaningArea {
    Room(RoomId),
    Outside,
}
impl CleaningArea {
    pub fn key(self) -> u32 {
        match self {
            Self::Room(id) => id.get(),
            Self::Outside => 0,
        }
    }
}

/// Material eligibility is independent of enclosure and furniture occupancy.
pub fn cleaning_area_at(world: &World, tile: (i32, i32)) -> Option<CleaningArea> {
    let x = u32::try_from(tile.0).ok()?;
    let y = u32::try_from(tile.1).ok()?;
    let map = world.get_resource::<RoomMap>()?;
    let selection = map.selection_at((x, y))?;
    if crate::lot_frame::street_exit(world).is_some() && x + 1 == map.topology.width {
        return None;
    }
    let covering = world
        .get_resource::<terri_core::layout::SavedFloors>()
        .map_or(0, |floors| floors.covering(x, y));
    let cleanable = match covering {
        0 => crate::lot_frame::house_or_grid(world).contains(x, y),
        1..=4 => true,
        _ => false,
    };
    cleanable.then_some(match selection {
        RoomSelection::Outside => CleaningArea::Outside,
        RoomSelection::Room(id) => CleaningArea::Room(id),
    })
}

pub(crate) fn hash(world: &World, hash: &mut terri_core::FnvHasher) {
    let Some(saved) = world.get_resource::<SavedRooms>() else {
        return;
    };
    hash.write_u64(saved.next_id.into());
    hash.write_u64(saved.next_default_name.into());
    hash.write_u64(saved.outside_name.len() as u64);
    for byte in saved.outside_name.bytes() {
        hash.write_u64(byte.into());
    }
    hash.write_u64(saved.records.len() as u64);
    for record in &saved.records {
        hash.write_u64(record.id.get().into());
        hash.write_u64(record.name.len() as u64);
        for byte in record.name.bytes() {
            hash.write_u64(byte.into());
        }
        hash.write_u64(u64::from(record.anchor.is_some()));
        if let Some((x, y)) = record.anchor {
            hash.write_u64(x.into());
            hash.write_u64(y.into());
        }
    }
}

/// Construction changes membership without constituting a new physical visit.
pub(crate) fn refresh_visits(world: &mut World) {
    let map = world.resource::<RoomMap>();
    let positions: std::collections::BTreeMap<_, _> = world
        .try_query::<(Entity, &terri_core::Position)>()
        .map_or_else(Default::default, |mut query| {
            query
                .iter(world)
                .filter_map(|(entity, p)| {
                    map.selection_at((p.x.round() as u32, p.y.round() as u32))
                        .map(|room| (entity.index_u32(), room.key()))
                })
                .collect()
        });
    if let Some(mut state) = world.get_resource_mut::<terri_core::save::SavedDomestic>() {
        for visit in &mut state.visits {
            if let Some(room) = positions.get(&visit.person) {
                visit.room = *room;
            }
        }
    }
    if let Some(mut state) = world.get_resource_mut::<terri_core::save::SavedDining>() {
        for opportunity in &mut state.opportunities {
            if let Some(room) = positions.get(&opportunity.person) {
                opportunity.room = *room;
            }
        }
    }
}

pub(crate) fn retain_referenced_history(world: &mut World) {
    use terri_core::{
        chores::*,
        save::{SavedDining, SavedDomestic},
        CommandQueue, SimCommand,
    };
    let mut keys = std::collections::BTreeSet::new();
    let mut chore = |key: ChoreKey| {
        if key.kind == ChoreKind::Floors || key.kind.grouped() {
            keys.insert(key.target);
        }
    };
    if let Some(state) = world.get_resource::<SavedChores>() {
        for key in state
            .assignments
            .iter()
            .map(|a| a.key)
            .chain(state.episodes.iter().map(|e| e.key))
            .chain(state.tasks.iter().map(|t| t.key))
            .chain(state.orders.iter().map(|o| o.key))
        {
            chore(key);
        }
    }
    for command in world.resource::<CommandQueue>().as_slice() {
        if let SimCommand::CleanChore { key, .. } | SimCommand::CleanChoreFirst { key, .. } =
            command
        {
            chore(*key);
        }
    }
    if let Some(state) = world.get_resource::<SavedDomestic>() {
        keys.extend(state.visits.iter().map(|row| row.room));
    }
    if let Some(state) = world.get_resource::<SavedDining>() {
        keys.extend(state.opportunities.iter().map(|row| row.room));
    }
    let ids = keys.into_iter().filter_map(RoomId::new).collect();
    world.resource_mut::<SavedRooms>().retain_history(&ids);
}
