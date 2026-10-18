//! Read-only privacy navigation, independent of incident collection and effects.
use super::{tile, PRIVATE_USE_TAG};
use crate::{room_regions::RoomRegions, Content};
use bevy_ecs::prelude::*;
use terri_core::{Agent, AtWork, Eating, Needs, Position, SimId, SmartObject, Target, TileGrid};

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct NavigationConstraints {
    current: Option<u32>,
    private_rooms: Vec<u32>,
    geometry: [u32; 3],
    house: crate::lot_frame::HouseRect,
    geometry_fresh: bool,
}

impl NavigationConstraints {
    pub(super) fn new(
        current: Option<u32>,
        private_rooms: impl IntoIterator<Item = u32>,
        geometry: [u32; 3],
        house: crate::lot_frame::HouseRect,
        geometry_fresh: bool,
    ) -> Self {
        let mut private_rooms: Vec<_> = private_rooms
            .into_iter()
            .filter(|room| Some(*room) != current)
            .collect();
        private_rooms.sort_unstable();
        private_rooms.dedup();
        Self {
            current,
            private_rooms,
            geometry,
            house,
            geometry_fresh,
        }
    }

    pub(crate) fn cacheable(&self) -> bool {
        !self.geometry_fresh
    }

    pub(super) fn safe_grid(&self, rooms: &RoomRegions, grid: &TileGrid) -> TileGrid {
        let mut safe = grid.clone();
        for y in 0..grid.height() {
            for x in 0..grid.width() {
                if rooms
                    .at((x as i32, y as i32))
                    .is_some_and(|room| self.private_rooms.contains(&room))
                {
                    safe.set_blocked(x, y, true);
                }
            }
        }
        safe
    }
}

pub(super) fn navigation_geometry(world: &World) -> [u32; 3] {
    [
        world
            .get_resource_ref::<TileGrid>()
            .unwrap()
            .last_changed()
            .get(),
        world
            .get_resource_ref::<terri_core::layout::SavedLayout>()
            .unwrap()
            .last_changed()
            .get(),
        world
            .get_resource_ref::<Content>()
            .unwrap()
            .last_changed()
            .get(),
    ]
}

pub(super) fn active_private_room(
    world: &World,
    entity: Entity,
    rooms: &RoomRegions,
) -> Option<u32> {
    let eating = world.get::<Eating>(entity)?;
    let target = world.get::<Target>(entity)?;
    let object = world.get::<SmartObject>(target.object)?;
    if object.0 != eating.object {
        return None;
    }
    let action = world
        .resource::<Content>()
        .0
        .object(object.0)
        .interactions
        .get(eating.interaction as usize)?;
    action
        .tags
        .iter()
        .any(|tag| tag == PRIVATE_USE_TAG)
        .then_some(())?;
    rooms.at(tile(*world.get::<Position>(target.object)?))
}

/// One captured set of facts supplies both the cache key and the route mask.
pub(crate) struct PrivacyNavigation {
    rooms: RoomRegions,
    constraints: NavigationConstraints,
}

impl PrivacyNavigation {
    pub(crate) fn capture(world: &World, agent: Entity) -> Self {
        let rooms = RoomRegions::from_world(world);
        let mut current = None;
        let mut private_rooms = Vec::new();
        // Query only required, present components. An unregistered optional
        // AtWork type must not make a read-only query omit the whole household.
        if let Some(mut query) = world.try_query::<(Entity, &Agent, &SimId, &Position, &Needs)>() {
            for (entity, _, _, position, _) in query.iter(world) {
                if world.get::<AtWork>(entity).is_some() {
                    continue;
                }
                if entity == agent {
                    current = rooms.at(tile(*position));
                } else if let Some(room) = active_private_room(world, entity, &rooms) {
                    private_rooms.push(room);
                }
            }
        }
        let geometry = navigation_geometry(world);
        let constraints = NavigationConstraints::new(
            current,
            private_rooms,
            geometry,
            crate::lot_frame::house_or_grid(world),
            geometry.contains(&world.read_change_tick().get()),
        );
        Self { rooms, constraints }
    }

    pub(crate) fn rooms(&self) -> &RoomRegions {
        &self.rooms
    }
    pub(crate) fn constraints(&self) -> &NavigationConstraints {
        &self.constraints
    }
    pub(crate) fn safe_grid(&self, grid: &TileGrid) -> TileGrid {
        self.constraints.safe_grid(&self.rooms, grid)
    }
}
