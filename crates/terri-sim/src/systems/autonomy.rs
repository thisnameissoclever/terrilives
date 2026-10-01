//! Shared autonomous scoring and sampling, including the trace's probability report.
use terri_core::{NeedId, Needs, Personality, SimRng};
use terri_data::{ContentPack, Tuning};

pub fn preservation_multiplier(tuning: &Tuning, instinct: u8) -> f32 {
    for pair in tuning.self_preservation_curve.windows(2) {
        if instinct == pair[0].0 {
            return pair[0].1;
        }
        if instinct == pair[1].0 {
            return pair[1].1;
        }
        if instinct < pair[1].0 {
            let along =
                f32::from(instinct.saturating_sub(pair[0].0)) / f32::from(pair[1].0 - pair[0].0);
            return pair[0].1 + (pair[1].1 - pair[0].1) * along;
        }
    }
    tuning.self_preservation_curve[5].1
}

pub fn comfort(needs: &Needs, tuning: &Tuning) -> f32 {
    let lowest = NeedId::ALL
        .iter()
        .map(|id| needs.get(*id))
        .fold(100.0, f32::min);
    ((lowest - tuning.mood_low_need_level)
        / (tuning.mood_needs_met_level - tuning.mood_low_need_level))
        .clamp(0.0, 1.0)
}

pub fn choice_parameters(needs: &Needs, tuning: &Tuning) -> (f32, f32) {
    let along = comfort(needs, tuning);
    (
        tuning.choice_temperature
            + along * (tuning.choice_comfort_temperature - tuning.choice_temperature),
        tuning.choice_exploration
            + along * (tuning.choice_comfort_exploration - tuning.choice_exploration),
    )
}

pub fn need_score(
    needs: &Needs,
    id: NeedId,
    delta: f32,
    duration: u32,
    distance: f32,
    instinct: u8,
    tuning: &Tuning,
) -> f32 {
    let mut score =
        super::advertise::score_advertisement(needs.deficit(id), delta, duration, distance);
    if needs.get(id) <= tuning.mood_low_need_level {
        score *= preservation_multiplier(tuning, instinct);
    }
    // Enjoyment remains appealing even when there is no meter deficit.
    if delta > 0.0 && matches!(id, NeedId::Fun | NeedId::Social) {
        score += comfort(needs, tuning) * tuning.leisure_appeal * delta
            / (duration as f32 + distance / super::advertise::TILES_PER_TICK + 1.0);
    }
    score
}

/// A penalty rather than an eligibility gate. Both need urgency and elapsed deprivation matter.
#[allow(clippy::too_many_arguments)]
pub fn survival_penalty(
    pack: &ContentPack,
    needs: &Needs,
    personality: &Personality,
    instinct: u8,
    advertises: &[(u8, f32)],
    duration: u32,
    distance: f32,
    asleep: bool,
    deprivation: u32,
    death_enabled: bool,
    terminal: bool,
) -> f32 {
    if !death_enabled {
        return 0.0;
    }
    let tuning = &pack.tuning;
    let time = duration as f32 * (1.0 + tuning.duration_variance)
        + distance / super::advertise::TILES_PER_TICK;
    let instinct = preservation_multiplier(tuning, instinct);
    let mut risk = 0.0;
    for id in [NeedId::Hunger, NeedId::Energy] {
        let level = needs.get(id);
        if level > tuning.mood_critical_need_level {
            continue;
        }
        let decay = pack.decay_per_tick[id.index()]
            * personality.drain[id.index()]
            * if asleep {
                tuning.asleep_decay_scale
            } else {
                1.0
            };
        let until_empty = if level == 0.0 {
            0.0
        } else if decay > 0.0 {
            level / decay
        } else {
            continue;
        };
        let remaining =
            until_empty + tuning.death_after_ticks.saturating_sub(deprivation).max(1) as f32;
        let positive_delta: f32 = advertises
            .iter()
            .filter(|(need, delta)| *need as usize == id.index() && *delta > 0.0)
            .map(|(_, delta)| *delta * personality.satisfaction[id.index()])
            .sum();
        let recovery_delay = if terminal {
            time
        } else {
            distance / super::advertise::TILES_PER_TICK
        };
        let effective_recovery =
            positive_delta > 0.0 && (terminal || positive_delta / duration.max(1) as f32 > decay);
        if effective_recovery && recovery_delay < remaining {
            continue;
        }
        let urgency = 1.0 - level / tuning.mood_critical_need_level;
        risk += tuning.survival_risk_penalty * instinct * instinct * urgency * time / remaining;
    }
    risk
}

