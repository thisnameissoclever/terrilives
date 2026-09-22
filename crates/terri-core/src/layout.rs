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

impl EdgeAxis {
    /// The boundary's number for this axis, matching `wall_edges`' first word.
    pub const fn code(self) -> u8 {
        match self {
            Self::Vertical => 0,
            Self::Horizontal => 1,
        }
    }

    pub const fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Self::Vertical),
            1 => Some(Self::Horizontal),
            _ => None,
        }
    }
}

/// What one boundary between two tiles is: nothing, a wall, a doorway in a
/// wall, or a window - [WT-command] in `docs/specs/2026-09-21-wall-tool.md`
/// and [WN-state] in `docs/specs/2026-09-22-windows.md`. The order is the
/// wire order and the boundary's codes; append only, which is why `Window`
/// is last rather than beside the wall it is a kind of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WallState {
    Open,
    Wall,
    Doorway,
    Window,
}

impl WallState {
    pub const fn code(self) -> u8 {
        match self {
            Self::Open => 0,
            Self::Wall => 1,
            Self::Doorway => 2,
            Self::Window => 3,
        }
    }

    pub const fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Self::Open),
            1 => Some(Self::Wall),
            2 => Some(Self::Doorway),
            3 => Some(Self::Window),
            _ => None,
        }
    }

    /// Whether a person is stopped by this boundary. A window is a wall to
    /// anyone trying to walk through it ([WN-rules]).
    pub const fn blocks_movement(self) -> bool {
        matches!(self, Self::Wall | Self::Window)
    }

    /// Whether the sky passes. A doorway and a window let the day in; a wall
    /// stops it, and an open line has nothing to stop it ([WN-rules]).
    pub const fn passes_daylight(self) -> bool {
        !matches!(self, Self::Wall)
    }

    /// The state a saved record describes. A line with no record is `Open`.
    /// A window has no `WallEdge` at all: it is a line in the layout's own
    /// window list ([WN-state]), so callers that can see one ask the layout.
    pub fn of(edge: Option<&WallEdge>) -> Self {
        match edge {
            None => Self::Open,
            Some(edge) if edge.doorway => Self::Doorway,
            Some(_) => Self::Wall,
        }
    }
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

/// One boundary between two tiles, named as a [`WallEdge`] names it, with no
/// state - the doorway a room is built with ([RT-command]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct WallLine {
    pub axis: EdgeAxis,
    pub x: u32,
    pub y: u32,
}

/// What one household member is to another - [FM-tie] in
/// `docs/specs/2026-09-22-family.md`. The order is the wire order and the
/// codes; append only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Relation {
    Partner,
    Parent,
    Child,
    Sibling,
}

impl Relation {
    pub const ALL: [Self; 4] = [Self::Partner, Self::Parent, Self::Child, Self::Sibling];

    pub const fn code(self) -> u8 {
        match self {
            Self::Partner => 0,
            Self::Parent => 1,
            Self::Child => 2,
            Self::Sibling => 3,
        }
    }

    pub const fn from_code(code: u8) -> Option<Self> {
        match code {
            0 => Some(Self::Partner),
            1 => Some(Self::Parent),
            2 => Some(Self::Child),
            3 => Some(Self::Sibling),
            _ => None,
        }
    }

    /// The same tie read from the other person's side: a parent's other end
    /// is a child, and the rest are their own ([FM-tie]).
    pub const fn mirrored(self) -> Self {
        match self {
            Self::Parent => Self::Child,
            Self::Child => Self::Parent,
            other => other,
        }
    }

    /// The plain word for this relation, as the relationship list says it.
    pub const fn word(self) -> &'static str {
        match self {
            Self::Partner => "partner",
            Self::Parent => "parent",
            Self::Child => "child",
            Self::Sibling => "sibling",
        }
    }
}

/// Who the household are to each other - [FM-save]. One entry per pair,
/// stored from the lower entity index to the higher with the relation as the
/// lower one sees it, so a parent and a child are one fact read from either
/// end.
///
/// **Keyed on the entity index today, and that is a debt, not a decision.**
/// `Relationships` keys on SimId because an index is reused once its entity
/// is gone ([L47]). No sim can leave or die yet, sold indices are retired
/// rather than reused, and a load rebuilds every index exactly, so no tie
/// can transfer to the wrong person in this build. It could the moment
/// somebody can move out, which is why [T-family-simid] in
/// `docs/TIM-TODO.md` says this must change before that slice.
#[derive(Resource, Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FamilyTies {
    ties: Vec<(u32, u32, u8)>,
}

