//! Burnt meals - issue 243. A recipe's last hob step can ruin the food:
//! the cook throws it away, starts the recipe again from the fridge, and
//! carries a Burnt dinner moodlet for a while. Cooking mastery lowers the
//! chance, down to one meal in five hundred at the top of the ladder.
use bevy_ecs::prelude::*;
use terri_core::{FnvHasher, SimClock, SimId};
use terri_data::{CompiledChain, ContentPack, Tuning};

/// The activity tag whose skill decides how often the food burns.
pub const COOKING_TAG: &str = "cooking";
/// The station role the food leaves when the roll happens.
pub const HOB_ROLE: &str = "hob";

/// Who burnt a meal and the tick their Burnt dinner moodlet ends, sorted
/// by person with one entry each. Saved in schema eleven; in the world
/// hash whenever it holds anything.
#[derive(Resource, Default, Clone, Debug, PartialEq, Eq)]
pub struct BurntMeals(Vec<(SimId, u64)>);

impl BurntMeals {
    /// Builds the list from saved rows, keeping one entry per person in
    /// id order; a later duplicate loses.
    pub fn from_entries(entries: Vec<(SimId, u64)>) -> Self {
        let mut list = Self::default();
        for (sim, until) in entries {
            if list.0.iter().all(|(id, _)| *id != sim) {
                list.record(sim, until);
            }
        }
        list
    }

    pub fn entries(&self) -> &[(SimId, u64)] {
        &self.0
    }

    /// A new burn replaces the person's earlier one, so the moodlet
    /// restarts rather than stacking.
    pub fn record(&mut self, sim: SimId, until: u64) {
        self.0.retain(|(id, _)| *id != sim);
        let at = self.0.partition_point(|(id, _)| *id < sim);
        self.0.insert(at, (sim, until));
    }

    /// Whether the person's moodlet is still running at `now`.
    pub fn active(&self, sim: SimId, now: u64) -> bool {
        self.0.iter().any(|(id, until)| *id == sim && now < *until)
    }

    /// Drops every moodlet whose tick has passed.
    pub fn expire(&mut self, now: u64) {
        self.0.retain(|(_, until)| now < *until);
    }

    /// An empty list hashes nothing, so a household that never burnt a
    /// meal hashes exactly as it did before burnt meals existed.
    pub fn hash_into(&self, hash: &mut FnvHasher) {
        if self.0.is_empty() {
            return;
        }
        hash.write_bytes(b"burnt-meals-v1");
        hash.write_u64(self.0.len() as u64);
        for (id, until) in &self.0 {
            hash.write_u64(u64::from(id.0));
            hash.write_u64(*until);
        }
    }
}

/// The chance the last hob step burns the food at `mastery`, the share of
/// the cooking ladder climbed: the novice chance at 0, the master chance
/// at 1, a straight line between. Anything that is not a number counts as
/// no mastery at all.
pub fn burn_chance(tuning: &Tuning, mastery: f32) -> f32 {
    let mastery = if mastery.is_finite() {
        mastery.clamp(0.0, 1.0)
    } else {
        0.0
    };
    tuning.burn_chance_novice + (tuning.burn_chance_master - tuning.burn_chance_novice) * mastery
}

/// Whether `step` is the last hob step of `chain`: a hob step with no hob
/// step directly after it. The food leaves the stove when it ends, which
/// is when the cook finds out whether it is ruined; one roll per meal.
pub(crate) fn last_hob_step(pack: &ContentPack, chain: &CompiledChain, step: u32) -> bool {
    let on_hob = |index: usize| {
        chain
            .steps
            .get(index)
            .and_then(|s| pack.roles.get(s.role as usize))
            .is_some_and(|role| role == HOB_ROLE)
    };
    let step = step as usize;
    on_hob(step) && !on_hob(step + 1)
}

/// Drops expired moodlets once per tick, before anything reads them.
pub(crate) fn expire(world: &mut World) {
    let now = world.resource::<SimClock>().tick;
    if let Some(mut burnt) = world.get_resource_mut::<BurntMeals>() {
        burnt.expire(now);
    }
}

