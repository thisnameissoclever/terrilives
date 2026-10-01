# Game systems: inventory, build status, and proposals

Originally written 2026-09-21. Status reconciled on 2026-09-30 against main at `5ac34ca`, current content and commands, and merged PRs through #141. This document lists requested, planned and proposed systems. Completed slices are distinguished from unfinished full systems. Accepted proposals carry build status; undecided proposals remain proposals.

[FEATURES.md](FEATURES.md) still owns milestone scope and shipped evidence. This document owns the system-by-system view: what each system is, how complete it is, and what it needs before work can start.

**Next build: Edit Sims [B-edit-sims], selected by the owner on 2026-09-30.** The suggested order at the end starts with that slice. Later steps remain recommendations.

## How to read the status

Status follows implemented code and content, with merge evidence in FEATURES.md. The former percentage estimates have been removed: they were subjective and did not track shipped slices consistently. Each row now names what is built. A partial system can contain several completed slices without being complete as a whole.

| Label | Meaning |
|---|---|
| Not started | No code and no content. At most a paragraph in a plan. |
| Foundation only | A data type, a number on screen, or an engine hook exists, and the player cannot do anything with it yet. |
| Partial | The player can use a first slice. Most of the described system is missing. |
| Substantial | The system works in normal play. What remains is content volume or named extensions. |
| Complete | Nothing further is planned. |

Entry IDs use a word slug, such as `[S-pets]`, so that parallel branches cannot collide on a shared counter. `S` marks a requested or planned system, `P` marks a system this document proposes, and `F` marks a shared foundation that several systems need.

## Status at a glance

### Systems the owner asked for on 2026-09-21

| ID | System | Status | Shipped scope |
|---|---|---|---|
| [S-skills] | Skills | Foundation only | Three capability traits; no general skills system |
| [S-pets] | Pets as full characters | Not started | None |
| [S-household-events] | Random household events and messes | Not started | None |
| [S-money] | Money: deep earning and spending | Partial | Wages, purchases and sale proceeds |
| [S-catalogue] | Furniture and visual asset volume | Partial | 30 object types, reviewed replacements and recolour controls |
| [S-household-size] | More people in the house | Partial | Six-member capacity, creation and removal by death |
| [S-build] | Build mode: buying, walls, rooms, and a bigger house | Partial | Placement, buying/selling, walls, rooms, floors and windows |

### Systems the owner added in a second round on 2026-09-21

| ID | System | Status | Shipped scope |
|---|---|---|---|
| [S-sensitivities] | Sensory and social sensitivities | Not started | None |
| [S-acclimation] | Overdoing it, novelty, and acclimation | Partial | Action habituation only |
| [S-deep-traits] | Behaviour traits with hidden sub-traits | Foundation only | Existing trait kinds and personality multipliers |
| [S-sim-details] | An expandable details panel for each Sim | Partial | Collapsed personality factors, sleep rhythm and activity repetition in Overview; existing Traits and People panels |
| [S-advanced-controls] | An advanced controls toggle | Not started | None |
| [S-bed-assignment] | Assigning a Sim to a bed | In progress | Local runtime, saves, controls and place-specific routing; occupied visuals remain |

The owner also accepted and expanded four proposals in that round: [P-nuisance], [P-mood-feedback], [P-health], and [P-upkeep]. The table under "Proposed additional systems" records each decision.

### Systems already planned in the docs and not fully built

| ID | System | Status | Shipped scope |
|---|---|---|---|
| [S-traits] | Traits | Substantial | 15 traits, panel, wording and creation choices |
| [S-moods] | Moods and moodlets | Substantial | Derived moodlets, grief, waiting and satisfaction feedback |
| [S-chains] | Multi-step activities | Partial | Cooking dinner and resumable chain engine |
| [S-relationship-dynamics] | Relationship causes and consequences | Partial | Directional feelings, chat and living-person decay |
| [S-family] | Family relationships and kinship | Partial | Saved SimId ties and People labels; ties survive death |
| [S-careers] | Jobs and careers, with player-directed career paths | Partial | One scheduled office job with wages |
| [S-create-a-sim] | Create-a-sim and appearance | Partial | New housemate: name, personality, traits and family tie |
| [S-life-stages] | Life stages and aging | Not started | None |
| [S-birth-genetics] | Pregnancy, birth, and genetics | Not started | None |
| [S-death] | Death and its consequences | Partial | Deprivation, warning, setting, removal, records and grief |
| [S-outside] | A playable outside | Partial | Yard, street commute and daylight |
| [S-emergencies] | Fires, emergencies, and disasters | Not started | None |
| [S-town] | Town, neighbours, and other households | Not started | None |
| [S-ghosts] | Ghosts shared between players | Not started | None |
| [S-calendar] | Calendar and weekly schedules | Not started | Daily clock only; no weekly calendar |
| [S-action-animation] | Action animation coverage | Partial | Walking, conversation, eating, sitting, reading, fish, cycling and bunk sleep |
| [S-object-facing] | Object facing and layered depth | Partial | Supported rotation complete; depth layers partial |
| [S-audio] | Sound, ambience, music, and voices | Partial | Audio foundation and activity cues; broader sound content remains |

### Later owner requests, reviewed 2026-09-30

| Feature | Status | Boundary |
|---|---|---|
| [B-edit-sims] | Not started; next build | Existing names, personalities, traits and family ties |
| [B-gender] | Not started | Gender and saved appearance choices; new bodies and clothing need art |
| [B-object-affinities] | Not started | Individual reactions to kinds of objects and others' use |
| [B-colour-preferences] | Not started | Colour-family preferences, distinct from shipped recolour controls |

FEATURES.md records their requested behaviour and unresolved design choices.

### Systems that are built and carry the rest

These work in normal play today. They appear here because every new system must plug into them.

| System | Status | What exists |
|---|---|---|
| Needs | Substantial | Seven needs: hunger, energy, hygiene, bladder, social, fun, comfort. Each decays at its own rate. Personality, being at work, and being asleep each scale the decay. |
| Autonomy | Substantial | Each person scores every available action by how urgent the need is, how much the action helps, and how long it takes. The choice is weighted-random from a seeded generator, so the same save replays identically. |
| Habituation | Substantial | Repeating the same action on the same object pays less each time and recovers with time. This is what makes people rotate between objects. |
| Sleep rhythm | Substantial | A daily sleep-drive curve, a personal offset per personality, and an exhaustion ramp that guarantees a tired person eventually sleeps. |
| Player orders | Substantial | Unlimited stored orders per person, front or back placement, and current/queued action cards. The display reads only the visible prefix. |
| Time | Substantial | Pause and three speeds. One tick is one game minute and a day is 1,440 ticks. The HUD shows a day number and a time. |
| Save and load | Substantial | Save format version 5, with older versions still loadable. One browser save slot, daily autosave and New game; family, mortality, waiting, instinct and accumulated life satisfaction persist. |
| Pathfinding | Substantial | Shortest-path walking on one floor, through rooms and the yard to the street. Walls sit on tile edges; lot edits validate reachability from the front door. |
| HUD | Substantial | Roster, needs, mood, relationships, career, action cards, audio, saves, help and compact controls. Speed sits below Time and Funds; Build and Exit build sit at the sidebar's bottom. |
| Tuning file | Complete | Every system-wide tunable number lives in `content/tuning.toml`. Numbers that belong to one piece of content, such as a job's pay or an object's benefit, live in that content file. The build rejects invalid values in both. New systems follow the same split. |
| Content compiler | Substantial | The build refuses content with a broken reference, an unreachable interaction point, or inconsistent tuning. |

