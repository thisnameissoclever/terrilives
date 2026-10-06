//! Current persistence is staged completely before the caller adopts the world.

use super::{action_refs, architecture, SaveError};
use crate::{
    books::{BookLibrary, BookWorld},
    portals::ActivePortals,
    Content, Sim,
};
use bevy_ecs::prelude::World;
use terri_core::{books::*, FnvHasher, SaveSnapshotV6};
use terri_data::ContentPack;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV6 {
    capture_world(&sim.world)
}
pub(crate) fn capture_world(world: &World) -> SaveSnapshotV6 {
    let legacy = crate::SnapshotSource { world }.save_snapshot_v5();
    let chain_origins = crate::recipe_actions::capture(world);
    let actions =
        action_refs::capture_origins(&legacy, world.resource::<Content>().0, &chain_origins);
    let mut books = world.resource::<BookLibrary>().state().clone();
    books.copies.sort_by_key(|copy| copy.id);
    books
        .memories
        .sort_by(|a, b| (a.sim_id, &a.title_id).cmp(&(b.sim_id, &b.title_id)));
    let queues = capture_queues(world, &legacy, &actions);
    let command_order = world
        .resource::<terri_core::CommandQueue>()
        .as_slice()
        .iter()
        .map(|c| match c {
            terri_core::SimCommand::Book(book) => Some(book.clone()),
            _ => None,
        })
        .collect();
    let mut recipe_orders = world
        .try_query::<(
            bevy_ecs::entity::Entity,
            &crate::recipe_actions::RecipeOrder,
        )>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .map(|(person, order)| (person.index_u32(), order.0))
                .collect()
        });
    recipe_orders.sort_by_key(|row| row.0);
    SaveSnapshotV6 {
        recipe_orders,
        chain_origins,
        queues,
        reading: crate::reading::persistence::capture(world),
        pending_shifts: crate::reading::persistence::capture_shifts(world),
        command_order,
        legacy,
        actions,
        books,
        seats: crate::seating::capture(world),
    }
}

pub(crate) fn restore(
    snapshot: SaveSnapshotV6,
    content: &'static ContentPack,
    portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    if snapshot.legacy.affinities.is_none() {
        return Err(SaveError::InvalidValue);
    }
    if super::table_retirement::needed(&snapshot, content) {
        return super::table_retirement::restore(snapshot, content, portals, false);
    }
    restore_inner(snapshot, content, portals, false)
}

pub(crate) fn restore_frozen_owned(
    snapshot: terri_core::save_v6::FrozenSaveSnapshotV6,
    content: &'static ContentPack,
    portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    let snapshot = snapshot.into_current();
    if super::table_retirement::needed(&snapshot, content) {
        return super::table_retirement::restore(snapshot, content, portals, false);
    }
    restore_inner(snapshot, content, portals, false)
}

pub(crate) fn restore_migrated(
    snapshot: SaveSnapshotV6,
    content: &'static ContentPack,
    portals: Option<ActivePortals>,
) -> Result<Sim, SaveError> {
    if super::table_retirement::needed(&snapshot, content) {
        return super::table_retirement::restore(snapshot, content, portals, true);
    }
    restore_inner(snapshot, content, portals, true)
}

