//! Buying land - issue 254 (`docs/specs/2026-10-17-land-expansion.md`).
//!
//! A purchase adds a strip `land_strip_depth` tiles deep along the whole
//! of one side of the lot. The street is the east column, so the rear is
//! west, and the two sides are north and south. A south strip only
//! lengthens the grid. A west or north strip grows the grid at its origin,
//! and every coordinate the world holds moves by the strip's depth: the
//! grid, every position and path, the walls, windows and floors, the chore
//! cells and room ids, the grime patches, the diners' places, and the
//! frame that places the content lot. Money is in cents.
use bevy_ecs::prelude::*;
use terri_core::chores::{ChoreKind, SavedChores};
use terri_core::grime::SavedGrime;
use terri_core::layout::{SavedFloors, SavedLayout, WallEdge, WallLine};
use terri_core::save::{SavedDining, SavedDomestic};
use terri_core::windows::WindowPlacement;
use terri_core::{Funds, Path, Position, TileGrid};

use crate::lot_frame;
use crate::room_regions::RoomRegions;

/// The three sides land can be bought on, as the interface numbers them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    /// Behind the house, away from the street: west.
    Rear = 0,
    /// The left side, standing on the street facing the house: south.
    Left = 1,
    /// The right side, standing on the street facing the house: north.
    Right = 2,
}

impl Side {
    pub fn from_index(index: u32) -> Option<Self> {
        match index {
            0 => Some(Self::Rear),
            1 => Some(Self::Left),
            2 => Some(Self::Right),
            _ => None,
        }
    }
}

/// The grid may not pass this many tiles on a side. The loader bounds the
/// tile count, not a side; this keeps a lot a shape the view and the tools
/// were made for, and keeps every price inside an `i64`.
pub const MAX_SIDE: u32 = 1024;

/// Why a purchase was refused, numbered for the shell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LandRefusal {
    UnknownSide = 1,
    /// The world's walls are a frozen legacy layout, or it has no frame.
    UnsupportedLayout = 2,
    TooLarge = 3,
    CannotAfford = 4,
}

/// What one strip would be and cost. A quote changes nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quote {
    pub side: Side,
    /// The strip's size along the side and its depth, in tiles.
    pub length: u32,
    pub depth: u32,
    pub area: u32,
    pub price_cents: i64,
    pub remaining_cents: i64,
}

impl Quote {
    pub fn affordable(&self) -> bool {
        self.remaining_cents >= 0
    }
}

/// What the drain did with the last purchase: the side as the command
/// named it, and either the cents charged or why nothing was.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LandResult {
    pub side: u32,
    pub charged_cents: Option<i64>,
    pub reason: Option<LandRefusal>,
}

/// The drain's entry point for `SimCommand::BuyLand`: buys or refuses, and
/// records which in `LotEditState::last_land_result`.
pub(crate) fn commit(world: &mut World, side: u32) {
    let outcome = match Side::from_index(side) {
        Some(parsed) => buy(world, parsed),
        None => Err(LandRefusal::UnknownSide),
    };
    let result = match outcome {
        Ok(quoted) => LandResult {
            side,
            charged_cents: Some(quoted.price_cents),
            reason: None,
        },
        Err(reason) => LandResult {
            side,
            charged_cents: None,
            reason: Some(reason),
        },
    };
    world
        .resource_mut::<crate::placement::LotEditState>()
        .last_land_result = Some(result);
}

/// The price of one square with `purchased` squares already bought, in
/// cents: the base price plus the step for every square bought.
pub fn square_price_cents(tuning: &terri_data::Tuning, purchased: u32) -> i64 {
    i64::from(tuning.land_price_cents)
        + i64::from(tuning.land_price_step_cents) * i64::from(purchased)
}

/// The strip's size on `side` for a `width` by `height` lot.
pub fn strip(tuning: &terri_data::Tuning, side: Side, width: u32, height: u32) -> (u32, u32) {
    let depth = tuning.land_strip_depth;
    match side {
        Side::Rear => (height, depth),
        Side::Left | Side::Right => (width, depth),
    }
}

/// The quote for `side`, from the same numbers a purchase uses.
pub fn quote(world: &World, side: Side) -> Quote {
    let tuning = &world.resource::<crate::Content>().0.tuning;
    let grid = world.resource::<TileGrid>();
    let purchased = lot_frame::frame(world).map_or(0, |f| f.purchased_area);
    let (length, depth) = strip(tuning, side, grid.width() as u32, grid.height() as u32);
    let area = length * depth;
    // A price past `i64` saturates and is refused as too large, never wrapped.
    let price_cents = i64::from(area)
        .checked_mul(square_price_cents(tuning, purchased))
        .unwrap_or(i64::MAX);
    let funds = world.get_resource::<Funds>().map_or(0, |f| f.0);
    Quote {
        side,
        length,
        depth,
        area,
        price_cents,
        remaining_cents: funds.saturating_sub(price_cents),
    }
}

/// Checks a purchase without changing anything.
pub fn validate(world: &World, side: Side) -> Result<Quote, LandRefusal> {
    if lot_frame::frame(world).is_none()
        || !matches!(
            world.resource::<SavedLayout>(),
            SavedLayout::EdgeWallsV1 { .. }
                | SavedLayout::EdgeWallsV2 { .. }
                | SavedLayout::EdgeWallsV3 { .. }
        )
    {
        return Err(LandRefusal::UnsupportedLayout);
    }
    let grid = world.resource::<TileGrid>();
    let quoted = quote(world, side);
    let (width, height) = (grid.width() as u32, grid.height() as u32);
    let grown = match side {
        Side::Rear => (width + quoted.depth, height),
        Side::Left | Side::Right => (width, height + quoted.depth),
    };
    if grown.0 > MAX_SIDE
        || grown.1 > MAX_SIDE
        || quoted.area == 0
        || quoted.price_cents == i64::MAX
    {
        return Err(LandRefusal::TooLarge);
    }
    if !quoted.affordable() {
        return Err(LandRefusal::CannotAfford);
    }
    Ok(quoted)
}