## Shared foundations to build first

Several requested systems need the same missing pieces. Building each piece once, before the systems that use it, avoids building it three times in three shapes.

### [F-entity-lifecycle] Adding and removing characters while the game runs

**Status: Partial.** A character can be added while the game runs: the New housemate form moves a named person in with a chosen personality and traits ([CS-slice-housemate]), and a debug stress-test tool can add bare characters with no name, personality, traits, or job.

Death now removes a character without freeing its entity index. The index is retired, and a saved death record preserves the person's identity. Removal releases the person's reservation, conversations, incoming queued orders and selection. Cleanup also releases an action if its owner loses Needs or its target loses SmartObject. Moving out, visitors and babies still need their own lifecycle rules.

### [F-creature] A character model that is not only human

**Status: Not started.** Today a character has exactly seven human needs, a human body, and human actions. Pets need their own need list, their own actions, their own body and animation set, and their own rules for which objects they can use.

The work is to separate "a thing that has needs, makes choices, walks, and has relationships" from "a human". Humans and each pet species then become content definitions on top of that shared base.

### [F-event-scheduler] A deterministic event scheduler

**Status: Not started.** No scheduled world event happens by chance. The seeded random generator is used for five things today: action choice, action length, where an idle person wanders, which voice clips a conversation plays, and the cooking fumble roll. There is no table of possible events, no per-event chance, and no cooldown.

Pet accidents, breakages, visitors, bills, and emergencies all need one scheduler. It must draw from the seeded random generator, save its cooldowns, and enter the world hash, because determinism is a hard rule in this project. The clock already exposes an hourly boundary that nothing uses, and that boundary is the natural place to roll for events.

### [F-object-state] Objects and tiles that carry state

**Status: Not started.** An object today is a fixed definition placed on a tile. It cannot be dirty, broken, full, empty, or owned. A floor tile cannot hold a mess.

Messes on the floor, a litter box that fills, a food bowl that empties, a sink that breaks, and a bin that overflows all need mutable state on objects or tiles. That state must be saved and hashed like everything else.

### [F-task-willingness] A willingness gate for unpleasant tasks

**Status: Not started.** The owner's pet example needs this: a person cleans up after the dog only when they are happy or motivated enough and are not too tired. The game has no such gate. Any person will start any action that scores well.

The proposal is one general rule. A task can declare a minimum mood and a maximum tiredness, and a person below the bar refuses the task, both on their own and when ordered. The same rule then serves cleaning, repairs, chores, homework, and exercise. Mood already changes life satisfaction under [MW-satisfaction]; task refusal remains unbuilt.

A task can also name the kind of unpleasantness it involves. A Sim who is sensitive to smells is less willing to clean up a dog mess than one who is not; [S-sensitivities] supplies that value.

### [F-notifications] A notification feed

**Status: Foundation only.** The HUD has four one-line status messages, for saves, orders, keyboard targeting, and build mode. Each is visible text that a screen reader also announces, and each shows only its latest message. There is no feed or history that tells the player "the dog made a mess in the kitchen" or "the rent is due".

Every event-driven system needs this feed, with a way to jump the camera to the place concerned.

**Owner direction, 2026-09-21.** The feed reports significant things that happened. The owner's examples: two Sims have an actual fight, a Sim is promoted, a Sim becomes despondent. Many trigger conditions across every system should produce notifications.

Each notification carries a channel, a type, and the Sim it concerns. A channel is a broad area, such as relationships, work, mood, money, pets, or the house. A type is one specific trigger, such as "promoted". The player can mute any one Sim, any one channel, or any one type, and the mutes are saved with the player's other preferences.

The feed keeps a history the player can scroll back through. A muted notification is still recorded in that history, so that muting hides an interruption without deleting what happened. Notifications are presentation: they read the simulation and never change it, which keeps them out of the world hash.

## Systems the owner asked for

### [S-skills] Skills

**Status: Foundation only.**

**What exists.** One trait, labelled "Can't cook", carries a competence number. It starts low, rises a little with every cooking attempt, and sets the chance that the person fumbles the meal. A fumbled meal costs the full time and pays none of the benefit. The engine calls this kind of trait a capability. Three of them exist as of PR 87: cooking, exercise and reading. The selected person's Traits panel shows each one's number as "Skill" and a percentage.

**What is missing.** A list of skills defined in content. A level and progress value per person per skill. Skill gain from doing tagged actions, with a tunable curve. A skills panel in the HUD.

Skills then need consequences. Higher skill should give better outcomes: tastier meals that fill more hunger, faster repairs, fewer fumbles. Some actions and chains should unlock at a level. Careers should read skills for performance and promotion, and the ghost design already assumes that ghosts teach skills.

**Design note.** The existing competence number should become the first skill, not remain a second, parallel mechanism. The fumble roll already works and already saves.

**Depends on.** Nothing. This system can start now.

### [S-pets] Pets as full characters

**Status: Not started.** No pet code or content exists. The aquarium is a piece of furniture with a "Watch the fish" action; no fish is simulated. [FEATURES.md](FEATURES.md) names pets in one paragraph under `[B-pets]`.

**The target.** A pet is a full character with the same depth as a person. It has its own needs, personality, preferences, relationships, and autonomous behaviour. It is never furniture.

**Pet needs.** Each species defines its own list. A dog might have hunger, energy, bladder, play, attention, and exercise. A cat might swap exercise for territory or scratching. The needs decay and drive choices through the same autonomy engine that people use.

**Pet personality and affinity.** Each pet has authored personality values, such as energy level, noisiness, affection, and obedience. Each pet holds a directional relationship toward every person and every other pet, and each person holds one back. A person also has a standing affinity per species, so one housemate can love dogs and merely tolerate cats.

