//! Current saved geometry and deterministic access through the lot boundary.
use bevy_ecs::prelude::*;
use std::collections::{BTreeSet, VecDeque};
pub use terri_core::WorldSurfaces;
use terri_core::{
    layout::{EdgeAxis, SavedLayout, WallEdge, WallLine},
    Agent, Position, SmartObject, TileGrid,
};

#[path = "world_geometry_migration.rs"]
mod migration;
#[path = "world_geometry_navigation.rs"]
mod navigation;
pub(crate) use navigation::home_targets;
#[path = "world_geometry_occupancy.rs"]
mod occupancy;
#[path = "world_geometry_routes.rs"]
mod routes;

#[derive(Component, Clone, Copy, Debug)]
pub struct WaitingToReturn;

pub fn current(world: &World) -> bool {
    world.contains_resource::<WorldSurfaces>()
}

/// A current worker or waiting return has no physical body at its retained
/// coordinate. A live path remains subject to physical validation.
pub(crate) fn hidden_away(world: &World, actor: Entity) -> bool {
    current(world)
        && world.get::<terri_core::AtWork>(actor).is_some()
        && world.get::<terri_core::Path>(actor).is_none()
}

pub(crate) fn admit_legacy_people(world: &mut World) -> Result<(), crate::SaveError> {
    migration::admit_people(world)
}

pub(crate) fn validate_occupied_objects(world: &World) -> Result<(), crate::SaveError> {
    occupancy::validate(world)
}
pub(crate) fn normalize_legacy_occupied_objects(world: &mut World) -> Result<(), crate::SaveError> {
    occupancy::normalize(world)
}

/// No historical shell exists under the current envelope.
pub fn historical_house(world: &World) -> crate::lot_frame::HouseRect {
    if current(world) {
        crate::lot_frame::HouseRect {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        }
    } else {
        crate::lot_frame::house_or_grid(world)
    }
}

/// Convert only geometry that the historical world actually implies.
pub fn materialize(world: &mut World) -> Result<(), crate::SaveError> {
    if current(world) {
        return Ok(());
    }
    let grid = world.resource::<TileGrid>();
    let (width, height) = (grid.width() as u32, grid.height() as u32);
    let house = crate::lot_frame::house_or_grid(world);
    let street = crate::lot_frame::street_exit(world).map(|p| p.0);
    let tiles = (0..height)
        .flat_map(|y| {
            (0..width).map(move |x| {
                if street == Some(x) {
                    2
                } else if house.contains(x, y) {
                    0
                } else {
                    1
                }
            })
        })
        .collect();
    let layout = world.resource::<SavedLayout>().clone();
    let old_map = world.get_resource::<crate::rooms::RoomMap>().cloned();
    let mut edges = layout.edges().to_vec();
    let cells = match &layout {
        SavedLayout::LegacyCells { walls } => Some(walls.iter().copied().collect::<BTreeSet<_>>()),
        SavedLayout::LegacyAuthoredV1 => Some(migration::unowned_collision_cells(world)),
        _ => None,
    };
    if matches!(layout, SavedLayout::LegacyAuthoredV1) {
        migration::normalize_objects(world, cells.as_ref().expect("legacy cells were collected"))?;
    }
    if let Some(cells) = &cells {
        for &(x, y) in cells {
            for (axis, lx, ly, neighbor) in [
                (EdgeAxis::Vertical, x, y, (i64::from(x) - 1, i64::from(y))),
                (
                    EdgeAxis::Vertical,
                    x + 1,
                    y,
                    (i64::from(x) + 1, i64::from(y)),
                ),
                (EdgeAxis::Horizontal, x, y, (i64::from(x), i64::from(y) - 1)),
                (
                    EdgeAxis::Horizontal,
                    x,
                    y + 1,
                    (i64::from(x), i64::from(y) + 1),
                ),
            ] {
                if neighbor.0 >= 0
                    && neighbor.1 >= 0
                    && cells.contains(&(neighbor.0 as u32, neighbor.1 as u32))
                {
                    continue;
                }
                edges.push(WallEdge {
                    axis,
                    x: lx,
                    y: ly,
                    doorway: false,
                });
            }
        }
        let mut grid = world.resource_mut::<TileGrid>();
        for &(x, y) in cells {
            grid.set_blocked(x as usize, y as usize, false);
        }
    }
    if layout.has_edges() || cells.is_some() {
        for line in house.rear_lines() {
            if layout.window_at(line).is_none()
                && !edges
                    .iter()
                    .any(|e| e.axis == line.axis && e.x == line.x && e.y == line.y)
            {
                edges.push(WallEdge {
                    axis: line.axis,
                    x: line.x,
                    y: line.y,
                    doorway: false,
                });
            }
        }
        let frozen_perimeter = matches!(layout, SavedLayout::LegacyAuthoredV1)
            || matches!(&layout,SavedLayout::LegacyCells {walls} if walls.len()==terri_core::layout::LEGACY_WALL_TILES.len()
                && terri_core::layout::LEGACY_WALL_TILES.iter().all(|&(x,y)|walls.contains(&(x+house.x,y+house.y))));
        if frozen_perimeter {
            let portal = crate::portals::front_portal(world.resource::<crate::Content>().0)
                .map(|p| crate::lot_frame::shift_portal(p, crate::lot_frame::origin(world)));
            for line in (house.y..house.y + house.height)
                .map(|y| WallLine {
                    axis: EdgeAxis::Vertical,
                    x: house.x + house.width,
                    y,
                })
                .chain((house.x..house.x + house.width).map(|x| WallLine {
                    axis: EdgeAxis::Horizontal,
                    x,
                    y: house.y + house.height,
                }))
            {
                if !edges
                    .iter()
                    .any(|e| e.axis == line.axis && e.x == line.x && e.y == line.y)
                {
                    let doorway = portal.as_ref().is_some_and(|p| {
                        line.axis == EdgeAxis::Vertical
                            && p.position.0 + 1 == line.x
                            && p.position.1 == line.y
                    });
                    edges.push(WallEdge {
                        axis: line.axis,
                        x: line.x,
                        y: line.y,
                        doorway,
                    });
                }
            }
        }
        edges.sort_by_key(|e| (e.axis, e.x, e.y));
        edges.dedup_by_key(|e| (e.axis, e.x, e.y));
        let mut grid = world.resource_mut::<TileGrid>();
        for edge in &edges {
            if edge.in_bounds(width, height) {
                let [a, b] = edge.cells();
                grid.set_edge_blocked(a, b, !edge.doorway);
            }
        }
        world.insert_resource(crate::placement::windows::with_architecture(
            &layout,
            edges,
            layout.window_placements(),
        ));
    }
    world.insert_resource(WorldSurfaces {
        width,
        height,
        tiles,
    });
    if cells.is_some() {
        if let Some(old) = old_map {
            let topology = crate::rooms::RoomTopology::from_world(world)
                .map_err(|_| crate::SaveError::InvalidGrid)?;
            let proposal = crate::rooms::match_rooms(&old, &topology, (0, 0));
            let resolved = crate::rooms::resolve_rooms(
                &proposal,
                &crate::rooms::RoomChoices::default(),
                world.resource::<terri_core::rooms::SavedRooms>(),
            )
            .map_err(|_| crate::SaveError::InvalidGrid)?;
            crate::rooms::install(world, resolved.saved)
                .map_err(|_| crate::SaveError::InvalidGrid)?;
        }
    }
    Ok(())
}

pub fn blank(world: &mut World) {
    let grid = world.resource::<TileGrid>();
    world.insert_resource(WorldSurfaces {
        width: grid.width() as u32,
        height: grid.height() as u32,
        tiles: vec![0; grid.width() * grid.height()],
    });
}

/// Open perimeter segments are exits even when no door model stands there.
pub fn boundary_tiles(world: &World, grid: &TileGrid) -> Vec<(i32, i32)> {
    let layout = world.resource::<SavedLayout>();
    let (width, height) = (grid.width() as u32, grid.height() as u32);
    let perimeter = |line: WallLine| match line.axis {
        EdgeAxis::Vertical => line.x == 0 || line.x == width,
        EdgeAxis::Horizontal => line.y == 0 || line.y == height,
    };
    let blocked: BTreeSet<_> = layout
        .edges()
        .iter()
        .filter(|edge| !edge.doorway)
        .map(|edge| WallLine {
            axis: edge.axis,
            x: edge.x,
            y: edge.y,
        })
        .chain(layout.window_lines())
        .filter(|line| perimeter(*line))
        .map(|line| (line.axis, line.x, line.y))
        .collect();
    let mut result = BTreeSet::new();
    for y in 0..height {
        for (x, line_x) in [(0, 0), (width - 1, width)] {
            if grid.is_walkable(x as i32, y as i32)
                && !blocked.contains(&(EdgeAxis::Vertical, line_x, y))
            {
                result.insert((x as i32, y as i32));
            }
        }
    }
    for x in 0..width {
        for (y, line_y) in [(0, 0), (height - 1, height)] {
            if grid.is_walkable(x as i32, y as i32)
                && !blocked.contains(&(EdgeAxis::Horizontal, x, line_y))
            {
                result.insert((x as i32, y as i32));
            }
        }
    }
    result.into_iter().collect()
}