pub(super) fn restore_inner(
    mut snapshot: SaveSnapshotV6,
    content: &'static ContentPack,
    portals: Option<ActivePortals>,
    migration: bool,
) -> Result<Sim, SaveError> {
    // These markers exist only to migrate historical envelopes. Current
    // capture always includes sleep ownership and has already applied them.
    if (!migration && snapshot.legacy.skills.is_none())
        || snapshot.legacy.sleeping_places.is_none()
        || !snapshot.legacy.death_default_applied
        || !snapshot.legacy.family_by_index.ties().is_empty()
    {
        return Err(SaveError::InvalidValue);
    }
    if super::exceeds_limit(
        snapshot.command_order.len(),
        content.tuning.max_queued_commands as usize,
    ) {
        return Err(SaveError::TooManyCommands);
    }
    validate_queues(&snapshot, content)?;
    if snapshot
        .command_order
        .iter()
        .filter(|c| c.is_none())
        .count()
        != snapshot.legacy.world.queued_commands.len()
    {
        return Err(SaveError::InvalidValue);
    }
    action_refs::remap(
        &mut snapshot.legacy,
        &snapshot.actions,
        content,
        &snapshot.chain_origins,
        migration,
    )?;
    let mut candidate = architecture::restore_v5_seats(
        snapshot.legacy,
        content,
        portals,
        if migration {
            None
        } else {
            Some(&snapshot.seats)
        },
    )?;
    crate::recipe_actions::restore(&mut candidate.world, snapshot.chain_origins)?;
    crate::books::validate_borrower_positions(&candidate.world, &snapshot.books)
        .map_err(|_| SaveError::InvalidValue)?;
    let books = with_book_world(&candidate.world, |world| {
        BookLibrary::from_saved(snapshot.books, world)
    })?;
    candidate.world.insert_resource(books);
    for saved in snapshot.queues {
        let entity = live_entity(&candidate.world, saved.owner).ok_or(SaveError::InvalidValue)?;
        let old = candidate
            .world
            .get::<terri_core::IntentQueue>(entity)
            .ok_or(SaveError::InvalidValue)?;
        let entries = old
            .entries()
            .iter()
            .zip(saved.orders)
            .map(|(entry, row)| terri_core::components::QueuedOrder {
                id: row.id,
                intent: entry.intent,
                title_id: row.title,
            })
            .collect();
        let queue = terri_core::IntentQueue::from_entries(entries, saved.next_id)
            .ok_or(SaveError::InvalidValue)?;
        candidate.world.entity_mut(entity).insert(queue);
    }
    let mut prior = None;
    for (owner, order) in snapshot.recipe_orders {
        if prior.is_some_and(|previous| previous >= owner) {
            return Err(SaveError::InvalidValue);
        }
        prior = Some(owner);
        let person = live_entity(&candidate.world, owner).ok_or(SaveError::InvalidValue)?;
        let entry = candidate
            .world
            .get::<terri_core::IntentQueue>(person)
            .and_then(|queue| queue.order(order))
            .ok_or(SaveError::InvalidValue)?;
        let placed = candidate
            .world
            .get::<terri_core::SmartObject>(entry.intent.object)
            .ok_or(SaveError::InvalidValue)?;
        let recipe =
            crate::systems::chain::ordered_chain(content, placed.0, entry.intent.interaction)
                .ok_or(SaveError::InvalidValue)?;
        if candidate
            .world
            .get::<terri_core::ChainState>(person)
            .is_none_or(|state| state.chain != recipe)
        {
            return Err(SaveError::InvalidValue);
        }
        candidate
            .world
            .entity_mut(person)
            .insert(crate::recipe_actions::RecipeOrder(order));
    }
    if migration {
        let inferred = candidate
            .world
            .try_query::<(
                bevy_ecs::entity::Entity,
                &terri_core::ChainState,
                &terri_core::IntentQueue,
            )>()
            .map_or_else(Vec::new, |mut query| {
                query
                    .iter(&candidate.world)
                    .filter_map(|(person, state, queue)| {
                        queue
                            .entries()
                            .iter()
                            .find(|order| {
                                order.intent.cleanup.is_none()
                                    && order.intent.chore.is_none()
                                    && candidate
                                        .world
                                        .get::<terri_core::SmartObject>(order.intent.object)
                                        .is_some_and(|placed| {
                                            crate::systems::chain::ordered_chain(
                                                content,
                                                placed.0,
                                                order.intent.interaction,
                                            ) == Some(state.chain)
                                        })
                            })
                            .map(|order| (person, order.id))
                    })
                    .collect()
            });
        for (person, order) in inferred {
            candidate
                .world
                .entity_mut(person)
                .insert(crate::recipe_actions::RecipeOrder(order));
        }
    }
    let ordinary: Vec<_> = candidate
        .world
        .resource_mut::<terri_core::CommandQueue>()
        .drain()
        .collect();
    let mut ordinary = ordinary.into_iter();
    for row in snapshot.command_order {
        let command = match row {
            Some(book) => terri_core::SimCommand::Book(book),
            None => ordinary.next().ok_or(SaveError::InvalidValue)?,
        };
        candidate
            .world
            .resource_mut::<terri_core::CommandQueue>()
            .push(command);
    }
    crate::reading::persistence::restore(
        &mut candidate.world,
        &snapshot.reading,
        &snapshot.pending_shifts,
    )?;
    crate::reading::persistence::validate(
        &candidate.world,
        candidate.world.resource::<terri_core::TileGrid>(),
    )?;
    crate::seating::validate(
        &candidate.world,
        candidate.world.resource::<terri_core::TileGrid>(),
    )?;
    if candidate
        .world
        .resource::<terri_core::layout::SavedLayout>()
        .has_edges()
    {
        architecture::validate_edge_world(
            &candidate.save_snapshot(),
            candidate.world.resource::<terri_core::TileGrid>(),
            content,
            &candidate.world,
        )?;
    }
    candidate.sync_render_buffer_after_commands();
    Ok(candidate)
}

