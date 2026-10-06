use super::{add, value};
use bevy_ecs::prelude::*;
use terri_core::{
    chores::*, Agent, AtWork, ChainState, Commuting, Eating, Intent, IntentQueue, Needs, Path,
    Position, SimClock, SmartObject, Socialising, Target, TileGrid,
};

pub(crate) fn key_valid(world: &World, key: ChoreKey) -> bool {
    match key.kind {
        ChoreKind::Dishes => key.target == 0,
        ChoreKind::Floors => {
            let width = world.resource::<TileGrid>().width() as u32;
            crate::room_regions::RoomRegions::from_world(world)
                .at(((key.target % width) as i32, (key.target / width) as i32))
                == Some(key.target)
        }
        ChoreKind::Surfaces => crate::targeted_cleanup::surface(world, key.target).is_some(),
        ChoreKind::Bins => crate::dining::entity(world, key.target)
            .and_then(|e| world.get::<SmartObject>(e))
            .is_some_and(|o| world.resource::<crate::Content>().0.object(o.0).id == "trashcan"),
        ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces => {
            !super::groups::members(world, key).is_empty()
        }
    }
}

pub(crate) fn issue(state: &mut SavedChores, person: u32, key: ChoreKey) -> Option<u32> {
    let id = state.next_order;
    state.next_order = state.next_order.checked_add(1)?;
    state.orders.push(ChoreOrder {
        id,
        person,
        key,
        queue_position: 0,
    });
    Some(id)
}

pub(super) fn may_release_path(world: &World, person: Entity) -> bool {
    world.get::<Target>(person).is_none()
        && world.get::<Commuting>(person).is_none()
        && world.get::<Socialising>(person).is_none()
        && world.get::<ChainState>(person).is_none()
}

pub(crate) fn cancel(world: &mut World, person: Entity) {
    super::grime::forget(world, person.index_u32());
    if let Some(mut state) = world.get_resource_mut::<SavedChores>() {
        state.tasks.retain(|t| t.person != person.index_u32());
        state.dish_started.retain(|r| r.0 != person.index_u32());
    }
    let owns = world.get::<ChoreWork>(person).is_some() && may_release_path(world, person);
    if let Ok(mut p) = world.get_entity_mut(person) {
        p.remove::<ChoreWork>();
        if owns {
            p.remove::<Path>();
        }
    }
}

