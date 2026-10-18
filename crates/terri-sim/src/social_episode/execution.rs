//! Durable requests and temporary physical conversation ownership are separate.
use super::SocialEpisodes;
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{Agent, IntentQueue, Path, Position, Reserved, Socialising, Target};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExecutionOwner {
    Player(u64),
    Autonomous,
    System(Option<u64>),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExecutionPhase {
    Approaching,
    Running,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Execution {
    pub recipient: Entity,
    pub interaction: u32,
    pub owner: ExecutionOwner,
    pub phase: ExecutionPhase,
    pub admitted: bool,
}

pub(crate) fn execution_order(world: &World, actor: Entity) -> Option<u64> {
    match world
        .resource::<SocialEpisodes>()
        .executions
        .get(&actor)?
        .owner
    {
        ExecutionOwner::Player(id) => Some(id),
        _ => None,
    }
}

pub(crate) fn request_order_id(world: &World, actor: Entity) -> Option<u64> {
    match world
        .get_resource::<SocialEpisodes>()?
        .executions
        .get(&actor)?
        .owner
    {
        ExecutionOwner::Player(id) | ExecutionOwner::System(Some(id)) => Some(id),
        _ => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ParticipantRole {
    Available,
    Initiator,
    Recipient,
}
struct ParticipantPlan {
    roles: BTreeMap<Entity, ParticipantRole>,
    incoming: BTreeMap<Entity, Entity>,
    retained_recipients: BTreeSet<Entity>,
}
impl ParticipantPlan {
    fn available(&self, person: Entity) -> bool {
        self.roles.get(&person) == Some(&ParticipantRole::Available)
    }
    fn is_recipient(&self, person: Entity) -> bool {
        matches!(self.roles.get(&person), Some(ParticipantRole::Recipient))
    }
    fn select(&mut self, initiator: Entity, recipient: Entity) {
        assert!(
            self.available(initiator) && self.available(recipient),
            "selected conversations cannot share a participant"
        );
        self.roles.insert(initiator, ParticipantRole::Initiator);
        self.roles.insert(recipient, ParticipantRole::Recipient);
        self.incoming.insert(recipient, initiator);
    }
}

fn target(execution: Execution) -> Target {
    Target {
        object: execution.recipient,
        interaction: execution.interaction,
    }
}
pub(super) fn owns_target(world: &World, actor: Entity, execution: Execution) -> bool {
    world.get::<Target>(actor) == Some(&target(execution))
}
fn front(world: &World, actor: Entity) -> Option<u64> {
    let id = world.get::<crate::player_actions::FrontOrder>(actor)?.0;
    world
        .get::<IntentQueue>(actor)?
        .entries()
        .first()
        .filter(|entry| entry.id == id)
        .map(|_| id)
}
fn explicit_social_front(world: &World, actor: Entity) -> bool {
    front(world, actor).is_some()
        && world
            .get::<IntentQueue>(actor)
            .and_then(|q| q.entries().first())
            .is_some_and(|entry| world.get::<Agent>(entry.intent.object).is_some())
}
fn can_redirect_ordinary(world: &World, actor: Entity) -> bool {
    world
        .get::<crate::player_actions::ServedOrder>(actor)
        .is_none()
        && world.get::<terri_core::ChainState>(actor).is_none()
        && world.get::<crate::reading::ReadingJourney>(actor).is_none()
        && world.get::<terri_core::chores::ChoreWork>(actor).is_none()
        && world.get::<Target>(actor).is_some_and(|target| {
            world
                .get::<terri_core::SmartObject>(target.object)
                .is_some()
        })
}

fn can_suspend_autonomous_recipe(world: &World, actor: Entity, candidate: u64) -> bool {
    world.get::<terri_core::ChainState>(actor).is_some()
        && world.get::<crate::recipe_actions::Origin>(actor).is_some()
        && world
            .get::<crate::recipe_actions::RecipeOrder>(actor)
            .is_none()
        && world
            .get::<crate::player_actions::DirectedMealOrder>(actor)
            .is_none()
        && world
            .get::<crate::player_actions::ServedOrder>(actor)
            .is_none()
        && world.get::<crate::reading::ReadingJourney>(actor).is_none()
        && world.get::<terri_core::chores::ChoreWork>(actor).is_none()
        && world.get::<terri_core::AtWork>(actor).is_none()
        && world.get::<terri_core::Commuting>(actor).is_none()
        && world.get::<Socialising>(actor).is_none()
        && world
            .get::<Target>(actor)
            .is_none_or(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
        && world
            .get_resource::<crate::player_actions::PlayerActions>()
            .is_none_or(|actions| {
                !actions
                    .orders
                    .iter()
                    .any(|((owner, id), state)| *owner == actor && *id != candidate && state.active)
            })
        && world
            .get_resource::<terri_core::chores::SavedChores>()
            .is_none_or(|chores| {
                !chores
                    .tasks
                    .iter()
                    .any(|task| task.person == actor.index_u32() && !task.suspended)
            })
}
fn occupied(world: &mut World, actor: Entity) -> bool {
    world.get::<Target>(actor).is_some()
        || world.get::<Path>(actor).is_some()
        || world.get::<terri_core::Eating>(actor).is_some()
        || world.get::<Socialising>(actor).is_some()
        || crate::recipe_actions::foreground(world, actor)
        || world.get::<crate::reading::ReadingJourney>(actor).is_some()
        || world.get::<terri_core::chores::ChoreWork>(actor).is_some()
        || world.get::<terri_core::AtWork>(actor).is_some()
        || world.get::<terri_core::Commuting>(actor).is_some()
        || world
            .get_resource::<terri_core::chores::SavedChores>()
            .is_some_and(|s| {
                s.tasks
                    .iter()
                    .any(|t| t.person == actor.index_u32() && !t.suspended)
            })
        || world
            .query::<&Socialising>()
            .iter(world)
            .any(|s| s.partner == actor)
}
fn detach(world: &mut World, actor: Entity, remove_activity: bool) {
    let Some(execution) = world
        .resource_mut::<SocialEpisodes>()
        .executions
        .remove(&actor)
    else {
        return;
    };
    if let ExecutionOwner::Player(id) = execution.owner {
        if front(world, actor) == Some(id) {
            world
                .entity_mut(actor)
                .remove::<crate::player_actions::FrontOrder>();
        }
    }
    let physical = world
        .resource::<SocialEpisodes>()
        .rendezvous
        .get(&execution.recipient)
        == Some(&actor);
    if physical {
        world
            .resource_mut::<SocialEpisodes>()
            .rendezvous
            .remove(&execution.recipient);
    }
    if remove_activity && owns_target(world, actor, execution) {
        world.entity_mut(actor).remove::<(
            Target,
            Path,
            Socialising,
            terri_core::ConversationVoice,
            terri_core::Blocked,
        )>();
    }
    let another = world
        .resource::<SocialEpisodes>()
        .executions
        .values()
        .any(|e| e.recipient == execution.recipient && e.admitted);
    if execution.admitted && !another {
        if let Ok(mut person) = world.get_entity_mut(execution.recipient) {
            person.remove::<Reserved>();
        }
    }
}
pub(crate) fn redirect_recipient(world: &mut World, recipient: Entity) {
    let owners: Vec<_> = world
        .resource::<SocialEpisodes>()
        .executions
        .iter()
        .filter(|(_, e)| e.recipient == recipient)
        .map(|(&i, _)| i)
        .collect();
    for owner in owners {
        detach(world, owner, true);
    }
}
pub(crate) fn forget_person(world: &mut World, person: Entity) {
    redirect_recipient(world, person);
    detach(world, person, true);
}
pub(crate) fn release_order(world: &mut World, actor: Entity, id: u64) {
    let owned = world.resource::<SocialEpisodes>().executions.get(&actor).is_some_and(|execution| {
        matches!(execution.owner,ExecutionOwner::Player(owner) | ExecutionOwner::System(Some(owner)) if owner == id)
    });
    if owned {
        detach(world, actor, true);
    }
}

pub(crate) fn complete_execution(world: &mut World, actor: Entity) {
    let owner = world
        .resource::<SocialEpisodes>()
        .executions
        .get(&actor)
        .map(|e| e.owner);
    detach(world, actor, false);
    match owner {
        Some(ExecutionOwner::Player(id)) => {
            crate::player_actions::terminal(world, actor, id, "completed", None)
        }
        Some(ExecutionOwner::System(Some(id))) => {
            if let Some(mut q) = world.get_mut::<IntentQueue>(actor) {
                q.remove_order(id);
            }
        }
        _ => {}
    }
}

/// Both producers call this after their same-tick availability checks.
fn commit(world: &mut World, actor: Entity, execution: Execution, steps: Vec<(i32, i32)>) {
    world
        .entity_mut(actor)
        .remove::<(
            terri_core::Wander,
            terri_core::Restless,
            terri_core::Blocked,
        )>()
        .insert((target(execution), Path { steps, cursor: 0 }));
    if execution.admitted {
        world
            .entity_mut(execution.recipient)
            .remove::<(terri_core::Wander, terri_core::Restless)>()
            .insert(Reserved);
        world
            .resource_mut::<SocialEpisodes>()
            .rendezvous
            .insert(execution.recipient, actor);
    }
    world
        .resource_mut::<SocialEpisodes>()
        .executions
        .insert(actor, execution);
}
pub(crate) fn commit_autonomous(
    world: &mut World,
    actor: Entity,
    recipient: Entity,
    interaction: u32,
    steps: Vec<(i32, i32)>,
) {
    if actor == recipient
        || world.get::<Reserved>(recipient).is_some()
        || occupied(world, recipient)
    {
        return;
    }
    let owner = if world
        .resource::<crate::Content>()
        .0
        .social
        .get(interaction as usize)
        .is_some_and(crate::fights::is_fight)
    {
        ExecutionOwner::System(None)
    } else {
        ExecutionOwner::Autonomous
    };
    commit(
        world,
        actor,
        Execution {
            recipient,
            interaction,
            owner,
            phase: ExecutionPhase::Approaching,
            admitted: true,
        },
        steps,
    );
}

fn route(world: &World, actor: Entity, recipient: Entity) -> Option<Vec<(i32, i32)>> {
    let from = world.get::<Position>(actor)?;
    let to = world.get::<Position>(recipient)?;
    let grid = world.resource::<terri_core::TileGrid>();
    grid.find_path_adjacent_to_tile(
        (from.x.round() as i32, from.y.round() as i32),
        (to.x.round() as i32, to.y.round() as i32),
    )
    .and_then(|steps| grid.anchor_path((from.x, from.y), steps))
}
fn keep_route(world: &World, actor: Entity, recipient: Entity) -> bool {
    let Some(from) = world.get::<Position>(actor) else {
        return false;
    };
    let Some(to) = world.get::<Position>(recipient) else {
        return false;
    };
    let endpoint = world
        .get::<Path>(actor)
        .and_then(|p| p.steps.last().copied())
        .unwrap_or((from.x.round() as i32, from.y.round() as i32));
    world
        .resource::<terri_core::TileGrid>()
        .can_interact_with_rect(
            endpoint,
            (to.x.round() as i32, to.y.round() as i32),
            terri_core::Footprint::SINGLE,
        )
}

pub(crate) fn maintain(world: &mut World) {
    adopt_unowned_physical(world);
    reconcile_executions(world);
    let requests = eligible_requests(world);
    let plan = elect_incoming(world, &requests);
    yield_to_incoming(world, &plan);
    for (actor, entry) in requests {
        prepare_request(world, actor, entry, &plan);
    }
}

fn adopt_unowned_physical(world: &mut World) {
    // Legacy saves and low-level fixtures have physical state without the companion owner.
    let legacy: Vec<_> = world
        .query::<(Entity, &Target)>()
        .iter(world)
        .filter(|(actor, t)| {
            world.get::<Agent>(t.object).is_some()
                && !world
                    .resource::<SocialEpisodes>()
                    .executions
                    .contains_key(actor)
        })
        .map(|(a, t)| (a, *t))
        .collect();
    for (actor, t) in legacy {
        let running = world.get::<Socialising>(actor).is_some();
        let admitted = running
            || world.resource::<SocialEpisodes>().rendezvous.get(&t.object) == Some(&actor)
            || world.get::<Reserved>(t.object).is_some();
        let system = world
            .resource::<crate::Content>()
            .0
            .social
            .get(t.interaction as usize)
            .is_some_and(crate::fights::is_fight);
        world.resource_mut::<SocialEpisodes>().executions.insert(
            actor,
            Execution {
                recipient: t.object,
                interaction: t.interaction,
                owner: if system {
                    ExecutionOwner::System(None)
                } else {
                    ExecutionOwner::Autonomous
                },
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

fn reconcile_executions(world: &mut World) {
    let old: Vec<_> = world
        .resource::<SocialEpisodes>()
        .executions
        .iter()
        .map(|(&a, &e)| (a, e))
        .collect();
    for (actor, execution) in old {
        let request_gone = match execution.owner {
            ExecutionOwner::Player(id) | ExecutionOwner::System(Some(id)) => world
                .get::<IntentQueue>(actor)
                .is_none_or(|q| q.order(id).is_none()),
            _ => false,
        };
        let redirect = front(world, actor)
            .is_some_and(|id| execution.owner != ExecutionOwner::Player(id))
            && (execution.phase == ExecutionPhase::Approaching
                || explicit_social_front(world, actor));
        let recipient_redirect = explicit_social_front(world, execution.recipient);
        if !owns_target(world, actor, execution)
            || request_gone
            || redirect
            || recipient_redirect
            || world.get::<Agent>(execution.recipient).is_none()
        {
            detach(world, actor, true);
        }
    }
}

fn eligible_requests(world: &mut World) -> Vec<(Entity, terri_core::components::QueuedOrder)> {
    let mut requests: Vec<_> = world
        .query::<(Entity, &IntentQueue)>()
        .iter(world)
        .filter_map(|(actor, q)| q.entries().first().map(|e| (actor, e.clone())))
        .filter(|(a, e)| {
            *a != e.intent.object
                && e.intent.cleanup.is_none()
                && e.intent.chore.is_none()
                && world.get::<Agent>(e.intent.object).is_some()
                && world
                    .resource::<crate::Content>()
                    .0
                    .social
                    .get(e.intent.interaction as usize)
                    .is_some()
        })
        .collect();
    requests.retain(|(actor, entry)| {
        let execution = world
            .resource::<SocialEpisodes>()
            .executions
            .get(actor)
            .copied();
        if let Some(e) = execution {
            return e.owner == ExecutionOwner::Player(entry.id)
                || e.owner == ExecutionOwner::System(Some(entry.id));
        }
        if front(world, *actor) == Some(entry.id)
            && world
                .get::<crate::reading::ReadingJourney>(*actor)
                .is_none()
            && world.get::<terri_core::chores::ChoreWork>(*actor).is_none()
        {
            return true;
        }
        if world.get::<terri_core::Wander>(*actor).is_some()
            && world.get::<Target>(*actor).is_none()
        {
            return true;
        }
        can_redirect_ordinary(world, *actor)
            || can_suspend_autonomous_recipe(world, *actor, entry.id)
            || !occupied(world, *actor)
    });
    requests.sort_by_key(|(actor, e)| crate::player_actions::priority(world, *actor, e.id));
    requests
}

fn elect_incoming(
    world: &World,
    requests: &[(Entity, terri_core::components::QueuedOrder)],
) -> ParticipantPlan {
    let mut roles = BTreeMap::new();
    if let Some(mut people) = world.try_query_filtered::<Entity, With<Agent>>() {
        roles.extend(
            people
                .iter(world)
                .map(|person| (person, ParticipantRole::Available)),
        );
    }
    let mut plan = ParticipantPlan {
        roles,
        incoming: BTreeMap::new(),
        retained_recipients: BTreeSet::new(),
    };
    for (&actor, execution) in &world.resource::<SocialEpisodes>().executions {
        if execution.phase == ExecutionPhase::Running || execution.admitted {
            plan.select(actor, execution.recipient);
            plan.retained_recipients.insert(execution.recipient);
        }
    }
    for (actor, entry) in requests {
        let recipient = entry.intent.object;
        if !plan.available(*actor) || !plan.available(recipient) {
            continue;
        }
        if front(world, recipient).is_some() {
            // Only fresh front orders participate in a front-order cycle.
            if front(world, *actor) != Some(entry.id) {
                continue;
            }
            let priority = crate::player_actions::priority(world, *actor, entry.id);
            let mut cursor = recipient;
            let mut visited = BTreeSet::new();
            let mut closes_cycle = false;
            let mut oldest = true;
            let traversal_limit = requests.len().saturating_add(1);
            let mut traversed = 0;
            while visited.insert(cursor) {
                traversed += 1;
                assert!(
                    traversed <= traversal_limit,
                    "front-order cycle traversal exceeded its participant bound"
                );
                let Some(id) = front(world, cursor) else {
                    break;
                };
                let Some((_, next)) = requests
                    .iter()
                    .find(|(person, e)| *person == cursor && e.id == id)
                else {
                    break;
                };
                oldest &= priority < crate::player_actions::priority(world, cursor, id);
                if next.intent.object == *actor {
                    closes_cycle = true;
                    break;
                }
                cursor = next.intent.object;
            }
            if !closes_cycle || !oldest {
                continue;
            }
        }
        plan.select(*actor, recipient);
    }
    plan
}

fn yield_to_incoming(world: &mut World, plan: &ParticipantPlan) {
    world.resource_mut::<SocialEpisodes>().incoming = plan.incoming.clone();
    // Winning incoming work displaces only a temporary outgoing approach.
    for &recipient in plan.incoming.keys() {
        if world
            .resource::<SocialEpisodes>()
            .executions
            .get(&recipient)
            .is_some_and(|e| e.phase == ExecutionPhase::Approaching && !e.admitted)
        {
            detach(world, recipient, true);
        }
        if !plan.retained_recipients.contains(&recipient) && front(world, recipient).is_some() {
            world
                .entity_mut(recipient)
                .remove::<crate::player_actions::FrontOrder>();
        }
        if world.get::<Target>(recipient).is_none()
            && world.get::<Path>(recipient).is_none()
            && world
                .get::<IntentQueue>(recipient)
                .is_some_and(|q| !q.is_empty())
        {
            world.entity_mut(recipient).insert(terri_core::Blocked);
        }
    }
}

fn prepare_request(
    world: &mut World,
    actor: Entity,
    entry: terri_core::components::QueuedOrder,
    plan: &ParticipantPlan,
) {
    if plan.is_recipient(actor) {
        return;
    }
    let recipient = entry.intent.object;
    let owner = if world
        .get_resource::<crate::fights::Fights>()
        .is_some_and(|f| f.owns_order(actor, entry.id))
    {
        ExecutionOwner::System(Some(entry.id))
    } else {
        ExecutionOwner::Player(entry.id)
    };
    let existing = world
        .resource::<SocialEpisodes>()
        .executions
        .get(&actor)
        .copied();
    if existing.is_some_and(|e| e.owner != owner || e.phase == ExecutionPhase::Running) {
        return;
    }
    if existing.is_none() {
        let Some(steps) = route(world, actor, recipient) else {
            crate::player_actions::terminal(
                world,
                actor,
                entry.id,
                "failed",
                Some("Recipient unreachable"),
            );
            return;
        };
        if world.get::<terri_core::Wander>(actor).is_some() && world.get::<Target>(actor).is_none()
        {
            world
                .entity_mut(actor)
                .remove::<(Path, terri_core::Wander)>();
        }
        let held_autonomous_recipe = can_suspend_autonomous_recipe(world, actor, entry.id);
        if (front(world, actor) == Some(entry.id)
            || can_redirect_ordinary(world, actor)
            || held_autonomous_recipe)
            && world.get::<crate::reading::ReadingJourney>(actor).is_none()
            && world.get::<terri_core::chores::ChoreWork>(actor).is_none()
        {
            redirect_recipient(world, actor);
            crate::recipe_actions::suspend(world, actor);
            if let Some(old) = world.get::<Target>(actor).copied() {
                crate::reservations::release_now(world, actor, old);
                world.entity_mut(actor).remove::<(
                    Target,
                    Path,
                    terri_core::Eating,
                    terri_core::StepWork,
                    Socialising,
                    terri_core::ConversationVoice,
                    terri_core::Fumbled,
                )>();
            }
        }
        let held_recipe = front(world, actor) == Some(entry.id)
            && world.get::<terri_core::ChainState>(actor).is_some()
            && world
                .get::<crate::recipe_actions::RecipeOrder>(actor)
                .is_some_and(|owner| owner.0 != entry.id);
        if occupied(world, actor) && !held_recipe && !held_autonomous_recipe {
            return;
        }
        crate::domestic::suspend_cleanup(world, actor);
        commit(
            world,
            actor,
            Execution {
                recipient,
                interaction: entry.intent.interaction,
                owner,
                phase: ExecutionPhase::Approaching,
                admitted: false,
            },
            steps,
        );
        crate::player_actions::transition(world, actor, entry.id, 1, true);
    }
    if !keep_route(world, actor, recipient) {
        if let Some(steps) = route(world, actor, recipient) {
            world.entity_mut(actor).insert(Path { steps, cursor: 0 });
        } else {
            detach(world, actor, true);
            crate::player_actions::terminal(
                world,
                actor,
                entry.id,
                "failed",
                Some("Recipient unreachable"),
            );
            return;
        }
    }
    let winner = plan.incoming.get(&recipient) == Some(&actor);
    let busy = occupied(world, recipient);
    let admitted = world
        .resource::<SocialEpisodes>()
        .executions
        .get(&actor)
        .is_some_and(|e| e.admitted);
    if winner && !busy {
        world
            .entity_mut(recipient)
            .remove::<(terri_core::Wander, terri_core::Restless)>()
            .insert(Reserved);
        world
            .resource_mut::<SocialEpisodes>()
            .rendezvous
            .insert(recipient, actor);
        world
            .resource_mut::<SocialEpisodes>()
            .executions
            .get_mut(&actor)
            .unwrap()
            .admitted = true;
        if world.get::<Path>(actor).is_none() {
            world
                .entity_mut(actor)
                .remove::<terri_core::Blocked>()
                .insert(Path {
                    steps: vec![],
                    cursor: 0,
                });
        }
    } else if !admitted && world.get::<Path>(actor).is_none() {
        world.entity_mut(actor).insert(terri_core::Blocked);
    }
}
