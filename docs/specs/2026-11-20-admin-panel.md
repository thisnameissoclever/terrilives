# Admin panel: edit housemates, relationships, funds and bills

Implementation plan for issue 312. Nothing here is implemented yet. The owner approved the mockups in `D:/VIBES/.worktrees/mockups-admin/` on 2026-11-20: `admin-housemate`, `admin-relationships` and `admin-household` at 1440 by 900, and the three `-phone` views at 390 wide, each as `.html` and `.png`. `notes.md` in that folder maps every control to its model field and range, and records the owner's decisions at its end. Where a literal copy of a mockup would look poor, confuse or miss functionality, the owner asked for good interface design over a literal copy; [AP-conflicts] lists every place this plan departs from the mockups and why.

Base: `origin/main` at `ebe7be646` (save schema 24, Go to work), merged forward to `a80b38d9f` (save schema 27, needs affect mood over time, issue 355, then the last good save copy and the test repair). Branch `twcl/admin-panel-312`.

## Contents

1. [Owner decisions this plan builds on](#ap-owner-owner-decisions-this-plan-builds-on)
2. [Design in brief](#ap-design-design-in-brief)
3. [The command](#ap-command-the-command)
4. [Every control and the edit it sends](#ap-edits-every-control-and-the-edit-it-sends)
5. [Undo](#ap-undo-undo)
6. [Skip ahead](#ap-skip-skip-ahead)
7. [Saves and hashing](#ap-save-saves-and-hashing)
8. [Tuning](#ap-tuning-tuning)
9. [Wasm and bridge](#ap-wasm-wasm-and-bridge)
10. [The web panel](#ap-web-the-web-panel)
11. [Player-facing strings](#ap-strings-player-facing-strings)
12. [Tests](#ap-tests-tests)
13. [Player guide and changelog](#ap-docs-player-guide-and-changelog)
14. [Mockup and model conflicts](#ap-conflicts-mockup-and-model-conflicts)
15. [Open questions](#ap-questions-open-questions)
16. [Task breakdown](#ap-tasks-task-breakdown)

## [AP-owner] Owner decisions this plan builds on

Recorded at the end of `notes.md` on 2026-11-20:

1. The Relationships tab gets the same housemate picker as the Housemate tab and lists only the selected housemate's relationships.
2. Good interface design wins over a literal copy of the mockups.
3. Opening the panel pauses the game; closing it restores exactly the previous state: paused, 1x, 2x or 3x.
4. Tilde opens and closes the panel. Backtick keeps the developer overlay under `?debug=1`.
5. The panel is available in every game.
6. On a touch screen, tapping and holding the lot's bottommost tile (the south corner of the lot diamond, on the street edge) opens the panel when not in Build mode.
7. Changes are saved with the game like any other change (coordinator). No save records that the panel was used.
8. Undo steps back through every change made since the panel opened (coordinator). Skip ahead is not undoable (`notes.md`, Undo section).

## [AP-design] Design in brief

1. **One command carries every edit.** `SimCommand::Admin(Box<AdminChange>)`, wire code 41, holds a list of edits applied atomically as one change. One player action is one change and one Undo step. Each edit names people by `SimId`, never by entity index, so it survives the world restore that Undo performs.
2. **Edits apply only inside an admin session**, a simulation resource that exists while the panel is open. The session holds a baseline snapshot taken at open and a journal of the changes applied since. It is not saved and not hashed, like Build mode's transaction.
3. **The shell applies a change synchronously.** The wasm export stages the command and runs the paused command drain in the same call, so an admin command never sits in a queue at a save boundary. The ordinary queue entry point refuses admin bytes.
4. **Undo restores the baseline and replays the journal minus its last change**, checking the world hash after every replayed change against the hash recorded when that change first applied. This is the Build transaction's mechanism ([AP-undo]), exact by construction, with no hand-written inverse per edit.
5. **Every edit refuses rather than clamps.** The shell clamps typed numbers to the shown range before sending; the simulation refuses anything non-finite, outside its range, or that would produce a world the save loader refuses. After applying, each edit runs the load validator of the state it changed.
6. **No new save schema.** No new saved field is needed ([AP-save]).
7. **Skip ahead is ordinary ticking**, run by the shell at a raised tick budget with the session closed and reopened around it. It ends the Undo history.

## [AP-command] The command

### [AP-cmd-wire] Wire format

`crates/terri-core/src/admin.rs` (new), re-exported from `lib.rs`:

```rust
pub struct AdminChange { pub edits: Vec<AdminEdit> }

pub enum AdminEdit {
    SetNeed { sim: u32, need: u8, value: f32 },                    // 0
    SetSatisfaction { sim: u32, value: f32 },                      // 1
    SetRepetition { sim: u32, object: u32, row: u32, value: f32 }, // 2
    EndTimedMoodlet { sim: u32, timer: u8 },                       // 3
    SetAffinity { sim: u32, kind: u32, value: f32 },               // 4
    SetSkillPractice { sim: u32, skill: u32, practice: f32 },      // 5
    SetTraitState { sim: u32, trait_index: u32, state: f32 },      // 6
    AddTrait { sim: u32, trait_index: u32 },                       // 7
    RemoveTrait { sim: u32, trait_index: u32 },                    // 8
    SetJob { sim: u32, job: Option<u32>, shift: u32 },             // 9
    SetShift { sim: u32, shift: u32 },                             // 10
    SetPay { sim: u32, dollars: u32 },                             // 11
    SetJobSatisfaction { sim: u32, value: f32 },                   // 12
    SetGoodWeeks { sim: u32, weeks: u32 },                         // 13
    SetPoorWeeks { sim: u32, weeks: u32 },                         // 14
    SetJobSearch { sim: u32, on: bool },                           // 15
    SetFeeling { from: u32, to: u32, value: f32 },                 // 16
    StartFight { from: u32, to: u32 },                             // 17
    SetFunds { cents: i64 },                                       // 18
    AdjustFunds { cents: i64 },                                    // 19
    SetBill { due_day: u32, kind: u8, amount_cents: i64, late_fee_cents: i64 }, // 20
    MoveBill { due_day: u32, kind: u8, to_due_day: u32 },          // 21
    PayBill { due_day: u32, kind: u8 },                            // 22
    MarkBillPaid { due_day: u32, kind: u8 },                       // 23
    DeleteBill { due_day: u32, kind: u8 },                         // 24
    AddBill { due_day: u32, kind: u8, amount_cents: i64, late_fee_cents: i64 }, // 25
}
```

`timer` codes: 0 burnt dinner, 1 had a fight, 2 promoted, 3 got a raise, 4 demoted, 5 fired. `need` is the `NeedId` order. `object` is the pack's object definition index, `row` the flyout action row (`action_rows::rows`), `kind` the pack's affinity index, `skill` the pack's skill index, `trait_index` the pack's trait index, `job` a career row, `shift` an index into that row's shifts. Content indices are safe because an admin command never outlives the session that sent it ([AP-save-queue]).

1. `SimCommand::Admin(Box<AdminChange>)` is appended after `GoToWork`, so postcard code 41, boxed as `Character` is. Variants are appended only at the end and fields only after the last field, as `command.rs` lines 24 to 38 require.
2. A golden byte test pins code 41 and every `AdminEdit` code with one vector each, and checks that `[41, ...]` does not decode as `SavedCommand`. The same vectors live in a shared fixture, `crates/terri-core/tests/fixtures/admin-wire.json`, read by both the Rust test and `web/tests/admin-codec.test.ts`, so the TypeScript encoder cannot drift from the Rust decoder ([L13]).
3. Queue hash (`Sim::hash`, `queued-commands-v1`): `Admin(change) => [41, edit count, then per edit its code and fields]`, every `f32` by `to_bits`, `i64` as its two's complement `u64`, `Option` as 0 or 1 plus the value. The arm exists because the match is exhaustive; [AP-save-queue] makes it unreachable in practice, and a test pins it anyway.
4. Both match lists in `systems/command.rs`: `Placement::of` maps `Admin` to `Back`; `drain_ordinary_commands` lists it with the commands `lot_edit` applies itself. `capture_command` in `save.rs` returns `SaveError::AdminCommandQueued` for it instead of panicking ([AP-save-queue]). `build_transaction::commands` refuses it as `CommandNotAllowed`.

### [AP-cmd-admit] Admission at the queue

`enqueue_command` (the ordinary entry point) refuses `Admin` bytes outright. Only `admin_apply` ([AP-wasm]) admits them, and only while a session is active. Admission checks what does not depend on the world ([L-queued-commands-must-survive-save]):

1. 1 to `MAX_ADMIN_EDITS` edits (1024, a representational bound in `admin.rs`, enough for "set every feeling to 0" in the largest household).
2. Every `f32` finite. Static ranges: need, satisfaction and job satisfaction 0 to 100; feeling and affinity -1 to 1; trait state 0 to 1; repetition 0 or more; practice 0 or more; funds, amounts and fees within `MAX_ADMIN_FUNDS_CENTS` (10^12 cents, the bill loader's own ceiling, so dollars times 100 can never overflow at load).
3. Codes known: `need < 7`, `timer < 6`, bill `kind < 4`.
4. **No two edits in one change touch the same unit.** A unit is (person, need), (person, satisfaction), (person, object, row), (person, timer), (person, affinity kind), (person, skill), (person, traits), (person, career), (from, to) for a feeling, (from) for a fight, funds, or (due day, kind) for a bill. `SetSkillPractice` and the trait edits both touch (person, skills) as well, because adding a capability trait raises practice. This keeps a change's edits independent, so validating them all against the world before applying any is exact.

### [AP-cmd-drain] At the drain

`systems/lot_edit.rs` applies `Admin` after `flush_ordinary`, as it applies career commands, by calling `admin::apply(world, &change)`:

1. Refuse with 1 (`NoSession`) unless an `AdminSession` resource exists.
2. Validate every edit against the world as it stands ([AP-edits] gives each edit's refusals). The first refusal refuses the whole change; nothing is applied.
3. Apply every edit in order.
4. Run the post-condition checks of [AP-cmd-post]. A failure here means a bug: the change is undone by restoring the session's last good state ([AP-undo-restore]) and reported as refusal 99 (`WouldNotLoad`). If even that restore fails, the live world keeps edits that would not load, so the session is marked broken and fails loudly: every later edit is refused as 99, Undo fails, and no save is written, while the panel stays open and after it closes, until a load replaces the world. The panel cannot open again on that world, and neither can Build mode: `begin_build` refuses it as Build failure 17, since ending or cancelling Build installs a restored world that would drop the mark and let a save through. The shell shows the Undo failure path ("Undo failed. Your changes are kept.") instead of saying nothing was changed.
5. Record the change and `Sim::hash()` in the session's journal, and set `AdminState.last` to `{ sequence, refusal: None }` or `{ sequence, refusal: Some((edit index, code)) }`. `AdminState` is not saved and not hashed; it is reporting only, like `Careers.last_result`. `Sim::admin_apply` reads the result only when its sequence moved past the one before the flush; a flush that left no new result is treated as a refusal that changed nothing (99), made true by restoring the last good state as in step 4.

An admin edit never touches `Careers.commands`, `Careers.last_result` or `LotEditState.last_edit_result`, so the Career tab and Edit Sims pending loops never mistake an admin change for their own. Admin edits draw from no random stream, with one exception: settling an open shift on a job or shift change can run a career review, which draws. Undo replays that draw exactly, because restoring the baseline restores the stream's state.

### [AP-cmd-post] Post-condition: the result must load

After applying, the drain runs the load validator of each kind of state the change touched, on the live values:

| State touched | Validator |
| --- | --- |
| Needs, satisfaction, traits, relationships | the per-entity checks of `save.rs` (lines 1715 to 1730, 1807 to 1822, 1862 to 1886), factored into functions the drain can call |
| Repetition | `validate_habituation` |
| Affinities, skills | `save/affinities.rs`, `save/skills.rs` row checks on the captured rows |
| Timed moodlets | `save/v11.rs`, `save/v12.rs`, `careers::validate_saved` moodlet checks |
| Career | `careers::validate_saved` on `careers::saved`, the schema 21 shift checks, the schema 24 input checks, `attendance::validate_saved` |
| Funds | the schema 13 dollars and cents agreement |
| Bills | `bills::validate_saved(world, &bills::saved(world))` |
| Need mood (every change) | the schema 27 row checks in `save/v27.rs` (`validate_rows` and `resolve`, shared with the loader through `v27::validate_live`) on the rows a save would write |

No edit writes the need mood balance: a need edit changes only what it accrues on later ticks, as refilling a need in play does. The need mood rows are checked after every change anyway, because they are keyed by person and cheap to check. These checks are cheap and cover exactly what changed. The full save round trip after every edit kind is proven by tests ([AP-tests-sim] item 3), not run at play time.

### [AP-cmd-refusals] Refusal codes

| Code | Name | Meaning |
| --- | --- | --- |
| 1 | `NoSession` | the panel is not open |
| 2 | `NotAPerson` | the named sim is not a living member of the household |
| 3 | `OutOfRange` | a value outside its content range (skill top, `habituation_max`, pay range, `advance_weeks`) |
| 4 | `UnknownContent` | an unknown object row, affinity kind, skill, trait, career row or shift |
| 5 | `NotFound` | no such repetition entry, running timer or bill |
| 6 | `AtWork` | a job or shift change while at work or commuting (the career commands' code 2) |
| 7 | `TooManyTraits` | adding a fifth trait (`housemate_max_traits`) |
| 8 | `AlreadyWorn` | adding a trait already worn |
| 9 | `NotWorn` | changing or removing a trait not worn |
| 10 | `NoValue` | setting a disposition's state |
| 11 | `SamePerson` | a feeling or fight toward oneself |
| 12 | `BillExists` | adding or moving a bill onto a due day and kind already used |
| 13 | `BillPaid` | editing, moving or paying a paid bill |
| 14 | `BadDueDay` | a due day that is not a billing month start, or is after today |
| 15 | `LateFeeTooEarly` | a nonzero late fee before the bill's grace days end |
| 16 | `LateFeeTooHigh` | a late fee above the bill's cap |
| 17 | `CannotAfford` | Pay from funds with funds below the bill and its fee |
| 18 | `Busy` | a fight while either person is at work or commuting |
| 99 | `WouldNotLoad` | the post-condition failed; a bug report, never expected |

## [AP-edits] Every control and the edit it sends

"Person" below is the housemate chosen in the panel's picker. Every row validates refusal 2 for every named person. Ranges come from content and the model as read on `ebe7be646`. The shell commits a slider on release (`change`), never while dragging (`input`), and a number box on Enter or leaving the field, so one adjustment is one change and one Undo step. A number typed outside the shown range is clamped to it before sending and the box shows the clamped value.

### [AP-e-housemate] Housemate tab

| Id | Control | Change sent | Range and validation | Notes |
| --- | --- | --- | --- | --- |
| [AP-e-need] | Hunger, Energy, Hygiene, Bladder, Social, Fun, Comfort | `SetNeed` | 0 to 100, whole numbers | `Needs::set`. Mortality counts are left alone: a need above 0 drops the person's count on the next tick as it does now. With death on, a note under Needs warns that Hunger or Energy at 0 counts toward death. |
| [AP-e-fill] | Fill {name}'s needs | seven `SetNeed` to 100 | | one Undo step |
| [AP-e-sat] | Life satisfaction | `SetSatisfaction` | 0 to 100, whole numbers | band word beside it from `satisfaction-meter.ts` |
| [AP-e-rep] | One row per repetition entry | `SetRepetition` | 0 to `habituation_max` (3.0), two decimals; refusal 5 when the entry does not exist; 0 removes the entry | the panel lists only existing entries; labels from the action row; "Overdoing" above `overdoing_threshold`, "Feeling sick" for a food row at `sick_threshold` or more |
| [AP-e-repclear] | Clear {name}'s repetition | `SetRepetition` 0 for every entry | | ends Overdoing and Feeling sick, which are derived |
| [AP-e-mood] | Mood and moodlets | none | read only | mood is derived ([AP-c-mood]) |
| [AP-e-end] | End now, on a timed moodlet | `EndTimedMoodlet` | refusal 5 when that timer is not running for the person | removes the person's row from `BurntMeals`, `Fights.timers` or the career timer |
| [AP-e-endall] | End {name}'s timed moodlets | one `EndTimedMoodlet` per running timer | | hidden when none run |
| [AP-e-aff] | Plants, Aquarium, Television, Radio | `SetAffinity` | -1 to 1, two decimals | one row per `[[affinity]]` kind in pack order; band words from `affinity_band_likes` and `affinity_band_loves` |
| [AP-e-skill] | One row per skill | `SetSkillPractice` | level 0 to the skill's `levels`, shown as level plus fraction ("2.40" is level 2, 40% of the way to 3); the shell converts with `skill_practice_for` ([AP-wasm]); the drain refuses practice above `Ladder::max_practice(levels)` with 3 | labels from `skills.toml` (Cooking, Fitness, Reading) |
| [AP-e-tval] | A worn condition's value ("how severe") | `SetTraitState` | 0 to 100 percent, sent as 0 to 1; refusal 9 when not worn, 10 for a disposition | |
| [AP-e-tcap] | A worn capability's value ("improvement") | `SetSkillPractice` on the capability's skill, from `practice_for_mastery` | 0 to 100 percent | the value shown for a capability is its skill's mastery, not the trait state ([AP-c-capability]); a capability whose tag names no skill falls back to `SetTraitState` |
| [AP-e-tdisp] | A disposition | none | "No value to set" | |
| [AP-e-tremove] | Remove | `RemoveTrait` | refusal 9 | practice stays where it is, as Edit Sims leaves it |
| [AP-e-tadd] | Choose a trait to add, Add | `AddTrait` | refusal 7 at 4 traits, 8 when worn, 4 when unknown; Add is disabled at 4 with the note "Four traits at most." | applied through the trait half of `edit.rs` `apply`, factored into `edit::apply_traits`: the new trait starts at `authored_trait_state`, kept traits keep their states, a capability raises its skill (`seed_from_capabilities`), and `LotEditState.revision` moves so trait caches refresh |
| [AP-e-job] | Job: No job, or any level of any path | `SetJob` | refusal 6 at work or commuting; 4 for an unknown row or shift | Through a new `careers::install_job(world, entity, row, shift)` that `assign_or_refuse` also calls: `attendance::close_for_career_change` settles a late-at-home open shift as an assignment does, then a fresh `Record::new` at the chosen level with the chosen shift, starting pay and job satisfaction 50. "No job" goes through the quit path. The shell sends the first shift the level offers, read from `admin_job_options` with no draw, since a level's standard shift may have weight 0; a level that offers no shift is listed but cannot be chosen. |
| [AP-e-shift] | Shift | `SetShift` | refusal 6; 4 for an unknown shift | Through `change_shift_or_refuse`'s core, so the change takes effect from the next day as the Career tab's does; the note "Takes effect tomorrow." shows under the select |
| [AP-e-pay] | Pay per shift | `SetPay` | the level's `pay` to `pay_max`, whole dollars; refusal 3 | |
| [AP-e-jsat] | Job satisfaction | `SetJobSatisfaction` | 0 to 100 | |
| [AP-e-good] | Good weeks in a row | `SetGoodWeeks` | 0 to the level's `advance_weeks`; refusal 3 | hint "{n} earns a promotion" ([AP-c-promote]) |
| [AP-e-poor] | Poor weeks in a row | `SetPoorWeeks` | 0 to `2 + ceil(1 / career_fire_base)` (15 at 0.08), the count at which firing becomes certain, held to the 100,000 weeks a save may hold; 0 to 2 (the warning count) when `career_fire_base` is 0; 0 to 100,000 when the base is so small that no count within that cap makes firing certain, since firing is still possible from 3 weeks | hint "2 brings a warning. 3 or more risk being fired." |
| [AP-e-search] | Job search | `SetJobSearch` | | the same `search_off` change as the Career tab, without counting a career command |

Career fields other than the job show only while the person has a job.

### [AP-e-rel] Relationships tab

The tab shows the picker and, for the chosen housemate A, one card per other living housemate B, in `SimId` order. Feelings toward people who have died are not shown: grief reads them and decay leaves them alone.

| Id | Control | Change sent | Range and validation | Notes |
| --- | --- | --- | --- | --- |
| [AP-e-feel] | {A}'s feeling about {B}; {B}'s feeling about {A} | `SetFeeling` | -1 to 1, two decimals; refusal 11 for oneself; 0 removes the entry, as decay does | band word from `people-panel.ts` |
| [AP-e-both] | Set both to 0 | two `SetFeeling` 0 | | one Undo step |
| [AP-e-allzero] | Set all of {A}'s feelings to 0 | `SetFeeling` 0 in both directions for every card | | replaces the mockup's household-wide "Set every feeling to 0" ([AP-c-relpicker]); disabled, with no reason text, as "Set to $0" is at $0, when every feeling it would set is already 0 or there is no other housemate, so it never adds an Undo step that changes nothing |
| [AP-e-fight] | {A} starts a fight | `StartFight` | refusal 11; 18 while either is at work or commuting | Appends the same fight order a player's talk order with the fighting row queues (`TalkTo` with `fight_index`), through the confirmed-order core so it is not held for a work-conflict confirmation: the click is the confirmation. It runs when play resumes. The topic is drawn when the fight begins, not at the drain ([AP-c-topic]). A full order queue is refused as 18 too, since the order would otherwise be dropped. Status: "The fight starts when the game resumes." |
| [AP-e-fought] | {A} had a fight. Ends in {duration}. End now | `EndTimedMoodlet` timer 1 | refusal 5 | shown when A's fight timer runs; the timer belongs to A alone ([AP-c-fight]) |

### [AP-e-house] Household tab

| Id | Control | Change sent | Range and validation | Notes |
| --- | --- | --- | --- | --- |
| [AP-e-funds] | Funds box | `SetFunds` | -$10,000,000,000.00 to $10,000,000,000.00; typed dollars parse to cents from the text, never through a float multiply; more than two decimals is refused in the box | negative funds are allowed, as the model allows |
| [AP-e-fundbtn] | Add $1,000; Subtract $1,000; Add $10,000 | `AdjustFunds` +100000, -100000, +1000000 | refusal 3 past the bound | amounts are view constants in `admin-household.ts` |
| [AP-e-zero] | Set to $0 | `SetFunds` 0 | | |
| [AP-e-amount] | A bill's Amount and Late fee | `SetBill` | amount $0.01 to the bound ([AP-c-amount]); late fee 0 to `late_fee_cap(bill)`; refusal 15 for a nonzero fee before `due_day + grace_days`, 16 above the cap, 13 when paid, 5 when missing | fields are disabled on a paid bill; the late fee is disabled with "No fee until Day {n}" before the grace ends |
| [AP-e-due] | A bill's Due | `MoveBill` | a month start under the bill's own `month_length`, at most today; refusal 14, 12, 13 | The select lists month starts from today's month back `admin_bill_due_months` months. `MoveBill` clears the bill's late fee itself when the new due day's grace has not yet passed, so the fee rule holds without a second edit on the same bill; the row shows the fee become 0. |
| [AP-e-paybill] | Pay from funds | `PayBill` | refusal 17 when funds are below amount plus fee; 13 when paid | Funds fall by the total and `paid_day` becomes today, then the record keeps only the last issued month's paid bills, as `bills::pay` does. Disabled with a reason when funds fall short. |
| [AP-e-free] | Mark paid, free | `MarkBillPaid` | 13 | as Pay from funds, Funds unchanged |
| [AP-e-del] | Delete | `DeleteBill` | 5 | Every bill edit leaves the record as the loader requires: a change that makes a later month the last issued drops the paid bills of earlier months, as Pay from funds does. |
| [AP-e-add] | New bill: kind, due, amount, late fee, Add bill | `AddBill` | refusal 12, 14, 15, 16 | Issued under the current terms (`BillTerms::of`), inserted in due-day then kind order. The due select offers the same month starts as [AP-e-due]; the amount box starts with that kind's amount this month (`month_amounts`); the late fee is disabled until the chosen due day's grace has passed. |
| [AP-e-nofees] | Remove all late fees | `SetBill` fee 0 on every unpaid bill with a fee | | hidden when no bill has a fee |
| [AP-e-allpaid] | Mark all paid, free | `MarkBillPaid` on every unpaid bill | | hidden when none is unpaid |
| [AP-e-skip] | Skip ahead by {n} hours, Skip | none | [AP-skip] | |

Below the bill table: "Next bills due: Day {n}, {Weekday}", "Late fee: {p}% a day after {g} days, up to {c}% of the bill", and "Unpaid bills are paid from funds automatically when the game resumes, oldest first, while funds cover them." The last sentence matters: `bills::pay` runs every tick, so a player who leaves a bill unpaid with enough funds sees it paid on the first tick after closing.

## [AP-undo] Undo

### [AP-undo-model] The session

`crates/terri-sim/src/admin.rs` (new) holds `AdminSession { baseline: SaveSnapshotV27, baseline_hash: u64, request_runtime, journal: Vec<AdminEntry> }` with `AdminEntry { change: AdminChange, hash_after: u64 }`. It mirrors `BuildTransaction`:

1. `Sim::begin_admin()` refuses while Build is active (and `begin_build` refuses while an admin session is active), flushes the queue, captures `save::v27::capture`, test-restores it exactly as `begin_build` does (a world that would not reload cannot open the panel), records `Sim::hash()` as `baseline_hash` and captures the social request runtime.
2. `Sim::end_admin()` drops the session. Every applied change stays in the world.
3. While a session is active, `Sim::tick` only flushes commands, as it does in Build, so no game time can pass under a baseline. The panel pauses the game anyway; this is the guard that makes the baseline's meaning mechanical.

### [AP-undo-restore] Undo

`Sim::admin_undo()`:

1. Refuses when the journal is empty.
2. Builds a candidate from the baseline with the same steps `restore_build` uses (`save::v27::restore`, copy the native feedback, restore the request runtime, `refresh_derived`). That body is factored into one helper both call, so Build and the panel restore identically.
3. Replays every journal entry but the last through the candidate's own stage-and-flush path, so maintenance (`seating`, `privacy`, the activity log's finish) runs exactly as it ran live. After each, it compares the candidate's hash with the entry's `hash_after`.
4. On any mismatch or refusal, discards the candidate, leaves the live world and journal untouched and returns an error; the panel shows "Undo failed. Your changes are kept." and disables Undo for the rest of the session. Tests prove this path is never reached by any shipped edit ([AP-tests-sim] item 5).
5. Otherwise installs the candidate (`ordinary::runtime::install`), pops the last entry and syncs the render buffer.

Undo steps back one change at a time, as far as the panel's opening. The world after Undo hashes equal to the world before the undone change. There is no Redo; the owner did not ask for one.

The shell keeps one label per journal entry ("Add $1,000", "Change Hunger") and checks its count against `admin_undo_depth()` after every call; a mismatch clears the labels and the button reads "Undo last change". Ctrl+Z or Cmd+Z inside the panel, outside a text or number field, presses Undo.

### [AP-undo-why] Why restore and replay

The alternative, an inverse command per edit, needs a hand-written exact inverse for every edit, including the ones with side effects: adding a capability raises a skill, a job change settles a late shift and pays it, paying an older bill drops it from the record. Each is a chance to leave a world that differs from the one before. Restore and replay has one mechanism, is already trusted by Build mode, and checks itself with a hash on every step. Its cost is one restore per Undo plus replaying a few small changes, which is negligible while paused.

Restoring rebuilds the world, so entity indices may change. Admin edits name `SimId`s for that reason. After Undo the shell runs the same refresh Build's Cancel runs: the roster, the selected person, the HUD panels and every entity-keyed shell cache. After every applied change, every Undo and every close, every HUD panel, the clock, funds and bills row included, reads the world at once rather than on its next periodic read. [T3] lists each cache it checked.

## [AP-skip] Skip ahead

1. **What it is.** Ordinary ticks, as many as `hours * 60`, run by the shell. The simulation does not change: the same `Sim::tick`, the same order, the same draws as playing at speed. Determinism holds because nothing else enters the queue while it runs (the panel is modal and its other controls are disabled).
2. **The session around it.** Skip calls `admin_end()` (the journal is discarded), runs the ticks, then `admin_begin()` with a new baseline. The shell clears its Undo labels. Skip is not undoable and ends the Undo history; the note beside Skip says so before the player presses it.
3. **Pace.** Each rendered frame runs up to `admin_skip_ticks_per_frame` ticks (shipped 300, the hidden-tab budget the frame loop already handles) through `frameSimulation.tick`, with footstep sampling off so per-tick audio events drain silently, then draws one frame and updates "Skipping: {h} of {n} hours." The activity log, notifications and autosave run per frame as usual; a skip across midnight autosaves as play would.
4. **Stopping.** Stop or Escape stops at the end of the current frame and keeps the hours already run. A housemate's death stops it at the end of that frame with "Stopped after {h} hours: {name} died." The panel then reopens its session.
5. **Limits.** 1 to `admin_skip_max_hours` (shipped 168, one in-game week), whole hours; the box clamps. The default is `admin_skip_default_hours` (8, as the mockup shows).
6. **While skipping** the panel's other controls are disabled, focus stays on Stop ([L-bed-pending-focus]), the pause pill reads "Skipping ahead", and Close is disabled until the skip stops.

## [AP-save] Saves and hashing

### [AP-save-schema] No new schema

The panel writes only fields every save already holds: needs, satisfaction, habituation, timers, affinities, skills, traits, careers and attendance, relationships, the queued fight order, funds and bills. The session, the journal and `AdminState` are not saved. No save records that the panel was used ([AP-owner] item 7). `SAVE_SCHEMA_VERSION` stays at main's 27 (the schema the needs mood balance added, issue 355) and no fixture or projection changes. The session baseline is a schema 27 snapshot, so Undo restores each person's need mood balance with the rest of the world.

### [AP-save-queue] An admin command never sits in a saved queue

A queued command must survive a save ([L-queued-commands-must-survive-save]), and `SavedCommand` is frozen, so a queueable admin command would need a schema 25 record. The plan avoids that by construction:

1. `admin_apply` stages the change and runs `flush_commands` in the same wasm call. JavaScript cannot run a save between the two.
2. `enqueue_command` refuses `Admin` bytes, so no other path can queue one.
3. `Sim::try_save_snapshot_v27`, the current save that the wasm `save_bytes` writes, returns `SaveError::AdminCommandQueued` rather than panicking if one is ever found, and a test proves the wasm path leaves the queue empty.

A save taken while the panel is open (the hidden-tab autosave, [L-live-verification-autosave]) holds the edits applied so far and no session. It loads as an ordinary game with the panel closed.

### [AP-save-hash] World hash

No hash block is added or changed; `Sim::hash` gains only the queue arm of [AP-cmd-wire] item 3, which no shipped run reaches. GOLDEN, `SHIPPED_THURSDAY`, `STANDARD_ONLY_HASH` and the published witnesses stay unchanged; the verification record confirms each. A test applies every edit kind and checks that each moves `Sim::hash` ([L-a-blind-digest-proves-false-equalities]). If any edited field turns out not to be hashed, stop: adding it to the hash moves pins and needs its own decision.

## [AP-tuning] Tuning

Four root knobs in `content/tuning.toml`, appended after `career_input_history_weeks`, and appended to the compiled `Tuning` in the same order. The data crate's schema, compile, error, pack, published-pack wire and pre-books expansion follow the commit that added `go_to_work_window_ticks`; `crates/terri-data/tests/fixtures/inherited-runtime.pack` is regenerated.

| Knob | Shipped | Range | Meaning | A pack published before it |
| --- | --- | --- | --- | --- |
| `admin_skip_max_hours` | 168 | 1 to 672 | The most hours one Skip ahead runs. | reconstructs 168 |
| `admin_skip_default_hours` | 8 | 1 to `admin_skip_max_hours` | The hours the Skip box starts with. | reconstructs 8 |
| `admin_skip_ticks_per_frame` | 300 | 1 to 1440 | Ticks run per rendered frame while skipping. | reconstructs 300 |
| `admin_bill_due_months` | 12 | 1 to 120 | How many billing months back the Due selects offer. | reconstructs 12 |

The funds buttons' amounts are labels of a view, as the review window's presets are, and live as named constants in `admin-household.ts`. `MAX_ADMIN_EDITS` and `MAX_ADMIN_FUNDS_CENTS` are representational bounds, not tuning.

## [AP-wasm] Wasm and bridge

`crates/terri-wasm/src/admin_exports.rs` (new, re-exported through `lib.rs`), with bridge methods in `web/src/bridge.ts`:

| Export | Returns | Bridge |
| --- | --- | --- |
| `admin_begin()` | 0 ok, 1 Build active, 2 would not reload, 3 already open | `adminBegin()` |
| `admin_end()` | | `adminEnd()` |
| `admin_apply(bytes)` | `[applied, edit index, refusal code, depth]` | `adminApply(change)`, encoding through `web/src/admin/codec.ts` |
| `admin_undo()` | 0 ok, 1 nothing to undo, 2 failed | `adminUndo()` |
| `admin_undo_depth()` | journal length | `adminUndoDepth()` |
| `admin_person(sim)` | needs, satisfaction, job fields: `[needs x7, satisfaction, career row or -1, shift, pay, job satisfaction, good, poor, search on, advance_weeks, pay min, pay max]`; empty for anyone but a living housemate | `adminPerson(sim)` |
| `admin_repetition(sim)` | `[object, row, value]` per entry | `adminRepetition(sim)`, labels through the existing action-row label read |
| `admin_moodlets(sim)` | `[source code, score, ends tick or -1]` per moodlet, with the label from the existing moodlet read | `adminMoodlets(sim)` ([AP-c-sources]) |
| `admin_timers(sim)` | `[timer code, ends tick]` per running timer | `adminTimers(sim)` |
| `admin_bills()` | `[due day, kind, amount, fee, paid day or -1, fee cap, overdue from]` per bill, then the due-day options | `adminBills()` |
| `skill_practice_for(skill, level, fraction)` | the practice `standing` reads back as that level and fraction | `skillPracticeFor(...)` |

Affinities, skills, traits, relationships and funds use the existing reads. Every read takes a `SimId` and copies typed arrays before any later call ([L72]). Refusal texts live in `web/src/admin/admin-words.ts`.

## [AP-web] The web panel

### [AP-web-files] Files

`web/src/admin/` (new): `admin-panel.ts` (dialog, header, tabs, picker, pause, Undo, focus), `admin-housemate.ts`, `admin-relationships.ts`, `admin-household.ts` (including Skip), `admin-words.ts` (labels, Undo labels, refusals), `codec.ts`, `admin-open.ts` (the tilde key and the long press). `web/src/ui/admin-panel.css` for styles. `web/index.html` gains `<dialog id="admin-panel" aria-labelledby="admin-panel-title">`. `main.ts` creates the panel once and closes it when a load, new game or import replaces the world.

### [AP-web-modal] Layout and the header

1. On a desktop-sized screen the dialog measures `min(1240px, 100vw - 48px)` by `min(820px, 100dvh - 48px)`, over the backdrop the review window uses (`rgba(0, 0, 0, .62)`). The header and the tab row stay fixed; the body scrolls.
2. Header, left to right: "Admin panel", the Cheat badge, the pause pill ("Game paused" with "Closing the panel resumes the game at {speed}." or "The game stays paused after you close the panel."), the hint "~ opens and closes" ([AP-c-hint]), Undo with its label, Close.
3. Tabs: Housemate, Relationships, Household, as a `role="tablist"` with arrow keys, Home and End. The picker shows under the tabs on Housemate and Relationships: one button per living housemate with `aria-pressed`, named "Housemate" as a group. Both tabs share one choice. It starts at the game's selected housemate, or the first by `SimId`, and never changes the game's selection.
4. Housemate tab: three columns as Mockup A (Needs, Life satisfaction, Repetition; Mood and moodlets, Likes and dislikes; Skills, Traits, Career). Relationships tab: the fight row for the chosen person, "Set all of {A}'s feelings to 0", then one card per other housemate as Mockup B. Household tab: Funds and Time at left, Bills at right as Mockup C.
5. Each control shows its value beside it and the range in its section heading, as the mockups do. A refusal appears in a status line under the section that sent it, with `role="status"`; success adds no message, since the changed value is visible.

### [AP-web-pause] Pause and restore

`open()` calls `overlayPause.suspend('admin-panel')`, then `adminBegin()`, then `showModal()`. If `adminBegin()` fails the panel shows its error in a small alert dialog and resumes. `close()` ends the skip if one runs, calls `adminEnd()`, `dialog.close()` and `overlayPause.resume('admin-panel')`. `OverlayPauseController` restores `chosenSpeed` when the last blocker leaves, which is exactly the speed before opening: paused stays paused, 1x, 2x and 3x resume as they were. The pill reads `selectedSpeed` at open. Pausing is shell time, as for the review window, so it adds nothing to the simulation.

### [AP-web-keys] The tilde key and the developer overlay

1. A document `keydown` listener in `admin-open.ts` toggles the panel on `event.key === '~'` and on no other key: only the tilde character opens the panel. It ignores repeats and Ctrl, Alt or Meta chords. Ctrl and Alt held together, or the `AltGraph` modifier state, count as AltGr rather than a chord, since German, Spanish and French Windows layouts type the tilde with AltGr and the browser reports it as Ctrl and Alt.
2. It does nothing to open the panel while Build mode is active (the command status line shows "Leave Build mode to open the admin panel."), while any other dialog is open (`dialog[open]`, `dialog:popover-open`), or while focus is in a text or number field outside the panel.
3. Inside the panel, tilde closes it from anywhere, including a number field, and calls `preventDefault` so no character is typed.
4. The developer overlay's listener (`main.ts` line 1173) adds `!event.shiftKey`, so Shift+Backquote no longer toggles it. The comment above it that says the key "collides with nothing" is corrected.
5. Escape closes the panel through the dialog's native `cancel`, except while skipping, when it stops the skip and keeps the panel open.

### [AP-web-touch] The long press on the bottom tile

1. The existing `LongPressGesture` in `input.ts` (500 ms, cancelled by a 5 px move, a second finger, lifting or `pointercancel`) already arms only for a first touch and only when not in Build mode. Its fire callback gains one check before opening the object menu: if `clientToTile` at the press's start point is `(lotWidth - 1, lotHeight - 1)`, the largest `x + y` on the lot and so its bottommost tile on screen, it opens the admin panel instead ([AP-q-occupied]).
2. It sets `menuOpeningPointer` exactly as the object menu does, so the click a phone sends after the hold is swallowed and cannot also select or order anything.
3. A tap on that tile (released before 500 ms) behaves as today. A drag or pinch starting there pans or zooms as today.
4. The lot size is read live (`adoptLotShape`), so the tile follows land purchases on the south and east sides; a purchase on the north or west moves every coordinate, and the formula still names the bottom tile.
5. Mouse input is unchanged: a desktop opens the panel with tilde.

### [AP-web-focus] Focus and keyboard

1. `showModal()` makes the page inert. Focus lands on the panel heading (`tabindex="-1"`) so a screen reader announces it. Tab order: Undo, Close, the tabs, the picker, the tab's content.
2. On close, focus returns to the element focused before opening when it is still connected, visible and enabled, else to the game canvas ([L-dialog-focus-visible-return]).
3. A control disabled by its own change moves focus to its section heading first ([L-bed-pending-focus]). After Undo, focus stays on Undo when it is still enabled, else moves to the active tab.
4. Sliders are native range inputs labelled by their row; each has its number box beside it with the same accessible name plus "value".

### [AP-web-phone] Phone layout

As the approved phone mockups: the dialog fills the screen; the header wraps the pill under the title; Undo reads only "Undo" with the full label as its accessible name and `title`; tabs and picker span the width; sections stack in one column; each slider sits under its label with the number box at the right; touch targets are 44 px under a coarse pointer. The bill table becomes one card per bill with the actions in a row under the fields. Breakpoint: `COMPACT_HUD_MEDIA_QUERY`.

## [AP-strings] Player-facing strings

Every string below is functional text proposed for the owner's review under the boundary in `docs/player-visible-strings.md` and [L58]. None is a joke. A new "Admin panel" row is added to that inventory, and the Help shortcut list (`web/src/ui/shortcuts.ts`) gains the tilde key. Ids are for review comments.

| Id | String | Where |
| --- | --- | --- |
| S-title | Admin panel; Cheat | header |
| S-pill | Game paused; Closing the panel resumes the game at {speed}.; The game stays paused after you close the panel.; Skipping ahead | header pill |
| S-hint | ~ opens and closes | header |
| S-undo | Undo; Undo: {change}; Undo last change; Nothing to undo; Undo failed. Your changes are kept. | header |
| S-close | Close | header |
| S-tabs | Housemate; Relationships; Household; Housemate (picker group name) | tabs |
| S-needs | Needs; 0 to 100; Fill {name}'s needs; At 0, Hunger and Energy count toward death. | Housemate |
| S-sat | Life satisfaction; Satisfaction | Housemate |
| S-rep | Repetition; 0 to {max}; Clear {name}'s repetition; Overdoing; Feeling sick; No repetition.; {n} overdoing (the folded phone summary) | Housemate |
| S-mood | Mood and moodlets; Mood {word}; {word}, {score} (the folded phone summary); Ends in {duration}; End now; End {name}'s timed moodlets; From job satisfaction; From {name}'s feeling about {other}; While a bill is overdue | Housemate ([AP-c-sources]) |
| S-likes | Likes and dislikes; -1 to 1 | Housemate |
| S-skills | Skills; Level 0 to {max} | Housemate |
| S-traits | Traits; improvement; how severe; No value to set; Remove; Choose a trait to add; Add; Four traits at most. | Housemate |
| S-career | Career; Job; No job; {path}: {title} (level {n} of {m}); Shift; {shift name}, {hh:mm} to {hh:mm}; Takes effect tomorrow.; Pay per shift; ${min} to ${max}; Job satisfaction; of 100; Good weeks in a row; {n} earns a promotion; Poor weeks in a row; 2 brings a warning. 3 or more risk being fired.; Job search; Looks for work on their own | Housemate |
| S-rel | {A} and {B}; {A}'s feeling about {B}; {A} starts a fight; Set both to 0; Set all of {A}'s feelings to 0; {A} had a fight. Ends in {duration}.; The fight starts when the game resumes. | Relationships |
| S-funds | Funds; Add $1,000; Subtract $1,000; Add $10,000; Set to $0; Use at most two decimal places. | Household |
| S-bills | Bills; Bill; Due; Amount; Late fee; Status; Day {n}, {Weekday}; Overdue; Due; No fee until Day {n}; Paid Day {n}; Pay from funds; Mark paid, free; Delete; Add bill; Remove all late fees; Mark all paid, free; No bills.; Next bills due: Day {n}, {Weekday}; Late fee: {p}% a day after {g} days, up to {c}% of the bill; Unpaid bills are paid from funds automatically when the game resumes, oldest first, while funds cover them.; Funds don't cover this bill. | Household |
| S-time | Time; Now; Day {n}, {Weekday}, {hh:mm}; Skip ahead by; hours; Skip; Stop; Skipping can't be undone, and it clears Undo.; Skipping: {h} of {n} hours.; Skipped {n} hours.; Stopped after {h} hours.; Stopped after {h} hours: {name} died. | Household |
| S-refuse | 1 The admin panel is closed.; 2 {name} is no longer in the household.; 3 That value is outside the allowed range.; 4 That option no longer exists.; 5 That has already ended or been removed.; 6 They are at work or on the way. Change the job when they are home.; 7 Four traits at most. Remove one first.; 8 They already have that trait.; 9 They don't have that trait.; 10 That trait has no value to set.; 11 Choose someone else.; 12 There is already a {kind} bill due that day.; 13 That bill is paid.; 14 Bills fall due on the first day of a billing month, today or earlier.; 15 A late fee starts only after Day {n}.; 16 The late fee can be at most ${cap}.; 17 Funds don't cover this bill.; 18 One of them is at work or on the way.; 99 That change could not be kept. Nothing was changed. | status lines |
| S-errors | The admin panel can't open: {reason}.; Leave Build mode to open the admin panel.; This game's state would not reload, so the admin panel can't open. | alert, command status |
| S-undolabels | Change {need}; Fill needs; Change life satisfaction; Change repetition: {action}; Clear repetition; End {moodlet}; End timed moodlets; Change liking for {kind}; Change {skill}; Change {trait}; Add {trait}; Remove {trait}; Change job; Change shift; Change pay; Change job satisfaction; Change good weeks; Change poor weeks; Turn job search on; Turn job search off; Change {A}'s feeling about {B}; Set both feelings to 0; Set {A}'s feelings to 0; Start a fight; Change funds; Add $1,000; Subtract $1,000; Add $10,000; Set funds to $0; Change {kind} bill; Move {kind} bill; Pay {kind} bill; Mark {kind} bill paid; Delete {kind} bill; Add {kind} bill; Remove late fees; Mark all bills paid | Undo button |
| S-help | ~ : Open or close the admin panel; Touch: hold the lot's bottom corner tile | Help shortcuts |

Existing labels are reused unchanged: need names, satisfaction and mood band words, affinity words, relationship bands, skill labels, trait labels, career titles and shift names, bill kinds.

## [AP-tests] Tests

Each test names its invariant, and each load-bearing one is broken on purpose and seen to fail before it is trusted (testing protocol rules 1, 5 and 6).

### [AP-tests-core] Rust, `terri-core` and `terri-data`

1. `admin.rs`: every `AdminEdit` and code 41 match the shared byte fixture; `[41, ...]` fails to decode as `SavedCommand`; the saved-command table stays frozen.
2. Admission: each structural refusal of [AP-cmd-admit], including non-finite values in every float field, overlapping units and an empty or oversized change.
3. Knobs: each knob's range refusal by name, the shipped values, published-pack and pre-books reconstruction, the regenerated inherited-runtime fixture.

### [AP-tests-sim] Rust, `terri-sim` (`admin_tests.rs`, new)

1. **Each edit** applies, and refuses each of its listed refusal codes from a built world, leaving the hash unchanged on refusal. Edge values at both ends of every range apply; one step past is refused.
2. **Atomic change:** a change whose third edit is refused changes nothing.
3. **Every edit kind survives a save:** after each kind, `try_save_snapshot_v27` then `load_snapshot_v27` succeeds and the hash after load equals the hash before. Break one post-condition (let `AddBill` accept a future due day) and see this test fail at the load, which proves the post-condition is what prevents it.
4. **Every edit kind moves `Sim::hash`.**
5. **Undo:** a fixed sequence of 20 changes touching every edit kind, then 20 Undos; after each Undo the hash equals the hash recorded before that change, and the last equals `baseline_hash`. Separate cases: Undo after adding a capability restores the skill's practice; after a job change restores the record, the attendance register and Funds (a late-at-home shift settled and paid); after Pay from funds on an older month's bill restores the bill and Funds; after `StartFight` removes the queued order.
6. **Undo detects a bad replay:** corrupt one journal entry's `hash_after`; Undo returns the failure and the live world and journal are unchanged.
7. **The session's guards:** `tick` advances no clock while a session is active; `begin_admin` refuses in Build and `begin_build` refuses during a session; an edit with no session is refused with 1.
8. **Saved queue:** `capture_command` returns `AdminCommandQueued` for a forced admin command; a save taken mid-session holds the edits and no session, reloads, and continues with the same hash on every following tick for one game day.
9. **Determinism:** two worlds given the same changes hash equal; every random stream's draw count is unchanged by every edit that settles no open shift; a world with edits applied, saved and reloaded continues identically to the live one for two game days ([L5]: across a save boundary, not twice in one process).
10. **Career cases:** job change refused at work and commuting; a late-at-home open shift settles; any level of any path installs with the level's starting pay; Shift takes effect the next day; pay, good weeks and poor weeks bounds from content.
11. **Bills cases:** due day must be a month start at or before today; duplicate key; fee before grace; fee over cap; paid bills refuse edits; paying an older month drops it; Mark all paid and Remove all late fees; Behind on bills ends when nothing is overdue; funds bound.
12. **Relationship cases:** self refused; 0 removes the entry; a dead person refused; `StartFight` queues the fight order and the fight begins on the first tick after resume, drawing its topic then.
13. **Pins:** GOLDEN and the shipped hashes are unchanged.
14. **Need mood (issue 355, `admin_need_mood_tests.rs`):** with a balance on every person, a need set to 0, a need set low above 0 and Fill needs each keep every balance, save at schema 27 and reload with the same hash; Undo after them restores each hash and balance; after the panel closes an emptied need charges the balance on the next minute and a reloaded twin continues identically; a balance no load accepts fails the post-condition as 99 and the last good world comes back. A job change and a shift change that settle a late shift do the same in `admin_career_tests.rs`.

### [AP-tests-wasm] Wasm boundary (`crates/terri-wasm/src/admin_boundary_tests.rs`, new)

1. The shared fixture's bytes decode through `admin_apply` to the same changes; each read's layout; empty reads for a non-person.
2. `admin_apply` leaves the queue empty; `enqueue_command` refuses admin bytes.
3. A release-wasm run: open, apply one edit of each tab, Undo twice, close, save through the wasm save path, reload, compare hashes.

### [AP-tests-web] Web (vitest)

1. `admin-codec.test.ts`: every edit encodes to the shared fixture's bytes; dollars text parses to exact cents ("2318.40", "-0.01", "1e3" refused, three decimals refused).
2. `admin-panel.test.ts`: open and close restore each of paused, 1x, 2x and 3x through a fake `OverlayPauseController`; Escape, Close and tilde all resume once; `adminBegin` failure resumes; focus lands on the heading and returns to the opener or the canvas; the Undo label stack, its disabled state, the depth cross-check and Ctrl+Z; sliders commit on `change` and never on `input`; refusal text in the right status line.
3. `admin-housemate.test.ts`, `admin-relationships.test.ts`, `admin-household.test.ts`: each control sends the change of [AP-edits]; the picker is shared by both tabs and starts at the game's selection; capability rows send `SetSkillPractice`; Add disabled at four traits; bill fields disabled when paid and fees before grace; the due select's options; Skip runs `hours * 60` ticks across frames at the knob's budget, Stop and Escape stop at a frame boundary, a death stops it, and Undo is cleared.
4. `admin-open.test.ts`: tilde opens and closes, including an AltGr tilde; Backquote without Shift toggles only the debug overlay, and an AltGr tilde never toggles it; ignored in Build (with the status text), with another dialog open, with a Ctrl, Alt or Meta chord, and in a text field outside the panel.
5. `input.test.ts`: a 500 ms hold on the bottom tile opens the panel and swallows the following click; the same hold on any other tile opens the object menu; a tap on the bottom tile selects as before; the gesture is not armed in Build; the tile follows a lot resize.
6. `admin-layout.test.ts` and `mobile-hud.test.ts`: the dialog bounds on desktop; full-screen phone layout; 44 px targets under a coarse pointer; header controls fit at 601, 800 and 1280 px with doubled text ([L-clipped-headers-need-field-bounds]).

### [AP-tests-played] Played visual pass (testing protocol section 9)

Play the built game in a displayed, muted browser on a task-owned preview port, closed in a `finally` block when done. Use a game a few days in with three housemates, a job, an overdue bill, a running fight timer and some repetition, loaded from a save written by the browser save writer. Watch every mechanic happen in the game, not in a counter: needs bars change on the HUD, a removed trait disappears from the Traits tab, a started fight plays out after resume, Pay from funds lowers the household funds display, Skip ahead runs visibly and the clock lands where it should, and closing restores the speed chosen before opening (test once each at paused, 1x and 3x). Inspect every capture at full resolution, record findings per file in `docs/alpha-feel-notes.md`, and give a fresh reviewer (`first-use-review` on a T2 or T3 model) the captures and one sentence about the player's goal, without explaining the controls.

Screenshots, desktop at 1440 by 900 and phone at 390 by 844, each with Light: auto by day and by night:

1. Housemate tab with a condition, a capability and a disposition worn, a timed moodlet and repetition above 1 (matches Mockup A).
2. Relationships tab with the picker on each of two people, and the fight row (Mockup B with the owner's change).
3. Household tab with an overdue bill, a bill in its grace days and a paid bill (Mockup C).
4. Undo's label after three changes, and after Undo.
5. A refusal status line (Add at four traits; Pay from funds short).
6. Skip ahead in progress, and its result line.
7. The panel opened by a long press on a touch emulation, over the lot with its bottom tile visible.
8. The game paused before opening, after closing (the pill's stays-paused text).
9. Each phone tab scrolled to its end.

## [AP-docs] Player guide and changelog

1. `docs/player/ui-elements.md`: a new `#admin-panel` section covering opening (tilde; holding the bottom corner tile on a touch screen), the pause and what closing restores, each tab, Undo and its limit at Skip ahead, and that changes are saved with the game.
2. `docs/player/home-and-controls.md`: the tilde key and the touch hold in the controls list. `docs/player/quick-help.md` if it lists shortcuts.
3. `docs/player/needs.md`, `relationships.md` and `the-world.md` (bills): one sentence each pointing to the admin panel, only where the article tells the player how to change that value.
4. Screenshots in `docs/player/screenshots.json`: `admin-housemate`, `admin-relationships`, `admin-household` (desktop and mobile), with a new source snapshot. Run the guide build and its tests.
5. `docs/player-visible-strings.md`: the Admin panel row ([AP-strings]).
6. Changelog: `docs/player/changelog/{delivery date}-admin-panel.md`, or bullets added to that date's entry when one exists, following `.agents/skills/maintain-changelog/SKILL.md`. Draft:

```markdown
# The admin panel

Change housemates, feelings, funds and bills directly while the game waits.

## New
- Press ~ to open the admin panel. On a touch screen, hold the lot's bottom corner tile. The game pauses while it is open and goes back to the speed you had when you close it.
- Set a housemate's needs, life satisfaction, likes, skills, traits, repetition and job details, and end timed moodlets such as Promoted or Burnt dinner.
- Set how housemates feel about each other, or have one start a fight.
- Set the household's funds, and edit, pay, add or delete bills.
- Skip ahead a number of hours.
- Undo steps back through every change since you opened the panel, except Skip ahead. Changes are saved with your game.
```

7. Internal docs: `docs/FEATURES.md`, `docs/ARCHITECTURE.md` (the admin session beside the Build transaction, and that an admin command never sits in a saved queue), `docs/GAME-SYSTEMS.md`, `docs/glossary.md` (admin session), and a verification record `docs/specs/2026-11-20-admin-panel-verification.md` holding the gate results and the unchanged pins.

## [AP-conflicts] Mockup and model conflicts

1. **[AP-c-hint] The header hint.** The mockups show "` or ~ opens and closes". The owner then kept backtick for the developer overlay, so the hint reads "~ opens and closes".
2. **[AP-c-relpicker] Every pair.** Mockup B lists every pair and a household-wide "Set every feeling to 0". The owner's change scopes the tab to the chosen housemate; the button becomes "Set all of {A}'s feelings to 0".
3. **[AP-c-fight] "Active fight: Tim and Casey".** `Fights.timers` holds one timer per person with no partner; "Had a fight" is each person's own moodlet. The pair cannot be named. The tab shows the chosen person's own timer instead ([AP-e-fought]), and the Housemate tab's timed moodlets include it.
4. **[AP-c-topic] "Topic code 26".** `notes.md` says the panel's fight uses topic 26, "a fight the player started with no reason". That code is written only under the published fight rules. Under the current rules a player's fight with no grievance draws a topic when the fight begins. The panel queues the same order a player's fight order queues, so the topic follows whichever rules are in force.
5. **[AP-c-future] "Day 106" in the new-bill row.** A bill's due day must be a billing month start at or before today: bills are issued on that day, and an added future bill would collide with the one the game issues. The due select offers past and current month starts only.
6. **[AP-c-amount] Bill amount "0 up".** The loader refuses a bill of 0 cents, so the minimum is $0.01. To remove a bill, Delete it.
7. **[AP-c-capability] "Can't cook 35, how far learned".** The Traits panel shows a capability's linked skill mastery, not its trait state, and nothing reads the state once worn. Editing the state would change nothing visible. The row edits the linked skill instead, so it and the Skills row always agree.
8. **[AP-c-promote] "3 earns a promotion".** Reaching `advance_weeks` good weeks only makes a promotion possible at the next review, weighted by the score. Owner ruling 2026-11-19: the short hint "{n} earns a promotion" stays as written; it states the goal for the counter, and the panel does not need to explain the review weighting.
9. **[AP-c-sources] Moodlet sources.** Mockup A explains derived moodlets ("From Energy below 40"). The existing moodlet read has labels and scores but no source. `admin_moodlets` adds a source code per moodlet from where `mood.rs` builds it; moodlets whose source has no short explanation show none. Since needs affect mood over time (issue 355), no moodlet comes from a need below a band: the single "Mood from needs" moodlet replaces them, its label already names its source, so it shows none, and the need source codes 10 to 26 are no longer sent.
10. **[AP-c-mood] Mood cannot be set**, as `notes.md` records: it is derived from needs, feelings, traits, the job, bills and timed events. It stays read only.
11. **[AP-c-undo] Undo's mechanism.** `notes.md` proposes keeping a snapshot of each field before each change. The plan keeps one baseline and replays the journal ([AP-undo-why]), which gives the same behavior with one checked mechanism.
12. **[AP-c-badge] The Cheat badge** is approved and stays, but nothing records cheating in the save ([AP-owner] item 7).

## [AP-questions] Open questions

1. **[AP-q-occupied] What if a person or an object is on the bottom tile when it is held?** The owner's rule names the tile, and a long press there opens the object or person menu today. Recommended: the panel always wins on that tile. People move off it within moments, the tile sits on the street edge where furniture is rare, and a rule with exceptions would make the panel unreachable by touch whenever a plant stands there. An object on that tile keeps its menu from any other tile it covers; a one-tile object there loses its touch menu, which the guide notes.
2. **[AP-q-discover] Should Options list the admin panel for keyboards without an easy tilde?** Accepting Shift with the key left of 1 covers most layouts. Recommended: no Options entry; the Help shortcut list and the player guide name both routes, and the panel stays out of the way of players who never look for it.

## [AP-tasks] Task breakdown

Take them in order; each ends with its tests passing locally and the tree clean. Tiers follow the global table: Sonnet (T3) for well-defined pieces, Opus (T2) where the command, Undo or career and attendance rules make mistakes costly.

| Task | Files | Tests | Done means | Tier |
| --- | --- | --- | --- | --- |
| [T1] Knobs | `content/tuning.toml`, `crates/terri-data/src/{schema,compile,error,pack,lib,published_pack_wire}.rs`, `build_pre_books.rs`, inherited-runtime fixture, `terri-sim/src/test_content.rs` | data crate knob tests | four knobs compile, refuse out of range, reconstruct in old packs | Sonnet |
| [T2] Wire and admission | `terri-core/src/{admin,command,lib}.rs`, shared fixture, `terri-sim/src/{lib,save}.rs` (queue arm, `AdminCommandQueued`), `systems/{command,lot_edit}.rs`, `build_transaction/commands.rs`, `terri-wasm` `enqueue_command` gate | [AP-tests-core] items 1 and 2 | code 41 and every edit code pinned; ordinary queue refuses admin bytes; capture refuses without panicking | Opus |
| [T3] Session and Undo | `terri-sim/src/admin.rs` (session, drain entry, journal, `admin_undo`), `build_transaction.rs` (shared restore helper, mutual refusal), `lib.rs` (`tick` guard) | [AP-tests-sim] items 2, 5 (with a stub edit), 6, 7, 8 | Undo exact by hash on every step; Build tests unchanged | Opus |
| [T4] Housemate edits | `admin.rs` edit modules for needs, satisfaction, repetition, timers, affinities, skills, traits; `edit.rs` (`apply_traits`), save validators factored out | [AP-tests-sim] items 1, 3, 4 for these kinds | every row of [AP-e-housemate] except career | Sonnet |
| [T5] Career edits | `careers.rs` (`install_job`, shift core, bounds), `attendance.rs` if the settle path needs a hook | items 1, 3, 4, 5 (job case), 10 | refusals and attendance consistency proven; mutations seen failing | Opus |
| [T6] Relationship edits | `admin.rs` feelings and fight; the confirmed-order core in `systems/command.rs` | items 1, 3, 4, 12 | feelings and fights per [AP-e-rel] | Sonnet |
| [T7] Household edits | `admin.rs` funds and bills; `bills.rs` (retention helper shared with `pay`) | items 1, 3, 4, 5 (bill case), 11 | every bill rule enforced by refusal and by the post-condition | Sonnet, Opus review |
| [T8] Wasm and bridge | `terri-wasm/src/admin_exports.rs`, `admin_boundary_tests.rs`, `web/src/bridge.ts`, `web/src/admin/codec.ts` | [AP-tests-wasm], `admin-codec.test.ts` | exports, reads, codec against the shared fixture | Sonnet |
| [T9] Panel shell | `admin-panel.ts`, `admin-words.ts`, `admin-panel.css`, `index.html`, `main.ts` | `admin-panel.test.ts` | pause and restore, tabs, shared picker, Undo, focus | Sonnet, Opus review |
| [T10] Housemate tab | `admin-housemate.ts` | `admin-housemate.test.ts` | Mockup A with [AP-conflicts] applied | Sonnet |
| [T11] Relationships tab | `admin-relationships.ts` | `admin-relationships.test.ts` | Mockup B with the picker | Sonnet |
| [T12] Household tab and Skip | `admin-household.ts`, `main.ts` (skip frame path) | `admin-household.test.ts` | Mockup C, Skip per [AP-skip] | Sonnet |
| [T13] Opening routes | `admin-open.ts`, `input.ts`, `main.ts` (debug overlay Shift guard), `ui/shortcuts.ts` | `admin-open.test.ts`, `input.test.ts` | tilde, long press, overlay unchanged without Shift | Sonnet |
| [T14] Phone layout | `admin-panel.css` | `admin-layout.test.ts`, `mobile-hud.test.ts` | approved phone mockups | Sonnet |
| [T15] Strings, guide, changelog | `docs/player-visible-strings.md`, `docs/player/*.md`, `screenshots.json`, images, changelog file, internal docs | guide build and tests, `node --test scripts/build-changelog.test.mjs`, `node scripts/build-changelog.mjs` | [AP-docs] complete | Sonnet |
| [T16] Played pass and review | evidence under `docs/assets/review-evidence/admin-panel/` (stills only) | [AP-tests-played], `first-use-review`, independent code review of the full diff | findings resolved or recorded with reasons | Opus coordinating |
| [T17] Final gate | verification record | `py -3 -B scripts/check-local-ci.py run` on the final head | pins confirmed unchanged; owner-facing report | Opus |
