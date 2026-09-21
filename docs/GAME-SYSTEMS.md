# Game systems: inventory, build status, and proposals

Written 2026-09-21 against `main` at `097a849`, and extended the same day with the owner's second round of direction. This document lists every major gameplay system that the owner has requested, that the docs already plan, or that this document proposes. Each requested, planned, and foundation entry states how much of it exists in the game today. A proposed system has no status, because none of it exists.

[FEATURES.md](FEATURES.md) still owns milestone scope and shipped evidence. This document owns the system-by-system view: what each system is, how complete it is, and what it needs before work can start.

## How to read the status

Every status was checked against the code and the content files, not against the plans. The percentage is a judgement of how much of the full system described in that entry exists today. It measures the distance to the finished system, so a working first slice of a large system scores low.

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

| ID | System | Status | Built |
|---|---|---|---|
| [S-skills] | Skills | Foundation only | 5% |
| [S-pets] | Pets as full characters | Not started | 0% |
| [S-household-events] | Random household events and messes | Not started | 0% |
| [S-money] | Money: deep earning and spending | Foundation only | 5% |
| [S-catalogue] | Furniture and visual asset volume | Partial | 15% |
| [S-household-size] | More people in the house | Partial | 35% |
| [S-build] | Build mode: buying, walls, rooms, and a bigger house | Partial | 20% |

### Systems the owner added in a second round on 2026-09-21

| ID | System | Status | Built |
|---|---|---|---|
| [S-sensitivities] | Sensory and social sensitivities | Not started | 0% |
| [S-acclimation] | Overdoing it, novelty, and acclimation | Partial | 20% |
| [S-deep-traits] | Behaviour traits with hidden sub-traits | Foundation only | 10% |
| [S-sim-details] | An expandable details panel for each Sim | Foundation only | 10% |
| [S-advanced-controls] | An advanced controls toggle | Not started | 0% |
| [S-bed-assignment] | Assigning a Sim to a bed | Not started | 0% |

The owner also accepted and expanded four proposals in that round: [P-nuisance], [P-mood-feedback], [P-health], and [P-upkeep]. The table under "Proposed additional systems" records each decision.

### Systems already planned in the docs and not fully built

| ID | System | Status | Built |
|---|---|---|---|
| [S-traits] | Traits | Substantial | 85% |
| [S-moods] | Moods and moodlets | Substantial | 60% |
| [S-chains] | Multi-step activities | Partial | 50% |
| [S-relationship-dynamics] | Relationship causes and consequences | Partial | 45% |
| [S-family] | Family relationships and kinship | Not started | 0% |
| [S-careers] | Jobs and careers, with player-directed career paths | Partial | 15% |
| [S-create-a-sim] | Create-a-sim and appearance | Not started | 0% |
| [S-life-stages] | Life stages and aging | Not started | 0% |
| [S-birth-genetics] | Pregnancy, birth, and genetics | Not started | 0% |
| [S-death] | Death and its consequences | Not started | 0% |
| [S-outside] | A playable outside | Not started | 0% |
| [S-emergencies] | Fires, emergencies, and disasters | Not started | 0% |
| [S-town] | Town, neighbours, and other households | Not started | 0% |
| [S-ghosts] | Ghosts shared between players | Not started | 0% |
| [S-calendar] | Calendar and weekly schedules | Not started | 0% |
| [S-action-animation] | Action animation coverage | Partial | 50% |
| [S-object-facing] | Object facing and layered depth | Partial | 40% |
| [S-audio] | Sound, ambience, music, and voices | Partial | 45% |

### Systems that are built and carry the rest

These work in normal play today. They appear here because every new system must plug into them.

