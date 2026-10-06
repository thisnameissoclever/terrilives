//! Skills: practice on a ladder, learned by doing - [SK-model],
//! [SK-learning] and [SK-capability] in `docs/specs/2026-10-05-skills.md`.
//!
//! A person holds one practice number per content skill in their
//! [`Skills`] component. Everything else is derived here: the level and
//! the progress within it come from one tunable ladder, and mastery is
//! the fraction of the ladder climbed. A completed tagged attempt adds
//! the skill's `practice_per_attempt`; a worn capability trait rolls its
//! fumble against the mastery of the skill with the same tag.

use bevy_ecs::prelude::*;
use terri_core::{Agent, Skills, Traits};

use terri_data::{CompiledSkill, CompiledTrait, CompiledTraitKind, ContentPack, Tuning};

/// The practice each level costs: level 1 costs `cost`, and each level
/// after it costs `growth` times the one before.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ladder {
    pub cost: f32,
    pub growth: f32,
}

impl Ladder {
    /// The ladder the content pack's tuning describes.
    pub fn from_tuning(tuning: &Tuning) -> Self {
        Self {
            cost: tuning.skill_level_cost,
            growth: tuning.skill_level_growth,
        }
    }

    /// The practice that climbing from `level - 1` to `level` costs. There
    /// is no rung below level 1, so level 0 costs nothing.
    pub fn level_cost(&self, level: u8) -> f32 {
        if level == 0 {
            return 0.0;
        }
        self.cost * self.growth.powi(i32::from(level) - 1)
    }

    /// The total practice that reaching `level` from zero costs. Summed
    /// rung by rung in ascending order; [`standing`] accumulates the same
    /// sum in the same order, so a boundary compares bit for bit.
    pub fn cumulative(&self, level: u8) -> f32 {
        let mut total = 0.0;
        for rung in 1..=level {
            total += self.level_cost(rung);
        }
        total
    }

    /// The practice at the top of a ladder with `levels` rungs: no
    /// practice above it means anything.
    pub fn max_practice(&self, levels: u8) -> f32 {
        self.cumulative(levels)
    }
}

/// Where a practice value sits on a skill's ladder.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Standing {
    /// Levels completed, from 0 to the skill's `levels`.
    pub level: u8,
    /// The fraction of the next level's cost already practised, in
    /// `[0, 1)`; 0 at the top, where there is no next level.
    pub progress: f32,
    /// `(level + progress) / levels`, from 0 to 1.
    pub mastery: f32,
}

/// The standing `practice` reaches on a ladder with `levels` rungs.
///
/// Walks at most `levels` rungs, and `levels` is at most 100 (the content
/// compiler refuses more). Practice exactly at a level's cumulative cost
/// has reached that level; one f32 step below it has not.
pub fn standing(ladder: &Ladder, levels: u8, practice: f32) -> Standing {
    let bottom = Standing {
        level: 0,
        progress: 0.0,
        mastery: 0.0,
    };
    if levels == 0 || practice.is_nan() {
        return bottom;
    }
    let mut level = 0u8;
    let mut reached = 0.0f32;
    for rung in 1..=levels {
        let next = reached + ladder.level_cost(rung);
        if practice < next {
            break;
        }
        level = rung;
        reached = next;
    }
    if level == levels {
        return Standing {
            level,
            progress: 0.0,
            mastery: 1.0,
        };
    }
    let progress =
        ((practice - reached) / ladder.level_cost(level + 1)).clamp(0.0, just_below(1.0));
    // Rounding in the sum can carry a progress just below 1 onto the next
    // level's mastery; the mastery stays below the level it has not reached.
    let next_mastery = f32::from(level + 1) / f32::from(levels);
    let mastery = ((f32::from(level) + progress) / f32::from(levels)).min(just_below(next_mastery));
    Standing {
        level,
        progress,
        mastery,
    }
}

/// The practice whose standing has `mastery`, clamped to `[0, 1]`: the
/// inverse of [`standing`] up to f32 rounding. A NaN mastery is treated
/// as 0.
pub fn practice_for_mastery(ladder: &Ladder, levels: u8, mastery: f32) -> f32 {
    let mastery = if mastery.is_nan() {
        0.0
    } else {
        mastery.clamp(0.0, 1.0)
    };
    let x = mastery * f32::from(levels);
    let level = x.floor() as u8;
    if level >= levels {
        return ladder.max_practice(levels);
    }
    let fraction = x - f32::from(level);
    ladder.cumulative(level) + fraction * ladder.level_cost(level + 1)
}

/// The skill that keys on `tag`, with its pack index. Compile allows one
/// skill per tag, so the first match is the only one.
pub fn skill_for_tag<'a>(pack: &'a ContentPack, tag: &str) -> Option<(u32, &'a CompiledSkill)> {
    pack.skills
        .iter()
        .enumerate()
        .find(|(_, skill)| skill.tag == tag)
        .map(|(index, skill)| (index as u32, skill))
}

