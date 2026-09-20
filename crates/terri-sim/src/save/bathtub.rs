//! The reviewed 2x1-to-1x2 bathtub transition, separate from digest acceptance.

use super::{validate_snapshot, SaveError};
use std::collections::{BTreeMap, VecDeque};
use terri_core::{Footprint, SaveSnapshotV1, SavedEntity, SavedPath, SavedPosition, TileGrid};
use terri_data::ContentPack;

pub(super) mod source_layout;

#[cfg(test)]
mod mutation_tests;

const SOURCE_FINGERPRINT: u64 = 0xa020_602a_6acd_3a90;
const REVIEWED_DESTINATION_FINGERPRINTS: [u64; 3] = [
    0xbcdd_476e_1e23_8ab0,
    0xfdf5_87d9_437f_bfd0,
    0x4dab_6950_757c_1f15,
];
const OLD: Footprint = Footprint { width: 2, depth: 1 };
const NEW: Footprint = Footprint { width: 1, depth: 2 };
type Tile = (i32, i32);

pub(super) fn prepare(
    mut snapshot: SaveSnapshotV1,
    destination: &ContentPack,
) -> Result<(SaveSnapshotV1, bool), SaveError> {
    if terri_data::content_fingerprint_matches(destination, snapshot.content_fingerprint) {
        validate_snapshot(&snapshot, destination)?;
        let rename =
            terri_data::content_fingerprint_is_legacy(destination, snapshot.content_fingerprint);
        return Ok((snapshot, rename));
    }

    let source = reviewed_source(destination).ok_or(SaveError::IncompatibleContent)?;
    // Keep the original digest during source validation. It owns the legacy
    // name rules and the restrictions on formerly inert interaction rows.
    validate_snapshot(&snapshot, &source)?;
    for (index, _) in &snapshot.sleep_pressure {
        super::validate_entity_reference(&snapshot.entities, *index)?;
    }
    let rename = terri_data::content_fingerprint_is_legacy(&source, snapshot.content_fingerprint);
    rotate_world(&mut snapshot, &source, destination)?;
    snapshot.content_fingerprint = terri_data::content_fingerprint(destination);
    validate_snapshot(&snapshot, destination)?;
    Ok((snapshot, rename))
}

pub(super) fn reviewed_source(destination: &ContentPack) -> Option<ContentPack> {
    if !REVIEWED_DESTINATION_FINGERPRINTS.contains(&terri_data::content_fingerprint(destination)) {
        return None;
    }
    let bathtub = destination.find("bathtub")?;
    if destination.object(bathtub).footprint != NEW {
        return None;
    }
    let mut source = destination.clone();
    source.objects[bathtub.0 as usize].footprint = OLD;
    source.objects[bathtub.0 as usize].base_facing = terri_core::Facing::SouthEast;
    source.portals.clear();
    terri_data::content_fingerprint_matches(&source, SOURCE_FINGERPRINT).then_some(source)
}

fn rotate_world(
    snapshot: &mut SaveSnapshotV1,
    source: &ContentPack,
    destination: &ContentPack,
) -> Result<(), SaveError> {
    let old_grid = grid(snapshot);
    let tubs = bathtub_origins(snapshot)?;
    source_layout::validate(snapshot, source)?;
    validate_source_paths(snapshot, &old_grid)?;
    let width = snapshot.grid_width as usize;
    for &(x, y) in tubs.values() {
        snapshot.blocked_tiles[y as usize * width + x as usize + 1] = false;
        snapshot.blocked_tiles[(y as usize + 1) * width + x as usize] = true;
    }
    let new_grid = grid(snapshot);
    let original_entities = snapshot.entities.clone();
    let social_contacts = social_contacts(&original_entities)?;
    for entity in snapshot.entities.iter_mut().filter(|e| e.agent) {
        repair_agent(
            entity,
            &original_entities,
            &old_grid,
            &new_grid,
            &tubs,
            &social_contacts,
            destination,
        )?;
    }
    // A relocated social target changes where an approaching partner must go.
    // Repath those walkers only after every position has its final value.
    let migrated_entities = snapshot.entities.clone();
    for entity in snapshot
        .entities
        .iter_mut()
        .filter(|e| e.agent && e.path.is_some())
    {
        if let Some(target) = entity.target {
            let old = lookup(&original_entities, target.object)?;
            let new = lookup(&migrated_entities, target.object)?;
            if old.position != new.position {
                rebuild_path(entity, &migrated_entities, &new_grid, destination)?;
            }
        }
    }
    Ok(())
}

fn validate_source_paths(snapshot: &SaveSnapshotV1, grid: &TileGrid) -> Result<(), SaveError> {
    for path in snapshot
        .entities
        .iter()
        .filter_map(|entity| entity.path.as_ref())
    {
        let remaining = &path.steps[path.cursor as usize..];
        if remaining.iter().any(|&(x, y)| !grid.is_walkable(x, y)) {
            return Err(SaveError::InvalidGrid);
        }
        if remaining
            .windows(2)
            .any(|pair| pair[0].0.abs_diff(pair[1].0) + pair[0].1.abs_diff(pair[1].1) > 1)
        {
            return Err(SaveError::InvalidGrid);
        }
    }
    Ok(())
}

