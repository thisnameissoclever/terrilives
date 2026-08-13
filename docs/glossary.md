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

## Mood and moodlets

| Term | Means |
| --- | --- |
| **mood** | The selected sim's current overall feeling, scored from -100 to 100 and labelled Miserable, Low, Okay, Good, or Great. It is derived from the live world rather than saved separately. |
| **moodlet** | One active reason contributing to mood, such as Hungry, Low spirits, or Comforted by Bill. The signed number beside it is its contribution to the overall score. |
| **need moodlet** | A low or critical need, or the single Needs met summary when every need is healthy. |
| **condition moodlet** | The content label of any worn condition trait with material severity. Capability and disposition traits do not claim an emotional effect they do not define. |
| **environment moodlet** | The selected sim's directional feeling about a nearby named sim, weakened by distance. The other sim's reciprocal feeling is a separate fact. |

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

## Player controls and saves

| Term | Means |
| --- | --- |
| **HUD** | The always-visible controls and status panels over the game: household time and funds, household roster, the selected person's needs and activity, speed, save controls, and Help. |
| **household roster** | The Household row of named buttons used to select a person. Its order follows stable household identity, and it reconciles those identities after Load rather than trusting replaceable entity indices. |
| **Save** | Writes the complete resumable household to the browser's one local save slot. The saved tick, random state, selection, active work, queued orders, and all entity state resume together. |
| **Load** | Replaces progress since the last save only after confirmation. Invalid or incompatible bytes are rejected without changing the running household. |
| **autosave** | The same complete save, written once when a new simulated day begins. It waits while Save, Load, or New game owns the persistence boundary, so snapshot capture and storage cannot race. |
| **New game** | Deletes the browser-local save after confirmation and reloads the authored move-in household. It does not delete content or files outside this game's private browser storage. |
| **OPFS** | Origin Private File System: private storage owned by this website. The game uses one `terri-save-1.bin` file there instead of squeezing binary state into `localStorage`. |
| **Queue** | A visible mode that appends each new order. On desktop, holding Ctrl or Cmd while clicking does the same thing. Turn Queue off to make a new order replace the old queue. |
| **Clear orders** | Cancels the selected person's current player-directed commitment and waiting orders. Autonomous needs can make them choose something new immediately afterward. |
| **action menu** | The list opened by long-press, right-click, or keyboard Enter. It contains the target's authored interactions and **Never mind**. |
| **keyboard target** | The world person or object chosen with arrow keys while the game view is focused. Space selects a person; Enter opens that target's action menu. |
| **Help** | The persistent copy of the first-run control guide. Closing it is remembered in browser preferences, separately from the game save. |
| **needs panel** | The collapsible panel named for the selected person. On a narrow screen it starts folded so controls do not cover most of the house. |
| **Light: auto / Light: flat** | Auto follows the simulation clock and shows local lamp and television pools. Flat uses neutral daylight and removes local pools. The choice is a browser preference rather than game state. Reduced motion temporarily forces Flat without overwriting the saved choice. |

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
| **disposition** | A per-thing pull or aversion - "Bill likes that chair more than the numbers say". A disposition of 0 IS a fear: the sim never chooses it on its own, though your click still works. |

## Relationships

| Term | Means |
| --- | --- |
| **relationship** | One number per **ordered pair** of sims, -1 (nemesis) to +1 (best friend), 0 for strangers. A's feeling about B is stored separately from B's about A, so unrequited is a real state. |
| `relationships:` | The overlay's relationship line. |
| **People panel** | The normal HUD's selected-person view of that same ordered value. It merges the complete live household with sparse relationship entries by stable `SimId`; a missing entry displays as Stranger. |
| **relationship state** | The panel's plain-language band: Hostile, Dislikes, Wary, Stranger, Warm, Friendly, or Close. The centered meter still carries the exact direction and movement without printing float noise. |
| **gain** | Each completed conversation adds 0.15 to both sides. Roughly seven chats takes strangers to best friends. |
| **decay** | Every relationship drifts toward zero by 0.00001 per tick - a grudge fades on the same clock a friendship does. Maintenance matters. |
| **relationship scale** | A friend's conversation is worth up to 1.5x its authored value and a nemesis's 0.5x, so sims visibly prefer their friends. |

## Life satisfaction - the second axis

This is the score the PLAYER is playing for; it is not a need and it
never derives from one.

| Term | Means |
| --- | --- |
| `life satisfaction` | An accumulator per sim, starting at 0 on move-in day and growing for the rest of that life. There is no maximum - lives do not fill up. |
| **hobby** | An activity tag a sim loves (`content/household.toml`). Completing a loved activity pays **3x** its base satisfaction. Tim loves correspondence and reading; Bill television and cooking; Casey socialising. |
| **tag** | A label on an activity (`cooking`, `reading`, `socialising`) - the vocabulary hobbies and traits both key on, so one word covers every activity that counts as that thing. |
| **neglect** | Any need below 15 bleeds 0.002 life satisfaction per tick, per crisis. Keeping a sim alive is table stakes; failing to is a life quietly not worth living. |

**Only completions pay.** An interrupted activity pays nothing, which
is the same rule habituation and relationships follow.

## Traits - `traits:` in the overlay

Authored in `content/traits.toml`, worn by household members. Three
kinds, each doing exactly one thing:

