//! Household dirt, timed work, preferences and weekly commitments.
mod board;
pub(crate) mod grime;
mod groups;
mod patches;
pub(crate) mod presentation;
mod save;
pub(crate) use save::restore;
mod consequences;
pub use consequences::moodlets;
pub(crate) use consequences::{dish_washed, moodlets_in};
mod policy;
mod work;
use bevy_ecs::prelude::*;
pub use policy::{enjoyment, willingness};
use terri_core::chores::*;
pub(crate) use work::{activate, cancel, issue, key_valid, soil};
#[cfg(test)]
mod board_tests;
#[cfg(test)]
mod grime_tests;
#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod tests;

pub(crate) fn tick(world: &mut World) {
    let pack = world.resource::<crate::Content>().0;
    if std::ptr::eq(pack, terri_data::pre_books_pack())
        || std::ptr::eq(pack, terri_data::published_pre_books_pack())
        || std::ptr::eq(pack, terri_data::affinity_pre_books_pack())
    {
        return;
    }
    if world
        .resource::<crate::Content>()
        .0
        .tuning
        .domestic
        .is_none()
    {
        return;
    }
    let now = world.resource::<terri_core::SimClock>().tick;
    let mut state = world
        .remove_resource::<SavedChores>()
        .unwrap_or_else(|| SavedChores {
            last_age_tick: now.saturating_sub(1),
            board_enabled: true,
            ..Default::default()
        });
    initialize(world, &mut state);
    grime::ensure(world, &state);
    board::tick(world, &mut state);
    work::advance(world, &mut state);
    redistribute(world, &mut state);
    state.feelings.retain(|f| f.expires > now);
    world.insert_resource(state);
    patches::reconcile(world);
}
pub(crate) fn value(rows: &[(u32, u16)], key: u32) -> u16 {
    rows.binary_search_by_key(&key, |r| r.0)
        .map_or(0, |i| rows[i].1)
}

pub(crate) fn add(rows: &mut Vec<(u32, u16)>, key: u32, delta: u32) {
    match rows.binary_search_by_key(&key, |r| r.0) {
        Ok(i) => rows[i].1 = (u32::from(rows[i].1) + delta).min(1000) as u16,
        Err(i) if delta > 0 => rows.insert(i, (key, delta.min(1000) as u16)),
        _ => {}
    }
}

fn redistribute(world: &World, state: &mut SavedChores) {
    if state.unbinned == 0 {
        return;
    }
    let Some(mut q) = world.try_query::<(Entity, &terri_core::SmartObject)>() else {
        return;
    };
    let mut bins: Vec<_> = q
        .iter(world)
        .filter(|(_, o)| world.resource::<crate::Content>().0.object(o.0).id == "trashcan")
        .map(|(e, _)| e.index_u32())
        .collect();
    bins.sort_unstable();
    for bin in bins {
        let amount = state
            .unbinned
            .min(1000 - u32::from(value(&state.bins, bin)));
        add(&mut state.bins, bin, amount);
        state.unbinned -= amount;
    }
}

fn initialize(world: &World, state: &mut SavedChores) {
    if state.rng.is_none() {
        let mut seed_stream = world.resource::<terri_core::SimRng>().clone();
        let seed = (u64::from(seed_stream.next_u32()) << 32) | u64::from(seed_stream.next_u32());
        state.rng = Some(terri_core::SimRng::from_seed(seed ^ 0x43484f524553));
    }
    let Some(mut people) =
        world.try_query::<(&terri_core::SimId, Option<&terri_core::Personality>)>()
    else {
        return;
    };
    for (id, personality) in people.iter(world) {
        let Err(at) = state.profiles.binary_search_by_key(&id.0, |p| p.sim_id) else {
            continue;
        };
        let pack = world.resource::<crate::Content>().0;
        let archetype = personality.and_then(|person| {
            pack.personalities
                .iter()
                .find(|p| p.drain == person.drain && p.satisfaction == person.satisfaction)
        });
        let (responsibility, preferences) = match archetype.map(|p| p.id.as_str()) {
            Some("the_correspondent") => (80, [25, 55, 35, -15]),
            Some("the_settled") => (25, [-60, -45, -50, -70]),
            Some("the_flitting") => (55, [10, -10, 5, 20]),
            _ => (50, [0; 4]),
        };
        state.profiles.insert(
            at,
            ChoreProfile {
                sim_id: id.0,
                responsibility,
                commitment: 50,
                preferences,
            },
        );
    }
    state.profiles.sort_by_key(|p| p.sim_id);
}

