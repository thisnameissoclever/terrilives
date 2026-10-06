//! Scoped player chores retain exact selections through queues and saves.
use crate::{Content, SaveError};
use bevy_ecs::prelude::*;
use std::collections::BTreeSet;
use terri_core::{
    save::*, Agent, ChainState, Intent, IntentQueue, Position, SmartObject, TileGrid,
};

pub(crate) fn surface(world: &World, index: u32) -> Option<Entity> {
    let e = crate::dining::entity(world, index)?;
    let object = world.get::<SmartObject>(e)?;
    let pack = world.resource::<Content>().0;
    is_surface(pack, object.0).then_some(e)
}

pub(crate) fn is_surface(pack: &terri_data::ContentPack, object: terri_core::ObjectDefId) -> bool {
    let roles = &pack.object(object).roles;
    let has = |name| roles.iter().any(|r| pack.roles[*r as usize] == name);
    has("meal_table") || (has("prep_surface") && !has("dish_sink"))
}

pub(crate) fn valid_selection(dishes: &Option<Vec<u32>>) -> bool {
    dishes.as_ref().is_none_or(|ids| {
        !ids.is_empty() && ids.len() <= 100_000 && ids.windows(2).all(|p| p[0] < p[1])
    })
}

pub(crate) fn issue(
    state: &mut SavedTargetedCleanup,
    person: u32,
    surface: u32,
    dishes: Option<Vec<u32>>,
) -> Option<u32> {
    if !valid_selection(&dishes) {
        return None;
    }
    let id = state.next_order;
    state.next_order = state.next_order.checked_add(1)?;
    state.orders.push(SavedCleanupOrder {
        id,
        person,
        surface,
        dishes,
        queue_position: Some(0),
    });
    Some(id)
}

pub(crate) fn active_surface(world: &World, person: u32) -> Option<u32> {
    world
        .get_resource::<SavedTargetedCleanup>()?
        .orders
        .iter()
        .find(|o| o.person == person && o.queue_position.is_none() && o.dishes.is_none())
        .map(|o| o.surface)
}

pub(crate) fn has_active(world: &World, person: u32) -> bool {
    world
        .get_resource::<SavedTargetedCleanup>()
        .is_some_and(|s| {
            s.orders
                .iter()
                .any(|o| o.person == person && o.queue_position.is_none())
        })
}

/// Validate a replacement before releasing the current scoped work.
pub(crate) fn interrupt_for_order(world: &mut World, person: Entity, id: u32) {
    let valid = world
        .get_resource::<SavedTargetedCleanup>()
        .and_then(|state| state.orders.iter().find(|order| order.id == id))
        .filter(|order| order.person == person.index_u32())
        .is_some_and(|order| {
            surface(world, order.surface).is_some_and(|station| reachable(world, person, station))
                && washing_available(world, person)
                && {
                    let (ids, visible) = candidates(world, order);
                    !ids.is_empty() || visible
                }
        });
    if valid {
        crate::chores::cancel(world, person);
        interrupt_active(world, person);
    }
}

pub(crate) fn interrupt_for_sink(world: &mut World, person: Entity, sink: Entity) {
    if reachable(world, person, sink) && washing_available(world, person) {
        crate::chores::cancel(world, person);
        interrupt_active(world, person);
    }
}

/// A plain front order replaces the active scope at the command boundary.
/// Waiting scoped orders remain queued and carried dishes use normal restoration.
pub(crate) fn interrupt_active(world: &mut World, person: Entity) {
    if !has_active(world, person.index_u32()) {
        return;
    }
    if let Some(target) = world.get::<terri_core::Target>(person).copied() {
        crate::reservations::release_now(world, person, target);
    }
    crate::domestic::abandon(world, person);
    world
        .entity_mut(person)
        .remove::<terri_core::Target>()
        .remove::<terri_core::Path>()
        .remove::<terri_core::Eating>()
        .remove::<terri_core::StepWork>()
        .remove::<terri_core::Carrying>()
        .remove::<ChainState>();
}

