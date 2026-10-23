//! Persist exact conversation ownership without rewriting older save layouts.
use super::SaveError;
use crate::{
    social_episode::{requests::*, SocialEpisodes},
    Content, Sim,
};
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{save_v15::*, Agent, SimClock, SimId, Socialising, Target};

fn saved_phase(phase: RequestPhase) -> SavedConversationPhase {
    match phase {
        RequestPhase::Approaching => SavedConversationPhase::Approaching,
        RequestPhase::Waiting => SavedConversationPhase::Waiting,
        RequestPhase::Suspended => SavedConversationPhase::Suspended,
        RequestPhase::Talking => SavedConversationPhase::Talking,
    }
}
fn live_phase(phase: SavedConversationPhase) -> RequestPhase {
    match phase {
        SavedConversationPhase::Approaching => RequestPhase::Approaching,
        SavedConversationPhase::Waiting => RequestPhase::Waiting,
        SavedConversationPhase::Suspended => RequestPhase::Suspended,
        SavedConversationPhase::Talking => RequestPhase::Talking,
    }
}
pub(crate) fn capture_requests(world: &World) -> SavedConversationRequests {
    let state = crate::social_episode::requests::snapshot(world);
    let pack = world.resource::<Content>().0;
    SavedConversationRequests {
        next_id: state.next_id,
        requests: state
            .requests
            .values()
            .map(|r| SavedConversationRequest {
                id: r.id,
                initiator: world
                    .get::<SimId>(r.initiator)
                    .expect("a chat initiator has a stable person identity")
                    .0,
                recipient: world
                    .get::<SimId>(r.recipient)
                    .expect("a chat recipient has a stable person identity")
                    .0,
                interaction: pack.social[r.interaction as usize].id.clone(),
                origin: match r.origin {
                    ConversationOrigin::Autonomous => SavedConversationOrigin::Autonomous,
                    ConversationOrigin::Player { order_id } => {
                        SavedConversationOrigin::Player { order_id }
                    }
                    ConversationOrigin::LegacyUnattributed => {
                        SavedConversationOrigin::LegacyUnattributed
                    }
                },
                created: r.created,
                phase: saved_phase(r.phase),
                waiting_tile: r.waiting_tile,
                target_owned: r.phase != RequestPhase::Suspended
                    && state
                        .outgoing(r.initiator)
                        .is_some_and(|owner| owner.id == r.id)
                    && world
                        .get::<Target>(r.initiator)
                        .is_some_and(|t| t.object == r.recipient && t.interaction == r.interaction),
            })
            .collect(),
    }
}

pub(crate) fn capture(sim: &Sim) -> terri_core::SaveSnapshotV15 {
    let requests = capture_requests(sim.world());
    let mut legacy = super::v14::capture(sim);
    // A queued recipient is intentionally unreserved. Strip that new kind of
    // target from the frozen payload, then restore it from its explicit owner.
    let waiting: BTreeSet<_> = requests
        .requests
        .iter()
        .filter(|r| r.phase == SavedConversationPhase::Waiting && r.target_owned)
        .map(|r| r.initiator)
        .collect();
    for entity in &mut legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .world
        .entities
    {
        if entity.sim_id.is_some_and(|id| waiting.contains(&id)) {
            entity.target = None;
        }
    }
    terri_core::SaveSnapshotV15 {
        legacy,
        conversation_requests: requests,
    }
}

pub(crate) fn restore(
    snapshot: terri_core::SaveSnapshotV15,
    content: &'static terri_data::ContentPack,
    portals: super::Carried,
) -> Result<Sim, SaveError> {
    let mut candidate = super::v14::restore(snapshot.legacy, content, portals)?;
    restore_requests(&mut candidate.world, snapshot.conversation_requests)?;
    Ok(candidate)
}

pub(crate) fn restore_requests(
    world: &mut World,
    saved: SavedConversationRequests,
) -> Result<(), SaveError> {
    restore_requests_with_executions(world, saved, &[])
}