impl FamilyTies {
    /// Every tie, sorted by the pair it joins.
    pub fn ties(&self) -> &[(u32, u32, u8)] {
        &self.ties
    }

    /// What `who` is to `to`, or `None` when they are not related. Reading
    /// the stored fact from the higher one's side mirrors it.
    pub fn relation(&self, who: u32, to: u32) -> Option<Relation> {
        let (low, high) = (who.min(to), who.max(to));
        let stored = self
            .ties
            .binary_search_by_key(&(low, high), |&(a, b, _)| (a, b))
            .ok()
            .and_then(|at| Relation::from_code(self.ties[at].2))?;
        Some(if who == low {
            stored
        } else {
            stored.mirrored()
        })
    }

    /// Records that `who` is `relation` to `to`, or removes the tie with
    /// `None`. Returns whether anything changed. A sim tied to itself is
    /// refused rather than stored.
    pub fn set(&mut self, who: u32, to: u32, relation: Option<Relation>) -> bool {
        if who == to {
            return false;
        }
        let (low, high) = (who.min(to), who.max(to));
        let stored = relation.map(|relation| {
            if who == low {
                relation
            } else {
                relation.mirrored()
            }
        });
        match (
            self.ties
                .binary_search_by_key(&(low, high), |&(a, b, _)| (a, b)),
            stored,
        ) {
            (Ok(at), None) => {
                self.ties.remove(at);
                true
            }
            (Ok(at), Some(relation)) if self.ties[at].2 == relation.code() => false,
            (Ok(at), Some(relation)) => {
                self.ties[at].2 = relation.code();
                true
            }
            (Err(_), None) => false,
            (Err(at), Some(relation)) => {
                self.ties.insert(at, (low, high, relation.code()));
                true
            }
        }
    }

    /// The saved list, refused whole when a tie names somebody that is not
    /// there, ties a sim to itself, repeats a pair, is out of order, or
    /// names a relation the game does not have ([FM-save]).
    pub fn from_saved(ties: Vec<(u32, u32, u8)>, known: &dyn Fn(u32) -> bool) -> Option<Self> {
        let mut previous: Option<(u32, u32)> = None;
        for &(low, high, code) in &ties {
            if low >= high
                || Relation::from_code(code).is_none()
                || previous.is_some_and(|last| last >= (low, high))
            {
                return None;
            }
            if !known(low) || !known(high) {
                return None;
            }
            previous = Some((low, high));
        }
        Some(Self { ties })
    }
}

/// What the player has laid on the floor, one entry per painted tile and
/// nothing for the rest - [FL-save] in `docs/specs/2026-09-22-floors.md`.
///
/// Sparse and sorted by tile, so a house nobody has painted costs one byte
/// and two houses painted in different orders save identically. A tile with
/// no entry is drawn by where it is ([OS-yard]), which is how every save
/// written before floors existed keeps looking exactly as it did.
#[derive(Resource, Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedFloors {
    tiles: Vec<(u32, u32, u8)>,
}

impl SavedFloors {
    /// The painted tiles, sorted, each `(x, y, covering)` with a covering of
    /// 1 upward: an entry is never a 0, which is the absence of one.
    pub fn tiles(&self) -> &[(u32, u32, u8)] {
        &self.tiles
    }

    /// The covering on this tile, or 0 for a tile the player has not painted.
    pub fn covering(&self, x: u32, y: u32) -> u8 {
        self.tiles
            .binary_search_by_key(&(x, y), |&(tx, ty, _)| (tx, ty))
            .map_or(0, |at| self.tiles[at].2)
    }

    /// Lays `covering` on a tile, or takes its covering away with 0.
    /// Returns whether anything changed, so a repeat of what is already
    /// there writes nothing and moves no revision.
    pub fn set(&mut self, x: u32, y: u32, covering: u8) -> bool {
        match (
            self.tiles
                .binary_search_by_key(&(x, y), |&(tx, ty, _)| (tx, ty)),
            covering,
        ) {
            (Ok(at), 0) => {
                self.tiles.remove(at);
                true
            }
            (Ok(at), _) if self.tiles[at].2 == covering => false,
            (Ok(at), _) => {
                self.tiles[at].2 = covering;
                true
            }
            (Err(_), 0) => false,
            (Err(at), _) => {
                self.tiles.insert(at, (x, y, covering));
                true
            }
        }
    }