pub(crate) fn snapshot(world: &World) -> Option<SavedChores> {
    let mut state = world.get_resource::<SavedChores>()?.clone();
    state.orders.retain_mut(|o| {
        let Some(person) = crate::dining::entity(world, o.person) else {
            return false;
        };
        let position = world
            .get::<terri_core::IntentQueue>(person)
            .and_then(|q| q.intents().position(|i| i.chore == Some(o.id)));
        if let Some(position) = position {
            o.queue_position = position as u32;
            true
        } else {
            false
        }
    });
    Some(state)
}

pub(crate) fn ensure(world: &mut World) {
    if !world.contains_resource::<SavedChores>() {
        let mut state = SavedChores {
            last_age_tick: world.resource::<terri_core::SimClock>().tick,
            board_enabled: true,
            ..Default::default()
        };
        initialize(world, &mut state);
        world.insert_resource(state);
    }
    let mut state = world.remove_resource::<SavedChores>().unwrap();
    initialize(world, &mut state);
    world.insert_resource(state);
    patches::reconcile(world);
}

pub(crate) fn object_claimed(state: Option<&SavedChores>, object: u32, except: u32) -> bool {
    state.is_some_and(|s| {
        s.tasks
            .iter()
            .any(|t| groups::claims(t, object) && t.person != except)
    })
}

pub(crate) fn set_profile(
    world: &mut World,
    person: u32,
    responsibility: u8,
    preferences: [i8; 4],
) {
    if responsibility > 100 || preferences.iter().any(|p| !(-100..=100).contains(p)) {
        return;
    }
    let Some(id) = crate::dining::entity(world, person)
        .filter(|e| world.get::<terri_core::Agent>(*e).is_some())
        .and_then(|e| world.get::<terri_core::SimId>(e))
        .copied()
    else {
        return;
    };
    ensure(world);
    if let Some(p) = world
        .resource_mut::<SavedChores>()
        .profiles
        .iter_mut()
        .find(|p| p.sim_id == id.0)
    {
        p.responsibility = responsibility;
        p.preferences = preferences;
    }
}

pub(crate) fn status(world: &World, person: u32) -> Option<String> {
    let entity = crate::dining::entity(world, person)?;
    world.get::<ChoreWork>(entity)?;
    let task = world
        .get_resource::<SavedChores>()?
        .tasks
        .iter()
        .find(|t| t.person == person)?;
    if task.key.kind == ChoreKind::Floors {
        return Some(task.key.kind.label().into());
    }
    Some(format!(
        "{} - {}/{}",
        task.key.kind.label(),
        task.cursor + 1,
        task.cells.len()
    ))
}

pub(crate) fn prune(world: &mut World) {
    let Some(mut state) = snapshot(world) else {
        return;
    };
    groups::reconcile(world, &mut state);
    let invalid: Vec<_> = state
        .tasks
        .iter()
        .filter(|t| {
            !work::plan_valid(world, t)
                || t.cursor as usize >= t.cells.len()
                || crate::dining::entity(world, t.person).is_none()
        })
        .map(|t| (t.person, t.key, t.started_day))
        .collect();
    let mut unavailable = Vec::new();
    for (person, key, day) in invalid {
        unavailable.push((key, day));
        if let Some(e) = crate::dining::entity(world, person) {
            cancel(world, e);
        }
        state.tasks.retain(|t| t.person != person);
    }
    state.tasks.retain_mut(|task| {
        if task.key.kind != ChoreKind::Floors
            && !(task.key.kind.grouped() && task.endpoint.is_none())
            && task
                .endpoint
                .is_none_or(|cell| !work::contact_valid(world, groups::current_key(task), cell))
        {
            let Some(endpoint) = work::contact(world, task) else {
                unavailable.push((task.key, task.started_day));
                if let Some(person) = crate::dining::entity(world, task.person) {
                    cancel(world, person);
                }
                return false;
            };
            task.endpoint = Some(endpoint);
            task.remaining = 0;
        }
        true
    });
    for episode in &mut state.episodes {
        if !episode.settled && unavailable.contains(&(episode.key, episode.day)) {
            episode.unavailable = true;
        }
    }
    state.dish_started.retain(|(person, _)| {
        crate::dining::entity(world, *person)
            .is_some_and(|e| world.get::<terri_core::Agent>(e).is_some())
            && world
                .get_resource::<terri_core::save::SavedDomestic>()
                .is_some_and(|s| s.cleanup.iter().any(|t| t.person == *person))
    });
    state.orders.retain(|o| key_valid(world, o.key));
    state.surfaces.retain(|r| {
        key_valid(
            world,
            ChoreKey {
                kind: ChoreKind::Surfaces,
                target: r.0,
            },
        )
    });
    state.bins.retain(|r| {
        let valid = key_valid(
            world,
            ChoreKey {
                kind: ChoreKind::Bins,
                target: r.0,
            },
        );
        if !valid {
            state.unbinned = state.unbinned.saturating_add(u32::from(r.1));
        }
        valid
    });
    let ids: std::collections::BTreeSet<_> = state.orders.iter().map(|order| order.id).collect();
    let people: Vec<_> = world
        .query::<(Entity, &terri_core::IntentQueue)>()
        .iter(world)
        .filter(|(_, queue)| {
            queue
                .intents()
                .any(|intent| intent.chore.is_some_and(|id| !ids.contains(&id)))
        })
        .map(|(person, _)| person)
        .collect();
    for person in people {
        if let Some(mut queue) = world.get_mut::<terri_core::IntentQueue>(person) {
            queue.retain(|order| order.intent.chore.is_none_or(|id| ids.contains(&id)));
        }
    }
    state.assignments.retain(|a| key_valid(world, a.key));
    for episode in &mut state.episodes {
        if !episode.settled && !key_valid(world, episode.key) {
            episode.outcome = DutyOutcome::Unavailable;
            episode.unavailable = true;
            episode.settled = true;
        }
    }
    board::reconcile(world, &mut state);
    world.insert_resource(state);
    patches::reconcile(world);
}

