//! Player orders own their identity independently of routes and reservations.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, VecDeque};
use terri_core::components::QueuedOrder;
use terri_core::{Agent, IntentQueue, Path, SimClock, Socialising, Target};

#[derive(Clone, Debug)]
pub struct ActionEvent {
    pub sequence: u64,
    pub tick: u64,
    pub actor: u32,
    pub counterpart: Option<u32>,
    pub order_id: u64,
    pub action: String,
    pub phase: String,
    pub reason: Option<String>,
    pub blocking_state: Option<String>,
}
#[derive(Clone, Debug)]
pub struct ActionEventBatch {
    pub events: Vec<ActionEvent>,
    pub next_cursor: u64,
    pub expired: bool,
}
#[derive(Clone, Debug)]
pub struct ActionQueueRow {
    pub order_id: Option<u64>,
    pub label: String,
    pub phase: String,
    pub role: String,
    pub counterpart: Option<u32>,
    pub reason: Option<String>,
}
#[derive(Resource, Default)]
pub struct ActionDiagnostics {
    records: VecDeque<ActionEvent>,
    sequence: u64,
}
#[derive(Clone)]
pub(crate) struct OrderState {
    pub entry: QueuedOrder,
    pub acceptance: u64,
    pub phase: u8,
    pub active: bool,
    pub started: bool,
    pub chore_key: Option<terri_core::chores::ChoreKey>,
    pub label: String,
}
#[derive(Resource, Default)]
pub struct PlayerActions {
    pub(crate) orders: BTreeMap<(Entity, u64), OrderState>,
    pub(crate) next_acceptance: u64,
}
#[derive(Component)]
pub(crate) struct FrontOrder(pub u64);

/// The dynamic prepared-food action owns a meal, rather than an authored recipe.
#[doc(hidden)]
#[derive(Component, Clone, Copy)]
pub struct DirectedMealOrder(pub u64);

#[derive(Component, Clone, Copy)]
pub(crate) struct ServedOrder(pub u64);

pub(crate) fn serving_directed_meal(world: &World, actor: Entity) -> bool {
    world.get::<DirectedMealOrder>(actor).is_some_and(|owner| {
        world.get::<IntentQueue>(actor).is_some_and(|queue| {
            queue
                .entries()
                .first()
                .is_some_and(|entry| entry.id == owner.0)
        })
    }) && world
        .get::<terri_core::ChainState>(actor)
        .is_some_and(|chain| {
            world.resource::<crate::Content>().0.chains[chain.chain as usize].id
                == crate::domestic::SHARED
        })
}

pub(crate) fn explicit_front(world: &mut World, actor: Entity, id: u64) {
    world.entity_mut(actor).insert(FrontOrder(id));
}

fn phase_name(phase: u8) -> &'static str {
    match phase {
        1 => "approaching",
        2 => "waiting",
        3 => "running",
        _ => "queued",
    }
}
fn label(world: &World, entry: &QueuedOrder) -> String {
    let pack = world.resource::<crate::Content>().0;
    if let Some(title) = entry.title_id.as_deref() {
        if let Some(book) = pack.books.iter().find(|book| book.id == title) {
            return format!("Read: {}", book.title);
        }
    }
    if let Some(id) = entry.intent.chore {
        if let Some(order) = world
            .get_resource::<terri_core::chores::SavedChores>()
            .and_then(|s| s.orders.iter().find(|o| o.id == id))
        {
            return order.key.kind.label().into();
        }
    }
    if entry.intent.cleanup.is_some() {
        return "Clean up".into();
    }
    if let Some(object) = world.get::<terri_core::SmartObject>(entry.intent.object) {
        if let Some(row) = crate::action_rows::resolve(pack, object.0, entry.intent.interaction) {
            return format!(
                "{}: {}",
                row.label(world.resource::<SimClock>().tick, pack.tuning.day_ticks),
                pack.object(object.0).display_name()
            );
        }
    }
    if let Some(action) = pack
        .social
        .get(entry.intent.interaction as usize)
        .filter(|_| world.get::<Agent>(entry.intent.object).is_some())
    {
        let name = world
            .get::<terri_core::SimName>(entry.intent.object)
            .map_or("Housemate", |n| n.0.as_str());
        return format!("{}: {}", action.label, name);
    }
    "Unavailable action".into()
}
fn counterpart(state: &OrderState) -> Option<u32> {
    if state.entry.id == u64::MAX {
        return None;
    }
    if let Some(key) = state.chore_key {
        return matches!(
            key.kind,
            terri_core::chores::ChoreKind::Surfaces | terri_core::chores::ChoreKind::Bins
        )
        .then_some(key.target);
    }
    Some(state.entry.intent.object.index_u32())
}

fn emit(world: &mut World, actor: Entity, state: &OrderState, phase: &str, reason: Option<&str>) {
    let tick = world.resource::<SimClock>().tick;
    let counterpart = counterpart(state);
    let mut diagnostics = world.get_resource_or_insert_with(ActionDiagnostics::default);
    diagnostics.sequence += 1;
    let sequence = diagnostics.sequence;
    diagnostics.records.push_back(ActionEvent {
        sequence,
        tick,
        actor: actor.index_u32(),
        counterpart,
        order_id: state.entry.id,
        action: state.label.clone(),
        phase: phase.into(),
        reason: reason.map(str::to_owned),
        blocking_state: (phase == "waiting").then(|| "Recipient or resource busy".into()),
    });
    if diagnostics.records.len() > 2048 {
        diagnostics.records.pop_front();
    }
}

fn record_acceptance(world: &mut World, actor: Entity, entry: QueuedOrder) -> bool {
    if world
        .get_resource::<PlayerActions>()
        .is_some_and(|s| s.orders.contains_key(&(actor, entry.id)))
    {
        return false;
    }
    let description = label(world, &entry);
    let chore_key = entry.intent.chore.and_then(|id| {
        world
            .get_resource::<terri_core::chores::SavedChores>()
            .and_then(|s| s.orders.iter().find(|o| o.id == id))
            .map(|o| o.key)
    });
    let mut actions = world.get_resource_or_insert_with(PlayerActions::default);
    let acceptance = actions.next_acceptance;
    actions.next_acceptance += 1;
    let state = OrderState {
        entry,
        acceptance,
        phase: 0,
        active: false,
        started: false,
        chore_key,
        label: description,
    };
    actions
        .orders
        .insert((actor, state.entry.id), state.clone());
    emit(world, actor, &state, "accepted", None);
    true
}

/// Called at command acceptance, including paused command batches.
pub(crate) fn accept(world: &mut World, actor: Entity, entry: QueuedOrder) {
    if record_acceptance(world, actor, entry) {
        crate::attendance::interrupt_for_order(world, actor);
    }
}

/// An invalid action consumes its identity without becoming work or recalling its owner.
pub(crate) fn fail_submission(world: &mut World, actor: Entity, entry: QueuedOrder, reason: &str) {
    let id = entry.id;
    if record_acceptance(world, actor, entry) {
        terminal(world, actor, id, "failed", Some(reason));
    }
}

