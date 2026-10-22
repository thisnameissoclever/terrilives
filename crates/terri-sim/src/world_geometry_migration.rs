//! Intentional normalization of generic legacy collision maps.
use super::*;

/// Historical producers allowed finite off-lot positions. Admit ordinary people
/// to current ground without moving people who are at work or waiting outside.
pub(super) fn admit_people(world: &mut World) -> Result<(), crate::SaveError> {
    let grid = world.resource::<TileGrid>();
    let mut moves = Vec::new();
    if let Some(mut query) = world.try_query_filtered::<(Entity, &Position), With<Agent>>() {
        for (actor, position) in query.iter(world) {
            let tile = (position.x.round() as i32, position.y.round() as i32);
            if world.get::<terri_core::AtWork>(actor).is_some()
                || (tile.0 >= 0
                    && tile.1 >= 0
                    && (tile.0 as usize) < grid.width()
                    && (tile.1 as usize) < grid.height())
            {
                continue;
            }
            let distance = |(x, y): (i32, i32)| {
                (f64::from(x) - f64::from(position.x)).abs()
                    + (f64::from(y) - f64::from(position.y)).abs()
            };
            let destination = (0..grid.height() as i32)
                .flat_map(|y| (0..grid.width() as i32).map(move |x| (x, y)))
                .filter(|&(x, y)| grid.is_walkable(x, y))
                .min_by(|a, b| distance(*a).total_cmp(&distance(*b)).then_with(|| a.cmp(b)))
                .ok_or(crate::SaveError::InvalidGrid)?;
            moves.push((actor, destination));
        }
    }
    // Collect the whole admission first so no-space refusal cannot partly move people.
    moves.sort_by_key(|(actor, _)| actor.index_u32());
    for (actor, (x, y)) in moves {
        world.entity_mut(actor).insert(Position {
            x: x as f32,
            y: y as f32,
        });
    }
    Ok(())
}

pub(super) fn unowned_collision_cells(world: &World) -> BTreeSet<(u32, u32)> {
    let grid = world.resource::<TileGrid>();
    let mut cells: BTreeSet<_> = (0..grid.height() as u32)
        .flat_map(|y| (0..grid.width() as u32).map(move |x| (x, y)))
        .filter(|&(x, y)| !grid.is_walkable(x as i32, y as i32))
        .collect();
    if let Some(mut query) = world.try_query_filtered::<(Entity, &Position), With<SmartObject>>() {
        for (entity, position) in query.iter(world) {
            let Some((_, definition, facing)) =
                crate::placement::object_definition(world, entity.index_u32())
            else {
                continue;
            };
            let footprint = definition.footprint_at(facing);
            let (x0, y0) = (position.x.floor() as i64, position.y.floor() as i64);
            let (x1, y1) = (
                x0.saturating_add(footprint.width as i64),
                y0.saturating_add(footprint.depth as i64),
            );
            for y in y0.max(0)..y1.min(grid.height() as i64) {
                for x in x0.max(0)..x1.min(grid.width() as i64) {
                    cells.remove(&(x as u32, y as u32));
                }
            }
        }
    }
    cells
}

