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

## The game's name

| Term | Means |
| --- | --- |
| **Natural Causes** | The game's title, chosen by the owner on 2026-09-21. It is what players see. |
| `terrilives` | The working title, kept as the internal codename: the repository, the play URL, the `terri-*` crates, browser storage keys, and the save file. It stays because renaming those would reset players' settings, invalidate saves, or move the public link. `docs/TIM-TODO.md` [T1] lists exactly what was and was not renamed. |

## Time

| Term | Means |
| --- | --- |
| **tick** | The simulation's heartbeat. Everything happens on ticks; nothing happens between them. One tick is one **sim-minute**. |
| **1x speed** | 10 ticks per second of real time. So one real second is ten sim-minutes, and one real minute is about ten sim-hours. `2x` and `3x` run 20 and 30 ticks a second - they change how many ticks run per frame, never how long a tick means. |
| **day** | 1440 ticks (`day_ticks` in tuning), because 1440 minutes is a day. `tick % 1440` is the clock: 360 is 06:00. About 2.4 real minutes at 1x. The HUD numbers days from 1 and names each one's weekday, with the time on a second line: `Day 1, Monday` above `06:00`. |
| **weekday** | Which of the seven days of the week a day is, Monday to Sunday, numbered 0 to 6. It is worked out from the tick: day index `tick / day_ticks`, plus `first_weekday` from tuning (0, so day 1 is a Monday), modulo 7. Nothing about it is saved ([CAL-week] in `docs/specs/2026-10-06-calendar.md`). |
| **weekend** | Saturday and Sunday. Nothing in the simulation reads the word; a job rests on a weekend only because its **working days** leave those days out. With the shipped tuning, days 6 and 7 are the first weekend. |

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
| **mood** | The selected sim's current overall feeling, scored from -100 to 100 and labelled Miserable, Low, Okay, Good, or Great. It is derived from the live world rather than saved separately. Sustained high or low mood changes life satisfaction each simulation tick, outside a neutral band. |
| **moodlet** | One active reason contributing to mood, such as Hungry, Low spirits, or Comforted by Bill. The signed number beside it is its contribution to the overall score. |
| **need moodlet** | A low or critical need, or the single Needs met summary when every need is healthy. |
| **waiting moodlet** | Waiting for an occupied item lowers mood. Its penalty increases with the greatest deficit among the needs that activity benefits. Walking, working, talking and wandering do not count as waiting. |
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
| `player orders waiting:` | How many of YOUR clicks the sim still has queued. Not a stall reason - it is work about to happen. Cap 10. |
| **intent** / **order** | One player instruction ("use that fridge"). Player orders always beat the sim's own choice and are served in the order given. |

## Player controls and saves

| Term | Means |
| --- | --- |
| **HUD** | The always-visible controls and status panels over the game: household time and funds, household roster, the selected person's needs and activity, speed, save controls, and Help. |
| **housemate, new** | A person the player adds to the household during play from the New housemate form: named, given a personality and up to four traits, arriving from the street ([CS-slice-housemate]). Made by the same spawn as the shipped household, so they save and behave like anyone else. |
| **housemate, edit** | Changing a living person's name, personality, traits and family ties from the Edit button beside their name. The same two pages as New housemate; one command applies it, and the person keeps their SimId, needs, job, hobbies, satisfaction and feelings. A removed condition forgets its severity, while a removed capability leaves its skill as it was; "Keep current personality" leaves their effects exactly as they are ([ES-form] in `docs/specs/2026-09-30-edit-sims.md`). |
| **household roster** | The Household row of named buttons used to select a person. Its order follows stable household identity, and it reconciles those identities after Load rather than trusting replaceable entity indices. |
| **Save** | Writes the complete resumable household to the browser's one local save slot. The saved tick, random state, selection, active work, queued orders, and all entity state resume together. |
| **Load** | Replaces progress since the last save only after confirmation. Invalid or incompatible bytes are rejected without changing the running household. |
| **autosave** | The same complete save, written once when a new simulated day begins. It waits while Save, Load, or New game owns the persistence boundary, so snapshot capture and storage cannot race. |
| **New game** | Deletes the browser-local save after confirmation and reloads the authored move-in household. It does not delete content or files outside this game's private browser storage. |
| **OPFS** | Origin Private File System: private storage owned by this website. The game uses one `terri-save-1.bin` file there instead of squeezing binary state into `localStorage`. |
| **Queue** | A visible mode that adds each new order after the ones already waiting, for objects and for talking alike. On desktop, holding Ctrl or Cmd while clicking does the same thing. With Queue off, a new order goes FIRST: the person drops what they are doing for it and then carries on with the orders that were waiting. Neither empties the queue; only Clear orders and the action menu's cancel row do. A new first order on a full queue pushes out the order that would have run last, and the game says so. |
| **Clear orders** | Cancels the selected person's current player-directed commitment and every waiting order. It and the action menu's cancel row are the only controls that empty the queue. Autonomous needs can make them choose something new immediately afterward. |
| **action menu** | The list opened by long-press, right-click, or keyboard Enter. It contains the target's authored interactions and **Never mind**. |
| **keyboard target** | The world person or object chosen with arrow keys while the game view is focused. Space selects a person; Enter opens that target's action menu. |
| **Help** | The persistent copy of the first-run control guide. Closing it is remembered in browser preferences, separately from the game save. |
| **needs panel** | The collapsible panel named for the selected person. On a narrow screen it starts folded so controls do not cover most of the house. |
| **Options flyout** | The panel under the gear at the window's top right. It holds Light, Build, the sound controls, and Save, Load, Clear orders, Queue, New game and Help ([OF3]). Opening it pauses nothing; Escape or a press outside closes it. |
| **sky exposure** | How much open sky a tile sees, from 1 in the yard down to 0 deep inside the house ([OS-daylight]). It falls by `daylight_reach_per_tile` for each step in from the yard, passes every doorway, whether or not a door stands in it, and stops at walls. By day the shader dims a tile by `interior_daylight_shade` times what it lacks, scaled by how strong the sun is; at night and in flat light it changes nothing. It is drawing only and never enters the simulation or the save. |
| **Light: auto / Light: flat** | In the Options flyout. Auto follows the simulation clock and shows local lamp and television pools. Flat uses neutral daylight and removes local pools. The choice is a browser preference rather than game state. Reduced motion temporarily forces Flat without overwriting the saved choice. |

