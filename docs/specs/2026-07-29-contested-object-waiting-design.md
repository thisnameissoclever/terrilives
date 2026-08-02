# Contested Object Waiting - Design

Status: agreed, and **partly overtaken by events**. Read this first.

The finding this was written against, [C3] of `docs/alpha-feel-notes.md`, was
fixed independently and in parallel by other work on `m1b-interaction`, in
"Make actions long enough to see, and stop lying to an outbid sim". That fix
and the one designed here reached structurally the same answer for the core
change: a contested object is scored so that the agent can see it, and is
never offered as a candidate so it cannot be double-booked.

**Sections [D1] through [D4] and [D6] are what remains**, and they are what
the accompanying change implements: the tuning knob deciding how much a
contested object is worth, and the marker recording that an agent's best
option is somebody else's. Without the knob, the shipped behaviour is this
design's `contested_score_multiplier` pinned at 1.0 - every outbid sim waits,
however little it wanted the thing.

**[D5] and [D7]'s first two tests describe work that already exists** and are
kept for the reasoning rather than as instructions. [D8]'s measurements have
been re-taken against the merged base and are recorded in the vector's own
comment; the figures below are from the superseded branch.

Section IDs are stable and are not renumbered, including for the sections
events overtook.

## Why

`docs/alpha-feel-notes.md` [C3]. `select_action` skips an object that another
agent has taken **before** that object's score reaches `best_seen`, so a sim
whose only worthwhile option was just claimed leaves the loop with `best_seen`
at `f32::NEG_INFINITY` and is marked `Restless`.

`Restless` is documented in `crates/terri-core/src/components.rs` as "every
candidate it can reach scored at or below `idle_threshold`", and `idle::wander`
reads it as exactly that. For an outbid sim the marker is **false**, and the
visible consequence is a sim strolling away from something it plainly wanted.

Three exclusions can drop an object before it reaches `best_seen`, and they are
not equivalent:

- **[E1]** `claimed.contains(&object)` - taken by a lower-indexed agent on this
  same tick. `crates/terri-sim/src/systems/action.rs`, in the object loop.
- **[E2]** the query's `Without<Reserved>` - reserved on an earlier tick, so
  the object is never yielded at all.
- **[E3]** `grid.find_path` returning `None` - no route to the object.

[E1] and [E2] describe a condition that **resolves on its own**, because
interactions end. [E3] does not. This design changes [E1] and [E2] and leaves
[E3] exactly as it is; see [D5].

The existing fallback is not the defect and is not being changed: an outbid sim
that can see anything clearing `action_threshold` already takes it. The defect
is confined to what `best_seen` reports when nothing available clears the bar.

**Unobservable in the shipped page, which spawns one sim.** It is the first
thing that goes wrong with two, and a household of up to six sims is M1 scope
(`docs/FEATURES.md`, M1 - Core loop).

## [D1] A busy object is scored, not hidden - and it is worth less

A claimed or reserved object contributes its score to `best_seen`. It is
**never** pushed into `candidates`, at any value of any knob, so it can never
be selected and double-booking remains impossible by construction.

How much it contributes is a new tuning knob, `contested_score_multiplier`, per
[D-1]'s standing rule that every value governing the system lives in
`content/tuning.toml`.

This knob does exactly one thing: **it sets how badly a sim must want a busy
object before it will stand and wait for it rather than stroll off.** A sim
waits when

```
busy_score * contested_score_multiplier > idle_threshold
```

so the raw score at which waiting begins is `idle_threshold / m`. At the
shipped `idle_threshold` of 0.04:

| `m` | waits above a raw score of | behaviour |
| --- | --- | --- |
| 0.0 | never | today's behaviour, restated as a knob |
| 0.25 | 0.16 | waits only when desperate |
| 0.5 | 0.08 | waits when it genuinely wants the thing |
| **0.75** | **0.053** | **shipped value; see [D2]** |
| 1.0 | 0.04 | waits for anything at all |

Two properties are worth stating because they are what make this a single-
purpose knob rather than a second balance lever:

- **It never changes what a sim does, only whether it stands still.** The
  candidate list is untouched, so the softmax draw sees the same objects in the
  same order and consumes the PRNG identically.
- **It cannot make a sim double-book.** The multiplier feeds `best_seen` and
  nothing else.

## [D2] The shipped value is 0.75, and it is a priori rather than measured

**No trace can produce this number today**, because nothing in the shipped
content has two sims and the knob has no effect below two. `tuning.toml` will
say so beside the value, in the style the M1c feel pass established: where a
claim has a number behind it the number is given, and where it does not the
comment says so.