/// Preserve valid placements; resolve actual overlaps by distance then coordinates.
/// Only generic historical adoption calls this, never a current runtime constructor.
pub(super) fn normalize_objects(
    world: &mut World,
    cells: &BTreeSet<(u32, u32)>,
) -> Result<(), crate::SaveError> {
    let (width, height) = {
        let grid = world.resource::<TileGrid>();
        (grid.width() as u32, grid.height() as u32)
    };
    let mut occupied = cells.clone();
    let mut people = BTreeSet::new();
    for (actor, position) in world
        .query_filtered::<(Entity, &Position), With<Agent>>()
        .iter(world)
    {
        if world.get::<terri_core::AtWork>(actor).is_some() {
            continue;
        }
        for x in [position.x.floor() as i64, position.x.ceil() as i64] {
            for y in [position.y.floor() as i64, position.y.ceil() as i64] {
                if x >= 0 && y >= 0 && x < i64::from(width) && y < i64::from(height) {
                    people.insert((x as u32, y as u32));
                }
            }
        }
    }
    let mut objects: Vec<_> = world
        .query_filtered::<(Entity, &Position), With<SmartObject>>()
        .iter(world)
        .map(|(e, p)| (e, *p))
        .collect();
    objects.sort_by_key(|(e, _)| e.index_u32());
    let mut moved = BTreeSet::new();
    for (entity, position) in objects {
        let (_, definition, facing) =
            crate::placement::object_definition(world, entity.index_u32())
                .ok_or(crate::SaveError::InvalidContentReference)?;
        let footprint = definition.footprint_at(facing);
        let legal = |x: u32, y: u32| {
            x.checked_add(footprint.width).is_some_and(|v| v <= width)
                && y.checked_add(footprint.depth).is_some_and(|v| v <= height)
                && (y..y + footprint.depth).all(|ty| {
                    (x..x + footprint.width)
                        .all(|tx| !occupied.contains(&(tx, ty)) && !people.contains(&(tx, ty)))
                })
        };
        let origin = (position.x as u32, position.y as u32);
        let at = if position.x >= 0. && position.y >= 0. && legal(origin.0, origin.1) {
            origin
        } else {
            (0..height)
                .flat_map(|y| (0..width).map(move |x| (x, y)))
                .filter(|&(x, y)| legal(x, y))
                .min_by_key(|&(x, y)| {
                    (
                        u64::from(x.abs_diff(origin.0)) + u64::from(y.abs_diff(origin.1)),
                        x,
                        y,
                    )
                })
                .ok_or(crate::SaveError::InvalidGrid)?
        };
        if at != origin || position.x < 0. || position.y < 0. {
            crate::apply_object_placement(
                world,
                entity,
                definition,
                Position {
                    x: at.0 as f32,
                    y: at.1 as f32,
                },
                facing,
            );
            moved.insert(entity);
        }
        for y in at.1..at.1 + footprint.depth {
            for x in at.0..at.0 + footprint.width {
                occupied.insert((x, y));
            }
        }
    }
    let mut grid = TileGrid::new(width as usize, height as usize);
    for &(x, y) in &occupied {
        grid.set_blocked(x as usize, y as usize, true);
    }
    world.insert_resource(grid);
    let affected: Vec<_> = world
        .query::<(Entity, &terri_core::Target)>()
        .iter(world)
        .filter_map(|(actor, target)| moved.contains(&target.object).then_some(actor))
        .collect();
    for actor in affected {
        super::end_obstructed_work(
            world,
            actor,
            "The target moved while an overlapping old placement was repaired.",
        );
    }
    Ok(())
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    #[test]
    fn offlot_admission_uses_legal_ground_and_stable_coordinate_ties() {
        let mut sim = crate::Sim::new_with_lot(3, 3);
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(0, 1, true);
        let actor = sim.spawn_agent(Position { x: -2., y: 1. }, 50.);
        let id = *sim.world().get::<terri_core::SimId>(actor).unwrap();
        admit_people(sim.world_mut()).unwrap();
        assert_eq!(
            sim.world().get::<Position>(actor),
            Some(&Position { x: 0., y: 0. })
        );
        assert_eq!(sim.world().get::<terri_core::SimId>(actor), Some(&id));
    }
    #[test]
    fn offlot_admission_preserves_work_waiting_and_valid_fractional_positions() {
        let mut sim = crate::Sim::new_with_lot(3, 3);
        let working = sim.spawn_agent(Position { x: -2., y: 1. }, 50.);
        sim.world_mut()
            .entity_mut(working)
            .insert(terri_core::AtWork {
                remaining_ticks: 10,
            });
        let waiting = sim.spawn_agent(Position { x: 4., y: 1. }, 50.);
        sim.world_mut()
            .entity_mut(waiting)
            .insert((WaitingToReturn, terri_core::AtWork { remaining_ticks: 1 }));
        let local = sim.spawn_agent(Position { x: 0.25, y: 1.25 }, 50.);
        admit_people(sim.world_mut()).unwrap();
        for (actor, position) in [
            (working, Position { x: -2., y: 1. }),
            (waiting, Position { x: 4., y: 1. }),
            (local, Position { x: 0.25, y: 1.25 }),
        ] {
            assert_eq!(sim.world().get::<Position>(actor), Some(&position));
        }
    }
    #[test]
    fn offlot_admission_refuses_no_ground_without_moving_anyone() {
        let mut sim = crate::Sim::new_with_lot(1, 1);
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_blocked(0, 0, true);
        let actor = sim.spawn_agent(Position { x: -1., y: 0. }, 50.);
        assert_eq!(
            admit_people(sim.world_mut()),
            Err(crate::SaveError::InvalidGrid)
        );
        assert_eq!(
            sim.world().get::<Position>(actor),
            Some(&Position { x: -1., y: 0. })
        );
    }

    #[test]
    fn offlot_people_do_not_displace_unrelated_boundary_furniture() {
        let mut sim = crate::Sim::new_with_lot(4, 4);
        let model = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("counter")
            .unwrap();
        let fixture = sim.spawn_object(Position { x: 0., y: 1. }, model);
        let person = sim.spawn_agent(Position { x: -2., y: 1. }, 50.);
        normalize_objects(sim.world_mut(), &BTreeSet::new()).unwrap();
        assert_eq!(
            sim.world().get::<Position>(fixture),
            Some(&Position { x: 0., y: 1. })
        );
        admit_people(sim.world_mut()).unwrap();
        assert_eq!(
            sim.world().get::<Position>(person),
            Some(&Position { x: 0., y: 0. })
        );
    }
}
