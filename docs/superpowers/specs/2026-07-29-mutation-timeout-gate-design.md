# Design: bound the PRNG rejection loop, and make the gate see a hang

**Date:** 2026-07-29
**Status:** approved, implemented in this branch

## The problem

A full `cargo mutants` sweep reports three TIMEOUT outcomes, unchanged since
M1c Task 1 and present in every sweep since:

```
crates/terri-core/src/rng.rs:41:9: replace SimRng::next_u32 -> u32 with 0
crates/terri-core/src/rng.rs:41:9: replace SimRng::next_u32 -> u32 with 1
crates/terri-core/src/rng.rs:66:18: replace >= with < in SimRng::range
```

They are pre-existing rather than caused by any recent change: they reproduce
identically against pre-duration-floor content and current content, and
serially as well as under `-j 6`.

Two defects follow. **The gate cannot see them** - the CI step compares
`mutants.out/missed.txt` against `docs/mutants-baseline.txt`, and a timeout is
neither caught nor a survivor, so a fourth one could appear unnoticed. And
**each costs the mutation job 60s**, 180s a run.

## What the diagnostic found

Each mutation was applied alone and every test in `terri-core` and `terri-sim`
was then run alone under an 8s deadline, under the [L15] harness rules. On
`1f61d1f`, over 51 + 107 tests:

| Mutant | Hangs | Tests failing an assertion |
|---|---|---|
| `next_u32 -> 0` | 7 | 14 |
| `next_u32 -> 1` | 6 | 15 |
| `>=` to `<` in `range` | 11 | 2 |

**Every hang is `SimRng::range`'s rejection loop**, the only unbounded `loop {}`
in production code. Its one production caller is `roll_wander_path`, so any
test that ticks a world with a restless sim reaches it.

**The finding that decided the design: all three mutants are already killed by
assertions.** `a_golden_sequence_pins_the_algorithm` fails outright under the
two frozen-generator mutants; `range_is_uniform_at_a_bound_that_divides_badly_into_2_32`
and `world_hash_matches_its_golden_vector` fail outright under the comparison
flip. They report TIMEOUT only because a *different* test in the same run spins
forever, so `cargo test` never exits and never reports the failures that had
already happened.

This matters because `docs/mutation-baseline.md` had recorded the opposite
reading and concluded: *"An unbounded rejection loop is inherent to debiased
sampling and is not worth capping."* That conclusion was sound given the
premise that a hang was the only detection. The premise was wrong.

## The decision

**Bound the loop, reversing that recorded judgement.** Three arguments:

1. The project already made this exact call one layer up. `roll_wander_path`
   bounds its re-roll loop and its doc comment says the bound *"is what stops
   that becoming a hang"*, citing [L15]. The rejection loop is the
   inconsistency, and it survived because a rejection loop and a re-roll loop
   do not look alike.
2. The cap is mathematically free. A rejection needs a draw below
   `threshold = 2^32 % bound`, which is below `2^31` for every possible bound,
   so one rejection is always less likely than a coin flip and 128 in a row is
   under 2^-128. The worst real case is `bound = 3 << 30`, one rejection in
   four.
3. It cannot fire on a working generator, so **no draw changes** and no golden
   world hash or replay moves. That is what makes it safe to put in the PRNG.

**It must be a real `panic!`, not `debug_assert!`.** Per [L12] and protocol
rule 8, `wasm-pack` builds release, so a debug assert would leave the shipped
target able to freeze a browser tab while `cargo mutants`, which builds debug,
reported the problem fixed.

## The change

`crates/terri-core/src/rng.rs`:

- `range` keeps its signature and delegates to a new private
  `draw_below_bound(bound: u32, draw: impl FnMut() -> u32) -> u32`, which holds
  the threshold computation, the loop, the cap and the panic.
- The closure is the point rather than an accident of refactoring. The cap can
  only fire on a broken generator, so no state of `SimRng` reaches it, and per
  protocol rule 4 an unexercised guard is indistinguishable from no guard. The
  closure is the seam a test needs.
- `MAX_REJECTED_DRAWS = 128`, sited next to the helper it governs with the
  argument above written out.

Two tests:

- `a_frozen_generator_panics_instead_of_spinning_forever` - `#[should_panic]`
  driving `draw_below_bound(5, || 0)`. Bound 5 has threshold 1, so a frozen 0
  is rejected on every draw; this is exactly the `next_u32 -> 0` mutant. The
  `expected` substring is load-bearing: `range` also panics via
  `assert!(bound > 0)`, so a bare `#[should_panic]` would be satisfied by the
  wrong panic. It omits the count so retuning the cap need not touch the test.