| System | Status | What exists |
|---|---|---|
| Needs | Substantial | Seven needs: hunger, energy, hygiene, bladder, social, fun, comfort. Each decays at its own rate. Personality, being at work, and being asleep each scale the decay. |
| Autonomy | Substantial | Each person scores every available action by how urgent the need is, how much the action helps, and how long it takes. The choice is weighted-random from a seeded generator, so the same save replays identically. |
| Habituation | Substantial | Repeating the same action on the same object pays less each time and recovers with time. This is what makes people rotate between objects. |
| Sleep rhythm | Substantial | A daily sleep-drive curve, a personal offset per personality, and an exhaustion ramp that guarantees a tired person eventually sleeps. |
| Player orders | Substantial | A ten-order queue per person, orders that go to the front or the back, and clear feedback when an order is rejected. |
| Time | Substantial | Pause and three speeds. One tick is one game minute and a day is 1,440 ticks. The HUD shows a day number and a time. |
| Save and load | Substantial | Save format version 3, with older versions still loadable. One save slot in browser storage, a daily autosave, and New game. |
| Pathfinding | Substantial | Shortest-path walking on one floor, indoors. Walls sit on tile edges. The front door is the only exit. |
| HUD | Substantial | Roster, needs, mood, relationships, career, activity, orders, time, audio, save controls, help, a build dock, and a phone layout. |
| Tuning file | Complete | Every system-wide tunable number lives in `content/tuning.toml`. Numbers that belong to one piece of content, such as a job's pay or an object's benefit, live in that content file. The build rejects invalid values in both. New systems follow the same split. |
| Content compiler | Substantial | The build refuses content with a broken reference, an unreachable interaction point, or inconsistent tuning. |

## Shared foundations to build first

Several requested systems need the same missing pieces. Building each piece once, before the systems that use it, avoids building it three times in three shapes.

### [F-entity-lifecycle] Adding and removing characters while the game runs

**Status: Not started.** The household is fixed when a new game starts. The only way to add a character at runtime is a debug stress-test tool, and the character it creates has no name, personality, traits, or job.

Nothing in the game can remove a character either. The code that handles object reservations records three places that will leak a reservation once removal exists. Pets, new housemates, visitors, babies, and death all depend on this piece.

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

The proposal is one general rule. A task can declare a minimum mood and a maximum tiredness, and a person below the bar refuses the task, both on their own and when ordered. The same rule then serves cleaning, repairs, chores, homework, and exercise. Mood is currently a display-only summary, so this is also the first place mood would change behaviour.

A task can also name the kind of unpleasantness it involves. A Sim who is sensitive to smells is less willing to clean up a dog mess than one who is not; [S-sensitivities] supplies that value.

### [F-notifications] A notification feed

**Status: Foundation only.** The HUD has four one-line status messages, for saves, orders, keyboard targeting, and build mode. Each is visible text that a screen reader also announces, and each shows only its latest message. There is no feed or history that tells the player "the dog made a mess in the kitchen" or "the rent is due".

Every event-driven system needs this feed, with a way to jump the camera to the place concerned.

**Owner direction, 2026-09-21.** The feed reports significant things that happened. The owner's examples: two Sims have an actual fight, a Sim is promoted, a Sim becomes despondent. Many trigger conditions across every system should produce notifications.

Each notification carries a channel, a type, and the Sim it concerns. A channel is a broad area, such as relationships, work, mood, money, pets, or the house. A type is one specific trigger, such as "promoted". The player can mute any one Sim, any one channel, or any one type, and the mutes are saved with the player's other preferences.

The feed keeps a history the player can scroll back through. A muted notification is still recorded in that history, so that muting hides an interruption without deleting what happened. Notifications are presentation: they read the simulation and never change it, which keeps them out of the world hash.

## Systems the owner asked for

### [S-skills] Skills

**Status: Foundation only, about 5%.**

**What exists.** One trait, labelled "Can't cook", carries a competence number. It starts low, rises a little with every cooking attempt, and sets the chance that the person fumbles the meal. A fumbled meal costs the full time and pays none of the benefit. The engine calls this kind of trait a capability. Three of them exist as of PR 87: cooking, exercise and reading. The selected person's Traits panel shows each one's number as "Skill" and a percentage.

**What is missing.** A list of skills defined in content. A level and progress value per person per skill. Skill gain from doing tagged actions, with a tunable curve. A skills panel in the HUD.

Skills then need consequences. Higher skill should give better outcomes: tastier meals that fill more hunger, faster repairs, fewer fumbles. Some actions and chains should unlock at a level. Careers should read skills for performance and promotion, and the ghost design already assumes that ghosts teach skills.

