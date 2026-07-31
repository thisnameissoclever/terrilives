# Mutation Testing Baseline

**This document is the argument. `docs/mutants-baseline.txt` is the
contract.** That file, not this one, is what CI compares against; it is the
sorted contents of `mutants.out/missed.txt` from a full sweep.

**Latest sweep: the `SimRng::range` timeout fix, 2026-07-29**, full, run to
completion on the finished tree, CI's package list and CI's exact single-job
invocation:

```
cargo mutants --package terri-core --package terri-sim \
  --package terri-data --package terri-wasm --test-workspace true --timeout 60
513 mutants tested in 27m: 7 missed, 450 caught, 56 unviable
```

**Zero timeouts - the first sweep with none since `rng.rs` entered the count at
M1c Task 1.** That line used to end "3 timeouts", and this is the whole point of
the task: `SimRng::range`'s rejection loop is now bounded, so the three mutants
that used to spin forever fail an assertion instead. **Mutation score on viable
mutants: 98.5%** (450 caught of 457 viable), and for the first time the
pessimistic and optimistic readings are the same number, because there is no
timeout column left to argue about.

**Seven missed, and they are exactly the seven in `docs/mutants-baseline.txt`.**
CI's own comparison, run locally against this output, gives an empty
new-survivor list *and* an empty now-caught list. **The baseline file is
unchanged and was not regenerated** - `rng.rs:32:30` did not re-anchor, which
was checked rather than assumed: `MAX_REJECTED_DRAWS` and `draw_below_bound`
were deliberately sited *below* `from_seed` so the line-keyed entry could not
move, and the sweep's `missed.txt` confirms it still reads `32:30`.

**The count is seven, and the section below says five. The section below is the
stale one.** `fe8b5d7` accepted two `find_path_adjacent` survivors into the
baseline after the M1b Task 7 sweep was recorded, without re-running the full
sweep, so that section's "exactly the five" claim and its `diff`-is-empty claim
both describe a file with two fewer lines than the one now committed. The
contract file was right; the argument document had drifted. This sweep is the
run that settles it.

**Fifty-two new mutants entered the sweep, and only two of them are this
task's.** The scoped run below pins this task's contribution at exactly two;
the other fifty arrived with `fe8b5d7`, which merged after M1b Task 7's sweep
and added `TileGrid::find_path_adjacent` among other code.

**Scoped run over the one file this task changed**, per [L43] rule 3 - believe
the scoped one about your own changes and the full one about everything else:

```
cargo mutants --package terri-core -f crates/terri-core/src/rng.rs \
  --test-workspace true --timeout 60
27 mutants tested in 2m: 1 missed, 25 caught, 1 unviable
```

Against M1c Task 1's scoped run over the same file - `25 mutants: 1 missed, 20
caught, 1 unviable, 3 timeouts` - the accounting is exact and worth writing out,
because it is the evidence that nothing was traded away:

- **Caught went 20 to 25.** Three of those five are the former timeouts:
  `rng.rs:41:9 next_u32 -> 0`, `rng.rs:41:9 next_u32 -> 1`, and the comparison
  flip, which now reads `rng.rs:100:14: replace >= with < in draw_below_bound`
  because the loop moved out of `range`. All three are CAUGHT.
- **The other two are new**, and are the ones the extraction created:
  `draw_below_bound -> u32 with 0` and `with 1`. Both caught.
- **Missed is still the one accepted `from_seed` entry**, unchanged, and
  unviable is still the one `Default::default()` mutant.

Every operator mutant the loop carries - the two `%` on the threshold and the
modulo, and the `>=` - moved from `range` to `draw_below_bound` and is caught
there. None of them can hang any more, which is the property the cap buys.

**What the sweep still cannot say.** The cap itself is unreachable through
`SimRng`, so no mutation of the *generator* can exercise it; that is why
`draw_below_bound` takes its draws from a closure and why
`a_frozen_generator_panics_instead_of_spinning_forever` exists. And the
before/after claim rests on evidence `cargo mutants` does not produce: each of
the three mutants was applied alone and every test in `terri-core` and
`terri-sim` run alone under an 8s deadline, before and after. Before: 7, 6 and
11 hanging tests. After: **zero**, with the failures intact - 22, 22 and 17
tests failing an assertion. See [L50].

---

**Previous sweep: M1b Task 7, the need bars and time controls, 2026-07-29**,
full, run to completion on the finished tree, CI's package list and CI's exact
single-job invocation:

```
cargo mutants --package terri-core --package terri-sim   --package terri-data --package terri-wasm --test-workspace true --timeout 60
461 mutants tested in 27m: 5 missed, 397 caught, 56 unviable, 3 timeouts
```

**Five missed, and they are exactly the five in `docs/mutants-baseline.txt`.**
`diff` on the sorted files is empty. **No new survivors.** The three timeouts
are the known `rng.rs` ones, which are detections rather than survivors. The
baseline file is unchanged and was not regenerated.

**Scoped run over every file Task 7 touched**, which is the check that answers
the gate's question about the task's own code ([L43] rule 3: believe the scoped
one about your own changes and the full one about everything else):

```
cargo mutants --package terri-data --package terri-wasm   -f crates/terri-data/src/compile.rs -f crates/terri-wasm/src/lib.rs   --test-workspace true --timeout 60
89 mutants tested in 3m: 62 caught, 27 unviable, 0 missed
```

**The mutant count rose from 456 to 461**, which is the expected reading for a
task that added three boundary exports and one tuning knob.

**What `cargo mutants` could not answer here, and what did.** The task's
load-bearing invariant is [D2] - speed multiplies step COUNT and never step
SIZE - and it lives entirely in TypeScript, which this tool does not touch. It
was pinned by hand instead, and the first attempt at that pin was itself
faulty: the step-count assertion killed the dt-mutation only because 100/3 is
inexact in binary64. See [L44] and `.superpowers/sdd/m1b-task-7-report.md`
[S2]. Fourteen hand-written mutations across `frame.ts`, `needs-panel.ts`,
`terri-wasm/src/lib.rs` and `terri-data/src/compile.rs`, each with a named
prediction: all fourteen killed, every prediction matched.

---

**Previous sweep: M1b Task 6, the WASM boundary, 2026-07-29**, full, on the
finished tree, CI's package list and CI's exact single-job invocation:

```
cargo mutants --package terri-core --package terri-sim   --package terri-data --package terri-wasm --test-workspace true --timeout 60
456 mutants tested in 28m: 6 missed, 392 caught, 55 unviable, 3 timeouts
```

**Read that 6 as the state of the tree the sweep ran on, which is Task 6's
code before its last commit.** One of the six was killed in response, and the
scoped re-sweep below is the measurement of the fixed tree rather than a
prediction about it. Test code is not mutated, so the kill adds a test without
adding a mutant: the projected full-sweep figure is 456 tested, 5 missed, and
those five are exactly `docs/mutants-baseline.txt`.

**It found a survivor outside the baseline, and it is the first sweep since
M1b Task 5 to run to completion.**

```
crates/terri-sim/src/systems/interact.rs:139:52: replace && with || in tick_interactions
```

That is the twin of the guard Task 5 killed in `drain_commands`, named in that
task's own code comment as using the same comparison and never swept, because
Task 5's full run was stopped at 204 of ~420 and this file was well past the
stopping point. It was **killed rather than baselined** -
`a_finished_interaction_pops_only_the_intent_that_named_the_object_it_finished`
in `interact.rs` - and the scoped re-sweep of that file reports **21 mutants,
21 caught, 0 missed**. `docs/mutants-baseline.txt` is unchanged: the other five
survivors are exactly its five entries, and the three timeouts are the known
`rng.rs` ones, which are detections rather than survivors. [L43] records why a
stopped sweep's missed list can never clear anything.

**Scoped run over every file Task 6 touched**, which is the check that answers
the gate's question about the task's own code:

```
cargo mutants --package terri-wasm --package terri-sim --package terri-data   -f crates/terri-wasm/src/lib.rs -f crates/terri-sim/src/lib.rs   -f crates/terri-data/src/{compile,pack,schema,error}.rs   --test-workspace true --timeout 60
109 mutants tested in 6m: 80 caught, 29 unviable, 0 missed
```

`terri-wasm` alone: 37 caught, 1 unviable, 0 missed. The mutants that matter
are all caught, including `delete ! in SimHandle::enqueue_command` - the
trailing-byte guard - and `replace >= with < in SimHandle::enqueue_command` -
the staging-queue cap, which a test that only checked "the queue stops growing"
could not have seen. `grep -lE "content is invalid"` counts **23** of the 29
unviable, which is [L28] again and not a coverage regression.

**The mutant count rose from 392 to 456**, which is the expected reading for a
task that added three exports, two `Sim` accessors and a tuning knob.

---

**Previous sweep: M1b Task 5, the command drain, 2026-07-29. PARTIAL, and the
partiality is the first thing to read.** The full sweep was started on the
finished, committed tree with CI's package list, and was stopped at **204 of
roughly 420 mutants** after 45 minutes because it was pacing at about another
45 and had not yet reached the file the task actually added. What ran instead
was the full sweep's completed prefix plus a **scoped sweep over every file
this task touched**, which is the split `docs/mutants-baseline.md` already
endorses: the scoped run is the cheap check, the full run is the one that is
allowed to be believed.

```
# full sweep, stopped at 204/~420
cargo mutants --package terri-core --package terri-sim \
  --package terri-data --package terri-wasm --test-workspace true --timeout 60 --jobs 4
