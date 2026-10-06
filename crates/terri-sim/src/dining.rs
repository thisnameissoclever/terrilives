//! Exact chair and setting claims for meal chains, including standing fallback.
#[cfg(test)]
mod tests;
use crate::{Content, SaveError};
use bevy_ecs::prelude::*;
use terri_core::{
    save::*, Agent, AtWork, Blocked, ChainState, Commuting, Eating, IntentQueue, ObjectFacing,
    Path, Position, Reserved, SimId, SmartObject, Socialising, StepWork, Target, TileGrid,
};

pub(crate) fn entity(world: &World, index: u32) -> Option<Entity> {
    let index = bevy_ecs::entity::EntityIndex::from_raw_u32(index)?;
    let e = world.entities().resolve_from_index(index);
    world.get_entity(e).ok().map(|_| e)
}

fn role(world: &World, e: Entity, name: &str) -> bool {
    world.get::<SmartObject>(e).is_some_and(|o| {
        let pack = world.resource::<Content>().0;
        pack.object(o.0)
            .roles
            .iter()
            .any(|r| pack.roles[*r as usize] == name)
    })
}

pub(crate) fn terminal(world: &World, e: Entity) -> bool {
    world.get::<ChainState>(e).is_some_and(|s| {
        let pack = world.resource::<Content>().0;
        pack.chains
            .get(s.chain as usize)
            .is_some_and(|c| managed_step(pack, c, s.step))
    })
}

pub(crate) fn managed_step(
    pack: &terri_data::ContentPack,
    chain: &terri_data::CompiledChain,
    step: u32,
) -> bool {
    crate::domestic::communal(&chain.id, step, chain.steps.len())
        && chain.steps.get(step as usize).is_some_and(|s| {
            pack.roles
                .get(s.role as usize)
                .is_some_and(|r| r == "meal_table")
        })
}

pub(crate) fn claim(world: &World, person: u32) -> Option<&SavedDiner> {
    crate::seating::claim(world, person)
        .filter(|d| crate::seating::kind(world, d) == Some(crate::seating::UseKind::Meal))
}

pub(crate) fn object_in_use(world: &World, object: u32) -> bool {
    crate::seating::object_in_use(world, object)
}

pub(crate) fn release(world: &mut World, person: u32) -> Option<SavedDiner> {
    claim(world, person)?;
    crate::seating::release(world, person)
}

/// Four authored place settings: two along each long edge, rotated with the table.
fn setting_for(world: &World, table: Entity, chair: Entity) -> Option<(u8, (i32, i32))> {
    if world
        .get::<SmartObject>(chair)
        .is_none_or(|o| world.resource::<Content>().0.object(o.0).id != "chair")
    {
        return None;
    }
    let p = world.get::<Position>(table)?;
    let c = world.get::<Position>(chair)?;
    let facing = world
        .get::<ObjectFacing>(table)
        .map_or(terri_core::Facing::SouthEast, |f| f.0);
    let front = world
        .get::<ObjectFacing>(chair)
        .map_or(terri_core::Facing::SouthEast, |f| f.0)
        .rotate_axis(0, 1);
    let positions = [
        (0, -1, 0, (0, 1)),
        (1, -1, 1, (0, 1)),
        (0, 1, 2, (0, -1)),
        (1, 1, 3, (0, -1)),
        (-1, 0, 0, (1, 0)),
        (2, 0, 1, (-1, 0)),
    ];
    for (x, y, slot, axis) in positions {
        let (x, y) = match facing {
            terri_core::Facing::SouthEast => (x, y),
            terri_core::Facing::SouthWest => (-y, x),
            terri_core::Facing::NorthWest => (1 - x, -y),
            terri_core::Facing::NorthEast => (y, 1 - x),
        };
        if (c.x.round() as i32, c.y.round() as i32)
            == (p.x.round() as i32 + x, p.y.round() as i32 + y)
            && front == facing.rotate_axis(axis.0, axis.1)
        {
            return Some((slot, chair_approaches(world, chair)[0]));
        }
    }
    None
}

