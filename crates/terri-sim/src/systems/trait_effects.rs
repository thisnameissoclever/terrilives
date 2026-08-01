//! What worn traits DO - [E3]'s three mechanisms at their four
//! touchpoints: a disposition weighs scoring, a capability rolls at an
//! attempt's start and learns at its end, and a condition scales the
//! satisfaction accrual while tagged completions manage it down.
//!
//! Pure helpers, called from the systems that own each touchpoint
//! (`select_action`, `follow_path`, `tick_interactions`, `tick_social`)
//! rather than systems of their own, because each effect must land at
//! an exact existing point in the tick - a disposition applied anywhere
//! but scoring is a different mechanic.

use terri_core::{SimRng, Traits};
use terri_data::{CompiledTrait, CompiledTraitKind, ContentPack};

/// The product of every worn DISPOSITION whose tag the activity
/// carries - the [S4] "one mechanism, several sources" multiplier,
/// composed at the same scoring site as habituation, the relationship
/// scale and the archetype dispositions. Absent traits multiply by 1,
/// like every absent modifier in this codebase.
pub fn disposition_multiplier(traits: Option<&Traits>, pack: &ContentPack, tags: &[String]) -> f32 {
    let Some(traits) = traits else {
        return 1.0;
    };
    let mut multiplier = 1.0;
    for (index, _) in traits.entries() {
        let def = &pack.traits[*index as usize];
        if let CompiledTraitKind::Disposition { score_multiplier } = def.kind {
            if tags.contains(&def.tag) {
                multiplier *= score_multiplier;
            }
        }
    }
    multiplier
}

/// What the satisfaction ACCRUAL is multiplied by under this sim's
/// conditions: each interpolates from 1 (severity 0, resolved) down to
/// its `accrual_scale` (severity 1, full weight), and several compose
/// multiplicatively. Applied to every payout, not only tagged ones -
/// the tag is what MANAGES a condition, not what it dims.
pub fn condition_accrual_scale(traits: Option<&Traits>, pack: &ContentPack) -> f32 {
    let Some(traits) = traits else {
        return 1.0;
    };
    let mut scale = 1.0;
    for (index, severity) in traits.entries() {
        let def = &pack.traits[*index as usize];
        if let CompiledTraitKind::Condition { accrual_scale, .. } = def.kind {
            scale *= 1.0 - severity * (1.0 - accrual_scale);
        }
    }
    scale
}

/// Rolls this attempt against every worn CAPABILITY the activity's tags
/// touch. `None` is success; `Some(scale)` is a fumble, with the failed
/// capabilities' `fail_delta_scale`s multiplied together in the rare
/// case an activity needs two skills and both miss.
///
/// One draw per matching capability, pass or fail, taken in the
/// component's sorted order - PRNG consumption is a function of world
/// state, never of the outcome, which is the same discipline
/// `sample_duration` documents for its own draw.
pub fn roll_fumble(
    traits: &Traits,
    pack: &ContentPack,
    tags: &[String],
    rng: &mut SimRng,
) -> Option<f32> {
    let mut fumbled: Option<f32> = None;
    for (index, level) in traits.entries() {
        let def = &pack.traits[*index as usize];
        if let CompiledTraitKind::Capability {
            fail_delta_scale, ..
        } = def.kind
        {
            if tags.contains(&def.tag) {
                let roll = rng.next_f32();
                if roll >= *level {
                    fumbled = Some(fumbled.unwrap_or(1.0) * fail_delta_scale);
                }
            }
        }
    }
    fumbled
}

