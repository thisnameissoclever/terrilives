# Needs Modulation - Forward Design

Status: **architectural intent, not scheduled.** One part of it shipped (the
base-rate retune); the rest is written down because it changes the shape of
`decay_needs` and of scoring, and both are cheap to shape now and expensive to
reshape later.

Four requests, in the order they arrived. [N1] is done. [N2] is half done.
[N3], [N4] and [N5] are not started.

---

## What shipped

**[N1] Every need drains more slowly, and hunger by more than the rest.**

All seven `decay_per_tick` rates are multiplied by roughly 0.75 and hunger by
0.6, because hunger and bladder between them were taking 54% of all
interactions and the rest of the house rarely got a turn. Hunger now drains
from full in 1 613 ticks - 2.7 real minutes at 1x, about 27 sim-hours.

Measured over 12 000 ticks before and after:

| | before | after |
| --- | --- | --- |
| interactions | 126 | 94 |
| fridge share | 27.8% | 23.4% |
| hunger floor | 18.0 | 22.3 |
| hygiene floor | 42.7 | 51.9 |
| back-to-back repeats | 5.6% | 3.2% |
| **motionless** | **12.0%** | **25.4%** |

**The last row is the cost and it is worth stating plainly.** Slower needs mean
less to do, and a sim with nothing to do wanders and pauses. A quarter of the
run is now spent standing still, against roughly 15% before. That is arguably
correct - a sim whose worst need is at 35% has no reason to hurry - but it is
also the single most visible thing a sim can do wrong, and `idle_threshold` in
`content/tuning.toml` is the knob that trades it back. Nothing here fixes it;
[N4] is the mechanic most likely to, by giving the sim reasons to prefer
variety over repetition.

---

## [N2] Activity coupling: effort should cost more than rest

**Asked for:** hunger drains slowly by default but faster while the sim is
doing something that also drains energy - exercise, or an energetic social
activity.

The base-rate half shipped. The coupling half is not built, and **there is
nothing to couple to yet**: exactly one interaction in the game drains energy,
the shower's `energy = -12.0`, and no content describes exercise.

### What it needs

An interaction would declare that it is *effortful*, and `decay_needs` would
consult what the agent is currently doing. Today it consults nothing - it reads
a global table by need index and nothing else - so this is the change that
turns a lookup into a computation.

The natural expression, given the content model already in place, is that
**effort is derived rather than declared**: an interaction that advertises a
negative delta on `energy` is by definition effortful, and its magnitude is the
degree. That gets the mechanic for free from content that already exists, needs
no new field, and cannot get out of step with the energy cost a designer
authored. The shower would then make a sim slightly hungrier, which is right.

The alternative - an explicit `effort` field - is worth having only if
something should be effortful without costing energy, and no example of that
has come up.

### The trap

**Do not multiply the base rate by a factor derived from the current activity
and leave it there.** A sim that is mid-shower drains hunger faster; a sim that
stops mid-shower must stop draining faster on that same tick. That means the
modulation is a function of state read fresh every tick, not a value written
onto the agent when an interaction starts. Written-on state is the version that
survives a cancelled interaction and leaves a sim permanently ravenous.

---

## [N3] Per-sim affinities: personality as a rate multiplier

**Asked for:** each sim has its own needs affinities, so a social butterfly's
`social` drains faster - because they *want* company - while an introvert's
drains very slowly and refills fast.

### Why this is the most important of the four to get right early

`decay_needs` currently reads one global table for every agent in the world.
That is the assumption [N3] deletes, and it is the assumption everything else
in this document also deletes. So the shape is shared: **decay becomes
per-agent, and the global table becomes the default that per-agent data
modulates.**

Concretely, a `Personality` component holding a per-need multiplier array,
alongside the `Needs` array it modulates. Two arrays of seven, same indexing,
same `NeedId`.

### What must not be foreclosed