    /// The saved list, refused whole when any entry is off the lot, names a
    /// covering the content does not have, repeats a tile, is out of order,
    /// or is a 0 where no entry belongs at all ([FL-save]).
    pub fn from_saved(
        tiles: Vec<(u32, u32, u8)>,
        width: u32,
        height: u32,
        coverings: usize,
    ) -> Option<Self> {
        let mut previous: Option<(u32, u32)> = None;
        for &(x, y, covering) in &tiles {
            if x >= width || y >= height || covering == 0 || covering as usize > coverings {
                return None;
            }
            if previous.is_some_and(|last| last >= (x, y)) {
                return None;
            }
            previous = Some((x, y));
        }
        Some(Self { tiles })
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
    /// [WN-state]: walls and doorways as before, plus the lines that are
    /// windows. Appended after `EdgeWallsV1` rather than growing it,
    /// because postcard writes a variant's index and an enum grows by
    /// appending: every save written before windows still says
    /// `EdgeWallsV1` and still decodes byte for byte.
    EdgeWallsV2 {
        edges: Vec<WallEdge>,
        windows: Vec<WallLine>,
    },
}

impl SavedLayout {
    /// The wall and doorway records, empty for a layout that has none.
    /// Callers ask for what they need rather than matching a version, so
    /// the next variant costs one method here instead of a match each.
    pub fn edges(&self) -> &[WallEdge] {
        match self {
            Self::EdgeWallsV1 { edges } | Self::EdgeWallsV2 { edges, .. } => edges,
            Self::LegacyAuthoredV1 | Self::LegacyCells { .. } => &[],
        }
    }

    /// The lines that are windows ([WN-state]), empty for every layout
    /// written before windows existed.
    pub fn windows(&self) -> &[WallLine] {
        match self {
            Self::EdgeWallsV2 { windows, .. } => windows,
            _ => &[],
        }
    }

    /// Whether this layout keeps its architecture as edge records at all,
    /// which the legacy two do not.
    pub fn has_edges(&self) -> bool {
        matches!(self, Self::EdgeWallsV1 { .. } | Self::EdgeWallsV2 { .. })
    }

    /// The layout holding these records, and the OLDER variant whenever
    /// there are no windows. A house with no window is then byte-identical
    /// to one saved before windows existed, so its save does not grow and
    /// its world hash does not move; the newer variant appears the moment a
    /// window does ([WN-state]).
    pub fn from_parts(edges: Vec<WallEdge>, windows: Vec<WallLine>) -> Self {
        if windows.is_empty() {
            Self::EdgeWallsV1 { edges }
        } else {
            Self::EdgeWallsV2 { edges, windows }
        }
    }

    /// What this boundary is, reading both lists ([WN-state]). A line in
    /// both is a corrupt save, and the wall wins, because a barrier kept by
    /// mistake is safe and one dropped by mistake strands a sim outdoors.
    pub fn state_of(&self, line: WallLine) -> WallState {
        let edge = self
            .edges()
            .iter()
            .find(|edge| edge.axis == line.axis && edge.x == line.x && edge.y == line.y);
        match WallState::of(edge) {
            WallState::Open if self.windows().contains(&line) => WallState::Window,
            state => state,
        }
    }
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
    fn axis_and_state_codes_are_pinned_and_round_trip() {
        assert_eq!(EdgeAxis::Vertical.code(), 0);
        assert_eq!(EdgeAxis::Horizontal.code(), 1);
        assert_eq!(WallState::Open.code(), 0);
        assert_eq!(WallState::Wall.code(), 1);
        assert_eq!(WallState::Doorway.code(), 2);
        // [WN-state]: appended after the three that shipped, so no saved or
        // queued command changes meaning.
        assert_eq!(WallState::Window.code(), 3);
        for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
            assert_eq!(EdgeAxis::from_code(axis.code()), Some(axis));
        }
        for state in [
            WallState::Open,
            WallState::Wall,
            WallState::Doorway,
            WallState::Window,
        ] {
            assert_eq!(WallState::from_code(state.code()), Some(state));
        }
        assert_eq!(EdgeAxis::from_code(2), None);
        assert_eq!(WallState::from_code(4), None);
    }

