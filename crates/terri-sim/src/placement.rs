//! Atomic furniture placement planning. Preview never writes simulation state.

use crate::{apply_object_placement, Content};
use bevy_ecs::prelude::*;
use std::collections::{HashSet, VecDeque};
use terri_core::layout::SavedLayout;
use terri_core::{
    Agent, Facing, Footprint, ObjectFacing, Path, Position, Reserved, SmartObject, Target, TileGrid,
};

/// Stable boundary codes. Zero is success; English belongs to the shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PlacementRefusal {
    InvalidInput = 1,
    UnknownObject = 2,
    UnsupportedFacing = 3,
    UnsupportedLayout = 4,
    OutOfBounds = 5,
    WallOverlap = 6,
    FurnitureOverlap = 7,
    InUse = 8,
    SimOverlap = 9,
    BlockedRoute = 10,
    InaccessibleInteraction = 11,
    BlockedDoor = 12,
    BlockedLanding = 13,
    /// The household's Funds are less than the price - [BM-buy].
    CannotAfford = 14,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlacementResult {
    pub object: u32,
    pub reason: Option<PlacementRefusal>,
}

/// Presentation/cache state, deliberately excluded from saves and world hashes.
#[derive(Resource, Debug, Default)]
pub struct LotEditState {
    pub revision: u64,
    pub last_result: Option<PlacementResult>,
    /// The most recent wall edit the drain committed or refused, so the shell
    /// can report a refusal only the commit could see - [WT-boundary].
    pub last_wall_result: Option<walls::WallEditResult>,
    /// The most recent purchase the drain committed or refused - [BM-buy].
    pub last_purchase_result: Option<purchase::PurchaseResult>,
    pub(crate) discontinuities: HashSet<Entity>,
}

#[derive(Debug)]
pub struct PlacementPlan {
    grid: TileGrid,
    entity: Entity,
    pub origin: (u32, u32),
    pub facing: Facing,
    pub footprint: Footprint,
    pub sprite: u32,
    pub foreground: Option<u32>,
}

/// Resolves a live object without requiring a mutable query cache.
pub fn object_definition(
    world: &World,
    object: u32,
) -> Option<(Entity, &'static terri_data::CompiledObject, Facing)> {
    let content = world.get_resource::<Content>()?.0;
    let mut query = world.try_query::<EntityRef>()?;
    let entity = query
        .iter(world)
        .find(|e| e.id().index_u32() == object && e.contains::<SmartObject>())?;
    let definition = content
        .objects
        .get(entity.get::<SmartObject>()?.0 .0 as usize)?;
    Some((
        entity.id(),
        definition,
        entity
            .get::<ObjectFacing>()
            .map_or(definition.base_facing, |f| f.0),
    ))
}

#[derive(Clone, Copy)]
struct Rectangle {
    /// The object standing here, or `None` for one a purchase is about to
    /// bring onto the lot.
    entity: Option<Entity>,
    origin: (u32, u32),
    footprint: Footprint,
}

fn fits(grid: &TileGrid, origin: (u32, u32), footprint: Footprint) -> bool {
    footprint.width > 0
        && footprint.depth > 0
        && origin
            .0
            .checked_add(footprint.width)
            .is_some_and(|x| x as usize <= grid.width())
        && origin
            .1
            .checked_add(footprint.depth)
            .is_some_and(|y| y as usize <= grid.height())
}

fn cells(rect: Rectangle) -> impl Iterator<Item = (u32, u32)> {
    (rect.origin.1..rect.origin.1 + rect.footprint.depth).flat_map(move |y| {
        (rect.origin.0..rect.origin.0 + rect.footprint.width).map(move |x| (x, y))
    })
}

fn approaches(rect: Rectangle, grid: &TileGrid) -> Vec<(i32, i32)> {
    let (x, y) = (rect.origin.0 as i32, rect.origin.1 as i32);
    let (right, bottom) = (
        x + rect.footprint.width as i32,
        y + rect.footprint.depth as i32,
    );
    (x..right)
        .flat_map(|x| [(x, y - 1), (x, bottom)])
        .chain((y..bottom).flat_map(|y| [(x - 1, y), (right, y)]))
        .filter(|&tile| grid.can_interact_with_rect(tile, (x, y), rect.footprint))
        .collect()
}