## Habituation - "not that again"

| Term | Means |
| --- | --- |
| **habituation** | Doing the same thing makes it worth less. Each completion adds 0.34 (to a max of 3.0) against that exact (object, interaction) pair, and every entry decays 0.0011 per tick. Appeal and the repetition meter read at most 1.0 and need delivery ignores it; the part above 1.0 is overdoing. |
| **habituation floor** | The lowest appeal can fall: a fully habituated interaction is still worth 45% of its advertised benefit when autonomy chooses, and need delivery is unchanged. Mood has no such floor: above saturation each further use costs mood as overdoing, and too much food makes a Sim feel sick for a while. |
| **overdoing** | A habituation entry above 1.0. Each such entry adds an `Overdoing {activity}` moodlet whose penalty grows from 0 just above 1.0 to 20 at the 3.0 maximum. Decay is the timer: with no further use it clears in about 30 game hours from the maximum. The rule lives in [OD-moodlets] of `docs/specs/2026-10-06-overdoing-it.md`. |
| **feeling sick** | The `Feeling sick` moodlet (-25), shown once per Sim while any food entry (an action that raises Hunger) is at or above 2.5. With no further eating it clears in about seven and a half game hours from the maximum. The rule lives in [OD-moodlets]. |

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
| **gain** | A completed conversation has a base affinity gain of 0.17 in each direction, scaled by compatibility. Poor hygiene or an unhelped critical need can block that person's gain. Pleasant proximity and recognized shared activities also contribute; see [relationship development](specs/2026-09-30-relationship-development.md). |
| **decay** | Every relationship drifts toward zero by 0.00001 per tick - a grudge fades on the same clock a friendship does. Maintenance matters. |
| **relationship scale** | A friend's conversation is worth up to 1.5x its authored value and a nemesis's 0.5x, so sims visibly prefer their friends. |

## Life satisfaction - the second axis

This is the long-term life score. Activity rewards, work, neglect and sustained
mood change it. It has no need bar to refill.

| Term | Means |
| --- | --- |
| `life satisfaction` | A long-term assessment from 0 to 100, starting at 50 with at most nine points of trait adjustment. Sustained mood, completed activities, careers and neglect change it over game months and years. The dock shows a status meter; hover or focus reveals its exact score. See [life satisfaction](specs/2026-10-01-life-satisfaction.md). |
| **hobby** | An activity tag a sim loves (`content/household.toml`). Completing a loved activity pays **3x** its base satisfaction. Tim loves correspondence and reading; Bill television and cooking; Casey socialising. |
| **tag** | A label on an activity (`cooking`, `reading`, `socialising`) - the vocabulary hobbies and traits both key on, so one word covers every activity that counts as that thing. |
| **deprivation** | Hunger or energy held at zero on consecutive simulation ticks. The counter resets when both recover. Death is enabled for new worlds and enabled once when older saves migrate; neglect remains a separate satisfaction penalty. |
| **grief** | A derived negative moodlet after a household death. Its strength and duration use the survivor's preserved affinity at death. It fades linearly to zero over 10 game days for a neutral acquaintance through 60 for the closest relationship; hatred produces neither grief nor a happiness bonus. Later newcomers do not grieve earlier deaths. |
| **death record** | Saved permanent SimId, name, cause, simulation tick and the identity boundary at death. It preserves a person after their entity is removed; family ties and survivors' affinities stay. |
| **neglect** | Each need below 15 costs 0.00001 life-satisfaction points per tick, about 0.0144 per game day before rounding. |