    /// [WN-rules]: a window stops a person and passes the day.
    #[test]
    fn a_window_stops_a_person_and_passes_the_sky() {
        for (state, blocks, passes) in [
            (WallState::Open, false, true),
            (WallState::Wall, true, false),
            (WallState::Doorway, false, true),
            (WallState::Window, true, true),
        ] {
            assert_eq!(state.blocks_movement(), blocks, "{state:?} movement");
            assert_eq!(state.passes_daylight(), passes, "{state:?} daylight");
        }
    }

    #[test]
    fn a_line_with_no_record_is_open_and_a_record_is_a_wall_or_a_doorway() {
        let wall = WallEdge {
            axis: EdgeAxis::Vertical,
            x: 1,
            y: 1,
            doorway: false,
        };
        let doorway = WallEdge {
            doorway: true,
            ..wall
        };
        assert_eq!(WallState::of(None), WallState::Open);
        assert_eq!(WallState::of(Some(&wall)), WallState::Wall);
        assert_eq!(WallState::of(Some(&doorway)), WallState::Doorway);
    }

    /// [FM-tie]: one stored fact, read from either end, and a parent's
    /// other end is a child.
    #[test]
    fn a_tie_reads_the_same_from_both_sides() {
        let mut family = FamilyTies::default();
        assert!(family.set(7, 2, Some(Relation::Parent)));
        // Stored once, from the lower sim id.
        assert_eq!(family.ties(), [(2, 7, Relation::Child.code())]);
        assert_eq!(family.relation(7, 2), Some(Relation::Parent));
        assert_eq!(family.relation(2, 7), Some(Relation::Child));
        assert_eq!(family.relation(2, 3), None);

        for relation in [Relation::Partner, Relation::Sibling] {
            assert_eq!(
                relation.mirrored(),
                relation,
                "{relation:?} is its own mirror"
            );
        }
        assert_eq!(Relation::Parent.mirrored(), Relation::Child);
        for relation in Relation::ALL {
            assert_eq!(Relation::from_code(relation.code()), Some(relation));
        }
        assert_eq!(Relation::from_code(4), None);

        // A repeat writes nothing; a change writes; None takes it away.
        assert!(!family.set(2, 7, Some(Relation::Child)));
        assert!(family.set(2, 7, Some(Relation::Sibling)));
        assert_eq!(family.relation(7, 2), Some(Relation::Sibling));
        assert!(family.set(7, 2, None));
        assert!(family.ties().is_empty());
        assert!(
            !family.set(5, 5, Some(Relation::Partner)),
            "nobody is their own sibling"
        );
    }

    /// [FM-save]: a saved list is refused whole rather than repaired.
    #[test]
    fn a_saved_family_is_refused_when_it_cannot_be_true() {
        let known = |id: u32| id < 4;
        let ok = FamilyTies::from_saved(vec![(0, 1, 0), (1, 3, 3)], &known).expect("well formed");
        assert_eq!(ok.relation(1, 0), Some(Relation::Partner));
        for bad in [
            vec![(0, 9, 0)],
            vec![(1, 1, 0)],
            vec![(1, 0, 0)],
            vec![(0, 1, 9)],
            vec![(0, 1, 0), (0, 1, 3)],
            vec![(1, 3, 0), (0, 1, 0)],
        ] {
            assert!(
                FamilyTies::from_saved(bad.clone(), &known).is_none(),
                "{bad:?} must be refused"
            );
        }
    }

    /// [FL-save]: the painted tiles stay sorted whatever order they were
    /// painted in, a repeat writes nothing, and 0 takes a covering away.
    #[test]
    fn the_painted_tiles_stay_sorted_and_sparse() {
        let mut floors = SavedFloors::default();
        assert!(floors.set(3, 1, 2));
        assert!(floors.set(1, 4, 1));
        assert!(floors.set(1, 0, 3));
        assert_eq!(floors.tiles(), [(1, 0, 3), (1, 4, 1), (3, 1, 2)]);
        assert_eq!(floors.covering(1, 4), 1);
        assert_eq!(floors.covering(2, 2), 0, "an unpainted tile has none");

        assert!(
            !floors.set(1, 4, 1),
            "laying what is already there changes nothing"
        );
        assert!(floors.set(1, 4, 2));
        assert_eq!(floors.covering(1, 4), 2);
        assert!(floors.set(1, 4, 0), "0 takes the covering away");
        assert_eq!(floors.tiles(), [(1, 0, 3), (3, 1, 2)]);
        assert!(!floors.set(9, 9, 0), "so does nothing, on a bare tile");
    }

