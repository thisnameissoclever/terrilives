//! Architectural membership across owned land. Component indices are temporary.

use bevy_ecs::world::World;
use terri_core::{
    layout::{EdgeAxis, SavedLayout, WallEdge, WallLine, LEGACY_WALL_TILES},
    TileGrid,
};

mod matching;
pub use matching::*;
mod runtime;
pub use runtime::*;
#[cfg(test)]
mod integration_tests;
pub(crate) mod migration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TopologyCell {
    NotFloor,
    Outside,
    Enclosed(u32),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomComponent {
    /// Lowest cell in row order, independent of traversal order.
    pub anchor: (u32, u32),
    /// Cell indices in ascending row order, including occupied floor.
    pub cells: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomTopology {
    pub width: u32,
    pub height: u32,
    pub cells: Vec<TopologyCell>,
    pub components: Vec<RoomComponent>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomError {
    MissingGrid,
    MissingLayout,
    InvalidDimensions,
    InvalidArchitecture,
    AllocationFailed,
    FloodFillBound,
    InvalidRoomMap,
    InvalidRegistry,
    InvalidChoice,
    InvalidName,
    IdExhausted,
    DefaultNameExhausted,
    TooManyRecords,
}

impl RoomTopology {
    /// Derives physical enclosure without reading movement or furniture blockage.
    /// Enclosed indices address `components`; they must never be saved as room IDs.
    pub fn from_world(world: &World) -> Result<Self, RoomError> {
        let layout = world
            .get_resource::<SavedLayout>()
            .ok_or(RoomError::MissingLayout)?;
        Self::with_layout(world, layout)
    }

    /// [`Self::from_world`] with `layout` in place of the world's own, for a
    /// lot edit that has not been written yet ([WB-beds] in
    /// `docs/specs/2026-10-18-wages-and-bills.md`).
    pub fn with_layout(world: &World, layout: &SavedLayout) -> Result<Self, RoomError> {
        let grid = world
            .get_resource::<TileGrid>()
            .ok_or(RoomError::MissingGrid)?;
        let (width, height) = (grid.width(), grid.height());
        let count = width
            .checked_mul(height)
            .filter(|&count| width > 0 && height > 0 && u32::try_from(count).is_ok())
            .ok_or(RoomError::InvalidDimensions)?;
        let (width, height) = (width as u32, height as u32);
        let mut cells = filled(count, TopologyCell::Outside)?;
        let walls = match layout {
            SavedLayout::LegacyAuthoredV1 => LEGACY_WALL_TILES.as_slice(),
            SavedLayout::LegacyCells { walls } => walls.as_slice(),
            _ => &[],
        };
        for &(x, y) in walls {
            if x >= width || y >= height {
                if matches!(layout, SavedLayout::LegacyAuthoredV1) {
                    continue;
                }
                return Err(RoomError::InvalidArchitecture);
            }
            cells[y as usize * width as usize + x as usize] = TopologyCell::NotFloor;
        }
        let boundaries = architecture(world, layout, width, height, count)?;
        let mut visited = filled(count, false)?;
        let mut queue = Vec::new();
        queue
            .try_reserve_exact(count)
            .map_err(|_| RoomError::AllocationFailed)?;
        let mut components = Vec::new();
        for seed in 0..count {
            if visited[seed] || cells[seed] == TopologyCell::NotFloor {
                continue;
            }
            queue.clear();
            queue.push(seed as u32);
            visited[seed] = true;
            let mut cursor = 0;
            let mut outside = false;
            while cursor < queue.len() {
                // A missing visited check must fail before growing an unbounded queue.
                if cursor >= count {
                    return Err(RoomError::FloodFillBound);
                }
                let cell = queue[cursor] as usize;
                cursor += 1;
                let (x, y) = (cell % width as usize, cell / width as usize);
                for (blocked, next) in [
                    (
                        boundaries[cell] & EAST != 0,
                        (x + 1 < width as usize).then_some(cell + 1),
                    ),
                    (
                        boundaries[cell] & SOUTH != 0,
                        (y + 1 < height as usize).then_some(cell + width as usize),
                    ),
                    (
                        boundaries[cell] & WEST != 0,
                        x.checked_sub(1).map(|_| cell - 1),
                    ),
                    (
                        boundaries[cell] & NORTH != 0,
                        y.checked_sub(1).map(|_| cell - width as usize),
                    ),
                ] {
                    if blocked {
                        continue;
                    }
                    let Some(next) = next else {
                        outside = true;
                        continue;
                    };
                    if cells[next] != TopologyCell::NotFloor && !visited[next] {
                        if queue.len() >= count {
                            return Err(RoomError::FloodFillBound);
                        }
                        visited[next] = true;
                        queue.push(next as u32);
                    }
                }
            }
            if !outside {
                let index = components.len() as u32;
                let mut members = Vec::new();
                members
                    .try_reserve_exact(queue.len())
                    .map_err(|_| RoomError::AllocationFailed)?;
                members.extend_from_slice(&queue);
                members.sort_unstable();
                for &cell in &members {
                    cells[cell as usize] = TopologyCell::Enclosed(index);
                }
                components
                    .try_reserve(1)
                    .map_err(|_| RoomError::AllocationFailed)?;
                components.push(RoomComponent {
                    anchor: (seed as u32 % width, seed as u32 / width),
                    cells: members,
                });
            }
        }
        Ok(Self {
            width,
            height,
            cells,
            components,
        })
    }

    /// Whether every tile of `footprint` at `origin` is inside an enclosed
    /// room: the rule a bed is held to ([WB-beds]).
    pub fn footprint_indoors(&self, origin: (u32, u32), footprint: terri_core::Footprint) -> bool {
        (origin.1..origin.1 + footprint.depth).all(|y| {
            (origin.0..origin.0 + footprint.width)
                .all(|x| matches!(self.at((x, y)), Some(TopologyCell::Enclosed(_))))
        })
    }

    pub fn at(&self, (x, y): (u32, u32)) -> Option<TopologyCell> {
        if x >= self.width || y >= self.height {
            return None;
        }
        self.cells
            .get(y as usize * self.width as usize + x as usize)
            .copied()
    }
}

const EAST: u8 = 1;
const SOUTH: u8 = 2;
const WEST: u8 = 4;
const NORTH: u8 = 8;

fn filled<T: Clone>(count: usize, value: T) -> Result<Vec<T>, RoomError> {
    let mut result = Vec::new();
    result
        .try_reserve_exact(count)
        .map_err(|_| RoomError::AllocationFailed)?;
    result.resize(count, value);
    Ok(result)
}

fn architecture(
    world: &World,
    layout: &SavedLayout,
    width: u32,
    height: u32,
    count: usize,
) -> Result<Vec<u8>, RoomError> {
    let mut boundaries = filled(count, 0u8)?;
    let mut block = |line: WallLine| -> Result<(), RoomError> {
        let edge = WallEdge {
            axis: line.axis,
            x: line.x,
            y: line.y,
            doorway: false,
        };
        if !edge.physical_in_bounds(width, height) {
            return Err(RoomError::InvalidArchitecture);
        }
        let (x, y, stride) = (line.x as usize, line.y as usize, width as usize);
        match line.axis {
            EdgeAxis::Vertical => {
                if x > 0 {
                    boundaries[y * stride + x - 1] |= EAST;
                }
                if x < stride {
                    boundaries[y * stride + x] |= WEST;
                }
            }
            EdgeAxis::Horizontal => {
                if y > 0 {
                    boundaries[(y - 1) * stride + x] |= SOUTH;
                }
                if y < height as usize {
                    boundaries[y * stride + x] |= NORTH;
                }
            }
        }
        Ok(())
    };
    for edge in layout.edges() {
        if !edge.physical_in_bounds(width, height) {
            return Err(RoomError::InvalidArchitecture);
        }
        block(WallLine {
            axis: edge.axis,
            x: edge.x,
            y: edge.y,
        })?;
    }
    for window in layout.window_placements() {
        for line in window
            .checked_lines()
            .ok_or(RoomError::InvalidArchitecture)?
        {
            block(line)?;
        }
    }
    if world.contains_resource::<crate::LotFrame>() && !world.contains_resource::<crate::Content>()
    {
        return Err(RoomError::InvalidArchitecture);
    }
    let house = crate::lot_frame::house_or_grid(world);
    let right = house
        .x
        .checked_add(house.width)
        .filter(|&x| x <= width)
        .ok_or(RoomError::InvalidArchitecture)?;
    let bottom = house
        .y
        .checked_add(house.height)
        .filter(|&y| y <= height)
        .ok_or(RoomError::InvalidArchitecture)?;
    for line in house.rear_lines() {
        block(line)?;
    }
    let frozen_origin = match layout {
        SavedLayout::LegacyAuthoredV1 => Some((0, 0)),
        SavedLayout::LegacyCells { walls }
            if walls.len() == LEGACY_WALL_TILES.len()
                && LEGACY_WALL_TILES.iter().all(|&(x, y)| {
                    house
                        .x
                        .checked_add(x)
                        .zip(house.y.checked_add(y))
                        .is_some_and(|tile| walls.contains(&tile))
                }) =>
        {
            Some((house.x, house.y))
        }
        _ => None,
    };
    if let Some(origin) = frozen_origin {
        // The frozen cell-wall house predates explicit exterior edges. Only
        // that exact authored layout retains its complete historical shell.
        for y in house.y..bottom {
            block(WallLine {
                axis: EdgeAxis::Vertical,
                x: right,
                y,
            })?;
        }
        for x in house.x..right {
            block(WallLine {
                axis: EdgeAxis::Horizontal,
                x,
                y: bottom,
            })?;
        }
        for (axis, x, y) in [
            (EdgeAxis::Vertical, 8, 2),
            (EdgeAxis::Horizontal, 3, 6),
            (EdgeAxis::Horizontal, 13, 6),
            (EdgeAxis::Vertical, 6, 9),
            (EdgeAxis::Vertical, 12, 8),
        ] {
            let line = WallLine {
                axis,
                x: origin
                    .0
                    .checked_add(x)
                    .ok_or(RoomError::InvalidArchitecture)?,
                y: origin
                    .1
                    .checked_add(y)
                    .ok_or(RoomError::InvalidArchitecture)?,
            };
            // These coordinates belong to the frozen implicit presentation,
            // not an explicit architecture record supplied by a saved payload.
            if matches!(layout, SavedLayout::LegacyAuthoredV1)
                && !(WallEdge {
                    axis: line.axis,
                    x: line.x,
                    y: line.y,
                    doorway: true,
                })
                .physical_in_bounds(width, height)
            {
                continue;
            }
            block(line)?;
        }
    }
    Ok(boundaries)
}

#[cfg(test)]
mod identity_tests;
#[cfg(test)]
mod tests;
