# Wages and Bills Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for the coupled simulation and save changes. Obtain a fresh independent review before delivery. The checkboxes describe future implementation work.

**Goal:** Multiply every wage by 1.5, pay a 15 percent premium on night shifts, add monthly rent, electricity, water and transportation bills with base charges, usage charges, automatic payment, grace and late fees, keep beds inside rooms, and show the bills in a Bills row and panel, as the spec defines.

**Architecture:** The content compiler adds a `[bills]` tuning section, the night premium knob, `bill_uses` on actions and chain steps, and `bill_daily` and `indoor_only` on object layers. A new simulation module counts each day's base charges, rent tiles and daily usage, counts uses at the physical start of work and trips at shift settlement, issues the month's bills, pays them from Funds and adds late fees. A derived moodlet reports overdue bills. Placement, Confirm and single wall edits enforce the bed rule. Schema twenty saves the bills record on top of schema nineteen and migrates older pay. The shell adds a Bills row and a read-only Bills dialog.

**Tech stack:** Rust (`terri-core`, `terri-data`, `terri-sim`, `terri-wasm`), TOML content, TypeScript shell with Vitest. No dependency changes.

**Spec:** [Wages and bills](../../specs/2026-10-18-wages-and-bills.md). Read it whole before starting; section ids such as [WB-rent] refer to it.

## Contents

