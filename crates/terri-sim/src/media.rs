//! Deterministic viewing routes and physical seat projections for media use.
use crate::beds::{
    navigation::{Reachable, Route},
    Occupancy,
};
use crate::systems::interpersonal::BoundaryFurniture;
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::{
    save::SavedDiner, Eating, Position, SmartObject, Target, TileDistanceField, TileGrid,
};
use terri_data::CompiledSocketFacing;

#[derive(Clone)]
pub(crate) struct Plan {
    pub access: Reachable,
    pub lease: Option<SavedDiner>,
}

impl Plan {
    pub(crate) fn physical_place(&self, person: Entity, device: Entity) -> SavedDiner {
        self.lease.clone().unwrap_or_else(|| {
            let Route::Exact(endpoint) = self.access.route else {
                unreachable!("Media plans have exact endpoints")
            };
            SavedDiner {
                person: person.index_u32(),
                station: device.index_u32(),
                chair: None,
                setting: None,
                endpoint,
                obstructing: vec![],
            }
        })
    }
}

fn direction(facing: CompiledSocketFacing) -> (i32, i32) {
    match facing {
        CompiledSocketFacing::PositiveX => (1, 0),
        CompiledSocketFacing::NegativeX => (-1, 0),
        CompiledSocketFacing::PositiveY => (0, 1),
        CompiledSocketFacing::NegativeY => (0, -1),
    }
}

fn cone(origin: (f32, f32), front: (i32, i32), point: (f32, f32)) -> bool {
    let (x, y) = (point.0 - origin.0, point.1 - origin.1);
    let forward = x * front.0 as f32 + y * front.1 as f32;
    let lateral = x * front.1 as f32 - y * front.0 as f32;
    forward > 0. && lateral.abs() <= forward && x * x + y * y <= 49.
}

fn seat_socket(
    pack: &terri_data::ContentPack,
    seat: &BoundaryFurniture,
    toward: (f32, f32),
) -> Option<terri_data::CompiledPlacementSocket> {
    let definition = pack.object(seat.definition);
    if matches!(definition.id.as_str(), "armchair" | "reading_chair") {
        let socket = definition.interactions.iter().find_map(|action| {
            action
                .visual
                .as_ref()
                .filter(|v| {
                    matches!(
                        v.action,
                        terri_data::CompiledVisualAction::Sit
                            | terri_data::CompiledVisualAction::Read
                    )
                })
                .and_then(|v| v.socket)
        })?;
        return definition
            .sockets_at(seat.position.x, seat.position.y, seat.facing)
            .get(socket as usize)
            .cloned();
    }
    if !matches!(
        definition.id.as_str(),
        "chair" | "desk_chair" | "long_sofa" | "sofa"
    ) {
        return None;
    }
    let footprint = definition.footprint_at(seat.facing);
    let x = seat.position.x + (footprint.width as f32 - 1.) * 0.5;
    let y = seat.position.y + (footprint.depth as f32 - 1.) * 0.5;
    let front = if definition.id == "sofa" {
        axis_facing(wire_facing(toward.0 - x, toward.1 - y))
    } else {
        seat.facing.rotate_axis(0, 1)
    };
    Some(terri_data::CompiledPlacementSocket {
        x,
        y,
        facing: match front {
            (1, 0) => CompiledSocketFacing::PositiveX,
            (-1, 0) => CompiledSocketFacing::NegativeX,
            (0, 1) => CompiledSocketFacing::PositiveY,
            _ => CompiledSocketFacing::NegativeY,
        },
    })
}

fn axis_facing(facing: u32) -> (i32, i32) {
    match facing {
        1 => (1, 0),
        2 => (-1, 0),
        3 => (0, 1),
        _ => (0, -1),
    }
}

fn footprint_tiles(pack: &terri_data::ContentPack, item: &BoundaryFurniture) -> Vec<(i32, i32)> {
    let footprint = pack.object(item.definition).footprint_at(item.facing);
    let origin = (
        item.position.x.round() as i32,
        item.position.y.round() as i32,
    );
    (0..footprint.depth as i32)
        .flat_map(|y| (0..footprint.width as i32).map(move |x| (origin.0 + x, origin.1 + y)))
        .collect()
}

