//! Housemates remember which topics each person likes: issue 359.
//!
//! When a chat that is not a fight completes, each side may remember how the
//! other really felt about its topic. A memory names who remembers, whom it
//! is about and the topic tag, and holds the remembered preference and the
//! tick it was learned. It fades to nothing over `topic_memory_fade_days`
//! game days, and a later chat on the same topic with the same person
//! replaces it. Without a memory, an initiator guesses.
//!
//! Nothing here draws from `SimRng`. Whether a chat is remembered and what a
//! guess is come from FNV-1a hashes of saved facts, so the shared random
//! stream is exactly as long as it was before memories existed.
use bevy_ecs::prelude::*;
use terri_core::{FnvHasher, SimId};
use terri_data::ContentPack;

/// Domain bytes for the roll that decides whether a chat is remembered.
const REMEMBER_DOMAIN: &[u8] = b"topic-remember-v1";
/// Domain bytes for the noise in a guess.
const GUESS_DOMAIN: &[u8] = b"topic-guess-v1";

/// One remembered preference: what `knower` learned about how `other`
/// feels about `tag`, at `tick`.
#[derive(Clone, Debug, PartialEq)]
pub struct Memory {
    pub knower: SimId,
    pub other: SimId,
    pub tag: String,
    /// The other person's true preference for the topic, from -1 to 1.
    pub preference: f32,
    /// The tick the memory was learned or last refreshed.
    pub tick: u64,
}

impl Memory {
    fn key(&self) -> (SimId, SimId, &str) {
        (self.knower, self.other, &self.tag)
    }
}

/// Every memory, strictly ascending by knower, other and tag, one row each.
/// Saved from schema thirty-one; in the world hash whenever it holds
/// anything.
#[derive(Resource, Default, Clone, Debug, PartialEq)]
pub struct TopicMemory(Vec<Memory>);

impl TopicMemory {
    /// Builds the list from rows that are already strictly ordered. The
    /// loader checks the order before it calls this.
    pub fn from_sorted(rows: Vec<Memory>) -> Self {
        Self(rows)
    }

    pub fn entries(&self) -> &[Memory] {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    fn position(&self, knower: SimId, other: SimId, tag: &str) -> Result<usize, usize> {
        self.0
            .binary_search_by(|memory| memory.key().cmp(&(knower, other, tag)))
    }

    /// What `knower` remembers about `other` and `tag`, if anything.
    pub fn get(&self, knower: SimId, other: SimId, tag: &str) -> Option<&Memory> {
        self.position(knower, other, tag).ok().map(|at| &self.0[at])
    }

    /// Records or refreshes a memory. A list already holding `cap` rows
    /// first drops its oldest row, the earliest tick and then the smallest
    /// key, so the list never holds more than a save can load.
    pub fn remember(&mut self, memory: Memory, cap: usize) {
        match self.position(memory.knower, memory.other, &memory.tag) {
            Ok(at) => self.0[at] = memory,
            Err(_) => {
                if cap == 0 {
                    return;
                }
                while self.0.len() >= cap {
                    let oldest = self
                        .0
                        .iter()
                        .enumerate()
                        .min_by(|(_, a), (_, b)| (a.tick, a.key()).cmp(&(b.tick, b.key())))
                        .map(|(at, _)| at)
                        .expect("a full list holds a row");
                    self.0.remove(oldest);
                }
                let at = self
                    .position(memory.knower, memory.other, &memory.tag)
                    .unwrap_err();
                self.0.insert(at, memory);
            }
        }
    }

    /// Drops every memory held by or about `sim`, as death drops every
    /// other per-person record.
    pub fn forget(&mut self, sim: SimId) {
        self.0
            .retain(|memory| memory.knower != sim && memory.other != sim);
    }

    /// Drops every memory whose strength has reached zero at `now`.
    pub fn expire(&mut self, now: u64, fade_ticks: u64) {
        self.0
            .retain(|memory| strength(memory.tick, now, fade_ticks) > 0.0);
    }

    /// An empty list hashes nothing, so a world in which nobody remembers
    /// anything hashes exactly as it did before memories existed.
    pub fn hash_into(&self, hash: &mut FnvHasher, tag: &[u8]) {
        if self.0.is_empty() {
            return;
        }
        hash.write_bytes(tag);
        hash.write_u64(self.0.len() as u64);
        for memory in &self.0 {
            hash.write_u64(u64::from(memory.knower.0));
            hash.write_u64(u64::from(memory.other.0));
            hash.write_u64(memory.tag.len() as u64);
            hash.write_bytes(memory.tag.as_bytes());
            hash.write_f32(memory.preference);
            hash.write_u64(memory.tick);
        }
    }
}

/// How many ticks a memory takes to fade: the tuned days times the pack's
/// day length.
pub fn fade_ticks(pack: &ContentPack) -> u64 {
    u64::from(pack.tuning.topic_memory_fade_days) * u64::from(pack.tuning.day_ticks)
}

/// How much of a memory learned at `learned` is left at `now`, from 1 when
/// fresh to 0 once `fade_ticks` have passed. A fade of no ticks leaves
/// nothing.
pub fn strength(learned: u64, now: u64, fade_ticks: u64) -> f32 {
    if fade_ticks == 0 {
        return 0.0;
    }
    let elapsed = now.saturating_sub(learned);
    if elapsed >= fade_ticks {
        return 0.0;
    }
    (1.0 - elapsed as f64 / fade_ticks as f64).clamp(0.0, 1.0) as f32
}

/// A hash read as a number from 0 up to but not including 1: its top 53
/// bits over 2 to the 53rd, as [`crate::subjects::personal`] reads one.
fn unit(hash: &FnvHasher) -> f64 {
    (hash.finish() >> 11) as f64 / (1u64 << 53) as f64
}

/// The chance that a completed chat is remembered by someone of this
/// sociability: `floor + (1 - floor) * sociability`.
pub fn remember_chance(floor: f32, sociability: f32) -> f32 {
    let floor = floor.clamp(0.0, 1.0);
    floor + (1.0 - floor) * sociability.clamp(0.0, 1.0)
}

/// Whether `knower` remembers how `other` felt about `tag` after the chat
/// that completed at `tick`. The roll is a hash of those facts, not a draw.
pub fn remembers(knower: SimId, other: SimId, tag: &str, tick: u64, chance: f32) -> bool {
    let mut hash = FnvHasher::default();
    hash.write_bytes(REMEMBER_DOMAIN);
    hash.write_u64(tick);
    hash.write_u64(u64::from(knower.0));
    hash.write_u64(u64::from(other.0));
    hash.write_bytes(tag.as_bytes());
    unit(&hash) < f64::from(chance)
}

/// The noise in `knower`'s guess about `other` and `tag`, from -1 up to 1.
/// It leaves out the tick, so the same guess comes back every time.
pub fn guess_noise(knower: SimId, other: SimId, tag: &str) -> f32 {
    let mut hash = FnvHasher::default();
    hash.write_bytes(GUESS_DOMAIN);
    hash.write_u64(u64::from(knower.0));
    hash.write_u64(u64::from(other.0));
    hash.write_bytes(tag.as_bytes());
    (unit(&hash) * 2.0 - 1.0) as f32
}

/// What an initiator believes about a listener's preference, and what of it
/// comes from memory.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Belief {
    /// `strength * remembered + (1 - strength) * guess`, or the guess alone
    /// without a memory.
    pub value: f32,
    /// How much of a memory is left, 0 without one.
    pub strength: f32,
    /// The remembered preference, 0 without a memory.
    pub remembered: f32,
}