pub(crate) fn abandon(world: &mut World, person: u32) {
    if let Some(mut state) = world.get_resource_mut::<SavedTargetedCleanup>() {
        state
            .orders
            .retain(|o| o.person != person || o.queue_position.is_some());
    }
}

pub(crate) fn reachable(world: &World, person: Entity, object: Entity) -> bool {
    let (Some(from), Some(to), Some(placed)) = (
        world.get::<Position>(person),
        world.get::<Position>(object),
        world.get::<SmartObject>(object),
    ) else {
        return false;
    };
    let footprint = crate::placed_footprint(
        world.resource::<Content>().0,
        placed.0,
        world.get::<terri_core::ObjectFacing>(object),
    );
    world
        .resource::<TileGrid>()
        .find_path_adjacent(
            (from.x.round() as i32, from.y.round() as i32),
            (to.x.round() as i32, to.y.round() as i32),
            footprint,
        )
        .is_some()
}

pub(crate) fn washing_available(world: &World, person: Entity) -> bool {
    let pack = world.resource::<Content>().0;
    let Some(mut objects) = world.try_query::<(Entity, &SmartObject)>() else {
        return false;
    };
    objects.iter(world).any(|(e, o)| {
        pack.object(o.0)
            .roles
            .iter()
            .any(|r| pack.roles[*r as usize] == "dish_sink")
            && reachable(world, person, e)
    })
}

fn candidates(world: &World, order: &SavedCleanupOrder) -> (Vec<u32>, bool) {
    let Some(state) = world.get_resource::<SavedDomestic>() else {
        return (vec![], false);
    };
    let matching = |d: &&SavedDishes| {
        d.surface == order.surface && order.dishes.as_ref().is_none_or(|ids| ids.contains(&d.id))
    };
    let visible = state
        .dishes
        .iter()
        .filter(matching)
        .any(|d| crate::domestic::visible(state, d.id));
    let ids = state
        .dishes
        .iter()
        .filter(matching)
        .filter(|d| !state.cleanup.iter().any(|t| t.dishes.contains(&d.id)))
        .map(|d| d.id)
        .collect();
    (ids, visible)
}

pub(crate) fn activate(world: &mut World, person: Entity, id: u32) {
    let order = world
        .get_resource::<SavedTargetedCleanup>()
        .and_then(|s| s.orders.iter().find(|o| o.id == id))
        .cloned();
    let Some(mut order) = order else {
        return;
    };
    let Some(station) = surface(world, order.surface) else {
        remove_order(world, id);
        return;
    };
    if order.person != person.index_u32()
        || !reachable(world, person, station)
        || !washing_available(world, person)
    {
        remove_order(world, id);
        return;
    }
    let (ids, visible) = candidates(world, &order);
    if ids.is_empty() && !visible {
        remove_order(world, id);
        return;
    }
    crate::domestic::abandon(world, person);
    if let Some(target) = world.get::<terri_core::Target>(person).copied() {
        crate::reservations::release_now(world, person, target);
    }
    world
        .entity_mut(person)
        .remove::<terri_core::Target>()
        .remove::<terri_core::Path>()
        .remove::<terri_core::Eating>()
        .remove::<terri_core::Socialising>()
        .remove::<terri_core::ConversationVoice>()
        .remove::<terri_core::StepWork>()
        .remove::<terri_core::Carrying>()
        .remove::<terri_core::Fumbled>()
        .remove::<ChainState>();
    order.queue_position = None;
    if let Some(o) = world
        .resource_mut::<SavedTargetedCleanup>()
        .orders
        .iter_mut()
        .find(|o| o.id == id)
    {
        *o = order.clone();
    }
    let (ids, visible) = candidates(world, &order);
    if ids.is_empty() && !visible {
        remove_order(world, id);
        return;
    }
    begin(world, person, ids);
}

fn remove_order(world: &mut World, id: u32) {
    if let Some(mut s) = world.get_resource_mut::<SavedTargetedCleanup>() {
        s.orders.retain(|o| o.id != id);
    }
}

