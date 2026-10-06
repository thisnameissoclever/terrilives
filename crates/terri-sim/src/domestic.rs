//! Domestic work uses the ordinary chain scheduler, reservations and seeded RNG.
//! Dishes retain their creator's SimId; entry memory prevents per-tick complaints.

use crate::{Content, SaveError};
use bevy_ecs::prelude::*;
use std::collections::{BTreeSet, VecDeque};
use terri_core::{
    save::*, Agent, AtWork, ChainState, Commuting, Eating, IntentQueue, NeedId, Needs, Path,
    Personality, Position, Relationships, SimClock, SimId, SimRng, SmartObject, Socialising,
    StepWork, Target, TileGrid,
};

#[cfg(test)]
mod tests;

pub const SNACK: &str = "prepare_snack";
pub const CLEANUP: &str = "clean_dishes";
pub const SHARED: &str = "eat_shared_meal";

fn entity(world: &World, index: u32) -> Option<Entity> {
    let index = bevy_ecs::entity::EntityIndex::from_raw_u32(index)?;
    let entity = world.entities().resolve_from_index(index);
    world.get_entity(entity).ok().map(|_| entity)
}

pub fn cleanliness(world: &World, person: Entity) -> f32 {
    if let Some(state) = world.get_resource::<SavedDomestic>() {
        if let Some((_, score)) = state
            .cleanliness
            .iter()
            .find(|(index, _)| *index == person.index_u32())
        {
            return *score;
        }
    }
    let Some(personality) = world.get::<Personality>(person) else {
        return 0.5;
    };
    world
        .resource::<Content>()
        .0
        .personalities
        .iter()
        .find(|p| p.drain == personality.drain && p.satisfaction == personality.satisfaction)
        .map_or(0.5, |p| p.cleanliness)
}

/// Own-mess probability before current needs reduce willingness.
pub fn cleanup_probability(
    cleanliness: f32,
    needs: &Needs,
    critical: f32,
    tuning: &terri_data::DomesticTuning,
) -> f32 {
    let clean = cleanliness.clamp(0.0, 1.0);
    let curve = clean * clean / (clean * clean + 0.5 * (1.0 - clean).powi(2));
    let base = tuning.own_cleanup_min + tuning.own_cleanup_bonus * curve;
    base * needs_multiplier(needs, critical, tuning)
}

fn needs_multiplier(needs: &Needs, critical: f32, tuning: &terri_data::DomesticTuning) -> f32 {
    let urgent = [NeedId::Energy, NeedId::Hunger, NeedId::Bladder]
        .into_iter()
        .map(|need| needs.get(need))
        .fold(100.0_f32, f32::min);
    let readiness = if urgent <= critical {
        tuning.critical_cleanup_scale
    } else {
        ((urgent - critical) / (tuning.ready_need_level - critical)).clamp(0.0, 1.0)
    };
    let other = [
        NeedId::Fun,
        NeedId::Social,
        NeedId::Hygiene,
        NeedId::Comfort,
    ]
    .into_iter()
    .map(|need| needs.get(need))
    .fold(100.0_f32, f32::min);
    readiness
        * (tuning.other_need_floor
            + (1.0 - tuning.other_need_floor) * (other / tuning.other_need_level).clamp(0.0, 1.0))
}

pub(crate) fn blocked_cleanup_probability(
    clean: f32,
    needs: &Needs,
    critical: f32,
    tuning: &terri_data::DomesticTuning,
) -> f32 {
    (0.05 + 0.5 * clean.clamp(0.0, 1.0)) * needs_multiplier(needs, critical, tuning)
}

fn idle(world: &World, person: Entity) -> bool {
    let Ok(e) = world.get_entity(person) else {
        return false;
    };
    !e.contains::<Target>()
        && !e.contains::<terri_core::chores::ChoreWork>()
        && !e.contains::<Eating>()
        && !e.contains::<StepWork>()
        && !e.contains::<Socialising>()
        && !e.contains::<ChainState>()
        && !e.contains::<Commuting>()
        && !e.contains::<AtWork>()
        && e.get::<IntentQueue>().is_none_or(|q| q.is_empty())
}

fn roll(world: &mut World, probability: f32) -> bool {
    world.resource_mut::<SimRng>().next_f32() < probability
}

/// Room boundaries include doorways; furniture occupancy does not split a room.
fn rooms(world: &World) -> (usize, Vec<u32>) {
    let grid = world.resource::<TileGrid>();
    let (width, height) = (grid.width(), grid.height());
    let layout = world.get_resource::<terri_core::layout::SavedLayout>();
    let mut labels = vec![u32::MAX; width * height];
    for start in 0..labels.len() {
        if labels[start] != u32::MAX {
            continue;
        }
        labels[start] = start as u32;
        let mut pending = VecDeque::from([start]);
        while let Some(cell) = pending.pop_front() {
            let (x, y) = ((cell % width) as i32, (cell / width) as i32);
            for (nx, ny) in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] {
                if nx < 0 || ny < 0 || nx >= width as i32 || ny >= height as i32 {
                    continue;
                }
                use terri_core::layout::{EdgeAxis, WallLine, WallState};
                let line = if nx != x {
                    WallLine {
                        axis: EdgeAxis::Vertical,
                        x: x.max(nx) as u32,
                        y: y as u32,
                    }
                } else {
                    WallLine {
                        axis: EdgeAxis::Horizontal,
                        x: x as u32,
                        y: y.max(ny) as u32,
                    }
                };
                if layout.is_some_and(|layout| layout.state_of(line) != WallState::Open) {
                    continue;
                }
                let next = ny as usize * width + nx as usize;
                if labels[next] == u32::MAX {
                    labels[next] = start as u32;
                    pending.push_back(next);
                }
            }
        }
    }
    (width, labels)
}

fn room_at(width: usize, labels: &[u32], position: &Position) -> Option<u32> {
    let (x, y) = (position.x.round() as i32, position.y.round() as i32);
    if x < 0 || y < 0 || x as usize >= width {
        return None;
    }
    labels.get(y as usize * width + x as usize).copied()
}

pub(crate) fn visible(state: &SavedDomestic, dish: u32) -> bool {
    !state
        .cleanup
        .iter()
        .any(|task| task.collected.contains(&dish))
}

fn room_piles(
    world: &World,
    person: Entity,
    state: &SavedDomestic,
    width: usize,
    labels: &[u32],
) -> Vec<SavedDishes> {
    let Some(position) = world.get::<Position>(person) else {
        return Vec::new();
    };
    let Some(room) = room_at(width, labels, position) else {
        return Vec::new();
    };
    state
        .dishes
        .iter()
        .filter(|dish| visible(state, dish.id))
        .filter(|dish| {
            entity(world, dish.surface)
                .and_then(|e| world.get::<Position>(e))
                .and_then(|pos| room_at(width, labels, pos))
                == Some(room)
        })
        .cloned()
        .collect()
}

fn annoying(
    world: &World,
    person: Entity,
    state: &SavedDomestic,
    width: usize,
    labels: &[u32],
) -> Vec<SavedDishes> {
    let Some(id) = world.get::<SimId>(person) else {
        return Vec::new();
    };
    room_piles(world, person, state, width, labels)
        .into_iter()
        .filter(|d| d.owner != id.0)
        .collect()
}

