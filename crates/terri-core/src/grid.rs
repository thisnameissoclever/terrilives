use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};
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

/// The tile rectangle an object occupies. `width` runs along +x and
/// `depth` along +y from the object's **origin** tile, so a 2x1 footprint
/// placed at `(4, 7)` covers `(4, 7)` and `(5, 7)` - [F2] in
/// `docs/specs/2026-07-30-object-footprints-design.md`, where the rejected
/// centre-anchored alternative is also recorded.
///
/// It lives here rather than in `terri-data` for the same reason
/// [`crate::ObjectDefId`] does: [`TileGrid::find_path_adjacent`] takes one,
/// and `terri-core` is the lowest layer and must not depend on the content
/// crate. `terri-data` re-exports it and `CompiledObject` holds one.
///
/// **Axis-aligned, with no rotation.** Every sprite in the kit is
/// pre-rendered at one facing and the projection is fixed, so a rotation
/// concept has nothing to act on yet; when build mode adds one it will need
/// a facing on the placement and a swap of `width` and `depth`. Nothing
/// here may assume square.
///
/// Content declares it and `terri-data`'s `compile` is what enforces that
/// both dimensions are at least 1 and that the whole rectangle fits inside
/// the lot and clears its walls. This crate assumes all of that, per [L12]
/// rule 1: the sim crates keep the right to assume valid inputs, and that
/// assumption is what makes them testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Footprint {
    pub width: u32,
    pub depth: u32,
}

impl Footprint {
    /// One tile: what every object was before footprints existed, and what
    /// all but one still is.
    pub const SINGLE: Self = Self { width: 1, depth: 1 };
}

/// One tile, **not** the derived zero.
///
/// A zero-sized footprint is not a smaller object; it is one whose
/// adjacency set is empty, so every caller here would read it as
/// unreachable and a sim would simply never use it. Deriving `Default`
/// would produce exactly that, and the authored schema leans on this
/// default so that an object omitting `footprint` keeps the 1x1 behaviour
/// it had before the field existed ([F1]).
impl Default for Footprint {
    fn default() -> Self {
        Self::SINGLE
    }
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