fn begin(world: &mut World, person: Entity, dishes: Vec<u32>) {
    let Some(chain) = world
        .resource::<Content>()
        .0
        .chains
        .iter()
        .position(|c| c.id == crate::domestic::CLEANUP)
    else {
        return;
    };
    if !world.contains_resource::<SavedDomestic>() {
        world.insert_resource(SavedDomestic::default());
    }
    let mut state = world.resource_mut::<SavedDomestic>();
    state.cleanup.retain(|t| t.person != person.index_u32());
    state.cleanup.push(SavedCleanup {
        person: person.index_u32(),
        dishes,
        collected: vec![],
        directed: true,
    });
    state.cleanup.sort_by_key(|t| t.person);
    world
        .entity_mut(person)
        .insert(ChainState::begin(chain as u32));
}

/// Refresh only collection work. Washing never claims dishes still on a surface.
pub(crate) fn refresh(world: &mut World, person: Entity) {
    let order = world
        .get_resource::<SavedTargetedCleanup>()
        .and_then(|s| {
            s.orders
                .iter()
                .find(|o| o.person == person.index_u32() && o.queue_position.is_none())
        })
        .cloned();
    let Some(order) = order else {
        return;
    };
    if world.get::<ChainState>(person).is_none_or(|c| c.step != 0) {
        return;
    }
    if surface(world, order.surface).is_none() || !washing_available(world, person) {
        crate::domestic::abandon(world, person);
        world.entity_mut(person).remove::<ChainState>();
        return;
    }
    let (ids, visible) = candidates(world, &order);
    let mut state = world.resource_mut::<SavedDomestic>();
    let Some(task) = state
        .cleanup
        .iter_mut()
        .find(|t| t.person == person.index_u32())
    else {
        return;
    };
    task.dishes.extend(ids);
    task.dishes.sort_unstable();
    task.dishes.dedup();
    let empty = task.dishes.is_empty();
    if empty && !visible {
        crate::domestic::abandon(world, person);
        world
            .entity_mut(person)
            .remove::<ChainState>()
            .remove::<terri_core::Blocked>();
    }
}

pub(crate) fn washed(world: &mut World, person: Entity) {
    if active_surface(world, person.index_u32()).is_some() {
        begin(world, person, vec![]);
        refresh(world, person);
    } else {
        abandon(world, person.index_u32());
    }
}

pub(crate) fn tick(world: &mut World) {
    let people: Vec<_> = world
        .get_resource::<SavedTargetedCleanup>()
        .into_iter()
        .flat_map(|s| &s.orders)
        .filter(|o| o.queue_position.is_none())
        .filter_map(|o| crate::dining::entity(world, o.person))
        .collect();
    for person in people {
        refresh(world, person);
    }
    prune(world);
}

pub(crate) fn prune(world: &mut World) {
    let Some(saved) = snapshot(world) else {
        return;
    };
    world.insert_resource(saved);
}

pub(crate) fn snapshot(world: &World) -> Option<SavedTargetedCleanup> {
    let mut state = world.get_resource::<SavedTargetedCleanup>()?.clone();
    state.orders.retain_mut(|o| {
        let Some(person) = crate::dining::entity(world, o.person) else {
            return false;
        };
        if o.queue_position.is_none() {
            return world.get::<ChainState>(person).is_some();
        }
        let position = world
            .get::<IntentQueue>(person)
            .and_then(|q| q.as_slice().iter().position(|i| i.cleanup == Some(o.id)));
        o.queue_position = position.map(|p| p as u32);
        position.is_some()
    });
    (state.next_order > 0 || !state.orders.is_empty()).then_some(state)
}

