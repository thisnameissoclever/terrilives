//! Occupied object rectangles, distinct from unoccupied developer projections.
use super::*;
use terri_core::{Facing, Footprint};

#[derive(Clone, Copy)]
struct Claim {
    entity: Entity,
    origin: (u32, u32),
    footprint: Footprint,
    facing: Facing,
}
impl Claim {
    fn cells(self) -> impl Iterator<Item = (u32, u32)> {
        (self.origin.1..self.origin.1 + self.footprint.depth).flat_map(move |y| {
            (self.origin.0..self.origin.0 + self.footprint.width).map(move |x| (x, y))
        })
    }
}
fn rectangles(world: &World) -> Vec<Claim> {
    let grid = world.resource::<TileGrid>();
    let mut result = Vec::new();
    if let Some(mut query) = world.try_query_filtered::<(Entity, &Position), With<SmartObject>>() {
        for (entity, position) in query.iter(world) {
            let Some((_, definition, facing)) =
                crate::placement::object_definition(world, entity.index_u32())
            else {
                continue;
            };
            if !position.x.is_finite()
                || !position.y.is_finite()
                || position.x < 0.
                || position.y < 0.
            {
                continue;
            }
            let origin = (position.x as u32, position.y as u32);
            let footprint = definition.footprint_at(facing);
            if origin
                .0
                .checked_add(footprint.width)
                .is_none_or(|x| x as usize > grid.width())
                || origin
                    .1
                    .checked_add(footprint.depth)
                    .is_none_or(|y| y as usize > grid.height())
            {
                continue;
            }
            result.push(Claim {
                entity,
                origin,
                footprint,
                facing,
            });
        }
    }
    result.sort_by_key(|claim| claim.entity.index_u32());
    result
}
fn claims(world: &World) -> Vec<Claim> {
    let grid = world.resource::<TileGrid>();
    rectangles(world)
        .into_iter()
        .filter(|claim| {
            claim
                .cells()
                .all(|(x, y)| !grid.is_walkable(x as i32, y as i32))
        })
        .collect()
}
pub(super) fn validate(world: &World) -> Result<(), crate::SaveError> {
    let mut used = BTreeSet::new();
    for claim in claims(world) {
        if claim.cells().any(|cell| !used.insert(cell)) {
            return Err(crate::SaveError::InvalidGrid);
        }
    }
    Ok(())
}

