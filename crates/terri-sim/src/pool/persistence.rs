//! Current saves and trusted physical previews share one pool ownership contract.
use super::*;
use crate::{
    player_actions::{PlayerActions, ServedOrder},
    SaveError,
};
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{AtWork, Commuting, Reserved, StepWork};

#[derive(Clone, Copy)]
enum Coordinates {
    HistoricalV22,
    Current,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SavedPoolClock {
    Legacy,
    ForwardHop,
    LongExit,
}

impl SavedPoolClock {
    pub(super) fn exit_ticks(self) -> u32 {
        match self {
            Self::Legacy | Self::ForwardHop => LEGACY_EXIT_TICKS,
            Self::LongExit => EXIT_TICKS,
        }
    }
}

/// Frozen meaning of the header-22 pool coordinates.
pub(super) fn historical_approach(origin: (i32, i32), facing: terri_core::Facing) -> (i32, i32) {
    let offset = match facing {
        terri_core::Facing::SouthEast => (-1, 0),
        terri_core::Facing::SouthWest => (0, 2),
        terri_core::Facing::NorthWest => (2, 1),
        terri_core::Facing::NorthEast => (1, -1),
    };
    (origin.0 + offset.0, origin.1 + offset.1)
}

/// Reading placement previews intentionally omit current player-order metadata.
pub(crate) fn restore_physical(
    world: &mut World,
    rows: Vec<SavedPoolEpisode>,
) -> Result<(), SaveError> {
    attach(world, rows, true)?;
    validate_physical(world, Coordinates::Current, SavedPoolClock::LongExit, true)
}

pub(crate) fn restore_shared(
    world: &mut World,
    rows: Vec<SavedPoolEpisode>,
) -> Result<(), SaveError> {
    restore_physical(world, rows)?;
    validate_orders(world)
}

/// Save layers attach after every nested component and order is restored.
pub(crate) fn restore(
    world: &mut World,
    rows: Vec<SavedPoolEpisode>,
    clock: SavedPoolClock,
) -> Result<(), SaveError> {
    attach(world, rows, false)?;
    validate_physical(world, Coordinates::Current, clock, false)?;
    validate_orders(world)?;
    if clock != SavedPoolClock::LongExit {
        migrate_legacy_clock(world, clock);
    }
    Ok(())
}

pub(crate) fn restore_historical_v22(
    world: &mut World,
    rows: Vec<SavedPoolEpisode>,
) -> Result<(), SaveError> {
    attach(world, rows, false)?;
    validate_physical(
        world,
        Coordinates::HistoricalV22,
        SavedPoolClock::Legacy,
        false,
    )?;
    validate_orders(world)
}

pub(super) fn validate_legacy_clock_at_current_coordinates(world: &World) -> Result<(), SaveError> {
    validate_physical(world, Coordinates::Current, SavedPoolClock::Legacy, false)?;
    validate_orders(world)
}

fn validate_orders(world: &World) -> Result<(), SaveError> {
    let actions = world.resource::<PlayerActions>();
    let Some(mut owners) = world.try_query::<(Entity, &Target, &ServedOrder)>() else {
        return Ok(());
    };
    for (actor, target, owner) in owners.iter(world) {
        let Some(object) = world.get::<SmartObject>(target.object) else {
            continue;
        };
        if !has_pool(world.resource::<Content>().0.object(object.0)) {
            continue;
        }
        let state = actions
            .orders
            .get(&(actor, owner.0))
            .ok_or(SaveError::InvalidValue)?;
        let occupied = world.get::<Eating>(actor).is_some();
        if world
            .get::<PoolEpisode>(actor)
            .is_some_and(|e| e.interrupted)
            || !state.active
            || state.phase != if occupied { 3 } else { 1 }
            || (occupied && !state.started)
            || state.entry.intent.object != target.object
            || state.entry.intent.interaction != target.interaction
            || state.entry.intent.cleanup.is_some()
            || state.entry.intent.chore.is_some()
            || state.entry.title_id.is_some()
            || world
                .get::<IntentQueue>(actor)
                .and_then(|q| q.order(owner.0))
                != Some(&state.entry)
        {
            return Err(SaveError::InvalidValue);
        }
    }
    Ok(())
}

fn attach(
    world: &mut World,
    rows: Vec<SavedPoolEpisode>,
    shared_pools: bool,
) -> Result<(), SaveError> {
    if rows.len() > 100_000 || rows.windows(2).any(|p| p[0].actor >= p[1].actor) {
        return Err(SaveError::InvalidValue);
    }
    for row in rows {
        let actor =
            crate::dining::entity(world, row.actor).ok_or(SaveError::InvalidEntityReference)?;
        let pool =
            crate::dining::entity(world, row.pool).ok_or(SaveError::InvalidEntityReference)?;
        let (phase, place) = if row.phase <= CANCELED_LANDING {
            (row.phase, None)
        } else {
            let slot = (row.phase / 8)
                .checked_sub(1)
                .ok_or(SaveError::InvalidValue)?;
            if !shared_pools {
                return Err(SaveError::InvalidValue);
            }
            let object = world
                .get::<SmartObject>(pool)
                .ok_or(SaveError::InvalidValue)?;
            let definition = world.resource::<Content>().0.object(object.0);
            if capacity(definition) <= 1 || slot >= capacity(definition) {
                return Err(SaveError::InvalidValue);
            }
            (
                row.phase % 8,
                Some(PoolPlace {
                    slot,
                    swim_ticks: swim_ticks(definition),
                }),
            )
        };
        world.entity_mut(actor).insert(PoolEpisode {
            pool,
            phase,
            elapsed: row.elapsed,
            exit_origin: row.exit_origin,
            interrupted: row.interrupted,
            approach: row.approach,
            place,
        });
    }
    Ok(())
}

fn phase_valid(e: &PoolEpisode, clock: SavedPoolClock) -> bool {
    let swim_ticks = e.place.map_or(SWIM_TICKS, |place| place.swim_ticks);
    match e.phase {
        0 => e.elapsed == 0 && !e.interrupted && e.exit_origin == 0,
        1 => e.elapsed < ENTER_TICKS && !e.interrupted && e.exit_origin == 0,
        2 => e.elapsed < swim_ticks && !e.interrupted && e.exit_origin == 0,
        3 => {
            e.elapsed < clock.exit_ticks()
                && if e.place.is_some() {
                    e.exit_origin < STROKE_TICKS
                } else {
                    e.exit_origin <= SWIM_TICKS && (e.interrupted || e.exit_origin == SWIM_TICKS)
                }
        }
        4 => {
            let limit = if clock == SavedPoolClock::Legacy {
                ENTER_TICKS
            } else {
                TAKEOFF_TICK
            };
            e.elapsed < limit && e.interrupted && e.exit_origin == 0
        }
        CANCELED_LANDING => {
            clock != SavedPoolClock::Legacy
                && (TAKEOFF_TICK..ENTER_TICKS).contains(&e.elapsed)
                && e.interrupted
                && e.exit_origin == 0
        }
        WAITING_FOR_LADDER => {
            e.place.is_some()
                && e.elapsed < SETTLE_TICKS + STROKE_TICKS
                && e.exit_origin <= swim_ticks
                && (e.interrupted || e.exit_origin == swim_ticks)
        }
        RETURNING_TO_LADDER => {
            e.place.is_some() && e.elapsed < RETURN_TICKS && e.exit_origin < STROKE_TICKS
        }
        _ => false,
    }
}

fn validate_physical(
    world: &World,
    coordinates: Coordinates,
    clock: SavedPoolClock,
    shared_pools: bool,
) -> Result<(), SaveError> {
    let pack = world.resource::<Content>().0;
    let pools: BTreeSet<_> =
        world
            .try_query::<(Entity, &SmartObject)>()
            .map_or_else(BTreeSet::new, |mut objects| {
                objects
                    .iter(world)
                    .filter(|(_, object)| has_pool(pack.object(object.0)))
                    .map(|(entity, _)| entity)
                    .collect()
            });
    let mut pool_owners = BTreeMap::new();
    if let Some(mut targets) = world.try_query::<(Entity, &Target)>() {
        for (actor, target) in targets
            .iter(world)
            .filter(|(_, target)| pools.contains(&target.object))
        {
            if world.get::<Reserved>(target.object).is_none()
                || world.get::<Agent>(actor).is_none()
                || world.get::<Needs>(actor).is_none()
                || world.get::<StepWork>(actor).is_some()
                || world.get::<AtWork>(actor).is_some()
                || world.get::<Commuting>(actor).is_some()
            {
                return Err(SaveError::InvalidValue);
            }
            let position = world
                .get::<Position>(actor)
                .ok_or(SaveError::InvalidValue)?;
            let object = world.get::<SmartObject>(target.object).unwrap();
            let definition = pack.object(object.0);
            let claims = pool_owners.entry(target.object).or_insert(0);
            *claims += 1;
            if *claims
                > if shared_pools {
                    usize::from(capacity(definition))
                } else {
                    1
                }
            {
                return Err(SaveError::InvalidValue);
            }
            if !definition
                .interactions
                .get(target.interaction as usize)
                .is_some_and(is_swimming)
            {
                return Err(SaveError::InvalidValue);
            }
            let origin = world
                .get::<Position>(target.object)
                .ok_or(SaveError::InvalidValue)?;
            let facing = world
                .get::<ObjectFacing>(target.object)
                .map_or(definition.base_facing, |f| f.0);
            let origin = (origin.x as i32, origin.y as i32);
            let endpoint = match coordinates {
                Coordinates::HistoricalV22 => historical_approach(origin, facing),
                Coordinates::Current => approach(definition, origin, facing),
            };
            let episode = world.get::<PoolEpisode>(actor);
            let eating = world.get::<Eating>(actor);
            let path = world.get::<Path>(actor);
            if let Some(e) = episode {
                if e.pool != target.object || e.approach != endpoint || !phase_valid(e, clock) {
                    return Err(SaveError::InvalidValue);
                }
            }
            if let Some(e) = episode.filter(|e| e.phase > 0) {
                if path.is_some()
                    || (position.x, position.y) != (endpoint.0 as f32, endpoint.1 as f32)
                    || eating.is_none_or(|work| {
                        work.object != object.0
                            || work.interaction != target.interaction
                            || Some(work.remaining_ticks)
                                != if e.place.is_some() {
                                    Some(remaining(e))
                                } else {
                                    countdown(e.phase, e.elapsed, clock.exit_ticks())
                                }
                    })
                {
                    return Err(SaveError::InvalidValue);
                }
            } else {
                // An exhausted waiting route can outlive the previous ladder owner by one tick.
                let path = path.ok_or(SaveError::InvalidValue)?;
                let at_ladder = (position.x, position.y) == (endpoint.0 as f32, endpoint.1 as f32);
                if eating.is_some() || path.steps.last().map_or(!at_ladder, |end| *end != endpoint)
                {
                    return Err(SaveError::InvalidValue);
                }
                // Shared swimmers acquire the ladder on the final step or at its dry contact.
                if episode.is_some_and(|e| e.place.is_some())
                    && !final_approach(path, position, endpoint)
                {
                    return Err(SaveError::InvalidValue);
                }
            }
        }
    }
    for pool in pools {
        if world.get::<Reserved>(pool).is_some() != pool_owners.contains_key(&pool) {
            return Err(SaveError::InvalidValue);
        }
    }
    if let Some(mut episodes) = world.try_query::<(Entity, &PoolEpisode)>() {
        let mut approaches = BTreeSet::new();
        let mut exclusive = BTreeSet::new();
        let mut slots = BTreeMap::<Entity, BTreeSet<u8>>::new();
        for (actor, e) in episodes.iter(world) {
            if world
                .get::<Target>(actor)
                .is_none_or(|target| target.object != e.pool)
                || ((e.place.is_none() || e.uses_ladder()) && !approaches.insert(e.approach))
            {
                return Err(SaveError::InvalidValue);
            }
            let valid_place = match e.place {
                Some(place) => {
                    !exclusive.contains(&e.pool)
                        && slots.entry(e.pool).or_default().insert(place.slot)
                }
                None => !slots.contains_key(&e.pool) && exclusive.insert(e.pool),
            };
            if !valid_place {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    if let Some(mut occupations) = world.try_query::<(Entity, &Eating)>() {
        for (actor, eating) in occupations.iter(world) {
            if pack
                .object(eating.object)
                .interactions
                .get(eating.interaction as usize)
                .is_some_and(is_swimming)
                && world.get::<PoolEpisode>(actor).is_none_or(|e| e.phase == 0)
            {
                return Err(SaveError::InvalidValue);
            }
        }
    }
    Ok(())
}