| Kind | Does | Shipped example |
| --- | --- | --- |
| **disposition** | Weighs the CHOICE. Multiplies the score of anything carrying its tag. Never changes what the thing delivers - fearing the couch makes a sim avoid it, not fail to be comforted by it. | **Television devotee** (Bill): television-tagged activities score 1.5x. |
| **capability** | May attempt, may FAIL. Has a **level** 0-1; a roll at the start of an attempt decides. A failed attempt delivers `fail_delta_scale` of the benefits (usually nothing), pays no life satisfaction, and still **teaches** - every attempt raises the level. | **Can't cook** (Casey): starts at level 0.25, learns 0.015 per attempt. |
| **condition** | Scales life satisfaction ACCRUAL, and has a **severity** 0-1 that falls whenever the sim completes an activity carrying the condition's tag. A managed condition fades; a neglected one binds. | **Low spirits** (Tim): at full severity she earns 40% of normal; eases 0.005 per treating activity (her desk). |

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
| **needs at work** | They still decay, at `at_work_decay_scale` of the usual rate - an office has a toilet and a kettle in it. At the full rate the worker starved: measured at zero on six of seven needs every day of 25 ([A-19]). The job's price is the TIME, not hunger. |
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
| **activity code** | What a row is doing: 0 none, 1 walking, 2 waiting, 3 exact authored eating, 4 talking, 5 sleeping, 6 at work, 7 generic object use, 8 exact authored reading, 9 exercising, 10 watching fish. Some activities are text-only and deliberately draw no indicator bubble. |
| **visual action code** | Which presentation body pose a row draws: 0 none, 1 talk, 2 eat, 3 seated read, 4 standing read, 5 walk, 6 exercise, 7 watch fish. Exact compiled interactions own codes 1 through 4, 6, and 7; final walking activity plus a real path owns code 5. Activity alone never invents an authored object or social pose. |

## What the debug overlay prints, line by line

Turn it on with `?debug=1`; the panel folds to a pill on narrow
screens. A full block reads:

```
household funds: 240

Tim  (entity 34, SimId 0)  doing: idle
  life satisfaction: 13.1
  career: Office clerk
  traits: Low spirits (condition, severity 0.59)
  stalled reason: waiting on something in use
  player orders waiting: 2
  chain: Cook dinner - step: Cook (carrying ingredients)
  needs: hunger 2.2  energy 23.4  hygiene 33.3 ...
  need decay: fun x1.30, comfort x0.70
  need refill: energy x1.15, fun x0.85
  relationships: Casey +0.28
```

Every line above has its own glossary entry. `entity` is the engine's
internal row number and changes across runs; `SimId` is the sim's
permanent identity and does not. Lines are omitted entirely when they
do not apply - no career, no traits, nothing stalling, no chain - so a
short block means a simple sim rather than missing data.

## Art and print terms

Vocabulary used by `docs/specs/2026-08-03-design-language-options.md` and
by the art-pipeline section of `docs/TECH_STACK.md`. None of it is
implemented; it is here because rule 6 below says a word a developer
meets gets an entry, and a design paper is where you meet these.

| Term | Means |
| --- | --- |
| **atlas** | The one generated texture holding every sprite in the game. Its canonical bytes are `web/public/atlas.png`; runtime uses a byte-identical `web/public/atlas-<sha256>.png` pathname so Pages cannot pair new hashed JavaScript with an old cached texture. One atlas is what keeps the whole frame to a single draw call ([D10]). |
| **post-pass** (offline) | A program that reads the finished atlas, restyles every sprite in it, and writes it back. Runs on a developer machine, never in the browser. |
| **post-process** (runtime) | A shader that restyles the whole finished frame on the GPU each time it is drawn. Costs a second render pass, so [D10]'s one-draw-call claim stops being true the day one lands. |
| **screen space** | Measured in display pixels rather than in the sprite. A pattern applied in screen space stays the same size when the camera zooms; the same pattern baked into a sprite grows and shrinks with it. |
| **quantise** | Force every pixel to the nearest colour in a short fixed list. Four inks means the image is allowed four values and nothing between them. |
| **dither** | Alternate two available colours in a fine pattern so the eye mixes them into a third that the palette does not contain. |
| **halftone** | Dither done as dots of varying size, which is how a printing press fakes shading with one ink. |
| **misregistration** | Printing plates that do not quite line up, so the inks sit a fraction out of position. Deliberate misregistration is most of what makes an image read as printed rather than as rendered. |
| **risograph** (riso) | A duplicator that prints one saturated spot colour per pass. Cheap, loud, and slightly misregistered by nature. |
| **spot colour** | One specific premixed ink, rather than a colour built from mixing others. A four-ink design has exactly four of them and no others are available. |
| **knockout** | Text left as bare paper inside a block of ink, rather than printed on top of it. |
| **morphological gradient** | The difference between a shape grown by one pixel and the same shape shrunk by one pixel, which is its outline. The cheap way to get a clean line around a sprite. |
| **drafting figure** | The schematic human symbol drawn on architectural plans to show scale. Deliberately a notation rather than a portrait, which is why it is a finished style and not a placeholder. |
| **gouache** | Opaque water-based paint. Flat, matte, visible brushwork, and the look most "hand-painted storybook" art is imitating. |
| **chyron** | The name-and-title strip along the bottom of a news broadcast. |
| **depth-conditioned generation** | Handing an image model a depth map of a 3D render alongside the prompt, so it paints the shapes that are actually there instead of inventing its own. [G1]'s "generate by rendering, not by prompting". |
| **LoRA** | A small fine-tune bolted onto an image model, trained here on 20 to 30 approved assets so everything generated afterwards matches this project rather than the model's average. [K3]. |
| **OFL** | The SIL Open Font License. Permits embedding and commercial use, including self-hosting a font in the web build. |

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
