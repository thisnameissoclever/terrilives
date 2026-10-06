use super::*;
use terri_core::{
    grime::{FloorPatch, SavedGrime},
    Path, Position, TileGrid,
};

pub(super) const WORK_TICKS: u32 = 24;
pub(super) enum Progress {
    Working,
    Done,
    Unavailable,
}

pub(super) fn cells(world: &World, room: u32, center: u32) -> Vec<u32> {
    let grid = world.resource::<TileGrid>();
    let regions = crate::room_regions::RoomRegions::from_world(world);
    let at = (
        (center as usize % grid.width()) as i32,
        (center as usize / grid.width()) as i32,
    );
    if !grid.is_walkable(at.0, at.1) || regions.at(at) != Some(room) {
        return vec![];
    }
    let mut result = vec![];
    for dy in -1..=1 {
        for dx in -1..=1 {
            let to = (at.0 + dx, at.1 + dy);
            if dx != 0
                && dy != 0
                && (!grid.is_walkable(at.0 + dx, at.1) || !grid.is_walkable(at.0, at.1 + dy))
            {
                continue;
            }
            if grid.is_walkable(to.0, to.1)
                && regions.at(to) == Some(room)
                && grid.segment_can_cross((at.0 as f32, at.1 as f32), (to.0 as f32, to.1 as f32))
            {
                result.push(to.1 as u32 * grid.width() as u32 + to.0 as u32);
            }
        }
    }
    result.sort_unstable();
    result
}

pub(super) fn fade(rows: &mut Vec<(u32, u16)>, cell: u32, remaining: u32) -> u32 {
    let Ok(index) = rows.binary_search_by_key(&cell, |r| r.0) else {
        return 0;
    };
    let removed = u32::from(rows[index].1).div_ceil(remaining.max(1));
    rows[index].1 -= removed as u16;
    if rows[index].1 == 0 {
        rows.remove(index);
    }
    removed
}

fn dirty(world: &World, floors: &[(u32, u16)], room: u32) -> Vec<u32> {
    let grid = world.resource::<TileGrid>();
    let regions = crate::room_regions::RoomRegions::from_world(world);
    floors
        .iter()
        .filter(|(cell, amount)| {
            let xy = (
                (*cell as usize % grid.width()) as i32,
                (*cell as usize / grid.width()) as i32,
            );
            *amount > 0 && grid.is_walkable(xy.0, xy.1) && regions.at(xy) == Some(room)
        })
        .map(|r| r.0)
        .collect()
}

pub(super) fn advance(
    world: &mut World,
    task: &mut ChoreTask,
    floors: &mut Vec<(u32, u16)>,
) -> Progress {
    let person = crate::dining::entity(world, task.person).unwrap();
    let pos = *world.get::<Position>(person).unwrap();
    let width = world.resource::<TileGrid>().width() as u32;
    let at = (pos.x.round() as i32, pos.y.round() as i32);
    if let Some(mut patch) = world
        .resource::<SavedGrime>()
        .patches
        .iter()
        .find(|p| p.person == task.person)
        .cloned()
    {
        let allowed = cells(world, task.key.target, patch.center);
        patch.cells.retain(|c| allowed.contains(c));
        if patch.cells.is_empty() {
            grime::forget(world, task.person);
            return Progress::Unavailable;
        }
        let center = ((patch.center % width) as i32, (patch.center / width) as i32);
        if (pos.x - center.0 as f32).abs() > 0.01 || (pos.y - center.1 as f32).abs() > 0.01 {
            if !walk(world, person, pos, center) {
                return Progress::Unavailable;
            }
            return Progress::Working;
        }
        for cell in &patch.cells {
            task.completed_units += fade(floors, *cell, task.remaining);
        }
        task.remaining -= 1;
        let mut state = world.resource_mut::<SavedGrime>();
        if task.remaining == 0 {
            state.patches.retain(|p| p.person != task.person);
            task.endpoint = None;
        } else {
            *state
                .patches
                .iter_mut()
                .find(|p| p.person == task.person)
                .unwrap() = patch;
        }
        if task.remaining == 0 && dirty(world, floors, task.key.target).is_empty() {
            return Progress::Done;
        }
        return Progress::Working;
    }
    let pending = dirty(world, floors, task.key.target);
    if pending.is_empty() {
        return Progress::Done;
    }
    task.cells = pending.clone();
    task.cursor = 0;
    let here = at.1 as u32 * width + at.0 as u32;
    let here_patch = cells(world, task.key.target, here);
    let center = if here_patch.iter().any(|cell| value(floors, *cell) > 0) {
        Some(here)
    } else {
        let grid = world.resource::<TileGrid>();
        pending
            .into_iter()
            .filter_map(|cell| {
                let xy = ((cell % width) as i32, (cell / width) as i32);
                grid.find_path(at, xy).map(|path| (path.len(), cell))
            })
            .min()
            .map(|(_, cell)| cell)
    };
    let Some(center) = center else {
        return Progress::Unavailable;
    };
    let destination = ((center % width) as i32, (center / width) as i32);
    if (pos.x - destination.0 as f32).abs() > 0.01 || (pos.y - destination.1 as f32).abs() > 0.01 {
        if !walk(world, person, pos, destination) {
            return Progress::Unavailable;
        }
        task.endpoint = Some(center);
        return Progress::Working;
    }
    let patch = FloorPatch {
        person: task.person,
        center,
        cells: cells(world, task.key.target, center),
    };
    task.remaining = WORK_TICKS;
    task.endpoint = Some(center);
    {
        let mut state = world.resource_mut::<SavedGrime>();
        state.patches.push(patch);
        state.patches.sort_by_key(|p| p.person);
    }
    // Begin this tick's work immediately after the bounded setup above.
    let active = world
        .resource::<SavedGrime>()
        .patches
        .iter()
        .find(|p| p.person == task.person)
        .unwrap()
        .cells
        .clone();
    for cell in active {
        task.completed_units += fade(floors, cell, task.remaining);
    }
    task.remaining -= 1;
    Progress::Working
}

fn walk(world: &mut World, person: Entity, pos: Position, destination: (i32, i32)) -> bool {
    let grid = world.resource::<TileGrid>();
    let Some(steps) = grid
        .find_path((pos.x.round() as i32, pos.y.round() as i32), destination)
        .and_then(|p| grid.anchor_path((pos.x, pos.y), p))
        .filter(|p| !p.is_empty())
    else {
        return false;
    };
    world.entity_mut(person).insert(Path { steps, cursor: 0 });
    true
}

pub(super) fn reconcile(world: &mut World) {
    let Some(chores) = world.get_resource::<SavedChores>() else {
        return;
    };
    let tasks = chores.tasks.clone();
    let Some(mut state) = world.remove_resource::<SavedGrime>() else {
        return;
    };
    state.legacy_floors.retain(|person| {
        tasks
            .iter()
            .any(|t| t.person == *person && t.key.kind == ChoreKind::Floors)
    });
    state.patches.retain_mut(|patch| {
        let Some(task) = tasks
            .iter()
            .find(|t| t.person == patch.person && t.key.kind == ChoreKind::Floors)
        else {
            return false;
        };
        let allowed = cells(world, task.key.target, patch.center);
        patch.cells.retain(|c| allowed.contains(c));
        if patch.cells.is_empty() {
            if let Some(task) = world
                .resource_mut::<SavedChores>()
                .tasks
                .iter_mut()
                .find(|t| t.person == patch.person)
            {
                task.remaining = 0;
                task.endpoint = None;
            }
            return false;
        }
        true
    });
    world.insert_resource(state);
}
