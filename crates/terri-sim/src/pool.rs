//! A pool keeps its physical owner until the body has returned down its ladder.
use crate::Content;
use bevy_ecs::prelude::*;
use terri_core::save_editable_v22::SavedPoolEpisode;
use terri_core::{
    Agent, Eating, IntentQueue, NeedId, Needs, ObjectFacing, Path, Personality, Position,
    SmartObject, Target,
};

pub(crate) const ENTER_TICKS: u32 = 20;
pub(crate) const TAKEOFF_TICK: u32 = 12;
pub(crate) const SWIM_TICKS: u32 = 60;
pub(crate) const LEGACY_EXIT_TICKS: u32 = 20;
pub(crate) const EXIT_TICKS: u32 = 40;
pub(crate) const TOTAL_TICKS: u32 = ENTER_TICKS + SWIM_TICKS + EXIT_TICKS;
pub(crate) const CANCELED_LANDING: u8 = 5;

#[derive(Component, Clone, Debug, PartialEq, Eq)]
pub(crate) struct PoolEpisode {
    pub pool: Entity,
    pub phase: u8,
    pub elapsed: u32,
    pub exit_origin: u32,
    pub interrupted: bool,
    pub approach: (i32, i32),
}

impl PoolEpisode {
    pub(crate) fn render_phase(&self) -> u8 {
        if self.phase == CANCELED_LANDING {
            1
        } else {
            self.phase
        }
    }
}

pub(crate) fn is_swimming(action: &terri_data::CompiledInteraction) -> bool {
    action.tags.iter().any(|tag| tag == "pool_swimming")
}
pub(crate) fn has_pool(object: &terri_data::CompiledObject) -> bool {
    object.interactions.iter().any(is_swimming)
}

pub(crate) fn contacts_required(world: &World) -> bool {
    let pack = world.resource::<Content>().0;
    world
        .try_query::<&SmartObject>()
        .is_some_and(|mut objects| {
            objects
                .iter(world)
                .any(|object| has_pool(pack.object(object.0)))
        })
        || has_swimming_state(world)
}

pub(crate) fn has_swimming_state(world: &World) -> bool {
    if world
        .try_query::<&PoolEpisode>()
        .is_some_and(|mut query| query.iter(world).next().is_some())
    {
        return true;
    }
    world.try_query::<&Target>().is_some_and(|mut query| {
        query.iter(world).any(|target| {
            world
                .get::<SmartObject>(target.object)
                .is_some_and(|object| {
                    world
                        .resource::<Content>()
                        .0
                        .object(object.0)
                        .interactions
                        .get(target.interaction as usize)
                        .is_some_and(is_swimming)
                })
        })
    })
}

/// Both pool models place the ladder beside the second row of their base footprint.
pub(crate) fn approach(
    object: &terri_data::CompiledObject,
    origin: (i32, i32),
    facing: terri_core::Facing,
) -> (i32, i32) {
    let (x, y) = object.footprint_offset_at((-1, 1), facing);
    (origin.0 + x, origin.1 + y)
}

pub(crate) fn request_exit(world: &mut World, actor: Entity) -> bool {
    if world
        .get::<PoolEpisode>(actor)
        .is_some_and(|e| e.phase == 0)
    {
        world.entity_mut(actor).remove::<PoolEpisode>();
        return false;
    }
    let Some(mut episode) = world.get_mut::<PoolEpisode>(actor) else {
        return false;
    };
    episode.interrupted = true;
    match episode.phase {
        1 => {
            episode.phase = if episode.elapsed < TAKEOFF_TICK {
                4
            } else {
                CANCELED_LANDING
            };
        }
        2 => {
            episode.exit_origin = episode.elapsed;
            episode.elapsed = 0;
            episode.phase = 3;
        }
        _ => {}
    }
    let ticks = remaining(&episode);
    if let Some(mut eating) = world.get_mut::<Eating>(actor) {
        eating.remaining_ticks = ticks;
    }
    true
}

