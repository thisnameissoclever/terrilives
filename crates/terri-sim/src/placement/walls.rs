//! Wall edits: make one boundary between two tiles open, a wall, or a
//! doorway - [WT-rules] and [WT-apply] in `docs/specs/2026-09-21-wall-tool.md`.
//!
//! Preview and commit share [`validate_wall_edit`], exactly as furniture
//! preview and commit share `validate_placement`, and the two validators share
//! the layout check and the usability proofs, so a wall can never be accepted
//! by a rule a sofa would be refused by.

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
    edges: Vec<WallEdge>,
    grid: TileGrid,
}

/// A sim, the tiles it stands on, and what it is walking to or using.
struct Standing {
    entity: Entity,
    tiles: [(i32, i32); 4],
    target: Option<Entity>,
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

/// Produces a complete owned transaction; no mutation and no random draws.
///
/// The checks run in the order [WT-rules] lists, so the reason a player reads
/// is the first thing wrong, not whichever check happened to run first.
pub fn validate_wall_edit(world: &World, edit: WallEdit) -> Result<WallPlan, PlacementRefusal> {
    use PlacementRefusal::*;
    let Some(SavedLayout::EdgeWallsV1 { edges }) = world.get_resource::<SavedLayout>() else {
        // A legacy household keeps its frozen walls. Guessing an edge list
        // for it would rewrite a house the player never touched.
        return Err(UnsupportedLayout);
    };
    let CurrentLayout { rectangles, .. } = current_layout(world)?;
    let live = world.resource::<TileGrid>();
    let line = WallEdge {
        axis: edit.axis,
        x: edit.x,
        y: edit.y,
        doorway: edit.state == WallState::Doorway,
    };
    // Interior boundaries only: the outside wall belongs with [B-outside].
    if !line.in_bounds(live.width() as u32, live.height() as u32) {
        return Err(OutOfBounds);
    }

    let existing = edges
        .iter()
        .position(|e| e.axis == edit.axis && e.x == edit.x && e.y == edit.y);
    if WallState::of(existing.map(|index| &edges[index])) == edit.state {
        return Ok(WallPlan {
            changed: false,
            edges: edges.clone(),
            grid: live.clone(),
        });
    }

    // The record is updated where it is, appended when new and removed when
    // opened. Never re-sorted, so the same edits in the same order give the
    // same save bytes - [WT-apply].
    let mut next = edges.clone();
    match (existing, edit.state) {
        (Some(index), WallState::Open) => {
            next.remove(index);
        }
        (Some(index), state) => next[index].doorway = state == WallState::Doorway,
        (None, WallState::Open) => unreachable!("an absent record is already open"),
        (None, _) => next.push(line),
    }
    let [a, b] = line.cells();
    let mut grid = live.clone();
    grid.set_edge_blocked(a, b, edit.state == WallState::Wall);

    // Opening a line or making it a doorway only ever removes a barrier, so
    // it cannot cut anything off. Running the proofs for it would refuse to
    // mend a house that was already in trouble.
    if edit.state == WallState::Wall {
        if rectangles.iter().any(|&rect| crosses_wall(rect, &grid)) {
            return Err(WallOverlap);
        }
        // Nothing registered as a sim yet means there are no sims to wall in.
        let mut standing: Vec<Standing> = world
            .try_query_filtered::<(Entity, &Position), With<Agent>>()
            .map(|mut agents| {
                agents
                    .iter(world)
                    .map(|(entity, position)| Standing {
                        entity,
                        tiles: tiles_under(position),
                        target: world.get::<Target>(entity).map(|t| t.object),
                    })
                    .collect()
            })
            .unwrap_or_default();
        standing.sort_by_key(|sim| sim.entity.index());
        if standing
            .iter()
            .any(|sim| sim.tiles.contains(&a) && sim.tiles.contains(&b))
        {
            return Err(SimOverlap);
        }
        // A wall must not come down between a sim and the thing it is using
        // or the person it is talking to: it would carry on through the wall.
        for Standing { tiles, target, .. } in &standing {
            let Some(target) = *target else {
                continue;
            };
            let across = |mine: (i32, i32), theirs: (i32, i32)| {
                tiles.contains(&mine)
                    && if world.get::<SmartObject>(target).is_some() {
                        rectangles
                            .iter()
                            .any(|rect| rect.entity == target && rectangle_holds(rect, theirs))
                    } else {
                        world
                            .get::<Position>(target)
                            .is_some_and(|p| tiles_under(p).contains(&theirs))
                    }
            };
            if across(a, b) || across(b, a) {
                return Err(InUse);
            }
        }
        prove_lot_usable(world, &grid, &rectangles)?;
    }

    Ok(WallPlan {
        changed: true,
        edges: next,
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
            world.insert_resource(SavedLayout::EdgeWallsV1 { edges: plan.edges });
            let mut state = world.resource_mut::<LotEditState>();
            state.revision = state.revision.saturating_add(1);
        }
    }
    world.resource_mut::<LotEditState>().last_wall_result = Some(WallEditResult { edit, reason });
}

#[cfg(test)]
#[path = "wall_tests.rs"]
mod tests;
