use serde::{Deserialize, Serialize};

/// Limits and rates for need effects that depend on actual participation.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct NeedInteractionTuning {
    pub handwashing_hygiene_ceiling: f32,
    pub standing_meal_comfort_cost_per_tick: f32,
    pub shared_social_per_tick: f32,
}

impl Default for NeedInteractionTuning {
    fn default() -> Self {
        Self {
            handwashing_hygiene_ceiling: 40.,
            standing_meal_comfort_cost_per_tick: 2. / 90.,
            shared_social_per_tick: 0.12,
        }
    }
}

impl NeedInteractionTuning {
    pub(crate) fn valid(self, odor_threshold: f32) -> bool {
        self.handwashing_hygiene_ceiling.is_finite()
            && (0.0..=odor_threshold).contains(&self.handwashing_hygiene_ceiling)
            && [
                self.standing_meal_comfort_cost_per_tick,
                self.shared_social_per_tick,
            ]
            .iter()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
    }
}

#[cfg(test)]
#[test]
fn partial_washing_cannot_erase_odor_and_contextual_rates_are_bounded() {
    let valid = NeedInteractionTuning::default();
    assert!(valid.valid(40.));
    for bad in [
        NeedInteractionTuning {
            handwashing_hygiene_ceiling: 40.01,
            ..valid
        },
        NeedInteractionTuning {
            handwashing_hygiene_ceiling: f32::NAN,
            ..valid
        },
        NeedInteractionTuning {
            standing_meal_comfort_cost_per_tick: -0.1,
            ..valid
        },
        NeedInteractionTuning {
            shared_social_per_tick: f32::INFINITY,
            ..valid
        },
    ] {
        assert!(!bad.valid(40.));
    }
}