/// Selection reserves the fixture first. Claim the ladder before movement.
pub(crate) fn prepare(world: &mut World) {
    cleanup(world);
    let mut actors: Vec<_> = world
        .query_filtered::<Entity, With<Agent>>()
        .iter(world)
        .collect();
    actors.sort_by_key(|e| e.index_u32());
    for actor in &actors {
        if let Some(episode) = world.get::<PoolEpisode>(*actor) {
            if episode.phase == 0
                && world
                    .get::<Target>(*actor)
                    .is_none_or(|t| t.object != episode.pool)
            {
                world.entity_mut(*actor).remove::<PoolEpisode>();
            }
        }
    }
    for actor in actors {
        if world.get::<PoolEpisode>(actor).is_some() {
            continue;
        }
        let Some(target) = world.get::<Target>(actor).copied() else {
            continue;
        };
        let Some(object) = world.get::<SmartObject>(target.object) else {
            continue;
        };
        let definition = world.resource::<Content>().0.object(object.0);
        if !definition
            .interactions
            .get(target.interaction as usize)
            .is_some_and(is_swimming)
        {
            continue;
        }
        let Some(position) = world.get::<Position>(target.object) else {
            continue;
        };
        let facing = world
            .get::<ObjectFacing>(target.object)
            .map_or(definition.base_facing, |f| f.0);
        let endpoint = approach(definition, (position.x as i32, position.y as i32), facing);
        if world
            .query::<&PoolEpisode>()
            .iter(world)
            .any(|e| e.approach == endpoint)
        {
            continue;
        }
        world.entity_mut(actor).insert(PoolEpisode {
            pool: target.object,
            phase: 0,
            elapsed: 0,
            exit_origin: 0,
            interrupted: false,
            approach: endpoint,
        });
    }
}

pub(crate) fn tick(world: &mut World) {
    cleanup(world);
    let mut actors: Vec<_> = world
        .query_filtered::<Entity, With<PoolEpisode>>()
        .iter(world)
        .collect();
    actors.sort_by_key(|e| e.index_u32());
    for actor in actors {
        let mut episode = world.get::<PoolEpisode>(actor).unwrap().clone();
        if episode.phase == 0 {
            if world.get::<Eating>(actor).is_none() {
                continue;
            }
            episode.phase = 1;
            episode.elapsed = 0;
            world.entity_mut(actor).insert(episode);
            continue;
        }
        if episode.phase == 2 {
            let eating = *world
                .get::<Eating>(actor)
                .expect("pool episode retains ordinary occupation");
            let pack = world.resource::<Content>().0;
            let action = &pack.object(eating.object).interactions[eating.interaction as usize];
            let personality = world.get::<Personality>(actor).cloned();
            let fumble = world
                .get::<terri_core::Fumbled>(actor)
                .map_or(1., |f| f.delta_scale);
            if let Some(mut needs) = world.get_mut::<Needs>(actor) {
                for &(need, total) in &action.advertises {
                    let rate = crate::need_interactions::physical::ordinary_rate(
                        total,
                        personality
                            .as_ref()
                            .map_or(1., |p| p.satisfaction[need as usize]),
                        fumble,
                        1.,
                        SWIM_TICKS,
                    );
                    needs.fill(NeedId::ALL[need as usize], rate);
                }
            }
        }
        let done = if episode.phase == 4 {
            episode.elapsed = episode.elapsed.saturating_sub(1);
            episode.elapsed == 0
        } else {
            episode.elapsed += 1;
            match episode.phase {
                1 if episode.elapsed == ENTER_TICKS => {
                    episode.phase = 2;
                    episode.elapsed = 0;
                    false
                }
                CANCELED_LANDING if episode.elapsed == ENTER_TICKS => {
                    episode.phase = 3;
                    episode.elapsed = 0;
                    false
                }
                2 if episode.elapsed == SWIM_TICKS => {
                    episode.phase = 3;
                    episode.exit_origin = episode.elapsed;
                    episode.elapsed = 0;
                    false
                }
                3 => episode.elapsed == EXIT_TICKS,
                _ => false,
            }
        };
        if done {
            let target = *world
                .get::<Target>(actor)
                .expect("pool episode retains its target");
            if !episode.interrupted {
                complete(world, actor);
            }
            crate::player_actions::complete_matching(
                world,
                actor,
                terri_core::Intent {
                    object: target.object,
                    interaction: target.interaction,
                    cleanup: None,
                    chore: None,
                },
            );
            crate::reservations::release_now(world, actor, target);
            world
                .entity_mut(actor)
                .remove::<(PoolEpisode, Eating, Target, terri_core::Fumbled)>();
        } else {
            if let Some(mut eating) = world.get_mut::<Eating>(actor) {
                eating.remaining_ticks = remaining(&episode);
            }
            world.entity_mut(actor).insert(episode);
        }
    }
}

