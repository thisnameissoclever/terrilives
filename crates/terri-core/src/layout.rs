//! Interior architecture lives on cell boundaries, separately from occupancy.

use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

/// Public house before the wall-edge conversion. V1 presentation is frozen.
pub const LEGACY_WALL_TILES: [(u32, u32); 28] = [
    (7, 0),
    (7, 1),
    (7, 3),
    (7, 4),
    (0, 5),
    (1, 5),
    (2, 5),
    (4, 5),
    (5, 5),
    (6, 5),
    (7, 5),
    (8, 5),
    (9, 5),
    (10, 5),
    (11, 5),
    (12, 5),
    (14, 5),
    (15, 5),
    (5, 6),
    (5, 7),
    (5, 8),
    (5, 10),
    (5, 11),
    (11, 6),
    (11, 7),
    (11, 9),
    (11, 10),
    (11, 11),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeAxis {
    Vertical,
    Horizontal,
}

/// V(x,y) separates (x-1,y)/(x,y); H(x,y) separates (x,y-1)/(x,y).
/// Coordinates identify a boundary, not the center of a wall tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WallEdge {
    pub axis: EdgeAxis,
    pub x: u32,
    pub y: u32,
    #[serde(default)]
    pub doorway: bool,
}

impl WallEdge {
    pub fn in_bounds(self, width: u32, height: u32) -> bool {
        match self.axis {
            EdgeAxis::Vertical => self.x > 0 && self.x < width && self.y < height,
            EdgeAxis::Horizontal => self.y > 0 && self.y < height && self.x < width,
        }
    }

    /// Call only after bounds validation against an i32-addressable grid.
    pub fn cells(self) -> [(i32, i32); 2] {
        let (x, y) = (self.x as i32, self.y as i32);
        match self.axis {
            EdgeAxis::Vertical => [(x - 1, y), (x, y)],
            EdgeAxis::Horizontal => [(x, y - 1), (x, y)],
        }
    }
}

/// Kept in the world and saved with it. Loading an older or custom world must
/// not substitute the newest authored walls for its actual architecture.
#[derive(Resource, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedLayout {
    /// V1 never saved architecture separately. Retain its frozen presentation
    /// rather than claiming the mixed collision bitmap identifies wall cells.
    LegacyAuthoredV1,
    LegacyCells {
        walls: Vec<(u32, u32)>,
    },
    EdgeWallsV1 {
        edges: Vec<WallEdge>,
    },
}

impl Default for SavedLayout {
    fn default() -> Self {
        Self::LegacyCells { walls: Vec::new() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_coordinates_are_boundaries_with_two_interior_neighbors() {
        for (axis, x, y, cells) in [
            (EdgeAxis::Vertical, 2, 1, [(1, 1), (2, 1)]),
            (EdgeAxis::Horizontal, 2, 1, [(2, 0), (2, 1)]),
        ] {
            let edge = WallEdge {
                axis,
                x,
                y,
                doorway: false,
            };
            assert_eq!(edge.cells(), cells);
            assert!(edge.in_bounds(4, 3));
        }
        for (axis, x, y) in [
            (EdgeAxis::Vertical, 0, 1),
            (EdgeAxis::Vertical, 4, 1),
            (EdgeAxis::Vertical, 2, 3),
            (EdgeAxis::Horizontal, 2, 0),
            (EdgeAxis::Horizontal, 2, 3),
            (EdgeAxis::Horizontal, 4, 1),
        ] {
            assert!(!WallEdge {
                axis,
                x,
                y,
                doorway: false
            }
            .in_bounds(4, 3));
        }
    }
}