/// Normalize utility and exploration separately. Risk also biases exploration, so
/// exploration does not turn every healthy Sim into a periodic suicide lottery.
pub fn probabilities(
    scores: &[f32],
    risks: &[f32],
    temperature: f32,
    exploration: f32,
    floor: f32,
) -> Vec<f64> {
    assert!(!scores.is_empty() && scores.len() == risks.len());
    let max = scores.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let weights: Vec<_> = scores
        .iter()
        .map(|score| (f64::from(*score - max) / f64::from(temperature)).exp())
        .collect();
    let explore: Vec<_> = risks
        .iter()
        .map(|risk| {
            (-f64::from(*risk) / f64::from(temperature))
                .exp()
                .max(f64::from(floor))
        })
        .collect();
    let total: f64 = weights.iter().sum();
    let explore_total: f64 = explore.iter().sum();
    weights
        .iter()
        .zip(explore)
        .map(|(weight, random)| {
            (1.0 - f64::from(exploration)) * weight / total
                + f64::from(exploration) * random / explore_total
        })
        .collect()
}

const DRAW_BUCKETS: u64 = 1u64 << 53;

/// Reserve at least one RNG bucket for every positive probability. This keeps
/// rare alternatives selectable even below floating-point cumulative precision.
fn sampling_buckets(probabilities: &[f64]) -> Vec<u64> {
    assert!(!probabilities.is_empty() && (probabilities.len() as u64) < DRAW_BUCKETS);
    let mut buckets: Vec<u64> = probabilities
        .iter()
        .map(|p| (p * DRAW_BUCKETS as f64).round().max(1.0) as u64)
        .collect();
    let largest = buckets
        .iter()
        .enumerate()
        .max_by_key(|(_, n)| **n)
        .unwrap()
        .0;
    let total: u64 = buckets.iter().sum();
    if total > DRAW_BUCKETS {
        buckets[largest] -= total - DRAW_BUCKETS;
    } else {
        buckets[largest] += DRAW_BUCKETS - total;
    }
    buckets
}

pub fn sample(probabilities: &[f64], rng: &mut SimRng) -> usize {
    let draw = (u64::from(rng.next_u32() >> 5) << 26) | u64::from(rng.next_u32() >> 6);
    let mut cumulative = 0;
    for (index, buckets) in sampling_buckets(probabilities).into_iter().enumerate() {
        cumulative += buckets;
        if draw < cumulative {
            return index;
        }
    }
    unreachable!("normalized sampling buckets cover every draw")
}

/// Sample a target once, then one of its interactions. An extra interaction
/// cannot multiply a target's lottery entries.
pub fn sample_grouped<K: Eq + Copy>(
    rows: &[(K, u32, f32)],
    risks: &[f32],
    temperature: f32,
    exploration: f32,
    floor: f32,
    rng: &mut SimRng,
) -> usize {
    let probabilities = grouped_probabilities(rows, risks, temperature, exploration, floor);
    // The flattened distribution is mathematically the two-stage draw, with
    // one RNG draw instead of consuming randomness for discarded targets.
    sample(&probabilities, rng)
}