What 0.75 has behind it is arithmetic against measured quantities. From
`docs/alpha-feel-notes.md` [F3], the shipped lot's decisions span scores of
0.059 to 0.276. From [F4], the best *available* score is clipped from above at
`action_threshold` = 0.05, because a sim acts the instant anything crosses it -
but **a busy object's score is not clipped that way**, since the sim cannot act
on it and its deficit keeps growing while it waits.

At 0.75 the waiting bar is a raw score of 0.053, just above `action_threshold`.
The design stance that expresses is: **anything a sim would have acted on, it
will wait for.** The band in which a sim wants a busy object and abandons it
anyway is only `(0.04, 0.053]`; below 0.04 it would have been restless even
with the object free.

**The cost of that stance, stated rather than discovered later.** This is close
to always waiting, so it largely retains the standing-still problem [F4] was
written about: 22.9% of a run motionless, in stretches up to 15.8 real seconds.
Two things bound it, and neither is a guarantee:

- The shipped lot has eight objects, so a sim blocked on one usually has
  another that clears `action_threshold` and acts instead. The freeze needs
  *every* alternative to be below the bar.
- The longest single commitment measured is a 24.1-second sleep ([F1]), which
  is the worst case for how long a blocked sim can be a statue.

`build_scenario` has one object and no alternative at all, so it is the
scenario where this is most visible; [D8] covers what that does to the golden
vector.

**When it becomes measurable, measure it.** The trace that settles this value
is the [O1] harness run against a lot with two or more sims, reporting the
distribution of blocked-sim scores and the share of ticks spent waiting.
Replace the value with a measurement rather than with another guess.

## [D3] The applied form is `score.min(score * m)`

A score can be negative - the object loop's own comment records that an
interaction's costs can outweigh its benefits - and a negative number
multiplied by a factor in `[0, 1]` moves **up**, toward zero. The naive
`score * m` therefore makes a disliked busy object score *better* than the same
object free, which is incoherent.

`score.min(score * m)` states the actual invariant in one line:

> **A busy object is never worth more than the same object free.**

Written as `min` rather than as a branch on the sign for the same reason the
existing `best_seen = best_seen.max(score)` is a method rather than a
comparison: a sign branch is a mutation target whose flipped form is
unreachable at any sane `idle_threshold`, and an unkillable mutant in the
baseline is permanent noise. This shape has no comparison to mutate.

## [D4] Validation

In `compile_tuning`, following the existing order - finiteness first, because
every comparison against `NaN` is false and a `NaN` would otherwise pass the
range check:

1. `check_finite(tuning.contested_score_multiplier, ...)`
2. `!(0.0..=1.0).contains(&m)` is an error. Above 1.0 means a busy object is
   worth more than a free one, contradicting [D3]'s invariant. Below 0.0 flips
   the sign of every busy score.

Inclusive at both ends on purpose. 0.0 is "never wait", which is today's
behaviour and a legitimate thing for a pack to ask for; 1.0 is "always wait".
New `ContentError` variant, modelled on `DurationVarianceOutOfRange`.

**A note on `the_shipped_pack_carries_the_authored_tuning`, because it is easy
to overstate.** That test asserts seven literal values off the compiled pack,
and the bug it exists to catch is a transposition inside `compile_tuning` -
`idle_threshold: tuning.action_threshold`. Distinct values are what let it see
such a swap, but that is far narrower than a rule that knob values must be
unique, and no such rule exists:

- It only concerns the seven knobs it asserts. `wander_attempts` is not among
  them.
- It only concerns fields of the same type, since transposing an `f32` with a
  `u32` does not compile. The group that can collide is the four `f32` knobs:
  0.05, 0.06, 0.04 and 0.4.
- A collision breaks nothing in the game. It costs that one test the ability to
  distinguish that one pair, and nothing else.

`contested_score_multiplier` joins the `f32` group. 0.75 collides with none of the
four, but so would 0.5 or most other values, so this is a fact worth knowing
rather than a constraint on [D2]'s choice.

## [D5] Which exclusions change

`select_action`'s object query becomes

```rust
Query<(Entity, &Position, &SmartObject, Has<Reserved>)>
```

which is the shape `serve_intents` already uses, and

```rust
let unavailable = reserved || claimed.contains(&object);
```

covers [E1] and [E2] identically. Treating them the same matches
`serve_intents`' existing `(reserved && !held_here) || claimed.contains(...)`,
and they mean the same thing to a sim: somebody else has it, and that will end.

