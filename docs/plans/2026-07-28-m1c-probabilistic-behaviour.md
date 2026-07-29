# M1c Probabilistic Behaviour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sims choose probabilistically rather than by argmax, so urgency raises the odds a need is served next without making it certain, with every knob in one tunable file.

**Architecture:** A seeded in-repo PCG lives as a world resource. Candidate scores are sampled by softmax with a temperature read from `content/tuning.toml`. Interaction durations vary around their content value with a real-time floor, and a sim with nothing urgent wanders instead of freezing.

**Tech Stack:** Rust 1.94.1 (pinned), `bevy_ecs` 0.18.1, `serde`, `toml`, `postcard`.

**Design doc:** `docs/specs/2026-07-28-m1c-probabilistic-behaviour-design.md`. Read it; this plan implements it and does not restate its reasoning.

## Global Constraints

- **Every tunable value goes in `content/tuning.toml`, never a Rust `const`.** This is a standing project rule, not a preference for this milestone. If a value governs the *system* it is tuning; if it describes a specific piece of content it stays in `objects.toml`.
- **Randomness must not mean nondeterminism.** Seeded PRNG as a world resource, advanced deterministically. No wall-clock, no OS entropy. The golden hashes, replay, and the multiplayer option all rest on this.
- **No em-dashes anywhere.** Code, comments, strings, TOML, markdown, commit messages. Spaced hyphens ( - ) or semicolons only. Hard project rule.
- **`terri-core`, `terri-sim`, `terri-data` must contain zero `wasm-bindgen` and zero `web-sys`**, host and `wasm32-unknown-unknown`, verified with explicit `--target` flags ([L4]).
- **Read `docs/testing-protocol.md` before writing any test.** Mutation-test load-bearing invariants and report actual failure output.
- **Declare `pub mod foo;` in the same step that creates `foo.rs`** ([L2]). Read test counts, not exit status.
- **Never restore with `git checkout <path>`** ([L9]); snapshot on the full repo-relative path ([L22]); touch after restoring ([L8]). A non-compiling mutation is inconclusive ([L21]). **A suite whose inputs all share a property cannot detect a change that only shows on inputs lacking it** ([L34]).
- **Rebuild the WASM package before running the web suite** ([L8]).
- Rust edition 2021. CI gates on clippy `-D warnings`, `cargo fmt --check`, `npm run typecheck`, `npm test`, and the mutation baseline diff.
- Commit messages: imperative summary, why-body. **No AI or Claude attribution, no co-authored-by trailers.**
- Baseline at branch start: **144 Rust tests, 88 web tests.** Golden hash in two places.

---

### Task 1: The seeded PRNG

**Files:** Create `crates/terri-core/src/rng.rs`; modify `lib.rs`.

**Interfaces:** `struct SimRng` (a `Resource`) with `from_seed(u64)`, `next_u32()`, `next_f32()` in `[0, 1)`, `range(usize) -> usize`; `Serialize`/`Deserialize` so it can join a save file.

**Why in-repo rather than the `rand` crate:** `rand` does not guarantee its algorithms stay bit-identical across major versions. A routine dependency bump would silently change every replay and every golden hash, with no way to distinguish that from a real regression. Twenty lines of PCG that we own is stable forever.

- [ ] **Step 1: Create the file with its module declaration and failing tests**

```rust
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
        assert!(a.iter().all(|v| *v == a[0]), "a fresh rng must be reproducible");
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
        assert_eq!(got, vec![/* fill from first run, see Step 4 */]);
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
        assert!(seen.iter().all(|s| *s), "some index is unreachable: {seen:?}");
    }
}
```

- [ ] **Step 2: Run and verify the failure** - `E0433` naming `SimRng`, not `0 tests`.

- [ ] **Step 3: Implement a PCG-XSH-RR 64/32**

```rust
use bevy_ecs::prelude::Resource;
use serde::{Deserialize, Serialize};

/// A small PCG, implemented here rather than taken from a crate.
///
/// The whole point is stability: `rand` does not guarantee its
/// algorithms stay bit-identical across major versions, so a routine
/// bump would change every replay and every golden world hash with no
/// way to tell that from a real regression. This will not move unless
/// someone edits this file, and `a_golden_sequence_pins_the_algorithm`
/// makes that edit loud.
#[derive(Resource, Debug, Clone, Serialize, Deserialize)]
pub struct SimRng {
    state: u64,
    inc: u64,
}

const PCG_MULT: u64 = 6_364_136_223_846_793_005;

impl SimRng {
    pub fn from_seed(seed: u64) -> Self {
        let mut rng = SimRng { state: 0, inc: (seed << 1) | 1 };
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
    pub fn range(&mut self, bound: usize) -> usize {
        assert!(bound > 0, "range(0) has no valid result");
        let bound = bound as u32;
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let r = self.next_u32();
            if r >= threshold {
                return (r % bound) as usize;
            }
        }
    }
}
```

- [ ] **Step 4: Run, read the golden sequence off the first failure, fill it in, re-run**