pub(crate) fn with_book_world<R>(
    world: &World,
    operation: impl FnOnce(&BookWorld<'_>) -> Result<R, crate::books::BookError>,
) -> Result<R, SaveError> {
    crate::books::with_book_world(world, operation).map_err(|_| SaveError::InvalidValue)
}

pub(crate) fn validate_live_books(world: &World) -> Result<(), SaveError> {
    let Some(library) = world.get_resource::<BookLibrary>() else {
        return Ok(());
    };
    // Historical/synthetic content has no catalogue, and cannot own books.
    if world.resource::<Content>().0.reading.is_none() {
        return if library.state().copies.is_empty() && library.state().memories.is_empty() {
            Ok(())
        } else {
            Err(SaveError::InvalidValue)
        };
    }
    with_book_world(world, |context| {
        crate::books::validate_saved(library.state(), context)
    })?;
    crate::books::validate_borrower_positions(world, library.state())
        .map_err(|_| SaveError::InvalidValue)?;
    crate::reading::persistence::validate(world, world.resource::<terri_core::TileGrid>())?;
    Ok(())
}

pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    let origins = crate::recipe_actions::capture(world);
    if !origins.is_empty() && !terri_data::is_pre_books_pack(world.resource::<Content>().0) {
        hash.write_bytes(b"recipe-origins-v1");
        hash.write_u64(origins.len() as u64);
        for origin in origins {
            hash.write_u64(origin.person.into());
            let text = |hash: &mut FnvHasher, text: &str| {
                hash.write_u64(text.len() as u64);
                hash.write_bytes(text.as_bytes());
            };
            match origin.origin {
                terri_core::save_v6::ChainOrigin::Action {
                    model,
                    action,
                    recipe,
                    selected_step,
                } => {
                    hash.write_u64(0);
                    text(hash, &model);
                    text(hash, &action);
                    text(hash, &recipe);
                    hash.write_u64(selected_step.into());
                }
                terri_core::save_v6::ChainOrigin::Internal { recipe } => {
                    hash.write_u64(1);
                    text(hash, &recipe);
                }
            }
            match origin.selected_use {
                terri_core::save_v6::SavedSelectedUse::Station(index) => {
                    hash.write_u64(0);
                    hash.write_u64(index.into());
                }
                terri_core::save_v6::SavedSelectedUse::LegacyPending => hash.write_u64(1),
                terri_core::save_v6::SavedSelectedUse::Complete => hash.write_u64(2),
            }
        }
    }
    let mut recipe_orders = world
        .try_query::<(
            bevy_ecs::entity::Entity,
            &crate::recipe_actions::RecipeOrder,
        )>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .map(|(person, order)| (person.index_u32(), order.0))
                .collect()
        });
    recipe_orders.sort_by_key(|row| row.0);
    if !recipe_orders.is_empty() {
        hash.write_bytes(b"recipe-orders-v1");
        hash.write_u64(recipe_orders.len() as u64);
        for (owner, order) in recipe_orders {
            hash.write_u64(owner.into());
            hash.write_u64(order);
        }
    }
    crate::seating::hash(world, hash);
    crate::reading::persistence::hash(world, hash);
    let mut rows = world
        .try_query::<(bevy_ecs::entity::Entity, &terri_core::IntentQueue)>()
        .map(|mut q| q.iter(world).collect::<Vec<_>>())
        .unwrap_or_default();
    rows.retain(|(_, queue)| queue.next_id() != 0);
    rows.sort_by_key(|(e, _)| e.index_u32());
    if !rows.is_empty() {
        hash.write_bytes(b"queue-identities-v1");
        hash.write_u64(rows.len() as u64);
        for (owner, queue) in rows {
            hash.write_u64(owner.index_u32().into());
            hash.write_u64(queue.next_id());
            hash.write_u64(queue.len() as u64);
            for order in queue.entries() {
                hash.write_u64(order.id);
                hash.write_u64(order.intent.object.index_u32().into());
                hash.write_u64(order.intent.interaction.into());
                hash.write_u64(order.title_id.is_some().into());
                if let Some(title) = &order.title_id {
                    hash.write_u64(title.len() as u64);
                    hash.write_bytes(title.as_bytes());
                }
            }
        }
    }
    let library = world.resource::<BookLibrary>().state();
    hash.write_bytes(b"books-v1");
    hash.write_u64(library.next_copy_id.into());
    hash.write_u64(library.migration_granted.into());
    hash.write_u64(library.taste_seed);
    let text = |hash: &mut FnvHasher, value: &str| {
        hash.write_u64(value.len() as u64);
        hash.write_bytes(value.as_bytes());
    };
    let home = |hash: &mut FnvHasher, slot: Option<ShelfSlot>| {
        hash.write_u64(slot.is_some().into());
        if let Some(slot) = slot {
            hash.write_u64(slot.shelf.0);
            hash.write_u64(slot.slot.into());
        }
    };
    let mut copies: Vec<_> = library.copies.iter().collect();
    copies.sort_by_key(|copy| copy.id);
    hash.write_u64(copies.len() as u64);
    for copy in copies {
        hash.write_u64(copy.id.0.into());
        text(hash, &copy.title_id);
        home(hash, copy.home);
        hash.write_u64(copy.borrower.is_some().into());
        if let Some(person) = copy.borrower {
            hash.write_u64(person.0.into());
        }
        match copy.location {
            BookLocation::Inventory => hash.write_u64(0),
            BookLocation::Shelf(slot) => {
                hash.write_u64(1);
                home(hash, Some(slot));
            }
            BookLocation::Carried(person) => {
                hash.write_u64(2);
                hash.write_u64(person.0.into());
            }
            BookLocation::Lot { x, y } => {
                hash.write_u64(3);
                hash.write_f32(x);
                hash.write_f32(y);
            }
        }
    }
    let mut memories: Vec<_> = library.memories.iter().collect();
    memories.sort_by(|a, b| (a.sim_id, &a.title_id).cmp(&(b.sim_id, &b.title_id)));
    hash.write_u64(memories.len() as u64);
    for memory in memories {
        hash.write_u64(memory.sim_id.0.into());
        text(hash, &memory.title_id);
        hash.write_u64(memory.progress_ticks.into());
        hash.write_f32(memory.progress_fraction);
        hash.write_u64(memory.pass_novelty.is_some().into());
        if let Some(novelty) = memory.pass_novelty {
            hash.write_f32(novelty);
        }
        hash.write_f32(memory.familiarity);
        hash.write_u64(memory.last_read_tick);
        hash.write_u64(memory.completed_passes.into());
    }
}