pub(crate) fn start(
    world: &mut World,
    state: &mut SavedChores,
    person: Entity,
    key: ChoreKey,
    directed: bool,
) -> bool {
    super::grime::ensure(world, state);
    if key.kind == ChoreKind::Dishes {
        return start_dishes(world, state, person, directed);
    }
    if matches!(key.kind, ChoreKind::Surfaces | ChoreKind::Bins) {
        if state
            .tasks
            .iter()
            .any(|t| super::groups::claims(t, key.target) && t.person != person.index_u32())
        {
            return false;
        }
        if world.try_query::<(Entity, &Target)>().is_some_and(|mut q| {
            q.iter(world)
                .any(|(owner, target)| owner != person && target.object.index_u32() == key.target)
        }) {
            return false;
        }
        if key.kind == ChoreKind::Surfaces
            && world
                .get_resource::<terri_core::save::SavedDomestic>()
                .is_some_and(|s| {
                    s.dishes
                        .iter()
                        .any(|d| d.surface == key.target && crate::domestic::visible(s, d.id))
                })
        {
            return false;
        }
    }
    if !key_valid(world, key)
        || state
            .tasks
            .iter()
            .any(|t| t.key == key || t.person == person.index_u32())
    {
        return false;
    }
    let grid = world.resource::<TileGrid>();
    let Some(pos) = world.get::<Position>(person).copied() else {
        return false;
    };
    let from = (pos.x.round() as i32, pos.y.round() as i32);
    let (cells, endpoint) = match key.kind {
        ChoreKind::Floors => {
            let rooms = crate::room_regions::RoomRegions::from_world(world);
            let cells: Vec<_> = state
                .floors
                .iter()
                .filter(|(cell, amount)| {
                    let xy = (
                        (*cell as usize % grid.width()) as i32,
                        (*cell as usize / grid.width()) as i32,
                    );
                    *amount > 0
                        && rooms.at(xy) == Some(key.target)
                        && grid.is_walkable(xy.0, xy.1)
                        && grid.find_path(from, xy).is_some()
                })
                .map(|r| r.0)
                .collect();
            (cells, None)
        }
        ChoreKind::Surfaces | ChoreKind::Bins => {
            let dirty = if key.kind == ChoreKind::Surfaces {
                value(&state.surfaces, key.target)
            } else {
                value(&state.bins, key.target)
            };
            if dirty == 0 {
                return false;
            }
            let Some(object) = crate::dining::entity(world, key.target) else {
                return false;
            };
            let Some(pos) = world.get::<Position>(object).copied() else {
                return false;
            };
            let definition = world.get::<SmartObject>(object).unwrap();
            let footprint = crate::placed_footprint(
                world.resource::<crate::Content>().0,
                definition.0,
                world.get::<terri_core::ObjectFacing>(object),
            );
            let Some(path) = grid.find_path_adjacent(
                from,
                (pos.x.round() as i32, pos.y.round() as i32),
                footprint,
            ) else {
                return false;
            };
            let end = path.last().copied().unwrap_or(from);
            (
                vec![key.target],
                Some(end.1 as u32 * grid.width() as u32 + end.0 as u32),
            )
        }
        ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces => (
            super::groups::members(world, key)
                .into_iter()
                .filter(|id| value(&state.surfaces, *id) > 0)
                .collect(),
            None,
        ),
        ChoreKind::Dishes => return false,
    };
    if cells.is_empty() {
        return false;
    }
    if key.kind.grouped()
        && cells.iter().any(|id| {
            state
                .tasks
                .iter()
                .any(|t| t.person != person.index_u32() && super::groups::claims(t, *id))
        })
    {
        return false;
    }
    super::grime::forget(world, person.index_u32());
    crate::domestic::abandon(world, person);
    if let Some(target) = world.get::<Target>(person).copied() {
        crate::reservations::release_now(world, person, target);
    }
    world
        .entity_mut(person)
        .remove::<Target>()
        .remove::<Path>()
        .remove::<Eating>()
        .remove::<Socialising>()
        .remove::<terri_core::ConversationVoice>()
        .remove::<terri_core::StepWork>()
        .remove::<terri_core::Carrying>()
        .remove::<ChainState>()
        .remove::<terri_core::Restless>()
        .insert(ChoreWork);
    let day = world.resource::<SimClock>().tick
        / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks);
    state.tasks.push(ChoreTask {
        person: person.index_u32(),
        key,
        cells,
        cursor: 0,
        endpoint,
        remaining: 0,
        directed,
        suspended: false,
        started_day: day,
        completed_units: 0,
    });
    state.tasks.sort_by_key(|t| t.person);
    true
}

fn start_dishes(
    world: &mut World,
    state: &mut SavedChores,
    person: Entity,
    directed: bool,
) -> bool {
    if !crate::targeted_cleanup::washing_available(world, person) {
        return false;
    }
    if world
        .get_resource::<terri_core::save::SavedDomestic>()
        .is_none_or(|s| {
            !s.dishes.iter().any(|d| {
                crate::domestic::visible(s, d.id)
                    && !s.cleanup.iter().any(|c| c.dishes.contains(&d.id))
            })
        })
    {
        return false;
    }
    state.tasks.retain(|t| t.person != person.index_u32());
    if let Some(target) = world.get::<Target>(person).copied() {
        crate::reservations::release_now(world, person, target);
    }
    world
        .entity_mut(person)
        .remove::<Target>()
        .remove::<Path>()
        .remove::<Eating>()
        .remove::<Socialising>()
        .remove::<terri_core::ConversationVoice>()
        .remove::<terri_core::StepWork>()
        .remove::<terri_core::Carrying>()
        .remove::<ChainState>()
        .remove::<ChoreWork>();
    crate::domestic::directed_cleanup(world, person);
    if let Some(mut domestic) = world.get_resource_mut::<terri_core::save::SavedDomestic>() {
        if let Some(task) = domestic
            .cleanup
            .iter_mut()
            .find(|t| t.person == person.index_u32())
        {
            task.directed = directed;
            let day = world.resource::<SimClock>().tick
                / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks);
            state.dish_started.retain(|r| r.0 != person.index_u32());
            state.dish_started.push((person.index_u32(), day));
            state.dish_started.sort_unstable();
            return true;
        }
    }
    false
}