/// Restore scoped entries into ordinary saved queues before domestic validation.
pub(crate) fn restore(
    world: &mut World,
    state: Option<SavedTargetedCleanup>,
) -> Result<(), SaveError> {
    let Some(state) = state else {
        return Ok(());
    };
    if state.orders.len() > 100_000 || state.orders.windows(2).any(|p| p[0].id >= p[1].id) {
        return Err(SaveError::InvalidValue);
    }
    let mut active = BTreeSet::new();
    for o in &state.orders {
        let person = crate::dining::entity(world, o.person)
            .filter(|e| world.get::<Agent>(*e).is_some())
            .ok_or(SaveError::InvalidValue)?;
        if o.id >= state.next_order
            || surface(world, o.surface).is_none()
            || !valid_selection(&o.dishes)
        {
            return Err(SaveError::InvalidValue);
        }
        if o.queue_position.is_none()
            && (!active.insert(o.person)
                || world.get::<ChainState>(person).is_none_or(|c| {
                    world.resource::<Content>().0.chains[c.chain as usize].id
                        != crate::domestic::CLEANUP
                }))
        {
            return Err(SaveError::InvalidValue);
        }
    }
    let mut queued: Vec<_> = state
        .orders
        .iter()
        .filter(|o| o.queue_position.is_some())
        .collect();
    queued.sort_by_key(|o| (o.person, o.queue_position));
    if queued
        .windows(2)
        .any(|p| (p[0].person, p[0].queue_position) == (p[1].person, p[1].queue_position))
    {
        return Err(SaveError::InvalidValue);
    }
    for o in queued {
        let person = crate::dining::entity(world, o.person).unwrap();
        let mut intents = world
            .get::<IntentQueue>(person)
            .map_or(vec![], |q| q.as_slice().to_vec());
        let position = o.queue_position.unwrap() as usize;
        let cap = world.resource::<Content>().0.tuning.max_queued_intents as usize;
        if position > intents.len() || (cap > 0 && intents.len() >= cap) {
            return Err(SaveError::InvalidValue);
        }
        intents.insert(
            position,
            Intent {
                object: surface(world, o.surface).unwrap(),
                interaction: 0,
                cleanup: Some(o.id),
                chore: None,
            },
        );
        world
            .entity_mut(person)
            .insert(IntentQueue::from_intents(intents));
    }
    world.insert_resource(state);
    Ok(())
}

pub(crate) fn hash(world: &World, hash: &mut terri_core::FnvHasher) {
    let Some(state) = snapshot(world) else {
        return;
    };
    hash.write_bytes(b"targeted-cleanup-v1");
    hash.write_u64(state.next_order as u64);
    hash.write_u64(state.orders.len() as u64);
    for o in state.orders {
        for value in [
            o.id,
            o.person,
            o.surface,
            o.queue_position.unwrap_or(u32::MAX),
        ] {
            hash.write_u64(value as u64);
        }
        hash.write_u64(u64::from(o.dishes.is_some()));
        if let Some(ids) = o.dishes {
            hash.write_u64(ids.len() as u64);
            for id in ids {
                hash.write_u64(id as u64);
            }
        }
    }
}

