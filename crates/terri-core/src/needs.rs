use crate::components::{NEED_MAX, NEED_MIN};
use bevy_ecs::prelude::Component;

/// Number of distinct needs. Fixed at compile time on purpose: it sets
/// the world-hash shape, and a variable count would make a determinism
/// regression and a content edit produce the same failure.
pub const NEED_COUNT: usize = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum NeedId {
    Hunger = 0,
    Energy,
    Hygiene,
    Bladder,
    Social,
    Fun,
    Comfort,
}

impl NeedId {
    /// Every variant, in index order. Hand-written because Rust has no
    /// built-in enum iteration; `all_lists_every_variant_in_index_order`
    /// is what stops it drifting from the enum.
    pub const ALL: [NeedId; NEED_COUNT] = [
        NeedId::Hunger,
        NeedId::Energy,
        NeedId::Hygiene,
        NeedId::Bladder,
        NeedId::Social,
        NeedId::Fun,
        NeedId::Comfort,
    ];

    pub fn index(self) -> usize {
        self as usize
    }

    /// The name content files use. Changing one of these is a content
    /// breaking change, not a rename.
    pub fn as_str(self) -> &'static str {
        match self {
            NeedId::Hunger => "hunger",
            NeedId::Energy => "energy",
            NeedId::Hygiene => "hygiene",
            NeedId::Bladder => "bladder",
            NeedId::Social => "social",
            NeedId::Fun => "fun",
            NeedId::Comfort => "comfort",
        }
    }

    pub fn from_name(name: &str) -> Option<NeedId> {
        NeedId::ALL.into_iter().find(|id| id.as_str() == name)
    }
}

/// All seven need levels for one sim, each 0.0 (desperate) to 100.0
/// (satisfied).
#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Needs([f32; NEED_COUNT]);

impl Needs {
    pub fn all_at(level: f32) -> Self {
        Needs([level.clamp(NEED_MIN, NEED_MAX); NEED_COUNT])
    }

    pub fn get(&self, id: NeedId) -> f32 {
        self.0[id.index()]
    }

    pub fn set(&mut self, id: NeedId, level: f32) {
        self.0[id.index()] = level.clamp(NEED_MIN, NEED_MAX);
    }

    pub fn drain(&mut self, id: NeedId, amount: f32) {
        let next = self.get(id) - amount;
        self.set(id, next);
    }

    pub fn fill(&mut self, id: NeedId, amount: f32) {
        let next = self.get(id) + amount;
        self.set(id, next);
    }

    /// 0.0 when satisfied, 1.0 when desperate. Advertisement scoring
    /// weights this nonlinearly.
    pub fn deficit(&self, id: NeedId) -> f32 {
        (NEED_MAX - self.get(id)) / NEED_MAX
    }

    pub fn as_slice(&self) -> &[f32; NEED_COUNT] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_lists_every_variant_in_index_order() {
        // ALL is hand-written, so it can silently drift from the enum.
        // Anything that iterates needs would then skip one forever.
        assert_eq!(NeedId::ALL.len(), NEED_COUNT);
        for (i, id) in NeedId::ALL.iter().enumerate() {
            assert_eq!(id.index(), i, "ALL is out of order at {i}");
        }
    }

    #[test]
    fn names_round_trip_for_every_variant() {
        for id in NeedId::ALL {
            assert_eq!(NeedId::from_name(id.as_str()), Some(id));
        }
        assert_eq!(NeedId::from_name("nonexistent"), None);
    }

    #[test]
    fn needs_clamp_to_range() {
        let mut n = Needs::all_at(100.0);
        n.drain(NeedId::Hunger, 150.0);
        assert_eq!(n.get(NeedId::Hunger), 0.0);
        n.fill(NeedId::Hunger, 500.0);
        assert_eq!(n.get(NeedId::Hunger), 100.0);
    }

    #[test]
    fn each_need_is_independent() {
        // A shared-index bug would move all seven together and every
        // other test here would still pass.
        let mut n = Needs::all_at(100.0);
        n.drain(NeedId::Energy, 40.0);
        assert_eq!(n.get(NeedId::Energy), 60.0);
        for id in NeedId::ALL {
            if id != NeedId::Energy {
                assert_eq!(n.get(id), 100.0, "{} moved with Energy", id.as_str());
            }
        }
    }

    #[test]
    fn deficit_is_inverse_of_level() {
        assert_eq!(Needs::all_at(100.0).deficit(NeedId::Fun), 0.0);
        assert_eq!(Needs::all_at(0.0).deficit(NeedId::Fun), 1.0);
        assert_eq!(Needs::all_at(50.0).deficit(NeedId::Fun), 0.5);
    }
}