pub(crate) fn mood_penalty(world: &World, person: Entity) -> Option<f32> {
    let tuning = world.resource::<Content>().0.tuning.domestic?;
    let state = world.get_resource::<SavedDomestic>()?;
    let (width, labels) = rooms(world);
    let piles = room_piles(world, person, state, width, &labels);
    let obstructed =
        crate::dining::claim(world, person.index_u32()).is_some_and(|d| !d.obstructing.is_empty());
    if piles.is_empty() && !obstructed {
        return None;
    }
    let units: u32 = piles.iter().map(|dish| dish.units).sum();
    Some(
        (tuning.mood_penalty_min + tuning.mood_penalty_bonus * cleanliness(world, person))
            * ((units as f32 / tuning.mood_units).min(tuning.mood_max_load)
                + if obstructed { 0.5 } else { 0.0 }),
    )
}

fn chain_index(world: &World, id: &str) -> Option<u32> {
    world
        .resource::<Content>()
        .0
        .chains
        .iter()
        .position(|chain| chain.id == id)
        .map(|i| i as u32)
}

/// The extra complaint happens once when a diner discovers a dirty setting.
pub(crate) fn blocked_setting_annoyance(world: &mut World, person: Entity, ids: &[u32]) {
    let Some(tuning) = world.resource::<Content>().0.tuning.domestic else {
        return;
    };
    let Some(own) = world.get::<SimId>(person).copied() else {
        return;
    };
    let owners: BTreeSet<_> = world
        .get_resource::<SavedDomestic>()
        .into_iter()
        .flat_map(|s| s.dishes.iter())
        .filter(|d| ids.contains(&d.id) && d.owner != own.0)
        .map(|d| d.owner)
        .collect();
    let penalty = 0.5
        * (tuning.affinity_penalty_min
            + tuning.affinity_penalty_bonus * cleanliness(world, person));
    if !owners.is_empty() && world.get::<Relationships>(person).is_none() {
        world.entity_mut(person).insert(Relationships::default());
    }
    for owner in owners {
        world
            .get_mut::<Relationships>(person)
            .unwrap()
            .bump(SimId(owner), -penalty);
    }
}

fn start_cleanup(world: &mut World, person: Entity, dishes: Vec<u32>, directed: bool) -> bool {
    let Some(chain) = chain_index(world, CLEANUP) else {
        return false;
    };
    if dishes.is_empty() {
        return false;
    }
    let pack = world.resource::<Content>().0;
    if !world.query::<&SmartObject>().iter(world).any(|object| {
        pack.object(object.0)
            .roles
            .iter()
            .any(|role| pack.roles[*role as usize] == "dish_sink")
    }) {
        return false;
    }
    let state = world.resource::<SavedDomestic>();
    if state
        .cleanup
        .iter()
        .any(|task| task.person == person.index_u32())
    {
        return false;
    }
    if dishes
        .iter()
        .any(|id| state.cleanup.iter().any(|task| task.dishes.contains(id)))
    {
        return false;
    }
    world
        .resource_mut::<SavedDomestic>()
        .cleanup
        .push(SavedCleanup {
            person: person.index_u32(),
            dishes,
            collected: Vec::new(),
            directed,
        });
    world
        .resource_mut::<SavedDomestic>()
        .cleanup
        .sort_by_key(|task| task.person);
    world
        .entity_mut(person)
        .remove::<Path>()
        .insert(ChainState::begin(chain));
    true
}

