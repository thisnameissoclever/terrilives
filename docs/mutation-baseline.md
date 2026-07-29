# Mutation Testing Baseline

**This document is the argument. `docs/mutants-baseline.txt` is the
contract.** That file, not this one, is what CI compares against; it is the
sorted contents of `mutants.out/missed.txt` from a full sweep.

**Latest sweep: M1c Task 1, 2026-07-28**, full, on a clean tree at `f4458fb`,
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

## Read the three counts, not the score

A sweep reports **caught**, **missed** and **unviable**, and only the first two
say anything about the tests.

- **Missed** is behaviour nothing constrains. That is the gate.
- **Unviable** means the mutated code did not compile or did not build, so the
  test suite never ran against it. By [L21] that is **no evidence at all about
  the tests** - not a pass, not a failure. It must never be added to caught.
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

## The four accepted survivors

Was five. M1b Task 3 removed one by removing the operator it mutated; see
the `advertise.rs` section below.

### `grid.rs:102:43` and `102:63` - the neighbour offsets - EQUIVALENT

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

### `grid.rs:115:44` - the f-score - A REAL GAP, not an equivalent mutant

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

### `advertise.rs:79:18` - the deficit clause of the NaN guard - EQUIVALENT

**Re-derived in M1b Task 3**, where the guard changed shape and moved from
line 42 to line 79. Both halves of that sentence matter: CI compares
survivor strings byte for byte, so the line move alone would read as a new
survivor plus a stale entry, and the shape change means the previous
argument had to be redone rather than carried.

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
