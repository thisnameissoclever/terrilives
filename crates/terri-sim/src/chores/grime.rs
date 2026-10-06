use super::*;
use terri_core::{grime::SavedGrime, Position, SimRng, SmartObject, TileGrid};

pub(super) fn ensure(world: &mut World, chores: &SavedChores) {
    if world.contains_resource::<SavedGrime>() {
        return;
    }
    let mut seed = world.resource::<SimRng>().clone();
    let seed = (u64::from(seed.next_u32()) << 32) | u64::from(seed.next_u32());
    world.insert_resource(SavedGrime {
        rng: SimRng::from_seed(seed ^ 0x4752494d45555345),
        patches: vec![],
        legacy_floors: chores
            .tasks
            .iter()
            .filter(|t| t.key.kind == ChoreKind::Floors)
            .map(|t| t.person)
            .collect(),
    });
}

pub fn chance(cleanliness: f32, surface: bool) -> f32 {
    (0.10 - 0.08 * cleanliness.clamp(0.0, 1.0)) * if surface { 2.0 } else { 1.0 }
}

fn ready(world: &mut World) -> bool {
    if world
        .resource::<crate::Content>()
        .0
        .tuning
        .domestic
        .is_none()
    {
        return false;
    }
    if world.contains_resource::<SavedChores>() && world.contains_resource::<SavedGrime>() {
        return true;
    }
    super::ensure(world);
    let chores = world.resource::<SavedChores>().clone();
    ensure(world, &chores);
    true
}

fn succeeds(world: &mut World, person: Entity, surface: bool) -> bool {
    let probability = chance(crate::domestic::cleanliness(world, person), surface);
    world.resource_mut::<SavedGrime>().rng.next_f32() < probability
}

pub(crate) fn footstep(world: &mut World, person: Entity, from: (i32, i32), to: (i32, i32)) {
    if from == to || world.get::<terri_core::Agent>(person).is_none() {
        return;
    }
    let grid = world.resource::<TileGrid>();
    if !grid.is_walkable(to.0, to.1)
        || crate::room_regions::RoomRegions::from_world(world)
            .at(to)
            .is_none()
    {
        return;
    }
    let cell = to.1 as u32 * grid.width() as u32 + to.0 as u32;
    if ready(world) && succeeds(world, person, false) {
        add(&mut world.resource_mut::<SavedChores>().floors, cell, 100);
    }
}

pub(crate) fn adjacent_counters(world: &World, station: Entity) -> Vec<u32> {
    let Some(pos) = world.get::<Position>(station) else {
        return vec![];
    };
    let Some(def) = world.get::<SmartObject>(station) else {
        return vec![];
    };
    let pack = world.resource::<crate::Content>().0;
    let footprint =
        crate::placed_footprint(pack, def.0, world.get::<terri_core::ObjectFacing>(station));
    let rooms = crate::room_regions::RoomRegions::from_world(world);
    let origin = (pos.x.round() as i32, pos.y.round() as i32);
    let room = rooms.at(origin);
    let Some(mut query) = world.try_query::<(Entity, &Position, &SmartObject)>() else {
        return vec![];
    };
    let grid = world.resource::<TileGrid>();
    let mut result = vec![];
    for (entity, p, _) in query.iter(world) {
        if groups::kind(world, entity) != Some(ChoreKind::CounterSurfaces) {
            continue;
        }
        let xy = (p.x.round() as i32, p.y.round() as i32);
        if room.is_none() || rooms.at(xy) != room {
            continue;
        }
        let counter = world.get::<SmartObject>(entity).unwrap();
        let size = crate::placed_footprint(
            pack,
            counter.0,
            world.get::<terri_core::ObjectFacing>(entity),
        );
        let mut adjacent = false;
        for y in 0..size.depth as i32 {
            for x in 0..size.width as i32 {
                let c = (xy.0 + x, xy.1 + y);
                for sy in 0..footprint.depth as i32 {
                    for sx in 0..footprint.width as i32 {
                        let s = (origin.0 + sx, origin.1 + sy);
                        if (c.0 - s.0).abs() + (c.1 - s.1).abs() == 1 && grid.can_cross(c, s) {
                            adjacent = true;
                        }
                    }
                }
            }
        }
        if adjacent {
            result.push(entity.index_u32());
        }
    }
    result.sort_unstable();
    result.dedup();
    result
}