pub(crate) fn completed(
    world: &mut World,
    state: &mut SavedChores,
    person: u32,
    key: ChoreKey,
    day: u64,
    units: u32,
) {
    if units == 0 {
        return;
    }
    if key.kind == ChoreKind::Surfaces {
        if let Some(group) =
            crate::dining::entity(world, key.target).and_then(|e| groups::key_for(world, e))
        {
            if dirt_in(world, state, group) < 150 {
                board::credit(world, state, person, group, day, units);
            }
        }
    } else if key.kind != ChoreKind::Dishes || dirt_in(world, state, key) == 0 {
        board::credit(world, state, person, key, day, units);
    }
    if let Some(id) =
        crate::dining::entity(world, person).and_then(|e| world.get::<terri_core::SimId>(e))
    {
        let preference = state
            .profiles
            .iter()
            .find(|p| p.sim_id == id.0)
            .map_or(0, |p| i16::from(p.preferences[key.kind.index()]));
        state.feelings.retain(|f| f.person != id.0);
        state.feelings.push(ChoreFeeling {
            person: id.0,
            kind: key.kind,
            score: preference,
            expires: world
                .resource::<terri_core::SimClock>()
                .tick
                .saturating_add(60),
        });
        state.feelings.sort_by_key(|f| f.person);
    }
}

pub fn keys(world: &World) -> Vec<ChoreKey> {
    let mut keys = std::collections::BTreeSet::from([ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    }]);
    let grid = world.resource::<terri_core::TileGrid>();
    let rooms = crate::room_regions::RoomRegions::from_world(world);
    for y in 0..grid.height() {
        for x in 0..grid.width() {
            if grid.is_walkable(x as i32, y as i32) {
                if let Some(room) = rooms.at((x as i32, y as i32)) {
                    keys.insert(ChoreKey {
                        kind: ChoreKind::Floors,
                        target: room,
                    });
                }
            }
        }
    }
    if let Some(mut objects) = world.try_query::<(Entity, &terri_core::SmartObject)>() {
        for (e, o) in objects.iter(world) {
            if crate::targeted_cleanup::is_surface(world.resource::<crate::Content>().0, o.0) {
                if let Some(key) = groups::key_for(world, e) {
                    keys.insert(key);
                }
            }
            if world.resource::<crate::Content>().0.object(o.0).id == "trashcan" {
                keys.insert(ChoreKey {
                    kind: ChoreKind::Bins,
                    target: e.index_u32(),
                });
            }
        }
    }
    keys.into_iter().collect()
}

pub fn dirt(world: &World, key: ChoreKey) -> u32 {
    if key.kind == ChoreKind::Dishes {
        return world
            .get_resource::<terri_core::save::SavedDomestic>()
            .map_or(0, |s| {
                s.dishes
                    .iter()
                    .map(|d| d.units.saturating_mul(100))
                    .sum::<u32>()
                    .min(1000)
            });
    }
    let Some(state) = world.get_resource::<SavedChores>() else {
        return 0;
    };
    dirt_in(world, state, key)
}