fn chair_approaches(world: &World, chair: Entity) -> [(i32, i32); 3] {
    let p = world.get::<Position>(chair).unwrap();
    let (x, y) = (p.x.round() as i32, p.y.round() as i32);
    let front = world
        .get::<ObjectFacing>(chair)
        .map_or(terri_core::Facing::SouthEast, |f| f.0)
        .rotate_axis(0, 1);
    [
        (x - front.1, y + front.0),
        (x + front.1, y - front.0),
        (x - front.0, y - front.1),
    ]
}

fn standing_contact(world: &World, station: Entity, endpoint: (i32, i32)) -> bool {
    let Some(p) = world.get::<Position>(station) else {
        return false;
    };
    let Some(o) = world.get::<SmartObject>(station) else {
        return false;
    };
    let f = crate::placed_footprint(
        world.resource::<Content>().0,
        o.0,
        world.get::<ObjectFacing>(station),
    );
    let (x, y) = (p.x.round() as i32, p.y.round() as i32);
    endpoint.0 >= x - 2
        && endpoint.0 <= x + f.width as i32 + 1
        && endpoint.1 >= y - 2
        && endpoint.1 <= y + f.depth as i32 + 1
        && !(endpoint.0 >= x
            && endpoint.0 < x + f.width as i32
            && endpoint.1 >= y
            && endpoint.1 < y + f.depth as i32)
}

pub(crate) fn dirty_at(world: &World, table: u32, setting: u8) -> Vec<u32> {
    let Some(domestic) = world.get_resource::<SavedDomestic>() else {
        return vec![];
    };
    let Some(dining) = world.get_resource::<SavedDining>() else {
        return vec![];
    };
    domestic
        .dishes
        .iter()
        .filter(|d| d.surface == table && crate::domestic::visible(domestic, d.id))
        .filter(|d| dining.settings.contains(&(d.id, setting)))
        .map(|d| d.id)
        .collect()
}

pub(crate) fn setting_counts(world: &World, table: u32) -> u32 {
    let atlas = [2, 0, 1, 3];
    let mut packed = 0;
    for setting in 0..4 {
        packed |=
            (dirty_at(world, table, setting).len().min(15) as u32) << (4 * atlas[setting as usize]);
    }
    packed
}

/// Initialize old dishes once; claiming or returning a pile never moves its setting.
pub(crate) fn maintain(world: &mut World) {
    if !world.contains_resource::<SavedDining>() {
        world.insert_resource(SavedDining::default());
    }
    let dishes = world
        .get_resource::<SavedDomestic>()
        .map_or(vec![], |s| s.dishes.clone());
    let mut state = world.resource::<SavedDining>().clone();
    state.tableless.retain(|(cook, tick)| {
        world.get_resource::<SavedDomestic>().is_some_and(|s| {
            s.meals.iter().any(|m| {
                m.cook == *cook && m.tick == *tick && m.table.is_none() && m.dining_started
            })
        })
    });
    state
        .complaints
        .retain(|(p, _)| entity(world, *p).is_some_and(|e| terminal(world, e)));
    for (_, ids) in &mut state.complaints {
        ids.retain(|id| dishes.iter().any(|d| d.id == *id));
    }
    state.complaints.retain(|(_, ids)| !ids.is_empty());
    for o in &mut state.opportunities {
        o.known.retain(|id| dishes.iter().any(|d| d.id == *id));
    }
    state
        .settings
        .retain(|(id, _)| dishes.iter().any(|d| d.id == *id));
    state
        .diners
        .retain(|d| crate::seating::kind(world, d).is_some());
    for diner in &mut state.diners {
        diner.obstructing.retain(|id| {
            world.get_resource::<SavedDomestic>().is_some_and(|s| {
                dishes.iter().any(|d| d.id == *id) && crate::domestic::visible(s, *id)
            })
        });
    }
    state
        .opportunities
        .retain(|o| entity(world, o.person).is_some_and(|e| world.get::<Agent>(e).is_some()));
    for dish in &dishes {
        if entity(world, dish.surface).is_some_and(|e| role(world, e, "meal_table"))
            && !state.settings.iter().any(|(id, _)| *id == dish.id)
        {
            let occupied: Vec<_> = dishes
                .iter()
                .filter(|d| d.surface == dish.surface)
                .flat_map(|d| {
                    state
                        .settings
                        .iter()
                        .filter(move |(id, _)| *id == d.id)
                        .map(|(_, s)| *s)
                })
                .collect();
            let first = (0..4).find(|s| !occupied.contains(s)).unwrap_or(0);
            for unit in 0..dish.units.min(4) {
                state.settings.push((dish.id, (first + unit as u8) % 4));
            }
        }
    }
    state.settings.sort_unstable();
    world.insert_resource(state);
}