/// Runs after player intents and before ordinary autonomous selection.
pub(crate) fn tick(world: &mut World) {
    let Some(tuning) = world.resource::<Content>().0.tuning.domestic else {
        return;
    };
    if !world.contains_resource::<SavedDomestic>() {
        world.insert_resource(SavedDomestic::default());
    }
    let mut people: Vec<_> = world
        .query_filtered::<(Entity, &SimId), With<Agent>>()
        .iter(world)
        .map(|(e, id)| (e, *id))
        .collect();
    people.sort_by_key(|(e, _)| e.index_u32());
    // Interrupted tasks keep their claims. Explicitly abandoned tasks put their
    // collected dishes back on their original surfaces.
    let mut state = world.resource::<SavedDomestic>().clone();
    // A replaced or cancelled guest chain gives up its plate. Interruptions
    // retain ChainState and therefore retain ownership. The abandoned plate
    // becomes a dirty dish at the serving counter, with the guest responsible.
    let mut abandoned = Vec::new();
    for meal in &mut state.meals {
        for guest in &meal.claimed {
            if meal.eaten.contains(guest) {
                continue;
            }
            let active = people
                .iter()
                .find(|(_, id)| id.0 == *guest)
                .and_then(|(person, _)| world.get::<ChainState>(*person))
                .is_some_and(|chain| {
                    world.resource::<Content>().0.chains[chain.chain as usize].id == SHARED
                });
            if !active {
                meal.eaten.push(*guest);
                abandoned.push((meal.counter, *guest));
            }
        }
    }
    for (surface, owner) in abandoned {
        let id = state.next_dish;
        state.next_dish = state
            .next_dish
            .checked_add(1)
            .expect("dish identity exhausted");
        state.dishes.push(SavedDishes {
            id,
            surface,
            owner,
            units: 1,
        });
    }
    state.cleanliness.retain(|(index, _)| {
        entity(world, *index).is_some_and(|e| world.get::<Agent>(e).is_some())
    });
    state.visits.retain(|visit| {
        entity(world, visit.person).is_some_and(|e| world.get::<Agent>(e).is_some())
    });
    state.dishes.retain(|dish| {
        entity(world, dish.surface).is_some_and(|e| world.get::<SmartObject>(e).is_some())
    });
    state.cleanup.retain(|task| {
        entity(world, task.person)
            .and_then(|e| world.get::<ChainState>(e))
            .is_some_and(|chain| {
                world.resource::<Content>().0.chains[chain.chain as usize].id == CLEANUP
            })
            && task
                .dishes
                .iter()
                .all(|id| state.dishes.iter().any(|dish| dish.id == *id))
    });
    state.meals.retain(|meal| {
        entity(world, meal.counter).is_some()
            && meal
                .table
                .is_none_or(|table| entity(world, table).is_some())
            && meal.guests.iter().any(|guest| !meal.eaten.contains(guest))
    });
    state.serving_meals.retain(|(cook, tick)| {
        state
            .meals
            .iter()
            .any(|meal| meal.cook == *cook && meal.tick == *tick)
            && people.iter().any(|(person, id)| {
                id.0 == *cook
                    && world.get::<ChainState>(*person).is_some_and(|chain| {
                        world.resource::<Content>().0.chains[chain.chain as usize].id
                            == "cook_dinner"
                            && chain.step == 5
                    })
            })
    });
    let surviving: BTreeSet<_> = state.dishes.iter().map(|dish| dish.id).collect();
    for visit in &mut state.visits {
        visit.seen.retain(|id| surviving.contains(id));
    }
    for (person, _) in &people {
        if !state
            .cleanliness
            .iter()
            .any(|(index, _)| *index == person.index_u32())
        {
            state
                .cleanliness
                .push((person.index_u32(), cleanliness(world, *person)));
        }
    }
    state.cleanliness.sort_by_key(|(index, _)| *index);
    world.insert_resource(state);
    crate::dining::maintain(world);
    let (width, labels) = rooms(world);
    let critical = world
        .resource::<Content>()
        .0
        .tuning
        .mood_critical_need_level;
    for (person, id) in people {
        let Some(needs) = world.get::<Needs>(person).cloned() else {
            continue;
        };
        let Some(position) = world.get::<Position>(person).copied() else {
            continue;
        };
        let room = room_at(width, &labels, &position).unwrap_or(u32::MAX);
        let state = world.resource::<SavedDomestic>();
        let piles = annoying(world, person, state, width, &labels);
        let previous = state
            .visits
            .iter()
            .find(|visit| visit.person == person.index_u32());
        let entered = previous.is_none_or(|visit| visit.room != room);
        let seen = if entered {
            Vec::new()
        } else {
            previous.unwrap().seen.clone()
        };
        let mut seen_now = seen.clone();
        let mut owners = BTreeSet::new();
        for pile in &piles {
            if !seen.contains(&pile.id) {
                owners.insert(pile.owner);
                seen_now.push(pile.id);
            }
        }
        seen_now.sort_unstable();
        seen_now.dedup();
        let clean = cleanliness(world, person);
        for owner in owners {
            if world.get::<Relationships>(person).is_none() {
                world.entity_mut(person).insert(Relationships::default());
            }
            let requested = -(tuning.affinity_penalty_min + tuning.affinity_penalty_bonus * clean);
            let before = world
                .get::<Relationships>(person)
                .unwrap()
                .feeling(SimId(owner));
            world
                .get_mut::<Relationships>(person)
                .unwrap()
                .bump(SimId(owner), requested);
            let actual = world
                .get::<Relationships>(person)
                .unwrap()
                .feeling(SimId(owner))
                - before;
            let tick = world.resource::<SimClock>().tick;
            let affected = *world.get::<SimId>(person).unwrap();
            world
                .resource_mut::<crate::relationship_effects::RelationshipDiagnostics>()
                .effects
                .push(crate::relationship_effects::RelationshipEffect {
                    tick,
                    event: 0,
                    cause: crate::relationship_effects::RelationshipCause::HouseholdMess,
                    responsible: SimId(owner),
                    affected,
                    requested,
                    actual,
                    emergency: false,
                    directed: false,
                });
        }
        let mut state = world.resource_mut::<SavedDomestic>();
        state
            .visits
            .retain(|visit| visit.person != person.index_u32());
        state.visits.push(SavedRoomVisit {
            person: person.index_u32(),
            room,
            seen: seen_now,
        });
        state.visits.sort_by_key(|visit| visit.person);
        let all_piles = room_piles(
            world,
            person,
            world.resource::<SavedDomestic>(),
            width,
            &labels,
        );
        let available: Vec<_> = all_piles
            .iter()
            .filter(|dish| {
                !world
                    .resource::<SavedDomestic>()
                    .cleanup
                    .iter()
                    .any(|task| task.dishes.contains(&dish.id))
            })
            .map(|dish| dish.id)
            .collect();
        {
            let state = world.resource_mut::<SavedDining>().into_inner();
            if let Some(o) = state
                .opportunities
                .iter_mut()
                .find(|o| o.person == person.index_u32())
            {
                if o.room != room {
                    o.room = room;
                    o.known.clear();
                    o.pending = false;
                }
                for pile in &all_piles {
                    if !o.known.contains(&pile.id) {
                        o.known.push(pile.id);
                        o.pending = true;
                    }
                }
                o.known.sort_unstable();
            } else {
                let mut known: Vec<_> = all_piles.iter().map(|d| d.id).collect();
                known.sort_unstable();
                state.opportunities.push(SavedCleanupOpportunity {
                    person: person.index_u32(),
                    room,
                    pending: !known.is_empty(),
                    known,
                });
                state.opportunities.sort_by_key(|o| o.person);
            }
        }
        if !idle(world, person) {
            continue;
        }
        // A waiting plate is real food, so a guest does not begin another meal.
        let meal = world
            .resource::<SavedDomestic>()
            .meals
            .iter()
            .position(|meal| {
                meal.guests.contains(&id.0)
                    && !meal.claimed.contains(&id.0)
                    && !meal.eaten.contains(&id.0)
            });
        if let Some(meal) = meal {
            if needs.get(NeedId::Hunger) < tuning.accept_hunger_level
                && needs.get(NeedId::Energy) > critical
            {
                if let Some(chain) = chain_index(world, SHARED) {
                    world.resource_mut::<SavedDomestic>().meals[meal]
                        .claimed
                        .push(id.0);
                    let mut progress = ChainState::begin(chain);
                    progress.fumble_scale = world.resource::<SavedDomestic>().meals[meal].scale;
                    world.entity_mut(person).remove::<Path>().insert(progress);
                    continue;
                }
            }
        }
        let pending = world
            .resource::<SavedDining>()
            .opportunities
            .iter()
            .any(|o| o.person == person.index_u32() && o.pending);
        if pending && !available.is_empty() {
            world
                .resource_mut::<SavedDining>()
                .opportunities
                .iter_mut()
                .find(|o| o.person == person.index_u32())
                .unwrap()
                .pending = false;
        }
        if pending
            && !available.is_empty()
            && roll(
                world,
                tuning.visitor_cleanup_fraction
                    * cleanup_probability(clean, &needs, critical, &tuning)
                    * crate::chores::cleanup_bias(world, person),
            )
        {
            start_cleanup(world, person, available, false);
        }
    }
}

pub(crate) fn step_station(
    state: &SavedDomestic,
    person: u32,
    id: Option<SimId>,
    chain: &str,
    step: u32,
) -> Option<u32> {
    if chain == CLEANUP && step == 0 {
        let task = state.cleanup.iter().find(|task| task.person == person)?;
        let dish = task.dishes.iter().find(|id| !task.collected.contains(id))?;
        return state
            .dishes
            .iter()
            .find(|pile| pile.id == *dish)
            .map(|pile| pile.surface);
    }
    if chain == SHARED {
        let id = id?;
        let meal = state
            .meals
            .iter()
            .find(|meal| meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0))?;
        return if step == 0 {
            Some(meal.counter)
        } else {
            meal.table
        };
    }
    if chain == "cook_dinner" && step == 5 {
        let id = id?;
        let (_, tick) = state.serving_meals.iter().find(|(cook, _)| *cook == id.0)?;
        return state
            .meals
            .iter()
            .find(|meal| meal.cook == id.0 && meal.tick == *tick)
            .and_then(|meal| meal.table);
    }
    None
}

pub(crate) fn awaiting_meal_table(state: &SavedDomestic, id: Option<SimId>, step: u32) -> bool {
    step == 1
        && id.is_some_and(|id| {
            state.meals.iter().any(|meal| {
                meal.table.is_none() && meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0)
            })
        })
}

pub(crate) fn communal(chain: &str, step: u32, steps: usize) -> bool {
    (chain == "cook_dinner" || chain == SHARED) && step as usize + 1 == steps
}

