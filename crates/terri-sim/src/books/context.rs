//! Read-only physical identities shared by save validation and book lifecycle operations.

use super::{BookError, BookWorld, ShelfCapacity};
use crate::Content;
use bevy_ecs::prelude::World;
use terri_core::{books::BookShelfId, SimClock, SimId, SmartObject, TileGrid};

/// A physical borrower must have a place where death can leave their copy.
pub(crate) fn validate_borrower_positions(
    world: &World,
    library: &terri_core::books::SavedBookLibrary,
) -> Result<(), BookError> {
    if library.copies.iter().all(|copy| copy.borrower.is_none()) {
        return Ok(());
    }
    let grid = world.resource::<TileGrid>();
    let mut people = world.try_query_filtered::<(&SimId, &terri_core::Position), bevy_ecs::prelude::With<terri_core::Agent>>()
        .ok_or(BookError::InvalidState("borrower has no physical position"))?;
    for borrower in library.copies.iter().filter_map(|copy| copy.borrower) {
        if !people.iter(world).any(|(person, position)| {
            *person == borrower
                && position.x.is_finite()
                && position.y.is_finite()
                && position.x >= 0.0
                && position.y >= 0.0
                && position.x < grid.width() as f32
                && position.y < grid.height() as f32
        }) {
            return Err(BookError::InvalidState(
                "borrower has no recoverable physical position",
            ));
        }
    }
    Ok(())
}

/// Build identities from the actual candidate, including recorded deceased people.
pub(crate) fn with_book_world<R>(
    world: &World,
    operation: impl FnOnce(&BookWorld<'_>) -> Result<R, BookError>,
) -> Result<R, BookError> {
    let pack = world.resource::<Content>().0;
    let tuning = pack
        .reading
        .as_ref()
        .ok_or(BookError::InvalidState("book catalogue has no tuning"))?;
    let mut shelves = Vec::new();
    let mut living = Vec::new();
    for raw in 0..world.entities().len() {
        let Some(index) = bevy_ecs::entity::EntityIndex::from_raw_u32(raw) else {
            continue;
        };
        if !world.entities().is_index_spawned(index) {
            continue;
        }
        let entity = world.entity(world.entities().resolve_from_index(index));
        if entity.contains::<terri_core::Agent>() {
            if let Some(person) = entity.get::<SimId>() {
                living.push(*person);
            }
        }
        if let Some(object) = entity.get::<SmartObject>() {
            let slots = pack.object(object.0).shelf_capacity;
            if slots > 0 {
                shelves.push(ShelfCapacity {
                    id: BookShelfId(u64::from(raw)),
                    slots,
                });
            }
        }
    }
    let mut known = living.clone();
    if let Some(mortality) = world.get_resource::<terri_core::save::SavedMortality>() {
        known.extend(mortality.deaths.iter().map(|death| SimId(death.sim_id)));
    }
    let grid = world.resource::<TileGrid>();
    operation(&BookWorld {
        books: &pack.books,
        tuning,
        shelves: &shelves,
        known_sims: &known,
        living_sims: &living,
        lot_width: grid.width() as u32,
        lot_height: grid.height() as u32,
        now: world.resource::<SimClock>().tick,
    })
}