fn live_entity(world: &World, index: u32) -> Option<bevy_ecs::entity::Entity> {
    let index = bevy_ecs::entity::EntityIndex::from_raw_u32(index)?;
    world
        .entities()
        .is_index_spawned(index)
        .then(|| world.entities().resolve_from_index(index))
}

fn action_key(
    legacy: &terri_core::SaveSnapshotV5,
    actions: &terri_core::save_v6::SavedActionManifest,
    target: u32,
    row: u32,
) -> Option<String> {
    let entity = legacy.world.entities.iter().find(|e| e.index == target)?;
    if let Some(model) = &entity.smart_object {
        let object = actions.objects.iter().find(|o| &o.model == model)?;
        if let Some(id) = object.interactions.get(row as usize) {
            Some(format!("interaction:{id}"))
        } else {
            object
                .advertised_chains
                .get((row as usize).checked_sub(object.interactions.len())?)
                .map(|id| format!("chain:{id}"))
        }
    } else {
        actions
            .social
            .get(row as usize)
            .map(|id| format!("social:{id}"))
    }
}

pub(crate) fn historical_queues(
    legacy: &terri_core::SaveSnapshotV5,
    actions: &terri_core::save_v6::SavedActionManifest,
) -> Vec<terri_core::save_v6::SavedOrderQueue> {
    let mut rows: Vec<terri_core::save_v6::SavedOrderQueue> = legacy
        .world
        .entities
        .iter()
        .filter_map(|entity| {
            entity
                .intents
                .as_ref()
                .map(|intents| terri_core::save_v6::SavedOrderQueue {
                    owner: entity.index,
                    next_id: 0,
                    orders: intents
                        .iter()
                        .map(|intent| terri_core::save_v6::SavedOrder {
                            id: 0,
                            target: intent.object,
                            action: action_key(legacy, actions, intent.object, intent.interaction)
                                .unwrap_or_default(),
                            title: None,
                        })
                        .collect(),
                })
        })
        .collect();
    for row in &mut rows {
        let mut special = Vec::new();
        if let Some(cleanup) = &legacy.targeted_cleanup {
            for order in &cleanup.orders {
                if order.person == row.owner {
                    if let Some(position) = order.queue_position {
                        special.push((position, order.surface, format!("cleanup:{}", order.id)));
                    }
                }
            }
        }
        if let Some(chores) = &legacy.chores {
            for order in &chores.orders {
                if order.person == row.owner {
                    special.push((
                        order.queue_position,
                        row.owner,
                        format!("chore:{}", order.id),
                    ));
                }
            }
        }
        special.sort_by_key(|order| order.0);
        for (position, target, action) in special {
            if position as usize > row.orders.len() {
                continue;
            }
            row.orders.insert(
                position as usize,
                terri_core::save_v6::SavedOrder {
                    id: 0,
                    target,
                    action,
                    title: None,
                },
            );
        }
        row.next_id = row.orders.len() as u64;
        for (id, order) in row.orders.iter_mut().enumerate() {
            order.id = id as u64;
        }
    }
    rows
}
fn capture_queues(
    world: &World,
    legacy: &terri_core::SaveSnapshotV5,
    actions: &terri_core::save_v6::SavedActionManifest,
) -> Vec<terri_core::save_v6::SavedOrderQueue> {
    let mut rows = historical_queues(legacy, actions);
    for row in &mut rows {
        let queue = world
            .get::<terri_core::IntentQueue>(live_entity(world, row.owner).expect("live owner"))
            .expect("live queue");
        assert_eq!(row.orders.len(), queue.len(), "complete queue annotations");
        row.next_id = queue.next_id();
        for (saved, entry) in row.orders.iter_mut().zip(queue.entries()) {
            saved.id = entry.id;
            saved.title = entry.title_id.clone();
        }
    }
    rows.sort_by_key(|row| row.owner);
    rows
}