- `the_rejection_loop_returns_in_range_on_draws_a_real_generator_produces` -
  the companion, so the helper is not covered only by its failure path, with a
  coverage assertion per protocol rule 5.

`.github/workflows/ci.yml`: a new step failing on a non-empty
`mutants.out/timeout.txt`.

- **Zero tolerance, not a second baseline.** The set is empty and expected to
  stay so; the fix for a hang is a bound, and an allowance that can grow is an
  invitation to raise `--timeout` instead. The survivor baseline's own comment
  already warns that a list which only grows becomes a permission slip.
- **The existence check is the load-bearing half.** `[ -s missing_file ]` is
  simply false, so without it a renamed output file would make the step report
  success while checking nothing - the same vacuous-green trap the `cargo tree`
  step documents.

## Documentation

- `docs/mutation-baseline.md`: a new sweep section, and the reversal recorded
  as a block quote appended to the original sentence rather than an edit of it.
  [L30] is this file's own warning that a recorded argument expires; an expiry
  that is edited away teaches nobody.
- `docs/lessons-learned.md` [L50]: a TIMEOUT is a statement about the run, not
  about the mutant.
- `docs/testing-protocol.md` rule 2: a bullet that the gate reads `missed.txt`
  only, and that no production loop may be unbounded.
- `docs/mutants-baseline.txt`: re-anchored only if the sweep's actual
  `missed.txt` says so. `MAX_REJECTED_DRAWS` and `draw_below_bound` were sited
  below `from_seed` so the existing `rng.rs:32:30` entry does not move, but
  that is verified from sweep output rather than assumed.

## Out of scope

`content/objects.toml` and `content/tuning.toml` are untouched; this is
unrelated to the duration balance. The cap is not a tunable - its value follows
from the arithmetic above, not from balance - so it stays in `rng.rs` rather
than becoming a knob in `tuning.toml`.

## Verification

1. `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`,
   `cargo test --workspace`.
2. The diagnostic harness re-run unchanged: all three mutations must produce
   **zero hangs** while keeping their assertion failures.
3. Scoped `cargo mutants --file crates/terri-core/src/rng.rs`: the three must
   appear as CAUGHT, `timeout.txt` empty, and the cap must not introduce new
   survivors of its own.
4. Full sweep with CI's exact invocation: 0 timeouts, survivor set unchanged.
   Per [L43] rule 3 the scoped run is believed about this task's own code and
   the full run about everything else.

## Outcome

All four verification steps passed.

1. `fmt` clean, `clippy -D warnings` clean, 257 tests pass across the four
   packages, `a_golden_sequence_pins_the_algorithm` among them - so no draw
   moved.
2. Harness re-run: **zero hangs** on all three mutations, with the assertion
   failures intact and increased, 7/6/11 hanging tests before against 0/0/0
   after, and 14/15/2 failures before against 22/22/17 after.
   `RESTORE VERIFIED` both runs.
3. Scoped `rng.rs` sweep: `27 mutants: 1 missed, 25 caught, 1 unviable`, zero
   timeouts, against M1c Task 1's `25 mutants: 1 missed, 20 caught, 1 unviable,
   3 timeouts`. Caught rose by exactly the 3 former timeouts plus the 2 new
   `draw_below_bound` return mutants.
4. Full sweep: `513 mutants tested in 27m: 7 missed, 450 caught, 56 unviable`,
   **zero timeouts**. The 7 survivors are exactly the 7 committed baseline
   entries; CI's comparison run locally gives an empty new-survivor list and an
   empty now-caught list, and the new timeout step passes.

`docs/mutants-baseline.txt` needed **no change**: the siting of the new const
and helper below `from_seed` kept the `rng.rs:32:30` entry from re-anchoring,
confirmed against the sweep's `missed.txt` rather than assumed.

One thing this task did not fix, recorded because it was found on the way: the
"Latest sweep" section for M1b Task 7 claims five survivors and a `diff`-empty
baseline, while the committed file holds seven. `fe8b5d7` accepted two
`find_path_adjacent` entries after that sweep was written without re-running it.
The contract file was correct and the argument document had drifted; this task's
sweep section states the true count, but the stale section is left as it stands.