pub(crate) fn dirt_in(world: &World, state: &SavedChores, key: ChoreKey) -> u32 {
    match key.kind {
        ChoreKind::Dishes => world
            .get_resource::<terri_core::save::SavedDomestic>()
            .map_or(0, |s| {
                s.dishes
                    .iter()
                    .map(|d| d.units.saturating_mul(100))
                    .sum::<u32>()
                    .min(1000)
            }),
        ChoreKind::Surfaces => u32::from(value(&state.surfaces, key.target)),
        ChoreKind::CounterSurfaces | ChoreKind::TableSurfaces => groups::members(world, key)
            .into_iter()
            .map(|id| u32::from(value(&state.surfaces, id)))
            .max()
            .unwrap_or(0),
        ChoreKind::Bins => u32::from(value(&state.bins, key.target)),
        ChoreKind::Floors => {
            let grid = world.resource::<terri_core::TileGrid>();
            let rooms = crate::room_regions::RoomRegions::from_world(world);
            state
                .floors
                .iter()
                .filter(|(cell, _)| {
                    let xy = (
                        (*cell as usize % grid.width()) as i32,
                        (*cell as usize / grid.width()) as i32,
                    );
                    grid.is_walkable(xy.0, xy.1) && rooms.at(xy) == Some(key.target)
                })
                .map(|r| u32::from(r.1))
                .max()
                .unwrap_or(0)
        }
    }
}

pub fn floor_at(world: &World, x: i32, y: i32) -> Option<ChoreKey> {
    let target = crate::room_regions::RoomRegions::from_world(world).at((x, y))?;
    let key = ChoreKey {
        kind: ChoreKind::Floors,
        target,
    };
    (dirt(world, key) > 0).then_some(key)
}

pub fn profile(world: &World, person: u32) -> Option<ChoreProfile> {
    let id =
        crate::dining::entity(world, person).and_then(|e| world.get::<terri_core::SimId>(e))?;
    Some(
        world
            .get_resource::<SavedChores>()
            .and_then(|s| s.profiles.iter().find(|p| p.sim_id == id.0))
            .cloned()
            .unwrap_or_else(|| ChoreProfile::neutral(id.0)),
    )
}

pub(crate) fn cleanup_bias(world: &World, person: Entity) -> f32 {
    let Some(profile) = profile(world, person.index_u32()) else {
        return 1.0;
    };
    (1.0 + 0.2 * (f32::from(profile.responsibility) / 100.0 - 0.5)
        + 0.2 * f32::from(profile.preferences[0]) / 100.0)
        .clamp(0.25, 1.5)
}

pub fn options(world: &World, entity: u32) -> Vec<ChoreKey> {
    [ChoreKind::Surfaces, ChoreKind::Bins]
        .into_iter()
        .map(|kind| ChoreKey {
            kind,
            target: entity,
        })
        .filter(|key| key_valid(world, *key) && dirt(world, *key) > 0)
        .collect()
}

pub fn rows(world: &World) -> Vec<u32> {
    let state = world.get_resource::<SavedChores>();
    let day = world.resource::<terri_core::SimClock>().tick
        / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks);
    keys(world)
        .into_iter()
        .flat_map(|key| {
            let owner = state
                .and_then(|s| s.assignments.iter().find(|a| a.key == key))
                .map_or(u32::MAX, |a| a.owner);
            let outcome = state
                .and_then(|s| {
                    s.episodes
                        .iter()
                        .rev()
                        .find(|e| e.key == key && e.day == day)
                })
                .map_or(DutyOutcome::Pending, |e| e.outcome);
            [
                key.kind as u32,
                key.target,
                owner,
                dirt(world, key),
                outcome as u32,
            ]
        })
        .collect()
}

pub fn location_label(world: &World, key: ChoreKey) -> String {
    if key.kind == ChoreKind::Dishes {
        return "Household".into();
    }
    if key.kind == ChoreKind::Floors || key.kind.grouped() {
        return groups::room_label(world, key.target);
    }
    let Some(object) = crate::dining::entity(world, key.target) else {
        return "Removed object".into();
    };
    let Some(pos) = world.get::<terri_core::Position>(object) else {
        return "Removed object".into();
    };
    let room = crate::room_regions::RoomRegions::from_world(world)
        .at((pos.x.round() as i32, pos.y.round() as i32));
    room.map_or_else(|| "Outside".into(), |id| groups::room_label(world, id))
}

pub fn history_rows(world: &World) -> Vec<u32> {
    world
        .get_resource::<SavedChores>()
        .into_iter()
        .flat_map(|state| {
            state.episodes.iter().rev().map(|e| {
                [
                    e.day as u32,
                    (e.day >> 32) as u32,
                    e.key.kind as u32,
                    e.key.target,
                    e.owner,
                    e.performer.unwrap_or(u32::MAX),
                    e.outcome as u32,
                    u32::from(e.settled),
                ]
            })
        })
        .flatten()
        .collect()
}
