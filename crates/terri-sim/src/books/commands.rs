//! Native book command transactions and read-only projections.
use super::{with_book_world, BookError, BookLibrary};
use crate::{Content, Sim};
use bevy_ecs::prelude::*;
use terri_core::{
    books::*, command::BookCommand, Agent, Funds, Intent, IntentQueue, SimId, SmartObject,
};

#[derive(Resource, Default)]
pub struct LegacyBookImportNotice(pub bool);
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookCommandResult {
    pub sequence: u64,
    pub copy: Option<u32>,
    pub order: Option<u64>,
    pub refusal: Option<&'static str>,
}
#[derive(Resource, Default)]
pub struct BookFeedback {
    pub sequence: u64,
    pub results: Vec<BookCommandResult>,
}
fn code(error: &BookError) -> &'static str {
    match error {
        BookError::UnknownTitle(_) => "unknown_title",
        BookError::UnknownCopy(_) => "unknown_copy",
        BookError::UnknownShelf(_) => "unknown_shelf",
        BookError::UnknownSim(_) => "unknown_person",
        BookError::InsufficientFunds => "insufficient_funds",
        BookError::CopyIdsExhausted => "copy_ids_exhausted",
        BookError::Borrowed(_) => "borrowed",
        BookError::ShelfFull(_) => "shelf_full",
        BookError::AlreadyBorrowing(_) => "already_borrowing",
        BookError::NotBorrower => "not_borrower",
        BookError::NotReadable => "not_readable",
        BookError::InvalidState(_) => "invalid_state",
    }
}
fn entity(world: &World, raw: u32) -> Option<Entity> {
    let index = bevy_ecs::entity::EntityIndex::from_raw_u32(raw)?;
    world
        .entities()
        .is_index_spawned(index)
        .then(|| world.entities().resolve_from_index(index))
}
pub(crate) fn commit(world: &mut World, command: BookCommand) {
    let result = match command {
        BookCommand::Read {
            agent,
            object,
            action,
            title,
            front,
        } => selected_order(world, agent, object, &action, title, front).map(|id| (None, Some(id))),
        operation => {
            let mut library = world.resource::<BookLibrary>().clone();
            let mut funds = *world.resource::<Funds>();
            let result = with_book_world(world, |context| match operation {
                BookCommand::Purchase { ref title, shelf } => library
                    .purchase(
                        title,
                        shelf.map(|s| BookShelfId(s.into())),
                        &mut funds,
                        context,
                    )
                    .map(|id| (Some(id.0), None)),
                BookCommand::Transfer { copy, shelf } => {
                    library.transfer(
                        BookCopyId(copy),
                        shelf.map(|s| BookShelfId(s.into())),
                        context,
                    )?;
                    Ok((Some(copy), None))
                }
                _ => unreachable!(),
            })
            .map_err(|e| code(&e));
            if result.is_ok() {
                world.insert_resource(library);
                world.insert_resource(funds);
            }
            result
        }
    };
    world.init_resource::<BookFeedback>();
    let mut feedback = world.resource_mut::<BookFeedback>();
    feedback.sequence = feedback.sequence.saturating_add(1);
    let sequence = feedback.sequence;
    feedback.results.push(match result {
        Ok((copy, order)) => BookCommandResult {
            sequence,
            copy,
            order,
            refusal: None,
        },
        Err(refusal) => BookCommandResult {
            sequence,
            copy: None,
            order: None,
            refusal: Some(refusal),
        },
    });
}
fn selected_order(
    world: &mut World,
    raw_agent: u32,
    raw_object: u32,
    action: &str,
    title: String,
    front: bool,
) -> Result<u64, &'static str> {
    let agent = entity(world, raw_agent)
        .filter(|e| world.get::<Agent>(*e).is_some())
        .ok_or("unknown_person")?;
    let object = entity(world, raw_object).ok_or("unknown_object")?;
    let placed = world.get::<SmartObject>(object).ok_or("unknown_object")?;
    let pack = world.resource::<Content>().0;
    if !pack.books.iter().any(|b| b.id == title) {
        return Err("unknown_title");
    }
    let row = pack
        .object(placed.0)
        .interactions
        .iter()
        .position(|a| a.id == action && a.book_reading)
        .ok_or("not_owned_reading_action")?;
    let cap = pack.tuning.max_queued_intents as usize;
    let mut queue = world.get::<IntentQueue>(agent).cloned().unwrap_or_default();
    if !queue.can_allocate() {
        return Err("order_ids_exhausted");
    }
    if !front && cap != 0 && queue.len() >= cap {
        return Err("queue_full");
    }
    let displaced = if front && cap != 0 && queue.len() >= cap {
        queue.pop_back_order()
    } else {
        None
    };
    let id = queue
        .insert_order(
            Intent {
                cleanup: None,
                chore: None,
                object,
                interaction: row as u32,
            },
            Some(title),
            front,
        )
        .ok_or("order_ids_exhausted")?;
    let target = world.get::<terri_core::Target>(agent).copied();
    let release = target.filter(|t| {
        displaced.as_ref().is_some_and(|entry| {
            entry.title_id.is_none()
                && entry.intent
                    == Intent {
                        cleanup: None,
                        chore: None,
                        object: t.object,
                        interaction: t.interaction,
                    }
        }) && !queue.contains(Intent {
            cleanup: None,
            chore: None,
            object: t.object,
            interaction: t.interaction,
        })
    });
    if displaced.is_some() {
        world
            .resource_mut::<crate::systems::command::CommandFeedback>()
            .record_intent_displacement();
    }
    world.entity_mut(agent).insert(queue);
    if let Some(target) = release {
        crate::systems::command::release_commitment(&mut world.commands(), agent, target);
        world.flush();
    }
    Ok(id)
}
impl Sim {
    pub fn book_titles(&self) -> &[terri_data::BookDefinition] {
        &self.world.resource::<Content>().0.books
    }
    pub fn book_shelves(&self) -> Result<Vec<super::ShelfCapacity>, BookError> {
        with_book_world(&self.world, |context| Ok(context.shelves.to_vec()))
    }
    pub fn book_copies(&self) -> &[BookCopy] {
        &self.world.resource::<BookLibrary>().state().copies
    }
    pub fn book_shelf_slots(
        &self,
        raw: u32,
        reserved: bool,
    ) -> Result<Vec<Option<BookCopyId>>, BookError> {
        with_book_world(&self.world, |context| {
            let shelf = BookShelfId(raw.into());
            let capacity = context
                .shelves
                .iter()
                .find(|s| s.id == shelf)
                .ok_or(BookError::UnknownShelf(shelf))?
                .slots;
            let library = self.world.resource::<BookLibrary>();
            Ok(if reserved {
                library.reserved_slots(shelf, capacity)
            } else {
                library.shelf_slots(shelf, capacity)
            })
        })
    }
    /// Taste and dispositions only. Multiply actual ReadingWork by this, not the estimate.
    pub fn book_taste_multiplier(
        &self,
        raw: u32,
        object: u32,
        action: &str,
        title: &str,
    ) -> Result<f32, BookError> {
        let person = entity(&self.world, raw).ok_or(BookError::NotReadable)?;
        let object = entity(&self.world, object).ok_or(BookError::NotReadable)?;
        let placed = self
            .world
            .get::<SmartObject>(object)
            .ok_or(BookError::NotReadable)?;
        let row = self
            .world
            .resource::<Content>()
            .0
            .object(placed.0)
            .interactions
            .iter()
            .position(|a| a.id == action && a.book_reading)
            .ok_or(BookError::NotReadable)?;
        taste_multiplier(
            &self.world,
            person,
            terri_core::Target {
                object,
                interaction: row as u32,
            },
            title,
        )
    }