**Design note.** The existing competence number should become the first skill, not remain a second, parallel mechanism. The fumble roll already works and already saves.

**Depends on.** Nothing. This system can start now.

### [S-pets] Pets as full characters

**Status: Not started, 0%.** No pet code or content exists. The aquarium is a piece of furniture with a "Watch the fish" action; no fish is simulated. [FEATURES.md](FEATURES.md) names pets in one paragraph under `[B-pets]`.

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

**Status: Not started, 0%.**

**What exists.** Nothing. The bin and the laundry machine are decorative and have no actions. The kitchen sink's washing-up action restores the person's own hygiene and changes no object.

**What is missing.** The owner described this system through pets, and it is broader than pets. It covers things that happen to the household and demand a response: a pet accident, a spilled meal, dirty dishes left on the table, a full bin, a blocked toilet, a broken shower, a tripped fuse, a leaking tap.

Each event has a cause in the simulation where possible, a visible result in the world, a cost while it is ignored, and an action that resolves it. This entry is the everyday tier. [S-emergencies] is the dangerous tier and should use the same scheduler.

**Depends on.** [F-event-scheduler], [F-object-state], [F-task-willingness], [F-notifications].

### [S-money] Money: deep earning and spending

**Status: Foundation only, about 5%.** The owner raised the target for this system on 2026-09-21, so the same code now covers a smaller share of it.

**What exists.** The household has one shared Funds number. It is saved and shown in the HUD. Exactly one thing changes it: Tim's office job pays 120 at the end of each shift. Nothing in the game costs money. A comment in the career content says so directly: the number is a score until there is something to buy.

**What is missing.** A price on every object. Charging for purchases and refunding for sales, which arrives with buy mode in [S-build]. Costs for walls, floors, and lot expansion.

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

**Status: Partial, about 15%.**

**What exists.** 30 object types, all of them placed in the starting house. 19 have an action of their own. 18 of those offer one action, and the fridge offers two: a snack, and the start of cooking dinner. Of the other 11, the stove and the counter are working stations in the cooking activity, and 9 are decorative. 13 objects use the newer reviewed 3D-modelled art, plus the bunk, the exercise bike, and the reading chair. The original plan called for about 40 interactive objects at this stage.

**What is missing.** Volume, in several directions. More objects per need, at several quality and price tiers, so that buying a better bed means something. Several actions per object as the normal case. Objects for every new system: pet bowls, pet beds, a litter box, a lead hook, skill objects such as an easel or a workbench, a phone, outdoor furniture.

Walls, floors, doors, and windows as selectable styles. Recolours of existing objects. More hairstyles, clothing, and body variation for people, which [S-create-a-sim] needs. Every rotatable object needs art for each direction it supports, and only a few have all four today.

**The real constraint.** Each new object currently passes through modelling, rendering to sprites, a primary review, an adversarial review, and integration into the sprite sheet. The catalogue grows only as fast as that pipeline runs. Making the pipeline faster per object is worth more than any single object.

**Depends on.** Pipeline capacity. [S-object-facing] for rotation.

### [S-household-size] More people in the house

**Status: Partial, about 35%.**

**What exists.** The content format accepts up to six household members and rejects a seventh. The roster, the people panel, and the save format all handle six. The shipped household has three people, Tim, Bill, and Casey, and all three share one face, hairstyle, and body and differ only by shirt colour.

**What is missing.** A way to add a person during play: a new housemate, a partner moving in, a baby, or an adopted child. A way for a person to leave. Both need [F-entity-lifecycle].

A larger household also needs a larger house, so that six people are not queueing for one bathroom. That ties this entry to [S-build]. More people need to look different from each other, which ties it to [S-create-a-sim]. Whether six is the right ceiling is an open design question; performance is not the limit, since the engine has been measured with a thousand characters on screen.

**Depends on.** [F-entity-lifecycle], [S-create-a-sim], [S-build].

### [S-build] Build mode: buying, walls, rooms, and a bigger house

**Status: Partial, about 20%.**

