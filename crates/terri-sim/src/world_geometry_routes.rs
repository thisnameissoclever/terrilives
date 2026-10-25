//! Replan a walk without choosing a different activity, object or physical owner.
use super::*;
use crate::seating::{EndpointUse, PhysicalClaim, UseKind};
use terri_core::{save_v6::ReadingStage, ObjectFacing, Path, SleepPlace, Target};
type Tile = (i32, i32);

fn object(
    world: &World,
    entity: Entity,
) -> Option<(
    Position,
    &'static terri_data::CompiledObject,
    terri_core::Facing,
)> {
    let position = *world.get::<Position>(entity)?;
    let id = world.get::<SmartObject>(entity)?.0;
    let definition = world
        .resource::<crate::Content>()
        .0
        .objects
        .get(id.0 as usize)?;
    Some((
        position,
        definition,
        world
            .get::<ObjectFacing>(entity)
            .map_or(definition.base_facing, |f| f.0),
    ))
}
fn origin(position: Position) -> Tile {
    (position.x.round() as i32, position.y.round() as i32)
}
fn perimeter(world: &World, entity: Entity) -> BTreeSet<Tile> {
    let Some((position, definition, facing)) = object(world, entity) else {
        return BTreeSet::new();
    };
    let (x, y) = origin(position);
    let fp = definition.footprint_at(facing);
    let (Some(right), Some(bottom)) = (
        x.checked_add(fp.width as i32),
        y.checked_add(fp.depth as i32),
    ) else {
        return BTreeSet::new();
    };
    if x < 0
        || y < 0
        || right as usize > world.resource::<TileGrid>().width()
        || bottom as usize > world.resource::<TileGrid>().height()
    {
        return BTreeSet::new();
    }
    (x..right)
        .flat_map(|x| [(x, y - 1), (x, bottom)])
        .chain((y..bottom).flat_map(|y| [(x - 1, y), (right, y)]))
        .collect()
}
fn free_endpoint(world: &World, actor: Entity, endpoint: Tile, kind: UseKind) -> bool {
    crate::seating::endpoint_available(
        world,
        EndpointUse {
            owner: actor,
            endpoint,
            kind,
        },
    )
}
fn seat_contacts(world: &World, claim: &PhysicalClaim) -> BTreeSet<Tile> {
    let Some((at, def, facing)) = object(world, claim.furniture) else {
        return BTreeSet::new();
    };
    let ordinal = if claim.all {
        None
    } else {
        let Some(n) = crate::seating::ordinal(world, claim) else {
            return BTreeSet::new();
        };
        Some(n)
    };
    perimeter(world, claim.furniture)
        .into_iter()
        .filter(|&endpoint| {
            crate::seating::legal_contact(
                world.resource::<TileGrid>(),
                def,
                facing,
                origin(at),
                ordinal,
                endpoint,
            )
        })
        .collect()
}
fn sleep_contacts(
    world: &World,
    _actor: Entity,
    target: Target,
    place: SleepPlace,
) -> BTreeSet<Tile> {
    let Some((at, def, facing)) = object(world, target.object) else {
        return BTreeSet::new();
    };
    let pack = world.resource::<crate::Content>().0;
    let fp = def.footprint_at(facing);
    let at = origin(at);
    let grid = world.resource::<TileGrid>();
    let Some(offsets) = def.sleep_approaches_at(place.0, facing) else {
        return if def.sleep_capacity(&pack.sleep_tag) == 1 && def.sleep_places.is_empty() {
            perimeter(world, target.object)
                .into_iter()
                .filter(|&end| grid.can_interact_with_rect(end, at, fp))
                .collect()
        } else {
            BTreeSet::new()
        };
    };
    offsets
        .into_iter()
        .filter_map(|offset| crate::seating::contact_offset(at, offset).map(|end| (offset, end)))
        .filter(|&((x, y), end)| {
            grid.can_interact_with_rect(
                end,
                (
                    at.0 + x.clamp(0, fp.width as i32 - 1),
                    at.1 + y.clamp(0, fp.depth as i32 - 1),
                ),
                terri_core::Footprint::SINGLE,
            )
        })
        .map(|(_, end)| end)
        .collect()
}
fn lease_contact(world: &World, lease: &terri_core::save::SavedDiner, end: Tile) -> bool {
    let Some(kind) = crate::seating::kind(world, lease) else {
        return false;
    };
    let Some(actor) = crate::dining::entity(world, lease.person) else {
        return false;
    };
    if !free_endpoint(world, actor, end, kind) {
        return false;
    }
    if kind == UseKind::Media {
        let mut proposed = lease.clone();
        proposed.endpoint = end;
        return crate::media::valid_lease_geometry(world, &proposed);
    }
    if let Some(chair) = lease.chair.and_then(|id| crate::dining::entity(world, id)) {
        crate::dining::chair_contact(world, chair, end)
    } else {
        crate::dining::entity(world, lease.station)
            .is_some_and(|station| crate::dining::standing_contact(world, station, end))
    }
}
fn reading_destination_valid(
    world: &World,
    actor: Entity,
    j: &crate::reading::ReadingJourney,
    end: Tile,
) -> bool {
    if let Some((seat, name)) = &j.seat {
        world
            .get::<PhysicalClaim>(actor)
            .filter(|claim| claim.furniture == *seat && claim.seat == *name)
            .is_some_and(|claim| seat_contacts(world, claim).contains(&end))
            && free_endpoint(world, actor, end, UseKind::Media)
    } else {
        world.resource::<TileGrid>().is_walkable(end.0, end.1)
            && !crate::reading::shelf_contact_tile(world, end)
            && free_endpoint(world, actor, end, UseKind::Standing)
    }
}
fn shelf_contacts(world: &World, actor: Entity, shelf: Entity) -> BTreeSet<Tile> {
    perimeter(world, shelf)
        .into_iter()
        .filter(|&end| {
            crate::reading::legal_shelf_contact(world, world.resource::<TileGrid>(), shelf, end)
                && free_endpoint(world, actor, end, UseKind::ShelfTransfer)
        })
        .collect()
}
fn reading_destinations(
    world: &World,
    actor: Entity,
    j: &crate::reading::ReadingJourney,
) -> BTreeSet<Tile> {
    if j.seat.is_some() {
        return world
            .get::<PhysicalClaim>(actor)
            .map(|claim| seat_contacts(world, claim))
            .unwrap_or_default()
            .into_iter()
            .filter(|&end| reading_destination_valid(world, actor, j, end))
            .collect();
    }
    // Standing reading keeps the owned shelf and uses the same one-step-away
    // destinations as reading admission, never a generic point elsewhere.
    shelf_contacts(world, actor, j.shelf)
        .into_iter()
        .flat_map(|(x, y)| [(x - 1, y), (x, y - 1), (x, y + 1), (x + 1, y)])
        .filter(|&end| reading_destination_valid(world, actor, j, end))
        .collect()
}
fn choose(
    world: &World,
    actor: Entity,
    old: Option<Tile>,
    targets: &BTreeSet<Tile>,
) -> Option<Vec<Tile>> {
    let position = *world.get::<Position>(actor)?;
    let grid = world.resource::<TileGrid>();
    if let Some(old) = old.filter(|end| targets.contains(end)) {
        if let Some(path) = grid
            .find_path(origin(position), old)
            .and_then(|steps| grid.anchor_path((position.x, position.y), steps))
        {
            return Some(path);
        }
    }
    super::shortest_route(grid, position, targets)
}
fn endpoint(world: &World, actor: Entity, path: &[Tile]) -> Option<Tile> {
    path.last()
        .copied()
        .or_else(|| world.get::<Position>(actor).copied().map(origin))
}