    fn book_disposition(
        &self,
        person: Entity,
        object: u32,
        action: &str,
    ) -> Result<f32, BookError> {
        let furniture = entity(&self.world, object)
            .and_then(|e| self.world.get::<SmartObject>(e))
            .ok_or(BookError::NotReadable)?;
        let row = self
            .world
            .resource::<Content>()
            .0
            .object(furniture.0)
            .interactions
            .iter()
            .position(|a| a.id == action && a.book_reading)
            .ok_or(BookError::NotReadable)?;
        Ok(self.reading_disposition(person, furniture.0, row))
    }
    fn reading_disposition(
        &self,
        person: Entity,
        definition: terri_core::ObjectDefId,
        row: usize,
    ) -> f32 {
        let pack = self.world.resource::<Content>().0;
        let disposition = self
            .world
            .get::<terri_core::Personality>(person)
            .map_or(1.0, |p| p.disposition(definition, row as u32));
        let traits = crate::systems::trait_effects::disposition_multiplier(
            self.world.get::<terri_core::Traits>(person),
            pack,
            &pack.object(definition).interactions[row].tags,
        );
        traits * disposition
    }
    /// Store baseline: authored bookshelf/read personality and trait weights.
    /// No placed shelf is required. Actual action scoring uses its own action context.
    pub fn book_store_interest(&self, raw: u32, title: &str) -> Result<f32, BookError> {
        let person = entity(&self.world, raw)
            .filter(|e| self.world.get::<Agent>(*e).is_some())
            .ok_or(BookError::NotReadable)?;
        let id = *self
            .world
            .get::<SimId>(person)
            .ok_or(BookError::NotReadable)?;
        let pack = self.world.resource::<Content>().0;
        let definition = pack.find("bookshelf").ok_or(BookError::NotReadable)?;
        let row = pack
            .object(definition)
            .interactions
            .iter()
            .position(|a| a.id == "read" && a.tags.iter().any(|t| t == "reading"))
            .ok_or(BookError::NotReadable)?;
        let estimate = with_book_world(&self.world, |context| {
            self.world
                .resource::<BookLibrary>()
                .estimate_interest(id, title, context)
        })?;
        Ok(estimate * self.reading_disposition(person, definition, row))
    }
    pub fn book_interest(
        &self,
        raw: u32,
        object: u32,
        action: &str,
        title: &str,
    ) -> Result<f32, BookError> {
        let person = entity(&self.world, raw).ok_or(BookError::NotReadable)?;
        let id = *self
            .world
            .get::<SimId>(person)
            .ok_or(BookError::NotReadable)?;
        let estimate = with_book_world(&self.world, |context| {
            self.world
                .resource::<BookLibrary>()
                .estimate_interest(id, title, context)
        })?;
        Ok(estimate * self.book_disposition(person, object, action)?)
    }
    pub fn take_book_results(&mut self) -> Vec<BookCommandResult> {
        self.world
            .get_resource_mut::<BookFeedback>()
            .map(|mut f| std::mem::take(&mut f.results))
            .unwrap_or_default()
    }
    pub fn take_legacy_book_import_notice(&mut self) -> bool {
        self.world
            .get_resource_mut::<LegacyBookImportNotice>()
            .is_some_and(|mut n| std::mem::take(&mut n.0))
    }
}

pub(crate) fn taste_multiplier(
    world: &World,
    person: Entity,
    target: terri_core::Target,
    title: &str,
) -> Result<f32, BookError> {
    if world.get::<Agent>(person).is_none() {
        return Err(BookError::NotReadable);
    }
    let id = *world.get::<SimId>(person).ok_or(BookError::NotReadable)?;
    let pack = world.resource::<Content>().0;
    let object = world
        .get::<SmartObject>(target.object)
        .ok_or(BookError::NotReadable)?
        .0;
    let act = pack
        .object(object)
        .interactions
        .get(target.interaction as usize)
        .filter(|a| a.book_reading)
        .ok_or(BookError::NotReadable)?;
    let book = pack
        .books
        .iter()
        .find(|b| b.id == title)
        .ok_or_else(|| BookError::UnknownTitle(title.into()))?;
    Ok(super::title_affinity(
        world.resource::<BookLibrary>().state().taste_seed,
        id,
        &book.genre,
        title,
    ) * world
        .get::<terri_core::Personality>(person)
        .map_or(1.0, |p| p.disposition(object, target.interaction))
        * crate::systems::trait_effects::disposition_multiplier(
            world.get::<terri_core::Traits>(person),
            pack,
            &act.tags,
        ))
}