**What exists.** Build mode pauses the game. The player can select a placed object, move it, rotate it through the directions its art supports, and confirm or cancel. The game refuses a move that would overlap a wall, furniture, or a person, block a doorway, cut a room off, or make any object's use point unreachable. The save format already stores walls and furniture directions. Walls sit on tile edges, which is the right model for a wall tool.

**What is missing, in a sensible order.**

1. Buy mode: a catalogue panel, placing a new object, deleting or selling an object, and charging Funds for it.
2. A wall tool: draw and delete walls, place and move doors, with the same checks that every room stays reachable.
3. Floor and wall coverings per room or per tile.
4. Windows, which also affect the lighting already in the game.
5. A larger lot. The lot is 16 by 12 tiles and cannot change. This needs a lot-resize operation or a set of lot sizes to choose from.
6. Multiple floors, with stairs. Pathfinding, rendering, and the camera all assume one floor today, so this is the most expensive item on the list.
7. Roofs and exterior walls, which belong with [S-outside].
8. Undo and redo in build mode.

**Depends on.** [S-money] for prices. [S-catalogue] for things worth buying. [S-object-facing] for rotation.

## Systems the owner added in a second round on 2026-09-21

### [S-sensitivities] Sensory and social sensitivities

**Status: Not started, 0%.** No Sim has any sensitivity value today.

**The target.** Each Sim has a sensitivity value in each of four primary categories: visual, auditory, olfactory, and social. The social category measures how much the presence and attention of other people wears on the Sim, which the owner also called antisocial and confirmed as the intended meaning on 2026-09-21. The category list is content, so more can be added later.

**How the values are set.** Each value is drawn at random when the Sim is created. The draw comes from the game's seeded random generator and the result is saved, so the same new game always produces the same household. The player can change any value at any time once [S-advanced-controls] is switched on. Such a change is a recorded player command, like an order, so replays still agree.

**How the values are used.** Every nuisance in [P-nuisance] declares how much of it reaches each category. The owner's example: a dog mess is mostly a smell and partly a sight. A Sim's annoyance is the strength of the nuisance where they stand, multiplied by their sensitivity in each category it touches.

A more sensitive Sim is annoyed more, keeps a greater distance from the source, and is less willing to be the one who deals with it. The first effect feeds moodlets and relationships. The second feeds where the Sim chooses to walk and which objects they prefer. The third feeds [F-task-willingness].

**Depends on.** Nothing to store and show the values. [P-nuisance] to give them an effect. The two should ship together, as the owner suggested.

### [S-acclimation] Overdoing it, novelty, and acclimation

**Status: Partial, about 20%.**

**What exists.** Repeating the same action on the same object pays less each time. Each completed use lowers the benefit, the benefit recovers with time away, and it never falls below 45% of its full value. This is tracked separately for each Sim and each action on each kind of object, so two identical chairs count as one. It never turns negative, it covers actions only, and nothing in the game is new or old.

**Owner direction, part one: overdoing it.** The 45% floor goes away for mood. A Sim who keeps repeating an action, even one they once liked, eventually loses happiness from it, and loses more the longer they keep going.

An action's effect on its need is separate from its effect on happiness. Eating always reduces hunger. Eating again and again when not hungry lowers happiness and eventually makes the Sim feel sick. The first version of feeling sick can be a temporary condition with a moodlet; the full version belongs to [P-health].

**Owner direction, part two: new things.** This part waits for the in-game shop in [S-build]. Every Sim in the household gets a happiness boost when something new is bought. The size of the boost depends on that Sim's affinity for the kind of item, its colour, and similar properties, and it is always positive.

Being near the new thing keeps boosting the Sim for a while. The boost fades as the Sim grows used to the thing. It can return only after the Sim has spent long enough away from the thing, or has stopped doing the activity for long enough. The rate of fading belongs to each pairing of one Sim and one item, and it follows from that Sim's preferences.

**The floor for possessions is zero.** A thing a Sim has owned and lived beside for a long time stops bringing joy. It does not start causing unhappiness, at least not in most cases. Overdoing an action is the case that does go negative.