fn dining_meal<'a>(state: &'a SavedDomestic, id: SimId, chain: &str) -> Option<&'a SavedMeal> {
    match chain {
        "cook_dinner" => {
            let (_, tick) = state.serving_meals.iter().find(|(cook, _)| *cook == id.0)?;
            state
                .meals
                .iter()
                .find(|meal| meal.cook == id.0 && meal.tick == *tick)
        }
        SHARED => state
            .meals
            .iter()
            .find(|meal| meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0)),
        _ => None,
    }
}

pub(crate) fn gathering(state: &SavedDomestic, id: SimId, chain: &str, step: u32) -> bool {
    ((chain == "cook_dinner" && step == 5) || (chain == SHARED && step == 1))
        && dining_meal(state, id, chain).is_some_and(|meal| !meal.dining_started)
}

fn dining_capacity(world: &World, table: u32) -> usize {
    let Some(table) = entity(world, table) else {
        return 0;
    };
    let (Some(position), Some(object)) = (
        world.get::<Position>(table),
        world.get::<SmartObject>(table),
    ) else {
        return 0;
    };
    let footprint = crate::placed_footprint(
        world.resource::<Content>().0,
        object.0,
        world.get::<terri_core::ObjectFacing>(table),
    );
    let origin = (position.x.round() as i32, position.y.round() as i32);
    let grid = world.resource::<TileGrid>();
    (origin.1 - 1..=origin.1 + footprint.depth as i32)
        .flat_map(|y| (origin.0 - 1..=origin.0 + footprint.width as i32).map(move |x| (x, y)))
        .filter(|seat| grid.can_interact_with_rect(*seat, origin, footprint))
        .count()
        .min(4)
}