- **The multiplier has to apply to REFILL as well as DRAIN.** The request says
  an introvert's social need should deplete slowly *and* be replenished
  quickly, which is two different numbers. A single multiplier per need is not
  enough; it wants a pair, or a drain multiplier plus a satisfaction
  multiplier. Whichever, `tick_interactions` needs it too - it is the only
  thing that refills - and that means the component has to be readable from
  both systems.
- **It belongs in the world hash.** Personality is simulation state that
  changes behaviour, so a replay that did not reproduce it would diverge.
  `world_hash` currently digests position and needs; this is a third column.
- **It is content, not code.** Per the standing rule, the *ranges* a
  personality can span belong in `content/tuning.toml`, and the archetypes -
  what "social butterfly" means numerically - belong in a content file
  alongside `needs.toml`. A `Personality` generated in Rust from hardcoded
  constants is the thing to avoid.
- **Uniqueness discipline applies.** Two archetypes whose multiplier arrays are
  equal are untestable apart, the same trap [L26] records for decay rates.

---

## [N4] Diminishing returns on repetition

**Asked for:** a second family of meters, red rather than green, that the
player wants to keep LOW. Doing the same thing repeatedly raises the
corresponding meter and reduces the benefit of doing it again, down to some
floor - and in some cases with no floor. Rate of rise and fall tunable by
personality and other factors.

The user's own note says the name needs workshopping. Candidates, with what
each implies:

- **Satiation** - the standard term for exactly this in both economics and game
  design. Reads correctly as "how full up of this you are", inverts cleanly
  ("satiated" = no benefit left), and is honest about applying to pleasant
  things as well as food.
- **Tedium** - conveys the feeling better and is more in the game's voice, but
  implies boredom specifically, which is wrong for hunger.
- **Novelty** - the inverse: high is good, so it would be a green meter and the
  mechanic becomes "novelty is what makes things worth doing". Arguably the
  clearest to a player, at the cost of inverting the mental model the request
  describes.
- **Fed up with** - plain, funny, fits the dark-comedy register, unusable as an
  identifier.

**SUPERSEDED. The name is `habituation`**, and this section's whole naming
discussion is kept only as the record of how it got there. `satiation` was
wrong for the reason the shortlist above should have made obvious: it imports a
food metaphor into a mechanic that has nothing to do with food, and the
mechanic applies identically to the same television, the same gym and the same
person. `habituation` is the psychological term for a diminished response to a
repeated stimulus, which is exactly the mechanic.
 
The design moved on as well as the name. See
`2026-07-29-satisfaction-and-traits-design.md`, which reframes this as one of
three sources feeding a single per-(sim, thing) multiplier, and which is where
the satisfaction axis this mechanic feeds is defined.

### This is the mechanic two recorded problems are waiting for

It is not speculative. Two measured findings both point at it:

- **[C5], repeated use of the same object back to back.** Measured at 5.8%,
  then 5.6% after sims stopped standing on furniture, then 3.2% after the decay
  retune. It has never been *fixed*, only diluted, and the note in
  `TileGrid::find_path_adjacent` says outright that it needs "a mechanism aimed
  at repetition, such as a short per-object cooldown, rather than a distance
  nudge." [N4] is the general form of that cooldown.
- **[C6], the bookshelf is used zero times in 12 000 ticks.** It exists to be
  the low end of the fun range and instead is furniture the sim walks past. Any
  mechanic that makes the television worth less the fourth time running is a
  mechanic that gives the bookshelf its turn - which is a far better fix than
  raising the bookshelf's numbers until it wins on merit it does not have.

So [N4] is the one item here that would improve behaviour that has already been
measured as wrong, rather than adding a dimension.

### Where it plugs in

Scoring, at `score_advertisement`. It already weighs `delta` against a cubed
urgency and a time cost; satiation is a fourth term, scaling the delta down.
That keeps it in one function, and that function is the most heavily tested in
the project.

### What must not be foreclosed