**The consequence the owner wants.** Keeping Sims above a baseline happiness takes continual novelty. The player either keeps buying new things and getting rid of old ones, or keeps giving Sims new experiences. Experiences join the same mechanism once there is a broader world to have them in. This treadmill suits the game's satirical tone, and it gives [S-money] a permanent reason to spend.

**Design notes.** Both halves are one mechanism: a familiarity value held by each Sim toward each object and each activity, rising with exposure and falling with absence. The existing per-action value is the start of it. Selling an old object needs a price, so [S-build] must let the player sell.

The game has two values a player might call happiness: mood, which moves minute to minute, and satisfaction, which is the long-term life score. The boosts and losses here are mood effects, delivered as moodlets, and satisfaction follows mood slowly through [P-mood-feedback]. The owner confirmed this reading on 2026-09-21.

**Depends on.** Part one depends on nothing. Part two depends on buy mode in [S-build], item properties in [S-catalogue], and affinities from [S-deep-traits].

### [S-deep-traits] Behaviour traits with hidden sub-traits

**Status: Foundation only, about 10%.**

**What exists.** Three traits, one of each kind the engine supports. Three personality types, each a set of multipliers on how fast needs fall, how much each activity satisfies, and how attractive some actions are. No Sim has a numeric value for anything like novelty-seeking or empathy.

**Owner direction.** The behaviour systems need to become much deeper, fed by a large set of traits. Each visible trait, such as novelty-seeking, is broken down into sub-traits that work under the hood. The owner's example: two Sims who both score eight for novelty-seeking should not have the same appetite for skydiving.

**The shape this implies.** A visible trait is a summary of several hidden values. Novelty-seeking might summarise appetite for physical risk, for new places, for new people, for new food, and for new possessions. Each action and item declares which hidden values it appeals to. The visible score is what the player sees first; the hidden values are what the autonomy engine reads.

Traits named so far by the owner's direction: novelty-seeking, which a poor mood raises, and empathy, which decides who can help a despondent Sim. Sensitivities in [S-sensitivities], item and colour affinities in [S-acclimation], tidiness in [P-chores], and species affinity in [S-pets] are all the same kind of value and should live in one model.

**Relation to [S-traits].** The three existing trait kinds remain. This entry adds a fourth kind, a graded value with hidden parts, and it moves the personality multipliers under the same model over time.

**Depends on.** Nothing to start. [S-sim-details] to show the values. [S-create-a-sim] to let the player set them.

### [S-sim-details] An expandable details panel for each Sim

**Status: Foundation only, about 10%.** The HUD shows the selected Sim's needs, mood and moodlets, relationships, satisfaction, job, and activity. A developer debug panel shows a few hidden numbers. Nothing shows a Sim's whole make-up in one place.

**Owner direction.** Each Sim gets a details panel that the player can expand. It shows everything about the Sim, innate and temporary: sensitivities, traits and their hidden parts, affinities, skills, habits, familiarity with things, current moodlets, and anything later systems add. It presents them as many small bars, numbers, and similar marks, and it should be attractive to look at in the way good data graphics are.

**Design notes.** The panel can ship early with the data that already exists: needs, how fast each need falls for this Sim, how used they are to each object, relationship values, the cooking competence, the sleep rhythm offset, and satisfaction. Each later system then adds its rows. Innate values and temporary values should look different at a glance. Every bar needs a text value too, so the panel works with a screen reader and at phone width.

With [S-advanced-controls] on, the same panel is where the player edits a value.

**Depends on.** Nothing. It grows with every other system.

### [S-advanced-controls] An advanced controls toggle

**Status: Not started, 0%.** The only comparable thing today is a read-only developer overlay reached through a web address option.

**Owner direction.** A toggle in the game's settings. When it is on, the player can change values that are normally fixed, starting with each Sim's sensitivities. When it is off, those values are visible and locked.

**Design notes.** Every edit is a recorded player command, so that a replay of the same commands produces the same world. The toggle itself is a player preference and changes nothing in the simulation. It is a natural home for later options of the same kind, such as editing traits, setting a need, or setting Funds.

**Depends on.** [S-sim-details] for the place to edit.

### [S-bed-assignment] Assigning a Sim to a bed

**Status: Not started, 0%.** Any Sim sleeps in any free bed. The starting house has a bunk and a double bed.

