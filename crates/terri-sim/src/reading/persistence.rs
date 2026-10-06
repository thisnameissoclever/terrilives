use super::*;
use crate::SaveError;
use terri_core::save_v6::{SavedPendingShift, SavedReadingJourney};

pub(crate) fn capture(world: &World) -> Vec<SavedReadingJourney> {
    let mut rows = world
        .try_query::<(Entity, &ReadingJourney)>()
        .map_or_else(Vec::new, |mut q| {
            q.iter(world)
                .map(|(owner, j)| SavedReadingJourney {
                    owner: owner.index_u32(),
                    origin: j.origin.object.index_u32(),
                    action: action(world, j.origin).map_or_else(String::new, |a| a.id.clone()),
                    order: j.order,
                    copy: j.copy,
                    shelf: j.shelf.index_u32(),
                    transfer_contact: j.transfer_contact,
                    reach_remaining: j.reach_remaining,
                    seat: j.seat.as_ref().map(|(e, s)| (e.index_u32(), s.clone())),
                    stage: j.stage,
                    elapsed: j.elapsed,
                    work: j.work,
                    earned_satisfaction: j.earned_satisfaction,
                    destination: j.destination,
                    outcome: j.outcome,
                    reward_contexts: j.reward_contexts.clone(),
                })
                .collect()
        });
    rows.sort_by_key(|r| r.owner);
    rows
}
pub(crate) fn capture_shifts(world: &World) -> Vec<SavedPendingShift> {
    let mut rows = world
        .try_query::<(Entity, &PendingShift)>()
        .map_or_else(Vec::new, |mut q| {
            q.iter(world)
                .map(|(owner, p)| SavedPendingShift {
                    owner: owner.index_u32(),
                    scheduled_tick: p.scheduled_tick,
                    career: world.resource::<Content>().0.careers[p.career as usize]
                        .id
                        .clone(),
                })
                .collect()
        });
    rows.sort_by_key(|r| r.owner);
    rows
}
pub(crate) fn restore(
    world: &mut World,
    rows: &[SavedReadingJourney],
    shifts: &[SavedPendingShift],
) -> Result<(), SaveError> {
    if rows.windows(2).any(|p| p[0].owner >= p[1].owner)
        || shifts.windows(2).any(|p| p[0].owner >= p[1].owner)
    {
        return Err(SaveError::InvalidValue);
    }
    let pack = world.resource::<Content>().0;
    for row in rows {
        let owner = crate::dining::entity(world, row.owner).ok_or(SaveError::InvalidValue)?;
        let object = crate::dining::entity(world, row.origin).ok_or(SaveError::InvalidValue)?;
        let definition = world
            .get::<SmartObject>(object)
            .ok_or(SaveError::InvalidValue)?
            .0;
        let interaction = pack
            .object(definition)
            .interactions
            .iter()
            .position(|a| a.id == row.action && a.book_reading)
            .ok_or(SaveError::InvalidValue)? as u32;
        let seat = row
            .seat
            .as_ref()
            .map(|(e, s)| {
                crate::dining::entity(world, *e)
                    .map(|e| (e, s.clone()))
                    .ok_or(SaveError::InvalidValue)
            })
            .transpose()?;
        let shelf = crate::dining::entity(world, row.shelf).ok_or(SaveError::InvalidValue)?;
        world.entity_mut(owner).insert(ReadingJourney {
            origin: Target {
                object,
                interaction,
            },
            order: row.order,
            copy: row.copy,
            shelf,
            transfer_contact: row.transfer_contact,
            reach_remaining: row.reach_remaining,
            seat,
            stage: row.stage,
            elapsed: row.elapsed,
            work: row.work,
            earned_satisfaction: row.earned_satisfaction,
            destination: row.destination,
            outcome: row.outcome,
            reward_contexts: row.reward_contexts.clone(),
        });
    }
    for row in shifts {
        let owner = crate::dining::entity(world, row.owner).ok_or(SaveError::InvalidValue)?;
        let career = pack
            .careers
            .iter()
            .position(|c| c.id == row.career)
            .ok_or(SaveError::InvalidValue)? as u32;
        world.entity_mut(owner).insert(PendingShift {
            scheduled_tick: row.scheduled_tick,
            career,
        });
    }
    Ok(())
}
pub(crate) fn validate(world: &World, grid: &TileGrid) -> Result<(), SaveError> {
    let bad = || SaveError::InvalidValue;
    let pack = world.resource::<Content>().0;
    let rows = world
        .try_query::<(Entity, &ReadingJourney)>()
        .map_or_else(Vec::new, |mut q| q.iter(world).collect());
    let mut owned = std::collections::BTreeSet::new();
    for (person, j) in &rows {
        let id = *world.get::<SimId>(*person).ok_or_else(bad)?;
        let tuning = pack.reading.as_ref().ok_or_else(bad)?;
        let copy = world
            .resource::<BookLibrary>()
            .copy(j.copy)
            .ok_or_else(bad)?;
        if world.get::<Agent>(*person).is_none()
            || world.get::<AtWork>(*person).is_some()
            || world.get::<Commuting>(*person).is_some()
            || world.get::<Carrying>(*person).is_some()
            || world.get::<Eating>(*person).is_some()
            || world.get::<StepWork>(*person).is_some()
            || world.get::<Socialising>(*person).is_some()
            || copy.borrower != Some(id)
            || !owned.insert(j.copy)
            || !is_read(world, j.origin)
            || !j.earned_satisfaction.is_finite()
            || j.earned_satisfaction < 0.0
            || !j.work.is_finite()
            || j.work < 0.0
            || j.elapsed > tuning.session_ticks
            || (j.elapsed == 0) != (j.work == 0.0)
        {
            return Err(bad());
        }
        if matches!(j.outcome, Some(ReadingOutcome::Fumbled(scale)) if !scale.is_finite() || !(0.0..=1.0).contains(&scale))
            || (matches!(
                j.stage,
                ReadingStage::Fetch | ReadingStage::Pickup | ReadingStage::Travel
            ) && j.outcome.is_some())
            || (j.stage == ReadingStage::Read && j.outcome.is_none())
            || (j.elapsed > 0 && j.outcome.is_none())
            || (j.stage != ReadingStage::Read && !j.reward_contexts.is_empty())
        {
            return Err(bad());
        }
        if world
            .get::<terri_core::chores::ChoreWork>(*person)
            .is_some()
            || world
                .get_resource::<terri_core::chores::SavedChores>()
                .is_some_and(|state| {
                    state
                        .tasks
                        .iter()
                        .any(|task| task.person == person.index_u32() && !task.suspended)
                })
        {
            return Err(bad());
        }
        let origin = pack.object(world.get::<SmartObject>(j.origin.object).ok_or_else(bad)?.0);
        if origin.seats.is_empty() {
            if j.origin.object != j.shelf {
                return Err(bad());
            }
        } else if j
            .seat
            .as_ref()
            .is_none_or(|(seat, _)| *seat != j.origin.object)
        {
            return Err(bad());
        }
        if let Some((seat, name)) = &j.seat {
            let def = pack.object(world.get::<SmartObject>(*seat).ok_or_else(bad)?.0);
            if !def.seats.iter().any(|s| s.id == *name) {
                return Err(bad());
            }
        }
        if matches!(
            j.stage,
            ReadingStage::Fetch | ReadingStage::Pickup | ReadingStage::Travel
        ) && (j.elapsed != 0 || j.work != 0.0 || j.earned_satisfaction != 0.0)
        {
            return Err(bad());
        }
        if j.elapsed == 0 && j.earned_satisfaction != 0.0 {
            return Err(bad());
        }
        let length = pack
            .books
            .iter()
            .find(|b| b.id == copy.title_id)
            .ok_or_else(bad)?
            .reading_minutes as f32;
        if j.work > length + 0.001 {
            return Err(bad());
        }
        if j.stage == ReadingStage::Read {
            if accrual::reward_upper(world, *person, j)
                .is_none_or(|maximum| f64::from(j.earned_satisfaction) > maximum)
            {
                return Err(bad());
            }
            if j.elapsed >= tuning.session_ticks {
                return Err(bad());
            }
            if j.work > 0.0
                && world
                    .resource::<BookLibrary>()
                    .memory(id, &copy.title_id)
                    .is_none_or(|m| {
                        m.pass_novelty.is_none()
                            || m.progress_ticks as f32 + m.progress_fraction + 0.001 < j.work
                    })
            {
                return Err(bad());
            }
        }
        for endpoint in endpoints(*person, j) {
            if !crate::seating::endpoint_available(world, endpoint) {
                return Err(bad());
            }
        }
        if j.seat.is_none()
            && matches!(
                j.stage,
                ReadingStage::Fetch
                    | ReadingStage::Pickup
                    | ReadingStage::Travel
                    | ReadingStage::Read
            )
            && shelf_contact_tile(world, j.destination)
        {
            return Err(bad());
        }
        let returning = matches!(
            j.stage,
            ReadingStage::Return | ReadingStage::WaitingReturn | ReadingStage::Shelve
        );
        if let Some(order) = j.order {
            let q = world.get::<IntentQueue>(*person).ok_or_else(bad)?;
            if order >= q.next_id() {
                return Err(bad());
            }
            if !returning {
                let entry = q.order(order).ok_or_else(bad)?;
                if entry.intent.object != j.origin.object
                    || entry.intent.interaction != j.origin.interaction
                    || entry.title_id.as_ref().is_some_and(|s| *s != copy.title_id)
                {
                    return Err(bad());
                }
            }
        }
        if matches!(j.stage, ReadingStage::Fetch | ReadingStage::Pickup) {
            if copy.location != BookLocation::Shelf(copy.home.ok_or_else(bad)?) || j.elapsed != 0 {
                return Err(bad());
            }
        } else if copy.location != BookLocation::Carried(id) {
            return Err(bad());
        }
        let claim = world.get::<crate::seating::PhysicalClaim>(*person);
        if returning {
            if j.earned_satisfaction != 0.0 {
                return Err(bad());
            }
            if claim.is_some() {
                return Err(bad());
            }
        } else if let Some((seat, name)) = &j.seat {
            let claim = claim.ok_or_else(bad)?;
            if claim.furniture != *seat || claim.seat != *name || claim.all {
                return Err(bad());
            }
            let def = pack.object(world.get::<SmartObject>(*seat).ok_or_else(bad)?.0);
            let n = def
                .seats
                .iter()
                .position(|s| s.id == *name)
                .ok_or_else(bad)?;
            let at = world.get::<Position>(*seat).ok_or_else(bad)?;
            let facing = world
                .get::<ObjectFacing>(*seat)
                .map_or(def.base_facing, |f| f.0);
            if !crate::seating::legal_contact(
                grid,
                def,
                facing,
                (at.x.round() as i32, at.y.round() as i32),
                Some(n as u16),
                j.destination,
            ) {
                return Err(bad());
            }
        } else if claim.is_some() {
            return Err(bad());
        }
        let position = *world.get::<Position>(*person).ok_or_else(bad)?;
        let tile = (position.x.round() as i32, position.y.round() as i32);
        let path = world.get::<Path>(*person);
        if let Some(path) = path {
            if path.cursor > path.steps.len() {
                return Err(bad());
            }
            let mut previous = (position.x, position.y);
            for &(x, y) in &path.steps[path.cursor..] {
                if !grid.is_walkable(x, y)
                    || !grid.segment_can_cross(previous, (x as f32, y as f32))
                {
                    return Err(bad());
                }
                previous = (x as f32, y as f32);
            }
        }
        let end = path.and_then(|p| p.steps.last().copied()).unwrap_or(tile);
        let home = j.shelf;
        if world.get::<SmartObject>(home).is_none()
            || copy
                .home
                .is_none_or(|h| h.shelf.0 != u64::from(home.index_u32()))
        {
            return Err(bad());
        }
        let transferring = matches!(
            j.stage,
            ReadingStage::Fetch
                | ReadingStage::Pickup
                | ReadingStage::Return
                | ReadingStage::Shelve
        );
        if transferring {
            let contact = j.transfer_contact.ok_or_else(bad)?;
            if !legal_shelf_contact(world, grid, home, contact) || end != contact {
                return Err(bad());
            }
            let reach = match j.stage {
                ReadingStage::Pickup => Some(tuning.pickup_ticks),
                ReadingStage::Shelve => Some(tuning.shelve_ticks),
                _ => None,
            };
            if let Some(total) = reach {
                if path.is_some() || j.reach_remaining == 0 || j.reach_remaining > total {
                    return Err(bad());
                }
            } else if path.is_none() || j.reach_remaining != 0 {
                return Err(bad());
            }
            let candidate = crate::seating::EndpointUse {
                owner: *person,
                endpoint: contact,
                kind: crate::seating::UseKind::ShelfTransfer,
            };
            if !crate::seating::endpoint_available(world, candidate) {
                return Err(bad());
            }
        } else {
            if j.transfer_contact.is_some() || j.reach_remaining != 0 {
                return Err(bad());
            }
            if j.stage == ReadingStage::WaitingReturn {
                if path.is_some()
                    || world.get::<Target>(*person).is_some()
                    || world.get::<Blocked>(*person).is_none()
                {
                    return Err(bad());
                }
            } else if end != j.destination
                || (j.stage == ReadingStage::Read && path.is_some())
                || (j.stage == ReadingStage::Travel && path.is_none())
            {
                return Err(bad());
            }
        }
        if !returning
            && world
                .get::<Target>(*person)
                .is_none_or(|t| !is_read(world, *t))
        {
            return Err(bad());
        }
    }
    if let Some(library) = world.get_resource::<BookLibrary>() {
        for copy in &library.state().copies {
            if copy.borrower.is_some() && !owned.contains(&copy.id) {
                return Err(bad());
            }
        }
    }
    if let Some(mut q) = world.try_query::<(Entity, &Target)>() {
        for (e, t) in q.iter(world) {
            if is_read(world, *t) && world.get::<ReadingJourney>(e).is_none() {
                return Err(bad());
            }
        }
    }
    if let Some(mut q) = world.try_query::<(Entity, &PendingShift)>() {
        for (e, p) in q.iter(world) {
            let career = pack.careers.get(p.career as usize).ok_or_else(bad)?;
            if world.get::<Career>(e).is_none_or(|c| c.0 != p.career)
                || p.scheduled_tick > world.resource::<SimClock>().tick
                || p.scheduled_tick % u64::from(pack.tuning.day_ticks)
                    != u64::from(career.shift_start)
                || !crate::systems::career::works_today(
                    career,
                    &SimClock {
                        tick: p.scheduled_tick,
                    },
                    &pack.tuning,
                )
                || world.get::<AtWork>(e).is_some()
                || world.get::<Commuting>(e).is_some()
            {
                return Err(bad());
            }
        }
    }
    Ok(())
}
pub(crate) fn hash(world: &World, h: &mut FnvHasher) {
    let rows = capture(world);
    let shifts = capture_shifts(world);
    if rows.is_empty() && shifts.is_empty() {
        return;
    }
    h.write_bytes(b"reading-journeys-v1");
    let text = |h: &mut FnvHasher, s: &str| {
        h.write_u64(s.len() as u64);
        h.write_bytes(s.as_bytes());
    };
    h.write_u64(rows.len() as u64);
    for r in rows {
        h.write_u64(r.owner.into());
        h.write_u64(r.origin.into());
        text(h, &r.action);
        h.write_u64(r.order.is_some().into());
        if let Some(id) = r.order {
            h.write_u64(id);
        }
        h.write_u64(r.copy.0.into());
        h.write_u64(r.shelf.into());
        h.write_u64(r.reach_remaining.into());
        h.write_u64(r.transfer_contact.is_some().into());
        if let Some((x, y)) = r.transfer_contact {
            h.write_u64(x as u64);
            h.write_u64(y as u64);
        }
        h.write_u64(r.stage as u64);
        h.write_u64(r.elapsed.into());
        h.write_f32(r.work);
        h.write_f32(r.earned_satisfaction);
        match r.outcome {
            None => h.write_u64(0),
            Some(ReadingOutcome::Success) => h.write_u64(1),
            Some(ReadingOutcome::Fumbled(scale)) => {
                h.write_u64(2);
                h.write_u64(scale.to_bits().into());
            }
        }
        h.write_u64(r.reward_contexts.len() as u64);
        for context in r.reward_contexts {
            h.write_u64(context.start_tick.into());
            h.write_u64(context.end_tick.into());
            h.write_u64(context.start_work.to_bits().into());
            h.write_u64(context.end_work.to_bits().into());
            h.write_u64(context.disposition.to_bits().into());
            h.write_u64(context.traits.len() as u64);
            for name in context.traits {
                text(h, &name);
            }
        }
        h.write_u64(r.destination.0 as u64);
        h.write_u64(r.destination.1 as u64);
        h.write_u64(r.seat.is_some().into());
        if let Some((e, s)) = r.seat {
            h.write_u64(e.into());
            text(h, &s);
        }
    }
    h.write_u64(shifts.len() as u64);
    for p in shifts {
        h.write_u64(p.owner.into());
        h.write_u64(p.scheduled_tick);
        text(h, &p.career);
    }
}
