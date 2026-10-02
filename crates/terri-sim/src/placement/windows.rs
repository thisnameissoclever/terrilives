//! Whole-window edits. Validation owns the finished layout before anything is written.

use super::{current_layout, walls::check_new_walls, LotEditState, PlacementRefusal};
use crate::Content;
use bevy_ecs::prelude::*;
use std::collections::BTreeSet;
use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge, WallLine, WallState};
use terri_core::windows::WindowPlacement;
use terri_core::TileGrid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowEdit {
    Fit(WindowPlacement),
    Remove(WallLine),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowEditResult {
    pub edit: WindowEdit,
    pub reason: Option<PlacementRefusal>,
}

#[derive(Debug)]
pub struct WindowPlan {
    pub changed: bool,
    pub placement: Option<WindowPlacement>,
    pub affected_lines: Vec<WallLine>,
    layout: SavedLayout,
    grid: TileGrid,
}

pub(crate) fn record(line: WallLine, doorway: bool) -> WallEdge {
    WallEdge {
        axis: line.axis,
        x: line.x,
        y: line.y,
        doorway,
    }
}

pub(crate) fn is_rear(line: WallLine) -> bool {
    match line.axis {
        EdgeAxis::Vertical => line.x == 0,
        EdgeAxis::Horizontal => line.y == 0,
    }
}

/// Rear glazing belongs only to the house's implicit north/west shell.
pub fn window_line_in_bounds(line: WallLine, width: u32, height: u32, house: (u32, u32)) -> bool {
    if is_rear(line) {
        match line.axis {
            EdgeAxis::Vertical => line.y < height.min(house.1),
            EdgeAxis::Horizontal => line.x < width.min(house.0),
        }
    } else {
        record(line, false).in_bounds(width, height)
    }
}

/// A perpendicular boundary meeting an internal aperture vertex cuts the window.
fn crosses_aperture(window: WindowPlacement, other: WallLine) -> bool {
    let start = window.line;
    if start.axis == other.axis {
        return false;
    }
    match start.axis {
        EdgeAxis::Vertical => {
            other.y > start.y
                && (other.y as u64) < start.y as u64 + window.model.width() as u64
                && (other.x == start.x || other.x.checked_add(1) == Some(start.x))
        }
        EdgeAxis::Horizontal => {
            other.x > start.x
                && (other.x as u64) < start.x as u64 + window.model.width() as u64
                && (other.y == start.y || other.y.checked_add(1) == Some(start.y))
        }
    }
}

/// Shared edit/load geometry proof. Legacy one-line windows retain their rules.
pub fn validate_window_layout(
    layout: &SavedLayout,
    width: u32,
    height: u32,
    house: (u32, u32),
) -> Result<(), PlacementRefusal> {
    use PlacementRefusal::*;
    let mut seen = BTreeSet::new();
    for edge in layout.edges() {
        if !edge.in_bounds(width, height) {
            return Err(OutOfBounds);
        }
        if !seen.insert((edge.axis, edge.x, edge.y)) {
            return Err(WallOverlap);
        }
    }
    let windows = layout.window_placements();
    for window in &windows {
        let lines = window.checked_lines().ok_or(OutOfBounds)?;
        for line in lines {
            if !window_line_in_bounds(line, width, height, house)
                || (is_rear(line) && !matches!(layout, SavedLayout::EdgeWallsV3 { .. }))
            {
                return Err(OutOfBounds);
            }
            if !seen.insert((line.axis, line.x, line.y)) {
                return Err(WallOverlap);
            }
        }
    }
    for window in windows {
        // Bounds above prove the span fits; use wider arithmetic in the
        // junction comparison so a hostile u32 endpoint cannot overflow.
        if seen
            .iter()
            .any(|&(axis, x, y)| crosses_aperture(window, WallLine { axis, x, y }))
        {
            return Err(WindowJunction);
        }
    }
    Ok(())
}

/// Existing writers keep typed descriptors and preserve untouched variants.
pub(crate) fn with_architecture(
    original: &SavedLayout,
    edges: Vec<WallEdge>,
    windows: Vec<WindowPlacement>,
) -> SavedLayout {
    match original {
        SavedLayout::EdgeWallsV3 { .. } => SavedLayout::from_window_placements(edges, windows),
        SavedLayout::EdgeWallsV2 { .. } if windows == original.window_placements() => {
            SavedLayout::EdgeWallsV2 {
                edges,
                windows: windows.into_iter().map(|w| w.line).collect(),
            }
        }
        _ => SavedLayout::from_parts(edges, windows.into_iter().map(|w| w.line).collect()),
    }
}

pub(crate) fn restore_solid(edges: &mut Vec<WallEdge>, lines: &[WallLine]) {
    for &line in lines {
        if !is_rear(line) {
            edges.push(record(line, false));
        }
    }
}

/// V3 restores obey the same occupied-route and usability proofs as edits.
pub(crate) fn validate_restored_windows(world: &World) -> Result<(), PlacementRefusal> {
    let current = current_layout(world)?;
    let grid = world.resource::<TileGrid>();
    let layout = world.resource::<SavedLayout>();
    let front = crate::portals::front_door_lines(world);
    let lines = layout.window_lines();
    if lines
        .iter()
        .any(|line| line.axis == EdgeAxis::Vertical && front.contains(&(line.x, line.y)))
    {
        return Err(PlacementRefusal::BlockedDoor);
    }
    let walls: Vec<_> = lines
        .into_iter()
        .filter(|&line| !is_rear(line))
        .map(|line| record(line, false).cells())
        .collect();
    check_new_walls(world, &current.rectangles, grid, &walls)
}

pub fn validate_window_edit(
    world: &World,
    edit: WindowEdit,
) -> Result<WindowPlan, PlacementRefusal> {
    use PlacementRefusal::*;
    let layout = world
        .get_resource::<SavedLayout>()
        .filter(|l| l.has_edges())
        .ok_or(UnsupportedLayout)?;
    let current = current_layout(world)?;
    let live = world.resource::<TileGrid>();
    let house = world.resource::<Content>().0.lot.house;
    let clicked = match edit {
        WindowEdit::Fit(w) => w.line,
        WindowEdit::Remove(line) => line,
    };
    if !window_line_in_bounds(clicked, live.width() as u32, live.height() as u32, house) {
        return Err(OutOfBounds);
    }
    let owner = layout.window_at(clicked);
    let mut edges = layout.edges().to_vec();
    let mut windows = layout.window_placements();
    let mut affected_lines = Vec::new();
    if let Some(owner) = owner {
        affected_lines = owner.checked_lines().ok_or(OutOfBounds)?;
        windows.retain(|w| *w != owner);
        restore_solid(&mut edges, &affected_lines);
    }
    let placement = match edit {
        WindowEdit::Fit(mut window) => {
            // A click inside an existing window selects its canonical start.
            if let Some(owner) = owner {
                window.line = owner.line;
            }
            let lines = window.checked_lines().ok_or(OutOfBounds)?;
            for &line in &lines {
                if !window_line_in_bounds(line, live.width() as u32, live.height() as u32, house) {
                    return Err(OutOfBounds);
                }
                if line.axis == EdgeAxis::Vertical
                    && crate::portals::front_door_lines(world).contains(&(line.x, line.y))
                {
                    return Err(BlockedDoor);
                }
                let selected = owner.is_some_and(|w| w.lines().contains(&line));
                let solid_wall = layout.state_of(line) == WallState::Wall
                    || (is_rear(line) && layout.window_at(line).is_none());
                if !(selected || solid_wall) {
                    return Err(WindowRequiresWall);
                }
                if !affected_lines.contains(&line) {
                    affected_lines.push(line);
                }
            }
            edges.retain(|edge| {
                !lines.contains(&WallLine {
                    axis: edge.axis,
                    x: edge.x,
                    y: edge.y,
                })
            });
            windows.push(window);
            Some(window)
        }
        WindowEdit::Remove(_) => {
            if owner.is_none() {
                return Ok(WindowPlan {
                    changed: false,
                    placement: None,
                    affected_lines,
                    layout: layout.clone(),
                    grid: live.clone(),
                });
            }
            None
        }
    };
    let candidate = SavedLayout::from_window_placements(edges, windows);
    validate_window_layout(&candidate, live.width() as u32, live.height() as u32, house)?;
    let mut grid = live.clone();
    let walls: Vec<_> = affected_lines
        .iter()
        .filter(|&&line| !is_rear(line))
        .map(|&line| record(line, false).cells())
        .collect();
    for &[a, b] in &walls {
        grid.set_edge_blocked(a, b, true);
    }
    check_new_walls(world, &current.rectangles, &grid, &walls)?;
    let changed = match (edit, owner) {
        (WindowEdit::Fit(_), Some(old))
            if Some(old) == placement && matches!(layout, SavedLayout::EdgeWallsV3 { .. }) =>
        {
            false
        }
        _ => candidate != *layout,
    };
    Ok(WindowPlan {
        changed,
        placement,
        affected_lines,
        layout: candidate,
        grid,
    })
}

pub fn apply_window_edit(world: &mut World, edit: WindowEdit) -> WindowEditResult {
    let plan = validate_window_edit(world, edit);
    let result = WindowEditResult {
        edit,
        reason: plan.as_ref().err().copied(),
    };
    if let Ok(plan) = plan {
        if plan.changed {
            world.insert_resource(plan.layout);
            world.insert_resource(plan.grid);
            let mut state = world.resource_mut::<LotEditState>();
            state.revision = state.revision.saturating_add(1);
        }
    }
    world.resource_mut::<LotEditState>().last_window_result = Some(result);
    result
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod tests;