**Owner direction.** The player can assign a Sim to a bed. The Sim then prefers that bed when tired, and other Sims leave it alone when they have a choice.

**Design notes.** This is the first slice of [P-ownership], and it should be built as that system's general rule applied to beds. A double bed has two places, so the assignment is to a sleeping place within the bed. An assigned Sim whose bed is unreachable or taken still sleeps somewhere else; exhaustion always wins.

**Depends on.** Nothing.

## Systems already planned in the docs and not fully built

### [S-traits] Traits

**Status: Substantial, about 85%.** The engine supports three kinds of trait: a preference that makes certain actions more attractive, a competence that can fail and improves with practice, and a condition with a severity that the person manages over time. Fifteen traits exist as of PR 87: nine preferences, three competences and three conditions. Each household member has three or four, and the selected person's panel lists them with one sentence each and a percentage for a competence or a severity. Four of the fifteen belong to nobody yet. The remaining work is the owner's voice pass on the names and sentences ([T-trait-copy] in TIM-TODO.md), choosing traits when a person is created ([S-create-a-sim]), and rolling traits for people the game spawns by itself.

### [S-moods] Moods and moodlets

**Status: Substantial, about 60%.** The HUD shows an overall mood and a list of moodlets for the selected person. They derive from needs, active conditions, and nearby people the person likes or dislikes. Mood is display-only: it changes nothing a person does. The missing part is feedback into behaviour, which [F-task-willingness] and [P-mood-feedback] describe and which the owner has made a priority, and moodlets from events, memories, and surroundings.

### [S-chains] Multi-step activities

**Status: Partial, about 50%.** The engine runs an activity made of several steps across several objects, with a carried item, and resumes it after an interruption. Exactly one such activity exists: cooking dinner. It needs cold storage, then a preparation surface, then a hob, then an eating surface, and at each step the person uses the nearest free object that fills that role. In the starting house that usually means fridge, counter, stove, and dining table. Candidates for more: laundry, washing up after a meal, making coffee, a full morning routine, feeding a pet, and cleaning a litter box.

### [S-relationship-dynamics] Relationship causes and consequences

**Status: Partial, about 45%.** Each person holds a separate feeling toward every other person. Talking raises it and time slowly fades it. One social action exists, a two-person chat, with recorded voice clips that set its length. The relationships spec plans four additions in items `[H12]` through `[H15]`, and none is built. Item `[H16]` requires every one of them to be tunable, saved, hashed, and tested.

- `[H12]` A small penalty toward someone when you have to wait for an object they are using.
- `[H13]` Slow drift while sharing a room, positive for compatible personalities and negative for incompatible ones.
- `[H14]` Autonomous friendly conversations above a positive threshold, and fights below a negative one.
- `[H15]` Extroversion changing how readily a person starts either.

Also missing: more social actions than chat, group conversations (the content already declares a slot count that nothing reads), and a romance axis.

### [S-family] Family relationships and kinship

**Status: Not started, 0%.** The game does not know who is whose parent, sibling, or partner. `[B-family-relationships]` in [FEATURES.md](FEATURES.md) plans a kinship graph and a family tree view. Genetics, inheritance, and bereavement depend on it.

### [S-careers] Jobs and careers, with player-directed career paths

**Status: Partial, about 15%.** The owner raised the target for this system on 2026-09-21, so the same code now covers a smaller share of it.

**What exists.** One career exists, an office job. One person holds it. They walk to the front door, vanish for the shift, return, and get paid a fixed 120. The job runs every day, never changes, and the player has no say in it. The HUD shows the job's name and nothing else about it.

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

**Status: Not started, 0%.** Every person uses one approved face, hairstyle, and body. The household is authored in a content file. There is no screen for making a person, and no body, face, hair, or clothing options to choose from. This blocks [S-household-size] from feeling real, and genetics later. On 2026-09-21 the owner called a character creator important. It should also set the values from [S-deep-traits] and [S-sensitivities], with a button that draws them at random.

### [S-life-stages] Life stages and aging

