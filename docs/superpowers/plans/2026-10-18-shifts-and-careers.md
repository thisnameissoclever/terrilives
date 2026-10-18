# Shifts and Careers Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for the tightly coupled simulation and save changes. Obtain a fresh independent review before delivery. The checkboxes describe future implementation work.

**Goal:** Give every job a chance of early, day, late or night shifts by content weights, add five career paths, make night workers sleep by day, and save each person's held shift, as the spec defines.

**Architecture:** The content compiler adds path shifts and level weights to the compiled career rows. The simulation draws a shift from a new seeded stream at each hire and holds it in the person's career record; every reader of a job's hours asks one function for the held shift. The sleep drive adds a per-kind offset. Schema nineteen saves the held shifts on top of schema eighteen. The shell names the shift and shows the chances before assigning.

**Tech stack:** Rust (`terri-core`, `terri-data`, `terri-sim`, `terri-wasm`), TOML content, TypeScript shell with Vitest. No dependency changes.

**Spec:** [Shifts and more career paths](../../specs/2026-10-18-shifts-and-careers.md). Read it whole before starting; section ids such as [WS-choose] below refer to it.

## Contents

- [Global constraints](#global-constraints)
- [Task 1: Start from a main that holds schema eighteen](#task-1-start-from-a-main-that-holds-schema-eighteen)
- [Task 2: Compile path shifts and level weights](#task-2-compile-path-shifts-and-level-weights)
- [Task 3: Ship the shifts and the five new paths](#task-3-ship-the-shifts-and-the-five-new-paths)
- [Task 4: Draw and hold a shift](#task-4-draw-and-hold-a-shift)
- [Task 5: Read the held shift wherever hours are read](#task-5-read-the-held-shift-wherever-hours-are-read)
- [Task 6: Shift the sleep drive by shift kind](#task-6-shift-the-sleep-drive-by-shift-kind)
- [Task 7: Hash and save the held shifts in schema nineteen](#task-7-hash-and-save-the-held-shifts-in-schema-nineteen)
- [Task 8: Export shifts across the boundary](#task-8-export-shifts-across-the-boundary)
- [Task 9: Show the shift in the shell and save version nineteen](#task-9-show-the-shift-in-the-shell-and-save-version-nineteen)
- [Task 10: Measure sleep, waiting and cost with the trace](#task-10-measure-sleep-waiting-and-cost-with-the-trace)
- [Task 11: Update documentation and the changelog](#task-11-update-documentation-and-the-changelog)
- [Task 12: Run the full local checks](#task-12-run-the-full-local-checks)
- [Task 13: Play the build and obtain a visual review](#task-13-play-the-build-and-obtain-a-visual-review)

## Global constraints

1. Every number, threshold and weight lives in `content/careers.toml` or `content/tuning.toml`; none is written into code.
2. Randomness comes only from the shift stream of [WS-determinism]. Never draw the careers stream or the world's `SimRng` for a shift.
3. Run Rust tests with `-- --test-threads=1` and Vitest with `--maxWorkers=1`. Do not overlap heavy builds and tests. Save long output to `.local-build/logs/<step>.log` and report each command's exit code with a bounded digest.
4. Scripted edits write LF line endings. After each scripted edit, check with `git ls-files --eol` that touched files report `i/lf w/lf`.
5. Keep player-visible strings plain. Path labels and titles stay proposed for the owner per [L58] until approved.
6. Before a pull request leaves draft, a fresh adversarial review by subagents covers the exact final head, and every valid finding is resolved and recorded.
7. Do not commit videos. Close task-owned browser pages and preview servers when a check ends.

## Task 1: Start from a main that holds schema eighteen

**Files:** none changed.

1. [ ] Check whether pull request 303 has merged with `gh pr view 303 --repo thisnameissoclever/terrilives --json state,mergeCommit`. If it is not `MERGED`, stop and coordinate with its owner; this work does not take schema eighteen ([WS-save]).
2. [ ] Run `git fetch origin` and `git merge origin/main` on `twcl/296-shifts-and-careers`. Confirm `crates/terri-core/src/save_v18.rs` exists and `SAVE_SCHEMA_VERSION` is 18.
3. [ ] Check free space with `Get-PSDrive -PSProvider FileSystem`; keep at least 30 GB free on the volume holding `target/`.
4. [ ] In `web/`, run `npm ci`, then from the repository root run `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, because a new worktree's ignored wasm can be stale.
5. [ ] Record the baseline: `cargo test --workspace -- --test-threads=1` saved to `.local-build/logs/baseline-cargo.log`, and the median of three `Measure-Command { cargo run --release -p terri-sim --example trace -- 12000 }` runs.

**Done when:** the branch contains main with schema eighteen, the baseline passes, and the baseline trace time is recorded in `.local-build/work-queue.md`.

## Task 2: Compile path shifts and level weights

**Files:** `crates/terri-data/src/schema.rs` (`CareerDef`, `CareerLevelDef`, new `CareerShiftDef`, `SHIFT_KIND_NAMES`), `crates/terri-data/src/pack.rs` (`CompiledShift`, appended `CompiledCareer` fields, `ShiftView`, methods), `crates/terri-data/src/compile.rs` (`compile_careers`), `crates/terri-data/src/error.rs` (new refusals), `crates/terri-data/src/published_pack_wire.rs` (`career_from_published`, published tuning defaults), the tuning schema and compiler for the four `shift_sleep_offset_*` knobs, and every `CompiledCareer` literal found by `rg "CompiledCareer \{" crates`.

**Interfaces:** `CareerDef.standard_shift: String` defaulting to `"day"`; `CareerDef.shift: Vec<CareerShiftDef>` defaulting to empty; `CareerLevelDef.shift_weights: Option<BTreeMap<String, u32>>`. `CompiledCareer` appends `standard_kind: u8`, `standard_weight: u32`, `shifts: Vec<CompiledShift>`. Add `CompiledCareer::shift_count(&self) -> usize`, `shift(&self, index: usize) -> Option<ShiftView<'_>>` (index 0 the standard), `shift_index(&self, id: &str) -> Option<usize>`, and `works_on` on `ShiftView`. Constants `SHIFT_DAY = 0`, `SHIFT_EARLY = 1`, `SHIFT_LATE = 2`, `SHIFT_NIGHT = 3`.

1. [ ] Write the failing compiler tests in `compile.rs`: `compiles_a_level_without_weights_to_its_standard_shift_alone`, `compiles_path_shifts_and_level_weights_in_authored_order`, `rejects_each_bad_shift_and_weight` (unknown kind, duplicate id, reserved id `standard`, weight key naming no shift, weight 1001, all weights 0, start at `day_ticks`, length 0, length `day_ticks`, empty, repeated and unknown day names), and `rejects_shift_sleep_offsets_outside_their_range` (-721 and 721 refused, -720 and 720 accepted).
2. [ ] Write `a_published_career_converts_to_a_day_standard_shift_alone` beside the published converter's tests, and `shift_index_zero_is_the_level_standard_shift` in `pack.rs`.
3. [ ] Run `cargo test -p terri-data shift -- --test-threads=1` and confirm the new tests fail on assertions, not on compile errors in unrelated code.
4. [ ] Implement the schema, compiled types, validation and published conversion. Add the four tuning knobs after `career_mood_fired_ticks` with `SHIPPED_SHIFT_SLEEP_OFFSET_*` constants for published packs.
5. [ ] Update every hand-built `CompiledCareer` with `standard_kind: 0`, `standard_weight: 1`, `shifts: Vec::new()`. Prefer one test helper over repeated literals where a file builds several.
6. [ ] Run `cargo test -p terri-data -- --test-threads=1`, then `cargo test -p terri-data --test content_hierarchy -- --test-threads=1` to confirm the content fingerprint constant is unchanged.

**Done when:** the new tests pass, every existing `terri-data` test passes unchanged, and `cargo clippy -p terri-data --all-targets -- -D warnings` is clean.

## Task 3: Ship the shifts and the five new paths

**Files:** `content/careers.toml`, `content/tuning.toml`, `crates/terri-data/src/lib.rs` (shipped-content tests).

1. [ ] Write the failing tests in `crates/terri-data/src/lib.rs`: `the_shipped_careers_hold_eight_paths_with_the_first_twelve_rows_unchanged` (ids, titles, standard times and pay of rows 0 to 11 equal today's; 32 rows; path order office, cafe, night watch, hospital, warehouse, library, restaurant kitchen, buses), `the_shipped_shift_weights_match_the_spec` (each path's shifts, kinds, times, days and weights from the table in [WS-content]), `the_shipped_shift_sleep_offsets_match_the_spec` (0, -60, 120, 660), and `three_random_housemates_rarely_share_a_schedule`.
2. [ ] Implement `three_random_housemates_rarely_share_a_schedule` with exact rational arithmetic over each path's first level: merge identical (start, length, days) schedules across paths, sum each schedule's probability cubed, assert the result equals 2441/512000, and assert it is at most 1/100. Print the value with `eprintln!` for the verification record.
3. [ ] Edit `content/careers.toml`: add `standard_shift`, `[[career.shift]]` entries and `shift_weights` to the three existing paths without changing any existing field, then append the five new paths with the ids, titles and numbers of [WS-content]. Update the header comment to describe shifts, the weight rule and the never-delete-a-shift-id rule, and keep the [L58] note.
4. [ ] Append the four offsets to `content/tuning.toml` after `career_mood_fired_ticks`, each with a one-line comment.
5. [ ] Run `cargo test -p terri-data -- --test-threads=1` and `cargo test -p terri-data --test content_hierarchy -- --test-threads=1`.

**Done when:** the shipped pack compiles, the four tests pass, and the content fingerprint is unchanged.

## Task 4: Draw and hold a shift

**Files:** new `crates/terri-sim/src/shifts.rs` (draw, keep-or-draw, `shift_of`), `crates/terri-sim/src/careers.rs` (`Record.shift: u32`, the shift stream and draw count on `Careers`, `is_pristine`, `forget`, hire sites in `search`, `assign_or_refuse`, `review_person`), `crates/terri-sim/src/lib.rs` (module registration), new `crates/terri-sim/src/shift_tests.rs` registered from `shifts.rs`.

**Interfaces:** `Careers` gains `shift_rng: SimRng` seeded from `SHIFTS_SEED = 0x5348_4946_5453_3031` and `shift_draws: u64`. `Record` gains `shift: u32`, an index into the held row's shifts, 0 for the standard; `Record::new` keeps 0. Add `shifts::draw(careers: &mut Careers, job: &CompiledCareer) -> u32`, `shifts::keep_or_draw(careers: &mut Careers, from: &CompiledCareer, held: u32, to: &CompiledCareer) -> u32`, and `pub fn shift_of<'a>(world: &World, pack: &'a ContentPack, entity: Entity) -> Option<ShiftView<'a>>`.

1. [ ] Write the failing tests in `shift_tests.rs`: `the_household_worker_holds_the_standard_shift_without_a_draw`, `a_search_hire_draws_one_shift_and_holds_the_pinned_result`, `an_assigned_path_draws_one_shift_and_holds_the_pinned_result`, `a_change_of_path_draws_from_the_new_level`, `a_level_with_one_possible_shift_draws_nothing`, `a_promotion_keeps_an_offered_shift_and_draws_otherwise`, `shift_draws_follow_the_weights` (10,000 draws on a fixture level weighted 5, 3, 2; each share within 1.5 percentage points), `the_careers_stream_draws_the_same_numbers_with_shifts_present` (the careers stream's state and draw count after a review and a search equal a run on the same fixture without alternatives), and `a_death_drops_the_held_shift`. Pin exact shifts and draw counts, per [L5].
2. [ ] Run `cargo test -p terri-sim shift_tests -- --test-threads=1`; confirm assertion failures.
3. [ ] Implement the draw of [WS-choose] step 5 with `SimRng::range(total)`, skipping the draw when one weight is positive. Call it at the search hire, the assign command and the path change; call `keep_or_draw` at promotion and demotion before inserting the new `Career`.
4. [ ] Run `cargo test -p terri-sim careers -- --test-threads=1` and `cargo test -p terri-sim shift_tests -- --test-threads=1`.

**Done when:** the new tests pass and every existing careers test passes; any changed expectation is listed in the work queue with its cause.

## Task 5: Read the held shift wherever hours are read

**Files:** `crates/terri-sim/src/attendance.rs` (`start_tick`, `work_conflicts`, the saved-attendance validator), `crates/terri-sim/src/systems/career.rs` (`works_today` takes a `ShiftView`), `crates/terri-sim/src/reading/persistence.rs` (`PendingShift` validation), `crates/terri-sim/src/portals.rs` (door window), `crates/terri-sim/src/lib.rs` (`career_definition_of` callers and a new `Sim::career_shift_of`), and tests in `attendance_tests.rs`, `systems/career.rs` and `portals.rs`.

1. [ ] Write the failing tests: `a_held_late_shift_starts_registers_and_ends_on_its_own_times`, `the_preflight_reports_the_held_shifts_hours`, `a_saved_scheduled_shift_under_a_previous_shift_still_validates`, `a_pending_shift_is_validated_against_the_held_shift`, `the_door_window_follows_the_held_shift_length`, `a_sunday_night_shift_counts_in_the_ending_week_and_its_review_waits`, and `a_hire_at_the_search_tick_starts_a_shift_due_that_tick`.
2. [ ] Replace each read of `job.shift_start`, `job.shift_ticks` and `job.works_on` in the listed production files with `shifts::shift_of`. Confirm none remain with `rg -n "\.shift_start|\.shift_ticks|works_on\(" crates/terri-sim/src --glob '!*test*'` and review each hit.
3. [ ] Make the saved-attendance validator accept a scheduled shift that matches any shift of its row, per [WS-systems] item 3.
4. [ ] Run `cargo test -p terri-sim attendance -- --test-threads=1`, `cargo test -p terri-sim career -- --test-threads=1`, `cargo test -p terri-sim reading -- --test-threads=1` and `cargo test -p terri-sim portals -- --test-threads=1`.

**Done when:** the seven tests pass and every existing attendance, street, edit, bed, reservation and reading test passes unchanged.

## Task 6: Shift the sleep drive by shift kind

**Files:** `crates/terri-sim/src/systems/action.rs` (`select_action`), new `ShiftRhythm` system parameter in `crates/terri-sim/src/shifts.rs`, tests in `crates/terri-sim/src/systems/circadian.rs` or `shift_tests.rs`.

1. [ ] Write the failing tests: `a_night_shift_moves_the_beds_appeal_to_the_morning` (for a night worker the bed's scale at 10:00 exceeds that at 22:00), `a_day_shift_leaves_the_sleep_drive_unchanged` (scale equal to a person without a job at the same ticks), and `the_offset_holds_on_days_off`.
2. [ ] Add `ShiftRhythm`, a `SystemParam` reading `Option<Res<Careers>>`, `Res<Content>` and `Query<(&SimId, &Career)>`, with `fn offset(&self, entity: Entity) -> i32`. In `select_action`, compute `personality.chronotype_offset_ticks + rhythm.offset(entity)` once per agent before the candidate loop and pass it to `sleep_drive`.
3. [ ] Run `cargo test -p terri-sim circadian -- --test-threads=1`, `cargo test -p terri-sim shift_tests -- --test-threads=1` and `cargo test -p terri-sim action -- --test-threads=1`.

**Done when:** the three tests pass, the bare-agent golden hash test in `crates/terri-sim/src/lib.rs` passes unchanged, and no other selection test changes.

## Task 7: Hash and save the held shifts in schema nineteen

**Files:** new `crates/terri-core/src/save_v19.rs` (`SaveSnapshotV19`, `SavedShifts`, `SavedHeldShift`), `crates/terri-core/src/lib.rs`, `crates/terri-core/src/save.rs` (`SAVE_SCHEMA_VERSION = 19`), new `crates/terri-sim/src/save/v19.rs`, `crates/terri-sim/src/save.rs`, `crates/terri-sim/src/careers.rs` (`hash`, `hash_into`, validation), `crates/terri-sim/src/build_transaction.rs` and its submodules, `crates/terri-sim/src/job_search_tests.rs`, `crates/terri-sim/src/test_content.rs` (`pre_shift_careers`).

1. [ ] Write the failing tests: `the_hash_is_unchanged_while_everyone_holds_the_standard_shift`, `the_hash_sees_a_drawn_shift`, `schema_nineteen_round_trips_held_shifts_and_the_stream`, `schema_nineteen_refuses_what_the_world_cannot_account_for` (a dead or unemployed person, an unordered or repeated list, the id `standard`, an id the level does not list, each leaving the running world unchanged), `schemas_fourteen_to_eighteen_load_on_the_standard_shift`, and `a_build_transaction_keeps_the_held_shift`.
2. [ ] Add `pre_shift_careers(pack: &ContentPack) -> &'static ContentPack` to `test_content.rs`: the shipped pack cut to the first three paths and twelve rows, every row's `shifts` emptied with `standard_weight` 1, and the four sleep offsets set to 0. Change `every_search_on_plays_out_exactly_as_the_global_setting_did` to run under it with its existing `MAIN_HASH` and `MAIN_DRAWS`, and add `the_shipped_household_hash_and_draws_through_thursday` pinning the shipped content's hash, careers draw count and shift draw count, with a comment naming this issue as the cause of the move.
3. [ ] Implement the hash section of [WS-determinism] item 3 and the schema-nineteen writer, reader, validation and migration of [WS-save]. Switch the current writer and build transactions to schema nineteen; keep the schema-fourteen to schema-eighteen writers for tests.
4. [ ] Run `cargo test -p terri-core -- --test-threads=1` and `cargo test -p terri-sim -- --test-threads=1` saved to `.local-build/logs/task7-sim.log`. For each failing test whose expectation moved, record in the work queue whether the move is the schema envelope, the content change or a defect, and fix defects.
5. [ ] Confirm the bare-agent golden (`GOLDEN` in `crates/terri-sim/src/lib.rs`) and `crates/terri-wasm/src/published_v15_tests.rs` values are unchanged.

**Done when:** all `terri-core` and `terri-sim` tests pass, the two pinned hashes are unchanged, and the pre-change pin still equals main's values.

## Task 8: Export shifts across the boundary

**Files:** `crates/terri-wasm/src/lib.rs` (`career_schedule_of`, new `career_path_shifts`, current save writer), `crates/terri-wasm/src/calendar_boundary_tests.rs`, new `crates/terri-wasm/src/shift_boundary_tests.rs`, and the tests pull request 303 updated for schema eighteen (`save_v3_tests.rs`, `room_save_tests.rs`, `current_test_snapshot.rs`, `character_tests.rs`, `player_order_tests.rs`, `examples/support/mod.rs`).

1. [ ] Write the failing tests: `career_schedule_of_reports_the_held_shift_and_its_kind` (the shipped worker reads `[31, 360, 480, 0]`; a night worker reads the kind 3), `career_path_shifts_lists_the_first_levels_drawable_shifts` (the office returns two shifts, standard first), `career_path_shifts_is_empty_for_an_unknown_path`, `schema_nineteen_round_trips_through_the_save_bytes`, and `published_inputs_load_on_the_standard_shift`.
2. [ ] Implement the exports and update the existing calendar boundary assertions from three values to four.
3. [ ] Update the fixture tests for the schema-nineteen envelope the way pull request 303 updated them for schema eighteen, comparing every other byte unchanged.
4. [ ] Run `cargo test -p terri-wasm -- --test-threads=1`, then rebuild the module with `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.

**Done when:** all `terri-wasm` tests pass and the module rebuilds.

## Task 9: Show the shift in the shell and save version nineteen

**Files:** `web/src/ui/game-hud.ts` (`CareerSchedule`, `formatCareerSchedule`), `web/src/bridge.ts` (`careerScheduleOf`, new `careerPathShifts`), `web/src/ui/career-panel.ts` (the chooser line), `web/src/storage/save-header.ts` (`CURRENT_SAVE_VERSION = 19`), `web/src/storage/save-worker.ts` (`V18_BACKUP_FILE`), new `web/tests/fixtures/v18-worker/` (frozen worker, header and manifest with the source commit and SHA-256 digests), and tests `web/tests/game-hud.test.ts`, `web/tests/career-panel.test.ts`, `web/tests/career-bridge.test.ts`, `web/tests/save-worker.test.ts`, `web/tests/legacy-save.test.ts`.

1. [ ] Write the failing tests: in `game-hud.test.ts`, `names the held shift on the Career row` for each kind, a shift ending after midnight and an invalid kind; in `career-panel.test.ts`, `shows the shift chances of the selected path` for one shift and for three with whole-percent rounding and ordering; in `career-bridge.test.ts`, `validates shift kinds and path shifts`; in `save-worker.test.ts`, `keeps a schema-eighteen backup when writing schema nineteen`.
2. [ ] Implement the wording of [WS-shell]. Build the chooser line from `careerPathShifts` when the selection changes.
3. [ ] Copy the schema-eighteen worker and header from the merge commit of pull request 303 into `web/tests/fixtures/v18-worker/`, record their digests in `manifest.json`, and bump the version and backup map.
4. [ ] In `web/`, run `npm run typecheck` and `npx vitest run --maxWorkers=1 --testTimeout=20000` saved to `.local-build/logs/task9-vitest.log`.

**Done when:** typecheck passes and every Vitest test passes.

## Task 10: Measure sleep, waiting and cost with the trace

**Files:** `crates/terri-sim/examples/trace.rs`.

1. [ ] Add three read-only reports that draw no random number and change no state: each person's job title and held shift, each person's sleeping ticks by hour of day, and the longest consecutive wait any person spends on a sleeping conversation recipient. Add a `--night-worker` flag that assigns Casey the night watch on its standard shift before the first tick.
2. [ ] Run `cargo run --release -p terri-sim --example trace -- 10080` and `cargo run --release -p terri-sim --example trace -- 10080 --night-worker`, saving both to `.local-build/logs/`.
3. [ ] Check the [WS-sleep] acceptance for the night worker: more than half of sleeping ticks fall between 07:00 and 18:00, and the worker is at home and awake, or wakes and leaves, at the start of at least 9 shifts in 10. If not, adjust only `shift_sleep_offset_night` and rerun; on a third failed value, follow the Rule of Three and report.
4. [ ] Record which paths and shifts Bill and Casey hold in the shipped run, testing the [WS-household] prediction, and the longest wait on a sleeping recipient. If that wait exceeds 60 minutes, report it to the owner as a conversation-system finding.
5. [ ] Repeat the Task 1 timing with three release trace runs and confirm the median is within 5 percent of the baseline.

**Done when:** the acceptance holds or a blocker is reported, and every measured figure is in the verification record of Task 11.

## Task 11: Update documentation and the changelog

**Files:** `docs/specs/2026-10-17-careers.md` (rules 2 and 18 point to the shifts spec), `docs/specs/2026-10-06-calendar.md` ([CAL-hud] Career row wording), `docs/GAME-SYSTEMS.md` ([S-careers] "What exists"), `docs/player-visible-strings.md` (Selected person row, Career tab chooser line, shift names, new labels and titles as proposed per [L58]), `docs/ARCHITECTURE.md` (schema nineteen), new `docs/specs/2026-10-18-shifts-and-careers-verification.md`, and a new or extended note in `docs/changelog/` for the delivery date.

1. [ ] Update each document to the delivered behavior. Put measured figures, timings, moved test expectations and played findings only in the verification record.
2. [ ] Apply `.agents/skills/maintain-changelog/SKILL.md` and write the player note of [WS-docs]: plain sentences about shifts by chance, office days, five new careers, night workers sleeping by day, and the Career tab's shift and chances.
3. [ ] Run `py -3 check-doc-ids.py`, `node --test scripts/build-changelog.test.mjs scripts/branding.test.mjs` and `node scripts/build-changelog.mjs`.
4. [ ] Check for prohibited dash characters in every changed document with `rg -n "[\x{2013}\x{2014}]" docs content` and expect no match.

**Done when:** the three commands pass and every changed document reads as the current contract.

## Task 12: Run the full local checks

**Files:** none changed unless a check finds a defect.

1. [ ] On the committed head, run each of these, saving output under `.local-build/logs/` and recording each exit code:
   - `cargo fmt --all -- --check`
   - `cargo clippy --workspace --all-targets -- -D warnings`
   - `cargo test --workspace -- --test-threads=1`
   - `py -3 check-doc-ids.py`
   - `node --test scripts/build-changelog.test.mjs scripts/branding.test.mjs` and `node scripts/build-changelog.mjs`
   - `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`
   - in `web/`: `npm run typecheck`, `npx vitest run --maxWorkers=1 --testTimeout=20000` and `npm run build`
   - the core web-dependency guard from `.github/workflows/ci.yml`, translated to PowerShell for `x86_64-pc-windows-msvc` and `wasm32-unknown-unknown`
2. [ ] Run a targeted mutation sweep over the diff in the shared mutants worktree: `cargo mutants --in-place --in-diff <diff-file> --package terri-data --package terri-sim`. Each surviving mutant in the draw, the keep-or-draw rule, the hash section, the save validation or the compiler refusals gets a test or a written reason in the verification record.
3. [ ] Check `git ls-files --eol` for every changed file and `git status` for a clean tree.

**Done when:** every command exits 0, the mutation results are recorded, and the tree is clean.

## Task 13: Play the build and obtain a visual review

**Files:** selected screenshots under `docs/evidence/` as its README directs, and the verification record.

1. [ ] Start or reuse the project's preview servers on 5174 and 4173 only. Confirm the served bundle is this branch's before looking.
2. [ ] Play at desktop width and at phone width (375 by 812), muted where possible, per [Testing Protocol, section 9](../../testing-protocol.md#9-every-milestone-ends-with-a-played-visual-pass): a new game's first two days with the shipped worker leaving at 06:00; the chooser line for the office and for a three-shift path; assign paths until a night shift and a late or early shift are held; the Career row and tab for each; the night worker leaving at the shift's start and asleep in bed at mid-morning; and a schema-eighteen save loading with its old schedules.
3. [ ] Inspect each saved screenshot at full size and write what it shows. File findings in `docs/alpha-feel-notes.md` with this milestone's entry, fixed or deferred with a reason.
4. [ ] Give a fresh independent reviewer the [WS-played] points and the captures without an expected verdict. Resolve every disagreement and finding, then inspect the same images yourself.
5. [ ] Close every task-owned page in a `finally` block and stop task-owned servers.

**Done when:** every [WS-played] point has an inspected screenshot and written finding, the independent review is recorded, and no task-owned page or server remains open.