pub(crate) fn transition(world: &mut World, actor: Entity, id: u64, phase: u8, active: bool) {
    let Some(state) = world.get_resource_mut::<PlayerActions>().and_then(|mut s| {
        s.orders.get_mut(&(actor, id)).map(|v| {
            let old = (v.phase, v.active, v.started);
            v.phase = phase;
            v.active = active;
            if phase == 3 {
                v.started = true;
            }
            (old, v.clone())
        })
    }) else {
        return;
    };
    if (state.0 .0, state.0 .1) == (phase, active) {
        return;
    }
    if active
        && world
            .get::<IntentQueue>(actor)
            .is_none_or(|queue| queue.order(id).is_none())
        && world
            .get::<FrontOrder>(actor)
            .is_some_and(|front| front.0 == id)
    {
        world.entity_mut(actor).remove::<FrontOrder>();
    }
    let event = if phase == 3 && state.0 .2 {
        "resumed"
    } else if phase == 3 {
        "started"
    } else {
        phase_name(phase)
    };
    emit(world, actor, &state.1, event, None);
}

/// Records contact before one-tick work can finish and remove its runtime marker.
pub(crate) fn record_physical_work_start(world: &mut World, actor: Entity, expected: Target) {
    if world.get::<Target>(actor) != Some(&expected) {
        return;
    }
    let mut owners = std::collections::BTreeSet::new();
    if expected.interaction == crate::systems::chain::CHAIN_STEP {
        if world
            .get::<terri_core::StepWork>(actor)
            .is_none_or(|work| work.remaining_ticks == 0)
        {
            return;
        }
        let Some(progress) = world.get::<terri_core::ChainState>(actor) else {
            return;
        };
        let pack = world.resource::<crate::Content>().0;
        let Some(actions) = world.get_resource::<PlayerActions>() else {
            return;
        };
        if let Some(owner) = world.get::<crate::recipe_actions::RecipeOrder>(actor) {
            if let Some(state) = actions.orders.get(&(actor, owner.0)) {
                let declared = world
                    .get::<terri_core::SmartObject>(state.entry.intent.object)
                    .and_then(|object| {
                        crate::systems::chain::ordered_chain(
                            pack,
                            object.0,
                            state.entry.intent.interaction,
                        )
                    });
                if declared == Some(progress.chain)
                    && world
                        .get::<IntentQueue>(actor)
                        .and_then(|queue| queue.order(owner.0))
                        == Some(&state.entry)
                {
                    owners.insert(owner.0);
                }
            }
        }
        if let Some(owner) = world.get::<DirectedMealOrder>(actor) {
            if let Some(state) = actions.orders.get(&(actor, owner.0)) {
                let claimed = world.get::<terri_core::SimId>(actor).is_some_and(|person| {
                    world
                        .get_resource::<terri_core::save::SavedDomestic>()
                        .is_some_and(|domestic| {
                            domestic.meals.iter().any(|meal| {
                                meal.table == Some(state.entry.intent.object.index_u32())
                                    && meal.claimed.contains(&person.0)
                                    && !meal.eaten.contains(&person.0)
                            })
                        })
                });
                if pack.chains[progress.chain as usize].id == crate::domestic::SHARED
                    && claimed
                    && world
                        .get::<IntentQueue>(actor)
                        .and_then(|queue| queue.order(owner.0))
                        == Some(&state.entry)
                {
                    owners.insert(owner.0);
                }
            }
        }
        for (&(person, id), state) in actions.orders.range((actor, 0)..=(actor, u64::MAX)) {
            if person != actor || !state.active {
                continue;
            }
            let scope_owned = state.entry.intent.cleanup.is_some_and(|scope| {
                crate::targeted_cleanup::player_phase(world, actor, scope) == Some(3)
            });
            let dish_chore_owned = state
                .chore_key
                .is_some_and(|key| key.kind == terri_core::chores::ChoreKind::Dishes)
                && world
                    .get_resource::<terri_core::chores::SavedChores>()
                    .is_some_and(|chores| {
                        chores
                            .dish_started
                            .iter()
                            .any(|(person, _)| *person == actor.index_u32())
                    })
                && retained_work_phase(world, actor, id, state) == Some(3);
            if scope_owned || dish_chore_owned {
                owners.insert(id);
            }
        }
    } else {
        let Some(owner) = world.get::<ServedOrder>(actor) else {
            return;
        };
        let Some(state) = world
            .get_resource::<PlayerActions>()
            .and_then(|actions| actions.orders.get(&(actor, owner.0)))
        else {
            return;
        };
        let actual = world.get::<terri_core::Eating>(actor).is_some_and(|work| {
            work.remaining_ticks > 0
                && work.interaction == expected.interaction
                && world
                    .get::<terri_core::SmartObject>(expected.object)
                    .is_some_and(|object| object.0 == work.object)
        });
        if actual
            && state.entry.title_id.is_none()
            && state.entry.intent
                == (terri_core::Intent {
                    object: expected.object,
                    interaction: expected.interaction,
                    cleanup: None,
                    chore: None,
                })
            && world
                .get::<IntentQueue>(actor)
                .and_then(|queue| queue.order(owner.0))
                == Some(&state.entry)
        {
            owners.insert(owner.0);
        }
    }
    if owners.len() == 1 {
        transition(
            world,
            actor,
            *owners.first().expect("one exact physical owner"),
            3,
            true,
        );
    }
}

