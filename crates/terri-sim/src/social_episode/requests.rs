//! A chosen chat keeps its identity while its recipient finishes another action.
pub(crate) mod route_cache;
pub(crate) mod runtime;
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{
    Agent, AtWork, Blocked, ChainState, Commuting, Eating, IntentQueue, Path, Position, Reserved,
    Restless, SimClock, Socialising, StepWork, Target, TileGrid, Wander,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConversationOrigin {
    Autonomous,
    Player { order_id: u64 },
    LegacyUnattributed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RequestPhase {
    Approaching,
    Waiting,
    Suspended,
    Talking,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WaitReason {
    Busy,
    Work,
    Privacy,
    NoRoute,
    Queued,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConversationRequest {
    pub id: u64,
    pub initiator: Entity,
    pub recipient: Entity,
    pub interaction: u32,
    pub origin: ConversationOrigin,
    pub created: u64,
    pub phase: RequestPhase,
    pub waiting_tile: Option<(i32, i32)>,
}
#[derive(Component)]
pub struct CommittedConversation(pub(crate) u64);
#[derive(Resource, Default, Clone)]
pub struct ConversationRequests {
    pub(crate) next_id: u64,
    pub(crate) requests: BTreeMap<u64, ConversationRequest>,
    pub(crate) reasons: BTreeMap<u64, WaitReason>,
    pub(crate) delays: BTreeMap<Entity, Option<u32>>,
}

impl ConversationRequests {
    pub(crate) fn outgoing(&self, person: Entity) -> Option<&ConversationRequest> {
        self.requests
            .values()
            .filter(|r| r.initiator == person && r.phase != RequestPhase::Suspended)
            .min_by_key(|r| (r.created, r.id))
    }
    pub(crate) fn owns(&self, person: Entity, target: Target) -> bool {
        self.outgoing(person)
            .is_some_and(|r| r.recipient == target.object && r.interaction == target.interaction)
    }
    pub(crate) fn admitted(&self, person: Entity, recipient: Entity) -> bool {
        self.outgoing(person).is_some_and(|r| {
            r.recipient == recipient
                && matches!(r.phase, RequestPhase::Approaching | RequestPhase::Talking)
        })
    }
    pub(crate) fn finish(
        &mut self,
        person: Entity,
        partner: Entity,
        interaction: u32,
    ) -> Option<ConversationOrigin> {
        let id = self
            .requests
            .values()
            .find(|r| {
                r.initiator == person
                    && r.recipient == partner
                    && r.interaction == interaction
                    && r.phase == RequestPhase::Talking
            })?
            .id;
        self.reasons.remove(&id);
        self.requests.remove(&id).map(|r| r.origin)
    }
}

/// Published request records mirror player executions for frozen-save compatibility.
/// The player scheduler is the only authority for these records' physical claims.
pub(crate) fn managed_player(world: &World, r: &ConversationRequest) -> bool {
    matches!(r.origin, ConversationOrigin::Player { order_id }
        if world.get_resource::<crate::player_actions::PlayerActions>()
            .is_some_and(|actions| actions.orders.contains_key(&(r.initiator, order_id))))
}

pub(crate) fn owns_autonomous_target(world: &World, person: Entity, target: Target) -> bool {
    world
        .get_resource::<ConversationRequests>()
        .is_some_and(|state| {
            state.requests.values().any(|r| {
                r.initiator == person
                    && r.recipient == target.object
                    && r.interaction == target.interaction
                    && !managed_player(world, r)
                    && owns_physical(world, r)
            })
        })
}

fn mirror_players(world: &World, state: &mut ConversationRequests) {
    let Some(episodes) = world.get_resource::<super::SocialEpisodes>() else {
        return;
    };
    if let Some(actions) = world.get_resource::<crate::player_actions::PlayerActions>() {
        let mut orders: Vec<_> = actions.orders.iter().collect();
        orders.sort_by_key(|(_, order)| order.acceptance);
        for (&(actor, order_id), order) in orders {
            let intent = order.entry.intent;
            if world.get::<terri_core::SimId>(actor).is_none()
                || world.get::<terri_core::SimId>(intent.object).is_none()
                || intent.cleanup.is_some()
                || intent.chore.is_some()
                || world.get::<Agent>(intent.object).is_none()
                || world
                    .resource::<crate::Content>()
                    .0
                    .social
                    .get(intent.interaction as usize)
                    .is_none_or(crate::fights::is_fight)
                || state.requests.values().any(|r| {
                    r.initiator == actor && r.origin == ConversationOrigin::Player { order_id }
                })
            {
                continue;
            }
            let id = state.next_id;
            state.next_id = id.checked_add(1).expect("conversation identity exhausted");
            state.requests.insert(
                id,
                ConversationRequest {
                    id,
                    initiator: actor,
                    recipient: intent.object,
                    interaction: intent.interaction,
                    origin: ConversationOrigin::Player { order_id },
                    created: world.resource::<SimClock>().tick,
                    phase: RequestPhase::Suspended,
                    waiting_tile: None,
                },
            );
        }
    }
    for (&actor, execution) in &episodes.executions {
        if world.get::<terri_core::SimId>(actor).is_none()
            || world
                .get::<terri_core::SimId>(execution.recipient)
                .is_none()
        {
            continue;
        }
        let super::execution::ExecutionOwner::Player(order_id) = execution.owner else {
            continue;
        };
        let existing = state
            .requests
            .values()
            .find(|r| r.initiator == actor && r.origin == ConversationOrigin::Player { order_id })
            .map(|r| r.id);
        let id = existing.unwrap_or_else(|| {
            let id = state.next_id;
            state.next_id = id.checked_add(1).expect("conversation identity exhausted");
            id
        });
        let phase = match execution.phase {
            super::ExecutionPhase::Running => RequestPhase::Talking,
            super::ExecutionPhase::Approaching if execution.admitted => RequestPhase::Approaching,
            _ => RequestPhase::Waiting,
        };
        let created = state
            .requests
            .get(&id)
            .map_or(world.resource::<SimClock>().tick, |r| r.created);
        let waiting_tile = if phase == RequestPhase::Waiting {
            world
                .get::<Path>(actor)
                .and_then(|path| path.steps.last().copied())
                .or_else(|| world.get::<Position>(actor).map(|position| tile(*position)))
        } else {
            state.requests.get(&id).and_then(|r| r.waiting_tile)
        };
        state.requests.insert(
            id,
            ConversationRequest {
                id,
                initiator: actor,
                recipient: execution.recipient,
                interaction: execution.interaction,
                origin: ConversationOrigin::Player { order_id },
                created,
                phase,
                waiting_tile,
            },
        );
    }
    for r in state.requests.values_mut() {
        if managed_player(world, r)
            && !episodes.executions.get(&r.initiator).is_some_and(|e| {
                matches!(e.owner, super::execution::ExecutionOwner::Player(id)
                if r.origin == ConversationOrigin::Player { order_id: id })
            })
        {
            r.phase = RequestPhase::Suspended;
        }
    }
}

pub(crate) fn sync_players(world: &mut World) {
    let mut state = world.resource::<ConversationRequests>().clone();
    mirror_players(world, &mut state);
    world.insert_resource(state);
}

pub(crate) fn finish_player(world: &mut World, actor: Entity, order_id: u64) {
    let ids: Vec<_> = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .filter(|r| r.initiator == actor && r.origin == ConversationOrigin::Player { order_id })
        .map(|r| r.id)
        .collect();
    for id in ids {
        // Physical teardown belongs to the execution owner.
        let mut state = world.resource_mut::<ConversationRequests>();
        state.requests.remove(&id);
        state.reasons.remove(&id);
    }
}

fn tile(p: Position) -> (i32, i32) {
    (p.x.round() as i32, p.y.round() as i32)
}
pub(crate) fn request_target(r: &ConversationRequest) -> Target {
    Target {
        object: r.recipient,
        interaction: r.interaction,
    }
}
fn own_target(world: &World, r: &ConversationRequest) -> bool {
    owns_physical(world, r)
        && world
            .get::<Target>(r.initiator)
            .is_some_and(|t| t.object == r.recipient && t.interaction == r.interaction)
}
fn owns_physical(world: &World, r: &ConversationRequest) -> bool {
    r.phase != RequestPhase::Suspended
        && world
            .get::<CommittedConversation>(r.initiator)
            .is_some_and(|owner| owner.0 == r.id)
}
fn is_talking(world: &World, person: Entity) -> bool {
    conversation_remaining(world, person).is_some()
}

fn conversation_remaining(world: &World, person: Entity) -> Option<u32> {
    let owned = world.get::<Socialising>(person).map(|s| s.remaining_ticks);
    let received = world.try_query::<&Socialising>().and_then(|mut q| {
        q.iter(world)
            .filter(|s| s.partner == person)
            .map(|s| s.remaining_ticks)
            .max()
    });
    owned.into_iter().chain(received).max()
}
fn work(world: &World, person: Entity) -> bool {
    world.get::<AtWork>(person).is_some() || world.get::<Commuting>(person).is_some()
}

fn release_recipient(world: &mut World, r: &ConversationRequest) {
    if !owns_physical(world, r) {
        return;
    }
    let owns = world
        .resource::<super::SocialEpisodes>()
        .rendezvous
        .get(&r.recipient)
        == Some(&r.initiator);
    if owns {
        world
            .resource_mut::<super::SocialEpisodes>()
            .rendezvous
            .remove(&r.recipient);
        if !is_talking(world, r.recipient) {
            if let Ok(mut e) = world.get_entity_mut(r.recipient) {
                e.remove::<Reserved>();
            }
        }
    }
}
fn release_approach(world: &mut World, r: &ConversationRequest) {
    let owns_talk = owns_physical(world, r)
        && world
            .get::<Socialising>(r.initiator)
            .is_some_and(|s| s.partner == r.recipient && s.interaction == r.interaction);
    if owns_talk {
        world
            .entity_mut(r.initiator)
            .remove::<(Socialising, terri_core::ConversationVoice)>();
        world
            .resource_mut::<super::SocialEpisodes>()
            .topics
            .remove(&r.initiator);
    }
    if own_target(world, r) {
        world
            .entity_mut(r.initiator)
            .remove::<(Target, Path, Blocked)>();
    }
    release_recipient(world, r);
    if owns_talk
        && !is_talking(world, r.recipient)
        && !world
            .resource::<super::SocialEpisodes>()
            .rendezvous
            .contains_key(&r.recipient)
    {
        if let Ok(mut person) = world.get_entity_mut(r.recipient) {
            person.remove::<Reserved>();
        }
    }
}
pub(crate) fn cancel_request(world: &mut World, id: u64) {
    let Some(r) = world
        .resource_mut::<ConversationRequests>()
        .requests
        .remove(&id)
    else {
        return;
    };
    world
        .resource_mut::<ConversationRequests>()
        .reasons
        .remove(&id);
    release_approach(world, &r);
    if !world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .any(|q| q.initiator == r.initiator)
    {
        if let Ok(mut e) = world.get_entity_mut(r.initiator) {
            e.remove::<CommittedConversation>();
        }
    }
}
pub(crate) fn forget_person(world: &mut World, person: Entity) {
    let ids: Vec<_> = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .filter(|r| r.initiator == person || r.recipient == person)
        .map(|r| r.id)
        .collect();
    for id in ids {
        cancel_request(world, id);
    }
}
pub(crate) fn cancel_target(world: &mut World, person: Entity, t: Target) {
    let ids: Vec<_> = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .filter(|r| {
            r.initiator == person && r.recipient == t.object && r.interaction == t.interaction
        })
        .map(|r| r.id)
        .collect();
    for id in ids {
        cancel_request(world, id);
    }
}
/// A fresh front order redirects the listener without deleting the old initiator's request.
pub(crate) fn redirect_incoming(world: &mut World, recipient: Entity) {
    let physical: Vec<_> = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .filter(|request| {
            request.recipient == recipient
                && !managed_player(world, request)
                && matches!(
                    request.phase,
                    RequestPhase::Approaching | RequestPhase::Talking
                )
        })
        .cloned()
        .collect();
    for request in physical {
        suspend(world, &request);
    }
}

pub(crate) fn defer_incoming(world: &mut World, recipient: Entity) {
    let incoming: Vec<_> = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .filter(|r| {
            r.recipient == recipient
                && r.phase != RequestPhase::Talking
                && !managed_player(world, r)
        })
        .cloned()
        .collect();
    for r in incoming {
        release_recipient(world, &r);
        world
            .resource_mut::<ConversationRequests>()
            .requests
            .get_mut(&r.id)
            .unwrap()
            .phase = RequestPhase::Waiting;
    }
}

pub(crate) fn enqueue(
    world: &mut World,
    initiator: Entity,
    recipient: Entity,
    interaction: u32,
    origin: ConversationOrigin,
) -> Option<u64> {
    let pack = world.resource::<crate::Content>().0;
    if initiator == recipient
        || world.get::<Agent>(initiator).is_none()
        || world.get::<Agent>(recipient).is_none()
        || world.get::<terri_core::SimId>(initiator).is_none()
        || world.get::<terri_core::SimId>(recipient).is_none()
        || pack
            .social
            .get(interaction as usize)
            .is_none_or(crate::fights::is_fight)
    {
        return None;
    }
    let duplicate = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .find(|r| {
            (r.initiator == initiator
                && r.recipient == recipient
                && r.interaction == interaction
                && r.origin == origin)
                || (origin == ConversationOrigin::Autonomous
                    && r.initiator == recipient
                    && r.recipient == initiator
                    && r.interaction == interaction)
        })
        .map(|r| r.id);
    if duplicate.is_some() {
        return duplicate;
    }
    let next = world
        .resource::<ConversationRequests>()
        .next_id
        .checked_add(1)?;
    let old: Vec<_> = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .filter(|r| r.initiator == initiator)
        .map(|r| r.id)
        .collect();
    for id in old {
        let r = world.resource::<ConversationRequests>().requests[&id].clone();
        if matches!(r.origin,ConversationOrigin::Player{order_id} if world.get::<IntentQueue>(initiator).is_some_and(|q|q.order(order_id).is_some()))
        {
            release_approach(world, &r);
            world
                .resource_mut::<ConversationRequests>()
                .requests
                .get_mut(&id)
                .unwrap()
                .phase = RequestPhase::Suspended;
        } else {
            cancel_request(world, id);
        }
    }
    if let Some(old) = world.get::<Target>(initiator).copied() {
        crate::reservations::release_now(world, initiator, old);
    }
    crate::domestic::suspend_cleanup(world, initiator);
    let created = world.resource::<SimClock>().tick;
    let id = next - 1;
    let request = ConversationRequest {
        id,
        initiator,
        recipient,
        interaction,
        origin,
        created,
        phase: RequestPhase::Waiting,
        waiting_tile: None,
    };
    let mut state = world.resource_mut::<ConversationRequests>();
    state.next_id = next;
    state.requests.insert(id, request);
    world
        .entity_mut(initiator)
        .remove::<(
            Eating,
            Path,
            Socialising,
            terri_core::ConversationVoice,
            StepWork,
            terri_core::Fumbled,
            terri_core::SleepPlace,
            Wander,
            Restless,
        )>()
        .insert((
            CommittedConversation(id),
            Target {
                object: recipient,
                interaction,
            },
            Blocked,
        ));
    Some(id)
}

/// Derive the same legacy identity for read-only capture and live adoption.
fn legacy_requests(world: &World) -> Vec<ConversationRequest> {
    let state = world.resource::<ConversationRequests>();
    let mut missing = BTreeMap::new();
    for (&recipient, &initiator) in &world.resource::<super::SocialEpisodes>().rendezvous {
        if let Some(t) = world
            .get::<Target>(initiator)
            .filter(|t| t.object == recipient)
        {
            missing.insert(
                initiator,
                (recipient, t.interaction, RequestPhase::Approaching),
            );
        }
    }
    if let Some(mut query) = world.try_query::<(Entity, &Socialising)>() {
        for (initiator, s) in query.iter(world) {
            missing.insert(initiator, (s.partner, s.interaction, RequestPhase::Talking));
        }
    }
    let pack = world.resource::<crate::Content>().0;
    let mut next_id = state.next_id;
    let mut rows = Vec::new();
    for (initiator, (recipient, interaction, phase)) in missing {
        if world.get::<terri_core::SimId>(initiator).is_none()
            || world.get::<terri_core::SimId>(recipient).is_none()
            || pack
                .social
                .get(interaction as usize)
                .is_none_or(crate::fights::is_fight)
            || world
                .get_resource::<super::SocialEpisodes>()
                .is_some_and(|episodes| episodes.executions.contains_key(&initiator))
            || state.requests.values().any(|r| {
                r.initiator == initiator && r.recipient == recipient && r.interaction == interaction
            })
        {
            continue;
        }
        let id = next_id;
        let Some(next) = id.checked_add(1) else {
            break;
        };
        next_id = next;
        rows.push(ConversationRequest {
            id,
            initiator,
            recipient,
            interaction,
            origin: ConversationOrigin::LegacyUnattributed,
            created: world.resource::<SimClock>().tick,
            phase,
            waiting_tile: None,
        });
    }
    rows
}

/// Historical and low-level worlds can contain a chat without request metadata.
/// Project its identity without changing the clock or random generator.
pub(crate) fn snapshot(world: &World) -> ConversationRequests {
    let mut state = world.resource::<ConversationRequests>().clone();
    mirror_players(world, &mut state);
    for mut request in legacy_requests(world) {
        request.id = state.next_id;
        state.next_id = request.id + 1;
        state.requests.insert(request.id, request);
    }
    state
}

pub(crate) fn migrate_legacy(world: &mut World) {
    recover_legacy_approaches(world);
    let mut state = snapshot(world);
    recover_legacy_waiters(world, &mut state);
    world.insert_resource(state);
    refresh_markers(world);
}

/// Preserve historical intent without claiming another person's reservation.
fn recover_legacy_waiters(world: &World, state: &mut ConversationRequests) {
    let Some(mut query) = world.try_query::<(Entity, &terri_core::SimId, &Target)>() else {
        return;
    };
    let pack = world.resource::<crate::Content>().0;
    let active: BTreeSet<_> = state
        .requests
        .values()
        .filter(|request| request.phase != RequestPhase::Suspended)
        .map(|request| request.initiator)
        .collect();
    let represented: BTreeSet<_> = state
        .requests
        .values()
        .map(|request| (request.initiator, request.recipient, request.interaction))
        .collect();
    let mut missing: Vec<_> = query
        .iter(world)
        .filter(|(person, _, target)| {
            world.get::<Agent>(*person).is_some()
                && *person != target.object
                && world.get::<Agent>(target.object).is_some()
                && world.get::<terri_core::SimId>(target.object).is_some()
                && pack
                    .social
                    .get(target.interaction as usize)
                    .is_some_and(|action| !crate::fights::is_fight(action))
                && !world
                    .resource::<super::SocialEpisodes>()
                    .executions
                    .contains_key(person)
                && !active.contains(person)
                && !represented.contains(&(*person, target.object, target.interaction))
        })
        .map(|(person, id, target)| (id.0, person, *target))
        .collect();
    missing.sort_by_key(|(id, _, _)| *id);
    let created = world.resource::<SimClock>().tick;
    for (_, initiator, target) in missing {
        let id = state.next_id;
        let Some(next) = id.checked_add(1) else {
            break;
        };
        state.next_id = next;
        state.requests.insert(
            id,
            ConversationRequest {
                id,
                initiator,
                recipient: target.object,
                interaction: target.interaction,
                origin: ConversationOrigin::LegacyUnattributed,
                created,
                phase: RequestPhase::Waiting,
                waiting_tile: None,
            },
        );
    }
}

/// Older envelopes retain the physical reservation but omit rendezvous metadata.
/// Current-format ownership is validated before this adoption boundary.
fn recover_legacy_approaches(world: &mut World) {
    let pack = world.resource::<crate::Content>().0;
    let mut claims: BTreeMap<Entity, Vec<Entity>> = BTreeMap::new();
    for (initiator, target) in world
        .query_filtered::<(Entity, &Target), With<Agent>>()
        .iter(world)
    {
        if world.get::<terri_core::SimId>(initiator).is_none()
            || world.get::<terri_core::SimId>(target.object).is_none()
            || world.get::<Agent>(target.object).is_none()
            || world.get::<Reserved>(target.object).is_none()
            || world.get::<Socialising>(initiator).is_some()
            || is_talking(world, target.object)
            || pack
                .social
                .get(target.interaction as usize)
                .is_none_or(crate::fights::is_fight)
            || world
                .resource::<ConversationRequests>()
                .requests
                .values()
                .any(|request| {
                    request.initiator == initiator
                        && request.recipient == target.object
                        && request.interaction == target.interaction
                })
        {
            continue;
        }
        claims.entry(target.object).or_default().push(initiator);
    }
    for (recipient, owners) in claims {
        // Only a unique existing physical claim identifies the old approach.
        if let [initiator] = owners.as_slice() {
            world
                .resource_mut::<super::SocialEpisodes>()
                .rendezvous
                .entry(recipient)
                .or_insert(*initiator);
        }
    }
}

pub(crate) fn refresh_markers(world: &mut World) {
    let state = world.resource::<ConversationRequests>();
    let people: BTreeSet<_> = state
        .requests
        .values()
        .filter(|r| !managed_player(world, r))
        .map(|r| r.initiator)
        .collect();
    let owners: Vec<_> = people
        .into_iter()
        .map(|person| {
            let id = state
                .outgoing(person)
                .or_else(|| state.requests.values().find(|r| r.initiator == person))
                .unwrap()
                .id;
            (person, id)
        })
        .collect();
    let marked: Vec<_> = world
        .query_filtered::<Entity, With<CommittedConversation>>()
        .iter(world)
        .collect();
    for person in marked {
        if !owners.iter().any(|(owner, _)| *owner == person) {
            world.entity_mut(person).remove::<CommittedConversation>();
        }
    }
    for (person, id) in owners {
        world.entity_mut(person).insert(CommittedConversation(id));
    }
}

/// Import legacy claims using the same phases and identities as capture.
fn adopt_legacy(world: &mut World) {
    for request in legacy_requests(world) {
        let (id, initiator) = (request.id, request.initiator);
        let mut state = world.resource_mut::<ConversationRequests>();
        state.next_id = id + 1;
        state.requests.insert(id, request);
        world
            .entity_mut(initiator)
            .insert(CommittedConversation(id));
    }
}

pub(crate) fn maintain(world: &mut World) {
    adopt_legacy(world);
    let requests: Vec<_> = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .cloned()
        .collect();
    for r in requests {
        if managed_player(world, &r) {
            continue;
        }
        let invalid = world.get::<Agent>(r.initiator).is_none()
            || world.get::<Agent>(r.recipient).is_none()
            || matches!(r.origin,ConversationOrigin::Player{order_id} if world.get::<IntentQueue>(r.initiator).is_none_or(|q|q.order(order_id).is_none()));
        if invalid {
            cancel_request(world, r.id);
            continue;
        }
        if r.phase == RequestPhase::Talking
            && world
                .get::<Socialising>(r.initiator)
                .is_none_or(|s| s.partner != r.recipient || s.interaction != r.interaction)
        {
            world
                .resource_mut::<ConversationRequests>()
                .requests
                .get_mut(&r.id)
                .unwrap()
                .phase = RequestPhase::Waiting;
        }
        if r.origin == ConversationOrigin::Autonomous
            && !work(world, r.initiator)
            && world
                .get::<Target>(r.initiator)
                .is_some_and(|t| t.object != r.recipient || t.interaction != r.interaction)
        {
            cancel_request(world, r.id);
            continue;
        }
        if r.origin == ConversationOrigin::Autonomous
            && r.phase != RequestPhase::Talking
            && world
                .get::<terri_core::Needs>(r.initiator)
                .is_some_and(|needs| {
                    gives_up_chosen_chat(needs, &world.resource::<crate::Content>().0.tuning)
                })
        {
            cancel_request(world, r.id);
            continue;
        }
    }
    refresh_markers(world);
    let marked: Vec<_> = world
        .query_filtered::<Entity, With<CommittedConversation>>()
        .iter(world)
        .collect();
    for person in marked {
        if !world
            .resource::<ConversationRequests>()
            .requests
            .values()
            .any(|r| r.initiator == person && !managed_player(world, r))
        {
            world.entity_mut(person).remove::<CommittedConversation>();
        }
    }
}

/// A chat a housemate chose for themselves gives up while their own Hunger or
/// Energy is at or below the critical level (the owner's decision of
/// 2026-10-18). Selection also does not choose one then, even for critical
/// Social; the implementer proposed that exclusion and the owner confirmed
/// it on 2026-10-18. Player-ordered and `LegacyUnattributed` chats stay.
pub(crate) fn gives_up_chosen_chat(needs: &terri_core::Needs, tuning: &terri_data::Tuning) -> bool {
    [terri_core::NeedId::Hunger, terri_core::NeedId::Energy]
        .into_iter()
        .any(|need| needs.get(need) <= tuning.mood_critical_need_level)
}

fn busy(world: &World, person: Entity) -> bool {
    if world
        .get::<Target>(person)
        .is_some_and(|t| world.resource::<ConversationRequests>().owns(person, *t))
        && world.get::<Eating>(person).is_none()
        && world
            .get::<crate::reading::ReadingJourney>(person)
            .is_none()
    {
        return false;
    }
    world.get::<Eating>(person).is_some()
        || world.get::<ChainState>(person).is_some()
        || world
            .get::<crate::reading::ReadingJourney>(person)
            .is_some()
        || world.get::<terri_core::chores::ChoreWork>(person).is_some()
        || world.get::<crate::reading::PendingShift>(person).is_some()
        || world
            .get::<Target>(person)
            .is_some_and(|t| !world.resource::<ConversationRequests>().owns(person, *t))
        || (world.get::<Path>(person).is_some()
            && world
                .resource::<ConversationRequests>()
                .outgoing(person)
                .is_none()
            && world.get::<Wander>(person).is_none())
}

pub(crate) fn remaining(world: &World, person: Entity) -> Option<u32> {
    if work(world, person) {
        return None;
    }
    if let Some(remaining) = conversation_remaining(world, person) {
        return Some(remaining);
    }
    let travel = world.get::<Path>(person).map_or(0, |p| {
        (p.steps.len().saturating_sub(p.cursor) as u32).saturating_mul(4)
    });
    if let Some(chain) = world.get::<ChainState>(person) {
        let pack = world.resource::<crate::Content>().0;
        let c = pack.chains.get(chain.chain as usize)?;
        let work = world
            .get::<StepWork>(person)
            .map_or(c.steps.get(chain.step as usize)?.duration_ticks, |s| {
                s.remaining_ticks
            });
        return Some(
            c.steps
                .iter()
                .skip(chain.step as usize + 1)
                .fold(work, |n, s| n.saturating_add(s.duration_ticks))
                .saturating_add(travel),
        );
    }
    if let Some(journey) = world.get::<crate::reading::ReadingJourney>(person) {
        let tuning = world.resource::<crate::Content>().0.reading.as_ref()?;
        return Some(
            travel
                .saturating_add(tuning.session_ticks.saturating_sub(journey.elapsed))
                .saturating_add(journey.reach_remaining)
                .saturating_add(tuning.shelve_ticks),
        );
    }
    let active = world
        .get::<Eating>(person)
        .map(|e| e.remaining_ticks)
        .or_else(|| world.get::<Socialising>(person).map(|s| s.remaining_ticks))
        .or_else(|| {
            let target = world.get::<Target>(person)?;
            let object = world.get::<terri_core::SmartObject>(target.object)?;
            world
                .resource::<crate::Content>()
                .0
                .object(object.0)
                .interactions
                .get(target.interaction as usize)
                .map(|a| a.duration_ticks)
        });
    Some(travel.saturating_add(active.unwrap_or(0)))
}

fn suspend(world: &mut World, r: &ConversationRequest) {
    release_approach(world, r);
    if let Some(live) = world
        .resource_mut::<ConversationRequests>()
        .requests
        .get_mut(&r.id)
    {
        live.phase = RequestPhase::Suspended;
    }
}

/// The autonomous chat a person is doing nothing but wait for: it owns their
/// target, the recipient has not admitted it, and no meal, journey, chain,
/// chore or conversation of theirs is under way.
pub(crate) fn only_waiting(world: &World, person: Entity) -> Option<u64> {
    let request = world
        .get_resource::<ConversationRequests>()?
        .outgoing(person)?;
    (request.phase == RequestPhase::Waiting
        && !managed_player(world, request)
        && own_target(world, request)
        && world.get::<Eating>(person).is_none()
        && world.get::<ChainState>(person).is_none()
        && world
            .get::<crate::reading::ReadingJourney>(person)
            .is_none()
        && world.get::<terri_core::chores::ChoreWork>(person).is_none()
        && !is_talking(world, person))
    .then_some(request.id)
}

/// Issue 301: a pending chat must not hold its own initiator hostage. An
/// order admitted to that person suspends the chat, which keeps its age and
/// resumes once the order's conversation releases them.
pub(crate) fn yield_waiting(world: &mut World, person: Entity) -> bool {
    let Some(id) = only_waiting(world, person) else {
        return false;
    };
    let request = world.resource::<ConversationRequests>().requests[&id].clone();
    suspend(world, &request);
    true
}

pub(crate) fn before_choices(world: &mut World) {
    maintain(world);
    process(world, false);
    let people: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    let delays = people
        .into_iter()
        .map(|p| (p, remaining(world, p)))
        .collect();
    world.resource_mut::<ConversationRequests>().delays = delays;
}
pub(crate) fn before_movement(world: &mut World) {
    maintain(world);
    process(world, true);
}

fn process(world: &mut World, routes: bool) {
    route_cache::prune(world);
    let mut requests: Vec<_> = world
        .resource::<ConversationRequests>()
        .requests
        .values()
        .cloned()
        .collect();
    requests.sort_by_key(|r| (r.created, r.id));
    let mut occupied = BTreeSet::new();
    for (owner, talk) in world.query::<(Entity, &Socialising)>().iter(world) {
        occupied.insert(owner);
        occupied.insert(talk.partner);
    }
    for (&actor, execution) in &world.resource::<super::SocialEpisodes>().executions {
        occupied.insert(actor);
        if execution.admitted || execution.phase == super::ExecutionPhase::Running {
            occupied.insert(execution.recipient);
        }
    }
    let elected = world.resource::<super::SocialEpisodes>().incoming.clone();
    let mut recipients = BTreeSet::new();
    for mut r in requests {
        if managed_player(world, &r) {
            continue;
        }
        if !world
            .resource::<ConversationRequests>()
            .requests
            .contains_key(&r.id)
            || r.phase == RequestPhase::Talking
        {
            continue;
        }
        let player_wait = match r.origin {
            ConversationOrigin::Player { order_id } => world
                .get::<IntentQueue>(r.initiator)
                .is_none_or(|q| q.entries().first().is_none_or(|e| e.id != order_id)),
            _ => false,
        };
        if work(world, r.initiator)
            || occupied.contains(&r.initiator)
            || player_wait
            || busy(world, r.initiator)
        {
            suspend(world, &r);
            continue;
        }
        if !own_target(world, &r) {
            world
                .entity_mut(r.initiator)
                .insert((CommittedConversation(r.id), request_target(&r)));
        }
        let first = !recipients.contains(&r.recipient);
        let receiver_work = work(world, r.recipient);
        let later_player_choice = world
            .resource::<ConversationRequests>()
            .outgoing(r.recipient)
            .is_some_and(|other| {
                other.recipient != r.initiator
                    && matches!(other.origin, ConversationOrigin::Player { .. })
                    && other.created > r.created
            });
        let reserved_elsewhere = world.get::<Reserved>(r.recipient).is_some()
            && world
                .resource::<super::SocialEpisodes>()
                .rendezvous
                .get(&r.recipient)
                != Some(&r.initiator);
        let receiver_busy = elected
            .get(&r.recipient)
            .is_some_and(|owner| *owner != r.initiator)
            || busy(world, r.recipient)
            || occupied.contains(&r.recipient)
            || !first
            || later_player_choice
            || reserved_elsewhere;
        let ready = !receiver_work && !receiver_busy;
        let plan = (!receiver_work).then(|| route_cache::plan(world, &r, ready));
        // A failed route retains the request but cannot hold the recipient or
        // win the per-pass recipient slot ahead of a reachable conversation.
        if plan.as_ref().is_some_and(Result::is_err) {
            release_recipient(world, &r);
            r.phase = RequestPhase::Waiting;
            world
                .resource_mut::<ConversationRequests>()
                .reasons
                .insert(r.id, WaitReason::NoRoute);
            world
                .entity_mut(r.initiator)
                .remove::<Path>()
                .insert(Blocked);
            world
                .resource_mut::<ConversationRequests>()
                .requests
                .insert(r.id, r);
            continue;
        }
        // Pending requests cannot displace a different approach that already
        // owns this recipient, even when their old staging tile is reachable.
        if !reserved_elsewhere {
            recipients.insert(r.recipient);
        }
        if ready {
            if let Some(outgoing) = world
                .resource::<ConversationRequests>()
                .outgoing(r.recipient)
                .cloned()
            {
                suspend(world, &outgoing);
            }
            world
                .resource_mut::<super::SocialEpisodes>()
                .rendezvous
                .insert(r.recipient, r.initiator);
            world
                .entity_mut(r.recipient)
                .remove::<(Wander, Restless, Path)>()
                .insert(Reserved);
            occupied.insert(r.initiator);
            occupied.insert(r.recipient);
            r.phase = RequestPhase::Approaching;
            world
                .resource_mut::<ConversationRequests>()
                .reasons
                .remove(&r.id);
        } else {
            release_recipient(world, &r);
            r.phase = RequestPhase::Waiting;
            world.resource_mut::<ConversationRequests>().reasons.insert(
                r.id,
                if receiver_work {
                    WaitReason::Work
                } else if !first {
                    WaitReason::Queued
                } else {
                    WaitReason::Busy
                },
            );
        }
        world
            .resource_mut::<ConversationRequests>()
            .requests
            .insert(r.id, r.clone());
        if !routes {
            continue;
        }
        if receiver_work {
            world
                .entity_mut(r.initiator)
                .remove::<Path>()
                .insert(Blocked);
            continue;
        }
        route(
            world,
            &mut r,
            ready,
            plan.expect("a present recipient has a route plan"),
        );
        world
            .resource_mut::<ConversationRequests>()
            .requests
            .insert(r.id, r);
    }
}

fn private_room(
    world: &World,
    recipient: Entity,
    rooms: &crate::room_regions::RoomRegions,
) -> Option<u32> {
    let t = world.get::<Target>(recipient)?;
    let o = world.get::<terri_core::SmartObject>(t.object)?;
    let act = world
        .resource::<crate::Content>()
        .0
        .object(o.0)
        .interactions
        .get(t.interaction as usize)?;
    act.tags
        .iter()
        .any(|t| t == crate::systems::interpersonal::PRIVATE_USE_TAG)
        .then(|| rooms.at(tile(*world.get::<Position>(t.object)?)))
        .flatten()
}

struct RoutePlan {
    destination: (i32, i32),
    steps: Vec<(i32, i32)>,
    private: bool,
}

/// Player approaches use the same privacy snapshot and staging rules as autonomy.
pub(crate) fn player_route(
    world: &World,
    actor: Entity,
    recipient: Entity,
) -> Option<Vec<(i32, i32)>> {
    let ready = world.get::<Target>(recipient).is_none()
        && world.get::<Path>(recipient).is_none()
        && world.get::<Eating>(recipient).is_none()
        && !crate::recipe_actions::foreground(world, recipient)
        && world
            .get::<crate::reading::ReadingJourney>(recipient)
            .is_none()
        && world
            .get::<terri_core::chores::ChoreWork>(recipient)
            .is_none()
        && !is_talking(world, recipient);
    let request = ConversationRequest {
        id: 0,
        initiator: actor,
        recipient,
        interaction: 0,
        origin: ConversationOrigin::LegacyUnattributed,
        created: 0,
        phase: RequestPhase::Waiting,
        waiting_tile: None,
    };
    plan_route(world, &request, ready)
        .ok()
        .map(|plan| plan.steps)
}

fn plan_route(
    world: &World,
    r: &ConversationRequest,
    ready: bool,
) -> Result<RoutePlan, WaitReason> {
    let navigation = crate::systems::interpersonal::PrivacyNavigation::capture(world, r.initiator);
    plan_route_with_navigation(world, r, ready, &navigation)
}

fn plan_route_with_navigation(
    world: &World,
    r: &ConversationRequest,
    ready: bool,
    navigation: &crate::systems::interpersonal::PrivacyNavigation,
) -> Result<RoutePlan, WaitReason> {
    let pos = world
        .get::<Position>(r.initiator)
        .copied()
        .ok_or(WaitReason::NoRoute)?;
    let recipient = world
        .get::<Position>(r.recipient)
        .copied()
        .ok_or(WaitReason::NoRoute)?;
    let grid = world.resource::<TileGrid>();
    let rooms = navigation.rooms();
    let private = if ready {
        None
    } else {
        private_room(world, r.recipient, rooms)
    };
    let mut safe = navigation.safe_grid(grid);
    let from = tile(pos);
    if let Some(room) = private {
        if rooms.at(from) != Some(room) {
            for y in 0..grid.height() {
                for x in 0..grid.width() {
                    if rooms.at((x as i32, y as i32)) == Some(room) {
                        safe.set_blocked(x, y, true);
                    }
                }
            }
        }
    }
    let receiver_destination = world
        .get::<Path>(r.recipient)
        .and_then(|p| p.steps.last().copied())
        .unwrap_or(tile(recipient));
    let destination = if ready {
        safe.find_path_adjacent_to_tile(from, tile(recipient))
            .map(|s| s.last().copied().unwrap_or(from))
    } else if r.waiting_tile.is_some_and(|t| {
        safe.is_walkable(t.0, t.1) && private.is_none_or(|room| rooms.at(t) != Some(room))
    }) {
        r.waiting_tile
    } else if let Some(room) = private {
        let mut candidates = Vec::new();
        for y in 0..grid.height() as i32 {
            for x in 0..grid.width() as i32 {
                let t = (x, y);
                if !safe.is_walkable(x, y) || rooms.at(t) == Some(room) {
                    continue;
                }
                if ![(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
                    .iter()
                    .any(|n| rooms.at(*n) == Some(room) && grid.can_cross(t, *n))
                {
                    continue;
                }
                if let Some(path) = safe.find_path(from, t) {
                    candidates.push((path.len(), y, x));
                }
            }
        }
        candidates.sort();
        candidates.first().map(|(_, y, x)| (*x, *y))
    } else {
        safe.find_path_adjacent_to_tile(from, receiver_destination)
            .map(|p| p.last().copied().unwrap_or(from))
    };
    let destination = destination.ok_or(WaitReason::NoRoute)?;
    let steps = safe
        .find_path(from, destination)
        .and_then(|p| safe.anchor_path((pos.x, pos.y), p))
        .ok_or(WaitReason::NoRoute)?;
    Ok(RoutePlan {
        destination,
        steps,
        private: private.is_some(),
    })
}

fn route(
    world: &mut World,
    r: &mut ConversationRequest,
    ready: bool,
    plan: Result<RoutePlan, WaitReason>,
) {
    let plan = match plan {
        Ok(plan) => plan,
        Err(reason) => {
            world
                .entity_mut(r.initiator)
                .remove::<Path>()
                .insert(Blocked);
            world
                .resource_mut::<ConversationRequests>()
                .reasons
                .insert(r.id, reason);
            return;
        }
    };
    let RoutePlan {
        destination,
        steps,
        private,
    } = plan;
    if private {
        world
            .resource_mut::<ConversationRequests>()
            .reasons
            .insert(r.id, WaitReason::Privacy);
    }
    let pos = *world
        .get::<Position>(r.initiator)
        .expect("planned initiator position");
    let current_path = world.get::<Path>(r.initiator);
    if current_path.is_some_and(|p| p.steps.last() == Some(&destination)) {
        return;
    }
    // Finish a real fractional segment before changing an otherwise valid route.
    if (pos.x != pos.x.round() || pos.y != pos.y.round())
        && current_path.is_some_and(|p| p.next_step().is_some())
    {
        return;
    }
    if !ready {
        r.waiting_tile = Some(destination);
    }
    if steps.is_empty() && !ready {
        world
            .entity_mut(r.initiator)
            .remove::<Path>()
            .insert(Blocked);
    } else {
        world
            .entity_mut(r.initiator)
            .remove::<Blocked>()
            .insert(Path { steps, cursor: 0 });
    }
}

pub(crate) fn started(world: &mut World, initiator: Entity, recipient: Entity) {
    let mut requests = world.resource_mut::<ConversationRequests>();
    if let Some(r) = requests.requests.values_mut().find(|r| {
        r.initiator == initiator && r.recipient == recipient && r.phase == RequestPhase::Approaching
    }) {
        r.phase = RequestPhase::Talking;
    }
}

pub(crate) fn status(world: &World, person: Entity) -> Option<(Entity, WaitReason)> {
    let state = world.resource::<ConversationRequests>();
    let request = state
        .outgoing(person)
        .filter(|r| r.phase != RequestPhase::Talking)?;
    Some((
        request.recipient,
        state.reasons.get(&request.id).copied().unwrap_or_else(|| {
            if work(world, request.recipient) {
                WaitReason::Work
            } else {
                match plan_route(world, request, request.phase == RequestPhase::Approaching) {
                    Err(reason) => reason,
                    Ok(plan) if plan.private => WaitReason::Privacy,
                    Ok(_) => WaitReason::Busy,
                }
            }
        }),
    ))
}
