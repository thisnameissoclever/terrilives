use super::*;

pub(crate) fn dish_washed(world: &mut World, person: u32, units: u32) {
    if units == 0 {
        return;
    }
    ensure(world);
    let mut state = world.remove_resource::<SavedChores>().unwrap();
    let now = world.resource::<terri_core::SimClock>().tick;
    let day = state.dish_started.iter().find(|r| r.0 == person).map_or(
        now / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks),
        |r| r.1,
    );
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    let actor = crate::dining::entity(world, person)
        .and_then(|e| world.get::<terri_core::SimId>(e))
        .map(|id| id.0);
    if let (Some(actor), Some(episode)) = (
        actor,
        state
            .episodes
            .iter()
            .rev()
            .find(|e| e.key == key && e.day == day)
            .map(|e| e.id),
    ) {
        if let Some(entry) = state
            .dish_contributions
            .iter_mut()
            .find(|r| r.0 == episode && r.1 == actor)
        {
            entry.2 = entry.2.saturating_add(units);
        } else {
            state.dish_contributions.push((episode, actor, units));
            state.dish_contributions.sort_unstable();
        }
        if dirt_in(world, &state, key) == 0 {
            let leader = state
                .dish_contributions
                .iter()
                .filter(|r| r.0 == episode)
                .max_by_key(|r| (r.2, std::cmp::Reverse(r.1)))
                .map(|r| r.1);
            if let Some(leader) = leader {
                let entity = world
                    .try_query::<(Entity, &terri_core::SimId)>()
                    .and_then(|mut q| q.iter(world).find(|(_, id)| id.0 == leader).map(|(e, _)| e));
                if let Some(entity) = entity {
                    board::credit(world, &mut state, entity.index_u32(), key, day, units);
                }
            }
        }
    }
    if let Some(actor) = actor {
        let preference = state
            .profiles
            .iter()
            .find(|p| p.sim_id == actor)
            .map_or(0, |p| i16::from(p.preferences[0]));
        state.feelings.retain(|f| f.person != actor);
        state.feelings.push(ChoreFeeling {
            person: actor,
            kind: ChoreKind::Dishes,
            score: preference,
            expires: now.saturating_add(60),
        });
        state.feelings.sort_by_key(|f| f.person);
    }
    state.dish_started.retain(|r| r.0 != person);
    world.insert_resource(state);
}

pub fn moodlets(world: &World, person: Entity) -> Vec<crate::mood::Moodlet> {
    let Some(state) = world.get_resource::<SavedChores>() else {
        return vec![];
    };
    moodlets_in(world, person, state)
}

pub(crate) fn moodlets_in(
    world: &World,
    person: Entity,
    state: &SavedChores,
) -> Vec<crate::mood::Moodlet> {
    let Some(id) = world.get::<terri_core::SimId>(person) else {
        return vec![];
    };
    let now = world.resource::<terri_core::SimClock>().tick;
    let mut moodlets = vec![];
    let kind = state
        .tasks
        .iter()
        .find(|t| t.person == person.index_u32() && !t.suspended)
        .map(|t| t.key.kind)
        .or_else(|| {
            world
                .get::<terri_core::ChainState>(person)
                .filter(|c| {
                    world.resource::<crate::Content>().0.chains[c.chain as usize].id
                        == crate::domestic::CLEANUP
                })
                .map(|_| ChoreKind::Dishes)
        });
    if let Some(kind) = kind {
        let preference = state
            .profiles
            .iter()
            .find(|p| p.sim_id == id.0)
            .map_or(0, |p| p.preferences[kind.index()]);
        if preference != 0 {
            moodlets.push(crate::mood::Moodlet {
                label: if preference > 0 {
                    "Enjoying a chore"
                } else {
                    "Dislikes this chore"
                }
                .into(),
                score: f32::from(preference) / 100.0,
            });
        }
    }
    for feeling in state
        .feelings
        .iter()
        .filter(|f| f.person == id.0 && f.expires > now && f.score != 0)
    {
        moodlets.push(crate::mood::Moodlet {
            label: if feeling.score > 0 {
                "Enjoyed a chore"
            } else {
                "Chore frustration"
            }
            .into(),
            score: f32::from(feeling.score) / 100.0,
        });
    }
    if let Some(pos) = world.get::<terri_core::Position>(person) {
        if let Some(room) = crate::room_regions::RoomRegions::from_world(world)
            .at((pos.x.round() as i32, pos.y.round() as i32))
        {
            let key = ChoreKey {
                kind: ChoreKind::Floors,
                target: room,
            };
            let grid = world.resource::<terri_core::TileGrid>();
            let rooms = crate::room_regions::RoomRegions::from_world(world);
            let mut sum = 0u64;
            let mut count = 0u64;
            for y in 0..grid.height() {
                for x in 0..grid.width() {
                    if grid.is_walkable(x as i32, y as i32)
                        && rooms.at((x as i32, y as i32)) == Some(key.target)
                    {
                        count += 1;
                        sum += u64::from(value(&state.floors, (y * grid.width() + x) as u32));
                    }
                }
            }
            let floor = sum as f32 / (count.max(1) as f32 * 1000.0);
            let mut surfaces = groups::members(
                world,
                ChoreKey {
                    kind: ChoreKind::CounterSurfaces,
                    target: key.target,
                },
            );
            surfaces.extend(groups::members(
                world,
                ChoreKey {
                    kind: ChoreKind::TableSurfaces,
                    target: key.target,
                },
            ));
            let surface = surfaces
                .iter()
                .map(|id| u32::from(value(&state.surfaces, *id)))
                .sum::<u32>() as f32
                / (surfaces.len().max(1) as f32 * 1000.0);
            for (label, intensity) in [("Grimy floor", floor), ("Grimy surfaces", surface)] {
                if intensity > 0.0 {
                    moodlets.push(crate::mood::Moodlet {
                        label: label.into(),
                        score: -(0.3 + crate::domestic::cleanliness(world, person))
                            * intensity.clamp(0.0, 1.0),
                    });
                }
            }
        }
    }
    moodlets
}