/// One breadth-first traversal ranks reachable destinations by distance and coordinates.
fn shortest_route(
    grid: &TileGrid,
    position: Position,
    targets: &BTreeSet<(i32, i32)>,
) -> Option<Vec<(i32, i32)>> {
    let start = (position.x.round() as i32, position.y.round() as i32);
    if !grid.is_walkable(start.0, start.1) {
        return None;
    }
    let mut previous = std::collections::BTreeMap::from([(start, start)]);
    let mut layer = vec![start];
    while !layer.is_empty() {
        if let Some(to) = layer.iter().copied().filter(|p| targets.contains(p)).min() {
            let mut steps = vec![];
            let mut at = to;
            while at != start {
                steps.push(at);
                at = previous[&at];
            }
            steps.reverse();
            return grid.anchor_path((position.x, position.y), steps);
        }
        let mut next_layer = Vec::new();
        for at in layer {
            for next in [
                (at.0 - 1, at.1),
                (at.0, at.1 - 1),
                (at.0, at.1 + 1),
                (at.0 + 1, at.1),
            ] {
                if grid.can_step(at, next) && !previous.contains_key(&next) {
                    previous.insert(next, at);
                    next_layer.push(next);
                }
            }
        }
        layer = next_layer;
    }
    None
}

pub fn route_to_boundary(world: &World, position: Position) -> Option<Vec<(i32, i32)>> {
    let grid = world.resource::<TileGrid>();
    shortest_route(
        grid,
        position,
        &boundary_tiles(world, grid).into_iter().collect(),
    )
}

pub(crate) fn route_endpoint(
    position: Position,
    path: Option<&terri_core::Path>,
) -> Option<(i32, i32)> {
    let tile = (position.x.round() as i32, position.y.round() as i32);
    match path {
        Some(path) => Some(
            path.steps
                .get(path.cursor..)?
                .last()
                .copied()
                .unwrap_or(tile),
        ),
        None => Some(tile),
    }
}

/// Current floor surfaces provide arrival destinations. A bare lot uses open ground.
pub fn route_home(world: &World, position: Position) -> Option<Vec<(i32, i32)>> {
    navigation::route_home(world, position)
}

pub(crate) fn arrival_route(world: &World) -> Option<(Position, Vec<(i32, i32)>)> {
    navigation::arrival(world)
}