fn validate_queues(snapshot: &SaveSnapshotV6, content: &ContentPack) -> Result<(), SaveError> {
    let mut owners = std::collections::BTreeSet::new();
    let mut positions = std::collections::BTreeSet::new();
    if let Some(state) = &snapshot.legacy.targeted_cleanup {
        for order in &state.orders {
            if let Some(position) = order.queue_position {
                if !positions.insert((order.person, position)) {
                    return Err(SaveError::InvalidValue);
                }
            }
        }
    }
    if let Some(state) = &snapshot.legacy.chores {
        for order in &state.orders {
            if !positions.insert((order.person, order.queue_position)) {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    let expected = snapshot
        .legacy
        .world
        .entities
        .iter()
        .filter(|e| e.intents.is_some())
        .count();
    if expected != snapshot.queues.len() {
        return Err(SaveError::InvalidValue);
    }
    for queue in &snapshot.queues {
        if !owners.insert(queue.owner) {
            return Err(SaveError::InvalidValue);
        }
        let expected = historical_queues(&snapshot.legacy, &snapshot.actions)
            .into_iter()
            .find(|row| row.owner == queue.owner)
            .ok_or(SaveError::InvalidValue)?;
        if expected.orders.len() != queue.orders.len()
            || (content.tuning.max_queued_intents > 0
                && super::exceeds_limit(
                    queue.orders.len(),
                    content.tuning.max_queued_intents as usize,
                ))
        {
            return Err(SaveError::InvalidValue);
        }
        let mut ids = std::collections::BTreeSet::new();
        for (order, intent) in queue.orders.iter().zip(&expected.orders) {
            if order.id >= queue.next_id
                || !ids.insert(order.id)
                || order.target != intent.target
                || order.action != intent.action
            {
                return Err(SaveError::InvalidValue);
            }
            if let Some(title) = &order.title {
                let model = snapshot
                    .legacy
                    .world
                    .entities
                    .iter()
                    .find(|e| e.index == order.target)
                    .and_then(|e| e.smart_object.as_ref())
                    .ok_or(SaveError::InvalidValue)?;
                let action = order
                    .action
                    .strip_prefix("interaction:")
                    .ok_or(SaveError::InvalidValue)?;
                if !content.books.iter().any(|b| &b.id == title)
                    || !content.find(model).is_some_and(|id| {
                        content
                            .object(id)
                            .interactions
                            .iter()
                            .any(|a| a.id == action && a.book_reading)
                    })
                {
                    return Err(SaveError::InvalidValue);
                }
            }
        }
    }
    Ok(())
}
