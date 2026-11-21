# Career tab: Go to work, the review window and a fixed panel width

Implementation plan for issues 311 and 317. Nothing here is implemented yet. The owner approved the mockups in `D:/VIBES/.worktrees/mockups-career/` ("as shown", 2026-11-16): `career-tab.html` and `.png` (Mockup 1), `career-graph-modal.html` and `.png` (Mockup 2), `panel-width.html`, `panel-width.png` and `panel-width-career-crop.png` (Mockup 3). For the review window's data the owner chose "All seven inputs", which needs a weekly history of those inputs in saves. The build must match the mockups; where they and the code disagree, [CT-conflicts] says so and [CT-questions] recommends an answer.

Base: `origin/main` at `e31afe285` (save schema 23, the presence fade). Branch `twcl/career-tab-311-317`.

## Contents

1. [The seven inputs](#ct-inputs-the-seven-inputs)
2. [Go to work (issue 311)](#ct-work-go-to-work-issue-311)
3. [The command](#ct-command-the-command)
4. [Schema 24](#ct-save-schema-24)
5. [Tuning](#ct-tuning-tuning)
6. [Web changes, file by file](#ct-web-web-changes-file-by-file)
7. [Player-facing strings](#ct-strings-player-facing-strings)
8. [Tests](#ct-tests-tests)
9. [Player guide and changelog](#ct-docs-player-guide-and-changelog)
10. [Mockup and code conflicts](#ct-conflicts-mockup-and-code-conflicts)
11. [Open questions](#ct-questions-open-questions)
12. [Merging after the late departure cap](#ct-merge-merging-after-the-late-departure-cap)
13. [Task breakdown](#ct-tasks-task-breakdown)

## [CT-inputs] The seven inputs

A shift's score is computed in `attendance::settle` from `careers::shift_score(fit, mastery, mood)`, then reduced by the missed-work deduction of `attendance::settlement` (10 points for each hour missed past the first 120 minutes). Fit is `clamp(trait_fit - 2 * max(0, social_demand - social_capacity), -1, 1)` (`careers::fit`). The seven series the review window draws, in the mockup's order:

| Id | Series | Per shift, read at settlement | Per week | Display | Affects the score |
| --- | --- | --- | --- | --- | --- |
| [CT-in-mastery] | Skill mastery | `careers::mastery`, 0 to 1 (0.5 when the path names no skill) | mean | percent | yes, `20 * (mastery - 0.5)` |
| [CT-in-mood] | Mood on shifts | `careers::mood_term`, -1 to 1 | mean | signed, two decimals | yes, `10 * mood` |
| [CT-in-missed] | Missed work | scheduled minus worked minutes | sum, in minutes | minutes | yes, through the deduction |
| [CT-in-fit] | Fit | `careers::fit`, -1 to 1 | mean | signed, two decimals | yes, `20 * fit` |
| [CT-in-trait] | Trait fit | `careers::trait_fit`, the sum of the path's weights over worn traits | mean | signed, two decimals | through fit |
| [CT-in-social] | Social capacity | `careers::social_capacity`, 0 to 1, against the row's `social_demand` | mean | percent, with the job's demand | through fit, only while below the demand |
| [CT-in-pay] | Pay per shift | the record's `pay`, whole dollars | the pay held during the week, read before the review's outcome | dollars | no ([CT-c-pay]) |

Each weekly row also keeps the career row index held during the week (for the level labels and the job's social demand), the number of scored shifts and the number of those with any minutes worked (the tooltip's "Shifts worked 5 of 5").

## [CT-work] Go to work (issue 311)

The Career tab gains a Go to work box under the job title (Mockup 1). One simulation function, `careers::go_to_work_status(world, entity, now) -> WorkStatus`, decides what the box shows and whether the command applies, so the shell and the drain can never disagree.

### [CT-work-state] When the control shows, is enabled or is disabled

`window` is `go_to_work_window_ticks` ([CT-tuning], shipped 120). The "current shift" is the person's open scheduled shift in `Attendance` (not settled, `start_tick <= now < end_tick`). The "next start" is the earliest tick `t` with `now < t <= now + window` at which the person's shift for `t`'s day starts, by exactly the rule `shifts::starts_at` and `shifts::shift_today` apply (working days, one paid shift a day, the day-of-a-shift-change rule). Only today and tomorrow need checking, at each day's `shift_start` time of day. A "too early" next start is found the same way over the following seven days.

| Id | State | Box | Button |
| --- | --- | --- | --- |
| [CT-ws-none] | No job | hidden, with the rest of the job details | hidden |
| [CT-ws-due] | At home, next start within the window | "{Shift name} starts at {hh:mm}, in {duration}." Note: "Stops what they are doing and leaves now, even with low needs." | enabled |
| [CT-ws-late] | At home, current shift started and open | "Started at {hh:mm}, {duration} ago. Time before they arrive counts as missed work." in the late style (Mockup 1 variant D), same note | enabled |
| [CT-ws-early] | At home, next start more than the window away (including days off and after today's shift) | "Next shift: {Weekday}, {hh:mm} to {hh:mm}." Note: "Go to work becomes available at {hh:mm}, {window words} before the shift." (variant B) | disabled |
| [CT-ws-work] | At work | "At work until {hh:mm}." Note: the schedule line (variant C) | disabled |
| [CT-ws-out] | Commuting to work | "On the way to work." Note: the schedule line | disabled |
| [CT-ws-home] | Commuting home | "On the way home." Note: the schedule line | disabled ([CT-q-inbound]) |
| [CT-ws-pending] | A career command is pending | unchanged text; status line "Sending them to work…" | disabled |

Asleep, eating, talking, fighting, washing, holding queued orders or on a reading journey do not disable the button ([CT-q-asleep], [CT-q-orders], [CT-q-reading]). `{window words}` is derived from the knob: "two hours" at 120, otherwise "{n} hours" or "{n} minutes". `{duration}` reads "1 hour 20 minutes", "35 minutes", "2 hours". A shift that starts at the window's edge (exactly `now + window`) counts as within it, as the mockup's "available at 04:00" for a 06:00 start implies.

### [CT-work-effect] What the command does

At the drain, for a person in [CT-ws-due] or [CT-ws-late]:

1. **Player orders.** The person's queued and running player orders are cancelled exactly as `SimCommand::CancelIntents` cancels them ([CT-q-orders]). Others' orders that target the person meet them gone, as they do at a normal shift start.
2. **Reading journey.** A reader puts the book down where they stand through `reading::floor::put_down_and_end` from the late departure cap branch ([CT-merge], [CT-q-reading]).
3. **Before the start ([CT-ws-due]): pre-register the shift.** Insert the day's `SavedScheduledShift` into `Attendance` now, with `start_tick` and `end_tick` at their scheduled values, `worked_ticks` 0, `accounted_tick = start_tick` and `pay_cents` computed exactly as `attendance::start_tick` computes it (record pay plus the night premium of the shift's kind). This is required: without it an early arrival takes `finish_tick`'s legacy branch, which starts a full `shift_ticks` countdown and pays through `complete_shift`, and `start_tick` then refuses to register the shift because the person counts as untracked legacy work.
4. **Depart.** Call `attendance::depart` directly. It suspends the running recipe, releases the reservation and removes `Eating` (sleep, meals and every other interaction), `Socialising`, `StepWork` and the rest, as at a shift start. Nothing checks `lateness::waits_for_needs` or `player_actions::has_player_work`; that bypass is what [WL-depart] item 6 reserved the predicate for. If `depart` finds no route, the command reports refusal 8 ([CT-command]) and nothing else changes (orders and the pre-registration are rolled back by doing steps 1 to 3 only after a route check).
5. **Critical needs** are ignored. Needs then drain at work at `at_work_decay_scale` and Bladder is relieved at work ([WL-bladder]). A person sent with Hunger or Energy at 0 still counts toward deprivation death (`death_after_ticks`, 3600), which no single shift reaches.

### [CT-work-time] Lateness, missed time and pay

1. Attendance is unchanged: `worked_ticks` accrues only while at work and only inside `[start_tick, end_tick)`. `account_and_settle` must skip a shift whose `start_tick` is still in the future (today it would move `accounted_tick` backwards), and `lateness::late_ticks` already returns `None` before the start.
2. **Leaving before the start counts as on time** when the walk ends before the start: 0 missed minutes, full pay, no deduction. If the walk ends after the start, the minutes from the start to arrival are missed, as for any late arrival.
3. **Time at work before the start is unpaid and unscored.** The shift still ends at its scheduled end and settles once ([WL-rulings] item 2).
4. **Leaving after the start**: missed minutes run from the scheduled start to arrival, as today. The 120-minute grace and the 10-points-an-hour deduction are unchanged.
5. The shift's week is `week_of(start_tick)`, unchanged. A weekly review that falls due while the person waits at work is deferred to their return, as rule 6 of the careers spec already does for anyone at work.
6. Pay is captured when the shift is pre-registered rather than at the start. A review cannot run between the two for a person who is away, so the captured pay equals what the start would have captured.

### [CT-work-guards] Other code that must accept a pre-registered shift

1. `attendance::validate_saved` refuses `start > now` today. It accepts a not-settled shift whose start is in the future only when `start - now <= go_to_work_window_ticks`, `accounted_tick == start_tick`, `worked_ticks == 0` and the shift is the person's current career. Older schemas can never contain one.
2. `attendance::close_open_shift` (a quit, a reassignment or a shift change) removes a not-yet-started shift instead of settling it, so it is never scored as a fully missed shift. Today those commands are refused while away, so this only matters for a person sent home by an order before the start. The register holds one record a person, so pre-registering replaces the person's settled record (normally the shift settled that day). `register_before_start` keeps that settled record unchanged in `Attendance::replaced`, and the removal puts it back exactly, with its shift pay, worked time and legacy flag, so the one-paid-shift-a-day rule keeps its history and the record still matches its outcome on every later load. A person with no record before has none after. The kept record is dropped when the registered shift starts, since a started shift settles rather than being removed, and when the person dies. Review finding F1 (2026-11-20): an earlier version rebuilt the record from the latest outcome, which set its pay to the pay settled and cleared the legacy flag, so every later save of a partly worked or legacy shift failed to load and Build mode would not open.
3. `attendance::work_conflicts` reports `remaining_minutes` as `end - max(now, start)` so the order confirmation never shows more minutes remaining than the shift has.
4. `attendance::report` (the Career tab's attendance line) reports 0 worked and 0 missed for a shift that has not started.
5. `shifts::starts_at` already lets the start tick of a registered shift pass (`last.start_tick == now`), and `attendance::start_tick` skips re-registering a shift whose `start_tick` equals `now`. A test pins both.

## [CT-command] The command

1. `SimCommand::GoToWork { agent: u32 }`, appended after `ChangeShift`, so postcard code 40. `agent` is an entity index, as every per-person command names one.
2. Queue hash (`Sim::hash`, `queued-commands-v1`): `GoToWork { agent } => vec![40, u64::from(*agent)]`.
3. It is a career command: applied by the drain in `systems/lot_edit.rs` after `flush_ordinary`, listed with the other career commands in both match lists of `systems/command.rs`, counted in `Careers::commands` and reported through `last_result`, so the shell's existing pending-result loop works unchanged.
4. Refusals: 1 not a living person, 5 no job (both exist); new 7 `NotDue` (no open shift and no start within the window), new 8 `NoRoute` (no way to the street). At work or commuting reuses 2.
5. Saves: the published saved command records stay frozen. A queued `GoToWork` rides schema 24 beside its queue position as `SavedQueuedWorkCommand::GoToWork { agent }`, restored through `save::v18::place_by_position`, as schema 21 does for shift commands. `save.rs` adds it to the unreachable "versioned commands" arm and `save::v18` leaves it out of older projections.
6. Determinism: the command draws nothing. Its effect depends only on the world at the drain, so replay and a save between enqueue and drain both give the same result ([L-queued-commands-must-survive-save]).

## [CT-save] Schema 24

### [CT-save-memory] What the simulation keeps

`careers::Record` gains three fields, none of which affects any simulation decision:

1. `shift_inputs: Vec<ShiftInputs>`: the current week's scored shifts, one per entry of `shifts`, in the same order. `ShiftInputs { fit, trait_fit, social_capacity, mastery, mood, missed_minutes: f32, attended: bool }`, taken from the exact values `settle` passes to `shift_score` (and from `complete_shift`'s values on the pre-schema-15 path, with 0 missed and attended true). A forfeited shift (a shift change) is not scored and gets no inputs, matching `shifts`.
2. `last_shift: Option<ShiftInputs>`: the most recent scored shift's inputs, kept across reviews. The Career tab's "Mood on the last shift" reads it ([CT-c-mood]).
3. `input_weeks: VecDeque<WeekInputs>`: at most `career_input_history_weeks` rows, oldest dropped first. `WeekInputs { week: u64, career: u32, shifts: u32, attended: u32, fit, trait_fit, social_capacity, mastery, mood: f32 (means), missed_minutes: f32 (sum), pay: u32 }`.

### [CT-save-row] When a row is written

In `review_person`, after the performance is computed and before the outcome changes the job or pay, when `shift_inputs.len() == shifts.len()` and both are non-empty. Means sum in shift order and divide by the count in `f32`. `career` is the row held during the week, `pay` the pay held before the outcome. `shift_inputs` clears with `shifts`. When the lengths differ (a save migrated mid-week), the week gets a score point and no input row. Firing drops the record and its rows; a player assignment starts a fresh record; a promotion, demotion, raise or autonomous path change keeps them, as they keep the score history.

### [CT-save-format] Format

`crates/terri-core/src/save_v24.rs`:

```rust
pub struct SavedShiftInputs { pub fit: f32, pub trait_fit: f32, pub social_capacity: f32, pub mastery: f32, pub mood: f32, pub missed_minutes: f32, pub attended: bool }
pub struct SavedWeekInputs { pub week: u64, pub career: u32, pub shifts: u32, pub attended: u32, pub fit: f32, pub trait_fit: f32, pub social_capacity: f32, pub mastery: f32, pub mood: f32, pub missed_minutes: f32, pub pay: u32 }
pub struct SavedCareerInputs { pub sim: u32, pub current: Vec<SavedShiftInputs>, pub last_shift: Option<SavedShiftInputs>, pub weeks: Vec<SavedWeekInputs> }
pub enum SavedQueuedWorkCommand { GoToWork { agent: u32 } }
pub struct SaveSnapshotV24 { pub legacy: SaveSnapshotV23, pub career_inputs: Vec<SavedCareerInputs>, pub queued_work_commands: Vec<(u32, SavedQueuedWorkCommand)>, pub replaced_shifts: Vec<SavedScheduledShift> }
```

`replaced_shifts` holds the settled records Go to work's pre-registration replaced ([CT-work-guards] item 2), strictly ascending by sim id. It is empty unless a registered shift waits for its start.

`SAVE_SCHEMA_VERSION` becomes 24. Only records holding any input data are written, ascending by sim id. The `legacy` chain grows one level in every `save_snapshot_v17` to `save_snapshot_v23` projection, exactly as the presence fade commit (`e31afe285`) did for schema 23; `save_snapshot_v23` becomes a historical projection and `save_snapshot_v24` the current save, with `load_snapshot_v24` beside it. Build mode's baseline (`build_transaction`) carries the rows, as it carries the fades.

### [CT-save-load] Load validation

`save::v24::restore` restores the schema 23 part first, then refuses the whole save before touching the live world when:

1. Rows are not strictly ascending by sim, exceed `MAX_LIST_ENTRIES`, or name someone with no career record in the restored careers.
2. `current.len()` exceeds the record's `shifts.len()`.
3. `weeks` are not strictly ascending, a week is not one of the record's reviewed weeks in `history`, or there are more than 520 (the knob's maximum).
4. A `career` row index is unknown, `shifts` is 0 or above 14, `attended > shifts`, `pay` lies outside that row's `pay..=pay_max`, or a value is non-finite or outside its range: fit, mood -1 to 1; social capacity, mastery 0 to 1; trait fit between the sum of the row's negative weights and the sum of its positive weights; missed minutes from 0 to `shifts` times the row's longest listed shift.
5. A queued work command's position is out of the queue's range or repeats a position, as schema 21 checks.
6. A replaced record is out of sim order, names someone whose restored register holds no open shift starting after the save's tick, is not settled, began at or after that shift's start, fails any check a record on the register must pass (except the at-home check, since its person may be waiting at work), or does not match the restored outcome with its sim and start exactly as `matching_settlement` requires.

A save holding more weeks than the current knob allows loads and keeps the newest knob's worth, so lowering the knob never refuses a save. This trims state at load; the hash after load reflects the trimmed rows.

[T5] settled three details the list leaves open. Current shifts are checked against the person's current career row, and the last shift against the widest bounds of any row, since it is kept across a promotion or a path change. A week's mean bounds are the row's bounds put through the same sum in shift order and division by the count in `f32`, so a mean of in-range values is never refused for rounding. The 14-shift limit is `save::v24::MAX_SHIFTS_IN_A_WEEK`, two for each day, and the 520-week limit is `Tuning::MAX_CAREER_INPUT_HISTORY_WEEKS`, which the knob's range check shares.

### [CT-save-migrate] Older saves

Schema 23 and every earlier schema load with no input rows, no current-week inputs and no last shift. The first review after loading writes a row only if the week's shifts were all settled after the load ([CT-save-row]). Nothing else migrates.

### [CT-save-hash] World hash

A tagged block `career-inputs-v1`, appended in `Sim::hash` after `presence_fade::hash`, written only when some record holds input data: the number of records, then for each in sim order its id, the current inputs, the last shift and the weekly rows, every `f32` by `to_bits`. A world with no settled shift since the change hashes as before. Every run that settles a scored shift moves its hash, so pins move ([CT-merge]).

The replaced records of [CT-work-guards] item 2 hash at the end of `attendance::hash`, as a tagged block `attendance-replaced-v1` written only when there are any: their count, then each record's fields in sim order, as the register's records are hashed. No shipped run uses Go to work, so no pin moves for them.

## [CT-tuning] Tuning

Two root knobs in `content/tuning.toml`, appended after `work_bladder_relief_threshold`, and appended to the compiled `Tuning` in the same order. The data crate's compile, schema, error, pack, published-pack wire and pre-books expansion follow the presence fade commit's pattern; `crates/terri-data/tests/fixtures/inherited-runtime.pack` is regenerated.

| Knob | Shipped | Range | Meaning | A pack published before it |
| --- | --- | --- | --- | --- |
| `go_to_work_window_ticks` | 120 | 0 to 720 | How long before a shift's start Go to work becomes available, in game minutes. 0 allows it only once the shift has started. | reconstructs 120; inert, since no older world can hold the command |
| `career_input_history_weeks` | 52 | 1 to 520 | How many reviewed weeks of score inputs each person keeps for the review window. | reconstructs 52 |

The window words in [CT-ws-early] and the player guide come from the knob. The review window's "Last 4 weeks" and "Last 12 weeks" presets are labels of a view, not simulation tuning; they live as two named constants in `web/src/ui/career-graph-modal.ts` ([CT-q-presets]).

## [CT-web] Web changes, file by file

### `crates/terri-wasm/src/lib.rs` and `web/src/bridge.ts`

1. `go_to_work(entity_index) -> bool` stages the command; bridge `goToWork(entity)`.
2. `go_to_work_status(entity_index) -> Vec<f64>`: `[state, start_tick, end_tick, opens_tick]`, state 0 none, 1 due, 2 late, 3 too early, 4 at work, 5 on the way to work, 6 on the way home; empty for anything but a living person. Bridge `goToWorkStatus(entity): GoToWorkStatus | null`.
3. `career_input_history(entity_index) -> Vec<f64>`: 14 numbers per row, `[week, career, path, level, shifts, attended, fit, trait_fit, social_capacity, social_demand, mastery, mood, missed_minutes, pay]`. Bridge `careerInputHistory(entity): CareerInputWeek[]`.
4. `career_last_shift(entity_index) -> Vec<f64>`: the seven `ShiftInputs` numbers, or empty. Bridge `careerLastShift(entity)`.
5. `career_row_title(row) -> String` for the level labels and "Promoted to {title}"; or reuse `career_level_titles(path)` with the row's path and level, whichever keeps the bridge smaller.
6. Refusal text in the bridge map: 7 "Their next shift is more than {window words} away.", 8 "They cannot find a way out to work."

### `web/src/ui/compact-hud.css` (panel width, Mockup 3)

1. Inside the existing desktop query (`min-width: 601px` and `min-height: 481px` and not a coarse pointer), `#sim-sheet` takes `--sim-sheet-width: 560px` on every tab, and `max-height: min(690px, …)` keeping the existing viewport terms. The width stays `min(var(--sim-sheet-width), calc(100vw - 18px))`.
2. Remove the rule `#sim-sheet:has(#sim-overview:not([hidden]) #personal-details[open]) { --sim-sheet-width: 540px; }`. Nothing else may change the width: not the tab, not a disclosure.
3. Phone and short-screen layouts keep their full-width sheet (`left: -1px; right: -1px; width: auto`). A coarse-pointer desktop-sized screen gets the 560px width too ([CT-q-coarse]).

### `web/index.html`

1. Career CSS: the work box (`.career-work`, button with the affirmative intent at 40px height, late text in the warning amber `#f0c36b` of Mockup 1), the facts grid (`.career-facts`, two columns, the Shift row spanning both), the score input grid with the effect column (`.career-effect` with `help`, `hurt`, `none`), the inline tooltip, the inline legend, and the `.career-info` focus ring (2px `--need-fill` outline). Remove `.career-graph-mini` and `.career-row-graph`.
2. The review window: `<dialog id="career-graph-dialog" aria-labelledby="career-graph-title">` with its CSS: 1160 by 800 on a 1440 by 900 screen, bounded by `min(1160px, 100vw - 48px)` and `min(800px, 100dvh - 48px)`; the backdrop at `rgba(0, 0, 0, .62)`; the paused pill (`#3a3220` with `#b89a52` edge and `#f3e2b5` text); the 250px filter column; the seven series colors as custom properties `--career-c-mastery: #4aa3ef`, `--career-c-mood: #f59a2f`, `--career-c-missed: #ef4f4f`, `--career-c-fit: #b07cf5`, `--career-c-trait: #3fcf7f`, `--career-c-social: #ec5fb8`, `--career-c-pay: #f2e64a`.
3. The Overview row's `#career-info` keeps its place; its label becomes "Open the review graph. Pauses the game." and its `aria-controls` points at the dialog. The `#career-row-graph` container is removed ([CT-q-overview]).

### `web/src/ui/career-panel.ts` (Mockup 1)

Order inside the tab: heading (title with trend color, then the i), subtitle "{path} path, level {n} of {m}", the Go to work box, the facts grid, the attendance line, Score inputs, Reviews (graph and legend), then everything below the graph that exists today: streak line, warning, Assign a career, Shift schedule and the job search box. The mockup's scrollbar shows this continues below the fold ([CT-c-omitted]).

1. **Remove the duplicate graph.** Delete `miniGraph`, `miniOpen` and the `career-tab-mini-graph` id. The i calls a new `actions.openReviewGraph(sender)`.
2. **The i** shows a tooltip "Open the review graph. Pauses the game." on hover and on keyboard focus, as in Mockup 1, and carries the same text as its accessible name. It stays hidden with no reviewed week, as today.
3. **Facts grid** replaces the separate Path, Level, Pay, Schedule, This week and Last review lines: Shift; Pay; Pay range at this level; This week ("1 shift, scoring 64", "No shifts yet"); Last review ("72 of 100", "None yet"); Promotion ("1 of 3 good weeks in a row", or "At the top of this path"). A night worker's premium sentence stays as a note under Pay.
4. **Go to work box** renders `goToWorkStatus` ([CT-work-state]) and sends `goToWork` as a fourth pending command kind, `'work'`, with the existing one-pending-command rule and focus handling ([L-bed-pending-focus]): focus returns to the button when it is still enabled, else to the box.
5. **Rename** "What the score reads" to "Score inputs".
6. **Score inputs rows** (five, as Mockup 1): name with a muted hint, value, effect. Effects: fit and trait fit and mood "Helps" above 0, "Hurts" below 0, "No effect" at 0 after rounding to two decimals; social capacity "No effect" at or above the job's demand, else "Hurts", with no value in the value column; skill mastery "Helps" above 50%, "Hurts" below, "No effect" at 50%. Mood reads `careerLastShift`, falling back to hiding the row's value with "No shift yet" ([CT-c-mood]). Fit and trait fit both show two decimals ([CT-q-decimals]).
7. `careerFactorLines` and `careerJobView` change shape; every caller and test updates with them.

### `web/src/ui/career-graph.ts` (the inline graph)

1. Size to the panel: 530 by 200 drawing space at the 560px panel (viewBox scaled to width), plot top margin 58 so the tooltip sits above the line without covering points, as Mockup 1.
2. Shaded bands above the good threshold and below the poor threshold (fill at 7% opacity), dashed threshold rules labelled with their values, axis labels 100, 65, 40 and 0, the first and last week under the axis.
3. Points colored by kind: green at or above good, red below poor, the line color between. Event markers as today.
4. **Hover text.** Pointer over a point or within half a column of it, keyboard focus on the graph with Left, Right, Home and End, and a tap on a phone select a week. The selected point gets a white ring and a guide line, and the tooltip shows "Week {n} review: {score} of 100", then the kind sentence ([CT-strings] S-tip), then the event sentence when there is one ("Promoted to {title}.", "Got a raise.", "Demoted to {title}.", "Changed path to {title}.", "Fired."). The graph is `role="group"` with `tabindex="0"` and the accessible name "Reviewed weeks"; a visually hidden `aria-live="polite"` line repeats the tooltip. Leaving or Escape hides it.
5. **Inline legend** under the graph: Weekly review score, Good, {good}, Poor, {poor}, then only the event markers present in the shown weeks.
6. The word helpers (kind of week, event sentence) move to `career-graph-words.ts` so the window uses the same text.

### `web/src/ui/career-graph-modal.ts` (new, Mockup 2)

1. **Open and pause.** `open(entity, opener)` calls `overlayPause.suspend('career-graph')` and `dialog.showModal()`. Close (the button, Escape, a backdrop click) calls `dialog.close()` and `overlayPause.resume('career-graph')`. The pause is shell time, not a replayable command, through the existing `OverlayPauseController`, so determinism is untouched. The data is read once at open; the game is paused, so it cannot change.
2. **Header.** "{name}'s reviews"; under it "{title}, {path} path, level {n} of {m}"; the paused pill with `role="status"`: "Game paused" and "Closing this window resumes the game at {speed}." where `{speed}` is the speed selected before opening (`OverlayPauseController` gains a read-only `selectedSpeed`); when the player had already paused, "The game stays paused after you close this window." ([CT-q-resume]). Close at the right with the negative intent.
3. **Filters column.** Score inputs: six checkboxes, each with its color swatch, in [CT-inputs] order; Skill mastery, Mood on shifts, Missed work and Fit start checked, Trait fit and Social capacity unchecked (Mockup 2). Below them, under the short label "Also shown: Pay per shift" ([CT-c-pay], the owner's ruling of 2026-11-20), one more checkbox with its swatch, unchecked, for the pay line. Pay is not a score input and is never listed under the "Score inputs" heading. On the score graph: Good and poor lines; Promotions and other events, both checked. Key: the three point colors, promoted and demoted, got a raise and changed path. Choices last until the page reloads, like the activity log's filters.
4. **Toolbar.** "Show" and a segmented control, `role="group"` named "Weeks shown", buttons with `aria-pressed`: Last 4 weeks, Last 12 weeks, All weeks (selected at open). The summary at the right counts the shown weeks: "{n} reviewed weeks. Average {a}. Good weeks {g}, poor weeks {p}."
5. **Score graph.** Grid lines every 20 points, "Review score" rotated on the left, threshold rules and labels "Good, {good}" and "Poor, {poor}", bands, the level labels centered over each run of weeks at one title with a dotted rule at each level change (weeks without an input row carry no label, [CT-c-levels]), week numbers under every column (every second or fifth when crowded), the selected week's number in bold white.
6. **Input rows.** One small chart per checked series, in filter order, all sharing the week columns: label in the series color at left, "Week {n}: {value}" at right for the selected week, scale ticks at left (0% and 100%; -1 and +1 with a zero rule; 0 min and the scale top for missed work as bars; $ low and high for pay). Missed work's scale top is the larger of the longest shift in view and the largest weekly total, labelled in hours ([CT-q-missed]). A week with no input row shows no mark and its label reads "Week {n}: not recorded".
7. **Tooltip and selection.** Pointer, keyboard (the score graph is focusable; Left, Right, Home, End) and tap select a week across the score graph and every row. The tooltip shows the heading, the kind sentence and a two-column list: Shifts worked {a} of {s}, Missed work {m} minutes, Skill mastery {x}%, Mood on shifts {±x}, Fit {±x}, Pay ${p} per shift (Mockup 2). A polite live region repeats it.
8. **Keyboard and focus.** `showModal` makes the page inert. Focus lands on the dialog heading (tabindex -1) so a screen reader announces the title; Tab order: Close, the filters, the week buttons, the score graph. On close, focus returns to the opener when it is still visible and enabled, else to the Career tab's heading, else the Sim details section ([L-dialog-focus-visible-return], [L73]).
9. **Contrast.** The game's interface has one dark theme (`color-scheme: dark`); there is no light interface theme ([CT-c-theme]). Against the window's `#16161c` and the row background `#1c1c24` every series color measures between 4.76:1 (missed work) and 13.05:1 (pay), and the muted text 6.62:1, so text in the series colors passes 4.5:1 and the lines pass the 3:1 graphics minimum. Color is never the only cue: every row is labelled by name and every point's kind is spelled out in the tooltip.
10. **Phone layout** ([CT-q-phone]): no approved mockup exists. Recommended until one is approved: the dialog fills the screen; the header wraps the pill under the title; the filters and key move into a collapsed "Filters" disclosure above the toolbar; the segmented control wraps; graphs take the full width with horizontal scrolling inside the plot when more than 12 weeks show; the tooltip docks to the bottom of the window instead of floating.

### `web/src/main.ts`

Create the window once with the simulation source, `overlayPause` and the roster's names; wire both i controls (Career tab and Overview row) to it; close it when a load, new game or import replaces the world.

### Tests directory additions

`web/tests/career-panel.test.ts`, `career-bridge.test.ts`, `compact-hud.test.ts`, `mobile-hud.test.ts`, `overlay-pause.test.ts` change; `career-graph.test.ts` and `career-graph-modal.test.ts` are new ([CT-tests]).

## [CT-strings] Player-facing strings

Every string below is functional text proposed for the owner's review under the boundary in `docs/player-visible-strings.md` and [L58]. None is a joke. The Career tab row of that inventory is updated: "What the score reads" is replaced, "Show the review graph" is replaced, and the rows below are added. Ids are for review comments.

| Id | String | Where |
| --- | --- | --- |
| S-btn | Go to work | Career tab button |
| S-due | {Shift name} starts at {hh:mm}, in {duration}. | work box |
| S-late | Started at {hh:mm}, {duration} ago. Time before they arrive counts as missed work. | work box |
| S-note | Stops what they are doing and leaves now, even with low needs. | work box note |
| S-early | Next shift: {Weekday}, {hh:mm} to {hh:mm}. | work box, disabled |
| S-opens | Go to work becomes available at {hh:mm}, {window words} before the shift. | work box note, disabled |
| S-atwork | At work until {hh:mm}. | work box, disabled |
| S-out | On the way to work. | work box, disabled |
| S-home | On the way home. | work box, disabled |
| S-dur | {n} hour(s), {n} minute(s), {h} hour(s) {m} minute(s) | durations |
| S-sent | Sending them to work… | status while pending |
| S-left | Left for work. | status after success |
| S-r7 | Their next shift is more than {window words} away. | refusal 7 |
| S-r8 | They cannot find a way out to work. | refusal 8 |
| S-sub | {path} path, level {n} of {m} | tab subtitle, window subtitle |
| S-facts | Shift; Pay; Pay range at this level; This week; Last review; Promotion; {n} shift(s), scoring {x}; No shifts yet; {x} of 100; None yet; {g} of {a} good week(s) in a row; At the top of this path; ${p} per shift; ${min} to ${max} | facts grid |
| S-inputs | Score inputs | section heading (rename) |
| S-rows | Fit (from -1 to 1); Trait fit (part of fit); Social capacity (job needs {y}%) with {x}% in the value column; Skill mastery (50% is neutral); Mood on the last shift; No shift yet | score input rows |
| S-eff | Helps; Hurts; No effect | score input effects |
| S-info | Open the review graph. Pauses the game. | both i controls: tooltip and accessible name |
| S-tip | Week {n} review: {x} of 100; Good week: {good} or more counts toward promotion.; Steady week: between {poor} and {good} counts toward neither.; Poor week: under {poor}. Poor weeks in a row bring a warning.; Promoted to {title}.; Got a raise.; Demoted to {title}.; Changed path to {title}.; Fired. | inline and window tooltips ([CT-q-tipwords]) |
| S-legend | Weekly review score; Good, {good}; Poor, {poor}; Promoted; Demoted; Raise; Changed path | inline legend |
| S-win | {name}'s reviews; Game paused; Closing this window resumes the game at {speed}.; The game stays paused after you close this window.; Close | window header |
| S-filters | Score inputs; Skill mastery; Mood on shifts; Missed work; Fit; Trait fit; Social capacity; Also shown: Pay per shift; On the score graph; Good and poor lines; Promotions and other events; Key; One weekly review; Green: good. White: steady. Red: poor.; Promoted, demoted; Got a raise, changed path; Filters (phone disclosure) | window filters |
| S-scale | Show; Last 4 weeks; Last 12 weeks; All weeks; Weeks shown (accessible name); {n} reviewed weeks. Average {a}. Good weeks {g}, poor weeks {p}.; Review score; Week; Review score by week (accessible name) | window toolbar and graph |
| S-rowlabels | Week {n}: {value}; Week {n}: not recorded; {n} minutes; {x} h; 0 min; ${p} per shift | window input rows |
| S-tipfacts | Shifts worked; {a} of {s}; Missed work; Skill mastery; Mood on shifts; Fit; Pay | window tooltip list |

## [CT-tests] Tests

Each test names its invariant, and each load-bearing one is broken on purpose and seen to fail before it is trusted (testing protocol rules 1, 5 and 6).

### Rust, `terri-core` and `terri-data`

1. `command.rs`: `GoToWork { agent: 34 }` encodes as `[40, 34]` and decodes back; the saved-command byte table stays frozen.
2. Knobs: each knob's range refusal by name, non-finite refusal, the shipped values, published-pack and pre-books reconstruction of 120 and 52, the regenerated inherited-runtime fixture.

### Rust, `terri-sim` (`go_to_work_tests.rs`, new)

1. Status: each state of [CT-work-state] from a built world, including the window edge (exactly `now + window` is due, one tick more is too early), tomorrow's early-morning shift seen from late evening, a day off, the day of a shift change (the old shift's start), a settled shift today, at work, both commute directions.
2. Due: the command departs on the drain tick, pre-registers the shift with the scheduled start and end and the start's pay; arriving before the start gives 0 missed minutes, full pay and no deduction; no worked minutes accrue before the start (break the `account_and_settle` guard and see the worked minutes and `accounted_tick` go wrong).
3. Early arrival does not take the legacy countdown: remove the pre-registration and see `complete_shift`'s legacy pay, which the test refuses.
4. Late: a person held home by critical Hunger leaves on the drain tick; missed minutes equal arrival minus start; the deduction past 120 minutes is unchanged.
5. Bypasses: critical needs, a sleep in progress (the bed is released), a meal in progress, a conversation (the partner's target clears), queued player orders (cancelled as `CancelIntents` cancels them), a reader (the book is on the floor, after [CT-merge]).
6. Refusals 1, 2, 5, 7 and 8 leave the world unchanged apart from the command count and result.
7. Guards of [CT-work-guards]: a not-started shift closed by a reassignment is removed, not scored; the order preflight's remaining minutes never exceed the total; the start tick does not register the shift twice; `starts_at` passes the registered start.
8. Save mid-wait: a save taken at work before the start, and a save with `GoToWork` still queued, both reload and continue with the same world hash on every following tick to the shift's settlement.
9. Determinism: two runs with the same commands give the same hash; the command consumes no draw (the careers and shift streams' draw counts are unchanged).

### Rust, `terri-sim` (`career_inputs_tests.rs`, new)

1. Settlement records inputs equal to the values the score used: recompute `shift_score` from the stored inputs and the deduction from the missed minutes and get the outcome's score exactly.
2. A review writes one row with the means, the missed sum, the attended count, the pre-outcome career row and pay; a promotion's row carries the old level.
3. A forfeited shift gets no inputs; a mid-week migrated record gets no row for that week and a row the next week.
4. The history keeps the newest `career_input_history_weeks` rows; firing drops them; an assignment starts empty; a path change keeps them.
5. The hash block: a world with no inputs hashes as before (pin one pre-change hash); a world with inputs changes when any stored field changes (flip one field and see the hash move).

### Rust, saves (`save/v24.rs`, `v24_tests.rs`, new)

1. Round trip of rows, current inputs, last shift and queued work commands, with equal hashes after load.
2. Each refusal of [CT-save-load], one test per condition, each failing the load before the live world changes.
3. Trimming to a lowered knob on load.
4. Schema 23 fixture saves (a new `crates/terri-wasm/tests/fixtures/career-inputs-v23/` set: a new game mid-week and a household after two reviewed weeks) load with empty inputs and continue; their next full week writes a row.
5. Every older-schema projection test updated for the extra `legacy` level, as in the presence fade commit.

### Wasm boundary (`crates/terri-wasm/src/career_tab_boundary_tests.rs`, new)

1. `go_to_work` stages a command whose drain matches the native result; `go_to_work_status` returns each state; a release-WASM run sends the shipped worker early and checks pay, following events rather than guessed ticks ([L-career-tests-follow-events-not-guessed-ticks]).
2. `career_input_history` and `career_last_shift` layouts, and empty results for a non-person.
3. A save written through the wasm save path at schema 24 reloads with the rows.

### Web (vitest)

1. `career-panel.test.ts`: the new order and facts; the rename; no mini graph and no `aria-expanded` on the i; the i calls `openReviewGraph`; every work box state and its text; the pending `work` command, its status lines and focus return; the effect labels at, above and below each neutral point.
2. `career-graph.test.ts` (new): hover, focus and arrow-key selection, the tooltip text for each kind and event, the legend's present-only markers, the live region.
3. `career-graph-modal.test.ts` (new): pause on open and resume on close through a fake `OverlayPauseController`, including the already-paused case; Escape, backdrop and Close all resume once; filters show and hide rows; presets change the shown weeks and the summary; missing input rows read "not recorded"; focus lands on the heading and returns to the opener, or to the tab heading when the opener is hidden.
4. `career-bridge.test.ts`: the three new parses and the two refusal texts.
5. `compact-hud.test.ts` and `mobile-hud.test.ts`: 560px on every tab and with Personality, habits and bed open; 690px maximum height; the phone sheet unchanged; header and controls fit at 601, 640, 800 and 1280px with doubled text ([L-clipped-headers-need-field-bounds]).
6. `overlay-pause.test.ts`: `selectedSpeed` reports the chosen speed and never the temporary pause.

### Played visual pass (testing protocol section 9)

Play the built game in a displayed, muted browser on a task-owned preview port, with the shipped household after at least five reviewed weeks (a schema 24 save written by the browser save writer, loaded through Import save) and a fresh schema 23 save for the migration case. Watch Go to work happen in the game: the sleeper gets up, walks out and the attendance line later reads 0 missed. Inspect every capture at full resolution, record findings per file, and give a fresh reviewer (`first-use-review` on a T2 or T3 model) the captures and one sentence about the player's goal, without explaining the controls.

Screenshots, desktop at 1440 by 900 and phone at 390 by 844, each with Light: auto by day and by night (the world shows through the backdrop and around the panel; the interface itself has one theme, [CT-c-theme]):

1. Career tab, Go to work enabled before the shift (matches Mockup 1).
2. Career tab, variants B, C and D (too early, at work, late).
3. The i's tooltip, keyboard-focused.
4. The inline graph's tooltip on a promotion week.
5. The review window at All weeks with the default filters (matches Mockup 2), and at Last 4 weeks with all seven inputs on.
6. The window's tooltip on a poor week, and a week with "not recorded" rows from the migrated save.
7. The window with the game previously paused (the stays-paused text).
8. Overview with Personality, habits and bed open, and Career, both at 560px (matches Mockup 3).
9. The phone review window.

## [CT-docs] Player guide and changelog

1. `docs/player/ui-elements.md` `#career`: Go to work and its two-hour rule, the facts, Score inputs, the hover text, the i opening the review window and pausing the game; the Overview paragraph (line 57) and the "smaller graph" sentence (line 119) change to the window.
2. `docs/player/the-world.md` `#careers`: a paragraph on sending someone to work early or late: leaving early is on time and the wait is unpaid; leaving late counts missed minutes from the start.
3. `docs/player/mood-and-personality.md` line 87: the review window and its inputs.
4. Screenshots in `docs/player/screenshots.json` and `illustrations.json` to recapture with a new source snapshot: `sim-career` (desktop, mobile, detail), `career-review`, `career-overview-graph` (becomes the window), `career-assigned`, `career-controls`, `career-shift-controls`, `overview`, and every other Sim details capture whose panel width changes (Queue, People, Traits). Run the guide build and its tests afterwards.
5. `docs/player-visible-strings.md`: the Career tab row and a new Review window row ([CT-strings]).
6. Changelog: a new file `docs/player/changelog/{delivery date}-career-tab.md`, or the bullets added to that date's entry when one exists, following `.agents/skills/maintain-changelog/SKILL.md`. Draft:

```markdown
# Go to work and a larger review graph

Send a housemate to work from the Career tab, and read their weekly reviews in a larger window.

## New
- Go to work in the Career tab sends a housemate to work now, whatever they are doing and however low their needs, once their shift has started or starts within two hours. Arriving before the start counts as on time; the wait at work is not paid.
- The i beside a job title opens the review graph in its own window and pauses the game until you close it. Choose which score inputs to show and how many weeks.

## Improved
- Hover over or tap a week on the Career tab's graph to see its score and what it meant.
- Score inputs, formerly What the score reads, says whether each input helps or hurts.
- Sim details keeps one wider size on every tab on a computer screen.
```

7. Internal docs: `docs/specs/2026-10-17-careers.md` (rules 16 and 18 point here), `docs/FEATURES.md`, `docs/ARCHITECTURE.md` (schema list), `docs/GAME-SYSTEMS.md`, `docs/glossary.md`, and a verification record `docs/specs/2026-11-19-career-tab-verification.md` holding every moved pin with its old and new value.

## [CT-conflicts] Mockup and code conflicts

1. **[CT-c-pay] Pay per shift is not a score input.** Mockup 2 lists it under Score inputs. The score reads fit, mastery, mood and missed time only. Owner's ruling of 2026-11-20: Pay per shift stays in the graph as a line the player can turn on, but it is listed below the score inputs under its own short label, "Also shown: Pay per shift", so the "Score inputs" heading stays true. The player guide says pay is shown for comparison.
2. **[CT-c-mood] "Mood on the last shift" shows today's mood.** `careers::factors` reads `mood_term` live. The plan stores the last shift's inputs so the label becomes true.
3. **[CT-c-height] The panel's height.** Mockup 3 lets the sheet grow to 690px; the code caps it at 420px. The plan raises the cap.
4. **[CT-c-levels] Level labels and "Shifts worked" need data the history lacks.** `Week` holds only week, performance and event. The schema 24 rows carry the career row and shift counts; weeks reviewed before schema 24 have no labels and no counts.
5. **[CT-c-theme] There is no light interface theme.** The HUD declares `color-scheme: dark` and nothing else. Contrast is verified against the dark theme; "light and dark" screenshots use the world's Light setting by day and night.
6. **[CT-c-omitted] Mockup 1 stops at Reviews.** The streak line, the warning, the night premium sentence, Assign a career, Shift schedule and the job search box are not drawn. The plan keeps them below the graph, reached by scrolling, as the mockup's scrollbar suggests.
7. **[CT-c-decimals] Number formats.** Mockup 1 shows trait fit as "+0.4" beside fit "+0.40".
8. **[CT-c-words] Tooltip punctuation differs.** Mockup 1 reads "Good week: 65 or more…"; Mockup 2 reads "Poor week. Under 40. …".
9. **[CT-c-legacy] An early arrival would be paid as a legacy shift.** Not a mockup conflict but a hazard the code hides: `finish_tick`'s legacy branch fires for anyone arriving at work without a registered shift. [CT-work-effect] item 3 closes it.
10. **[CT-c-label] Button label.** The issue says "send to work"; the approved mockup says Go to work. The mockup wins.

## [CT-questions] Open questions

Decided on 2026-11-20 by the coordinator, following the owner's earlier rulings: every question below is decided as its recommendation. [CT-q-phone] was open until the owner approved the phone layout the same day.

1. **[CT-q-asleep] Can a sleeping housemate be sent?** Decided as recommended (coordinator, 2026-11-20): yes; they wake and leave. The issue says "regardless of needs or anything else".
2. **[CT-q-orders] What happens to their queued orders?** Decided as recommended (coordinator, 2026-11-20): cancelled, as Cancel orders does. Go to work is the newest instruction.
3. **[CT-q-reading] A reader with a book?** Decided as recommended (coordinator, 2026-11-20): the book goes on the floor where they stand and they leave, reusing the late departure cap's helper.
4. **[CT-q-inbound] Someone on the way home while their shift is still open (sent home by an order)?** Decided as recommended (coordinator, 2026-11-20): disabled until they are home ("On the way home."); turning a walk around adds a path rule for little gain.
5. **[CT-q-early-pay] Is the wait before the start paid?** Decided as recommended (coordinator, 2026-11-20): no; it counts as on time and earns nothing.
6. **[CT-q-overview] What does the Overview row's i do?** Decided as recommended (coordinator, 2026-11-20): open the same window. The issue removes duplicates, and a third inline copy would remain otherwise.
7. **[CT-q-phone] The review window's phone layout has no approved mockup.** Approved by the owner on 2026-11-20: `career-graph-modal-phone.html` with its renders `career-graph-modal-phone.png`, `-tapped.png`, `-filters.png` and `-full.png` in `D:/VIBES/.worktrees/mockups-career/`, with two changes to build: the tapped-week panel's pay row reads just "Pay per shift" (not "Also shown: ..."), and the "Tap a week for details." hint hides while a week's details are open. The Filters checkbox reads "Also show: Pay per shift" and sits below the score inputs ([CT-c-pay]).
8. **[CT-q-resume] Which speed does closing the window restore?** Decided as recommended (coordinator, 2026-11-20): the speed chosen before opening, named in the pill; if the player had paused, it stays paused.
9. **[CT-q-missed] Missed work's scale.** Decided as recommended (coordinator, 2026-11-20): weekly total, scale to the larger of the longest shift in view and the largest weekly total.
10. **[CT-q-decimals] Number formats.** Decided as recommended (coordinator, 2026-11-20): two decimals for both fit and trait fit.
11. **[CT-q-tipwords] One wording for both tooltips.** Decided as recommended (coordinator, 2026-11-20): the "{Kind} week: …" form of Mockup 1 everywhere.
12. **[CT-q-history] How long is the input history?** Decided as recommended (coordinator, 2026-11-20): 52 reviewed weeks (13 game years, since a year is four weeks), with the score history left unbounded as today.
13. **[CT-q-coarse] A touch screen at desktop size.** Decided as recommended (coordinator, 2026-11-20): the 560px width applies; only the phone and short layouts keep the full-width sheet.
14. **[CT-q-presets] Do the 4 and 12 week presets belong in tuning?** Decided as recommended (coordinator, 2026-11-20): no; they are view labels, kept as named constants in one web module.
15. **[CT-q-log] Should Go to work write an activity log line?** Decided as recommended (coordinator, 2026-11-20): no new line; the departure and the attendance result already show.

## [CT-merge] Merging after the late departure cap

`twcl/late-departure-cap` (in progress, uncommitted at the time of writing) changes `attendance::start_tick`'s reading-journey branch, adds `lateness::book_return_cap_reached` and `reading/floor.rs` with `put_down_and_end`, and moves hash pins. It does not change the save schema as far as known.

1. After that branch lands, merge `origin/main` into this branch rather than rebasing, so a pushed branch never needs a force-push.
2. Expected conflict areas: `attendance.rs` (`start_tick`, where this work adds nothing, and `account_and_settle`, `close_open_shift`, `validate_saved`, `work_conflicts`, `report`, which it does not touch), `lateness.rs` (adjacent additions), `lib.rs` (hash order and system lists), the pinned constants.
3. [CT-q-reading] depends on `put_down_and_end`. If this branch must land first, the reader case requests the book's return and departs when the journey ends, and switches to the helper at merge. [T3] built that fallback: `careers::go_to_work` calls `reading::request_return` and does not depart; the open shift's ordinary departure in `attendance::start_tick` follows once the journey ends. Before the start no need holds the reader back, but a reader sent after the start whose Hunger or Energy is critical when the journey ends still waits under the lateness rule. Done at the merge of `c7932801c` (PR 353): `careers::go_to_work` now calls `put_down_and_end` for a reader and then `attendance::depart`, so the book stays on the floor where the reader stood, keeping its home, and they leave on the drain tick. The test, renamed `go_to_work_sends_a_reader_with_the_book_left_on_the_floor` in `reading/tests.rs`, expects exactly that.
4. Pins: GOLDEN (`lib.rs`), `SHIPPED_THURSDAY` (`job_search_tests.rs`), `STANDARD_ONLY_HASH` (`save/v21_tests.rs`), the activity log folds and the published witnesses are expected to move wherever a run settles a scored shift. Recompute them only on the merged tree, record each old and new value with its reason in the verification record, and run the full local gate (`py -3 -B scripts/check-local-ci.py run`) on the merged head.
5. If that branch adds tuning knobs, these two knobs follow its knobs in both the file and the `Tuning` struct.

## [CT-tasks] Task breakdown

Take them in order; each ends with its tests passing locally and the tree clean. Tiers follow the global table: Sonnet (T3) for well-defined pieces, Opus (T2) where save contracts or attendance timing make mistakes costly.

| Task | Files | Tests | Done means | Tier |
| --- | --- | --- | --- | --- |
| [T1] Knobs | `content/tuning.toml`, `crates/terri-data/src/{schema,compile,error,pack,lib,published_pack_wire}.rs`, `build_pre_books.rs`, inherited-runtime fixture | data crate knob tests | both knobs compile, refuse out of range, reconstruct in old packs | Sonnet |
| [T2] Command plumbing | `terri-core/src/command.rs`, `terri-sim/src/{lib,save}.rs`, `systems/{command,lot_edit}.rs`, `save/v18.rs`, `careers.rs` (refusals 7 and 8, a stub that refuses) | byte test, queue hash test | code 40 round-trips, drains, counts, refuses | Sonnet |
| [T3] Go to work behavior | `careers.rs` (`go_to_work_status`, `go_to_work`), `attendance.rs` ([CT-work-guards]), `shifts.rs` (next start helper) | `go_to_work_tests.rs` items 1 to 7 and 9 | every state and effect of [CT-work] proven, mutations seen failing | Opus |
| [T4] Inputs in memory | `careers.rs` (`Record`, `review_person`, `complete_shift`, `complete_attended_shift`), `attendance.rs` (`settle`), `lib.rs` (hash block) | `career_inputs_tests.rs` | rows written as [CT-save-row]; hash block as [CT-save-hash] | Sonnet |
| [T5] Schema 24 | `terri-core/src/{save_v24,save,lib}.rs`, `terri-sim/src/save/{v24,v24_tests}.rs`, `save.rs`, every `save_snapshot_v*` projection, `build_transaction`, wasm save path, v23 fixtures | v24 tests, `go_to_work_tests.rs` item 8, all older save tests | round trip, every refusal, migration, projections; all save suites green | Opus |
| [T6] Wasm and bridge | `terri-wasm/src/lib.rs`, `career_tab_boundary_tests.rs`, `web/src/bridge.ts` | boundary tests, `career-bridge.test.ts` | the four exports and parses, refusal texts | Sonnet |
| [T7] Panel width | `web/src/ui/compact-hud.css` | `compact-hud.test.ts`, `mobile-hud.test.ts` | 560px on every tab, 690px cap, phone unchanged, doubled text fits | Sonnet |
| [T8] Career tab layout | `career-panel.ts`, `web/index.html` (career CSS), `main.ts` (wiring) | `career-panel.test.ts` | Mockup 1 layout, Go to work box, rename, no duplicate graph | Sonnet |
| [T9] Inline graph | `career-graph.ts`, `career-graph-words.ts`, `web/index.html` | `career-graph.test.ts` | hover, focus and tap text, legend, live region | Sonnet |
| [T10] Phone mockup (if [CT-q-phone] stands) | `D:/VIBES/.worktrees/mockups-career/` | `first-use-review` on the render | owner approval through the question tool | Fable or Astra to draw, Opus or Sonnet to review |
| [T11] Review window | `career-graph-modal.ts`, `overlay-pause.ts`, `web/index.html` (dialog and CSS), `main.ts` | `career-graph-modal.test.ts`, `overlay-pause.test.ts` | Mockup 2 on desktop, approved phone layout, pause and focus contracts | Sonnet, Opus review |
| [T12] Overview i | `career-panel.ts`, `web/index.html` | `career-panel.test.ts` | the row's i opens the window; row graph removed | Sonnet |
| [T13] Strings, guide, changelog | `docs/player-visible-strings.md`, `docs/player/*.md`, `screenshots.json`, `illustrations.json`, images, changelog file, internal docs | guide build and tests, changelog tests and build | [CT-docs] complete; screenshots recaptured | Sonnet |
| [T14] Played pass and review | evidence under `docs/assets/review-evidence/career-tab/` (stills only) | section 9 pass, `first-use-review`, independent code review | findings resolved or recorded with reasons | Opus coordinating |
| [T15] Merge and pins | merged tree, verification record | full local gate on the merged head | pins recomputed and explained; owner-facing report | Opus |