pub(super) fn endpoint_valid(world: &World, actor: Entity, end: Tile) -> bool {
    if let Some(j) = world.get::<crate::reading::ReadingJourney>(actor) {
        let returning = matches!(
            j.stage,
            ReadingStage::Return | ReadingStage::Shelve | ReadingStage::WaitingReturn
        );
        if !returning && !reading_destination_valid(world, actor, j, j.destination) {
            return false;
        }
        return match j.stage {
            ReadingStage::Fetch
            | ReadingStage::Pickup
            | ReadingStage::Return
            | ReadingStage::Shelve => {
                j.transfer_contact == Some(end)
                    && shelf_contacts(world, actor, j.shelf).contains(&end)
            }
            ReadingStage::Travel | ReadingStage::Read => {
                j.destination == end && reading_destination_valid(world, actor, j, end)
            }
            ReadingStage::WaitingReturn => false,
        };
    }
    if let Some(lease) = crate::seating::claim(world, actor.index_u32()) {
        return lease.endpoint == end && lease_contact(world, lease, end);
    }
    let Some(target) = world.get::<Target>(actor).copied() else {
        return true;
    };
    if let Some(place) = world.get::<SleepPlace>(actor) {
        let Some((at, def, facing)) = object(world, target.object) else {
            return false;
        };
        // Historical whole-bed walks keep a physically valid old-side contact.
        // Authored slot approaches govern new/replacement routes in replan,
        // not whether an already admitted walk needs to change.
        let pack = world.resource::<crate::Content>().0;
        return place.0 < def.sleep_capacity(&pack.sleep_tag)
            && world.resource::<TileGrid>().can_interact_with_rect(
                end,
                origin(at),
                def.footprint_at(facing),
            );
    }
    if let Some(claim) = world.get::<PhysicalClaim>(actor) {
        return seat_contacts(world, claim).contains(&end);
    }
    let Some((at, def, facing)) = object(world, target.object) else {
        return true;
    };
    if def.interactions.get(target.interaction as usize).is_some_and(crate::pool::is_swimming) {
        return end==crate::pool::approach(origin(at),facing)
            && world.resource::<TileGrid>().can_interact_with_rect(end,origin(at),def.footprint_at(facing));
    }
    let model = world.get::<SmartObject>(target.object).unwrap().0;
    if crate::seating::media_activity(
        world.resource::<crate::Content>().0,
        model,
        target.interaction,
    )
    .is_some()
    {
        return crate::media::valid_standing_contact(
            world,
            actor.index_u32(),
            target.object.index_u32(),
            end,
        );
    }

    world
        .resource::<TileGrid>()
        .can_interact_with_rect(end, origin(at), def.footprint_at(facing))
        || crate::media::valid_standing_contact(
            world,
            actor.index_u32(),
            target.object.index_u32(),
            end,
        )
        || crate::media::valid_work_contact(
            world,
            actor.index_u32(),
            target.object.index_u32(),
            end,
        )
}

