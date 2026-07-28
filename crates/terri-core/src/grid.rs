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

    /// Panics if the tile is outside the grid. That is deliberate: the
    /// naive `y * width + x` silently addresses the wrong row when x is
    /// out of range rather than failing, so an off-by-one in lot setup
    /// would block an unrelated tile and surface much later as an
    /// inexplicable pathfinding bug.
    pub fn set_blocked(&mut self, x: usize, y: usize, blocked: bool) {
        assert!(
            x < self.width && y < self.height,
            "set_blocked({x}, {y}) is outside the {}x{} grid",
            self.width,
            self.height
        );
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

        // Assert a real path exists before comparing. Two Nones compare
        // equal, so without this the test would pass vacuously if
        // pathfinding broke entirely - green while protecting nothing.
        // See lessons-learned [L3].
        let steps = a.as_ref().expect("a path exists across an open grid");
        assert_eq!(steps.len(), 22, "expected a Manhattan-optimal path");
        assert_eq!(*steps.last().unwrap(), (11, 11));
        assert!(!steps.contains(&(0, 0)), "path must exclude the start tile");

        assert_eq!(a, b, "identical queries must return identical paths");
    }

    #[test]
    fn tie_breaking_pins_one_specific_path_among_equals() {
        // A diagonal query on an open grid has many equally short paths,
        // so which one comes back is decided entirely by the f-score tie
        // break on tile index in OpenNode::cmp.
        //
        // This is a golden assertion, and it is the only test that covers
        // that tiebreak. Deleting the .then_with(...) line leaves every
        // other test in this file green: BinaryHeap is deterministic for
        // a fixed push order, so comparing two calls in one process can
        // never observe the difference. What the tiebreak actually buys
        // is stability across Rust versions and across future changes to
        // push order, which is what Task 7's cross-run world hash needs.
        let grid = TileGrid::new(5, 5);
        let path = grid.find_path((0, 0), (2, 2)).expect("path exists");
        assert_eq!(path, vec![(1, 0), (2, 0), (2, 1), (2, 2)]);
    }

    #[test]
    #[should_panic(expected = "outside the 5x5 grid")]
    fn set_blocked_rejects_out_of_bounds() {
        // Without the bounds check this silently blocks (0, 2) instead.
        TileGrid::new(5, 5).set_blocked(5, 1, true);
    }

    #[test]
    fn width_and_height_report_the_constructor_arguments_in_that_order() {
        // Every other test in this file builds a SQUARE grid, so a
        // transposed `TileGrid::new` - or a `height` that returns
        // `self.width` - is invisible to all of them. Both accessors
        // survived as mutants on that basis, and they are not idle
        // getters: `is_walkable` and `set_blocked` both derive their
        // bounds from these fields, and `find_path` indexes rows by
        // `width`.
        let grid = TileGrid::new(7, 3);
        assert_eq!(grid.width(), 7);
        assert_eq!(grid.height(), 3);

        // The same claim stated through behaviour, so the two lines
        // above cannot both be satisfied by a grid that is actually
        // 3 wide and 7 tall.
        assert!(grid.is_walkable(6, 2), "(6, 2) is the far corner of 7x3");
        assert!(!grid.is_walkable(2, 6), "(2, 6) is outside a 7x3 grid");
    }

    #[test]
    fn a_path_that_starts_on_an_unwalkable_tile_is_none() {
        // The two halves of `find_path`'s entry guard are not equally
        // covered. The DESTINATION half is protected incidentally: an
        // unreachable goal makes the search exhaust and return None
        // anyway, so removing that half changes nothing observable.
        // The ORIGIN half has no such backstop - without it the search
        // happily expands outward from inside a wall and hands back a
        // path - which is why `||` mutated to `&&` survived every other
        // test in this file.
        //
        // Reachable in play rather than contrived: an agent standing on
        // a tile that build mode then walls over is exactly this state.
        let mut grid = TileGrid::new(5, 5);
        grid.set_blocked(2, 2, true);

        assert!(
            grid.find_path((2, 2), (0, 0)).is_none(),
            "an agent inside a wall has nowhere to walk from"
        );
        assert!(
            grid.find_path((0, 0), (2, 2)).is_none(),
            "nothing can path into a wall"
        );
        // Without this the two assertions above would also pass if
        // find_path were broken outright and returned None for
        // everything.
        assert!(grid.find_path((0, 0), (4, 4)).is_some());
    }

    #[test]
    fn the_heuristic_equals_the_true_cost_on_an_open_grid() {
        // A* returns optimal paths only while its heuristic never
        // overestimates the remaining cost. On a four-neighbour grid
        // with unit step cost and no obstacles, the Manhattan distance
        // IS the remaining cost exactly, so admissibility here is an
        // equality rather than an inequality - and that is the strongest
        // form the claim can take.
        //
        // Three mutants lived in this function because nothing else can
        // see them: replacing the heuristic with 0 or with any constant
        // degrades A* to Dijkstra, which still returns paths of optimal
        // LENGTH, so every path assertion in this file stays green.
        //
        // Both coordinates differ in every pair, and no pair starts on
        // an axis, deliberately: where `a.1` is 0, `a.1 - b.1` and
        // `a.1 + b.1` have the same absolute value and the sign flip is
        // invisible.
        let grid = TileGrid::new(9, 9);
        for (from, to, cost) in [
            ((2, 5), (3, 1), 5usize),
            ((5, 2), (1, 3), 5),
            ((7, 7), (0, 4), 10),
        ] {
            assert_eq!(
                heuristic(from, to) as usize,
                cost,
                "heuristic {from:?} -> {to:?}"
            );
            assert_eq!(
                grid.find_path(from, to).expect("open grid").len(),
                cost,
                "the cost above must be the real one, not a copied literal"
            );
        }
    }
}