/// V17 retains bare actors through exact execution rows. The published request
/// layout addresses named people only; its standalone reader stays strict.
pub(crate) fn restore_requests_with_executions(
    world: &mut World,
    saved: SavedConversationRequests,
    executions: &[terri_core::save_v17::SavedSocialExecution],
) -> Result<(), SaveError> {
    let mut bare = BTreeMap::new();
    let mut player_executions = BTreeMap::new();
    for row in executions {
        let actor = crate::dining::entity(world, row.initiator)
            .filter(|&e| world.get::<Agent>(e).is_some())
            .ok_or(SaveError::InvalidEntityReference)?;
        let recipient = crate::dining::entity(world, row.recipient)
            .filter(|&e| world.get::<Agent>(e).is_some())
            .ok_or(SaveError::InvalidEntityReference)?;
        if row.provenance == 1 && player_executions.insert(actor, row).is_some() {
            return Err(SaveError::InvalidValue);
        }
        if row.provenance == 2
            || (world.get::<SimId>(actor).is_some() && world.get::<SimId>(recipient).is_some())
        {
            continue;
        }
        if bare
            .insert(
                actor,
                (recipient, row.interaction, row.running, row.admitted),
            )
            .is_some()
        {
            return Err(SaveError::InvalidValue);
        }
    }
    if saved.requests.len() > super::MAX_ENTITIES {
        return Err(SaveError::TooManyEntities);
    }
    if saved.requests.windows(2).any(|w| w[0].id >= w[1].id)
        || saved.requests.iter().any(|r| r.id >= saved.next_id)
    {
        return Err(SaveError::InvalidValue);
    }
    let people: BTreeMap<_, _> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .map(|(e, i)| (i.0, e))
        .collect();
    let person = |id: u32| {
        people
            .get(&id)
            .copied()
            .ok_or(SaveError::InvalidEntityReference)
    };
    let pack = world.resource::<Content>().0;
    let mut result = ConversationRequests {
        next_id: saved.next_id,
        ..Default::default()
    };
    let mut active = BTreeSet::new();
    let mut physical_participants = BTreeSet::new();
    let mut autonomous = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut owned_targets = Vec::new();
    for r in saved.requests {
        let initiator = person(r.initiator)?;
        let recipient = person(r.recipient)?;
        let interaction = pack
            .social
            .iter()
            .position(|a| a.id == r.interaction)
            .ok_or(SaveError::InvalidValue)? as u32;
        // Published V17+ writers mirror a player's executing fight into the
        // request table. Its exact execution proves ownership; older standalone
        // readers have no such witness and keep refusing fight requests.
        if crate::fights::is_fight(&pack.social[interaction as usize]) {
            let matching = match (r.origin, player_executions.get(&initiator)) {
                (SavedConversationOrigin::Player { order_id }, Some(execution)) => {
                    execution.order_id == Some(order_id)
                        && execution.recipient == recipient.index_u32()
                        && execution.interaction == interaction
                        && match r.phase {
                            SavedConversationPhase::Talking => {
                                execution.running && execution.admitted
                            }
                            SavedConversationPhase::Approaching => {
                                !execution.running && execution.admitted
                            }
                            SavedConversationPhase::Waiting => {
                                !execution.running && !execution.admitted
                            }
                            SavedConversationPhase::Suspended => false,
                        }
                }
                _ => false,
            };
            if !matching {
                return Err(SaveError::InvalidValue);
            }
        }
        if initiator == recipient || r.created > world.resource::<SimClock>().tick {
            return Err(SaveError::InvalidValue);
        }
        if let Some((x, y)) = r.waiting_tile {
            let grid = world.resource::<terri_core::TileGrid>();
            if x < 0 || y < 0 || x as usize >= grid.width() || y as usize >= grid.height() {
                return Err(SaveError::InvalidValue);
            }
        }
        let origin = match r.origin {
            SavedConversationOrigin::Autonomous => {
                if !autonomous.insert(initiator) {
                    return Err(SaveError::InvalidValue);
                }
                ConversationOrigin::Autonomous
            }
            SavedConversationOrigin::LegacyUnattributed => ConversationOrigin::LegacyUnattributed,
            SavedConversationOrigin::Player { order_id } => {
                if !orders.insert((initiator, order_id)) {
                    return Err(SaveError::InvalidValue);
                }
                let entry = world
                    .get::<terri_core::IntentQueue>(initiator)
                    .and_then(|q| q.order(order_id))
                    .ok_or(SaveError::InvalidValue)?;
                if entry.intent.object != recipient
                    || entry.intent.interaction != interaction
                    || entry.title_id.is_some()
                    || entry.intent.cleanup.is_some()
                    || entry.intent.chore.is_some()
                {
                    return Err(SaveError::InvalidValue);
                }
                ConversationOrigin::Player { order_id }
            }
        };
        let phase = live_phase(r.phase);
        if phase != RequestPhase::Suspended && !active.insert(initiator) {
            return Err(SaveError::InvalidValue);
        }
        if matches!(phase, RequestPhase::Approaching | RequestPhase::Talking)
            && (!physical_participants.insert(initiator)
                || !physical_participants.insert(recipient))
        {
            return Err(SaveError::InvalidValue);
        }
        let expected = Target {
            object: recipient,
            interaction,
        };
        if phase == RequestPhase::Talking {
            if !r.target_owned
                || world
                    .get::<Socialising>(initiator)
                    .is_none_or(|s| s.partner != recipient || s.interaction != interaction)
                || world.get::<Target>(initiator) != Some(&expected)
            {
                return Err(SaveError::InvalidValue);
            }
        } else if phase == RequestPhase::Approaching {
            if !r.target_owned
                || world.get::<Target>(initiator) != Some(&expected)
                || world
                    .resource::<SocialEpisodes>()
                    .rendezvous
                    .get(&recipient)
                    != Some(&initiator)
            {
                return Err(SaveError::InvalidValue);
            }
        } else if phase == RequestPhase::Waiting {
            if world
                .resource::<SocialEpisodes>()
                .rendezvous
                .get(&recipient)
                == Some(&initiator)
                || (r.target_owned && world.get::<Target>(initiator).is_some())
            {
                return Err(SaveError::InvalidValue);
            }
        } else if r.target_owned {
            return Err(SaveError::InvalidValue);
        }
        if r.target_owned && phase == RequestPhase::Waiting {
            owned_targets.push((initiator, expected));
        }
        result.requests.insert(
            r.id,
            ConversationRequest {
                id: r.id,
                initiator,
                recipient,
                interaction,
                origin,
                created: r.created,
                phase,
                waiting_tile: r.waiting_tile,
            },
        );
    }
    for (&recipient, &initiator) in &world.resource::<SocialEpisodes>().rendezvous {
        let t = world
            .get::<Target>(initiator)
            .ok_or(SaveError::InvalidEntityReference)?;
        if pack
            .social
            .get(t.interaction as usize)
            .is_some_and(crate::fights::is_fight)
        {
            continue;
        }
        if !result.requests.values().any(|r| {
            r.initiator == initiator
                && r.recipient == recipient
                && matches!(r.phase, RequestPhase::Approaching | RequestPhase::Talking)
        }) && !bare
            .get(&initiator)
            .is_some_and(|&(partner, interaction, running, admitted)| {
                partner == recipient && interaction == t.interaction && (running || admitted)
            })
        {
            return Err(SaveError::InvalidValue);
        }
    }
    for (initiator, talk) in world.query::<(Entity, &Socialising)>().iter(world) {
        if pack
            .social
            .get(talk.interaction as usize)
            .is_some_and(crate::fights::is_fight)
        {
            continue;
        }
        if !result.requests.values().any(|r| {
            r.initiator == initiator
                && r.recipient == talk.partner
                && r.phase == RequestPhase::Talking
        }) && !bare
            .get(&initiator)
            .is_some_and(|&(partner, interaction, running, _)| {
                partner == talk.partner && interaction == talk.interaction && running
            })
        {
            return Err(SaveError::InvalidValue);
        }
    }
    // Frozen validators allow a bare social target. Current saves require its
    // exact admitted owner; a Waiting target would have been stripped above.
    for (person, target) in world
        .query_filtered::<(Entity, &Target), With<Agent>>()
        .iter(world)
    {
        if world.get::<Agent>(target.object).is_some()
            && pack
                .social
                .get(target.interaction as usize)
                .is_some_and(|a| !crate::fights::is_fight(a))
            && !result.requests.values().any(|r| {
                r.initiator == person
                    && r.recipient == target.object
                    && r.interaction == target.interaction
                    && matches!(r.phase, RequestPhase::Approaching | RequestPhase::Talking)
            })
            && !bare
                .get(&person)
                .is_some_and(|&(partner, interaction, _, _)| {
                    partner == target.object && interaction == target.interaction
                })
        {
            return Err(SaveError::InvalidValue);
        }
    }
    for (person, target) in owned_targets {
        world.entity_mut(person).insert(target);
    }
    world.insert_resource(result);
    crate::social_episode::requests::refresh_markers(world);
    Ok(())
}

