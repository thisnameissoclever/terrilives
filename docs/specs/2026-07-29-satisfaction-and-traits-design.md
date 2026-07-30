# Satisfaction, Habituation and Traits - Forward Design

Status: **architectural intent, nothing scheduled.** Written down because it
reframes what the game is about, and because one decision it implies - the shape
of an advertisement - is cheap to make now and expensive to change later.

Companion to `2026-07-29-needs-modulation-design.md` (which covers the base
rates and per-sim affinities) and
`2026-07-29-multi-step-interactions-design.md` (which covers action chains).

---

## [S0] The reframing, in the author's words

Needs are **background**. The complex interplay between them - eating filling
the stomach and therefore draining the bladder - is the ambient loop, not the
game.

The **core loop is managing whole lives**: a sim's career, their hobbies and
interests, their social relationships, and their environment, all at once, and
watching satisfaction grow. Sims spawn with a random assortment of
characteristics that get in the way - a fear of couches, not knowing how to
cook, clinical depression - and part of the game is resolving them.

Everything below follows from taking that seriously.

---

## [S1] Two axes, not one

The single most important consequence is that **satisfaction is a second axis
and not a summary of the first**.

| | Needs | Satisfaction |
| --- | --- | --- |
| horizon | minutes | a lifetime |
| behaviour | drain continuously, must be topped up | accumulates |
| failing it | a crisis | a life quietly not worth living |
| who cares | the sim | the **player** |
| source | objects that advertise | hobbies, career, relationships |

**DECIDED, 2026-07-29: needs can only ever COST satisfaction, never earn it.**
A well-fed, rested, clean sim earns nothing for it - competence is the baseline,
not an achievement. A chronically starving or filthy one bleeds satisfaction
steadily.

This is the rule that keeps the two axes from blurring, and it is a decision
rather than a default. The alternative considered and rejected was needs
contributing a positive baseline of contentment: richer on paper, but it
collapses satisfaction into a lagging average of the need bars, which makes the
whole second axis decorative. The cost of the rule as chosen is that needs are
pure chores with no upside - accepted deliberately, because "keeping a person
alive is table stakes, not an accomplishment" is the reading the game wants.

So: **satisfaction is produced by hobbies (and later career and relationships),
and reduced by neglect.** Nothing else writes to it upward.

### Idle time is the raw resource

Slowing the need rates took idle time from 12% to 25% of a run, and that was
recorded as a cost. Under this design it is **the supply of the thing the game
is actually about**: idle time is what hobbies consume to produce satisfaction.

The trap to avoid: if satisfaction rose with idle time *directly*, the optimal
play would be a sim who does nothing, which is unwatchable. Idle time must be
**spent** to convert. That is what makes a career a real antagonist - it is the
thing that eats the resource satisfaction is made from - and the institutional
satire follows for free rather than being bolted on.

---

## [S2] Habituation

**The name is `habituation`** - the psychological term for a diminished response
to a repeated stimulus. It replaces the "satiation" this document originally
proposed, which imported a food metaphor into a mechanic that has nothing to do
with food. It applies identically to the same meal, the same television, the
same gym, and the same person. Plain-language UI can say "sick of it".

- A rising value per **(sim, activity)**, decaying over time.
- It scales **down the benefit** of that activity.
- Not per need, and **not per placed object** - eating at three different tables
  is one activity; eating three different meals is not.
- Floors are content, not a constant: usually a minimum, occasionally zero.

**Where it meets satisfaction is the actual game.** A hobby done to death stops
paying out, so variety matters, so a sim needs several hobbies and enough free
time to rotate them. That is an optimisation problem with no dominant strategy,
which is what a core loop needs.

Two already-measured problems are waiting for this: [C5], repeated use of the
same object, diluted three times and never fixed; and [C6], the bookshelf used
zero times in 12 000 ticks.

---

## [S3] The decision that is load-bearing now: what an advertisement IS

Today an interaction advertises a list of `(NeedId, f32)`. That is the whole
vocabulary, and `select_action` scores nothing else.

