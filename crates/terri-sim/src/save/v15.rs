//! Player ownership and attendance are validated before adopting the candidate.
use super::SaveError;
use crate::{attendance, player_actions, Sim};
use terri_core::SaveSnapshotV15;

pub(crate) fn capture(sim: &Sim) -> SaveSnapshotV15 {
    SaveSnapshotV15 {
        social_executions: crate::social_episode::save_executions(sim.world()),
        system_social_orders: sim
            .world()
            .resource::<crate::fights::Fights>()
            .saved_orders(sim.world()),
        legacy: super::v14::capture(sim),
        player_orders: player_actions::save(sim.world()),
        attendance: attendance::to_saved(sim.world()),
        confirmed_commands: sim
            .world()
            .resource::<terri_core::CommandQueue>()
            .as_slice()
            .iter()
            .enumerate()
            .filter_map(|(position, command)| match command {
                terri_core::SimCommand::ConfirmedOrder {
                    fingerprint,
                    command,
                } => Some((position as u32, *fingerprint, command.clone())),
                _ => None,
            })
            .collect(),
        background_recipes: crate::recipe_actions::save_activity(sim.world()),
    }
}

pub(crate) fn restore(
    mut snapshot: SaveSnapshotV15,
    content: &'static terri_data::ContentPack,
    portals: super::Carried,
) -> Result<Sim, SaveError> {
    normalize_action_rows(&mut snapshot, content)?;
    // Attendance can keep a weekly review pending while its worker is home.
    // Restore that context before validating the career continuation.
    let mut candidate = super::v13::restore(snapshot.legacy.legacy, content, portals)?;
    attendance::validate_saved(candidate.world(), &snapshot.attendance)?;
    attendance::restore(candidate.world_mut(), snapshot.attendance);
    crate::careers::validate_saved(candidate.world(), &snapshot.legacy.careers)?;
    candidate
        .world_mut()
        .insert_resource(crate::careers::Careers::from_saved(snapshot.legacy.careers));
    crate::recipe_actions::restore_activity(candidate.world_mut(), snapshot.background_recipes)?;
    let mut system_owners = std::collections::BTreeSet::new();
    for (actor, id) in snapshot.system_social_orders {
        let person = crate::dining::entity(candidate.world(), actor)
            .ok_or(SaveError::InvalidEntityReference)?;
        if !system_owners.insert(actor)
            || candidate
                .world()
                .get::<terri_core::IntentQueue>(person)
                .and_then(|q| q.order(id))
                .is_none_or(|order| {
                    order.intent.cleanup.is_some()
                        || order.intent.chore.is_some()
                        || candidate
                            .world()
                            .get::<terri_core::Agent>(order.intent.object)
                            .is_none()
                        || content
                            .social
                            .get(order.intent.interaction as usize)
                            .is_none_or(|action| !crate::fights::is_fight(action))
                })
            || snapshot.player_orders.orders.iter().any(|row| {
                Some(row.actor) == player_actions::saved_actor(candidate.world(), person)
                    && row.order_id == id
            })
        {
            return Err(SaveError::InvalidValue);
        }
        candidate
            .world_mut()
            .resource_mut::<crate::fights::Fights>()
            .restore_order(person, id);
    }
    player_actions::restore(candidate.world_mut(), snapshot.player_orders)?;
    crate::social_episode::restore_executions(candidate.world_mut(), snapshot.social_executions)?;
    let entities = candidate.save_snapshot_v5().world.entities;
    for (_, _, order) in &snapshot.confirmed_commands {
        let command = order.clone().into_command();
        if let terri_core::SimCommand::Book(terri_core::command::BookCommand::Read {
            agent,
            object,
            action,
            title,
            ..
        }) = &command
        {
            super::validate_agent_reference(&entities, *agent)?;
            let model = super::validate_entity_reference(&entities, *object)?
                .smart_object
                .as_deref()
                .and_then(|name| content.find(name))
                .ok_or(SaveError::InvalidEntityReference)?;
            if !content
                .object(model)
                .interactions
                .iter()
                .any(|row| row.id == *action && row.book_reading)
                || !content.books.iter().any(|book| book.id == *title)
            {
                return Err(SaveError::InvalidContentReference);
            }
        } else {
            // Preserve the ordinary command contract, including edits/chore
            // selections whose final validity belongs to their drain position.
            let frozen = super::capture_command(&command, content);
            super::validate_command(&frozen, &entities, content, false)?;
        }
    }
    let ordinary: Vec<_> = candidate
        .world_mut()
        .resource_mut::<terri_core::CommandQueue>()
        .drain()
        .collect();
    let count = ordinary
        .len()
        .checked_add(snapshot.confirmed_commands.len())
        .ok_or(SaveError::TooManyCommands)?;
    if super::exceeds_limit(count, content.tuning.max_queued_commands as usize)
        || snapshot
            .confirmed_commands
            .windows(2)
            .any(|pair| pair[0].0 >= pair[1].0)
        || snapshot
            .confirmed_commands
            .iter()
            .any(|(position, _, command)| {
                *position as usize >= count || command.validate_structure().is_err()
            })
    {
        return Err(SaveError::InvalidValue);
    }
    let mut confirmed = snapshot.confirmed_commands.into_iter().peekable();
    let mut ordinary = ordinary.into_iter();
    for position in 0..count {
        let command = if confirmed
            .peek()
            .is_some_and(|row| row.0 as usize == position)
        {
            let (_, fingerprint, command) =
                confirmed.next().expect("the matching staged row exists");
            terri_core::SimCommand::ConfirmedOrder {
                fingerprint,
                command,
            }
        } else {
            ordinary.next().ok_or(SaveError::InvalidValue)?
        };
        candidate
            .world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(command);
    }
    Ok(candidate)
}