pub fn grouped_probabilities<K: Eq + Copy>(
    rows: &[(K, u32, f32)],
    risks: &[f32],
    temperature: f32,
    exploration: f32,
    floor: f32,
) -> Vec<f64> {
    let mut groups: Vec<(K, Vec<usize>)> = Vec::new();
    for (at, (key, ..)) in rows.iter().enumerate() {
        if let Some((_, indices)) = groups.iter_mut().find(|(known, _)| known == key) {
            indices.push(at);
        } else {
            groups.push((*key, vec![at]));
        }
    }
    let scores: Vec<_> = groups
        .iter()
        .map(|(_, indices)| {
            indices
                .iter()
                .map(|at| rows[*at].2)
                .fold(f32::NEG_INFINITY, f32::max)
        })
        .collect();
    let hazards: Vec<_> = groups
        .iter()
        .map(|(_, indices)| {
            indices
                .iter()
                .map(|at| risks[*at])
                .fold(f32::INFINITY, f32::min)
        })
        .collect();
    let targets = probabilities(&scores, &hazards, temperature, exploration, floor);
    let mut result = vec![0.0; rows.len()];
    for ((_, indices), target) in groups.into_iter().zip(targets) {
        let scores: Vec<_> = indices.iter().map(|at| rows[*at].2).collect();
        let risks: Vec<_> = indices.iter().map(|at| risks[*at]).collect();
        for (at, probability) in indices.into_iter().zip(probabilities(
            &scores,
            &risks,
            temperature,
            exploration,
            floor,
        )) {
            result[at] = target * probability;
        }
    }
    sampling_buckets(&result)
        .into_iter()
        .map(|b| b as f64 / DRAW_BUCKETS as f64)
        .collect()
}

/// Per-tick diagnostics only; no simulation choice reads this resource.
#[derive(bevy_ecs::prelude::Resource, Default)]
pub struct DecisionTelemetry(pub Vec<Decision>);
pub struct Decision {
    pub agent: u32,
    pub instinct: u8,
    pub lowest_need: f32,
    pub chosen: usize,
    /// Target index, interaction row, utility, risk penalty, probability.
    pub choices: Vec<(u32, u32, f32, f32, f64)>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preservation_reads_each_curve_anchor_and_interpolates_between_them() {
        let tuning = &terri_data::pack().tuning;
        for (at, value) in tuning.self_preservation_curve {
            assert_eq!(preservation_multiplier(tuning, at), value);
        }
        let mut changed = *tuning;
        changed.self_preservation_curve[3].1 = 1.2;
        assert_eq!(preservation_multiplier(&changed, 50), 1.2);
        assert!((preservation_multiplier(tuning, 40) - 0.875).abs() < 0.0001);
    }

    #[test]
    fn comfortable_choices_are_more_varied_without_erasing_the_best_option() {
        let tuning = &terri_data::pack().tuning;
        let mut urgent = Needs::all_at(100.0);
        urgent.set(NeedId::Hunger, 10.0);
        let met = Needs::all_at(100.0);
        let (cold, little) = choice_parameters(&urgent, tuning);
        let (warm, more) = choice_parameters(&met, tuning);
        assert_eq!(cold, tuning.choice_temperature);
        assert_eq!(more, tuning.choice_comfort_exploration);
        assert!(warm > cold && more > little);
        let scores = [0.4, 0.2, 0.0];
        let a = probabilities(
            &scores,
            &[0.0; 3],
            cold,
            little,
            tuning.choice_probability_floor,
        );
        let b = probabilities(
            &scores,
            &[0.0; 3],
            warm,
            more,
            tuning.choice_probability_floor,
        );
        assert!(a[0] > b[0] && b[0] > b[1] && b[1] > b[2]);
        assert!(b.iter().all(|p| *p > 0.0));
        let empirical_concentration = |weights: &[f64]| {
            let mut rng = SimRng::from_seed(137);
            let mut counts = [0u32; 3];
            for _ in 0..10_000 {
                counts[sample(weights, &mut rng)] += 1;
            }
            counts
                .iter()
                .map(|count| f64::from(*count).powi(2))
                .sum::<f64>()
        };
        // Lower concentration means choices are spread more evenly.
        assert!(empirical_concentration(&b) < empirical_concentration(&a));
    }

