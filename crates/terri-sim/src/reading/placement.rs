//! Complete candidate previews for shelf moves, with an explicit commit set.
use super::*;
use crate::{placement::PlacementRefusal, Sim};

#[derive(Debug)]
pub(crate) struct MovePlan {
    library: BookLibrary,
    updates: Vec<Update>,
}
#[derive(Debug)]
struct Update {
    owner: Entity,
    expected: ReadingJourney,
    journey: Option<ReadingJourney>,
    path: Option<Path>,
    target: Option<Target>,
    claim: Option<crate::seating::PhysicalClaim>,
    queue: Option<IntentQueue>,
    blocked: bool,
}
pub(crate) fn affects(world: &World, shelf: Entity) -> bool {
    world
        .try_query::<&ReadingJourney>()
        .is_some_and(|mut q| q.iter(world).any(|j| j.shelf == shelf))
}
pub(crate) fn owns_target(world: &World, person: Entity, shelf: Entity) -> bool {
    world
        .get::<ReadingJourney>(person)
        .is_some_and(|j| j.shelf == shelf)
        && world
            .get::<Target>(person)
            .is_some_and(|t| t.object == shelf && is_read(world, *t))
}
pub(crate) fn pins_sale(world: &World, object: Entity) -> bool {
    world.try_query::<&ReadingJourney>().is_some_and(|mut q| {
        q.iter(world).any(|j| {
            j.origin.object == object
                || j.shelf == object
                || j.seat.as_ref().is_some_and(|(s, _)| *s == object)
        })
    })
}
pub(crate) fn prepare(
    world: &World,
    shelf: Entity,
    origin: (u32, u32),
    facing: Facing,
    grid: &TileGrid,
) -> Result<(Sim, MovePlan), PlacementRefusal> {
    let bad = || PlacementRefusal::BlockedRoute;
    let pack = world.resource::<Content>().0;
    let mut candidate = crate::save::v6::restore(
        crate::save::v6::capture_world(world),
        pack,
        world
            .get_resource::<crate::portals::ActivePortals>()
            .copied(),
    )
    .map_err(|_| bad())?;
    let moved = crate::dining::entity(&candidate.world, shelf.index_u32()).ok_or_else(bad)?;
    let definition = pack.object(candidate.world.get::<SmartObject>(moved).ok_or_else(bad)?.0);
    candidate.world.insert_resource(grid.clone());
    crate::apply_object_placement(
        &mut candidate.world,
        moved,
        definition,
        Position {
            x: origin.0 as f32,
            y: origin.1 as f32,
        },
        facing,
    );
    let mut owners: Vec<_> =
        world
            .try_query::<(Entity, &ReadingJourney)>()
            .map_or_else(Vec::new, |mut q| {
                q.iter(world)
                    .filter(|(_, j)| j.shelf == shelf)
                    .map(|(e, j)| (e, j.clone()))
                    .collect()
            });
    owners.sort_by_key(|(e, _)| e.index_u32());
    for (owner, _) in &owners {
        let person = crate::dining::entity(&candidate.world, owner.index_u32()).ok_or_else(bad)?;
        reroute_after_move(&mut candidate.world, person);
    }
    let resolve = |entity: Entity| crate::dining::entity(world, entity.index_u32()).ok_or_else(bad);
    let map_target = |t: Target| {
        Ok::<_, PlacementRefusal>(Target {
            object: resolve(t.object)?,
            interaction: t.interaction,
        })
    };
    let mut updates = vec![];
    for (owner, expected) in owners {
        let person = crate::dining::entity(&candidate.world, owner.index_u32()).ok_or_else(bad)?;
        let mut journey = candidate.world.get::<ReadingJourney>(person).cloned();
        if let Some(j) = journey.as_mut() {
            j.origin = map_target(j.origin)?;
            j.shelf = resolve(j.shelf)?;
            if let Some((seat, _)) = j.seat.as_mut() {
                *seat = resolve(*seat)?;
            }
        }
        let target = candidate
            .world
            .get::<Target>(person)
            .copied()
            .map(map_target)
            .transpose()?;
        let mut claim = candidate
            .world
            .get::<crate::seating::PhysicalClaim>(person)
            .cloned();
        if let Some(c) = claim.as_mut() {
            c.furniture = resolve(c.furniture)?;
            c.target = map_target(c.target)?;
        }
        let queue = candidate
            .world
            .get::<IntentQueue>(person)
            .map(|q| {
                let mut entries = q.entries().to_vec();
                for order in &mut entries {
                    order.intent.object = resolve(order.intent.object)?;
                }
                IntentQueue::from_entries(entries, q.next_id()).ok_or_else(bad)
            })
            .transpose()?;
        updates.push(Update {
            owner,
            expected,
            journey,
            target,
            claim,
            queue,
            path: candidate.world.get::<Path>(person).cloned(),
            blocked: candidate.world.get::<Blocked>(person).is_some(),
        });
    }
    let library = candidate.world.resource::<BookLibrary>().clone();
    Ok((candidate, MovePlan { library, updates }))
}
fn reroute_after_move(world: &mut World, person: Entity) {
    let j = world.get::<ReadingJourney>(person).unwrap().clone();
    match j.stage {
        ReadingStage::Fetch | ReadingStage::Pickup => {
            let occupancy = crate::seating::occupancy(world);
            if let Some(steps) = route_to(world, person, j.shelf, &occupancy) {
                let contact = endpoint(&steps, *world.get::<Position>(person).unwrap());
                world.entity_mut(person).insert(Path { steps, cursor: 0 });
                let mut j = world.get_mut::<ReadingJourney>(person).unwrap();
                j.stage = ReadingStage::Fetch;
                j.transfer_contact = Some(contact);
                j.reach_remaining = 0;
            } else {
                request_return(world, person);
            }
        }
        ReadingStage::Return | ReadingStage::Shelve | ReadingStage::WaitingReturn => {
            route_return(world, person)
        }
        ReadingStage::Travel => {
            let pos = *world.get::<Position>(person).unwrap();
            let grid = world.resource::<TileGrid>();
            if let Some(steps) = grid
                .find_path((pos.x.round() as i32, pos.y.round() as i32), j.destination)
                .and_then(|s| grid.anchor_path((pos.x, pos.y), s))
            {
                world.entity_mut(person).insert(Path { steps, cursor: 0 });
            } else {
                request_return(world, person);
            }
        }
        ReadingStage::Read => {}
    }
}
impl MovePlan {
    pub(crate) fn apply(self, world: &mut World) {
        assert!(
            self.updates
                .iter()
                .all(|u| world.get::<ReadingJourney>(u.owner) == Some(&u.expected)),
            "placement revalidates the exact live reading owner"
        );
        for u in self.updates {
            if let Some(target) = world.get::<Target>(u.owner).copied() {
                crate::reservations::release_now(world, u.owner, target);
            }
            let mut actor = world.entity_mut(u.owner);
            if let Some(j) = u.journey {
                actor.insert(j);
            } else {
                actor.remove::<ReadingJourney>();
            }
            if let Some(path) = u.path {
                actor.insert(path);
            } else {
                actor.remove::<Path>();
            }
            if let Some(target) = u.target {
                actor.insert(target);
            } else {
                actor.remove::<Target>();
            }
            if let Some(queue) = u.queue {
                actor.insert(queue);
            } else {
                actor.remove::<IntentQueue>();
            }
            if u.blocked {
                actor.insert(Blocked);
            } else {
                actor.remove::<Blocked>();
            }
            if let Some(claim) = u.claim {
                let seat = claim.furniture;
                actor.insert(claim);
                world.entity_mut(seat).insert(Reserved);
            } else {
                actor.remove::<crate::seating::PhysicalClaim>();
            }
        }
        world.insert_resource(self.library);
    }
}
