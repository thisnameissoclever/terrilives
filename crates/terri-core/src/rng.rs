use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

/// A small PCG-XSH-RR 64/32, implemented here rather than taken from a
/// crate.
///
/// The whole point is stability: `rand` does not guarantee its
/// algorithms stay bit-identical across major versions, so a routine
/// bump would change every replay and every golden world hash with no
/// way to tell that from a real regression. This will not move unless
/// someone edits this file, and `a_golden_sequence_pins_the_algorithm`
/// makes that edit loud.
///
/// It is `Serialize`/`Deserialize` because a saved game is only
/// replayable if the generator's state is saved with it. Both fields
/// are state: `inc` is the stream selector and is derived from the
/// seed, so dropping it from a save silently moves the sim to a
/// different sequence. `a_resumed_rng_continues_the_same_sequence`
/// pins that.
#[derive(Resource, Debug, Clone, Serialize, Deserialize)]
pub struct SimRng {
    state: u64,
    inc: u64,
}

const PCG_MULT: u64 = 6_364_136_223_846_793_005;

impl SimRng {
    pub fn from_seed(seed: u64) -> Self {
        let mut rng = SimRng {
            state: 0,
            inc: (seed << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(PCG_MULT).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform in [0, 1). Uses 24 bits, which is f32's mantissa, so
    /// every representable value is reachable and none rounds to 1.0.
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }

    /// Uniform in [0, bound). Debiased by rejection, because the naive
    /// modulo is skewed toward low indices and that skew is exactly the
    /// kind of thing that shows up as "the sim always picks the fridge".
    ///
    /// `bound` must fit in a `u32`; every caller here is choosing among
    /// candidates, so it is a small count.
    pub fn range(&mut self, bound: usize) -> usize {
        assert!(bound > 0, "range(0) has no valid result");
        draw_below_bound(bound as u32, || self.next_u32()) as usize
    }
}

/// How many rejected draws `draw_below_bound` tolerates before it calls the
/// generator broken rather than unlucky.
///
/// A rejection needs a draw below `threshold`, which is `2^32 % bound` and
/// is therefore below `2^31` for every possible `bound`: at `bound <= 2^31`
/// the threshold is smaller than the bound and so smaller still, and above
/// that the threshold is `2^32 - bound`. One rejection is thus always less
/// likely than a coin flip, and 128 of them in a row is under 2^-128. The
/// worst case a real bound can produce is `3 << 30`, where the threshold is
/// `2^30` and a rejection runs one in four.
///
/// So the cap is not a concession on uniformity - it cannot fire on a
/// working generator, and it does not change a single draw of one. It is
/// there for the other direction: a generator that cannot produce a
/// qualifying draw at all makes the loop spin forever. Per [L15] a hang is a
/// far weaker signal than a failure, because it burns a CI job timeout
/// instead of printing an assertion, and the mutation gate compares
/// `missed.txt`, so a hang is invisible to it. `roll_wander_path` bounds its
/// re-roll loop for exactly this reason; this is the same argument applied
/// to the loop one layer down.
const MAX_REJECTED_DRAWS: u32 = 128;

/// The rejection loop behind [`SimRng::range`].
///
/// Split out of `range`, and taking its draws through a closure rather than
/// from `&mut SimRng`, for one reason: the cap can only be reached by a
/// generator that is broken, so no state of `SimRng` can reach it, and a
/// guard nothing exercises is indistinguishable from no guard. The closure
/// is what lets `a_frozen_generator_panics_instead_of_spinning_forever`
/// supply a draw source a real generator cannot be.
fn draw_below_bound(bound: u32, mut draw: impl FnMut() -> u32) -> u32 {
    let threshold = bound.wrapping_neg() % bound;
    for _ in 0..MAX_REJECTED_DRAWS {
        let r = draw();
        if r >= threshold {
            return r % bound;
        }
    }
    panic!(
        "range({bound}) rejected {MAX_REJECTED_DRAWS} draws in a row, all below \
         the debias threshold {threshold}; the generator is not producing uniform \
         u32s"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_seed_produces_the_same_sequence() {
        let a: Vec<u32> = (0..16).map(|_| SimRng::from_seed(42).next_u32()).collect();
        let mut r = SimRng::from_seed(42);
        let b: Vec<u32> = (0..16).map(|_| r.next_u32()).collect();
        // The first collects from a FRESH rng each time, so it is 16
        // copies of the first draw. That is the point: it proves the
        // second list is actually advancing rather than repeating.
        assert!(
            a.iter().all(|v| *v == a[0]),
            "a fresh rng must be reproducible"
        );
        assert_ne!(b[0], b[1], "the rng must advance");
        assert_eq!(a[0], b[0], "the same seed must start the same way");
    }

    #[test]
    fn different_seeds_diverge() {
        let mut x = SimRng::from_seed(1);
        let mut y = SimRng::from_seed(2);
        let xs: Vec<u32> = (0..8).map(|_| x.next_u32()).collect();
        let ys: Vec<u32> = (0..8).map(|_| y.next_u32()).collect();
        assert_ne!(xs, ys);
    }

    #[test]
    fn a_golden_sequence_pins_the_algorithm() {
        // This is the whole reason the PRNG is in-repo. If these numbers
        // change, every replay and every golden world hash changes with
        // them. Update this ONLY alongside a deliberate decision to
        // invalidate saved games, never to make a red build green.
        let mut r = SimRng::from_seed(0xDEAD_BEEF);
        let got: Vec<u32> = (0..4).map(|_| r.next_u32()).collect();
        // These four were read off the first run of this test, which is
        // the only way a golden value can ever be established and is
        // legitimate exactly once. Any later edit is a claim that the
        // algorithm changed on purpose.
        assert_eq!(got, vec![2228698415, 333786497, 526285456, 194127073]);
    }

    #[test]
    fn next_f32_stays_in_the_unit_interval_and_is_not_constant() {
        let mut r = SimRng::from_seed(7);
        let vs: Vec<f32> = (0..1000).map(|_| r.next_f32()).collect();
        assert!(vs.iter().all(|v| (0.0..1.0).contains(v)), "out of range");
        // Rule 5: a constant 0.0 satisfies the range check alone.
        assert!(vs.iter().any(|v| *v > 0.5), "never above half");
        assert!(vs.iter().any(|v| *v < 0.5), "never below half");
    }

    #[test]
    fn range_covers_every_index_and_never_exceeds_the_bound() {
        let mut r = SimRng::from_seed(11);
        let mut seen = [false; 5];
        for _ in 0..1000 {
            let i = r.range(5);
            assert!(i < 5, "range(5) returned {i}");
            seen[i] = true;
        }
        assert!(
            seen.iter().all(|s| *s),
            "some index is unreachable: {seen:?}"
        );
    }

    #[test]
    fn range_is_uniform_at_a_bound_that_divides_badly_into_2_32() {
        // `range_covers_every_index_and_never_exceeds_the_bound` cannot
        // see the rejection loop at all. Replacing the whole loop with a
        // plain `% bound` leaves it, and every other test here, green:
        // at bound 5 the modulo bias is about one part in 10^9, which no
        // realistic sample size distinguishes from uniform. That is
        // [L34] - the assertions are right and the INPUT DOMAIN is
        // degenerate - so the fix is a different bound, not more samples.
        //
        // 3 * 2^30 is the worst case. 2^32 is one and a third bounds, so
        // under a plain modulo the bottom third of the range has two
        // preimages and the other two thirds have one: the split becomes
        // 50/25/25 instead of 33/33/33. The threshold works out to 2^30,
        // and the draws the loop rejects are exactly the ones that would
        // otherwise land in the bottom third a second time.
        //
        // This is also the honest scale of the risk. The bug the debias
        // prevents is invisible at the bounds this sim will actually use
        // and glaring here, so this test is what keeps the loop from
        // being deleted as dead weight by someone who checked.
        const BOUND: usize = 3 << 30;
        const THIRD: usize = BOUND / 3;
        const SAMPLES: usize = 10_000;

        let mut r = SimRng::from_seed(2024);
        let mut thirds = [0usize; 3];
        for _ in 0..SAMPLES {
            let v = r.range(BOUND);
            assert!(v < BOUND, "range({BOUND}) returned {v}");
            thirds[(v / THIRD).min(2)] += 1;
        }

        // Rule 5: a test over counts must assert it counted something.
        assert_eq!(
            thirds.iter().sum::<usize>(),
            SAMPLES,
            "every draw must land in a third"
        );

        // Uniform gives 1/3 each, with a standard deviation of about
        // 0.5% at this sample count. The window below is roughly seven
        // of those either side, so it is not tight enough to be flaky,
        // and the biased split of 50/25/25 misses it by a mile in all
        // three buckets. Measured: 3314/3339/3347 unmutated against
        // 5045/2459/2496 with the loop removed. A constant generator
        // puts 1.0 in one bucket and 0.0 in the others, so it misses
        // the window too.
        for (i, count) in thirds.iter().enumerate() {
            let share = *count as f64 / SAMPLES as f64;
            assert!(
                (0.30..0.37).contains(&share),
                "third {i} took {share} of the draws, not about a third: {thirds:?}"
            );
        }
    }

    #[test]
    fn the_rejection_loop_returns_in_range_on_draws_a_real_generator_produces() {
        // The companion to the panic test below, and the reason that one is
        // not the only coverage the extracted loop has: this drives
        // `draw_below_bound` on ordinary draws and pins that splitting it out
        // of `range` kept it doing its job. Without this, replacing the whole
        // helper with a constant would only be caught one layer up.
        let mut r = SimRng::from_seed(99);
        let mut seen = [false; 7];
        for _ in 0..500 {
            let v = draw_below_bound(7, || r.next_u32());
            assert!(v < 7, "draw_below_bound(7) returned {v}");
            seen[v as usize] = true;
        }
        // Rule 5: a constant 0 satisfies the bound check on its own.
        assert!(
            seen.iter().all(|s| *s),
            "some index is unreachable: {seen:?}"
        );
    }

    #[test]
    #[should_panic(expected = "draws in a row, all below the debias threshold")]
    fn a_frozen_generator_panics_instead_of_spinning_forever() {
        // Bound 5 has a threshold of 1, so a source frozen at 0 is rejected
        // on every draw and the unbounded form of this loop never returns.
        // That is precisely the `next_u32 -> 0` mutant, which reported
        // TIMEOUT rather than CAUGHT: the suite never went green, which is
        // what "caught" means, but a hang lands in `timeout.txt` while the
        // gate compares `missed.txt`, so nothing mechanical could see it. See
        // [L50], and `docs/mutation-baseline.md` for the reversal of the
        // earlier decision to leave the loop unbounded.
        //
        // `expected` is load-bearing, not decoration. `draw_below_bound`'s
        // caller also panics - `assert!(bound > 0)` - and a bare
        // `#[should_panic]` would be satisfied by either, so it would pass
        // while saying nothing about the cap. The substring omits the count
        // so that retuning the cap does not have to touch this test, and
        // still cannot match the other panic.
        let _ = draw_below_bound(5, || 0);
    }

    #[test]
    fn a_resumed_rng_continues_the_same_sequence() {
        // The derives are why a saved game is replayable at all, and
        // until this test existed nothing in the workspace consumed
        // them, so deleting `Serialize, Deserialize` while tidying
        // unused code left every test green and would have surfaced at
        // M1d as a save file that reloads into a different future.
        //
        // Deliberately NOT a round trip. Per [L33] a round trip is
        // self-consistent under any encoding; this compares the resumed
        // generator against a reference that was never serialised, so
        // it pins the causal property a save actually needs.
        //
        // Eight draws rather than one, per testing-protocol rule 7, and
        // the margin is thinner than it looks. Marking `inc` with
        // `#[serde(skip)]` was run as a mutation, and the resumed
        // generator matched the reference for the first TWO draws
        // before diverging on the third:
        //
        //   [3398805763, 2211399277, 3474744281, ...]  resumed
        //   [3398805763, 2211399277, 3248241063, ...]  reference
        //
        // Draw one agrees because a draw is a function of `state`
        // alone. Draw two agrees for a subtler reason: after one step
        // the two states differ only by `inc`, which is 2469 here, and
        // the output keeps only bits 27 and up of `(old >> 18) ^ old`,
        // where a difference in the bottom twelve bits of `old` never
        // reaches. It stays invisible until the multiply carries it
        // upward. A one-draw or two-draw test would have passed this
        // mutation.
        let mut reference = SimRng::from_seed(1234);
        for _ in 0..3 {
            reference.next_u32();
        }

        let bytes = postcard::to_allocvec(&reference).expect("serialises");
        let mut resumed: SimRng = postcard::from_bytes(&bytes).expect("deserialises");

        let expected: Vec<u32> = (0..8).map(|_| reference.next_u32()).collect();
        let actual: Vec<u32> = (0..8).map(|_| resumed.next_u32()).collect();
        assert_ne!(
            expected[0], expected[1],
            "a frozen generator would satisfy this test trivially"
        );
        assert_eq!(actual, expected, "a resumed rng diverged from its save");
    }
}
