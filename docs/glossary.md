# Glossary: every term this game uses, in plain language

**Read this first if a word in the game, the debug overlay, a spec or a
commit message did not explain itself.** Everything here is defined for
a reader rather than for the person who wrote it, and every entry says
where the authoritative version lives if you want the argument behind
the rule.

This file exists because the project had the opposite problem: 59
lessons and 13 design specs recording every DECISION in detail, keyed by
IDs like [S4] and [K1], and nowhere at all defining what the words
meant. Written 2026-08-01 after the owner asked what "wears" and
"drains" were supposed to mean - which was a fair question, because
nothing answered it.

Names in `code font` are what you will see in the debug overlay
(`?debug=1`), in content files, or in code.

---

## Time

| Term | Means |
| --- | --- |
| **tick** | The simulation's heartbeat. Everything happens on ticks; nothing happens between them. One tick is one **sim-minute**. |
| **1x speed** | 10 ticks per second of real time. So one real second is ten sim-minutes, and one real minute is about ten sim-hours. `2x` and `3x` run 20 and 30 ticks a second - they change how many ticks run per frame, never how long a tick means. |
| **day** | 1440 ticks (`day_ticks` in tuning), because 1440 minutes is a day. `tick % 1440` is the clock: 360 is 06:00. About 2.4 real minutes at 1x. |

## Needs - the first axis

Seven needs, each a number from 0 (desperate) to 100 (fully satisfied):
`hunger`, `energy`, `hygiene`, `bladder`, `social`, `fun`, `comfort`.

| Term | Means |
| --- | --- |
| **decay** | Every need falls a fixed amount per tick, per need. Shipped rates: bladder 0.102 (fastest), hygiene 0.072, hunger 0.062, energy 0.051, fun 0.048, comfort 0.032, social 0.026 (slowest). Authored in `content/tuning.toml`. |
| **deficit** | How empty a need is, as 0.0 (full) to 1.0 (empty). A sim at hunger 30 has a hunger deficit of 0.7. |
| **urgency** | The deficit **cubed**. This is why sims have priorities instead of a checklist: at deficit 0.9 a need is 13x more pressing than at 0.4, not 2x. |

## Choosing what to do

