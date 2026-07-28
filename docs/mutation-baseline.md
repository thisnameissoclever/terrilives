# Mutation Testing Baseline

**This document is the argument. `docs/mutants-baseline.txt` is the
contract.** That file, not this one, is what CI compares against; it is the
sorted contents of `mutants.out/missed.txt` from a full sweep.

Re-recorded 2026-07-28 at the close of M1a, from a full sweep on a clean tree:

```
cargo mutants --package terri-core --package terri-data --package terri-sim \
  --test-workspace true --timeout 60
269 mutants tested in 14m: 5 missed, 237 caught, 27 unviable
```

**Mutation score on viable mutants: 97.9%** (237 caught of 242 viable). The
survivor set fell from 16 to 5 in this task, and the eleven closures are the
whole of the change; no production code moved.

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

**27 of the 269 are unviable, and 13 of those are unviable because of the
content build gate rather than because of the type system.** They are mutants
whose mutated code runs inside `terri-data`'s `build.rs`, rejects the real
`content/*.toml`, and kills the build before any test runs. Six of the thirteen
are in **`terri-core`**, not in the crate that owns the build script:
`NeedId::index`, `NeedId::as_str` and `NeedId::from_name` became build
dependencies of the validator in M1a Task 5, and `terri-core`'s own tests used
to catch them. Nothing is less safe - the build gate detects every one - but
the sweep has stopped vouching for roughly a dozen tests that still exist and
still work. See [L28]. To re-identify them in any future run:

```bash
grep -lE "content is invalid" mutants.out/log/*.log | wc -l
```

Measured here: **13**, unchanged from Task 5. If that number and the caught
count move together in opposite directions, coverage has shifted out of the
test suite and into the build again.

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

## The five accepted survivors

### `grid.rs:102:43` and `102:63` - the neighbour offsets - EQUIVALENT

**Re-derived in this task.** Argument:

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

**Re-derived in this task, and the conclusion changed from the previous
wording.** The old file filed this under "real test gaps" with no analysis;
here is the analysis, because it is what a future test has to exploit.

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
attempted here, because finding one is search rather than reasoning and this
task's budget went to the eleven closures below. It is the single most valuable
remaining entry in this file - it is the only survivor that can produce a wrong
answer rather than merely an unobservable one.

### `advertise.rs:42:18` and `42:36` - the NaN guard - EQUIVALENT

**Re-derived in this task**, and these are the two entries the CI gate was
about to fail on: M1a Task 6 moved them from line 32 to line 42, and a
byte-for-byte comparison reads a shifted line as a new survivor.

```rust
if !(deficit > 0.0) || !(delta > 0.0) || !(distance >= 0.0) {
    return 0.0;
}
```

`>` and `>=` differ on exactly one input each: `deficit == 0.0`, and
`delta == 0.0`. On both, the two programs return the same value.

- With `>`, the guard fires and the function returns `0.0`.
- With `>=`, the guard does not fire, and the function computes
  `(urgency * delta) / (time_cost + 1.0)`. `urgency` is `d * d * d` over a
  value clamped to `0.0..=1.0`, so it is in `0.0..=1.0`; the denominator is at
  least `1.0` because the third guard has already established
  `distance >= 0.0`. Either the numerator's `urgency` is zero (the deficit
  case) or its `delta` is zero (the delta case), so the quotient is `0.0`.

The one input where the two genuinely take different branches is
`delta == -0.0`, which content validation accepts because `-0.0 < 0.0` is
false. There the mutant reaches the arithmetic and produces `-0.0`. That is
still `== 0.0` under every f32 comparison the caller makes - `score += ...`,
`score > best_score`, `score > ACTION_THRESHOLD` - so no observable behaviour
differs, and no assertion could tell them apart without inspecting the sign
bit.

**Note the asymmetry with the third clause.** `distance >= 0.0` mutated to
`> 0.0` is **caught**, and correctly: a distance of exactly zero is an agent
already standing on the object, which must score normally rather than zero.
That clause is a range check; the other two are NaN rejections that happen to
be written as comparisons. The guard is a single line doing two different jobs,
which is why one third of it is killable and two thirds are not.

**When this expires:** if `score_advertisement` ever returns something other
than a plain product over the clamped urgency - a floor, an additive term, a
different denominator - the "both sides reach 0.0" argument has to be redone.

## Closed in this task (11 mutants, no production code changed)

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

## Removed from the baseline in this task (4 entries, none of them debt)

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

The 2026-07-27 entry for Task 4 recorded a first `terri-data` run with **1**
missed - `compile.rs:24:14: replace < with <= in check_number`, meaning nothing
pinned whether a decay rate of exactly zero is legal content. It is;
`zero_is_a_legal_decay_rate_and_a_legal_advert` now says so. Worth keeping
because no amount of reading the code could have settled it: the code cannot
state which side of `<` was intended.
