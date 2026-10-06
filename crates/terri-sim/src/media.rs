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
    pub seat: Option<(Entity, u16)>,
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

fn legacy_seat_socket(
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

fn media_socket(
    pack: &terri_data::ContentPack,
    definition: terri_core::ObjectDefId,
    mut socket: terri_data::CompiledPlacementSocket,
    toward: (f32, f32),
) -> terri_data::CompiledPlacementSocket {
    if pack
        .object(definition)
        .roles
        .iter()
        .any(|r| pack.roles[*r as usize] == "turnable_seat")
    {
        socket.facing = match wire_facing(toward.0 - socket.x, toward.1 - socket.y) {
            1 => CompiledSocketFacing::PositiveX,
            2 => CompiledSocketFacing::NegativeX,
            3 => CompiledSocketFacing::PositiveY,
            _ => CompiledSocketFacing::NegativeY,
        };
    }
    socket
}

fn axis_facing(facing: u32) -> (i32, i32) {
    match facing {
        1 => (1, 0),
        2 => (-1, 0),
        3 => (0, 1),
        _ => (0, -1),
    }
}

fn approaches(
    pack: &terri_data::ContentPack,
    seat: &BoundaryFurniture,
    socket: &terri_data::CompiledPlacementSocket,
) -> Vec<((i32, i32), (i32, i32))> {
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
    } = planning;
    let origin = (device.position.x, device.position.y);
    let front = device.facing.rotate_axis(1, 0);
    let mut candidates = vec![];
    for seat in objects {
        let definition = pack.object(seat.definition);
        for ordinal in 0..definition.seats.len() {
            let socket = media_socket(
                pack,
                seat.definition,
                definition.seat_at(ordinal, seat.position.x, seat.position.y, seat.facing)?,
                origin,
            );
            let point = (socket.x, socket.y);
            if !cone(origin, front, point)
                || !cone(point, direction(socket.facing), origin)
                || !grid.segment_can_cross(point, origin)
                || !occupancy.seat_available(person, seat.entity, ordinal as u16)
            {
                continue;
            }
            let footprint = definition.footprint_at(seat.facing);
            let at = (
                seat.position.x.round() as i32,
                seat.position.y.round() as i32,
            );
            let best = definition
                .seat_approaches_at(ordinal, seat.facing)?
                .into_iter()
                .filter_map(|(x, y)| {
                    let endpoint = (at.0 + x, at.1 + y);
                    if !occupancy.endpoint_available(crate::seating::EndpointUse {
                        owner: person,
                        endpoint,
                        kind: crate::seating::UseKind::Media,
                    }) {
                        return None;
                    }
                    let contact = (
                        at.0 + x.clamp(0, footprint.width as i32 - 1),
                        at.1 + y.clamp(0, footprint.depth as i32 - 1),
                    );
                    field
                        .distance_to_contact(endpoint, contact)
                        .map(|distance| (distance, endpoint))
                })
                .min();
            if let Some((distance, endpoint)) = best {
                candidates.push((
                    (point.0 - origin.0).powi(2) + (point.1 - origin.1).powi(2),
                    seat.entity,
                    ordinal as u16,
                    distance,
                    endpoint,
                ));
            }
        }
    }
    candidates.sort_by(|a, b| {
        a.0.total_cmp(&b.0)
            .then(a.1.index_u32().cmp(&b.1.index_u32()))
            .then(a.2.cmp(&b.2))
    });
    if let Some((_, chair, ordinal, distance, endpoint)) = candidates.first().copied() {
        return Some(Plan {
            access: Reachable {
                route: Route::Exact(endpoint),
                distance,
            },
            lease: Some(SavedDiner {
                person: person.index_u32(),
                station: device.entity.index_u32(),
                chair: Some(chair.index_u32()),
                setting: None,
                endpoint,
                obstructing: vec![],
            }),
            seat: Some((chair, ordinal)),
        });
    }
    let mut standing = vec![];
    for dx in -7..=7 {
        for dy in -7..=7 {
            let tile = (origin.0.round() as i32 + dx, origin.1.round() as i32 + dy);
            let point = (tile.0 as f32, tile.1 as f32);
            if !cone(origin, front, point)
                || !grid.is_walkable(tile.0, tile.1)
                || !grid.segment_can_cross(point, origin)
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
        seat: None,
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
    let activity = crate::seating::media_activity(pack, object.0, target.interaction)?;
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
        let socket = crate::seating::body(world, person)
            .or_else(|| legacy_seat_socket(pack, &seat, (device.x, device.y)))?;
        let socket = media_socket(pack, definition, socket, (device.x, device.y));
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
    let held = world.get::<crate::seating::PhysicalClaim>(person);
    if world
        .try_query::<(Entity, &Target)>()
        .is_some_and(|mut query| {
            query.iter(world).any(|(owner, target)| {
                owner != person
                    && target.object == chair
                    && world
                        .get::<crate::seating::PhysicalClaim>(owner)
                        .is_none_or(|c| {
                            held.is_none_or(|ours| c.all || ours.all || c.seat == ours.seat)
                        })
            })
        })
    {
        return false;
    }
    if held.is_none() && world.get::<terri_core::Reserved>(chair).is_some() {
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
    if crate::seating::media_activity(pack, device.definition, target.interaction).is_none() {
        return false;
    }
    let origin = (device.position.x, device.position.y);
    let socket =
        crate::seating::body(world, person).or_else(|| legacy_seat_socket(pack, &seat, origin));
    let Some(socket) = socket else {
        return false;
    };
    let socket = media_socket(pack, seat.definition, socket, origin);
    let front = direction(socket.facing);
    let point = (socket.x, socket.y);
    let grid = world.resource::<TileGrid>();
    let options = if let Some(held) = held {
        let Some(ordinal) = crate::seating::ordinal(world, held) else {
            return false;
        };
        let def = pack.object(seat.definition);
        let fp = def.footprint_at(seat.facing);
        def.seat_approaches_at(ordinal as usize, seat.facing)
            .unwrap_or_default()
            .into_iter()
            .map(|(x, y)| {
                let at = (
                    seat.position.x.round() as i32,
                    seat.position.y.round() as i32,
                );
                (
                    (at.0 + x, at.1 + y),
                    (
                        at.0 + x.clamp(0, fp.width as i32 - 1),
                        at.1 + y.clamp(0, fp.depth as i32 - 1),
                    ),
                )
            })
            .collect()
    } else {
        approaches(pack, &seat, &socket)
    };
    let contact = options.into_iter().find(|(end, _)| *end == lease.endpoint);
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
                crate::seating::media_activity(pack, o.0, target.interaction).is_some()
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
        if held.is_none() && world.get::<Eating>(person).is_none() {
            continue;
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
            },
            person,
            device,
        );
        let Some(next) = next else {
            cancel(world, person, target);
            continue;
        };
        if held.is_none() && next.lease.is_none() {
            continue;
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
        crate::seating::replace_media(world, person, next);
        world
            .entity_mut(person)
            .remove::<Eating>()
            .insert(terri_core::Path { steps, cursor: 0 });
    }
}
