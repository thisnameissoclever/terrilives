/// How steeply need deficit is weighted. A sim at 5% hunger should want
/// food enormously more than one at 60%, not 12x more. Cubing the
/// deficit produces roughly that curve.
const DEFICIT_EXPONENT: f32 = 3.0;

/// Tiles per tick an agent walks. Used to convert distance into a time
/// cost so travel and duration are commensurable.
const TILES_PER_TICK: f32 = 0.25;

/// Score one advertised interaction for one agent. Higher wins.
///
/// The shape is: benefit scaled by how badly the need is felt, divided
/// by the total time cost of getting there and doing it.
pub fn score_advertisement(deficit: f32, delta: f32, duration_ticks: u32, distance: f32) -> f32 {
    if deficit <= 0.0 || delta <= 0.0 {
        return 0.0;
    }
    // Clamp before exponentiating. Hunger's field is public, so nothing
    // structurally prevents a level outside 0..=100 and therefore a
    // deficit outside 0.0..=1.0; cubing 1.6 would inflate the score by
    // 4x with no bound. Clamping here rather than trusting callers keeps
    // the guarantee local to the function that depends on it.
    let urgency = deficit.clamp(0.0, 1.0).powf(DEFICIT_EXPONENT);
    let travel_ticks = distance / TILES_PER_TICK;
    let time_cost = travel_ticks + duration_ticks as f32;
    // The +1 keeps a zero-cost interaction from producing infinity.
    (urgency * delta) / (time_cost + 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desperate_agents_score_far_higher_than_comfortable_ones() {
        let desperate = score_advertisement(0.95, 35.0, 15, 5.0);
        let comfortable = score_advertisement(0.40, 35.0, 15, 5.0);
        assert!(
            desperate > comfortable * 4.0,
            "deficit weighting must be steeply nonlinear: {desperate} vs {comfortable}"
        );
    }

    #[test]
    fn zero_deficit_scores_zero() {
        assert_eq!(score_advertisement(0.0, 35.0, 15, 1.0), 0.0);
    }

    #[test]
    fn out_of_range_deficit_cannot_inflate_a_score() {
        // Hunger's field is public, so callers can construct values
        // outside 0..=100 and deficit() can return outside 0.0..=1.0.
        // Raising such a value to DEFICIT_EXPONENT would inflate the
        // score without bound, so scoring clamps its input.
        let sane = score_advertisement(1.0, 35.0, 15, 5.0);
        assert_eq!(score_advertisement(1.6, 35.0, 15, 5.0), sane);
        assert_eq!(score_advertisement(-0.4, 35.0, 15, 5.0), 0.0);
    }

    #[test]
    fn closer_objects_score_higher() {
        let near = score_advertisement(0.5, 35.0, 15, 1.0);
        let far = score_advertisement(0.5, 35.0, 15, 40.0);
        assert!(near > far, "{near} should beat {far}");
    }

    #[test]
    fn larger_need_delta_scores_higher() {
        let big = score_advertisement(0.5, 60.0, 15, 5.0);
        let small = score_advertisement(0.5, 10.0, 15, 5.0);
        assert!(big > small);
    }

    #[test]
    fn slower_interactions_score_lower_all_else_equal() {
        let quick = score_advertisement(0.5, 35.0, 10, 5.0);
        let slow = score_advertisement(0.5, 35.0, 120, 5.0);
        assert!(quick > slow);
    }
}