pub(crate) fn used(world: &mut World, person: Entity, station: Entity) {
    if world.get::<terri_core::Agent>(person).is_none() || !ready(world) {
        return;
    }
    let Some(object) = world.get::<SmartObject>(station) else {
        return;
    };
    let pack = world.resource::<crate::Content>().0;
    let def = pack.object(object.0);
    let mut targets = if crate::targeted_cleanup::is_surface(pack, object.0) {
        vec![station.index_u32()]
    } else {
        vec![]
    };
    if def.roles.iter().any(|r| {
        pack.roles
            .get(*r as usize)
            .is_some_and(|r| r == "hob" || r == "dish_sink")
    }) {
        targets.extend(adjacent_counters(world, station));
    }
    targets.sort_unstable();
    targets.dedup();
    for target in targets {
        if succeeds(world, person, true) {
            add(
                &mut world.resource_mut::<SavedChores>().surfaces,
                target,
                100,
            );
        }
    }
}

pub(super) fn forget(world: &mut World, person: u32) {
    if let Some(mut state) = world.get_resource_mut::<SavedGrime>() {
        state.patches.retain(|p| p.person != person);
        state.legacy_floors.retain(|p| *p != person);
    }
}

pub(crate) fn restore(
    world: &mut World,
    state: Option<SavedGrime>,
) -> Result<(), crate::SaveError> {
    let Some(state) = state else {
        if world.get_resource::<SavedChores>().is_some_and(|s| {
            s.tasks.iter().any(|t| {
                t.key.kind == ChoreKind::Floors && (t.remaining > 12 || t.endpoint.is_some())
            })
        }) {
            return Err(crate::SaveError::InvalidValue);
        }
        return Ok(());
    };
    let chores = world
        .get_resource::<SavedChores>()
        .ok_or(crate::SaveError::InvalidValue)?;
    if state.patches.len() > chores.tasks.len()
        || state.legacy_floors.len() > chores.tasks.len()
        || state.patches.windows(2).any(|p| p[0].person >= p[1].person)
        || state.legacy_floors.windows(2).any(|p| p[0] >= p[1])
    {
        return Err(crate::SaveError::InvalidValue);
    }
    for patch in &state.patches {
        let task = chores
            .tasks
            .iter()
            .find(|t| t.person == patch.person && t.key.kind == ChoreKind::Floors)
            .ok_or(crate::SaveError::InvalidValue)?;
        if task.remaining == 0
            || task.remaining > 24
            || task.endpoint != Some(patch.center)
            || state.legacy_floors.contains(&patch.person)
            || patch.cells.is_empty()
            || patch.cells.len() > 9
            || patch.cells.windows(2).any(|p| p[0] >= p[1])
            || patch
                .cells
                .iter()
                .any(|c| !super::patches::cells(world, task.key.target, patch.center).contains(c))
        {
            return Err(crate::SaveError::InvalidValue);
        }
    }
    for person in &state.legacy_floors {
        if !chores
            .tasks
            .iter()
            .any(|t| t.person == *person && t.key.kind == ChoreKind::Floors && t.remaining <= 12)
        {
            return Err(crate::SaveError::InvalidValue);
        }
    }
    for task in chores
        .tasks
        .iter()
        .filter(|t| t.key.kind == ChoreKind::Floors && t.remaining > 0)
    {
        if !state.legacy_floors.contains(&task.person)
            && !state.patches.iter().any(|p| p.person == task.person)
        {
            return Err(crate::SaveError::InvalidValue);
        }
    }
    world.insert_resource(state);
    Ok(())
}
