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

    /// A* to any tile **orthogonally adjacent** to `to`, rather than to `to`
    /// itself. Returns the path excluding `from`, or None if no neighbour of
    /// `to` is reachable.
    ///
    /// # Why this exists
    ///
    /// A sim used to path to the object's own tile and therefore stand **on**
    /// the furniture, which is wrong in four separate ways that all looked
    /// like different problems:
    ///
    /// - It reads as a bug. The sim overlaps the sprite, and the depth-layer
    ///   fix that stopped it vanishing entirely ([V12]) only made the overlap
    ///   visible rather than fatal.
    /// - **A sim using an object and a sim loitering on one are the same
    ///   picture**, so neither a player nor a test can tell them apart - which
    ///   corrupted a whole measurement pass, recorded as [P8].
    /// - A finished sim is standing at distance zero from what it just used,
    ///   which is that object's maximum possible score, so it is unusually
    ///   likely to use it again immediately ([C5]).
    ///
    ///   **That last one turned out NOT to be fixed by this, and the number is
    ///   recorded here so nobody claims it again.** Back-to-back reuse was
    ///   5.8% of interactions before and 5.6% after, over 12 000 ticks - no
    ///   change worth the name at n = 125. The reason is the shape of the
    ///   denominator: the score divides by `4 * distance + duration + 1`, so
    ///   moving the just-used object from distance 0 to 1 costs it only
    ///   `4/(duration + 5)`, which for the fridge is about 12% - not enough to
    ///   reorder anything, especially since every OTHER object also came one
    ///   tile closer. If [C5] is ever worth fixing it needs a mechanism aimed
    ///   at repetition, such as a short per-object cooldown, rather than a
    ///   distance nudge. Measured with
    ///   `cargo run -p terri-sim --example trace`.
    /// - Multi-step interactions need it anyway: a chain of steps at different
    ///   objects has to put the sim somewhere it can plausibly reach two
    ///   things from.
    ///
    /// # Why one search and not four
    ///
    /// The obvious implementation runs `find_path` to each of the four
    /// neighbours and keeps the shortest, which is four A* searches per
    /// candidate object per idle agent per tick - and selection already scores
    /// every candidate this way, so it would quadruple the most expensive
    /// thing in the tick.
    ///
    /// This changes the **goal test** instead: the search is identical except
    /// that it succeeds on reaching any neighbour of `to`. One search, and it
    /// finds the closest approach for free, because A* expands in order of
    /// cost so the first neighbour it pops is the cheapest one to reach.
    ///
    /// # Determinism
    ///
    /// The heuristic still targets `to` itself, which is admissible for this
    /// goal set: every neighbour of `to` is one step from `to`, so the
    /// heuristic overestimates the true remaining cost by at most 1 and can
    /// only ever make the search explore slightly more, never return a
    /// non-optimal path. Ties resolve through `OpenNode`'s index ordering
    /// exactly as in `find_path`, so the same query always yields the same
    /// path and the same length.
    ///
    /// # The cases that are not the general one
    ///
    /// `to` itself is **not** an accepted goal, even when it is walkable: the
    /// whole point is to stop short of it. An agent standing on `to` therefore
    /// gets a real path off it and onto a neighbour, which is the correct
    /// behaviour for a sim that has been told to use the thing it is standing
    /// on top of.
    ///
    /// An agent already adjacent gets `Some(empty)`, mirroring `find_path`'s
    /// `from == to` case: it is already where it needs to be, and an empty
    /// path is what makes `follow_path` start the interaction immediately.
    ///
    /// `to` does **not** need to be walkable. That is deliberate and is what
    /// lets a future change make object tiles solid without touching this.
    pub fn find_path_adjacent(&self, from: (i32, i32), to: (i32, i32)) -> Option<Vec<(i32, i32)>> {
        if !self.is_walkable(from.0, from.1) {
            return None;
        }
        if is_adjacent(from, to) {
            return Some(Vec::new());
        }

        let cell_count = self.width * self.height;
        let mut g_score = vec![u32::MAX; cell_count];
        let mut came_from = vec![usize::MAX; cell_count];
        let mut closed = vec![false; cell_count];

        let start = self.index(from.0, from.1);
        g_score[start] = 0;

        let mut open = BinaryHeap::new();
        open.push(OpenNode {
            f_score: heuristic(from, to),
            index: start,
            pos: from,
        });

        while let Some(current) = open.pop() {
            // The one difference from `find_path`. Tested on POP rather than
            // on push, so the first adjacent tile accepted is the cheapest
            // one to reach rather than the first one stumbled across.
            if is_adjacent(current.pos, to) {
                return Some(reconstruct(&came_from, self.width, start, current.index));
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

/// Whether `a` shares an edge with `b`. **Orthogonal only**, matching
/// `NEIGHBOURS`, so a sim never stands diagonally against something it is
/// using - the four-way movement rule and the adjacency rule have to agree or
/// a sim could be "adjacent" to a place it cannot step to.
///
/// A tile is not adjacent to itself.
fn is_adjacent(a: (i32, i32), b: (i32, i32)) -> bool {
    let dx = (a.0 - b.0).abs();
    let dy = (a.1 - b.1).abs();
    dx + dy == 1
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

    // ---- find_path_adjacent ------------------------------------------------

    /// **The property the whole thing exists for**: the path ends one step
    /// short of the target, never on it.
    ///
    /// Asserted against `find_path` in the same breath, because "ends near the
    /// target" is satisfied by both and only the comparison shows this is a
    /// different answer.
    #[test]
    fn adjacent_path_stops_one_step_short_of_the_target() {
        let grid = TileGrid::new(10, 10);
        let target = (5, 0);

        let onto = grid.find_path((0, 0), target).expect("path exists");
        assert_eq!(
            *onto.last().unwrap(),
            target,
            "find_path must still walk onto the target, or the contrast below \
             is not a contrast"
        );

        let beside = grid
            .find_path_adjacent((0, 0), target)
            .expect("path exists");
        assert_eq!(*beside.last().unwrap(), (4, 0));
        assert!(
            !beside.contains(&target),
            "the target tile must not appear anywhere in the path; got {beside:?}"
        );
        assert_eq!(
            beside.len(),
            onto.len() - 1,
            "stopping short must cost exactly one step less on an open grid"
        );
    }

    /// An agent already beside the target has nowhere to go.
    ///
    /// All four neighbours, because a rule written with one axis's sign wrong
    /// works for two of them and silently sends the sim on a lap for the other
    /// two.
    #[test]
    fn an_agent_already_adjacent_has_an_empty_path() {
        let grid = TileGrid::new(10, 10);
        let target = (5, 5);
        for from in [(4, 5), (6, 5), (5, 4), (5, 6)] {
            assert_eq!(
                grid.find_path_adjacent(from, target),
                Some(vec![]),
                "an agent at {from:?} is already beside {target:?}"
            );
        }
    }

    /// **Diagonal is not adjacent.** Movement is four-way, so a sim that
    /// counted a diagonal as adjacent would stop at a tile it cannot actually
    /// step to the object from - and every later rule that assumes "beside"
    /// means "one step away" would be wrong for it.
    #[test]
    fn a_diagonal_neighbour_is_not_adjacent_enough() {
        let grid = TileGrid::new(10, 10);
        let path = grid
            .find_path_adjacent((4, 4), (5, 5))
            .expect("path exists");
        assert_eq!(
            path.len(),
            1,
            "a diagonal start must still take one step to reach a true \
             neighbour; got {path:?}"
        );
        assert!(
            path[0] == (5, 4) || path[0] == (4, 5),
            "that step must land on an orthogonal neighbour of the target; \
             got {:?}",
            path[0]
        );
    }

    /// Standing **on** the target is not "already there" - it is the thing
    /// this function exists to stop. The sim gets a real path off it.
    ///
    /// This is the case a player produces by clicking an object the sim is
    /// already standing on top of, which was the normal resting state before
    /// this change.
    #[test]
    fn an_agent_standing_on_the_target_is_moved_off_it() {
        let grid = TileGrid::new(10, 10);
        let path = grid
            .find_path_adjacent((5, 5), (5, 5))
            .expect("neighbours are reachable");
        assert_eq!(
            path.len(),
            1,
            "the agent must take exactly one step to get beside the tile it \
             is standing on; got {path:?}"
        );
        assert!(
            is_adjacent(path[0], (5, 5)),
            "and that step must land beside it; got {:?}",
            path[0]
        );
    }

    /// Wall-aware, and the wall is placed so the *nearest* neighbour is the
    /// unreachable one.
    ///
    /// The target sits against a wall with its west neighbour walled off, so a
    /// search that picked a neighbour geometrically would choose (3, 2) and
    /// find no path. Picking by search cost routes round to the far side.
    #[test]
    fn the_chosen_neighbour_is_the_cheapest_one_to_actually_reach() {
        let mut grid = TileGrid::new(7, 5);
        // A wall running the full height at x = 3, with a gap at y = 0 only.
        for y in 1..5 {
            grid.set_blocked(3, y, true);
        }
        let target = (4, 2);

        let path = grid
            .find_path_adjacent((0, 2), target)
            .expect("the far side is reachable through the gap at y = 0");
        let arrival = *path.last().unwrap();
        assert!(
            is_adjacent(arrival, target),
            "must arrive beside the target; got {arrival:?}"
        );
        assert_ne!(
            arrival,
            (3, 2),
            "the geometrically nearest neighbour is inside the wall and must \
             not be chosen"
        );
        assert!(
            path.iter().all(|&(x, y)| grid.is_walkable(x, y)),
            "every step must be walkable; got {path:?}"
        );
    }

    /// An object walled in on all four sides is unavailable, not free.
    ///
    /// Scoring treats `None` as "cannot have this", so returning a path here
    /// would hand a sim a target it can never arrive at and freeze it - the
    /// [L17] failure with a wall instead of an out-of-bounds coordinate.
    #[test]
    fn a_target_with_no_reachable_neighbour_returns_none() {
        let mut grid = TileGrid::new(7, 7);
        let target = (3, 3);
        for (dx, dy) in NEIGHBOURS {
            grid.set_blocked((target.0 + dx) as usize, (target.1 + dy) as usize, true);
        }
        assert!(
            grid.find_path_adjacent((0, 0), target).is_none(),
            "every neighbour is walled off, so there is nowhere to stand"
        );
    }

    /// The target itself needs no path and needs not be walkable, which is
    /// what lets object tiles become solid later without touching this.
    #[test]
    fn the_target_itself_need_not_be_walkable() {
        let mut grid = TileGrid::new(7, 7);
        let target = (3, 3);
        grid.set_blocked(3, 3, true);

        let path = grid
            .find_path_adjacent((0, 3), target)
            .expect("a blocked target is still approachable");
        assert_eq!(*path.last().unwrap(), (2, 3));
        assert!(
            grid.find_path((0, 3), target).is_none(),
            "find_path must refuse the same blocked target, or this test is \
             not showing a difference between the two"
        );
    }

    /// An agent standing somewhere impassable cannot path at all, matching
    /// `find_path`.
    #[test]
    fn an_agent_on_a_blocked_tile_cannot_path_to_a_neighbour() {
        let mut grid = TileGrid::new(7, 7);
        grid.set_blocked(1, 1, true);
        assert!(grid.find_path_adjacent((1, 1), (5, 5)).is_none());
    }

    /// Same query, same answer, every time - the determinism [D4] rests on.
    #[test]
    fn the_adjacent_path_is_stable_across_repeated_queries() {
        let mut grid = TileGrid::new(9, 9);
        for y in 2..7 {
            grid.set_blocked(4, y, true);
        }
        let first = grid.find_path_adjacent((0, 4), (5, 4));
        for _ in 0..16 {
            assert_eq!(grid.find_path_adjacent((0, 4), (5, 4)), first);
        }
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