/// Every visit inserts a previously unseen tile, bounded by the bitmap size.
fn reachable(grid: &TileGrid) -> HashSet<(i32, i32)> {
    let mut seen = HashSet::new();
    let root = (0..grid.height() as i32)
        .flat_map(|y| (0..grid.width() as i32).map(move |x| (x, y)))
        .find(|&(x, y)| grid.is_walkable(x, y));
    let Some(root) = root else {
        return seen;
    };
    let mut pending = VecDeque::from([root]);
    seen.insert(root);
    for _ in 0..grid.width() * grid.height() {
        let Some((x, y)) = pending.pop_front() else {
            return seen;
        };
        for next in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
            if grid.can_step((x, y), next) && seen.insert(next) {
                pending.push_back(next);
            }
        }
    }
    assert!(pending.is_empty(), "placement flood exceeded tile bound");
    seen
}

fn architecture_dimensions_valid(width: usize, height: usize) -> bool {
    !(width == 0 || height == 0 || width > i32::MAX as usize || height > i32::MAX as usize)
}

fn fixed_architecture(world: &World, live: &TileGrid) -> Result<TileGrid, PlacementRefusal> {
    use PlacementRefusal::UnsupportedLayout;
    if !architecture_dimensions_valid(live.width(), live.height()) {
        return Err(UnsupportedLayout);
    }
    let mut grid = TileGrid::new(live.width(), live.height());
    match world
        .get_resource::<SavedLayout>()
        .ok_or(UnsupportedLayout)?
    {
        SavedLayout::LegacyAuthoredV1 => return Err(UnsupportedLayout),
        SavedLayout::LegacyCells { walls } => {
            for &(x, y) in walls {
                // Dimensions fit i32. High-bit u32 coordinates become negative;
                // is_walkable rejects those, positive overflow and duplicates.
                if !grid.is_walkable(x as i32, y as i32) {
                    return Err(UnsupportedLayout);
                }
                grid.set_blocked(x as usize, y as usize, true);
            }
        }
        SavedLayout::EdgeWallsV1 { edges } => {
            let mut seen = std::collections::BTreeSet::new();
            for &edge in edges {
                if !edge.in_bounds(grid.width() as u32, grid.height() as u32)
                    || !seen.insert((edge.axis, edge.x, edge.y))
                {
                    return Err(UnsupportedLayout);
                }
                let [a, b] = edge.cells();
                grid.set_edge_blocked(a, b, !edge.doorway);
            }
        }
    }
    Ok(grid)
}

fn crosses_wall(rect: Rectangle, grid: &TileGrid) -> bool {
    let contains = |(x, y): (i32, i32)| {
        x >= rect.origin.0 as i32
            && y >= rect.origin.1 as i32
            && x < (rect.origin.0 + rect.footprint.width) as i32
            && y < (rect.origin.1 + rect.footprint.depth) as i32
    };
    grid.blocked_edges()
        .any(|(a, b)| contains(a) && contains(b))
}

/// The fixed architecture and every placed object, proven to account for the
/// live grid exactly. Every lot edit starts here: an edit validated against a
/// world whose grid nobody can explain would be validated against a guess.
struct CurrentLayout {
    walls: TileGrid,
    rectangles: Vec<Rectangle>,
}

fn current_layout(world: &World) -> Result<CurrentLayout, PlacementRefusal> {
    use PlacementRefusal::UnsupportedLayout;
    let content = world.get_resource::<Content>().ok_or(UnsupportedLayout)?.0;
    let live = world.resource::<TileGrid>();
    let walls = fixed_architecture(world, live)?;
    let mut current = walls.clone();
    let mut rectangles = Vec::new();
    let mut entities = world.try_query::<EntityRef>().ok_or(UnsupportedLayout)?;
    for row in entities.iter(world).filter(|e| e.contains::<SmartObject>()) {
        let position = row.get::<Position>().ok_or(UnsupportedLayout)?;
        if !position.x.is_finite()
            || !position.y.is_finite()
            || position.x < 0.0
            || position.y < 0.0
        {
            return Err(UnsupportedLayout);
        }
        let def = content
            .objects
            .get(row.get::<SmartObject>().unwrap().0 .0 as usize)
            .ok_or(UnsupportedLayout)?;
        let direction = row.get::<ObjectFacing>().map_or(def.base_facing, |f| f.0);
        if !def.supports(direction) {
            return Err(UnsupportedLayout);
        }
        let rect = Rectangle {
            entity: Some(row.id()),
            origin: (position.x as u32, position.y as u32),
            footprint: def.footprint_at(direction),
        };
        if !fits(&current, rect.origin, rect.footprint) || crosses_wall(rect, &walls) {
            return Err(UnsupportedLayout);
        }
        for (x, y) in cells(rect) {
            if !current.is_walkable(x as i32, y as i32) {
                return Err(UnsupportedLayout);
            }
            current.set_blocked(x as usize, y as usize, true);
        }
        rectangles.push(rect);
    }
    if !live.blocked_edges().eq(current.blocked_edges())
        || (0..live.height()).any(|y| {
            (0..live.width()).any(|x| {
                live.is_walkable(x as i32, y as i32) != current.is_walkable(x as i32, y as i32)
            })
        })
    {
        return Err(UnsupportedLayout);
    }
    Ok(CurrentLayout { walls, rectangles })
}