- **Per-agent AND per-what.** Per-object is the obvious reading and probably
  the wrong one: eating three different meals should not feel as repetitive as
  eating the same one three times, but eating at three different tables IS the
  same activity. So the thing satiation attaches to is likely the
  **interaction** - a `(sim, object-def, interaction)` triple - not the placed
  entity. That distinction is cheap now and would be a migration later.
- **A floor, and the ability to have none.** The request says "down to some
  minimum in most but not all cases", which makes the floor content rather
  than a constant. An interaction with no floor can be driven to worthless,
  which is a legitimate design choice for a novelty item and a bug for a
  fridge - so hunger must be unable to become unsatisfiable this way, and that
  is the same invariant `every_declared_need_can_be_satisfied_by_some_interaction`
  already protects statically. It would need a dynamic counterpart.
- **Decay of the meter itself.** Satiation has to fall over time or it is a
  one-way ratchet. That is a second rate table, and [N3] and [N5] both apply to
  it as well.

---

## [N5] A little randomness in the rates themselves

**Asked for:** a small percentage of randomness in how fast meters move,
bounded by a min and a max, with the percentage itself subject to personality
and other multipliers.

### The constraint that shapes it

**Randomness means the seeded PRNG, always.** `SimRng` is a world resource and
every draw comes from it, which is what makes the golden hashes, replay, the
save-file command log and the planned lockstep multiplayer possible. A rate
jitter drawn from anywhere else - `Math::random`, a wall clock, a thread-local
- silently breaks all four, and the failure appears as a replay that diverges
rather than as an error.

### The decision this needs, and it is not obvious

**How often is the jitter redrawn?** Three options, materially different:

1. **Per tick per need.** A fresh draw every tick for every need of every
   agent. Smooth, and the most expensive: seven draws per agent per tick, and
   PRNG consumption becomes a function of population, which makes the draw
   sequence depend on how many sims exist. Every existing golden vector's
   alignment shifts the moment a sim is added.
2. **Per sim, once.** Each sim gets a fixed personal offset at creation. Cheap,
   deterministic, and indistinguishable from [N3] - it *is* an affinity, just a
   randomly generated one. Probably the right answer for "sims differ from each
   other".
3. **Per interaction, or per some interval.** A fresh draw each time a need
   crosses some boundary, or every N ticks. Middle ground, and the only one of
   the three that makes a *single* sim non-metronomic over time, which is what
   the request seems to be after.

**Recommendation: 2 and 3 together, and they are different features.** Option 2
is "sims are individuals" and collapses into [N3]. Option 3 is "a sim is not a
metronome" and is the new thing. Option 1 buys smoothness nobody asked for at
the cost of coupling the PRNG stream to the population, which is a determinism
hazard worth avoiding.

Note the precedent already in the codebase: `sample_duration` draws once per
interaction rather than per tick, and its doc explains that the draw is taken
even when the variance is zero *specifically* so that PRNG consumption stays a
function of what the simulation does rather than of how the knobs are set. Rate
jitter should follow the same discipline.

---

## What must not be foreclosed, collected

The one-line version, for anybody touching these systems now:

- **`decay_needs` must be allowed to become per-agent.** It reads a global
  table today; [N2], [N3] and [N5] all need it to consult the agent. Nothing
  should come to depend on decay being uniform across the world.
- **`tick_interactions` must be allowed to modulate refill.** [N3] needs
  satisfaction rates to vary per sim, and it is the only thing that refills.
- **`score_advertisement` must be allowed a fourth term.** [N4] scales the
  advertised delta, and that function is where the scaling belongs.
- **The world hash will need more columns.** Personality and satiation are both
  behaviour-changing simulation state, so a replay has to reproduce them.
- **Every draw comes from `SimRng`.** No exceptions, and prefer draws whose
  frequency depends on what the simulation *does* rather than on how many
  agents exist.
- **Keep the uniqueness discipline.** Distinct rates, distinct multipliers,
  distinct archetypes - two equal values anywhere in these tables makes the two
  slots untestable apart, which is [L26] and [L29].