/// Approach tiles paired with the seat tile they touch. A viewing seat is
/// entered from the tile it faces; a work seat faces its station, so it is
/// entered from any free side that is not part of the station.
fn approaches(
    pack: &terri_data::ContentPack,
    seat: &BoundaryFurniture,
    socket: &terri_data::CompiledPlacementSocket,
    device: &BoundaryFurniture,
) -> Vec<((i32, i32), (i32, i32))> {
    let tiles = footprint_tiles(pack, seat);
    if crate::seating::work_station(pack, device.definition) {
        let blocked = footprint_tiles(pack, device);
        let mut result = vec![];
        for &contact in &tiles {
            for step in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let endpoint = (contact.0 + step.0, contact.1 + step.1);
                if !tiles.contains(&endpoint) && !blocked.contains(&endpoint) {
                    result.push((endpoint, contact));
                }
            }
        }
        return result;
    }
    let footprint = pack.object(seat.definition).footprint_at(seat.facing);
    let origin = (
        seat.position.x.round() as i32,
        seat.position.y.round() as i32,
    );
    let front = direction(socket.facing);
    let mut result = vec![];
    for y in 0..footprint.depth as i32 {
        for x in 0..footprint.width as i32 {
            if (front.0 == 1 && x != footprint.width as i32 - 1)
                || (front.0 == -1 && x != 0)
                || (front.1 == 1 && y != footprint.depth as i32 - 1)
                || (front.1 == -1 && y != 0)
            {
                continue;
            }
            let contact = (origin.0 + x, origin.1 + y);
            result.push(((contact.0 + front.0, contact.1 + front.1), contact));
        }
    }
    result
}

pub(crate) struct Planning<'a> {
    pub pack: &'a terri_data::ContentPack,
    pub grid: &'a TileGrid,
    pub field: &'a TileDistanceField,
    pub objects: &'a [BoundaryFurniture],
    pub occupancy: &'a Occupancy,
    pub claims: &'a [SavedDiner],
}