    /// A* to any tile **orthogonally adjacent** to the footprint rectangle
    /// whose origin tile is `to`, rather than to a tile of the rectangle
    /// itself. Returns the path excluding `from`, or None if no tile beside
    /// the rectangle is reachable.
    ///
    /// `footprint` is the object's declared extent: `(width, depth)` tiles
    /// running +x and +y from `to`, so `Footprint::SINGLE` reproduces the
    /// original one-tile behaviour exactly. [`TileGrid::
    /// find_path_adjacent_to_tile`] is that case spelled out, and is what
    /// most callers want.
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
    ///   **This does NOT address that, and an earlier version of this comment
    ///   claimed it did. The claim was wrong twice over.** It said standing
    ///   beside an object costs it one tile of distance. It costs it nothing:
    ///   the early return above yields `Some(vec![])` for an agent that is
    ///   already adjacent, so `steps.len()` is **0**, and a sim that has just
    ///   finished an interaction is by definition adjacent. It scores that
    ///   object at distance 0 exactly as it did when it stood on top of it.
    ///
    ///   The measurement was right and the explanation was not: back-to-back
    ///   reuse went 5.8% to 5.6% over 12 000 ticks, which is no change at
    ///   n = 125 - and now reads as exactly what you would predict from a term
    ///   that did not move. **A distance nudge has therefore never been
    ///   tried**, which is the opposite of what the old comment told the next
    ///   person. If [C5] is worth fixing, a per-interaction cooldown or the
    ///   habituation mechanic in
    ///   `docs/specs/2026-07-29-satisfaction-and-traits-design.md` is the
    ///   aimed-at mechanism; a nudge is the untested cheap option. Measure
    ///   with `cargo run -p terri-sim --example trace`.
    /// - Multi-step interactions need it anyway: a chain of steps at different
    ///   objects has to put the sim somewhere it can plausibly reach two
    ///   things from.
    ///
    /// # Why one search and not four
    ///
    /// The obvious implementation runs `find_path` to each tile beside the
    /// rectangle and keeps the shortest, which is up to `2 * (width + depth)`
    /// A* searches per candidate object per idle agent per tick - and
    /// selection already scores every candidate this way, so it would multiply
    /// the most expensive thing in the tick. The single-tile version of that
    /// argument said "four searches"; widening the footprint makes it worse
    /// rather than better.
    ///
    /// This changes the **goal test** instead: the search is identical except
    /// that it succeeds on reaching any tile beside the rectangle. One search,
    /// and it finds the closest approach for free, because A* expands in order
    /// of cost so the first such tile it pops is the cheapest one to reach.
    ///
    /// # Why this is optimal, which is NOT because the heuristic is admissible
    ///
    /// The heuristic is `rect_distance(n, to, footprint)`, the Manhattan
    /// distance from `n` to the **nearest tile of the rectangle**. That is
    /// inadmissible for this goal set - it returns `h*(n) + 1` at every goal,
    /// because every goal is one step from the rectangle and the search stops
    /// there. An early version of this comment claimed the opposite, and
    /// claimed that overestimating makes the search "explore slightly more";
    /// both are backwards. Overestimating is what inadmissible MEANS, and it
    /// makes A* explore less, which is exactly how an inadmissible heuristic
    /// returns non-optimal paths.
    ///
    /// It is optimal anyway, for two properties that do hold:
    ///
    /// - `h` is **consistent**: `rect_distance` is a clamped Manhattan
    ///   distance, so one orthogonal step changes it by at most 1. Nodes
    ///   therefore pop in non-decreasing `f` order with their optimal `g`.
    /// - `h` is **exactly 1 at every goal in the set**. Uniform `h` across the
    ///   goals means `f` ordering among them is `g` ordering, so the first goal
    ///   popped really is the cheapest to reach.
    ///
    /// **The second property is the load-bearing one, and it is what the
    /// footprint change had to preserve.** An earlier version of this function
    /// used `Manhattan(n, to)` - the distance to the origin TILE - and this
    /// comment warned that multi-tile footprints would break it, because goals
    /// along a wide object sit at different distances from its origin: the goal
    /// beside the far end of a 3x1 object is 3 away from the origin, not 1, so
    /// `h` stopped being uniform and the search would happily return a
    /// reachable-but-not-nearest tile. **That is exactly what
    /// `rect_distance` fixes, and it is why the heuristic is the nearest tile
    /// of the rectangle rather than its origin**: measured to the rectangle,
    /// every goal is at 1 again and the argument above transfers verbatim.
    /// [F4] in `docs/specs/2026-07-30-object-footprints-design.md` records the
    /// decision, including why `h = 0` (plain Dijkstra) was rejected - correct,
    /// but selection runs one of these searches per candidate object per idle
    /// agent per tick.
    ///
    /// Note there is no separate goal-set arithmetic to keep in step: the goal
    /// test **is** `rect_distance(..) == 1`, so "h is 1 at every goal" holds by
    /// construction rather than by two pieces of code agreeing about what
    /// "beside" means.
    ///
    /// The other change that would break the uniformity is still outstanding:
    /// **admitting diagonal movement**, where `h` at a goal would be 1 or 2
    /// depending on the direction. That one needs a different fix from this,
    /// because no metric measured to the rectangle is 1 at a diagonal
    /// neighbour; it wants `h = 0`, or a diagonal-aware distance and an
    /// adjacency rule that agrees with it.
    ///
    /// Ties resolve through `OpenNode`'s index ordering exactly as in
    /// `find_path`, so the same query always yields the same path and length.
    ///
    /// # The cases that are not the general one
    ///
    /// **No tile of the rectangle is an accepted goal**, even where one is
    /// walkable: the whole point is to stop short of it. An agent standing on
    /// the object therefore gets a real path off it and onto a tile beside it,
    /// which is the correct behaviour for a sim that has been told to use the
    /// thing it is standing on top of.
    ///
    /// An agent already beside the rectangle gets `Some(empty)`, mirroring
    /// `find_path`'s `from == to` case: it is already where it needs to be, and
    /// an empty path is what makes `follow_path` start the interaction
    /// immediately.
    ///
    /// The rectangle does **not** need to be walkable, and since [F3] it
    /// generally is not - `Sim::new_from_lot` marks every footprint tile
    /// blocked. This function never needed a change for that, which is what
    /// the original one-tile note predicted. Where footprint tiles happen to
    /// be walkable, a path may cross the rectangle rather than round it; that
    /// is a legal shortest path and the optimality argument does not depend on
    /// which.
    pub fn find_path_adjacent(
        &self,
        from: (i32, i32),
        to: (i32, i32),
        footprint: Footprint,
    ) -> Option<Vec<(i32, i32)>> {
        if !self.is_walkable(from.0, from.1) {
            return None;
        }
        if is_adjacent_to_rect(from, to, footprint) {
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
            f_score: rect_distance(from, to, footprint),
            index: start,
            pos: from,
        });

