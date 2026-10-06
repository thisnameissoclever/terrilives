//! Saved architecture validation after restoring the world's object directions.

use super::{SaveError, Sim};
use crate::portals::ActivePortals;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{
    layout::SavedLayout, Colourway, Facing, SaveSnapshotV2, SaveSnapshotV3, SaveSnapshotV4,
    SaveSnapshotV5, SmartObject, TileGrid,
};
use terri_data::ContentPack;

#[cfg(test)]
#[path = "architecture_boundary_tests.rs"]
mod boundary_tests;

pub(crate) fn restore(
    snapshot: SaveSnapshotV2,
    content: &'static ContentPack,
    active_portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    // V2 carries complete architecture: do not apply V1's optional-tail repair or
    // reinterpret a saved layout from whatever lot content now happens to be.
    super::meal_migration::validate_source(&snapshot.world, content)?;
    let candidate = super::restore_legacy(snapshot.world, content, active_portals)?;
    finish_restore(candidate, snapshot.layout, content, None)
}

pub(crate) fn restore_v3(
    snapshot: SaveSnapshotV3,
    content: &'static ContentPack,
    active_portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    restore_v4(
        SaveSnapshotV4 {
            world: snapshot.world,
            layout: snapshot.layout,
            object_facings: snapshot.object_facings,
            retired_indices: Vec::new(),
        },
        content,
        active_portals,
    )
}

/// [RC-save] in `docs/specs/2026-09-22-colourways.md`: the V4 envelope's
/// checks, then each saved colourway ascending by entity index, naming a
/// placed object in the candidate. An id the content no longer has, or one
/// that now names the first colourway, loads as drawn, so retiring or
/// renaming a colourway id keeps every save loading. The
/// candidate is discarded on any failure, so the running world is untouched.
pub(crate) fn restore_v5(
    snapshot: SaveSnapshotV5,
    content: &'static ContentPack,
    active_portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    restore_v5_seats(snapshot, content, active_portals, None)
}

