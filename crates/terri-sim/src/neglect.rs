//! Continuous household neglect, independent of published chore and dish records.
use bevy_ecs::prelude::*;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::{chores::*, save::SavedDomestic, save_v19::*, SimClock, TileGrid};

pub(crate) const MAXIMUM_DIRT_GRACE_TICKS: u64 = 120;
pub(crate) const UNFINISHED_WORK_GRACE_TICKS: u64 = 1440;

fn now(world: &World) -> u64 {
    world.resource::<SimClock>().tick
}

/// Each entry describes work that can be cleaned, together with its board duty.
fn sources(world: &World, chores: &SavedChores) -> BTreeMap<NeglectSource, (ChoreKey, bool)> {
    let mut result = BTreeMap::new();
    let grid = world.resource::<TileGrid>();
    let regions = crate::room_regions::RoomRegions::cleanable(world);
    for &(cell, amount) in &chores.floors {
        let xy = (
            (cell as usize % grid.width()) as i32,
            (cell as usize / grid.width()) as i32,
        );
        if !grid.is_walkable(xy.0, xy.1) {
            continue;
        }
        if let Some(room) = regions.at(xy) {
            let key = ChoreKey {
                kind: ChoreKind::Floors,
                target: room,
            };
            if amount > 0 {
                result.insert(NeglectSource::Floor(cell), (key, amount == 1000));
            }
        }
    }
    for &(surface, amount) in &chores.surfaces {
        if let Some(key) = crate::chores::neglect_surface_key(world, surface) {
            if amount > 0 {
                result.insert(NeglectSource::Surface(surface), (key, amount == 1000));
            }
        }
    }
    for &(bin, amount) in &chores.bins {
        let key = ChoreKey {
            kind: ChoreKind::Bins,
            target: bin,
        };
        if amount >= 600 && crate::chores::key_valid(world, key) {
            result.insert(NeglectSource::Bin(bin), (key, amount == 1000));
        }
    }
    let key = ChoreKey {
        kind: ChoreKind::Dishes,
        target: 0,
    };
    if let Some(domestic) = world.get_resource::<SavedDomestic>() {
        if !domestic.dishes.is_empty() {
            let (width, labels) = crate::domestic::rooms(world);
            let mut room_units = BTreeMap::<Option<u32>, u32>::new();
            for dish in domestic
                .dishes
                .iter()
                .filter(|dish| crate::domestic::visible(domestic, dish.id))
            {
                let room = crate::dining::entity(world, dish.surface)
                    .and_then(|e| world.get::<terri_core::Position>(e))
                    .and_then(|p| crate::domestic::room_at(width, &labels, p));
                *room_units.entry(room).or_default() += dish.units;
            }
            for dish in &domestic.dishes {
                let room = crate::dining::entity(world, dish.surface)
                    .and_then(|e| world.get::<terri_core::Position>(e))
                    .and_then(|p| crate::domestic::room_at(width, &labels, p));
                result.insert(
                    NeglectSource::Dish(dish.id),
                    (
                        key,
                        crate::domestic::visible(domestic, dish.id)
                            && room_units.get(&room).copied().unwrap_or(0) >= 6,
                    ),
                );
            }
        }
    }
    result
}

type SourceMap = BTreeMap<NeglectSource, (ChoreKey, bool)>;
type DutySet = BTreeSet<(ChoreKey, u32)>;

struct Observation {
    sources: SourceMap,
    duties: DutySet,
    episodes: Vec<ChoreEpisode>,
    continuing: BTreeSet<(ChoreKey, u64)>,
}