#[cfg(test)]
thread_local! {
    static HOME_TARGET_VISITS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AccessReport {
    pub regions: Vec<InaccessibleRegion>,
    pub blocked_targets: Vec<BlockedTarget>,
}
impl AccessReport {
    pub fn requires_acknowledgment(&self) -> bool {
        !self.regions.is_empty() || !self.blocked_targets.is_empty()
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InaccessibleRegion {
    pub tiles: Vec<(u32, u32)>,
    pub people: Vec<u32>,
    pub targets: Vec<u32>,
    pub external_access: bool,
    pub unreachable_by: Vec<u32>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BlockedTarget {
    pub target: u32,
    pub tiles: Vec<(u32, u32)>,
}

/// No person or entrance is a privileged reachability root.
pub fn access_report(world: &World) -> AccessReport {
    let grid = world.resource::<TileGrid>();
    let boundary: BTreeSet<_> = boundary_tiles(world, grid).into_iter().collect();
    let mut membership = std::collections::BTreeMap::new();
    let mut components = Vec::new();
    for y in 0..grid.height() as i32 {
        for x in 0..grid.width() as i32 {
            if !grid.is_walkable(x, y) || membership.contains_key(&(x, y)) {
                continue;
            }
            let id = components.len();
            let mut component = BTreeSet::from([(x, y)]);
            membership.insert((x, y), id);
            let mut queue = VecDeque::from([(x, y)]);
            while let Some(at) = queue.pop_front() {
                for next in [
                    (at.0 - 1, at.1),
                    (at.0, at.1 - 1),
                    (at.0, at.1 + 1),
                    (at.0 + 1, at.1),
                ] {
                    if grid.can_step(at, next) && !membership.contains_key(&next) {
                        membership.insert(next, id);
                        component.insert(next);
                        queue.push_back(next);
                    }
                }
            }
            components.push(component);
        }
    }
    let mut people = Vec::new();
    let mut targets = Vec::new();
    let mut report = AccessReport::default();
    if let Some(mut query) = world.try_query::<EntityRef>() {
        for entity in query.iter(world) {
            let Some(position) = entity.get::<Position>() else {
                continue;
            };
            let tile = (position.x.round() as i32, position.y.round() as i32);
            if entity.contains::<Agent>()
                && !entity.contains::<terri_core::AtWork>()
                && position.x >= 0.
                && position.y >= 0.
            {
                if let Some(&component) = membership.get(&tile) {
                    people.push((entity.id().index_u32(), component));
                }
            }
            if let Some(object) = entity.get::<SmartObject>() {
                let Some(definition) = world
                    .get_resource::<crate::Content>()
                    .and_then(|content| content.0.objects.get(object.0 .0 as usize))
                else {
                    continue;
                };
                let facing = entity
                    .get::<terri_core::ObjectFacing>()
                    .map_or(definition.base_facing, |f| f.0);
                let footprint = definition.footprint_at(facing);
                let (x, y) = (position.x as i32, position.y as i32);
                let (right, bottom) = (
                    x.saturating_add(footprint.width as i32),
                    y.saturating_add(footprint.depth as i32),
                );
                let component_at = |at| {
                    grid.can_interact_with_rect(at, (x, y), footprint)
                        .then(|| membership.get(&at).copied())
                        .flatten()
                };
                let approaches: BTreeSet<_> = if crate::pool::has_pool(definition) {
                    component_at(crate::pool::approach(definition, (x, y), facing))
                        .into_iter()
                        .collect()
                } else {
                    (x..right)
                        .flat_map(|x| [(x, y.saturating_sub(1)), (x, bottom)])
                        .chain((y..bottom).flat_map(|y| [(x.saturating_sub(1), y), (right, y)]))
                        .filter_map(component_at)
                        .collect()
                };
                if approaches.is_empty() {
                    let tiles = (y..bottom)
                        .flat_map(|ty| (x..right).map(move |tx| (tx, ty)))
                        .filter(|&(tx, ty)| {
                            tx >= 0
                                && ty >= 0
                                && (tx as usize) < grid.width()
                                && (ty as usize) < grid.height()
                        })
                        .map(|(x, y)| (x as u32, y as u32))
                        .collect();
                    report.blocked_targets.push(BlockedTarget {
                        target: entity.id().index_u32(),
                        tiles,
                    });
                } else {
                    targets.push((entity.id().index_u32(), approaches));
                }
            }
        }
    }
    people.sort_unstable();
    targets.sort_by_key(|row| row.0);
    report.blocked_targets.sort_by_key(|row| row.target);
    for (id, component) in components.into_iter().enumerate() {
        let external_access = !component.is_disjoint(&boundary);
        let unreachable_by: Vec<_> = people
            .iter()
            .filter_map(|&(person, at)| (at != id).then_some(person))
            .collect();
        if external_access && unreachable_by.is_empty() {
            continue;
        }
        report.regions.push(InaccessibleRegion {
            tiles: component
                .into_iter()
                .map(|(x, y)| (x as u32, y as u32))
                .collect(),
            people: people
                .iter()
                .filter_map(|&(person, at)| (at == id).then_some(person))
                .collect(),
            targets: targets
                .iter()
                .filter_map(|(target, approaches)| {
                    (approaches.len() == 1 && approaches.contains(&id)).then_some(*target)
                })
                .collect(),
            external_access,
            unreachable_by,
        });
    }
    report
}

/// Retain valid work and fail only the order whose current route was obstructed.
pub(crate) fn revalidate_routes(world: &mut World) {
    revalidate_routes_for(world, false);
}

pub(crate) fn revalidate_legacy_commutes(world: &mut World) {
    revalidate_routes_for(world, true);
}

fn revalidate_routes_for(world: &mut World, commutes_only: bool) {
    use terri_core::{Commuting, Path};
    if !current(world) {
        return;
    }
    let mut exits = None;
    let mut home_targets = None;
    let invalid: Vec<_> = world
        .query_filtered::<
            (Entity, &Position, Option<&Path>, Option<&Commuting>),
            Or<(With<Path>, With<Commuting>)>,
        >()
        .iter(world)
        .filter_map(|(entity, &pos, path, commute)| {
            if commutes_only && commute.is_none() {
                return None;
            }
            let grid = world.resource::<TileGrid>();
            let Some(endpoint) = route_endpoint(pos, path) else {
                return Some(entity);
            };
            let mut previous = (pos.x, pos.y);
            let remaining = path.map_or(&[][..], |p| &p.steps[p.cursor..]);
            let valid = remaining.iter().all(|&(x, y)| {
                let next = (x as f32, y as f32);
                let valid = grid.is_walkable(x, y) && grid.segment_can_cross(previous, next);
                previous = next;
                valid
            });
            let destination = match commute {
                Some(Commuting::Outbound) => exits
                    .get_or_insert_with(|| boundary_tiles(world, grid))
                    .binary_search(&endpoint)
                    .is_ok(),
                Some(Commuting::Inbound) => {
                    let (x, y) = endpoint;
                    grid.is_walkable(x, y)
                        && home_targets
                            .get_or_insert_with(|| navigation::home_targets(world, grid))
                            .as_ref()
                            .is_some_and(|targets| targets[y as usize * grid.width() + x as usize])
                }
                None => routes::endpoint_valid(world, entity, endpoint),
            };
            (!valid || !destination).then_some(entity)
        })
        .collect();
    for actor in invalid {
        let position = *world
            .get::<Position>(actor)
            .expect("route owner has a position");
        let replacement = match world.get::<Commuting>(actor) {
            Some(Commuting::Outbound) => route_to_boundary(world, position),
            Some(Commuting::Inbound) => route_home(world, position),
            None => routes::replan(world, actor),
        };
        if let Some(steps) = replacement {
            world.entity_mut(actor).insert(Path { steps, cursor: 0 });
            continue;
        }
        if world.get::<Commuting>(actor).is_some() {
            crate::attendance::end_manual_work_trip(world, actor);
            finish_visible_commute_next_tick(world, actor);
            continue;
        }
        end_obstructed_work(world, actor, "The route was blocked by a building change.");
    }
}

/// Let attendance finish the interrupted return and any due career review when time resumes.
pub(crate) fn finish_visible_commute_next_tick(world: &mut World, actor: Entity) {
    world
        .entity_mut(actor)
        .remove::<terri_core::Path>()
        .insert(terri_core::Commuting::Inbound);
}

fn end_obstructed_work(world: &mut World, actor: Entity, reason: &str) {
    use terri_core::{Path, Target};
    let target = world.get::<Target>(actor).copied();
    let recipe = target
        .filter(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
        .and_then(|_| {
            world
                .get::<terri_core::ChainState>(actor)
                .map(|state| state.chain)
        });
    if let Some(target) = target {
        let recipe_order = recipe.and_then(|_| {
            world
                .get::<crate::recipe_actions::RecipeOrder>(actor)
                .map(|order| order.0)
                .or_else(|| {
                    world
                        .get::<crate::player_actions::DirectedMealOrder>(actor)
                        .map(|order| order.0)
                })
        });
        let order = recipe_order
            .or_else(|| {
                world
                    .get::<crate::player_actions::ServedOrder>(actor)
                    .map(|s| s.0)
            })
            .or_else(|| {
                world
                    .get_resource::<crate::player_actions::PlayerActions>()
                    .and_then(|orders| {
                        orders
                            .orders
                            .iter()
                            .find(|((owner, _), state)| {
                                *owner == actor
                                    && state.active
                                    && state.entry.intent.object == target.object
                            })
                            .map(|((_, id), _)| *id)
                    })
            });
        if let Some(id) = order {
            crate::player_actions::terminal(world, actor, id, "failed", Some(reason));
        }
        crate::reservations::release_now(world, actor, target);
    }
    if let Some(chain) = recipe.filter(|_| world.get::<terri_core::ChainState>(actor).is_some()) {
        // Use the same permanent-failure teardown as the recipe runtime. The
        // initiating object may differ from the current station, so its explicit
        // RecipeOrder owns termination; later queued orders remain untouched.
        world
            .entity_mut(actor)
            .remove::<crate::recipe_actions::ActiveRecipe>()
            .remove::<(
                terri_core::Carrying,
                terri_core::Fumbled,
                terri_core::Blocked,
                terri_core::Restless,
            )>();
        crate::systems::chain::fail_order(world, actor, reason);
        crate::systems::chain::settle_order(world, actor, chain);
        crate::domestic::abandon(world, actor);
    }
    if world.get::<crate::reading::ReadingJourney>(actor).is_some() {
        crate::reading::request_return(world, actor);
        return;
    }
    world
        .entity_mut(actor)
        .remove::<Path>()
        .remove::<Target>()
        .remove::<crate::pool::PoolEpisode>()
        .remove::<terri_core::Eating>()
        .remove::<terri_core::StepWork>();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{build_transaction::BuildCommitError, rooms::RoomChoices, Sim};
    use terri_core::{layout::WallState, CommandQueue, SimCommand};
    fn wall(sim: &mut Sim, axis: EdgeAxis, x: u32, y: u32, state: WallState) {
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetWallEdge { axis, x, y, state });
        sim.flush_commands();
        assert_eq!(
            sim.world()
                .resource::<crate::placement::LotEditState>()
                .last_wall_result
                .unwrap()
                .reason,
            None
        );
    }
    #[test]
    fn inaccessible_empty_ground_requires_exact_review_and_round_trips() {
        let mut sim = Sim::new_with_lot(5, 5);
        sim.begin_build().unwrap();
        for (axis, x, y) in [
            (EdgeAxis::Vertical, 2, 2),
            (EdgeAxis::Vertical, 3, 2),
            (EdgeAxis::Horizontal, 2, 2),
            (EdgeAxis::Horizontal, 2, 3),
        ] {
            wall(&mut sim, axis, x, y, WallState::Wall);
        }
        let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
        assert_eq!(review.access.regions.len(), 1);
        assert_eq!(review.access.regions[0].tiles, vec![(2, 2)]);
        assert_eq!(
            sim.commit_build(review.token),
            Err(BuildCommitError::AccessAcknowledgmentRequired)
        );
        sim.commit_build_with_access_ack(review.token).unwrap();
        sim.end_build().unwrap();
        let snapshot = sim.save_snapshot_v28();
        let hash = sim.world_hash();
        let mut restored = Sim::new_with_lot(1, 1);
        restored.load_snapshot_v28(snapshot.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v28(), snapshot);
        assert_eq!(restored.world_hash(), hash);
        assert_eq!(
            access_report(restored.world()).regions[0].tiles,
            vec![(2, 2)]
        );
    }
    #[test]
    fn edited_draft_invalidates_access_acknowledgment() {
        let mut sim = Sim::new_with_lot(5, 5);
        sim.begin_build().unwrap();
        let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
        wall(&mut sim, EdgeAxis::Vertical, 2, 2, WallState::Wall);
        assert_eq!(
            sim.commit_build_with_access_ack(review.token),
            Err(BuildCommitError::StaleToken)
        );
    }
    #[test]
    fn exits_use_actual_perimeter_openings_and_coordinate_ties() {
        let mut sim = Sim::new_with_lot(5, 5);
        assert_eq!(
            route_to_boundary(sim.world(), Position { x: 2., y: 2. })
                .unwrap()
                .last(),
            Some(&(0, 2))
        );
        sim.begin_build().unwrap();
        wall(&mut sim, EdgeAxis::Vertical, 0, 2, WallState::Wall);
        assert_eq!(
            route_to_boundary(sim.world(), Position { x: 2., y: 2. })
                .unwrap()
                .last(),
            Some(&(2, 0))
        );
    }
    #[test]
    fn removed_rear_wall_stays_removed_after_growth_and_load() {
        let mut sim = Sim::new_from_shipped_lot();
        sim.begin_build().unwrap();
        wall(&mut sim, EdgeAxis::Vertical, 0, 2, WallState::Open);
        let review = sim.prepare_build_commit(RoomChoices::default()).unwrap();
        sim.commit_build_with_access_ack(review.token).unwrap();
        sim.end_build().unwrap();
        crate::land::grow(sim.world_mut(), (1, 0), (1, 0));
        assert!(sim.world().resource::<TileGrid>().can_step((0, 2), (1, 2)));
        // Growth's public purchase updates the purchased-area ledger; match it here.
        sim.world_mut()
            .resource_mut::<crate::LotFrame>()
            .purchased_area += 16;
        let saved = sim.save_snapshot_v28();
        sim.load_snapshot_v28(saved).unwrap();
        assert!(sim.world().resource::<TileGrid>().can_step((0, 2), (1, 2)));
    }
}

pub(crate) fn hash(world: &World, hasher: &mut terri_core::FnvHasher) {
    let Some(surfaces) = world.get_resource::<WorldSurfaces>() else {
        return;
    };
    hasher.write_bytes(b"world-surfaces-v21");
    hasher.write_u64(surfaces.width as u64);
    hasher.write_u64(surfaces.height as u64);
    hasher.write_bytes(&surfaces.tiles);
    let mut travel = Vec::new();
    if let Some(mut query) = world.try_query::<EntityRef>() {
        for entity in query.iter(world) {
            let code = if entity.contains::<WaitingToReturn>() {
                Some(2)
            } else {
                entity.get::<terri_core::Commuting>().map(|c| {
                    if *c == terri_core::Commuting::Inbound {
                        1
                    } else {
                        0
                    }
                })
            };
            if let Some(code) = code {
                travel.push((entity.id().index_u32(), code));
            }
        }
    }
    travel.sort_unstable();
    hasher.write_u64(travel.len() as u64);
    for (entity, code) in travel {
        hasher.write_u64(entity as u64);
        hasher.write_u64(code);
    }
}
#[cfg(test)]
mod migration_tests {
    use super::*;
    #[test]
    fn recorded_legacy_cells_become_editable_edges_without_changing_existing_routes() {
        let mut sim = crate::Sim::new_with_lot(5, 5);
        sim.world_mut().remove_resource::<WorldSurfaces>();
        sim.world_mut().insert_resource(SavedLayout::LegacyCells {
            walls: vec![(2, 1), (2, 2), (2, 3)],
        });
        for y in 1..=3 {
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(2, y, true);
        }
        crate::rooms::initialize(sim.world_mut()).unwrap();
        let before = sim.world().resource::<TileGrid>().clone();
        materialize(sim.world_mut()).unwrap();
        let after = sim.world().resource::<TileGrid>();
        for y in 0..5 {
            for x in 0..5 {
                for ty in 0..5 {
                    for tx in 0..5 {
                        if before.is_walkable(x, y) && before.is_walkable(tx, ty) {
                            assert_eq!(
                                before.find_path((x, y), (tx, ty)).is_some(),
                                after.find_path((x, y), (tx, ty)).is_some()
                            );
                        }
                    }
                }
            }
        }
        let saved = sim.save_snapshot_v28();
        sim.load_snapshot_v28(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v28(), saved);
        sim.begin_build().unwrap();
        assert!(crate::placement::walls::validate_wall_edit(
            sim.world(),
            crate::placement::walls::WallEdit {
                axis: EdgeAxis::Vertical,
                x: 2,
                y: 2,
                state: terri_core::layout::WallState::Open
            }
        )
        .is_ok());
    }
    #[test]
    fn surface_dimensions_are_checked_before_nested_world_restoration() {
        let mut sim = crate::Sim::new_with_lot(5, 5);
        let before = sim.save_snapshot_v28();
        let mut malformed = before.clone();
        malformed.surfaces = WorldSurfaces {
            width: 1,
            height: 1,
            tiles: vec![0],
        };
        assert_eq!(
            sim.load_snapshot_v28(malformed),
            Err(crate::SaveError::InvalidGrid)
        );
        assert_eq!(sim.save_snapshot_v28(), before);
    }
}

#[cfg(test)]
mod generic_migration_tests {
    use super::*;
    #[test]
    fn mixed_legacy_collision_preserves_ids_and_repairs_overlapping_objects() {
        let pack =
            crate::test_content::pack(vec![crate::test_content::object("legacy_box", &[], 10)]);
        let mut sim = crate::Sim::new_with_lot_and_content(16, 12, crate::Content(pack));
        let first = sim.spawn_object(Position { x: 3., y: 4. }, terri_data::ObjectDefId(0));
        let second = sim.spawn_object(Position { x: 3., y: 4. }, terri_data::ObjectDefId(0));
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(3, 4, true);
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(8, 8, true);
        sim.world_mut()
            .insert_resource(SavedLayout::LegacyAuthoredV1);
        sim.world_mut().remove_resource::<WorldSurfaces>();
        materialize(sim.world_mut()).unwrap();
        assert_eq!(
            *sim.world().get::<Position>(first).unwrap(),
            Position { x: 3., y: 4. }
        );
        assert_eq!(
            *sim.world().get::<Position>(second).unwrap(),
            Position { x: 2., y: 4. }
        );
        assert_eq!(
            sim.world().get::<SmartObject>(first),
            sim.world().get::<SmartObject>(second)
        );
        assert!(sim.world().resource::<SavedLayout>().has_edges());
        assert!(!sim.world().resource::<TileGrid>().can_step((8, 7), (8, 8)));
        let saved = sim.save_snapshot_v28();
        sim.load_snapshot_v28(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v28(), saved);
        sim.begin_build().unwrap();
        assert!(crate::placement::walls::validate_wall_edit(
            sim.world(),
            crate::placement::walls::WallEdit {
                axis: EdgeAxis::Horizontal,
                x: 8,
                y: 8,
                state: terri_core::layout::WallState::Open
            }
        )
        .is_ok());
    }
}

#[cfg(test)]
mod access_tests {
    use super::*;
    #[test]
    fn connected_ground_beside_a_pool_cannot_replace_its_blocked_ladder() {
        for (model, ladder, width, depth) in [
            ("pool", (6, 4), 2, 2),
            ("pool_rectangular", (7, 4), 3, 2),
            ("pool_above_ground_3x4", (8, 4), 4, 3),
            ("pool_in_ground_5x7", (11, 6), 7, 5),
        ] {
            let mut sim = crate::Sim::new_with_lot(13, 13);
            let pack = sim.world().resource::<crate::Content>().0;
            let model = pack.find(model).unwrap();
            let pool = sim.spawn_object(Position { x: 4., y: 4. }, model);
            sim.world_mut()
                .entity_mut(pool)
                .insert(terri_core::ObjectFacing(terri_core::Facing::NorthWest));
            let mut grid = sim.world_mut().resource_mut::<TileGrid>();
            for x in 4..4 + width {
                for y in 4..4 + depth {
                    grid.set_blocked(x, y, true);
                }
            }
            assert!(access_report(sim.world()).blocked_targets.is_empty());
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(ladder.0, ladder.1, true);
            let report = access_report(sim.world());
            assert!(report.regions.is_empty());
            assert_eq!(report.blocked_targets.len(), 1);
            assert_eq!(report.blocked_targets[0].target, pool.index_u32());
            assert_eq!(report.blocked_targets[0].tiles.len(), width * depth);
        }
    }

    #[test]
    fn access_report_does_not_repeat_numeric_object_lookup() {
        for occupied in [false, true] {
            for count in [4, 16, 32] {
                let mut sim = crate::Sim::new_with_lot(count + 4, 5);
                let model = sim
                    .world()
                    .resource::<crate::Content>()
                    .0
                    .find("radio")
                    .unwrap();
                for x in 2..count + 2 {
                    sim.world_mut()
                        .spawn((SmartObject(model), Position { x: x as f32, y: 2. }));
                    if occupied {
                        sim.world_mut()
                            .resource_mut::<TileGrid>()
                            .set_blocked(x, 2, true);
                    }
                }
                crate::placement::OBJECT_LOOKUP_VISITS.with(|counter| counter.set(0));
                let report = access_report(sim.world());
                let visits = crate::placement::OBJECT_LOOKUP_VISITS.with(|counter| counter.get());
                assert_eq!(report, AccessReport::default());
                assert_eq!(
                    visits, 0,
                    "{count} translated objects, occupied={occupied}: repeated numeric lookup visits"
                );
            }
        }
    }
    #[test]
    fn access_report_retains_translated_footprints_facing_fallback_and_missing_data() {
        use terri_core::{Facing, Footprint, ObjectFacing};
        let mut definition = crate::test_content::object("access_fixture", &[], 10);
        definition.footprint = Footprint { width: 2, depth: 1 };
        definition.base_facing = Facing::NorthEast;
        let pack = crate::test_content::pack(vec![definition]);
        for occupied in [false, true] {
            let mut sim = crate::Sim::new_with_lot_and_content(12, 10, crate::Content(pack));
            for y in 0..10 {
                for x in 0..12 {
                    sim.world_mut()
                        .resource_mut::<TileGrid>()
                        .set_blocked(x, y, true);
                }
            }
            let fallback = sim
                .world_mut()
                .spawn((
                    SmartObject(terri_data::ObjectDefId(0)),
                    Position { x: 2., y: 2. },
                ))
                .id()
                .index_u32();
            let turned = sim
                .world_mut()
                .spawn((
                    SmartObject(terri_data::ObjectDefId(0)),
                    Position { x: 7., y: 5. },
                    ObjectFacing(Facing::SouthEast),
                ))
                .id()
                .index_u32();
            sim.world_mut()
                .spawn(SmartObject(terri_data::ObjectDefId(0)));
            sim.world_mut().spawn((
                SmartObject(terri_data::ObjectDefId(u32::MAX)),
                Position { x: 10., y: 8. },
            ));
            sim.world_mut().spawn(Position { x: 1., y: 1. });
            let footprints = [vec![(2, 2), (3, 2)], vec![(7, 5), (7, 6)]];
            if !occupied {
                for &(x, y) in footprints.iter().flatten() {
                    sim.world_mut()
                        .resource_mut::<TileGrid>()
                        .set_blocked(x as usize, y as usize, false);
                }
            }
            let regions: Vec<_> = if occupied {
                vec![]
            } else {
                footprints
                    .iter()
                    .map(|tiles| InaccessibleRegion {
                        tiles: tiles.clone(),
                        ..Default::default()
                    })
                    .collect()
            };
            let mut blocked_targets = vec![
                BlockedTarget {
                    target: fallback,
                    tiles: footprints[0].clone(),
                },
                BlockedTarget {
                    target: turned,
                    tiles: footprints[1].clone(),
                },
            ];
            blocked_targets.sort_by_key(|target| target.target);
            let expected = AccessReport {
                regions: regions.clone(),
                blocked_targets,
            };
            assert_eq!(access_report(sim.world()), expected, "occupied={occupied}");
            assert_eq!(
                access_report(sim.world()),
                expected,
                "repeat, occupied={occupied}"
            );
            sim.world_mut().remove_resource::<crate::Content>();
            assert_eq!(
                access_report(sim.world()),
                AccessReport {
                    regions,
                    blocked_targets: vec![]
                }
            );
        }
    }
    #[test]
    fn every_on_lot_person_must_reach_each_region_even_when_both_sides_have_exits() {
        let mut sim = crate::Sim::new_with_lot(5, 5);
        let edges: Vec<_> = (0..5)
            .map(|y| WallEdge {
                axis: EdgeAxis::Vertical,
                x: 2,
                y,
                doorway: false,
            })
            .collect();
        for edge in &edges {
            let [a, b] = edge.cells();
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_edge_blocked(a, b, true);
        }
        sim.world_mut()
            .insert_resource(SavedLayout::EdgeWallsV1 { edges });
        assert!(!access_report(sim.world()).requires_acknowledgment());
        let left = sim
            .world_mut()
            .spawn((Agent, Position { x: 0., y: 2. }))
            .id()
            .index_u32();
        let report = access_report(sim.world());
        assert_eq!(report.regions.len(), 1);
        assert!(report.regions[0].external_access);
        assert_eq!(report.regions[0].unreachable_by, vec![left]);
        assert!(report.regions[0].people.is_empty());
        let right = sim
            .world_mut()
            .spawn((Agent, Position { x: 4., y: 2. }))
            .id();
        let report = access_report(sim.world());
        assert_eq!(report.regions.len(), 2);
        assert_eq!(report.regions[0].unreachable_by, vec![right.index_u32()]);
        assert_eq!(report.regions[1].unreachable_by, vec![left]);
        sim.world_mut()
            .entity_mut(right)
            .insert(terri_core::AtWork { remaining_ticks: 1 });
        assert_eq!(access_report(sim.world()).regions.len(), 1);
    }
    #[test]
    fn an_object_with_no_usable_approach_reports_its_footprint() {
        let pack = crate::test_content::pack(vec![crate::test_content::object("boxed", &[], 10)]);
        let mut sim = crate::Sim::new_with_lot_and_content(5, 5, crate::Content(pack));
        let object = sim.spawn_object(Position { x: 2., y: 2. }, terri_data::ObjectDefId(0));
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(2, 2, true);
        let edges = vec![
            WallEdge {
                axis: EdgeAxis::Vertical,
                x: 2,
                y: 2,
                doorway: false,
            },
            WallEdge {
                axis: EdgeAxis::Vertical,
                x: 3,
                y: 2,
                doorway: false,
            },
            WallEdge {
                axis: EdgeAxis::Horizontal,
                x: 2,
                y: 2,
                doorway: false,
            },
            WallEdge {
                axis: EdgeAxis::Horizontal,
                x: 2,
                y: 3,
                doorway: false,
            },
        ];
        for edge in &edges {
            let [a, b] = edge.cells();
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_edge_blocked(a, b, true);
        }
        sim.world_mut()
            .insert_resource(SavedLayout::EdgeWallsV1 { edges });
        let report = access_report(sim.world());
        assert!(report.regions.is_empty());
        assert_eq!(
            report.blocked_targets,
            vec![BlockedTarget {
                target: object.index_u32(),
                tiles: vec![(2, 2)]
            }]
        );
        assert!(report.requires_acknowledgment());
    }
}

#[cfg(test)]
mod route_revalidation_tests {
    use super::*;
    use terri_core::{CommandQueue, IntentQueue, NeedId, Path, SimCommand};
    fn fixture() -> (crate::Sim, Entity, Vec<u64>) {
        let pack = crate::test_content::pack(vec![crate::test_content::object(
            "target",
            &[(NeedId::Fun, 10.)],
            100,
        )]);
        let mut sim = crate::Sim::new_with_lot_and_content(6, 6, crate::Content(pack));
        let first = sim.spawn_object(Position { x: 4., y: 1. }, terri_data::ObjectDefId(0));
        let second = sim.spawn_object(Position { x: 1., y: 4. }, terri_data::ObjectDefId(0));
        for (x, y) in [(4, 1), (1, 4)] {
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
        let actor = sim.spawn_agent(Position { x: 1., y: 1. }, 100.);
        for object in [first, second] {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObject {
                    agent: actor.index_u32(),
                    object: object.index_u32(),
                    interaction: 0,
                });
        }
        sim.flush_commands();
        sim.tick();
        assert!(sim.world().get::<Path>(actor).is_some());
        let ids = sim
            .world()
            .get::<IntentQueue>(actor)
            .unwrap()
            .entries()
            .iter()
            .map(|entry| entry.id)
            .collect();
        (sim, actor, ids)
    }
    fn sleep_fixture(alternate: bool) -> (crate::Sim, Entity, Vec<u64>) {
        let mut bed = crate::test_content::object("bed", &[(NeedId::Energy, 20.)], 100);
        bed.interactions[0].tags = vec![terri_data::pack().sleep_tag.clone()];
        bed.interactions[0].slots = 2;
        bed.sleep_places = vec![
            terri_data::SleepPlaceAccess {
                id: "owned".into(),
                approaches: if alternate {
                    vec![(-1, 0), (0, -1)]
                } else {
                    vec![(-1, 0)]
                },
            },
            terri_data::SleepPlaceAccess {
                id: "other".into(),
                approaches: vec![(1, 0)],
            },
        ];
        let pack = crate::test_content::pack(vec![bed]);
        let mut sim = crate::Sim::new_with_lot_and_content(6, 6, crate::Content(pack));
        let first = sim.spawn_object(Position { x: 4., y: 1. }, terri_data::ObjectDefId(0));
        let second = sim.spawn_object(Position { x: 1., y: 4. }, terri_data::ObjectDefId(0));
        for (x, y) in [(4, 1), (1, 4)] {
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_blocked(x, y, true);
        }
        let actor = sim.spawn_agent(Position { x: 1., y: 1. }, 100.);
        for object in [first, second] {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObject {
                    agent: actor.index_u32(),
                    object: object.index_u32(),
                    interaction: 0,
                });
        }
        sim.flush_commands();
        sim.tick();
        assert_eq!(
            sim.world().get::<terri_core::SleepPlace>(actor),
            Some(&terri_core::SleepPlace(0))
        );
        let ids = sim
            .world()
            .get::<IntentQueue>(actor)
            .unwrap()
            .entries()
            .iter()
            .map(|entry| entry.id)
            .collect();
        (sim, actor, ids)
    }
    #[test]
    fn approach_replanning_keeps_the_owned_sleep_slot_and_never_uses_another_slots_approach() {
        for alternate in [true, false] {
            let (mut sim, actor, ids) = sleep_fixture(alternate);
            let target = *sim.world().get::<terri_core::Target>(actor).unwrap();
            let assignments = sim
                .world()
                .resource::<crate::beds::BedAssignments>()
                .clone();
            sim.begin_build().unwrap();
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::SetWallEdge {
                    axis: EdgeAxis::Vertical,
                    x: 4,
                    y: 1,
                    state: terri_core::layout::WallState::Wall,
                });
            sim.flush_commands();
            let review = sim
                .prepare_build_commit(crate::rooms::RoomChoices::default())
                .unwrap();
            sim.commit_build_with_access_ack(review.token).unwrap();
            sim.end_build().unwrap();
            assert_eq!(
                sim.world().resource::<crate::beds::BedAssignments>(),
                &assignments
            );
            if alternate {
                assert_eq!(sim.world().get::<terri_core::Target>(actor), Some(&target));
                assert_eq!(
                    sim.world().get::<terri_core::SleepPlace>(actor),
                    Some(&terri_core::SleepPlace(0))
                );
                assert_eq!(
                    sim.world().get::<Path>(actor).unwrap().steps.last(),
                    Some(&(4, 0))
                );
                assert_eq!(
                    sim.world()
                        .get::<IntentQueue>(actor)
                        .unwrap()
                        .entries()
                        .iter()
                        .map(|entry| entry.id)
                        .collect::<Vec<_>>(),
                    ids
                );
            } else {
                assert!(sim.world().get::<terri_core::Target>(actor).is_none());
                assert!(sim.world().get::<terri_core::SleepPlace>(actor).is_none());
                assert_eq!(
                    sim.world()
                        .get::<IntentQueue>(actor)
                        .unwrap()
                        .entries()
                        .iter()
                        .map(|entry| entry.id)
                        .collect::<Vec<_>>(),
                    vec![ids[1]]
                );
                assert!(sim
                    .action_events_since(0)
                    .events
                    .iter()
                    .any(|event| event.order_id == ids[0] && event.phase == "failed"));
            }
            let saved = sim.save_snapshot_v28();
            sim.load_snapshot_v28(saved.clone()).unwrap();
            assert_eq!(sim.save_snapshot_v28(), saved);
        }
    }
    #[test]
    fn blocking_a_recipe_station_fails_its_origin_order_and_keeps_the_later_order() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        let pack = sim.world().resource::<crate::Content>().0;
        let actors: Vec<_> = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .collect();
        let actor = actors[0];
        for other in actors.into_iter().filter(|other| *other != actor) {
            sim.world_mut()
                .entity_mut(other)
                .insert(terri_core::Reserved);
        }
        sim.world_mut()
            .entity_mut(actor)
            .insert(terri_core::Needs::all_at(100.));
        let objects: Vec<_> = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .map(|(entity, model)| (entity, model.0))
            .collect();
        let find = |name: &str| {
            objects
                .iter()
                .find(|(_, model)| pack.object(*model).id == name)
                .unwrap()
                .0
        };
        let (fridge, stove, television) = (find("fridge"), find("stove"), find("television"));
        let model = sim.world().get::<SmartObject>(fridge).unwrap().0;
        let cook = pack
            .object(model)
            .interactions
            .iter()
            .position(|action| action.id == "cook_dinner")
            .unwrap() as u32;
        for (object, interaction) in [(fridge, cook), (television, 0)] {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObject {
                    agent: actor.index_u32(),
                    object: object.index_u32(),
                    interaction,
                });
        }
        sim.flush_commands();
        let ids = sim
            .world()
            .get::<IntentQueue>(actor)
            .unwrap()
            .entries()
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>();
        for _ in 0..2000 {
            sim.tick();
            if sim
                .world()
                .get::<terri_core::Target>(actor)
                .is_some_and(|target| target.object == stove)
                && sim.world().get::<Path>(actor).is_some()
            {
                break;
            }
        }
        assert_eq!(
            sim.world().get::<terri_core::Target>(actor).unwrap().object,
            stove
        );
        assert!(sim.world().get::<Path>(actor).is_some());
        assert_eq!(
            sim.world()
                .get::<crate::recipe_actions::RecipeOrder>(actor)
                .map(|owner| owner.0),
            Some(ids[0])
        );
        let at = *sim.world().get::<Position>(stove).unwrap();
        let model = *sim.world().get::<SmartObject>(stove).unwrap();
        let front = crate::cooking_contact(
            sim.world().resource::<TileGrid>(),
            pack,
            &model,
            &at,
            sim.world().get::<terri_core::ObjectFacing>(stove),
        )
        .unwrap();
        let fp = crate::placed_footprint(
            pack,
            model.0,
            sim.world().get::<terri_core::ObjectFacing>(stove),
        );
        let end = (front.x.round() as u32, front.y.round() as u32);
        let contact = (
            end.0.clamp(at.x as u32, at.x as u32 + fp.width - 1),
            end.1.clamp(at.y as u32, at.y as u32 + fp.depth - 1),
        );
        let (axis, x, y) = if end.0 != contact.0 {
            (EdgeAxis::Vertical, end.0.max(contact.0), end.1)
        } else {
            (EdgeAxis::Horizontal, end.0, end.1.max(contact.1))
        };
        // Represent a valid earlier point on this same owned walk, beyond any
        // occupied-contact guard. A player can place preparation stations farther
        // away; the original one-tile kitchen hop reaches the guarded contact too soon.
        let from = Position { x: 4., y: 4. };
        let route = sim
            .world()
            .resource::<TileGrid>()
            .find_path((4, 4), (end.0 as i32, end.1 as i32))
            .unwrap();
        sim.world_mut().entity_mut(actor).insert((
            from,
            Path {
                steps: route,
                cursor: 0,
            },
        ));
        let positive = sim.save_snapshot_v28();
        sim.load_snapshot_v28(positive.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v28(), positive);
        sim.begin_build().unwrap();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetWallEdge {
                axis,
                x,
                y,
                state: terri_core::layout::WallState::Wall,
            });
        sim.flush_commands();
        assert_eq!(
            sim.world()
                .resource::<crate::placement::LotEditState>()
                .last_wall_result
                .unwrap()
                .reason,
            None,
            "future contact wall must actually be accepted"
        );
        assert!(crate::cooking_contact(
            sim.world().resource::<TileGrid>(),
            pack,
            &model,
            &at,
            sim.world().get::<terri_core::ObjectFacing>(stove)
        )
        .is_none());
        let review = sim
            .prepare_build_commit(crate::rooms::RoomChoices::default())
            .unwrap();
        sim.commit_build_with_access_ack(review.token).unwrap();
        sim.end_build().unwrap();
        assert_eq!(
            sim.world()
                .get::<IntentQueue>(actor)
                .unwrap()
                .entries()
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec![ids[1]]
        );
        assert_eq!(
            sim.action_events_since(0)
                .events
                .iter()
                .filter(|event| event.order_id == ids[0] && event.phase == "failed")
                .count(),
            1
        );
        assert!(!sim
            .action_events_since(0)
            .events
            .iter()
            .any(|event| event.order_id == ids[0] && event.phase == "completed"));
        assert!(sim.world().get::<terri_core::ChainState>(actor).is_none());
        let saved = sim.save_snapshot_v28();
        sim.load_snapshot_v28(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v28(), saved);
    }
    fn build_barrier(sim: &mut crate::Sim, rows: impl Iterator<Item = u32>) {
        sim.begin_build().unwrap();
        for y in rows {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::SetWallEdge {
                    axis: EdgeAxis::Vertical,
                    x: 3,
                    y,
                    state: terri_core::layout::WallState::Wall,
                });
        }
        sim.flush_commands();
        let review = sim
            .prepare_build_commit(crate::rooms::RoomChoices::default())
            .unwrap();
        sim.commit_build_with_access_ack(review.token).unwrap();
        sim.end_build().unwrap();
    }
    #[test]
    fn a_changed_walk_replans_to_the_existing_valid_contact_without_canceling_orders() {
        let (mut sim, actor, ids) = fixture();
        build_barrier(&mut sim, std::iter::once(1));
        assert_eq!(
            sim.world()
                .get::<IntentQueue>(actor)
                .unwrap()
                .entries()
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            ids
        );
        assert!(sim.world().get::<Path>(actor).is_some());
        assert!(!sim
            .action_events_since(0)
            .events
            .iter()
            .any(|event| event.phase == "failed"));
        sim.load_snapshot_v28(sim.save_snapshot_v28()).unwrap();
    }

    #[test]
    fn a_blocked_contact_uses_another_legal_approach_without_replacing_owned_orders() {
        let (mut sim, actor, ids) = fixture();
        let target = *sim.world().get::<terri_core::Target>(actor).unwrap();
        assert_eq!(
            sim.world().get::<Path>(actor).unwrap().steps.last(),
            Some(&(3, 1))
        );
        sim.begin_build().unwrap();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::SetWallEdge {
                axis: EdgeAxis::Vertical,
                x: 4,
                y: 1,
                state: terri_core::layout::WallState::Wall,
            });
        sim.flush_commands();
        let grid = sim.world().resource::<TileGrid>();
        let from = *sim.world().get::<Position>(actor).unwrap();
        assert!(!grid.can_interact_with_rect((3, 1), (4, 1), terri_core::Footprint::SINGLE));
        assert!(grid.can_interact_with_rect((4, 0), (4, 1), terri_core::Footprint::SINGLE));
        assert!(grid
            .find_path((from.x.round() as i32, from.y.round() as i32), (4, 0))
            .is_some());
        let review = sim
            .prepare_build_commit(crate::rooms::RoomChoices::default())
            .unwrap();
        sim.commit_build_with_access_ack(review.token).unwrap();
        sim.end_build().unwrap();
        assert_eq!(sim.world().get::<terri_core::Target>(actor), Some(&target));
        assert!(sim
            .world()
            .get::<terri_core::Reserved>(target.object)
            .is_some());
        assert_eq!(
            sim.world()
                .get::<IntentQueue>(actor)
                .unwrap()
                .entries()
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            ids
        );
        let endpoint = *sim
            .world()
            .get::<Path>(actor)
            .unwrap()
            .steps
            .last()
            .unwrap();
        assert_ne!(endpoint, (3, 1));
        assert!(sim.world().resource::<TileGrid>().can_interact_with_rect(
            endpoint,
            (4, 1),
            terri_core::Footprint::SINGLE
        ));
        assert!(!sim
            .action_events_since(0)
            .events
            .iter()
            .any(|event| event.phase == "failed"));
        let saved = sim.save_snapshot_v28();
        sim.load_snapshot_v28(saved.clone()).unwrap();
        assert_eq!(sim.save_snapshot_v28(), saved);
    }
    #[test]
    fn a_cut_off_current_order_fails_once_and_keeps_the_later_queue_entry() {
        let (mut sim, actor, ids) = fixture();
        assert_eq!(ids.len(), 2);
        build_barrier(&mut sim, 0..6);
        assert_eq!(
            sim.world()
                .get::<IntentQueue>(actor)
                .unwrap()
                .entries()
                .iter()
                .map(|entry| entry.id)
                .collect::<Vec<_>>(),
            vec![ids[1]]
        );
        let events = sim.action_events_since(0);
        let failed: Vec<_> = events
            .events
            .iter()
            .filter(|event| event.phase == "failed")
            .collect();
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].order_id, ids[0]);
        assert_eq!(
            failed[0].reason.as_deref(),
            Some("The route was blocked by a building change.")
        );
        sim.load_snapshot_v28(sim.save_snapshot_v28()).unwrap();
    }
}