/// Only historical adoption repairs occupied overlap. Current records must
/// already be coherent. Unoccupied developer projections retain their contract.
pub(super) fn normalize(world: &mut World) -> Result<(), crate::SaveError> {
    let claims = claims(world);
    let mut held = BTreeSet::new();
    let mut keep = Vec::new();
    let mut move_claims = Vec::new();
    for claim in &claims {
        if claim.cells().any(|cell| held.contains(&cell)) {
            move_claims.push(*claim);
        } else {
            held.extend(claim.cells());
            keep.push(*claim);
        }
    }
    if move_claims.is_empty() {
        return Ok(());
    }
    let grid = world.resource::<TileGrid>();
    let (width, height) = (grid.width() as u32, grid.height() as u32);
    let physical: BTreeSet<_> = claims.iter().map(|claim| claim.entity).collect();
    let mut occupied: BTreeSet<_> = (0..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .filter(|&(x, y)| !grid.is_walkable(x as i32, y as i32))
        .collect();
    for claim in &claims {
        for cell in claim.cells() {
            occupied.remove(&cell);
        }
    }
    // Keep every nonconflicting object's original location, even when its ID
    // follows an overlapping object that needs a new location.
    for claim in &keep {
        occupied.extend(claim.cells());
    }
    for other in rectangles(world)
        .into_iter()
        .filter(|claim| !physical.contains(&claim.entity))
    {
        occupied.extend(other.cells());
    }
    let people = super::migration::people_tiles(world, width, height);
    let mut moved = Vec::new();
    for mut claim in move_claims {
        let legal = |x: u32, y: u32| {
            let (Some(right), Some(bottom)) = (
                x.checked_add(claim.footprint.width),
                y.checked_add(claim.footprint.depth),
            ) else {
                return false;
            };
            right <= width
                && bottom <= height
                && (y..bottom).all(|ty| {
                    (x..right).all(|tx| {
                        !occupied.contains(&(tx, ty))
                            && !people.contains(&(tx, ty))
                            && (tx + 1 == right
                                || grid
                                    .can_cross((tx as i32, ty as i32), (tx as i32 + 1, ty as i32)))
                            && (ty + 1 == bottom
                                || grid
                                    .can_cross((tx as i32, ty as i32), (tx as i32, ty as i32 + 1)))
                    })
                })
        };
        let destination = (0..height)
            .flat_map(|y| (0..width).map(move |x| (x, y)))
            .filter(|&(x, y)| legal(x, y))
            .min_by_key(|&(x, y)| {
                (
                    u64::from(x.abs_diff(claim.origin.0)) + u64::from(y.abs_diff(claim.origin.1)),
                    x,
                    y,
                )
            })
            .ok_or(crate::SaveError::InvalidGrid)?;
        claim.origin = destination;
        occupied.extend(claim.cells());
        moved.push(claim);
    }
    let mut next = grid.clone();
    for claim in &claims {
        for (x, y) in claim.cells() {
            next.set_blocked(x as usize, y as usize, false);
        }
    }
    for claim in keep.iter().chain(&moved) {
        for (x, y) in claim.cells() {
            next.set_blocked(x as usize, y as usize, true);
        }
    }
    world.insert_resource(next);
    let mut affected = BTreeSet::new();
    for claim in moved {
        let (_, definition, _) =
            crate::placement::object_definition(world, claim.entity.index_u32())
                .ok_or(crate::SaveError::InvalidContentReference)?;
        crate::apply_object_placement(
            world,
            claim.entity,
            definition,
            Position {
                x: claim.origin.0 as f32,
                y: claim.origin.1 as f32,
            },
            claim.facing,
        );
        affected.insert(claim.entity);
    }
    let users: Vec<_> = world
        .query::<(Entity, &terri_core::Target)>()
        .iter(world)
        .filter_map(|(actor, target)| affected.contains(&target.object).then_some(actor))
        .collect();
    for actor in users {
        super::end_obstructed_work(
            world,
            actor,
            "The target moved while an overlapping old placement was repaired.",
        );
    }
    // A seated viewer targets the device, not the chair. Its physical lease
    // must follow the repaired placement even when no walk is in progress.
    // Maintenance retains valid leases and the existing device/order owner.
    crate::media::maintain(world);
    crate::social_episode::prune_inactive_company(world);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relocation_keeps_later_valid_objects_and_away_positions() {
        let mut sim = crate::Sim::new_with_lot(12, 12);
        let model = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("double_bed")
            .unwrap();
        let first = sim.spawn_object(Position { x: 5., y: 5. }, model);
        let overlapping = sim.spawn_object(Position { x: 5., y: 5. }, model);
        let keeper = sim.spawn_object(Position { x: 3., y: 5. }, model);
        for rect in rectangles(sim.world()) {
            for (x, y) in rect.cells() {
                sim.world_mut()
                    .resource_mut::<TileGrid>()
                    .set_blocked(x as usize, y as usize, true);
            }
        }
        let away = sim.spawn_agent(Position { x: 5., y: 3. }, 100.);
        sim.world_mut().entity_mut(away).insert(terri_core::AtWork {
            remaining_ticks: 10,
        });
        normalize(sim.world_mut()).unwrap();
        assert_eq!(
            sim.world().get::<Position>(first),
            Some(&Position { x: 5., y: 5. })
        );
        assert_eq!(
            sim.world().get::<Position>(keeper),
            Some(&Position { x: 3., y: 5. })
        );
        assert_eq!(
            sim.world().get::<Position>(overlapping),
            Some(&Position { x: 5., y: 3. })
        );
        assert_eq!(
            sim.world().get::<Position>(away),
            Some(&Position { x: 5., y: 3. })
        );
        validate(sim.world()).unwrap();
    }
}
