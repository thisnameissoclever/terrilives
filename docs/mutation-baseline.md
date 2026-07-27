# Mutation Testing Baseline

Recorded 2026-07-27 at commit `7415d98`, after Task 7 of M0.

```
cargo mutants --package terri-core --package terri-sim --test-workspace true --timeout 60
236 mutants tested in 7m: 40 missed, 189 caught, 7 unviable
```

**Mutation score: 83%** (189 caught of 229 viable).

CI gates on **no new** survivors via `--in-diff`, not on zero survivors. This
list is the accepted debt. Anything here is a known gap, deliberately recorded
rather than silently tolerated.

## A trap worth knowing before you run this yourself

The first run reported **51** missed. Eleven of those were artifacts: by default
`cargo mutants` tests each mutant against **only the mutated package's own test
suite**. Most of `terri-core`'s behaviour is exercised through `terri-sim`, so
mutations like `Path::next_step -> None` were reported as surviving when the
real workspace suite catches them instantly (`distance 11.401754`).

**Always pass `--test-workspace true` in this repository.** Without it the tool
produces a report that fails to find anything, which is the same shape as the
bug the tool exists to catch.

## Group A: dead or not-yet-consumed code (9 mutants)

Nothing tests these because nothing *uses* them. All three were independently
flagged in human code review before the tool existed, which is a useful
cross-check that reviewers and the tool see the same territory.

| Location | Note |
|---|---|
| `clock.rs:32` `is_hour_boundary` (2) | No consumer until M3 Tier 2 story progression |
| `components.rs:66` `Path::is_complete` (3) | Genuinely redundant; `follow_path` uses `next_step().is_none()` |
| `grid.rs:28,32` `width`/`height` (4) | Unused accessors |

## Group B: real test gaps (31 mutants)

### The largest and most important cluster: `select_action` distance arithmetic (8)

`action.rs:47-49`, the `dx`/`dy`/`sqrt` distance computation, is **completely
unconstrained**, because every existing test uses exactly one smart object.
With one candidate, distance cannot change which object wins.

**This means the core "pick the best object" logic has no test that actually
picks between objects at different distances.** That is the heart of the game's
decision-making per [D6], and it is the highest-value gap on this list.

### Selection comparison boundaries (6)

`action.rs:60` (`>` vs `==`/`<`/`>=`, `&&` vs `||`, `<` vs `<=`) and
`action.rs:64` (the `ACTION_THRESHOLD` comparison). Partly covered by the
golden tie-break test; the strict-versus-non-strict boundaries are not.

### Pathfinding internals (9)

`grid.rs:72` (`||` to `&&` in the walkability guard - no test starts an agent
on an unwalkable tile), `grid.rs:102,115` (neighbour offsets and f-score), and
the four `heuristic` mutants. Note `heuristic -> 0` is an **equivalent mutant**
for correctness: it degrades A* to Dijkstra, which still returns optimal paths.
The `+`-to-`*` and `-`-to-`+` variants change admissibility and are real gaps.

### Movement arithmetic (4)

`movement.rs:28,35,42,43` - the normalisation and step arithmetic.

### Scoring boundaries (3)

`advertise.rs:31` (the NaN guard's `>` versus `>=`) and `advertise.rs:59`
(the `time_cost + 1.0` denominator guard; the existing `is_finite` test passes
even with `- 1.0`, which yields a negative score rather than an infinity).

### Hash (2)

`hash.rs:15` and `lib.rs:101` - the latter is the `-1.0` "no Hunger component"
sentinel, unexercised because every hashed entity currently has `Hunger`.
Already recorded as a gap in Task 7's review.

## How to reproduce

```bash
cargo mutants --package terri-core --package terri-sim --test-workspace true --timeout 60
```

Roughly 7 minutes on the development machine. Update this file when the
baseline changes, and say which entries were closed and which were added.
