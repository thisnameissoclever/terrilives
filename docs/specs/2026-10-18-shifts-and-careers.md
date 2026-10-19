# Shifts and more career paths

Issue 296: different jobs have different chances of early, day, late and night shifts; office work is almost always weekday day hours; in a household of three with random job assignment it is unlikely that all three share one schedule; and the game gains career paths. This document amends rules 1, 2, 12 to 14, 16 and 18 of the [careers spec](2026-10-17-careers.md) and [CAL-hud] of the [calendar spec](2026-10-06-calendar.md). [Player orders and attendance](2026-10-17-player-orders.md) and [job search for each housemate](2026-10-18-job-search-per-person.md) (issue 297, pull request 303) remain in force. The owner's decisions of 2026-10-18 are recorded in [WS-rulings]; rulings marked **For confirmation** are the designer's choices and wait for the owner.

Pay stays out of this design. Issue 298 will multiply every wage by 1.5 and add bills; the new careers below state pay in today's units, whole dollars per shift before that change, so issue 298 scales them with every other wage.

## Contents

1. [The shift model](#ws-model-the-shift-model)
2. [Drawing a shift](#ws-choose-drawing-a-shift)
3. [Choosing a shift as the player](#ws-select-choosing-a-shift-as-the-player)
4. [Choosing a path by chance in the job search](#ws-search-choosing-a-path-by-chance-in-the-job-search)
5. [Shared schedules in a household of three](#ws-household-shared-schedules-in-a-household-of-three)
6. [Shipped career paths and shifts](#ws-content-shipped-career-paths-and-shifts)
7. [Work, attendance, reviews and the order systems](#ws-systems-work-attendance-reviews-and-the-order-systems)
8. [Sleeping around a shift](#ws-sleep-sleeping-around-a-shift)
9. [What the player reads and does](#ws-shell-what-the-player-reads-and-does)
10. [Determinism](#ws-determinism-determinism)
11. [Saves and older saves](#ws-save-saves-and-older-saves)
12. [Performance](#ws-performance-performance)
13. [Verification](#ws-tests-verification)
14. [Played evidence](#ws-played-played-evidence)
15. [Changelog and documentation](#ws-docs-changelog-and-documentation)
16. [Decisions and rulings](#ws-rulings-decisions-and-rulings)

## [WS-model] The shift model

A shift is a named working pattern: a kind, a start time of day, a length and the weekdays it runs. There are four kinds, **day**, **early**, **late** and **night**, numbered 0 to 3 in that order. The kind gives the shift its name in the interface and its sleeping rhythm ([WS-sleep]); the start, length and days decide when the person works. Two shifts with the same start, length and days are the same schedule, whatever their kinds or paths.

Every level keeps its own `shift_start`, `shift_ticks` and `working_days`. They are the level's **standard shift**, and its kind is the path's `standard_shift`, which defaults to `day`. A level with nothing else behaves exactly as every level does today.

A path may declare other shifts in `[[career.shift]]` entries. Each has an `id` unique within the path, a `kind`, a `shift_start`, a `shift_ticks` and `working_days`, validated as a level's are: the start below `day_ticks`, the length from 1 to below `day_ticks`, and the days a non-empty list of distinct weekday names. The id `standard` is reserved for the level's own shift.

A level chooses among its shifts with `shift_weights`, a table from shift id to a whole-number weight from 0 to 1000. The key `standard` names the level's own shift; the other keys name the path's shifts. An absent table means `{ standard = 1 }`. A shift with weight 0 is never drawn or offered to the player but can still be held, which is how content retires a shipped shift without breaking a save that holds it. The compiler refuses an unknown kind, a duplicate or reserved shift id, a weight key that names no shift of the path, a weight above 1000, and a level whose weights are all 0.

The compiler stores each level row's choices in the flat compiled career list, as rows already carry their path's values. `CompiledCareer` gains, appended after its last field per the pack's compatibility rule, `standard_kind: u8`, `standard_weight: u32` and `shifts: Vec<CompiledShift>`: the path shifts the level names in its weights, including weight-0 entries, in the path's authored order. `CompiledShift` holds `id`, `kind`, `shift_start`, `shift_ticks`, `working_days` (the seven-bit mask) and `weight`. The level's own fields stay where they are, so shift index 0 always means the standard shift and index `i` above 0 means `shifts[i - 1]`; nothing is stored twice. A shift is **offered** at a level when its weight there is above 0. Packs published before this change convert with `standard_kind` day, `standard_weight` 1 and no other shifts.

## [WS-choose] Drawing a shift

A person **holds** one shift of their level. The held shift is part of the person's career record; the job itself names only the level.

1. **Hiring draws by default.** When the autonomous search hires a person ([WS-search]), when a review changes a person's path (careers rule 14), and when the player assigns a path without choosing a shift, the person draws a shift from the new level's weights. When the player assigns a path with a chosen shift, the person holds that shift and nothing is drawn ([WS-select]).
2. **A household job holds the standard shift.** A job named in `content/household.toml` starts on the level's standard shift without a draw, so the shipped worker keeps today's Monday to Friday 06:00 to 14:00.
3. **A level change keeps the shift when it can.** A promotion or a demotion keeps the held shift's id when the new level offers it; the times are the new level's, as a promotion already moves the standard shift's hours today. Otherwise the person draws from the new level's weights.
4. **One choice draws nothing.** When exactly one of the level's shifts is offered, the person takes it without a draw.
5. **The draw.** The candidates are the standard shift and then the listed shifts in order, each with its weight. With `total` the sum of positive weights, one `range(total)` call on the shift stream ([WS-determinism]) returns `r`, and the person takes the first candidate whose running sum of weights exceeds `r`.
6. **Only these events move a shift.** A hire, a level change and the player's shift change of [WS-select] set the held shift. Loading, a save, a Build mode commit or cancel, an attendance settlement, a raise and a week with no event leave it alone. Quitting and dismissal drop it with the record.

## [WS-select] Choosing a shift as the player

The player can choose a housemate's shift in the Career tab, both when assigning a path and later while the housemate is employed. The search's hires keep the drawn shift until the player changes it.

1. **Assigning with a shift.** `SimCommand::AssignCareerShift { agent, path, shift }` assigns path `path` exactly as `AssignCareer` does and makes the person hold shift index `shift` of the path's first level, with no draw. `AssignCareer` keeps its meaning and wire form and draws the shift.
2. **Changing shift while employed.** `SimCommand::ChangeShift { agent, shift }` makes an employed person hold shift index `shift` of their current level. It is allowed at any time the person is at home, as often as the player likes.
3. **What a change costs.** A change resets the person's consecutive good weeks to 0, so the next promotion needs a full run of good weeks again; nothing else changes. Pay, level, job satisfaction, the poor-week streak and the warning stay as they were. Before the change, any scheduled shift that is still open while the person is at home settles as a career change settles it today, prorated by the minutes worked.
4. **Refusals.** Both commands are refused, changing nothing, for a person who is not a living person, a person at work or commuting, and a `shift` index the level does not offer. `AssignCareerShift` is also refused for an unknown path; `ChangeShift` also for a person with no job and for the shift the person already holds. The refusal numbers continue the career list: 4 for a shift not offered, 5 for a person with no job, 6 for the shift already held.
5. **Accounting.** Both are career commands: each handled one adds one to the career command count and sets the last career result, as `AssignCareer` and `QuitCareer` do.

Command codes follow pull request 303's: `AssignCareerShift` is `SimCommand` code 38 and `ChangeShift` code 39. Pull request 303 froze the published `SavedCommand` records at code 32 and carries its two settings commands in schema eighteen beside their queue positions; the shift commands follow that precedent and have no `SavedCommand` code ([WS-save]). If another branch takes codes 38 and 39 first, the implementation takes the next free ones and this section is updated with them.

## [WS-search] Choosing a path by chance in the job search

Careers rule 13 keeps its timing, its apply chance and its hire chance. Only the choice of path changes: an unemployed person who applies picks a path by a weighted draw over the fits of every path's first level, so trait fit still favors a path but does not decide it.

1. **Order of draws.** For each person in sim id order whose search is on: the apply draw as today; if they apply, the path draw; then the hire draw with the chosen path's fit, `clamp(0.5 + 0.5 * fit, 0.1, 0.95)`, as today. A person who does not apply draws once, as today.
2. **The path draw.** With `T = career_search_temperature`, path `i` is weighted `exp((fit_i - best) / T)`, where `best` is the highest fit, through the existing `sample_softmax` sampler over the paths in index order. It draws one number from the careers stream.
3. **Temperature 0.** `career_search_temperature = 0` means the rule before this change: the best fit wins, ties go to the lower path index, and no path draw happens. The compiler accepts 0 and finite values above 0 up to 2.
4. **Shipped value.** `career_search_temperature = 0.25`, appended to `content/tuning.toml` after the shift sleep offsets. A fit difference of 0.2 then makes one path about 2.2 times as likely as the other, and a path 0.8 worse is about 25 times less likely.
5. **Stream.** The path draw uses the careers stream, not the shift stream, because it is part of the search and sits between the search's two existing careers draws. Keeping the search's draws in one stream means that stream alone replays every search decision. The shift stream stays limited to shifts, so a player's shift choices never move a later search or review.
6. **Unchanged.** A review's change of path (careers rule 14) still chooses the best-fitting path with no draw; it is a deliberate move away from a bad fit, not a search.

`sample_softmax` computes `exp` with the platform's floating-point library. Its own documentation records that native and WebAssembly agreement on a last-bit result is measured, not guaranteed; the path draw inherits that measured risk and adds no new kind of risk.

## [WS-household] Shared schedules in a household of three

**Random assignment.** The issue's measure is the chance that three housemates, each given a job independently and at random, all hold the same schedule: each person's path drawn uniformly from the shipped paths, each starting at the path's first level as every hire does, and each drawing a shift by that level's weights. With `p(s)` the chance that one such hire holds schedule `s`, merging identical schedules across paths, the chance that all three share one is the sum over schedules of `p(s)` cubed. For the eight shipped paths of [WS-content], the first levels offer 20 distinct schedules and the chance is **2441/512000, about 0.48 percent**. Before this change, with three paths and one schedule each, it was one in nine, about 11.1 percent. The chance that at least two of the three share a schedule is about 17.7 percent, and that all three share a shift kind regardless of times about 8.0 percent.

**The shipped household with the actual search.** Tim holds the office clerk job from `content/household.toml` on its standard shift; Bill and Casey start unemployed and are hired by the search of [WS-search]. A person who applies but is not hired tries again on a later working day with a fresh path draw, so the path they end up in has probability proportional to the softmax weight times the hire chance. With the shipped traits, shyness drawn from sim ids 1 and 2, and temperature 0.25, the predicted fits and outcomes are:

| Person | Fit by path (office, cafe, night watch, hospital, warehouse, library, restaurant kitchen, buses) | Most likely paths |
| --- | --- | --- |
| Bill | 0.2, -1, 0, -0.24, -0.2, 0.2, 0.1, -0.2 | office 30%, library 30%, restaurant kitchen 18%, night watch 11% |
| Casey | -0.3, 0.2, 0.1, 0.2, 0.2, -0.6, -0.8, 0.2 | cafe, hospital, warehouse and buses 21% each, night watch 13% |

Under those predictions, all three share Tim's schedule with a chance of about **0.45 percent**, Tim and Bill share it about 28 percent of the time, Bill and Casey share some schedule about 2 percent of the time, and at least two of the three share a schedule about 31 percent of the time. With the best-fit search that this replaces, Bill took the office and Casey the cafe every time, so all three never shared but Tim and Bill shared about 95 percent of the time. If the shipped household were assigned at random apart from Tim, the chance that both others match Tim would be about 1.41 percent.

These household figures are predictions from the fit formula and need the plan's trace measurement before they count as measured. A compiler test computes the random-assignment figure from the compiled pack and fails above 1 percent, so a later content change cannot quietly undo the issue's requirement.

## [WS-content] Shipped career paths and shifts

The three existing paths keep their ids, labels, levels, titles, pay, standard shifts and fit values, and they stay first in `content/careers.toml`, so compiled rows 0 to 11 and path indices 0 to 2 keep their meaning. They gain other shifts and weights. Five new paths follow them. Every level of a path uses the same weights.

The owner approved the five new path labels and twenty job titles below on 2026-10-18. The shift names Day shift, Early shift, Late shift and Night shift are functional text.

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

The office's standard shift stays 06:00 to 14:00 and is labeled Day shift, by the owner's decision. The office and library late shifts are the same schedule, and the computation in [WS-household] counts them once.

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

Pay depends on the level only, never on the shift, and a night shift costs the same energy as a day shift at that level. By the owner's decision, any shift premium belongs to the wage calibration of issue 298.

## [WS-systems] Work, attendance, reviews and the order systems

Every reader of a job's start, length or working days reads the person's held shift instead, through one function, `shifts::shift_of(world, pack, entity)`, which returns the held shift of the person's level, or the standard shift when the person has no record (a hand-built world or a household worker before their first shift). The readers are:

1. `attendance::start_tick`, which registers a due shift and its end tick;
2. `attendance::work_conflicts`, the preflight behind the Proceed and Cancel prompt, so the prompt shows the held shift's remaining and total hours;
3. the saved-attendance validator, which accepts a scheduled shift whose start time of day, weekday and length match any shift the row lists, because a promotion or a shift change can move the held shift after a scheduled shift was recorded under the old one;
4. the reading system's `PendingShift` validator, which checks against the held shift;
5. `portals.rs`, whose door opening window reads the shift length;
6. `Sim::career_definition_of` and the boundary exports in [WS-shell].

Commuting, `AtWork`, deferral by player orders, interruption, resumption, proration of pay, energy and rewards, the two-hour grace and the deduction behave as [player orders and attendance](2026-10-17-player-orders.md) says. A shift that starts before midnight and ends after it already exists in the shipped night watch: it starts only on a working day, finishes on the next day and is attributed to the week of its scheduled start. A shift starting on Sunday night therefore belongs to the ending week, and its worker is reviewed on return through careers rule 6's waiting review.

The search runs at `career_search_tick` (09:00) before shifts start in the same tick. A person hired at 09:00 onto a shift that starts at 09:00 (the cafe day shift or the library standard shift) starts it in that tick; a test in [WS-tests] pins that order. A shift change at home takes effect for the next scheduled start of the new shift, which can be later the same day.

Reviews, outcomes, warnings and job satisfaction do not read the shift. A shift draw or change never counts as a review outcome and adds no history entry.

Conversations and player orders gain no rule. A night worker asleep by day is a sleeping recipient, and the existing rules apply: a player order waits beside a busy recipient, and autonomous requests weigh the recipient's remaining protected activity. The plan's trace measurement reports how long housemates wait on a day sleeper; a defect there belongs to the conversation system and is reported to the owner, not patched here.

## [WS-sleep] Sleeping around a shift

A night worker must sleep by day. The circadian sleep drive already shifts a person's rhythm by their chronotype offset (`chronotype_offset_ticks`, positive meaning later). Each shift kind adds a further offset while the person holds a shift of that kind, on working days and days off alike:

| Tuning knob | Shipped value | Effect |
| --- | --- | --- |
| `shift_sleep_offset_day` | 0 | No change; the shipped worker's rhythm is untouched. |
| `shift_sleep_offset_early` | -60 | Bed an hour earlier. |
| `shift_sleep_offset_late` | 120 | Bed two hours later. |
| `shift_sleep_offset_night` | 660 | The rhythm's midnight falls at 11:00, so a worker home at 06:00 sleeps from mid-morning to late afternoon. |

The four knobs are appended to the root of `content/tuning.toml` after `career_mood_fired_ticks`, in that order, followed by `career_search_temperature`; the compiled `Tuning` appends them after its last field, `meal_appreciation_gain`, per the pack's appending rule. The compiler refuses an offset outside -720 to 720. Packs published before them reconstruct the shipped values, which matter only for a held shift of a non-day kind, and no published pack has one.

`select_action` computes the person's effective offset once per decision, the chronotype offset plus the held shift's kind offset, and passes it to `sleep_drive` for every candidate. The lookup goes through one system parameter that reads the `Careers` resource with each person's `SimId` and `Career`, so the existing query and parameter lists do not grow past their limits. The offset changes scores only and adds no random draw. Needs, energy cost and the exhaustion ramp are unchanged.

**For confirmation:** the offset applies on days off too, so a night worker keeps a steady rhythm through the week rather than flipping twice. The values are a first estimate that the plan's trace measures; the acceptance is that a night worker over a simulated week spends most of their sleep between 07:00 and 18:00 and is awake at their shift's start on at least 9 shifts in 10.

## [WS-shell] What the player reads and does

1. **Sim details, Career row.** The row reads `{title}, {shift}, {working days}, {start} to {end}`, for example `Night watch, Night shift, Sunday to Thursday, 22:00 to 06:00` and `Office clerk, Day shift, Monday to Friday, 06:00 to 14:00`. The shift is Day shift, Early shift, Late shift or Night shift. The working-day wording is [CAL-hud]'s.
2. **Career tab, schedule line.** The schedule line uses the same wording for the held shift.
3. **Career tab, assigning.** Beside the existing path selector, a **Shift** selector lists `By chance` first, selected by default, and then each shift the selected path's first level offers as `{shift}, {working days}, {start} to {end}, {n}%`, where `{n}` is its chance of being drawn rounded to a whole percent; for example `Late shift, Monday to Friday, 12:00 to 20:00, 5%`. Shifts are listed in falling order of chance with ties in authored order. The list refreshes when the path selection changes, returning to `By chance`. Assign sends `AssignCareer` when `By chance` is selected and `AssignCareerShift` otherwise.
4. **Career tab, changing shift.** For an employed person, below the schedule line, a **Shift** selector lists every shift their current level offers in the same wording, with the held shift selected, and a **Change shift** button that is enabled only when another shift is selected. A note beneath reads `Changing shift resets the good weeks counted toward the next promotion.` The button sends `ChangeShift`. While the person is at work or on the way, the existing refusal text `Not while they are at work or on the way.` is shown after a refused send, as for Assign and Quit.
5. **Feedback.** Sending shows `Changing the shift…`; an applied change shows `Shift changed.`; the refusals show `That shift is not offered at this level.`, `This person has no job.` and `They already work that shift.`, and the existing texts for an unknown person, a person at work and a send the queue refused.
6. **Boundary.** `career_schedule_of(entity_index)` returns `[working_days, shift_start, shift_ticks, kind, index]` for the held shift, empty for anyone without a job as today. `career_path_shifts(path)` returns the path's first level's offered shifts and `career_shifts_of(entity_index)` the person's current level's offered shifts, each flattened as `[index, kind, shift_start, shift_ticks, working_days, weight]` per shift, standard first then authored order, and each empty for an unknown path or a person without a job. `assign_career_shift(entity_index, path, shift)` and `change_shift(entity_index, shift)` stage the two commands and return queue acceptance, as `assign_career` does; `last_career_result` reports refusals 4 to 6. The bridge validates each kind as 0 to 3 and omits the shift name for any other value.

The strings Day shift, Early shift, Late shift, Night shift, Shift, By chance, the shift option wording, Change shift, the note and the five feedback texts are functional text, proposed here for the owner's review, and join `docs/player-visible-strings.md` with the approved path labels and titles.

## [WS-determinism] Determinism

1. **Streams.** Shift draws use a new `SimRng`, the shift stream, held in the `Careers` resource with its own draw count and seeded from the constant `SHIFTS_SEED = 0x5348_4946_5453_3031`. The search's path draw uses the careers stream ([WS-search]). Reviews and path changes draw exactly the careers numbers they do today.
2. **Order.** Draws happen inside the search and the reviews, which visit people in sim id order, and inside the player's commands, which the command drain applies in queue order. No shift draw happens for a household job, a chosen shift, a single offered shift, a level change that keeps its shift, or a load. No path draw happens for a person who does not apply or at temperature 0.
3. **Hash.** The careers part of the world hash keeps its layout. After the people whose job search is off (issue 297), it appends the tag `career-shifts-v1`, the shift stream's state, its draw count, the number of people holding a shift other than the standard, and for each in sim id order their id and the shift id's bytes, but only when the stream has been drawn or someone holds a shift other than the standard. A world in which everyone holds the standard shift and the stream is undrawn hashes exactly as before. The careers stream's state and draw count are already hashed, so a path draw is visible there.
4. **Golden assertions.** Per [L5], the draw tests pin exact outcomes: for a fixed stream state and hire order, the exact path and shift each hire holds and each stream's draw count.

### Movement of pinned values

Each pinned value falls into one of four classes. The plan records every test whose expectation moves, with its class.

1. **Unchanged.** Worlds with no job and no search keep their values: the bare-agent golden hash, 4661132544113609906, with its release-wasm twin in `web/tests/bridge.test.ts`, and the published schema-fifteen boundary values in `crates/terri-wasm/src/published_v15_tests.rs`. A loaded older save keeps every job on its standard shift and draws nothing on load, so load-only comparisons are unchanged. The content fingerprint pinned in `crates/terri-data/tests/content_hierarchy.rs`, the trait and skill libraries and the saved action manifest are unchanged, because careers are deliberately outside the fingerprint and no interaction, trait, skill or object is added.
2. **Search behavior, intended.** Every run in which an unemployed person applies now makes one more careers draw and can choose another path, so the careers stream's later numbers, the hired path, every later review and the world hash move. This covers `the_search_hires_the_unemployed_only_while_the_setting_is_on`, `the_search_runs_at_the_search_tick_of_a_weekday_only` and issue 297's tests in `job_search_tests.rs` that count draws. A test whose subject is not the path choice runs at temperature 0, which is the old rule exactly; a test of the search itself is re-pinned to the new exact path, draws and hash, with a comment naming this issue.
3. **Pull request 303's pin.** `every_search_on_plays_out_exactly_as_the_global_setting_did` pins the hash and careers draw count main computed at commit 2b15dcfea. It keeps those exact values by running under a pack cut back to the first three paths and twelve rows, with no other shifts, every shift sleep offset at 0 and the search temperature at 0, which is the pre-change career content and search exactly. A second test, `the_shipped_household_hash_and_draws_through_thursday`, pins the shipped content's hash, careers draw count and shift draw count.
4. **Content and envelope.** Careers tests that run the shipped household with chosen jobs, such as `the_shipped_household_keeps_living_around_its_jobs`, which puts Casey on the night watch, now apply the night offset; their measured funds, needs and life satisfaction are measured again and any moved threshold is recorded with its cause. Historical save fixtures still load; tests that re-save a fixture and compare bytes see the schema-nineteen envelope and are updated exactly as pull request 303 updated them for schema eighteen. The compiled runtime fixture `crates/terri-data/tests/fixtures/inherited-runtime.pack`, which compiles the shipped tuning and careers, gains the five shift knobs, the shift fields of every career row and the new rows and paths; its regeneration proves that every other byte is unchanged. The trace example's output changes and is not pinned.

## [WS-save] Saves and older saves

Schema nineteen builds on schema eighteen from pull request 303. `SaveSnapshotV19` is the complete `SaveSnapshotV18` followed by `SavedShifts`: the shift stream, its draw count and `held`, a list of `{ sim, shift }` naming each person whose held shift is not the standard one, ascending by sim id, each once, with the shift's string id. Everyone not listed holds the standard shift, so a new game saves an empty list. A chosen shift and a drawn shift save the same way. The search temperature is content, not saved state.

A schema-nineteen payload refuses to load, leaving the running game unchanged, when a listed person is not a living person with a career record, the list is out of order or repeats a person, a listed id is `standard`, or the id is not one of the shifts their level lists. Shift ids are validated by name against the current pack, as level ids are, and a shift's times follow the current content like every other career number. Content therefore never deletes a shipped shift id; it sets the weight to 0.

A queued `AssignCareerShift` or `ChangeShift` crosses a save in schema nineteen as a row beside its position in the whole command queue, as schema eighteen carries its settings (`SavedQueuedSetting`): the person by entity index as `QuitCareer` names them, the path, and the shift as its index at the level. The published `SavedCommand` records stay frozen, so the rows exist only in schema nineteen. The historical writers for schemas fourteen to eighteen return an error for a queue holding either command rather than dropping it, and a load of either row validates it as the drain will. Until schema nineteen lands, the schema-eighteen writer leaves both commands out of the queue and out of the positions it counts, so the rest of the queue still loads in order.

The current writer, every build transaction and the browser save worker use schema nineteen. `SAVE_SCHEMA_VERSION` and the shell's `CURRENT_SAVE_VERSION` become 19, the save worker keeps a `terri-save-1.v18-backup.bin` recovery file when a current write replaces a schema-eighteen save, and a frozen copy of the schema-eighteen worker joins `web/tests/fixtures/` as pull request 303 added the schema-seventeen one.

**Older saves.** A save from schema eighteen or earlier loads with every employed person on their level's standard shift, the shift stream at its seed and no draws. Every existing job therefore keeps today's schedule, including a night watch worker's Sunday to Thursday nights, and no draw happens on load. A person who changes job or shift later draws or chooses as any hire does. An older save's careers stream continues from its saved state; the next search in that game makes the path draw.

If pull request 303 has not merged when implementation starts, the implementer stops and coordinates with its owner: this design does not take schema eighteen for itself.

## [WS-performance] Performance

The work added per tick is one ordered-map lookup and one index for each employed person where the start, length or days are read today, and one lookup per person per action decision for the sleep offset, outside the per-candidate loop. A shift draw happens only at a hire or a level change; the path draw computes eight exponentials once per applicant on a working day. No new per-tick allocation is allowed, and the shift list exports run only when the Career tab draws.

The plan measures the shipped household's trace run for 12,000 ticks in release mode three times before and after the change and accepts a median difference within 5 percent.

## [WS-tests] Verification

**Compiler** (`crates/terri-data`): each refusal in [WS-model]; a level with no weights compiles to the standard shift alone; the shipped pack compiles eight paths and 32 rows with rows 0 to 11 unchanged; the four sleep offsets and the search temperature compile, and out-of-range values are refused, including a negative or non-finite temperature; a published pack converts with day kind and no other shifts; and `three_random_housemates_rarely_share_a_schedule` computes the [WS-household] random-assignment figure exactly from the compiled pack, asserts it equals 2441/512000 for the shipped content, and fails above 1 percent.

**Simulation** (`crates/terri-sim`): the household worker holds the standard shift with no draw; a hire by search, by command and by path change each draws once and holds the pinned shift; a level with one offered shift draws nothing; a promotion keeps an offered shift and draws when the new level does not offer it; over 10,000 draws on a fixture level each shift's share is within 1.5 percentage points of its weight; the search's path choice draws once per applicant from the careers stream in the pinned order, follows the softmax weights within 1.5 percentage points over 10,000 fixture draws, and at temperature 0 picks the best fit with no draw; `AssignCareerShift` and `ChangeShift` apply, cost exactly the good-week streak, settle an open shift at home, count as career commands and refuse each case in [WS-select] without changing the world; every reader in [WS-systems] uses the held shift, including the preflight prompt's hours and the door window; a Sunday night shift is attributed to the ending week and its review waits for the return; a hire at 09:00 onto a 09:00 shift starts that tick; the night offset moves the bed's score at 10:00 above its score at 22:00 for a night worker and leaves a day worker's unchanged; a death drops the held shift; the hash is unchanged for a world with only standard shifts and moves when a shift is drawn or chosen; the pinned values of [WS-determinism]; and the schema-nineteen round trip, including queued shift commands, every refusal in [WS-save], and loading schemas fourteen to eighteen on the standard shift.

**Boundary** (`crates/terri-wasm`): `career_schedule_of` returns five values for a held night shift and the shipped worker's `[31, 360, 480, 0, 0]`; `career_path_shifts` returns the office's two shifts and nothing for an unknown path; `career_shifts_of` returns a worker's offered shifts and nothing for an unemployed person; the two command exports stage their commands and `last_career_result` reports refusals 4 to 6; schema nineteen round-trips through the save bytes; and the published schema-fourteen to schema-eighteen inputs load on the standard shift.

**Shell** (`web/tests`): the Career row and tab wording for each kind, a midnight-spanning shift and an invalid kind; the assigning selector's options, default, ordering, rounding and the command it sends; the change selector, the button's enabled state, the note and each feedback text; the bridge's validation of every new export; and the save worker's version 19 with the schema-eighteen backup.

**Measurement** (trace example): a week of the shipped household and of a household with one night worker, reporting each person's job, shift and sleep by hour of day, the longest wait any housemate spends on a sleeping recipient, the [WS-sleep] acceptance, and the paths Bill and Casey reach over 200 seeds of the careers stream against the [WS-household] predictions.

## [WS-played] Played evidence

Per [Testing Protocol, section 9](../testing-protocol.md#9-every-milestone-ends-with-a-played-visual-pass), the change is played in a displayed browser at desktop and phone widths before delivery. The pass must show, with retained screenshots and written findings and no video:

1. the Career row and Career tab of a day worker, an early or late worker and a night worker;
2. the assigning Shift selector for the office path and a three-shift path, with `By chance` selected, and an assignment made with a chosen shift;
3. a shift change for an employed person at home, the note, the reset good-week count and the refusal while at work;
4. a night worker leaving at the shift's start, and the same person asleep in their bed in mid-morning while the others are up;
5. a new game's first two days, confirming that the shipped worker still leaves at 06:00, that Bill and Casey find work, and that the household still eats, sleeps and talks;
6. a schema-eighteen save loading with every job on its old schedule.

A fresh independent reviewer inspects the captures against these points. The coordinating agent inspects the same images. Task-owned pages and preview servers are closed when the pass ends.

## [WS-docs] Changelog and documentation

The delivery adds a public changelog note in `docs/changelog/` on the delivery date, written for players: jobs now come with day, early, late or night shifts, with office work nearly always weekday days; the Career tab lets the player pick a shift when assigning a job or change it later, at the cost of the good weeks counted toward promotion; housemates looking for work now try different careers rather than always the same best fit; five new career paths; and night workers sleep during the day. It names no implementation detail.

The delivery also updates the careers spec's rules 2, 12, 13 and 18 to point here, [CAL-hud] for the Career row's wording, [S-careers] in `docs/GAME-SYSTEMS.md`, `docs/player-visible-strings.md`, the save schema in `docs/ARCHITECTURE.md`, and a dated verification record `docs/specs/2026-10-18-shifts-and-careers-verification.md` holding the measured figures and played findings.

## [WS-rulings] Decisions and rulings

**Owner's decisions of 2026-10-18:**

1. **Owner decision, 2026-10-18:** the automatic job search mixes chance into the choice of path while trait fit still matters ([WS-search]). The design's temperature, its stream and the classification of moved values are the designer's and appear in rulings 10 and 11.
2. **Owner decision, 2026-10-18:** shifts are choosable by the player in the Career tab, both when assigning a path and later while employed, and a search hire keeps its drawn shift until the player changes it ([WS-select]).
3. **Owner decision, 2026-10-18:** no night premium now; pay and energy follow the level, and any shift premium is left to issue 298's wage calibration.
4. **Owner decision, 2026-10-18:** the office keeps its 06:00 start, labeled Day shift.
5. **Owner decision, 2026-10-18:** the five new path labels and twenty job titles in [WS-content] are approved as proposed.

**For confirmation:**

6. Shifts are drawn per hire and held, rather than fixed per job, and a promotion keeps the shift when the new level offers it ([WS-choose]).
7. A job from `content/household.toml` starts on the standard shift with no draw, which keeps the shipped worker's 06:00 departure.
8. A shift change is allowed whenever the person is at home, as often as the player likes, and costs only the consecutive good weeks ([WS-select]). The reset makes a change a real decision without touching pay or the job.
9. The four shift kinds and their names are fixed vocabulary, and the sleep offsets of [WS-sleep] apply on days off too.
10. The search temperature is 0.25, spread weighted by fit through the existing softmax sampler, and a review's change of path stays best-fit ([WS-search]).
11. The path draw uses the careers stream, so that stream alone replays the search, and the shift stream holds only shifts ([WS-search]).
12. The Shift selectors show times, days and chances, and the strings in [WS-shell] are proposed for the owner's review.
