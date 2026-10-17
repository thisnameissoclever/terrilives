//! Buying land - issue 254 (`docs/specs/2026-10-17-land-expansion.md`).
//!
//! A purchase adds a strip `land_strip_depth` tiles deep along the whole
//! of one side of the lot. The street is the east column, so the rear is
//! west, and the two sides are north and south. A south strip only
//! lengthens the grid. A west or north strip grows the grid at its origin,
//! and every coordinate the world holds moves by the strip's depth: the
//! grid, every position and path, the walls, windows and floors, the chore
//! cells and room ids, the grime patches, and the frame that places the
//! content lot. Money is in cents.
use bevy_ecs::prelude::*;
use terri_core::chores::{ChoreKind, SavedChores};
use terri_core::grime::SavedGrime;
use terri_core::layout::{SavedFloors, SavedLayout, WallEdge, WallLine};
use terri_core::save::SavedDomestic;
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

/// The grid may not pass this many tiles on a side; the loader refuses
/// more, so a purchase must too.
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
    let price_cents = i64::from(area) * square_price_cents(tuning, purchased);
    let funds = world.get_resource::<Funds>().map_or(0, |f| f.0);
    Quote {
        side,
        length,
        depth,
        area,
        price_cents,
        remaining_cents: funds - price_cents,
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
    if grown.0 > MAX_SIDE || grown.1 > MAX_SIDE || quoted.area == 0 {
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
    let old_rooms = RoomRegions::from_world(world);

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
        let mut grid = world.resource_mut::<TileGrid>();
        for line in house.rear_lines() {
            let [from, to] = WallEdge {
                axis: line.axis,
                x: line.x,
                y: line.y,
                doorway: false,
            }
            .cells();
            if from.0 >= 0 && from.1 >= 0 {
                grid.set_edge_blocked(from, to, true);
            }
        }
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

    // Cells and room ids: a cell moves with its tile; a room is found again
    // by its old seed tile, because new land can precede a room in row
    // order and take over its lowest cell.
    let new_rooms = RoomRegions::from_world(world);
    let cell = |old: u32| (old / old_width + dy) * new_width + (old % old_width + dx);
    let room = |old: u32| {
        let seed = ((old % old_width) as i32, (old / old_width) as i32);
        let _ = &old_rooms;
        new_rooms.at(shift_tile(seed)).unwrap_or_else(|| cell(old))
    };
    if let Some(mut chores) = world.get_resource_mut::<SavedChores>() {
        let chores = &mut *chores;
        for (c, _) in &mut chores.floors {
            *c = cell(*c);
        }
        chores.floors.sort_unstable();
        for (c, _) in &mut chores.traffic {
            *c = cell(*c);
        }
        chores.traffic.sort_unstable();
        for task in &mut chores.tasks {
            for c in &mut task.cells {
                *c = cell(*c);
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
        for c in &mut grime.legacy_floors {
            *c = cell(*c);
        }
    }
    if let Some(mut domestic) = world.get_resource_mut::<SavedDomestic>() {
        for visit in &mut domestic.visits {
            visit.room = room(visit.room);
        }
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