    #[test]
    fn full_fun_and_social_still_have_appeal_and_preferences_weight_it() {
        let tuning = &terri_data::pack().tuning;
        let needs = Needs::all_at(100.0);
        let liked = need_score(&needs, NeedId::Fun, 40.0, 30, 0.0, 50, tuning);
        let disliked = need_score(&needs, NeedId::Fun, 10.0, 30, 0.0, 50, tuning);
        assert!(liked > disliked && disliked > 0.0);
        assert!(need_score(&needs, NeedId::Social, 40.0, 30, 0.0, 50, tuning) > 0.0);
        assert_eq!(
            need_score(&needs, NeedId::Hunger, 40.0, 30, 0.0, 50, tuning),
            0.0
        );
    }

    #[test]
    fn comfortable_repeated_samples_prefer_entertainment_without_excluding_chores() {
        let tuning = &terri_data::pack().tuning;
        let needs = Needs::all_at(100.0);
        let scores: Vec<_> = [NeedId::Fun, NeedId::Social, NeedId::Hunger, NeedId::Hygiene]
            .iter()
            .map(|id| need_score(&needs, *id, 40.0, 30, 0.0, 50, tuning))
            .collect();
        let (temperature, exploration) = choice_parameters(&needs, tuning);
        let p = probabilities(
            &scores,
            &[0.0; 4],
            temperature,
            exploration,
            tuning.choice_probability_floor,
        );
        let mut rng = SimRng::from_seed(312);
        let mut counts = [0; 4];
        for _ in 0..10_000 {
            counts[sample(&p, &mut rng)] += 1;
        }
        assert!(counts.iter().all(|n| *n > 500));
        assert!(counts[0] + counts[1] > 6_000 && counts[0] > counts[2] && counts[1] > counts[3]);
    }

    #[test]
    fn another_interaction_does_not_add_target_lottery_entries_and_both_can_win() {
        let tuning = &terri_data::pack().tuning;
        let before = grouped_probabilities(
            &[(1, 0, 0.3), (2, 0, 0.3)],
            &[0.0; 2],
            0.06,
            0.02,
            tuning.choice_probability_floor,
        );
        let rows = [(1, 0, 0.3), (1, 1, 0.3), (2, 0, 0.3)];
        let after = grouped_probabilities(
            &rows,
            &[0.0; 3],
            0.06,
            0.02,
            tuning.choice_probability_floor,
        );
        assert_eq!(before, vec![0.5, 0.5]);
        assert_eq!(after, vec![0.25, 0.25, 0.5]);
        let mut rng = SimRng::from_seed(7);
        let mut counts = [0u32; 3];
        for _ in 0..10_000 {
            counts[sample(&after, &mut rng)] += 1;
        }
        assert!(counts.iter().all(|n| *n > 2000));
        assert!(counts[2] > counts[0] && counts[2] > counts[1]);
    }

    #[test]
    fn microscopic_alternatives_retain_an_actual_random_bucket() {
        let buckets = sampling_buckets(&[1.0, 1e-40, 1e-40]);
        assert_eq!(buckets[1..], [1, 1]);
        assert_eq!(buckets.iter().sum::<u64>(), DRAW_BUCKETS);
        assert!(buckets[0] < DRAW_BUCKETS);
    }

    #[test]
    fn underflowing_utility_keeps_a_positive_alternative_through_exploration() {
        let p = probabilities(&[1000.0, -1000.0], &[0.0; 2], 0.001, 0.05, 1e-9);
        assert!(p[1] > 0.0 && p[0] < 1.0);
        let mut rng = SimRng::from_seed(23);
        let alternate = (0..10_000).filter(|_| sample(&p, &mut rng) == 1).count();
        assert!((150..350).contains(&alternate), "{alternate}");
    }

