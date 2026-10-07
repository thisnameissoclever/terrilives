//! Keep copies valid when furniture or a reader leaves the world.

use super::{with_book_world, BookError, BookLibrary};
use bevy_ecs::prelude::{Entity, World};
use terri_core::{books::BookShelfId, Position, SimId};

/// Return an owned replacement for the sale transaction; validation never writes.
pub(crate) fn prepare_shelf_sale(
    world: &World,
    shelf: u32,
) -> Result<Option<BookLibrary>, BookError> {
    let Some(mut candidate) = world.get_resource::<BookLibrary>().cloned() else {
        return Ok(None);
    };
    with_book_world(world, |context| {
        candidate.evacuate_shelf(BookShelfId(u64::from(shelf)), context)
    })?;
    Ok(Some(candidate))
}

/// Run before recording/removing any of this tick's deaths. Other people dying
/// in the same tick remain living until their own borrowed copies are recovered.
pub(crate) fn recover_before_death(world: &mut World, entity: Entity) {
    crate::reading::settle_reward(world, entity);
    let person = *world
        .get::<SimId>(entity)
        .expect("death has a stable person identity");
    let Some(library) = world.get_resource::<BookLibrary>() else {
        return;
    };
    if !library
        .state()
        .copies
        .iter()
        .any(|copy| copy.borrower == Some(person))
    {
        return;
    }
    let position = *world
        .get::<Position>(entity)
        .expect("a book borrower has a physical position");
    let mut candidate = library.clone();
    with_book_world(world, |context| {
        candidate.recover_on_death(person, (position.x, position.y), context)
    })
    .expect("a valid live borrower has a recoverable book location");
    world.insert_resource(candidate);
    world
        .entity_mut(entity)
        .remove::<(crate::reading::ReadingJourney, crate::reading::PendingShift)>();
}