#[cfg(test)]
mod current_contract_tests {
    use super::*;
    #[test]
    fn historical_offlot_working_actor_requires_a_positive_load_and_current_reload() {
        let mut source = crate::Sim::new_from_shipped_lot();
        let actor = source
            .world_mut()
            .query_filtered::<Entity, With<terri_core::Career>>()
            .iter(source.world())
            .min_by_key(|actor| actor.index_u32())
            .expect("shipped worker");
        let portal = source
            .world()
            .resource::<crate::Content>()
            .0
            .lot
            .front_door
            .unwrap();
        source
            .world_mut()
            .entity_mut(actor)
            .insert(terri_core::AtWork {
                remaining_ticks: 10,
            });
        let source = source.save_snapshot();
        for position in [
            terri_core::SavedPosition {
                x: portal.0 as f32,
                y: portal.1 as f32,
            },
            terri_core::SavedPosition { x: -2., y: 1. },
        ] {
            let mut historical = source.clone();
            historical
                .entities
                .iter_mut()
                .find(|row| row.index == actor.index_u32())
                .unwrap()
                .position = Some(position);
            let mut live = crate::Sim::new_from_shipped_lot();
            live.load_snapshot(historical).expect("positive historical worker admission with unchanged shipped content and valid career");
            let current = live.save_snapshot_v28();
            let mut resumed = crate::Sim::new_from_shipped_lot();
            resumed
                .load_snapshot_v28(current.clone())
                .unwrap_or_else(|error| {
                    panic!("supported historical work at {position:?} must reload: {error:?}")
                });
            assert_eq!(resumed.save_snapshot_v28(), current);
            assert_eq!(
                resumed.world().get::<Position>(actor),
                Some(&Position {
                    x: position.x,
                    y: position.y
                })
            );
            assert_eq!(
                resumed.world().get::<terri_core::AtWork>(actor),
                Some(&terri_core::AtWork {
                    remaining_ticks: 10
                })
            );
            if position.x < 0. {
                let before = resumed.current_v5_view();
                let mut malformed = before.clone();
                malformed
                    .world
                    .entities
                    .iter_mut()
                    .find(|row| row.index == actor.index_u32())
                    .unwrap()
                    .path = Some(terri_core::save::SavedPath {
                    steps: vec![],
                    cursor: 0,
                });
                assert!(
                    resumed.load_current_v5_view(malformed).is_err(),
                    "off-lot work with a live path still requires physical route validation"
                );
                assert_eq!(resumed.current_v5_view(), before);
            }
        }
    }