- [Global constraints](#global-constraints)
- [Task 1: Start from a main that holds schema nineteen](#task-1-start-from-a-main-that-holds-schema-nineteen)
- [Task 2: Add months to the calendar](#task-2-add-months-to-the-calendar)
- [Task 3: Compile the bills tuning and the night premium](#task-3-compile-the-bills-tuning-and-the-night-premium)
- [Task 4: Compile usage and indoor-only properties and mark the shipped content](#task-4-compile-usage-and-indoor-only-properties-and-mark-the-shipped-content)
- [Task 5: Count days, rent, usage and trips, and issue bills](#task-5-count-days-rent-usage-and-trips-and-issue-bills)
- [Task 6: Pay bills, add late fees and report overdue bills in mood](#task-6-pay-bills-add-late-fees-and-report-overdue-bills-in-mood)
- [Task 7: Raise wages, pay the night premium and save schema twenty](#task-7-raise-wages-pay-the-night-premium-and-save-schema-twenty)
- [Task 8: Keep beds inside rooms](#task-8-keep-beds-inside-rooms)
- [Task 9: Export bills, refusals and night pay across the boundary](#task-9-export-bills-refusals-and-night-pay-across-the-boundary)
- [Task 10: Show the Bills row, the Bills panel and the new texts](#task-10-show-the-bills-row-the-bills-panel-and-the-new-texts)
- [Task 11: Measure and calibrate with the trace](#task-11-measure-and-calibrate-with-the-trace)
- [Task 12: Update documentation and the changelog](#task-12-update-documentation-and-the-changelog)
- [Task 13: Run the full local checks](#task-13-run-the-full-local-checks)
- [Task 14: Play the build and obtain a visual review](#task-14-play-the-build-and-obtain-a-visual-review)

## Global constraints

1. Every rate, base charge, percentage, day count and mood weight lives in `content/tuning.toml`; every wage lives in `content/careers.toml`. None is written into code, and no code names a particular object type, action or usage kind.
2. Nothing in this change draws from any random stream ([WB-determinism]). All money is integer cents with the rounding steps the spec states.
3. Run Rust tests with `-- --test-threads=1` and Vitest with `--maxWorkers=1`. Do not overlap heavy builds and tests. Save long output to `.local-build/logs/<step>.log` and report each command's exit code with a bounded digest.
4. Scripted edits write LF line endings (Python `newline="\n"`). After each scripted edit, check `git ls-files --eol` for the touched files.
5. Keep player-visible strings plain and exactly as [WB-strings] proposes; they stay marked proposed until the owner reviews them.
6. Record every test whose expected value moves in `.local-build/work-queue.md` with its class from [WB-determinism] (unchanged, wages, bills, migration, pack layout) and its cause. A move that fits no class is a defect to investigate, not a value to re-pin.
7. Before a pull request leaves draft, a fresh adversarial review by subagents covers the exact final head, and every valid finding is resolved and recorded.
8. Do not commit videos. Close task-owned browser pages and preview servers when a check ends.

## Task 1: Start from a main that holds schema nineteen

**Files:** none changed.

1. [ ] Check whether pull request 304 (issue 296) has merged with `gh pr view 304 --repo thisnameissoclever/terrilives --json state,mergeCommit`. If it is not `MERGED`, stop and coordinate with its owner; this work does not take schema nineteen ([WB-scope]).
2. [ ] Run `git fetch origin` and `git merge origin/main` on `twcl/298-wages-and-bills`. Confirm with `rg -n "SAVE_SCHEMA_VERSION: u16 = 19" crates/terri-core/src/save.rs` and `rg -n "CURRENT_SAVE_VERSION = 19" web/src/storage/save-header.ts` that schema nineteen is current, that `content/careers.toml` holds eight paths, and that `career_search_temperature` is the last root knob in `content/tuning.toml`. If another branch has already taken schema twenty, stop and follow [L-save-version-collision].
3. [ ] Check free space with `Get-PSDrive -PSProvider FileSystem`; keep at least 30 GB free on the volume holding `target/`.
4. [ ] In `web/`, run `npm ci`; from the repository root run `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, because a new worktree's ignored wasm can be stale.
5. [ ] Record the baseline: `cargo test --workspace -- --test-threads=1` saved to `.local-build/logs/baseline-cargo.log`, and the median of three `Measure-Command { cargo run --release -p terri-sim --example trace -- 12000 }` runs.
6. [ ] Capture the authentic schema-nineteen fixtures before any change, following the method in `crates/terri-wasm/tests/fixtures/job-search-v17/README.md`: in a scratch worktree at the merged main commit, add `crates/terri-wasm/examples/write_bills_v19_fixtures.rs` and run `cargo run --release -p terri-wasm --example write_bills_v19_fixtures`. It writes three saves: a new game after two days with Tim mid-shift, a household with a night watch worker holding a night shift, and a household whose double bed was moved to a yard tile (allowed before this change). Copy them with a README holding their SHA-256 digests to `crates/terri-wasm/tests/fixtures/bills-v19/`, then remove the scratch worktree with `git worktree remove`.

**Done when:** the branch contains main with schema nineteen, the baseline passes, the baseline trace time is in `.local-build/work-queue.md`, and the three fixtures and their README are committed.

## Task 2: Add months to the calendar

**Files:** `crates/terri-core/src/clock.rs`.

**Interfaces:** `pub fn month(tick: u64, day_ticks: u32, days_per_month: u32) -> u64` and `pub fn day_of_month(tick: u64, day_ticks: u32, days_per_month: u32) -> u32`, the latter 1-based. Both reduce as `season` does, so the top of the tick range cannot overflow.

1. [ ] Write the failing tests in `clock.rs`: `month_and_day_of_month_at_the_start_of_a_game` (tick 0 is month 0, day 1), `the_last_day_of_a_month_and_the_first_of_the_next` (with 1440-tick days and 7-day months, day index 6 is day 7 of month 0 and day index 7 is day 1 of month 1), `month_reduces_before_dividing_at_the_top_of_the_tick_range` (`u64::MAX` with a one-tick day), and `a_seven_day_month_starts_on_the_first_weekday` (every first day of a month from day 0 to day 70 has weekday 0 with `first_weekday = 0`).
2. [ ] Run `cargo test -p terri-core clock -- --test-threads=1`; confirm the new tests fail to compile or fail on assertions.
3. [ ] Implement the two functions with doc comments pointing to [WB-calendar].
4. [ ] Run `cargo test -p terri-core -- --test-threads=1`.

**Done when:** the four tests pass and no other `terri-core` test changes.

## Task 3: Compile the bills tuning and the night premium

**Files:** `crates/terri-data/src/schema.rs` (`TuningFile.bills: Option<BillsTuningDef>`, `TuningFile.night_shift_premium_percent`), `crates/terri-data/src/compile.rs` (`compile_tuning` validation and copy), `crates/terri-data/src/pack.rs` (`Tuning.night_shift_premium_percent`, `Tuning.bills: BillsTuning`, `BillKind { id, label, water_cents, electricity_cents }`, `SHIPPED_*` constants), `crates/terri-data/src/published_pack_wire.rs` (reconstruction for published packs), `crates/terri-data/src/error.rs` (refusals), `crates/terri-data/build_pre_books.rs` (historical source expansion), `crates/terri-data/tests/inherited_runtime.rs` and `crates/terri-data/tests/fixtures/inherited-runtime.pack`, `content/tuning.toml`.

**Interfaces:** `BillsTuning { days_per_month: u32, grace_days: u32, late_fee_percent: u32, late_fee_cap_percent: u32, overdue_mood: f32, rent_base_cents: i64, rent_indoor_tile_cents: i64, rent_outdoor_tile_cents: i64, electricity_base_cents: i64, water_base_cents: i64, transportation_base_cents: i64, commute_cents: i64, uses: Vec<BillKind>, daily: Vec<BillKind> }`, each kind list sorted by id. Both fields are appended after issue 296's last tuning field, the premium first.

1. [ ] Write the failing tests in `compile.rs`: `compiles_the_bills_section_with_kinds_in_id_order`, `rejects_each_bad_bills_value` (`days_per_month` 0 and 366; grace equal to `days_per_month`; each percentage at 101; a negative and a non-finite mood; a cent amount of 1,000,001; an empty kind id; an id repeated across `uses` and `daily`; an empty label and a 33-character label; an unknown key in a kind row; a missing key), `rejects_a_night_premium_above_one_hundred` (100 accepted, 101 refused), and `the_shipped_bills_tuning_matches_the_spec` in `crates/terri-data/src/lib.rs`, asserting every value of the `[bills]` block in [WB-tuning] and the premium 15.
2. [ ] Write `a_published_pack_reconstructs_the_shipped_bills_tuning` beside the published converter's tests, and extend the pre-books expansion test so the frozen source compiles with the shipped bills values.
3. [ ] Run `cargo test -p terri-data bills -- --test-threads=1` and `cargo test -p terri-data premium -- --test-threads=1`; confirm assertion or compile failures in the new tests only.
4. [ ] Implement the schema, validation, compiled types and reconstruction. Append `night_shift_premium_percent = 15` after `career_search_temperature` and the `[bills]`, `[bills.uses]` and `[bills.daily]` tables of [WB-tuning] to `content/tuning.toml`, each knob with a one-line comment naming [WB-bills], [WB-paying] or [WB-usage]. The `[bills.uses]` and `[bills.daily]` rows ship in this task; the compiler's "kind nobody uses" refusal arrives in Task 4 with the content that uses them.
5. [ ] Regenerate the inherited runtime fixture with `TERRI_WRITE_RUNTIME_FIXTURE=1 cargo test -p terri-data --test inherited_runtime -- --test-threads=1`, then prove it with `TERRI_PROVE_RUNTIME_FIXTURE=1` and the same command; the test requires that only appended bytes changed. Update `GOLDEN_PACK_BYTES` in `compile.rs` by its documented method and record the move as class "pack layout".
6. [ ] Run `cargo test -p terri-data -- --test-threads=1` and `cargo test -p terri-data --test content_hierarchy -- --test-threads=1`; the content fingerprint constant must not change.

**Done when:** the new tests pass, the fingerprint is unchanged, the only moved pins are the two pack-layout ones, and `cargo clippy -p terri-data --all-targets -- -D warnings` is clean.

## Task 4: Compile usage and indoor-only properties and mark the shipped content

**Files:** `crates/terri-data/src/schema.rs` (`InteractionDef.bill_uses`, the chain step's `bill_uses`, the object layer properties `bill_daily` and `indoor_only`), `crates/terri-data/src/hierarchy.rs` (layer resolution), `crates/terri-data/src/compile.rs`, `crates/terri-data/src/pack.rs` (appended `bill_uses: Vec<u16>` on compiled interactions and chain steps, `bill_daily: Vec<u16>` and `indoor_only: bool` on `ObjectDef`), `crates/terri-data/src/published_pack_wire.rs`, `crates/terri-data/src/error.rs`, `content/objects.toml`, `content/chains.toml`, and every hand-built `ObjectDef`, interaction or chain step literal found by `rg "ObjectDef \{|InteractionDef \{|ChainStepDef \{" crates`.

1. [ ] Write the failing tests: `resolves_bill_uses_through_template_type_and_model_layers` and `resolves_bill_daily_and_indoor_only_through_category_type_and_model_layers` in `hierarchy.rs`; `rejects_an_unknown_use_kind_on_an_action_or_step`, `rejects_an_unknown_daily_kind_on_an_object`, `rejects_a_repeated_kind_in_one_list`, and `rejects_a_defined_kind_that_nothing_uses` in `compile.rs`; and in `crates/terri-data/src/lib.rs`, `the_shipped_usage_marks_match_the_spec` (each row of the [WB-usage] table: `take_shower` carries `shower`, `soak` carries `bath`, `wash_hands` and `wash_up` carry `hand_wash`, `relieve_self` carries `toilet`, the Wash dishes step of `clean_dishes` carries `dishes`, `watch_tv` carries `television`, `listen` carries `radio`, the Cook step of `cook_dinner` carries `stove` and Simmer and stir carries nothing, the `fridge` and `aquarium` types, every `lighting` model and the `pool` type carry their daily kinds, and no other action, step or object carries any) and `only_sleeping_models_are_indoor_only` (both bed models true, every other model false).
2. [ ] Write `bill_marks_do_not_move_the_content_fingerprint` in `crates/terri-data/tests/content_hierarchy.rs`: a clone of the shipped pack with every `bill_uses`, `bill_daily` and `indoor_only` cleared has the same fingerprint as the shipped pack.
3. [ ] Run `cargo test -p terri-data bill -- --test-threads=1`; confirm failures.
4. [ ] Implement the properties, their resolution, the compiled indices and the published conversion (empty lists, `false`).
5. [ ] Mark the shipped content as the [WB-usage] table and `indoor_only = { set = true }` on the `sleeping` category. Update the header comments of `content/objects.toml` and `content/chains.toml` to describe the two bill properties and the bed rule.
6. [ ] Run `cargo test -p terri-data -- --test-threads=1`, then `cargo test -p terri-sim -- --test-threads=1` to confirm that nothing in the simulation reads the new properties yet and every simulation pin is unchanged.

**Done when:** the new tests pass, the fingerprint and the saved action manifest are unchanged, and every `terri-sim` test passes unchanged.

## Task 5: Count days, rent, usage and trips, and issue bills

**Files:** new `crates/terri-sim/src/bills.rs` and `crates/terri-sim/src/bills_tests.rs` (registered from `bills.rs`), `crates/terri-sim/src/lib.rs` (module, resource insertion, schedule, `world_hash`), `crates/terri-sim/src/systems/movement.rs` (the two physical-start sites), `crates/terri-sim/src/attendance.rs` (`settle`), `crates/terri-sim/src/rooms/runtime.rs` (a shared tile-count helper beside `cleaning_area_at`).

**Interfaces:** resource `Bills` holding the fields of `SavedBills` ([WB-save]) with kinds as compiled indices and `events: BillEvents` (session-local, [WB-hooks]); `bills::tick(world)` scheduled immediately after `systems::career::commute_and_work`; `bills::count_use(world, uses: &[u16])`; `bills::count_trip(world)`; `bills::hash(world, hasher)`; `rooms::runtime::rent_tiles(world) -> (u32, u32)` returning indoor and outdoor tile counts from the confirmed `RoomMap`; `Bills::is_pristine()`.

1. [ ] Write the failing tests in `bills_tests.rs`:
   - `the_shipped_lot_has_192_indoor_and_112_outdoor_rent_tiles` and `the_tiny_house_and_the_wall_free_lot_count_as_the_spec_says` (build the 4 by 4 house and the wall-free lot with real wall commands, then confirm);
   - `a_new_game_counts_its_first_day_on_its_first_tick` and `each_day_is_counted_once_on_its_first_processed_tick`;
   - `a_full_month_issues_four_bills_with_the_exact_amounts` (a fixture month with known tiles, uses, daily objects and trips, asserting each bill's cents, including the single rounding step);
   - `rent_ignores_an_unconfirmed_draft_and_follows_a_confirmed_layout_from_the_next_day`;
   - `each_shipped_use_kind_counts_once_at_physical_start` (one case per kind, driving the real action or chain step), `an_abandoned_walk_counts_nothing`, `two_viewers_count_two_television_uses`, `an_interrupted_shower_still_counts`;
   - `daily_kinds_count_per_placed_object_per_day` (two lamps count two a day; a sold fridge stops counting the next day);
   - `a_trip_counts_once_per_settled_shift_with_time_worked`, `a_missed_shift_counts_no_trip`, `a_worker_sent_home_and_back_counts_one_trip`;
   - `a_zero_bill_is_not_issued` and `bills_are_issued_in_the_order_rent_electricity_water_transportation`;
   - `a_world_without_a_lot_stays_pristine_and_hashes_as_before` and `a_counted_day_moves_the_hash`;
   - `the_events_ring_holds_issued_bills_and_is_not_hashed`.
   Pin exact cents and counts, per [L5].
2. [ ] Run `cargo test -p terri-sim bills -- --test-threads=1`; confirm assertion failures.
3. [ ] Implement the module. Count uses at the site that calls `player_actions::record_physical_work_start` and at the `StepWork` insertion in `systems/movement.rs`, reading the compiled indices only. Count a trip in `attendance::settle` when the worked minutes are above zero. Do day work in the order of [WB-calendar]. Append the hash section of [WB-determinism] after the career shift section, skipped while pristine.
4. [ ] Run `cargo test -p terri-sim -- --test-threads=1`. Classify every moved pin as "bills" in the work queue; a shipped-household run that does not cross a day start must not move.
5. [ ] Apply testing protocol rule 1 to `each_day_is_counted_once_on_its_first_processed_tick` and `a_world_without_a_lot_stays_pristine_and_hashes_as_before`: delete the `last_counted_day` guard and the pristine check in turn, record the failing output, restore, and confirm the tree is byte-identical with `git diff --stat`.

**Done when:** the new tests pass, every moved pin is classified, and the rule 1 receipts are in the work queue.

## Task 6: Pay bills, add late fees and report overdue bills in mood

**Files:** `crates/terri-sim/src/bills.rs`, `crates/terri-sim/src/bills_tests.rs`, `crates/terri-sim/src/mood.rs` (`BEHIND_ON_BILLS` derived moodlet).

1. [ ] Write the failing tests: `bills_are_paid_on_the_tick_they_are_issued_when_funds_cover_them`, `payment_is_oldest_first_and_stops_at_the_first_unaffordable_bill`, `a_bill_is_never_paid_in_part_and_funds_never_go_below_zero`, `pay_from_a_settling_shift_pays_a_waiting_bill_in_the_same_tick`, `no_fee_is_added_within_the_grace_period`, `a_late_fee_is_added_on_the_first_tick_of_each_day_after_grace` (a bill due Day 8 gains its first fee on Day 13), `late_fees_round_up_to_the_cent_and_stop_exactly_at_the_cap`, `behind_on_bills_appears_only_while_a_bill_is_overdue`, `behind_on_bills_ends_on_the_tick_the_last_overdue_bill_is_paid`, and `behind_on_bills_lowers_mood_by_the_tuned_amount_for_every_living_housemate`. Pin exact cents and ticks.
2. [ ] Run `cargo test -p terri-sim bills -- --test-threads=1` and `cargo test -p terri-sim mood -- --test-threads=1`; confirm failures.
3. [ ] Implement payment, fees and the moodlet as [WB-paying] defines. The moodlet is derived where `Warned at work` is derived, from the `Bills` resource, with no timer.
4. [ ] Apply testing protocol rule 1 to `payment_is_oldest_first_and_stops_at_the_first_unaffordable_bill` (replace the stop with a skip) and `late_fees_round_up_to_the_cent_and_stop_exactly_at_the_cap` (remove the cap reduction); record and restore.
5. [ ] Run `cargo test -p terri-sim -- --test-threads=1` and classify moved pins.

**Done when:** the tests pass, the rule 1 receipts are recorded, and every moved pin is classified.

## Task 7: Raise wages, pay the night premium and save schema twenty

**Files:** `content/careers.toml`; `crates/terri-sim/src/attendance.rs` (`start_tick`, the open-shift validator); `crates/terri-sim/src/careers.rs` (validation comments only; the range check reads content); new `crates/terri-core/src/save_v20.rs` with `SaveSnapshotV20` and `SavedBills`; `crates/terri-core/src/save.rs` (`SAVE_SCHEMA_VERSION = 20`); `crates/terri-core/src/lib.rs`; new `crates/terri-sim/src/save/v20.rs` (`capture`, `capture_without_commands`, `restore`, `project_v19`, the pay migration); `crates/terri-sim/src/lib.rs` (`save_snapshot_v20`, `load_snapshot_v20`, current-save dispatch); `crates/terri-sim/src/build_transaction.rs` (current schema references); `crates/terri-wasm/src/lib.rs` (`load_bytes` dispatch); `crates/terri-sim/src/attendance_tests.rs`, `crates/terri-sim/src/job_search_tests.rs` and every test that pins funds after a shift.

1. [ ] Write the failing tests:
   - in `crates/terri-data/src/lib.rs`, `the_shipped_wages_are_one_and_a_half_times_the_old_ones` asserting all 32 levels against the [WB-wages] table;
   - in `attendance_tests.rs`, `a_night_shift_records_the_premium_in_cents` (night watch guard: 12075 cents), `day_early_and_late_shifts_record_no_premium`, `a_prorated_night_shift_pays_its_share_of_the_premium`, and `the_open_shift_validator_accepts_the_premium_range_and_refuses_above_it`;
   - in `crates/terri-sim/src/save/v20.rs` tests, `schema_twenty_round_trips_the_bills_record` (mid-month, with an overdue bill and a last month), one `refuses_*` test per refusal in [WB-save] that asserts unchanged live bytes, hash and random state, `drops_counts_for_a_usage_kind_content_no_longer_defines`, `loading_schema_nineteen_migrates_pay_and_open_shift_cents` (from the authentic fixture of Task 1, Tim's pay 120 becomes 180 and his open shift's 12000 cents becomes 18000), `migrated_pay_is_clamped_into_the_new_range`, `loading_schemas_fourteen_to_nineteen_starts_an_empty_prorated_month`, and `a_schema_twenty_save_is_not_migrated_twice`.
2. [ ] Run the new tests by name with `cargo test -p terri-sim <name> -- --test-threads=1`; confirm failures.
3. [ ] Edit `content/careers.toml` to the [WB-wages] values. Update its header comment so pay is described in the new dollars and the "one shift buys a chair and a lamp" comment is recomputed.
4. [ ] Implement the premium in `start_tick`, the validator range, schema twenty and the migration exactly as [WB-save] defines. Bump `SAVE_SCHEMA_VERSION` to 20.
5. [ ] Run `cargo test --workspace -- --test-threads=1` saved to `.local-build/logs/task7-cargo.log`. Classify every moved pin as "wages", "bills" or "migration", including issue 296's `the_shipped_household_hash_and_draws_through_thursday` and pull request 303's `every_search_on_plays_out_exactly_as_the_global_setting_did`; re-pin each with a comment naming issue 298. Search for each moved hash in decimal, hex and quoted forms with `rg`, per [L-pinned-hash-search-includes-strings], and update byte-fixture cuts per [L-save-tail-offset-fixtures].
6. [ ] Apply testing protocol rule 1 to `a_schema_twenty_save_is_not_migrated_twice` (apply the migration to schema twenty too) and `loading_schema_nineteen_migrates_pay_and_open_shift_cents` (skip the open-shift step); record and restore.

**Done when:** the workspace passes, every moved pin is classified and re-pinned with its cause, and the rule 1 receipts are recorded.

## Task 8: Keep beds inside rooms

**Files:** `crates/terri-sim/src/placement.rs` (`PlacementRefusal::OutsideRoom = 21`, `validate_placement`), `crates/terri-sim/src/placement/purchase.rs` (`validate_purchase`), `crates/terri-sim/src/placement/walls.rs` and `crates/terri-sim/src/placement/rooms.rs` (the single-edit refusal `BedOutside`), `crates/terri-sim/src/build_transaction.rs` (`BuildCommitError::BedOutside { object }` in `prepare_build_commit_projected_validated`), `crates/terri-sim/src/rooms/mod.rs` (a helper `footprint_is_indoors(topology, footprint) -> bool`), and tests in `placement/purchase_tests.rs`, `placement/tests.rs`, `placement/wall_tests.rs`, `placement/room_tests.rs` and the build transaction tests.

1. [ ] Write the failing tests:
   - `buying_a_bed_on_a_yard_tile_is_refused_as_outside_room` and `buying_a_bed_in_a_room_is_allowed` in `purchase_tests.rs`;
   - `moving_a_bed_onto_the_yard_is_refused` and `a_non_bed_object_may_stand_outdoors` in `placement/tests.rs`;
   - `a_bed_may_go_into_a_room_built_earlier_in_the_same_session`;
   - `confirm_refuses_a_batch_that_leaves_an_indoor_bed_outside`, `confirm_keeps_the_draft_unchanged_when_refused`, `confirm_allows_a_batch_that_removes_and_rebuilds_walls_around_a_bed`, and `confirm_ignores_a_bed_already_outside_in_the_baseline_that_did_not_move`;
   - `a_single_wall_edit_outside_a_session_that_leaves_a_bed_outside_is_refused` and the same for a room command;
   - `an_older_save_with_an_outdoor_bed_loads_and_the_bed_still_works` (from the Task 1 fixture: a sim sleeps in it), and `that_outdoor_bed_can_move_into_a_room_but_not_to_another_yard_tile`.
2. [ ] Run `cargo test -p terri-sim bed -- --test-threads=1`; confirm failures.
3. [ ] Implement the checks of [WB-beds], reading `ObjectDef::indoor_only` only. Compute `RoomTopology::from_world` on the draft only when an `indoor_only` object is placed or moved.
4. [ ] Apply testing protocol rule 1 to `confirm_refuses_a_batch_that_leaves_an_indoor_bed_outside` (remove the Confirm check) and `confirm_ignores_a_bed_already_outside_in_the_baseline_that_did_not_move` (remove the baseline exception); record and restore.
5. [ ] Run `cargo test -p terri-sim -- --test-threads=1`.

**Done when:** the tests pass, the receipts are recorded, and no unrelated placement test changes.

## Task 9: Export bills, refusals and night pay across the boundary

**Files:** new `crates/terri-wasm/src/browser_bills.rs`, `crates/terri-wasm/src/lib.rs` (exports, refusal code mappings, schema twenty in the save path), the wasm tests beside them, and `crates/terri-wasm/src/published_v15_tests.rs` only if a pin moves by class.

**Interfaces:** each export returns a flat `Float64Array` of cents and counts, empty when the world has no lot:
- `bills_overview()`: `[funds_cents, keep_aside_cents, shortfall_cents, next_due_day, overdue_cents, overdue_fee_cents, days_per_month, grace_days, late_fee_percent, late_fee_cap_percent, month_days]`;
- `bills_next()`: per bill in payment order, `[kind, so_far_cents, expected_cents]`;
- `bills_lines(kind)`: per line, `[line, kind_index, count, unit_cents, amount_cents]`, where `line` is 0 for the base charge, 1 for indoor tiles, 2 for outdoor tiles, 3 for a use kind, 4 for a daily kind and 5 for trips;
- `bills_overdue()` and `bills_last_month()`: per bill, `[kind, due_day, amount_cents, fee_cents, paid_day]`, with `paid_day` -1 when unpaid;
- `bill_kind_labels()`: a string array of use labels followed by daily labels, in compiled order;
- `night_pay_cents_of(entity_index)`: the premium pay of a person holding a night shift, -1 otherwise.
The placement refusal 21 and the build commit and wall refusals for a bed are mapped to new codes in the existing result exports.

1. [ ] Write the failing wasm tests: `bills_exports_are_empty_without_a_lot`, `bills_overview_on_a_new_game`, `bills_exports_mid_month_with_an_overdue_bill`, `bills_lines_for_each_bill_kind`, `night_pay_of_a_night_worker_and_of_a_day_worker`, `bed_refusals_cross_the_boundary_with_their_codes`, `schema_twenty_round_trips_through_the_save_bytes`, and `the_authentic_schema_nineteen_fixtures_load_with_migrated_pay`.
2. [ ] Run `cargo test -p terri-wasm -- --test-threads=1`; confirm failures.
3. [ ] Implement the exports and mappings.
4. [ ] Run `cargo test -p terri-wasm -- --test-threads=1` and classify moved pins.

**Done when:** the tests pass and every moved pin is classified.

## Task 10: Show the Bills row, the Bills panel and the new texts

**Files:** `web/index.html` (the Bills row in `#household-summary`, dialog styles), new `web/src/ui/bills-panel.ts`, `web/src/ui/game-hud.ts` (the row's text and danger state), `web/src/main.ts` (dialog wiring with `overlayPause.suspend('bills')`, disabled in Build), `web/src/bridge.ts` (bills exports, `PLACEMENT_REASONS[21]`, the wall and room refusal text, the night pay export), `web/src/ui/build-exit.ts` (`confirmRefusal` with the bed case), `web/src/ui/career-panel.ts` (the night pay sentence), `web/src/storage/save-header.ts` (`CURRENT_SAVE_VERSION = 20`), `web/src/storage/save-worker.ts` (the `terri-save-1.v19-backup.bin` recovery file), a frozen copy of the schema-nineteen worker in `web/tests/fixtures/`, and tests `web/tests/bills-panel.test.ts`, `web/tests/game-hud.test.ts`, `web/tests/bridge.test.ts`, `web/tests/build-exit.test.ts`, `web/tests/career-panel.test.ts`, `web/tests/save-worker.test.ts`.

1. [ ] Write the failing tests:
   - `bills-panel.test.ts`: `renders keep aside, cover and shortfall lines`, `lists overdue bills only when one is overdue`, `lists next bills with so far and expected amounts in cents`, `expands each bill into its lines`, `shows the last month with paid and unpaid bills`, `reads the rules paragraph from the overview numbers`, `closes on Close and Escape and resumes the paused game`;
   - `game-hud.test.ts`: `the Bills row reads the amount due rounded up to the dollar and the due day`, `the Bills row reads the overdue total in the danger state`, `the Bills row button's accessible name adds open bills`, `the Bills row is disabled in Build mode`;
   - `bridge.test.ts`: validation of every bills export, refusal 21's text, the bed wall and room refusal text;
   - `build-exit.test.ts`: the bed Confirm refusal text;
   - `career-panel.test.ts`: the night pay sentence for a night worker and its absence for others;
   - `save-worker.test.ts`: version 20 writes, the schema-nineteen backup, and the frozen schema-nineteen worker refusing a version 20 file.
2. [ ] Run `npm --prefix web test -- --maxWorkers=1 tests/bills-panel.test.ts tests/game-hud.test.ts tests/bridge.test.ts tests/build-exit.test.ts tests/career-panel.test.ts tests/save-worker.test.ts`; confirm failures.
3. [ ] Implement the row, the dialog and the texts exactly as [WB-panel] and [WB-strings] define, using the phone rules of [WB-panel] in `web/src/ui/compact-hud.css` where the dialog needs them.
4. [ ] Rebuild the wasm with `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, then run `npm --prefix web run typecheck` and `npm --prefix web test -- --maxWorkers=1`.

**Done when:** the typecheck and the whole Vitest suite pass.

## Task 11: Measure and calibrate with the trace

**Files:** `crates/terri-sim/examples/trace.rs`, new `crates/terri-sim/examples/trace/bills.rs`, `crates/terri-sim/examples/trace/catalogue.rs` (a `solo` scenario that turns job search off for Bill and Casey through `SimCommand::SetJobSearch` before the first tick), `content/tuning.toml` only if a band fails, and the verification record `docs/specs/2026-10-18-wages-and-bills-verification.md`.

1. [ ] Add a `BILLS` section to the trace output: for each issued month, the four bills in cents, each usage kind's count, the trip count, the payment tick, any late fee, and the household's income for the month; then the share of income and the usage share of each utility.
2. [ ] Run `cargo run --release -p terri-sim --example trace -- 40320 <seed>` for seeds 20260728, 1, 2 and 3, and `cargo run --release -p terri-sim --example trace -- 40320 <seed> - solo` for the same seeds, saving each to `.local-build/logs/trace-bills-<scenario>-<seed>.log`.
3. [ ] Compare the results with the acceptance bands of [WB-numbers]. Record the measured dish washing count, trip count and one-earner usage, which the spec states as estimates.
4. [ ] If a band fails, change only tuning values, rerun all eight traces, and record the old values, new values and both measurements in the verification record and in the delivery report for the owner.
5. [ ] Measure performance: the median of three `Measure-Command { cargo run --release -p terri-sim --example trace -- 12000 }` runs against Task 1's baseline. Accept a median within 5 percent; otherwise profile the bills tick and the use-count sites before changing anything.

**Done when:** every band passes on all four seeds, the measurements and the performance comparison are in the verification record, and any tuning change is recorded with its reason.

## Task 12: Update documentation and the changelog

**Files:** `docs/changelog/<delivery date>.md`, `docs/specs/2026-10-17-careers.md` (rules 1, 2 and 8 point to [WB-wages]), `docs/specs/2026-10-06-calendar.md` (months point to [WB-calendar]), `docs/GAME-SYSTEMS.md` ([S-money], [S-calendar], [S-careers]), `docs/player-visible-strings.md` (the [WB-strings] rows, marked proposed), `docs/ARCHITECTURE.md` (schema twenty), `docs/specs/2026-10-18-wages-and-bills-verification.md`.

1. [ ] Read `.agents/skills/maintain-changelog/SKILL.md` and `docs/changelog.md`. Extend the delivery date's entry if one exists, otherwise create it, with the player-facing points of [WB-docs] and nothing about implementation.
2. [ ] Update the documents above. State changed behavior only; do not add progress counts.
3. [ ] Run `node --test scripts/build-changelog.test.mjs scripts/branding.test.mjs` and `node scripts/build-changelog.mjs`, and read the generated copy for accuracy.
4. [ ] Run `py -3 check-doc-ids.py`.

**Done when:** both changelog commands and the doc-id check exit 0 and every listed document reflects the delivered behavior.

## Task 13: Run the full local checks

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
2. [ ] Run a targeted mutation sweep over the diff in the shared mutants worktree: `cargo mutants --in-place --in-diff <diff-file> --package terri-core --package terri-data --package terri-sim`. Each surviving mutant in day counting, rent tiles, use and trip counting, bill amounts, payment order, late fees and the cap, the moodlet, the night premium, the bed checks, the schema-twenty validation, the pay migration or the compiler refusals gets a test or a written reason in the verification record.
3. [ ] Check `git ls-files --eol` for every changed file and `git status` for a clean tree.

**Done when:** every command exits 0, the mutation results are recorded, and the tree is clean.

## Task 14: Play the build and obtain a visual review

**Files:** selected screenshots under `docs/evidence/` as its README directs, and the verification record.

1. [ ] Start or reuse the project's preview servers on 5174 and 4173 only. Confirm the served bundle is this branch's before looking.
2. [ ] Play at desktop width and at 375 by 812, muted where possible, per [Testing Protocol, section 9](../../testing-protocol.md#9-every-milestone-ends-with-a-played-visual-pass), covering every point of [WB-played]. To reach an overdue bill quickly, play a household whose only worker quits on Day 1, or load a save prepared by a scratch example and written into the page's save slot.
3. [ ] Inspect each saved screenshot at full size and write what it shows, including the Bills row's width at 375 pixels. File findings in `docs/alpha-feel-notes.md` with this milestone's entry, fixed or deferred with a reason.
4. [ ] Give a fresh independent reviewer the [WB-played] points and the captures without an expected verdict. Resolve every disagreement and finding, then inspect the same images yourself.
5. [ ] Close every task-owned page in a `finally` block and stop task-owned servers.

**Done when:** every [WB-played] point has an inspected screenshot and a written finding, the independent review is recorded, and no task-owned page or server remains open.