/// A completion's trait consequences, pass or fail: every matching
/// CAPABILITY learns `learn_per_attempt` toward 1 (failure is a lesson
/// too - that is what makes "can't cook" resolvable rather than
/// permanent), and every CONDITION whose tag the activity carries has
/// its severity managed down by `manage_per_completion`.
pub fn learn_and_manage(traits: &mut Traits, pack: &ContentPack, tags: &[String]) {
    // Collected first: `set_state` borrows mutably and the entries
    // borrow does not survive it.
    let updates: Vec<(u32, f32)> = traits
        .entries()
        .iter()
        .filter_map(|(index, state)| {
            let def: &CompiledTrait = &pack.traits[*index as usize];
            if !tags.contains(&def.tag) {
                return None;
            }
            match def.kind {
                CompiledTraitKind::Capability {
                    learn_per_attempt, ..
                } => Some((*index, state + learn_per_attempt)),
                CompiledTraitKind::Condition {
                    manage_per_completion,
                    ..
                } => Some((*index, state - manage_per_completion)),
                CompiledTraitKind::Disposition { .. } => None,
            }
        })
        .collect();
    for (index, value) in updates {
        traits.set_state(index, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_data::{CompiledTrait, CompiledTraitKind};

    fn pack_with_traits(traits: Vec<CompiledTrait>) -> &'static ContentPack {
        let base = crate::test_content::pack_tuned(vec![], crate::test_content::tuning());
        Box::leak(Box::new(ContentPack {
            traits,
            ..base.clone()
        }))
    }

    fn disposition(tag: &str, multiplier: f32) -> CompiledTrait {
        CompiledTrait {
            id: format!("d_{tag}"),
            label: format!("About {tag}"),
            tag: tag.to_string(),
            kind: CompiledTraitKind::Disposition {
                score_multiplier: multiplier,
            },
        }
    }

    fn condition(tag: &str, accrual_scale: f32, manage: f32) -> CompiledTrait {
        CompiledTrait {
            id: format!("c_{tag}"),
            label: format!("Heavy about {tag}"),
            tag: tag.to_string(),
            kind: CompiledTraitKind::Condition {
                accrual_scale,
                manage_per_completion: manage,
                start_severity: 1.0,
            },
        }
    }

    fn capability(tag: &str, fail_scale: f32, learn: f32) -> CompiledTrait {
        CompiledTrait {
            id: format!("k_{tag}"),
            label: format!("Skill at {tag}"),
            tag: tag.to_string(),
            kind: CompiledTraitKind::Capability {
                start_level: 0.5,
                fail_delta_scale: fail_scale,
                learn_per_attempt: learn,
            },
        }
    }

    fn tags(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn dispositions_multiply_on_matching_tags_and_ignore_the_rest() {
        let pack = pack_with_traits(vec![
            disposition("reading", 1.5),
            disposition("cooking", 0.0),
        ]);
        let worn = Traits::from_entries(vec![(0, 0.0), (1, 0.0)]);

        // Matching tag applies; non-matching leaves 1; zero IS the fear.
        assert_eq!(
            disposition_multiplier(Some(&worn), pack, &tags(&["reading"])),
            1.5
        );
        assert_eq!(
            disposition_multiplier(Some(&worn), pack, &tags(&["television"])),
            1.0
        );
        assert_eq!(
            disposition_multiplier(Some(&worn), pack, &tags(&["cooking"])),
            0.0
        );
        // No component: neutral, the standing absent-modifier contract.
        assert_eq!(disposition_multiplier(None, pack, &tags(&["reading"])), 1.0);
        // A worn DISPOSITION whose tag the sim does not wear... the other
        // direction: wearing only trait 0 must not apply trait 1.
        let only_reader = Traits::from_entries(vec![(0, 0.0)]);
        assert_eq!(
            disposition_multiplier(Some(&only_reader), pack, &tags(&["cooking"])),
            1.0
        );
    }

    #[test]
    fn a_condition_interpolates_with_severity_and_composes() {
        let pack = pack_with_traits(vec![
            condition("correspondence", 0.4, 0.02),
            condition("television", 0.5, 0.01),
        ]);
        // Full severity: the full accrual_scale bites. Tolerances
        // because 0.4 is not exact in binary32 and the interpolation
        // arithmetic round-trips it through 1 - (1 - x).
        let full = Traits::from_entries(vec![(0, 1.0)]);
        assert!((condition_accrual_scale(Some(&full), pack) - 0.4).abs() < 1e-6);
        // Half severity: halfway back toward 1.
        let half = Traits::from_entries(vec![(0, 0.5)]);
        assert!((condition_accrual_scale(Some(&half), pack) - 0.7).abs() < 1e-6);
        // Resolved: no effect at all.
        let resolved = Traits::from_entries(vec![(0, 0.0)]);
        assert_eq!(condition_accrual_scale(Some(&resolved), pack), 1.0);
        // Two conditions compose multiplicatively: 0.4 * 0.5.
        let both = Traits::from_entries(vec![(0, 1.0), (1, 1.0)]);
        assert!((condition_accrual_scale(Some(&both), pack) - 0.2).abs() < 1e-6);
    }

    #[test]
    fn the_fumble_roll_is_level_shaped_and_consumes_rng_pass_or_fail() {
        let pack = pack_with_traits(vec![capability("cooking", 0.25, 0.05)]);
        // Level 0: every roll fails (roll >= 0 always). Level 1: none
        // can (next_f32 is in [0, 1)). The two ends are what pin the
        // comparison's direction without depending on seed behaviour.
        let hopeless = Traits::from_entries(vec![(0, 0.0)]);
        let master = Traits::from_entries(vec![(0, 1.0)]);
        let mut rng = SimRng::from_seed(7);
        assert_eq!(
            roll_fumble(&hopeless, pack, &tags(&["cooking"]), &mut rng),
            Some(0.25)
        );
        assert_eq!(
            roll_fumble(&master, pack, &tags(&["cooking"]), &mut rng),
            None
        );
        // An untagged activity draws NOTHING: two identical generators,
        // one used for an untagged roll, must stay in lockstep.
        let mut a = SimRng::from_seed(99);
        let mut b = SimRng::from_seed(99);
        assert_eq!(
            roll_fumble(&master, pack, &tags(&["reading"]), &mut a),
            None
        );
        assert_eq!(a.next_u32(), b.next_u32(), "no draw may have been taken");
    }

    // ---- End to end, through the running schedule ---------------------

    /// A hopeless cook attempts anyway, fumbles, is fed almost nothing,
    /// paid nothing - and LEARNS. The whole may-attempt-may-fail loop
    /// on one meal, with level 0 so the roll's outcome is certain and
    /// the test is about the machinery rather than a seed.
    #[test]
    fn a_fumbled_meal_starves_the_soul_but_teaches_the_hands() {
        let mut cook_act =
            crate::test_content::interaction("cook", &[(terri_core::NeedId::Hunger, 40.0)], 20);
        cook_act.tags = vec!["cooking".to_string()];
        cook_act.satisfaction = 3.0;
        let base = crate::test_content::pack_tuned(
            vec![crate::test_content::object_offering(
                "stove",
                vec![cook_act],
            )],
            terri_data::Tuning {
                duration_variance: 0.0,
                ..crate::test_content::tuning()
            },
        );
        let pack: &'static ContentPack = Box::leak(Box::new(ContentPack {
            traits: vec![CompiledTrait {
                id: "cannot_cook".to_string(),
                label: "Can't cook".to_string(),
                tag: "cooking".to_string(),
                kind: CompiledTraitKind::Capability {
                    start_level: 0.0,
                    fail_delta_scale: 0.0,
                    learn_per_attempt: 0.05,
                },
            }],
            ..base.clone()
        }));
        let mut sim = crate::test_content::sim_with(8, 8, pack);
        let stove = pack.find("stove").expect("fixture");
        sim.world_mut().spawn((
            terri_core::Position { x: 3.0, y: 1.0 },
            terri_core::SmartObject(stove),
        ));
        let mut needs = terri_core::Needs::all_at(terri_core::NEED_MAX);
        needs.set(terri_core::NeedId::Hunger, 20.0);
        let agent = sim
            .world_mut()
            .spawn((
                terri_core::Agent,
                terri_core::Position { x: 2.0, y: 1.0 },
                needs,
                terri_core::Satisfaction::default(),
                Traits::from_entries(vec![(0, 0.0)]),
            ))
            .id();

        // Ride the attempt: the fumble must exist DURING it.
        let mut saw_fumble = false;
        for _ in 0..80 {
            sim.tick();
            if sim.world().get::<terri_core::Fumbled>(agent).is_some() {
                saw_fumble = true;
            }
            let hungry_still = sim
                .world()
                .get::<terri_core::Needs>(agent)
                .unwrap()
                .get(terri_core::NeedId::Hunger);
            let done = sim.world().get::<terri_core::Eating>(agent).is_none();
            let level = sim.world().get::<Traits>(agent).unwrap().state(0).unwrap();
            if saw_fumble && done && level > 0.0 {
                assert!(
                    hungry_still < 25.0,
                    "a fail_delta_scale of 0 must deliver nothing of the                      meal; hunger read {hungry_still}"
                );
                assert_eq!(
                    sim.world()
                        .get::<terri_core::Satisfaction>(agent)
                        .unwrap()
                        .value(),
                    0.0,
                    "a ruined meal feeds nobody's soul"
                );
                assert_eq!(level, 0.05, "and yet the attempt taught");
                assert!(
                    sim.world().get::<terri_core::Fumbled>(agent).is_none(),
                    "the fumble closes with the attempt"
                );
                return;
            }
        }
        panic!("the attempt never ran its course (fumble seen: {saw_fumble})");
    }

    /// A disposition of ZERO - the authored fear - keeps a sim from
    /// ever CHOOSING the tagged activity, while an identical sim
    /// without the trait takes it immediately. The fear is a weight on
    /// choice, not a wall: nothing here gates the attempt itself.
    #[test]
    fn a_fear_keeps_a_sim_from_choosing_what_its_twin_takes_at_once() {
        let mut lounge =
            crate::test_content::interaction("lounge", &[(terri_core::NeedId::Comfort, 30.0)], 20);
        lounge.tags = vec!["lounging".to_string()];
        let base = crate::test_content::pack_tuned(
            vec![crate::test_content::object_offering("sofa", vec![lounge])],
            crate::test_content::tuning(),
        );
        let pack: &'static ContentPack = Box::leak(Box::new(ContentPack {
            traits: vec![CompiledTrait {
                id: "fears_the_sofa".to_string(),
                label: "Fears the sofa".to_string(),
                tag: "lounging".to_string(),
                kind: CompiledTraitKind::Disposition {
                    score_multiplier: 0.0,
                },
            }],
            ..base.clone()
        }));

        for (worn, expect_target) in [(true, false), (false, true)] {
            let mut sim = crate::test_content::sim_with(8, 8, pack);
            let sofa = pack.find("sofa").expect("fixture");
            sim.world_mut().spawn((
                terri_core::Position { x: 3.0, y: 1.0 },
                terri_core::SmartObject(sofa),
            ));
            let mut needs = terri_core::Needs::all_at(terri_core::NEED_MAX);
            needs.set(terri_core::NeedId::Comfort, 10.0);
            let mut spawned = sim.world_mut().spawn((
                terri_core::Agent,
                terri_core::Position { x: 2.0, y: 1.0 },
                needs,
            ));
            if worn {
                spawned.insert(Traits::from_entries(vec![(0, 0.0)]));
            }
            let agent = spawned.id();

            let mut chose = false;
            for _ in 0..30 {
                sim.tick();
                if sim.world().get::<terri_core::Target>(agent).is_some()
                    || sim.world().get::<terri_core::Eating>(agent).is_some()
                {
                    chose = true;
                    break;
                }
            }
            assert_eq!(
                chose, expect_target,
                "worn={worn}: a zero disposition must silence the only                  candidate, and its absence must leave it irresistible"
            );
        }
    }

    #[test]
    fn completion_teaches_capabilities_and_manages_conditions() {
        let pack = pack_with_traits(vec![
            capability("cooking", 0.0, 0.05),
            condition("cooking", 0.4, 0.02),
            disposition("cooking", 1.5),
        ]);
        let mut worn = Traits::from_entries(vec![(0, 0.25), (1, 0.6), (2, 0.0)]);

        learn_and_manage(&mut worn, pack, &tags(&["cooking"]));
        assert_eq!(worn.state(0), Some(0.3), "the capability learned");
        assert!(
            (worn.state(1).unwrap() - 0.58).abs() < 1e-6,
            "the condition was managed down"
        );
        assert_eq!(
            worn.state(2),
            Some(0.0),
            "dispositions have no state to move"
        );

        // An untagged completion moves nothing.
        learn_and_manage(&mut worn, pack, &tags(&["reading"]));
        assert_eq!(worn.state(0), Some(0.3));

        // And both clamps hold: learning tops out at 1, management
        // floors at 0.
        let mut extremes = Traits::from_entries(vec![(0, 0.98), (1, 0.01)]);
        learn_and_manage(&mut extremes, pack, &tags(&["cooking"]));
        assert_eq!(extremes.state(0), Some(1.0));
        assert_eq!(extremes.state(1), Some(0.0));
    }
}