/// Start the eating interval together, after arrival and before work countdowns.
pub(crate) fn gather_diners(world: &mut World) {
    let Some(state) = world.get_resource::<SavedDomestic>() else {
        return;
    };
    let meals = state.meals.clone();
    let serving = state.serving_meals.clone();
    let pack = world.resource::<Content>().0;
    let people: Vec<_> = world
        .query::<(Entity, &SimId)>()
        .iter(world)
        .map(|(person, id)| (person, *id))
        .collect();
    for (index, meal) in meals
        .iter()
        .enumerate()
        .filter(|(_, meal)| !meal.dining_started)
    {
        let table = meal.table.unwrap_or(meal.counter);
        let mut participants = BTreeSet::new();
        let mut arrived = BTreeSet::new();
        let mut urgent = false;
        for (person, id) in &people {
            let expected = if serving.contains(&(id.0, meal.tick)) && meal.cook == id.0 {
                "cook_dinner"
            } else if meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0) {
                SHARED
            } else {
                continue;
            };
            if world
                .get::<ChainState>(*person)
                .is_none_or(|chain| pack.chains[chain.chain as usize].id != expected)
            {
                continue;
            }
            let target = world.get::<Target>(*person);
            let seated = target.is_some_and(|target| {
                (target.object.index_u32() == table
                    || crate::dining::claim(world, person.index_u32())
                        .is_some_and(|d| d.station == target.object.index_u32()))
                    && target.interaction == crate::systems::chain::CHAIN_STEP
            }) && world.get::<StepWork>(*person).is_some()
                && world.get::<Path>(*person).is_none();
            if seated {
                arrived.insert(id.0);
                urgent |= world.get::<Needs>(*person).is_some_and(|needs| {
                    [NeedId::Hunger, NeedId::Energy, NeedId::Bladder]
                        .iter()
                        .any(|need| needs.get(*need) <= pack.tuning.mood_critical_need_level)
                });
            }
            // Player interruptions and queued orders must not hold the household at dinner.
            if target.is_some_and(|target| target.interaction != crate::systems::chain::CHAIN_STEP)
                || world
                    .get::<IntentQueue>(*person)
                    .is_some_and(|queue| !queue.is_empty())
                || world.get::<AtWork>(*person).is_some()
                || world.get::<Commuting>(*person).is_some()
            {
                continue;
            }
            participants.insert(id.0);
        }
        let outsiders = people
            .iter()
            .filter(|(person, id)| {
                !participants.contains(&id.0)
                    && world
                        .get::<Target>(*person)
                        .is_some_and(|target| target.object.index_u32() == table)
            })
            .count();
        if !arrived.is_empty()
            && (participants.iter().all(|id| arrived.contains(id))
                || urgent
                || (meal.table.is_some()
                    && participants.len() + outsiders > dining_capacity(world, table)))
        {
            world.resource_mut::<SavedDomestic>().meals[index].dining_started = true;
            if meal.table.is_none() {
                world
                    .resource_mut::<SavedDining>()
                    .tableless
                    .push((meal.cook, meal.tick));
                world
                    .resource_mut::<SavedDining>()
                    .tableless
                    .sort_unstable();
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn bind_table(world: &mut World, person: Entity, table: Entity) {
    let Some(id) = world.get::<SimId>(person).copied() else {
        return;
    };
    if let Some(mut state) = world.get_resource_mut::<SavedDomestic>() {
        bind_meal_table(&mut state, id, table.index_u32(), "cook_dinner");
    }
}

/// Publish immediately during station selection so every diner uses one table.
pub(crate) fn bind_meal_table(state: &mut SavedDomestic, id: SimId, table: u32, chain: &str) {
    let serving = state.serving_meals.iter().find(|(cook, _)| *cook == id.0);
    let meal = state.meals.iter_mut().find(|meal| match chain {
        "cook_dinner" => {
            serving.is_some_and(|(cook, tick)| meal.cook == *cook && meal.tick == *tick)
        }
        SHARED => meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0),
        _ => false,
    });
    if let Some(meal) = meal.filter(|meal| meal.table.is_none()) {
        meal.table = Some(table);
    }
}

fn add_dishes(world: &mut World, surface: u32, owner: u32, units: u32) {
    if !world.contains_resource::<SavedDomestic>() {
        world.insert_resource(SavedDomestic::default());
    }
    let mut state = world.resource_mut::<SavedDomestic>();
    let id = state.next_dish;
    state.next_dish = state
        .next_dish
        .checked_add(1)
        .expect("dish identity exhausted");
    state.dishes.push(SavedDishes {
        id,
        surface,
        owner,
        units,
    });
}

/// Called once after a station completes, after its chain counter is advanced.
pub(crate) fn completed(
    world: &mut World,
    person: Entity,
    chain: u32,
    step: u32,
    station: Option<Entity>,
) {
    let pack = world.resource::<Content>().0;
    let Some(tuning) = pack.tuning.domestic else {
        return;
    };
    let Some(def) = pack.chains.get(chain as usize) else {
        return;
    };
    let Some(id) = world.get::<SimId>(person).copied() else {
        return;
    };
    let Some(station) = station else { return };
    if def.id != CLEANUP || step > 0 {
        crate::chores::grime::used(world, person, station);
    }
    if def.id == CLEANUP {
        if step == 0 {
            let state = world.resource_mut::<SavedDomestic>().into_inner();
            if let Some(task) = state
                .cleanup
                .iter_mut()
                .find(|task| task.person == person.index_u32())
            {
                for dish in &state.dishes {
                    if dish.surface == station.index_u32()
                        && task.dishes.contains(&dish.id)
                        && !task.collected.contains(&dish.id)
                    {
                        task.collected.push(dish.id);
                    }
                }
                if task.collected.len() < task.dishes.len() {
                    if let Some(mut chain) = world.get_mut::<ChainState>(person) {
                        chain.step = 0;
                    }
                }
            }
        } else {
            let mut washed_units = 0;
            let mut state = world.resource_mut::<SavedDomestic>();
            if let Some(task) = state
                .cleanup
                .iter()
                .find(|task| task.person == person.index_u32())
                .cloned()
            {
                washed_units = state
                    .dishes
                    .iter()
                    .filter(|d| task.dishes.contains(&d.id))
                    .map(|d| d.units)
                    .sum();
                state.dishes.retain(|dish| !task.dishes.contains(&dish.id));
                for visit in &mut state.visits {
                    visit.seen.retain(|id| !task.dishes.contains(id));
                }
            }
            state
                .cleanup
                .retain(|task| task.person != person.index_u32());
            crate::dining::maintain(world);
            crate::targeted_cleanup::washed(world, person);
            crate::chores::dish_washed(world, person.index_u32(), washed_units);
        }
        return;
    }
    if (def.id == "cook_dinner" || def.id == SNACK) && step == 1 {
        crate::chores::soil(
            world,
            station.index_u32(),
            if def.id == SNACK { 50 } else { 120 },
        );
        add_dishes(
            world,
            station.index_u32(),
            id.0,
            if def.id == SNACK { 1 } else { 3 },
        );
    }
    // Plating selects hungry friends once, with a stable upper bound.
    if def.id == "cook_dinner" && step as usize + 2 == def.steps.len() {
        let feelings = world
            .get::<Relationships>(person)
            .cloned()
            .unwrap_or_default();
        let invited: BTreeSet<_> = world
            .resource::<SavedDomestic>()
            .meals
            .iter()
            .flat_map(|meal| {
                meal.guests
                    .iter()
                    .filter(|guest| !meal.eaten.contains(guest))
            })
            .copied()
            .collect();
        let mut guests: Vec<_> = world
            .query_filtered::<(Entity, &SimId, &Needs), With<Agent>>()
            .iter(world)
            .filter(|(e, guest, needs)| {
                *e != person
                    && feelings.feeling(**guest) >= tuning.friend_affinity
                    && !invited.contains(&guest.0)
                    && needs.get(NeedId::Hunger) <= tuning.invite_hunger_level
                    && needs.get(NeedId::Energy) > pack.tuning.mood_critical_need_level
            })
            .map(|(e, guest, _)| (guest.0, e.index_u32()))
            .collect();
        guests.sort_unstable();
        guests.truncate(3);
        let scale = world
            .get::<ChainState>(person)
            .map_or(1.0, |chain| chain.fumble_scale);
        world
            .resource_mut::<SavedDomestic>()
            .serving_meals
            .retain(|(cook, _)| *cook != id.0);
        if !guests.is_empty() {
            let tick = world.resource::<SimClock>().tick;
            let mut state = world.resource_mut::<SavedDomestic>();
            state.serving_meals.push((id.0, tick));
            state.serving_meals.sort_unstable();
            state.meals.push(SavedMeal {
                cook: id.0,
                counter: station.index_u32(),
                table: None,
                guests: guests.into_iter().map(|(id, _)| id).collect(),
                claimed: Vec::new(),
                collected: Vec::new(),
                eaten: Vec::new(),
                scale,
                tick,
                dining_started: false,
            });
        }
    }
    if def.id == SHARED && step == 0 {
        if let Some(meal) = world
            .resource_mut::<SavedDomestic>()
            .meals
            .iter_mut()
            .find(|meal| meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0))
        {
            meal.collected.push(id.0);
        }
    }
    if step as usize + 1 != def.steps.len() {
        return;
    }
    if def.id == "cook_dinner" || def.id == SNACK || def.id == SHARED {
        let diner = crate::dining::release(world, person.index_u32());
        let obstructing = world
            .get_resource::<SavedDining>()
            .and_then(|s| s.complaints.iter().find(|(p, _)| *p == person.index_u32()))
            .map_or(vec![], |(_, ids)| ids.clone());
        if def.id == "cook_dinner" {
            world
                .resource_mut::<SavedDomestic>()
                .serving_meals
                .retain(|(cook, _)| *cook != id.0);
        }
        add_dishes(world, station.index_u32(), id.0, 1);
        let dish = world.resource::<SavedDomestic>().next_dish - 1;
        if let Some(diner) = &diner {
            if let Some(setting) = diner.setting {
                world
                    .resource_mut::<SavedDining>()
                    .settings
                    .push((dish, setting));
                world.resource_mut::<SavedDining>().settings.sort_unstable();
            }
        }
        if def.id == SHARED {
            let mut state = world.resource_mut::<SavedDomestic>();
            if let Some(meal) = state
                .meals
                .iter_mut()
                .find(|meal| meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0))
            {
                meal.eaten.push(id.0);
            }
        }
        let Some(needs) = world.get::<Needs>(person).cloned() else {
            return;
        };
        let probability = cleanup_probability(
            cleanliness(world, person),
            &needs,
            pack.tuning.mood_critical_need_level,
            &tuning,
        );
        let own = roll(
            world,
            (probability * crate::chores::cleanup_bias(world, person)).min(0.99),
        );
        let blocked = !obstructing.is_empty();
        let response = blocked
            && roll(
                world,
                blocked_cleanup_probability(
                    cleanliness(world, person),
                    &needs,
                    pack.tuning.mood_critical_need_level,
                    &tuning,
                ),
            );
        if own || response {
            let dishes = world
                .resource::<SavedDomestic>()
                .dishes
                .iter()
                .filter(|dish| {
                    (own && dish.owner == id.0) || (response && obstructing.contains(&dish.id))
                })
                .filter(|dish| {
                    !world
                        .resource::<SavedDomestic>()
                        .cleanup
                        .iter()
                        .any(|task| task.dishes.contains(&dish.id))
                })
                .map(|dish| dish.id)
                .collect();
            start_cleanup(world, person, dishes, false);
        }
        crate::dining::maintain(world);
    }
}

pub(crate) fn wash_ticks(state: &SavedDomestic, person: u32, base: u32, per_unit: u32) -> u32 {
    let Some(task) = state.cleanup.iter().find(|task| task.person == person) else {
        return base;
    };
    let units: u32 = state
        .dishes
        .iter()
        .filter(|dish| task.dishes.contains(&dish.id))
        .map(|dish| dish.units)
        .sum();
    base.saturating_add(units.saturating_mul(per_unit))
}

pub(crate) fn snapshot(world: &World) -> Option<SavedDomestic> {
    world
        .get_resource::<SavedDomestic>()
        .filter(|state| **state != SavedDomestic::default())
        .cloned()
}