204 tested: 4 missed, 175 caught, 23 unviable, 2 timeouts

# scoped, on each file the task changed
crates/terri-sim/src/systems/command.rs   18 mutants: 0 missed, 17 caught,  1 unviable
crates/terri-sim/src/lib.rs               13 mutants: 0 missed, 13 caught,  0 unviable
crates/terri-data/src/{compile,pack,schema,error}.rs
                                          49 mutants: 0 missed, 22 caught, 27 unviable
```

**No new survivors on any file this task touched.** The four survivors in the
full sweep's prefix are **exactly** four of the five entries in
`docs/mutants-baseline.txt` - the three in `grid.rs` and the one in `rng.rs`.
The fifth, `advertise.rs:82:18`, lives in `terri-sim` and the prefix stopped
before reaching it; that file is byte-unchanged by this task, so its entry
cannot have moved. Compared line-keyed **and** normalised on
`(file, column, mutation)`; both give an empty new-survivor list. The baseline
file is unchanged and was **not** regenerated - a scoped run's `missed.txt`
must never be written over it, because a scoped run cannot see the entries it
did not mutate.

**The two timeouts are two of the three `rng.rs` ones recorded at M1c Task 1**
(`next_u32 -> 0` and `next_u32 -> 1`), which are detections rather than
survivors and land in `timeout.txt`, not `missed.txt`. The third,
`replace >= with < in range`, was past the stopping point.

**The scoped run found one survivor that eleven hand mutations had not, and it
was killed rather than baselined:**

```
crates/terri-sim/src/systems/command.rs:206:56: replace && with || in drain_commands
```

That is the guard deciding whether `CancelIntents` releases the sim's current
commitment: `intent.object == target.object && intent.interaction ==
target.interaction`. The second clause looks redundant, and every fixture in
the module had **both** fields agreeing - which is [L34], and is why the hand
pass missed it. It is not equivalent and the relaxed form is a real bug:
`UseObject` always names interaction 0 and an autonomously chosen interaction
is 0 on every single-interaction object, so an intent for the bed and a target
on the fridge agree on the interaction index while naming different objects
entirely. Under `||` a cancel then releases the sim's own choice the moment the
player has queued a click on anything else - the very interruption the guard
exists to prevent.
`a_cancel_does_not_release_an_autonomous_target_that_only_shares_the_intents_interaction_index`
is the fixture written for it; it asserts both preconditions, so it cannot
decay into a copy of its neighbours. Re-running the scoped sweep after it:
**0 missed.**

**Twenty-seven of the 49 terri-data mutants are unviable**, against 22 caught,
which is [L28] at its widest yet: a mutation to `compile_tuning` that rejects
the shipped `content/tuning.toml` aborts `build.rs` before any test runs. The
new `max_queued_intents == 0` check is one of them - the shipped value is 4, so
flipping the comparison rejects real content. By [L21] that is **no evidence
about the test**; `rejects_zero_max_queued_intents` in `compile.rs` is what
constrains it, and the build gate is what would catch the flip in practice.

**Outstanding:** a full sweep on this tree, for the totals row in the history
table below and for the `terri-sim` and `terri-wasm` portion of the survivor
list. Whoever runs it next should expect roughly 420 mutants and about 90
minutes single-machine at `--jobs 4`, and should compare against the unchanged
`docs/mutants-baseline.txt`.

---

**Latest sweep: M1c Task 6, the alpha feel pass, 2026-07-28**, full, on the
finished Task 6 tree, with the package list CI uses and **CI's exact
invocation** - single-job, unlike the two sweeps below:

```
cargo mutants --package terri-core --package terri-sim \
  --package terri-data --package terri-wasm --test-workspace true --timeout 60