/// Select and publish exact places before generic chain targeting runs.
pub(crate) fn advance(world: &mut World) {
    maintain(world);
    let mut people: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    people.sort_by_key(|e| e.index_u32());
    let mut furniture: Vec<_> = world
        .query::<(Entity, &SmartObject)>()
        .iter(world)
        .map(|(e, _)| e)
        .collect();
    furniture.sort_by_key(|e| e.index_u32());
    let owners: Vec<_> = world
        .query::<(Entity, &Target)>()
        .iter(world)
        .map(|(e, t)| (e, *t))
        .collect();
    let exclusive: Vec<_> = owners
        .into_iter()
        .filter(|(e, t)| {
            t.interaction != crate::systems::chain::CHAIN_STEP
                || !terminal(world, *e)
                || claim(world, e.index_u32()).is_none_or(|d| d.station != t.object.index_u32())
        })
        .map(|(_, t)| t.object)
        .collect();
    for person in people {
        if !terminal(world, person)
            || world.get::<Target>(person).is_some()
            || world.get::<Path>(person).is_some()
            || world.get::<Eating>(person).is_some()
            || world.get::<StepWork>(person).is_some()
            || world.get::<Socialising>(person).is_some()
            || world.get::<AtWork>(person).is_some()
            || world.get::<Commuting>(person).is_some()
            || world
                .get::<IntentQueue>(person)
                .is_some_and(|q| !q.is_empty())
        {
            continue;
        }
        release(world, person.index_u32());
        let pos = *world.get::<Position>(person).unwrap();
        let from = (pos.x.round() as i32, pos.y.round() as i32);
        let progress = *world.get::<ChainState>(person).unwrap();
        let name = world.resource::<Content>().0.chains[progress.chain as usize]
            .id
            .clone();
        let fixed = world.get_resource::<SavedDomestic>().and_then(|s| {
            crate::domestic::step_station(
                s,
                person.index_u32(),
                world.get::<SimId>(person).copied(),
                &name,
                progress.step,
            )
        });
        let tables: Vec<_> = furniture
            .iter()
            .copied()
            .filter(|e| role(world, *e, "meal_table") && fixed.is_none_or(|id| e.index_u32() == id))
            .collect();
        let mut best: Option<(SavedDiner, Vec<(i32, i32)>)> = None;
        let mut denied = vec![];
        let grid = world.resource::<TileGrid>();
        for table in &tables {
            let ordinary_occupied = exclusive.contains(table);
            for chair in &furniture {
                if world
                    .get::<SmartObject>(*chair)
                    .is_none_or(|o| world.resource::<Content>().0.object(o.0).id != "chair")
                {
                    continue;
                }
                let Some((setting, _approach)) = setting_for(world, *table, *chair) else {
                    continue;
                };
                if ordinary_occupied
                    || world.get::<Reserved>(*chair).is_some()
                    || world.resource::<SavedDining>().diners.iter().any(|d| {
                        d.chair == Some(chair.index_u32())
                            || (d.station == table.index_u32() && d.setting == Some(setting))
                    })
                {
                    continue;
                }
                let options = chair_approaches(world, *chair);
                let path = options
                    .into_iter()
                    .filter(|p| grid.is_walkable(p.0, p.1))
                    .filter(|p| {
                        !world
                            .resource::<SavedDining>()
                            .diners
                            .iter()
                            .any(|d| d.endpoint == *p)
                    })
                    .filter_map(|p| {
                        grid.find_path(from, p)
                            .and_then(|s| grid.anchor_path((pos.x, pos.y), s))
                            .map(|s| (p, s))
                    })
                    .min_by_key(|(_, s)| s.len());
                let Some((endpoint, path)) = path else {
                    continue;
                };
                let dirty = dirty_at(world, table.index_u32(), setting);
                if !dirty.is_empty() {
                    denied.extend(dirty);
                    continue;
                }
                if best.as_ref().is_none_or(|(_, s)| path.len() < s.len()) {
                    best = Some((
                        SavedDiner {
                            person: person.index_u32(),
                            station: table.index_u32(),
                            chair: Some(chair.index_u32()),
                            setting: Some(setting),
                            endpoint,
                            obstructing: vec![],
                        },
                        path,
                    ));
                }
            }
        }
        if best.is_none() {
            // Standing diners use free walkable contacts, including a small ring
            // around a crowded table. No table means eating beside a real counter.
            let mut surfaces = tables.clone();
            surfaces.extend(
                furniture
                    .iter()
                    .copied()
                    .filter(|e| role(world, *e, "prep_surface") && !role(world, *e, "dish_sink"))
                    .filter(|e| !tables.contains(e)),
            );
            for station in surfaces {
                if !role(world, station, "meal_table") && exclusive.contains(&station) {
                    continue;
                }
                // Prefer a reachable table; counters are the fallback after all
                // table routes fail, including a table in another room.
                if best.is_some() && !role(world, station, "meal_table") {
                    break;
                }
                let p = world.get::<Position>(station).unwrap();
                let f = crate::placed_footprint(
                    world.resource::<Content>().0,
                    world.get::<SmartObject>(station).unwrap().0,
                    world.get::<ObjectFacing>(station),
                );
                let origin = (p.x.round() as i32, p.y.round() as i32);
                for y in origin.1 - 2..=origin.1 + f.depth as i32 + 1 {
                    for x in origin.0 - 2..=origin.0 + f.width as i32 + 1 {
                        if !grid.is_walkable(x, y)
                            || world
                                .resource::<SavedDining>()
                                .diners
                                .iter()
                                .any(|d| d.endpoint == (x, y))
                        {
                            continue;
                        }
                        if let Some(path) = grid
                            .find_path(from, (x, y))
                            .and_then(|s| grid.anchor_path((pos.x, pos.y), s))
                        {
                            if best.as_ref().is_none_or(|(_, s)| path.len() < s.len()) {
                                best = Some((
                                    SavedDiner {
                                        person: person.index_u32(),
                                        station: station.index_u32(),
                                        chair: None,
                                        setting: None,
                                        endpoint: (x, y),
                                        obstructing: denied.clone(),
                                    },
                                    path,
                                ));
                            }
                        }
                    }
                }
            }
        }
        let Some((mut diner, path)) = best else {
            world.entity_mut(person).insert(Blocked);
            continue;
        };
        diner.obstructing.sort_unstable();
        diner.obstructing.dedup();
        let station = entity(world, diner.station).unwrap();
        if role(world, station, "meal_table") {
            if let Some(id) = world.get::<SimId>(person).copied() {
                if let Some(mut s) = world.get_resource_mut::<SavedDomestic>() {
                    crate::domestic::bind_meal_table(&mut s, id, diner.station, &name);
                }
            }
        }
        let noticed = world
            .resource::<SavedDining>()
            .complaints
            .iter()
            .find(|(p, _)| *p == person.index_u32())
            .map_or(vec![], |(_, ids)| ids.clone());
        let fresh: Vec<_> = diner
            .obstructing
            .iter()
            .copied()
            .filter(|id| !noticed.contains(id))
            .collect();
        crate::domestic::blocked_setting_annoyance(world, person, &fresh);
        let mut history = noticed;
        history.extend(fresh);
        history.sort_unstable();
        history.dedup();
        world
            .resource_mut::<SavedDining>()
            .complaints
            .retain(|(p, _)| *p != person.index_u32());
        if !history.is_empty() {
            world
                .resource_mut::<SavedDining>()
                .complaints
                .push((person.index_u32(), history));
        }
        world
            .resource_mut::<SavedDining>()
            .complaints
            .sort_by_key(|(p, _)| *p);
        world.entity_mut(station).insert(Reserved);
        world.resource_mut::<SavedDining>().diners.push(diner);
        world
            .resource_mut::<SavedDining>()
            .diners
            .sort_by_key(|d| d.person);
        world
            .entity_mut(person)
            .remove::<Blocked>()
            .remove::<terri_core::Restless>()
            .insert((
                Target {
                    object: station,
                    interaction: crate::systems::chain::CHAIN_STEP,
                },
                Path {
                    steps: path,
                    cursor: 0,
                },
            ));
    }
}

