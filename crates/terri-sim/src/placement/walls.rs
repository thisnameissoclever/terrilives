//! Wall edits: make one boundary between two tiles open, a wall, or a
//! doorway - [WT-rules] and [WT-apply] in `docs/specs/2026-09-21-wall-tool.md`.
//!
//! Preview and commit share [`validate_wall_edit`], exactly as furniture
//! preview and commit share `validate_placement`. Both preserve physical layout
//! invariants; current accessibility is reviewed separately during Build
//! preparation. Frozen historical worlds retain their entrance rules.

use super::{
    crosses_wall, current_layout, prove_lot_usable, CurrentLayout, LotEditState, PlacementRefusal,
    Rectangle,
};
use bevy_ecs::prelude::*;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge, WallState};
use terri_core::{Agent, Position, SmartObject, Target, TileGrid};

/// One requested edit: this boundary, in this state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WallEdit {
    pub axis: EdgeAxis,
    pub x: u32,
    pub y: u32,
    pub state: WallState,
}

/// What the drain did with the most recent wall edit. `reason` is `None` when
/// the edit was applied, including when it asked for the state the line
/// already had.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WallEditResult {
    pub edit: WallEdit,
    pub reason: Option<PlacementRefusal>,
}

/// A validated edit, owned and ready to write. `changed` is false when the
/// line already had the requested state; nothing is written then.
#[derive(Debug)]
pub struct WallPlan {
    pub changed: bool,
    layout: SavedLayout,
    grid: TileGrid,
}

/// A sim, the tiles it stands on, and what it is walking to or using.
struct Standing {
    tiles: [(i32, i32); 4],
    target: Option<Entity>,
    /// Still on the way, with steps left; the loader judges the contact at the walk's end.
    walking: bool,
}

/// Whether the barriers are being built now or already stood when the world was saved.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Barriers {
    New,
    Standing,
}

/// The tiles a sim standing at `position` touches: one, two or four, the same
/// floor and ceiling pairs the placement proofs read.
fn tiles_under(position: &Position) -> [(i32, i32); 4] {
    let (x0, x1) = (position.x.floor() as i32, position.x.ceil() as i32);
    let (y0, y1) = (position.y.floor() as i32, position.y.ceil() as i32);
    [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]
}

fn rectangle_holds(rect: &Rectangle, (x, y): (i32, i32)) -> bool {
    x >= rect.origin.0 as i32
        && y >= rect.origin.1 as i32
        && x < (rect.origin.0 + rect.footprint.width) as i32
        && y < (rect.origin.1 + rect.footprint.depth) as i32
}

/// Physical barrier validation under [WT-rules], run against the candidate grid.
/// A single wall passes one pair of tiles and a room its whole outline
/// ([RT-rules]). Each check runs over every wall before the next check starts,
/// giving refusals a stable priority. Frozen historical worlds also retain
/// entrance guards. Only new barriers are passed; openings remove barriers.
pub(super) fn check_new_walls(
    world: &World,
    rectangles: &[Rectangle],
    grid: &TileGrid,
    walls: &[[(i32, i32); 2]],
) -> Result<(), PlacementRefusal> {
    check_barriers(world, rectangles, grid, walls, Barriers::New)
}

/// The same rules for barriers a loaded world already has, such as its windows.
/// Someone walking past one, round to what lies behind it, is not using that
/// through it: live play makes that state, so refusing it would refuse a
/// save. Someone who has arrived is held to the rule as a new wall would be.
pub(super) fn check_standing_barriers(
    world: &World,
    rectangles: &[Rectangle],
    grid: &TileGrid,
    walls: &[[(i32, i32); 2]],
) -> Result<(), PlacementRefusal> {
    check_barriers(world, rectangles, grid, walls, Barriers::Standing)
}