pub(crate) fn validate_claims(world: &World) -> Result<(), SaveError> {
    let Some(scoped) = world.get_resource::<SavedTargetedCleanup>() else {
        return Ok(());
    };
    let domestic = world.get_resource::<SavedDomestic>();
    for order in &scoped.orders {
        if order.dishes.as_ref().is_some_and(|ids| {
            domestic.is_none_or(|s| {
                ids.iter().any(|id| {
                    *id >= s.next_dish
                        || s.dishes
                            .iter()
                            .any(|d| d.id == *id && d.surface != order.surface)
                })
            })
        }) {
            return Err(SaveError::InvalidValue);
        }
        if order.queue_position.is_none() {
            let task = domestic
                .and_then(|s| s.cleanup.iter().find(|t| t.person == order.person))
                .ok_or(SaveError::InvalidValue)?;
            if !task.directed
                || task.dishes.iter().any(|id| {
                    domestic.is_none_or(|s| {
                        s.dishes
                            .iter()
                            .any(|d| d.id == *id && d.surface != order.surface)
                    }) || order.dishes.as_ref().is_some_and(|ids| !ids.contains(id))
                })
            {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_legacy_capacity(world: &World) -> Result<(), SaveError> {
    if let (Some(domestic), Some(dining)) = (
        world.get_resource::<SavedDomestic>(),
        world.get_resource::<SavedDining>(),
    ) {
        let added: u64 = domestic
            .dishes
            .iter()
            .filter(|d| dining.settings.iter().filter(|(id, _)| *id == d.id).count() > 1)
            .map(|d| u64::from(d.units - 1))
            .sum();
        if u64::from(domestic.next_dish) + added > u64::from(u32::MAX)
            || domestic.dishes.len() as u64 + added > 100_000
        {
            return Err(SaveError::InvalidValue);
        }
    }
    Ok(())
}

/// Flat records: surface, visual slot (4 for the counter), dish identity.
pub(crate) fn piles(world: &World) -> Vec<u32> {
    let Some(domestic) = world.get_resource::<SavedDomestic>() else {
        return vec![];
    };
    let dining = world.get_resource::<SavedDining>();
    let mut rows = vec![];
    for d in &domestic.dishes {
        if !crate::domestic::visible(domestic, d.id) {
            continue;
        }
        if let Some(setting) = dining
            .and_then(|s| s.settings.iter().find(|(id, _)| *id == d.id))
            .map(|(_, s)| *s)
        {
            rows.push((d.surface, [2, 0, 1, 3][setting as usize], d.id));
        } else {
            rows.push((d.surface, 4, d.id));
        }
    }
    rows.sort_unstable();
    rows.into_iter()
        .flat_map(|(surface, slot, id)| [surface, slot, id])
        .collect()
}

/// Old table records could span several settings. Split those records once,
/// retaining every unit, creator, claim and noticed identity.
pub(crate) fn split_legacy_piles(world: &mut World) {
    if !world.get_resource::<SavedDomestic>().is_some_and(|s| {
        s.dishes.iter().any(|d| {
            d.units > 1
                && world.get_resource::<SavedDining>().is_some_and(|dining| {
                    dining.settings.iter().filter(|(id, _)| *id == d.id).count() > 1
                })
        })
    }) {
        return;
    }
    let (Some(mut domestic), Some(mut dining)) = (
        world.get_resource::<SavedDomestic>().cloned(),
        world.get_resource::<SavedDining>().cloned(),
    ) else {
        return;
    };
    let originals = domestic.dishes.clone();
    let mut changed = false;
    for dish in originals {
        let settings: Vec<_> = dining
            .settings
            .iter()
            .filter(|(id, _)| *id == dish.id)
            .map(|(_, s)| *s)
            .collect();
        if settings.len() <= 1 {
            continue;
        }
        let mut replacements = vec![];
        for ordinal in 0..dish.units as usize {
            let setting = settings[ordinal % settings.len()];
            let id = if ordinal == 0 {
                dish.id
            } else {
                let id = domestic.next_dish;
                domestic.next_dish = domestic
                    .next_dish
                    .checked_add(1)
                    .expect("dish identity exhausted");
                id
            };
            let units = 1;
            if ordinal == 0 {
                domestic
                    .dishes
                    .iter_mut()
                    .find(|d| d.id == id)
                    .unwrap()
                    .units = units;
            } else {
                domestic.dishes.push(SavedDishes {
                    id,
                    units,
                    ..dish.clone()
                });
            }
            replacements.push((id, setting));
        }
        let replace = |ids: &mut Vec<u32>| {
            if ids.contains(&dish.id) {
                ids.extend(replacements.iter().map(|(id, _)| *id));
                ids.sort_unstable();
                ids.dedup();
            }
        };
        for task in &mut domestic.cleanup {
            replace(&mut task.dishes);
            replace(&mut task.collected);
        }
        for visit in &mut domestic.visits {
            replace(&mut visit.seen);
        }
        for diner in &mut dining.diners {
            replace(&mut diner.obstructing);
        }
        for (_, ids) in &mut dining.complaints {
            replace(ids);
        }
        for opportunity in &mut dining.opportunities {
            replace(&mut opportunity.known);
        }
        if let Some(mut scoped) = world.get_resource_mut::<SavedTargetedCleanup>() {
            for order in &mut scoped.orders {
                if let Some(ids) = &mut order.dishes {
                    replace(ids);
                }
            }
        }
        dining.settings.retain(|(id, _)| *id != dish.id);
        dining.settings.extend(replacements);
        changed = true;
    }
    if changed {
        domestic.dishes.sort_by_key(|d| d.id);
        dining.settings.sort_unstable();
        world.insert_resource(domestic);
        world.insert_resource(dining);
    }
}