    #[test]
    fn late_terminal_recovery_and_ineffective_recovery_remain_dangerous() {
        let pack = terri_data::pack();
        let mut needs = Needs::all_at(100.0);
        needs.set(NeedId::Hunger, 0.0);
        let personality = Personality::default();
        let adverts = [(NeedId::Hunger.index() as u8, 40.0)];
        let penalty = |duration, satisfaction, terminal| {
            let mut physical = personality.clone();
            physical.satisfaction[NeedId::Hunger.index()] = satisfaction;
            survival_penalty(
                pack,
                &needs,
                &physical,
                50,
                &adverts,
                duration,
                0.0,
                false,
                pack.tuning.death_after_ticks - 20,
                true,
                terminal,
            )
        };
        assert_eq!(penalty(30, 1.0, false), 0.0);
        let disliked = Personality::with_dispositions(
            [1.0; terri_core::NEED_COUNT],
            [1.0; terri_core::NEED_COUNT],
            vec![(terri_data::ObjectDefId(0), 0, 0.0)],
        );
        assert_eq!(
            survival_penalty(
                pack,
                &needs,
                &disliked,
                50,
                &adverts,
                30,
                0.0,
                false,
                pack.tuning.death_after_ticks - 20,
                true,
                false
            ),
            0.0
        );
        assert!(penalty(180, 1.0, true) > 0.0);
        assert!(penalty(30, 0.0, false) > 0.0);
        let p = probabilities(
            &[0.2, -penalty(180, 1.0, true)],
            &[0.0, penalty(180, 1.0, true)],
            0.06,
            0.005,
            1e-9,
        );
        assert!(p[1] > 0.0 && p[1] < 0.001);
    }

    #[test]
    fn instinct_increases_recovery_probability_but_extremes_can_neglect_survival() {
        let pack = terri_data::pack();
        let tuning = &pack.tuning;
        let mut needs = Needs::all_at(100.0);
        needs.set(NeedId::Hunger, 0.0);
        needs.set(NeedId::Energy, 35.0);
        let personality = Personality::default();
        let mut previous = 0.0;
        let mut previous_recoveries = 0;
        for instinct in [0, 5, 30, 50, 70, 100] {
            let food = need_score(&needs, NeedId::Hunger, 40.0, 30, 0.0, instinct, tuning);
            let nap = need_score(&needs, NeedId::Energy, 60.0, 180, 0.0, instinct, tuning);
            let risk = survival_penalty(
                pack,
                &needs,
                &personality,
                instinct,
                &[(NeedId::Energy.index() as u8, 60.0)],
                180,
                0.0,
                true,
                tuning.death_after_ticks - 50,
                true,
                false,
            );
            let p = probabilities(
                &[food, nap - risk],
                &[0.0, risk],
                tuning.choice_temperature,
                tuning.choice_exploration,
                tuning.choice_probability_floor,
            );
            assert!(
                p[0] >= previous && p[1] > 0.0 && p[0] < 1.0,
                "{instinct}: {p:?}"
            );
            if instinct == 5 {
                assert!(
                    p[1] > 0.01,
                    "dangerous low-instinct choice disappeared: {p:?}"
                );
            }
            if instinct >= 30 {
                assert!(
                    p[1] < 0.001,
                    "ordinary instinct neglects imminent death: {p:?}"
                );
            }
            let mut rng = SimRng::from_seed(133);
            let recoveries = (0..10_000).filter(|_| sample(&p, &mut rng) == 0).count();
            assert!(recoveries >= previous_recoveries);
            if instinct == 0 {
                assert!(recoveries < 9_000);
            }
            if instinct >= 30 {
                assert!(recoveries > 9_990);
            }
            previous_recoveries = recoveries;
            previous = p[0];
        }
        assert_eq!(
            survival_penalty(
                pack,
                &needs,
                &personality,
                50,
                &[],
                180,
                0.0,
                false,
                3500,
                false,
                false
            ),
            0.0
        );
    }
}