fn check_barriers(
    world: &World,
    rectangles: &[Rectangle],
    grid: &TileGrid,
    walls: &[[(i32, i32); 2]],
    barriers: Barriers,
) -> Result<(), PlacementRefusal> {
    use PlacementRefusal::*;
    // Frozen formats preserve their entrance landing rule. Current geometry
    // reviews accessibility separately and has no protected starting door.
    let door = crate::lot_frame::front_portal(world)
        .filter(|_| !crate::world_geometry::current(world))
        .map(|portal| {
            (
                (portal.position.0 as i32, portal.position.1 as i32),
                (portal.inward.0 as i32, portal.inward.1 as i32),
            )
        });
    if walls.iter().any(|&[a, b]| {
        door.is_some_and(|(door, landing)| (a, b) == (door, landing) || (a, b) == (landing, door))
    }) {
        return Err(BlockedLanding);
    }
    if rectangles.iter().any(|&rect| crosses_wall(rect, grid)) {
        return Err(WallOverlap);
    }
    // Nothing registered as a sim yet means there are no sims to wall in.
    // Every check below asks whether ANY sim matches, so the order the query
    // returns them in cannot change an answer.
    let standing: Vec<Standing> = world
        .try_query_filtered::<(Entity, &Position), With<Agent>>()
        .map(|mut agents| {
            agents
                .iter(world)
                .filter(|(entity, _)| !crate::world_geometry::hidden_away(world, *entity))
                .map(|(entity, position)| Standing {
                    tiles: tiles_under(position),
                    target: world.get::<Target>(entity).map(|t| t.object),
                    walking: world
                        .get::<terri_core::Path>(entity)
                        .is_some_and(|path| path.next_step().is_some()),
                })
                .collect()
        })
        .unwrap_or_default();
    if walls.iter().any(|&[a, b]| {
        standing
            .iter()
            .any(|sim| sim.tiles.contains(&a) && sim.tiles.contains(&b))
    }) {
        return Err(SimOverlap);
    }
    // A wall must not come down between a sim and the thing it is using or
    // the person it is talking to: it would carry on through the wall.
    for Standing {
        tiles,
        target,
        walking,
    } in &standing
    {
        let Some(target) = *target else {
            continue;
        };
        if *walking && barriers == Barriers::Standing {
            continue;
        }
        let across = |mine: (i32, i32), theirs: (i32, i32)| {
            tiles.contains(&mine)
                && if world.get::<SmartObject>(target).is_some() {
                    rectangles
                        .iter()
                        .any(|rect| rect.entity == Some(target) && rectangle_holds(rect, theirs))
                } else {
                    !crate::world_geometry::hidden_away(world, target)
                        && world
                            .get::<Position>(target)
                            .is_some_and(|p| tiles_under(p).contains(&theirs))
                }
        };
        if walls.iter().any(|&[a, b]| across(a, b) || across(b, a)) {
            return Err(InUse);
        }
    }
    prove_lot_usable(world, grid, rectangles)?;
    // Delegate candidate-load validation to the save layer. Current edits may
    // leave routes for Build preparation to reconcile; the save layer checks
    // the validated source when required. Historical validation retains route
    // endpoint and portal-return checks, including its entrance rules.
    crate::save::candidate_grid_loads(world, grid).map_err(|problem| match problem {
        crate::save::LoadProblem::PortalReturn => BlockedLanding,
        crate::save::LoadProblem::EdgeWorld => BlockedRoute,
    })
}

/// Preserve occupied ground when opening a current boundary; Build preparation
/// reviews accessibility separately. Historical worlds also check furniture
/// approaches and common-region access. Refuse only a newly introduced failure
/// so an already disconnected layout can still be repaired.
pub(super) fn keep_usable(
    world: &World,
    rectangles: &[Rectangle],
    grid: &TileGrid,
) -> Result<(), PlacementRefusal> {
    match prove_lot_usable(world, grid, rectangles) {
        Err(refusal)
            if prove_lot_usable(world, world.resource::<TileGrid>(), rectangles).is_ok() =>
        {
            Err(refusal)
        }
        _ => Ok(()),
    }
}