`unavailable` guards **only** the `candidates.push`. The interaction loop runs
unchanged, so every interaction's score still reaches `best_seen` through
[D3]'s attenuation.

**[E3] is deliberately not changed.** An object with no path stays invisible to
`best_seen`, so an agent that can reach nothing at all still comes out of the
loop restless. That is [L17]: a sim that stands still forever, needs decaying,
waiting on something it can never walk to. Busy resolves itself; unreachable
does not, and conflating them would reintroduce exactly that failure with a
wall in place of a reservation.

`held_here` has no analogue here and is not needed: `select_action`'s query
carries `Without<Target>`, so an agent it considers holds no reservation of its
own.

**Cost.** Selection now runs one A* per *object* rather than per *unreserved
object*, per idle agent, per tick. At M1's eight objects and at most six sims
that is nothing. `docs/ARCHITECTURE.md` currently states that `select_action`
"scans every unreserved object every tick" and needs correcting; the O(agents x
objects) scale concern it already tracks is unchanged in kind.

## [D6] The `Blocked` marker

A new component in `crates/terri-core/src/components.rs`, beside `Restless`.

**Meaning:** this agent took no action, and the highest-scoring thing it could
see is held by somebody else.

**`Blocked` and `Restless` can co-occur, and the pair is informative rather
than contradictory:** *wanted a busy thing, but not enough to wait for it.*
That is precisely the sim whose penalised score fell under `idle_threshold`,
and it is the state [D2]'s knob exists to move sims into and out of.

**Two writers, and the rule between them.** `serve_intents` runs first and sets
`Blocked` on an agent whose front intent names a reserved object - the case
where a player clicked a busy bed and the sim is visibly waiting its turn. It
already computes `reserved && !held_here` and needs no scoring to do it, so
this costs nothing and creates no second copy of a rule that could drift. That
is the distinction from `Restless`, whose single-writer rule exists to stop the
A*-per-candidate scoring sweep running twice a tick. `select_action` then skips
directed agents entirely, so the two writers cannot disagree about one agent on
one tick.

Both systems clear a stale `Blocked` on the paths where they already clear a
stale `Restless`.

**Status update:** M2g added `stall_reason_of` and the normal selected-person HUD
now reads `Blocked` to explain why a sim is standing still. The paragraph below
records the state and reasoning when this marker originally shipped.

**It had no reader, and that was recorded rather than hidden.** [L41] says an
unread mechanism is dead code and should be deleted rather than tested. That
rule does not apply here, and the distinction is substantive rather than a
convenience: [L41] is about a **guard** - a second line enforcing a rule an
earlier line already enforces, where "defence in depth and untested code are
indistinguishable from inside the suite". `Blocked` is not a guard. Nothing
depends on it being correct, so it cannot silently fail to decide something
that a test would otherwise have caught.

It is one system publishing one fact, which is what `Restless` was before
`wander` existed to read it. Its doc comment names the intended readers - the
selection UI, and the local wander that `docs/alpha-feel-notes.md` [F2] records
as the highest-value change to the wander system - and its tests assert the
marker directly, so it was unread but not untested.

## [D7] Tests

**Every test here uses two real agents.** A single-agent fixture cannot express
contention at all, which is why [C3] went unobserved.

- **[T-1] `an_agent_outbid_this_tick_is_not_told_nothing_is_worth_doing`.** Two
  agents, one object, the loser wanting it enough that the attenuated score
  clears `idle_threshold`. The loser has no `Target`, no `Restless`, and has
  `Blocked`. **Control:** the same loser alone in the same world does act, so
  "not restless" cannot be satisfied by a world with nothing on offer - [L3]'s
  rule applied to a negative assertion. This is the input on which the [E1]
  half is the only thing deciding.
- **[T-2]
  `an_agent_whose_object_was_reserved_earlier_is_not_told_nothing_is_worth_doing`.**
  The winner claims on one tick and the loser is evaluated on the next, so it
  meets a `Reserved` marker rather than a `claimed` entry. Same assertions.
  This is the input on which the [E2] half - the `Without<Reserved>` to
  `Has<Reserved>` change - is the only thing deciding. Separated from [T-1] per
  [L41] rule 1: two mechanisms, two inputs, not one test of the rule.