/// What every lot edit must leave usable, proven on the candidate grid: the
/// front door and its landing are clear, every sim stands on open floor in
/// one connected region and can finish the walk it is on, and every object
/// keeps a clear approach in that same region. Shared by furniture moves and
/// wall edits so the two cannot drift - [WT-rules].
fn prove_lot_usable(
    world: &World,
    grid: &TileGrid,
    rectangles: &[Rectangle],
) -> Result<(), PlacementRefusal> {
    use PlacementRefusal::*;
    let content = world.resource::<Content>().0;
    let mut entities = world.try_query::<EntityRef>().ok_or(UnsupportedLayout)?;
    if content
        .lot
        .front_door
        .is_some_and(|(x, y)| !grid.is_walkable(x as i32, y as i32))
    {
        return Err(BlockedDoor);
    }
    if content
        .portals
        .iter()
        .any(|p| !grid.is_walkable(p.inward.0 as i32, p.inward.1 as i32))
    {
        return Err(BlockedLanding);
    }
    let reached = reachable(grid);
    for row in entities.iter(world).filter(|e| e.contains::<Agent>()) {
        let pos = row.get::<Position>().ok_or(UnsupportedLayout)?;
        for x in [pos.x.floor() as i32, pos.x.ceil() as i32] {
            for y in [pos.y.floor() as i32, pos.y.ceil() as i32] {
                if !grid.is_walkable(x, y) {
                    return Err(SimOverlap);
                }
                if !reached.contains(&(x, y)) {
                    return Err(BlockedRoute);
                }
            }
        }
        if let Some(path) = row.get::<Path>() {
            let Some(remaining) = path.steps.get(path.cursor..) else {
                return Err(BlockedRoute);
            };
            let mut previous = (pos.x, pos.y);
            for &(x, y) in remaining {
                let next = (x as f32, y as f32);
                if !reached.contains(&(x, y)) || !grid.segment_can_cross(previous, next) {
                    return Err(BlockedRoute);
                }
                previous = next;
            }
            if remaining
                .windows(2)
                .any(|pair| pair[0] != pair[1] && !grid.can_step(pair[0], pair[1]))
            {
                return Err(BlockedRoute);
            }
        }
    }
    // Match F5: every object, including scenery, has a clear approach and
    // every clear approach belongs to the common reachable region.
    for &rect in rectangles {
        let beside = approaches(rect, grid);
        if beside.is_empty() || beside.iter().any(|tile| !reached.contains(tile)) {
            return Err(InaccessibleInteraction);
        }
    }
    if content
        .lot
        .front_door
        .is_some_and(|(x, y)| !reached.contains(&(x as i32, y as i32)))
    {
        return Err(BlockedDoor);
    }
    if content
        .portals
        .iter()
        .any(|p| !reached.contains(&(p.inward.0 as i32, p.inward.1 as i32)))
    {
        return Err(BlockedLanding);
    }
    Ok(())
}