**Status: Not started, 0%.** Everyone is an adult forever. The plan lists baby, toddler, child, teen, adult, and elder. Each stage needs its own body art, animation set, and permitted actions, so the art cost is several times the code cost.

### [S-birth-genetics] Pregnancy, birth, and genetics

**Status: Not started, 0%.** Depends on [S-family], [S-life-stages], [S-create-a-sim], and [F-entity-lifecycle].

### [S-death] Death and its consequences

**Status: Not started, 0%.** Nobody can die. The plan treats death as a required system, not a fail state, because the ghost feature depends on it. `[B-death]` in [FEATURES.md](FEATURES.md) lists causes, warnings, grief, inheritance, and player controls for sudden deaths. Depends on [F-entity-lifecycle].

### [S-outside] A playable outside

**Status: Not started, 0%.** The house is an interior with nothing around it. The front door is where a worker disappears. `[B-outside]` in [FEATURES.md](FEATURES.md) plans a yard, a street, exterior walls, roofs, and outdoor lighting. Dog walking, visitors arriving, gardening, and neighbours all need it.

### [S-emergencies] Fires, emergencies, and disasters

**Status: Not started, 0%.** `[B-emergencies-disasters]` in [FEATURES.md](FEATURES.md) plans a general incident system, with fire and smoke as the first case. It should share [F-event-scheduler] with [S-household-events].

### [S-town] Town, neighbours, and other households

**Status: Not started, 0%.** This is milestone M3: several lots, a neighbourhood map, households that live their own lives off-screen, and visits between them. `[B-neighborhood-dynamics]` in [FEATURES.md](FEATURES.md) adds household-to-household relationships. The engine design for simulating distant households cheaply is decided in [ARCHITECTURE.md](ARCHITECTURE.md) and unbuilt.

### [S-ghosts] Ghosts shared between players

**Status: Not started, 0%.** This is milestone M4 and the game's signature feature. A dead person exports a record that appears as a ghost in other players' towns, haunts places, teaches skills, and leaves unfinished business. It depends on [S-death], [S-skills], [S-town], a sync service, and moderation tools, plus the owner's legal and policy items in [TIM-TODO.md](TIM-TODO.md).

### [S-calendar] Calendar and weekly schedules

**Status: Not started, 0%.** The HUD shows "Day N" and a time. There are no weekdays, weekends, dates, or seasons. A job runs every single day. Weekends, bill due dates, birthdays, bin day, and scheduled visits all need a calendar. It is cheap to build and many other systems need it.

### [S-action-animation] Action animation coverage

**Status: Partial, about 50%.** Walking, talking, eating, sitting in the armchair, seated reading, standing reading, watching the fish, cycling, and lower-bunk sleeping are animated. Double-bed sleeping, cooking, washing, using the toilet, showering, watching television, sitting at the dining table, and standing idle are static poses. Every new system adds to this list: cleaning a mess, walking a dog, petting a cat, repairing a sink. On 2026-09-21 the owner asked for far more animations across the whole game.

### [S-object-facing] Object facing and layered depth

**Status: Partial, about 40%.** A few objects have art for all four directions. The bunk is the only object that draws a front layer over a person. Televisions, fridge doors, and other objects with moving or covering parts still need their own split art. `[B-facing]` in [FEATURES.md](FEATURES.md) has the detail.

### [S-audio] Sound, ambience, music, and voices

**Status: Partial, about 45%.** Footsteps, a rejected-order cue, 12 recorded conversation clips, and cues for sleeping, eating, reading, and exercise are in. Two object loops are wired and silent until recordings are chosen: the shower and the stove. There is no music, no room or outdoor ambience, no door sound, no alarm, and no non-verbal voice for anything except conversation. Pets add barking, meowing, purring, and whining to this list. On 2026-09-21 the owner asked for far more sounds across the whole game.

## Proposed additional systems

None of these was planned in the docs before this document. Each is offered for the owner to accept, change, or reject by ID.

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

Mood is display-only today. Beyond the willingness gate, a bad mood could make a person choose comfort actions over productive ones, snap at others in conversation, work worse, and learn slower. A good mood could do the reverse. Without this, mood is a readout the player can ignore.