/// Produces a complete owned transaction; no mutation and no random draws.
///
/// Physical checks have a fixed refusal priority under [WT-rules]. Historical
/// entrance guards remain scoped to worlds without current explicit geometry.
pub fn validate_wall_edit(world: &World, edit: WallEdit) -> Result<WallPlan, PlacementRefusal> {
    use PlacementRefusal::*;
    let Some(layout) = world
        .get_resource::<SavedLayout>()
        .filter(|l| l.has_edges())
    else {
        // A legacy household keeps its frozen walls. Guessing an edge list
        // for it would rewrite a house the player never touched.
        return Err(UnsupportedLayout);
    };
    let edges = layout.edges();
    let CurrentLayout { rectangles, .. } = current_layout(world)?;
    let live = world.resource::<TileGrid>();
    let line = WallEdge {
        axis: edit.axis,
        x: edit.x,
        y: edit.y,
        doorway: edit.state == WallState::Doorway,
    };
    let requested_line = terri_core::layout::WallLine {
        axis: edit.axis,
        x: edit.x,
        y: edit.y,
    };
    let owner = layout.window_at(requested_line);
    // A rear window can be restored to shell, but never opened as a wall edit.
    let (width, height) = (live.width() as u32, live.height() as u32);
    let house = crate::world_geometry::historical_house(world);
    let rear_restore = owner.is_some()
        && super::windows::is_rear(requested_line, house)
        && edit.state == WallState::Wall;
    let rear_shell = |segment| {
        super::windows::is_rear(segment, house)
            && super::windows::window_line_in_bounds(segment, width, height, house)
    };
    // [WT-rules]: a wall on the lot's edge may also be a doorway or a window.
    let perimeter_edit = line.physical_in_bounds(width, height) && !rear_shell(requested_line);
    // With bought land beyond it a shell line lies inside the grid, but
    // it is still the shell: only glazing and restoring glass may touch it.
    if rear_shell(requested_line) && !rear_restore && edit.state != WallState::Window {
        return Err(OutOfBounds);
    }
    if !rear_restore && !line.in_bounds(width, height) && !perimeter_edit {
        return Err(OutOfBounds);
    }
    // Historical [OS-door] guard; current front_door_lines is empty.
    // Opening the line or glazing nothing cuts nobody's way, so only a
    // barrier is refused, and a window is one ([WN-rules]).
    if edit.state.blocks_movement()
        && edit.axis == EdgeAxis::Vertical
        && crate::portals::front_door_lines(world).contains(&(edit.x, edit.y))
    {
        return Err(BlockedDoor);
    }

    if layout.state_of(requested_line) == edit.state {
        return Ok(WallPlan {
            changed: false,
            layout: layout.clone(),
            grid: live.clone(),
        });
    }
    let mut next = edges.to_vec();
    let mut windows = layout.window_placements();
    let mut affected = vec![requested_line];
    if let Some(owner) = owner {
        affected = owner.checked_lines().ok_or(OutOfBounds)?;
        windows.retain(|w| *w != owner);
        // Doorway edits open only the clicked segment; the rest becomes wall.
        if edit.state == WallState::Doorway {
            let remaining: Vec<_> = affected
                .iter()
                .copied()
                .filter(|l| *l != requested_line)
                .collect();
            super::windows::restore_solid(&mut next, &remaining, house);
        }
    }
    let edited = if edit.state == WallState::Doorway {
        vec![requested_line]
    } else {
        affected.clone()
    };
    for &segment in &edited {
        let existing = next
            .iter()
            .position(|e| e.axis == segment.axis && e.x == segment.x && e.y == segment.y);
        match (existing, edit.state) {
            (Some(index), WallState::Open | WallState::Window) => {
                next.remove(index);
            }
            (Some(index), state) => next[index].doorway = state == WallState::Doorway,
            (None, WallState::Open | WallState::Window) => {}
            (None, _) if !rear_shell(segment) => next.push(super::windows::record(
                segment,
                edit.state == WallState::Doorway,
            )),
            (None, _) => {}
        }
    }
    if edit.state == WallState::Window {
        windows.push(terri_core::windows::WindowPlacement {
            line: requested_line,
            model: terri_core::windows::WindowModel::Sash,
        });
    }
    let candidate = super::windows::with_architecture(layout, next, windows);
    super::windows::validate_window_layout(
        &candidate,
        live.width() as u32,
        live.height() as u32,
        crate::world_geometry::historical_house(world),
    )?;
    let mut grid = live.clone();
    let mut barriers = Vec::new();
    for segment in affected {
        let edge = super::windows::record(segment, false);
        if !edge.in_bounds(width, height) {
            continue;
        }
        let [a, b] = edge.cells();
        let blocked = candidate.state_of(segment).blocks_movement();
        grid.set_edge_blocked(a, b, blocked);
        if blocked {
            barriers.push([a, b]);
        }
    }
    if !barriers.is_empty() {
        check_new_walls(world, &rectangles, &grid, &barriers)?;
    } else if candidate != *layout {
        keep_usable(world, &rectangles, &grid)?;
    }
    Ok(WallPlan {
        changed: candidate != *layout,
        layout: candidate,
        grid,
    })
}

/// Revalidation and writes happen in one exclusive command drain.
pub(crate) fn commit(world: &mut World, edit: WallEdit) {
    let result = validate_wall_edit(world, edit);
    let reason = result.as_ref().err().copied();
    if let Ok(plan) = result {
        if plan.changed {
            world.insert_resource(plan.grid);
            world.insert_resource(plan.layout);
            let mut state = world.resource_mut::<LotEditState>();
            state.revision = state.revision.saturating_add(1);
        }
    }
    world.resource_mut::<LotEditState>().last_wall_result = Some(WallEditResult { edit, reason });
}

#[cfg(test)]
#[path = "wall_tests.rs"]
pub(crate) mod tests;
