//! Burnt meals - issue 243. A recipe's last hob step can ruin the food:
//! the cook throws it away, starts the recipe again from the fridge, and
//! carries a Burnt dinner moodlet for a while. Cooking mastery lowers the
//! chance, down to one meal in five hundred at the top of the ladder.
use bevy_ecs::prelude::*;
use terri_core::{FnvHasher, SimClock};
use terri_data::{CompiledChain, ContentPack, Tuning};

use crate::moodlet_timers::MoodletTimers;

/// The activity tag whose skill decides how often the food burns.
pub const COOKING_TAG: &str = "cooking";
/// The station role the food leaves when the roll happens.
pub const HOB_ROLE: &str = "hob";

/// Who burnt a meal and the tick their Burnt dinner moodlet ends. Saved in
/// schema eleven; in the world hash whenever it holds anything.
#[derive(Resource, Default, Clone, Debug, PartialEq, Eq)]
pub struct BurntMeals(pub MoodletTimers);

impl std::ops::Deref for BurntMeals {
    type Target = MoodletTimers;
    fn deref(&self) -> &MoodletTimers {
        &self.0
    }
}
impl std::ops::DerefMut for BurntMeals {
    fn deref_mut(&mut self) -> &mut MoodletTimers {
        &mut self.0
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
        burnt.hash_into(hash, b"burnt-meals-v1");
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