**Pet behaviours that affect people.** Barking is the owner's worked example. A barking dog annoys every person within range, and the annoyance is stronger the closer the person is. Annoyance lowers that person's relationship toward the dog and adds a negative moodlet. This needs the nuisance field proposed in [P-nuisance], so that barking, a loud television, and a smoke alarm all use one mechanism.

Other behaviours in the same family: scratching furniture, begging at the table, waking a sleeping person, greeting someone at the door, sleeping on a bed, following a favourite person, fighting or playing with another pet, and hiding from a disliked person.

**Pet events.** The owner's second example: the dog fouls the floor. The event leaves a mess on a tile. The mess lowers comfort for anyone in the room until a person cleans it. A person can clean it only if they pass the willingness gate in [F-task-willingness]. Cleaning slightly lowers the cleaner's relationship toward the dog.

The chance of the accident should follow from the simulation and not be a flat dice roll. A dog with a full bladder that nobody has walked or let out is the dog that has the accident. That makes the event a consequence the player can prevent.

**Pet care duties.** Dogs need walks. Cats need a clean litter box. Both need a filled food bowl and water. Both benefit from play, grooming, and training. Each duty is an action a person performs, with a willingness gate, a relationship gain toward the pet, and a consequence when nobody does it. Walking a dog needs somewhere to walk, which means [S-outside], or a first version where the walk leaves through the front door the way a work shift does.

**Later parts.** Adoption and a household pet limit. Training that changes behaviour over time. Pet life stages, illness, and death. Species and breed appearance. Pets meeting other pets once a town exists.

**Depends on.** [F-creature], [F-entity-lifecycle], [F-event-scheduler], [F-object-state], [F-task-willingness], [F-notifications], and [P-nuisance]. It also needs a full new art and animation set per species, which is the largest cost in the whole entry.

### [S-household-events] Random household events and messes

**Status: Not started.**

**What exists.** Nothing. The bin and the laundry machine are decorative and have no actions. The kitchen sink's washing-up action restores the person's own hygiene and changes no object.

**What is missing.** The owner described this system through pets, and it is broader than pets. It covers things that happen to the household and demand a response: a pet accident, a spilled meal, dirty dishes left on the table, a full bin, a blocked toilet, a broken shower, a tripped fuse, a leaking tap.

Each event has a cause in the simulation where possible, a visible result in the world, a cost while it is ignored, and an action that resolves it. This entry is the everyday tier. [S-emergencies] is the dangerous tier and should use the same scheduler.

**Depends on.** [F-event-scheduler], [F-object-state], [F-task-willingness], [F-notifications].

### [S-money] Money: deep earning and spending

**Status: Partial.** The owner raised the target for this system on 2026-09-21, so the same code now covers a smaller share of it. Since PR 96 the household has something to spend on.

**What exists.** Shared Funds are saved and shown in the HUD. Tim's office job pays 120 per completed shift, purchases charge the object's price, and sales refund the tuned fraction of that price. Sales shipped in PR 101. Building walls, rooms and floors does not yet charge Funds.

**What is missing.** Costs for walls, floors and lot expansion, plus the recurring costs and income routes below. Purchase prices and sale refunds already work.

Recurring costs: rent or a mortgage, utility bills that scale with the house and what runs in it, groceries, and pet food and vet fees. Consequences for not paying, such as a shut-off utility or a repossessed object. The Funds number was deliberately built to allow a negative balance for this reason.

A household ledger in the HUD, so the player can see where money went. Per-person money is a later question; shared household funds is the right first version.

**Owner direction, 2026-09-21.** Earning and spending both need to be much deeper than one pay packet and a price list. The two lists below are the target.

**Ways to earn.** Wages from the career system in [S-careers], which is the main source and varies by job, level, and performance. Bonuses, overtime, and a raise on promotion. Side income from skills: selling paintings, writing, baked goods, repairs for neighbours, or garden produce. Freelance and gig work taken by the job, for people without a fixed career.

Selling owned objects at a depreciated price. Rent paid by a lodger, once [S-household-size] lets one move in. Windfalls and losses from events: a tax refund, an inheritance, a fine, a scam. Benefits or a pension for a person with no job, so that an unemployed household declines slowly and does not stop dead.

**Ways to spend.** Objects, walls, floors, and lot expansion through [S-build]. Rent or a mortgage, charged on a calendar period. Utility bills that follow what the household ran: long showers, lights left on, the television. Groceries and takeaway through [P-food]. Pet food, vet fees, and adoption fees through [S-pets].

Paid services through [P-services]: a cleaner, a repair person, a dog walker. Repairs and replacements through [P-upkeep]. Training courses and books that raise a skill faster. Medical costs through [P-health]. Leisure spending that buys fun or satisfaction, such as a night out, a holiday, or a gift that raises a relationship. Debt: an overdraft or a loan with interest, and consequences that escalate from a warning to a shut-off utility to a repossessed object.

**Balance is the hard part.** The economy works only if a typical household sits near break-even, so that a better job, a raise, or a cheaper habit is a decision the player feels. Every price and wage belongs in its content file, every system-wide rate belongs in the tuning file, and the headless trace tool that already reports funds over simulated days is the way to measure a change before shipping it.

**Depends on.** [S-careers] for income. [S-build] for buying and selling. [S-calendar] for pay days and billing periods. [F-notifications] for bills and warnings. [S-skills] for side income.

### [S-catalogue] Furniture and visual asset volume

**Status: Partial.**

**What exists.** 30 object types, all of them placed in the starting house. 19 have an action of their own. 18 of those offer one action, and the fridge offers two: a snack, and the start of cooking dinner. Of the other 11, the stove and the counter are working stations in the cooking activity, and 9 are decorative. 13 objects use the newer reviewed 3D-modelled art, plus the bunk, the exercise bike, and the reading chair. The original plan called for about 40 interactive objects at this stage.

**What is missing.** Volume, in several directions. More objects per need, at several quality and price tiers, so that buying a better bed means something. Several actions per object as the normal case. Objects for every new system: pet bowls, pet beds, a litter box, a lead hook, skill objects such as an easel or a workbench, a phone, outdoor furniture.

Floor-covering choices and furniture recolour controls are shipped; distinct floor art and final palettes remain open. More wall, door and window styles and more hairstyles, clothing and bodies remain. Rotation is supported for every movable or buyable object: 29 of 30 catalogue objects have four directions, while the aquarium has one. Further visual depth layers remain separate work.

**The real constraint.** Each new object currently passes through modelling, rendering to sprites, a primary review, an adversarial review, and integration into the sprite sheet. The catalogue grows only as fast as that pipeline runs. Making the pipeline faster per object is worth more than any single object.

**Depends on.** Pipeline capacity. [S-object-facing] for rotation.

### [S-household-size] More people in the house