/// `knower`'s belief about how `other` feels about `tag`. The guess is
/// `sociability * truth + (1 - sociability) * noise`.
pub fn belief(
    memory: &TopicMemory,
    (knower, other, tag): (SimId, SimId, &str),
    truth: f32,
    sociability: f32,
    (now, fade_ticks): (u64, u64),
) -> Belief {
    let s = sociability.clamp(0.0, 1.0);
    let guess = s * truth + (1.0 - s) * guess_noise(knower, other, tag);
    match memory.get(knower, other, tag) {
        Some(found) => {
            let strength = strength(found.tick, now, fade_ticks);
            Belief {
                value: strength * found.preference + (1.0 - strength) * guess,
                strength,
                remembered: found.preference,
            }
        }
        None => Belief {
            value: guess,
            strength: 0.0,
            remembered: 0.0,
        },
    }
}

/// How much a remembered dislike holds a topic back: 1 for no remembered
/// dislike, falling with sociability, the memory's strength and how much
/// the topic was disliked, and never below `min_factor`. A guess never
/// enters, so nobody avoids a topic on a hunch.
pub fn avoidance_factor(belief: Belief, sociability: f32, avoidance: f32, min_factor: f32) -> f32 {
    let dislike = (-belief.remembered).max(0.0);
    (1.0 - avoidance * sociability.clamp(0.0, 1.0) * belief.strength * dislike).max(min_factor)
}

/// After a completed chat, `knower` may remember how `other` felt about the
/// chat's topic: with [`remember_chance`] for their sociability, decided by
/// [`remembers`]. A memory already held for that person and topic is always
/// refreshed. Smalltalk, the fallback with no topic of its own, teaches
/// nothing. A list at the save loader's cap drops its oldest memory first.
pub(crate) fn learn(
    memory: &mut TopicMemory,
    tuning: &terri_data::Tuning,
    (knower, other, topic): (SimId, SimId, &crate::social_episode::Topic),
    preference: f32,
    sociability: f32,
    tick: u64,
) {
    if topic.tag == crate::social_episode::SMALLTALK_TAG || !preference.is_finite() {
        return;
    }
    // A later chat on a topic already remembered always refreshes it; only a
    // new memory depends on the roll.
    let known = memory.get(knower, other, &topic.tag).is_some();
    let chance = remember_chance(tuning.topic_memory_remember_floor, sociability);
    if !known && !remembers(knower, other, &topic.tag, tick, chance) {
        return;
    }
    memory.remember(
        Memory {
            knower,
            other,
            tag: topic.tag.clone(),
            preference: preference.clamp(-1.0, 1.0),
            tick,
        },
        crate::save::MAX_LIST_ENTRIES,
    );
}

/// Prunes memories that have faded completely.
pub(crate) fn expire(world: &mut World) {
    let Some(pack) = world
        .get_resource::<crate::Content>()
        .map(|content| content.0)
    else {
        return;
    };
    let now = world.resource::<terri_core::SimClock>().tick;
    if let Some(mut memory) = world.get_resource_mut::<TopicMemory>() {
        if !memory.is_empty() {
            memory.expire(now, fade_ticks(pack));
        }
    }
}

pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    if let Some(memory) = world.get_resource::<TopicMemory>() {
        memory.hash_into(hash, b"topic-memory-v1");
    }
}

#[cfg(test)]
#[path = "topic_memory_tests.rs"]
mod tests;