Paste the four values into `a_golden_sequence_pins_the_algorithm`. **State in the report that you did this**, since a golden value read off a failure is only legitimate the first time it is established.

- [ ] **Step 5: Mutation-verify**

1. Make `next_u32` return `self.state as u32` without advancing. Expect `the_same_seed_produces_the_same_sequence` to fail on the advance assertion.
2. Replace `range`'s rejection loop with a plain `% bound`. **This will probably still pass** - the bias is small at bound 5. If so, say so: it is [L34], the input domain is too forgiving. Either strengthen with a bound that divides badly into 2^32, or record it as accepted with the reasoning.

- [ ] **Step 6: Commit**

---

### Task 2: `content/tuning.toml`

**Files:** Create `content/tuning.toml`; modify `crates/terri-data/src/schema.rs`, `compile.rs`, `pack.rs`, `build.rs`; modify `crates/terri-sim/src/systems/action.rs`.

**Interfaces:** `TuningFile` and a compiled `Tuning` on the pack, with `action_threshold`, `choice_temperature`, `idle_threshold`, `min_interaction_ticks`, `duration_variance`, `wander_pause_ticks`, `rng_seed`.

**This task establishes a standing project rule**, so the file's own comments should say so: it is the single home for every system knob, and new tunables go here rather than into a Rust `const`.

- [ ] **Step 1: Write the file**

```toml
# Every knob that governs the SYSTEM lives here. Values describing a
# specific piece of content - a fridge's hunger delta - stay in
# objects.toml. This split is deliberate and permanent: a designer
# tuning feel should have one file to open, not a hunt through Rust
# constants.
#
# Validated at build time like every other content file, so a missing or
# malformed knob fails cargo build rather than surfacing later as
# inexplicable behaviour.

# Below this score, an option is not worth doing at all.
action_threshold = 0.05

# Softmax temperature for choosing among candidates. Low approaches
# always-pick-the-best; high approaches pick-at-random.
#
# SCALE-SENSITIVE. Because urgency is cubed, scores span orders of
# magnitude, so this must be tuned against the real range rather than
# picked as a round number. Observed range on the shipped lot with one
# sim: roughly 0.001 to 1.0. Record new observations here when the
# content changes.
choice_temperature = 0.15

# Below this, nothing is urgent enough to act on and the sim wanders
# instead of standing still. Separate from action_threshold on purpose:
# one asks "is anything worth doing", this asks "is nothing worth doing
# enough that I should mill about".
idle_threshold = 0.02

# Ticks a sim pauses between wanders.
wander_pause_ticks = 20

# An interaction's content duration_ticks is a CENTRE. The real duration
# is sampled within this fraction either side, biased shorter, so
# repeated actions are not metronomic.
duration_variance = 0.4

# Hard floor on any interaction, in ticks. At 1x speed the simulation
# runs 10 ticks per second, so 25 ticks is 2.5 real seconds. Anything
# shorter reads as a sim teleporting through an action.
min_interaction_ticks = 25

# Seed for the simulation PRNG. Constant for now; it becomes part of the
# save file at M1d, which is what makes a saved game replayable.
rng_seed = 20260728
```

- [ ] **Step 2: Add schema, validation, and failing-case tests**

Rules, each needing a failing case: every field present; `choice_temperature > 0` (zero divides); `min_interaction_ticks >= 1`; `duration_variance` in `[0, 1)`; all values finite; `idle_threshold <= action_threshold` (an idle threshold above the action threshold means a sim wanders while something is worth doing, which is incoherent rather than merely odd).

- [ ] **Step 3: Delete `ACTION_THRESHOLD` and read from tuning**

It appears in ten places in `action.rs`, most of them tests. Tests should read the tuned value rather than hardcoding `0.05`, or they will silently stop testing the real threshold the first time it is tuned.

**Watch `a_score_exactly_at_the_action_threshold_selects_nothing`**: it constructs a score bit-identical to the threshold, and every term is exact in binary32. If the tuned value is not exactly representable the construction breaks. Keep `0.05` and keep the bit-equality precondition.

- [ ] **Step 4: Verify the build gate, mutation-check, commit**

Set `choice_temperature = 0`, confirm `cargo build` fails naming it, restore, paste both outputs.

---

### Task 3: Softmax selection

**Files:** Modify `crates/terri-sim/src/systems/action.rs`, `crates/terri-sim/src/lib.rs`.

**Interfaces:** `fn sample_softmax(scores: &[f32], temperature: f32, rng: &mut SimRng) -> usize`

- [ ] **Step 1: Write failing tests for the sampler as a pure function**

Test it standalone before wiring it into the system - it is the piece with real maths in it.