- **[T-3] `a_busy_object_a_sim_barely_wants_still_sends_it_for_a_stroll`.** A
  matched pair against [T-1] - same fixture, same seed, **only the loser's need
  value moved** - in which the attenuated score falls under `idle_threshold`.
  The loser **is** `Restless` and **is** `Blocked`. This is the only test on
  which `contested_score_multiplier` is the thing that decides; without it the knob
  is decorative and a mutation to it survives. Causal rather than comparative,
  per `docs/testing-protocol.md` rule 3.
- **[T-4] `a_busy_object_is_never_worth_more_than_the_same_object_free`.**
  [D3]'s invariant, including an advert with a negative delta, which is the
  case `score * m` alone gets wrong.
- **[T-5] A sim waiting on a player-directed busy object is `Blocked`.** The
  `serve_intents` writer from [D6], built on the existing
  `a_sim_waiting_for_a_reserved_object_does_not_fall_back_to_autonomy` fixture,
  which already constructs exactly that state.
- **[T-6] Double-booking stays impossible.**
  `contention_resolves_by_entity_order_not_iteration_order` and the reserved-
  object tests stay green, and **deleting the `!unavailable` guard on
  `candidates.push` must turn one of them red by hand.** Verified by deletion
  and byte-identical restore per [L9], not by inspection.
- **[T-7] Content validation** rejects a multiplier outside `[0.0, 1.0]` and a
  non-finite one; the exhaustive-knob and shipped-pack tests carry the new
  value.

## [D8] Three golden vectors move, and each is measured rather than predicted

- `GOLDEN_PACK_BYTES` in `crates/terri-data/src/compile.rs` - a new `f32` in
  the serialised tuning block.
- The native world hash in `crates/terri-sim/src/lib.rs`.
- Its wasm copy in `web/tests/bridge.test.ts`, with the wasm **rebuilt first**
  and the file touched, per [L8] and [L13]. Measured on both targets rather
  than assumed to carry across.

**Unlike [L36]'s two instances, `build_scenario` genuinely exercises this
mechanism, and the check [L36] rule 1 asks for passes.** The fixture is eight
agents and one object: agent 0 claims the fridge and the other seven are the
outbid sims this design is about. `crates/terri-sim/src/lib.rs` records that
those seven "now wander" and that "fourteen of the sixteen coordinates in the
digest move, on almost every tick". Their behaviour is exactly what changes.

**Which of the seven stop wandering is to be measured, not asserted here.**
[L36] reports that agent 4 clears `action_threshold` at a Euclidean 21.4 tiles
and fails it at a path length of 30, so the lower-indexed agents score above
0.05 for the fridge and the higher-indexed ones below it. At `m` = 0.75 the
waiting bar is 0.053, which falls inside that spread, so some agents are
expected to stand and some to keep strolling. The actual split goes in the
vector's comment as a number.

**[C3] and [L36] both need correcting, and that is a finding rather than
bookkeeping.** [C3] states that `build_scenario` "is blind to this knob"
because its seven losers "are `Restless` at *every* value of `idle_threshold`".
After this change that stops being true: their `best_seen` is a real score, so
the fixture becomes sensitive to `idle_threshold` and to `contested_score_multiplier`
for the first time. The fixture is *not* being tuned to make the vector move -
[C3]'s instruction not to do that stands - it becomes sensitive because the
mechanism it always contained is no longer discarded before it can act.

## Documentation to update

- `docs/alpha-feel-notes.md` [C3]: resolved, with the blindness correction
  above.
- `docs/lessons-learned.md`: a new entry. The lesson is not the null check - it
  is that **a marker's doc comment is a claim the code has to keep**, and that
  a single-agent fixture cannot falsify a claim about contention no matter how
  thorough it is. Same family as [L34] and [L41], different trigger.
- `docs/ARCHITECTURE.md`: the "scans every unreserved object" wording in the
  advertisement-scan section, and the `Blocked` marker beside `Restless` in the
  system order.
- `content/tuning.toml`: the new knob, with [D2]'s arithmetic and its explicit
  a-priori flag.

## Non-goals

- **Waiting *near* the contested object.** A blocked sim stands where it
  already is. Pathing to a tile beside the object needs a waiting-spot notion,
  collision handling and a release rule; that is a feature.
- **A reservation queue.** No ordering among waiting sims, no first-come
  guarantee. The sim that gets the object next is whichever one wins the next
  tick's selection.
- **Local wander for blocked sims.** `docs/alpha-feel-notes.md` [F2] records
  that a stroll reads as commuting and that bounding it to a radius is a design
  change to [D-5] rather than a tuning one. `Blocked` is the hook that change
  will read; it is not being made here.
- **[E3], unreachable objects.** See [D5].