pub(crate) fn plan(
    planning: Planning<'_>,
    person: Entity,
    device: &BoundaryFurniture,
) -> Option<Plan> {
    let Planning {
        pack,
        grid,
        field,
        objects,
        occupancy,
        claims,
    } = planning;
    let origin = (device.position.x, device.position.y);
    let front = device.facing.rotate_axis(1, 0);
    let mut candidates = vec![];
    for seat in objects {
        let Some(socket) = seat_socket(pack, seat, origin) else {
            continue;
        };
        let point = (socket.x, socket.y);
        let seat_front = direction(socket.facing);
        if !cone(origin, front, point)
            || !cone(point, seat_front, origin)
            || !grid.segment_can_cross(point, origin)
            || !occupancy.exclusive_available(person, seat.entity)
            || claims
                .iter()
                .any(|d| d.person != person.index_u32() && d.chair == Some(seat.entity.index_u32()))
        {
            continue;
        }
        let best = approaches(pack, seat, &socket, device)
            .into_iter()
            .filter(|(endpoint, _)| {
                !claims
                    .iter()
                    .any(|d| d.person != person.index_u32() && d.endpoint == *endpoint)
            })
            .filter_map(|(endpoint, contact)| {
                field
                    .distance_to_contact(endpoint, contact)
                    .map(|distance| (distance, endpoint))
            })
            .min();
        let Some((distance, endpoint)) = best else {
            continue;
        };
        let device_distance = (point.0 - origin.0).powi(2) + (point.1 - origin.1).powi(2);
        candidates.push((device_distance, seat.entity.index_u32(), distance, endpoint));
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    if let Some((_, chair, distance, endpoint)) = candidates.first().copied() {
        return Some(Plan {
            access: Reachable {
                route: Route::Exact(endpoint),
                distance,
            },
            lease: Some(SavedDiner {
                person: person.index_u32(),
                station: device.entity.index_u32(),
                chair: Some(chair),
                setting: None,
                endpoint,
                obstructing: vec![],
            }),
        });
    }
    // Work without a reachable chair falls back to the ordinary standing
    // route at the station's perimeter, never to a viewing position.
    if crate::seating::work_station(pack, device.definition) {
        return None;
    }
    let mut standing = vec![];
    for dx in -7..=7 {
        for dy in -7..=7 {
            let tile = (origin.0.round() as i32 + dx, origin.1.round() as i32 + dy);
            let point = (tile.0 as f32, tile.1 as f32);
            if !cone(origin, front, point)
                || !grid.is_walkable(tile.0, tile.1)
                || !grid.segment_can_cross(point, origin)
                || claims
                    .iter()
                    .any(|d| d.person != person.index_u32() && d.endpoint == tile)
            {
                continue;
            }
            if let Some(distance) = field.distance_to_tile(tile) {
                standing.push((dx * dx + dy * dy, distance, tile));
            }
        }
    }
    standing.sort_unstable();
    standing.first().map(|(_, distance, tile)| Plan {
        access: Reachable {
            route: Route::Exact(*tile),
            distance: *distance,
        },
        lease: None,
    })
}

pub(crate) fn projection(world: &World, person: Entity) -> Option<crate::SocketActionProjection> {
    let target = world.get::<Target>(person)?;
    let object = world.get::<SmartObject>(target.object)?;
    let eating = world.get::<Eating>(person)?;
    if eating.object != object.0
        || eating.interaction != target.interaction
        || world.get::<terri_core::StepWork>(person).is_some()
        || world.get::<terri_core::Path>(person).is_some()
    {
        return None;
    }
    let pack = world.resource::<Content>().0;
    let activity = crate::seating::seated_activity(pack, object.0, target.interaction)?;
    if let Some(lease) = crate::seating::claim(world, person.index_u32())
        .filter(|d| crate::seating::kind(world, d) == Some(crate::seating::UseKind::Media))
    {
        let chair = crate::dining::entity(world, lease.chair?)?;
        let position = *world.get::<Position>(chair)?;
        let definition = world.get::<SmartObject>(chair)?.0;
        let seat = BoundaryFurniture {
            entity: chair,
            position,
            definition,
            facing: world
                .get::<terri_core::ObjectFacing>(chair)
                .map_or(pack.object(definition).base_facing, |f| f.0),
        };
        let device = world.get::<Position>(target.object)?;
        let socket = seat_socket(pack, &seat, (device.x, device.y))?;
        let front = direction(socket.facing);
        return Some(crate::SocketActionProjection {
            x: socket.x,
            y: socket.y,
            facing: wire_facing(front.0 as f32, front.1 as f32),
            target_entity: chair.index_u32(),
            visual_action: crate::render_buffer::visual_action::SIT,
            activity,
        });
    }
    if crate::seating::work_station(pack, object.0) {
        // Standing work keeps the ordinary standing presentation.
        return None;
    }
    let position = world.get::<Position>(person)?;
    let device = world.get::<Position>(target.object)?;
    Some(crate::SocketActionProjection {
        x: position.x,
        y: position.y,
        facing: wire_facing(device.x - position.x, device.y - position.y),
        target_entity: u32::MAX,
        visual_action: crate::render_buffer::visual_action::WATCH,
        activity,
    })
}

pub(crate) fn valid_lease(world: &World, lease: &SavedDiner) -> bool {
    let Some(person) = crate::dining::entity(world, lease.person) else {
        return false;
    };
    let Some(device) = crate::dining::entity(world, lease.station) else {
        return false;
    };
    let Some(chair) = lease.chair.and_then(|id| crate::dining::entity(world, id)) else {
        return false;
    };
    if lease.setting.is_some()
        || !lease.obstructing.is_empty()
        || world.get::<terri_core::Agent>(person).is_none()
        || world.get::<terri_core::AtWork>(person).is_some()
        || world.get::<terri_core::Socialising>(person).is_some()
        || world
            .get::<Target>(person)
            .is_none_or(|t| t.object != device)
    {
        return false;
    }
    if world.get::<terri_core::Reserved>(chair).is_some()
        || world
            .try_query::<(Entity, &Target)>()
            .is_some_and(|mut query| {
                query
                    .iter(world)
                    .any(|(owner, target)| owner != person && target.object == chair)
            })
    {
        return false;
    }
    let pack = world.resource::<Content>().0;
    let item = |entity: Entity| -> Option<BoundaryFurniture> {
        let position = *world.get::<Position>(entity)?;
        let definition = world.get::<SmartObject>(entity)?.0;
        Some(BoundaryFurniture {
            entity,
            position,
            definition,
            facing: world
                .get::<terri_core::ObjectFacing>(entity)
                .map_or(pack.object(definition).base_facing, |f| f.0),
        })
    };
    let Some(device) = item(device) else {
        return false;
    };
    let Some(seat) = item(chair) else {
        return false;
    };
    let target = *world.get::<Target>(person).unwrap();
    if crate::seating::seated_activity(pack, device.definition, target.interaction).is_none() {
        return false;
    }
    let origin = (device.position.x, device.position.y);
    let Some(socket) = seat_socket(pack, &seat, origin) else {
        return false;
    };
    let front = direction(socket.facing);
    let point = (socket.x, socket.y);
    let grid = world.resource::<TileGrid>();
    let contact = approaches(pack, &seat, &socket, &device)
        .into_iter()
        .find(|(end, _)| *end == lease.endpoint);
    if contact.is_none()
        || !grid.is_walkable(lease.endpoint.0, lease.endpoint.1)
        || !contact.is_some_and(|(_, tile)| {
            grid.can_interact_with_rect(lease.endpoint, tile, terri_core::Footprint::SINGLE)
        })
        || !cone(origin, device.facing.rotate_axis(1, 0), point)
        || !cone(point, front, origin)
        || !grid.segment_can_cross(point, origin)
    {
        return false;
    }
    let Some(position) = world.get::<Position>(person) else {
        return false;
    };
    if let Some(path) = world.get::<terri_core::Path>(person) {
        return path
            .steps
            .last()
            .copied()
            .unwrap_or((position.x.round() as i32, position.y.round() as i32))
            == lease.endpoint;
    }
    world
        .get::<Eating>(person)
        .is_some_and(|e| e.object == device.definition && e.interaction == target.interaction)
        && (position.x.round() as i32, position.y.round() as i32) == lease.endpoint
}

/// Validate device capacity and exclusive destinations before adopting a save.
pub(crate) fn validate_ownership(world: &World) -> Result<(), crate::SaveError> {
    let pack = world.resource::<Content>().0;
    let Some(mut people) = world.try_query_filtered::<(Entity, &Target, &Position, Option<&terri_core::Path>), With<terri_core::Agent>>() else { return Ok(()); };
    let viewers: Vec<_> = people
        .iter(world)
        .filter_map(|(person, target, position, path)| {
            let definition = world.get::<SmartObject>(target.object)?.0;
            crate::seating::media_activity(pack, definition, target.interaction)?;
            let endpoint = crate::seating::claim(world, person.index_u32())
                .map(|d| d.endpoint)
                .or_else(|| path.and_then(|p| p.steps.last().copied()))
                .unwrap_or((position.x.round() as i32, position.y.round() as i32));
            Some((person, *target, definition, endpoint))
        })
        .collect();
    for (person, target, definition, endpoint) in &viewers {
        let occupants: Vec<_> = viewers
            .iter()
            .filter(|(_, t, _, _)| t.object == target.object)
            .collect();
        let slots =
            pack.object(*definition).interactions[target.interaction as usize].slots as usize;
        if occupants.len() > slots
            || occupants
                .iter()
                .any(|(_, t, _, _)| t.interaction != target.interaction)
            || viewers
                .iter()
                .any(|(other, _, _, p)| other != person && p == endpoint)
            || world
                .get_resource::<terri_core::save::SavedDining>()
                .is_some_and(|s| {
                    s.diners
                        .iter()
                        .any(|d| d.person != person.index_u32() && d.endpoint == *endpoint)
                })
        {
            return Err(crate::SaveError::InvalidValue);
        }
    }
    Ok(())
}

fn wire_facing(x: f32, y: f32) -> u32 {
    if x.abs() >= y.abs() {
        if x >= 0. {
            1
        } else {
            2
        }
    } else if y >= 0. {
        3
    } else {
        4
    }
}

pub(crate) fn valid_standing_contact(
    world: &World,
    person: u32,
    station: u32,
    endpoint: (i32, i32),
) -> bool {
    if crate::seating::claim(world, person).is_some() {
        return false;
    }
    let Some(person) = crate::dining::entity(world, person) else {
        return false;
    };
    let Some(device) = crate::dining::entity(world, station) else {
        return false;
    };
    let Some(target) = world.get::<Target>(person).filter(|t| t.object == device) else {
        return false;
    };
    let Some(object) = world.get::<SmartObject>(device) else {
        return false;
    };
    let pack = world.resource::<Content>().0;
    if crate::seating::media_activity(pack, object.0, target.interaction).is_none()
        || world.get::<terri_core::StepWork>(person).is_some()
        || world.get::<terri_core::Socialising>(person).is_some()
        || world.get::<terri_core::AtWork>(person).is_some()
        || world
            .get::<Eating>(person)
            .is_some_and(|e| e.object != object.0 || e.interaction != target.interaction)
    {
        return false;
    }
    let Some(position) = world.get::<Position>(device) else {
        return false;
    };
    let origin = (position.x, position.y);
    let point = (endpoint.0 as f32, endpoint.1 as f32);
    let facing = world
        .get::<terri_core::ObjectFacing>(device)
        .map_or(pack.object(object.0).base_facing, |f| f.0);
    let grid = world.resource::<TileGrid>();
    grid.is_walkable(endpoint.0, endpoint.1)
        && cone(origin, facing.rotate_axis(1, 0), point)
        && grid.segment_can_cross(point, origin)
}

fn cancel(world: &mut World, person: Entity, target: Target) {
    crate::reservations::release_now(world, person, target);
    world
        .entity_mut(person)
        .remove::<Target>()
        .remove::<terri_core::Path>()
        .remove::<Eating>();
}

/// A changed viewing position interrupts its current use and resumes after arrival.
pub(crate) fn maintain(world: &mut World) {
    let pack = world.resource::<Content>().0;
    let mut people: Vec<_> = world
        .query_filtered::<(Entity, &Target), (
            With<terri_core::Agent>,
            Without<terri_core::AtWork>,
            Without<terri_core::Commuting>,
            Without<terri_core::Socialising>,
        )>()
        .iter(world)
        .filter(|(_, target)| {
            world.get::<SmartObject>(target.object).is_some_and(|o| {
                crate::seating::seated_activity(pack, o.0, target.interaction).is_some()
            })
        })
        .map(|(person, target)| (person, *target))
        .collect();
    people.sort_by_key(|(person, _)| person.index_u32());
    for (person, target) in people {
        let held = crate::seating::claim(world, person.index_u32()).cloned();
        if held.as_ref().is_some_and(|lease| valid_lease(world, lease)) {
            continue;
        }
        if held.is_none()
            && world
                .get::<SmartObject>(target.object)
                .is_some_and(|o| crate::seating::work_station(pack, o.0))
        {
            // Standing work at a station is an ordinary use with no seat to maintain.
            continue;
        }
        if held.is_none() && world.get::<Eating>(person).is_none() {
            let endpoint = world
                .get::<terri_core::Path>(person)
                .and_then(|p| p.steps.last().copied())
                .or_else(|| {
                    world
                        .get::<Position>(person)
                        .map(|p| (p.x.round() as i32, p.y.round() as i32))
                });
            if endpoint.is_some_and(|p| {
                valid_standing_contact(world, person.index_u32(), target.object.index_u32(), p)
            }) {
                continue;
            }
        }
        if held.is_none()
            && world
                .get::<Eating>(person)
                .is_some_and(|e| e.remaining_ticks <= 1)
        {
            continue;
        }
        let Some(position) = world.get::<Position>(person).copied() else {
            continue;
        };
        let furniture: Vec<_> = world
            .query::<(
                Entity,
                &Position,
                &SmartObject,
                Option<&terri_core::ObjectFacing>,
            )>()
            .iter(world)
            .map(|(entity, position, object, facing)| BoundaryFurniture {
                entity,
                position: *position,
                definition: object.0,
                facing: facing.map_or(pack.object(object.0).base_facing, |f| f.0),
            })
            .collect();
        let Some(device) = furniture.iter().find(|d| d.entity == target.object) else {
            continue;
        };
        let claims = crate::seating::physical_places(world);
        let occupancy = crate::seating::occupancy(world);
        let grid = world.resource::<TileGrid>();
        let from = (position.x.round() as i32, position.y.round() as i32);
        let Some(field) = grid.distance_field(from) else {
            cancel(world, person, target);
            continue;
        };
        let next = plan(
            Planning {
                pack,
                grid,
                field: &field,
                objects: &furniture,
                occupancy: &occupancy,
                claims: &claims,
            },
            person,
            device,
        );
        let Some(next) = next else {
            cancel(world, person, target);
            continue;
        };
        if held.is_none() && next.lease.is_none() {
            let Route::Exact(endpoint) = next.access.route else {
                unreachable!("media endpoint")
            };
            if endpoint == (position.x.round() as i32, position.y.round() as i32)
                && valid_standing_contact(
                    world,
                    person.index_u32(),
                    target.object.index_u32(),
                    endpoint,
                )
            {
                continue;
            }
        }
        let Some(steps) = next
            .access
            .route
            .path(grid, from)
            .and_then(|p| grid.anchor_path((position.x, position.y), p))
        else {
            cancel(world, person, target);
            continue;
        };
        crate::seating::replace(world, person, next.lease);
        world
            .entity_mut(person)
            .remove::<Eating>()
            .insert(terri_core::Path { steps, cursor: 0 });
    }
}