**Activity rewards pay on completion.** An interrupted activity pays no reward,
which is the same rule habituation and relationships follow. Mood contributes
separately while time passes, including during an activity.

## Traits - `traits:` in the overlay

Authored in `content/traits.toml`, worn by household members. Three
kinds, each doing exactly one thing:

| Kind | Does | Shipped example |
| --- | --- | --- |
| **disposition** | Weighs the CHOICE. Multiplies the score of anything carrying its tag. Never changes what the thing delivers - fearing the couch makes a sim avoid it, not fail to be comforted by it. | **Television devotee** (Bill): television-tagged activities score 1.5x. |
| **capability** | May attempt, may FAIL. A roll at the start of an attempt reads the **mastery** of the skill with the same tag. A failed attempt delivers `fail_delta_scale` of the benefits (usually nothing), pays no life satisfaction, and still **teaches**: every completed attempt adds practice to that skill. | **Can't cook** (Casey): her Cooking skill starts at mastery 0.25 and gains 0.015 practice per completed attempt. |
| **condition** | Scales life satisfaction ACCRUAL, and has a **severity** 0-1 that falls whenever the sim completes an activity carrying the condition's tag. A managed condition fades; a neglected one binds. | **Low spirits** (Tim): at full severity she earns 40% of normal; eases 0.005 per treating activity (her desk). |

| Term | Means |
| --- | --- |
| **fumble** | A failed capability roll, live on the current attempt. The meal happens; it just does not feed anybody. |
| **mastery** / **severity** (overlay) | The number the overlay prints beside a capability / condition. For a capability it is the matching skill's mastery from 0 to 1, not the skill's ladder level; the trait's own saved number no longer changes in play. |
| **trait library** | All fifteen traits in `content/traits.toml`. It is append-only: a sim's traits are stored as positions in this list, so a new trait goes at the end. Four of the fifteen are worn by nobody yet and wait for Create-a-sim. |
| **affinity verb** | The word a disposition trait's sentence opens with: Loves, Likes, Dislikes or Hates, chosen by its score multiplier against the two lines in `tuning.toml` ([TL-affinity]). The compiler refuses a sentence with the wrong one. |
| **Traits panel** | The Traits tab of Sim details for the selected person. Each row is the trait's label, one sentence saying what it does, and for a capability **Skill** or for a condition **Severity** as a whole percentage. A disposition has no number. Hidden while nobody is selected. |
| **Skill** / **Severity** | What the Traits panel calls the mastery of a capability's matching skill and a condition's severity, as a whole 0 to 100%. Skill is rounded down, so it never reads 100% while the person can still fumble; Severity is rounded to the nearest percent. Skill rises each time the person finishes an attempt, pass or fail; an attempt that is interrupted teaches nothing. Severity falls each time the person finishes the activity that manages the condition. |

## Skills - learned by doing

| Term | Means |
| --- | --- |
| **skill** | One craft a person gets better at by doing it, such as Cooking. Each skill is defined in `content/skills.toml` with a label, a one-sentence description, the activity tag it learns from and its number of levels. Sim details lists every skill in a collapsed Skills section in Overview. The rules are [SK-model] in `docs/specs/2026-10-05-skills.md`. |
| **practice** | The one number a person holds for each skill. Every completed interaction, chain step or conversation carrying the skill's tag adds that skill's `practice_per_attempt` to each participant, pass or fail; an interrupted attempt adds nothing. Practice is saved with the household ([SK-learning]). |
| **ladder** | How practice becomes a level. Level 1 costs `skill_level_cost` practice and each later level costs `skill_level_growth` times the one before; both live in `content/tuning.toml`. Progress is the share of the current level's cost already paid, and practice stops rising at the top level. |
| **mastery** | How far up the ladder a person is, from 0 to 1: the level plus progress, divided by the number of levels. The capability fumble roll and the Traits panel's Skill percentage read it ([SK-capability]). |

## Career