/// Eating at a real chair facing the claimed table, rather than standing nearby.
pub(crate) fn seated_at_table(world: &World, person: Entity) -> bool {
    let Some(diner) = claim(world, person.index_u32()) else {
        return false;
    };
    let Some(table) = entity(world, diner.station) else {
        return false;
    };
    let Some(chair) = diner.chair.and_then(|c| entity(world, c)) else {
        return false;
    };
    role(world, table, "meal_table")
        && setting_for(world, table, chair).map(|(setting, _)| setting) == diner.setting
        && diner.setting.is_some()
        && world
            .get::<Position>(person)
            .is_some_and(|p| (p.x.round() as i32, p.y.round() as i32) == diner.endpoint)
        && projection(world, person).is_some()
}

pub(crate) fn projection(world: &World, person: Entity) -> Option<crate::SocketActionProjection> {
    if world.get::<StepWork>(person).is_none()
        || world.get::<Eating>(person).is_some()
        || world.get::<Path>(person).is_some()
        || !terminal(world, person)
    {
        return None;
    }
    let state = world.get::<ChainState>(person)?;
    let step = world
        .resource::<Content>()
        .0
        .chains
        .get(state.chain as usize)?
        .steps
        .get(state.step as usize)?;
    if !crate::is_authored_station_visual(step)
        || step.visual.as_ref()?.action != terri_data::CompiledVisualAction::Eat
        || step.activity != Some(terri_data::CompiledActivity::Eating)
    {
        return None;
    }
    let d = claim(world, person.index_u32())?;
    let target = world.get::<Target>(person)?;
    if target.object.index_u32() != d.station
        || target.interaction != crate::systems::chain::CHAIN_STEP
    {
        return None;
    }
    let chair = entity(world, d.chair?)?;
    let p = world.get::<Position>(chair)?;
    let front = world
        .get::<ObjectFacing>(chair)
        .map_or(terri_core::Facing::SouthEast, |f| f.0)
        .rotate_axis(0, 1);
    let facing = match front {
        (1, 0) => 1,
        (-1, 0) => 2,
        (0, 1) => 3,
        _ => 4,
    };
    Some(crate::SocketActionProjection {
        x: p.x,
        y: p.y,
        facing,
        target_entity: chair.index_u32(),
        visual_action: crate::render_buffer::visual_action::SEATED_EAT,
        activity: crate::render_buffer::activity::EATING,
    })
}

