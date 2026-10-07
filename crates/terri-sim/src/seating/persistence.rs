//! V6 requires complete claims; only the published-format migration may derive them.
use super::*;
use crate::SaveError;
use std::collections::BTreeSet;
use terri_core::{save_v6::SavedPhysicalSeat, Agent, Eating, Path, Position, Reserved, TileGrid};

fn action(world: &World, target: Target) -> Option<String> {
    if target.interaction == crate::systems::chain::CHAIN_STEP {
        return Some("$meal".into());
    }
    let definition = world
        .resource::<Content>()
        .0
        .object(world.get::<SmartObject>(target.object)?.0);
    definition
        .interactions
        .get(target.interaction as usize)
        .map(|a| a.id.clone())
}

pub(crate) fn capture(world: &World) -> Vec<SavedPhysicalSeat> {
    let mut rows = world
        .try_query::<(Entity, &PhysicalClaim)>()
        .map_or_else(Vec::new, |mut q| {
            q.iter(world)
                .map(|(person, c)| SavedPhysicalSeat {
                    person: person.index_u32(),
                    furniture: c.furniture.index_u32(),
                    seat: c.seat.clone(),
                    target: c.target.object.index_u32(),
                    action: action(world, c.target).unwrap_or_default(),
                    all: c.all,
                })
                .collect()
        });
    rows.sort_by_key(|c| c.person);
    rows
}

pub(crate) fn restore_claims(
    world: &mut World,
    saved: &[SavedPhysicalSeat],
) -> Result<(), SaveError> {
    if saved.windows(2).any(|p| p[0].person >= p[1].person) {
        return Err(SaveError::InvalidValue);
    }
    let mut checked = vec![];
    for row in saved {
        let person = crate::dining::entity(world, row.person)
            .filter(|p| world.get::<Agent>(*p).is_some())
            .ok_or(SaveError::InvalidValue)?;
        let furniture =
            crate::dining::entity(world, row.furniture).ok_or(SaveError::InvalidValue)?;
        let target = *world.get::<Target>(person).ok_or(SaveError::InvalidValue)?;
        if target.object.index_u32() != row.target
            || action(world, target).as_deref() != Some(row.action.as_str())
        {
            return Err(SaveError::InvalidValue);
        }
        let claim = PhysicalClaim {
            furniture,
            seat: row.seat.clone(),
            target,
            all: row.all,
        };
        ordinal(world, &claim).ok_or(SaveError::InvalidValue)?;
        checked.push((person, claim));
    }
    for (person, claim) in checked {
        world.entity_mut(person).insert(claim);
    }
    Ok(())
}

pub(crate) fn validate_exclusive(world: &World) -> Result<(), SaveError> {
    let pack = world.resource::<Content>().0;
    let historical = terri_data::is_pre_books_pack(pack);
    let targets: Vec<_> = world
        .try_query_filtered::<(Entity, &Target), With<Agent>>()
        .map_or_else(Vec::new, |mut q| q.iter(world).collect());
    for (owner, target) in &targets {
        let Some(object) = world.get::<SmartObject>(target.object) else {
            continue;
        };
        let definition = pack.object(object.0);
        let has_seats = !definition.seats.is_empty()
            || (historical
                && matches!(
                    definition.id.as_str(),
                    "chair" | "desk_chair" | "sofa" | "long_sofa" | "armchair" | "reading_chair"
                ));
        let exclusive = definition
            .interactions
            .get(target.interaction as usize)
            .is_some_and(|a| a.seat_use == terri_data::SeatUse::Exclusive);
        if !has_seats || !exclusive {
            continue;
        }
        if targets
            .iter()
            .any(|(other, t)| other != owner && t.object == target.object)
            || (world.get::<Path>(*owner).is_some()
                && world.get::<Reserved>(target.object).is_none())
        {
            return Err(SaveError::InvalidValue);
        }
    }
    Ok(())
}