**Status: Partial.**

**What exists.** The content format accepts up to six household members and rejects a seventh. The roster, the people panel, and the save format all handle six. The shipped household has three people, Tim, Bill, and Casey, and all three share one face, hairstyle, and body and differ only by shirt colour.

**Also completed.** New housemate moves a person in during play, optionally as a partner, parent, child or sibling. Death removes a member and frees household capacity, including a valid empty household that can be repopulated.

**What is missing.** Moving an existing person between households, moving out ([CS-slice-move-out]), births, adoption and capacity above six. Creating a new partner is supported; moving an existing off-lot partner in is not.

The shipped yard and room tools already let the player build more house and buy facilities. Appearance variety still belongs to [S-create-a-sim]. Whether six is the right household ceiling remains an open design question; the separate thousand-character rendering measurement does not settle household design.

**Depends on.** [F-entity-lifecycle], [S-create-a-sim], [S-build].

### [S-build] Build mode: buying, walls, rooms, and a bigger house

**Status: Partial.**

**What exists.** Build mode pauses the game. The player can select a placed object, move it, rotate it through the directions its art supports, and confirm or cancel. Since PR 95 a Walls tool beside it makes any line between two floor tiles a wall, a doorway or nothing, refusing a wall that would cut through furniture, stand on a person, come between a person and what they are using, or cut any part of the house off. The game refuses a move that would overlap a wall, furniture, or a person, block a doorway, cut a room off, or make any object's use point unreachable. Since PR 96 a Buy tool lists every object with its price, and a purchase stands the new object on the floor under the same rules as a move and takes the price from Funds. The save format already stores walls and furniture directions. Walls sit on tile edges, which is the right model for a wall tool.

**Completed slices.** Buy mode (PR 96), walls (95), whole rooms (97), vertical hinged doors (98), front-door reachability (99), catalogue need filtering (100), sales (101), compact build controls (102), rotated lighting (103), placed and purchased colourways (104, 105), the larger yard lot (106), street (107), visible build walls (112), floating placement controls (113), daylight (116), windows (126) and floor painting (128). These are merged features, not branch-only work. FEATURES.md records the individual merge and play evidence.

The 2026-09-30 corrections show furniture only at its preview position. Successful
Confirm and Cancel both clear selection. Sales allow removal of the last appliance;
impossible unfinished recipes abandon without payout. Active commitments still
prevent sales. Bookcase backs meet a tile edge in each supported rotation. Scope
and local evidence are in `docs/specs/2026-09-30-gameplay-ui.md`.

**What remains.**

1. Wall coverings, more floor art and room-wide floor painting.
2. Horizontal hinged-door art, window art and final recolour palettes.
3. Other lot sizes or player-directed expansion beyond the shipped 20 by 16 lot.
4. Multiple floors and stairs; pathfinding, rendering and the camera assume one floor.
5. Roofs and exterior presentation under [S-outside].
6. Undo/redo and building costs under [S-money].

**Depends on.** [S-money] for prices. [S-catalogue] for things worth buying. [S-object-facing] for rotation.

## Systems the owner added in a second round on 2026-09-21

### [S-sensitivities] Sensory and social sensitivities

**Status: Not started.** No Sim has any sensitivity value today.

**The target.** Each Sim has a sensitivity value in each of four primary categories: visual, auditory, olfactory, and social. The social category measures how much the presence and attention of other people wears on the Sim, which the owner also called antisocial and confirmed as the intended meaning on 2026-09-21. The category list is content, so more can be added later.

**How the values are set.** Each value is drawn at random when the Sim is created. The draw comes from the game's seeded random generator and the result is saved, so the same new game always produces the same household. The player can change any value at any time once [S-advanced-controls] is switched on. Such a change is a recorded player command, like an order, so replays still agree.

**How the values are used.** Every nuisance in [P-nuisance] declares how much of it reaches each category. The owner's example: a dog mess is mostly a smell and partly a sight. A Sim's annoyance is the strength of the nuisance where they stand, multiplied by their sensitivity in each category it touches.

A more sensitive Sim is annoyed more, keeps a greater distance from the source, and is less willing to be the one who deals with it. The first effect feeds moodlets and relationships. The second feeds where the Sim chooses to walk and which objects they prefer. The third feeds [F-task-willingness].

**Depends on.** Nothing to store and show the values. [P-nuisance] to give them an effect. The two should ship together, as the owner suggested.

### [S-acclimation] Overdoing it, novelty, and acclimation

**Status: Partial.**

**What exists.** Repeating the same action on the same object pays less each time. Each completed use lowers the benefit, the benefit recovers with time away, and it never falls below 45% of its full value. This is tracked separately for each Sim and each action on each kind of object, so two identical chairs count as one. It never turns negative, it covers actions only, and nothing in the game is new or old.

**Owner direction, part one: overdoing it.** The 45% floor goes away for mood. A Sim who keeps repeating an action, even one they once liked, eventually loses happiness from it, and loses more the longer they keep going.

An action's effect on its need is separate from its effect on happiness. Eating always reduces hunger. Eating again and again when not hungry lowers happiness and eventually makes the Sim feel sick. The first version of feeling sick can be a temporary condition with a moodlet; the full version belongs to [P-health].

**Owner direction, part two: new things.** Buy mode now supplies the purchase event, but the novelty boost is not built. The proposal gives every Sim a positive happiness boost when something new is bought, sized by item and colour affinity. Reconcile this with the later hated-item direction in [B-object-affinities] before implementation.

Being near the new thing keeps boosting the Sim for a while. The boost fades as the Sim grows used to the thing. It can return only after the Sim has spent long enough away from the thing, or has stopped doing the activity for long enough. The rate of fading belongs to each pairing of one Sim and one item, and it follows from that Sim's preferences.

**The floor for possessions is zero.** A thing a Sim has owned and lived beside for a long time stops bringing joy. It does not start causing unhappiness, at least not in most cases. Overdoing an action is the case that does go negative.

**The consequence the owner wants.** Keeping Sims above a baseline happiness takes continual novelty. The player either keeps buying new things and getting rid of old ones, or keeps giving Sims new experiences. Experiences join the same mechanism once there is a broader world to have them in. This treadmill suits the game's satirical tone, and it gives [S-money] a permanent reason to spend.

**Design notes.** Both halves are one mechanism: a familiarity value held by each Sim toward each object and each activity, rising with exposure and falling with absence. The existing per-action value is the start of it. Selling an old object needs a price, so [S-build] must let the player sell.

The game has two values a player might call happiness: mood, which moves minute to minute, and satisfaction, which is the long-term life score. The boosts and losses here are mood effects, delivered as moodlets, and satisfaction follows mood slowly through [P-mood-feedback]. The owner confirmed this reading on 2026-09-21.

