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
- **A mutant that HANGS is invisible to the gate, and no production loop may
  be unbounded.** The gate compares `missed.txt`; a hang lands in
  `timeout.txt` and is neither caught nor a survivor, so nothing mechanical
  sees it. Worse, a hang **suppresses the assertions that did fire**: the test
  process never exits, so failures elsewhere in the same run are never
  reported, and the mutant looks detected only by the hang. [L50] is the
  recorded instance - three `SimRng` mutants each failed real assertions and
  all three reported TIMEOUT for a whole milestone. Every loop in production
  code therefore gets a bound whose overrun panics, however unreachable that
  bound is: `SimRng::draw_below_bound` and `roll_wander_path` are the two
  worked examples. CI now fails on a non-empty `timeout.txt`; the fix for one
  is a bound, never a longer `--timeout`.
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

## 9. Every milestone ends with a PLAYED visual pass

<!-- Renumbered from a second "8" on 2026-08-02: two rules shared the
number. Rule 8 is cited five times across crates/, web/ and docs/, and
every one of those means "validate at the boundary", so that rule kept
the number and this one moved. Nothing cited this one. -->

A milestone is not done when its tests are green and its trace numbers
are recorded; it is done when somebody has PLAYED the build and looked.
The M2d cycle proved the gap: every gate was green, the trace was
clean, and the first human session filed twelve findings in one
message - wrong-facing kitchen sprites, a bed drawn through a wall,
free-standing wall screens, an orphaned chair - none of which any test
or trace could see, because they are facts about pixels and reading,
not about state.

The pass, before the milestone PR:

- Play the build in a displayed browser (the pane, or over the LAN).
- Walk a fixed checklist: every object's sprite against its footprint;
  every wall run end to end; every UI element exercised; one full need
  cycle for one sim; one conversation watched end to end; every new
  mechanic SEEN doing its thing, not inferred from a counter.
- File findings in docs/alpha-feel-notes.md with the milestone's entry,
  fixed or explicitly deferred with the reason.

A finding class caught here twice becomes a candidate for automation -
the anchor rule got a render-buffer test the same day it got eyes - but
the pass itself is not automatable, which is the point: it is the one
gate that measures what a player actually receives.

## 10. A document's own ids must not come from a shared counter

Ids that identify entries in an accreting document - `[L-...]` in
`docs/lessons-learned.md`, `[A-...]` in `docs/alpha-feel-notes.md` - are
kebab-case SLUGS, never the next free integer.

A counter is an allocator, and branches that cannot see each other read
it identically. Both series collided in practice: two different `[L41]`s
on 2026-07-29, then three PRs on 2026-08-01 each appending what they
believed was `[A-17]`. Every collision costs a renumber, a sweep of the
cross-references and a fresh CI run, and none of it is about the code
under review.

- New entry: `## [L-what-it-is-about] ...`. Nothing to look up or
  reserve.
- Existing numbers never move; they are cited from ~60 files.
- `check-doc-ids.py` fails the build on a number past the closed series
  or on the same id twice. It runs in the `rust` CI job.
- Both files carry `merge=union` in `.gitattributes`, so two branches
  appending different entries merge with no conflict at all. Union keeps
  both sides of an overlapping hunk, so an edit to an OLD entry made on
  two branches at once wants a careful read of the merge rather than a
  trusted auto-resolve.

This rule is about documents. Ids that name a THING rather than an entry
- `[D-1]`, `[K5]`, `[E4]` in the design specs - are allocated inside one
document by one author and have never collided.