```rust
#[test]
fn a_much_better_option_wins_most_of_the_time_but_not_always() {
    // Both halves matter. The first distinguishes this from uniform
    // random; the second is the entire point of the milestone and is
    // what distinguishes it from argmax.
    let scores = [1.0, 0.25];
    let mut rng = SimRng::from_seed(3);
    let mut wins = [0u32; 2];
    for _ in 0..10_000 {
        wins[sample_softmax(&scores, 0.15, &mut rng)] += 1;
    }
    assert!(wins[0] > wins[1] * 3, "the better option must dominate: {wins:?}");
    assert!(wins[1] > 0, "the worse option must still happen sometimes");
}

#[test]
fn temperature_moves_the_distribution_between_argmax_and_uniform() {
    let scores = [1.0, 0.8];
    let cold = share_of_best(&scores, 0.01);
    let warm = share_of_best(&scores, 10.0);
    assert!(cold > 0.95, "low temperature must approach argmax, got {cold}");
    assert!((warm - 0.5).abs() < 0.1, "high temperature must approach uniform, got {warm}");
}

#[test]
fn a_large_score_does_not_overflow_to_nan() {
    // exp of a large score is infinity, and infinity over infinity is
    // NaN. NaN loses every comparison, so a sim would stop choosing
    // anything forever with no panic and no log. The fix is to subtract
    // the max before exponentiating, which is mathematically identity.
    let scores = [1000.0, 1.0];
    let mut rng = SimRng::from_seed(5);
    let picked = sample_softmax(&scores, 0.15, &mut rng);
    assert_eq!(picked, 0);
}

#[test]
fn a_single_candidate_is_always_chosen() {
    let mut rng = SimRng::from_seed(9);
    assert_eq!(sample_softmax(&[0.3], 0.15, &mut rng), 0);
}
```

- [ ] **Step 2: Run, verify failure, implement with the max-shift**

- [ ] **Step 3: Wire it into `select_action`, and sort the objects**

**This is the load-bearing part.** The object query iterates unsorted today, which is safe only because the score tie-break makes the argmax unique. Under weighted sampling, iteration order sets the cumulative-probability bucket boundaries, so the same draw picks differently depending on archetype layout.

Sort candidates by object entity index before sampling, exactly as agents already are.

**Write a test that fails without the sort.** Following [L5], a plain spawn puts entities in one archetype where table order already equals index order, so you must **induce archetype churn** to make the two differ. Mutation-verify by deleting the sort.

- [ ] **Step 4: Update golden vectors, full gate, mutation sweep, commit**

Both vectors move. Observe the wasm32 value rather than assuming ([L13]).

---

### Task 4: Varied interaction duration

**Files:** Modify `crates/terri-sim/src/systems/movement.rs` or wherever `Eating` is constructed, plus `interact.rs`.

- [ ] **Step 1: Failing tests**

Duration varies across repeated interactions with the same object; it is biased shorter than the content centre; it never falls below `min_interaction_ticks`; and with variance set to zero it is exactly the content value.

That last one matters: it is what proves the content value is still the centre rather than being ignored.

- [ ] **Step 2: Implement, verify, mutation-check the floor, commit**

Mutation: remove the `max(min_interaction_ticks)` clamp. Expect the floor test to fail. Note the floor is a **real-time** floor - 25 ticks is 2.5 seconds at 1x - so the test should say so rather than asserting a bare number.

---

### Task 5: Idle wandering

**Files:** Create `crates/terri-sim/src/systems/idle.rs`; modify `systems/mod.rs`, `lib.rs`.

- [ ] **Step 1: Failing tests**

A sim with all needs satisfied moves rather than standing still; it pauses between wanders rather than moving every tick; it only wanders to **reachable** tiles; and a sim with an urgent need does **not** wander.

That last one is the one that stops wandering from eating the whole behaviour.

- [ ] **Step 2: Implement**

Wandering goes through the same intent path as any other action, so a player command overrides it, and it consumes the same seeded RNG so it stays reproducible.

`find_path` returns `None` for an unreachable tile; re-roll rather than standing still, with a bounded number of attempts so a sealed room cannot spin forever.

- [ ] **Step 3: Full gate, mutation sweep, commit**

---

### Task 6: Watch it, and write down how it feels

- [ ] **Step 1: Run it and use it for several minutes**

Write to `docs/alpha-feel-notes.md`: does the sim read as having priorities or as erratic? Does the temperature feel right, or does it dither? Does wandering read as alive or as drunk? Do meals feel the right length?

**This is the deliverable.** The code is the means. Be specific, and do not flatter it.

- [ ] **Step 2: Tune `content/tuning.toml` based on what you saw**

Changing a knob and re-running is the point of having the file. Record what you changed and why.

- [ ] **Step 3: Full gate, sweep, baseline update, commit**

## Definition of done

- [ ] `content/tuning.toml` holds every knob; `ACTION_THRESHOLD` is gone as a Rust constant
- [ ] Selection is softmax-weighted with a tuned temperature
- [ ] The PRNG is in-repo, seeded, a world resource, with a golden sequence test
- [ ] **Objects are sorted before sampling**, with a test that fails without it
- [ ] **Same seed replays to the same world hash**
- [ ] **A distribution test proves both halves**: better options win more, worse options still happen
- [ ] Durations vary, biased shorter, never below the real-time floor
- [ ] A sim with nothing urgent wanders; one with an urgent need does not
- [ ] Golden vectors updated, observed on both targets
- [ ] `docs/alpha-feel-notes.md` written from actually watching it
