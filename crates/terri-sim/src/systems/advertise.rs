/// Tiles per tick an agent walks. Used to convert distance into a time
/// cost so travel and duration are commensurable.
///
/// Public and shared on purpose: Task 6's movement system consumes this
/// same constant rather than declaring its own. If the two ever drift,
/// the scoring function's travel estimate silently becomes a lie and no
/// test fails.
pub const TILES_PER_TICK: f32 = 0.25;

/// Score ONE advertised need of one interaction, for one agent. Higher
/// wins.
///
/// The shape is: benefit scaled by how badly the need is felt, divided
/// by the total time cost of getting there and doing it.
///
/// An interaction advertises a sparse list of (need, delta) pairs, and
/// `select_action` sums this function over the list. Keeping the
/// per-need score here rather than taking the whole advert is what makes
/// the nonlinearity apply to each need separately: urgency is cubic, so
/// summing the deltas first and cubing once would let a satisfied need
/// inflate the weight given to a desperate one.
pub fn score_advertisement(deficit: f32, delta: f32, duration_ticks: u32, distance: f32) -> f32 {
    // Written as negated `>` / `>=` rather than `<=` / `<` so that NaN
    // is rejected. Every comparison against NaN is false, so `NaN <= 0.0`
    // is false and a `<=` guard would pass NaN straight through; f32
    // arithmetic then propagates it all the way to the result. NaN is
    // reachable: `Needs::set` clamps, but `f32::clamp` PROPAGATES NaN
    // rather than replacing it, so a NaN level stores successfully and
    // yields a NaN deficit. The delta comes from the content pack, whose
    // build-time validation rejects a non-finite one - but this function
    // takes a bare `f32` and cannot see that, and the deficit has no
    // such gate at all.
    //
    // The resulting failure is silent and total, which is what makes it
    // worth guarding. Selection compares scores with `>`, and NaN loses
    // every comparison, so an affected sim would simply never choose to
    // do anything, forever, with no panic and no log.
    //
    // The distance guard also rejects negatives, which would otherwise
    // shrink the denominator and inflate the score without bound.
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    if !(deficit > 0.0) || !(delta > 0.0) || !(distance >= 0.0) {
        return 0.0;
    }
    // Clamp before cubing. This parameter is a bare `f32`, so nothing at
    // this boundary constrains it to 0.0..=1.0 whatever `Needs::deficit`
    // happens to guarantee today; cubing 1.6 would inflate the score by
    // 4x with no bound. Clamping here rather than trusting callers keeps
    // the guarantee local to the function that depends on it.
    let d = deficit.clamp(0.0, 1.0);
    // Urgency is the CUBE of the deficit. Cubing is what makes agents
    // read as having priorities rather than running a checklist:
    // weighting linearly, a sim at 5% hunger (deficit 0.95) would want
    // food only about 2.4x more than one at 60% (deficit 0.40); cubing
    // turns that into about 13.4x.
    //
    // Written as explicit multiplication rather than `powf(3.0)` on
    // purpose. Repeated multiplication is IEEE-exact and therefore
    // bit-identical on every target, whereas `f32::powf` lowers to a
    // platform libm call whose last-bit result is not guaranteed to
    // agree between the MSVC CRT used by `cargo test` and the wasm32
    // build that actually runs the game. Determinism here exists to
    // support replayable bug reports and future multiplayer, both of
    // which are cross-machine, and Task 7's determinism test runs twice
    // in one process so it would never catch such a divergence.
    let urgency = d * d * d;
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
    fn deficit_weighting_is_cubic_not_merely_steep() {
        // The test above is satisfied by any exponent above roughly 1.6,
        // so a quadratic would pass it unchanged while producing visibly
        // different agent behaviour. This pins the cube: at deficits 0.95
        // and 0.40 with everything else equal the ratio is
        // (0.95 / 0.40)^3 = 13.4. A 12.0..15.0 window admits only
        // exponents in roughly (2.87, 3.13).
        let desperate = score_advertisement(0.95, 35.0, 15, 5.0);
        let comfortable = score_advertisement(0.40, 35.0, 15, 5.0);
        let ratio = desperate / comfortable;
        assert!(
            (12.0..15.0).contains(&ratio),
            "deficit weighting must be cubic, not merely steep: ratio was {ratio}"
        );
    }

    #[test]
    fn travel_cost_uses_the_declared_walk_speed() {
        // Nothing else in this file constrains TILES_PER_TICK; every
        // other test passes identically at 1.0, 0.25 or 0.01, so the
        // "travel and duration are commensurable" claim would be
        // untested. Here 5 tiles of travel must cost exactly the same as
        // 20 ticks of interaction: both denominators equal 36 only when
        // TILES_PER_TICK is exactly 0.25.
        assert_eq!(
            score_advertisement(0.5, 35.0, 35, 0.0),
            score_advertisement(0.5, 35.0, 15, 5.0)
        );
    }

    #[test]
    fn zero_deficit_scores_zero() {
        assert_eq!(score_advertisement(0.0, 35.0, 15, 1.0), 0.0);
    }

    #[test]
    fn nan_inputs_score_zero_instead_of_poisoning_the_result() {
        // A `<=` guard would let NaN through, because every comparison
        // against NaN is false. Selection compares scores with `>` and
        // NaN loses every comparison, so the sim would silently stop
        // choosing anything at all. Assert finiteness as well as
        // equality, so the test states plainly that NaN never reaches
        // the result rather than leaving that to the reader's grasp of
        // NaN comparison semantics.
        for (label, score) in [
            ("deficit", score_advertisement(f32::NAN, 35.0, 15, 5.0)),
            ("delta", score_advertisement(0.5, f32::NAN, 15, 5.0)),
            ("distance", score_advertisement(0.5, 35.0, 15, f32::NAN)),
        ] {
            assert!(score.is_finite(), "NaN {label} produced {score}");
            assert_eq!(score, 0.0, "NaN {label} must score zero");
        }
    }

    #[test]
    fn out_of_range_deficit_cannot_inflate_a_score() {
        // `deficit` is passed as a bare f32, so this function cannot rely
        // on `Needs` having produced it: any caller can hand it anything.
        // Cubing an out-of-range value would inflate the score without
        // bound, so scoring clamps its own input.
        let sane = score_advertisement(1.0, 35.0, 15, 5.0);
        assert_eq!(score_advertisement(1.6, 35.0, 15, 5.0), sane);
        assert_eq!(score_advertisement(-0.4, 35.0, 15, 5.0), 0.0);
    }

    #[test]
    fn zero_cost_interaction_stays_finite() {
        // Zero distance and zero duration make the raw time cost zero.
        // Without the +1 in the denominator this divides by zero and
        // returns infinity, which would then beat every real candidate.
        let score = score_advertisement(1.0, 35.0, 0, 0.0);
        assert!(score.is_finite(), "zero-cost interaction produced {score}");
    }

    #[test]
    fn the_time_cost_offset_is_added_rather_than_subtracted() {
        // `zero_cost_interaction_stays_finite` above cannot tell `+ 1.0`
        // from `- 1.0`: at zero time cost the subtracting version divides
        // by -1.0, which is finite, merely negated. So the test that
        // exists to protect the denominator guard passes with the guard
        // inverted. Two consequences pin the sign instead.
        //
        // First, a time cost of exactly 1.0 - one tick of interaction and
        // no travel at all - is where subtracting actually divides by
        // zero. This is reachable content, not a contrived input: a
        // one-tick object an agent is already standing on.
        let unit_cost = score_advertisement(1.0, 35.0, 1, 0.0);
        assert!(
            unit_cost.is_finite(),
            "a unit time cost must not divide by zero; got {unit_cost}"
        );
        assert_eq!(unit_cost, 17.5, "1.0^3 * 35.0 / (1.0 + 1.0)");

        // Second, a genuinely free interaction must score its full
        // benefit rather than the negation of it. A negative score loses
        // every `>` in selection, so the object would be silently
        // invisible instead of irresistible.
        assert_eq!(score_advertisement(1.0, 35.0, 0, 0.0), 35.0);
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