| Term | Means |
| --- | --- |
| `career:` | The sim's job, from `content/careers.toml`. |
| **shift** | Starts at a tick of the day (`shift_start` 360 = 06:00) on each of the career's **working days**, and lasts `shift_ticks` (480 = eight hours). |
| **working days** | The weekdays a career's shift runs, listed as `working_days` in `content/careers.toml` and compiled to a seven-bit mask with bit 0 for Monday. The office job works Monday to Friday. On any other day the worker stays home, and a shift already running when a rest day begins finishes as normal. The Career row in Sim details shows them with the shift hours ([CAL-careers]). |
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
| **lot** | The house, its yard and everything on them (`content/lot.toml`). Currently 20x16 tiles: a 16x12 house of five rooms in its north-west corner. |
| **house** | The lot's rectangle of indoor floor, from its north-west corner. Every tile outside it is **yard**. |
| **yard** | A lot tile outside the house: walkable floor to the simulation, drawn green until there is grass art. The house's walls facing the yard are cut away in the view, as its front sides always were. |
| **street** | The lot's last column across the yard from the front door, drawn grey until there is street art. Its **exit**, the tile in the door's row, is where a worker leaves for work and comes back; nothing may be built there. |
| **placement** | One object standing at one position. Several placements can share an object definition (two chairs, one `chair`). |
| **footprint** | How many tiles an object occupies. A 2x1 bed blocks two tiles, and nothing may overlap it. |
| **facing** | Which of the kit's four pre-rendered directions a placement is drawn with. Presentation only - the simulation neither knows nor cares which way a counter faces. |
| **doorway** | A passable segment of a wall, recorded as its own line. Doorways on both wall axes hold a **door** when the lot has the authored door style. |
| **family tie** | What one household member is to another: partner, parent, child or sibling. Chosen when somebody moves in, saved with the house, and shown beside the feeling in the relationship list. One stored fact per pair, read from either end, so a parent one way is a child the other. It names both people by SimId, never by entity index, so it stays with them whatever happens to the entity that carries them. Nothing in the simulation behaves differently for it yet. |
| **floor covering** | What the player has laid on a tile with the Floors tool: Boards, Tiles or Carpet, or nothing, which leaves the tile drawn by where it is. It changes how the tile is drawn and nothing else: nobody walks differently on carpet. Saved per painted tile. |
| **window** | A wall line nobody walks through and the day comes through: it stops people exactly as a wall does, passes **sky exposure** as a doorway does, and stops a lamp's pool as a wall does. Fitted with Window in the Walls tool. Drawn as the wall panel it stands in, washed pale blue, until there is window art. The front door's line never becomes one. |
| **line** | In the Walls tool, the boundary between two neighbouring floor tiles. Each line is open, a wall, a doorway or a **window**. The outside edge of the lot is not a line the tool can change, and the front door's line never becomes a wall or a window. |
| **door** | A hinged door standing in a doorway, which swings open as a sim walks through and closes behind them. The authored front-door style supplies solid models for both doorway axes, as used by the shipped lot. A door blocks nobody and is not saved: it follows from the walls. |
| **retired index** | An entity index a sale took out of use. The sold object is despawned without freeing its index, so no later spawn can take it; the V4 save lists every retired index so a Load keeps them out of use too. |
| **colourway** | A colour shift the game can draw a placed object in: its hues turned, its colours made stronger or weaker, its lightness shifted, with the colour of ink, metal and white left alone. Chosen in the Furniture tool's Colour list and saved with the game; the first colourway is the art as drawn. [RC-shift] in `docs/specs/2026-09-22-colourways.md`. |
| **Room tool** | Build mode's fourth tool. The player chooses two opposite corner tiles and, if they like, a line of the outline as the doorway, and Build room walls the whole outline in one edit. The whole room is refused or built together. |
| **outline** | In the Room tool, the lines on the edge of the chosen rectangle of tiles that are inside the lot. Lines on the lot's own edge are the outside wall and are left alone. |
| **price** | What an object costs in the Buy tool, in Funds (`price` in `content/objects.toml`). An object with no price is not for sale. A save stores Funds, never prices. |
| **catalogue** | Everything with a price, listed by name in the Buy tool. Items the household cannot afford are greyed out. |
| **Buy tool** | Build mode's third tool. The player chooses from the catalogue, points at the floor, turns the ghost and presses Buy. A purchase is refused where a move would be, and when Funds are short of the price; the status line says which. |
| **Walls tool** | Build mode's second tool. The player picks a line and presses Wall, Doorway or Remove. A wall is refused if it would cut through furniture, stand on a person, come between a person and what they are using, or cut part of the house off; the status line says which. |

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

For objects using the new identity fields, **type** is the plain primary identification, such as Washing machine; **model name** identifies the particular product, such as Perpetual Cycle; **description** supplies optional context and flavor text. The first slice covers the washing machine, armchair, and dining table. Menu and shop behavior is documented in [object identity](specs/2026-09-22-object-identity.md).

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