fn observe(world: &World, chores: &SavedChores) -> Observation {
    let active = sources(world, chores);
    let duties = chores
        .assignments
        .iter()
        .filter(|a| crate::chores::work_needed(world, chores, a.key, a.owner))
        .map(|a| (a.key, a.owner))
        .collect();
    let mut continuing = BTreeSet::new();
    for task in &chores.tasks {
        if task.completed_units == 0 && task.remaining == 0 {
            continue;
        }
        let key = if task.key.kind == ChoreKind::Surfaces {
            crate::chores::neglect_surface_key(world, task.key.target).unwrap_or(task.key)
        } else {
            task.key
        };
        let physical = task.cells.iter().skip(task.cursor as usize).any(|target| {
            let source = match task.key.kind {
                ChoreKind::Floors => NeglectSource::Floor(*target),
                ChoreKind::Bins => NeglectSource::Bin(*target),
                ChoreKind::Dishes => return false,
                _ => NeglectSource::Surface(*target),
            };
            active
                .get(&source)
                .is_some_and(|(source_key, _)| *source_key == key)
        });
        if physical {
            continuing.insert((key, task.started_day));
        }
    }
    if let Some(domestic) = world.get_resource::<SavedDomestic>() {
        let days: BTreeMap<_, _> = chores.dish_started.iter().copied().collect();
        let today = now(world) / u64::from(world.resource::<crate::Content>().0.tuning.day_ticks);
        for cleanup in &domestic.cleanup {
            if cleanup
                .collected
                .iter()
                .any(|id| active.contains_key(&NeglectSource::Dish(*id)))
            {
                continuing.insert((
                    ChoreKey {
                        kind: ChoreKind::Dishes,
                        target: 0,
                    },
                    days.get(&cleanup.person).copied().unwrap_or(today),
                ));
            }
        }
    }
    Observation {
        sources: active,
        duties,
        episodes: chores
            .episodes
            .iter()
            .filter(|episode| !episode.settled)
            .cloned()
            .collect(),
        continuing,
    }
}

fn eligible_episodes(observation: &Observation) -> BTreeSet<u32> {
    observation
        .episodes
        .iter()
        .filter(|episode| {
            episode.needed
                && (observation.duties.contains(&(episode.key, episode.owner))
                    || observation.continuing.contains(&(episode.key, episode.day)))
        })
        .map(|episode| episode.id)
        .collect()
}

pub(crate) fn refresh(world: &mut World) {
    let observation = observe(
        world,
        world
            .get_resource::<SavedChores>()
            .unwrap_or(&SavedChores::default()),
    );
    apply(world, observation);
}

pub(crate) fn refresh_in(world: &mut World, chores: &SavedChores) {
    let observation = observe(world, chores);
    apply(world, observation);
}

fn apply(world: &mut World, observation: Observation) {
    let eligible = eligible_episodes(&observation);
    let Observation {
        sources: active,
        duties,
        episodes,
        continuing: _,
    } = observation;
    let tick = now(world);
    let mut saved = world.remove_resource::<SavedNeglect>().unwrap_or_default();
    let mut previous: BTreeMap<_, _> = std::mem::take(&mut saved.sources)
        .into_iter()
        .map(|timer| (timer.source, timer))
        .collect();
    for (&source, &(_, maximum)) in &active {
        let mut timer = previous.remove(&source).unwrap_or(NeglectTimer {
            source,
            actionable_since: tick,
            maximum_since: None,
        });
        timer.maximum_since = if maximum {
            Some(timer.maximum_since.unwrap_or(tick))
        } else {
            None
        };
        saved.sources.push(timer);
    }
    saved.sources.sort_by_key(|t| t.source);
    let mut maximum_by_key = BTreeMap::<ChoreKey, u64>::new();
    for source in &saved.sources {
        if let (Some(start), Some((key, true))) = (source.maximum_since, active.get(&source.source))
        {
            maximum_by_key
                .entry(*key)
                .and_modify(|old| *old = (*old).min(start))
                .or_insert(start);
        }
    }
    let mut previous_duties: BTreeMap<_, _> = std::mem::take(&mut saved.duties)
        .into_iter()
        .map(|timer| ((timer.key, timer.owner), timer))
        .collect();
    for (key, owner) in duties {
        let mut timer = previous_duties.remove(&(key, owner)).unwrap_or(DutyTimer {
            key,
            owner,
            actionable_since: tick,
            maximum_since: None,
        });
        timer.maximum_since = maximum_by_key
            .get(&key)
            .map(|start| (*start).max(timer.actionable_since));
        saved.duties.push(timer);
    }
    let due: DutySet = saved
        .duties
        .iter()
        .filter(|timer| duty_timer_due(timer, tick))
        .map(|timer| (timer.key, timer.owner))
        .collect();
    saved.matured_episodes.retain(|id| eligible.contains(id));
    for episode in &episodes {
        if episode.needed && !episode.unavailable && due.contains(&(episode.key, episode.owner)) {
            saved.matured_episodes.push(episode.id);
        }
    }
    saved.matured_episodes.sort_unstable();
    saved.matured_episodes.dedup();
    world.insert_resource(saved);
}

fn duty_timer_due(timer: &DutyTimer, tick: u64) -> bool {
    tick.saturating_sub(timer.actionable_since) >= UNFINISHED_WORK_GRACE_TICKS
        || timer
            .maximum_since
            .is_some_and(|start| tick.saturating_sub(start) >= MAXIMUM_DIRT_GRACE_TICKS)
}

