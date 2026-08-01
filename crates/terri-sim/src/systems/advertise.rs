/// Tiles per tick an agent walks. Used to convert distance into a time
/// cost so travel and duration are commensurable.
///
/// Public and shared on purpose: Task 6's movement system consumes this
/// same constant rather than declaring its own. If the two ever drift,
/// the scoring function's travel estimate silently becomes a lie and no
/// test fails.
pub const TILES_PER_TICK: f32 = 0.25;

/// How much of an interaction's BENEFIT a sim still gets, given how
/// habituated it is to that interaction - [S2].
///
/// Runs from 1.0 for something never done to `floor` for something done to
/// death, linearly in between. `habituation` is in `0.0..=1.0` because
/// `Habituation::bump` caps it there, and `floor` is in `(0.0, 1.0]`
/// because `compile_tuning` rejects anything else.
///
/// # Why this is a function rather than one line inside `select_action`
///
/// **It was one line inside `select_action`, and nothing constrained it.**
/// The M2b mutation sweep found four survivors on it at once - `-` to `+`,
/// `*` to `/`, and two more on the inner subtraction - and hand-mutation
/// confirmed all of them survive the entire workspace suite.
///
/// The reason is worth more than the fix.
/// `habituation_scales_the_benefit_and_leaves_a_cost_at_full_strength`
/// exists precisely to pin this behaviour, and it never calls
/// `select_action`: it computes `BENEFIT * scale` **itself** and asserts a
/// relation between two values it just calculated. That is the shape
/// docs/testing-protocol.md rule 3 forbids and [L5] records three
/// instances of - a test that would stay green if the production line it
/// names were deleted.
///
/// Nothing else could catch it either. Every other habituation test reads
/// the component rather than scoring with it, and the world-hash golden
/// vector's scenario holds one object, so a scaled score has nothing to
/// out-rank and the sim's choice is the same at any multiplier ([L36]).
///
/// Pulling the arithmetic out is what makes a golden-value test possible,
/// and a golden value is what pins a multiplier: "the habituated one
/// loses" is satisfied by any scale below 1, including three of the four
/// mutants.
pub fn benefit_scale(habituation: f32, floor: f32) -> f32 {
    1.0 - habituation * (1.0 - floor)
}

/// One advertised delta, with habituation applied - benefit only.
///
/// **A cost keeps its full strength however habituated the sim is.** A
/// fourth shower in a row is less refreshing but it does not become less
/// tiring, and scaling `energy = -12` toward zero would make a habituated
/// shower CHEAPER and therefore more attractive: the mechanic running
/// backwards.
///
/// Split out alongside [`benefit_scale`] and for the same reason - the sign
/// guard was inline and unconstrained, and the sweep found three survivors
/// on it.
pub fn scaled_delta(delta: f32, scale: f32) -> f32 {
    if delta > 0.0 {
        delta * scale
    } else {
        delta
    }
}