pub(crate) fn validate(world: &World, grid: &TileGrid) -> Result<(), SaveError> {
    validate_exclusive(world)?;
    let pack = world.resource::<Content>().0;
    let claims: Vec<_> = world
        .try_query::<(Entity, &PhysicalClaim)>()
        .map_or_else(Vec::new, |mut q| q.iter(world).collect());
    let mut occupied = BTreeSet::new();
    for (owner, claim) in &claims {
        if world.get::<Agent>(*owner).is_none()
            || world.get::<Target>(*owner) != Some(&claim.target)
            || world.get::<terri_core::AtWork>(*owner).is_some()
            || world.get::<terri_core::Commuting>(*owner).is_some()
            || world.get::<terri_core::Socialising>(*owner).is_some()
            || world.get::<terri_core::SleepPlace>(*owner).is_some()
            || world.get::<Reserved>(claim.target.object).is_none()
        {
            return Err(SaveError::InvalidValue);
        }
        let definition = pack.object(
            world
                .get::<SmartObject>(claim.furniture)
                .ok_or(SaveError::InvalidValue)?
                .0,
        );
        let ordinal = ordinal(world, claim).ok_or(SaveError::InvalidValue)?;
        let target_definition = world
            .get::<SmartObject>(claim.target.object)
            .ok_or(SaveError::InvalidValue)?
            .0;
        let direct = claim.target.object == claim.furniture;
        if direct {
            let a = pack
                .object(target_definition)
                .interactions
                .get(claim.target.interaction as usize)
                .ok_or(SaveError::InvalidValue)?;
            if a.seat_use
                != if claim.all {
                    terri_data::SeatUse::All
                } else {
                    terri_data::SeatUse::One
                }
            {
                return Err(SaveError::InvalidValue);
            }
        } else {
            let lease = super::claim(world, owner.index_u32()).ok_or(SaveError::InvalidValue)?;
            if claim.all
                || lease.chair != Some(claim.furniture.index_u32())
                || lease.station != claim.target.object.index_u32()
                || kind(world, lease).is_none()
            {
                return Err(SaveError::InvalidValue);
            }
        }
        for place in 0..definition.seats.len() {
            if (claim.all || place == ordinal as usize)
                && !occupied.insert((claim.furniture, place))
            {
                return Err(SaveError::InvalidValue);
            }
        }
        if world.try_query::<(Entity, &Target)>().is_some_and(|mut q| {
            q.iter(world).any(|(p, t)| {
                p != *owner
                    && t.object == claim.furniture
                    && world.get::<PhysicalClaim>(p).is_none()
            })
        }) {
            return Err(SaveError::InvalidValue);
        }
        if world
            .get::<crate::reading::ReadingJourney>(*owner)
            .is_some()
        {
            continue;
        }
        let p = world
            .get::<Position>(*owner)
            .ok_or(SaveError::InvalidValue)?;
        let path = world.get::<Path>(*owner);
        let endpoint = path
            .and_then(|p| p.steps.last().copied())
            .unwrap_or((p.x.round() as i32, p.y.round() as i32));
        if !grid.is_walkable(endpoint.0, endpoint.1) {
            return Err(SaveError::InvalidValue);
        }
        let at = world
            .get::<Position>(claim.furniture)
            .ok_or(SaveError::InvalidValue)?;
        let facing = world
            .get::<terri_core::ObjectFacing>(claim.furniture)
            .map_or(definition.base_facing, |f| f.0);
        if !legal_contact(
            grid,
            definition,
            facing,
            (at.x.round() as i32, at.y.round() as i32),
            (!claim.all).then_some(ordinal),
            endpoint,
        ) {
            return Err(SaveError::InvalidValue);
        }
        if path.is_some() {
            if world.get::<Eating>(*owner).is_some()
                || world.get::<terri_core::StepWork>(*owner).is_some()
            {
                return Err(SaveError::InvalidValue);
            }
        } else if direct || claim.target.interaction != crate::systems::chain::CHAIN_STEP {
            if world.get::<Eating>(*owner).is_none_or(|e| {
                e.object != target_definition || e.interaction != claim.target.interaction
            }) {
                return Err(SaveError::InvalidValue);
            }
        } else if world.get::<terri_core::StepWork>(*owner).is_none() {
            return Err(SaveError::InvalidValue);
        }
    }
    // Missing current claims are corruption, including users still travelling.
    if let Some(mut q) = world.try_query_filtered::<(Entity, &Target), With<Agent>>() {
        for (person, target) in q.iter(world) {
            let requested = world.get::<SmartObject>(target.object).is_some_and(|o| {
                pack.object(o.0)
                    .interactions
                    .get(target.interaction as usize)
                    .is_some_and(|a| a.seat_use != terri_data::SeatUse::Exclusive)
            });
            let secondary =
                super::claim(world, person.index_u32()).is_some_and(|d| d.chair.is_some());
            if (requested || secondary) && world.get::<PhysicalClaim>(person).is_none() {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    Ok(())
}

/// Published users retain a compatible place; impossible pre-feature actions end safely.
pub(crate) fn migrate(world: &mut World) -> Result<(), SaveError> {
    let pack = world.resource::<Content>().0;
    if terri_data::is_pre_books_pack(pack) {
        return Ok(());
    }
    // Published leases owned whole chairs. Validate that source exclusivity
    // before any safe termination can remove evidence of a corrupt record.
    if let Some(state) = world.get_resource::<SavedDining>() {
        let mut chairs = BTreeSet::new();
        let mut owners = BTreeSet::new();
        for lease in &state.diners {
            if !owners.insert(lease.person) {
                return Err(SaveError::InvalidValue);
            }
            if let Some(chair) = lease.chair {
                if !chairs.insert(chair)
                    || world.try_query::<(Entity, &Target)>().is_some_and(|mut q| {
                        q.iter(world).any(|(p, t)| {
                            p.index_u32() != lease.person && t.object.index_u32() == chair
                        })
                    })
                {
                    return Err(SaveError::InvalidValue);
                }
            }
        }
    }
    let mut users: Vec<_> = world
        .query_filtered::<(Entity, &Target), With<Agent>>()
        .iter(world)
        .map(|(p, t)| (p, *t))
        .collect();
    users.sort_by_key(|(person, _)| person.index_u32());
    for (person, target) in users {
        if world.get::<PhysicalClaim>(person).is_some() {
            continue;
        }
        let direct = world
            .get::<SmartObject>(target.object)
            .and_then(|o| {
                pack.object(o.0)
                    .interactions
                    .get(target.interaction as usize)
            })
            .filter(|a| a.seat_use != terri_data::SeatUse::Exclusive);
        let furniture = if direct.is_some() {
            Some(target.object)
        } else {
            super::claim(world, person.index_u32())
                .and_then(|d| d.chair)
                .and_then(|id| crate::dining::entity(world, id))
        };
        let Some(furniture) = furniture else {
            continue;
        };
        let definition = pack.object(
            world
                .get::<SmartObject>(furniture)
                .ok_or(SaveError::InvalidValue)?
                .0,
        );
        let at = world
            .get::<Position>(furniture)
            .ok_or(SaveError::InvalidValue)?;
        let facing = world
            .get::<terri_core::ObjectFacing>(furniture)
            .map_or(definition.base_facing, |f| f.0);
        let p = world
            .get::<Position>(person)
            .ok_or(SaveError::InvalidValue)?;
        let endpoint = world
            .get::<Path>(person)
            .and_then(|p| p.steps.last().copied())
            .unwrap_or((p.x.round() as i32, p.y.round() as i32));
        let all = direct.is_some_and(|a| a.seat_use == terri_data::SeatUse::All);
        let grid = world.resource::<TileGrid>();
        let origin = (at.x.round() as i32, at.y.round() as i32);
        let mut chosen = if all && legal_contact(grid, definition, facing, origin, None, endpoint) {
            Some(0)
        } else {
            (0..definition.seats.len()).find(|&i| {
                legal_contact(grid, definition, facing, origin, Some(i as u16), endpoint)
            })
        };
        let use_kind = super::claim(world, person.index_u32()).and_then(|lease| kind(world, lease));
        let endpoint_free = |point| {
            use_kind.is_none_or(|kind| {
                endpoint_available(
                    world,
                    EndpointUse {
                        owner: person,
                        endpoint: point,
                        kind,
                    },
                )
            })
        };
        if !endpoint_free(endpoint) {
            chosen = None;
        }
        let mut replacement = None;
        if chosen.is_none() && world.get::<Path>(person).is_some() {
            let from = (p.x.round() as i32, p.y.round() as i32);
            let mut routes = vec![];
            for ordinal in 0..definition.seats.len() {
                for (x, y) in definition
                    .seat_approaches_at(ordinal, facing)
                    .unwrap_or_default()
                {
                    let end = (origin.0 + x, origin.1 + y);
                    if !endpoint_free(end)
                        || !legal_contact(
                            grid,
                            definition,
                            facing,
                            origin,
                            Some(ordinal as u16),
                            end,
                        )
                    {
                        continue;
                    }
                    if let Some(steps) = grid
                        .find_path(from, end)
                        .and_then(|steps| grid.anchor_path((p.x, p.y), steps))
                    {
                        routes.push((steps.len(), ordinal, end, steps));
                    }
                }
            }
            routes.sort_by_key(|r| (r.0, r.1, r.2));
            if let Some((_, ordinal, end, steps)) = routes.into_iter().next() {
                chosen = Some(ordinal);
                replacement = Some((end, steps));
            }
        }
        if let Some((end, steps)) = replacement {
            world.entity_mut(person).insert(Path { steps, cursor: 0 });
            if let Some(mut state) = world.get_resource_mut::<SavedDining>() {
                if let Some(lease) = state
                    .diners
                    .iter_mut()
                    .find(|d| d.person == person.index_u32())
                {
                    lease.endpoint = end;
                }
            }
        }
        if chosen.is_none()
            && world.get::<terri_core::StepWork>(person).is_some()
            && super::claim(world, person.index_u32())
                .is_some_and(|lease| kind(world, lease) == Some(UseKind::Meal))
            && crate::dining::standing_contact(world, target.object, endpoint)
        {
            // A source-valid active meal can continue at its existing table contact.
            // Preserve its timer and food state; only the unusable chair is released.
            let mut state = world.resource_mut::<SavedDining>();
            let lease = state
                .diners
                .iter_mut()
                .find(|d| d.person == person.index_u32())
                .unwrap();
            lease.chair = None;
            lease.setting = None;
            continue;
        }
        if let Some(ordinal) = chosen {
            install(
                world,
                person,
                furniture,
                ordinal as u16,
                direct.is_some_and(|a| a.seat_use == terri_data::SeatUse::All),
            );
            let invalid_media = super::claim(world, person.index_u32()).is_some_and(|d| {
                kind(world, d) == Some(UseKind::Media) && !crate::media::valid_lease(world, d)
            });
            if !invalid_media {
                continue;
            }
        }
        {
            // An incompatible travelling meal retries from its retained programme.
            // Food, chain progress and queued orders are not discarded with the route.
            crate::reservations::release_now(world, person, target);
            world
                .entity_mut(person)
                .remove::<Target>()
                .remove::<Path>()
                .remove::<Eating>()
                .remove::<terri_core::StepWork>();
        }
    }
    Ok(())
}

pub(crate) fn hash(world: &World, hash: &mut terri_core::FnvHasher) {
    let claims = capture(world);
    if claims.is_empty() {
        return;
    }
    hash.write_bytes(b"physical-seats-v1");
    hash.write_u64(claims.len() as u64);
    for c in claims {
        hash.write_u64(c.person.into());
        hash.write_u64(c.furniture.into());
        hash.write_u64(c.target.into());
        hash.write_u64(c.all.into());
        for text in [&c.seat, &c.action] {
            hash.write_u64(text.len() as u64);
            hash.write_bytes(text.as_bytes());
        }
    }
}