    fn purchased_pair() -> crate::Sim {
        purchased_pair_model("counter", false)
    }
    fn purchased_pair_model(model: &str, enclose: bool) -> crate::Sim {
        let pack = terri_data::pack();
        let model = pack.find(model).unwrap();
        let mut live = crate::Sim::new_with_lot(6, 6);
        live.world_mut()
            .insert_resource(terri_core::Funds::from_dollars(10_000));
        live.begin_build().unwrap();
        if enclose {
            use terri_core::layout::WallState;
            for tile in 0..6 {
                for (axis, x, y) in [
                    (EdgeAxis::Vertical, 0, tile),
                    (EdgeAxis::Vertical, 6, tile),
                    (EdgeAxis::Horizontal, tile, 0),
                    (EdgeAxis::Horizontal, tile, 6),
                ] {
                    live.world_mut()
                        .resource_mut::<terri_core::CommandQueue>()
                        .push(terri_core::SimCommand::SetWallEdge {
                            axis,
                            x,
                            y,
                            state: if x == 6 && y == 3 {
                                WallState::Doorway
                            } else {
                                WallState::Wall
                            },
                        });
                }
            }
            live.flush_commands();
        }
        for (x, y) in [(1, 1), (4, 4)] {
            live.world_mut()
                .resource_mut::<terri_core::CommandQueue>()
                .push(terri_core::SimCommand::BuyObject {
                    definition: model.0,
                    x,
                    y,
                    facing: pack.object(model).base_facing,
                });
        }
        live.flush_commands();
        let review = live
            .prepare_build_commit(crate::rooms::RoomChoices::default())
            .unwrap();
        live.commit_build_with_access_ack(review.token).unwrap();
        live.end_build().unwrap();
        live
    }