pub(crate) fn hash(world: &World, hash: &mut FnvHasher) {
    if let Some(burnt) = world.get_resource::<BurntMeals>() {
        burnt.hash_into(hash);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tuning(novice: f32, master: f32) -> Tuning {
        Tuning {
            burn_chance_novice: novice,
            burn_chance_master: master,
            ..crate::test_content::tuning()
        }
    }

    /// The shipped pair: 0.12 with no practice, one in five hundred at the
    /// top, and a straight line between that never leaves that range.
    #[test]
    fn burn_chance_runs_from_the_novice_to_the_master_chance() {
        let shipped = terri_data::pack().tuning;
        assert_eq!(shipped.burn_chance_novice, 0.12);
        assert_eq!(shipped.burn_chance_master, 0.002);
        assert_eq!(burn_chance(&shipped, 0.0), 0.12);
        assert!((burn_chance(&shipped, 1.0) - 0.002).abs() < 1e-7);
        assert!((burn_chance(&shipped, 0.5) - 0.061).abs() < 1e-6);
        let mut last = burn_chance(&shipped, 0.0);
        for step in 1..=20 {
            let next = burn_chance(&shipped, step as f32 / 20.0);
            assert!(next < last, "mastery {step}/20: {next} is not below {last}");
            last = next;
        }
        let t = tuning(0.5, 0.25);
        assert_eq!(burn_chance(&t, -1.0), 0.5, "below the ladder is a novice");
        assert_eq!(burn_chance(&t, 2.0), 0.25, "above the top is a master");
        assert_eq!(burn_chance(&t, f32::NAN), 0.5, "not a number is a novice");
    }

    #[test]
    fn one_entry_per_person_and_a_new_burn_restarts_the_moodlet() {
        let mut burnt = BurntMeals::default();
        burnt.record(SimId(3), 100);
        burnt.record(SimId(1), 50);
        burnt.record(SimId(3), 120);
        assert_eq!(burnt.entries(), &[(SimId(1), 50), (SimId(3), 120)]);
        assert!(burnt.active(SimId(3), 119));
        assert!(!burnt.active(SimId(3), 120), "the end tick is already over");
        assert!(!burnt.active(SimId(2), 0));
        burnt.expire(50);
        assert_eq!(burnt.entries(), &[(SimId(3), 120)]);
        let rebuilt = BurntMeals::from_entries(vec![(SimId(7), 9), (SimId(2), 4), (SimId(7), 1)]);
        assert_eq!(rebuilt.entries(), &[(SimId(2), 4), (SimId(7), 9)]);
    }

    /// The digest sees the list only when it holds something, and sees
    /// every field of every entry.
    #[test]
    fn hash_observes_entries_and_ignores_an_empty_list() {
        let digest = |burnt: &BurntMeals| {
            let mut hash = FnvHasher::default();
            burnt.hash_into(&mut hash);
            hash.finish()
        };
        let empty = digest(&BurntMeals::default());
        assert_eq!(empty, FnvHasher::default().finish());
        let mut one = BurntMeals::default();
        one.record(SimId(1), 10);
        let base = digest(&one);
        assert_ne!(base, empty);
        let mut later = one.clone();
        later.record(SimId(1), 11);
        assert_ne!(digest(&later), base, "the end tick is hashed");
        let mut other = BurntMeals::default();
        other.record(SimId(2), 10);
        assert_ne!(digest(&other), base, "the person is hashed");
    }

    #[test]
    fn the_last_hob_step_is_the_hob_step_with_no_hob_step_after_it() {
        let pack = terri_data::pack();
        let chain = pack
            .chains
            .iter()
            .find(|c| c.id == "cook_dinner")
            .expect("shipped dinner");
        let labels: Vec<_> = chain.steps.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "Get ingredients",
                "Prepare food",
                "Cook",
                "Simmer and stir",
                "Plate meal",
                "Eat meal"
            ]
        );
        let last: Vec<bool> = (0..chain.steps.len() as u32)
            .map(|step| last_hob_step(pack, chain, step))
            .collect();
        assert_eq!(last, [false, false, false, true, false, false]);
        let snack = pack
            .chains
            .iter()
            .find(|c| c.id == "prepare_snack")
            .expect("shipped snack");
        assert!((0..snack.steps.len() as u32).all(|step| !last_hob_step(pack, snack, step)));
    }
}
