# M1c Probabilistic Behaviour - Design

Status: agreed. Section IDs are stable; do not renumber.

## Why

`select_action` currently takes the **argmax** of candidate scores. That makes a
sim read as a robot executing a priority list: given the same state it always
does the same thing, in the same order, and the seams show immediately.

The requested behaviour: **a need's urgency should raise the probability that it
is served next, without making it certain.** Plus varied interaction durations
so repeated actions are not metronomic, and idle wandering so a sim with nothing
urgent does not stand perfectly still.

## [D-1] Every tunable lives in one file

**`content/tuning.toml` is the single home for every threshold, weight,
temperature, rate and knob that governs the *system***, as opposed to values
that describe a specific piece of content.

The distinction: a fridge's hunger delta is content and stays in
`objects.toml`; the temperature governing how randomly any sim chooses is
tuning and goes here. Need decay rates move here from `needs.toml`, because they
are a system-wide balance knob rather than a property of a need's identity.

This is a standing project rule, not a one-off. **When adding any value a
designer might want to change, it goes in the tuning file rather than a Rust
`const`.** Existing scattered constants migrate as they are touched.
`ACTION_THRESHOLD` is the first, and today it appears in ten places in one file.

It is validated at build time by `terri-data` like every other content file, so
a malformed or missing knob fails `cargo build` rather than surfacing as
inexplicable behaviour.

## [D-2] Weighted selection by softmax

Candidates scoring above the threshold are sampled with probability

```
p_i = exp(score_i / T) / sum_j exp(score_j / T)
```

`T` is `choice_temperature` in the tuning file. **Low T approaches argmax; high
T approaches uniform.** A designer can slide from "always the most urgent thing"
to "barely cares" without a rebuild.

Two implementation notes that are correctness rather than style:

- **Subtract the maximum score before exponentiating.** `exp` of a large score
  overflows to infinity, and infinity divided by infinity is `NaN`, which then
  loses every comparison and would make a sim stop choosing anything forever
  with no panic and no log. The shift is mathematically identity.
- **Softmax is scale-sensitive**, unlike proportionate selection. Because
  urgency is cubed, scores span orders of magnitude, so `T` must be tuned
  against the actual score range rather than picked as a round number. The
  tuning file should carry a comment with the observed range.

The desired property still falls out: because urgency is cubed, a starving sim's
food score dwarfs a mild boredom score, so it eats nearly always. When two needs
are comparable it approaches a coin flip. **The randomness self-regulates -
desperate sims look decisive, comfortable ones whimsical.**

## [D-3] Randomness must not mean nondeterminism

The golden hashes, replay, the save-file command log and the planned multiplayer
all rest on the simulation being bit-reproducible ([A5]).

**A seeded PRNG lives in the world as a resource** and is advanced
deterministically. Same seed, same run, forever.

**The PRNG is implemented in-repo, not taken as a dependency.** `rand` does not
guarantee its algorithms stay bit-identical across major versions, so a routine
bump would change every replay and every golden hash with no way to distinguish
that from a real regression. A small PCG is twenty lines and is stable forever.

**Iteration order becomes load-bearing in a new place.** Agents are already
sorted by entity index before selection. **Objects must now be sorted too.**
Today the object query iterates unsorted, and that is safe only because the
score tie-break makes the argmax unique regardless of order. Under weighted
sampling, iteration order sets the cumulative-probability bucket boundaries, so
the same draw would select differently depending on archetype layout - a silent
determinism break of exactly the class this project has hit repeatedly.

The seed is a constant for now. It becomes part of the save file at M1d, which
is what makes a saved game replayable.

## [D-4] Varied interaction duration

An interaction's content `duration_ticks` becomes a **centre**, not a fixed
value. The actual duration is sampled per interaction within
`duration_variance` either side, biased shorter, and clamped to at least
`min_interaction_ticks`.

**The floor is a real-time floor.** At 1x speed the simulation runs 10 ticks per
second, so a 2.5 second minimum is **25 ticks**. The tuning file states the tick
value with the real-time equivalent in a comment, because the two are only
related through the tick rate and a reader will otherwise guess.

Note this raises the current fridge meal, which is 15 ticks or 1.5 seconds, so
existing balance shifts and the golden vectors move.

## [D-5] Idle wandering

When no candidate scores above `idle_threshold`, a sim currently stands
perfectly still, which reads as frozen rather than content.

Instead it picks a random reachable tile and walks there, pausing between
wanders. `idle_threshold` is separate from `ACTION_THRESHOLD` deliberately: one
governs "is anything worth doing", the other "is nothing worth doing enough that
I should mill about". Collapsing them removes a knob that will matter.

Wandering must go through the same intent path as any other action, so a
player-issued command still overrides it, and it must consume the same seeded
RNG so it stays reproducible.

## [D-6] Out of scope

Moodlets, traits, multiple sims, and anything requiring the M1b tasks that are
still open - selection, the command drain, need bars, time controls, input.

This milestone changes how a sim *decides*; M1b's remaining tasks are how a
player *watches and intervenes*. They are independent.

## [D-7] Definition of done

- `content/tuning.toml` exists, is build-validated, and holds every knob named
  here; `ACTION_THRESHOLD` no longer appears as a Rust constant
- Action choice is softmax-weighted with a temperature read from tuning
- The PRNG is in-repo, seeded, and held as a world resource
- **Objects are sorted before sampling**, with a test that fails if they are not
- **The determinism test still passes**: same seed replays to the same hash
- **A distribution test**: over many seeded runs, a higher-scoring option is
  chosen more often, and a lower-scoring one is still chosen sometimes. Both
  halves matter - the second is what distinguishes this from argmax
- Interaction durations vary, biased shorter, never below the configured floor
- A sim with nothing urgent wanders rather than freezing
- Golden vectors updated deliberately, observed on native and wasm32
- Full gate passes; no new mutation survivors without a written argument
