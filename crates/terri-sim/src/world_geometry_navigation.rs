//! One current floor scan and one deterministic search for an arrival.
use super::{boundary_tiles, WorldSurfaces};
use bevy_ecs::world::World;
use terri_core::{Position, TileGrid};

pub(crate) fn home_targets(world: &World, grid: &TileGrid) -> Option<Vec<bool>> {
    let surfaces = world.get_resource::<WorldSurfaces>()?;
    let (width, height) = (grid.width(), grid.height());
    let size = width.checked_mul(height)?;
    if surfaces.width as usize != width
        || surfaces.height as usize != height
        || surfaces.tiles.len() != size
    {
        return None;
    }
    let mut targets = Vec::with_capacity(size);
    let mut any = false;
    for &surface in &surfaces.tiles {
        #[cfg(test)]
        super::HOME_TARGET_VISITS.with(|visits| visits.set(visits.get() + 1));
        let target = surface == 0;
        targets.push(target);
        any |= target;
    }
    if let Some(floors) = world.get_resource::<terri_core::layout::SavedFloors>() {
        for &(x, y, covering) in floors.tiles() {
            if matches!(covering, 1..=4) && (x as usize) < width && (y as usize) < height {
                targets[y as usize * width + x as usize] = true;
                any = true;
            }
        }
    }
    if !any {
        targets.fill(true);
    }
    Some(targets)
}

/// The winning entry tile and the path of tiles from it to the destination.
type Route = ((i32, i32), Vec<(i32, i32)>);

/// Roots are sorted by coordinates. Each breadth-first layer stays grouped by
/// root, so the first claim of a tied cell belongs to the smaller entry. Winners
/// are ranked by distance, then entry coordinates, then destination coordinates.
fn search(grid: &TileGrid, roots: &[(i32, i32)], targets: &[bool]) -> Option<Route> {
    let width = grid.width();
    let index = |(x, y): (i32, i32)| y as usize * width + x as usize;
    let tile = |index: usize| ((index % width) as i32, (index / width) as i32);
    let roots: Vec<_> = roots
        .iter()
        .copied()
        .filter(|&(x, y)| grid.is_walkable(x, y))
        .collect();
    if let Some(&root) = roots.iter().find(|&&root| targets[index(root)]) {
        return Some((root, vec![]));
    }
    let mut parents = vec![usize::MAX; targets.len()];
    let mut owners = vec![usize::MAX; targets.len()];
    let mut layer = Vec::with_capacity(roots.len());
    for (owner, &root) in roots.iter().enumerate() {
        let at = index(root);
        if parents[at] != usize::MAX {
            continue;
        }
        parents[at] = at;
        owners[at] = owner;
        layer.push(at);
    }
    while !layer.is_empty() {
        if let Some(at) = layer
            .iter()
            .copied()
            .filter(|&at| targets[at])
            .min_by_key(|&at| (owners[at], tile(at)))
        {
            let root = roots[owners[at]];
            let mut steps = Vec::new();
            let mut at = at;
            while parents[at] != at {
                steps.push(tile(at));
                at = parents[at];
            }
            steps.reverse();
            return Some((root, steps));
        }
        let mut next_layer = Vec::new();
        for at in layer {
            let (x, y) = tile(at);
            for next in [(x - 1, y), (x, y - 1), (x, y + 1), (x + 1, y)] {
                if !grid.can_step((x, y), next) {
                    continue;
                }
                let to = index(next);
                if parents[to] != usize::MAX {
                    continue;
                }
                parents[to] = at;
                owners[to] = owners[at];
                next_layer.push(to);
            }
        }
        layer = next_layer;
    }
    None
}

pub(super) fn arrival(world: &World) -> Option<(Position, Vec<(i32, i32)>)> {
    let grid = world.resource::<TileGrid>();
    let targets = home_targets(world, grid)?;
    let roots = boundary_tiles(world, grid);
    let ((x, y), steps) = search(grid, &roots, &targets)?;
    Some((
        Position {
            x: x as f32,
            y: y as f32,
        },
        steps,
    ))
}

pub(super) fn route_home(world: &World, position: Position) -> Option<Vec<(i32, i32)>> {
    let grid = world.resource::<TileGrid>();
    let targets = home_targets(world, grid)?;
    let start = (position.x.round() as i32, position.y.round() as i32);
    let (_, steps) = search(grid, &[start], &targets)?;
    grid.anchor_path((position.x, position.y), steps)
}