**Depends on.** Part one depends on nothing. Part two depends on buy mode in [S-build], item properties in [S-catalogue], and affinities from [S-deep-traits].

### [S-deep-traits] Behaviour traits with hidden sub-traits

**Status: Foundation only.**

**What exists.** Fifteen traits across three kinds, and three personality types with multipliers on need decay, activity benefits and attraction. The Traits panel shows assigned traits. Numeric novelty-seeking, empathy and hidden sub-traits remain unbuilt.

**Owner direction.** The behaviour systems need to become much deeper, fed by a large set of traits. Each visible trait, such as novelty-seeking, is broken down into sub-traits that work under the hood. The owner's example: two Sims who both score eight for novelty-seeking should not have the same appetite for skydiving.

**The shape this implies.** A visible trait is a summary of several hidden values. Novelty-seeking might summarise appetite for physical risk, for new places, for new people, for new food, and for new possessions. Each action and item declares which hidden values it appeals to. The visible score is what the player sees first; the hidden values are what the autonomy engine reads.

Traits named so far by the owner's direction: novelty-seeking, which a poor mood raises, and empathy, which decides who can help a despondent Sim. Sensitivities in [S-sensitivities], item and colour affinities in [S-acclimation], tidiness in [P-chores], and species affinity in [S-pets] are all the same kind of value and should live in one model.

**Relation to [S-traits].** The three existing trait kinds remain. This entry adds a fourth kind, a graded value with hidden parts, and it moves the personality multipliers under the same model over time.

**Depends on.** Nothing to start. [S-sim-details] to show the values. [S-create-a-sim] to let the player set them.

### [S-sim-details] An expandable details panel for each Sim

**Status: Partial.** Overview contains a collapsed Personality, habits and bed section. The shipped read-only slice shows the seven personal need-drain and positive-refill factors, signed sleep rhythm in game minutes, and recent activity repetition with named meters and text percentages. Repetition follows the activity type across identical objects, including chains; it changes appeal, not the need refill. The local bed-assignment extension adds Assign and Clear controls; its place-specific routing is implemented locally, while occupied-bed visual checks remain open before publication. Needs, mood and moodlets, relationships, satisfaction, job, activity and Traits retain their existing panels. The broader make-up view and editing remain future work. See [the first slice](specs/2026-09-30-sim-details.md) and [bed assignment](specs/2026-10-01-bed-assignment.md).

**Owner direction.** Each Sim gets a details panel that the player can expand. It shows everything about the Sim, innate and temporary: sensitivities, traits and their hidden parts, affinities, skills, habits, familiarity with things, current moodlets, and anything later systems add. It presents them as many small bars, numbers, and similar marks, and it should be attractive to look at in the way good data graphics are.

**Design notes.** The panel can ship early with the data that already exists: needs, how fast each need falls for this Sim, how used they are to each object, relationship values, the cooking competence, the sleep rhythm offset, and satisfaction. Each later system then adds its rows. Innate values and temporary values should look different at a glance. Every bar needs a text value too, so the panel works with a screen reader and at phone width.

With [S-advanced-controls] on, the same panel is where the player edits a value.

**Depends on.** Nothing. It grows with every other system.

### [S-advanced-controls] An advanced controls toggle

**Status: Not started.** The only comparable thing today is a read-only developer overlay reached through a web address option.

**Owner direction.** A toggle in the game's settings. When it is on, the player can change values that are normally fixed, starting with each Sim's sensitivities. When it is off, those values are visible and locked.

**Design notes.** Every edit is a recorded player command, so that a replay of the same commands produces the same world. The toggle itself is a player preference and changes nothing in the simulation. It is a natural home for later options of the same kind, such as editing traits, setting a need, or setting Funds.

**Depends on.** [S-sim-details] for the place to edit.

### [S-bed-assignment] Assigning a Sim to a bed

**Status: In progress.** Owner-aware reservation release is implemented and
tested as groundwork. Assignment, simultaneous double-bed admission, save
migration, assignment controls and place-specific approach paths are implemented
and tested locally. The two-person sleeping display remains unfinished, so this
feature has not been published. The starting house has a bunk and a double bed.
See `docs/specs/2026-10-01-bed-assignment.md` and the routing/lifecycle evidence in
`docs/assets/review-evidence/bed-assignment/navigation.md`.

A separate shipped household capacity rule gives
every living member a -20 Not enough beds moodlet when sleep places are fewer
than people. The double bed counts as two places and the supported lower bunk
as one. This affects the shared sustained-mood satisfaction mechanism, without
assigning ownership or adding a separate drain.

**Owner direction.** The player can assign a Sim to a bed. The Sim then prefers that bed when tired, and other Sims leave it alone when they have a choice.

**Design notes.** This is the first slice of [P-ownership], and it should be built as that system's general rule applied to beds. A double bed has two places, so the assignment is to a sleeping place within the bed. An assigned Sim whose bed is unreachable or taken still sleeps somewhere else; exhaustion always wins.

**Depends on.** Nothing.

## Systems already planned in the docs and not fully built

### [S-traits] Traits

**Status: Substantial.** The engine supports three kinds of trait: a preference that makes certain actions more attractive, a competence that can fail and improves with practice, and a condition with a severity that the person manages over time. Fifteen traits exist as of PR 87: nine preferences, three competences and three conditions. Each household member has three or four, and the selected person's panel lists them with one sentence each and a percentage for a competence or a severity. Four of the fifteen belong to nobody yet. Plain affinity wording shipped in PR 109, and New housemate already lets the player choose up to four traits (PR 110). Editing existing Sims is next. The owner voice pass and random assignment for autonomously generated people remain open.

### [S-moods] Moods and moodlets

**Status: Substantial.** The HUD shows an overall mood and a list of moodlets for the selected person. They derive from needs, active conditions, nearby relationships, occupied-item waiting, bed shortages and death records. Grief lasts 10 to 60 game days according to affinity at death (PR 141). Sustained mood changes life satisfaction, and waiting for an occupied item adds a penalty scaled by the relevant need. The missing part is feedback into behaviour, which [F-task-willingness] and [P-mood-feedback] describe and which the owner has made a priority, and moodlets from events, memories, and surroundings.

### [S-chains] Multi-step activities

**Status: Partial.** The engine runs an activity made of several steps across several objects, with a carried item, and resumes it after an interruption. Exactly one such activity exists: cooking dinner. It needs cold storage, then a preparation surface, then a hob, then an eating surface, and at each step the person uses the nearest free object that fills that role. In the starting house that usually means fridge, counter, stove, and dining table. Candidates for more: laundry, washing up after a meal, making coffee, a full morning routine, feeding a pet, and cleaning a litter box.