#[cfg(test)]
mod schedule_tests {
    use super::*;
    use terri_core::{
        Agent, CommandQueue, Eating, Path, Position, Reserved, Restless, SelfPreservation,
        SimCommand, SmartObject, Target, Wander,
    };
    fn fixture(
        critical: bool,
    ) -> (
        crate::Sim,
        bevy_ecs::prelude::Entity,
        bevy_ecs::prelude::Entity,
    ) {
        let pack = crate::test_content::pack(vec![crate::test_content::object(
            "food",
            &[(NeedId::Hunger, 40.0)],
            15,
        )]);
        let mut sim = crate::test_content::sim_with(10, 10, pack);
        let food = sim
            .world_mut()
            .spawn((
                Position { x: 2.0, y: 4.0 },
                SmartObject(terri_data::ObjectDefId(0)),
            ))
            .id();
        let agent = sim
            .world_mut()
            .spawn((
                Agent,
                Position { x: 2.0, y: 2.0 },
                Needs::with(NeedId::Hunger, if critical { 0.0 } else { 100.0 }),
                SelfPreservation(50),
                Path {
                    steps: vec![(3, 2), (4, 2), (5, 2)],
                    cursor: 0,
                },
                Wander { pause_ticks: 5 },
                Restless,
            ))
            .id();
        (sim, agent, food)
    }
    #[test]
    fn ordinary_choices_wait_for_the_whole_stroll_and_pause() {
        let (mut sim, agent, _) = fixture(false);
        let mut committed_ticks = 0;
        for _ in 0..40 {
            let committed = sim.world().get::<Path>(agent).is_some()
                || sim
                    .world()
                    .get::<Wander>(agent)
                    .is_some_and(|w| w.pause_ticks > 0);
            sim.tick();
            let decisions = &sim.world().resource::<DecisionTelemetry>().0;
            if committed {
                committed_ticks += 1;
                assert!(decisions.iter().all(|d| d.agent != agent.index_u32()));
                assert!(sim.world().get::<Target>(agent).is_none());
            } else {
                assert!(decisions.iter().any(|d| d.agent == agent.index_u32()));
                assert!(committed_ticks >= 15);
                return;
            }
        }
        panic!("the bounded stroll and pause never finished");
    }
    #[test]
    fn critical_wait_releases_the_previous_stroll_without_moving() {
        let (mut sim, agent, food) = fixture(true);
        sim.world_mut().entity_mut(food).insert(Reserved);
        sim.tick();
        assert!(
            sim.world().get_resource::<DecisionTelemetry>().is_some(),
            "autonomy must publish its actual selection probabilities"
        );
        let d = &sim.world().resource::<DecisionTelemetry>().0[0];
        assert_eq!(
            d.choices[d.chosen].1,
            u32::MAX - 1,
            "fixture must choose an urgent wait"
        );
        assert!(sim.world().get::<Path>(agent).is_none());
        assert!(sim.world().get::<Wander>(agent).is_none());
        assert_eq!(
            *sim.world().get::<Position>(agent).unwrap(),
            Position { x: 2.0, y: 2.0 }
        );
    }
    #[test]
    fn player_action_immediately_replaces_a_committed_stroll() {
        let (mut sim, agent, food) = fixture(false);
        sim.world_mut()
            .resource_mut::<CommandQueue>()
            .push(SimCommand::UseObject {
                agent: agent.index_u32(),
                object: food.index_u32(),
                interaction: 0,
            });
        sim.tick();
        assert!(sim.world().get::<Wander>(agent).is_none());
        assert!(
            sim.world()
                .get::<Target>(agent)
                .is_some_and(|t| t.object == food)
                || sim
                    .world()
                    .get::<Eating>(agent)
                    .is_some_and(|e| e.object == terri_data::ObjectDefId(0))
        );
    }
}