pub(crate) fn snapshot(world: &World) -> Option<SavedDining> {
    world
        .get_resource::<SavedDining>()
        .filter(|s| **s != SavedDining::default())
        .cloned()
}

pub(crate) fn restore(world: &mut World, state: Option<SavedDining>) -> Result<(), SaveError> {
    let Some(state) = state else {
        // Historical meals already own their table contact. Adopt that contact
        // as standing dining before the first current-format re-save.
        let mut adopted = SavedDining::default();
        let mut people: Vec<_> = world
            .query_filtered::<Entity, With<Agent>>()
            .iter(world)
            .collect();
        people.sort_by_key(|p| p.index_u32());
        for person in people {
            if !terminal(world, person) {
                continue;
            }
            let Some(target) = world
                .get::<Target>(person)
                .filter(|t| t.interaction == crate::systems::chain::CHAIN_STEP)
            else {
                continue;
            };
            let pos = world
                .get::<Position>(person)
                .ok_or(SaveError::InvalidValue)?;
            let endpoint = world
                .get::<Path>(person)
                .and_then(|p| p.steps.last().copied())
                .unwrap_or((pos.x.round() as i32, pos.y.round() as i32));
            adopted.diners.push(SavedDiner {
                person: person.index_u32(),
                station: target.object.index_u32(),
                chair: None,
                setting: None,
                endpoint,
                obstructing: vec![],
            });
        }
        if adopted.diners.is_empty() {
            return Ok(());
        }
        world.insert_resource(adopted);
        maintain(world);
        return restore(world, Some(world.resource::<SavedDining>().clone()));
    };
    if state.diners.windows(2).any(|p| p[0].person >= p[1].person)
        || state.settings.windows(2).any(|p| p[0] >= p[1])
        || state
            .opportunities
            .windows(2)
            .any(|p| p[0].person >= p[1].person)
    {
        return Err(SaveError::InvalidValue);
    }
    for (i, d) in state.diners.iter().enumerate() {
        if crate::seating::kind(world, d) == Some(crate::seating::UseKind::Media) {
            if !crate::media::valid_lease(world, d)
                || state.diners[..i]
                    .iter()
                    .any(|other| other.chair == d.chair || other.endpoint == d.endpoint)
            {
                return Err(SaveError::InvalidValue);
            }
            continue;
        }
        let p = entity(world, d.person).ok_or(SaveError::InvalidValue)?;
        let station = entity(world, d.station).ok_or(SaveError::InvalidValue)?;
        if !terminal(world, p)
            || (!role(world, station, "meal_table") && !role(world, station, "prep_surface"))
            || d.chair.is_some() != d.setting.is_some()
            || d.setting.is_some_and(|s| s >= 4)
            || !world
                .resource::<TileGrid>()
                .is_walkable(d.endpoint.0, d.endpoint.1)
            || d.obstructing.windows(2).any(|p| p[0] >= p[1])
            || (d.chair.is_some() && !d.obstructing.is_empty())
            || d.obstructing.iter().any(|id| {
                world
                    .get_resource::<SavedDomestic>()
                    .is_none_or(|s| !s.dishes.iter().any(|dish| dish.id == *id))
            })
            || state.diners[..i].iter().any(|other| {
                d.chair.is_some()
                    && (other.chair == d.chair
                        || (other.station == d.station && other.setting == d.setting))
            })
        {
            return Err(SaveError::InvalidValue);
        }
        if let Some(c) = d.chair {
            if entity(world, c)
                .and_then(|c| setting_for(world, station, c))
                .is_none_or(|(s, _)| Some(s) != d.setting)
            {
                return Err(SaveError::InvalidValue);
            }
            if !chair_approaches(world, entity(world, c).unwrap()).contains(&d.endpoint) {
                return Err(SaveError::InvalidValue);
            }
        } else if !standing_contact(world, station, d.endpoint) {
            return Err(SaveError::InvalidValue);
        }
        if state.diners[..i]
            .iter()
            .any(|other| other.endpoint == d.endpoint)
        {
            return Err(SaveError::InvalidValue);
        }
        if world.get::<Target>(p).is_none_or(|t| {
            t.interaction != crate::systems::chain::CHAIN_STEP || t.object != station
        }) {
            return Err(SaveError::InvalidValue);
        }
        if let Some(target) = world
            .get::<Target>(p)
            .filter(|t| t.interaction == crate::systems::chain::CHAIN_STEP)
        {
            if target.object != station {
                return Err(SaveError::InvalidValue);
            }
            if let Some(path) = world.get::<Path>(p) {
                let pos = world.get::<Position>(p).unwrap();
                if path
                    .steps
                    .last()
                    .copied()
                    .unwrap_or((pos.x.round() as i32, pos.y.round() as i32))
                    != d.endpoint
                {
                    return Err(SaveError::InvalidValue);
                }
            } else if world.get::<StepWork>(p).is_some() {
                let pos = world.get::<Position>(p).unwrap();
                if (pos.x.round() as i32, pos.y.round() as i32) != d.endpoint {
                    return Err(SaveError::InvalidValue);
                }
            } else {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    for (id, setting) in &state.settings {
        if *setting >= 4
            || world.get_resource::<SavedDomestic>().is_none_or(|s| {
                !s.dishes.iter().any(|d| {
                    d.id == *id
                        && entity(world, d.surface).is_some_and(|e| role(world, e, "meal_table"))
                })
            })
        {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(mut people) = world.try_query_filtered::<Entity, With<Agent>>() {
        for person in people.iter(world) {
            if terminal(world, person)
                && world
                    .get::<Target>(person)
                    .is_some_and(|t| t.interaction == crate::systems::chain::CHAIN_STEP)
                && !state.diners.iter().any(|d| d.person == person.index_u32())
            {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    if world.get_resource::<SavedDomestic>().is_some_and(|s| {
        s.dishes.iter().any(|d| {
            entity(world, d.surface).is_some_and(|e| role(world, e, "meal_table"))
                && state.settings.iter().filter(|(id, _)| *id == d.id).count()
                    != d.units.min(4) as usize
        })
    }) {
        return Err(SaveError::InvalidValue);
    }
    for o in &state.opportunities {
        if entity(world, o.person).is_none_or(|e| world.get::<Agent>(e).is_none())
            || o.known.windows(2).any(|p| p[0] >= p[1])
            || o.room as usize
                >= world.resource::<TileGrid>().width() * world.resource::<TileGrid>().height()
            || o.known.iter().any(|id| {
                world
                    .get_resource::<SavedDomestic>()
                    .is_none_or(|s| !s.dishes.iter().any(|d| d.id == *id))
            })
        {
            return Err(SaveError::InvalidValue);
        }
    }
    if state.complaints.windows(2).any(|p| p[0].0 >= p[1].0) {
        return Err(SaveError::InvalidValue);
    }
    for (p, ids) in &state.complaints {
        if entity(world, *p).is_none_or(|e| !terminal(world, e))
            || ids.is_empty()
            || ids.windows(2).any(|p| p[0] >= p[1])
            || ids.iter().any(|id| {
                world
                    .get_resource::<SavedDomestic>()
                    .is_none_or(|s| !s.dishes.iter().any(|d| d.id == *id))
            })
        {
            return Err(SaveError::InvalidValue);
        }
    }
    if state.tableless.windows(2).any(|p| p[0] >= p[1])
        || state.tableless.iter().any(|(cook, tick)| {
            world.get_resource::<SavedDomestic>().is_none_or(|s| {
                !s.meals.iter().any(|m| {
                    m.cook == *cook && m.tick == *tick && m.table.is_none() && m.dining_started
                })
            })
        })
    {
        return Err(SaveError::InvalidValue);
    }
    world.insert_resource(state);
    Ok(())
}

pub(crate) fn hash(world: &World, h: &mut terri_core::FnvHasher) {
    if let Some(state) = snapshot(world) {
        h.write_bytes(b"dining-v1");
        h.write_u64(state.diners.len() as u64);
        for d in state.diners {
            for v in [
                d.person as u64,
                d.station as u64,
                d.chair.map_or(u64::MAX, u64::from),
                d.setting.map_or(u64::MAX, u64::from),
                d.endpoint.0 as u64,
                d.endpoint.1 as u64,
            ] {
                h.write_u64(v);
            }
            h.write_u64(d.obstructing.len() as u64);
            for id in d.obstructing {
                h.write_u64(id as u64);
            }
        }
        h.write_u64(state.settings.len() as u64);
        for (id, s) in state.settings {
            h.write_u64(id as u64);
            h.write_u64(s as u64);
        }
        h.write_u64(state.opportunities.len() as u64);
        for o in state.opportunities {
            h.write_u64(o.person as u64);
            h.write_u64(o.room as u64);
            h.write_u64(o.pending as u64);
            h.write_u64(o.known.len() as u64);
            for id in o.known {
                h.write_u64(id as u64);
            }
        }
        h.write_u64(state.complaints.len() as u64);
        for (p, ids) in state.complaints {
            h.write_u64(p as u64);
            h.write_u64(ids.len() as u64);
            for id in ids {
                h.write_u64(id as u64);
            }
        }
        h.write_u64(state.tableless.len() as u64);
        for (cook, tick) in state.tableless {
            h.write_u64(cook as u64);
            h.write_u64(tick);
        }
    }
}
