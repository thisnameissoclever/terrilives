//! Shared tolerance curve for household mess.

/// Normalized reaction to dirt, with cleanliness setting the tolerated amount.
pub fn response(cleanliness: f32, dirt: f32) -> f32 {
    let threshold = 0.40 - 0.35 * cleanliness.clamp(0.0, 1.0);
    ((dirt - threshold) / (1.0 - threshold)).clamp(0.0, 1.0)
}

/// Six dish units reach the existing maximum ordinary mess penalty.
pub fn dish_response(cleanliness: f32, units: u32) -> f32 {
    response(cleanliness, (units as f32 / 6.0).min(1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thresholds_are_quiet_and_response_reaches_the_same_full_dirt_cap() {
        for (clean, threshold, midpoint) in
            [(0.0, 0.4, 0.7), (0.5, 0.225, 0.6125), (1.0, 0.05, 0.525)]
        {
            for dirt in [-1.0, 0.0, threshold - 0.001, threshold] {
                assert_eq!(response(clean, dirt), 0.0);
            }
            assert!(response(clean, threshold + 0.001) > 0.0);
            assert!((response(clean, midpoint) - 0.5).abs() < 0.000001);
            assert_eq!(response(clean, 1.0), 1.0);
            assert_eq!(response(clean, 2.0), 1.0);
        }
        assert_eq!(response(-1.0, 0.7), response(0.0, 0.7));
        assert_eq!(response(2.0, 0.7), response(1.0, 0.7));
    }

    #[test]
    fn dish_units_share_the_curve_and_saturate_at_six() {
        assert_eq!(dish_response(0.0, 2), 0.0);
        assert!((dish_response(0.0, 3) - 1.0 / 6.0).abs() < 0.000001);
        assert_eq!(dish_response(0.5, 1), 0.0);
        assert!((dish_response(0.5, 2) - 13.0 / 93.0).abs() < 0.000001);
        assert!((dish_response(1.0, 1) - 7.0 / 57.0).abs() < 0.000001);
        for clean in [0.0, 0.5, 1.0] {
            assert_eq!(dish_response(clean, 0), 0.0);
            assert_eq!(dish_response(clean, 6), 1.0);
            assert_eq!(dish_response(clean, u32::MAX), 1.0);
        }
    }
}
