//! The lift liked furniture gives fades slowly after a person leaves it -
//! issue 344, [OA-presence] in `docs/specs/2026-10-06-object-affinities.md`.
//!
//! Mood has no stored component, so the fade needs one saved fact per
//! person and presence kind: the tick the lift reaches zero.
use bevy_ecs::prelude::*;
use terri_core::{FnvHasher, SimClock, SimId};
use terri_data::LONGEST_PRESENCE_FADE_TICKS;

use crate::Content;

/// Who is enjoying what they left, as `(person, affinity kind index, end
/// tick)`, ascending by person then kind with one row each. Saved in
/// schema twenty-three; in the world hash whenever it holds anything.
#[derive(Resource, Default, Clone, Debug, PartialEq, Eq)]
pub struct PresenceFade(Vec<(SimId, u32, u64)>);

impl PresenceFade {
    /// Builds the list from saved rows, keeping one entry per person and
    /// kind in order; a later duplicate loses.
    pub fn from_entries(entries: Vec<(SimId, u32, u64)>) -> Self {
        let mut list = Self::default();
        for (sim, kind, end) in entries {
            if let Err(at) = list.position(sim, kind) {
                list.0.insert(at, (sim, kind, end));
            }
        }
        list
    }

    pub fn entries(&self) -> &[(SimId, u32, u64)] {
        &self.0
    }

    fn position(&self, sim: SimId, kind: u32) -> Result<usize, usize> {
        self.0
            .binary_search_by_key(&(sim, kind), |&(person, kind, _)| (person, kind))
    }

    /// The tick the person's lift from `kind` reaches zero, if one is
    /// still on the list.
    pub fn end_tick(&self, sim: SimId, kind: u32) -> Option<u64> {
        self.position(sim, kind).ok().map(|at| self.0[at].2)
    }

    /// Records a lift that takes `ticks` to fade from `now`: the end tick
    /// becomes the later of the one already held and `now + ticks`, so a
    /// smaller lift never cuts a bigger one short. A fade of no ticks
    /// records nothing.
    pub fn refresh(&mut self, sim: SimId, kind: u32, now: u64, ticks: u64) {
        if ticks == 0 {
            return;
        }
        let end = now.saturating_add(ticks);
        match self.position(sim, kind) {
            Ok(at) => self.0[at].2 = self.0[at].2.max(end),
            Err(at) => self.0.insert(at, (sim, kind, end)),
        }
    }

    /// The lift left at `now`: the ticks to the end tick times
    /// `points_per_hour / 60`, and nothing once the end tick is reached or
    /// passed.
    pub fn lift(&self, sim: SimId, kind: u32, now: u64, points_per_hour: f32) -> f32 {
        let Some(end) = self.end_tick(sim, kind).filter(|&end| end > now) else {
            return 0.0;
        };
        let left = (end - now) as f32 * points_per_hour / 60.0;
        if left.is_finite() && left > 0.0 {
            left
        } else {
            0.0
        }
    }

    /// Drops the person's rows, as death drops every other per-person
    /// record.
    pub fn forget(&mut self, sim: SimId) {
        self.0.retain(|&(person, _, _)| person != sim);
    }

    /// Drops every fade whose end tick has been reached.
    pub fn expire(&mut self, now: u64) {
        self.0.retain(|&(_, _, end)| now < end);
    }

    /// An empty list hashes nothing, so a world in which nobody has stood
    /// among something they like hashes exactly as it did before the fade
    /// existed. `tag` keeps this list apart from the other tagged blocks.
    pub fn hash_into(&self, hash: &mut FnvHasher, tag: &[u8]) {
        if self.0.is_empty() {
            return;
        }
        hash.write_bytes(tag);
        hash.write_u64(self.0.len() as u64);
        for &(person, kind, end) in &self.0 {
            hash.write_u64(u64::from(person.0));
            hash.write_u64(u64::from(kind));
            hash.write_u64(end);
        }
    }
}

/// How many ticks a lift of `points` takes to fade at `points_per_hour`: the
/// points over the rate, times sixty ticks to the game hour, rounded down so
/// that the lift left right after a refresh is never more than the room
/// gives. A fade never lasts past [`LONGEST_PRESENCE_FADE_TICKS`], and a lift
/// or a rate that is not a positive number gives no fade at all.
pub fn fade_ticks(points: f32, points_per_hour: f32) -> u64 {
    if !(points.is_finite() && points > 0.0 && points_per_hour.is_finite() && points_per_hour > 0.0)
    {
        return 0;
    }
    let ticks = (f64::from(points) * 60.0 / f64::from(points_per_hour)).floor();
    if ticks >= LONGEST_PRESENCE_FADE_TICKS as f64 {
        LONGEST_PRESENCE_FADE_TICKS
    } else {
        ticks as u64
    }
}

/// Records, once per tick, the lift every person gets from the liked
/// furniture around them, and drops the fades that have ended. Each row
/// takes the later of its own end tick and the new one, so the result does
/// not depend on the order people are visited in.
pub(crate) fn refresh_all(world: &mut World) {
    if world.get_resource::<PresenceFade>().is_none() {
        return;
    }
    let now = world.resource::<SimClock>().tick;
    let pack = world.resource::<Content>().0;
    let rate = pack.tuning.affinity_presence_fade_points_per_hour;
    let lifts = crate::affinity::everyones_presence_lifts(world, pack);
    let mut fade = world.resource_mut::<PresenceFade>();
    fade.expire(now);
    for (person, kinds) in lifts {
        for (kind, points) in kinds {
            fade.refresh(person, kind, now, fade_ticks(points, rate));
        }
    }
}

pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    if let Some(fade) = world.get_resource::<PresenceFade>() {
        fade.hash_into(hash, b"presence-fade-v1");
    }
}

#[cfg(test)]
#[path = "presence_fade_tests.rs"]
mod tests;