/// The rectangle rules a move and a purchase share - [BM-buy]. `moving` is
/// the object a move lifts off the lot first, or `None` for a purchase, which
/// lifts nothing. Returns the grid with the rectangle standing in place; no
/// mutation and no random draws.
fn plan_rectangle(
    world: &World,
    moving: Option<Entity>,
    footprint: Footprint,
    origin: (u32, u32),
) -> Result<TileGrid, PlacementRefusal> {
    use PlacementRefusal::*;
    let live = world.resource::<TileGrid>();
    let CurrentLayout {
        walls,
        mut rectangles,
    } = current_layout(world)?;
    let mut entities = world.try_query::<EntityRef>().ok_or(UnsupportedLayout)?;
    if !fits(live, origin, footprint) {
        return Err(OutOfBounds);
    }
    if moving.is_some_and(|entity| {
        world.get::<Reserved>(entity).is_some()
            || entities
                .iter(world)
                .any(|e| e.get::<Target>().is_some_and(|t| t.object == entity))
    }) {
        return Err(InUse);
    }
    let candidate = Rectangle {
        entity: moving,
        origin,
        footprint,
    };
    if crosses_wall(candidate, &walls)
        || cells(candidate).any(|(x, y)| !walls.is_walkable(x as i32, y as i32))
    {
        return Err(WallOverlap);
    }
    // Every placed rectangle has an entity, so for a purchase this keeps them
    // all and for a move it drops only the object being moved.
    rectangles.retain(|rect| rect.entity != moving);
    let mut grid = walls;
    for rect in &rectangles {
        for (x, y) in cells(*rect) {
            grid.set_blocked(x as usize, y as usize, true);
        }
    }
    if cells(candidate).any(|(x, y)| !grid.is_walkable(x as i32, y as i32)) {
        return Err(FurnitureOverlap);
    }
    for (x, y) in cells(candidate) {
        grid.set_blocked(x as usize, y as usize, true);
    }
    rectangles.push(candidate);
    prove_lot_usable(world, &grid, &rectangles)?;
    // Last, the loader's own grid checks - [L-an-edit-must-pass-the-loader].
    // For furniture they are implied today by the proofs above: a sim's tile
    // and walk must be open floor there too, and blocking a tile never
    // changes a contact, which the loader reads through walls alone. They are
    // asked anyway, so a rule the loader gains later is honoured here without
    // a second edit. The rectangle itself is not in this world yet; the
    // loader's rule for it, no wall through it, is `WallOverlap` above.
    crate::save::candidate_grid_loads(world, &grid).map_err(|problem| match problem {
        crate::save::LoadProblem::PortalReturn => BlockedLanding,
        crate::save::LoadProblem::EdgeWorld => BlockedRoute,
    })?;
    Ok(grid)
}

/// Produces a complete owned transaction; no mutation and no random draws.
pub fn validate_placement(
    world: &World,
    object: u32,
    origin: (u32, u32),
    facing: Facing,
) -> Result<PlacementPlan, PlacementRefusal> {
    use PlacementRefusal::*;
    let (entity, definition, _) = object_definition(world, object).ok_or(UnknownObject)?;
    if !definition.supports(facing) {
        return Err(UnsupportedFacing);
    }
    let footprint = definition.footprint_at(facing);
    let grid = plan_rectangle(world, Some(entity), footprint, origin)?;
    Ok(PlacementPlan {
        grid,
        entity,
        origin,
        facing,
        footprint,
        sprite: definition.facing_sprites.get(facing).unwrap(),
        foreground: definition.facing_foreground_sprites.get(facing),
    })
}

/// Revalidation and writes happen in one exclusive command drain.
pub(crate) fn commit(world: &mut World, object: u32, origin: (u32, u32), facing: Facing) {
    let result = validate_placement(world, object, origin, facing);
    let reason = result.as_ref().err().copied();
    if let Ok(plan) = result {
        let (_, def, old_facing) = object_definition(world, object).unwrap();
        let old = world.get::<Position>(plan.entity).unwrap();
        if old.x != origin.0 as f32 || old.y != origin.1 as f32 || old_facing != facing {
            world.insert_resource(plan.grid);
            apply_object_placement(
                world,
                plan.entity,
                def,
                Position {
                    x: origin.0 as f32,
                    y: origin.1 as f32,
                },
                facing,
            );
            let mut state = world.resource_mut::<LotEditState>();
            state.revision = state.revision.saturating_add(1);
            state.discontinuities.insert(plan.entity);
        }
    }
    world.resource_mut::<LotEditState>().last_result = Some(PlacementResult { object, reason });
}

pub mod purchase;
pub mod walls;

#[cfg(test)]
mod tests;
