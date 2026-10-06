use super::*;

pub(crate) fn restore(
    world: &mut World,
    state: Option<SavedChores>,
) -> Result<(), crate::SaveError> {
    let Some(state) = state else {
        return Ok(());
    };
    let (width, height) = {
        let grid = world.resource::<terri_core::TileGrid>();
        (grid.width(), grid.height())
    };
    let rooms = crate::room_regions::RoomRegions::from_world(world);
    let issued = world.resource::<terri_core::SimIdAllocator>().issued();
    let now = world.resource::<terri_core::SimClock>().tick;
    let day = now / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks);
    if state.roster.len() > 100_000
        || state.roster.windows(2).any(|p| p[0] >= p[1])
        || state.roster.iter().any(|id| *id >= issued)
        || state.week.is_some_and(|w| w > day / 7)
        || state.assignments.len() > 100_000
        || state.assignments.windows(2).any(|p| p[0].key >= p[1].key)
        || state
            .assignments
            .iter()
            .any(|a| a.owner >= issued || !key_valid(world, a.key) || state.week != Some(a.week))
        || state.episodes.len() > 100_000
        || state.episodes.windows(2).any(|p| p[0].id >= p[1].id)
        || state.episodes.iter().any(|e| {
            e.id >= state.next_episode
                || e.owner >= issued
                || e.day > day
                || e.performer.is_some_and(|p| p >= issued)
                || e.completed_at.is_some_and(|t| t > now)
                || e.completed_at.is_some() != e.performer.is_some()
                || (e.outcome == DutyOutcome::WillDo && e.decision != Some(true))
                || (e.outcome == DutyOutcome::Skipped && e.decision != Some(false))
                || (matches!(e.outcome, DutyOutcome::Done | DutyOutcome::Covered)
                    && e.completed_at.is_none())
        })
        || state.feelings.len() > 100_000
        || state
            .feelings
            .windows(2)
            .any(|p| p[0].person >= p[1].person)
        || state
            .feelings
            .iter()
            .any(|f| f.person >= issued || !(-100..=100).contains(&f.score))
        || state.dish_started.len() > 100_000
        || state.dish_started.windows(2).any(|p| p[0].0 >= p[1].0)
        || state.dish_started.iter().any(|(person, start)| {
            crate::dining::entity(world, *person)
                .and_then(|e| world.get::<terri_core::Agent>(e))
                .is_none()
                || *start > day
        })
        || state.dish_contributions.len() > 100_000
        || state
            .dish_contributions
            .windows(2)
            .any(|p| (p[0].0, p[0].1) >= (p[1].0, p[1].1))
        || state
            .dish_contributions
            .iter()
            .any(|r| r.1 >= issued || r.2 == 0 || !state.episodes.iter().any(|e| e.id == r.0))
        || state.surfaces.iter().any(|r| {
            !key_valid(
                world,
                ChoreKey {
                    kind: ChoreKind::Surfaces,
                    target: r.0,
                },
            )
        })
        || state.bins.iter().any(|r| {
            !key_valid(
                world,
                ChoreKey {
                    kind: ChoreKind::Bins,
                    target: r.0,
                },
            )
        })
    {
        return Err(crate::SaveError::InvalidValue);
    }
    let valid = |rows: &[(u32, u16)]| {
        rows.len() <= 100_000
            && rows.windows(2).all(|p| p[0].0 < p[1].0)
            && rows.iter().all(|(_, v)| *v > 0 && *v <= 1000)
    };
    if !valid(&state.floors)
        || !valid(&state.surfaces)
        || !valid(&state.bins)
        || state.floors.iter().any(|(cell, _)| {
            *cell as usize >= width * height
                || rooms
                    .at((
                        (*cell as usize % width) as i32,
                        (*cell as usize / width) as i32,
                    ))
                    .is_none()
        })
        || state.profiles.len() > 100_000
        || state
            .profiles
            .windows(2)
            .any(|p| p[0].sim_id >= p[1].sim_id)
        || state.profiles.iter().any(|p| {
            p.sim_id >= issued
                || p.responsibility > 100
                || p.commitment > 100
                || p.preferences.iter().any(|v| !(-100..=100).contains(v))
        })
        || state.last_age_tick > world.resource::<terri_core::SimClock>().tick
        || state.traffic.windows(2).any(|p| p[0].0 >= p[1].0)
        || state
            .traffic
            .iter()
            .any(|(id, cell)| *id >= issued || *cell as usize >= width * height)
    {
        return Err(crate::SaveError::InvalidValue);
    }
    let mut queued = state.orders.clone();
    queued.sort_by_key(|o| (o.person, o.queue_position));
    if state.orders.len() > 100_000
        || state.orders.windows(2).any(|p| p[0].id >= p[1].id)
        || queued
            .windows(2)
            .any(|p| (p[0].person, p[0].queue_position) == (p[1].person, p[1].queue_position))
    {
        return Err(crate::SaveError::InvalidValue);
    }
    for order in queued {
        let person = crate::dining::entity(world, order.person)
            .filter(|e| world.get::<terri_core::Agent>(*e).is_some())
            .ok_or(crate::SaveError::InvalidValue)?;
        if order.id >= state.next_order || !key_valid(world, order.key) {
            return Err(crate::SaveError::InvalidValue);
        }
        let mut queue = world
            .get::<terri_core::IntentQueue>(person)
            .map_or(vec![], |q| q.as_slice().to_vec());
        if order.queue_position as usize > queue.len() {
            return Err(crate::SaveError::InvalidValue);
        }
        queue.insert(
            order.queue_position as usize,
            terri_core::Intent {
                object: person,
                interaction: 0,
                cleanup: None,
                chore: Some(order.id),
            },
        );
        world
            .entity_mut(person)
            .insert(terri_core::IntentQueue::from_intents(queue));
    }
    if state.tasks.len() > 100_000 || state.tasks.windows(2).any(|p| p[0].person >= p[1].person) {
        return Err(crate::SaveError::InvalidValue);
    }
    let mut claims = std::collections::BTreeSet::new();
    let mut object_claims = std::collections::BTreeSet::new();
    for task in &state.tasks {
        let person = crate::dining::entity(world, task.person)
            .filter(|e| world.get::<terri_core::Agent>(*e).is_some())
            .ok_or(crate::SaveError::InvalidValue)?;
        if task.key.kind == ChoreKind::Dishes
            || !key_valid(world, task.key)
            || !claims.insert(task.key)
            || task.cells.is_empty()
            || task.cells.len() > 100_000
            || task.cursor as usize >= task.cells.len()
            || task.remaining > 60
            || task.endpoint.is_some_and(|e| e as usize >= width * height)
        {
            return Err(crate::SaveError::InvalidValue);
        }
        if task.started_day > day
            || (!task.key.kind.grouped() && task.cells.windows(2).any(|p| p[0] >= p[1]))
            || (task.key.kind.grouped()
                && (task
                    .cells
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
                    != task.cells.len()
                    || task
                        .cells
                        .iter()
                        .skip(task.cursor as usize)
                        .any(|id| !groups::members(world, task.key).contains(id))
                    || task.endpoint.is_some_and(|cell| {
                        !work::contact_valid(world, groups::current_key(task), cell)
                    })
                    || (task.endpoint.is_none() && task.remaining != 0)))
            || (!task.key.kind.grouped()
                && task.key.kind != ChoreKind::Floors
                && (task.cells.len() != 1
                    || task.cells[0] != task.key.target
                    || task
                        .endpoint
                        .is_none_or(|cell| !work::contact_valid(world, task.key, cell))))
            || (task.key.kind == ChoreKind::Floors
                && task.cells.iter().any(|cell| {
                    *cell as usize >= width * height
                        || rooms.at((
                            (*cell as usize % width) as i32,
                            (*cell as usize / width) as i32,
                        )) != Some(task.key.target)
                }))
        {
            return Err(crate::SaveError::InvalidValue);
        }
        if !task.suspended {
            let claimed = if task.key.kind.grouped() {
                task.endpoint
                    .map(|_| groups::current_key(task).target)
                    .into_iter()
                    .collect::<Vec<_>>()
            } else if task.key.kind == ChoreKind::Floors {
                vec![]
            } else {
                vec![task.key.target]
            };
            if claimed.into_iter().any(|id| !object_claims.insert(id)) {
                return Err(crate::SaveError::InvalidValue);
            }
            world.entity_mut(person).insert(ChoreWork);
        }
    }
    world.insert_resource(state);
    Ok(())
}
