# Design: make `social` satisfiable, and make an unsatisfiable need a red test

**Date:** 2026-07-29
**Resolves:** [C2] in `docs/alpha-feel-notes.md`

## The problem

`content/needs.toml` declares `social`. No interaction in
`content/objects.toml` advertises it. It decays at 0.035 a tick like every
other need, reaches zero at about tick 2 857 - 4.8 minutes at 1x - and stays
pinned there for the rest of the session.

It has no behavioural effect today, because nothing scores a need no object
advertises. That is exactly why nothing in the suite notices: **"nothing
scores it" and "nothing tests it" are the same condition.** It becomes
player-visible the moment M1b Task 7's need bars land - seven bars, one of
them always empty, fillable by no action in the game, with no explanation.

## The decision

Two coherent fixes were considered.

**Chosen: give an object a small positive `social` advert.** Cheapest change,
honest about being a placeholder - `social` is meant to be satisfied by other
sims, which is M2 - and it survives M2 rather than being undone by it.

**Rejected: stop declaring `social` until something can satisfy it.** It is
the more literally honest option and it is the one that moves the world-hash
golden vectors, but removing the `NeedId` variant renumbers `Fun` 5 -> 4 and
`Comfort` 6 -> 5 and reaches `needs.rs`, `GOLDEN_PACK_BYTES` in `compile.rs`,
the `[f32; 7]` fixtures in `pack.rs`, both content files, both world-hash
vectors, and the M1b plan's "seven bars". M2 then puts the variant back and
moves every one of them a second time.

## [D1] The content change

`content/objects.toml`, the television's `watch_tv`:

```toml
advertises = { social = 14.0, fun = 30.0 }
```

**Why the television.** The sofa's exact advert list is pinned by
`the_shipped_pack_carries_a_multi_need_advert_and_a_negative_one`, and its
objects.toml comment builds an argument on "neither 18 fun nor 34 comfort
would beat the television's 30 fun on its own, and together they can" - a
third need on the sofa muddies the one comparison that comment exists to
make. The television also already has `slots = 2`, so two sims watching
together is the natural M2 reading of the same object.

**Why 14.** The file's rule 1 makes "no two deltas are equal" load-bearing,
and the taken magnitudes are 40, 100, 70, 12, 95, 30, 18, 34, 22, 26. `12`
is free as a *signed* value, because the shower's is `-12.0`, but a mutation
that dropped a negation would make the two indistinguishable - which is the
class of bug rule 1 exists to keep visible. 14 collides with nothing on
either reading.

**Why that magnitude.** `score_advertisement` returns
`urgency * delta / (time_cost + 1)`, summed across a sparse advert list. From
the sim's usual position the television's denominator is roughly 78 ticks -
55 duration plus three to eight tiles of travel at 0.25 tiles a tick - and
`content/tuning.toml` records the sim's best available score as 0.017 / 0.039
/ 0.050 at the 5th / 50th / 95th percentile. Solving `14 * d^3 / 78 = 0.039`
gives `d ~ 0.60`, so `social` should settle near **40** rather than at either
extreme: the bar moves, the television is worth walking to when the sim is
lonely, and it never fully satisfies - which is the honest reading for a
placeholder M2 replaces with actual sims.

**That is an estimate, not a measurement**, which is why [D5] exists. The
number that ships in the comment is the measured one.

> **Superseded by measurement, 2026-07-29: the delta shipped is 24, not 14,
> and the reasoning above is backwards.** The estimate landed in the right
> band - 14 does hold `social` at 21-52 - but "small so it does not distort
> behaviour" tunes the knob in the wrong direction. Because urgency is
> cubed, a smaller delta makes the television MORE dominant: 8 gave it 30.1%
> of interactions, 14 gave 21.1%, 24 gave 14.4%. At 24 every other need
> returns to roughly its no-advert level while `social` still sits lowest in
> the house. The table is in [D5]'s outcome below and in [C2] of
> `docs/alpha-feel-notes.md`. The uniqueness argument for avoiding 12 stands
> unchanged and applies to 22 and 26 as well.

## [D2] The new test

`every_declared_need_can_be_satisfied`, in `crates/terri-data/src/lib.rs`
beside `every_declared_object_is_placed_on_the_lot`, which is the same shape
of check over the same compiled pack.

Walks `pack().objects -> interactions -> advertises` and asserts every
`NeedId::ALL` variant appears with a **delta strictly greater than zero**.

**Why positive rather than present.** "Appears in some advert list" is
satisfied by a need that only ever appears as a *cost*: the shower's
`energy = -12.0` is exactly that shape. Energy is separately advertised
`+100` by the bed so the weaker rule passes today either way, but the
invariant this test exists to state is "a declared need has a way to be
**satisfied**", and a need advertised only as a cost is as unsatisfiable as
`social` is today.

