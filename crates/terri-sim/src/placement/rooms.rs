//! Building a room: wall the outline of a rectangle of tiles in one edit -
//! [RT-rules] and [RT-apply] in `docs/specs/2026-09-22-room-tool.md`.
//!
//! A room is many walls validated as one candidate. Every new wall is held to
//! the single-wall rules through `check_new_walls`, and the usability proofs
//! and the loader's checks run once, on the finished room, so a room whose
//! doorway lets a sim in is not refused wall by wall on the way there.

use super::walls::check_new_walls;
use super::{current_layout, CurrentLayout, LotEditState, PlacementRefusal};
use bevy_ecs::prelude::*;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge, WallLine};
use terri_core::TileGrid;

/// One requested room: two opposite corner tiles, in either order, and the
/// line of its outline to leave passable, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoomEdit {
    pub x0: u32,
    pub y0: u32,
    pub x1: u32,
    pub y1: u32,
    pub doorway: Option<WallLine>,
}

/// What the drain did with the most recent room. `reason` is `None` when it
/// was built, including when its outline was already built exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoomEditResult {
    pub edit: RoomEdit,
    pub reason: Option<PlacementRefusal>,
}

/// A validated room, owned and ready to write. `changed` is false when the
/// outline already stood exactly as asked; nothing is written then.
#[derive(Debug)]
pub struct RoomPlan {
    pub changed: bool,
    edges: Vec<WallEdge>,
    grid: TileGrid,
}

/// The interior lines on the edge of the rectangle of tiles from `top_left`
/// to `bottom_right`, both included, in [RT-apply]'s order: the top side, then
/// the bottom side, left to right; then the left side, then the right side,
/// top to bottom. Lines on the lot's own edge are the outside wall and are
/// left out. Both corners must already be inside the lot.
pub fn outline(
    width: u32,
    height: u32,
    top_left: (u32, u32),
    bottom_right: (u32, u32),
) -> Vec<WallLine> {
    let (left, top) = top_left;
    let (right, bottom) = bottom_right;
    let across = |y| {
        (left..=right).map(move |x| WallLine {
            axis: EdgeAxis::Horizontal,
            x,
            y,
        })
    };
    let down = |x| {
        (top..=bottom).map(move |y| WallLine {
            axis: EdgeAxis::Vertical,
            x,
            y,
        })
    };
    across(top)
        .chain(across(bottom + 1))
        .chain(down(left))
        .chain(down(right + 1))
        .filter(|line| record(*line, false).in_bounds(width, height))
        .collect()
}

fn record(line: WallLine, doorway: bool) -> WallEdge {
    WallEdge {
        axis: line.axis,
        x: line.x,
        y: line.y,
        doorway,
    }
}

/// Produces a complete owned transaction; no mutation and no random draws.
///
/// The checks run in the order [RT-rules] lists.
pub fn validate_room(world: &World, edit: RoomEdit) -> Result<RoomPlan, PlacementRefusal> {
    use PlacementRefusal::*;
    let Some(SavedLayout::EdgeWallsV1 { edges }) = world.get_resource::<SavedLayout>() else {
        return Err(UnsupportedLayout);
    };
    let CurrentLayout { rectangles, .. } = current_layout(world)?;
    let live = world.resource::<TileGrid>();
    let (width, height) = (live.width() as u32, live.height() as u32);
    if edit.x0.max(edit.x1) >= width || edit.y0.max(edit.y1) >= height {
        return Err(OutOfBounds);
    }
    let lines = outline(
        width,
        height,
        (edit.x0.min(edit.x1), edit.y0.min(edit.y1)),
        (edit.x0.max(edit.x1), edit.y0.max(edit.y1)),
    );
    if edit.doorway.is_some_and(|door| !lines.contains(&door)) {
        return Err(InvalidInput);
    }

    // A line already a doorway stays one, a line already a wall stays one
    // unless it is the doorway asked for, and an open line becomes a wall or
    // the doorway. New records are appended in outline order and changed ones
    // updated where they are, never re-sorted - [RT-apply].
    let mut next = edges.clone();
    let mut grid = live.clone();
    let mut walls = Vec::new();
    let mut changed = false;
    let front = crate::portals::front_door_lines(world);
    for line in lines {
        let doorway = edit.doorway == Some(line);
        let [a, b] = record(line, doorway).cells();
        match next
            .iter()
            .position(|e| e.axis == line.axis && e.x == line.x && e.y == line.y)
        {
            Some(index) if doorway && !next[index].doorway => {
                next[index].doorway = true;
                grid.set_edge_blocked(a, b, false);
                changed = true;
            }
            Some(_) => {}
            // [OS-door]: an open front-door line is the room's doorway or
            // is refused, since a wall there would shut the door.
            None if !doorway
                && line.axis == EdgeAxis::Vertical
                && front.contains(&(line.x, line.y)) =>
            {
                return Err(BlockedDoor);
            }
            None => {
                next.push(record(line, doorway));
                grid.set_edge_blocked(a, b, !doorway);
                if !doorway {
                    walls.push([a, b]);
                }
                changed = true;
            }
        }
    }
    if !changed {
        return Ok(RoomPlan {
            changed: false,
            edges: edges.clone(),
            grid: live.clone(),
        });
    }
    // Only new walls can cut anything off; a doorway made from a wall only
    // removes a barrier, as for a single line.
    if !walls.is_empty() {
        check_new_walls(world, &rectangles, &grid, &walls)?;
    }
    Ok(RoomPlan {
        changed: true,
        edges: next,
        grid,
    })
}

/// Revalidation and writes happen in one exclusive command drain.
pub(crate) fn commit(world: &mut World, edit: RoomEdit) {
    let result = validate_room(world, edit);
    let reason = result.as_ref().err().copied();
    if let Ok(plan) = result {
        if plan.changed {
            world.insert_resource(plan.grid);
            world.insert_resource(SavedLayout::EdgeWallsV1 { edges: plan.edges });
            let mut state = world.resource_mut::<LotEditState>();
            state.revision = state.revision.saturating_add(1);
        }
    }
    world.resource_mut::<LotEditState>().last_room_result = Some(RoomEditResult { edit, reason });
}

#[cfg(test)]
#[path = "room_tests.rs"]
mod tests;