pub(crate) fn hash(world: &World, hash: &mut terri_core::FnvHasher) {
    let saved = capture_requests(world);
    if saved.requests.is_empty() && saved.next_id == 0 {
        return;
    }
    hash.write_bytes(b"conversation-requests-v1");
    hash.write_u64(saved.next_id);
    hash.write_u64(saved.requests.len() as u64);
    for r in saved.requests {
        hash.write_u64(r.id);
        hash.write_u64(u64::from(r.initiator));
        hash.write_u64(u64::from(r.recipient));
        hash.write_u64(r.interaction.len() as u64);
        hash.write_bytes(r.interaction.as_bytes());
        match r.origin {
            SavedConversationOrigin::Autonomous => hash.write_u64(0),
            SavedConversationOrigin::Player { order_id } => {
                hash.write_u64(1);
                hash.write_u64(order_id);
            }
            SavedConversationOrigin::LegacyUnattributed => hash.write_u64(2),
        }
        hash.write_u64(r.created);
        hash.write_u64(r.phase as u64);
        hash.write_u64(u64::from(r.target_owned));
        if let Some((x, y)) = r.waiting_tile {
            hash.write_u64(1);
            hash.write_u64(x as u64);
            hash.write_u64(y as u64);
        } else {
            hash.write_u64(0);
        }
    }
}