pub(crate) fn restore_v5_seats(
    snapshot: SaveSnapshotV5,
    content: &'static ContentPack,
    active_portals: Option<ActivePortals>,
    seats: Option<&[terri_core::save_v6::SavedPhysicalSeat]>,
) -> Result<Sim, SaveError> {
    let SaveSnapshotV5 {
        world,
        layout,
        object_facings,
        retired_indices,
        object_colourways,
        floors,
        family_by_index,
        family,
        mortality,
        death_default_applied,
        waiting_needs,
        self_preservation,
        chronotype_offsets,
        domestic,
        sleeping_places,
        shyness,
        boundaries,
        mut dining,
        skills,
        targeted_cleanup,
        chores,
        grime,
        affinities,
    } = snapshot;
    if object_colourways
        .windows(2)
        .any(|pair| pair[0].0 >= pair[1].0)
    {
        return Err(SaveError::InvalidValue);
    }
    let mut candidate = restore_v4_with_dining(
        SaveSnapshotV4 {
            world,
            layout,
            object_facings,
            retired_indices,
        },
        content,
        active_portals,
        dining.as_ref(),
        seats,
    )?;
    let cap = content.tuning.max_queued_intents as usize;
    if cap > 0
        && candidate
            .world
            .try_query::<&terri_core::IntentQueue>()
            .is_some_and(|mut query| {
                query
                    .iter(&candidate.world)
                    .any(|queue| super::exceeds_limit(queue.len(), cap))
            })
    {
        return Err(SaveError::InvalidValue);
    }
    if seats.is_none() && !terri_data::is_pre_books_pack(content) {
        dining = candidate
            .world
            .get_resource::<terri_core::save::SavedDining>()
            .cloned()
            .or(dining);
    }
    for (index, id) in object_colourways {
        // The first colourway is the art as drawn, which is how an unknown
        // id loads too, so both simply leave the object as drawn.
        let colourway = content
            .colourways
            .iter()
            .position(|known| known.id == id)
            .filter(|&colourway| colourway > 0);
        let entity = bevy_ecs::entity::EntityIndex::from_raw_u32(index)
            .map(|index| candidate.world.entities().resolve_from_index(index))
            .filter(|&entity| {
                candidate
                    .world
                    .get_entity(entity)
                    .is_ok_and(|object| object.contains::<SmartObject>())
            })
            .ok_or(SaveError::InvalidValue)?;
        if let Some(colourway) = colourway {
            candidate
                .world
                .entity_mut(entity)
                .insert(Colourway(colourway as u32));
        }
    }
    // [FL-save]: the painted tiles. An entry off the lot, out of order or
    // repeated is a corrupt save and refuses the whole load. An entry naming
    // a covering the content no longer has is not corrupt, it is a content
    // edit, so that tile loses its covering and the rest of the house loads,
    // exactly as an unknown colourway leaves its object as drawn. Refusing
    // the save instead would let one line removed from lot.toml make every
    // save that used it unloadable.
    let grid = candidate.world.resource::<TileGrid>();
    let coverings = content.coverings.len();
    let (width, height) = (grid.width() as u32, grid.height() as u32);
    let known: Vec<(u32, u32, u8)> = floors
        .tiles()
        .iter()
        .copied()
        .filter(|&(_, _, covering)| covering as usize <= coverings)
        .collect();
    let floors = terri_core::layout::SavedFloors::from_saved(known, width, height, coverings)
        .ok_or(SaveError::InvalidValue)?;
    candidate.world.insert_resource(floors);
    // [FM-save]: the ties, refused whole when one names somebody this world
    // never had. A save written before ties existed carries none. One
    // written by the first build with ties carries them keyed on entity
    // index ([FM-identity]), which the rebuilt world turns into SimIds. No
    // build writes both lists, so a save that has both was not written by
    // one.
    let family = match (family_by_index.ties().is_empty(), family.ties().is_empty()) {
        (false, false) => None,
        (false, true) => crate::family::from_index_ties(&candidate.world, &family_by_index),
        (true, _) => {
            let known = |id: u32| crate::family::was_issued(&candidate.world, id);
            terri_core::layout::FamilyTies::from_saved(family.ties().to_vec(), &known)
        }
    }
    .ok_or(SaveError::InvalidValue)?;
    candidate.world.insert_resource(family);
    crate::mortality::restore(&mut candidate.world, mortality)?;
    crate::waiting::restore(&mut candidate.world, waiting_needs)?;
    super::self_preservation::restore(&mut candidate.world, self_preservation)?;
    super::chronotype::restore(&mut candidate.world, chronotype_offsets)?;
    // [SK-save]: a present field installs every person's practice; a
    // missing one seeds it once from the worn capabilities' saved states.
    super::skills::restore(&mut candidate.world, content, skills)?;
    // [OA-values]: a present field installs every person's values; a
    // missing one draws them once from the saved world generator.
    super::affinities::restore(&mut candidate.world, content, affinities)?;
    // Domestic validation needs exact standing claims for table-free meals.
    if let Some(state) = &dining {
        candidate.world.insert_resource(state.clone());
    }
    let original_cleanup = targeted_cleanup.clone();
    let mut rebased_cleanup = targeted_cleanup;
    if let (Some(cleanup), Some(chores)) = (&mut rebased_cleanup, &chores) {
        for order in &mut cleanup.orders {
            if let Some(position) = order.queue_position {
                let before = chores
                    .orders
                    .iter()
                    .filter(|o| o.person == order.person && o.queue_position < position)
                    .count() as u32;
                order.queue_position = Some(
                    position
                        .checked_sub(before)
                        .ok_or(SaveError::InvalidValue)?,
                );
            }
        }
    }
    crate::targeted_cleanup::restore(&mut candidate.world, rebased_cleanup)?;
    crate::domestic::restore(&mut candidate.world, domestic)?;
    match sleeping_places {
        Some(saved) => super::sleeping_places::restore(&mut candidate.world, saved)?,
        None => super::sleeping_places::migrate_legacy(&mut candidate.world)?,
    }
    crate::shyness::restore(&mut candidate.world, shyness)?;
    crate::privacy::restore(&mut candidate.world, boundaries)?;
    crate::dining::restore(&mut candidate.world, dining)?;
    crate::targeted_cleanup::validate_claims(&candidate.world)?;
    crate::targeted_cleanup::validate_legacy_capacity(&candidate.world)?;
    crate::targeted_cleanup::split_legacy_piles(&mut candidate.world);
    crate::chores::restore(&mut candidate.world, chores)?;
    crate::chores::grime::restore(&mut candidate.world, grime)?;
    if let Some(original) = original_cleanup {
        if let Some(mut current) = candidate
            .world
            .get_resource_mut::<terri_core::save::SavedTargetedCleanup>()
        {
            for order in &mut current.orders {
                if let Some(saved) = original.orders.iter().find(|o| o.id == order.id) {
                    order.queue_position = saved.queue_position;
                }
            }
        }
    }
    if seats.is_none() && !terri_data::is_pre_books_pack(content) {
        crate::seating::validate(&candidate.world, candidate.world.resource::<TileGrid>())?;
    }
    if !death_default_applied {
        candidate
            .world
            .resource_mut::<terri_core::save::SavedMortality>()
            .enabled = true;
    }
    // The base loader projected before V5 added colourways and other state.
    // Refresh the complete candidate without draining commands or advancing time.
    candidate.sync_render_buffer_after_commands();
    Ok(candidate)
}

