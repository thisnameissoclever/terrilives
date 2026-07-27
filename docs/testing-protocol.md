# Testing Protocol

Standing rules for this project, derived from five separate tests that were
permanently green while protecting nothing. See [L3], [L5], [L6], and [L7] in
`lessons-learned.md` for the individual cases.

**The governing principle:**

> You cannot determine whether a test tests something by reading it. Only by
> breaking the thing and watching the test fail.

This matters because the failure family does not look like itself. Each of the
five instances presented, in the moment, as a different problem: a null query
result, a same-process comparison, a guard reading the wrong term. Written down
together they are obviously one bug. Encountered one at a time, they are not.
**A rule you have to recognise the need for is not a defence against a bug
whose defining property is being unrecognisable.** That is why the defences
below are mechanical rather than advisory.

## 1. Mutation testing is mandatory for load-bearing invariants

For any test guarding determinism, ordering, an architectural rule, or a guard
itself:

1. Delete the mechanism.
2. Confirm the test fails, and paste the actual failure output.
3. Restore it.
4. Confirm the tree is byte-identical.

Report all four. A test claiming to pin a mechanism it cannot detect is **worse
than no test**, because it also removes the suspicion that would otherwise
prompt someone to check.

## 2. `cargo mutants` runs in CI

Automated backstop for everything rule 1 depends on a human to notice. A
surviving mutant is, by definition, behaviour that nothing constrains.

- Gate on **no new** surviving mutants, not zero survivors. A wall of known
  noise gets ignored, which is the failure mode this whole document is about.
- Baseline lives in `mutants.out/` conventions or an explicit skip list; keep
  deliberate exclusions annotated with why.
- It mutates **production** code, so it finds untested production behaviour. A
  test vacuous in a way not tied to a production mutation can still slip
  through. It is a backstop, not a replacement for rule 1.
- **It does not emit statement-deletion mutants.** It rewrites expressions and
  return values, so a whole statement whose only effect is on state - `swap`,
  `clear`, `sort`, `push`, `insert` - is outside its grammar. A clean report
  over such a line is true and is simultaneously no evidence. Delete those by
  hand. See [L11], where deleting one `std::mem::swap` left all 31 tests green
  under a "0 survivors" report.

## 3. Prefer causal assertions to equality assertions

All five failures asserted a relation between two computed values, which is the
shape that is easiest to satisfy by accident.

Weak:

```rust
assert_eq!(run_a.hash(), run_b.hash());
```

Strong:

```rust
let baseline = sim.world_hash();
mutate_one_field(&mut sim);
assert_ne!(baseline, sim.world_hash(), "hash ignores this field");
restore_that_field(&mut sim);
assert_eq!(baseline, sim.world_hash(), "restoring state must restore the digest");
```

The second pins a **causal relationship**. The first pins a coincidence.

## 4. A guard is a mechanism like any other

An untested guard is indistinguishable from no guard.

A guard must **hold everything else constant** to isolate what it claims to
check. [L7] happened because a guard compared a ticked world against an
unticked one: the clock term alone made the digests differ, so the guard passed
without ever observing the entity rows it existed to verify.

## 5. Any test that can pass on empty input must assert the input was not empty

The narrow original form of rule 3, kept because it is the single most common
instance.

## 6. Name the invariant in the test name

`hash_observes_entity_state_not_only_the_clock` tells a reader which mutation
should break it. `pathfinding_is_deterministic` does not. If you cannot write a
name that implies its own mutation, the test probably does not have one.

## 7. Take enough samples to exclude the degenerate alternative

For an invariant of the form "X lags, leads, or differs from Y by exactly N",
**N + 1 observations make the relation expressible and N + 2 are needed to test
it.** At N + 1 a *frozen* or *saturated* alternative predicts the same numbers,
so the test cannot tell the two apart and is green either way.

Before writing the assertions, name the degenerate alternative out loud: *what
else would produce exactly these numbers?* Then add samples until only the
intended mechanism survives.

[L11] is the recorded instance: `prev_positions_lag_by_one_sync` synced twice,
and "prev lags by one frame" and "prev is frozen at the first frame" agree on
both of those frames. They disagree only on the third.

## 8. Validate at the boundary, and check that the check ships

An FFI export reclassifies every argument from trusted to hostile, and nothing
in the type system marks the moment it happened. Two consequences:

- Put the validation in the crate where untrusted input **enters**
  (`terri-wasm`). The sim crates keep the right to assume valid inputs; that
  assumption is what makes them testable.
- **`debug_assert!` documents an invariant, it does not enforce one.**
  `wasm-pack build` is a release build, so every `debug_assert!` reachable from
  JavaScript is absent on the only target that ships. Verify boundary tests
  with `--release`, or a debug-only panic will fail them for the wrong reason
  and hide whether the real check works. See [L12].

## Standing review question

Every code review of this project must answer, for each test that names an
invariant:

> **Which specific mutation would make this test fail?**

If the reviewer cannot name one, that is a finding, not a pass. This question
has caught five of five instances so far; it is the defence that actually
works, and it only works when asked explicitly rather than re-derived.