Under [S0] an interaction has to be able to say considerably more. Take cooking
a meal, which is the canonical case because the multi-step design already uses
it:

- it satisfies **hunger** (a need - the existing vocabulary);
- it builds a **cooking skill** (progression);
- it **requires** some cooking capability to attempt at all;
- it yields **satisfaction** if cooking is one of this sim's hobbies;
- it is **avoided** by a sim afraid of the kitchen;
- it is worth less if they cooked the same thing yesterday (**habituation**).

Six different kinds of statement. **The advertisement is the extension point,
and it should be shaped to allow more than a need delta before anything else
starts depending on it being a `(NeedId, f32)` pair.** Concretely, the thing not
to foreclose: `CompiledInteraction::advertises` being a flat list of need
deltas, and `score_advertisement` taking a deficit and a delta as scalars.

---

## [S4] "Traits" is three mechanisms, and conflating them is the trap

The examples given - a fear of couches, not knowing how to cook, clinical
depression - look like one feature and are not. They fail differently and want
different code:

**1. Dispositions - modify a score.** A fear of couches makes an option less
attractive; a love of reading makes one more so. This is a multiplier on a
candidate's score, keyed by activity or object. Mechanically **identical to
per-sim affinities ([N3]) and to habituation ([S2])** - all three are per-(sim,
thing) multipliers from different sources. **Build one mechanism that composes
several sources**, not three lookup systems. That is the single biggest
implementation saving available here.

**2. Capabilities - gate an option.** Not knowing how to cook does not make
cooking unattractive; it makes it **unavailable**, or available and likely to
fail. That is a different mechanism: a filter on the candidate list, not a
weight on it. A capability also has a **level**, and activities that raise it,
which is a progression system rather than a modifier.

**Failure is interesting here and worth designing for rather than avoiding.** A
sim who cannot cook attempting to cook is a scene; a sim who simply never
approaches the stove is not. So the gate should more often be "may attempt, may
fail" than "cannot see".

**3. Conditions - modify satisfaction itself.** Clinical depression is not a
dislike of any particular object and not a missing skill. It acts on the
**satisfaction axis**: the accrual rate, or a ceiling on it, or the decay. This
is the clearest evidence that [S1]'s second axis is real - there is no sensible
way to express it as a need.

### Traits must be mutable, with progression state

"Resolving their neuroses" is part of the loop, so **a trait is not immutable
spawn data.** A trait system designed as a fixed roll at creation would have to
be rebuilt to support the thing it exists for. Each trait needs progression
state, whatever moves that state, and whether it can be fully resolved or only
managed.

Consequences: traits are simulation state, so they go in the **world hash**, and
the roll that assigns them comes from **`SimRng`** like every other draw.

### One note on framing, since the tone is deliberate

The game's register is absurdist institutional satire, and clinical depression
as a randomly rolled obstacle sits close to a line. It is a well-trodden
mechanic in the genre and the framing here - conditions to be understood and
improved, not punchlines - is the right side of it. Worth being deliberate
rather than incidental about which traits are played for comedy and which are
played straight: an institution being absurd is the joke, a sim's illness is
not. Recording it here so the decision is made on purpose when content is
authored.

---

## [S5] What must not be foreclosed

- **The advertisement vocabulary.** Nothing should come to depend on an advert
  being exactly a list of need deltas ([S3]).
- **One multiplier mechanism, several sources.** Affinities, habituation and
  dispositions are the same shape; do not build three ([S4]).
- **Candidate filtering as a distinct step from candidate weighting.**
  Capabilities gate, dispositions weigh. `select_action` currently has one
  notion of "this object is not available" (contested) and it will need more.
- **Satisfaction as its own axis**, never derived from need levels ([S1]).
- **Traits as mutable state with progression**, in the world hash, rolled from
  `SimRng` ([S4]).
- **Idle time as a resource that must be spent to convert**, not a bonus for
  inactivity ([S1]).