/// Buys the strip: charges the quoted cents once, grows the lot, and adds
/// the strip's area to the purchased total. Refuses as [`validate`] does,
/// writing nothing.
pub fn buy(world: &mut World, side: Side) -> Result<Quote, LandRefusal> {
    let quoted = validate(world, side)?;
    world.resource_mut::<Funds>().0 -= quoted.price_cents;
    let (dx, dy, grow_x, grow_y) = match side {
        Side::Rear => (quoted.depth, 0, quoted.depth, 0),
        Side::Left => (0, 0, 0, quoted.depth),
        Side::Right => (0, quoted.depth, 0, quoted.depth),
    };
    grow(world, (dx, dy), (grow_x, grow_y));
    let mut frame = lot_frame::frame(world).unwrap_or_default();
    frame.purchased_area += quoted.area;
    world.insert_resource(frame);
    world
        .resource_mut::<crate::placement::LotEditState>()
        .revision += 1;
    Ok(quoted)
}

/// Grows the grid by `(grow_x, grow_y)` tiles and moves everything by
/// `(dx, dy)`, where the move is the growth on a side the origin is on.
pub(crate) fn grow(world: &mut World, (dx, dy): (u32, u32), (grow_x, grow_y): (u32, u32)) {
    let (old_width, old_height) = {
        let grid = world.resource::<TileGrid>();
        (grid.width() as u32, grid.height() as u32)
    };
    let new_width = old_width + grow_x;
    let new_height = old_height + grow_y;

    // The grid: every blocked tile and every barrier, moved.
    let old_grid = world.resource::<TileGrid>().clone();
    let mut grid = TileGrid::new(new_width as usize, new_height as usize);
    for y in 0..old_height {
        for x in 0..old_width {
            if !old_grid.is_walkable(x as i32, y as i32) {
                grid.set_blocked((x + dx) as usize, (y + dy) as usize, true);
            }
        }
    }
    let shift_tile = |(x, y): (i32, i32)| (x + dx as i32, y + dy as i32);
    for (from, to) in old_grid.blocked_edges() {
        grid.set_edge_blocked(shift_tile(from), shift_tile(to), true);
    }

    // The frame, then the house's shell where it has left the grid's edge.
    let mut frame = lot_frame::frame(world).unwrap_or_default();
    frame.origin = (frame.origin.0 + dx, frame.origin.1 + dy);
    world.insert_resource(frame);
    world.insert_resource(grid);
    if let Some(house) = lot_frame::house(world) {
        lot_frame::block_shell(&mut world.resource_mut::<TileGrid>(), house);
    }

    // Walls, windows and floors.
    let layout = world.resource::<SavedLayout>().clone();
    let shift_edge = |edge: &WallEdge| WallEdge {
        axis: edge.axis,
        x: edge.x + dx,
        y: edge.y + dy,
        doorway: edge.doorway,
    };
    let shift_line = |line: WallLine| WallLine {
        axis: line.axis,
        x: line.x + dx,
        y: line.y + dy,
    };
    let moved = match &layout {
        SavedLayout::EdgeWallsV3 { edges, windows } => SavedLayout::EdgeWallsV3 {
            edges: edges.iter().map(shift_edge).collect(),
            windows: windows
                .iter()
                .map(|w| WindowPlacement {
                    line: shift_line(w.line),
                    model: w.model,
                })
                .collect(),
        },
        SavedLayout::EdgeWallsV2 { edges, windows } => SavedLayout::EdgeWallsV2 {
            edges: edges.iter().map(shift_edge).collect(),
            windows: windows.iter().map(|w| shift_line(*w)).collect(),
        },
        SavedLayout::EdgeWallsV1 { edges } => SavedLayout::EdgeWallsV1 {
            edges: edges.iter().map(shift_edge).collect(),
        },
        SavedLayout::LegacyCells { walls } => SavedLayout::LegacyCells {
            walls: walls.iter().map(|&(x, y)| (x + dx, y + dy)).collect(),
        },
        SavedLayout::LegacyAuthoredV1 => SavedLayout::LegacyAuthoredV1,
    };
    // A record on the old lot's edge, a perimeter solid a room or a wall
    // edit left there, had no barrier while the edge was the grid's edge.
    // Inside the grid it blocks, exactly as the lot-edit rebuild and the
    // loader apply it; a purchase must leave the grid they would build.
    {
        let (width, height) = (new_width, new_height);
        let house = lot_frame::house_or_grid(world);
        let framed = lot_frame::house(world);
        let mut grid = world.resource_mut::<TileGrid>();
        for edge in moved.edges() {
            if edge.in_bounds(width, height) {
                let [a, b] = edge.cells();
                grid.set_edge_blocked(a, b, !edge.doorway);
            }
        }
        for window in moved.window_lines() {
            if crate::placement::windows::is_rear(window, house) {
                continue;
            }
            let edge = WallEdge {
                axis: window.axis,
                x: window.x,
                y: window.y,
                doorway: false,
            };
            if edge.in_bounds(width, height) {
                let [a, b] = edge.cells();
                grid.set_edge_blocked(a, b, true);
            }
        }
        if let Some(house) = framed {
            lot_frame::block_shell(&mut grid, house);
        }
    }
    world.insert_resource(moved);
    if let Some(floors) = world.get_resource::<SavedFloors>() {
        let mut shifted = SavedFloors::default();
        for &(x, y, covering) in floors.tiles() {
            shifted.set(x + dx, y + dy, covering);
        }
        world.insert_resource(shifted);
    }

    // People, objects and the walks and reading journeys they are on.
    let mut positions = world.query::<&mut Position>();
    for mut position in positions.iter_mut(world) {
        position.x += dx as f32;
        position.y += dy as f32;
    }
    let mut paths = world.query::<&mut Path>();
    for mut path in paths.iter_mut(world) {
        for step in &mut path.steps {
            *step = shift_tile(*step);
        }
    }
    let mut journeys = world.query::<&mut crate::reading::ReadingJourney>();
    for mut journey in journeys.iter_mut(world) {
        journey.destination = shift_tile(journey.destination);
        journey.transfer_contact = journey.transfer_contact.map(shift_tile);
    }

    // Cells and room ids: a cell moves with its tile. A room id is read
    // again at its seed tile once moved, and becomes the moved cell when
    // that tile is in no room.
    let new_rooms = RoomRegions::from_world(world);
    let cell = |old: u32| (old / old_width + dy) * new_width + (old % old_width + dx);
    let room = |old: u32| {
        let seed = ((old % old_width) as i32, (old / old_width) as i32);
        new_rooms.at(shift_tile(seed)).unwrap_or_else(|| cell(old))
    };
    if let Some(mut chores) = world.get_resource_mut::<SavedChores>() {
        let chores = &mut *chores;
        for (c, _) in &mut chores.floors {
            *c = cell(*c);
        }
        chores.floors.sort_unstable();
        // Traffic is keyed by person; only its cell moves.
        for (_, c) in &mut chores.traffic {
            *c = cell(*c);
        }
        for task in &mut chores.tasks {
            // Only a floor task lists tiles: a surface or bin task lists
            // the object, a counter or table task its members.
            if task.key.kind == ChoreKind::Floors {
                for c in &mut task.cells {
                    *c = cell(*c);
                }
            }
            task.endpoint = task.endpoint.map(cell);
            task.key = remap_key(task.key, room);
        }
        for order in &mut chores.orders {
            order.key = remap_key(order.key, room);
        }
        for assignment in &mut chores.assignments {
            assignment.key = remap_key(assignment.key, room);
        }
        chores.assignments.sort_by_key(|a| a.key);
        for episode in &mut chores.episodes {
            episode.key = remap_key(episode.key, room);
        }
    }
    if let Some(mut grime) = world.get_resource_mut::<SavedGrime>() {
        let grime = &mut *grime;
        for patch in &mut grime.patches {
            patch.center = cell(patch.center);
            for c in &mut patch.cells {
                *c = cell(*c);
            }
        }
        // `legacy_floors` names people, not tiles.
    }
    if let Some(mut domestic) = world.get_resource_mut::<SavedDomestic>() {
        for visit in &mut domestic.visits {
            visit.room = room(visit.room);
        }
    }
    if let Some(mut dining) = world.get_resource_mut::<SavedDining>() {
        let dining = &mut *dining;
        for diner in &mut dining.diners {
            diner.endpoint = shift_tile(diner.endpoint);
        }
        for opportunity in &mut dining.opportunities {
            opportunity.room = room(opportunity.room);
        }
    }
    // The social company keeps its own copy of the room map; rebuild it
    // now rather than one tick late.
    crate::social_company::refresh(world);
    // Every position moved at once: the renderer must not slide anyone
    // from where they stood to where they stand.
    let mut placed = world.query_filtered::<Entity, With<Position>>();
    let moved: Vec<Entity> = placed.iter(world).collect();
    if let Some(mut state) = world.get_resource_mut::<crate::placement::LotEditState>() {
        state.discontinuities.extend(moved);
    }
}