### [S-relationship-dynamics] Relationship causes and consequences

**Status: Partial.** Each person holds a separate feeling toward every other person. Talking raises it and time slowly fades feelings toward living people. Affinity toward a dead person is preserved for grief. The shipped waiting moodlet does not implement the relationship penalty in [H12]. One social action exists, a two-person chat, with recorded voice clips that set its length. The relationships spec plans four additions in items `[H12]` through `[H15]`, and none is built. Item `[H16]` requires every one of them to be tunable, saved, hashed, and tested.

- `[H12]` A small penalty toward someone when you have to wait for an object they are using.
- `[H13]` Slow drift while sharing a room, positive for compatible personalities and negative for incompatible ones.
- `[H14]` Autonomous friendly conversations above a positive threshold, and fights below a negative one.
- `[H15]` Extroversion changing how readily a person starts either.

Also missing: more social actions than chat, group conversations (the content already declares a slot count that nothing reads), and a romance axis.

### [S-family] Family relationships and kinship

**Status: Partial.** A newcomer can arrive as somebody's partner, parent, child or sibling, the tie is saved with the house, and the relationship list says it beside the feeling. Ties name each person by SimId, so they stay with the people they join. Nothing in the simulation behaves differently for family yet, and there is no family tree view or relative outside the household. `[B-family-relationships]` in [FEATURES.md](FEATURES.md) and `docs/specs/2026-09-22-family.md` plan the rest. Ties survive death, and affinity-based bereavement is shipped under [S-death]. Genetics, inheritance and additional family-specific consequences remain open.

### [S-careers] Jobs and careers, with player-directed career paths

**Status: Partial.** The owner raised the target for this system on 2026-09-21, so the same code now covers a smaller share of it.

**What exists.** Tim holds the one office job, leaves through the front door and across the yard to the street, returns after the shift and receives 120 Funds. The job runs daily with fixed hours, need costs and a satisfaction reward. The HUD names it; there is no career-management panel or player-directed job choice yet.

**Owner direction, 2026-09-21.** The player must be able to direct each person's career choices, and every career must be a path with levels.

**Career paths.** Several careers defined in content, each a ladder of named levels. Each level sets its own title, hours, working days, pay, need costs, and the skills and mood it expects. The careers should differ in kind: steady and dull, well paid and exhausting, badly paid and satisfying, irregular shifts, night work. That difference is what makes the choice interesting, and it suits the game's satire of workplaces.

**Player direction.** A way to look for work, through a phone, a computer, or a newspaper, that shows the openings available today. The player picks one and the person applies. An application can succeed or fail on skills, traits, and work history. The player can also tell a person to quit, to ask for a raise, to go part-time, or to change career, and changing career should cost some seniority.

The player can set how a person works each shift: work hard, work normally, slack off, or socialise with colleagues. Each choice trades need costs against performance and workplace relationships. A person left without direction makes their own career choices from their traits and wants, as they do with everything else.

**Performance and promotion.** A performance value per person that rises and falls with each shift. It reads the person's mood and needs on arrival, their relevant skills, their traits, whether they turned up on time, and the effort setting. Enough performance over time earns a promotion to the next level. Poor performance earns a warning, then a demotion or dismissal.

**Work events.** Shift outcomes beyond the pay packet: a good day, a bad day, a bonus, a reprimand, a colleague who becomes a friend or an enemy. While the job remains off-screen, a short text choice during the shift can carry these, with each option trading risk against reward. Decision `[D15]` in [ARCHITECTURE.md](ARCHITECTURE.md) already requires that these outcomes pass through one interface, so that a workplace the player can watch can replace the off-screen version later.

**The rest of a working life.** Days off, sick days, and holidays, which need [S-calendar]. Unemployment, with its effect on money and satisfaction. Retirement and a pension, once [S-life-stages] exists. School for children and teenagers, as the same mechanism with grades in place of pay. A career history per person, which [P-memories] and [S-ghosts] both read.

**A career panel in the HUD.** Current job and level, pay, hours and working days, performance, what the next promotion needs, and the actions listed above.

**Already written down elsewhere.** `[B-jobs-careers]` in [FEATURES.md](FEATURES.md) lists the same scope in one paragraph, and `[D15]` plans workplaces the player can watch, with colleagues who are stable characters.

**Depends on.** [S-skills] first, because applications, performance, and promotion all read skills. [S-calendar] for working days and pay days. [F-notifications] for job offers, promotions, and warnings. [P-services] or an equivalent object for the job search. [S-money] is the other half of this system and the two should be designed together.

### [S-create-a-sim] Create-a-sim and appearance

**Status: Partial.** A New housemate form lets the player name a person, choose one of the three personalities and up to four traits, choose a family tie, and move them in during play ([CS-slice-housemate] in `docs/specs/2026-09-22-create-a-sim.md`). Editing existing people is the next slice, [B-edit-sims]. Every person still uses one approved face, hairstyle, and body, and there are no body, face, hair, or clothing options to choose from ([CS-slice-looks]). The shipped household is still authored in a content file. This blocks [S-household-size] from feeling real, and genetics later. On 2026-09-21 the owner called a character creator important. It should also set the values from [S-deep-traits] and [S-sensitivities], with a button that draws them at random.

### [S-life-stages] Life stages and aging

**Status: Not started.** Sims have no age and do not change life stage; deprivation can still kill them. The plan lists baby, toddler, child, teen, adult and elder. Each stage needs its own art, animation and permitted actions. Ages, lifespan tuning and older-save migration require design before [DE-slice-age].

### [S-birth-genetics] Pregnancy, birth, and genetics

**Status: Not started.** Depends on [S-family], [S-life-stages], [S-create-a-sim], and [F-entity-lifecycle].

### [S-death] Death and its consequences

**Status: Partial.** [DE-slice-neglect] implements deprivation deaths, on by default for new and migrated worlds, with an Options command, row warnings, saved death records, retired entity indices and affinity-based grief. Stronger affinity at death produces stronger, longer grief; hatred produces none. Aging, ghosts, bodies, memorials and inheritance remain unbuilt. See [B-death] in [FEATURES.md](FEATURES.md).

### [S-outside] A playable outside

**Status: Partial.** Yard and street merged in PRs 106 and 107. Workers cross the yard to leave via the street, and newcomers enter from it. PR 116 added outdoor daylight reaching rooms through doorways, and PR 126 added windows admitting that daylight. Roofs, further exterior presentation, outdoor objects and activities, and ambience remain. See [B-outside].

### [S-emergencies] Fires, emergencies, and disasters

**Status: Not started.** `[B-emergencies-disasters]` in [FEATURES.md](FEATURES.md) plans a general incident system, with fire and smoke as the first case. It should share [F-event-scheduler] with [S-household-events].