    #[test]
    fn supported_legacy_occupied_overlap_normalizes_before_current_resave() {
        let source = purchased_pair();
        let mut old = source.save_snapshot_v5();
        assert!(
            old.layout.has_edges(),
            "explicit historical edge-layout source"
        );
        let original_ids: Vec<_> = old
            .world
            .entities
            .iter()
            .filter(|row| row.smart_object.is_some())
            .map(|row| (row.index, row.smart_object.clone()))
            .collect();
        let mut objects = old
            .world
            .entities
            .iter_mut()
            .filter(|row| row.smart_object.is_some());
        let first = objects.next().unwrap().position;
        objects.next().unwrap().position = first;
        let mut live = crate::Sim::new_with_lot(6, 6);
        live.load_snapshot_v5(old)
            .expect("positive supported historical occupied overlap");
        let current = live.save_snapshot_v28();
        let mut resumed = crate::Sim::new_with_lot(6, 6);
        resumed
            .load_snapshot_v28(current.clone())
            .expect("historical adoption must produce reloadable current state");
        assert_eq!(resumed.save_snapshot_v28(), current);
        let after = live.save_snapshot();
        let objects: Vec<_> = after
            .entities
            .iter()
            .filter(|row| row.smart_object.is_some())
            .collect();
        assert_eq!(
            objects
                .iter()
                .map(|row| (row.index, row.smart_object.clone()))
                .collect::<Vec<_>>(),
            original_ids
        );
        assert_ne!(
            objects[0].position, objects[1].position,
            "legacy overlap needs a legal deterministic placement before current validation"
        );
    }