fn remap_key(
    key: terri_core::chores::ChoreKey,
    room: impl Fn(u32) -> u32,
) -> terri_core::chores::ChoreKey {
    match key.kind {
        ChoreKind::Floors | ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces => {
            terri_core::chores::ChoreKey {
                kind: key.kind,
                target: room(key.target),
            }
        }
        ChoreKind::Dishes | ChoreKind::Surfaces | ChoreKind::Bins => key,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::placement::rooms::{validate_room, RoomEdit};
    use crate::placement::walls::{validate_wall_edit, WallEdit};
    use crate::Sim;
    use terri_core::chores::SavedChores;
    use terri_core::layout::{EdgeAxis, WallState};

    fn rich() -> Sim {
        let mut sim = crate::test_content::without_owned_books(Sim::new_from_shipped_lot());
        crate::chores::ensure(sim.world_mut());
        sim.world_mut()
            .insert_resource(Funds::from_dollars(1_000_000));
        sim
    }

    fn dims(sim: &Sim) -> (u32, u32) {
        let grid = sim.world().resource::<TileGrid>();
        (grid.width() as u32, grid.height() as u32)
    }

    /// Sells `sim` its land in strips `depth` tiles deep.
    fn with_strip_depth(sim: &mut Sim, depth: u32) {
        let content = sim.world().resource::<crate::Content>().0;
        let mut tuning = content.tuning;
        tuning.land_strip_depth = depth;
        let pack = Box::leak(Box::new(terri_data::ContentPack {
            tuning,
            ..content.clone()
        }));
        sim.world_mut().insert_resource(crate::Content(pack));
    }

    /// Every position, path step and wall, read as sorted lists keyed by
    /// entity index where there is one. Windows and painted floors are not
    /// read here: the shipped lot has none, so comparing them would compare
    /// empty lists. `painted_floors_and_windows_move_with_the_world` lays
    /// some first and checks them on every side.
    #[allow(clippy::type_complexity)]
    fn geometry(
        sim: &mut Sim,
    ) -> (
        Vec<(u32, (f32, f32))>,
        Vec<(u32, Vec<(i32, i32)>)>,
        Vec<WallEdge>,
    ) {
        let mut positions: Vec<_> = sim
            .world_mut()
            .query::<(Entity, &Position)>()
            .iter(sim.world())
            .map(|(e, p)| (e.index_u32(), (p.x, p.y)))
            .collect();
        positions.sort_by_key(|p| p.0);
        let mut paths: Vec<_> = sim
            .world_mut()
            .query::<(Entity, &Path)>()
            .iter(sim.world())
            .map(|(e, p)| (e.index_u32(), p.steps.clone()))
            .collect();
        paths.sort_by_key(|p| p.0);
        let mut edges = sim.world().resource::<SavedLayout>().edges().to_vec();
        edges.sort_by_key(|e| (e.axis as u8, e.x, e.y));
        (positions, paths, edges)
    }

    /// The issue's first example: a 10 by 20 side strip at $150 a square
    /// costs $30,000 and makes the next square $180; a second one costs
    /// $36,000 and makes it $210; a rear strip after the first side strip
    /// is 10 by 26, costs $46,800 and makes it $219.
    #[test]
    fn the_pricing_examples_of_the_issue_hold() {
        let tuning = &terri_data::pack().tuning;
        assert_eq!(square_price_cents(tuning, 0), 15_000);
        assert_eq!(square_price_cents(tuning, 200), 18_000);
        assert_eq!(square_price_cents(tuning, 400), 21_000);
        assert_eq!(square_price_cents(tuning, 460), 21_900);
        let mut sim = rich();
        let first = quote(sim.world(), Side::Left);
        assert_eq!((first.length, first.depth, first.area), (20, 10, 200));
        assert_eq!(first.price_cents, 3_000_000);
        assert_eq!(first.remaining_cents, 100_000_000 - 3_000_000);
        assert!(first.affordable());
        assert_eq!(buy(sim.world_mut(), Side::Left), Ok(first));
        assert_eq!(sim.funds(), 100_000_000 - 3_000_000);
        assert_eq!(lot_frame::frame(sim.world()).unwrap().purchased_area, 200);
        let second = quote(sim.world(), Side::Left);
        assert_eq!((second.area, second.price_cents), (200, 3_600_000));
        let rear = quote(sim.world(), Side::Rear);
        assert_eq!((rear.length, rear.depth, rear.area), (26, 10, 260));
        assert_eq!(rear.price_cents, 4_680_000);
        assert_eq!(buy(sim.world_mut(), Side::Rear), Ok(rear));
        assert_eq!(square_price_cents(tuning, 460), 21_900);
        assert_eq!(lot_frame::frame(sim.world()).unwrap().purchased_area, 460);
        assert_eq!(dims(&sim), (30, 26));
    }

    /// A quote changes nothing; a refused purchase changes nothing either.
    #[test]
    fn quotes_and_refusals_write_nothing() {
        let mut sim = rich();
        let before = sim.world_hash();
        let _ = quote(sim.world(), Side::Rear);
        assert_eq!(sim.world_hash(), before);
        assert_eq!(Side::from_index(0), Some(Side::Rear));
        assert_eq!(Side::from_index(1), Some(Side::Left));
        assert_eq!(Side::from_index(2), Some(Side::Right));
        assert_eq!(Side::from_index(3), None);
        sim.world_mut().insert_resource(Funds::from_dollars(29_999));
        let hash = sim.world_hash();
        assert_eq!(
            buy(sim.world_mut(), Side::Left),
            Err(LandRefusal::CannotAfford)
        );
        assert_eq!(sim.world_hash(), hash);
        assert!(!quote(sim.world(), Side::Left).affordable());
        sim.world_mut().insert_resource(Funds::from_dollars(30_000));
        assert!(quote(sim.world(), Side::Left).affordable());
        // Too large: a strip that would pass the loader's side limit.
        with_strip_depth(&mut sim, MAX_SIDE);
        sim.world_mut().insert_resource(Funds(i64::MAX / 4));
        assert_eq!(buy(sim.world_mut(), Side::Left), Err(LandRefusal::TooLarge));
        // A frozen legacy layout cannot grow.
        let mut legacy = rich();
        legacy
            .world_mut()
            .insert_resource(SavedLayout::LegacyAuthoredV1);
        assert_eq!(
            buy(legacy.world_mut(), Side::Left),
            Err(LandRefusal::UnsupportedLayout)
        );
        // A lot with no frame cannot grow either.
        let mut custom = Sim::new_with_lot(8, 8);
        custom
            .world_mut()
            .insert_resource(SavedLayout::EdgeWallsV1 { edges: vec![] });
        custom.world_mut().insert_resource(Funds(i64::MAX / 4));
        assert_eq!(
            buy(custom.world_mut(), Side::Rear),
            Err(LandRefusal::UnsupportedLayout)
        );
    }

    /// The left side is south: the grid gains rows below everything, and
    /// no coordinate moves.
    #[test]
    fn a_left_strip_adds_rows_to_the_south_and_moves_nothing() {
        let mut sim = rich();
        let before = geometry(&mut sim);
        let frame = lot_frame::frame(sim.world()).unwrap();
        buy(sim.world_mut(), Side::Left).unwrap();
        assert_eq!(dims(&sim), (20, 26));
        assert_eq!(geometry(&mut sim), before);
        assert_eq!(lot_frame::frame(sim.world()).unwrap().origin, frame.origin);
        assert_eq!(lot_frame::street_exit(sim.world()), Some((19, 2)));
        for y in 16..26 {
            for x in 0..20 {
                assert!(sim.world().resource::<TileGrid>().is_walkable(x, y));
            }
        }
    }

    /// The right side is north and the rear is west: everything moves by
    /// the strip's depth, the house's implicit shell becomes a barrier on
    /// the moved edge, the content coordinates follow the frame, and every
    /// room keeps its tiles.
    #[test]
    fn rear_and_right_strips_move_the_whole_world() {
        for (side, dx, dy, expected) in [
            (Side::Rear, 10, 0, (30, 16)),
            (Side::Right, 0, 10, (20, 26)),
        ] {
            let mut sim = rich();
            sim.tick();
            sim.tick();
            let (positions, paths, edges) = geometry(&mut sim);
            let rooms = RoomRegions::from_world(sim.world());
            let chores = sim.world().resource::<SavedChores>().clone();
            let door = lot_frame::front_door(sim.world()).unwrap();
            buy(sim.world_mut(), side).unwrap();
            assert_eq!(dims(&sim), expected);
            let (new_positions, new_paths, new_edges) = geometry(&mut sim);
            let shift = |(x, y): (i32, i32)| (x + dx as i32, y + dy as i32);
            assert_eq!(
                new_positions,
                positions
                    .iter()
                    .map(|(e, (x, y))| (*e, (x + dx as f32, y + dy as f32)))
                    .collect::<Vec<_>>()
            );
            assert_eq!(
                new_paths,
                paths
                    .iter()
                    .map(|(e, steps)| (*e, steps.iter().map(|&s| shift(s)).collect()))
                    .collect::<Vec<_>>()
            );
            assert_eq!(
                new_edges,
                edges
                    .iter()
                    .map(|e| WallEdge {
                        axis: e.axis,
                        x: e.x + dx,
                        y: e.y + dy,
                        doorway: e.doorway
                    })
                    .collect::<Vec<_>>()
            );
            assert_eq!(lot_frame::frame(sim.world()).unwrap().origin, (dx, dy));
            assert_eq!(
                lot_frame::front_door(sim.world()),
                Some((door.0 + dx, door.1 + dy))
            );
            let house = lot_frame::house(sim.world()).unwrap();
            assert_eq!(
                (house.x, house.y, house.width, house.height),
                (dx, dy, 16, 12)
            );
            assert_eq!(
                lot_frame::street_exit(sim.world()),
                Some((expected.0 - 1, door.1 + dy))
            );
            // The implicit shell: a barrier between house and new land.
            let grid = sim.world().resource::<TileGrid>();
            if dx > 0 {
                for y in 0..12 {
                    assert!(
                        !grid.can_cross((dx as i32 - 1, y), (dx as i32, y)),
                        "west shell row {y}"
                    );
                }
                assert!(
                    grid.can_cross((dx as i32 - 1, 13), (dx as i32, 13)),
                    "the yard is open"
                );
            }
            if dy > 0 {
                for x in 0..16 {
                    assert!(
                        !grid.can_cross((x, dy as i32 - 1), (x, dy as i32)),
                        "north shell column {x}"
                    );
                }
                assert!(
                    grid.can_cross((17, dy as i32 - 1), (17, dy as i32)),
                    "the yard is open"
                );
            }
            // Rooms: every old tile's room moved with it, and the chore
            // board names the moved rooms.
            let new_rooms = RoomRegions::from_world(sim.world());
            let mut seen = std::collections::BTreeMap::new();
            for y in 0..16i32 {
                for x in 0..20i32 {
                    let old = rooms.at((x, y));
                    let new = new_rooms.at(shift((x, y)));
                    assert_eq!(old.is_some(), new.is_some(), "tile {x},{y}");
                    if let (Some(old), Some(new)) = (old, new) {
                        assert_eq!(*seen.entry(old).or_insert(new), new, "room {old} split");
                    }
                }
            }
            let new_chores = sim.world().resource::<SavedChores>();
            assert_eq!(new_chores.assignments.len(), chores.assignments.len());
            for (before, after) in chores.assignments.iter().zip(&new_chores.assignments) {
                assert_eq!(after.owner, before.owner);
                assert_eq!(after.key.kind, before.key.kind);
                match before.key.kind {
                    ChoreKind::Floors | ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces => {
                        assert_eq!(after.key.target, seen[&before.key.target]);
                    }
                    _ => assert_eq!(after.key.target, before.key.target),
                }
            }
            // Lot edits find the layout they expect, and the shell's lines,
            // now inside the grid, still refuse a doorway.
            assert!(crate::placement::current_layout(sim.world()).is_ok());
            let shell = if dx > 0 {
                WallEdit {
                    axis: EdgeAxis::Vertical,
                    x: dx,
                    y: dy + 3,
                    state: WallState::Doorway,
                }
            } else {
                WallEdit {
                    axis: EdgeAxis::Horizontal,
                    x: dx + 3,
                    y: dy,
                    state: WallState::Doorway,
                }
            };
            assert!(matches!(
                validate_wall_edit(sim.world(), shell),
                Err(crate::placement::PlacementRefusal::OutOfBounds)
            ));
            // The Room tool refuses a shell line on a room's outline as its
            // doorway: the room's north-west corner is the house's.
            let room = RoomEdit {
                x0: dx,
                y0: dy,
                x1: dx + 2,
                y1: dy + 2,
                doorway: Some(if dx > 0 {
                    WallLine {
                        axis: EdgeAxis::Vertical,
                        x: dx,
                        y: dy + 1,
                    }
                } else {
                    WallLine {
                        axis: EdgeAxis::Horizontal,
                        x: dx + 1,
                        y: dy,
                    }
                }),
            };
            assert!(matches!(
                validate_room(sim.world(), room),
                Err(crate::placement::PlacementRefusal::InvalidInput)
            ));
            // The world goes on: people keep walking and nothing panics.
            for _ in 0..200 {
                sim.tick();
            }
        }
    }

    /// Records keyed by a person or an object keep their ids through a
    /// move; only the tiles among them move: traffic cells, floor-task
    /// cells, task endpoints, grime patches, diners' places and the rooms
    /// of cleanup opportunities. The move is checked in the rear strip's
    /// shape, which moves columns and widens rows, and the right strip's,
    /// which moves rows. Every cell is at row and column 10 or more, so a
    /// wrong move shows as a wrong cell rather than an overflow.
    #[test]
    fn a_move_keeps_ids_and_moves_only_tiles() {
        use terri_core::chores::{ChoreKey, ChoreTask};
        use terri_core::grime::FloorPatch;
        use terri_core::save::{SavedCleanupOpportunity, SavedDiner};
        for (dx, dy) in [(10, 0), (0, 10)] {
            let mut sim = rich();
            let people: Vec<u32> = sim
                .world_mut()
                .query::<(Entity, &terri_core::Agent)>()
                .iter(sim.world())
                .map(|(e, _)| e.index_u32())
                .collect();
            assert!(people.len() >= 2, "the shipped lot has two people");
            let (first, second) = (people[0], people[1]);
            let object = sim
                .world_mut()
                .query::<(Entity, &terri_core::SmartObject)>()
                .iter(sim.world())
                .map(|(e, _)| e.index_u32())
                .next()
                .expect("an object");
            let rooms = RoomRegions::from_world(sim.world());
            let (seed, room_id) = (0..16i32)
                .flat_map(|y| (0..20i32).map(move |x| (x, y)))
                .find_map(|tile| rooms.at(tile).map(|room| (tile, room)))
                .expect("a room");
            // A tile's cell on the 20-wide lot, and the cell it moves to.
            let old = |x: u32, y: u32| y * 20 + x;
            let new = |x: u32, y: u32| (y + dy) * (20 + dx) + x + dx;
            let task = |person, key, cells, endpoint| ChoreTask {
                person,
                key,
                cells,
                cursor: 0,
                endpoint,
                remaining: 1,
                directed: false,
                suspended: false,
                started_day: 0,
                completed_units: 0,
            };
            {
                let mut chores = sim.world_mut().resource_mut::<SavedChores>();
                chores.traffic = vec![(first, old(17, 13))];
                chores.tasks = vec![
                    task(
                        first,
                        ChoreKey {
                            kind: ChoreKind::Floors,
                            target: room_id,
                        },
                        vec![old(12, 11)],
                        None,
                    ),
                    task(
                        second,
                        ChoreKey {
                            kind: ChoreKind::Surfaces,
                            target: object,
                        },
                        vec![object],
                        Some(old(14, 14)),
                    ),
                ];
            }
            sim.world_mut().insert_resource(SavedGrime {
                rng: terri_core::SimRng::from_seed(1),
                patches: vec![FloorPatch {
                    person: second,
                    center: old(16, 12),
                    cells: vec![old(15, 12), old(16, 12)],
                }],
                legacy_floors: vec![first],
            });
            sim.world_mut().insert_resource(SavedDining {
                diners: vec![SavedDiner {
                    person: first,
                    station: object,
                    chair: None,
                    setting: None,
                    endpoint: (13, 11),
                    obstructing: vec![],
                }],
                opportunities: vec![SavedCleanupOpportunity {
                    person: first,
                    room: room_id,
                    known: vec![],
                    pending: false,
                }],
                ..Default::default()
            });
            grow(sim.world_mut(), (dx, dy), (dx, dy));
            let shape = format!("moved by ({dx}, {dy})");
            let chores = sim.world().resource::<SavedChores>();
            assert_eq!(chores.traffic, vec![(first, new(17, 13))], "{shape}");
            assert_eq!(chores.tasks[0].cells, vec![new(12, 11)], "{shape}");
            assert_eq!(chores.tasks[1].cells, vec![object], "{shape}");
            assert_eq!(chores.tasks[1].endpoint, Some(new(14, 14)), "{shape}");
            let grime = sim.world().resource::<SavedGrime>();
            assert_eq!(
                grime.patches,
                vec![FloorPatch {
                    person: second,
                    center: new(16, 12),
                    cells: vec![new(15, 12), new(16, 12)],
                }],
                "{shape}"
            );
            assert_eq!(grime.legacy_floors, vec![first], "{shape}");
            let moved_room = RoomRegions::from_world(sim.world())
                .at((seed.0 + dx as i32, seed.1 + dy as i32))
                .expect("the room moved");
            assert_eq!(chores.tasks[0].key.target, moved_room, "{shape}");
            let dining = sim.world().resource::<SavedDining>();
            assert_eq!(
                dining.diners[0].endpoint,
                (13 + dx as i32, 11 + dy as i32),
                "{shape}"
            );
            assert_eq!(dining.opportunities[0].room, moved_room, "{shape}");
        }
    }

    /// The walk home from work ends on the landing where it now stands:
    /// once land lies behind the house, the content landing is a room.
    #[test]
    fn the_walk_home_from_work_ends_on_the_moved_landing() {
        let mut sim = rich();
        buy(sim.world_mut(), Side::Rear).unwrap();
        let portal =
            lot_frame::front_portal(sim.world()).expect("the shipped lot has a front door");
        let landing = (portal.inward.0 as i32, portal.inward.1 as i32);
        assert!(landing.0 >= 10, "the landing moved with the house");
        let mut walked_home = false;
        for _ in 0..3000 {
            sim.tick();
            let mut commuters = sim.world_mut().query::<(&terri_core::Commuting, &Path)>();
            for (commuting, path) in commuters.iter(sim.world()) {
                if matches!(commuting, terri_core::Commuting::Inbound) {
                    assert_eq!(path.steps.last().copied(), Some(landing));
                    walked_home = true;
                }
            }
            if walked_home {
                break;
            }
        }
        assert!(
            walked_home,
            "the shipped worker goes to work and walks home within two days"
        );
    }

    /// A perimeter solid recorded on the old lot's edge blocks once the
    /// lot grows past it, on every side, and the lot edits still find the
    /// layout they expect: the grid a purchase leaves is the grid the
    /// loader would build.
    #[test]
    fn a_record_on_the_old_edge_blocks_once_the_lot_grows_past_it() {
        for (side, line, cells) in [
            (
                Side::Left,
                WallEdge {
                    axis: EdgeAxis::Horizontal,
                    x: 3,
                    y: 16,
                    doorway: false,
                },
                ((3, 15), (3, 16)),
            ),
            (
                Side::Rear,
                WallEdge {
                    axis: EdgeAxis::Vertical,
                    x: 0,
                    y: 14,
                    doorway: false,
                },
                ((9, 14), (10, 14)),
            ),
            (
                Side::Right,
                WallEdge {
                    axis: EdgeAxis::Horizontal,
                    x: 18,
                    y: 0,
                    doorway: false,
                },
                ((18, 9), (18, 10)),
            ),
        ] {
            let mut sim = rich();
            {
                let mut layout = sim.world_mut().resource_mut::<SavedLayout>();
                match &mut *layout {
                    SavedLayout::EdgeWallsV1 { edges }
                    | SavedLayout::EdgeWallsV2 { edges, .. }
                    | SavedLayout::EdgeWallsV3 { edges, .. } => edges.push(line),
                    _ => panic!("the shipped lot has edge walls"),
                }
            }
            assert_eq!(
                crate::placement::current_layout(sim.world())
                    .map(|_| ())
                    .err(),
                None,
                "{side:?}: the record on the edge is a valid layout"
            );
            buy(sim.world_mut(), side).unwrap();
            let grid = sim.world().resource::<TileGrid>();
            assert!(
                !grid.can_cross(cells.0, cells.1),
                "{side:?}: the record blocks"
            );
            assert!(
                crate::placement::current_layout(sim.world()).is_ok(),
                "{side:?}: lot edits find the layout"
            );
        }
    }

    /// A strip that brings a side to exactly `MAX_SIDE` tiles is bought,
    /// and one tile deeper is refused. The rear strip grows the width and
    /// the left strip the height, so each side's limit is met on its own.
    #[test]
    fn a_strip_that_reaches_the_side_limit_is_bought_and_one_tile_deeper_is_refused() {
        for side in [Side::Rear, Side::Left] {
            let mut sim = rich();
            sim.world_mut().insert_resource(Funds(i64::MAX / 4));
            let (width, height) = dims(&sim);
            let (growing, grown) = match side {
                Side::Rear => (width, (MAX_SIDE, height)),
                Side::Left | Side::Right => (height, (width, MAX_SIDE)),
            };
            with_strip_depth(&mut sim, MAX_SIDE - growing + 1);
            assert_eq!(
                validate(sim.world(), side),
                Err(LandRefusal::TooLarge),
                "{side:?}: one tile past the limit"
            );
            with_strip_depth(&mut sim, MAX_SIDE - growing);
            assert_eq!(
                buy(sim.world_mut(), side).map(|quoted| quoted.depth),
                Ok(MAX_SIDE - growing),
                "{side:?}: exactly the limit"
            );
            assert_eq!(dims(&sim), grown, "{side:?}");
        }
    }

    /// Each purchase moves the lot-edit revision by one, which is how the
    /// shell's lot tools learn that the lot changed; a refusal leaves it
    /// alone.
    #[test]
    fn each_purchase_moves_the_lot_edit_revision_once_and_a_refusal_does_not() {
        let revision = |sim: &Sim| {
            sim.world()
                .resource::<crate::placement::LotEditState>()
                .revision
        };
        let mut sim = rich();
        let start = revision(&sim);
        buy(sim.world_mut(), Side::Left).unwrap();
        assert_eq!(revision(&sim), start + 1);
        buy(sim.world_mut(), Side::Rear).unwrap();
        assert_eq!(revision(&sim), start + 2);
        sim.world_mut().insert_resource(Funds(0));
        assert_eq!(
            buy(sim.world_mut(), Side::Right),
            Err(LandRefusal::CannotAfford)
        );
        assert_eq!(revision(&sim), start + 2);
    }

    /// Every blocked tile moves with the world, and the new land has none.
    #[test]
    fn every_blocked_tile_moves_with_the_world_and_new_land_is_open() {
        let blocked = |sim: &Sim| -> Vec<(i32, i32)> {
            let grid = sim.world().resource::<TileGrid>();
            (0..grid.height() as i32)
                .flat_map(|y| (0..grid.width() as i32).map(move |x| (x, y)))
                .filter(|&(x, y)| !grid.is_walkable(x, y))
                .collect()
        };
        for (side, dx, dy) in [
            (Side::Rear, 10, 0),
            (Side::Right, 0, 10),
            (Side::Left, 0, 0),
        ] {
            let mut sim = rich();
            let before = blocked(&sim);
            assert!(!before.is_empty(), "the shipped lot has blocked tiles");
            buy(sim.world_mut(), side).unwrap();
            let mut moved: Vec<_> = before.iter().map(|&(x, y)| (x + dx, y + dy)).collect();
            moved.sort_by_key(|&(x, y)| (y, x));
            assert_eq!(blocked(&sim), moved, "{side:?}");
        }
    }

    /// Painted floors and windows move with everything else. The shipped
    /// lot has neither, so the test lays two coverings and fits a window on
    /// the house's east wall first. Every coordinate is 10 or more, which
    /// makes a wrong move show as a wrong place rather than an overflow.
    #[test]
    fn painted_floors_and_windows_move_with_the_world() {
        use crate::placement::floors::FloorEdit;
        use crate::placement::windows::{apply_window_edit, WindowEdit};
        use terri_core::windows::{WindowModel, WindowPlacement};
        let window = |dx: u32, dy: u32| WindowPlacement {
            line: WallLine {
                axis: EdgeAxis::Vertical,
                x: 16 + dx,
                y: 10 + dy,
            },
            model: WindowModel::Sash,
        };
        for (side, dx, dy) in [
            (Side::Rear, 10, 0),
            (Side::Right, 0, 10),
            (Side::Left, 0, 0),
        ] {
            let mut sim = rich();
            for (x, y, covering) in [(13, 11, 1), (17, 14, 3)] {
                crate::placement::floors::commit(sim.world_mut(), FloorEdit { x, y, covering });
            }
            assert_eq!(
                apply_window_edit(sim.world_mut(), WindowEdit::Fit(window(0, 0))).reason,
                None
            );
            buy(sim.world_mut(), side).unwrap();
            assert_eq!(
                sim.world().resource::<SavedLayout>().window_placements(),
                vec![window(dx, dy)],
                "{side:?}"
            );
            assert_eq!(
                sim.world().resource::<SavedFloors>().tiles(),
                [(13 + dx, 11 + dy, 1), (17 + dx, 14 + dy, 3)],
                "{side:?}"
            );
        }
    }

    /// No purchase meets a legacy wall list: `validate` refuses the layout,
    /// and `buy` is the only caller of `grow`. `grow` still moves the
    /// list's cells with everything else, so that move is checked here
    /// directly, in the rear strip's shape and the right strip's.
    #[test]
    fn growing_moves_a_legacy_wall_list_with_the_world() {
        for (dx, dy) in [(10, 0), (0, 10)] {
            let mut sim = rich();
            sim.world_mut().insert_resource(SavedLayout::LegacyCells {
                walls: vec![(13, 11), (17, 14)],
            });
            assert_eq!(
                validate(sim.world(), Side::Rear),
                Err(LandRefusal::UnsupportedLayout)
            );
            grow(sim.world_mut(), (dx, dy), (dx, dy));
            assert_eq!(
                *sim.world().resource::<SavedLayout>(),
                SavedLayout::LegacyCells {
                    walls: vec![(13 + dx, 11 + dy), (17 + dx, 14 + dy)],
                }
            );
        }
    }

    /// A record naming a room still names that room after a purchase on a
    /// lot narrower than its house is tall, a shape content allows. On this
    /// 4 by 12 lot, whose house is the whole lot, two walls make room 1
    /// start at (1, 0) and leave (1, 4) in room 0, so a room found by any
    /// tile other than its id's own column and row would be the wrong one.
    #[test]
    fn a_room_record_names_the_moved_room_on_a_lot_narrower_than_its_house_is_tall() {
        use terri_core::save::SavedCleanupOpportunity;
        let mut pack = terri_data::pack().clone();
        pack.lot.width = 4;
        pack.lot.height = 12;
        pack.lot.house = (4, 12);
        let mut sim =
            Sim::new_with_lot_and_content(4, 12, crate::Content(Box::leak(Box::new(pack))));
        let wall = |axis, x, y| WallEdge {
            axis,
            x,
            y,
            doorway: false,
        };
        let edges = vec![
            wall(EdgeAxis::Vertical, 1, 0),
            wall(EdgeAxis::Vertical, 1, 1),
            wall(EdgeAxis::Horizontal, 1, 2),
            wall(EdgeAxis::Horizontal, 2, 2),
            wall(EdgeAxis::Horizontal, 3, 2),
        ];
        sim.world_mut()
            .insert_resource(SavedLayout::EdgeWallsV1 { edges });
        let rooms = RoomRegions::from_world(sim.world());
        assert_eq!(rooms.at((1, 0)), Some(1), "room 1 starts at (1, 0)");
        assert_eq!(rooms.at((1, 4)), Some(0), "(1, 4) lies in room 0");
        let opportunity = |room| SavedCleanupOpportunity {
            person: 0,
            room,
            known: vec![],
            pending: false,
        };
        sim.world_mut().insert_resource(SavedDining {
            opportunities: vec![opportunity(0), opportunity(1)],
            ..Default::default()
        });
        sim.world_mut()
            .insert_resource(Funds::from_dollars(1_000_000));
        buy(sim.world_mut(), Side::Rear).unwrap();
        let moved = RoomRegions::from_world(sim.world());
        let (room_0, room_1) = (moved.at((10, 0)).unwrap(), moved.at((11, 0)).unwrap());
        assert_eq!(
            (room_0, room_1),
            (10, 11),
            "the rooms moved 10 columns east"
        );
        let rooms_named: Vec<u32> = sim
            .world()
            .resource::<SavedDining>()
            .opportunities
            .iter()
            .map(|o| o.room)
            .collect();
        assert_eq!(rooms_named, vec![room_0, room_1]);
    }
}
