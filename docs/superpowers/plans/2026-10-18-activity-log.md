# Activity Log and Richer Conversation Topics Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for the simulation tasks, which share one resource and one schedule. If the owner chooses delegated implementation, use `superpowers:subagent-driven-development` with explicit file ownership per task. A ticked box marks a step done on the activity log branch.

**Goal:** Give the player a session-only activity log with seven filters and a selected-housemate view (phase 1), then give conversations player-readable topics, separate topic identity from activity codes and add subjects such as trains and bicycling (phase 2).

**Architecture:** The simulation stages fixed-size numeric records in an unsaved, unhashed resource, copying values it already computes. The shell drains them once per frame into a bounded typed-array store and composes text only while the panel is open. Phase 2 moves topics into content and derives subject interests without saved state.

**Tech stack:** Existing Rust simulation and content compiler, the WebAssembly bridge, the TypeScript shell and Vitest. No dependency changes.

**Spec:** [Activity log and richer conversation topics](../../specs/2026-10-18-activity-log.md). Read the whole specification first; this plan cites its sections by id.

## Contents

- [Global constraints](#global-constraints)
- [Review focus](#review-focus)
- [Phase 1: the log](#phase-1-the-log)
- [Task 1: Add the log resource, record and bounds](#task-1-add-the-log-resource-record-and-bounds)
- [Task 2: Route relationship effects and log annoyance](#task-2-route-relationship-effects-and-log-annoyance)
- [Task 3: Log actions, chats and fights](#task-3-log-actions-chats-and-fights)
- [Task 4: Report skill level-ups](#task-4-report-skill-level-ups)
- [Task 5: Log chores](#task-5-log-chores)
- [Task 6: Log careers and deaths](#task-6-log-careers-and-deaths)
- [Task 7: Measure volume on current main](#task-7-measure-volume-on-current-main)
- [Task 8: Export the log across the wasm bridge](#task-8-export-the-log-across-the-wasm-bridge)
- [Task 9: Build the shell store and line composer](#task-9-build-the-shell-store-and-line-composer)
- [Task 10: Build the panel](#task-10-build-the-panel)
- [Task 11: Prove the performance budget](#task-11-prove-the-performance-budget)
- [Task 12: Update documentation and the changelog](#task-12-update-documentation-and-the-changelog)
- [Task 13: Deliver phase 1](#task-13-deliver-phase-1)
- [Phase 2: richer topics](#phase-2-richer-topics)
- [Task 14: Move topics into content](#task-14-move-topics-into-content)
- [Task 15: Separate topic identity from activity codes](#task-15-separate-topic-identity-from-activity-codes)
- [Task 16: Derive subject interests](#task-16-derive-subject-interests)
- [Task 17: Offer subjects in conversations](#task-17-offer-subjects-in-conversations)
- [Task 18: Show topic words and subject interests](#task-18-show-topic-words-and-subject-interests)
- [Task 19: Deliver phase 2](#task-19-deliver-phase-2)

## Global constraints

1. This document proposes implementation. Implementation, merge and deployment need the owner's authorization. Phase 2 Tasks 16 to 18 also need the owner's answers to [Q1], [Q2], [Q3] and [Q5] in the specification's [AL-questions].
2. Before starting, fetch origin and confirm the branch contains current main with `git fetch origin && git log --oneline -1 origin/main`. If main has moved past `10ced796b`, re-read the files each task names before editing them; the line references in the specification describe that revision.
3. The log must never change the simulation. No `SimRng` draw, no component insert or removal, no new component, no change to schedule order, no entry in `Sim::world_hash`, no field in any save. Task 1's equality test runs again at the end of every simulation task.
4. Phase 1 does not change the save schema, the content digest, the save manifest or any golden hash. If a golden or pinned hash moves in phase 1, the change is a defect: stop and find it.
5. Keep every new player-visible string in `web/src/ui/activity-log-words.ts` and the specification's [AL-strings]. Do not invent wording elsewhere. The owner reviews it beside a running build per lesson L58.
6. Run Rust tests with one test thread and Vitest with one worker. Do not overlap heavy builds and test runs, and leave other sessions' processes alone.
7. Rebuild the wasm package before web tests whenever Rust or content changed: `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
8. Never commit review videos or animated substitutes. Close task-owned browser pages and preview servers in a `finally` block, with the game muted.
9. Write all documentation and commit messages without em or en dashes, in American English.

## Review focus

1. A record emitted inside a system must not change what that system or a later one does. Tasks 1 to 6 own the enabled-versus-disabled equality proof; the reviewer should try to break it with archetype churn and with a paused-frame command drain.
2. A child must attach to the right parent: a chore credit to the performer's completing action in the same tick, appreciation to the credit, meal appreciation to the eater's finished meal, a level-up to the action that crossed it. Tasks 1, 3, 4 and 5 own the link tests.
3. A Load, a Build confirm and a Build cancel must neither lose nor repeat staged records. Tasks 1 and 8 own these proofs.
4. A stale typed-array view during label lookups must not lose records (lesson L72). Task 8 owns the detach test.
5. The panel must allocate nothing per frame while closed and nothing per frame without new records while open. Task 11 owns the allocation profile.
6. Phase 2 must keep every published save loading and every old topic drawing the same art. Tasks 15 and 17 own these proofs.

## Phase 1: the log

Phase 1 ends with a mergeable branch: the log, the panel, the performance evidence and the played pass, with no topic changes.

## Task 1: Add the log resource, record and bounds

**Files:** Add `crates/terri-sim/src/activity_log.rs` and `crates/terri-sim/src/activity_log_tests.rs`. Edit `crates/terri-sim/src/lib.rs` (module declaration, resource insertion in `Sim::new_with_content` beside `CompletionSounds`, end-of-tick hooks in `Sim::tick` and `Sim::flush_commands`, accessors) and `crates/terri-sim/src/build_transaction/ordinary_runtime.rs` (`copy_feedback`).

**Interfaces:** `pub struct LogRecord([u32; 12])` with named accessors; `pub enum LogKind` with the twelve kinds of [AL-record]; trigger constants `ACTIONS = 1`, `CHORES = 2`, `SOCIAL = 4`, `SKILLS = 8`, `CAREER = 16`. `#[derive(Resource)] pub struct ActivityLog` holding a preallocated ring of 256 records, `next_seq: u32`, `dropped: u32`, `enabled: bool`, a scratch area keyed by `SimId` in `BTreeMap`s, and the label table. `pub(crate) fn emit(world: &mut World, record: LogRecord)`, a no-op when disabled. `pub(crate) fn finish_tick(world: &mut World)`, which links children to parents and closes ended episodes. `Sim::take_activity_log(&mut self, out: &mut Vec<u32>) -> u32`, `Sim::activity_log_labels(&self) -> &[String]`, `Sim::set_activity_log_enabled(&mut self, bool)`.

1. [x] Build the label table once from the content pack in a fixed order: every object interaction label, every chain label including each time-of-day meal label from `domestic::meal_label`, every social interaction label, every topic tag that `social_episode::tag_code` and `fights::Reason::tag` can produce, every skill label, every career level title and every chore duty kind. Look labels up with a `BTreeMap<String, u32>` built at the same time.
2. [x] Add `staging_ring_overwrites_oldest_and_counts_drops`: emit 300 test records and assert 256 remain, oldest first, `dropped` is 44 and `seq` values are contiguous.
3. [x] Add `link_pass_attaches_children_in_the_same_tick`: emit a parent and children in one tick in both orders and assert `parent` fields after `finish_tick`; a child with no parent in its tick stays a parent.
4. [x] Add `load_starts_an_empty_log`: stage records, save and load through the current public save path, and assert the restored log is empty with `next_seq` 1.
5. [x] Add `build_transaction_carries_staged_records`: stage records, enter Build, confirm and cancel in separate runs, and assert the same records remain exactly once. Add `ActivityLog` to `copy_feedback`.
6. [x] Add `label_table_covers_every_action_and_chain_label` over the shipped pack.
7. [x] Add `activity_log_never_changes_the_world`: run the shipped household for 20 game days (28,800 ticks) twice, enabled and disabled, inducing archetype churn in one run as `hash_ignores_archetype_layout_and_entity_history` does, and compare `world_hash` at every tick and `SimRng` state at the end. It passes trivially now; it becomes meaningful as Tasks 2 to 6 add emitters, and each of those tasks reruns it. As built, the test runs two game days and also pins the two-day hash fold to main without the log, so code that runs in both modes cannot hide; the twenty-day comparison is `activity_log_never_changes_the_world_over_twenty_days`, ignored by default.
8. [x] Run `cargo test -p terri-sim activity_log -- --test-threads=1` and `cargo test -p terri-sim world_hash -- --test-threads=1`.

**Done when:** the tests pass, `world_hash_matches_its_golden_vector` is unchanged, and no simulation system reads `ActivityLog`.

## Task 2: Route relationship effects and log annoyance

**Files:** Edit `crates/terri-sim/src/relationship_effects.rs`, every site that pushes to `RelationshipDiagnostics.effects` (find them with `rg "effects\s*\.push|RelationshipEffect \{" crates/terri-sim/src`), `crates/terri-sim/src/domestic.rs` (`blocked_setting_annoyance`), `crates/terri-sim/src/affinity.rs` (`bother`), `crates/terri-sim/src/systems/interpersonal.rs`, and the log module.

**Interfaces:** `pub(crate) fn record(world: &mut World, effect: RelationshipEffect)` in `relationship_effects.rs`, which pushes the diagnostic and forwards discrete causes to `activity_log`. A new `RelationshipCause::DirtySetting`. A nuisance episode table in the log scratch area keyed by `(affected, responsible)`.

1. [x] Replace every direct push with `record`. The function's match over `RelationshipCause` has no wildcard arm.
2. [x] Record `DirtySetting` effects from `blocked_setting_annoyance`, with requested and actual values computed as the other sites do. Check whether any existing test counts diagnostics and update its expected count with a comment naming this task.
3. [x] Emit kind 4 for HouseholdMess, DirtySetting, PrivacyEntry, PrivacyStart, LowNeedInterruption and CriticalNeedInterruption, carrying the fixture model for privacy incidents where `private_start` and `moved` have it.
4. [x] Turn Nuisance into episodes: open on first appearance, add each tick's actual change, emit one kind 4 record when the pair is absent for a whole tick or the day ends, from `finish_tick`.
5. [x] Hold Conversation, Fight, ChoreFulfilled and ChoreNeglected as kind 8 feelings for the link pass. Drop Proximity, SharedActivity, Incompatibility and Decay, except that SharedActivity and the Social deliveries of Task 3 accumulate per action.
6. [x] Add `every_relationship_cause_is_logged_or_excluded`, `mess_annoyance_logs_each_notice`, `dirty_setting_annoyance_is_recorded`, `privacy_incidents_log_victim_and_intruder` and `nuisance_logs_one_record_per_episode`.
7. [x] Run `cargo test -p terri-sim relationship -- --test-threads=1`, `cargo test -p terri-sim activity_log -- --test-threads=1` and `cargo test -p terri-sim affinity -- --test-threads=1`.

**Done when:** the new tests pass, the equality test passes, and removing the forwarding call from `record` fails the annoyance tests.

## Task 3: Log actions, chats and fights

**Files:** Edit `crates/terri-sim/src/systems/interact.rs`, `systems/chain.rs`, `reading.rs`, `systems/social.rs`, `systems/movement.rs`, `domestic.rs` (`gather_diners`), `social_company.rs` (`tick_meals`), `need_interactions.rs`, and the log module.

1. [x] Emit kind 1 at completion in `tick_interactions`, at the terminal payout in `tick_chain_steps`, and at reading completion in `reading::tick`. Resolve the label through `action_rows` and `ActionRow::label(tick, day_ticks)` at that tick.
2. [x] Reset the Social accumulator where `follow_path` inserts `Eating` or `Socialising` and where the meal countdown starts. Add delivered Social at each per-tick delivery site and SharedActivity opinion changes from Task 2. Mark a record partial when no reset happened since the world was created or loaded.
3. [x] Emit kind 2 at chat completion in `tick_social`, copying the topic and both preferences from `SocialEpisodes.topics` before `social_episode::maintain` runs, and kind 3 for a completed fight. Emit nothing on the disturbed branch.
4. [x] Add `chat_completion_logs_topic_reactions_social_and_opinion`, `fight_completion_logs_reason_and_both_losses`, `interrupted_chat_logs_nothing`, `chain_logs_once_with_the_meal_label` and `table_meal_logs_company_and_social`. The chat test asserts a disliked topic records the listener's `0.02 * preference` loss and a liked one records the gain.
5. [x] Run `cargo test -p terri-sim activity_log -- --test-threads=1`, `cargo test -p terri-sim social -- --test-threads=1` and the equality test.

**Done when:** the tests pass, each chain logs exactly once, and every `practise` call site that marks a completion has a matching kind 1 or kind 2 emission.

## Task 4: Report skill level-ups

**Files:** Edit `crates/terri-sim/src/skills.rs` and its five callers: `systems/interact.rs`, `systems/chain.rs`, `systems/social.rs`, `reading.rs` and `trait_effects.rs`. Search with `rg "practise\(" crates/terri-sim/src` first; update every caller, including tests.

1. [x] Change `practise` to return the skills whose level from `standing` rose, as a small fixed array, without changing the stored practice values or their update order.
2. [x] Forward each rise to the log as kind 9. A chain step's rise links to nothing and stays a parent, because its chain has not completed.
3. [x] Add `practise_reports_levels_without_changing_practice` (compare stored practice against the previous implementation's arithmetic for every shipped skill across the ladder) and `skill_level_up_is_logged_once_per_level`.
4. [x] Run `cargo test -p terri-sim skills -- --test-threads=1` and the equality test.

**Done when:** all callers compile against the new signature, the skills tests pass unchanged, and the new tests pass.

## Task 5: Log chores

**Files:** Edit `crates/terri-sim/src/chores/board.rs` (`reconcile`, `credit`, `tick`) and the log module.

1. [x] Emit kind 5 with kind 6 children for each owner whenever `reconcile` writes new assignments, grouping `SavedChores.assignments` by owner.
2. [x] Emit kind 7 Done or Covered in `credit`, Missed at the day rollover in `tick`, and Skipped where the willingness roll fails. Link Done and Covered to the performer's kind 1 record in the same tick, and the ChoreFulfilled and ChoreNeglected feelings to the outcome.
3. [x] Add `chore_week_logs_one_header_per_owner`, `chore_done_links_to_the_performing_action`, `chore_cover_and_appreciation_are_children`, `missed_chore_logs_neglect_feelings` and `skipped_chore_is_logged`.
4. [x] Run `cargo test -p terri-sim chores -- --test-threads=1` and the equality test.

**Done when:** the tests pass and the chores tests are unchanged.

## Task 6: Log careers and deaths

**Files:** Edit `crates/terri-sim/src/careers.rs` (`review_person`, `search`, `assign`, `quit`), `crates/terri-sim/src/mortality.rs` (`tick`) and the log module.

1. [x] Emit kind 10 in `review_person`, which covers reviews settled late through `complete_shift` and `settle_due_review`. Copy the outcome code, performance, the fit, mastery and mood from `factors()`, the title after the outcome, and the warning that starts at the second consecutive poor week.
2. [x] Emit kind 11 for a successful hire in `search` and for `assign` and `quit` when they are not refused.
3. [x] Emit kind 12 where `mortality::tick` pushes the `DeathRecord`.
4. [x] Add `career_review_logs_outcome_and_factors`, `late_review_after_a_shift_is_logged`, `job_search_hire_is_logged`, `assign_and_quit_are_logged_and_refusals_are_not` and `death_is_logged`.
5. [x] Run `cargo test -p terri-sim careers -- --test-threads=1`, `cargo test -p terri-sim mortality -- --test-threads=1` and the equality test.

**Done when:** the tests pass and the careers and mortality tests are unchanged.

## Task 7: Measure volume on current main

**Files:** Edit `crates/terri-sim/examples/trace.rs` to print record counts per kind per game day and the dropped count, read-only. Add a dated evidence record under `docs/assets/review-evidence/activity-log/`.

1. [x] Run `cargo run --release -p terri-sim --example trace -- 28800` for three seeds the trace supports. Record records per game day by kind, the largest number of records in one tick, the largest in five consecutive ticks, and dropped records.
2. [x] Compare with the research's figures of about 52 events and about 14 mess annoyances per game day. If the largest five-tick count exceeds a quarter of the 256-record ring, raise the ring size in Task 1's constant and its test, and record why.

**Done when:** the evidence record holds the measured numbers with the revision, command and seeds. The specification keeps no counts.

## Task 8: Export the log across the wasm bridge

**Files:** Edit `crates/terri-wasm/src/lib.rs`, add `crates/terri-wasm/src/activity_log_tests.rs`, edit `web/src/bridge.ts`, add `web/tests/activity-log-bridge.test.ts`.

**Interfaces:** wasm exports `activity_log_take() -> u32`, `activity_log_ptr() -> *const u32`, `activity_log_dropped() -> u32`, `activity_log_labels() -> String` and `set_activity_log_enabled(bool)`, as [AL-bridge] defines. Bridge methods `takeActivityLog(into: Uint32Array, at: number): number`, `activityLogLabels(): string[]`, `activityLogDropped(): number` and `setActivityLogEnabled(on: boolean): void`. `takeActivityLog` builds a fresh view and copies before returning.

1. [x] Add `activity_log_take_returns_records_in_sequence_and_empties_staging` and `activity_log_disabled_emits_nothing` in the wasm crate.
2. [x] Rebuild the wasm package. In `activity-log-bridge.test.ts`, run the shipped household until a chat completes and assert the record's fields; decode the label table; detach the memory buffer during the first label lookup and assert no records are lost; load a save and assert the next take starts at `seq` 1.
3. [x] Run `cargo test -p terri-wasm activity_log -- --test-threads=1` and `npm --prefix web test -- --maxWorkers=1 tests/activity-log-bridge.test.ts`.

**Done when:** both suites pass against the freshly built wasm.

## Task 9: Build the shell store and line composer

**Files:** Add `web/src/ui/activity-log-store.ts`, `web/src/ui/activity-log-compose.ts` and `web/src/ui/activity-log-words.ts`. Add `web/tests/activity-log-store.test.ts` and `web/tests/activity-log-compose.test.ts`.

1. [x] Implement the store as one preallocated `Uint32Array` of 2,000 records with a head index and count, a `resetAfterLoad()`, and a drain that throws when `seq` does not increase outside a reset.
2. [x] Implement composition by the rules of [AL-compose], [AL-selected], [AL-group] and [AL-numbers], reading every string from `activity-log-words.ts` and names from a `SimId` to name map refreshed from the household roster.
3. [x] In the compose test, reproduce every example line of [AL-compose] under each filter combination listed, the selected-housemate cases, same-day grouping with its count and summed change, omission of numbers that round to zero, and timestamps at the first and last minute of a day.
4. [x] In the store test, cover the 2,000-record bound, ring wrap, reset and the backwards-sequence error.
5. [x] Run `npm --prefix web test -- --maxWorkers=1 tests/activity-log-store.test.ts tests/activity-log-compose.test.ts` and `npm --prefix web run typecheck`.

**Done when:** the tests pass and no string used by the composer is defined outside `activity-log-words.ts`.

## Task 10: Build the panel

**Files:** Edit `web/index.html` (toggle and panel markup), `web/src/ui/compact-hud.css` (panel, corner and compact rules), `web/src/main.ts` (drain in the per-frame `afterCommands` hooks, `resetAfterLoad` in the Load callback beside `bookResults.resetAfterLoad`, Build hide, mutual exclusion with Options and the Sim sheet, `?activitylog=0`). Add `web/src/ui/activity-log-panel.ts` and `web/tests/activity-log-panel.test.ts`. Extend `web/tests/mobile-hud.test.ts` and `web/tests/compact-hud.test.ts`.

1. [x] Implement [AL-panel]: the `Log` toggle, the non-modal panel modeled on `OptionsMenu`, the `#sim-sheet` structure, `aria-pressed` filter toggles, the selected-person line polled at `needBarRefreshMs()`, the 200-row window with Show earlier entries, the empty states and the scroll rule.
2. [x] Compose and append only new visible lines while open; do no text or DOM work while closed. Guard repeated text writes with `set-text-if-changed.ts`.
3. [x] Correct the out-of-date comment in `web/index.html` that says Options owns the top-right corner.
4. [x] Test toggle state, Escape and focus return, exclusion with Options and the Sim sheet, the Build hide, default filters, filter persistence across a simulated Load, the window bound, and the compact layout query.
5. [x] Run `npm --prefix web test -- --maxWorkers=1 tests/activity-log-panel.test.ts tests/mobile-hud.test.ts tests/compact-hud.test.ts` and `npm --prefix web run typecheck`.

**Done when:** the tests pass and the production build (`npm --prefix web run build`) succeeds.

## Task 11: Prove the performance budget

**Files:** Add `scripts/activity-log-proof.cjs`, reusing the calibration and measurement helpers of `scripts/audio-browser-proof.cjs` by moving them into `scripts/lib/browser-frame-gate.cjs`, and `web/tests/activity-log-proof.test.js` for its verdicts. Edit `web/src/main.ts` to expose the stress-only `activityLogSampler` and the store's counts, and `crates/terri-sim/examples/trace.rs` to time `Sim::tick` and honor `TRACE_ACTIVITY_LOG=0`. Add the results to a dated performance record beside the volume record of Task 7, under `docs/assets/review-evidence/activity-log/`.

1. [ ] Extract the helpers without changing the audio script's behavior. Run `node scripts/audio-browser-proof.cjs performance` before and after the extraction and keep both reports. The extraction is done and `web/tests/audio-memory-report.test.js` passes; the two reports remain, because the audio script's fixed `?stress=1000` page does not finish starting on current main (see the performance record).
2. [x] Implement `performance` and `memory` modes for the log with the thresholds of [AL-perf], each comparing a page against the same page with `activitylog=0`, once with the panel closed and once open with every filter on. Both modes take `--stress N`, with `?stress=1000` the default. That page does not finish starting on current main (GitHub issue 305), so the measurements ran at `--stress 0` and `--stress 100`; the performance record gives each configuration.
3. [x] Take the [V11] sampling heap profile by the procedure in `docs/gpu-verification.md` with the panel closed and open, and attribute allocation by function.
4. [x] Run the native cost comparison. Five trace runs with the log enabled and five disabled, each a separate process, varied by a factor of two on the shared machine (`trace-compare.txt` beside the performance record), so the verdict comes from the `activity_log_cost` example in `crates/terri-sim/examples/` instead: it runs both worlds in lockstep in one process and reports the median chunk ratio and its bootstrap 95 percent interval, for three seeds.
5. [ ] If a threshold fails in both modes, profile the whole frame before changing the log, per lesson L-performance-features-need-a-disabled-baseline. Do not relax a threshold or retry for a favorable sample.

**Done when:** every threshold of [AL-perf] passes, and the evidence record holds the commands, build hash, display calibration, raw results and verdicts.

## Task 12: Update documentation and the changelog

**Files:** `docs/player-visible-strings.md`, `docs/ARCHITECTURE.md` ([D11]), `docs/GAME-SYSTEMS.md` ([F-notifications]), `content/social.toml` (comment only), `docs/changelog/` per the changelog skill.

1. [x] Add an Activity log row to the string inventory listing the proposed strings as awaiting the owner's review.
2. [x] Describe the log projection in [D11]: staged records, one drain per frame, one copy before string calls.
3. [x] Note in [F-notifications] that the log records events a feed can reuse; the feed itself remains unbuilt.
4. [x] Correct the comment in `content/social.toml` that says neutral and disliked partners give no Social refill. TOML comments are not compiled, so the digest does not move; confirm with the terri-data digest tests.
5. [x] Apply `.agents/skills/maintain-changelog/SKILL.md`: add a player-facing note for the Log, then run `node --test scripts/build-changelog.test.mjs` and `node scripts/build-changelog.mjs`.

**Done when:** the documents describe the shipped behavior and the changelog tests pass.

## Task 13: Deliver phase 1

1. [ ] Run the full local checks, in CI order, and record each exit status:
   - `py -3 -B -m unittest discover -s .github/scripts -p "test_*.py"`
   - `cargo fmt --all -- --check`
   - `cargo clippy --workspace --all-targets -- -D warnings`
   - `cargo test --workspace -- --test-threads=1`
   - `py -3 check-doc-ids.py`
   - `py -3 assets/sprites/gen/build.py --check`
   - `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`
   - `npm --prefix web ci`, `npm --prefix web run typecheck`, `npm --prefix web test -- --maxWorkers=1`
   - `node --test scripts/build-changelog.test.mjs` and `node scripts/build-changelog.mjs`
2. [ ] Run targeted mutation checks on the log module: `cargo mutants --package terri-sim --file crates/terri-sim/src/activity_log.rs --test-workspace true --timeout-multiplier 4`. Every surviving mutant is killed by a new test or recorded with a reason.
3. [ ] Perform the played visual pass of [AL-evidence] at both viewports. Check which preview servers are already running before starting one, and reuse them. Record the findings in `docs/alpha-feel-notes.md` under `[A-activity-log]`.
4. [ ] Obtain a fresh independent adversarial review of the final head, including the stills, and resolve every valid finding.
5. [ ] Present the strings of [AL-strings] to the owner beside the running build. Ship only approved wording; if the owner has not reviewed it, the branch waits.

**Done when:** every check passes on the exact head, the review findings are resolved, and the owner has approved the wording.

## Phase 2: richer topics

Phase 2 starts from merged phase 1 and merges separately. Tasks 14 and 15 change no behavior and can merge on their own; Tasks 16 to 18 wait for the owner's answers named in the global constraints.

## Task 14: Move topics into content

**Files:** Add `content/topics.toml`. Edit `crates/terri-data/src/schema.rs`, `crates/terri-data/src/compile.rs` and `crates/terri-data/src/lib.rs` (tests only for the digest).

1. [ ] Define `[[topic]]` with `id`, `label`, `icon`, `kind` (activity, subject or fight), `tags` for activity topics, `sources` and `variation` for subjects, and `reason` for fights. Author one activity topic per tag `tag_code` recognizes today, small talk, and the three fight topics.
2. [ ] Refuse duplicate ids, unknown tags or icons, a fight topic without a known reason, a subject without sources or variation, and weights outside -1 to 1.
3. [ ] Add `topics_do_not_move_the_content_digest`: compile the shipped pack with and without `topics.toml` and assert equal `content_fingerprint` values, with a comment citing L-save-digest-must-follow-post-load-reads and the reason in [AL-topics].
4. [ ] Run `cargo test -p terri-data -- --test-threads=1`.

**Done when:** the compiler tests pass and the digest pins are unchanged.

## Task 15: Separate topic identity from activity codes

**Files:** Edit `crates/terri-sim/src/social_episode.rs`, `crates/terri-sim/src/save/social.rs`, `crates/terri-sim/src/render_buffer.rs`, `crates/terri-sim/src/lib.rs` (the render column fill), `crates/terri-wasm/src/lib.rs` (`conversation_topic_table`), `web/src/bridge.ts`, `web/src/render/conversation-bubbles.ts`, `web/src/frame.ts`.

1. [ ] Give the runtime `Topic` its content row, resolved from the tag when chosen and when loaded. Keep `code` and `tag` as the saved fields, unchanged in value.
2. [ ] Fill `conversation_topics` with the row. Export each row's icon and kind once; build the bubble sprite table from it; keep the strong red tint for fight topics by kind instead of by `code >= 24`.
3. [ ] Add `legacy_topic_tags_keep_their_art`, a web test asserting every tag that existed before this task draws the same sprite index and tint as before, and a native test that saved V16 topics load to the same rows.
4. [ ] Run `cargo test -p terri-sim social -- --test-threads=1`, `cargo test -p terri-sim save -- --test-threads=1`, rebuild the wasm, and run `npm --prefix web test -- --maxWorkers=1`.

**Done when:** no behavior, save byte or hash changes, and the shell no longer interprets a topic number as an activity code.

## Task 16: Derive subject interests

**Files:** Add `crates/terri-sim/src/topics.rs` and its tests. Author the subjects the owner approves in `content/topics.toml`.

1. [ ] Implement `interest(world, person, topic) -> f32` by the formula in [AL-topics], reading only existing values and an FNV hash of `SimId` and the topic id.
2. [ ] Add `subject_interest_is_independent_of_entity_order` (archetype churn between two worlds), `subject_interest_stays_within_range`, and a test per source kind.
3. [ ] Run `cargo test -p terri-sim topics -- --test-threads=1`.

**Done when:** interests are deterministic, bounded and free of saved state and random draws.

## Task 17: Offer subjects in conversations

**Files:** Edit `crates/terri-sim/src/social_episode.rs` (`begin_topics`) and `crates/terri-sim/src/save/social.rs`.

1. [ ] Append subjects after the activity tags, in content order, with the existing weight function and the single draw. Save a subject as code 7 with the tag `subject:{id}`; load a subject missing from content as a generic subject.
2. [ ] Add `topic_draw_spends_one_value_and_includes_subjects`, `subject_topic_round_trips_and_loads_in_the_published_v16_reader` and `missing_subject_loads_as_generic`.
3. [ ] Run the whole Rust workspace. For every golden or pinned hash that moves, classify it by lesson L-fingerprint-fixtures-by-role, confirm its scenario completes a chat, and re-pin it with the reason beside the value. `world_hash_matches_its_golden_vector` and its browser copy must not move.
4. [ ] Measure topic frequencies over 20 game days for three seeds with the trace and add them to the evidence record.

**Done when:** published saves load, every moved hash is classified and explained, and the measured frequencies show subjects chosen without crowding out activity topics.

## Task 18: Show topic words and subject interests

**Files:** Edit `web/src/ui/activity-log-words.ts`, `web/src/ui/activity-log-compose.ts`, and, if the owner approves [Q5], `web/src/ui/affinities-panel.ts` with its bridge read.

1. [ ] Replace the phase 1 tag-to-word table with the content labels exported in Task 15.
2. [ ] If approved, add read-only subject rows to Likes and dislikes using the existing band words.
3. [ ] Extend the compose and panel tests, then run `npm --prefix web test -- --maxWorkers=1`.

**Done when:** every topic in the log reads from content and the tests pass.

## Task 19: Deliver phase 2

1. [ ] Run the full local checks listed in Task 13.
2. [ ] Run targeted mutation checks on `crates/terri-sim/src/topics.rs` and the changed parts of `social_episode.rs`.
3. [ ] Perform the played visual pass with watched subject chats, the Talk symbol tints and the log's topic words at both viewports. Record findings under `[A-richer-topics]` in `docs/alpha-feel-notes.md`.
4. [ ] Obtain a fresh independent adversarial review of the final head and resolve every valid finding.
5. [ ] Present subject names and topic words to the owner beside the running build, update the changelog per the changelog skill, and update the topic descriptions in [S-relationship-dynamics] of `docs/GAME-SYSTEMS.md` and in the conversation topics section of `docs/SIM-RELATIONSHIPS.md`.

**Done when:** every check passes on the exact head, the review findings are resolved, and the owner has approved the subject wording.