It composes with its neighbour rather than duplicating it: that test already
guarantees every declared object is placed on the lot, so "advertised" here
implies "reachable" without this test re-deriving it.

Per testing-protocol rule 5 it asserts the pack is non-empty first - a pack
with no objects would otherwise fail for a reason that is not the one the
test names. Per rule 6 the name implies its own mutation. The failure message
names the need and both ways out, so whoever trips it in future inherits
[C2]'s decision rather than a bare assertion.

## [D3] Collateral

`the_shipped_pack_carries_a_multi_need_advert_and_a_negative_one` still
passes - it pins the sofa's list and the shower's sign, neither of which
move - but its doc comment's claim that the sofa is "the one object in
shipped content that advertises two needs" becomes false. Comment only.

The television's own objects.toml comment gains the placeholder rationale,
the measured equilibrium, and a pointer to M2.

## [D4] Golden vectors

**Expected outcome: neither moves.** Both scenarios contain exactly one
object, the shipped fridge - `build_scenario` in `crates/terri-sim/src/lib.rs`
and the mirrored spawn sequence in `web/tests/bridge.test.ts`. `world_hash`
covers the clock plus per-entity `(index, x, y, seven need levels)`. A social
advert on the television touches neither the fridge nor social's decay rate,
so it cannot reach either digest.

Verified natively and on wasm32 separately per [L13], rebuilding the wasm
before `npm test` per [L8] - "unchanged" is only trustworthy if the artifact
under test was actually rebuilt, and skipping the rebuild measures the
previous `.wasm` and proves nothing either way.

Both comments gain the M1c-style paragraph recording *why* this change is
invisible to a one-object scenario, per [L36].

**If either vector moves, that is a finding: stop and report it rather than
updating the constant.** Nothing in this change should be able to reach the
fridge, so a move means something else did.

## [D5] Measurement

Rebuild the throwaway harness [O1] describes - `Sim::new_from_shipped_lot()`,
the agent `web/src/main.ts` spawns at tile (8, 6) with hunger 25, 12 000
ticks - and report:

- `social`'s floor and its equilibrium band over the run
- the television's share of interactions, before and after
- whether any other need's satisfaction degraded, since the television now
  wins more often and the sofa and bookshelf are what it wins against

If `social` still pins at zero, or the sim parks at the television and stops
eating, 14 is the wrong number and the measurement comes back before any
change to it. The measured figures replace the [D1] estimate in the
objects.toml comment, per `content/tuning.toml`'s standing instruction to
"replace them with new measurements rather than with new guesses".

### Outcome

The harness reproduced [O1]'s 121 interactions exactly on the no-advert
content, which is what makes the rows comparable.

| delta | social band | television's share |
| --- | --- | --- |
| none | 0 from tick 2 857, 9 143 ticks pinned | 6.6% (8 of 121) |
| 8 | 0 on 699 ticks, mean 8.3 | 30.1% (44 of 146) |
| 14 | 21-52, floor 17.1, mean 36.9 | 21.1% (28 of 133) |
| **24, shipped** | **33-69, floor 30.0, mean 48.9** | **14.4% (18 of 125)** |

24 chosen: every other need is back to roughly its no-advert level (hygiene
79.0 against 79.2, bladder 72.6 against 75.7, 125 interactions against 121)
while `social` holds a live band and is still the lowest need in the house
by 14 points - the intended placeholder reading.

**One regression found and recorded rather than absorbed:** the bookshelf
goes from 3 interactions to zero, and stays at zero for every delta tried
including 8. Written up as [C6] in `docs/alpha-feel-notes.md` with three
candidate fixes; not fixed here, because it is a balance change of the same
kind as [C1] and belongs in a content pass. It is deliberately not something
[D2]'s test catches - `fun` is still satisfiable - and it is not statically
checkable at all, since "an object nothing ever chooses" is a property of a
12 000-tick run rather than of the compiled pack.

## [D6] Documentation

- `docs/alpha-feel-notes.md` [C2] gains a resolution note: the fix, the
  measured equilibrium, and that this is a placeholder M2 supersedes.
- `docs/lessons-learned.md` gains an entry for the generalisable part - a
  declared need with no advert was invisible to the entire suite because
  nothing scored it, and [D2] is what converts that class of gap into a red
  test.

## Out of scope

- Raising the sink, toilet and fridge durations ([C1]). Separate balance task.
- `select_action`'s `best_seen` bug ([C3]). Separate task, needs two sims.
- M1b Task 7's need bars themselves. This change is what makes that task
  shippable, not part of it.