/// Every removal site supplies its actual outcome before releasing ownership.
pub(crate) fn terminal(
    world: &mut World,
    actor: Entity,
    id: u64,
    phase: &str,
    reason: Option<&str>,
) {
    if phase != "completed" {
        crate::social_episode::release_order(world, actor, id);
    }
    if world
        .get_resource::<crate::fights::Fights>()
        .is_some_and(|fights| fights.owns_order(actor, id))
    {
        if let Some(mut queue) = world.get_mut::<IntentQueue>(actor) {
            queue.remove_order(id);
        }
    }
    let state = world
        .get_resource_mut::<PlayerActions>()
        .and_then(|mut s| s.orders.remove(&(actor, id)));
    if let Some(state) = state {
        emit(world, actor, &state, phase, reason);
        if let Some(mut queue) = world.get_mut::<IntentQueue>(actor) {
            queue.remove_order(id);
        }
        if world
            .get::<ServedOrder>(actor)
            .is_some_and(|owner| owner.0 == id)
        {
            world.entity_mut(actor).remove::<ServedOrder>();
        }
        if world
            .get::<DirectedMealOrder>(actor)
            .is_some_and(|owner| owner.0 == id)
        {
            world.entity_mut(actor).remove::<DirectedMealOrder>();
            if phase != "completed"
                && world
                    .get::<terri_core::ChainState>(actor)
                    .is_some_and(|chain| {
                        world.resource::<crate::Content>().0.chains[chain.chain as usize].id
                            == crate::domestic::SHARED
                    })
            {
                let target = world.get::<Target>(actor).copied();
                if target
                    .is_none_or(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
                {
                    if let Some(target) = target {
                        crate::reservations::release_now(world, actor, target);
                    }
                    world.entity_mut(actor).remove::<(
                        Target,
                        Path,
                        terri_core::StepWork,
                        terri_core::Carrying,
                    )>();
                }
                crate::domestic::abandon(world, actor);
                world
                    .entity_mut(actor)
                    .remove::<crate::recipe_actions::ActiveRecipe>();
            }
        }
        if world
            .get::<FrontOrder>(actor)
            .is_some_and(|front| front.0 == id)
        {
            world.entity_mut(actor).remove::<FrontOrder>();
        }
    }
}
pub(crate) fn terminal_matching(
    world: &mut World,
    actor: Entity,
    intent: terri_core::Intent,
    phase: &str,
    reason: Option<&str>,
) {
    let id = world.get_resource::<PlayerActions>().and_then(|s| {
        s.orders
            .iter()
            .filter(|((owner, _), v)| *owner == actor && v.entry.intent == intent)
            .min_by_key(|(_, v)| (!v.active, v.acceptance))
            .map(|((_, id), _)| *id)
    });
    if let Some(id) = id {
        terminal(world, actor, id, phase, reason);
    }
}
pub(crate) fn complete_matching(world: &mut World, actor: Entity, intent: terri_core::Intent) {
    let Some(id) = world.get::<ServedOrder>(actor).map(|owner| owner.0) else {
        return;
    };
    let matches = world
        .get::<IntentQueue>(actor)
        .is_some_and(|queue| queue.order(id).is_some_and(|order| order.intent == intent));
    if matches {
        if let Some(mut queue) = world.get_mut::<IntentQueue>(actor) {
            queue.remove_order(id);
        }
        terminal(world, actor, id, "completed", None);
        world.entity_mut(actor).remove::<ServedOrder>();
    }
}

pub(crate) fn record_work_outcome(world: &mut World, actor: Entity, reason: &str) {
    let state = OrderState {
        entry: QueuedOrder {
            id: u64::MAX,
            intent: terri_core::Intent {
                object: actor,
                interaction: 0,
                cleanup: None,
                chore: None,
            },
            title_id: None,
        },
        acceptance: 0,
        phase: 3,
        active: false,
        started: true,
        chore_key: None,
        label: "Work".into(),
    };
    emit(world, actor, &state, "completed", Some(reason));
}
pub(crate) fn cancel_all(world: &mut World, actor: Entity, reason: &str) {
    let ids: Vec<_> = world
        .get_resource::<PlayerActions>()
        .map_or_else(Vec::new, |s| {
            s.orders
                .keys()
                .filter(|(owner, _)| *owner == actor)
                .map(|(_, id)| *id)
                .collect()
        });
    for id in ids {
        terminal(world, actor, id, "canceled", Some(reason));
    }
    if let Some(id) = crate::social_episode::request_order_id(world, actor) {
        terminal(world, actor, id, "canceled", Some(reason));
    }
}
pub(crate) fn has_player_work(world: &World, actor: Entity) -> bool {
    world
        .get::<IntentQueue>(actor)
        .is_some_and(|q| !q.is_empty())
        || world.get_resource::<PlayerActions>().is_some_and(|s| {
            s.orders.iter().any(|((owner, id), state)| {
                *owner == actor
                    || (state.entry.intent.object == actor
                        && state.entry.intent.chore.is_none()
                        && state.entry.intent.cleanup.is_none()
                        && world.get::<Agent>(*owner).is_some()
                        && (state.active
                            || world.get::<IntentQueue>(*owner).is_some_and(|q| {
                                q.entries().first().is_some_and(|entry| entry.id == *id)
                            })))
            })
        })
}
pub(crate) fn priority(world: &World, actor: Entity, id: u64) -> (u64, u32) {
    (
        world
            .get_resource::<PlayerActions>()
            .and_then(|s| s.orders.get(&(actor, id)))
            .map_or(u64::MAX, |v| v.acceptance),
        world
            .get::<terri_core::SimId>(actor)
            .map_or(actor.index_u32(), |v| v.0),
    )
}
pub(crate) fn reject_submission(world: &mut World, actor: u32, reason: &str) {
    let tick = world.resource::<SimClock>().tick;
    let mut d = world.get_resource_or_insert_with(ActionDiagnostics::default);
    d.sequence += 1;
    let sequence = d.sequence;
    d.records.push_back(ActionEvent {
        sequence,
        tick,
        actor,
        counterpart: None,
        order_id: u64::MAX,
        action: "Order submission".into(),
        phase: "rejected".into(),
        reason: Some(reason.into()),
        blocking_state: None,
    });
    if d.records.len() > 2048 {
        d.records.pop_front();
    }
}
pub(crate) fn continue_session(old: &World, new: &mut World) {
    let sequence = old
        .get_resource::<ActionDiagnostics>()
        .map_or(0, |d| d.sequence);
    new.insert_resource(ActionDiagnostics {
        records: VecDeque::new(),
        sequence,
    });
}

pub(crate) fn saved_actor(
    world: &World,
    actor: Entity,
) -> Option<terri_core::save_v15::SavedOrderActor> {
    use terri_core::save_v15::SavedOrderActor;
    world.get::<Agent>(actor)?;
    Some(world.get::<terri_core::SimId>(actor).map_or_else(
        || SavedOrderActor::Entity(actor.index_u32()),
        |identity| SavedOrderActor::Sim(identity.0),
    ))
}

pub(crate) fn restore_actor(
    world: &World,
    saved: terri_core::save_v15::SavedOrderActor,
) -> Result<Entity, crate::save::SaveError> {
    use crate::save::SaveError;
    use terri_core::save_v15::SavedOrderActor;
    match saved {
        SavedOrderActor::Sim(identity) => {
            let mut query = world
                .try_query::<(Entity, &Agent, &terri_core::SimId)>()
                .ok_or(SaveError::InvalidEntityReference)?;
            let mut matching = query
                .iter(world)
                .filter(|(_, _, id)| id.0 == identity)
                .map(|(actor, _, _)| actor);
            let actor = matching.next().ok_or(SaveError::InvalidEntityReference)?;
            if matching.next().is_some() {
                return Err(SaveError::InvalidValue);
            }
            Ok(actor)
        }
        SavedOrderActor::Entity(index) => crate::dining::entity(world, index)
            .filter(|&actor| {
                world.get::<Agent>(actor).is_some()
                    && world.get::<terri_core::SimId>(actor).is_none()
            })
            .ok_or(SaveError::InvalidEntityReference),
    }
}

pub(crate) fn save(world: &World) -> terri_core::save_v15::SavedPlayerOrders {
    let mut result = terri_core::save_v15::SavedPlayerOrders::default();
    let Some(actions) = world.get_resource::<PlayerActions>() else {
        return result;
    };
    result.next_acceptance = actions.next_acceptance;
    for (&(actor, id), s) in &actions.orders {
        let Some(identity) = saved_actor(world, actor) else {
            continue;
        };
        result.orders.push(terri_core::save_v15::SavedPlayerOrder {
            actor: identity,
            order_id: id,
            acceptance: s.acceptance,
            phase: s.phase,
            active: s.active,
            started: s.started,
            chore_key: s.chore_key,
            served: world
                .get::<ServedOrder>(actor)
                .is_some_and(|owner| owner.0 == id),
            explicit_front: world
                .get::<FrontOrder>(actor)
                .is_some_and(|front| front.0 == id),
            target: s.entry.intent.object.index_u32(),
            interaction: s.entry.intent.interaction,
            cleanup: s.entry.intent.cleanup,
            chore: s.entry.intent.chore,
            title_id: s.entry.title_id.clone(),
        });
    }
    // Legacy readers and native fixtures can supply a queue before the first
    // observation. Migrate that ownership in the same stable order as observe.
    if let Some(mut query) = world.try_query::<(Entity, &IntentQueue)>() {
        let mut missing: Vec<_> = query
            .iter(world)
            .flat_map(|(actor, queue)| {
                queue
                    .entries()
                    .iter()
                    .filter_map(move |entry| saved_actor(world, actor).map(|id| (actor, id, entry)))
            })
            .filter(|(actor, _, entry)| {
                !actions.orders.contains_key(&(*actor, entry.id))
                    && !world
                        .get_resource::<crate::fights::Fights>()
                        .is_some_and(|f| f.owns_order(*actor, entry.id))
            })
            .collect();
        missing.sort_by_key(|(actor, _, entry)| {
            (
                world
                    .get::<terri_core::SimId>(*actor)
                    .map_or(actor.index_u32(), |id| id.0),
                entry.id,
            )
        });
        for (actor, identity, entry) in missing {
            let acceptance = result.next_acceptance;
            result.next_acceptance += 1;
            let chore_key = entry.intent.chore.and_then(|id| {
                world
                    .get_resource::<terri_core::chores::SavedChores>()
                    .and_then(|s| s.orders.iter().find(|o| o.id == id))
                    .map(|o| o.key)
            });
            result.orders.push(terri_core::save_v15::SavedPlayerOrder {
                actor: identity,
                order_id: entry.id,
                acceptance,
                phase: 0,
                active: false,
                started: false,
                chore_key,
                served: world
                    .get::<ServedOrder>(actor)
                    .is_some_and(|owner| owner.0 == entry.id),
                explicit_front: world
                    .get::<FrontOrder>(actor)
                    .is_some_and(|front| front.0 == entry.id),
                target: entry.intent.object.index_u32(),
                interaction: entry.intent.interaction,
                cleanup: entry.intent.cleanup,
                chore: entry.intent.chore,
                title_id: entry.title_id.clone(),
            });
        }
    }
    result.orders.sort_by_key(|o| (o.actor, o.order_id));
    result
}
pub(crate) fn restore(
    world: &mut World,
    saved: terri_core::save_v15::SavedPlayerOrders,
) -> Result<(), crate::save::SaveError> {
    use crate::save::SaveError;
    let inferred: Vec<_> = world
        .query_filtered::<Entity, With<ServedOrder>>()
        .iter(world)
        .collect();
    for actor in inferred {
        world.entity_mut(actor).remove::<ServedOrder>();
    }
    let mut actions = PlayerActions {
        orders: BTreeMap::new(),
        next_acceptance: saved.next_acceptance,
    };
    let mut accepted = std::collections::BTreeSet::new();
    let mut transferred = std::collections::BTreeSet::new();
    let mut meal_owners = std::collections::BTreeSet::new();
    for s in saved.orders {
        if s.phase > 3
            || s.acceptance >= saved.next_acceptance
            || !accepted.insert(s.acceptance)
            || (s.phase == 3 && !s.started)
            || (s.active && s.phase == 0)
            || (!s.active && matches!(s.phase, 1 | 3))
            || s.chore.is_some() != s.chore_key.is_some()
            || (s.chore.is_some() && s.cleanup.is_some())
        {
            return Err(SaveError::InvalidValue);
        }
        let actor = restore_actor(world, s.actor)?;
        let queued = world
            .get::<IntentQueue>(actor)
            .and_then(|q| q.order(s.order_id))
            .cloned();
        if let Some(entry) = &queued {
            if entry.intent.object.index_u32() != s.target
                || entry.intent.interaction != s.interaction
                || entry.intent.cleanup != s.cleanup
                || entry.intent.chore != s.chore
                || entry.title_id != s.title_id
            {
                return Err(SaveError::InvalidValue);
            }
            if let Some(chore) = s.chore {
                if !world
                    .get_resource::<terri_core::chores::SavedChores>()
                    .is_some_and(|state| {
                        state.orders.iter().any(|o| {
                            o.id == chore
                                && o.person == actor.index_u32()
                                && Some(o.key) == s.chore_key
                        })
                    })
                {
                    return Err(SaveError::InvalidValue);
                }
            }
        } else {
            if !s.active || s.title_id.is_some() || s.interaction != 0 {
                return Err(SaveError::InvalidValue);
            }
            let valid = if let Some(key) = s.chore_key {
                s.target == actor.index_u32()
                    && transferred.insert((actor, 0))
                    && (world
                        .get_resource::<terri_core::chores::SavedChores>()
                        .is_some_and(|state| {
                            state.tasks.iter().any(|task| {
                                task.person == actor.index_u32() && task.directed && task.key == key
                            })
                        })
                        || key.kind == terri_core::chores::ChoreKind::Dishes
                            && key.target == 0
                            && world
                                .get_resource::<terri_core::save::SavedDomestic>()
                                .is_some_and(|state| {
                                    state.cleanup.iter().any(|task| {
                                        task.person == actor.index_u32() && task.directed
                                    })
                                }))
            } else if let Some(cleanup) = s.cleanup {
                transferred.insert((actor, 1))
                    && world
                        .get_resource::<terri_core::save::SavedTargetedCleanup>()
                        .is_some_and(|state| {
                            state.orders.iter().any(|scope| {
                                scope.id == cleanup
                                    && scope.person == actor.index_u32()
                                    && scope.surface == s.target
                                    && scope.queue_position.is_none()
                            })
                        })
            } else {
                false
            };
            if !valid {
                return Err(SaveError::InvalidValue);
            }
        }
        if s.explicit_front
            && world
                .get::<IntentQueue>(actor)
                .is_none_or(|q| q.entries().first().is_none_or(|e| e.id != s.order_id))
        {
            return Err(SaveError::InvalidValue);
        }
        let entry = queued
            .or_else(|| {
                let target = crate::dining::entity(world, s.target)?;
                Some(QueuedOrder {
                    id: s.order_id,
                    intent: terri_core::Intent {
                        object: target,
                        interaction: s.interaction,
                        cleanup: s.cleanup,
                        chore: s.chore,
                    },
                    title_id: s.title_id,
                })
            })
            .ok_or(SaveError::InvalidValue)?;
        if world
            .get::<IntentQueue>(actor)
            .is_none_or(|q| s.order_id >= q.next_id())
        {
            return Err(SaveError::InvalidValue);
        }
        let description = s
            .chore_key
            .map_or_else(|| label(world, &entry), |key| key.kind.label().into());
        let dynamic_meal = entry.intent.cleanup.is_none()
            && entry.intent.chore.is_none()
            && entry.intent.interaction == 1
            && world
                .get::<terri_core::SmartObject>(entry.intent.object)
                .is_some_and(|object| {
                    world.resource::<crate::Content>().0.object(object.0).id == "dining_table"
                });
        if dynamic_meal && s.active {
            let valid = world
                .get::<terri_core::ChainState>(actor)
                .is_some_and(|chain| {
                    world.resource::<crate::Content>().0.chains[chain.chain as usize].id
                        == crate::domestic::SHARED
                })
                && world
                    .get_resource::<terri_core::save::SavedDomestic>()
                    .is_some_and(|state| {
                        state.meals.iter().any(|meal| {
                            meal.table == Some(s.target)
                                && world.get::<terri_core::SimId>(actor).is_some_and(|id| {
                                    meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0)
                                })
                        })
                    });
            if !valid || !meal_owners.insert(actor) {
                return Err(SaveError::InvalidValue);
            }
            world
                .entity_mut(actor)
                .insert(DirectedMealOrder(s.order_id));
        }
        if s.served {
            if world.get::<Target>(actor).is_none_or(|t| {
                t.object != entry.intent.object || t.interaction != entry.intent.interaction
            }) || world
                .get::<terri_core::SmartObject>(entry.intent.object)
                .is_none()
                || world.get::<ServedOrder>(actor).is_some()
            {
                return Err(SaveError::InvalidValue);
            }
            world.entity_mut(actor).insert(ServedOrder(s.order_id));
        }
        let state = OrderState {
            label: description,
            entry,
            acceptance: s.acceptance,
            phase: s.phase,
            active: s.active,
            started: s.started,
            chore_key: s.chore_key,
        };
        if s.explicit_front {
            world.entity_mut(actor).insert(FrontOrder(s.order_id));
        }
        if actions.orders.insert((actor, s.order_id), state).is_some() {
            return Err(SaveError::InvalidValue);
        }
    }
    for (actor, queue) in world.query::<(Entity, &IntentQueue)>().iter(world) {
        for entry in queue.entries() {
            if !actions.orders.contains_key(&(actor, entry.id))
                && !world
                    .get_resource::<crate::fights::Fights>()
                    .is_some_and(|f| f.owns_order(actor, entry.id))
            {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    world.insert_resource(actions);
    Ok(())
}

pub(crate) fn hash(world: &World, hasher: &mut terri_core::FnvHasher) {
    let state = save(world);
    if state.next_acceptance == 0 && state.orders.is_empty() {
        return;
    }
    hasher.write_bytes(b"player-orders-v15");
    hasher.write_u64(state.next_acceptance);
    for s in state.orders {
        let (actor_kind, actor) = match s.actor {
            terri_core::save_v15::SavedOrderActor::Sim(identity) => (0, identity),
            terri_core::save_v15::SavedOrderActor::Entity(index) => (1, index),
        };
        for value in [
            actor_kind,
            u64::from(actor),
            s.order_id,
            s.acceptance,
            u64::from(s.phase),
            u64::from(s.active),
            u64::from(s.started),
            s.chore_key.map_or(u64::MAX, |key| key.kind as u64),
            s.chore_key.map_or(u64::MAX, |key| u64::from(key.target)),
            u64::from(s.explicit_front),
            u64::from(s.served),
            u64::from(s.target),
            u64::from(s.interaction),
            s.cleanup.map_or(u64::MAX, u64::from),
            s.chore.map_or(u64::MAX, u64::from),
        ] {
            hasher.write_u64(value);
        }
        if let Some(title) = s.title_id {
            hasher.write_u64(title.len() as u64);
            hasher.write_bytes(title.as_bytes());
        } else {
            hasher.write_u64(u64::MAX);
        }
    }
}
pub(crate) fn terminal_transferred(
    world: &mut World,
    actor: Entity,
    chore: bool,
    phase: &str,
    reason: Option<&str>,
) {
    let ids: Vec<_> = world
        .get_resource::<PlayerActions>()
        .map_or_else(Vec::new, |s| {
            s.orders
                .iter()
                .filter(|((owner, id), s)| {
                    *owner == actor
                        && s.active
                        && (if chore {
                            s.entry.intent.chore.is_some()
                        } else {
                            s.entry.intent.cleanup.is_some()
                        })
                        && world
                            .get::<IntentQueue>(actor)
                            .is_none_or(|q| q.order(*id).is_none())
                })
                .map(|((_, id), _)| *id)
                .collect()
        });
    for id in ids {
        terminal(world, actor, id, phase, reason);
    }
}
pub(crate) fn requeue_transferred(world: &mut World, actor: Entity, chore_id: u32) {
    let entry = world.get_resource::<PlayerActions>().and_then(|s| {
        s.orders
            .iter()
            .find(|((owner, _), s)| *owner == actor && s.entry.intent.chore == Some(chore_id))
            .map(|(_, s)| s.entry.clone())
    });
    if let Some(entry) = entry {
        if let Some(mut queue) = world.get_mut::<IntentQueue>(actor) {
            if queue.order(entry.id).is_none() {
                let mut entries = queue.entries().to_vec();
                entries.insert(0, entry);
                *queue = IntentQueue::from_entries(entries, queue.next_id())
                    .expect("retained order identity");
            }
        }
    }
}
/// Synchronizes phases only. Missing orders are never guessed to be completions.
fn retained_work_phase(world: &World, actor: Entity, id: u64, state: &OrderState) -> Option<u8> {
    if state.active {
        if let Some(scope) = state.entry.intent.cleanup {
            return crate::targeted_cleanup::player_phase(world, actor, scope);
        }
    }
    let other_activity = world.get::<Socialising>(actor).is_some()
        || world.get::<terri_core::AtWork>(actor).is_some()
        || world.get::<terri_core::Commuting>(actor).is_some()
        || world
            .get::<Target>(actor)
            .is_some_and(|target| target.interaction != crate::systems::chain::CHAIN_STEP);
    let recipe_owned = world
        .get::<crate::recipe_actions::RecipeOrder>(actor)
        .is_some_and(|owner| owner.0 == id)
        && world.get::<terri_core::ChainState>(actor).is_some();
    if recipe_owned && other_activity {
        return Some(2);
    }
    let key = state.chore_key.filter(|_| state.active)?;
    let task = world
        .get_resource::<terri_core::chores::SavedChores>()
        .and_then(|saved| {
            saved
                .tasks
                .iter()
                .find(|task| task.person == actor.index_u32() && task.directed && task.key == key)
        });
    let dishes = key.kind == terri_core::chores::ChoreKind::Dishes
        && world
            .get_resource::<terri_core::save::SavedDomestic>()
            .is_some_and(|saved| {
                saved
                    .cleanup
                    .iter()
                    .any(|task| task.person == actor.index_u32() && task.directed)
            });
    if task.is_none() && !dishes {
        return None;
    }
    if task.is_some_and(|task| task.suspended) || dishes && other_activity {
        return Some(2);
    }
    if world.get::<terri_core::chores::ChoreWork>(actor).is_some()
        || dishes && world.get::<terri_core::StepWork>(actor).is_some()
    {
        Some(3)
    } else if world.get::<Path>(actor).is_some() {
        Some(1)
    } else {
        Some(2)
    }
}

pub(crate) fn observe(world: &mut World) {
    maintain_served_orders(world);
    let mut entries: Vec<_> = world
        .query::<(Entity, &IntentQueue)>()
        .iter(world)
        .flat_map(|(e, q)| q.entries().iter().map(move |o| (e, o)))
        .filter(|(actor, entry)| {
            world
                .get_resource::<PlayerActions>()
                .is_none_or(|s| !s.orders.contains_key(&(*actor, entry.id)))
        })
        .map(|(actor, entry)| (actor, entry.clone()))
        .collect();
    entries.sort_by_key(|(e, o)| {
        (
            world
                .get::<terri_core::SimId>(*e)
                .map_or(e.index_u32(), |id| id.0),
            o.id,
        )
    });
    for (actor, entry) in entries {
        if !world
            .get_resource::<crate::fights::Fights>()
            .is_some_and(|f| f.owns_order(actor, entry.id))
        {
            accept(world, actor, entry);
        }
    }
    world.get_resource_or_insert_with(PlayerActions::default);
    let states: Vec<_> = world
        .resource::<PlayerActions>()
        .orders
        .iter()
        .filter(|(&(actor, id), s)| {
            s.active
                || world.get::<Agent>(actor).is_none()
                || world.get_entity(s.entry.intent.object).is_err()
                || world
                    .get::<IntentQueue>(actor)
                    .is_some_and(|q| q.entries().first().is_some_and(|e| e.id == id))
        })
        .map(|(&(e, id), s)| (e, id, s.clone()))
        .collect();
    for (actor, id, state) in states {
        if world.get::<Agent>(actor).is_none() {
            terminal(
                world,
                actor,
                id,
                "failed",
                Some("Initiator died or was removed"),
            );
            continue;
        }
        let intent = state.entry.intent;
        if intent.object != actor
            && intent.cleanup.is_none()
            && intent.chore.is_none()
            && world.get::<Agent>(intent.object).is_some()
            && (state.active
                || world
                    .get::<IntentQueue>(actor)
                    .is_some_and(|q| q.entries().first().is_some_and(|entry| entry.id == id)))
            && (world.get::<terri_core::AtWork>(intent.object).is_some()
                || world.get::<terri_core::Commuting>(intent.object)
                    == Some(&terri_core::Commuting::Outbound))
        {
            crate::attendance::interrupt_for_order(world, intent.object);
        }
        if world.get_entity(intent.object).is_err()
            && intent.chore.is_none()
            && intent.cleanup.is_none()
        {
            if let Some(target) = world
                .get::<Target>(actor)
                .copied()
                .filter(|target| target.object == intent.object)
            {
                crate::reservations::release_now(world, actor, target);
                world
                    .entity_mut(actor)
                    .remove::<(Target, Path, terri_core::Eating, terri_core::StepWork)>();
            }
            terminal(world, actor, id, "failed", Some("Target removed"));
            continue;
        }
        if let Some(phase) = crate::reading::player_phase(world, actor, id) {
            transition(world, actor, id, phase, true);
            continue;
        }
        if let Some(phase) = retained_work_phase(world, actor, id, &state) {
            transition(world, actor, id, phase, true);
            continue;
        }
        let meal_owned = world
            .get::<DirectedMealOrder>(actor)
            .is_some_and(|owner| owner.0 == id)
            && world
                .get::<terri_core::ChainState>(actor)
                .is_some_and(|chain| {
                    world.resource::<crate::Content>().0.chains[chain.chain as usize].id
                        == crate::domestic::SHARED
                });
        if meal_owned
            && (world
                .get::<Target>(actor)
                .is_some_and(|target| target.interaction != crate::systems::chain::CHAIN_STEP)
                || world.get::<Socialising>(actor).is_some())
        {
            transition(world, actor, id, 2, true);
            continue;
        }
        let social_order = world.get::<Agent>(intent.object).is_some()
            && intent.cleanup.is_none()
            && intent.chore.is_none();
        let active = meal_owned
            || (social_order && crate::social_episode::execution_order(world, actor) == Some(id))
            || (!social_order
                && world
                    .get::<ServedOrder>(actor)
                    .is_some_and(|owner| owner.0 == id)
                && world.get::<Target>(actor).is_some_and(|t| {
                    t.object == intent.object && t.interaction == intent.interaction
                }))
            || (world
                .get::<crate::recipe_actions::RecipeOrder>(actor)
                .is_some_and(|o| o.0 == id)
                && world
                    .get::<Target>(actor)
                    .is_none_or(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
                && world.get::<Socialising>(actor).is_none()
                && world.get::<terri_core::AtWork>(actor).is_none()
                && world.get::<terri_core::Commuting>(actor).is_none());
        if active {
            let earlier = world
                .get_resource::<PlayerActions>()
                .unwrap()
                .orders
                .iter()
                .any(|(&(owner, other), s)| {
                    owner == actor
                        && other != id
                        && s.entry.intent == intent
                        && (s.active || s.acceptance < state.acceptance)
                });
            if earlier {
                continue;
            }
            let waiting = world.get::<terri_core::Blocked>(actor).is_some();
            let running = world.get::<Socialising>(actor).is_some()
                || world.get::<terri_core::Eating>(actor).is_some()
                || world.get::<terri_core::StepWork>(actor).is_some();
            transition(
                world,
                actor,
                id,
                if waiting {
                    2
                } else if running {
                    3
                } else if world.get::<Path>(actor).is_some() {
                    1
                } else {
                    2
                },
                true,
            );
        } else if state.active && intent.cleanup.is_none() && intent.chore.is_none() {
            transition(world, actor, id, 0, false);
        } else if !state.active {
            let waiting = world.get::<terri_core::Blocked>(actor).is_some()
                && world
                    .get::<IntentQueue>(actor)
                    .is_some_and(|q| q.entries().first().is_some_and(|e| e.id == id));
            transition(world, actor, id, if waiting { 2 } else { 0 }, false);
        }
    }
}

impl crate::Sim {
    pub fn action_events_since(&self, cursor: u64) -> ActionEventBatch {
        let Some(d) = self.world.get_resource::<ActionDiagnostics>() else {
            return ActionEventBatch {
                events: vec![],
                next_cursor: 0,
                expired: false,
            };
        };
        ActionEventBatch {
            events: d
                .records
                .iter()
                .filter(|e| e.sequence > cursor)
                .cloned()
                .collect(),
            next_cursor: d.sequence,
            expired: d.records.front().map_or(cursor < d.sequence, |e| {
                cursor.saturating_add(1) < e.sequence
            }),
        }
    }
    pub fn action_queue_rows_of(&self, index: u32, max_rows: usize) -> Vec<ActionQueueRow> {
        let Some(mut query) = self.world.try_query_filtered::<Entity, With<Agent>>() else {
            return vec![];
        };
        let Some(person) = query.iter(&self.world).find(|e| e.index_u32() == index) else {
            return vec![];
        };
        let mut rows = Vec::new();
        if max_rows == 0 {
            return rows;
        }
        let Some(actions) = self.world.get_resource::<PlayerActions>() else {
            return rows;
        };
        let mut incoming: Vec<_> = actions
            .orders
            .iter()
            .filter(|((owner, _), s)| {
                *owner != person
                    && s.entry.intent.object == person
                    && s.entry.intent.chore.is_none()
                    && s.entry.intent.cleanup.is_none()
            })
            .collect();
        incoming.sort_by_key(|(_, s)| s.acceptance);
        let own = self.world.get::<IntentQueue>(person);
        let active_own = actions
            .orders
            .range((person, 0)..=(person, u64::MAX))
            .filter(|(_, s)| s.active)
            .min_by_key(|(_, s)| {
                (
                    !self.world.get::<Target>(person).is_some_and(|target| {
                        target.object == s.entry.intent.object
                            && target.interaction == s.entry.intent.interaction
                    }),
                    s.phase != 3,
                    s.acceptance,
                )
            });
        let own_row = |id: u64, s: &OrderState| ActionQueueRow {
            order_id: Some(id),
            label: s.label.clone(),
            phase: phase_name(s.phase).into(),
            role: "initiator".into(),
            counterpart: counterpart(s),
            reason: (s.phase == 2).then(|| "Waiting for recipient or resource".into()),
        };
        let incoming_row = |owner: Entity, id: u64, s: &OrderState| {
            let action = self
                .world
                .resource::<crate::Content>()
                .0
                .social
                .get(s.entry.intent.interaction as usize)
                .map_or("Talk", |a| a.label.as_str());
            let name = self
                .world
                .get::<terri_core::SimName>(owner)
                .map_or("Housemate", |n| n.0.as_str());
            ActionQueueRow {
                order_id: Some(id),
                label: format!("{}: {}", action, name),
                phase: phase_name(s.phase).into(),
                role: "incoming".into(),
                counterpart: Some(owner.index_u32()),
                reason: None,
            }
        };
        let active_incoming = incoming.iter().find(|((owner, _), _)| {
            self.world
                .get::<Socialising>(*owner)
                .is_some_and(|talk| talk.partner == person)
        });
        let displayed_own = if active_incoming.is_some() {
            None
        } else {
            active_own.map(|((_, id), _)| *id)
        };
        if let Some(((owner, id), s)) = active_incoming {
            rows.push(incoming_row(*owner, *id, s));
        } else if let Some(((_, id), s)) = active_own {
            rows.push(own_row(*id, s));
        } else {
            let label = self
                .action_queue_window_of(index, 1)
                .into_iter()
                .next()
                .unwrap_or_default();
            rows.push(ActionQueueRow {
                order_id: None,
                label,
                phase: "running".into(),
                role: "initiator".into(),
                counterpart: None,
                reason: None,
            });
        }
        if rows.len() == max_rows {
            return rows;
        }
        let eligible = |owner: Entity, id: u64| {
            self.world
                .get::<IntentQueue>(owner)
                .is_some_and(|q| q.entries().first().is_some_and(|entry| entry.id == id))
        };
        for ((owner, id), s) in &incoming {
            if self
                .world
                .get::<Socialising>(*owner)
                .is_none_or(|talk| talk.partner != person)
                && eligible(*owner, *id)
            {
                rows.push(incoming_row(*owner, *id, s));
                if rows.len() == max_rows {
                    return rows;
                }
            }
        }
        if let Some(queue) = own {
            for entry in queue.entries() {
                if Some(entry.id) == displayed_own {
                    continue;
                }
                if let Some(state) = actions.orders.get(&(person, entry.id)) {
                    rows.push(own_row(entry.id, state));
                } else {
                    rows.push(ActionQueueRow {
                        order_id: Some(entry.id),
                        label: label(&self.world, entry),
                        phase: "queued".into(),
                        role: "initiator".into(),
                        counterpart: None,
                        reason: None,
                    });
                }
                if rows.len() == max_rows {
                    return rows;
                }
            }
        }
        for ((owner, id), s) in incoming {
            if !eligible(*owner, *id) {
                rows.push(incoming_row(*owner, *id, s));
                if rows.len() == max_rows {
                    return rows;
                }
            }
        }
        rows
    }
}

fn maintain_served_orders(world: &mut World) {
    let stale: Vec<_> = world
        .query::<(Entity, &ServedOrder)>()
        .iter(world)
        .filter(|(actor, owner)| {
            world
                .get::<IntentQueue>(*actor)
                .and_then(|q| q.order(owner.0))
                .is_none_or(|order| {
                    world.get::<Target>(*actor).is_none_or(|target| {
                        target.object != order.intent.object
                            || target.interaction != order.intent.interaction
                    })
                })
        })
        .map(|(actor, _)| actor)
        .collect();
    for actor in stale {
        world.entity_mut(actor).remove::<ServedOrder>();
    }
}

/// Historical object actions used matching queue-front intent as their owner.
/// New V15 loads replace this inference with their explicit saved companion.
pub(crate) fn adopt_legacy_objects(world: &mut World) {
    let owners: Vec<_> = world
        .query::<(Entity, &Target, &IntentQueue)>()
        .iter(world)
        .filter_map(|(actor, target, queue)| {
            let object = world.get::<terri_core::SmartObject>(target.object)?;
            let action = world
                .resource::<crate::Content>()
                .0
                .object(object.0)
                .interactions
                .get(target.interaction as usize)?;
            if action.book_reading {
                return None;
            }
            let entry = queue.entries().first()?;
            (entry.intent.object == target.object
                && entry.intent.interaction == target.interaction
                && entry.intent.cleanup.is_none()
                && entry.intent.chore.is_none()
                && entry.title_id.is_none())
            .then_some((actor, entry.id))
        })
        .collect();
    for (actor, id) in owners {
        world.entity_mut(actor).insert(ServedOrder(id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_core::{CommandQueue, SimCommand, SmartObject};
    fn fixture() -> (crate::Sim, Entity, Entity) {
        let mut sim = crate::Sim::new_from_shipped_lot();
        let actor = sim
            .world_mut()
            .query_filtered::<Entity, With<Agent>>()
            .iter(sim.world())
            .next()
            .unwrap();
        let pack = sim.world().resource::<crate::Content>().0;
        let (object, definition) = sim
            .world_mut()
            .query::<(Entity, &SmartObject)>()
            .iter(sim.world())
            .find(|(_, object)| pack.object(object.0).id == "fridge")
            .map(|(object, definition)| (object, definition.0))
            .unwrap();
        assert!(crate::action_rows::resolve(pack, definition, 0).is_some_and(|row| row.public));
        (sim, actor, object)
    }
    #[test]
    fn diagnostics_ring_is_incremental_bounded_and_does_not_change_gameplay_hash() {
        let (mut sim, actor, _) = fixture();
        let before = sim.world_hash();
        for _ in 0..2050 {
            reject_submission(sim.world_mut(), actor.index_u32(), "Stale confirmation");
        }
        assert_eq!(sim.world_hash(), before);
        let history = sim.action_events_since(0);
        assert_eq!(history.events.len(), 2048);
        assert!(history.expired);
        assert_eq!(history.events[0].sequence, 3);
        assert_eq!(history.next_cursor, 2050);
        let tail = sim.action_events_since(2048);
        assert_eq!(
            tail.events.iter().map(|e| e.sequence).collect::<Vec<_>>(),
            vec![2049, 2050]
        );
        assert!(!tail.expired);
        assert!(sim.action_events_since(2050).events.is_empty());
    }

    #[test]
    fn accepted_and_canceled_capture_uses_bounded_session_history_without_affecting_continuation() {
        let (mut sim, actor, object) = fixture();
        for _ in 0..1025 {
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::UseObject {
                    agent: actor.index_u32(),
                    object: object.index_u32(),
                    interaction: 0,
                });
            sim.flush_commands();
            sim.world_mut()
                .resource_mut::<CommandQueue>()
                .push(SimCommand::CancelIntents {
                    agent: actor.index_u32(),
                });
            sim.flush_commands();
        }
        let before = sim.world_hash();
        let history = sim.action_events_since(0);
        assert_eq!(history.events.len(), 2048);
        assert!(history.expired);
        assert_eq!(history.events[0].sequence, 3);
        assert_eq!(history.next_cursor, 2050);
        assert_eq!(history.events[0].phase, "accepted");
        assert_eq!(history.events[0].order_id, 1);
        let tail = sim.action_events_since(2048);
        assert!(!tail.expired);
        assert_eq!(
            tail.events
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            [2049, 2050]
        );
        assert_eq!(
            tail.events
                .iter()
                .map(|event| event.phase.as_str())
                .collect::<Vec<_>>(),
            ["accepted", "canceled"]
        );
        assert!(tail
            .events
            .iter()
            .all(|event| event.actor == actor.index_u32() && event.order_id == 1024));
        let empty = sim.action_events_since(2050);
        assert!(empty.events.is_empty());
        assert_eq!(empty.next_cursor, 2050);
        assert_eq!(sim.world_hash(), before);

        let saved = sim.save_snapshot_v15();
        let mut loaded = crate::Sim::new_from_shipped_lot();
        loaded.load_snapshot_v15(saved.clone()).unwrap();
        assert!(loaded.action_events_since(0).events.is_empty());
        assert_eq!(loaded.save_snapshot_v15(), saved);
        assert_eq!(loaded.world_hash(), before);
        for _ in 0..8 {
            sim.tick();
            loaded.tick();
            assert_eq!(loaded.save_snapshot_v15(), sim.save_snapshot_v15());
            assert_eq!(loaded.world_hash(), sim.world_hash());
        }
    }

    #[test]
    fn cancel_and_invalid_action_have_separate_exactly_once_terminal_outcomes() {
        let (mut sim, actor, object) = fixture();
        let command = SimCommand::UseObject {
            agent: actor.index_u32(),
            object: object.index_u32(),
            interaction: 0,
        };
        sim.world_mut().resource_mut::<CommandQueue>().push(command);
        sim.flush_commands();
        let id = sim.world().get::<IntentQueue>(actor).unwrap().entries()[0].id;
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::CancelIntents {
                agent: actor.index_u32(),
            });
        sim.flush_commands();
        let canceled = sim
            .action_events_since(0)
            .events
            .into_iter()
            .filter(|e| e.order_id == id)
            .collect::<Vec<_>>();
        assert_eq!(
            canceled
                .iter()
                .map(|e| e.phase.as_str())
                .collect::<Vec<_>>(),
            vec!["accepted", "canceled"]
        );
        let invalid_id = sim.world().get::<IntentQueue>(actor).unwrap().next_id();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObject {
                agent: actor.index_u32(),
                object: object.index_u32(),
                interaction: u32::MAX,
            });
        sim.flush_commands();
        assert!(sim.world().get::<IntentQueue>(actor).unwrap().is_empty());
        let immediate = sim
            .action_events_since(0)
            .events
            .into_iter()
            .filter(|event| event.actor == actor.index_u32() && event.order_id == invalid_id)
            .collect::<Vec<_>>();
        assert_eq!(
            immediate
                .iter()
                .map(|event| event.phase.as_str())
                .collect::<Vec<_>>(),
            ["accepted", "failed"]
        );
        assert_eq!(
            immediate[1].reason.as_deref(),
            Some("Unknown object action")
        );
        for _ in 0..3 {
            sim.tick();
        }
        let failed = sim
            .action_events_since(0)
            .events
            .into_iter()
            .filter(|e| {
                e.actor == actor.index_u32() && e.order_id == invalid_id && e.phase == "failed"
            })
            .collect::<Vec<_>>();
        assert_eq!(failed.len(), 1);
        assert!(failed[0].reason.is_some());
    }

    #[test]
    fn current_reader_rejects_missing_or_mismatched_ownership_atomically() {
        let (mut sim, actor, object) = fixture();
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObject {
                agent: actor.index_u32(),
                object: object.index_u32(),
                interaction: 0,
            });
        sim.flush_commands();
        let snapshot = sim.save_snapshot_v15();
        assert_eq!(snapshot.player_orders.orders.len(), 1);
        let before = sim.world_hash();
        for mutation in 0..3 {
            let mut malformed = snapshot.clone();
            match mutation {
                0 => malformed.player_orders.orders.clear(),
                1 => malformed.player_orders.orders[0].interaction = u32::MAX,
                _ => {
                    let mut duplicate = malformed.player_orders.orders[0].clone();
                    duplicate.acceptance = malformed.player_orders.next_acceptance;
                    malformed.player_orders.next_acceptance += 1;
                    malformed.player_orders.orders.push(duplicate);
                }
            }
            assert!(sim.load_snapshot_v15(malformed).is_err());
            assert_eq!(sim.world_hash(), before);
        }
    }
}
