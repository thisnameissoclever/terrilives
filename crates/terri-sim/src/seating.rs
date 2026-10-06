//! Canonical physical-seat ownership and published meal/media lease metadata.
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::{
    save::{SavedDiner, SavedDining},
    SmartObject, Target,
};

/// The only authority for occupied physical places, including travel.
/// Entity generations protect live ownership; persistence resolves the envelope's saved indices.
#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub(crate) struct PhysicalClaim {
    pub furniture: Entity,
    pub seat: String,
    pub target: Target,
    pub all: bool,
}

/// Saved finite coordinates can still exceed integer contact arithmetic.
pub(crate) fn contact_offset(origin: (i32, i32), offset: (i32, i32)) -> Option<(i32, i32)> {
    Some((
        origin.0.checked_add(offset.0)?,
        origin.1.checked_add(offset.1)?,
    ))
}

/// Admission and restoration share the same authored approach and wall-edge test.
/// No ordinal means an action owns the whole furniture and uses its perimeter.
pub(crate) fn legal_contact(
    grid: &terri_core::TileGrid,
    definition: &terri_data::CompiledObject,
    facing: terri_core::Facing,
    origin: (i32, i32),
    ordinal: Option<u16>,
    endpoint: (i32, i32),
) -> bool {
    if !grid.is_walkable(endpoint.0, endpoint.1) {
        return false;
    }
    let footprint = definition.footprint_at(facing);
    let Some(ordinal) = ordinal else {
        return grid.can_interact_with_rect(endpoint, origin, footprint);
    };
    definition
        .seat_approaches_at(ordinal as usize, facing)
        .is_some_and(|approaches| {
            approaches.into_iter().any(|(x, y)| {
                Some(endpoint) == contact_offset(origin, (x, y))
                    && grid.can_interact_with_rect(
                        endpoint,
                        (
                            origin.0 + x.clamp(0, footprint.width as i32 - 1),
                            origin.1 + y.clamp(0, footprint.depth as i32 - 1),
                        ),
                        terri_core::Footprint::SINGLE,
                    )
            })
        })
}

pub(crate) fn ordinal(world: &World, claim: &PhysicalClaim) -> Option<u16> {
    let definition = world.get::<SmartObject>(claim.furniture)?;
    world
        .resource::<Content>()
        .0
        .object(definition.0)
        .seats
        .iter()
        .position(|s| s.id == claim.seat)
        .map(|i| i as u16)
}

pub(crate) fn install(
    world: &mut World,
    person: Entity,
    furniture: Entity,
    ordinal: u16,
    all: bool,
) {
    let target = *world
        .get::<Target>(person)
        .expect("admission installs its target first");
    let definition = world.get::<SmartObject>(furniture).unwrap().0;
    let seat = world.resource::<Content>().0.object(definition).seats[ordinal as usize]
        .id
        .clone();
    world.entity_mut(person).insert(PhysicalClaim {
        furniture,
        seat,
        target,
        all,
    });
}

pub(crate) fn apply_admission(
    world: &mut World,
    person: Entity,
    admission: crate::beds::Admission,
) {
    match admission {
        crate::beds::Admission::Seat { ordinal, all } => {
            let furniture = world.get::<Target>(person).unwrap().object;
            install(world, person, furniture, ordinal, all);
        }
        _ => {
            world.entity_mut(person).remove::<PhysicalClaim>();
        }
    }
}

pub(crate) fn body(world: &World, person: Entity) -> Option<terri_data::CompiledPlacementSocket> {
    let claim = world.get::<PhysicalClaim>(person)?;
    if world.get::<Target>(person) != Some(&claim.target) {
        return None;
    }
    let p = world.get::<terri_core::Position>(claim.furniture)?;
    let definition = world
        .resource::<Content>()
        .0
        .object(world.get::<SmartObject>(claim.furniture)?.0);
    let facing = world
        .get::<terri_core::ObjectFacing>(claim.furniture)
        .map_or(definition.base_facing, |f| f.0);
    definition.seat_at(ordinal(world, claim)? as usize, p.x, p.y, facing)
}

