use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreationInstinctBand {
    pub min: u8,
    pub max: u8,
    pub weight: u8,
}

/// Creation probabilities and the total allowance for unrelated crisis choices.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AutonomyTuning {
    pub unrelated_single: f32,
    pub unrelated_multiple: f32,
    pub creation_instinct_bands: [CreationInstinctBand; 7],
}

impl Default for AutonomyTuning {
    fn default() -> Self {
        Self {
            unrelated_single: 0.05,
            unrelated_multiple: 0.01,
            creation_instinct_bands: [
                CreationInstinctBand {
                    min: 11,
                    max: 30,
                    weight: 5,
                },
                CreationInstinctBand {
                    min: 31,
                    max: 50,
                    weight: 10,
                },
                CreationInstinctBand {
                    min: 51,
                    max: 60,
                    weight: 10,
                },
                CreationInstinctBand {
                    min: 61,
                    max: 70,
                    weight: 25,
                },
                CreationInstinctBand {
                    min: 71,
                    max: 80,
                    weight: 30,
                },
                CreationInstinctBand {
                    min: 81,
                    max: 90,
                    weight: 15,
                },
                CreationInstinctBand {
                    min: 91,
                    max: 95,
                    weight: 5,
                },
            ],
        }
    }
}

impl AutonomyTuning {
    pub(crate) fn valid(self) -> bool {
        [self.unrelated_single, self.unrelated_multiple]
            .iter()
            .all(|p| p.is_finite() && *p > 0. && *p < 1.)
            && self.unrelated_multiple <= self.unrelated_single
            && self
                .creation_instinct_bands
                .iter()
                .all(|b| b.min >= 11 && b.min <= b.max && b.max <= 95 && b.weight > 0)
            && self
                .creation_instinct_bands
                .windows(2)
                .all(|w| w[0].max < w[1].min)
            && self
                .creation_instinct_bands
                .iter()
                .map(|b| u32::from(b.weight))
                .sum::<u32>()
                == 100
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_weights_ranges_and_crisis_allowances() {
        let good = AutonomyTuning::default();
        assert!(good.valid());
        let mut bad = good;
        bad.creation_instinct_bands[0].weight = 4;
        assert!(!bad.valid());
        let mut bad = good;
        bad.creation_instinct_bands[0].min = 10;
        assert!(!bad.valid());
        let mut bad = good;
        bad.creation_instinct_bands[6].max = 96;
        assert!(!bad.valid());
        let mut bad = good;
        bad.creation_instinct_bands[1].min = 30;
        assert!(!bad.valid());
        let mut bad = good;
        bad.unrelated_multiple = 0.06;
        assert!(!bad.valid());
        let mut bad = good;
        bad.unrelated_single = f32::NAN;
        assert!(!bad.valid());
    }
}
