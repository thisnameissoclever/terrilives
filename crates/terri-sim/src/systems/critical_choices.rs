//! Physical need outcomes and bounded exploration while needs are critical.
use terri_core::{NeedId, Needs, Personality, NEED_COUNT};
#[cfg(test)]
use terri_data::CompiledInteraction;
use terri_data::{AutonomyTuning, ContentPack};
mod forecast;
pub(crate) use forecast::{predict_phases, travel_ticks, Phase};

#[derive(Clone, Debug, Default)]
pub struct NeedOutcome {
    pub net_change: [f32; NEED_COUNT],
    pub first_relief_ticks: [Option<u32>; NEED_COUNT],
    pub completion_ticks: u32,
}

pub fn critical_relief_mask(needs: &Needs, outcome: &NeedOutcome, threshold: f32) -> u8 {
    NeedId::ALL.into_iter().fold(0, |mask, need| {
        if needs.get(need) <= threshold && outcome.net_change[need.index()] > 0. {
            mask | (1 << need.index())
        } else {
            mask
        }
    })
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn predict(
    pack: &ContentPack,
    needs: &Needs,
    personality: &Personality,
    effects: &[(u8, f32)],
    action: Option<&CompiledInteraction>,
    duration: u32,
    distance: f32,
    wait: u32,
    asleep: bool,
    terminal: bool,
) -> NeedOutcome {
    use crate::need_interactions::physical;
    let mut phases = vec![Phase::Decay(travel_ticks(distance).saturating_add(wait))];
    if terminal {
        phases.push(Phase::Active {
            ticks: duration,
            effects: [0.; NEED_COUNT],
            action: None,
            asleep,
        });
        phases.push(Phase::Payment(physical::terminal_effects(
            effects,
            personality,
        )));
    } else {
        phases.push(Phase::Active {
            ticks: duration,
            effects: physical::ordinary_effects(effects, personality, 1., duration),
            action,
            asleep,
        });
    }
    predict_phases(pack, needs, personality, &phases)
}

pub(crate) fn recipe_outcome(
    pack: &ContentPack,
    needs: &Needs,
    personality: &Personality,
    effects: &[(u8, f32)],
    duration: u32,
    distance: f32,
) -> NeedOutcome {
    predict_phases(
        pack,
        needs,
        personality,
        &[
            Phase::Decay(travel_ticks(distance)),
            Phase::Decay(duration),
            Phase::Payment(crate::need_interactions::physical::terminal_effects(
                effects,
                personality,
            )),
        ],
    )
}

#[allow(clippy::too_many_arguments)]
pub fn critical_choice_probabilities<K: Eq + Copy>(
    rows: &[(K, u32, f32)],
    risks: &[f32],
    outcomes: &[NeedOutcome],
    needs: &Needs,
    threshold: f32,
    policy: Option<AutonomyTuning>,
    temperature: f32,
    exploration: f32,
    floor: f32,
) -> Vec<f64> {
    let ordinary =
        || super::autonomy::grouped_probabilities(rows, risks, temperature, exploration, floor);
    let critical = NeedId::ALL
        .iter()
        .filter(|n| needs.get(**n) <= threshold)
        .count();
    let Some(policy) = policy.filter(|_| critical > 0) else {
        return ordinary();
    };
    assert_eq!(rows.len(), outcomes.len());
    let (helpful, other): (Vec<usize>, Vec<usize>) =
        (0..rows.len()).partition(|i| critical_relief_mask(needs, &outcomes[*i], threshold) != 0);
    if helpful.is_empty() || other.is_empty() {
        return ordinary();
    }
    let best = |indices: &[usize]| {
        indices
            .iter()
            .map(|i| rows[*i].2)
            .fold(f32::NEG_INFINITY, f32::max)
    };
    let risk = |indices: &[usize]| {
        indices
            .iter()
            .map(|i| risks[*i])
            .fold(f32::INFINITY, f32::min)
    };
    let weights = super::autonomy::probabilities(
        &[best(&helpful), best(&other)],
        &[risk(&helpful), risk(&other)],
        temperature,
        exploration,
        floor,
    );
    let unrelated = weights[1].min(f64::from(if critical > 1 {
        policy.unrelated_multiple
    } else {
        policy.unrelated_single
    }));
    let mut result = vec![0.; rows.len()];
    for (indices, total) in [(&helpful, 1. - unrelated), (&other, unrelated)] {
        let subset: Vec<_> = indices.iter().map(|i| rows[*i]).collect();
        let subset_risks: Vec<_> = indices.iter().map(|i| risks[*i]).collect();
        let probabilities = super::autonomy::grouped_probabilities(
            &subset,
            &subset_risks,
            temperature,
            exploration,
            floor,
        );
        for (i, p) in indices.iter().zip(probabilities) {
            result[*i] = total * p;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn review_physical_terminal_reward_arrives_after_work_has_clamped_hunger_at_zero() {
        let pack = terri_data::pack();
        let mut needs = Needs::all_at(60.);
        needs.set(NeedId::Hunger, 20.);
        let predicted = predict(
            pack,
            &needs,
            &Personality::neutral(),
            &[(0, 21.)],
            None,
            400,
            0.,
            0,
            false,
            true,
        );
        let mut executed = needs;
        for _ in 0..400 {
            executed.drain(NeedId::Hunger, pack.decay_per_tick[0]);
        }
        assert_eq!(executed.get(NeedId::Hunger), 0.);
        executed.fill(NeedId::Hunger, 21.);
        assert!((predicted.net_change[0] - (executed.get(NeedId::Hunger) - 20.)).abs() < 0.0001);
        assert_eq!(predicted.first_relief_ticks[0], Some(400));
    }
    #[test]
    fn unrelated_mass_is_bounded_without_erasing_random_choices() {
        let rows = [(0, 0, 0.01), (1, 0, 10.), (2, 0, 20.)];
        let mut needs = Needs::all_at(60.);
        needs.set(NeedId::Hunger, 10.);
        needs.set(NeedId::Social, 10.);
        let mut outcome = NeedOutcome::default();
        outcome.net_change[NeedId::Hunger.index()] = 20.;
        let outcomes = [outcome, NeedOutcome::default(), NeedOutcome::default()];
        let p = critical_choice_probabilities(
            &rows,
            &[0.; 3],
            &outcomes,
            &needs,
            20.,
            Some(AutonomyTuning::default()),
            0.06,
            0.005,
            1e-9,
        );
        assert!((p.iter().sum::<f64>() - 1.).abs() < 1e-12);
        assert!((p[0] - 0.99).abs() < 1e-8);
        assert!(p[1] > 0. && p[2] > 0. && p[1] + p[2] <= 0.010000001);
    }
    #[test]
    fn washing_at_the_cap_is_not_relief_and_food_waits_until_completion() {
        let pack = terri_data::pack();
        let a = &pack.object(pack.find("sink").unwrap()).interactions[0];
        let mut n = Needs::all_at(60.);
        n.set(NeedId::Hygiene, 40.);
        n.set(NeedId::Hunger, 10.);
        let hands = predict(
            pack,
            &n,
            &Personality::neutral(),
            &a.advertises,
            Some(a),
            a.duration_ticks,
            0.,
            0,
            false,
            false,
        );
        assert!(hands.net_change[NeedId::Hygiene.index()] <= 0.);
        assert_eq!(critical_relief_mask(&n, &hands, 20.), 0);
        let food = predict(
            pack,
            &n,
            &Personality::neutral(),
            &[(0, 40.)],
            None,
            85,
            1.,
            10,
            false,
            true,
        );
        assert_eq!(food.first_relief_ticks[0], Some(99));
        assert!(food.net_change[0] > 30. && food.net_change[0] < 40.);
        n.set(NeedId::Hygiene, 10.);
        let hands = predict(
            pack,
            &n,
            &Personality::neutral(),
            &a.advertises,
            Some(a),
            a.duration_ticks,
            0.,
            0,
            false,
            false,
        );
        assert!(hands.net_change[NeedId::Hygiene.index()] > 0.);
    }
    #[test]
    fn a_duplicate_action_does_not_multiply_a_targets_chance() {
        let mut needs = Needs::all_at(60.);
        needs.set(NeedId::Fun, 10.);
        let mut out = NeedOutcome::default();
        out.net_change[NeedId::Fun.index()] = 20.;
        let run = |rows: &[(u8, u32, f32)], o: &[NeedOutcome]| {
            critical_choice_probabilities(
                rows,
                &vec![0.; rows.len()],
                o,
                &needs,
                20.,
                Some(AutonomyTuning::default()),
                0.06,
                0.005,
                1e-9,
            )
        };
        let a = run(
            &[(0, 0, 0.1), (1, 0, 0.2)],
            &[out.clone(), NeedOutcome::default()],
        );
        let b = run(
            &[(0, 0, 0.1), (0, 1, 0.1), (1, 0, 0.2)],
            &[out.clone(), out, NeedOutcome::default()],
        );
        assert!((a[0] - b[0] - b[1]).abs() < 1e-12);
    }
    #[test]
    fn critical_boundary_and_unavailable_relief_preserve_the_ordinary_distribution() {
        let rows = [(0, 0, 0.01), (1, 0, 100.)];
        let risks = [0.; 2];
        let mut helpful = NeedOutcome::default();
        helpful.net_change[NeedId::Hunger.index()] = 1.;
        let outcomes = [helpful, NeedOutcome::default()];
        let mut needs = Needs::all_at(60.);
        let policy = Some(AutonomyTuning::default());
        let ordinary =
            super::super::autonomy::grouped_probabilities(&rows, &risks, 0.06, 0.005, 1e-9);
        let evaluate = |needs: &Needs, outcomes: &[NeedOutcome]| {
            critical_choice_probabilities(
                &rows, &risks, outcomes, needs, 20., policy, 0.06, 0.005, 1e-9,
            )
        };
        needs.set(NeedId::Hunger, f32::from_bits(20f32.to_bits() + 1));
        assert_eq!(evaluate(&needs, &outcomes), ordinary);
        needs.set(NeedId::Hunger, 20.);
        let single = evaluate(&needs, &outcomes);
        assert!(single[1] <= 0.050000001);
        assert_eq!(
            evaluate(&needs, &[NeedOutcome::default(), NeedOutcome::default()]),
            ordinary
        );
        needs.set(NeedId::Social, 20.);
        let multiple = evaluate(&needs, &outcomes);
        assert!(multiple[0] >= single[0], "Another critical need with unchanged attainable effects and utilities cannot reduce the existing remedy's chance");
        assert!(multiple[1] > 0. && multiple[1] <= 0.010000001);
    }
}
