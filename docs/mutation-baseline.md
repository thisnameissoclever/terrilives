# Mutation Testing Baseline

Re-recorded 2026-07-27 on the tree that closes the `select_action`
distance and comparison gaps. Previous baseline: 2026-07-27 at commit
`7415d98`, after Task 7 of M0.

```
cargo mutants --package terri-core --package terri-sim --test-workspace true --timeout 60
236 mutants tested in 7m: 26 missed, 203 caught, 7 unviable
```

**Mutation score: 89%** (203 caught of 229 viable), up from 83%
(189 of 229). Fourteen survivors closed, none added.

CI gates on **no new** survivors via `--in-diff`, not on zero survivors.
This list is the accepted debt. Anything here is a known gap,
deliberately recorded rather than silently tolerated.

## A trap worth knowing before you run this yourself

The first run reported **51** missed. Eleven of those were artifacts: by default
`cargo mutants` tests each mutant against **only the mutated package's own test
suite**. Most of `terri-core`'s behaviour is exercised through `terri-sim`, so
mutations like `Path::next_step -> None` were reported as surviving when the
real workspace suite catches them instantly (`distance 11.401754`).

**Always pass `--test-workspace true` in this repository.** Without it the tool
produces a report that fails to find anything, which is the same shape as the
bug the tool exists to catch.

## Closed since the previous baseline (14 mutants)

Six tests: five in `action.rs`, one in `advertise.rs`. Every one of the
fourteen was verified individually by hand as well - mutation applied,
suite run, failing test recorded, source restored and confirmed
byte-identical by `git hash-object` - because `cargo mutants` is a
backstop and not a substitute for rule 1 of `testing-protocol.md`.

| Mutant | Now caught by |
|---|---|
| `action.rs:47:35` `-` to `+` and `-` to `/` | `distance_uses_the_x_offset_between_agent_and_object` |
| `action.rs:48:35` `-` to `+` and `-` to `/` | `distance_uses_the_y_offset_between_agent_and_object` |
| `action.rs:49:37` `+` to `-` | the y-offset test (negative radicand, NaN, nothing selected) |
| `action.rs:49:37` `+` to `*`, `49:32` `*` to `/` | both offset tests (distances collapse to a tie; the index tiebreak then hands the win to the wrong object) |
| `action.rs:49:42` `*` to `+` | `distance_is_weighed_against_benefit_rather_than_merely_consulted` |
| `action.rs:60:27` `>` to `==` and `>` to `<` | the three distance tests |
| `action.rs:60:27` `>` to `>=`, `60:64` `&&` to `\|\|` | `a_tied_object_with_a_higher_index_cannot_displace_the_incumbent` |
| `action.rs:64:22` `>` to `>=` | `a_score_exactly_at_the_action_threshold_selects_nothing` |
| `advertise.rs:59` `+` to `-` | `the_time_cost_offset_is_added_rather_than_subtracted` |

The whole cluster existed for one reason: **every `select_action` test
used exactly one smart object**, and with a single candidate the
distance term cannot change which object wins. Any test added here in
future that intends to constrain selection needs at least two
candidates, or it constrains nothing.

Two details worth keeping if these tests are ever edited:

- The **far** object is spawned first in the offset tests, so it holds
  the lower entity index. Mutations that flatten both distances into a
  tie then lose to the index tiebreak and the test fails, instead of
  passing on an accidental tie it never meant to create.
- `a_score_exactly_at_the_action_threshold_selects_nothing` builds a
  score **bit-identical** to `ACTION_THRESHOLD`, which is the only input
  that can tell `>` from `>=`. Every term is exact in binary32: hunger
  decays to exactly 50.0, giving urgency 0.125; 2 tiles at 0.25 tiles
  per tick plus 7 duration ticks plus 1 is a denominator of exactly 16;
  and `6.4f32`, `0.8f32`, `0.05f32` share a mantissa. Changing any of
  those numbers, or `TILES_PER_TICK`, or `ACTION_THRESHOLD`, breaks the
  construction - the test asserts the bit equality as a precondition, so
  it will say so rather than quietly becoming an ordinary inequality.

## Group A: dead or not-yet-consumed code (9 mutants)

Nothing tests these because nothing *uses* them. All three were independently
flagged in human code review before the tool existed, which is a useful
cross-check that reviewers and the tool see the same territory.

| Location | Note |
|---|---|
| `clock.rs:32` `is_hour_boundary` (2) | No consumer until M3 Tier 2 story progression |
| `components.rs:66` `Path::is_complete` (3) | Genuinely redundant; `follow_path` uses `next_step().is_none()` |
| `grid.rs:28,32` `width`/`height` (4) | Unused accessors |

## Group B: real test gaps (16 mutants)

### Pathfinding internals (8)

`grid.rs:72` (`||` to `&&` in the walkability guard - no test starts an agent
on an unwalkable tile), `grid.rs:102,115` (neighbour offsets and f-score), and
the four `heuristic` mutants. Note `heuristic -> 0` is an **equivalent mutant**
for correctness: it degrades A* to Dijkstra, which still returns optimal paths.
The `+`-to-`*` and `-`-to-`+` variants change admissibility and are real gaps.

(The previous baseline headed this group "(9)"; the count was always 8.
The group totals were right, the heading was not.)

### Movement arithmetic (4)

`movement.rs:28,35,42,43` - the normalisation and step arithmetic.

### Scoring boundaries (2)

`advertise.rs:31` - the NaN guard's `>` versus `>=`, on both the deficit
and the delta term. The `advertise.rs:59` denominator guard that used to
sit here is now closed.

### Hash (2)

`hash.rs:15` and `lib.rs:101` - the latter is the `-1.0` "no Hunger component"
sentinel, unexercised because every hashed entity currently has `Hunger`.
Already recorded as a gap in Task 7's review.

## Group C: equivalent mutants (1)

Not debt. These cannot be killed by any correctness test, so a future
run that reports them is reporting nothing actionable.

### `action.rs:60:82` `<` to `<=`

`object.index() < best_e.index()` versus `<=`. The two differ on exactly
one input, `object.index() == best_e.index()`, and that state is
unreachable:

1. `best_e` was captured from an **earlier iteration of the same
   `objects` query**, inside one agent's loop body (`best` resets to
   `None` per agent). A `bevy_ecs` query yields each matching entity
   once per iteration, so `object != best_e` wherever the clause runs.
2. `Entity` is an `(index, generation)` pair, and the generation exists
   precisely so a **reused** index can be distinguished from the
   original. At most one *live* entity holds a given index at a time,
   and both of these are live, so their indices differ.

Since the differing input cannot occur, the two programs compute the
same function. Writing a test would mean constructing two live entities
that share an index, which the ECS does not permit.

This is a claim about one relational operator only. The other four
mutants of the same expression - `60:27` in three forms and `60:64` -
are all caught, so the tiebreak clause itself is pinned.

`heuristic -> 0` in `grid.rs:128` is arguably a second member of this
group (A* degraded to Dijkstra still returns optimal paths), but it is
left in Group B because the *specific path* returned can differ, and the
project's determinism guarantees care about which path comes back.

## How to reproduce

```bash
cargo mutants --package terri-core --package terri-sim --test-workspace true --timeout 60
```

Roughly 7 to 8 minutes on the development machine. Update this file when
the baseline changes, and say which entries were closed and which were
added.