/// Lifecycle loss terminates the episode; ordinary orders use controlled exit instead.
pub(crate) fn cleanup(world: &mut World) {
    let invalid: Vec<_> = world
        .query::<(Entity, &PoolEpisode)>()
        .iter(world)
        .filter_map(|(actor, episode)| {
            let target = world.get::<Target>(actor);
            let reason =
                if world.get::<Agent>(actor).is_none() || world.get::<Needs>(actor).is_none() {
                    Some("Pool user is no longer available")
                } else if world.get::<SmartObject>(episode.pool).is_none() {
                    Some("Pool is no longer available")
                } else if target.is_none_or(|t| t.object != episode.pool) {
                    Some("Pool activity lost its target")
                } else if episode.phase > 0 && world.get::<Eating>(actor).is_none() {
                    Some("Pool activity lost its occupied action")
                } else {
                    None
                };
            reason.map(|reason| (actor, episode.pool, reason))
        })
        .collect();
    for (actor, pool, reason) in invalid {
        // Terminal lifecycle loss uses the existing native render reset owner.
        world
            .resource_mut::<crate::placement::LotEditState>()
            .discontinuities
            .insert(actor);
        if let Some(owner) = world
            .get::<crate::player_actions::ServedOrder>(actor)
            .copied()
        {
            if world
                .get::<IntentQueue>(actor)
                .is_some_and(|q| q.order(owner.0).is_some_and(|o| o.intent.object == pool))
            {
                crate::player_actions::terminal(world, actor, owner.0, "failed", Some(reason));
            }
        }
        let target = world
            .get::<Target>(actor)
            .copied()
            .filter(|t| t.object == pool);
        crate::reservations::release_now(
            world,
            actor,
            target.unwrap_or(Target {
                object: pool,
                interaction: 0,
            }),
        );
        world.entity_mut(actor).remove::<PoolEpisode>();
        if target.is_some() {
            world
                .entity_mut(actor)
                .remove::<(Eating, Target, Path, terri_core::Fumbled)>();
        } else if world.get::<Target>(actor).is_none() {
            world
                .entity_mut(actor)
                .remove::<(Eating, terri_core::Fumbled)>();
        }
    }
    let orphaned: Vec<_> = world
        .query_filtered::<(Entity, &SmartObject), With<terri_core::Reserved>>()
        .iter(world)
        .filter(|(object, definition)| {
            has_pool(world.resource::<Content>().0.object(definition.0))
                && !world
                    .try_query::<&Target>()
                    .is_some_and(|mut q| q.iter(world).any(|t| t.object == *object))
        })
        .map(|(object, _)| object)
        .collect();
    for object in orphaned {
        world.entity_mut(object).remove::<terri_core::Reserved>();
    }
}

fn complete(world: &mut World, actor: Entity) {
    let eating = *world.get::<Eating>(actor).unwrap();
    let pack = world.resource::<Content>().0;
    let action = &pack.object(eating.object).interactions[eating.interaction as usize];
    let mut habituation = world
        .get::<terri_core::Habituation>(actor)
        .cloned()
        .unwrap_or_default();
    habituation.bump(
        eating.object,
        eating.interaction,
        pack.tuning.habituation_per_use,
        pack.tuning.habituation_max,
    );
    world.entity_mut(actor).insert(habituation);
    let reward = if world.get::<terri_core::Fumbled>(actor).is_some() {
        0.
    } else {
        crate::systems::satisfaction::hobby_payout(
            action.satisfaction,
            &action.tags,
            world.get::<terri_core::Hobbies>(actor),
            pack.tuning.hobby_multiplier,
        ) * crate::systems::trait_effects::condition_accrual_scale(
            world.get::<terri_core::Traits>(actor),
            pack,
        )
    };
    if reward > 0. {
        if let Some(mut satisfaction) = world.get_mut::<terri_core::Satisfaction>(actor) {
            satisfaction.reward(reward);
        }
    }
    if let Some(mut traits) = world.get_mut::<terri_core::Traits>(actor) {
        crate::systems::trait_effects::learn_and_manage(&mut traits, pack, &action.tags);
    }
    if let Some(mut skills) = world.get_mut::<terri_core::Skills>(actor) {
        crate::skills::practise(&mut skills, pack, &action.tags);
    }
}

/// A new front order requests one controlled exit, then waits for physical release.
pub(crate) fn before_orders(world: &mut World, actor: Entity) {
    let Some(owner) = world
        .get::<crate::player_actions::ServedOrder>(actor)
        .copied()
    else {
        request_exit(world, actor);
        return;
    };
    let changed = world
        .get::<IntentQueue>(actor)
        .is_some_and(|q| q.entries().first().is_some_and(|e| e.id != owner.0));
    if changed && request_exit(world, actor) {
        crate::player_actions::terminal(
            world,
            actor,
            owner.0,
            "canceled",
            Some("Replaced by another order"),
        );
    }
}

