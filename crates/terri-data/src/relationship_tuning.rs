use serde::{Deserialize, Serialize};

/// Authored relationship rates use simulated hours; the engine converts once per tick.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RelationshipTuning {
    pub proximity_per_hour: f32,
    pub shared_activity_multiplier: f32,
    pub friction_per_hour: f32,
    pub incompatible_below: f32,
    pub contact_radius: f32,
    pub privacy_respect_chance: f32,
    pub shyness_respect_strength: f32,
    pub privacy_decision_ticks: u32,
    pub privacy_critical_wait_ticks: u32,
    pub privacy_desperate_need_level: f32,
}

impl Default for RelationshipTuning {
    fn default() -> Self {
        Self {
            proximity_per_hour: 0.0,
            shared_activity_multiplier: 10.0,
            friction_per_hour: 0.0,
            incompatible_below: -0.2,
            contact_radius: 4.0,
            privacy_respect_chance: 0.0,
            shyness_respect_strength: 0.0,
            privacy_decision_ticks: 30,
            privacy_critical_wait_ticks: 10,
            privacy_desperate_need_level: 5.0,
        }
    }
}

impl RelationshipTuning {
    pub(crate) fn valid(self) -> bool {
        [self.proximity_per_hour, self.friction_per_hour]
            .iter()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
            && self.shared_activity_multiplier.is_finite()
            && (1.0..=100.0).contains(&self.shared_activity_multiplier)
            && self.incompatible_below.is_finite()
            && self.incompatible_below > -1.0
            && self.incompatible_below <= 0.0
            && self.contact_radius.is_finite()
            && self.contact_radius > 0.0
            && self.contact_radius <= 32.0
            && [self.privacy_respect_chance, self.shyness_respect_strength]
                .iter()
                .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
            && self.privacy_respect_chance + self.shyness_respect_strength <= 1.0
            && (1..=1440).contains(&self.privacy_decision_ticks)
            && (1..=1440).contains(&self.privacy_critical_wait_ticks)
            && self.privacy_desperate_need_level.is_finite()
            && (0.0..=100.0).contains(&self.privacy_desperate_need_level)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relationship_tuning_rejects_nonfinite_rates_invalid_probabilities_and_unbounded_waits() {
        assert!(RelationshipTuning::default().valid());
        for bad in [
            RelationshipTuning {
                proximity_per_hour: f32::NAN,
                ..Default::default()
            },
            RelationshipTuning {
                friction_per_hour: -0.1,
                ..Default::default()
            },
            RelationshipTuning {
                privacy_respect_chance: 0.9,
                shyness_respect_strength: 0.2,
                ..Default::default()
            },
            RelationshipTuning {
                privacy_decision_ticks: 0,
                ..Default::default()
            },
            RelationshipTuning {
                incompatible_below: -1.0,
                ..Default::default()
            },
        ] {
            assert!(!bad.valid(), "{bad:?}");
        }
    }
}