    #[test]
    fn legacy_occupied_bed_relocation_preserves_permanent_assignment() {
        let mut source = purchased_pair_model("double_bed", true);
        let bed = source
            .world_mut()
            .query_filtered::<Entity, With<SmartObject>>()
            .iter(source.world())
            .max_by_key(|entity| entity.index_u32())
            .unwrap();
        let person = source.spawn_agent(Position { x: 0., y: 0. }, 100.);
        crate::beds::commit(
            source.world_mut(),
            person.index_u32(),
            Some((bed.index_u32(), 0)),
        );
        let assignments = source
            .world()
            .resource::<crate::beds::BedAssignments>()
            .clone();
        assert!(assignments.assigned_to(terri_core::SimId(0)).is_some());
        let mut old = source.save_snapshot_v5();
        let mut objects = old
            .world
            .entities
            .iter_mut()
            .filter(|row| row.smart_object.is_some());
        let first = objects.next().unwrap().position;
        objects.next().unwrap().position = first;
        let mut restored = crate::Sim::new_with_lot(6, 6);
        restored
            .load_snapshot_v5(old)
            .expect("supported historical occupied bed overlap");
        assert_eq!(
            restored.world().resource::<crate::beds::BedAssignments>(),
            &assignments
        );
        assert_ne!(
            restored.world().get::<Position>(bed),
            Some(&Position { x: 1., y: 1. })
        );
        let current = restored.save_snapshot_v28();
        restored.load_snapshot_v28(current.clone()).unwrap();
        assert_eq!(restored.save_snapshot_v28(), current);
        assert_eq!(
            restored.world().resource::<crate::beds::BedAssignments>(),
            &assignments
        );
    }