pub(crate) fn activate(world: &mut World, person: Entity, id: u32) {
    let Some(mut state) = world.remove_resource::<SavedChores>() else {
        return;
    };
    let order = state
        .orders
        .iter()
        .find(|o| o.id == id && o.person == person.index_u32())
        .cloned();
    if let Some(order) = order {
        let contended = state.tasks.iter().any(|t| {
            t.person != person.index_u32()
                && (t.key == order.key
                    || (matches!(order.key.kind, ChoreKind::Surfaces | ChoreKind::Bins)
                        && super::groups::claims(t, order.key.target))
                    || (order.key.kind.grouped()
                        && super::groups::members(world, order.key)
                            .iter()
                            .any(|id| super::groups::claims(t, *id))))
        }) || (matches!(order.key.kind, ChoreKind::Surfaces | ChoreKind::Bins)
            && world.try_query::<(Entity, &Target)>().is_some_and(|mut q| {
                q.iter(world).any(|(owner, target)| {
                    owner != person && target.object.index_u32() == order.key.target
                })
            }));
        if contended {
            if world.get::<IntentQueue>(person).is_none() {
                world.entity_mut(person).insert(IntentQueue::default());
            }
            world
                .get_mut::<IntentQueue>(person)
                .unwrap()
                .push_front(Intent {
                    object: person,
                    interaction: 0,
                    cleanup: None,
                    chore: Some(id),
                });
        } else {
            let prior = state
                .tasks
                .iter()
                .find(|t| t.person == person.index_u32())
                .cloned();
            state.tasks.retain(|t| t.person != person.index_u32());
            if !start(world, &mut state, person, order.key, true) {
                if let Some(prior) = prior {
                    state.tasks.push(prior);
                    state.tasks.sort_by_key(|t| t.person);
                }
            }
            state.orders.retain(|o| o.id != id);
        }
    }
    world.insert_resource(state);
}

pub(super) fn contact_valid(world: &World, key: ChoreKey, cell: u32) -> bool {
    let Some(object) = crate::dining::entity(world, key.target) else {
        return false;
    };
    let Some(pos) = world.get::<Position>(object) else {
        return false;
    };
    let Some(def) = world.get::<SmartObject>(object) else {
        return false;
    };
    let footprint = crate::placed_footprint(
        world.resource::<crate::Content>().0,
        def.0,
        world.get::<terri_core::ObjectFacing>(object),
    );
    let grid = world.resource::<TileGrid>();
    let (x, y) = (
        (cell as usize % grid.width()) as i32,
        (cell as usize / grid.width()) as i32,
    );
    let (ox, oy) = (pos.x.round() as i32, pos.y.round() as i32);
    grid.is_walkable(x, y) && grid.can_interact_with_rect((x, y), (ox, oy), footprint)
}

pub(super) fn contact(world: &World, task: &ChoreTask) -> Option<u32> {
    let person = crate::dining::entity(world, task.person)?;
    let from = world.get::<Position>(person)?;
    let object = crate::dining::entity(world, super::groups::current_key(task).target)?;
    let pos = world.get::<Position>(object)?;
    let def = world.get::<SmartObject>(object)?;
    let grid = world.resource::<TileGrid>();
    let from = (from.x.round() as i32, from.y.round() as i32);
    let footprint = crate::placed_footprint(
        world.resource::<crate::Content>().0,
        def.0,
        world.get::<terri_core::ObjectFacing>(object),
    );
    let path = grid.find_path_adjacent(
        from,
        (pos.x.round() as i32, pos.y.round() as i32),
        footprint,
    )?;
    let end = path.last().copied().unwrap_or(from);
    Some(end.1 as u32 * grid.width() as u32 + end.0 as u32)
}

pub(super) fn plan_valid(world: &World, task: &ChoreTask) -> bool {
    if !key_valid(world, task.key) || task.key.kind == ChoreKind::Dishes {
        return false;
    }
    if task.key.kind != ChoreKind::Floors {
        return true;
    }
    let grid = world.resource::<TileGrid>();
    let rooms = crate::room_regions::RoomRegions::from_world(world);
    task.cells.iter().all(|cell| {
        rooms.at((
            (*cell as usize % grid.width()) as i32,
            (*cell as usize / grid.width()) as i32,
        )) == Some(task.key.target)
    })
}