pub(crate) fn capture(world: &World) -> Vec<SavedPoolEpisode> {
    let mut rows = world
        .try_query::<(Entity, &PoolEpisode)>()
        .map_or_else(Vec::new, |mut q| {
            q.iter(world)
                .map(|(actor, e)| SavedPoolEpisode {
                    actor: actor.index_u32(),
                    pool: e.pool.index_u32(),
                    phase: e.phase,
                    elapsed: e.elapsed,
                    exit_origin: e.exit_origin,
                    interrupted: e.interrupted,
                    approach: e.approach,
                })
                .collect()
        });
    rows.sort_by_key(|e| e.actor);
    rows
}

mod migration;
#[cfg(test)]
mod migration_tests;
mod persistence;
pub(crate) use migration::migrate_v22;
pub(crate) use persistence::{restore, restore_historical_v22, restore_physical, SavedPoolClock};

/// Historical retreats may have reached the part of entry that is now airborne.
pub(crate) fn migrate_legacy_clock(world: &mut World, clock: SavedPoolClock) {
    for (mut episode, mut eating) in world
        .query::<(&mut PoolEpisode, &mut Eating)>()
        .iter_mut(world)
    {
        if episode.phase == 4 && clock == SavedPoolClock::Legacy && episode.elapsed >= TAKEOFF_TICK
        {
            episode.phase = CANCELED_LANDING;
        } else if episode.phase == 3 {
            episode.elapsed = episode.elapsed * EXIT_TICKS / clock.exit_ticks();
        }
        eating.remaining_ticks = remaining(&episode);
    }
}

pub(crate) fn legacy_exit_clock_is_exact(pools: &[SavedPoolEpisode]) -> bool {
    pools.iter().all(|episode| {
        episode.phase != 3
            || (u64::from(episode.elapsed) * u64::from(LEGACY_EXIT_TICKS))
                .is_multiple_of(u64::from(EXIT_TICKS))
    })
}

/// Project both the pool phase clock and its occupied countdown. Fractional
/// exit ticks round down on the historical clock.
pub(crate) fn project_legacy_clock(
    saved: &mut terri_core::SaveSnapshotV20,
    pools: &mut [SavedPoolEpisode],
    clock: SavedPoolClock,
) {
    let room_world = &mut saved.legacy.legacy.legacy.legacy;
    let entities = &mut room_world
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .world
        .entities;
    for episode in pools.iter_mut().filter(|row| row.phase != 0) {
        let Ok(index) = entities.binary_search_by_key(&episode.actor, |entity| entity.index) else {
            continue;
        };
        let Some(eating) = entities[index].eating.as_mut() else {
            continue;
        };
        if Some(eating.remaining_ticks) != countdown(episode.phase, episode.elapsed, EXIT_TICKS) {
            continue;
        }
        if episode.phase == CANCELED_LANDING && clock == SavedPoolClock::Legacy {
            episode.phase = 4;
        } else if episode.phase == 3 {
            episode.elapsed = episode.elapsed * clock.exit_ticks() / EXIT_TICKS;
        }
        eating.remaining_ticks = countdown(episode.phase, episode.elapsed, clock.exit_ticks())
            .expect("projected pool phase fits the historical countdown");
    }
}

fn remaining(e: &PoolEpisode) -> u32 {
    countdown(e.phase, e.elapsed, EXIT_TICKS).expect("runtime pool phase has a valid countdown")
}

fn countdown(phase: u8, elapsed: u32, exit_ticks: u32) -> Option<u32> {
    match phase {
        0 => Some(ENTER_TICKS + SWIM_TICKS + exit_ticks),
        1 => ENTER_TICKS
            .checked_sub(elapsed)
            .map(|entry| entry + SWIM_TICKS + exit_ticks),
        2 => SWIM_TICKS
            .checked_sub(elapsed)
            .map(|swim| swim + exit_ticks),
        3 => exit_ticks.checked_sub(elapsed),
        4 => Some(elapsed),
        CANCELED_LANDING => ENTER_TICKS
            .checked_sub(elapsed)
            .map(|entry| entry + exit_ticks),
        _ => None,
    }
}

pub(crate) fn hash(world: &World, hash: &mut terri_core::FnvHasher) {
    let rows = capture(world);
    if rows.is_empty() {
        return;
    }
    hash.write_bytes(b"pool-episodes-v22");
    hash.write_u64(rows.len() as u64);
    for e in rows {
        for value in [
            u64::from(e.actor),
            u64::from(e.pool),
            u64::from(e.phase),
            u64::from(e.elapsed),
            u64::from(e.exit_origin),
            u64::from(e.interrupted),
            e.approach.0 as u64,
            e.approach.1 as u64,
        ] {
            hash.write_u64(value);
        }
    }
}