| Term | Means |
| --- | --- |
| **interaction** | One thing an object offers - "Grab a snack", "Watch TV". It **advertises** need changes (`hunger = 40`) and takes `duration_ticks`. Authored in `content/objects.toml`. |
| **advertisement** (advert) | The promise an interaction makes: which needs it moves and by how much. Negative values are costs - a shower advertises `hygiene = +70, energy = -12`. |
| **score** | What a sim thinks something is worth right now: `delta x urgency / (travel time + duration + 1)`. So the same fridge is worth more when you are hungrier and less when it is further away or slower. |
| **action threshold** | Below this score (0.05), nothing is worth doing at all. |
| **idle threshold** | Below this score (0.04), the sim is `Restless` and wanders instead of standing still. The gap between the two is a deliberate dead band: mildly-worth-doing keeps a sim in place. |
| **choice temperature** | How randomly a sim picks among things worth doing (0.06). Low means it almost always takes the best option; high means a coin toss. It is a **weighted draw**, not a strict best-pick, so sims are not robots. |
| **reservation** (`Reserved`) | A claim on an object or a person. One sim per slot; whoever gets there first in a tick holds it until finished. |
| **contested** | Something that is worth wanting but reserved by somebody else. It still counts toward "is anything here worth it", at 75% weight, which is why an outbid sim waits rather than wandering off. |
| `stalled reason:` | The overlay line naming why a sim is not acting. Exactly two reasons: **waiting on something in use** (the best thing it saw is someone else's - the `Blocked` marker) and **found nothing worth doing** (nothing cleared the idle threshold - the `Restless` marker). Both can be true at once. |
| `player orders waiting:` | How many of YOUR clicks the sim still has queued. Not a stall reason - it is work about to happen. Cap 4. |
| **intent** / **order** | One player instruction ("use that fridge"). Player orders always beat the sim's own choice and are served in the order given. |

## Habituation - "not that again"

| Term | Means |
| --- | --- |
| **habituation** | Doing the same thing makes it worth less. Each completion adds 0.34 (to a max of 1.0) against that exact (object, interaction) pair, and every entry decays 0.0011 per tick. |
| **habituation floor** | The worst it can get: a fully habituated interaction is still worth 45% of its advertised benefit. It never becomes worthless - a sim sick of eating still eats. |

It scales **benefits only, never costs**: a fourth shower is less refreshing but not less tiring.

## Personality - why two sims differ

Each sim has an **archetype** (`the_correspondent`, `the_settled`,
`the_flitting`) from `content/personalities.toml`, which is a bundle of
multipliers. The overlay shows only the ones that deviate from neutral:

| Overlay line | Means |
| --- | --- |
| `need decay: fun x1.30` | This sim's fun need empties 1.3x faster than baseline. Higher = needier. |
| `need refill: comfort x1.25` | Doing something comfortable gives this sim 1.25x as much comfort as it would give anyone else. Higher = easier to please. |
| **disposition** | A per-thing pull or aversion - "Doug likes that chair more than the numbers say". A disposition of 0 IS a fear: the sim never chooses it on its own, though your click still works. |

## Relationships

| Term | Means |
| --- | --- |
| **relationship** | One number per **ordered pair** of sims, -1 (nemesis) to +1 (best friend), 0 for strangers. A's feeling about B is stored separately from B's about A, so unrequited is a real state. |
| `relationships:` | The overlay's relationship line. |
| **gain** | Each completed conversation adds 0.15 to both sides. Roughly seven chats takes strangers to best friends. |
| **decay** | Every relationship drifts toward zero by 0.00001 per tick - a grudge fades on the same clock a friendship does. Maintenance matters. |
| **relationship scale** | A friend's conversation is worth up to 1.5x its authored value and a nemesis's 0.5x, so sims visibly prefer their friends. |

## Life satisfaction - the second axis

This is the score the PLAYER is playing for; it is not a need and it
never derives from one.

| Term | Means |
| --- | --- |
| `life satisfaction` | An accumulator per sim, starting at 0 on move-in day and growing for the rest of that life. There is no maximum - lives do not fill up. |
| **hobby** | An activity tag a sim loves (`content/household.toml`). Completing a loved activity pays **3x** its base satisfaction. Terri loves correspondence and reading; Doug television and cooking; Nadia socialising. |
| **tag** | A label on an activity (`cooking`, `reading`, `socialising`) - the vocabulary hobbies and traits both key on, so one word covers every activity that counts as that thing. |
| **neglect** | Any need below 15 bleeds 0.002 life satisfaction per tick, per crisis. Keeping a sim alive is table stakes; failing to is a life quietly not worth living. |

**Only completions pay.** An interrupted activity pays nothing, which
is the same rule habituation and relationships follow.

## Traits - `traits:` in the overlay

Authored in `content/traits.toml`, worn by household members. Three
kinds, each doing exactly one thing:

| Kind | Does | Shipped example |
| --- | --- | --- |
| **disposition** | Weighs the CHOICE. Multiplies the score of anything carrying its tag. Never changes what the thing delivers - fearing the couch makes a sim avoid it, not fail to be comforted by it. | **Television devotee** (Doug): television-tagged activities score 1.5x. |
| **capability** | May attempt, may FAIL. Has a **level** 0-1; a roll at the start of an attempt decides. A failed attempt delivers `fail_delta_scale` of the benefits (usually nothing), pays no life satisfaction, and still **teaches** - every attempt raises the level. | **Can't cook** (Nadia): starts at level 0.25, learns 0.015 per attempt. |
| **condition** | Scales life satisfaction ACCRUAL, and has a **severity** 0-1 that falls whenever the sim completes an activity carrying the condition's tag. A managed condition fades; a neglected one binds. | **Low spirits** (Terri): at full severity she earns 40% of normal; eases 0.005 per treating activity (her desk). |

| Term | Means |
| --- | --- |
| **fumble** | A failed capability roll, live on the current attempt. The meal happens; it just does not feed anybody. |
| **level** / **severity** | The mutable number the overlay prints beside a capability / condition. |

## Career

| Term | Means |
| --- | --- |
| `career:` | The sim's job, from `content/careers.toml`. |
| **shift** | Starts at a tick of the day (`shift_start` 360 = 06:00) and lasts `shift_ticks` (480 = eight hours). |
| **rabbit hole** | The industry term this design borrows: the sim walks off the lot and is simply GONE for the shift - no workplace is simulated. |
| **front door** | The lot tile a worker leaves from and returns to (`front_door` in `content/lot.toml`). |
| `household funds:` | The household's money, credited on each shift's return. Shared by the whole lot, not per sim. |
| **the cost of a job** | Deliberately just the TIME. A career's satisfaction payout is small and can never be negative - what a bad job costs a life is the hours it eats from everything else, which the trace measures. |

## Chains - multi-step activities

A chain is one activity spread across several objects: **cook dinner** =
fetch from the fridge, prepare at a counter, cook at the stove, eat at a
table. Authored in `content/chains.toml`.

| Term | Means |
| --- | --- |
| **step** | One leg of the chain: where it happens, what it is called, how long it takes. |
| **role** / **station** | What KIND of object a step needs (`cold_storage`, `prep_surface`, `hob`, `eating_surface`) rather than which one. Objects declare the roles they can serve, so any lot with the right kinds of furniture works, and the sim walks to the nearest free one at the time it needs it. |
| **terminal step** | The last one - and **the only one that pays**. Everything the chain advertises lands there, whole. A sim that gets halfway through cooking and wanders off has not eaten. |
| **item kind** / `carrying` | What is in the sim's hands between steps - `ingredients` becoming `dinner` at the stove. Drawn as the badge beside the sim. |
| **resume** | The rule for interruptions: your click (or a work shift) drops the current STEP, never the errand. When the sim is free again it goes back and finishes. Only an explicit cancel abandons a chain. |
| `chain:` | The overlay line showing which chain a sim is on, which step, and what it is carrying: `Cook dinner - step: Cook (carrying ingredients)`. |

## The lot

| Term | Means |
| --- | --- |
| **lot** | The house and everything on it (`content/lot.toml`). Currently 16x12 tiles, five rooms. |
| **placement** | One object standing at one position. Several placements can share an object definition (two chairs, one `chair`). |
| **footprint** | How many tiles an object occupies. A 2x1 bed blocks two tiles, and nothing may overlap it. |
| **facing** | Which of the kit's four pre-rendered directions a placement is drawn with. Presentation only - the simulation neither knows nor cares which way a counter faces. |
| **doorway** | A GAP in a wall run. There is no door object; a tile is either passable or it is not. |

## Under the hood

| Term | Means |
| --- | --- |
| **content pack** | Every TOML file in `content/`, validated and compiled into one binary blob at build time. **Invalid content fails the build** rather than misbehaving at runtime - a chain whose station nobody placed, a hobby nothing can pay, a trait about nothing. |
| **tuning** | `content/tuning.toml` - every number that governs the SYSTEM rather than describing one object. One file for a balance pass, by standing rule. |
| **determinism** | The same seed and the same inputs produce the identical simulation, tick for tick, on any machine. Load-bearing for save files, replays and bug reports. |
| **world hash** | A digest of everything the simulation must agree on. Two runs that diverge by a hair produce different hashes, which is how CI catches an accidental behaviour change. Also, deliberately, the shape a save file takes. |
| **render buffer** | The flat arrays the display reads each frame - positions, sprites, activities, carried items. The simulation writes it; the browser never asks the simulation questions mid-frame. |
| **activity code** | What a row is doing, for the indicator bubbles: none, walking, waiting, eating, talking, sleeping, at work. |

## What the debug overlay prints, line by line

Turn it on with `?debug=1`; the panel folds to a pill on narrow
screens. A full block reads:

```
household funds: 240

Terri  (entity 34, SimId 0)  doing: idle
  life satisfaction: 13.1
  career: Office clerk
  traits: Low spirits (condition, severity 0.59)
  stalled reason: waiting on something in use
  player orders waiting: 2
  chain: Cook dinner - step: Cook (carrying ingredients)
  needs: hunger 2.2  energy 23.4  hygiene 33.3 ...
  need decay: fun x1.30, comfort x0.70
  need refill: energy x1.15, fun x0.85
  relationships: Nadia +0.28
```

Every line above has its own glossary entry. `entity` is the engine's
internal row number and changes across runs; `SimId` is the sim's
permanent identity and does not. Lines are omitted entirely when they
do not apply - no career, no traits, nothing stalling, no chain - so a
short block means a simple sim rather than missing data.

## Naming rules this project follows

Added the same day the glossary was, after `wears:` and `standing:`
shipped and neither meant anything to a reader:

1. **A label names the thing, not the implementation's mood.** `traits:`
   not `wears:`; `stalled:` not `standing:`.
2. **One label, one meaning.** If a line would need "and also" to
   explain it, it is two lines. Pending orders came out of the stall
   line for exactly this.
3. **A number's label says what the number DOES, and what it acts
   ON.** `need decay: fun x1.30` beats `drains: fun x1.30`, which beats
   `drain: fun 1.30`, and all three beat printing seven neutral 1.00s
   that read as broken stats.
4. **A label that names a CATEGORY says so.** `stalled reason:` rather
   than `stalled:`, because the value is a reason and the reader should
   not have to infer that from the words after the colon.
5. **Show deviations, not defaults.** A row of unchanged values is
   noise that hides the one changed value.
6. **Every player-visible or developer-visible word gets an entry
   here.** If it is not in this glossary, either name it better or
   document it - those are the only two options.
7. **Functional text stays plain** (buttons, diagnostics, labels). The
   game's dark comedy lives in object names and, later, authored voice
   text - never in a control the player needs to understand.
