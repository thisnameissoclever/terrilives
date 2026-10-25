# Activity log and richer conversation topics

Issue 275 asks for a player-facing log of what the household does: a button at the top right opens a right-side panel, seven filters choose what each line says, and selecting a housemate narrows the log to events that involve them. This document is the contract for that work. The phase 1 sections describe the log as built; [AL-topics] describes phase 2, which is still proposed. The [implementation plan](../superpowers/plans/2026-10-18-activity-log.md) orders the work into two separately mergeable phases: the log first, then richer conversation topics.

The design was written on 2026-10-18 against main `10ced796b`. Facts about the current code below were read from that revision; the plan repeats the checks an implementer should run before relying on them.

## Contents

- [[AL-decisions] Owner decisions this design follows](#al-decisions-owner-decisions-this-design-follows)
- [[AL-terms] Terms](#al-terms-terms)
- [[AL-boundary] The log sits outside the simulation](#al-boundary-the-log-sits-outside-the-simulation)
- [[AL-record] The event record](#al-record-the-event-record)
- [[AL-sources] Event sources](#al-sources-event-sources)
- [[AL-capture] Capturing data the game discards or never records](#al-capture-capturing-data-the-game-discards-or-never-records)
- [[AL-compose] One line per event](#al-compose-one-line-per-event)
- [[AL-selected] The selected housemate](#al-selected-the-selected-housemate)
- [[AL-group] Grouping repeated events](#al-group-grouping-repeated-events)
- [[AL-numbers] Which numbers Details shows](#al-numbers-which-numbers-details-shows)
- [[AL-bridge] The wasm bridge and the shell drain](#al-bridge-the-wasm-bridge-and-the-shell-drain)
- [[AL-panel] The panel at desktop and phone widths](#al-panel-the-panel-at-desktop-and-phone-widths)
- [[AL-persist] Session only](#al-persist-session-only)
- [[AL-perf] Performance budget and measurement](#al-perf-performance-budget-and-measurement)
- [[AL-topics] Phase 2: richer conversation topics](#al-topics-phase-2-richer-conversation-topics)
- [[AL-tests] Tests](#al-tests-tests)
- [[AL-evidence] Played evidence before delivery](#al-evidence-played-evidence-before-delivery)
- [[AL-strings] New player-visible strings for owner review](#al-strings-new-player-visible-strings-for-owner-review)
- [[AL-rulings] Rulings taken without the owner](#al-rulings-rulings-taken-without-the-owner)
- [[AL-questions] Questions for the owner](#al-questions-questions-for-the-owner)
- [[AL-research] Corrections to the earlier research report](#al-research-corrections-to-the-earlier-research-report)
- [[AL-out] What this does not do](#al-out-what-this-does-not-do)

## [AL-decisions] Owner decisions this design follows

The owner decided these points on 2026-10-17 and 2026-10-18.

1. Seven filters, as the issue lists them: Actions, Chores, Social, Skills, Career, Details and Time. Actions, Social and Career are on by default. None of the extra filters the research suggested (Problems, Mood, Household, Money, Relationships) is added; none is needed to satisfy the issue.
2. Lines read "Name: label", built from the game's existing action and interaction labels, for example "Tim: Read a book". Clauses that filters add need some new wording. It stays plain and minimal and is listed in [AL-strings] for review beside a running build, per lesson L58 and [the string inventory](../player-visible-strings.md).
3. The log is session only. It is not saved, it clears on Load and New game, and the save format does not change.
4. Richer conversation topics belong to this issue: player-readable topic words, a fix for the topic-code overlap, and subjects such as trains and bicycling. They ship as a second phase that merges separately.
5. Performance is critical. The log sits outside simulated and saved state, never feeds back into the simulation, never enters the world hash, is bounded, and is read incrementally by the shell.
6. Details shows numbers only where they compare with other quantities, rounded to integers.
7. Time adds a prefix such as `D74, T15:45` and is off by default.
8. A guest who finishes a portion of a shared meal someone else cooked appreciates the cook, as [the meal appreciation specification](2026-10-18-meal-appreciation.md) defines. The log shows that appreciation on the guest's meal line under Social.

## [AL-terms] Terms

| Term | Meaning |
| --- | --- |
| Event | One thing that happened in the simulation at one tick, such as a finished chat or a weekly review. |
| Record | The fixed-size numeric description of one event that the simulation hands to the shell. It holds no text. |
| Parent and child | A child record adds a clause to its parent's line instead of making a line of its own. An appreciation is a child of the chore or meal it rewards. |
| Line | What the panel shows for one parent record and its children. |
| Head | The part of a line every visible line shows: `Name: label`, with the other person and topic when the event has them. |
| Clause | A part of a line that one filter adds, such as the Social reactions or the Career outcome. |
| Trigger | A filter whose clause, when that filter is on, makes the line visible. Details and Time never trigger. |
| Opinion | One person's directional feeling toward another, stored from -1 to 1 and shown on the People panel as a band. Details shows it multiplied by 100. |
| Tick | One game minute. A game day is 1,440 ticks. |

## [AL-boundary] The log sits outside the simulation

The simulation keeps a resource, `ActivityLog`, in its ECS world. It is created empty with the world, so a Load, which builds a fresh world, starts with an empty log. It is never saved, never read by any simulation system, and absent from `Sim::world_hash`, which hashes an explicit list of resources and components. The resource holds a fixed-capacity staging ring of records, a small scratch area keyed by stable `SimId` for values that must be accumulated across ticks, and an `enabled` flag used for the disabled performance baseline.

Five rules keep the log from perturbing the game:

1. Emission reads values the simulation has already computed and copies them. It never draws from `SimRng`, never changes a component, never inserts or removes a component, and never adds a query whose iteration order could change another system's order.
2. All log state lives in the one resource, keyed by `SimId`. Per-person log state stored as components would change archetype layouts and therefore the iteration order of unsorted queries, which lesson L5 shows can change outcomes.
3. The schedule is single-threaded (`ExecutorKind::SingleThreaded` in `crates/terri-sim/src/lib.rs`), so giving systems write access to the resource cannot reorder them.
4. End-of-tick work (linking children to parents, closing episodes) runs in `Sim::tick` and `Sim::flush_commands` after the schedule, the same place completion sounds are handled, not as a scheduled system.
5. The Build transaction carries unsaved feedback resources across its world swaps in `copy_feedback` (`crates/terri-sim/src/build_transaction/ordinary_runtime.rs`). `ActivityLog` joins that list so a confirmed or canceled build neither loses nor repeats staged records.

## [AL-record] The event record

A record is twelve little-endian `u32` words, 48 bytes. The simulation never builds strings for it; every label is an index into a label table the shell reads once.

| Word | Field | Meaning |
| --- | --- | --- |
| 0 | `seq` | Sequence number, from 1, increasing by one per record within one world. |
| 1 | `tick` | Simulation tick of the event, saturated to `u32`. |
| 2 | `kind`, `triggers`, flags | Bits 0 to 7: the kind below. Bits 8 to 15: the trigger mask. Bits 16 to 23: flags. Bit 16 marks the actor's Social total as partial and bit 17 the other person's ([AL-capture] item 4); Details omits a partial total. |
| 3 | `actor` | The `SimId` the line is about. |
| 4 | `other` | A second `SimId`, or `u32::MAX` for none. |
| 5 | `label` | Index into the label table: an action, chain, social interaction, topic tag, skill, career level or chore duty label. |
| 6 | `label2` | A second label index, or `u32::MAX`. |
| 7 | `parent` | `seq` of the parent record, or 0. Set by the end-of-tick link pass, which only links records of the same tick and prefers the nearest earlier candidate, then the nearest later one. |
| 8 to 11 | `v0` to `v3` | Signed values whose meaning depends on the kind. |

Trigger mask bits: Actions 1, Chores 2, Social 4, Skills 8, Career 16. Details and Time have no bit because they never make a line visible.

Values use fixed units so the shell rounds once: needs in tenths of a point; opinion changes in ten-thousandths of the -1 to 1 scale, so 100 units is one displayed point; preferences, fit and mood multiplied by 100; performance and percentages as whole numbers.

| Kind | Parent or child | Triggers | Fields |
| --- | --- | --- | --- |
| 1 Action done | Parent | Actions; also Social when company refilled Social during it | `label` action or chain; `label2` skill practiced; `v0` Social gained; `v1` skill level after; `v2` progress percent after; `v3` the actor's opinion change from sharing the activity; `other` first companion |
| 2 Chat done | Parent | Actions, Social | `other` listener; `label` social interaction; `label2` topic; `v0` initiator and listener preference packed as two `i16`; `v1` both Social gains packed as two `i16`; `v2` initiator's opinion change; `v3` listener's opinion change |
| 3 Fight done | Parent | Actions, Social | `other` target; `label2` fight topic; `v2` and `v3` the two opinion changes |
| 4 Annoyed | Parent | Social | `actor` affected person; `other` responsible person; `label` cause; `label2` object type when known; `v2` opinion change |
| 5 Chores this week | Parent | Chores | `actor` duty owner; `v0` week |
| 6 Duty | Child of 5 | none | `label` duty kind; `v0` the kind's position in `ChoreKind::ALL` and `v1` its target, which the shell passes to `chore_location` for the current room name |
| 7 Chore outcome | Child of 1 when done by an action this tick, otherwise parent | Chores | `actor` performer or owner; `other` owner when someone covered; `label` duty; `v0` outcome code (Done, Covered, Skipped, Missed) |
| 8 Feeling | Child of 2, 3 or 7, of the eater's 1 for meal appreciation, or, for a chore feeling no 7 adopts, of the appreciated person's 1 in the same tick; otherwise a parent | Social, always | `actor` the person whose opinion changed; `other` the person it is about; `label` cause; `v2` change |
| 9 Skill level | Child of 1 or 2 in the same tick, otherwise parent | Skills | `label` skill; `v1` new level |
| 10 Weekly review | Parent | Career | `label` level title after, none after a dismissal; `v0` outcome code in bits 0 to 7 and the warning in bit 8; `v1` performance; `v2` fit; `v3` mastery percent and mood packed as two `i16` |
| 11 Career change | Parent | Career | `label` level title, the one left for a quit; `v0` 0 hired by search, 1 assigned by the player, 2 left the job |
| 12 Death | Parent | Social | `actor` the person who died |

Ordinary skill practice that does not cross a level is part of kind 1 and never triggers.

## [AL-sources] Event sources

Every source is a point where the simulation already settles the event. The schedule order is the one in `Sim::new_with_content`.

| Source | Kind | Emitted at | Data, and where it comes from |
| --- | --- | --- | --- |
| Object interaction completes | 1 | `systems::interact::tick_interactions` (`systems/interact.rs`), at completion where `practise` runs | Actor `SimId`; `Eating.object` model and interaction row resolved through `action_rows` with `ActionRow::label(tick, day_ticks)`; practiced skill from `practise` |
| Chain completes | 1 | `systems::chain::tick_chain_steps` (`systems/chain.rs`), at the terminal payout before `settle_order` | `ChainState.chain` label, including the time-of-day meal label; one record per chain, never per step |
| Book read completes | 1 | `reading::tick` (`reading.rs`), where `practise` runs | Book action label; Reading practice |
| Shared activity or table meal completes | 1 | The same completion sites | Social accumulated in the scratch area [AL-capture]; first companion `SimId` |
| Chat completes | 2 | `systems::social::tick_social` normal completion | Initiator, partner, interaction, the topic from `SocialEpisodes.topics` before `maintain` removes it, both preferences, Social accumulated per participant, the Conversation feelings |
| Fight completes | 3 | `tick_social` fight branch | Both people, the fight topic (no reason, a chore, a remembered grievance or an everyday topic, every one of `fights::Reason::all`), the two Fight feelings |
| Interrupted chat or fight | none | `tick_social` disturbed branch | Nothing is logged; the game changes nothing either |
| Mess noticed | 4 | `domestic::tick` (`domestic.rs`), cause HouseholdMess, once the pile's neglect grace has passed | Observer, pile owner, opinion change |
| Dirty place setting | 4 | `domestic::blocked_setting_annoyance`, called from `dining.rs` | Diner, each dish owner, opinion change; today this records no diagnostic [AL-capture] |
| Privacy incident | 4 | `systems::interpersonal::moved` and `private_start`, applied in `apply` | Affected, intruder, PrivacyEntry or PrivacyStart, the fixture's type label (never its model name), opinion change |
| Chat started while the listener had an unhelped need | 4 | `systems::interpersonal::conversation_start` | Listener, initiator, low or critical, opinion change |
| Disliked object in use | 4 | `affinity::bother`, every tick per pair | One record per episode, not per tick [AL-group] |
| New weekly duties | 5, 6 | Callers of `chores::board::reconcile` when it reports that `policy::assign` wrote new assignments | Assignments grouped by owner: duty kind and target; every owner in a new week, and within a week only the owners whose own duties changed |
| Chore work completes | 1 | `chores::work::advance` where a task finishes with credit | Performer, the duty kind's label; never a Social total or companion, because chore work is not company; the chore outcome that follows attaches to it |
| Chore done or covered | 7, 8 | `chores::board::credit`; the appreciation comes from `chore_repair::appreciate` and `chore_repair::completed_in` in the same tick | Owner, performer, duty, outcome; each other housemate's ChoreFulfilled appreciation of the performer; the ChoreNeglected feeling when a helper covers a declined duty whose neglect grace has passed |
| Washed dishes and other cleaning appreciated | 8 | `chores::consequences` for each washed batch of dishes and `chores::completed` for other finished cleaning, through `chore_repair::appreciate`; `chore_repair::completed_in` for a repaired argument, through `relationship_effects::record_opinion_change`; cause ChoreFulfilled | Only feelings about the cleaner: from `appreciate`, each other housemate's appreciation of the cleaner; from `completed_in`, the appreciation of the cleaner by each person who started the argument and each witness. Each is a child of the chore outcome when one is staged in the same tick, otherwise of the cleaner's own action line in that tick, otherwise its own line under Social |
| Meal appreciated | 8 | `domestic::appreciate_meal` through `relationship_effects::record_opinion_change`, cause MealShared | Eater, cook, opinion change; a child of the eater's kind 1 record for the shared meal, which completes in the same tick |
| Chore missed | 7, 8 | `chores::board::tick` at the first day rollover after the duty's neglect grace | Owner, duty, Missed; the ChoreNeglected feelings |
| Chore skipped | 7 | `chores::board::tick` where the willingness roll fails | Owner, duty, Skipped |
| Skill level crossed | 9 | `skills::practise`, comparing `standing` before and after | Person, skill, new level |
| Weekly review | 10 | `careers::review_person`, including reviews settled late in `complete_shift` and `settle_due_review` | Outcome code, performance, `factors()` (fit, mastery, mood), title after, the warning that starts at the second poor week |
| Hired by job search | 11 | `careers::search` on a successful hire | Person, path's first level |
| Career assigned or left by the player | 11 | `careers::assign` and `careers::quit` when not refused; a quit by someone without a job changes nothing and logs nothing | Person, level, or left |
| Death | 12 | `mortality::tick` where the `DeathRecord` is pushed | Person |

Sources that are not logged, and why:

1. Walking, waiting, wandering, commuting and work shifts. The issue excludes going to and returning from work, and the others are not actions a player orders.
2. Chain steps, which would repeat one meal four times. The chain is logged once.
3. Need decay, relationship decay, proximity contact, shared-activity contact counted per minute, and incompatibility friction. All are continuous; they change every tick for many pairs and are summarized only where an action carries them [AL-capture].
4. Moodlets starting or ending, needs turning critical, money and purchases. These would need the Mood or Money filters the owner did not choose.
5. Chats and fights withdrawn or given up before they start (pull request 302): a chosen chat a housemate gives up once Hunger or Energy turns critical or its partner falls asleep (issue 338), a waiting request withdrawn for another conversation, and a chore fight called off before it begins. Each ends a conversation that never ran, so the log records nothing, as it records nothing for an interrupted chat.
6. Changes to a housemate's own job search setting (pull request 303). Turning it on or off is a setting, not something the household did, so it logs nothing, as the old household-wide setting logged nothing. A hire by job search still logs its Career line.
7. Duties a room change adds in the middle of a week (`chores::board::assign_new_duties`, called from `chores::room_changes`). The room review lists each automatically assigned duty with its owner before the player confirms the change, and the next week's Chores this week line names it; a mid-week line would repeat what the player just confirmed.
8. The cleaner's warmer feeling toward the person who complained when a repaired chore argument completes (`chore_repair::completed_in`, recorded through `relationship_effects::record_unlogged_opinion_change`). It is a side effect of a repair the log already shows as the observers' appreciation of the cleaner, and as a ChoreFulfilled line from the cleaner about the complainer it would read as the cleaner appreciating the complainer's chore. The diagnostic still records it.

No source turned out to be impossible. Two are costlier than the others: the Social total per action needs an accumulator, and a skill level-up needs `practise` to report what it crossed, which changes that function's signature and its five call sites.

## [AL-capture] Capturing data the game discards or never records

Each item below is captured by copying a value at the moment the simulation computes it. None changes an outcome.

1. **Relationship effects.** Every effect today is pushed straight into `RelationshipDiagnostics.effects`, a per-tick observation that `relationship_effects::reset` clears early in each tick. Phase 1 routes every push through one function, `relationship_effects::record`, which also forwards discrete causes to the log. Its match over `RelationshipCause` has no wildcard arm, so a new cause fails to compile until someone classifies it as logged or excluded. Logged: Conversation, LowNeedInterruption, CriticalNeedInterruption, PrivacyEntry, PrivacyStart, HouseholdMess, ChoreFulfilled, ChoreNeglected, MealShared, Nuisance (as episodes), Fight and the new DirtySetting. `record_opinion_change`, which chores and meal appreciation share, records through `record` too. The one exception, `record_unlogged_opinion_change`, writes only the diagnostic, for the change listed as unlogged source 8 in [AL-sources]. Excluded: Proximity, SharedActivity, Incompatibility and Decay, which are continuous.
2. **Dirty place setting.** `blocked_setting_annoyance` changes opinion without recording an effect. It gains a `DirtySetting` cause and records through `record`. The diagnostic is not saved or hashed, so only tests that count diagnostics can notice.
3. **Topic and reactions.** `SocialEpisodes.topics` holds the topic and both preferences only while the chat runs. The chat record copies them at completion, before `social_episode::maintain` removes the entry.
4. **Social gained.** Chats, table meals and shared media deliver Social per tick, and no total is kept. The scratch area accumulates delivered Social per `SimId`, reset where the activity starts (`Eating` and `Socialising` inserts in `systems::movement::follow_path`, a recipe's arrival at its first step in the same function, a reading session's start in `reading::commit_plan`, and the meal countdown in `domestic::gather_diners`), and is read at completion. An activity that was already running when the world loaded has no reset point, so its record marks the total partial and Details omits it.
5. **Skill level-ups.** `skills::practise` returns the skills whose `standing` level rose. Its callers forward them to the log. The stored practice values and the order of updates do not change.
6. **Career events.** A hire by search records nothing today, and a dismissal removes the career record with its history. The review and change records copy outcome, performance, factors and title at the moment they are decided. Career history itself is not extended; that would be saved state.
7. **Deaths.** `DeathRecord` already exists natively without a wasm export. The death record copies the person at the moment it is pushed.

## [AL-compose] One line per event

The shell composes lines from records. A line is visible when at least one enabled filter is in its trigger mask, including the triggers of its children. A visible line always shows its head, then each clause whose filter is on, in a fixed order: chore, social, skill, career. Numbers from Details follow the clause they measure in parentheses. Time puts the timestamp first.

This one rule produces the issue's two notes. With only Actions on, a chat shows its head and nothing else. With Social on and Actions off, a chat still shows, because Social is one of its triggers, while "Tim: Read a book" disappears, because it has no Social trigger. Each event stays one line under every combination because filters only add or remove clauses.

The head is `Name: label`, extended with ` with {name}` when the event has another person and ` about {topic}` for a chat or fight. The timestamp is `D{day}, T{hh}:{mm} `, where day is `tick / day_ticks + 1`, as the HUD counts it, and the time is the minute of that day on a 24-hour clock.

Examples, with invented values to show the shape. Tim starts a chat with Bill about cooking; Tim loves the topic and Bill dislikes it.

| Filters on | Line |
| --- | --- |
| Actions | Tim: Chat with Bill about cooking |
| Social | Tim: Chat with Bill about cooking; Tim loves it, Bill dislikes it |
| Social, Details | Tim: Chat with Bill about cooking; Tim loves it (+48 Social, +17 opinion of Bill), Bill dislikes it (+31 Social, -1 opinion of Tim) |
| Actions, Time | D74, T15:45 Tim: Chat with Bill about cooking |
| Chores, Skills or Career only | hidden |

Tim reads a book, practicing Reading at level 3 and 40 percent of the way to level 4.

| Filters on | Line |
| --- | --- |
| Actions | Tim: Read a book |
| Actions, Skills | Tim: Read a book; Reading level 3 |
| Actions, Skills, Details | Tim: Read a book; Reading level 3 (40%) |
| Skills | hidden, unless the book took Tim to a new level: Tim: Read a book; Reading reached level 4 |
| Social | hidden |

Bill does Tim's dishes, covering Tim's chore, and Casey appreciates it. A meal appreciation reads the same way on the guest's meal line: `Casey: Join meal; Casey appreciates Tim` under Social.

| Filters on | Line |
| --- | --- |
| Actions | Bill: Do dishes |
| Chores | Bill: Do dishes; covered Tim's chore |
| Social | Bill: Do dishes; Casey appreciates Bill |
| Actions, Chores, Social, Details | Bill: Do dishes; covered Tim's chore; Casey appreciates Bill (+1 opinion of Bill) |

Other parents read as follows when their trigger is on: `Tim: Chores this week: Do dishes, Clean floor (Kitchen)`, `Tim: Missed chore: Do dishes`, `Tim: Skipped chore: Do dishes`, `Bill: Annoyed by Casey's dishes`, `Bill: Annoyed that Casey walked in while they were using the toilet. Awkward.`, `Bill: Bothered by Casey using the television`, `Tim: Cooking reached level 4`, `Tim: Weekly review: Promoted to Senior clerk`, `Tim: Hired as Office clerk`, `Tim: Quit as Office clerk`, `Tim: Died`. Chore lines use the game's own duty labels, such as Do dishes and Clean floor. A dismissal reads `Tim: Weekly review: Fired` without the warning clause, although its record carries the warning bit. A fight reads `Tim: Fight with Bill about the dishes; Tim and Bill like each other less`.

Names are the current names from the household roster. The shell keeps the last name it saw for each `SimId`, so a line about someone who has died or left still names them. Room names in chore clauses are the current names, read through `chore_location`.

## [AL-selected] The selected housemate

The log shows the whole household by default, whoever is selected. A checkbox at the end of the filter row, `Only {name}`, names the selected housemate and is off by default; it is hidden while nobody is selected. Ticked, the log shows a line only when that person's `SimId` is the head's actor or other person, or the actor or other person of a child whose clause is currently shown. The issue's examples follow: a chat shows for both participants; "Bill: Annoyed by Casey's dishes" shows for Bill and for Casey; "Bill: Do dishes; Casey appreciates Bill" shows for Casey only while Social is on, because only then does the line say anything about Casey.

The checkbox's label follows the selection, and a rename of the selected housemate while the panel is open, without rebuilding the lines. Entering Build closes the panel without focusing the Log button it hides, and when the focused checkbox hides because nobody is selected, focus moves to the list of entries. While it is ticked, a new selection rebuilds them in a task of its own after the frame, and clearing the selection shows everyone until someone is selected again; the box stays ticked for the page session, as the filters do. Owner's decision, 2026-10-23. The panel takes the selection from the household roster, which already resolves the selected housemate's `SimId` from the `sim_ids` column at the HUD refresh cadence (`need_bar_refresh_ms`, 100 ms), and checks it at that cadence while open. The check therefore makes no `simIdOf` call, which the release frame-time gate requires of every steady frame. There is no selection-change event to subscribe to.

## [AL-group] Grouping repeated events

Repeated irritation is the main source of volume. Three rules bound it.

1. **Same-day annoyance.** Kind 4 lines with the same cause, affected person, responsible person, object and day become one line, so annoyances about two different objects, such as a disliked television and a disliked radio, stay apart. The shell merges them: the count and the summed opinion change update, the line moves to the newest position and its timestamp shows the latest occurrence, and the clause reads `(3 times)` from the second occurrence. The simulation still emits each occurrence, because the household's mess annoyance happens about fourteen times a game day by the research's measurement, which the staging ring handles easily.
2. **Disliked object in use.** `affinity::bother` changes opinion every tick while the pair stays in the same situation, so the simulation groups it before emitting: the scratch area opens an episode when a pair appears, adds each tick's change, and emits one record when the pair has been absent for a whole tick or the day ends.
3. **Appreciation and resentment.** Feelings caused by one chore outcome are children of that outcome, so a household of five yields one line with up to four appreciations, not five lines.

## [AL-numbers] Which numbers Details shows

Details shows a number only where the player can compare it with another quantity on the same scale. Each number is rounded to the nearest integer, with halves rounded away from zero for both signs, so -1.5 shows as -2 and +1.5 as +2, and a number that rounds to zero is omitted rather than shown as `+0`.

| Quantity | Shown as | Why it qualifies |
| --- | --- | --- |
| Opinion change | `+17 opinion of Bill`, opinion times 100 | It compares with the People panel's band edges at 5, 20 and 60 on the same scale, with the other person's change on the same line, and with other causes such as a fight's -10. |
| Social gained from a chat, a table meal or a shared activity | `+48 Social` | Both participants' gains sit side by side, and the Social meter runs from 0 to 100. |
| Weekly review performance | `performance 72 of 100` | It compares with the poor and good thresholds and with earlier weeks on the Career tab's graph. |
| Review factors | `fit 40, skill 55%, mood 20` | They are the inputs of the performance score and compare with each other; the Career tab already shows them. |
| Skill progress | `(40%)` after the level | It compares with the next level at 100 percent, as the Skills panel shows it. |

Quantities left as words: other need changes, which are rates delivered over an action and duplicate the needs panel; money, which the owner did not include; chore preferences and commitment scores, which mean nothing in a single line; and topic preferences, which become the words loves, likes, does not mind, dislikes and hates using the existing Likes and dislikes band edges `affinity_band_loves` and `affinity_band_likes`.

## [AL-bridge] The wasm bridge and the shell drain

The simulation stages records; the shell drains them once per rendered frame and keeps the session's history. Six exports in `crates/terri-wasm/src/lib.rs` carry it:

| Export | Returns |
| --- | --- |
| `activity_log_take()` | Moves every finished staged record into an export buffer owned by the simulation and returns the record count. Consuming, like `take_book_results`. |
| `activity_log_ptr()` | Pointer to the export buffer, read as a fresh `Uint32Array` of `count * 12` words. |
| `activity_log_dropped()` | Records overwritten in the staging ring before a take. Diagnostic only. |
| `activity_log_labels()` | The label table as one string with one label per line, read once per page. |
| `set_activity_log_enabled(bool)` | Turns emission off for the disabled baseline, set from `?activitylog=0` at startup. |
| `activity_log_reaction_bands()` | The Likes and dislikes band edges `affinity_band_loves` and `affinity_band_likes`, read once when the panel first opens, which turn topic preferences into reaction words. |

The staging ring holds 256 records, preallocated with the world. The shell runs at most five ticks per frame (`MAX_TICKS_PER_FRAME` in `web/src/main.ts`) and drains once a frame, so the ring must hold the most records five ticks can stage. A household has at most six people (`MAX_HOUSEHOLD_SIZE`), and the busiest frame for six is the start of a chore week, when every owner's duties, the day's chore outcomes and each other housemate's feeling about them land together; the measured peak for six people is under a third of the ring, and the measurements live in `docs/assets/review-evidence/activity-log/`. The ring is therefore not sized for stress pages: a chore outcome draws a feeling from every other person, so with about a hundred extra people the end of a day can stage more than 256 records in one frame. When the ring is full, the oldest record is overwritten and `dropped` increases. The shell keeps every record that arrives and composes lines from them as usual; a child whose parent was overwritten has no line to join and stays hidden, and a parent whose children were overwritten shows without their clauses ([R12]).

The shell drain runs in the existing per-frame `afterCommands()` hooks in `web/src/main.ts`, whether or not the panel is open, so history exists when the player opens it.

1. Call `activity_log_take()`. When it returns 0, do nothing else.
2. Build a fresh view over the export buffer and copy it into the shell store before any other bridge call, per lesson L72.
3. The shell store is a preallocated `Uint32Array` ring of 2,000 records, 96 KB, with the head index and count as numbers. Copying into it allocates nothing beyond the one view object.
4. When the panel is open, compose lines for the new records only and append them. When it is closed, do no text or DOM work. Deciding whether a record makes a line allocates nothing, so records whose lines stay hidden cost no garbage, and the frame's work never reads layout: the panel learns its scroll position and the dock's height from scroll events and a ResizeObserver, after layout.

The label table is read once after startup. A successful Load calls the log's `resetAfterLoad()` from the same callback that resets book results and the Career panel, which empties the store; the fresh world starts again at `seq` 1. Outside that path, a `seq` that does not increase is a defect: the drain throws, as `BookResults.drain` does. New game reloads the page, which recreates everything.

## [AL-panel] The panel at desktop and phone widths

Nothing occupies the top-right corner in normal play. The `#hud` sidebar sits at the top left and the Sim details dock at the bottom. Build mode uses the top right for its zoom buttons, and `?debug=1` puts the debug panel there.

1. **Toggle.** A `Log` button at the top right, `#activity-log-toggle`, a `.hud-button` with `aria-expanded` and `aria-controls`, at least 44 pixels square on coarse pointers. It is hidden in Build mode, which closes the panel, because Build owns that corner and pauses the household.
2. **Behavior.** The panel follows the Options flyout (`web/src/ui/options-menu.ts`): non-modal, does not pause the game, closes on Escape caught in the capture phase and returns focus to the toggle, and is skipped by Escape while a dialog is open. It does not close on an outside press, because players will want to watch the house with it open. Opening it closes the Options flyout and the Sim details sheet, and opening either of those closes it, so one right-side surface shows at a time.
3. **Layout.** It reuses the `#sim-sheet` structure: a header row with the title `Log` and a Close button, a wrapping row of seven filter toggles and the `Only {name}` checkbox, then a scrolling list with `overscroll-behavior: contain`. Filter toggles are `aria-pressed` `.hud-button`s, as in the Buy tool's catalog filters (`.catalogue-filters` in `web/src/ui/buy-tool-controls.ts`).
4. **Desktop.** Anchored to the top right below the toggle, 360 pixels wide, reaching down to the top of the Sim details dock. The `z-index` is 7: above the dock (5), below Options (8), the debug panel (9) and the object menu (10).
5. **Phone and compact widths.** Under the compact query `(max-width: 600px), (max-height: 480px)` the open panel covers the full width from the top edge to the dock, above the `#hud` sidebar, with the filter row wrapping onto two lines. The toggle stays at the top right beside the sidebar.
6. **List.** An ordered list, oldest at the top. New lines append at the bottom, and the list scrolls to them only when the player was already at the bottom. It renders the newest 200 visible lines; `Show earlier entries` at the top adds 200 more, up to the 2,000 held. Changing a filter or the selection recomposes the newest 200 lines from the store and shows the newest line; a selection the frame notices is rebuilt in a task of its own after the frame. The list has no live region; announcing every line would drown screen-reader users.
7. **Empty states.** `Nothing has happened yet.` before the first record, and `Nothing matches these filters.` when filters or selection hide everything.
8. **Filters.** Defaults are Actions, Social and Career on; Chores, Skills, Details and Time off. Choices last for the page session, across Loads, and reset when the page reloads.

## [AL-persist] Session only

The log is never written to a save, OPFS or browser storage. Load empties it; New game reloads the page; a failed Load keeps the current game and its log. The save format, the save digest and the save manifest do not change in phase 1.

## [AL-perf] Performance budget and measurement

The acceptance rule is that a player cannot notice the log, measured against the same build with the log disabled (`?activitylog=0`), per lesson L-performance-features-need-a-disabled-baseline.

| Measure | Tool | Threshold |
| --- | --- | --- |
| Simulation outcome | Native test running the shipped household 20 game days with the log enabled and disabled | Identical world hash at every tick |
| Simulation cost | `cargo run --release -p terri-sim --example activity_log_cost`: two worlds with the same seed, one with the log on and one off, run in lockstep in one process over 28,800 ticks in 20 chunks of one game day, alternating which world runs each chunk first; at least the shipped seed and two others | The median of the 20 chunk ratios within 2 percent, with its 95 percent bootstrap interval reported, in wall time and in thread CPU cycles; the worlds hash the same after every chunk; records, the largest frame and dropped count reported |
| Frame time, panel closed and panel open with every filter on | The release frame-time gate of `docs/ARCHITECTURE.md`: production build, displayed Chrome at 1400 by 900, calibrated 120 Hz display, `?stress=1000`, 600 ticks with the first 60 discarded, compared with `&activitylog=0` | Log drain and compose p95 at most 0.25 ms and maximum at most 1 ms; application-work p95 regression at most 1 ms; no application-work frame over 16.6 ms in either mode. If both modes fail, profile before blaming the log. |
| Allocation | The [V11] sampling heap profile in `docs/gpu-verification.md`: CDP sampling with `samplingInterval: 32768` and both garbage-collection inclusion flags true, 6 seconds of warm-up and a 20-second window | Panel closed: no allocation attributed to log functions in frames without new records, and at most one typed-array view per drain otherwise. Panel open: at most 2 KB per appended line and nothing per frame without new lines. |
| Retained memory | The alternating enabled and disabled pairs of `scripts/audio-browser-proof.cjs memory`, adapted to the log, for the JS heap; `scripts/activity-log-wasm-memory.mjs` for the wasm memory, which runs the built wasm package in Node without the page, so the comparison is deterministic | Retained difference at most 160 KiB with the panel closed after the store has filled, and no growth between two samples taken after it is full, in the JS heap and in wasm memory |
| Bounds | Unit tests | Staging ring 256 records, store 2,000 records, rendered rows at most 2,000 |

A frame-time p95 alone cannot pass this gate, because [D11] records that a p95 and a heap trend both stayed green while the render loop allocated 57.8 MB. Only the allocation profile counts as evidence about allocation.

`scripts/activity-log-proof.cjs` runs the three browser measures with the calibration and frame-window helpers it shares with the audio proof in `scripts/lib/browser-frame-gate.cjs`. Its `performance` mode runs three alternating pairs of enabled and disabled pages for each panel state and judges the work regression on the median pair; every run must meet the other limits. Its `allocation` mode takes the sampling heap profile against the development server, where module paths and function names survive, and its `memory` mode fills the store by running the page's own frame body with a fabricated clock. Its `rebuild` mode times the one-off work outside the frame with the store filled: opening the panel, each filter change and each Show earlier entries, as the click's script and the layout it leaves behind. Opening and filter changes recompose the rendered window from the store and scroll to the newest line in the click; Show earlier entries composes and inserts only the up to 200 lines it reveals. Its `clicks` mode makes the same clicks with a pause between them and charges each click the main-thread work of the frame after it beyond a frame without a click, so work a click defers to its frame counts too. Both report rather than judge, because these costs come once per click, outside the per-frame limits. `--everyone` clears the selected housemate first, so every person's lines show. The household adds a few lines in a 20-second window, too few for the 32 KB sampling interval to resolve 2 KB a line, so the allocation per line is read at a 1 KB interval at `?stress=100` with `--everyone`, which appends hundreds of lines. Every page runs with `audio=0` and Chrome's `--mute-audio`. The trace example still prints the wall time spent inside `Sim::tick` and accepts `TRACE_ACTIVITY_LOG=0`, but two separate processes on a shared machine varied by a factor of two, so the simulation cost comes from the lockstep example. `--agents N` there adds filler agents as `?stress=N` does. Under `?stress=N` the page exposes `activityLogSampler`, the time of the store's drain plus the panel's update in each frame, and the store's counts.

Under `?stress=N` every filler agent has a `SimId`, so each one stages its own records. A stress page therefore drives the log with far more records than a household does, and with enough agents the staging ring overwrites records between frames; `dropped` counts them. One line can also grow large there: a missed chore carries a feeling from every other person, so at `?stress=100` its line holds about a hundred clauses and allocates tens of kilobytes when composed. A household's line holds at most five such clauses. Dated measurements live in `docs/assets/review-evidence/activity-log/`.

## [AL-topics] Phase 2: richer conversation topics

Today a topic is an activity tag. The initiator's preferences come from `compatibility::preferences`, a sorted map of tag to value built from personality dispositions, disposition traits and hobbies. `begin_topics` (`social_episode.rs`) offers every tag the initiator rates above zero, weights each by `mine * (1 + 4 * inclination * max(theirs, 0))`, and spends one `SimRng::next_f32` draw. With no candidate the topic is small talk. The initiator therefore always likes the topic; only the listener can dislike it, which turns their completion gain into a loss of `0.02 * preference`.

### Topic words and identity

Phase 1 shows the topic through its tag, mapped to a word in the shell's one string table (`reading` reads `reading`, `television` reads `TV`, `fight-dishes` reads `the dishes`). Phase 2 moves topics into content: `content/topics.toml` holds one `[[topic]]` per topic with a stable `id`, a player `label`, a bubble `icon`, a `kind` (activity, subject or fight) and, for activity topics, the tags it covers. The compiler refuses duplicate ids, an unknown tag or icon, and a fight topic without one of the three fight reasons.

### Resolving the code overlap

A topic's `code` is an activity-status code: `tag_code` maps reading to 8, the Reading activity, and the shell draws code `n` with the art of activity `n`. Fights took codes 24 to 26, which the activity namespace in `render_buffer.rs` already uses for mopping, wiping and emptying a bin. Both topic tables agree that 24 to 26 are fights, so nothing misreads a value today; the overlap is between two namespaces that were never meant to be one.

Phase 2 separates them. At runtime a topic is identified by its content row, the render column `conversation_topics` carries that row, and the shell reads each row's icon and label once through a new `conversation_topic_table` export. The `code` field survives only in saves, frozen to its old values, so the saved layout does not change.

### Subjects

Subjects are topics that are not activities: Trains, Bicycling, Gardening, Weather and Work are proposed for review. A person's interest in a subject is derived, not stored:

`interest = clamp(sum of source weights + variation, -1, 1)`

Sources are existing values: an activity tag's preference (exercise for Bicycling), a skill's mastery (Fitness for Bicycling), an object affinity (plants for Gardening, already saved per person), or job satisfaction for Work, read only for employed people. The variation is a fixed personal value from an FNV hash of the person's `SimId` and the topic id, scaled by the topic's `variation` field, so it needs no saved state, draws nothing from `SimRng`, and does not depend on entity order.

Subjects join the candidate list after the activity tags, in content order, with the same weight formula and the same single draw. The listener's reaction is their own derived interest, so a listener can dislike trains while the initiator loves them. In phase 2 subjects do not enter `compatibility::between`, which drives relationship drift and friction; that is [Q2].

### Determinism, digest, manifest and golden consequences

1. **Random stream.** Each chat still spends exactly one draw, or none for small talk or a fight. The stream position after any chat is unchanged; the topic it selects changes whenever a subject is a candidate.
2. **Outcomes.** A different topic can change the listener's reaction and therefore the completion gain or loss, so worlds diverge after the first chat that picks or displaces a subject. That is the intended behavior change of phase 2.
3. **World hash.** The `social-episodes-v1` block keeps hashing the saved fields, code and tag, so its layout does not change. A subject topic hashes as code 7 with its tag.
4. **Golden vectors.** `world_hash_matches_its_golden_vector` (`crates/terri-sim/src/lib.rs`) runs eight agents and one fridge for 100 ticks and should not move; its browser copy in `web/tests/bridge.test.ts` follows it. Any golden or pinned continuation hash whose scenario completes a chat may move. Each one that moves is classified by lesson L-fingerprint-fixtures-by-role before it is re-pinned, with the reason written beside the new value.
5. **Content digest.** `content_fingerprint` in `crates/terri-data/src/lib.rs` hashes social interaction ids and traits but no tags, topics, hobbies or affinity kinds. Topics stay out of it, because no simulation system reads topic content after a Load: a saved topic carries both preferences, and completion uses the saved listener preference. A test pins that adding `topics.toml` leaves the digest unchanged, and the reason is written beside it, per L-save-digest-must-follow-post-load-reads.
6. **Save manifest.** `SavedActionManifest` lists objects, social interactions, chains, voices, traits and portal structure. Topics are not in it and are not added.
7. **Saves.** A subject topic is saved in the existing `SavedTopic` as code 7 with the tag `subject:{id}`. The schema does not change. As read on main, the current loader accepts it, because it requires a chat code between 3 and 23, not 6, equal to `tag_code(tag)`, which is 7 for any unknown tag, and a positive initiator preference. A test loads a phase 2 save through the frozen published V16 reader to prove it.
8. **Old saves.** Saves from schema 9 onward carry topics; their tags map to activity or fight topics as `tag_code` maps them today. A saved subject whose topic later leaves the content loads as a generic subject with the word `something`, never a refusal.

### Bubble art

Subjects have no bubble art. Until art is approved, a subject uses the existing Talk symbol with the like or dislike tint. Commissioning art is [Q3].

## [AL-tests] Tests

Rust tests in `crates/terri-sim`:

1. `activity_log_never_changes_the_world`: the shipped household for two game days with the log enabled and disabled, with archetype churn induced in one run per L5 and L6, compares world hashes at every tick and `SimRng` state at the end, and pins the two-day hash fold to main without the log, so code that runs in both modes cannot hide. `activity_log_never_changes_the_world_over_twenty_days` runs the same comparison for 20 game days and is ignored by default.
2. `world_hash_matches_its_golden_vector` passes unmodified, and so do the published-save hash tests.
3. `every_relationship_cause_is_logged_or_excluded`: records one synthetic effect of each cause through `relationship_effects::record_about` and asserts how the log classifies it; the wildcard-free match is the compile-time half. Each cause's real source is covered by its own emitter test. `RelationshipDiagnostics.effects` is private, so `record`, `record_in` and `record_unlogged_opinion_change` are the only writers.
4. Per source: `chat_completion_logs_topic_reactions_social_and_opinion`, `fight_completion_logs_reason_and_both_losses`, `interrupted_chat_logs_nothing`, `chain_logs_once_with_the_meal_label`, `table_meal_logs_company_and_social`, `mess_annoyance_logs_each_notice`, `dirty_setting_annoyance_is_recorded`, `meal_appreciation_is_logged_on_the_eaters_meal`, `privacy_incidents_log_victim_and_intruder`, `nuisance_logs_one_record_per_episode`, `chore_week_logs_one_header_per_owner`, `chore_done_links_to_the_performing_action`, `chore_cover_and_appreciation_are_children`, `missed_chore_logs_neglect_feelings`, `skipped_chore_is_logged`, `skill_level_up_is_logged_once_per_level`, `practise_reports_levels_without_changing_practice`, `career_review_logs_outcome_and_factors`, `late_review_after_a_shift_is_logged`, `job_search_hire_is_logged`, `assign_and_quit_are_logged_and_refusals_are_not`, `death_is_logged`.
5. Bounds and lifecycle: `staging_ring_overwrites_oldest_and_counts_drops`, `load_starts_an_empty_log`, `build_transaction_carries_staged_records`, `link_pass_attaches_children_in_the_same_tick`, `label_table_covers_every_action_and_chain_label`.

Wasm tests in `crates/terri-wasm`: `activity_log_take_returns_records_in_sequence_and_empties_staging`, `activity_log_disabled_emits_nothing`, `activity_log_labels_cross_as_one_line_each`, `a_load_starts_the_next_take_at_seq_one`, `reaction_bands_are_the_likes_and_dislikes_edges`.

Web tests in `web/tests`, against the freshly built release wasm per lesson L-integration-tests-need-matching-wasm:

1. `activity-log-bridge.test.ts`: records cross the boundary, the label table decodes, a detached view during label reads cannot lose records (L72), and Load resets the store.
2. `activity-log-compose.test.ts`: every example line in [AL-compose] for every filter combination listed, the selected-housemate rule, rounding and omission of zero numbers, and the timestamp at day boundaries.
3. `activity-log-store.test.ts`: the 2,000-record bound, ring wrap, grouping by day, and a backwards `seq` throwing outside Load.
4. `activity-log-panel.test.ts`: toggle, `aria-expanded`, `aria-pressed`, Escape and focus return, mutual exclusion with Options and the Sim sheet, hidden in Build, empty states, the 200-row window and Show earlier entries, and the selection taken from the roster's read.
5. `mobile-hud.test.ts` and `compact-hud.test.ts` extended for the phone layout and the corner.
6. `activity-log-proof.test.js`: the performance, allocation and memory verdicts of `scripts/activity-log-proof.cjs` against prepared results.

Phase 2 adds compiler tests for `topics.toml`, `subject_interest_is_independent_of_entity_order`, `topic_draw_spends_one_value_and_includes_subjects`, `legacy_topic_tags_keep_their_art`, `subject_topic_round_trips_and_loads_in_the_published_v16_reader`, `missing_subject_loads_as_generic`, `topics_do_not_move_the_content_digest`, and a bubble test that every old tag draws the same sprite as before.

## [AL-evidence] Played evidence before delivery

Each phase ends with the played visual pass of [Testing Protocol, section 9](../testing-protocol.md#9-every-milestone-ends-with-a-played-visual-pass), in a displayed browser, at 1400 by 900 and at a 375 by 812 phone viewport.

1. Watch a conversation end to end and see its line appear with the right names, topic and reactions under Social, then under Social and Details.
2. Exercise every filter, alone and in the combinations of [AL-compose], and the Time prefix.
3. Select each housemate in turn and confirm only their lines remain, including both sides of an annoyance.
4. Use a prepared save, written into the page's save slot as the project's money checks do, that puts a chore completion, a skill level-up and a weekly review within a few game hours, and see each line.
5. Load and confirm the log empties; start a new game and confirm the same.
6. Capture stills of the closed and open panel at both sizes, inspect them at full resolution, and obtain a fresh independent visual review of the panel and its overlap with the HUD, the dock and Build mode.
7. Record findings in `docs/alpha-feel-notes.md` under a slug id, fixed or deferred with a reason. Keep no videos. Close task-owned pages and preview servers in a `finally` block, muting the game while it runs.

Phase 2 adds watched chats about subjects, the like and dislike tints on the Talk symbol, and the topic words in the log.

## [AL-strings] New player-visible strings for owner review

These are proposals, not approved copy. They live in one shell module, `web/src/ui/activity-log-words.ts`, so the owner can review them in one place beside a running build. Existing labels (action, chain and social labels, Likes and dislikes words, career outcome words, skill labels, chore duty labels, room names) are reused unchanged. An object's type label, the only object name the log uses, is lowercased inside a sentence unless it starts with an acronym.

| Surface | Proposed strings |
| --- | --- |
| Toggle and panel | Log; Close; Actions; Chores; Social; Skills; Career; Details; Time; Nothing has happened yet.; Nothing matches these filters.; Show earlier entries; Only {name}, the checkbox that narrows the log to the selected housemate; the accessible names Filters, for the filter group, and Log entries, for the scrolling list |
| Head | {name}: {label}; with {name}; about {topic}, left out for small talk and a fight over nothing in particular, which read Chat with {name} and Fight with {name}; Someone at the start of a line and someone elsewhere, for a person the shell never saw a name for |
| Time | D{day}, T{hh}:{mm} |
| Topic words, phase 1 | eating; sleep; reading; exercise; the aquarium; comfort; showers; the toilet; TV; lounging; washing; cleaning; music; letters; baths; cooking; bathroom privacy; something; the dishes; chores; for arguments over a grievance privacy, TV, music, exercise, a nuisance and interruptions; for arguments over an everyday topic the same words as that topic's chats, with ingredients and preparing food |
| Reactions | {name} loves it; {name} likes it; {name} does not mind it; {name} dislikes it; {name} hates it |
| Feelings | {name} appreciates {name}; {name} and {name} like each other less; a feeling whose line was not logged, as its own line: {name}: Appreciated {name}'s meal, Appreciated {name}'s chore or Resented {name}'s neglected chore; Annoyed by {name}'s dishes; Annoyed by {name}'s dirty place setting; Annoyed that {name} walked in while they were using the {type}. Awkward.; Annoyed that {name} started using the {type} right in front of them. Awkward.; in both, {type} is the fixture's type label in lowercase, such as toilet, shower or bathtub, never its model name, and bathroom when the fixture is unknown, since only bathroom fixtures start private use; Annoyed that {name} interrupted; Bothered by {name} using the {kind}, reused from the mood panel; ({n} times), which shares its parentheses with a Details number as ({n} times, {+n} opinion of {name}); {name} resents {name}, for a chore neglected; Annoyed by {name}, for a cause the shell does not know |
| Chores | Chores this week: {duties}; {duty} ({room}); covered {name}'s chore; Missed chore: {chore} and Skipped chore: {chore}, chosen by the owner |
| Skills | {skill} level {n}; {skill} reached level {n}; ({p}%); a chat partner's level-up reads {name}: {skill} reached level {n} |
| Career | Weekly review: {outcome}; Promoted to {title}; Got a raise; Demoted to {title}; Fired; Changed path to {title}; No change; Warned at work; Hired as {title}; Career assigned: {title}; Quit as {title}, chosen by the owner, with the title of the job left |
| Details | +{n} Social; {+n} opinion of {name}; performance {n} of 100; fit {n}; skill {n}%; mood {n} |
| Household | Died |
| Subjects, phase 2 | Trains; Bicycling; Gardening; Weather; Work |

## [AL-rulings] Rulings taken without the owner

Each ruling below is a reversible choice made to complete the design. Each needs the owner's confirmation.

- [R1] An action enters the log when it completes, not when it starts. An interrupted action is not logged, matching the game, which pays nothing for it.
- [R2] A chain is one line, at its terminal step, not one line per step.
- [R3] Death appears under Social, because grief changes how the household feels, and there is no Household filter.
- [R4] Opinion numbers use the -1 to 1 feeling multiplied by 100, show the change only, and omit changes that round to zero.
- [R5] Same-day annoyance between the same two people for the same cause is one line that moves to its latest occurrence.
- [R6] Routine skill practice is a clause on the action line under Skills but never makes a line visible; only a level-up does.
- [R7] Names and room names on old lines are the current ones; a person who died keeps the last name the shell saw.
- [R8] The panel does not pause the game, does not close on an outside press, and shares the right side with Options and Sim details one at a time.
- [R9] The toggle is hidden in Build mode.
- [R10] Filter choices last for the page session and are not stored.
- [R11] The list has no live region.
- [R12] Records lost to a full staging ring are counted for diagnostics but not shown to the player. A household of up to six people stays well inside the ring; only stress pages overflow it.
- [R13] Subjects use the Talk symbol until art is approved.
- [R14] The proposed subjects are Trains, Bicycling, Gardening, Weather and Work, with Work offered only by employed people.
- [R15] A subject removed from content later loads as a generic subject rather than refusing the save.

## [AL-questions] Questions for the owner

- [Q1] Should subject interests be derived from existing traits, skills and affinities plus a fixed personal variation, or authored per person and editable in the character creator? Deriving them needs no save change and ships with phase 2. Authoring them needs a new save schema, creator fields and old-save defaults. Recommendation: derive them now and revisit after play.
- [Q2] Should subjects affect compatibility, the score that drives relationship drift and friction? Including them would make shared interests matter beyond chats but changes relationship balance across the household. Recommendation: leave them out of phase 2 and decide after a measured play session.
- [Q3] Should subjects get their own bubble art? Art costs generation, review and atlas space; the Talk symbol works meanwhile. Recommendation: ship with the Talk symbol and commission art only for subjects that prove common in play.
- [Q5] Should subject interests appear in the Likes and dislikes panel, read only, with the existing Loves to Hates words? Without them, a player cannot see why Bill dislikes trains. Recommendation: yes, in phase 2.

## [AL-research] Corrections to the earlier research report

1. The research said topic codes 24 to 26 mean fights in one place and cleaning in another. Both topic tables, `tag_code` in the simulation and the bubble table in `web/src/render/conversation-bubbles.ts`, treat 24 to 26 as fights. The overlap is with the activity-status codes in `render_buffer.rs`, where 24 to 26 are mopping, wiping and emptying a bin, because topic codes were assigned from activity codes. No code misreads a value today; phase 2 separates the namespaces.
2. The research's example of appreciation after a shared meal had no counterpart in the code it read. Meal appreciation is now a separate owner-approved effect (MealShared), and the log records it.
3. The research did not mention that the dirty place-setting annoyance changes opinion without recording a relationship effect, or that incompatibility friction is continuous like decay. Both matter to the log and are handled in [AL-capture].
4. The research's volume figures, about 52 events per game day and about 14 mess annoyances a day, were not re-measured for this design. The plan's first task measures them again on current main, because critical-need choices, pending conversations and room identities merged after the research.
5. The remaining claims checked out: the initiator always likes the topic; topic, reactions and total Social are discarded when a chat ends; skill level-ups, job-search hires and moodlet starts are never recorded; a dismissal deletes career history; death records exist natively without a wasm export; and the comment in `content/social.toml` saying neutral and disliked partners give no Social is wrong, since the code gives full Social at neutral and half at -1, which `neutral_lonely_chat_builds_friendship_while_refilling_social` confirms.

## [AL-out] What this does not do

No saved history, notifications, camera jumps, mute settings or per-person memories; [F-notifications] and [P-memories] in `docs/GAME-SYSTEMS.md` remain separate work that can reuse these records. No Problems, Mood, Household, Money or Relationships filter. No new simulation effects: no penalty for waiting on someone's furniture, no change to how often anyone chats, fights or cleans. Phase 2 adds no saved interests, no creator fields and no compatibility change unless the owner chooses them under [Q1] and [Q2].