pub(crate) fn episode_matured(world: &World, episode: u32) -> bool {
    world
        .get_resource::<SavedNeglect>()
        .is_some_and(|saved| saved.matured_episodes.binary_search(&episode).is_ok())
}

fn timer_due(timer: &NeglectTimer, tick: u64) -> bool {
    tick.saturating_sub(timer.actionable_since) >= UNFINISHED_WORK_GRACE_TICKS
        || timer
            .maximum_since
            .is_some_and(|start| tick.saturating_sub(start) >= MAXIMUM_DIRT_GRACE_TICKS)
}

pub(crate) fn source_due(world: &World, source: NeglectSource) -> bool {
    world
        .get_resource::<SavedNeglect>()
        .and_then(|s| {
            s.sources
                .binary_search_by_key(&source, |t| t.source)
                .ok()
                .map(|index| &s.sources[index])
        })
        .is_some_and(|t| timer_due(t, now(world)))
}

pub(crate) fn duty_due(world: &World, _chores: &SavedChores, key: ChoreKey, owner: u32) -> bool {
    let Some(saved) = world.get_resource::<SavedNeglect>() else {
        return false;
    };
    saved
        .duties
        .iter()
        .any(|timer| timer.key == key && timer.owner == owner && duty_timer_due(timer, now(world)))
}

pub(crate) fn snapshot(world: &World) -> SavedNeglect {
    world
        .get_resource::<SavedNeglect>()
        .cloned()
        .unwrap_or_default()
}

pub(crate) fn restore(world: &mut World, saved: SavedNeglect) -> Result<(), crate::SaveError> {
    let chores = world
        .get_resource::<SavedChores>()
        .cloned()
        .unwrap_or_default();
    let observation = observe(world, &chores);
    let active = &observation.sources;
    let eligible = eligible_episodes(&observation);
    let tick = now(world);
    if saved.sources.len() > active.len()
        || saved.duties.len() > chores.assignments.len()
        || saved.matured_episodes.len() > chores.episodes.len()
        || saved
            .matured_episodes
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        || saved
            .matured_episodes
            .iter()
            .any(|id| !eligible.contains(id))
        || saved.sources.windows(2).any(|p| p[0].source >= p[1].source)
        || saved
            .duties
            .windows(2)
            .any(|p| (p[0].key, p[0].owner) >= (p[1].key, p[1].owner))
        || saved.sources.iter().any(|t| {
            t.actionable_since > tick
                || !active.contains_key(&t.source)
                || t.maximum_since.is_some_and(|start| {
                    start < t.actionable_since || start > tick || !active[&t.source].1
                })
        })
        || saved.duties.iter().any(|t| {
            t.actionable_since > tick
                || t.maximum_since
                    .is_some_and(|start| start > tick || start < t.actionable_since)
                || !observation.duties.contains(&(t.key, t.owner))
        })
    {
        return Err(crate::SaveError::InvalidValue);
    }
    world.insert_resource(saved);
    Ok(())
}

pub(crate) fn hash(world: &World, hash: &mut terri_core::FnvHasher) {
    let saved = snapshot(world);
    if saved.sources.is_empty() && saved.duties.is_empty() && saved.matured_episodes.is_empty() {
        return;
    }
    hash.write_bytes(b"household-neglect-v1");
    hash.write_u64(saved.matured_episodes.len() as u64);
    for episode in &saved.matured_episodes {
        hash.write_u64(u64::from(*episode));
    }
    hash.write_u64(saved.sources.len() as u64);
    for timer in saved.sources {
        let (tag, id) = match timer.source {
            NeglectSource::Floor(id) => (0, id),
            NeglectSource::Surface(id) => (1, id),
            NeglectSource::Dish(id) => (2, id),
            NeglectSource::Bin(id) => (3, id),
        };
        hash.write_u64(tag);
        hash.write_u64(u64::from(id));
        hash.write_u64(timer.actionable_since);
        hash.write_u64(timer.maximum_since.unwrap_or(u64::MAX));
    }
    hash.write_u64(saved.duties.len() as u64);
    for timer in saved.duties {
        hash.write_u64(timer.key.kind as u64);
        hash.write_u64(u64::from(timer.key.target));
        hash.write_u64(u64::from(timer.owner));
        hash.write_u64(timer.actionable_since);
        hash.write_u64(timer.maximum_since.unwrap_or(u64::MAX));
    }
}

#[cfg(test)]
pub(crate) mod tests;
