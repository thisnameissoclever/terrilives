//! Validate the saved execution owner separately from the frozen physical shape.
use super::{
    execution::{owns_target, Execution, ExecutionOwner, ExecutionPhase},
    SocialEpisodes,
};
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{Agent, IntentQueue, Reserved, Socialising, Target};

pub(crate) fn save_executions(world: &World) -> Vec<terri_core::save_v15::SavedSocialExecution> {
    let state = world.resource::<SocialEpisodes>();
    let mut rows: Vec<_> = state
        .executions
        .iter()
        .map(|(&actor, &e)| saved_row(actor, e))
        .collect();
    // Tests and frozen readers can expose an earlier physical-only continuation.
    if let Some(mut physical) = world.try_query::<(Entity, &Target)>() {
        for (actor, t) in physical.iter(world) {
            if state.executions.contains_key(&actor) || world.get::<Agent>(t.object).is_none() {
                continue;
            }
            rows.push(saved_row(
                actor,
                Execution {
                    recipient: t.object,
                    interaction: t.interaction,
                    owner: if world
                        .resource::<crate::Content>()
                        .0
                        .social
                        .get(t.interaction as usize)
                        .is_some_and(crate::fights::is_fight)
                    {
                        ExecutionOwner::System(None)
                    } else {
                        ExecutionOwner::Autonomous
                    },
                    phase: if world.get::<Socialising>(actor).is_some() {
                        ExecutionPhase::Running
                    } else {
                        ExecutionPhase::Approaching
                    },
                    admitted: world.get::<Socialising>(actor).is_some()
                        || state.rendezvous.get(&t.object) == Some(&actor)
                        || world.get::<Reserved>(t.object).is_some(),
                },
            ));
        }
    }
    rows.sort_by_key(|row| row.initiator);
    rows
}
fn saved_row(actor: Entity, e: Execution) -> terri_core::save_v15::SavedSocialExecution {
    let (provenance, order_id) = match e.owner {
        ExecutionOwner::Autonomous => (0, None),
        ExecutionOwner::Player(id) => (1, Some(id)),
        ExecutionOwner::System(id) => (2, id),
    };
    terri_core::save_v15::SavedSocialExecution {
        initiator: actor.index_u32(),
        recipient: e.recipient.index_u32(),
        interaction: e.interaction,
        provenance,
        order_id,
        running: e.phase == ExecutionPhase::Running,
        admitted: e.admitted,
    }
}
pub(crate) fn restore_executions(
    world: &mut World,
    rows: Vec<terri_core::save_v15::SavedSocialExecution>,
) -> Result<(), crate::save::SaveError> {
    use crate::save::SaveError;
    if rows.len() > world.entities().count_spawned() as usize {
        return Err(SaveError::TooManyEntities);
    }
    let mut restored = BTreeMap::new();
    let mut recipients = BTreeSet::new();
    let physical = world.resource::<SocialEpisodes>().rendezvous.clone();
    for row in rows {
        let actor = crate::dining::entity(world, row.initiator)
            .filter(|&a| world.get::<Agent>(a).is_some())
            .ok_or(SaveError::InvalidEntityReference)?;
        let recipient = crate::dining::entity(world, row.recipient)
            .filter(|&a| world.get::<Agent>(a).is_some())
            .ok_or(SaveError::InvalidEntityReference)?;
        let owner = match (row.provenance, row.order_id) {
            (0, None) => ExecutionOwner::Autonomous,
            (1, Some(id)) => {
                let order = world
                    .get_resource::<crate::player_actions::PlayerActions>()
                    .and_then(|s| s.orders.get(&(actor, id)))
                    .ok_or(SaveError::InvalidValue)?;
                if order.entry.intent.object != recipient
                    || order.entry.intent.interaction != row.interaction
                    || order.entry.intent.cleanup.is_some()
                    || order.entry.intent.chore.is_some()
                {
                    return Err(SaveError::InvalidValue);
                }
                ExecutionOwner::Player(id)
            }
            (2, id) => {
                if id.is_some_and(|id| {
                    !world
                        .resource::<crate::fights::Fights>()
                        .owns_order(actor, id)
                }) || !world
                    .resource::<crate::Content>()
                    .0
                    .social
                    .get(row.interaction as usize)
                    .is_some_and(crate::fights::is_fight)
                    || id.is_some_and(|id| {
                        world.get::<IntentQueue>(actor).is_none_or(|q| {
                            q.order(id).is_none_or(|order| {
                                order.intent.object != recipient
                                    || order.intent.interaction != row.interaction
                            })
                        })
                    })
                {
                    return Err(SaveError::InvalidValue);
                }
                ExecutionOwner::System(id)
            }
            _ => return Err(SaveError::InvalidValue),
        };
        let e = Execution {
            recipient,
            interaction: row.interaction,
            owner,
            phase: if row.running {
                ExecutionPhase::Running
            } else {
                ExecutionPhase::Approaching
            },
            admitted: row.admitted,
        };
        if actor == recipient
            || !owns_target(world, actor, e)
            || world
                .resource::<crate::Content>()
                .0
                .social
                .get(row.interaction as usize)
                .is_none()
            || (row.running
                && (!row.admitted
                    || world.get::<Socialising>(actor).is_none_or(|s| {
                        s.partner != recipient || s.interaction != row.interaction
                    })))
            || (!row.running && world.get::<Socialising>(actor).is_some())
            || (row.admitted
                && (!recipients.insert(recipient)
                    || world.get::<Reserved>(recipient).is_none()
                    || world.get::<Target>(recipient).is_some()
                    || world.get::<terri_core::Path>(recipient).is_some()
                    || world.get::<terri_core::Eating>(recipient).is_some()
                    || world.get::<Socialising>(recipient).is_some()
                    || crate::recipe_actions::foreground(world, recipient)
                    || world
                        .get::<crate::reading::ReadingJourney>(recipient)
                        .is_some()
                    || world
                        .get::<terri_core::chores::ChoreWork>(recipient)
                        .is_some()
                    || world.get::<terri_core::AtWork>(recipient).is_some()
                    || world.get::<terri_core::Commuting>(recipient).is_some()))
            || (!row.running && (physical.get(&recipient) == Some(&actor)) != row.admitted)
            || restored.insert(actor, e).is_some()
        {
            return Err(SaveError::InvalidValue);
        }
    }
    let physical_targets = world
        .query::<(Entity, &Target)>()
        .iter(world)
        .filter(|(_, t)| world.get::<Agent>(t.object).is_some())
        .count();
    if physical_targets != restored.len()
        || restored.iter().any(|(&a, e)| {
            e.admitted
                && restored
                    .get(&e.recipient)
                    .is_some_and(|other| other.admitted || other.phase == ExecutionPhase::Running)
                && a != e.recipient
        })
    {
        return Err(SaveError::InvalidValue);
    }
    world.resource_mut::<SocialEpisodes>().executions = restored;
    Ok(())
}