### [S-town] Town, neighbours, and other households

**Status: Not started.** This is milestone M3: several lots, a neighbourhood map, households that live their own lives off-screen, and visits between them. `[B-neighborhood-dynamics]` in [FEATURES.md](FEATURES.md) adds household-to-household relationships. The engine design for simulating distant households cheaply is decided in [ARCHITECTURE.md](ARCHITECTURE.md) and unbuilt.

### [S-ghosts] Ghosts shared between players

**Status: Not started.** This is milestone M4 and the game's signature feature. A dead person exports a record that appears as a ghost in other players' towns, haunts places, teaches skills, and leaves unfinished business. It depends on [S-death], [S-skills], [S-town], a sync service, and moderation tools, plus the owner's legal and policy items in [TIM-TODO.md](TIM-TODO.md).

### [S-calendar] Calendar and weekly schedules

**Status: Not started.** The HUD shows "Day N" and a time. There are no weekdays, weekends, dates, or seasons. A job runs every single day. Weekends, bill due dates, birthdays, bin day, and scheduled visits all need a calendar. It is cheap to build and many other systems need it.

### [S-action-animation] Action animation coverage

**Status: Partial.** Walking, talking, eating, sitting in the armchair, seated reading, standing reading, watching the fish, cycling, and lower-bunk sleeping are animated. Double-bed sleeping, cooking, washing, using the toilet, showering, watching television, sitting at the dining table, and standing idle are static poses. Every new system adds to this list: cleaning a mess, walking a dog, petting a cat, repairing a sink. On 2026-09-21 the owner asked for far more animations across the whole game.

### [S-object-facing] Object facing and layered depth

**Status: Partial.** Supported rotation and its saved direction are complete: 29 of 30 catalogue objects support four directions; the aquarium supports one. The bunk proves foreground layering over a person. Other moving or covering parts still need authored splits and review. [B-facing] distinguishes completed rotation from remaining depth work.

### [S-audio] Sound, ambience, music, and voices

**Status: Partial.** Footsteps, a rejected-order cue, 12 recorded conversation clips, and cues for sleeping, eating, reading, and exercise are in. Showering, handwashing and kitchen washing-up play provisional flowing-water recordings owned by the object in use. Door opening is silent; closing plays a filtered 0.32-second thunk. The Cook step plays a provisional first-party synthetic cooking texture through the same object-owned player. There is no music, room or outdoor ambience, alarm, or non-verbal voice for anything except conversation. Pets add barking, meowing, purring, and whining to this list. On 2026-09-21 the owner asked for far more sounds across the whole game.

## Proposed additional systems

These began as proposals. The decisions below remain in force; they are not all approved work. Accepted items are still unbuilt except for the shipped mood-to-satisfaction and waiting slices in [P-mood-feedback].

| ID | Decision on 2026-09-21 |
|---|---|
| [P-nuisance] | Accepted, and extended with per-Sim sensitivities in [S-sensitivities]. |
| [P-upkeep] | Accepted, and moved to the end of the build order. |
| [P-mood-feedback] | Accepted and expanded. The owner called it a big one. |
| [P-health] | Accepted. The owner asked for a health and medical system. |
| [P-ownership] | First slice accepted as [S-bed-assignment]. The rest is undecided. |
| [P-chores], [P-wants], [P-memories], [P-visitors], [P-food], [P-services], [P-room-quality] | Undecided. |

### [P-nuisance] Noise and nuisance with distance falloff

Something in the world emits a nuisance of a given kind and strength. Every character in range receives it, weaker with distance and blocked or reduced by walls. The owner's barking example needs exactly this. Built once as a general field, it also covers a loud television while someone sleeps, a smoke alarm, a bad smell from a mess or a full bin, and a crying baby. The lighting system already spreads light across tiles and stops it at walls, so the spreading logic has a working model to copy.

**Owner direction, 2026-09-21.** Each nuisance states how much of it reaches each sensory category. A dog mess is mostly a smell and partly a sight; barking is a sound. Each Sim reacts according to their own sensitivity in those categories, which [S-sensitivities] defines, so the same bark annoys one housemate and barely registers with another. A sensitive Sim also keeps further away from the source and is less willing to be the one who cleans it up.

### [P-upkeep] Dirt, wear, breakage, and repair

Objects get dirty with use and break with a chance that rises with wear. A dirty or broken object works worse or not at all. People clean and repair, and repair is a natural skill. This gives money something recurring to pay for, gives skills a purpose, and makes a cheap object differ from an expensive one. It builds on [F-object-state] and overlaps [S-household-events]; the two should be designed together.

**Owner direction, 2026-09-21.** Build this last. Messes from events and pets come earlier through [S-household-events]; wear, breakage, and repair wait until the end of the order.

### [P-chores] Chores and who does them

Once there are messes, dishes, litter boxes, and dog walks, the question of who does them becomes the comedy. People should differ in how readily they notice and take on a chore, driven by a trait such as tidiness. One person doing all the chores should resent the others, through the relationship system that already exists. The player should be able to assign a standing duty, such as "Casey walks the dog". This fits the game's dark-comedy tone unusually well.

### [P-mood-feedback] Mood that changes behaviour

**Status: Partial.** Mood-to-satisfaction and occupied-item frustration are complete. The behaviour, performance and despondency proposals below remain unbuilt.

Sustained mood now changes life satisfaction in either direction under [MW-satisfaction]. Occupied-item waiting lowers mood more strongly when the relevant need is low. Beyond this and the proposed willingness gate, a bad mood could make a person choose comfort actions over productive ones, snap at others in conversation, work worse, and learn slower. A good mood could do the reverse. Those effects on choices, conversations, work and learning remain unbuilt.

**Owner direction, 2026-09-21.** Mood should affect nearly everything. Once careers exist it affects performance at work, how much the Sim earns, and how likely a promotion is.

A poor mood raises novelty-seeking: an unhappy Sim goes looking for something new or fun. That holds only down to a threshold. Below it the Sim becomes despondent, stops seeking anything, and cannot recover alone in the ordinary way. Only another Sim with high empathy can help bring them out of it.

A despondent Sim keeps a small chance of finding the motivation to go and do something fun unprompted. That chance is above zero and far below the normal rate. It is drawn from the seeded random generator like every other chance in the game.

**Design notes.** Despondency is a state with its own entry and exit rules, and it should be saved. Helping a despondent Sim is a social action that only a Sim above an empathy threshold will offer or succeed at, and empathy comes from [S-deep-traits]. A household with no empathetic member needs another way out, such as a visitor or paid help through [P-health]; otherwise one bad week can end a game. Becoming despondent is one of the owner's named triggers for [F-notifications].