/// [SL-save]: the V3 envelope's checks, and the retired indices ascending,
/// under the bound saved entity indices have, none of them an index a saved
/// entity holds. The loader spawns a placeholder up to the highest, so an
/// unbounded one would ask for memory the save has no business naming. The
/// list's length needs no bound of its own: an ascending list of indices
/// under the bound has no more entries than the bound.
pub(crate) fn restore_v4(
    snapshot: SaveSnapshotV4,
    content: &'static ContentPack,
    active_portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    restore_v4_with_dining(snapshot, content, active_portals, None, None)
}

fn restore_v4_with_dining(
    snapshot: SaveSnapshotV4,
    content: &'static ContentPack,
    active_portals: Option<ActivePortals>,
    dining: Option<&terri_core::save::SavedDining>,
    seats: Option<&[terri_core::save_v6::SavedPhysicalSeat]>,
) -> Result<Sim, SaveError> {
    super::meal_migration::validate_source(&snapshot.world, content)?;
    let retired = &snapshot.retired_indices;
    if retired
        .iter()
        .any(|&index| index as usize >= super::MAX_ENTITIES)
    {
        return Err(SaveError::InvalidValue);
    }
    if retired.windows(2).any(|pair| pair[0] >= pair[1])
        || retired.iter().any(|index| {
            snapshot
                .world
                .entities
                .binary_search_by_key(index, |entity| entity.index)
                .is_ok()
        })
    {
        return Err(SaveError::InvalidValue);
    }
    let mut facings = BTreeMap::new();
    for (index, code) in snapshot.object_facings {
        let facing = Facing::from_code(code).ok_or(SaveError::InvalidValue)?;
        if facings.insert(index, facing).is_some() {
            return Err(SaveError::InvalidValue);
        }
        let entity = super::validate_entity_reference(&snapshot.world.entities, index)?;
        let id = entity
            .smart_object
            .as_deref()
            .ok_or(SaveError::InvalidEntityReference)?;
        let definition = content.object(super::resolve_object(content, id)?);
        if !definition.supports(facing) {
            return Err(SaveError::InvalidValue);
        }
    }
    let mut candidate = super::restore_with_facings(
        snapshot.world,
        content,
        active_portals,
        &facings,
        &snapshot.retired_indices,
    )?;
    if let Some(state) = dining {
        candidate.world.insert_resource(state.clone());
    }
    finish_restore(candidate, snapshot.layout, content, seats)
}

fn finish_restore(
    mut candidate: Sim,
    layout: SavedLayout,
    content: &ContentPack,
    seats: Option<&[terri_core::save_v6::SavedPhysicalSeat]>,
) -> Result<Sim, SaveError> {
    let grid = candidate.world.resource_mut::<TileGrid>();
    apply_layout(grid.into_inner(), &layout, content.lot.house)?;
    if let Some(seats) = seats {
        crate::seating::restore_claims(&mut candidate.world, seats)?;
    } else {
        crate::seating::migrate(&mut candidate.world)?;
    }
    super::validate_portal_returns(
        &candidate.save_snapshot(),
        candidate.world.resource::<TileGrid>(),
        content,
    )?;
    if layout.has_edges() && seats.is_none() {
        validate_edge_world(
            &candidate.save_snapshot(),
            candidate.world.resource::<TileGrid>(),
            content,
            &candidate.world,
        )?;
    }
    let typed = matches!(layout, SavedLayout::EdgeWallsV3 { .. });
    candidate.world.insert_resource(layout);
    if typed {
        crate::placement::windows::validate_restored_windows(&candidate.world)
            .map_err(|_| SaveError::InvalidGrid)?;
    }
    Ok(candidate)
}

