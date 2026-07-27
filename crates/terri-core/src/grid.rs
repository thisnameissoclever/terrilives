use bevy_ecs::prelude::Resource;
use std::collections::BinaryHeap;

/// A single lot's walkability grid. One tile is roughly one metre.
/// M0 is a single room; the room and portal graph in [D7] arrives with
/// multi-room lots.
#[derive(Resource, Debug, Clone)]
pub struct TileGrid {
    width: usize,
    height: usize,
    blocked: Vec<bool>,
}

/// Four-way movement only. Diagonals would need corner-cutting checks
/// and are not needed for M0.
const NEIGHBOURS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

impl TileGrid {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            blocked: vec![false; width * height],
        }
    }

    pub fn width(&self) -> usize {
        self.width
    }

    pub fn height(&self) -> usize {
        self.height
    }

    pub fn set_blocked(&mut self, x: usize, y: usize, blocked: bool) {
        let idx = y * self.width + x;
        self.blocked[idx] = blocked;
    }

    pub fn is_walkable(&self, x: i32, y: i32) -> bool {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return false;
        }
        !self.blocked[y as usize * self.width + x as usize]
    }

    fn index(&self, x: i32, y: i32) -> usize {
        y as usize * self.width + x as usize
    }

    /// A* over the tile grid. Returns the path excluding `from` and
    /// including `to`, or None if unreachable.
    ///
    /// Determinism note: the open set is a BinaryHeap ordered by
    /// (f_score, tile_index). Including the index breaks f-score ties in
    /// a stable way, so the same query always yields the same path.
    pub fn find_path(&self, from: (i32, i32), to: (i32, i32)) -> Option<Vec<(i32, i32)>> {
        if from == to {
            return Some(Vec::new());
        }
        if !self.is_walkable(to.0, to.1) || !self.is_walkable(from.0, from.1) {
            return None;
        }

        let cell_count = self.width * self.height;
        let mut g_score = vec![u32::MAX; cell_count];
        let mut came_from = vec![usize::MAX; cell_count];
        let mut closed = vec![false; cell_count];

        let start = self.index(from.0, from.1);
        let goal = self.index(to.0, to.1);
        g_score[start] = 0;

        let mut open = BinaryHeap::new();
        open.push(OpenNode {
            f_score: heuristic(from, to),
            index: start,
            pos: from,
        });

        while let Some(current) = open.pop() {
            if current.index == goal {
                return Some(reconstruct(&came_from, self.width, start, goal));
            }
            if closed[current.index] {
                continue;
            }
            closed[current.index] = true;

            for (dx, dy) in NEIGHBOURS {
                let next = (current.pos.0 + dx, current.pos.1 + dy);
                if !self.is_walkable(next.0, next.1) {
                    continue;
                }
                let next_idx = self.index(next.0, next.1);
                if closed[next_idx] {
                    continue;
                }
                let tentative = g_score[current.index].saturating_add(1);
                if tentative < g_score[next_idx] {
                    g_score[next_idx] = tentative;
                    came_from[next_idx] = current.index;
                    open.push(OpenNode {
                        f_score: tentative + heuristic(next, to),
                        index: next_idx,
                        pos: next,
                    });
                }
            }
        }

        None
    }
}

fn heuristic(a: (i32, i32), b: (i32, i32)) -> u32 {
    ((a.0 - b.0).abs() + (a.1 - b.1).abs()) as u32
}

fn reconstruct(came_from: &[usize], width: usize, start: usize, goal: usize) -> Vec<(i32, i32)> {
    let mut path = Vec::new();
    let mut cursor = goal;
    while cursor != start {
        path.push(((cursor % width) as i32, (cursor / width) as i32));
        cursor = came_from[cursor];
    }
    path.reverse();
    path
}

/// Min-heap entry. BinaryHeap is a max-heap, so Ord is reversed on
/// f_score. The index tiebreak keeps ordering total and stable.
#[derive(PartialEq, Eq)]
struct OpenNode {
    f_score: u32,
    index: usize,
    pos: (i32, i32),
}

impl Ord for OpenNode {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other
            .f_score
            .cmp(&self.f_score)
            .then_with(|| other.index.cmp(&self.index))
    }
}

impl PartialOrd for OpenNode {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn straight_path_on_open_grid() {
        let grid = TileGrid::new(10, 10);
        let path = grid.find_path((0, 0), (3, 0)).expect("path exists");
        assert_eq!(path, vec![(1, 0), (2, 0), (3, 0)]);
    }

    #[test]
    fn path_routes_around_a_wall() {
        let mut grid = TileGrid::new(5, 5);
        for y in 0..4 {
            grid.set_blocked(2, y, true);
        }
        let path = grid.find_path((0, 0), (4, 0)).expect("path exists");
        assert_eq!(*path.last().unwrap(), (4, 0));
        assert!(
            path.iter().all(|&(x, y)| !(x == 2 && y < 4)),
            "path must not cross the wall: {path:?}"
        );
    }

    #[test]
    fn unreachable_target_returns_none() {
        let mut grid = TileGrid::new(5, 5);
        for y in 0..5 {
            grid.set_blocked(2, y, true);
        }
        assert!(grid.find_path((0, 0), (4, 0)).is_none());
    }

    #[test]
    fn path_to_self_is_empty() {
        let grid = TileGrid::new(5, 5);
        assert_eq!(grid.find_path((1, 1), (1, 1)), Some(vec![]));
    }

    #[test]
    fn out_of_bounds_is_not_walkable() {
        let grid = TileGrid::new(3, 3);
        assert!(!grid.is_walkable(-1, 0));
        assert!(!grid.is_walkable(3, 0));
        assert!(grid.is_walkable(2, 2));
    }

    #[test]
    fn pathfinding_is_deterministic() {
        let mut grid = TileGrid::new(12, 12);
        grid.set_blocked(5, 5, true);
        let a = grid.find_path((0, 0), (11, 11));
        let b = grid.find_path((0, 0), (11, 11));
        assert_eq!(a, b);
    }
}