pub(crate) fn wire_facing(facing: terri_data::CompiledSocketFacing) -> u32 {
    match facing {
        terri_data::CompiledSocketFacing::PositiveX => 1,
        terri_data::CompiledSocketFacing::NegativeX => 2,
        terri_data::CompiledSocketFacing::PositiveY => 3,
        terri_data::CompiledSocketFacing::NegativeY => 4,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UseKind {
    Meal,
    TableSeat,
    Media,
    ShelfTransfer,
    Standing,
}

/// A meal reserves its approach; distinct media seats may share an approach.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EndpointUse {
    pub owner: Entity,
    pub endpoint: (i32, i32),
    pub kind: UseKind,
}

pub(crate) fn endpoints_conflict(a: EndpointUse, b: EndpointUse, historical: bool) -> bool {
    a.owner != b.owner
        && a.endpoint == b.endpoint
        && (historical
            || a.kind == UseKind::Meal
            || b.kind == UseKind::Meal
            || a.kind == UseKind::ShelfTransfer
            || b.kind == UseKind::ShelfTransfer
            || a.kind == UseKind::Standing
            || b.kind == UseKind::Standing)
}

pub(crate) fn endpoint_use(world: &World, lease: &SavedDiner) -> Option<EndpointUse> {
    Some(EndpointUse {
        owner: crate::dining::entity(world, lease.person)?,
        endpoint: lease.endpoint,
        kind: kind(world, lease)?,
    })
}

pub(crate) fn endpoint_available(world: &World, candidate: EndpointUse) -> bool {
    let historical = terri_data::is_pre_books_pack(world.resource::<Content>().0);
    let dining = world.get_resource::<SavedDining>().is_none_or(|state| {
        state
            .diners
            .iter()
            .filter_map(|d| endpoint_use(world, d))
            .all(|known| !endpoints_conflict(candidate, known, historical))
    });
    dining
        && world
            .try_query::<(Entity, &crate::reading::ReadingJourney)>()
            .is_none_or(|mut q| {
                q.iter(world)
                    .flat_map(|(owner, j)| crate::reading::endpoints(owner, j))
                    .all(|known| !endpoints_conflict(candidate, known, historical))
            })
}

pub(crate) fn media_activity(
    pack: &terri_data::ContentPack,
    object: terri_core::ObjectDefId,
    interaction: u32,
) -> Option<u32> {
    let definition = pack.objects.get(object.0 as usize)?;
    let action = definition.interactions.get(interaction as usize)?;
    let behavior = action.media.or_else(|| {
        if !terri_data::is_pre_books_pack(pack) {
            return None;
        }
        match (definition.id.as_str(), action.id.as_str()) {
            ("television", "watch_tv") => Some(terri_data::MediaBehavior::Television),
            ("radio", "listen") => Some(terri_data::MediaBehavior::Radio),
            _ => None,
        }
    })?;
    Some(match behavior {
        terri_data::MediaBehavior::Television => crate::render_buffer::activity::WATCHING_TV,
        terri_data::MediaBehavior::Radio => crate::render_buffer::activity::LISTENING_RADIO,
    })
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
    let definition = world.resource::<Content>().0.object(object.0);
    let interaction = definition.interactions.get(target.interaction as usize)?;
    if interaction.seat_use != terri_data::SeatUse::One {
        return None;
    }
    let socket = body(world, person)?;
    Some(crate::SocketActionProjection {
        x: socket.x,
        y: socket.y,
        facing: wire_facing(socket.facing),
        target_entity: target.object.index_u32(),
        visual_action: if interaction.book_reading {
            crate::render_buffer::visual_action::READ
        } else {
            crate::render_buffer::visual_action::SIT
        },
        activity: if interaction.book_reading {
            crate::render_buffer::activity::READING
        } else {
            crate::render_buffer::activity::SITTING
        },
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
    world.try_query::<&PhysicalClaim>().is_some_and(|mut q| {
        q.iter(world)
            .any(|c| c.furniture.index_u32() == object || c.target.object.index_u32() == object)
    }) || world.get_resource::<SavedDining>().is_some_and(|s| {
        s.diners
            .iter()
            .any(|d| d.station == object || d.chair == Some(object))
    })
}

pub(crate) fn release(world: &mut World, person: u32) -> Option<SavedDiner> {
    if let Some(owner) = crate::dining::entity(world, person) {
        world.entity_mut(owner).remove::<PhysicalClaim>();
    }
    let mut state = world.get_resource_mut::<SavedDining>()?;
    let index = state.diners.iter().position(|d| d.person == person)?;
    Some(state.diners.remove(index))
}

/// A stale release cannot remove the physical place of a replacement target.
pub(crate) fn release_exact(world: &mut World, owner: Entity, expected: Target) {
    // Published metadata uses indices; an old generation cannot release its replacement.
    if world.get_entity(owner).is_err() {
        return;
    }
    if world
        .get::<PhysicalClaim>(owner)
        .is_some_and(|c| c.target == expected)
        && world.get::<Target>(owner).is_none_or(|t| *t == expected)
    {
        world.entity_mut(owner).remove::<PhysicalClaim>();
    }
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
            !state.diners.iter().any(|d| d.person == lease.person),
            "Physical seat claims must be exclusive before commit"
        );
        state.diners.push(lease);
        state.diners.sort_by_key(|d| d.person);
    }
}

pub(crate) fn replace_media(world: &mut World, owner: Entity, plan: crate::media::Plan) {
    replace(world, owner, plan.lease);
    if let Some((furniture, ordinal)) = plan.seat {
        install(world, owner, furniture, ordinal, false);
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
    result.historical_endpoints(terri_data::is_pre_books_pack(world.resource::<Content>().0));
    if let Some(mut query) = world.try_query::<(Entity, &PhysicalClaim)>() {
        for (owner, place) in query.iter(world) {
            if let Some(ordinal) = ordinal(world, place) {
                result.physical_seat_claim(owner, place.furniture, ordinal, place.all);
            }
        }
    }
    if let Some(mut query) = world.try_query::<(Entity, &crate::reading::ReadingJourney)>() {
        for (owner, j) in query.iter(world) {
            for endpoint in crate::reading::endpoints(owner, j) {
                result.claim_endpoint(endpoint);
            }
        }
    }
    if let Some(state) = world.get_resource::<SavedDining>() {
        for lease in &state.diners {
            if let Some(endpoint) = endpoint_use(world, lease) {
                result.claim_endpoint(endpoint);
            }
            let Some(owner) = crate::dining::entity(world, lease.person) else {
                continue;
            };
            let Some(chair) = lease.chair.and_then(|id| crate::dining::entity(world, id)) else {
                continue;
            };
            if world
                .get::<Target>(owner)
                .is_some_and(|t| t.object.index_u32() == lease.station)
                && terri_data::is_pre_books_pack(world.resource::<Content>().0)
                && world.get::<PhysicalClaim>(owner).is_none()
            {
                result.physical_claim(owner, chair);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests;

/// Drop only claims whose recorded activity has ended; replacement claims remain intact.
pub(crate) fn maintain(world: &mut World) {
    let stale: Vec<_> = world
        .query::<(Entity, &PhysicalClaim)>()
        .iter(world)
        .filter(|(owner, claim)| {
            world.get::<terri_core::Agent>(*owner).is_none()
                || world.get::<Target>(*owner) != Some(&claim.target)
        })
        .map(|(owner, _)| owner)
        .collect();
    for owner in stale {
        world.entity_mut(owner).remove::<PhysicalClaim>();
    }
}

mod persistence;
pub(crate) use persistence::{
    capture, hash, migrate, restore_claims, validate, validate_exclusive,
};