pub(super) fn validate_edge_world(
    snapshot: &terri_core::SaveSnapshotV1,
    grid: &TileGrid,
    content: &ContentPack,
    world: &bevy_ecs::world::World,
) -> Result<(), SaveError> {
    crate::reading::persistence::validate(world, grid)?;
    for entity in &snapshot.entities {
        let Some(position) = entity.position else {
            continue;
        };
        let tile = (position.x.round() as i32, position.y.round() as i32);
        if entity.smart_object.is_some() {
            let footprint = restored_footprint(entity, world, content)?;
            let origin = (position.x.floor() as i32, position.y.floor() as i32);
            for (a, b) in grid.blocked_edges() {
                let inside = |p: (i32, i32)| {
                    p.0 >= origin.0
                        && p.1 >= origin.1
                        && p.0 < origin.0 + footprint.width as i32
                        && p.1 < origin.1 + footprint.depth as i32
                };
                if inside(a) && inside(b) {
                    return Err(SaveError::InvalidGrid);
                }
            }
        }
        if !entity.agent {
            continue;
        }
        if !grid.is_walkable(tile.0, tile.1) {
            return Err(SaveError::InvalidGrid);
        }
        let reader = crate::dining::entity(world, entity.index)
            .is_some_and(|e| world.get::<crate::reading::ReadingJourney>(e).is_some());
        if let Some(path) = &entity.path {
            let remaining = &path.steps[path.cursor as usize..];
            let mut previous = (position.x, position.y);
            for &(x, y) in remaining {
                let next = (x as f32, y as f32);
                if !grid.is_walkable(x, y) || !grid.segment_can_cross(previous, next) {
                    return Err(SaveError::InvalidGrid);
                }
                previous = next;
            }
            if remaining
                .windows(2)
                .any(|pair| pair[0] != pair[1] && !grid.can_step(pair[0], pair[1]))
            {
                return Err(SaveError::InvalidGrid);
            }
            if let Some(target) = entity.target {
                let target_entity = snapshot
                    .entities
                    .binary_search_by_key(&target.object, |e| e.index)
                    .ok()
                    .map(|i| &snapshot.entities[i])
                    .ok_or(SaveError::InvalidEntityReference)?;
                // Furniture stays put. A person may have been redirected while
                // this agent approached; that stale social route is checked at
                // arrival rather than rejecting a legitimate running save.
                if target_entity.smart_object.is_some() && !reader {
                    let at = target_entity.position.ok_or(SaveError::InvalidGrid)?;
                    let footprint = restored_footprint(target_entity, world, content)?;
                    let endpoint = remaining.last().copied().unwrap_or(tile);
                    if !valid_contact(grid, endpoint, at, footprint)
                        && !dining_contact(world, entity.index, target.object, endpoint)
                        && !crate::media::valid_standing_contact(
                            world,
                            entity.index,
                            target.object,
                            endpoint,
                        )
                    {
                        return Err(SaveError::InvalidGrid);
                    }
                }
            }
        }
        let contact = if reader {
            None
        } else if let Some(talk) = entity.socialising {
            Some(talk.partner)
        } else if entity.path.is_none()
            && (entity.eating.is_some() || entity.step_work_ticks.is_some())
        {
            entity.target.map(|t| t.object)
        } else {
            None
        };
        if let Some(index) = contact {
            let target = snapshot
                .entities
                .binary_search_by_key(&index, |e| e.index)
                .ok()
                .map(|i| &snapshot.entities[i])
                .ok_or(SaveError::InvalidEntityReference)?;
            let at = target.position.ok_or(SaveError::InvalidGrid)?;
            let footprint = restored_footprint(target, world, content)?;
            if !valid_contact(grid, tile, at, footprint)
                && !dining_contact(world, entity.index, index, tile)
                && !crate::media::valid_standing_contact(world, entity.index, index, tile)
            {
                return Err(SaveError::InvalidGrid);
            }
        }
    }
    Ok(())
}