    #[test]
    fn coherent_purchased_overlap_is_distinct_from_unoccupied_developer_spawns() {
        let mut developer = crate::Sim::new_with_lot(6, 6);
        let pack = developer.world().resource::<crate::Content>().0;
        let model = pack.find("counter").unwrap();
        for _ in 0..2 {
            developer.spawn_object(Position { x: 1., y: 1. }, model);
        }
        let positive = developer.save_snapshot_v28();
        developer
            .load_snapshot_v28(positive.clone())
            .expect("supported low-level spawns do not claim grid occupancy");
        assert_eq!(developer.save_snapshot_v28(), positive);

        let mut live = purchased_pair();
        let before = live.current_v5_view();
        live.load_current_v5_view(before.clone())
            .expect("coherent purchased positive control");
        let before = live.current_v5_view();
        let mut corrupt = before.clone();
        let mut objects = corrupt
            .world
            .entities
            .iter_mut()
            .filter(|row| row.smart_object.is_some());
        let first = objects.next().unwrap().position;
        objects.next().unwrap().position = first;
        assert!(
            live.load_current_v5_view(corrupt).is_err(),
            "overlapping purchased occupancy must not replace coherent current state"
        );
        assert_eq!(live.current_v5_view(), before);
    }
    #[test]
    fn arrival_target_work_is_linear_on_open_lots_up_to_supported_size() {
        // The first small case fails before the old algorithm can attempt the
        // supported maximum. This is an operation budget, not a timing threshold.
        for side in [32usize, 128, 1024] {
            let sim = crate::Sim::new_with_lot(side, side);
            HOME_TARGET_VISITS.with(|visits| visits.set(0));
            let (entry, steps) = crate::household::arrival(sim.world()).unwrap();
            assert_eq!(entry, Position { x: 0., y: 0. });
            assert!(steps.is_empty());
            let visits = HOME_TARGET_VISITS.with(|visits| visits.get());
            assert!(
                visits <= (side * side) as u64,
                "{side}x{side} arrival inspected {visits} surface candidates"
            );
        }
    }
    #[test]
    fn arrival_matches_independent_paths_and_ties_on_small_wall_patterns() {
        for pattern in 0u32..16 {
            let mut sim = crate::Sim::new_with_lot(5, 5);
            sim.world_mut()
                .resource_mut::<WorldSurfaces>()
                .tiles
                .fill(1);
            let goals = [(1, 2), (3, 2)];
            for &(x, y) in &goals {
                sim.world_mut().resource_mut::<WorldSurfaces>().tiles[(y * 5 + x) as usize] = 0;
            }
            let mut edges = vec![];
            for y in 0..4 {
                if pattern & (1 << y) != 0 {
                    edges.push(WallEdge {
                        axis: EdgeAxis::Vertical,
                        x: 2,
                        y,
                        doorway: false,
                    });
                    sim.world_mut().resource_mut::<TileGrid>().set_edge_blocked(
                        (1, y as i32),
                        (2, y as i32),
                        true,
                    );
                }
            }
            sim.world_mut()
                .insert_resource(SavedLayout::EdgeWallsV1 { edges });
            let grid = sim.world().resource::<TileGrid>();
            let expected = boundary_tiles(sim.world(), grid)
                .into_iter()
                .flat_map(|entry| {
                    goals.into_iter().filter_map(move |goal| {
                        grid.find_path(entry, goal)
                            .map(|steps| (steps.len(), entry, goal))
                    })
                })
                .min();
            let actual = arrival_route(sim.world()).map(|(entry, steps)| {
                let entry = (entry.x as i32, entry.y as i32);
                (steps.len(), entry, steps.last().copied().unwrap_or(entry))
            });
            assert_eq!(actual, expected, "wall pattern {pattern}");
        }
    }
    #[test]
    fn arrival_returns_none_when_existing_floor_is_sealed_from_all_entries() {
        let mut sim = crate::Sim::new_with_lot(5, 5);
        sim.world_mut()
            .resource_mut::<WorldSurfaces>()
            .tiles
            .fill(1);
        sim.world_mut().resource_mut::<WorldSurfaces>().tiles[12] = 0;
        let edges = vec![
            WallEdge {
                axis: EdgeAxis::Vertical,
                x: 2,
                y: 2,
                doorway: false,
            },
            WallEdge {
                axis: EdgeAxis::Vertical,
                x: 3,
                y: 2,
                doorway: false,
            },
            WallEdge {
                axis: EdgeAxis::Horizontal,
                x: 2,
                y: 2,
                doorway: false,
            },
            WallEdge {
                axis: EdgeAxis::Horizontal,
                x: 2,
                y: 3,
                doorway: false,
            },
        ];
        for edge in &edges {
            let [a, b] = edge.cells();
            sim.world_mut()
                .resource_mut::<TileGrid>()
                .set_edge_blocked(a, b, true);
        }
        sim.world_mut()
            .insert_resource(SavedLayout::EdgeWallsV1 { edges });
        HOME_TARGET_VISITS.with(|visits| visits.set(0));
        assert!(arrival_route(sim.world()).is_none());
        assert_eq!(HOME_TARGET_VISITS.with(|visits| visits.get()), 25);
    }
    #[test]
    fn current_geometry_cannot_select_a_historical_implicit_layout() {
        let mut sim = crate::Sim::new_with_lot(4, 4);
        let before = sim.save_snapshot_v28();
        let mut malformed = before.clone();
        let rooms = malformed.room_world_v16_mut();
        rooms
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .layout = SavedLayout::LegacyCells { walls: vec![] };
        assert_eq!(
            sim.load_snapshot_v28(malformed.clone()),
            Err(crate::SaveError::InvalidGrid)
        );
        assert_eq!(sim.save_snapshot_v28(), before);
        assert!(crate::save::v20::restore(
            malformed.editable.previous.legacy.legacy.legacy.legacy,
            terri_data::pack(),
            crate::save::Carried::default()
        )
        .is_ok());
    }
    #[test]
    fn current_objects_require_saved_facings_instead_of_starting_placement_inference() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        let before = sim.save_snapshot_v28();
        let mut malformed = before.clone();
        let rooms = malformed.room_world_v16_mut();
        rooms
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .legacy
            .object_facings
            .clear();
        assert_eq!(
            sim.load_snapshot_v28(malformed),
            Err(crate::SaveError::InvalidValue)
        );
        assert_eq!(sim.save_snapshot_v28(), before);
    }
}

#[cfg(test)]
mod door_model_tests {
    use super::*;
    #[test]
    fn a_player_door_uses_catalogue_art_without_any_starting_portal_instance() {
        let mut sim = crate::Sim::new_with_lot(5, 5);
        assert!(sim
            .world()
            .get_resource::<crate::portals::ActivePortals>()
            .is_none());
        sim.begin_build().unwrap();
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::SetWallEdge {
                axis: EdgeAxis::Vertical,
                x: 2,
                y: 2,
                state: terri_core::layout::WallState::Doorway,
            });
        sim.flush_commands();
        sim.sync_render_buffer_after_commands();
        assert_eq!(sim.portal_buffer().states.len(), 1);
        assert!(crate::portals::front_door_lines(sim.world()).is_empty());
        let review = sim
            .prepare_build_commit(crate::rooms::RoomChoices::default())
            .unwrap();
        sim.commit_build_with_access_ack(review.token).unwrap();
        sim.end_build().unwrap();
        let mut restored = crate::Sim::new_with_lot(1, 1);
        restored.load_snapshot_v28(sim.save_snapshot_v28()).unwrap();
        assert_eq!(restored.portal_buffer().states.len(), 1);
        assert_eq!(restored.portal_buffer().frames, sim.portal_buffer().frames);
    }
}