### [P-wants] Wants and short-term goals

Each person holds a few small current wants drawn from their traits, hobbies, relationships, and recent events: "talk to Bill", "buy a better bed", "get the dog to stop barking". Fulfilling a want pays satisfaction, and ignoring it costs a little. This would give the player direction and another satisfaction source alongside hobbies, work, need neglect and sustained mood.

### [P-memories] Life events and memories

A per-person log of notable things that happened: a promotion, a fight, the day the dog arrived, a death in the house. Memories produce long-lasting moodlets and colour relationships. The ghost design already requires "notable life events" in the record a dead person exports, so this log must exist before [S-ghosts]. It costs far less to start recording early than to reconstruct a life afterwards.

### [P-visitors] Visitors and guests

People who are not in the household come to the door: friends, a neighbour with a complaint about the barking, a delivery, a repair person, a date. This is the first step toward [S-town] and needs only the front door, not a whole neighbourhood. It needs [F-entity-lifecycle] and reuses everything a person already is.

### [P-food] Food, groceries, and meal quality

The fridge is bottomless and every meal is the same. Groceries that cost money and run out, meals whose quality depends on cooking skill and the quality of the stove, leftovers, and spoilage would connect [S-money], [S-skills], and [S-catalogue] through the one chain that already exists. Pet food fits the same model.

### [P-services] A phone and paid services

A phone or computer through which the household orders food, hires a cleaner, a repair person, or a dog walker, adopts a pet, and looks for a job. Each service converts money into relief from a chore. That trade is what makes the economy a set of decisions and not a rising number.

### [P-health] Illness and injury

People and pets can get sick or hurt, from neglect, from events, or by chance. Illness lowers needs faster, blocks some actions, and needs rest, medicine, or a paid visit. It is the step between "needs are low" and [S-death], and gives death a visible warning period.

**Owner direction, 2026-09-21.** The game needs a health and medical system. Feeling sick from overeating, described in [S-acclimation], is the first cause. The medical half covers medicine, rest, a doctor or vet visit that costs money, and help for a despondent Sim in a household where nobody has the empathy to give it.

### [P-room-quality] Room quality

Each room gets a score from its size, its lighting, its decoration, and any mess or broken object in it. The score feeds the comfort need and moodlets for whoever is in the room. This is what makes decorative objects, of which there are already 9, worth buying. Two inputs are missing today. The game has walls and no notion of a room, so it must first work out which tiles form each room. The light field exists only in the renderer, so the simulation cannot read it yet.

### [P-ownership] Personal belongings and territory

A bed, a chair, or a room can belong to one person. The armchair has no owner today. Using someone else's belongings lowers their feeling toward you. Cats in particular would claim furniture. It is a small system, and it produces household friction of a kind a player will recognise. The owner asked for its first slice, [S-bed-assignment], on 2026-09-21.

## A suggested build order

**Edit Sims is next, by owner direction on 2026-09-30.** Only that first position
is an approved priority. The later order remains a recommendation, subject to
design and owner choice. Each step must deliver playable behaviour, not isolated
infrastructure. FEATURES.md owns the same current priority.

1. **Edit Sims [B-edit-sims].** Reuse New housemate for existing names,
   personalities, traits and family ties. Settle progressed-trait removal and
   re-addition before implementation. No new art is required.
   The draft contract is `docs/specs/2026-09-30-edit-sims.md`; its proposed
   removed-trait history policy awaits the owner's answer.
2. **Object and colour affinities [B-object-affinities], [B-colour-preferences].**
   Recommended follow-up: connect different people's preferences to the shared
   room and the shipped mood-to-satisfaction mechanism. Reconcile novelty and
   nuisance rules before choosing the first playable slice.
3. **[S-skills] and [S-sim-details].** Extend capability progress into a general
   skills system and show existing and newly added values in the details panel.
4. **[S-calendar] and [F-notifications].** Weekly schedules and a history with
   channels and mutes. Buying, selling and their Funds changes are already done.
5. **[S-acclimation].** Negative mood from overdoing activities and a fading
   novelty boost. Purchase and sale mechanisms no longer block this work.
6. **[S-deep-traits], remaining [P-mood-feedback], and [S-advanced-controls].**
   Mood already affects satisfaction. Behaviour, performance and despondency
   remain, with empathy and recovery rules designed before implementation.
7. **[S-careers] and remaining [S-money].** Design career paths, job search,
   performance, bills and a ledger together. A phone or other job-search surface
   needs its own agreed slice; [P-services] remains an undecided broader proposal.
8. **[S-household-events].** Deliver object state, event scheduling and willingness
   through a playable mess-and-clean loop.
9. **[S-sensitivities] and [P-nuisance].** A loud television near a sleeper can
   prove the first slice; affinities should share its model where appropriate.
10. **Further character lifecycle and [F-creature].** Creation and death are
    complete. Visitors are a proposed human test case, pending acceptance;
    nonhuman needs and behaviour remain separate work required by pets.
11. **[S-pets], one species first.** Build on the care, nuisance and lifecycle
    mechanisms above, with the species art and animation they need.
12. **Remaining creation, household, building and outside slices.** Gender and
    appearance, moving out, larger households, bed assignment, roofs, further
    exterior work and other lot sizes. The wall/room tools, yard, street, floors,
    windows and New housemate are already shipped. Bed assignment can move earlier.
13. **[P-health].** The full health and medical system, including recovery options.
14. **[P-upkeep]**, last, as the owner directed. Event and pet messes precede wear,
    breakage and repair.

Aging [DE-slice-age] is the next death slice, but its ages, lifespans and migration
rules are not designed. It is not ahead of Edit Sims. Birth/genetics, town, ghosts,
memorials and inheritance remain later scope with their documented dependencies.
Deprivation death and its grief follow-ups are complete, not future build steps.

[S-catalogue], [S-action-animation] and [S-audio] continue alongside these systems.
Art and owner acceptance are separate from completed code slices. No art, policy
or proposal is approved merely by appearing in this order.


## [VA-status] Varied autonomy and self-preservation

Each new game starts with fresh browser cryptographic entropy. Saved games retain
their RNG state and subsequent choices. Each person has a saved integer
Self-preservation instinct from 0 through 100, displayed in Traits without taking
an optional slot. New housemate defaults to Random and offers a manual slider.
The authored starter people also draw independently across the full range.

All physically eligible actions retain positive selection probability. Needs,
personality, traits, relationships, habituation, travel and duration weight those
choices. Comfortable people vary their decisions more and retain appeal for Fun
and Social even at full meters. Very low instinct can neglect critical needs;
higher values increase urgency and penalize delays toward hunger or energy death.
This does not change need decay, restoration or death timing. See [VA-choice].