    /// [FL-save]: a saved list is refused whole rather than repaired.
    #[test]
    fn a_saved_floor_list_is_refused_when_it_cannot_be_true() {
        let ok = SavedFloors::from_saved(vec![(0, 0, 1), (1, 0, 3)], 4, 4, 3)
            .expect("in bounds, in order, known coverings");
        assert_eq!(ok.covering(1, 0), 3);
        for bad in [
            vec![(4, 0, 1)],
            vec![(0, 4, 1)],
            vec![(0, 0, 0)],
            vec![(0, 0, 4)],
            vec![(1, 0, 1), (0, 0, 1)],
            vec![(0, 0, 1), (0, 0, 2)],
        ] {
            assert!(
                SavedFloors::from_saved(bad.clone(), 4, 4, 3).is_none(),
                "{bad:?} must be refused"
            );
        }
    }

    /// [WN-state]: the layout answers for both lists, and an old layout
    /// answers that it has no windows rather than failing to answer.
    #[test]
    fn the_layout_reads_walls_doorways_and_windows_through_one_door() {
        let line = |axis, x, y| WallLine { axis, x, y };
        let wall = WallEdge {
            axis: EdgeAxis::Vertical,
            x: 2,
            y: 1,
            doorway: false,
        };
        let doorway = WallEdge {
            axis: EdgeAxis::Horizontal,
            x: 3,
            y: 4,
            doorway: true,
        };
        let window = line(EdgeAxis::Vertical, 5, 6);
        let layout = SavedLayout::from_parts(vec![wall, doorway], vec![window]);
        assert!(matches!(layout, SavedLayout::EdgeWallsV2 { .. }));
        // No window, no new variant: the save does not grow and the world
        // hash of an existing house cannot move.
        assert_eq!(
            SavedLayout::from_parts(vec![wall], Vec::new()),
            SavedLayout::EdgeWallsV1 { edges: vec![wall] }
        );
        assert_eq!(layout.state_of(window), WallState::Window);
        assert_eq!(
            layout.state_of(line(EdgeAxis::Vertical, 2, 1)),
            WallState::Wall
        );
        assert_eq!(
            layout.state_of(line(EdgeAxis::Horizontal, 3, 4)),
            WallState::Doorway
        );
        assert_eq!(
            layout.state_of(line(EdgeAxis::Vertical, 9, 9)),
            WallState::Open
        );

        // A line in both lists is a corrupt save: the wall wins.
        let corrupt = SavedLayout::from_parts(vec![wall], vec![line(EdgeAxis::Vertical, 2, 1)]);
        assert_eq!(
            corrupt.state_of(line(EdgeAxis::Vertical, 2, 1)),
            WallState::Wall
        );

        // Every layout written before windows reads as a house with none.
        let old = SavedLayout::EdgeWallsV1 { edges: vec![wall] };
        assert!(old.windows().is_empty());
        assert_eq!(old.edges(), [wall]);
        assert!(old.has_edges());
        assert!(!SavedLayout::LegacyCells { walls: Vec::new() }.has_edges());
        assert!(SavedLayout::LegacyAuthoredV1.edges().is_empty());
    }

    /// [WN-old-saves]: an EdgeWallsV1 payload written before windows existed
    /// still decodes, because a postcard enum grows by appending a variant.
    #[test]
    fn a_layout_saved_before_windows_still_decodes() {
        let old = SavedLayout::EdgeWallsV1 {
            edges: vec![WallEdge {
                axis: EdgeAxis::Horizontal,
                x: 7,
                y: 2,
                doorway: true,
            }],
        };
        let bytes = postcard::to_allocvec(&old).expect("serialises");
        assert_eq!(bytes[0], 2, "EdgeWallsV1 is still variant 2");
        let read: SavedLayout = postcard::from_bytes(&bytes).expect("old layout still decodes");
        assert_eq!(read, old);

        let new = SavedLayout::from_parts(
            Vec::new(),
            vec![WallLine {
                axis: EdgeAxis::Vertical,
                x: 1,
                y: 1,
            }],
        );
        let bytes = postcard::to_allocvec(&new).expect("serialises");
        assert_eq!(bytes[0], 3, "EdgeWallsV2 is the appended variant");
        assert_eq!(
            postcard::from_bytes::<SavedLayout>(&bytes).expect("decodes"),
            new
        );
    }

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
