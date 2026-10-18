# Shifts and more career paths

Issue 296: different jobs have different chances of early, day, late and night shifts; office work is almost always weekday day hours; in a household of three with random job assignment it is unlikely that all three share one schedule; and the game gains career paths. This document amends rules 1, 2, 12 to 14, 16 and 18 of the [careers spec](2026-10-17-careers.md) and [CAL-hud] of the [calendar spec](2026-10-06-calendar.md). [Player orders and attendance](2026-10-17-player-orders.md) and [job search for each housemate](2026-10-18-job-search-per-person.md) (issue 297, pull request 303) remain in force. Rulings marked **For confirmation** are the designer's choices and wait for the owner.

Pay stays out of this design. Issue 298 will multiply every wage by 1.5 and add bills; the new careers below state pay in today's units, whole dollars per shift before that change, so issue 298 scales them with every other wage.

## Contents

1. [The shift model](#ws-model-the-shift-model)
2. [Choosing a shift](#ws-choose-choosing-a-shift)
3. [Shared schedules in a household of three](#ws-household-shared-schedules-in-a-household-of-three)
4. [Shipped career paths and shifts](#ws-content-shipped-career-paths-and-shifts)
5. [Work, attendance, reviews and the order systems](#ws-systems-work-attendance-reviews-and-the-order-systems)
6. [Sleeping around a shift](#ws-sleep-sleeping-around-a-shift)
7. [What the player reads](#ws-shell-what-the-player-reads)
8. [Determinism](#ws-determinism-determinism)
9. [Saves and older saves](#ws-save-saves-and-older-saves)
10. [Performance](#ws-performance-performance)
11. [Verification](#ws-tests-verification)
12. [Played evidence](#ws-played-played-evidence)
13. [Changelog and documentation](#ws-docs-changelog-and-documentation)
14. [Rulings for confirmation](#ws-rulings-rulings-for-confirmation)

## [WS-model] The shift model

A shift is a named working pattern: a kind, a start time of day, a length and the weekdays it runs. There are four kinds, **day**, **early**, **late** and **night**, numbered 0 to 3 in that order. The kind gives the shift its name in the interface and its sleeping rhythm ([WS-sleep]); the start, length and days decide when the person works. Two shifts with the same start, length and days are the same schedule, whatever their kinds or paths.

Every level keeps its own `shift_start`, `shift_ticks` and `working_days`. They are the level's **standard shift**, and its kind is the path's `standard_shift`, which defaults to `day`. A level with nothing else behaves exactly as every level does today.

A path may declare other shifts in `[[career.shift]]` entries. Each has an `id` unique within the path, a `kind`, a `shift_start`, a `shift_ticks` and `working_days`, validated as a level's are: the start below `day_ticks`, the length from 1 to below `day_ticks`, and the days a non-empty list of distinct weekday names. The id `standard` is reserved for the level's own shift.

A level chooses among its shifts with `shift_weights`, a table from shift id to a whole-number weight from 0 to 1000. The key `standard` names the level's own shift; the other keys name the path's shifts. An absent table means `{ standard = 1 }`. A shift with weight 0 is never drawn but can still be held, which is how content retires a shipped shift without breaking a save that holds it. The compiler refuses an unknown kind, a duplicate or reserved shift id, a weight key that names no shift of the path, a weight above 1000, and a level whose weights are all 0.

The compiler stores each level row's choices in the flat compiled career list, as rows already carry their path's values. `CompiledCareer` gains, appended after its last field per the pack's compatibility rule, `standard_kind: u8`, `standard_weight: u32` and `shifts: Vec<CompiledShift>`: the path shifts the level names in its weights, including weight-0 entries, in the path's authored order. `CompiledShift` holds `id`, `kind`, `shift_start`, `shift_ticks`, `working_days` (the seven-bit mask) and `weight`. The level's own fields stay where they are, so shift index 0 always means the standard shift and index `i` above 0 means `shifts[i - 1]`; nothing is stored twice. Packs published before this change convert with `standard_kind` day, `standard_weight` 1 and no other shifts.

## [WS-choose] Choosing a shift

A shift is **drawn per hire** and then **held** by the person. The held shift is part of the person's career record; the job itself names only the level.

1. **Hiring draws.** When the autonomous search hires a person (careers rule 13), when the player assigns a path (rule 12), and when a review changes a person's path (rule 14), the person draws a shift from the new level's weights.
2. **A household job holds the standard shift.** A job named in `content/household.toml` starts on the level's standard shift without a draw, so the shipped worker keeps today's Monday to Friday 06:00 to 14:00.
3. **A level change keeps the shift when it can.** A promotion or a demotion keeps the held shift's id when the new level lists it with a positive weight; the times are the new level's, as a promotion already moves the standard shift's hours today. Otherwise the person draws from the new level's weights.
4. **One choice draws nothing.** When exactly one of the level's shifts has a positive weight, the person takes it without a draw.
5. **The draw.** The candidates are the standard shift and then the listed shifts in order, each with its weight. With `total` the sum of positive weights, one `range(total)` call on the shift stream ([WS-determinism]) returns `r`, and the person takes the first candidate whose running sum of weights exceeds `r`.
6. **No other change moves a shift.** Loading, a save, a Build mode commit or cancel, an attendance settlement, a raise and a week with no event leave the held shift alone. Quitting and dismissal drop it with the record.

**For confirmation:** the player cannot pick a shift. The issue asks for chance, and a later issue can add a command to request another shift. The chance at hiring is shown before the player assigns a path ([WS-shell]).

## [WS-household] Shared schedules in a household of three

The measure is the chance that three housemates, each given a job independently and at random, all hold the same schedule. Random assignment here means each person's path is drawn uniformly from the shipped paths, each starts at the path's first level as every hire does, and each draws a shift by that level's weights. With `p(s)` the chance that one such hire holds schedule `s`, merging identical schedules across paths, the chance that all three share one is the sum over schedules of `p(s)` cubed.

For the eight shipped paths of [WS-content], the first levels offer 20 distinct schedules. The chance that all three share one is **2441/512000, about 0.48 percent**. Before this change, with three paths and one schedule each, it was one in nine, about 11.1 percent. The most likely schedule is the office day shift (Monday to Friday, 06:00 to 14:00) at 0.119 per person, which alone contributes 0.17 percentage points. The chance that at least two of the three share a schedule is about 17.7 percent, and that all three share a shift kind regardless of times is about 8.0 percent.

The shipped household does not start fully random: Tim holds the office clerk job from `content/household.toml` on its standard shift. If Bill and Casey were then assigned at random, the chance that both match Tim is 0.119 squared, about **1.41 percent**, against 11.1 percent before.

The autonomous search does not assign at random: it hires each unemployed person to the path that fits their traits best (careers rule 13). From the fit formula and the shipped traits, Bill is expected to tie the office and library paths and take the office, and Casey to take the cafe. If so, all three never share a schedule, because no cafe shift matches the office's, but Tim and Bill share the office day shift about 95 percent of the time. This prediction is unverified until Task 8 of the plan measures it. Making the search itself random is outside this issue ([WS-rulings]).

A compiler test computes the all-three figure from the compiled pack and fails above 1 percent, so a later content change cannot quietly undo the issue's requirement.

## [WS-content] Shipped career paths and shifts

The three existing paths keep their ids, labels, levels, titles, pay, standard shifts and fit values, and they stay first in `content/careers.toml`, so compiled rows 0 to 11 and path indices 0 to 2 keep their meaning. They gain other shifts and weights. Five new paths follow them. Every level of a path uses the same weights.

All new path labels and job titles are **plain and proposed for the owner's review per [L58]**; nothing below is approved copy. The shift names Day shift, Early shift, Late shift and Night shift are functional text.

### Shifts by path

| Path | Standard kind | Other shifts | Weights (standard first) |
| --- | --- | --- | --- |
| Office | day | `late`: late, 12:00 for 8 hours, Monday to Friday | 19, 1 (95 and 5 percent) |
| Cafe | early | `day`: day, 09:00 for 7 hours, Wednesday to Sunday; `late`: late, 13:00 for 7 hours, Thursday to Monday | 5, 3, 2 |
| Night watch | night | `weekend_nights`: night, 22:00 for 8 hours, Wednesday to Sunday; `evening`: late, 14:00 for 8 hours, Monday to Friday | 2, 2, 1 |
| Hospital | day | `late`: late, 15:00 for 8 hours, Wednesday to Sunday; `night`: night, 23:00 for 8 hours, Friday to Tuesday | 4, 3, 3 |
| Warehouse | early | `late`: late, 13:00 for 8 hours, Monday to Friday; `night`: night, 21:00 for 8 hours, Sunday to Thursday | 4, 4, 2 |
| Library | day | `late`: late, 12:00 for 8 hours, Monday to Friday | 4, 1 |
| Restaurant kitchen | late | `day`: day, 10:00 for 8 hours, Tuesday to Saturday | 7, 3 |
| Buses | early | `late`: late, 13:30 for 8 hours, Monday to Friday; `weekend`: early, 05:30 for 8 hours, Thursday to Monday | 4, 4, 2 |

The office's standard shift stays 06:00 to 14:00 and is labeled Day shift, as the issue calls ordinary office hours. The office and library late shifts are the same schedule, and the computation in [WS-household] counts them once.

### The new paths

Each new path's levels share its standard shift. Pay and pay maximum are whole dollars per shift in today's units.

**Hospital** (`hospital`): social demand 0.6, no skill, fit `{ chatterbox = 0.2, private_person = -0.2, out_of_shape = -0.2, isolated = -0.3 }`, standard 07:00 for 8 hours, Monday to Friday.

| Level id | Title | Pay | Pay max | Energy cost | Satisfaction | Advance weeks |
| --- | --- | --- | --- | --- | --- | --- |
| `hospital_orderly` | Ward orderly | 95 | 120 | 20 | 1.5 | 2 |
| `hospital_nursing_assistant` | Nursing assistant | 125 | 160 | 21 | 1.5 | 3 |
| `hospital_ward_nurse` | Ward nurse | 170 | 220 | 22 | 2.0 | 3 |
| `hospital_charge_nurse` | Charge nurse | 235 | 300 | 24 | 2.5 | 4 |

**Warehouse** (`warehouse`): social demand 0.2, skill `exercise`, fit `{ keen_cyclist = 0.2, private_person = 0.1, out_of_shape = -0.3, exercise_averse = -0.3 }`, standard 05:00 for 8 hours, Monday to Friday.

| Level id | Title | Pay | Pay max | Energy cost | Satisfaction | Advance weeks |
| --- | --- | --- | --- | --- | --- | --- |
| `warehouse_picker` | Warehouse picker | 90 | 110 | 22 | 0.5 | 2 |
| `warehouse_forklift_driver` | Forklift driver | 110 | 140 | 22 | 0.5 | 2 |
| `warehouse_team_leader` | Team leader | 150 | 190 | 20 | 1.0 | 3 |
| `warehouse_manager` | Warehouse manager | 210 | 270 | 18 | 1.5 | 4 |

**Library** (`library`): social demand 0.4, skill `reading`, fit `{ bookworm = 0.6, private_person = 0.2, chatterbox = -0.2, slow_reader = -0.4 }`, standard 09:00 for 8 hours, Tuesday to Saturday.

| Level id | Title | Pay | Pay max | Energy cost | Satisfaction | Advance weeks |
| --- | --- | --- | --- | --- | --- | --- |
| `library_assistant` | Library assistant | 85 | 105 | 12 | 1.5 | 2 |
| `library_librarian` | Librarian | 105 | 130 | 13 | 1.5 | 3 |
| `library_senior_librarian` | Senior librarian | 140 | 175 | 14 | 2.0 | 3 |
| `library_head_librarian` | Head librarian | 190 | 240 | 15 | 2.5 | 4 |

**Restaurant kitchen** (`restaurant_kitchen`): social demand 0.2, skill `cooking`, fit `{ private_person = 0.1, chatterbox = -0.1, cannot_cook = -0.7 }`, standard 14:00 for 9 hours, Wednesday to Sunday. The label avoids plain Kitchen, which is a room's name.

| Level id | Title | Pay | Pay max | Energy cost | Satisfaction | Advance weeks |
| --- | --- | --- | --- | --- | --- | --- |
| `kitchen_porter` | Kitchen porter | 75 | 95 | 20 | 1.0 | 2 |
| `kitchen_line_cook` | Line cook | 100 | 130 | 22 | 1.5 | 2 |
| `kitchen_sous_chef` | Sous chef | 150 | 195 | 22 | 2.0 | 3 |
| `kitchen_head_chef` | Head chef | 230 | 300 | 24 | 2.5 | 4 |

**Buses** (`buses`): social demand 0.5, no skill, fit `{ chatterbox = 0.2, private_person = -0.2, isolated = -0.2, low_spirits = -0.1 }`, standard 05:30 for 8 hours, Monday to Friday.

| Level id | Title | Pay | Pay max | Energy cost | Satisfaction | Advance weeks |
| --- | --- | --- | --- | --- | --- | --- |
| `buses_relief_driver` | Relief bus driver | 110 | 135 | 18 | 0.5 | 2 |
| `buses_driver` | Bus driver | 130 | 165 | 18 | 1.0 | 3 |
| `buses_senior_driver` | Senior bus driver | 165 | 205 | 19 | 1.0 | 3 |
| `buses_route_supervisor` | Route supervisor | 205 | 255 | 20 | 1.5 | 4 |

Every new level satisfies careers rule 1: pay never falls between levels, the pay maximum rises at each level, and no id repeats a path or level id. The new paths read only existing traits and skills, so the content fingerprint, the trait library and the skills list do not change.

**For confirmation:** pay depends on the level only, never on the shift, and a night shift costs the same energy as a day shift at that level. A shift premium belongs with the wage calibration of issue 298.

## [WS-systems] Work, attendance, reviews and the order systems

Every reader of a job's start, length or working days reads the person's held shift instead, through one function, `careers::shift_of(world, entity)`, which returns the held shift of the person's level, or the standard shift when the person has no record (a hand-built world or a household worker before their first shift). The readers are:

1. `attendance::start_tick`, which registers a due shift and its end tick;
2. `attendance::work_conflicts`, the preflight behind the Proceed and Cancel prompt, so the prompt shows the held shift's remaining and total hours;
3. the saved-attendance validator, which accepts a scheduled shift whose start time of day, weekday and length match any shift the row offers, because a promotion can change the held shift after a scheduled shift was recorded under the old one;
4. the reading system's `PendingShift` validator, which checks against the held shift;
5. `portals.rs`, whose door opening window reads the shift length;
6. `Sim::career_definition_of` and the boundary exports in [WS-shell].

Commuting, `AtWork`, deferral by player orders, interruption, resumption, proration of pay, energy and rewards, the two-hour grace and the deduction behave as [player orders and attendance](2026-10-17-player-orders.md) says. A shift that starts before midnight and ends after it already exists in the shipped night watch: it starts only on a working day, finishes on the next day and is attributed to the week of its scheduled start. A shift starting on Sunday night therefore belongs to the ending week, and its worker is reviewed on return through careers rule 6's waiting review.

The search runs at `career_search_tick` (09:00) before shifts start in the same tick. A person hired at 09:00 onto a shift that starts at 09:00 (the cafe day shift or the library standard shift) starts it in that tick; the test in [WS-tests] pins that order.

Reviews, outcomes, warnings, job satisfaction and the autonomous search's choice of path do not read the shift. A shift draw never counts as a review outcome and adds no history entry.

Conversations and player orders gain no rule. A night worker asleep by day is a sleeping recipient, and the existing rules apply: a player order waits beside a busy recipient, and autonomous requests weigh the recipient's remaining protected activity. Task 8 of the plan measures how long housemates wait on a day sleeper; a defect there belongs to the conversation system and is reported to the owner, not patched here.

## [WS-sleep] Sleeping around a shift

A night worker must sleep by day. The circadian sleep drive already shifts a person's rhythm by their chronotype offset (`chronotype_offset_ticks`, positive meaning later). Each shift kind adds a further offset while the person holds a shift of that kind, on working days and days off alike:

| Tuning knob | Shipped value | Effect |
| --- | --- | --- |
| `shift_sleep_offset_day` | 0 | No change; the shipped worker's rhythm is untouched. |
| `shift_sleep_offset_early` | -60 | Bed an hour earlier. |
| `shift_sleep_offset_late` | 120 | Bed two hours later. |
| `shift_sleep_offset_night` | 660 | The rhythm's midnight falls at 11:00, so a worker home at 06:00 sleeps from mid-morning to late afternoon. |

The four knobs are appended to the root of `content/tuning.toml` after `career_mood_fired_ticks`, in that order. The compiler refuses a value outside -720 to 720. Packs published before them reconstruct the shipped values, which matter only for a held shift of a non-day kind, and no published pack has one.

`select_action` computes the person's effective offset once per decision, the chronotype offset plus the held shift's kind offset, and passes it to `sleep_drive` for every candidate. The lookup goes through one system parameter that reads the `Careers` resource with each person's `SimId` and `Career`, so the existing query and parameter lists do not grow past their limits. The offset changes scores only and adds no random draw. Needs, energy cost and the exhaustion ramp are unchanged.

**For confirmation:** the offset applies on days off too, so a night worker keeps a steady rhythm through the week rather than flipping twice. The values are a first estimate that Task 8 measures; the acceptance is that a night worker over a simulated week spends most of their sleep between 07:00 and 18:00 and is awake at their shift's start on at least 9 shifts in 10.

## [WS-shell] What the player reads

1. **Sim details, Career row.** The row reads `{title}, {shift}, {working days}, {start} to {end}`, for example `Night watch, Night shift, Sunday to Thursday, 22:00 to 06:00` and `Office clerk, Day shift, Monday to Friday, 06:00 to 14:00`. The shift is Day shift, Early shift, Late shift or Night shift. The working-day wording is [CAL-hud]'s.
2. **Career tab.** The schedule line uses the same wording for the held shift.
3. **Choosing a path.** Below the path selector, the Career tab reads `Shifts on this path: Day shift 95%, Late shift 5%.` for the selected path's first level, listing every shift with a positive weight by its kind, in falling order of chance with ties in authored order, each rounded to a whole percent. When one shift is possible it reads `Shift on this path: Day shift.` The line changes with the selection and needs no extra control.
4. **Boundary.** `career_schedule_of(entity_index)` returns `[working_days, shift_start, shift_ticks, kind]` for the held shift, empty for anyone without a job as today. A new export, `career_path_shifts(path)`, returns the first level's drawable shifts flattened as `[kind, shift_start, shift_ticks, working_days, weight]` per shift, standard first then authored order, and is empty for an unknown path. The bridge validates each kind as 0 to 3 and omits the shift name for any other value.

The strings Day shift, Early shift, Late shift, Night shift, `Shifts on this path: {shifts}.` and `Shift on this path: {shift}.` are functional text and join `docs/player-visible-strings.md`, with the new path labels and titles listed as proposed per [L58].

**For confirmation:** the chooser shows kinds and chances, not times and days, to keep the line short; the times appear on the Career row once the person holds the shift.

## [WS-determinism] Determinism

1. **Stream.** Shift draws use a new `SimRng`, the shift stream, held in the `Careers` resource with its own draw count and seeded from the constant `SHIFTS_SEED = 0x5348_4946_5453_3031`. The careers stream is not drawn for a shift, so the reviews, the search and path changes draw exactly the numbers in exactly the order they do today.
2. **Order.** Draws happen inside the search and the reviews, which visit people in sim id order, and inside the player's assign command, which the command drain applies in queue order. No draw happens for a household job, for a single possible shift, for a level change that keeps its shift, or on load.
3. **Hash.** The careers part of the world hash keeps its layout. After the people whose job search is off (issue 297), it appends the tag `career-shifts-v1`, the shift stream's state, its draw count, the number of people holding a shift other than the standard, and for each in sim id order their id and the shift id's bytes, but only when the stream has been drawn or someone holds a shift other than the standard. A world in which everyone holds the standard shift and the stream is undrawn hashes exactly as before.
4. **Consequences for pinned values.**
   - The bare-agent golden hash, 4661132544113609906, and its release-wasm twin in `web/tests/bridge.test.ts` hold no job and stay unchanged.
   - The published schema-fifteen boundary values in `crates/terri-wasm/src/published_v15_tests.rs` load with everyone on the standard shift and stay unchanged.
   - Issue 297's `every_search_on_plays_out_exactly_as_the_global_setting_did` pins the hash and careers draw count main computed at commit 2b15dcfea. Under the new content the search can choose among more paths, and any hire into a path with several shifts draws one, so the shipped pack's value moves. The test keeps its pinned values by running under a pack cut back to the first three paths and twelve rows with no other shifts and every shift sleep offset at 0, which is the pre-change career content exactly; a second test pins the shipped content's new hash, careers draw count and shift draw count.
   - Careers tests that run the shipped household, such as `the_shipped_household_keeps_living_around_its_jobs`, put Casey on the night watch and now apply the night offset; their measured funds, needs and life satisfaction are measured again and any moved threshold is recorded with its cause.
   - The content fingerprint, the trait and skill libraries and the saved action manifest do not change, because careers are deliberately outside the fingerprint and no interaction, trait, skill or object is added; a test asserts the fingerprint pinned in `crates/terri-data/tests/content_hierarchy.rs` is unchanged.
   - Historical save fixtures still load. Tests that re-save a fixture and compare bytes see the schema-nineteen envelope, and are updated exactly as pull request 303 updated them for schema eighteen.
5. **Golden assertions.** Per [L5], the draw tests pin exact outcomes: for a fixed shift stream state and hire order, the exact shift each hire holds and the stream's draw count.

## [WS-save] Saves and older saves

Schema nineteen builds on schema eighteen from pull request 303. `SaveSnapshotV19` is the complete `SaveSnapshotV18` followed by `SavedShifts`: the shift stream, its draw count and `held`, a list of `{ sim, shift }` naming each person whose held shift is not the standard one, ascending by sim id, each once, with the shift's string id. Everyone not listed holds the standard shift, so a new game saves an empty list.

A schema-nineteen payload refuses to load, leaving the running game unchanged, when a listed person is not a living person with a career record, the list is out of order or repeats a person, a listed id is `standard`, or the id is not one of the shifts their level lists. Shift ids are validated by name against the current pack, as level ids are, and a shift's times follow the current content like every other career number. Content therefore never deletes a shipped shift id; it sets the weight to 0.

The current writer, every build transaction and the browser save worker use schema nineteen. The historical writers for schemas fourteen to eighteen stay for tests and comparisons. `SAVE_SCHEMA_VERSION` and the shell's `CURRENT_SAVE_VERSION` become 19, the save worker keeps a `terri-save-1.v18-backup.bin` recovery file when a current write replaces a schema-eighteen save, and a frozen copy of the schema-eighteen worker joins `web/tests/fixtures/` as pull request 303 added the schema-seventeen one.

**Older saves.** A save from schema eighteen or earlier loads with every employed person on their level's standard shift, the shift stream at its seed and no draws. Every existing job therefore keeps today's schedule, including a night watch worker's Sunday to Thursday nights, and no draw happens on load. A person who changes job later draws as any hire does.

If pull request 303 has not merged when implementation starts, the implementer stops and coordinates with its owner: this design does not take schema eighteen for itself.

## [WS-performance] Performance

The work added per tick is one ordered-map lookup and one index for each employed person where the start, length or days are read today, and one lookup per person per action decision for the sleep offset, outside the per-candidate loop. A shift draw happens only at a hire or a level change. No new per-tick allocation is allowed, and `career_path_shifts` runs only when the Career tab draws.

The plan measures the shipped household's trace run for 12,000 ticks in release mode three times before and after the change and accepts a median difference within 5 percent.

## [WS-tests] Verification

**Compiler** (`crates/terri-data`): each refusal in [WS-model]; a level with no weights compiles to the standard shift alone; the shipped pack compiles eight paths and 32 rows with rows 0 to 11 unchanged; the four sleep offsets compile and out-of-range values are refused; a published pack converts with day kind and no other shifts; and `three_random_housemates_rarely_share_a_schedule` computes the [WS-household] figure exactly from the compiled pack, asserts it equals 2441/512000 for the shipped content, and fails above 1 percent.

**Simulation** (`crates/terri-sim`): the household worker holds the standard shift with no draw; a hire by search, by command and by path change each draws once and holds the pinned shift; a level with one positive weight draws nothing; a promotion keeps an offered shift and draws when the new level does not offer it; over 10,000 draws on a fixture level each shift's share is within 1.5 percentage points of its weight; every reader in [WS-systems] uses the held shift, including the preflight prompt's hours and the door window; a Sunday night shift is attributed to the ending week and its review waits for the return; a hire at 09:00 onto a 09:00 shift starts that tick; the night offset moves the bed's score at 10:00 above its score at 22:00 for a night worker and leaves a day worker's unchanged; a death drops the held shift; the hash is unchanged for a world with only standard shifts and moves when a shift is drawn; the pre-change pin and the shipped pin of [WS-determinism]; and the schema-nineteen round trip, every refusal in [WS-save], and loading schemas fourteen to eighteen on the standard shift.

**Boundary** (`crates/terri-wasm`): `career_schedule_of` returns four values for a held night shift and the shipped worker's `[31, 360, 480, 0]`; `career_path_shifts` returns the office's two shifts and nothing for an unknown path; schema nineteen round-trips through the save bytes; and the published schema-fourteen to schema-eighteen inputs load on the standard shift.

**Shell** (`web/tests`): the Career row and tab wording for each kind, a midnight-spanning shift and an invalid kind; the chooser line for one and several shifts with rounding; the bridge's validation of both exports; and the save worker's version 19 with the schema-eighteen backup.

**Measurement** (trace example): a week of the shipped household and of a household with one night worker, reporting each person's job, shift and sleep by hour of day, the longest wait any housemate spends on a sleeping recipient, and the [WS-sleep] acceptance.

## [WS-played] Played evidence

Per [Testing Protocol, section 9](../testing-protocol.md#9-every-milestone-ends-with-a-played-visual-pass), the change is played in a displayed browser at desktop and phone widths before delivery. The pass must show, with retained screenshots and written findings and no video:

1. the Career row and Career tab of a day worker, an early or late worker and a night worker;
2. the chooser line for the office path and a three-shift path;
3. a night worker leaving at the shift's start, and the same person asleep in their bed in mid-morning while the others are up;
4. a new game's first two days, confirming that the shipped worker still leaves at 06:00 and that the household still eats, sleeps and talks;
5. a schema-eighteen save loading with every job on its old schedule.

A fresh independent reviewer inspects the captures against these points. The coordinating agent inspects the same images. Task-owned pages and preview servers are closed when the pass ends.

## [WS-docs] Changelog and documentation

The delivery adds a public changelog note in `docs/changelog/` on the delivery date, written for players: jobs now come with day, early, late or night shifts by chance, with office work nearly always weekday days; five new career paths; night workers sleep during the day; the Career tab shows the shift and the chances before assigning. It names no implementation detail.

The delivery also updates the careers spec's rules 2 and 18 to point here, [CAL-hud] for the Career row's wording, [S-careers] in `docs/GAME-SYSTEMS.md`, `docs/player-visible-strings.md`, the save schema in `docs/ARCHITECTURE.md`, and a dated verification record `docs/specs/2026-10-18-shifts-and-careers-verification.md` holding the measured figures and played findings.

## [WS-rulings] Rulings for confirmation

1. **For confirmation:** shifts are drawn per hire and held, rather than fixed per job, because "almost always" asks for chance within one job. A promotion keeps the shift when the new level offers it.
2. **For confirmation:** a job from `content/household.toml` starts on the standard shift with no draw, which keeps the shipped worker's 06:00 departure and every pinned value that depends on it.
3. **For confirmation:** the player cannot choose a shift in this issue ([WS-choose]).
4. **For confirmation:** the four shift kinds and their names are fixed vocabulary, and the office's 06:00 to 14:00 standard shift is a Day shift.
5. **For confirmation:** the shift offsets of [WS-sleep], including keeping the rhythm on days off.
6. **For confirmation:** no shift premium in pay or energy ([WS-content]).
7. **For confirmation:** the chooser shows kinds and chances ([WS-shell]).
8. **For confirmation, owner review per [L58]:** the five new path labels and twenty titles in [WS-content]. The existing provisional titles are not changed here.
9. **For confirmation:** the autonomous search keeps choosing the best-fitting path. Randomizing it among near-equal fits would spread a household across paths but would change the search that issue 297 just pinned; it belongs in its own issue if wanted.