/// Metadata is changed only after a legal replacement path has been found.
pub(super) fn replan(world: &mut World, actor: Entity) -> Option<Vec<Tile>> {
    let old = world.get::<Path>(actor)?.steps.last().copied();
    if let Some(mut j) = world.get::<crate::reading::ReadingJourney>(actor).cloned() {
        let returning = matches!(
            j.stage,
            ReadingStage::Return | ReadingStage::Shelve | ReadingStage::WaitingReturn
        );
        if !returning
            && (!reading_destination_valid(world, actor, &j, j.destination)
                || j.stage == ReadingStage::Travel)
        {
            let mut destinations = reading_destinations(world, actor, &j);
            if reading_destination_valid(world, actor, &j, j.destination) {
                destinations.insert(j.destination);
            }
            let route = choose(world, actor, Some(j.destination), &destinations)?;
            j.destination = endpoint(world, actor, &route)?;
        }
        let targets = match j.stage {
            ReadingStage::Fetch | ReadingStage::Return => shelf_contacts(world, actor, j.shelf),
            ReadingStage::Travel => BTreeSet::from([j.destination]),
            _ => return None,
        };
        let path = choose(world, actor, old, &targets)?;
        if matches!(j.stage, ReadingStage::Fetch | ReadingStage::Return) {
            j.transfer_contact = Some(endpoint(world, actor, &path)?);
        }
        world.entity_mut(actor).insert(j);
        return Some(path);
    }
    if let Some(lease) = crate::seating::claim(world, actor.index_u32()).cloned() {
        let furniture = crate::dining::entity(world, lease.chair.unwrap_or(lease.station))?;
        let targets = perimeter(world, furniture)
            .into_iter()
            .filter(|&end| lease_contact(world, &lease, end))
            .collect();
        let path = choose(world, actor, old, &targets)?;
        let end = endpoint(world, actor, &path)?;
        world
            .resource_mut::<terri_core::save::SavedDining>()
            .diners
            .iter_mut()
            .find(|row| row.person == actor.index_u32())?
            .endpoint = end;
        return Some(path);
    }
    let Some(target) = world.get::<Target>(actor).copied() else {
        return choose(world, actor, old, &old.into_iter().collect());
    };
    if target.interaction == crate::systems::chain::CHAIN_STEP {
        let chain = world.get::<terri_core::ChainState>(actor)?;
        let pack = world.resource::<crate::Content>().0;
        let step = pack
            .chains
            .get(chain.chain as usize)?
            .steps
            .get(chain.step as usize)?;
        return crate::systems::chain::station_path(
            world.resource::<TileGrid>(),
            pack,
            step,
            world.get::<Position>(actor)?,
            world.get::<Position>(target.object)?,
            world.get::<SmartObject>(target.object)?,
            world.get::<ObjectFacing>(target.object),
        );
    }
    if let Some((at,def,facing))=object(world,target.object) {
        if def.interactions.get(target.interaction as usize).is_some_and(crate::pool::is_swimming) {
            let end=crate::pool::approach(origin(at),facing);
            let grid=world.resource::<TileGrid>();
            if !grid.can_interact_with_rect(end,origin(at),def.footprint_at(facing)) { return None; }
            let position=*world.get::<Position>(actor)?;
            let route=crate::beds::navigation::Route::Exact(end);
            let path=route.path(grid,origin(position)).and_then(|steps|route.bind_path(grid,(position.x,position.y),steps))?;
            if let Some(mut episode)=world.get_mut::<crate::pool::PoolEpisode>(actor) {
                if episode.pool!=target.object||episode.phase>0 { return None; }
                episode.approach=end;
            }
            return Some(path);
        }
    }
    let targets = if let Some(place) = world.get::<SleepPlace>(actor) {
        sleep_contacts(world, actor, target, *place)
    } else if let Some(claim) = world.get::<PhysicalClaim>(actor) {
        seat_contacts(world, claim)
    } else if let Some((at, def, facing)) = object(world, target.object) {
        let model = world.get::<SmartObject>(target.object).unwrap().0;
        if crate::seating::media_activity(
            world.resource::<crate::Content>().0,
            model,
            target.interaction,
        )
        .is_some()
        {
            crate::media::standing_approaches(world, actor, target.object)
                .into_iter()
                .collect()
        } else {
            perimeter(world, target.object)
                .into_iter()
                .filter(|&end| {
                    world.resource::<TileGrid>().can_interact_with_rect(
                        end,
                        origin(at),
                        def.footprint_at(facing),
                    )
                })
                .collect()
        }
    } else {
        old.into_iter().collect()
    };
    choose(world, actor, old, &targets)
}