/// The mastery this person holds in the skill that keys on `tag`, or
/// `None` when no skill does. A person without a [`Skills`] component
/// holds no practice, the same as a person with no entry for the skill.
pub fn mastery_for_tag(skills: Option<&Skills>, pack: &ContentPack, tag: &str) -> Option<f32> {
    let (index, skill) = skill_for_tag(pack, tag)?;
    let practice = skills.map_or(0.0, |skills| skills.practice(index));
    Some(standing(&Ladder::from_tuning(&pack.tuning), skill.levels, practice).mastery)
}

/// One completed attempt's practice - [SK-learning]: every skill whose tag
/// the activity carries gains its `practice_per_attempt`, pass or fail,
/// clamped at the top of its ladder.
pub fn practise(skills: &mut Skills, pack: &ContentPack, tags: &[String]) {
    let ladder = Ladder::from_tuning(&pack.tuning);
    for (index, skill) in pack.skills.iter().enumerate() {
        if !tags.contains(&skill.tag) {
            continue;
        }
        let index = index as u32;
        let next = (skills.practice(index) + skill.practice_per_attempt)
            .min(ladder.max_practice(skill.levels));
        skills.set_practice(index, next);
    }
}

/// Raises practice so each worn capability's `start_level` is reached as
/// mastery of the skill with its tag - [SK-capability]. Never lowers
/// practice. Spawn and Edit Sims call this.
pub fn seed_from_capabilities(skills: &mut Skills, traits: &Traits, pack: &ContentPack) {
    seed_from_capability_defs(skills, traits, &pack.traits, pack);
}

/// [`seed_from_capabilities`] with the worn indices resolved against
/// `trait_defs` rather than `pack.traits`, for `spawn_member`, which is
/// handed the trait list separately. Skills and the ladder come from
/// `pack`.
pub(crate) fn seed_from_capability_defs(
    skills: &mut Skills,
    traits: &Traits,
    trait_defs: &[CompiledTrait],
    pack: &ContentPack,
) {
    seed(skills, traits, trait_defs, pack, |kind, _| match kind {
        CompiledTraitKind::Capability { start_level, .. } => Some(*start_level),
        _ => None,
    });
}

/// Raises practice so each worn capability's saved state is reached as
/// mastery - the one-time seed for a save written before skills existed
/// ([SK-save]). Never lowers practice.
pub fn seed_from_states(skills: &mut Skills, traits: &Traits, pack: &ContentPack) {
    seed(
        skills,
        traits,
        &pack.traits,
        pack,
        |kind, state| match kind {
            CompiledTraitKind::Capability { .. } => Some(state),
            _ => None,
        },
    );
}

/// The shared walk of both seeds: `level_of` names the mastery a worn
/// trait asks for, or `None` for a trait that is not a capability.
fn seed(
    skills: &mut Skills,
    traits: &Traits,
    trait_defs: &[CompiledTrait],
    pack: &ContentPack,
    level_of: impl Fn(&CompiledTraitKind, f32) -> Option<f32>,
) {
    let ladder = Ladder::from_tuning(&pack.tuning);
    for &(index, state) in traits.entries() {
        let def = &trait_defs[index as usize];
        let Some(mastery) = level_of(&def.kind, state) else {
            continue;
        };
        let Some((skill_index, skill)) = skill_for_tag(pack, &def.tag) else {
            continue;
        };
        let wanted = practice_for_mastery(&ladder, skill.levels, mastery);
        let current = skills.practice(skill_index);
        skills.set_practice(skill_index, current.max(wanted));
    }
}

/// Every person's non-zero practice as `(entity index, skill index,
/// practice)`, ascending by entity index then skill index - what
/// `Sim::world_hash` digests ([SK-save]). Skill indices are only stable
/// within one pack, so the hash writes each skill's id instead.
pub(crate) fn hash_rows(world: &World) -> Vec<(u32, u32, f32)> {
    let mut rows: Vec<(u32, u32, f32)> = world
        .try_query::<(Entity, &Agent, &Skills)>()
        .map_or_else(Vec::new, |mut query| {
            query
                .iter(world)
                .flat_map(|(entity, _, skills)| {
                    skills
                        .entries()
                        .iter()
                        .filter(|(_, practice)| *practice != 0.0)
                        .map(move |&(skill, practice)| (entity.index_u32(), skill, practice))
                })
                .collect()
        });
    rows.sort_unstable_by_key(|&(entity, skill, _)| (entity, skill));
    rows
}

/// The largest f32 below `value`, for a positive finite `value`.
fn just_below(value: f32) -> f32 {
    f32::from_bits(value.to_bits() - 1)
}

#[cfg(test)]
#[path = "skills_tests.rs"]
mod tests;