        while let Some(current) = open.pop() {
            // The one difference from `find_path`. Tested on POP rather than
            // on push, so the first adjacent tile accepted is the cheapest
            // one to reach rather than the first one stumbled across.
            if is_adjacent_to_rect(current.pos, to, footprint) {
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
                        f_score: tentative + rect_distance(next, to, footprint),
                        index: next_idx,
                        pos: next,
                    });
                }
            }
        }

        None
    }

    /// [`TileGrid::find_path_adjacent`] for a one-tile object, which is what
    /// every object was before footprints existed and what all but one still
    /// is.
    ///
    /// A named wrapper rather than making the footprint argument optional,
    /// because the two callers that matter - selection and `serve_intents` -
    /// always have a real footprint to hand and must not be able to forget it.
    /// A defaulted argument is exactly how a 2x1 bed would silently get
    /// approached as though it were 1x1, which is the bug the footprint work
    /// exists to remove.
    pub fn find_path_adjacent_to_tile(
        &self,
        from: (i32, i32),
        to: (i32, i32),
    ) -> Option<Vec<(i32, i32)>> {
        self.find_path_adjacent(from, to, Footprint::SINGLE)
    }
}

/// The Manhattan distance from `p` to the **nearest tile** of the footprint
/// rectangle whose origin tile is `origin`. Zero anywhere inside it.
///
/// This is the whole of the footprint geometry, and both the goal test and
/// the heuristic in `find_path_adjacent` are defined in terms of it. That is
/// deliberate rather than economical: the two have to agree about what
/// "beside the rectangle" means or the search stops being optimal, and one
/// function cannot disagree with itself. See `find_path_adjacent`'s
/// optimality note for the argument that rests on it.
fn rect_distance(p: (i32, i32), origin: (i32, i32), footprint: Footprint) -> u32 {
    // `- 1` because the origin tile is the FIRST of `width`, so a 1-wide
    // footprint's far edge is the origin itself. Content validation bounds
    // the rectangle to the lot and the lot to a grid that has to be
    // allocatable, so neither add can overflow for a pack that exists; a
    // zero dimension would put `far` behind `origin` and is rejected at
    // build time as `ContentError::ZeroFootprint`.
    let far = (
        origin.0 + footprint.width as i32 - 1,
        origin.1 + footprint.depth as i32 - 1,
    );
    // Clamp to the interval on each axis independently, which is what makes
    // this the distance to the nearest tile rather than to a corner.
    let axis = |v: i32, lo: i32, hi: i32| {
        if v < lo {
            lo - v
        } else if v > hi {
            v - hi
        } else {
            0
        }
    };
    (axis(p.0, origin.0, far.0) + axis(p.1, origin.1, far.1)) as u32
}