**Owner direction, 2026-09-21.** Mood should affect nearly everything. Once careers exist it affects performance at work, how much the Sim earns, and how likely a promotion is.

A poor mood raises novelty-seeking: an unhappy Sim goes looking for something new or fun. That holds only down to a threshold. Below it the Sim becomes despondent, stops seeking anything, and cannot recover alone in the ordinary way. Only another Sim with high empathy can help bring them out of it.

A despondent Sim keeps a small chance of finding the motivation to go and do something fun unprompted. That chance is above zero and far below the normal rate. It is drawn from the seeded random generator like every other chance in the game.

**Design notes.** Despondency is a state with its own entry and exit rules, and it should be saved. Helping a despondent Sim is a social action that only a Sim above an empathy threshold will offer or succeed at, and empathy comes from [S-deep-traits]. A household with no empathetic member needs another way out, such as a visitor or paid help through [P-health]; otherwise one bad week can end a game. Becoming despondent is one of the owner's named triggers for [F-notifications].

### [P-wants] Wants and short-term goals

Each person holds a few small current wants drawn from their traits, hobbies, relationships, and recent events: "talk to Bill", "buy a better bed", "get the dog to stop barking". Fulfilling a want pays satisfaction, and ignoring it costs a little. This gives the player direction at every moment, and it gives the satisfaction score, which already exists, a third source besides hobbies and completed work shifts.

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

A bed, a chair, or a room can belong to one person. The armchair is already named "The Chair That Is His". Using someone else's belongings lowers their feeling toward you. Cats in particular would claim furniture. It is a small system, and it produces household friction of a kind a player will recognise. The owner asked for its first slice, [S-bed-assignment], on 2026-09-21.

## A suggested build order

This order is a recommendation. It puts each foundation before the systems that need it, and it keeps something new and playable at every step, which is the project's standing rule for milestones.

1. **[S-skills] and the first version of [S-sim-details].** Neither depends on anything. The panel starts with the data the game already has and gains rows with every later step.
2. **[S-calendar], [F-notifications] with channels and mutes, and buy mode with prices from [S-build] and [S-money].** Money gains a purpose the moment there is something to buy.
3. **[S-acclimation].** Overdoing it needs nothing new. The boost from new purchases needs the shop from step 2.
4. **[S-deep-traits] and [P-mood-feedback], with [S-advanced-controls].** Work performance reads mood, so mood must affect behaviour before careers are balanced.
5. **[S-careers] and the rest of [S-money], designed as one economy, with the phone from [P-services] as the way to look for work.** Career paths, the job search, performance, bills, and the ledger land together, so that income and costs can be balanced against each other from the start.
6. **[F-object-state], [F-event-scheduler], and [F-task-willingness], delivered through [S-household-events].** People can exercise the mess-and-clean loop alone, before any pet exists.
7. **[S-sensitivities] and [P-nuisance], together.** A loud television near a sleeper proves both without new art.
8. **[F-entity-lifecycle] and [F-creature], delivered through [P-visitors] first.** A visitor is a human, so it tests adding and removing characters without the cost of a new species.
9. **[S-pets], one species first.** By this point every mechanism a dog needs already exists and has been played. What remains is the dog's own content, art, and animation.
10. **The wall tool, a larger lot, [S-create-a-sim], [S-household-size], and [S-bed-assignment].** New housemates need to look different from each other, so making a person comes first. Bed assignment depends on nothing and can move earlier.
11. **[S-outside]**, which dog walks and visitors make more valuable by then.
12. **[P-health].** The sick feeling from overeating ships earlier as a simple condition; this step is the full system.
13. **[P-upkeep]**, last, as the owner directed.

This order covers the owner's requests and what they depend on. It leaves out the later planned systems, such as life stages, death, the town, and ghosts, and most of the proposals; each of those takes a place when it is accepted or when its milestone comes up.

[S-catalogue], [S-action-animation], and [S-audio] are not steps in this order. They run alongside every step, limited by the art pipeline and not by code.

The main risk in this plan is art throughput, not engineering. Nearly every system above needs new objects, new character animations, or a whole new species, and each of those passes through the same review pipeline. A pet species is the largest single art commitment in this document.
