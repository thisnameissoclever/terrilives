use serde::{Deserialize, Serialize};

/// Presentation weather, independent of household decisions and saved state.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeatherTuning {
    pub seed: u32,
    pub event_day_chance: [f32; 4],
    pub event_hours: f32,
    pub earliest_hour: f32,
    pub latest_hour: f32,
    pub leaf_ground_hours: f32,
    pub fall_minutes: f32,
}

impl WeatherTuning {
    pub(crate) fn valid(self) -> bool {
        self.event_day_chance
            .iter()
            .all(|p| p.is_finite() && (0.0..=1.0).contains(p))
            && self.event_day_chance[0] == 0.0
            && self.event_hours.is_finite()
            && self.event_hours > 0.0
            && self.earliest_hour.is_finite()
            && self.earliest_hour >= 0.0
            && self.latest_hour.is_finite()
            && self.latest_hour >= self.earliest_hour
            && self.leaf_ground_hours.is_finite()
            && self.leaf_ground_hours > 0.0
            && self.fall_minutes.is_finite()
            && self.fall_minutes > 0.0
            && self.fall_minutes / 60.0 <= self.event_hours
            && self.latest_hour
                + self.event_hours
                + self.leaf_ground_hours
                + self.fall_minutes / 60.0
                <= 24.0
    }
}