/// Whether `p` shares an edge with the footprint rectangle at `origin`
/// without being inside it.
///
/// **Orthogonal only**, matching `NEIGHBOURS`, so a sim never stands
/// diagonally against something it is using - the four-way movement rule and
/// the adjacency rule have to agree or a sim could be "adjacent" to a place
/// it cannot step to. A diagonal neighbour of a corner is at
/// `rect_distance` 2 and is therefore excluded, and so is every tile of the
/// rectangle itself, which sits at 0.
fn is_adjacent_to_rect(p: (i32, i32), origin: (i32, i32), footprint: Footprint) -> bool {
    rect_distance(p, origin, footprint) == 1
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

    /// The one-tile case of the production goal test, delegating rather than
    /// restating the arithmetic, so the tests that predate footprints keep
    /// reading as "beside this tile" and cannot drift from the rule they are
    /// checking.
    fn is_adjacent(a: (i32, i32), b: (i32, i32)) -> bool {
        is_adjacent_to_rect(a, b, Footprint::SINGLE)
    }

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
            .find_path_adjacent_to_tile((0, 0), target)
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
                grid.find_path_adjacent_to_tile(from, target),
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
            .find_path_adjacent_to_tile((4, 4), (5, 5))
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
            .find_path_adjacent_to_tile((5, 5), (5, 5))
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
            .find_path_adjacent_to_tile((0, 2), target)
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
            grid.find_path_adjacent_to_tile((0, 0), target).is_none(),
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
            .find_path_adjacent_to_tile((0, 3), target)
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
        assert!(grid.find_path_adjacent_to_tile((1, 1), (5, 5)).is_none());
    }

    /// **The path is the SHORTEST one, not merely a valid one, and this is the
    /// test that says so.**
    ///
    /// Every other test here checks that the path is contiguous, walkable, ends
    /// beside the target and has a plausible length. None of them constrains the
    /// PRIORITY the search expands in, so the f-score expression was free: a
    /// mutation replacing `tentative + heuristic(..)` with `tentative *
    /// heuristic(..)` survived the entire workspace suite. CI's mutation gate
    /// caught it as a new survivor.
    ///
    /// `docs/mutation-baseline.md` files the identical mutant in `find_path` as
    /// "A REAL GAP, not an equivalent mutant", carried on trust since M1a Task 9.
    /// Adding a second copy of a known gap to the baseline is what that document
    /// warns against - a baseline that only ever grows becomes a permission slip
    /// - so this kills it instead.
    ///
    /// **The fixture is not hand-drawn.** Multiplying makes the priority both
    /// inadmissible and inconsistent, which only produces a wrong answer on a
    /// maze where the cheap-looking direction is a detour, and such a maze is
    /// hard to invent by eye. It was found by brute force:
    /// `cargo run -p terri-core --example find_fscore_counterexample` walks
    /// random small grids comparing the real search, the mutated search, and a
    /// BFS optimum, and reports the first disagreement. This grid is its output
    /// after 11 107 596 cases. On it the true optimum is 11 steps and the mutant
    /// returns 13.
    ///
    /// So the assertion is the exact length. Do not relax it to a range: the
    /// range is what let the mutant through.
    #[test]
    fn the_adjacent_path_is_the_shortest_one_and_not_merely_a_valid_one() {
        // 4 x 7, from the counterexample search. Rendered as the search prints
        // it, so the shape is checkable against the tool that found it:
        //
        //     ...#
        //     .#..
        //     .#..
        //     .#..
        //     #...
        //     .#.#
        //     .#..
        let mut grid = TileGrid::new(4, 7);
        for (x, y) in [
            (3, 0),
            (1, 1),
            (1, 2),
            (1, 3),
            (0, 4),
            (1, 5),
            (3, 5),
            (1, 6),
        ] {
            grid.set_blocked(x, y, true);
        }
        let from = (0, 3);
        let to = (3, 6);

        let path = grid
            .find_path_adjacent_to_tile(from, to)
            .expect("the target has a reachable neighbour on this grid");

        // The optimum, independently established by the BFS in the
        // counterexample example rather than by reading this A* back.
        assert_eq!(
            path.len(),
            11,
            "the search must return the SHORTEST approach, not a valid one; a              corrupted f-score returns 13 here. Path was {path:?}"
        );

        // And it is a real path, so the length above cannot be met by cheating.
        assert!(
            is_adjacent(*path.last().unwrap(), to),
            "must end beside the target; got {:?}",
            path.last()
        );
        assert!(
            !path.contains(&to),
            "must not step onto the target; got {path:?}"
        );
        let mut cursor = from;
        for step in &path {
            assert!(
                is_adjacent(cursor, *step),
                "path must be contiguous: {cursor:?} to {step:?} in {path:?}"
            );
            assert!(
                grid.is_walkable(step.0, step.1),
                "every step must be walkable; {step:?} is not"
            );
            cursor = *step;
        }
    }

    /// **Which of several equally short routes comes back is pinned, and this
    /// is the only test that pins it** - the `find_path_adjacent` counterpart
    /// of `tie_breaking_pins_one_specific_path_among_equals`.
    ///
    /// A diagonal query on an open grid has many routes of the same length, so
    /// every other assertion on this function - the endpoint, the exact length,
    /// contiguity, walkability - is satisfied by all of them. What decides
    /// among them is the strict `<` in `tentative < g_score[next_idx]`, which
    /// refuses to re-parent a tile already reached at equal cost.
    ///
    /// **`cargo mutants` reported `<` relaxed to `<=` as a survivor here while
    /// it was caught in `find_path`**, and the asymmetry was exactly this test
    /// being absent. Measured: with `<=` this query returns
    /// `[(0, 1), (0, 2), (1, 2), (2, 2), (3, 2)]` instead - the same length,
    /// the same arrival tile, down the west side rather than along the north.
    ///
    /// What the strictness buys is the same thing the heap's index tiebreak
    /// buys, and it is not aesthetics: the world hash and the [D4] replay rest
    /// on the same query returning the same path across Rust versions and
    /// across future changes to push order. A same-process A/B cannot see that
    /// ([L5]), so the assertion has to be a golden route.
    #[test]
    fn the_adjacent_route_among_equally_short_ones_is_pinned() {
        let grid = TileGrid::new(6, 6);
        let path = grid
            .find_path_adjacent_to_tile((0, 0), (3, 3))
            .expect("an open grid is reachable");
        assert_eq!(path, vec![(1, 0), (2, 0), (3, 0), (3, 1), (3, 2)]);

        // The precondition that makes the golden route a CHOICE rather than
        // the only answer: a route of the same length exists down the other
        // side, so something had to pick between them.
        let mirrored = vec![(0, 1), (0, 2), (1, 2), (2, 2), (3, 2)];
        assert_eq!(
            mirrored.len(),
            path.len(),
            "the alternative is equally short"
        );
        let mut cursor = (0, 0);
        for step in &mirrored {
            assert!(
                is_adjacent(cursor, *step) && grid.is_walkable(step.0, step.1),
                "the alternative must be a real path, or it is not an alternative"
            );
            cursor = *step;
        }
        assert!(is_adjacent(*mirrored.last().unwrap(), (3, 3)));
    }

    /// Same query, same answer, every time - the determinism [D4] rests on.
    #[test]
    fn the_adjacent_path_is_stable_across_repeated_queries() {
        let mut grid = TileGrid::new(9, 9);
        for y in 2..7 {
            grid.set_blocked(4, y, true);
        }
        let first = grid.find_path_adjacent_to_tile((0, 4), (5, 4));
        for _ in 0..16 {
            assert_eq!(grid.find_path_adjacent_to_tile((0, 4), (5, 4)), first);
        }
    }

    // ---- footprints --------------------------------------------------------

    /// A footprint that occupies no tiles has an empty adjacency set, so every
    /// caller would read the object as unreachable and a sim would simply
    /// never use it. The authored schema also leans on this default: an object
    /// that omits `footprint` has to keep the 1x1 behaviour it had before the
    /// field existed, and `#[serde(default)]` is what gives it that.
    ///
    /// Stated as a test because `#[derive(Default)]` on this struct compiles
    /// and yields 0x0, so the manual impl is a mechanism rather than a
    /// formality.
    #[test]
    fn the_default_footprint_is_one_tile_rather_than_no_tiles() {
        assert_eq!(Footprint::default(), Footprint::SINGLE);
        assert_eq!(Footprint::SINGLE.width, 1);
        assert_eq!(Footprint::SINGLE.depth, 1);
    }

    /// The rectangle a 3x2 footprint at `(4, 2)` covers, so the numbers below
    /// read against something concrete:
    ///
    /// ```text
    ///        x=3 4 5 6 7
    ///   y=1      . . .
    ///   y=2    . # # # .
    ///   y=3    . # # # .
    ///   y=4      . . .
    /// ```
    const WIDE: Footprint = Footprint { width: 3, depth: 2 };
    const WIDE_ORIGIN: (i32, i32) = (4, 2);

    /// **`rect_distance` is the whole of the footprint geometry**, and both
    /// the goal test and the heuristic are it, so this is the test that says
    /// what it means.
    ///
    /// Two claims, and the second is what makes the first more than a
    /// restatement of the implementation:
    ///
    /// 1. The stated distance, per tile, for a rectangle that is **not
    ///    square**. 3 wide by 2 deep, so a transposed implementation gives
    ///    different answers at `(7, 3)` and at `(4, 5)` rather than agreeing
    ///    by symmetry - the [L34] shape, where a tidy fixture cannot express
    ///    the bug.
    /// 2. On an **open grid** that distance is the true remaining cost plus
    ///    one: the cheapest approach costs `rect_distance - 1` steps, because
    ///    every approach tile sits at `rect_distance` 1. That is the same
    ///    equality `the_heuristic_equals_the_true_cost_on_an_open_grid` pins
    ///    for the single-tile heuristic, and it is what makes "inadmissible by
    ///    exactly one, uniformly" a measured claim rather than an argument in
    ///    a comment.
    ///
    /// Interior tiles are excluded from claim 2 on purpose: their distance is
    /// 0 and no path can be `-1` steps long. What happens to an agent standing
    /// inside is
    /// `an_agent_standing_anywhere_on_a_wide_footprint_is_moved_off_it`.
    #[test]
    fn the_rectangle_distance_is_zero_inside_the_footprint_and_the_true_cost_outside_it() {
        // A grid roomy enough that no case below is clipped by an edge; the
        // farthest probe is (9, 7).
        let grid = TileGrid::new(12, 10);

        for (probe, expected) in [
            // Inside, including both corners and a middle tile.
            ((4, 2), 0u32),
            ((5, 2), 0),
            ((6, 3), 0),
            // Beside it, on all four sides.
            ((3, 2), 1),
            ((7, 3), 1),
            ((5, 1), 1),
            ((6, 4), 1),
            // Diagonally off both corners. Movement is four-way, so these are
            // 2 rather than 1 and are NOT approach tiles.
            ((3, 1), 2),
            ((7, 4), 2),
            // Two out on each axis separately, which is where a transposed
            // width and depth diverge from the truth.
            ((2, 3), 2),
            ((4, 5), 2),
            // Well clear, on both diagonals, so neither axis term can be
            // dropped without moving a number.
            ((0, 0), 6),
            ((9, 7), 7),
        ] {
            assert_eq!(
                rect_distance(probe, WIDE_ORIGIN, WIDE),
                expected,
                "rect_distance from {probe:?} to the 3x2 rectangle at {WIDE_ORIGIN:?}"
            );

            if expected == 0 {
                continue;
            }
            let path = grid
                .find_path_adjacent(probe, WIDE_ORIGIN, WIDE)
                .expect("an open grid reaches every approach tile");
            assert_eq!(
                path.len() as u32,
                expected - 1,
                "on an open grid the cheapest approach from {probe:?} must \
                 cost rect_distance - 1 steps; got {path:?}"
            );
        }
    }

    /// **The test that catches a heuristic measured to the origin tile rather
    /// than to the rectangle**, which is the one way to get footprints wrong
    /// that no other test here can see.
    ///
    /// The fixture is an alcove: a 4x1 object at `(4, 2)` filling the middle
    /// of a 4x3 obstacle, so the eight approach tiles above and below the
    /// object are walled off and the only two left are its two ENDS.
    ///
    /// ```text
    ///        x=0 1 2 3 4 5 6 7 8 9 10 11
    ///   y=0    . . . . . . . . . .  .  .
    ///   y=1    . . . . # # # # . .  .  .
    ///   y=2    . . . W # # # # E .  .  .     W = (3,2)  E = (8,2)
    ///   y=3    . . . . # # # # . .  .  .
    ///   y=4    . . . . . . . . . .  .  .
    ///   y=5    . . . . . . S . . .  .  .     S = the agent, (6,5)
    /// ```
    ///
    /// From `(6, 5)` the far end `E` costs 5 steps and the origin end `W`
    /// costs 6, so the cheapest approach is `E`. A heuristic of
    /// `Manhattan(n, origin)` scores `W` at `6 + 1 = 7` and `E` at
    /// `5 + 4 = 9`, because `E` is four tiles from the ORIGIN even though it
    /// is one tile from the rectangle - so it pops `W` first and returns a
    /// reachable, walkable, contiguous path that ends beside the object and is
    /// **one step longer than it needs to be**. Every other assertion in this
    /// file is satisfied by that answer.
    ///
    /// Both ends are asserted reachable and their costs stated, so the test is
    /// about the CHOICE rather than about one of them being walled off. And
    /// the assertion is the exact length, for the reason
    /// `the_adjacent_path_is_the_shortest_one_and_not_merely_a_valid_one`
    /// gives: a range is what lets a wrong-but-valid path through.
    #[test]
    fn the_chosen_approach_to_a_wide_footprint_is_the_cheapest_to_reach_not_the_nearest_to_its_origin(
    ) {
        let footprint = Footprint { width: 4, depth: 1 };
        let origin = (4, 2);
        let start = (6, 5);

        let mut grid = TileGrid::new(12, 6);
        // The object's own tiles are solid, per [F3], and so are the alcove
        // walls immediately above and below them.
        for x in 4..8 {
            for y in 1..4 {
                grid.set_blocked(x, y, true);
            }
        }

        // The precondition, measured rather than assumed: both ends are
        // reachable, and the far end is the cheaper by exactly one step.
        // Without this the test could pass because the origin end was sealed,
        // which is a different test and a much weaker one.
        let to_west = grid
            .find_path(start, (3, 2))
            .expect("the west end is reachable");
        let to_east = grid
            .find_path(start, (8, 2))
            .expect("the east end is reachable");
        assert_eq!(to_west.len(), 6, "the origin end costs 6 steps");
        assert_eq!(to_east.len(), 5, "the far end costs 5");
        assert!(
            rect_distance((8, 2), origin, footprint) == 1
                && rect_distance((3, 2), origin, footprint) == 1,
            "both ends must be approach tiles, or the search is not choosing \
             between them"
        );
        assert!(
            (8i32 - origin.0) > 1,
            "the far end must be more than one tile from the ORIGIN, or a \
             heuristic measured to the origin gives the same answer and this \
             test proves nothing"
        );

        let path = grid
            .find_path_adjacent(start, origin, footprint)
            .expect("both ends are reachable");
        assert_eq!(
            *path.last().unwrap(),
            (8, 2),
            "the cheapest approach is the far end; arriving at (3, 2) means \
             the heuristic is measured to the origin tile rather than to the \
             rectangle. Path was {path:?}"
        );
        assert_eq!(path.len(), 5, "and it must cost 5 steps, not 6");

        // A real path, so the length above cannot be met by cheating.
        let mut cursor = start;
        for step in &path {
            assert!(
                is_adjacent(cursor, *step),
                "path must be contiguous: {cursor:?} to {step:?} in {path:?}"
            );
            assert!(
                grid.is_walkable(step.0, step.1),
                "every step must be walkable; {step:?} is not"
            );
            assert!(
                rect_distance(*step, origin, footprint) >= 1,
                "no step may land inside the object; {step:?} did"
            );
            cursor = *step;
        }
    }

    /// Standing anywhere on a wide object is "on the furniture", not "beside
    /// it" - and **every** tile of it, not only the origin.
    ///
    /// Three separate mistakes end here, which is why the loop covers all
    /// three tiles rather than one:
    ///
    /// - An adjacency rule of `rect_distance <= 1` would call a tile inside
    ///   the rectangle a valid place to stand, so the agent would be handed an
    ///   empty path and would use the object from on top of it.
    /// - An adjacency rule measured to the ORIGIN tile calls `(5, 4)` adjacent,
    ///   since it is one tile away, so an agent standing on the middle of a
    ///   sofa would never move and an agent on the far tile would step onto
    ///   the middle of it and stop there.
    /// - The same origin-only rule sends an agent on the far tile `(6, 4)` to
    ///   `(5, 4)`, which is one step and lands *inside* the object. The length
    ///   assertion alone cannot see that; the distance assertion is what does.
    #[test]
    fn an_agent_standing_anywhere_on_a_wide_footprint_is_moved_off_it() {
        let footprint = Footprint { width: 3, depth: 1 };
        let origin = (4, 4);
        let grid = TileGrid::new(10, 10);

        for from in [(4, 4), (5, 4), (6, 4)] {
            let path = grid
                .find_path_adjacent(from, origin, footprint)
                .expect("the rectangle is not sealed in");
            assert_eq!(
                path.len(),
                1,
                "an agent on {from:?} must take exactly one step to get \
                 beside the object; got {path:?}"
            );
            assert_eq!(
                rect_distance(path[0], origin, footprint),
                1,
                "and that step must land BESIDE the rectangle rather than on \
                 another of its tiles; {:?} is at distance {}",
                path[0],
                rect_distance(path[0], origin, footprint)
            );
        }
    }

    /// The wrapper passes `Footprint::SINGLE` and not a wider default.
    ///
    /// Asserted as an equality against the explicit call AND as an inequality
    /// against a 2x1 one, because the equality alone is satisfied by a wrapper
    /// that passes anything at all as long as both sides pass the same thing -
    /// which is exactly what a defaulted footprint argument would do.
    ///
    /// The approach is from the EAST, deliberately. From the west both
    /// footprints put the agent on `(3, 4)` and the two are indistinguishable;
    /// a wider object is only wider on its far side.
    #[test]
    fn find_path_adjacent_to_tile_targets_one_tile_and_not_a_wider_default() {
        let grid = TileGrid::new(10, 10);
        let (from, to) = ((9, 4), (4, 4));

        let single = grid
            .find_path_adjacent_to_tile(from, to)
            .expect("an open grid is reachable");
        assert_eq!(
            Some(single.clone()),
            grid.find_path_adjacent(from, to, Footprint::SINGLE),
            "the wrapper must be the 1x1 case of the general search"
        );
        assert_eq!(*single.last().unwrap(), (5, 4));
        assert_eq!(single.len(), 4);

        let wide = grid
            .find_path_adjacent(from, to, Footprint { width: 2, depth: 1 })
            .expect("an open grid is reachable");
        assert_ne!(
            single, wide,
            "a 2x1 object must be approachable one tile sooner from the east, \
             or the equality above cannot tell SINGLE from anything else"
        );
        assert_eq!(*wide.last().unwrap(), (6, 4));
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