fn dining_contact(
    world: &bevy_ecs::world::World,
    person: u32,
    station: u32,
    endpoint: (i32, i32),
) -> bool {
    crate::seating::claim(world, person).is_some_and(|d| {
        d.station == station
            && d.endpoint == endpoint
            && match crate::seating::kind(world, d) {
                Some(crate::seating::UseKind::Meal | crate::seating::UseKind::TableSeat) => true,
                Some(crate::seating::UseKind::Media) => crate::media::valid_lease(world, d),
                Some(
                    crate::seating::UseKind::ShelfTransfer | crate::seating::UseKind::Standing,
                ) => false,
                None => false,
            }
    })
}

fn restored_footprint(
    saved: &terri_core::SavedEntity,
    world: &bevy_ecs::world::World,
    content: &ContentPack,
) -> Result<terri_core::Footprint, SaveError> {
    let Some(id) = saved.smart_object.as_deref() else {
        return Ok(terri_core::Footprint::SINGLE);
    };
    let definition = content.find(id).ok_or(SaveError::InvalidContentReference)?;
    let index = bevy_ecs::entity::EntityIndex::from_raw_u32(saved.index)
        .ok_or(SaveError::InvalidEntityReference)?;
    let entity = world.entities().resolve_from_index(index);
    Ok(crate::placed_footprint(
        content,
        definition,
        world.get::<terri_core::ObjectFacing>(entity),
    ))
}

/// Saved coordinates are untrusted even after the finite-number check. Bound
/// the rectangle before calling grid arithmetic that assumes authored inputs.
fn valid_contact(
    grid: &TileGrid,
    from: (i32, i32),
    at: terri_core::save::SavedPosition,
    footprint: terri_core::Footprint,
) -> bool {
    let (x, y) = (at.x.round() as i64, at.y.round() as i64);
    if x < 0 || y < 0 || x >= grid.width() as i64 || y >= grid.height() as i64 {
        return false;
    }
    if x + footprint.width as i64 > grid.width() as i64
        || y + footprint.depth as i64 > grid.height() as i64
    {
        return false;
    }
    grid.can_interact_with_rect(from, (x as i32, y as i32), footprint)
}