pub(crate) fn restore(world: &mut World, saved: Option<SavedDomestic>) -> Result<(), SaveError> {
    let pack = world.resource::<Content>().0;
    let domestic_chains: Vec<_> = world
        .query::<(Entity, &ChainState)>()
        .iter(world)
        .filter(|(_, chain)| {
            matches!(
                pack.chains[chain.chain as usize].id.as_str(),
                CLEANUP | SHARED
            )
        })
        .map(|(person, chain)| (person, *chain))
        .collect();
    let Some(state) = saved else {
        return if domestic_chains.is_empty() {
            Ok(())
        } else {
            Err(SaveError::InvalidValue)
        };
    };
    let cooks: Vec<_> = world
        .query::<(Entity, &SimId, &ChainState)>()
        .iter(world)
        .filter(|(_, _, chain)| {
            pack.chains[chain.chain as usize].id == "cook_dinner" && chain.step == 5
        })
        .map(|(person, id, _)| (person, id.0))
        .collect();
    let person = |index| {
        entity(world, index)
            .is_some_and(|e| world.get::<Agent>(e).is_some() && world.get::<SimId>(e).is_some())
    };
    let object =
        |index| entity(world, index).is_some_and(|e| world.get::<SmartObject>(e).is_some());
    let unique = |ids: &[u32]| ids.iter().copied().collect::<BTreeSet<_>>().len() == ids.len();
    let tiles = world.resource::<TileGrid>().width() * world.resource::<TileGrid>().height();
    if [
        state.cleanliness.len(),
        state.dishes.len(),
        state.visits.len(),
        state.cleanup.len(),
        state.meals.len(),
        state.serving_meals.len(),
    ]
    .into_iter()
    .any(|length| length > 65_536)
        || state.cleanliness.windows(2).any(|p| p[0].0 >= p[1].0)
        || state
            .cleanliness
            .iter()
            .any(|(p, c)| !person(*p) || !c.is_finite() || !(0.0..=1.0).contains(c))
        || state.dishes.windows(2).any(|p| p[0].id >= p[1].id)
        || state.dishes.iter().any(|dish| {
            dish.id >= state.next_dish
                || dish.units == 0
                || dish.units > 16
                || !object(dish.surface)
                || !crate::family::was_issued(world, dish.owner)
        })
        || state.visits.windows(2).any(|p| p[0].person >= p[1].person)
        || state.visits.iter().any(|visit| {
            !person(visit.person)
                || visit.room as usize >= tiles
                || visit.seen.len() > state.dishes.len()
                || visit.seen.windows(2).any(|p| p[0] >= p[1])
                || visit
                    .seen
                    .iter()
                    .any(|id| !state.dishes.iter().any(|dish| dish.id == *id))
        })
        || state.cleanup.windows(2).any(|p| p[0].person >= p[1].person)
        || state.cleanup.iter().any(|task| {
            !person(task.person)
                || (task.dishes.is_empty()
                    && !crate::targeted_cleanup::has_active(world, task.person))
                || !unique(&task.dishes)
                || !unique(&task.collected)
                || entity(world, task.person)
                    .and_then(|person| world.get::<ChainState>(person))
                    .is_none_or(|chain| {
                        world.resource::<Content>().0.chains[chain.chain as usize].id != CLEANUP
                    })
                || task
                    .dishes
                    .iter()
                    .any(|id| !state.dishes.iter().any(|dish| dish.id == *id))
                || task.collected.iter().any(|id| !task.dishes.contains(id))
        })
        || state.meals.iter().any(|meal| {
            !object(meal.counter)
                || (meal.dining_started
                    && meal.table.is_none()
                    && world
                        .get_resource::<SavedDining>()
                        .is_none_or(|s| !s.tableless.contains(&(meal.cook, meal.tick))))
                || meal.table.is_some_and(|table| !object(table))
                || !crate::family::was_issued(world, meal.cook)
                || meal.guests.is_empty()
                || meal.guests.len() > 3
                || meal.guests.windows(2).any(|p| p[0] >= p[1])
                || meal.guests.contains(&meal.cook)
                || meal
                    .guests
                    .iter()
                    .any(|id| !crate::family::was_issued(world, *id))
                || !unique(&meal.claimed)
                || !unique(&meal.collected)
                || !unique(&meal.eaten)
                || meal.collected.iter().any(|id| !meal.claimed.contains(id))
                || meal.claimed.iter().any(|id| !meal.guests.contains(id))
                || meal.eaten.iter().any(|id| !meal.claimed.contains(id))
                || !meal.scale.is_finite()
                || !(0.0..=1.0).contains(&meal.scale)
                || meal.tick > world.resource::<SimClock>().tick
        })
        || state
            .serving_meals
            .windows(2)
            .any(|pair| pair[0].0 >= pair[1].0)
        || state.serving_meals.iter().any(|(cook, tick)| {
            !state
                .meals
                .iter()
                .any(|meal| meal.cook == *cook && meal.tick == *tick)
                || !cooks.iter().any(|(_, id)| id == cook)
        })
    {
        return Err(SaveError::InvalidValue);
    }
    let mut meal_keys = BTreeSet::new();
    if state
        .meals
        .iter()
        .any(|meal| !meal_keys.insert((meal.cook, meal.tick)))
    {
        return Err(SaveError::InvalidValue);
    }
    for (cook, tick) in &state.serving_meals {
        let person = cooks.iter().find(|(_, id)| id == cook).unwrap().0;
        if let Some(target) = world
            .get::<Target>(person)
            .filter(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
        {
            let meal = state
                .meals
                .iter()
                .find(|meal| meal.cook == *cook && meal.tick == *tick)
                .unwrap();
            if meal.table != Some(target.object.index_u32())
                && !crate::dining::claim(world, person.index_u32())
                    .is_some_and(|d| d.station == target.object.index_u32() && d.chair.is_none())
            {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    let mut claimed = BTreeSet::new();
    if state
        .cleanup
        .iter()
        .flat_map(|task| &task.dishes)
        .any(|id| !claimed.insert(*id))
    {
        return Err(SaveError::InvalidValue);
    }
    let mut guests = BTreeSet::new();
    if state
        .meals
        .iter()
        .flat_map(|meal| {
            meal.guests
                .iter()
                .filter(|guest| !meal.eaten.contains(guest))
        })
        .any(|guest| !guests.insert(*guest))
    {
        return Err(SaveError::InvalidValue);
    }
    let has_role = |surface, role: &str| {
        entity(world, surface)
            .and_then(|e| world.get::<SmartObject>(e))
            .is_some_and(|object| {
                pack.object(object.0)
                    .roles
                    .iter()
                    .any(|r| pack.roles[*r as usize] == role)
            })
    };
    for meal in &state.meals {
        if !has_role(meal.counter, "prep_surface")
            || meal
                .table
                .is_some_and(|table| !has_role(table, "eating_surface"))
        {
            return Err(SaveError::InvalidValue);
        }
        for guest in meal
            .claimed
            .iter()
            .filter(|guest| !meal.eaten.contains(guest))
        {
            let person = domestic_chains.iter().find(|(person, chain)| {
                world.get::<SimId>(*person) == Some(&SimId(*guest))
                    && pack.chains[chain.chain as usize].id == SHARED
            });
            if person.is_none_or(|(_, chain)| {
                chain.fumble_scale.to_bits() != meal.scale.to_bits()
                    || (chain.step == 1) != meal.collected.contains(guest)
            }) {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    for (person, chain) in domestic_chains {
        let name = pack.chains[chain.chain as usize].id.as_str();
        let id = world.get::<SimId>(person).copied();
        if name == CLEANUP {
            let task = state
                .cleanup
                .iter()
                .find(|task| task.person == person.index_u32())
                .ok_or(SaveError::InvalidValue)?;
            if chain.step == 1 && task.collected.len() != task.dishes.len() {
                return Err(SaveError::InvalidValue);
            }
        } else if !state.meals.iter().any(|meal| {
            id.is_some_and(|id| meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0))
        }) {
            return Err(SaveError::InvalidValue);
        }
        if let Some(target) = world
            .get::<Target>(person)
            .filter(|target| target.interaction == crate::systems::chain::CHAIN_STEP)
        {
            let valid = if name == CLEANUP && chain.step == 1 {
                has_role(target.object.index_u32(), "dish_sink")
            } else {
                step_station(&state, person.index_u32(), id, name, chain.step)
                    == Some(target.object.index_u32())
                    || (chain.step == 1
                        && name == SHARED
                        && crate::dining::claim(world, person.index_u32())
                            .is_some_and(|d| d.station == target.object.index_u32()))
            };
            if !valid {
                return Err(SaveError::InvalidValue);
            }
        } else if world.get::<StepWork>(person).is_some() {
            return Err(SaveError::InvalidValue);
        }
    }
    world.insert_resource(state);
    Ok(())
}

pub(crate) fn hash(world: &World, hash: &mut terri_core::FnvHasher) {
    let Some(state) = snapshot(world) else { return };
    hash.write_bytes(b"domestic-v1");
    if !state.serving_meals.is_empty() {
        hash.write_bytes(b"serving-meals");
        hash.write_u64(state.serving_meals.len() as u64);
        for (cook, tick) in &state.serving_meals {
            hash.write_u64(u64::from(*cook));
            hash.write_u64(*tick);
        }
    }
    hash.write_u64(state.next_dish as u64);
    hash.write_u64(state.cleanliness.len() as u64);
    for (id, score) in state.cleanliness {
        hash.write_u64(id as u64);
        hash.write_u64(score.to_bits() as u64);
    }
    hash.write_u64(state.dishes.len() as u64);
    for dish in state.dishes {
        for value in [dish.id, dish.surface, dish.owner, dish.units] {
            hash.write_u64(value as u64);
        }
    }
    hash.write_u64(state.visits.len() as u64);
    for visit in state.visits {
        hash.write_u64(visit.person as u64);
        hash.write_u64(visit.room as u64);
        hash.write_u64(visit.seen.len() as u64);
        for id in visit.seen {
            hash.write_u64(id as u64);
        }
    }
    hash.write_u64(state.cleanup.len() as u64);
    for task in state.cleanup {
        hash.write_u64(task.person as u64);
        hash.write_u64(task.directed as u64);
        for ids in [task.dishes, task.collected] {
            hash.write_u64(ids.len() as u64);
            for id in ids {
                hash.write_u64(id as u64);
            }
        }
    }
    hash.write_u64(state.meals.len() as u64);
    for meal in state.meals {
        hash.write_u64(meal.cook as u64);
        hash.write_u64(meal.counter as u64);
        hash.write_u64(meal.table.map_or(u64::MAX, u64::from));
        hash.write_u64(meal.scale.to_bits() as u64);
        hash.write_u64(meal.tick);
        hash.write_u64(u64::from(meal.dining_started));
        for ids in [meal.guests, meal.claimed, meal.collected, meal.eaten] {
            hash.write_u64(ids.len() as u64);
            for id in ids {
                hash.write_u64(id as u64);
            }
        }
    }
}

pub(crate) fn directed_cleanup(world: &mut World, person: Entity) {
    if !world.contains_resource::<SavedDomestic>() {
        world.insert_resource(SavedDomestic::default());
    }
    abandon(world, person);
    let dishes = world
        .resource::<SavedDomestic>()
        .dishes
        .iter()
        .filter(|dish| {
            !world
                .resource::<SavedDomestic>()
                .cleanup
                .iter()
                .any(|task| task.dishes.contains(&dish.id))
        })
        .map(|dish| dish.id)
        .collect();
    if !start_cleanup(world, person, dishes, true) {
        world.entity_mut(person).remove::<ChainState>();
    }
}

/// Cancelling or replacing a chain releases all owned domestic commitments.
/// Collected dishes return to their source; a guest's abandoned plate is dirty.
pub(crate) fn abandon(world: &mut World, person: Entity) {
    crate::chores::cancel(world, person);
    crate::targeted_cleanup::abandon(world, person.index_u32());
    crate::dining::release(world, person.index_u32());
    if let Some(mut state) = world.get_resource_mut::<terri_core::save::SavedDining>() {
        state.complaints.retain(|(p, _)| *p != person.index_u32());
    }
    let id = world.get::<SimId>(person).copied();
    let plates = {
        let Some(mut state) = world.get_resource_mut::<SavedDomestic>() else {
            return;
        };
        state
            .cleanup
            .retain(|task| task.person != person.index_u32());
        let mut plates = Vec::new();
        if let Some(id) = id {
            state.serving_meals.retain(|(cook, _)| *cook != id.0);
            for meal in &mut state.meals {
                if meal.claimed.contains(&id.0) && !meal.eaten.contains(&id.0) {
                    meal.eaten.push(id.0);
                    plates.push(meal.counter);
                }
            }
        }
        state
            .meals
            .retain(|meal| meal.guests.iter().any(|guest| !meal.eaten.contains(guest)));
        let surviving: BTreeSet<_> = state
            .meals
            .iter()
            .map(|meal| (meal.cook, meal.tick))
            .collect();
        state.serving_meals.retain(|meal| surviving.contains(meal));
        plates
    };
    for counter in plates {
        add_dishes(world, counter, id.unwrap().0, 1);
    }
    crate::dining::maintain(world);
}

pub(crate) fn remove_person(world: &mut World, person: Entity) {
    if let Some(mut state) = world.get_resource_mut::<terri_core::save::SavedDining>() {
        state
            .opportunities
            .retain(|o| o.person != person.index_u32());
    }
    abandon(world, person);
    let id = world.get::<SimId>(person).copied();
    {
        let Some(mut state) = world.get_resource_mut::<SavedDomestic>() else {
            return;
        };
        state
            .cleanliness
            .retain(|(index, _)| *index != person.index_u32());
        state
            .visits
            .retain(|visit| visit.person != person.index_u32());
        if let Some(id) = id {
            for meal in &mut state.meals {
                meal.guests.retain(|guest| *guest != id.0);
                meal.claimed.retain(|guest| *guest != id.0);
                meal.collected.retain(|guest| *guest != id.0);
                meal.eaten.retain(|guest| *guest != id.0);
            }
            state.meals.retain(|meal| !meal.guests.is_empty());
            let surviving: BTreeSet<_> = state
                .meals
                .iter()
                .map(|meal| (meal.cook, meal.tick))
                .collect();
            state.serving_meals.retain(|meal| surviving.contains(meal));
        }
    }
    crate::dining::maintain(world);
}

pub(crate) fn surface_in_use(world: &World, surface: u32) -> bool {
    world.get_resource::<SavedDomestic>().is_some_and(|state| {
        state.dishes.iter().any(|dish| dish.surface == surface)
            || state
                .meals
                .iter()
                .any(|meal| meal.counter == surface || meal.table == Some(surface))
    })
}

pub(crate) fn hidden_chain(id: &str) -> bool {
    id == SNACK || id == SHARED
}

pub(crate) fn meal_label(tick: u64, day: u32) -> &'static str {
    let hour = (tick % u64::from(day)) * 24 / u64::from(day);
    if hour < 11 {
        "Cook breakfast"
    } else if hour < 17 {
        "Cook lunch"
    } else {
        "Cook dinner"
    }
}

/// Flattened surface, dirty-unit count, and available-food count for rendering.
pub fn surface_items(world: &World) -> Vec<u32> {
    let Some(state) = world.get_resource::<SavedDomestic>() else {
        return Vec::new();
    };
    let mut surfaces = std::collections::BTreeMap::<u32, (u32, u32)>::new();
    for dish in &state.dishes {
        if visible(state, dish.id) {
            surfaces.entry(dish.surface).or_default().0 += dish.units;
        }
    }
    for meal in &state.meals {
        surfaces.entry(meal.counter).or_default().1 += meal
            .guests
            .iter()
            .filter(|id| !meal.collected.contains(id) && !meal.eaten.contains(id))
            .count() as u32;
    }
    surfaces
        .into_iter()
        .flat_map(|(surface, (dirty, food))| [surface, dirty, food])
        .collect()
}

/// Collected dish units per carrier; uses the same claims that hide surface dishes.
pub(crate) fn carried_dishes(world: &World) -> std::collections::BTreeMap<u32, u32> {
    let Some(state) = world.get_resource::<SavedDomestic>() else {
        return Default::default();
    };
    state
        .cleanup
        .iter()
        .map(|task| {
            let units = state
                .dishes
                .iter()
                .filter(|dish| task.collected.contains(&dish.id))
                .map(|dish| dish.units)
                .sum();
            (task.person, units)
        })
        .collect()
}

/// A different activity frees the Sim's hands. Resume by collecting again.
pub(crate) fn suspend_cleanup(world: &mut World, person: Entity) {
    crate::dining::release(world, person.index_u32());
    let Some(chain) = world.get::<ChainState>(person) else {
        return;
    };
    if world.resource::<Content>().0.chains[chain.chain as usize].id != CLEANUP {
        return;
    }
    if let Some(mut state) = world.get_resource_mut::<SavedDomestic>() {
        if let Some(task) = state
            .cleanup
            .iter_mut()
            .find(|task| task.person == person.index_u32())
        {
            task.collected.clear();
        }
    }
    world.get_mut::<ChainState>(person).unwrap().step = 0;
}

/// Minimal occupancy snapshot for a privacy detour or late station recheck.
#[derive(Clone)]
pub(crate) struct BoundaryOccupant {
    pub actor: Entity,
    pub target: Target,
    pub chain: Option<ChainState>,
    pub seat: (i32, i32),
    pub dining_endpoint: Option<(i32, i32)>,
}

pub(crate) fn boundary_occupants(world: &mut World) -> Vec<BoundaryOccupant> {
    let dining = world
        .get_resource::<SavedDining>()
        .cloned()
        .unwrap_or_default();
    world
        .query::<(
            Entity,
            &Target,
            &Position,
            Option<&terri_core::Path>,
            Option<&ChainState>,
        )>()
        .iter(world)
        .map(|(actor, target, position, path, chain)| BoundaryOccupant {
            actor,
            target: *target,
            chain: chain.copied(),
            dining_endpoint: dining
                .diners
                .iter()
                .find(|d| d.person == actor.index_u32() && d.station == target.object.index_u32())
                .map(|d| d.endpoint),
            seat: path
                .and_then(|path| path.steps.last().copied())
                .unwrap_or((position.x.round() as i32, position.y.round() as i32)),
        })
        .collect()
}

/// Preserve fixed domestic stations, communal capacity and distinct seats while detouring.
#[allow(clippy::too_many_arguments)]
pub(crate) fn boundary_route(
    pack: &terri_data::ContentPack,
    state: Option<&SavedDomestic>,
    actor: Entity,
    id: Option<SimId>,
    chain_state: ChainState,
    station: Entity,
    object: terri_core::ObjectDefId,
    facing: Option<&terri_core::ObjectFacing>,
    to: Position,
    from: Position,
    grid: &terri_core::TileGrid,
    exclusive: bool,
    occupants: &[BoundaryOccupant],
) -> Option<Vec<(i32, i32)>> {
    let start = (from.x.round() as i32, from.y.round() as i32);
    let chain = pack.chains.get(chain_state.chain as usize)?;
    if crate::dining::managed_step(pack, chain, chain_state.step) {
        let endpoint = occupants
            .iter()
            .find(|row| {
                row.actor == actor
                    && row.target.object == station
                    && row.target.interaction == crate::systems::chain::CHAIN_STEP
            })?
            .dining_endpoint?;
        if !grid.is_walkable(start.0, start.1) || !grid.is_walkable(endpoint.0, endpoint.1) {
            return None;
        }
        return grid
            .find_path(start, endpoint)
            .and_then(|steps| grid.anchor_path((from.x, from.y), steps));
    }
    let step = chain.steps.get(chain_state.step as usize)?;
    let fixed = state
        .and_then(|state| step_station(state, actor.index_u32(), id, &chain.id, chain_state.step));
    let awaiting = state.is_some_and(|state| awaiting_meal_table(state, id, chain_state.step));
    let def = pack.object(object);
    if (chain.id == SHARED && fixed.is_none() && !awaiting)
        || fixed.is_some_and(|index| index != station.index_u32())
        || (fixed.is_none() && !def.roles.contains(&step.role))
        || (chain.id != CLEANUP
            && pack.roles[step.role as usize] == "prep_surface"
            && def
                .roles
                .iter()
                .any(|role| pack.roles[*role as usize] == "dish_sink"))
    {
        return None;
    }
    let communal = communal(&chain.id, chain_state.step, chain.steps.len());
    let others: Vec<_> = occupants
        .iter()
        .filter(|row| row.actor != actor && row.target.object == station)
        .collect();
    let sharing = communal
        && !others.is_empty()
        && others.len() < 4
        && others.iter().all(|row| {
            row.target.interaction == crate::systems::chain::CHAIN_STEP
                && row.chain.is_some_and(|c| {
                    let other = &pack.chains[c.chain as usize];
                    self::communal(&other.id, c.step, other.steps.len())
                })
        });
    if !exclusive && !sharing {
        return None;
    }
    let mut route_grid = grid.clone();
    if communal {
        for row in others {
            if row.seat != start {
                route_grid.set_blocked(row.seat.0 as usize, row.seat.1 as usize, true);
            }
        }
    }
    if step
        .visual
        .as_ref()
        .is_some_and(|v| v.action == terri_data::CompiledVisualAction::Cook)
    {
        if let Some(front) = crate::stove_front(pack, &terri_core::SmartObject(object), &to, facing)
        {
            if !route_grid.is_walkable(start.0, start.1)
                || !route_grid.is_walkable(front.x.round() as i32, front.y.round() as i32)
            {
                return None;
            }
            return route_grid
                .find_path(start, (front.x.round() as i32, front.y.round() as i32))
                .and_then(|steps| route_grid.anchor_path((from.x, from.y), steps));
        }
    }
    route_grid
        .find_path_adjacent(
            start,
            (to.x.round() as i32, to.y.round() as i32),
            crate::placed_footprint(pack, object, facing),
        )
        .and_then(|steps| route_grid.anchor_path((from.x, from.y), steps))
}