/// Frozen engines treated a matching queue front as the physical execution.
/// This inference belongs only to historical readers; V15 restores exact ownership.
pub(crate) fn adopt_legacy(world: &mut World) {
    let rows: Vec<_> = world
        .query::<(Entity, &Target)>()
        .iter(world)
        .filter(|(_, t)| world.get::<Agent>(t.object).is_some())
        .map(|(a, t)| (a, *t))
        .collect();
    for (actor, t) in rows {
        let owner = world
            .get::<IntentQueue>(actor)
            .and_then(|q| q.entries().first())
            .filter(|entry| {
                entry.intent.object == t.object
                    && entry.intent.interaction == t.interaction
                    && entry.intent.cleanup.is_none()
                    && entry.intent.chore.is_none()
            })
            .map_or_else(
                || {
                    if world
                        .resource::<crate::Content>()
                        .0
                        .social
                        .get(t.interaction as usize)
                        .is_some_and(crate::fights::is_fight)
                    {
                        ExecutionOwner::System(None)
                    } else {
                        ExecutionOwner::Autonomous
                    }
                },
                |entry| ExecutionOwner::Player(entry.id),
            );
        let running = world.get::<Socialising>(actor).is_some();
        let admitted = running
            || world.resource::<SocialEpisodes>().rendezvous.get(&t.object) == Some(&actor)
            || world.get::<Reserved>(t.object).is_some();
        world.resource_mut::<SocialEpisodes>().executions.insert(
            actor,
            Execution {
                recipient: t.object,
                interaction: t.interaction,
                owner,
                phase: if running {
                    ExecutionPhase::Running
                } else {
                    ExecutionPhase::Approaching
                },
                admitted,
            },
        );
    }
}