fn bathtub_origins(snapshot: &SaveSnapshotV1) -> Result<BTreeMap<u32, Tile>, SaveError> {
    snapshot
        .entities
        .iter()
        .filter(|e| e.smart_object.as_deref() == Some("bathtub"))
        .map(|e| Ok((e.index, object_tile(e, snapshot)?)))
        .collect()
}

fn object_tile(entity: &SavedEntity, snapshot: &SaveSnapshotV1) -> Result<Tile, SaveError> {
    let p = entity.position.ok_or(SaveError::InvalidGrid)?;
    if p.x < 0.0
        || p.y < 0.0
        || p.x >= snapshot.grid_width as f32
        || p.y >= snapshot.grid_height as f32
    {
        return Err(SaveError::InvalidGrid);
    }
    Ok((p.x as i32, p.y as i32))
}

fn repair_agent(
    entity: &mut SavedEntity,
    entities: &[SavedEntity],
    old: &TileGrid,
    new: &TileGrid,
    tubs: &BTreeMap<u32, Tile>,
    social_contacts: &BTreeMap<u32, Vec<Tile>>,
    pack: &ContentPack,
) -> Result<(), SaveError> {
    let Some(position) = entity.position else {
        return Ok(());
    };
    let start = tile(position);
    let newly_blocked = old.is_walkable(start.0, start.1) && !new.is_walkable(start.0, start.1);
    let active_tub = entity
        .target
        .and_then(|target| tubs.get(&target.object))
        .copied()
        .filter(|_| {
            entity
                .eating
                .as_ref()
                .is_some_and(|e| e.object == "bathtub")
        });
    let wrong_side = active_tub.is_some_and(|origin| !beside_rotated_tub(start, origin));
    let invalid_path = entity.path.as_ref().is_some_and(|path| {
        path.steps[path.cursor as usize..]
            .iter()
            .any(|&(x, y)| !new.is_walkable(x, y))
    });
    let crossing_segment = entity.path.as_ref().is_some_and(|path| {
        path.steps.get(path.cursor as usize).is_some_and(|&next| {
            tubs.values()
                .any(|&(x, y)| segment_crosses_cell(position, next, (x, y + 1)))
        })
    });
    let tub_path = entity.path.as_ref().is_some_and(|path| {
        entity
            .target
            .and_then(|target| tubs.get(&target.object))
            .is_some_and(|&origin| {
                !beside_rotated_tub(path.steps.last().copied().unwrap_or(start), origin)
            })
    });
    if newly_blocked {
        let partners = social_contacts
            .get(&entity.index)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        // A pair with both people swallowed requires a separate joint-layout
        // migration. Reject that custom layout without changing either person.
        if partners.iter().any(|&(x, y)| !new.is_walkable(x, y)) {
            return Err(SaveError::InvalidGrid);
        }
        let active_object = if entity.eating.is_some() || entity.step_work_ticks.is_some() {
            let target = entity.target.ok_or(SaveError::InvalidEntityReference)?;
            let object = lookup(entities, target.object)?;
            let origin = tile(object.position.ok_or(SaveError::InvalidGrid)?);
            let id = object
                .smart_object
                .as_deref()
                .and_then(|id| pack.find(id))
                .ok_or(SaveError::InvalidContentReference)?;
            Some((origin, pack.object(id).footprint))
        } else {
            None
        };
        let safe = nearest_retained_tile(old, new, start, |candidate| {
            partners
                .iter()
                .all(|&partner| beside(candidate, partner, Footprint::SINGLE))
                && active_object
                    .is_none_or(|(origin, footprint)| beside(candidate, origin, footprint))
        })
        .ok_or(SaveError::InvalidGrid)?;
        entity.position = Some(position_at(safe));
    }
    if wrong_side || (newly_blocked && active_tub.is_some()) {
        let from = tile(entity.position.unwrap());
        let route = new
            .find_path_adjacent(from, active_tub.unwrap(), NEW)
            .ok_or(SaveError::InvalidGrid)?;
        entity.position = Some(position_at(route.last().copied().unwrap_or(from)));
    }
    if entity.path.is_some()
        && (newly_blocked || wrong_side || invalid_path || crossing_segment || tub_path)
    {
        rebuild_path(entity, entities, new, pack)?;
    }
    Ok(())
}

fn segment_crosses_cell(from: SavedPosition, to: Tile, cell: Tile) -> bool {
    // Waypoints are tile centers. Retargeting rounds the current position,
    // so the first segment can cross a cell absent from the waypoint list.
    // Clip against the centered half-open tile on each of the two axes.
    // f64 keeps subtraction finite for every validated f32 position.
    let mut enter = 0.0_f64;
    let mut leave = 1.0_f64;
    for (start, end, center) in [
        (f64::from(from.x), f64::from(to.0), f64::from(cell.0)),
        (f64::from(from.y), f64::from(to.1), f64::from(cell.1)),
    ] {
        let low = center - 0.5;
        let high = center + 0.5;
        let delta = end - start;
        if delta == 0.0 {
            if start < low || start >= high {
                return false;
            }
        } else {
            let first = (low - start) / delta;
            let last = (high - start) / delta;
            enter = enter.max(first.min(last));
            leave = leave.min(first.max(last));
        }
    }
    enter < leave
}