fn apply_layout(
    grid: &mut TileGrid,
    layout: &SavedLayout,
    house: (u32, u32),
) -> Result<(), SaveError> {
    match layout {
        SavedLayout::LegacyAuthoredV1 => {}
        SavedLayout::LegacyCells { walls } => {
            let mut seen = BTreeSet::new();
            for &(x, y) in walls {
                if x as usize >= grid.width()
                    || y as usize >= grid.height()
                    || grid.is_walkable(x as i32, y as i32)
                    || !seen.insert((x, y))
                {
                    return Err(SaveError::InvalidGrid);
                }
            }
        }
        layout @ (SavedLayout::EdgeWallsV1 { .. }
        | SavedLayout::EdgeWallsV2 { .. }
        | SavedLayout::EdgeWallsV3 { .. }) => {
            crate::placement::windows::validate_window_layout(
                layout,
                grid.width() as u32,
                grid.height() as u32,
                house,
            )
            .map_err(|_| SaveError::InvalidGrid)?;
            let mut seen = BTreeSet::new();
            for &edge in layout.edges() {
                if !edge.in_bounds(grid.width() as u32, grid.height() as u32)
                    || !seen.insert((edge.axis, edge.x, edge.y))
                {
                    return Err(SaveError::InvalidGrid);
                }
                if !edge.doorway {
                    let [from, to] = edge.cells();
                    grid.set_edge_blocked(from, to, true);
                }
            }
            // [WN-rules]: a saved window blocks movement like a wall, and a
            // line that is already spoken for is a corrupt save.
            for window in layout.window_lines() {
                if crate::placement::windows::is_rear(window) {
                    continue;
                }
                let edge = terri_core::layout::WallEdge {
                    axis: window.axis,
                    x: window.x,
                    y: window.y,
                    doorway: false,
                };
                if !edge.in_bounds(grid.width() as u32, grid.height() as u32)
                    || !seen.insert((window.axis, window.x, window.y))
                {
                    return Err(SaveError::InvalidGrid);
                }
                let [from, to] = edge.cells();
                grid.set_edge_blocked(from, to, true);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::layout::{EdgeAxis, WallEdge};

    fn edge(x: u32, doorway: bool) -> WallEdge {
        WallEdge {
            axis: EdgeAxis::Vertical,
            x,
            y: 1,
            doorway,
        }
    }

    fn shipped_worker(sim: &mut Sim) -> terri_core::Entity {
        let mut careers = sim
            .world_mut()
            .query_filtered::<terri_core::Entity, bevy_ecs::prelude::With<terri_core::Career>>();
        careers
            .iter(sim.world())
            .next()
            .expect("the shipped household has a worker")
    }

    #[test]
    fn v2_load_preserves_the_callers_active_portal_scene() {
        let mut shipped = Sim::new_from_shipped_lot();
        let saved = shipped.save_snapshot_v2();

        shipped.load_snapshot_v2(saved.clone()).unwrap();
        assert!(shipped.world().contains_resource::<ActivePortals>());
        // The front door, then a door in each of the three vertical and two horizontal
        // doorways ([DR-derived]).
        assert_eq!(shipped.portal_buffer().states.len(), 6);

        let mut blank = Sim::new();
        blank.load_snapshot_v2(saved).unwrap();
        assert!(!blank.world().contains_resource::<ActivePortals>());
        assert!(blank.portal_buffer().states.is_empty());
    }

    #[test]
    fn v2_rejects_a_future_portal_return_through_a_solid_saved_edge() {
        let mut source = Sim::new_from_shipped_lot();
        let worker = shipped_worker(&mut source);
        source.world_mut().entity_mut(worker).insert((
            terri_core::Position { x: 15.0, y: 2.0 },
            terri_core::AtWork { remaining_ticks: 1 },
        ));
        source
            .world_mut()
            .entity_mut(worker)
            .remove::<(terri_core::Commuting, terri_core::Path)>();
        let mut saved = source.save_snapshot_v2();
        let return_edge = WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 15,
            y: 3,
            doorway: false,
        };
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![return_edge],
        };

        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        assert_eq!(
            live.load_snapshot_v2(saved.clone()),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);
        assert!(live.world().contains_resource::<ActivePortals>());

        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                doorway: true,
                ..return_edge
            }],
        };
        live.load_snapshot_v2(saved).unwrap();
        live.tick();
        let worker = live.world().entities().resolve_from_index(worker.index());
        assert_eq!(
            live.world()
                .get::<terri_core::Path>(worker)
                .and_then(|path| path.steps.last())
                .copied(),
            Some((15, 3)),
            "an open saved edge permits the authored return landing"
        );
    }

    #[test]
    fn v2_rejects_an_at_work_position_whose_return_segment_crosses_a_saved_edge() {
        let mut source = Sim::new_from_shipped_lot();
        let worker = shipped_worker(&mut source);
        source.world_mut().entity_mut(worker).insert((
            terri_core::Position { x: 13.0, y: 3.0 },
            terri_core::AtWork { remaining_ticks: 1 },
        ));
        source
            .world_mut()
            .entity_mut(worker)
            .remove::<(terri_core::Commuting, terri_core::Path)>();
        let mut saved = source.save_snapshot_v2();
        let crossed_edge = WallEdge {
            axis: EdgeAxis::Vertical,
            x: 14,
            y: 3,
            doorway: false,
        };
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![crossed_edge],
        };

        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        assert_eq!(
            live.load_snapshot_v2(saved.clone()),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);

        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                doorway: true,
                ..crossed_edge
            }],
        };
        live.load_snapshot_v2(saved).unwrap();
        live.tick();
        let worker = live.world().entities().resolve_from_index(worker.index());
        assert_eq!(
            live.world()
                .get::<terri_core::Path>(worker)
                .and_then(|path| path.steps.last())
                .copied(),
            Some((15, 3)),
            "an open saved edge permits the worker's actual return segment"
        );
    }

    #[test]
    fn v2_rejects_a_solid_future_portal_route_while_the_worker_is_home() {
        let source = Sim::new_from_shipped_lot();
        let mut saved = source.save_snapshot_v2();
        let return_edge = WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 15,
            y: 3,
            doorway: false,
        };
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![return_edge],
        };

        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        assert_eq!(
            live.load_snapshot_v2(saved.clone()),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);

        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                doorway: true,
                ..return_edge
            }],
        };
        live.load_snapshot_v2(saved).unwrap();
    }

    #[test]
    fn v1_rejects_a_blocked_future_portal_landing_transactionally() {
        let source = Sim::new_from_shipped_lot();
        let open = source.save_snapshot();
        let mut blocked = open.clone();
        blocked.blocked_tiles[3 * blocked.grid_width as usize + 15] = true;

        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        assert_eq!(live.load_snapshot(blocked), Err(SaveError::InvalidGrid));
        assert_eq!(live.save_snapshot_v2(), before);
        assert!(live.world().contains_resource::<ActivePortals>());

        live.load_snapshot(open).unwrap();
        assert!(live.world().contains_resource::<ActivePortals>());
    }

    #[test]
    fn v2_restores_geometry_from_the_save_not_live_authored_content() {
        let mut live = Sim::new_with_lot(5, 4);
        let mut saved = live.save_snapshot_v2();
        saved.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![edge(2, false), edge(3, true)],
        };
        live.load_snapshot_v2(saved.clone()).unwrap();
        assert_eq!(live.save_snapshot_v2(), saved);
        let grid = live.world.resource::<TileGrid>();
        assert!(!grid.can_step((1, 1), (2, 1)));
        assert!(!grid.can_step((2, 1), (1, 1)));
        assert!(grid.can_step((2, 1), (3, 1)));
        let mut resumed = Sim::new();
        resumed.load_snapshot_v2(saved).unwrap();
        for _ in 0..20 {
            live.tick();
            resumed.tick();
        }
        assert_eq!(resumed.save_snapshot_v2(), live.save_snapshot_v2());
    }

    #[test]
    fn invalid_v2_geometry_never_replaces_the_live_world() {
        let mut live = Sim::new_from_shipped_lot();
        let before = live.save_snapshot_v2();
        for edges in [
            vec![edge(0, false)],
            vec![edge(2, false), edge(2, true)],
            vec![edge(u32::MAX, false)],
        ] {
            let mut invalid = before.clone();
            invalid.layout = SavedLayout::EdgeWallsV1 { edges };
            assert_eq!(live.load_snapshot_v2(invalid), Err(SaveError::InvalidGrid));
            assert_eq!(live.save_snapshot_v2(), before);
        }
    }

    #[test]
    fn custom_v1_collision_survives_v2_resave_without_inventing_architecture() {
        let mut custom = Sim::new_with_lot(3, 4);
        custom
            .world
            .resource_mut::<TileGrid>()
            .set_blocked(1, 2, true);
        let old = custom.save_snapshot();
        let mut live = Sim::new_from_shipped_lot();
        live.load_snapshot(old.clone()).unwrap();
        let v2 = live.save_snapshot_v2();
        assert_eq!(v2.world, old);
        assert_eq!(v2.layout, SavedLayout::LegacyAuthoredV1);
        let mut resumed = Sim::new();
        resumed.load_snapshot_v2(v2.clone()).unwrap();
        assert_eq!(resumed.save_snapshot_v2(), v2);
    }

    #[test]
    fn edge_world_rejects_a_saved_route_through_a_boundary() {
        let mut live = Sim::new_with_lot(5, 4);
        live.world.spawn((
            terri_core::Agent,
            terri_core::Position { x: 1.0, y: 1.0 },
            terri_core::Path {
                steps: vec![(2, 1)],
                cursor: 0,
            },
        ));
        let before = live.save_snapshot_v2();
        let mut impossible = before.clone();
        impossible.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![edge(2, false)],
        };
        assert_eq!(
            live.load_snapshot_v2(impossible),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);
        let mut doorway = before;
        doorway.layout = SavedLayout::EdgeWallsV1 {
            edges: vec![edge(2, true)],
        };
        live.load_snapshot_v2(doorway).unwrap();
    }

    /// Review finding [F2] on PR 126: a save carrying a window is still held
    /// to every edge-world rule. The same impossible route as the test above,
    /// with the blocking line saved as a window rather than a wall.
    #[test]
    fn edge_world_rejects_a_saved_route_through_a_window() {
        let mut live = Sim::new_with_lot(5, 4);
        live.world.spawn((
            terri_core::Agent,
            terri_core::Position { x: 1.0, y: 1.0 },
            terri_core::Path {
                steps: vec![(2, 1)],
                cursor: 0,
            },
        ));
        let before = live.save_snapshot_v2();
        let glazed = terri_core::layout::WallLine {
            axis: EdgeAxis::Vertical,
            x: 2,
            y: 1,
        };
        let mut impossible = before.clone();
        impossible.layout = SavedLayout::from_parts(Vec::new(), vec![glazed]);
        assert_eq!(
            live.load_snapshot_v2(impossible),
            Err(SaveError::InvalidGrid)
        );
        assert_eq!(live.save_snapshot_v2(), before);

        // The same window on a line the walk does not cross loads, and it
        // still blocks its own line once loaded.
        let mut fine = before;
        fine.layout = SavedLayout::from_parts(
            Vec::new(),
            vec![terri_core::layout::WallLine {
                axis: EdgeAxis::Vertical,
                x: 2,
                y: 3,
            }],
        );
        live.load_snapshot_v2(fine).unwrap();
        assert!(!live.world.resource::<TileGrid>().can_step((1, 3), (2, 3)));
    }

    #[test]
    fn static_target_paths_must_end_at_an_open_contact_even_when_exhausted() {
        use terri_core::{Agent, Path, Position, Reserved, Target};
        let mut live = Sim::new_with_lot(5, 4);
        let fridge = live
            .world
            .resource::<crate::Content>()
            .0
            .find("fridge")
            .unwrap();
        let object = live.spawn_object(Position { x: 3.0, y: 1.0 }, fridge);
        live.world.entity_mut(object).insert(Reserved);
        live.world
            .resource_mut::<TileGrid>()
            .set_blocked(3, 1, true);
        let agent = live
            .world
            .spawn((
                Agent,
                Position { x: 2.0, y: 1.0 },
                Target {
                    object,
                    interaction: 0,
                },
                Path {
                    steps: vec![],
                    cursor: 0,
                },
            ))
            .id();
        for steps in [vec![], vec![(2, 1)], vec![(2, 0), (2, 1)]] {
            live.world
                .entity_mut(agent)
                .insert(Path { steps, cursor: 0 });
            let mut snapshot = live.save_snapshot_v2();
            snapshot.layout = SavedLayout::EdgeWallsV1 {
                edges: vec![edge(3, false)],
            };
            assert_eq!(
                restore(snapshot.clone(), terri_data::pack(), None).err(),
                Some(SaveError::InvalidGrid)
            );
            snapshot.layout = SavedLayout::EdgeWallsV1 {
                edges: vec![edge(3, true)],
            };
            assert!(restore(snapshot, terri_data::pack(), None).is_ok());
        }
    }

    #[test]
    fn extreme_finite_contact_targets_reject_without_panicking_or_replacing_the_world() {
        use terri_core::{Agent, Path, Position, Reserved, Target};
        let mut live = Sim::new_with_lot(5, 4);
        let bed = terri_data::pack().find("bed").unwrap();
        let object = live.spawn_object(Position { x: 2.0, y: 2.0 }, bed);
        live.world.entity_mut(object).insert(Reserved);
        live.world.spawn((
            Agent,
            Position { x: 0.0, y: 2.0 },
            Target {
                object,
                interaction: 0,
            },
            Path {
                steps: vec![],
                cursor: 0,
            },
        ));
        let before = live.save_snapshot_v2();
        for (x, y) in [(f32::MAX, -f32::MAX), (-f32::MAX, 2.0), (f32::MAX, 2.0)] {
            for walking in [true, false] {
                let mut invalid = before.clone();
                invalid.layout = SavedLayout::EdgeWallsV1 {
                    edges: vec![edge(4, false)],
                };
                invalid
                    .world
                    .entities
                    .iter_mut()
                    .find(|e| e.index == object.index_u32())
                    .unwrap()
                    .position = Some(terri_core::save::SavedPosition { x, y });
                if !walking {
                    let agent = invalid.world.entities.iter_mut().find(|e| e.agent).unwrap();
                    agent.path = None;
                    agent.eating = Some(terri_core::save::SavedEating {
                        object: "bed".into(),
                        interaction: 0,
                        remaining_ticks: 1,
                    });
                }
                assert_eq!(live.load_snapshot_v2(invalid), Err(SaveError::InvalidGrid));
                assert_eq!(live.save_snapshot_v2(), before);
            }
        }
    }
}