/// New ownership rows use the same authored identities as the frozen queues.
fn normalize_action_rows(
    snapshot: &mut SaveSnapshotV15,
    content: &terri_data::ContentPack,
) -> Result<(), SaveError> {
    let source = &snapshot.legacy.legacy.legacy.legacy.legacy.legacy;
    let social_row = |row: u32| {
        let id = source
            .actions
            .social
            .get(row as usize)
            .ok_or(SaveError::InvalidContentReference)?;
        content
            .social
            .iter()
            .position(|action| action.id == *id)
            .map(|index| index as u32)
            .ok_or(SaveError::InvalidContentReference)
    };
    let target_row = |target: u32, row: u32| {
        let entity = source
            .legacy
            .world
            .entities
            .iter()
            .find(|entity| entity.index == target)
            .ok_or(SaveError::InvalidEntityReference)?;
        let Some(model) = entity.smart_object.as_deref() else {
            return social_row(row);
        };
        let saved = source
            .actions
            .objects
            .iter()
            .find(|object| object.model == model)
            .ok_or(SaveError::InvalidContentReference)?;
        let definition = content
            .find(model)
            .ok_or(SaveError::InvalidContentReference)?;
        let object = content.object(definition);
        if let Some(id) = saved.interactions.get(row as usize) {
            return object
                .interactions
                .iter()
                .position(|action| action.id == *id)
                .map(|index| index as u32)
                .ok_or(SaveError::InvalidContentReference);
        }
        let id = saved
            .advertised_chains
            .get(row as usize - saved.interactions.len())
            .ok_or(SaveError::InvalidContentReference)?;
        crate::action_rows::aliases(content, definition)
            .position(|(_, chain)| chain.id == *id)
            .map(|index| (object.interactions.len() + index) as u32)
            .ok_or(SaveError::InvalidContentReference)
    };
    for execution in &mut snapshot.social_executions {
        execution.interaction = social_row(execution.interaction)?;
    }
    for order in &mut snapshot.player_orders.orders {
        // Domestic ownership uses zero as a sentinel, outside the action tables.
        if order.cleanup.is_none() && order.chore.is_none() {
            order.interaction = target_row(order.target, order.interaction)?;
        }
    }
    for (_, _, order) in &mut snapshot.confirmed_commands {
        match order {
            terri_core::command::PlayerOrder::UseObject {
                object,
                interaction,
                ..
            } => {
                *interaction = target_row(*object, *interaction)?;
            }
            terri_core::command::PlayerOrder::TalkTo { interaction, .. } => {
                *interaction = social_row(*interaction)?;
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "v15_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "v15_actor_tests.rs"]
mod actor_tests;