fn rebuild_path(
    entity: &mut SavedEntity,
    entities: &[SavedEntity],
    grid: &TileGrid,
    pack: &ContentPack,
) -> Result<(), SaveError> {
    let position = entity.position.ok_or(SaveError::InvalidGrid)?;
    let from = tile(position);
    let mut steps = if let Some(target) = entity.target {
        let target = lookup(entities, target.object)?;
        let to = tile(target.position.ok_or(SaveError::InvalidGrid)?);
        let footprint = target
            .smart_object
            .as_deref()
            .map(|id| {
                pack.object(pack.find(id).expect("source validation resolved object"))
                    .footprint
            })
            .unwrap_or(Footprint::SINGLE);
        grid.find_path_adjacent(from, to, footprint)
    } else {
        let to = entity
            .path
            .as_ref()
            .and_then(|p| p.steps.last())
            .copied()
            .unwrap_or(from);
        // A wander destination swallowed by the tub stops at a reachable
        // neighbor. A commute must retain its exact front-door destination.
        if grid.is_walkable(to.0, to.1) {
            grid.find_path(from, to)
        } else if entity.commuting {
            None
        } else {
            grid.find_path_adjacent_to_tile(from, to)
        }
    }
    .ok_or(SaveError::InvalidGrid)?;
    // Start fractional walkers by returning to their current walkable cell;
    // otherwise a new orthogonal route can cut diagonally through the tub.
    if position != position_at(from) {
        steps.insert(0, from);
    }
    entity.path = Some(SavedPath { steps, cursor: 0 });
    Ok(())
}

fn nearest_retained_tile(
    old: &TileGrid,
    new: &TileGrid,
    start: Tile,
    accept: impl Fn(Tile) -> bool,
) -> Option<Tile> {
    let mut visited = vec![false; old.width() * old.height()];
    let mut pending = VecDeque::from([start]);
    visited[start.1 as usize * old.width() + start.0 as usize] = true;
    for _ in 0..visited.len() {
        let current = pending.pop_front()?;
        if new.is_walkable(current.0, current.1) && accept(current) {
            return Some(current);
        }
        for next in [
            (current.0, current.1 - 1),
            (current.0 + 1, current.1),
            (current.0, current.1 + 1),
            (current.0 - 1, current.1),
        ] {
            if old.is_walkable(next.0, next.1) || new.is_walkable(next.0, next.1) {
                let index = next.1 as usize * old.width() + next.0 as usize;
                if !visited[index] {
                    visited[index] = true;
                    pending.push_back(next);
                }
            }
        }
    }
    None
}

fn lookup(entities: &[SavedEntity], index: u32) -> Result<&SavedEntity, SaveError> {
    entities
        .binary_search_by_key(&index, |e| e.index)
        .map(|i| &entities[i])
        .map_err(|_| SaveError::InvalidEntityReference)
}

fn tile(position: SavedPosition) -> Tile {
    (position.x.floor() as i32, position.y.floor() as i32)
}

fn beside_rotated_tub(tile: Tile, origin: Tile) -> bool {
    beside(tile, origin, NEW)
}

fn beside(tile: Tile, origin: Tile, footprint: Footprint) -> bool {
    tile.0.abs_diff(
        tile.0
            .clamp(origin.0, origin.0 + footprint.width as i32 - 1),
    ) + tile.1.abs_diff(
        tile.1
            .clamp(origin.1, origin.1 + footprint.depth as i32 - 1),
    ) == 1
}

fn social_contacts(entities: &[SavedEntity]) -> Result<BTreeMap<u32, Vec<Tile>>, SaveError> {
    let mut contacts = BTreeMap::<u32, Vec<Tile>>::new();
    for initiator in entities
        .iter()
        .filter(|entity| entity.socialising.is_some())
    {
        let partner = lookup(entities, initiator.socialising.unwrap().partner)?;
        let initiator_at = tile(initiator.position.ok_or(SaveError::InvalidGrid)?);
        let partner_at = tile(partner.position.ok_or(SaveError::InvalidGrid)?);
        contacts
            .entry(initiator.index)
            .or_default()
            .push(partner_at);
        contacts
            .entry(partner.index)
            .or_default()
            .push(initiator_at);
    }
    Ok(contacts)
}
fn position_at(tile: Tile) -> SavedPosition {
    SavedPosition {
        x: tile.0 as f32,
        y: tile.1 as f32,
    }
}

fn grid(snapshot: &SaveSnapshotV1) -> TileGrid {
    let mut grid = TileGrid::new(snapshot.grid_width as usize, snapshot.grid_height as usize);
    for (index, &blocked) in snapshot.blocked_tiles.iter().enumerate() {
        grid.set_blocked(index % grid.width(), index / grid.width(), blocked);
    }
    grid
}