fn busy(world: &World, person: Entity) -> bool {
    world.get::<Target>(person).is_some()
        || world.get::<Eating>(person).is_some()
        || world.get::<Socialising>(person).is_some()
        || world.get::<AtWork>(person).is_some()
        || world.get::<Commuting>(person).is_some()
        || world.get::<ChainState>(person).is_some()
}

pub(crate) fn advance(world: &mut World, state: &mut SavedChores) {
    super::groups::reconcile(world, state);
    let mut finished = vec![];
    let width = world.resource::<TileGrid>().width() as u32;
    for index in 0..state.tasks.len() {
        let target = super::groups::current_key(&state.tasks[index]);
        let contended = target.kind != ChoreKind::Floors
            && state
                .tasks
                .iter()
                .enumerate()
                .any(|(other, t)| other != index && super::groups::claims(t, target.target));
        let task = &mut state.tasks[index];
        let Some(person) = crate::dining::entity(world, task.person).filter(|e| {
            world.get::<Agent>(*e).is_some()
                && world.get::<Needs>(*e).is_some()
                && world.get::<Position>(*e).is_some()
        }) else {
            finished.push((task.person, None));
            continue;
        };
        if !plan_valid(world, task) {
            finished.push((task.person, None));
            continue;
        }
        if task.cursor as usize >= task.cells.len() {
            finished.push((
                task.person,
                Some((task.key, task.started_day, task.completed_units)),
            ));
            continue;
        }
        let current_key = super::groups::current_key(task);
        let urgent = world.get::<Needs>(person).is_some_and(|n| {
            [
                terri_core::NeedId::Energy,
                terri_core::NeedId::Hunger,
                terri_core::NeedId::Bladder,
            ]
            .iter()
            .any(|id| {
                n.get(*id)
                    <= world
                        .resource::<crate::Content>()
                        .0
                        .tuning
                        .mood_critical_need_level
            })
        });
        if contended
            || busy(world, person)
            || (!task.directed && urgent)
            || world
                .get::<IntentQueue>(person)
                .and_then(IntentQueue::front)
                .is_some_and(|order| {
                    let queued_chain = world.get::<SmartObject>(order.object).and_then(|placed| {
                        crate::systems::chain::ordered_chain(
                            world.resource::<crate::Content>().0,
                            placed.0,
                            order.interaction,
                        )
                    });
                    !(task.directed && (order.cleanup.is_some() || queued_chain.is_some()))
                })
        {
            if !task.suspended && may_release_path(world, person) {
                world.entity_mut(person).remove::<Path>();
            }
            task.suspended = true;
            world.entity_mut(person).remove::<ChoreWork>();
            continue;
        }
        if task.key.kind != ChoreKind::Floors
            && world.try_query::<(Entity, &Target)>().is_some_and(|mut q| {
                q.iter(world).any(|(owner, target)| {
                    owner != person && target.object.index_u32() == current_key.target
                })
            })
        {
            if !task.suspended {
                world.entity_mut(person).remove::<Path>();
            }
            task.suspended = true;
            world.entity_mut(person).remove::<ChoreWork>();
            continue;
        }
        if task.key.kind != ChoreKind::Floors
            && (task.suspended
                || task
                    .endpoint
                    .is_none_or(|cell| !contact_valid(world, current_key, cell)))
        {
            let Some(endpoint) = contact(world, task) else {
                finished.push((task.person, None));
                continue;
            };
            if task.endpoint != Some(endpoint) {
                task.remaining = 0;
            }
            task.endpoint = Some(endpoint);
        }
        if task.suspended {
            task.suspended = false;
            world
                .entity_mut(person)
                .remove::<terri_core::Restless>()
                .remove::<terri_core::Wander>()
                .insert(ChoreWork);
        }
        if world.get::<Path>(person).is_some() {
            continue;
        }
        if task.key.kind == ChoreKind::Floors
            && !world
                .resource::<terri_core::grime::SavedGrime>()
                .legacy_floors
                .contains(&task.person)
        {
            match super::patches::advance(world, task, &mut state.floors) {
                super::patches::Progress::Working => {}
                super::patches::Progress::Done => finished.push((
                    task.person,
                    Some((task.key, task.started_day, task.completed_units)),
                )),
                super::patches::Progress::Unavailable => finished.push((task.person, None)),
            }
            continue;
        }
        if task.cursor as usize >= task.cells.len() {
            finished.push((
                task.person,
                Some((task.key, task.started_day, task.completed_units)),
            ));
            continue;
        }
        let cell = task.cells[task.cursor as usize];
        let endpoint = if task.key.kind == ChoreKind::Floors {
            cell
        } else {
            task.endpoint.unwrap()
        };
        if task.key.kind != ChoreKind::Floors
            && world.try_query::<(Entity, &Target)>().is_some_and(|mut q| {
                q.iter(world).any(|(owner, target)| {
                    owner != person && target.object.index_u32() == current_key.target
                })
            })
        {
            task.suspended = true;
            world.entity_mut(person).remove::<ChoreWork>();
            continue;
        }
        let xy = ((endpoint % width) as i32, (endpoint / width) as i32);
        let pos = world.get::<Position>(person).copied().unwrap();
        if (pos.x - xy.0 as f32).abs() > 0.01 || (pos.y - xy.1 as f32).abs() > 0.01 {
            let grid = world.resource::<TileGrid>();
            let from = (pos.x.round() as i32, pos.y.round() as i32);
            let Some(path) = grid
                .find_path(from, xy)
                .and_then(|p| grid.anchor_path((pos.x, pos.y), p))
            else {
                finished.push((task.person, None));
                continue;
            };
            if path.is_empty() {
                finished.push((task.person, None));
                continue;
            }
            world.entity_mut(person).insert(Path {
                steps: path,
                cursor: 0,
            });
            continue;
        }
        if task.remaining == 0 {
            task.remaining = match task.key.kind {
                ChoreKind::Floors => 12,
                ChoreKind::Surfaces | ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces => 45,
                ChoreKind::Bins => 60,
                ChoreKind::Dishes => 0,
            };
        }
        if matches!(
            task.key.kind,
            ChoreKind::Surfaces | ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces
        ) {
            task.completed_units += super::patches::fade(&mut state.surfaces, cell, task.remaining);
        }
        task.remaining -= 1;
        if task.remaining == 0 {
            let rows = match task.key.kind {
                ChoreKind::Floors => &mut state.floors,
                ChoreKind::Surfaces | ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces => {
                    &mut state.surfaces
                }
                ChoreKind::Bins => &mut state.bins,
                ChoreKind::Dishes => unreachable!(),
            };
            task.completed_units += u32::from(value(rows, cell));
            rows.retain(|r| r.0 != cell);
            task.cursor += 1;
            if task.key.kind == ChoreKind::Floors {
                super::grime::forget(world, task.person);
            }
            if task.key.kind.grouped() {
                task.endpoint = None;
            }
            if task.cursor as usize == task.cells.len() {
                finished.push((
                    task.person,
                    Some((task.key, task.started_day, task.completed_units)),
                ));
            }
        }
    }
    for (person, credit) in finished {
        super::grime::forget(world, person);
        if credit.is_none() {
            if let Some(task) = state.tasks.iter().find(|t| t.person == person) {
                for episode in &mut state.episodes {
                    if episode.key == task.key
                        && episode.day == task.started_day
                        && !episode.settled
                    {
                        episode.unavailable = true;
                    }
                }
            }
        }
        state.tasks.retain(|t| t.person != person);
        if let Some(entity) = crate::dining::entity(world, person) {
            world.entity_mut(entity).remove::<ChoreWork>();
            if may_release_path(world, entity) {
                world.entity_mut(entity).remove::<Path>();
            }
        }
        if let Some((key, day, units)) = credit {
            if key.kind == ChoreKind::Bins {
                state.disposed = state.disposed.saturating_add(u64::from(units));
            }
            super::completed(world, state, person, key, day, units);
        }
    }
}

pub(crate) fn soil(world: &mut World, _surface: u32, units: u16) {
    super::ensure(world);
    let bin = world
        .try_query::<(Entity, &SmartObject)>()
        .into_iter()
        .flat_map(|mut q| {
            q.iter(world)
                .filter(|(_, o)| world.resource::<crate::Content>().0.object(o.0).id == "trashcan")
                .map(|(e, _)| e.index_u32())
                .collect::<Vec<_>>()
        })
        .min();
    let mut state = world.resource_mut::<SavedChores>();

    if let Some(bin) = bin {
        let amount = u32::from(units).min(1000 - u32::from(value(&state.bins, bin)));
        add(&mut state.bins, bin, amount);
        state.unbinned = state.unbinned.saturating_add(u32::from(units) - amount);
    } else {
        state.unbinned = state.unbinned.saturating_add(u32::from(units));
    }
}