/// How much a relationship multiplies a social interaction's BENEFIT -
/// [H8].
///
/// `1 + relationship * delta_scale`: a stranger (relationship 0) gets
/// exactly the authored delta, a best friend (1.0) gets up to double it
/// and a nemesis (-1.0) as little as none, with `delta_scale` from
/// `content/tuning.toml` setting how far either way. Both inputs arrive
/// bounded - relationships are clamped to `-1..=1` by
/// `Relationships::bump` and the scale to `[0, 1]` by `compile_tuning` -
/// so the result is in `[1 - scale, 1 + scale]` and never negative,
/// which is what keeps an authored benefit from silently becoming a
/// cost ([S2]).
///
/// A named `pub fn` rather than a line in `select_action`, per [L55]: a
/// multiplier needs a golden value and a golden value needs a callable
/// function. It is applied in scoring AND delivery, reading the same
/// relationship, so a sim seeks exactly what the conversation will give
/// it - the same one-mechanism rule satisfaction follows.
pub fn relationship_scale(relationship: f32, delta_scale: f32) -> f32 {
    1.0 + relationship * delta_scale
}

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
///
/// # A negative delta is a cost, and it is weighted the same way
///
/// Content may advertise a negative delta - a shower that drains energy -
/// and the sign is carried straight through the same cubed urgency the
/// benefit gets. That is a decision rather than a fallout of the
/// arithmetic, and the alternative it was chosen over is weighting the
/// cost by a flat constant.
///
/// `urgency` answers "how much does this agent care about this need right
/// now", and that question has the same answer whether the need is about
/// to be filled or about to be drained. An agent with full energy loses
/// almost nothing by spending some, and one about to collapse loses
/// nearly everything, so the cost has to scale with the deficit of the
/// need it drains - not with the deficit of the need being satisfied, and
/// not with nothing at all. Because the scaling is cubic, the cost stays
/// nearly free until the drained need is genuinely low and then bites
/// hard, which is exactly the "I want to be clean but I am exhausted"
/// hesitation the trade-off exists to produce.
///
/// Consequences worth knowing:
///
/// - **A score may now be negative**, where before it was in
///   `0.0..=delta`. Every consumer compares with `>` against
///   `action_threshold`, which `content/tuning.toml` authors above zero,
///   so a net-negative advert is simply never chosen - the intended
///   reading of "the costs outweigh the benefits". Tuning it below zero
///   would change that, which is a reason the knob is somewhere a
///   designer can see rather than buried in a `const`.
/// - **The clamp still binds.** `urgency` is in `0.0..=1.0`, so a cost
///   can never exceed its own delta in magnitude however large the
///   deficit argument is.
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
    // The delta clause is `is_finite` rather than a comparison, because
    // a negative delta is legal content and only a non-finite one is
    // meaningless. It rejects infinity as well as NaN, and that half is
    // load-bearing now rather than tidy: an interaction advertising
    // `+inf` on one need and `-inf` on another sums to NaN in
    // `select_action`, reintroducing the exact silent failure the NaN
    // guard exists to prevent.
    //
    // The distance guard also rejects negatives, which would otherwise
    // shrink the denominator and inflate the score without bound.
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    if !(deficit > 0.0) || !delta.is_finite() || !(distance >= 0.0) {
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

    /// **Golden values, because a multiplier needs magnitudes.**
    ///
    /// The four mutants the M2b sweep found on this line - `-` to `+`, `*`
    /// to `/`, and two on the inner subtraction - all produce a scale that
    /// is still WRONG but still less than 1 for a partly habituated sim. So
    /// a behavioural test of the obvious shape, "the habituated object
    /// loses to the fresh one", is satisfied by three of the four. Only the
    /// numbers separate them, and only at the ends of the range.
    ///
    /// Three points, and each is load-bearing:
    ///
    /// - **0 habituation gives exactly 1.0** - something never done is
    ///   worth its full advertised benefit. This is the anchor and it kills
    ///   nothing on its own: every mutant agrees here, because they all
    ///   multiply by `habituation`.
    /// - **Full habituation gives exactly the floor.** This is where all
    ///   four separate: the mutants give 1.55, -0.818, -0.45 and -1.22
    ///   against the correct 0.45. Two of them are NEGATIVE, which would
    ///   turn a benefit into a cost and make a well-used object actively
    ///   repellent.
    /// - **Half gives the midpoint**, which pins that the interpolation is
    ///   linear rather than merely monotonic between two correct ends.
    ///
    /// Exact equality rather than a tolerance: every value here is exact in
    /// binary32, and `1.0 - 1.0 * (1.0 - floor)` is `floor` exactly for any
    /// representable floor.
    #[test]
    fn benefit_scale_runs_from_one_when_fresh_to_the_floor_when_saturated() {
        const FLOOR: f32 = 0.45;
        assert_eq!(benefit_scale(0.0, FLOOR), 1.0);
        assert_eq!(benefit_scale(1.0, FLOOR), FLOOR);
        assert_eq!(benefit_scale(0.5, FLOOR), 0.725);

        // A floor of 1 disables the mechanic, which `compile_tuning` allows
        // deliberately. It must be a no-op at every habituation, not just at
        // zero - a mutant that reads the floor with the wrong sign passes the
        // three assertions above and fails here.
        for hab in [0.0, 0.25, 1.0] {
            assert_eq!(
                benefit_scale(hab, 1.0),
                1.0,
                "a floor of 1 must disable the effect at habituation {hab}"
            );
        }
    }

    /// **Habituation scales BENEFIT and never COST**, pinned on the
    /// function the simulation actually calls.
    ///
    /// `habituation_scales_the_benefit_and_leaves_a_cost_at_full_strength`
    /// in `habituation.rs` states the same rule and cannot enforce it: it
    /// computes `BENEFIT * scale` itself and compares its own arithmetic
    /// against itself, so it stays green with this whole guard deleted.
    /// Three mutants lived behind that gap. This is the version with the
    /// production function in it.
    ///
    /// The negative case is the rule; the positive case is what stops a
    /// mutant passing by scaling nothing at all.
    #[test]
    fn a_cost_keeps_its_full_strength_however_habituated_the_sim_is() {
        // A benefit IS scaled. `/` instead of `*` gives 80, `<` instead of
        // `>` leaves it at 40; the golden 20 excludes both.
        assert_eq!(scaled_delta(40.0, 0.5), 20.0);
        // A cost is NOT. `<` instead of `>` gives -6, which is a habituated
        // shower becoming cheaper and therefore more attractive - the
        // mechanic running backwards.
        assert_eq!(scaled_delta(-12.0, 0.5), -12.0);
        // And at a scale of 1 nothing moves either way, so the guard cannot
        // be passing by accident of the fixture's scale.
        assert_eq!(scaled_delta(40.0, 1.0), 40.0);
        assert_eq!(scaled_delta(-12.0, 1.0), -12.0);
    }

    /// **Golden values at both ends and the midpoint, for [L55]'s
    /// reason:** "the well-liked sim wins" is a discrete choice that
    /// throws away the magnitude, so most wrong formulas pass it. Only
    /// the numbers pin `1 + r * s` against `1 - r * s`, `r * s`, and
    /// `1 + r / s` - and every value here is exact in binary32, so the
    /// assertions are equalities rather than tolerances.
    #[test]
    fn relationship_scale_is_anchored_at_one_and_linear_to_both_ends() {
        const SCALE: f32 = 0.5;
        // A stranger gets exactly the authored delta. Every mutant that
        // multiplies agrees here; this is the anchor, not the killer.
        assert_eq!(relationship_scale(0.0, SCALE), 1.0);
        // The ends are where the formulas separate: `1 - r * s` gives
        // 0.5 for a friend, `r * s` gives 0.5, `1 + r / s` gives 3.0.
        assert_eq!(relationship_scale(1.0, SCALE), 1.5);
        assert_eq!(relationship_scale(-1.0, SCALE), 0.5);
        // The midpoint pins linearity rather than mere monotonicity.
        assert_eq!(relationship_scale(0.5, SCALE), 1.25);

        // A scale of 0 disables the mechanic at EVERY relationship, the
        // same contract as a habituation floor of 1 - and the same
        // mutant it kills: one that reads the scale with the wrong sign
        // passes the four assertions above.
        for feeling in [-1.0, -0.25, 0.0, 1.0] {
            assert_eq!(
                relationship_scale(feeling, 0.0),
                1.0,
                "a scale of 0 must disable the effect at relationship {feeling}"
            );
        }
    }

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

    /// The negative-delta decision, stated as a number.
    ///
    /// Until M1b a negative delta was rejected by content validation, and
    /// this function's guard turned one into a score of `0.0` - so a
    /// shower that costs energy would have scored as though it were free.
    /// That is the failure mode this test exists to keep out: silently
    /// ignoring the cost, rather than weighing it.
    ///
    /// The assertion is exact rather than "is negative", because
    /// negativity alone is satisfied by any number of wrong formulas -
    /// `-delta`, `-urgency`, a flat penalty. Only the exact mirror of the
    /// benefit formula produces this value.
    #[test]
    fn a_negative_delta_is_a_cost_weighted_by_the_same_cubic_urgency() {
        // 0.5^3 * 12.0 / (0.0/0.25 + 3 + 1) = 1.5 / 4 = 0.375
        assert_eq!(score_advertisement(0.5, 12.0, 3, 0.0), 0.375);
        // The cost is the same magnitude with the sign flipped, and
        // nothing else about the shape changes.
        assert_eq!(score_advertisement(0.5, -12.0, 3, 0.0), -0.375);
    }

    /// The behavioural claim the sign carries: a cost is nearly free to
    /// an agent whose drained need is full, and severe to one whose
    /// drained need is nearly empty. Cubic, so the two are far apart
    /// rather than merely ordered.
    ///
    /// Written as a ratio for the same reason
    /// `deficit_weighting_is_cubic_not_merely_steep` is: "the penalty
    /// grows with the deficit" is satisfied by a linear weighting too,
    /// and a linear penalty would make an exhausted sim shower almost as
    /// readily as a rested one. The window 12.0..15.0 admits only
    /// exponents in roughly (2.87, 3.13).
    #[test]
    fn a_cost_bites_harder_the_emptier_the_need_it_drains_already_is() {
        let exhausted = score_advertisement(0.95, -12.0, 45, 5.0);
        let rested = score_advertisement(0.40, -12.0, 45, 5.0);

        assert!(
            exhausted < rested,
            "{exhausted} must be worse than {rested}"
        );
        assert!(rested < 0.0, "a cost is a cost even to a rested agent");

        let ratio = exhausted / rested;
        assert!(
            (12.0..15.0).contains(&ratio),
            "a cost must be weighted cubically like a benefit, not linearly \
             and not flatly: ratio was {ratio}"
        );
    }

    /// What the sign is FOR, at the level `select_action` works on.
    ///
    /// `select_action` sums this function across an interaction's
    /// advertised needs, so an object whose costs exceed its benefits has
    /// to produce a net score below `action_threshold` and lose. The
    /// shipped shower is the real instance of the interesting half: it
    /// stays worth doing for a rested sim and stops being worth it for an
    /// exhausted one, on the same hygiene deficit.
    #[test]
    fn summed_costs_can_outweigh_summed_benefits() {
        // A grubby, rested agent: hygiene deficit high, energy deficit
        // low. The shower's numbers, from content/objects.toml.
        let worth_it =
            score_advertisement(0.8, 70.0, 45, 4.0) + score_advertisement(0.05, -12.0, 45, 4.0);
        // The same grubbiness, but the agent is running on empty.
        let not_worth_it =
            score_advertisement(0.8, 70.0, 45, 4.0) + score_advertisement(0.99, -12.0, 45, 4.0);

        assert!(
            worth_it > 0.0,
            "a rested agent must still want a shower; got {worth_it}"
        );
        assert!(
            not_worth_it < worth_it,
            "the same shower must appeal less to an exhausted agent: \
             {not_worth_it} vs {worth_it}"
        );

        // And a cost large enough to dominate must take the whole sum
        // negative, or "the costs outweigh the benefits" has no way to
        // express itself.
        let net =
            score_advertisement(0.2, 70.0, 45, 4.0) + score_advertisement(1.0, -60.0, 45, 4.0);
        assert!(
            net < 0.0,
            "an interaction whose costs dominate must score below zero, \
             not merely low; got {net}"
        );
    }

    /// The delta guard widened from `> 0.0` to `is_finite`, and infinity
    /// is the input where those two disagree in the dangerous direction:
    /// the old guard let `+inf` straight through to the arithmetic.
    ///
    /// It matters more now than it did, because two infinite deltas of
    /// opposite sign on one interaction sum to `NaN` in `select_action` -
    /// which is precisely the silent, permanent "the sim never chooses
    /// anything" failure the NaN guard exists for.
    #[test]
    fn an_infinite_delta_scores_zero_rather_than_beating_every_rival() {
        for delta in [f32::INFINITY, f32::NEG_INFINITY] {
            let score = score_advertisement(0.5, delta, 15, 5.0);
            assert!(score.is_finite(), "a delta of {delta} produced {score}");
            assert_eq!(score, 0.0, "a delta of {delta} must score zero");
        }
    }
}