392 mutants tested in 25m: 5 missed, 335 caught, 49 unviable, 3 timeouts
```

**Mutation score on viable mutants: 98.0%** (335 caught of 342 viable, counting
the 3 timeouts as not-caught, which is the pessimistic reading).

**The survivor list is byte-identical to `docs/mutants-baseline.txt`**, checked
line-keyed **and** normalised on `(file, column, mutation)`. Both comparisons
give an empty new-survivor list and an empty now-caught list. The two agree for
a checkable reason rather than a lucky one: all five baseline entries live in
`grid.rs`, `rng.rs` and `advertise.rs`, and this task touched none of the
three.

**No new mutants entered the sweep** - 392 against 392 at Tasks 4 and 5 - which
is the expected reading for a task whose code change is three numbers in a
content file plus comments and tests. Test-only code is not mutated, so the two
new helpers in `interact.rs` and `test_content.rs` add nothing to the count.

**One mutant moved from unviable to caught**, 50 to 49 unviable against 334 to
335 caught, with the missed set unchanged. That is the *opposite* of the
movement [L28] warns about: coverage moved out of the build gate and back into
the test suite, which is the safe direction, and the gate is unaffected either
way because unviable is neither caught nor missed.

**It was not isolated, and the leading explanation is the harness rather than
the code.** This run was single-job and the Tasks 4 and 5 run used `--jobs 4`;
a transient build failure under parallelism on this machine classifies as
unviable, and [L15] already records that this box handles concurrent build
processes badly. The semantic alternatives were checked and rejected: every
branch of `compile_tuning` evaluates the same way against both the old and the
new knob values, so no build-gate kill can have been created or removed by the
retune. `grep -lE "content is invalid" mutants.out/log/*.log` counts **27**
mutants killed by `build.rs` rather than by a test, up from the 13 [L28]
measured at M1a Task 5, which is content validation having grown across M1b and
M1c rather than anything moving in this task.

---

**Previous sweep: M1c Tasks 4 and 5, 2026-07-28**, full, on the finished Task 5
tree, with the package list CI uses:

```
cargo mutants --package terri-core --package terri-sim \
  --package terri-data --package terri-wasm --test-workspace true --timeout 60 \
  --jobs 4
392 mutants tested in 11m: 5 missed, 334 caught, 50 unviable, 3 timeouts
```

**Mutation score on viable mutants: 97.7%** (334 caught of 342 viable, counting
the 3 timeouts as not-caught, which is the pessimistic reading).

**The survivor list is byte-identical to `docs/mutants-baseline.txt`.** CI's
comparison gives an empty new-survivor list and an empty now-caught list, so the
baseline file is unchanged by these two tasks. It was checked line-keyed **and**
normalised on `(file, column, mutation)`, per the standing warning that the
baseline is line-keyed and an entry can re-anchor on a comment edit alone; both
comparisons are empty, and the two agree because none of the three files holding
baseline entries was touched.

Thirty-three new mutants entered the sweep (392 against 359 at Task 3), from
`sample_duration`, `roll_wander_path`, the wander system, the restlessness
branch in `select_action`, the optional target in `follow_path`, and the
`wander_attempts` validation.

**One of them survived the first sweep, and it was equivalent rather than
untested:**

```
crates/terri-sim/src/systems/action.rs:454:26: replace > with >= in select_action
```

That was `if score > best_seen { best_seen = score; }`, the running maximum that
`idle_threshold` is compared against. Relaxed to `>=` it reassigns a value equal
to the one already held, which changes nothing on any input - including the
`f32` corner cases, since `-0.0` and `0.0` compare identically against a
threshold and `NaN` fails both forms. No test can separate the two.

**It was removed rather than baselined**, and that choice is the point. A
genuinely equivalent mutant is a legitimate baseline entry, but this one had a
cheaper fix: `best_seen = best_seen.max(score)` has no comparison operator to
mutate, so the mutant is not generated at all. The same idiom the fold in
`sample_softmax` already uses. A baseline that only ever grows becomes a
permission slip; the second sweep above is the one with the entry gone, and it
matches the committed baseline exactly.

**Two sorts in this change are invisible to the sweep and are covered by hand.**
`cargo mutants` emits no statement-deletion mutant, so a `sort_by_key` whose
only effect is on state is outside its grammar entirely - a clean report over
those two lines is true and is simultaneously no evidence (rule 2 of
`testing-protocol.md`, and [L11]). Both were deleted by hand:
`arrival_draws_follow_entity_order_not_archetype_order` fails without the sort
in `follow_path`, and `wander_destinations_follow_entity_order_not_archetype_order`
fails without the one in `idle::wander`.

---

**Previous sweep: M1c Task 3, 2026-07-28**, full, on the finished Task 3 tree,
with the package list CI uses:

```
cargo mutants --package terri-core --package terri-sim \
  --package terri-data --package terri-wasm --test-workspace true --timeout 60 \
  --jobs 4
359 mutants tested in 10m: 5 missed, 303 caught, 48 unviable, 3 timeouts
```

**Mutation score on viable mutants: 97.4%** (303 caught of 311 viable, counting
the 3 timeouts as not-caught, which is the pessimistic reading).

`--jobs 4` is the only difference from CI's invocation, and it is a wall-clock
concession on this machine rather than a change to what is measured: which
mutants survive is not a function of how many run at once, and the test phase
is under two seconds so the 60s timeout is nowhere near contended. **CI's own
command is unchanged.** Single-job was measured at about 20s per mutant here
against CI's 3.3s, which would have been over two hours.

**The survivor list is byte-identical to `docs/mutants-baseline.txt`.** CI's
comparison gives an empty new-survivor list and an empty now-caught list, so
the baseline file is unchanged by this task.

Seventeen new mutants entered the sweep (359 against 342 at Task 1), from
`sample_softmax`, the object sort, the reshaped per-object comparison and the
decay split across two content files. All were caught, but **one of them was
not caught first time and that is the entry worth reading:**

```
crates/terri-sim/src/systems/action.rs:445:52: replace > with < in select_action
```

That is `score > *best_score`, the comparison that picks which of an object's
interactions an agent performs, flipped to keep the WORST one. It survived the
first sweep of the task with all 172 tests green. Two fixtures look like they
cover it and neither does: `selection_scores_every_interaction_and_records_the_one_that_won`
deliberately puts its weak interaction below the action threshold, so `best` is
still `None` when the strong one is scored and the comparison never runs against
an incumbent; and `a_tied_later_interaction_cannot_displace_an_earlier_one_on_the_same_object`
runs it only on EQUAL scores, where `>` and `<` agree. The missing input domain
is two interactions on one object that both clear the threshold and differ,
which no fixture had. That is [L34], and
`the_better_of_two_worthwhile_interactions_on_one_object_is_the_one_recorded`
is the test written for it.

Worth recording twice over. The mutation was **killable before this task**,
when the same comparison ranged over objects as well as interactions and
several fixtures place two objects with different scores; scoping it to within
one object is what made the existing coverage stop reaching it. That is [L30]
running in the opposite direction - not an equivalent mutant becoming killable,
but a killed mutant becoming a survivor because the code around it changed
shape. **Neither a reviewer nor the eight hand mutations run for this task
found it; the sweep did.**

**No baseline entry re-anchored.** The brief warned that the baseline is
line-keyed and that an entry can move on a comment edit alone. It did not
happen here, and the reason is checkable rather than lucky: all five baseline
entries live in `grid.rs`, `rng.rs` and `advertise.rs`, none of which this task
touched. Normalising on `(file, column, mutation)` was therefore unnecessary,
and the raw line-keyed comparison is sound for this task specifically.

---

**Previous sweep: M1c Task 1, 2026-07-28**, full, on a clean tree at `f4458fb`,
with the package list CI uses:

```
cargo mutants --package terri-core --package terri-sim \
  --package terri-data --package terri-wasm --test-workspace true --timeout 60
342 mutants tested in 19m: 5 missed, 292 caught, 42 unviable, 3 timeouts
```

**Mutation score on viable mutants: 97.3%** (292 caught of 300 viable, counting
the 3 timeouts as not-caught, which is the pessimistic reading).

The five missed are **exactly** the five in `docs/mutants-baseline.txt`. Running
CI's own comparison against the updated baseline gives an empty new-survivor
list and an empty now-caught list.

A scoped sweep over `rng.rs` alone was run first and predicted this:

```
cargo mutants --package terri-core --file crates/terri-core/src/rng.rs \
  --test-workspace true --timeout 60
25 mutants tested in 6m: 1 missed, 20 caught, 1 unviable, 3 timeouts
```

The reasoning was that Task 1 adds exactly one file of mutable code, its only
other change being two lines in `lib.rs` that `cargo mutants` cannot mutate, and
that its new tests exercise `SimRng` alone so they cannot close any existing
survivor. The full sweep confirmed it. **Both are recorded because the scoped
run is the cheap check and the full run is the one that is allowed to be
believed**; had they disagreed, the full one wins.

Thirty-one new mutants entered the sweep with `rng.rs` (342 against 311 at Task
3b) and one survived.

**One addition, and it is genuinely equivalent rather than untested:**

`crates/terri-core/src/rng.rs:32:30: replace | with ^ in SimRng::from_seed`

The line is `inc: (seed << 1) | 1`. `seed << 1` has bit 0 clear for **every**
`u64`, so `| 1` sets a bit that is already 0 and `^ 1` flips a bit that is
already 0. The two agree on the entire input domain; no test can separate them,
so per [L32] rule 4 the thing to record is the condition that ends the
equivalence rather than an excuse:

> The equivalence holds **only** because the operand is left-shifted by at
> least one. It ends the moment that expression changes shape - a rotate
> instead of a shift, a shift of 0, or `inc` seeded from anything not shifted.
> At that point bit 0 can be 1, `|` and `^` diverge, and
> `a_golden_sequence_pins_the_algorithm` should start failing on the mutant.

`| 1` was kept rather than rewritten as `+ 1`, which would have made the mutant
killable. It is the canonical PCG idiom and states the real constraint, that
the stream increment must be odd. Changing shipped code to give a tool
something to find is the wrong trade when the alternative is one sentence of
recorded reasoning.

**Three timeouts, which are detections and are reported separately** per [L15]
rule 4. `next_u32 -> 0`, `next_u32 -> 1` and `replace >= with < in range` all
make the rejection loop in `SimRng::range` spin forever: the loop only exits on
a draw at or above the threshold, and each of these mutants guarantees no such
draw. The suite never goes green, which is what "caught" means, but a hang
burns the job timeout instead of printing an assertion, so it is a weaker
signal than a failure. They cost about 180s of CI time and land in
`timeout.txt`, not `missed.txt`, so the gate does not see them. An unbounded
rejection loop is inherent to debiased sampling and is not worth capping.

> **That last sentence was reversed on 2026-07-29, and the error was in its
> premise rather than in the trade it made.** These three are not detected
> *only* by a hang. Measured one mutant and one test at a time under a
> deadline, all three fail real assertions - 14, 15 and 2 of them respectively
> - and the TIMEOUT verdict came from a **different** test in the same run
> spinning inside the rejection loop, which stopped `cargo test` exiting and so
> stopped it reporting the failures that had already happened. Once that was
> known the cap was free: it cannot fire on a working generator and it changes
> no draw. `SimRng::range` now delegates to a bounded `draw_below_bound`, all
> three report CAUGHT, and CI fails on a non-empty `timeout.txt`. See [L50] and
> the latest sweep section at the top of this file.
>
> Left standing rather than quietly corrected, because [L30] is this file's own
> warning that a recorded argument expires, and an expiry that is edited away
> teaches nobody.

---

**Previous sweep: M1b Task 3b, 2026-07-28**, with the package list CI actually
uses, which includes `terri-wasm`:

```
cargo mutants --package terri-core --package terri-sim \
  --package terri-data --package terri-wasm --test-workspace true --timeout 60
311 mutants tested in 16m: 4 missed, 266 caught, 41 unviable
```

The four survivors are **exactly** the four in `docs/mutants-baseline.txt`:
no new ones, and none of the existing four has become killable. Task 3b
added `Sim::new_from_lot`, `Sim::new_from_shipped_lot`, `SimHandle::from_lot`,
`SimHandle::lot_width`, `SimHandle::lot_height` and the wall-aware distance in
`select_action`, so the 14 extra mutants are theirs and all 14 are caught.

**The counts are not comparable with the Task 3 line below**, and the reason is
[L27]: that sweep named three packages, this one names four. Compare survivor
*lists*, which is what the gate does, rather than totals.

Recorded 2026-07-28 at M1b Task 3, from a full sweep on a clean tree at
`61b77fd`:

```
cargo mutants --package terri-core --package terri-data --package terri-sim \
  --test-workspace true --timeout 60
297 mutants tested in 15m: 5 missed, 252 caught, 40 unviable
```

**Mutation score on viable mutants: 98.1%** (252 caught of 257 viable).

Read the survivor list carefully, because 5 is the same number as last time
and means something different:

- **Three** are the `grid.rs` entries carried since M1a Task 9.
- **One** is `advertise.rs`, re-anchored from `42:18` to `79:18`; its
  companion `42:36` was deleted outright rather than moved.
- **One**, `command.rs:54:9`, is **not in the baseline file**, because it was
  killed rather than accepted. It belongs to M1b Task 1 and this was the
  first sweep to see it; the fix landed after this sweep ran, so the numbers
  above are from a tree that still contains the gap.

Net: `docs/mutants-baseline.txt` holds **four** entries, down from five.

## Read the four counts, not the score

A sweep reports **caught**, **missed**, **unviable** and **timeout**, and only
the first two say anything about the tests.

- **Missed** is behaviour nothing constrains. That is the gate.
- **Unviable** means the mutated code did not compile or did not build, so the
  test suite never ran against it. By [L21] that is **no evidence at all about
  the tests** - not a pass, not a failure. It must never be added to caught.
- **Timeout** is a fourth column, and reading it as "caught by a hang" is the
  mistake [L50] records. It means *some* test in that run never terminated,
  which also stops `cargo test` reporting the failures that had already fired,
  so it says nothing about whether the mutant was detected - all three of the
  `rng.rs` timeouts turned out to fail assertions the whole time. It must be
  zero, and CI now fails if it is not; the fix for one is to bound the loop the
  mutant spins in, never to raise `--timeout`.
- The score above is therefore quoted over *viable* mutants, and even that is
  not comparable across milestones, because [D9]'s build gate keeps moving
  mutants between the caught and unviable columns.

**40 of the 297 are unviable, and 21 of those are unviable because of the
content build gate rather than because of the type system.** They are mutants
whose mutated code runs inside `terri-data`'s `build.rs`, rejects the real
`content/*.toml`, and kills the build before any test runs. Several are in
**`terri-core`**, not in the crate that owns the build script:
`NeedId::index`, `NeedId::as_str` and `NeedId::from_name` became build
dependencies of the validator in M1a Task 5, and `terri-core`'s own tests used
to catch them. Nothing is less safe - the build gate detects every one - but
the sweep has stopped vouching for roughly two dozen tests that still exist
and still work. See [L28], and [L35] for what that means when you are
designing a mutation by hand. To re-identify them in any future run:

```bash
grep -lE "content is invalid" mutants.out/log/*.log | wc -l
```

Measured: **13** at M1a Task 5, **21** at M1b Task 3. The jump is
`content/lot.toml` entering the gate with five new validation rules over it.
If that number and the caught count move together in opposite directions,
coverage has shifted out of the test suite and into the build again.

Unviable by file at M1b Task 3, for whoever compares next:

| File | Unviable |
|---|---|
| `terri-data/src/compile.rs` | 17 |
| `terri-core/src/needs.rs` | 9 |
| `terri-core/src/hash.rs` | 5 |
| `terri-core/src/command.rs` | 4 |
| `terri-core/src/grid.rs` | 2 |
| `terri-data/src/pack.rs` | 2 |
| `terri-data/src/lib.rs` | 1 |

## What this file is for, and the failure mode it exists to avoid

CI runs a full sweep and fails only on survivors **absent from the baseline**.
It also reports baseline entries that are now caught, so the file cannot
quietly rot into a permission slip that only ever grows.

Two rules follow, and the second is the one that gets skipped:

1. **Adding an entry to the baseline is a deliberate act.** Record the argument
   here before doing it, and prefer killing the mutant.
2. **An argument is a claim about the code as it is today, so it expires.**
   [L30] is the recorded instance: `action.rs`'s `<` to `<=` was correct
   accepted debt from M0, a genuinely equivalent mutant, until M1a Task 6 gave
   that clause a second job and made it killable. **The sweep could not report
   this. A survivor that was already a survivor emits no signal when its
   meaning changes.** The baseline diff catches new survivors and is blind to
   existing ones ceasing to be equivalent.

Because of rule 2, every section below says whether its argument was
**re-derived against the current code in this task** or **carried on trust**.

`--in-diff` was tried first and abandoned. It approximates "no new survivors"
by restricting mutants to changed lines, which breaks on the one PR that
introduces the whole codebase: the diff is everything, the run degenerates into
a full sweep, and it fails on accepted debt. Diffing against a committed
baseline needs no special case.

## The accepted survivors

Five at M1c; six after the alpha branch, which added
`TileGrid::find_path_adjacent` and with it a second copy of the two neighbour-
offset mutants. It was five before that and four before M1b Task 3, which
removed one by removing the operator it mutated; see the `advertise.rs` section.
Object footprints added two more, both in `rect_distance` and both with a
one-line proof; see that section.

The count is deliberately not in this heading any more. It was wrong twice in one
day - the heading said four while the file held five - because a number in a
heading is a second copy of `wc -l docs/mutants-baseline.txt` that nothing keeps
in sync. Count the file.

**Every `grid.rs` line number below moved when footprints landed**, because the
`Footprint` type was declared above `impl TileGrid`. The mutants and their
arguments are unchanged; only the lines are. `find_path`'s pair went 102 to 151
and its f-score went 115 to 164; `find_path_adjacent`'s pair went 263 to 352.
Re-derived by a full `cargo mutants --file crates/terri-core/src/grid.rs
--package terri-core` sweep on 2026-07-30: 150 mutants, 139 caught, 2 unviable,
7 missed, and the 7 are exactly the file's `grid.rs` rows.

### `grid.rs:151:43` and `151:63` - the neighbour offsets - EQUIVALENT

**Carried on trust since M1a Task 9.** `NEIGHBOURS` has not been touched
since, and the expiry condition below names the edit that would invalidate
it. Argument:

```rust
const NEIGHBOURS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
...
let next = (current.pos.0 + dx, current.pos.1 + dy);
```

`NEIGHBOURS` is **closed under negation**: negating every element permutes the
array rather than changing its contents. So iterating it with `- dx` (or with
`- dy`, or with both) visits the same four tiles as `+ dx`, in a different
order. No test can distinguish the two, because the set of tiles considered is
identical.

The order difference is where an equivalence claim like this usually fails, so
it is worth pinning rather than waving at:

1. **Heap pop order does not depend on push order here**, because `OpenNode`'s
   `Ord` is a *total* order with no ties. It compares `f_score`, then `index`.
   Two entries can share an index only by being the same tile pushed twice, and
   a tile is re-pushed only when `tentative < g_score[next_idx]` strictly
   improves - so its `f_score` strictly falls each time. No two live entries
   ever compare `Equal`, so `pop` always returns a unique maximum.
2. **`came_from` cannot be decided by neighbour order.** The four neighbours of
   one node are four distinct tiles, so one expansion writes at most one entry
   per tile. Which of two *different* predecessors claims a tile is settled by
   which is popped first, and that is (1).

**When this expires:** the moment `NEIGHBOURS` stops being symmetric. Adding
diagonals keeps it symmetric; adding a one-way movement rule, a ledge, or a
directional portal does not. Whoever edits that array owns re-checking this.

#### The same two, in `find_path_adjacent` - added 2026-07-29, now at 352

`TileGrid::find_path_adjacent` arrived on the alpha branch and reuses
`find_path`'s expansion loop verbatim, including this expression, so it
contributes its own copy of both mutants. CI's gate caught them as new
survivors, which is the gate working.

**The argument above transfers without modification.** It rests entirely on two
things: that `NEIGHBOURS` is closed under negation, and that `OpenNode`'s `Ord`
is total with no ties. Both are properties of code shared by the two functions -
the same array and the same `Ord` impl - so neither can hold for one and fail
for the other. The only difference between the functions is the goal test, and
the goal test does not appear in the argument.

**When this expires:** exactly when the entry above does, and for the same
reason. Whoever edits `NEIGHBOURS` owns re-checking both.

#### And the f-score, in `find_path_adjacent` - KILLED rather than accepted

`find_path_adjacent` also contributed a copy of the `tentative + heuristic(..)`
to `tentative * heuristic(..)` mutant recorded below as "A REAL GAP". It is
**not** in the baseline, because it is now dead:
`the_adjacent_path_is_the_shortest_one_and_not_merely_a_valid_one` in
`grid.rs` kills it.

Two things about how, because both are reusable:

**The fixture was found by brute force, not by hand.** Multiplying makes the
priority inadmissible *and* inconsistent, so it only returns a wrong answer on a
maze where the cheap-looking direction is a detour - which is genuinely hard to
draw by eye, and is presumably why the `find_path` twin was carried on trust for
three milestones. `crates/terri-core/examples/find_fscore_counterexample.rs`
implements the real search, the mutated search and a BFS optimum side by side and
walks random small grids until they disagree. It found a 4x7 grid on which the
optimum is 11 steps and the mutant returns 13, after 11 107 596 cases. That
example is committed, so the next person does not have to rediscover the
technique.

**The assertion is an exact length.** Every other test on this function checked
contiguity, walkability, the endpoint and a plausible length, and a range is
precisely what let the mutant through - it returns a *valid* path, just not the
shortest one. Do not relax it.

**This makes the `find_path` entry below newly suspicious.** The same technique
would very likely kill it too, and nobody has tried since the tooling to do so
now exists. It is left in the baseline for now rather than removed on a guess,
but it should be treated as a to-do rather than as settled debt.

#### And the g-score comparison, in `find_path_adjacent` - KILLED, 2026-07-30

The footprint sweep turned up a **third** `find_path_adjacent` survivor that had
never been in the baseline: `tentative < g_score[next_idx]` relaxed to `<=`, at
what is now `grid.rs:361:30`. The identical mutant in `find_path` was caught,
and the asymmetry was the whole diagnosis: `find_path` has
`tie_breaking_pins_one_specific_path_among_equals`, which asserts an exact
route, and `find_path_adjacent` had no equivalent. Relaxing the comparison
re-parents a tile already reached at equal cost, so the returned path changes
ROUTE while keeping its length, its arrival tile, its contiguity and its
walkability - which is every property the adjacency tests asserted.

It is **not** in the baseline, because it is now dead:
`the_adjacent_route_among_equally_short_ones_is_pinned` asserts the exact route
for a diagonal query on an open 6x6 grid. Measured: `<` returns
`[(1, 0), (2, 0), (3, 0), (3, 1), (3, 2)]` and `<=` returns
`[(0, 1), (0, 2), (1, 2), (2, 2), (3, 2)]` - same length, same arrival, the
other side of the room.

**Worth generalising:** when a function is created by copying another's search
loop, it inherits the original's mutants and NOT the original's tests. Both
neighbour-offset copies were noticed at the time because CI's gate reported them
as new survivors; this one apparently was not, which means the sweep that added
them did not cover the whole file. A scoped sweep is not a baseline.

### `grid.rs:164:44` - the f-score - A REAL GAP, not an equivalent mutant

**Analysed at M1a Task 9 and carried on trust since**, with one M1b Task 3
update at the end of this section: the lot now has walls, which changes what
it would take to kill this. The old file filed it under "real test gaps"
with no analysis; here is the analysis, because it is what a future test has
to exploit.

```rust
f_score: tentative + heuristic(next, to),   // mutant: tentative * heuristic(...)
```

Multiplying makes the priority inadmissible **and** inconsistent, so `find_path`
can return a path that is not shortest. The specific pathology: at the goal
`heuristic` is 0, so the mutated `f_score` is 0 whatever `tentative` is, and 0
is the highest priority in this min-heap. **The goal is therefore popped the
instant it is discovered**, and `find_path` returns whatever route discovered
it rather than the shortest one.

It survives because no current fixture makes discovery order differ from
optimal order. The existing layouts are a 10x10 open grid, a 5x5 with one
straight wall, and a 12x12 with a single blocked tile; on all three the first
route to touch the goal is already a shortest one.

**What would kill it:** a layout with two routes to the goal of *different*
lengths where the longer one reaches the goal's neighbourhood first. Not
attempted at M1a Task 9, because finding one is search rather than reasoning
and that task's budget went to the eleven closures below. It is the single
most valuable remaining entry in this file - it is the only survivor that can
produce a wrong answer rather than merely an unobservable one.

**M1b Task 3 makes such a layout cheap to find, and that is new.**
`content/lot.toml` walls a bathroom off behind a single doorway at
`(16, 5)`, which is exactly the shape this needs: a goal inside the bathroom
has one long route through the door, and the direct approach reaches the
goal's neighbourhood first while being separated from it by a wall. Nobody
had a reason to build such a layout before, because M0's lot was one open
room. Whoever next attends to this entry should start from the shipped lot
rather than inventing a grid.

### `grid.rs:418:14` and `420:21` - the rect clamps - EQUIVALENT

**Derived 2026-07-30, when object footprints added `rect_distance`.** Both are
the boundary of a three-way clamp, and both are equivalent for the same
one-line reason:

```rust
let axis = |v: i32, lo: i32, hi: i32| {
    if v < lo {
        lo - v
    } else if v > hi {
        v - hi
    } else {
        0
    }
};
```

`<` to `<=` moves `v == lo` from the `else` branch into the first one, which
computes `lo - v` - and at `v == lo` that is **0**, exactly what the `else`
branch returns. `>` to `>=` is the mirror image at `v == hi`: `v - hi` is 0
there too. Neither mutant can change the function's value for any input, so no
test can distinguish them.

This is a stronger claim than the `NEIGHBOURS` entries above, which rest on a
property of a separate array that a future edit could break. This one is
arithmetic on the two lines shown, and the boundary values are pinned anyway:
`the_rectangle_distance_is_zero_inside_the_footprint_and_the_true_cost_outside_it`
asserts `rect_distance` at `v == lo` and `v == hi` on both axes - `(4, 2)` is
the origin corner and `(6, 3)` the far one - so the value the equivalence
argument depends on is a checked number rather than an assumption.

**When this expires:** if either branch ever returns something other than the
distance past the boundary - a weighted or clamped cost, say - the two branches
stop agreeing at the boundary and both mutants become real. Whoever changes the
body of `axis` owns re-deriving this.

### `advertise.rs:82:18` - the deficit clause of the NaN guard - EQUIVALENT

**Re-derived in M1b Task 3**, where the guard changed shape and moved from
line 42 to line 79. Both halves of that sentence matter: CI compares
survivor strings byte for byte, so the line move alone would read as a new
survivor plus a stale entry, and the shape change means the previous
argument had to be redone rather than carried.

**Re-anchored again from `79:18` to `82:18` in M1c Task 2**, and this time
the code did not change at all: `ACTION_THRESHOLD` became
`content/tuning.toml`'s `action_threshold`, and the doc comment above this
function that named the old constant grew three lines while being corrected.
That is the recurring cost of a line-keyed baseline - **an edit to a COMMENT
above a survivor invalidates its entry** - so re-derive the coordinate with
`cargo mutants --file` after touching a file that holds one, rather than
assuming the entry still points at it. The argument below is unchanged; only
the anchor moved.

```rust
// M1a
if !(deficit > 0.0) || !(delta > 0.0) || !(distance >= 0.0) {
// M1b Task 3
if !(deficit > 0.0) || !delta.is_finite() || !(distance >= 0.0) {
```

**The companion entry `42:36` is gone rather than re-anchored.** That was
the `>` on the delta clause, and the clause is no longer a comparison:
negative advertised deltas are legal content from M1b Task 3, so only a
non-finite delta is rejected. There is no operator left to mutate. See
`docs/specs/2026-07-28-m1b-playable-alpha-design.md` [D-6] for the decision
and `score_advertisement`'s doc comment for what a negative delta means.

The remaining entry is `>` mutated to `>=` on the deficit. The two differ on
exactly one input, `deficit == 0.0`, and on that input they return the same
value.

- With `>`, the guard fires and the function returns `0.0`.
- With `>=`, the guard does not fire and the function computes
  `(urgency * delta) / (time_cost + 1.0)`. `urgency` is `d * d * d` over a
  value clamped to `0.0..=1.0`, and here `d` is exactly `0.0`, so the
  numerator is zero. The denominator is at least `1.0`, because the third
  clause has already established `distance >= 0.0`. The quotient is `0.0`.

**The negative-delta case does not break this, and it is the part that had
to be re-derived.** With `delta < 0.0` the mutant's numerator is
`0.0 * negative`, which is `-0.0`. That is `== 0.0` under every comparison
the caller makes - `score += ...`, `score > best_score`,
`score > ACTION_THRESHOLD` - so no observable behaviour differs, and no
assertion could separate them without inspecting the sign bit. The same
argument that made the old `delta == -0.0` edge case unobservable now
covers the whole negative half of the delta domain.

**Note the asymmetry with the third clause.** `distance >= 0.0` mutated to
`> 0.0` is **caught**, and correctly: a distance of exactly zero is an agent
already standing on the object, which must score normally rather than zero.
That clause is a range check; the deficit clause is a NaN rejection that
happens to be written as a comparison. One line, two jobs, which is why half
of it is killable and half is not.

**When this expires:** if `score_advertisement` ever returns something other
than a plain product over the clamped urgency - a floor, an additive term, a
different denominator - the "both sides reach 0.0" argument has to be redone.
Adding a floor is the likely one now that scores can be negative.

## Closed in M1a Task 9 (11 mutants, no production code changed)

Every one was verified by hand as well as by the sweep, per rule 1 of
`testing-protocol.md`: mutation applied, suite run, failing test recorded,
source restored from a byte snapshot and confirmed byte-identical with
`git hash-object`.

| Mutant | Now caught by | Why it survived |
|---|---|---|
| `clock.rs:32:9` `is_hour_boundary` -> `true` and -> `false` | `hour_boundary_is_true_only_on_multiples_of_the_sim_hour` | Nothing consumes it, so no other test could see it at all |
| `grid.rs:28:9` `width` -> `0` and -> `1` | `width_and_height_report_the_constructor_arguments_in_that_order` | Every other fixture in the file is a **square** grid |
| `grid.rs:32:9` `height` -> `0` and -> `1` | the same test | The same reason, and the same fixture fixes both |
| `grid.rs:72:42` `\|\|` -> `&&` | `a_path_that_starts_on_an_unwalkable_tile_is_none` | The destination half of the guard is covered incidentally by search exhaustion; the origin half had no backstop |
| `grid.rs:128:5` `heuristic` -> `0` and -> `1` | `the_heuristic_equals_the_true_cost_on_an_open_grid` | A constant heuristic degrades A* to Dijkstra, which still returns optimal-**length** paths |
| `grid.rs:128:31` `-` -> `+` | the same test | Every existing query had `a.1 == 0`, where `a.1 - b.1` and `a.1 + b.1` have equal magnitude |
| `hash.rs:15:38` `+` -> `*` | `non_finite_values_get_distinct_digests` | The test checked each sentinel against only the saturation point on its own side |

Two of those deserve their reasoning kept, because the reasoning generalises.

**The width/height pair is a fixture problem, not a coverage problem.** Both
accessors were reachable from `is_walkable` and `set_blocked` the whole time.
What no test could see was a **transposed** grid, because a square fixture makes
`width` and `height` interchangeable. The fix was one non-square grid. This is
[L26]'s rule in a different costume: where a mapping is under test, the fixture
must make the keys distinguishable.

**`hash.rs:15:38` was a latent collision, not a style point.** The three
sentinels are `i64::MIN + 1`, `+ 2` and `+ 3` precisely because the quantizer
saturates to `i64::MAX` and `i64::MIN` exactly, so the sentinels have to clear
both. `i64::MIN + 1` mutated to `i64::MIN * 1` compiles, lands the NaN sentinel
**on** `i64::MIN`, and makes a NaN position hash identically to any coordinate
below roughly -9.2e14. The observed failure is the collision itself:

```
assertion `left != right` failed: NaN collides with i64::MIN saturation
  left: 12161821475553763397
 right: 12161821475553763397
```

The sibling mutants on lines 16 and 17 are unviable rather than caught, because
`i64::MIN * 2` overflows at compile time. That is [L21] again: the type system
guards two of the three and only the third needed a test.

## Removed from the baseline in M1a Task 9 (4 entries, none of them debt)

| Entry | Why it went |
|---|---|
| `action.rs:67:82` `<` -> `<=` | **Now caught.** This is [L30]'s entry. It was a correct equivalent mutant from M0 until Task 6 made `select_action` compare an object against itself, at which point `a_tied_later_interaction_cannot_displace_an_earlier_one_on_the_same_object` started killing it. The sweep never announced the change; the entry simply stopped being true. |
| `movement.rs:28:53` `/` -> `%` | **The code is gone.** It anchored `delta_per_tick: advert.hunger_delta / duration as f32`, which Task 6 deleted when `Eating` stopped carrying a per-tick delta. Deleting the code is the one baseline removal that needs no argument. |
| `advertise.rs:32:18` and `32:36` | **Re-anchored to `42:18` and `42:36`,** not removed. Task 6 shifted the guard down ten lines. |

That last row is the whole reason this file had to be rewritten rather than
amended. **CI compares survivor strings byte for byte, so a survivor at a
shifted line reads as a new survivor *and* leaves its old position behind as a
stale entry** - four diff lines describing two unmoved mutants, and a failed
job on the first PR of the branch. Task 7 measured this and left it for Task 9
deliberately. Before believing a survivor is new, normalise the line numbers
and compare again: **a survivor at a shifted line needs a renumber, and a
genuinely new one needs a test.**

## M1b Task 3 (lot content, walls and placements)

**Negative advertised deltas are now legal content**, and this file records
the decision because M1a's rejection of them was baselined behaviour rather
than an accident. The argument is in `score_advertisement`'s doc comment and
in [D-6]; the short version is that a cost is weighted by the cube of the
deficit of the need it drains, exactly as a benefit is weighted by the need
it fills, so an exhausted sim refuses a shower a rested one takes. The
mutation-relevant consequence is that `advertise.rs`'s delta clause stopped
being a comparison, which deleted one baseline entry outright rather than
re-anchoring it.

**One survivor closed, and it was not this task's code.** M1b Task 1 shipped
`CommandQueue::is_empty` with no test that could see
`is_empty -> true`: the only assertion was on an already-drained queue,
where `true` is the right answer. Task 1's own report predicted it as an
open concern ([C5]) and this was the first sweep to confirm it. Killed
rather than baselined, per rule 1, by asserting `is_empty` in **both**
directions in `the_queue_drains_in_order_and_empties`. Nothing outside
`command.rs` consumes the queue yet, so no other test could have stood in.

**Five new validation rules entered `terri-data`'s build gate**, which
widens [L28] again: a mutation to `compile_lot` that rejects the shipped
`content/lot.toml` aborts the build before any test runs, so it is reported
unviable rather than caught. The recorded instance is transposing
`x >= lot.width || y >= lot.height`, which the 24x18 shipped lot rejects at
`(18, 8)`. By [L21] that is no evidence about the test. The transposition is
guarded instead by `is_wall_matches_both_coordinates_of_a_declared_wall` in
`pack.rs`, which the build gate cannot shadow because it never runs there.
Re-measure the build-gated count each sweep:

```bash
grep -lE "content is invalid" mutants.out/log/*.log | wc -l
```

## What the sweep cannot see, which is most of what matters

`cargo mutants` **emits no statement-deletion mutants**. It rewrites
expressions and return values, so a whole statement whose only effect is on
state - `swap`, `clear`, `sort`, `push`, `insert` - is outside its grammar. A
clean report over such a line is true and is simultaneously no evidence. See
[L11], where deleting one `std::mem::swap` left all 31 tests green under a
"0 survivors" report, and [L29], where `interactions[i]` changed to
`interactions[0]` left all 91 green.

Three further blind spots, all recorded during M1a:

- **[L27]** it mutates only the packages named on the command line. `terri-data`
  was missing from that list for the whole of its first task.
- **[L28]** a build-time content gate converts caught mutants into unviable
  ones, silently, including in crates the change did not touch.
- **[L30]** it reports a survivor identically whether or not the argument for
  accepting it still holds.

The tool is the backstop for rule 2 of `testing-protocol.md`. Rule 1 - delete
the mechanism by hand and watch a named test fail - is what actually finds
things, and it is what found nine of the eleven closures above worth making.

## The trap to know before running this yourself

The first ever run reported **51** missed. Eleven were artifacts: by default
`cargo mutants` tests each mutant against **only the mutated package's own test
suite**. Most of `terri-core`'s behaviour is exercised through `terri-sim`, so
mutations like `Path::next_step -> None` were reported as surviving when the
real workspace suite catches them instantly.

**Always pass `--test-workspace true` in this repository.** Without it the tool
produces a report that fails to find anything, which is the same shape as the
bug the tool exists to catch. Note this is a different setting from the package
list in [L27]: `--test-workspace` decides *which tests judge* a mutant, the
package list decides *what gets mutated*, and no flag makes the latter follow
the workspace.

## How to reproduce

```bash
cargo mutants --package terri-core --package terri-data --package terri-sim \
  --test-workspace true --timeout 60
sort mutants.out/missed.txt > docs/mutants-baseline.txt
```

Roughly 14 minutes on the development machine. Run it on a **clean tree** and
confirm `git status` is clean first, or the copy `cargo mutants` takes will
include uncommitted work and the counts will not match this file. Update this
document when the baseline changes, and say which entries were closed, which
were added, and for each addition, why it cannot be killed.

## History

Counts are not comparable across all of these; the package list changed in
Task 4 and the build gate changed the caught/unviable split in Task 5.

| When | Mutants | Missed | Caught | Unviable | Note |
|---|---|---|---|---|---|
| M0, early | 237 | 21 | - | - | Two packages |
| M0 close-out (`28e5acf`) | 234 | 18 | - | - | After `Path::is_complete` was deleted |
| M1a Task 2 | 250 | 18 | 222 | 10 | Hunger to Needs; 3 entries re-anchored |
| M1a Task 4 | 266 | 18 | 235 | 13 | `terri-data` joins the sweep at 0 survivors ([L27]) |
| M1a Task 5 | 267 | 18 | 222 | 27 | Build gate moves 13 caught to unviable ([L28]) |
| M1a Task 6 | 269 | 16 | 226 | 27 | 2 closed by new selection tests |
| M1a Task 7 | 269 | 16 | 226 | 27 | Every figure identical to Task 6 |
| **M1a Task 9** | **269** | **5** | **237** | **27** | **11 closed; baseline rewritten** |
| **M1b Task 3** | **297** | **5** | **252** | **40** | **1 closed, 1 deleted, 1 re-anchored; baseline down to 4** |
| M1b Task 3b | 311 | 4 | 266 | 41 | 14 new mutants, all caught; baseline unchanged |
| **M1c Task 1** | **342** | **5** | **292** | **42** | **31 new mutants from `rng.rs`; 3 timeouts; baseline up to 5** |
| M1b Task 5 | *partial* | 4 | 175 | 23 | Stopped at 204/~420; scoped sweeps over all changed files gave 0 missed; baseline unchanged at 5 |
<<<<<<< HEAD
| M1b `UseObject::interaction` | *scoped* | 0 | 43 | 5 | 48 mutants over the four files the change touched; 0 missed, baseline unchanged at 5 |
=======
| **`range` timeout fix** | **513** | **7** | **450** | **56** | **First sweep with 0 timeouts; the 3 `rng.rs` hangs became CAUGHT; baseline unchanged at 7** |
>>>>>>> origin/main

The M1b Task 3 row is the one to read carefully. Missed stayed at 5 while
the set changed completely in composition: `advertise.rs:42:36` ceased to
exist, `command.rs:54:9` appeared from Task 1's untested `is_empty` and was
killed, and the remaining four are the accepted set. **Twenty-eight new
mutants entered the sweep** with the lot schema and validator, and **none of
them survived**.

The 2026-07-27 entry for Task 4 recorded a first `terri-data` run with **1**
missed - `compile.rs:24:14: replace < with <= in check_number`, meaning nothing
pinned whether a decay rate of exactly zero is legal content. It is;
`zero_is_a_legal_decay_rate_and_a_legal_advert` now says so. Worth keeping
because no amount of reading the code could have settled it: the code cannot
state which side of `<` was intended.

---

## M2b: the five-room house

The sweep over the house found **six** survivors that the baseline did not
list. Four were killed; two were accepted, and the argument is below.

### Killed

- `crates/terri-data/src/compile.rs:403` - three mutants on
  `habituation_floor <= 0.0 || habituation_floor > 1.0`: `||` to `&&`, and
  `> 1.0` to `== 1.0` and to `>= 1.0`. There was **no test for this bound at
  all**; the knob had a range check and nothing constrained it. Killed by
  `rejects_a_habituation_floor_outside_zero_exclusive_to_one_inclusive`, whose
  four rejected values and two accepted ones are each the only input that
  separates one of the three mutants - the doc comment on the test says which
  is which.

- `crates/terri-core/src/components.rs:265` - `> 0.0` to `>= 0.0` in
  `Habituation::decay`, which decides whether an entry that has decayed away
  is dropped. There WAS a test for the drop, and it could not see this:
  `habituation_decays_and_spent_entries_are_dropped` runs two extra ticks past
  the crossing point, so the value goes negative, and a negative is dropped by
  both comparisons. The mutation is observable on exactly one value.
  `an_entry_that_decays_to_exactly_zero_is_dropped_rather_than_kept` arranges
  it: bump an entry to exactly the tuned decay rate and tick once, so it lands
  on `rate - rate`, which is exactly 0.0 for any finite rate.

  Worth noting as a shape rather than as a bug. A test that walks a value
  *past* a boundary looks like a boundary test and is not one; the fixture has
  to stop ON it.

### Accepted, with the argument

```
crates/terri-data/src/compile.rs:752:38: replace + with - in flood_fill
crates/terri-data/src/compile.rs:752:53: replace + with - in flood_fill
```

**Genuinely equivalent mutants.** The line is

```rust
let (nx, ny) = (x as i64 + dx, y as i64 + dy);
```

inside `for (dx, dy) in [(1i64, 0i64), (-1, 0), (0, 1), (0, -1)]`. The offset
set is symmetric about the origin on both axes, so negating `dx` maps
`(1, 0)` to `(-1, 0)` and `(-1, 0)` to `(1, 0)`: the four neighbours VISITED
are the same four tiles, merely enumerated in a different order. The same
holds for `dy`. A flood fill's result does not depend on the order it pushes
neighbours, so no observable behaviour changes and no test can distinguish
them.

They are new to the baseline rather than newly surviving: the five-room lot is
the first content to make `flood_fill` do real work, so these mutants are the
first to be *reachable* rather than unviable.

The fix that would kill them is to write the offsets asymmetrically - two
loops, or `[(1, 0), (0, 1)]` plus explicit negation - and that is worse code
for the sake of a mutation score.

### The habituation multiplier: seven survivors from one untested line

The sweep's largest single finding, and it was not caused by anything M2b
changed - it was uncovered by it.

`select_action` carried the habituation arithmetic inline:

```rust
let benefit_scale = 1.0 - hab * (1.0 - content.0.tuning.habituation_floor);
let delta = if *delta > 0.0 { delta * benefit_scale } else { *delta };
```

Eight mutants on those two lines, seven of them real. Hand-mutation confirmed
each survived the ENTIRE workspace suite.

**Why nothing caught it.**
`habituation_scales_the_benefit_and_leaves_a_cost_at_full_strength` exists to
pin exactly this behaviour and cannot: it never calls `select_action`. It
computes `BENEFIT * scale` itself and compares its own arithmetic against
itself, so it stays green with the production guard deleted. That is
testing-protocol rule 3's forbidden shape, and [L5]'s family. Every other
habituation test reads the component rather than scoring with it, and the
world-hash golden vector's scenario holds ONE object, so a wrongly scaled
score has nothing to out-rank and the sim's choice is unchanged at any
multiplier ([L36]).

**Why a behavioural test would not have been enough either.** The obvious
repair is "habituate the sim on object A, assert it picks B". Three of the
four `benefit_scale` mutants still yield a multiplier below 1 for a partly
habituated sim, so A still loses and the test still passes. Only magnitudes
separate them: at full habituation the four give 1.55, -0.818, -0.45 and
-1.22 against the correct 0.45.

**The fix** extracts `benefit_scale` and `scaled_delta` into `advertise.rs`
and pins them with golden values at both ends of the range plus the midpoint.
Verified by hand-mutation, with the harness calibrated first on a mutation
known to be caught: seven killed, one survivor left, listed below.

Worth recording as a shape: **arithmetic that cannot be called cannot be
pinned with a golden value**, and a multiplier needs one. Inlining it into a
system whose only observable output is a choice means the best any test can do
is bound its sign.

### Accepted: the sign guard's boundary

```
crates/terri-sim/src/systems/advertise.rs:59:14: replace > with >= in scaled_delta
```

`if delta > 0.0 { delta * scale } else { delta }`. The two comparisons differ
only at `delta == 0.0`, and there both arms return `0.0` - the multiplied arm
gives `0.0 * scale`, which is `0.0` for every finite scale, and content
validation rejects a non-finite one. `-0.0` behaves the same way. Equivalent,
and unkillable without inventing a distinction the type does not have.

Its sibling `advertise.rs:138:18` in `score_advertisement` is the same
comparison for the same reason and has been in the baseline since M1c; it
moved from line 82 only because the two new functions sit above it.

**A note on the baseline's format.** Entries are file:line:column, so adding
code above a baselined mutant moves it and it reads as one entry disappearing
and another appearing. That happened here. Whoever sees an unfamiliar entry
should check whether it is the same mutation at a new line before treating it
as new.

### M2c: the drift note above came due, and three real survivors were killed

The flood_fill equivalents moved from `compile.rs:752` to `compile.rs:1011`
when `compile_personalities` and `compile_household` were inserted above
them - the same mutations, the same argument, new coordinates. The baseline
entries were updated in place; nothing about their equivalence changed.

The same sweep found three REAL survivors on `compile_household`'s spawn
bounds check, all on the negative side: with no test spawning at a negative
coordinate, `sim.x < 0.0` was free to become `== 0.0` or `<= 0.0` and the
first `||` to become `&&`. Killed by extending
`rejects_a_spawn_off_the_lot_or_inside_something_solid` with one negative
per axis (the `&&` mutant is only visible when exactly one clause fires)
plus `x = 0.0` accepted, which is the input that separates `<` from `<=`.
Worth keeping as a shape: a bounds check tested only from its positive
side is half a bounds check, and `as u32` saturates a negative to 0, so
the untested half fails as a silently wrong spawn position rather than as
an error.
