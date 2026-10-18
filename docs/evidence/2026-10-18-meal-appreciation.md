# Meal appreciation verification, October 18, 2026

Branch: `twcl/275-meal-appreciation`, based on `861fae2eb`. This record covers the local implementation prepared for coordinating review. The specification is [meal-sharing appreciation](../specs/2026-10-18-meal-appreciation.md).

## Behavioral tests

The initial focused run exited 101 with an actual opinion of `0.0` against the expected `0.009` in both positive appreciation tests; its exclusion test passed. The implemented completion effect then passed all seven focused tests:

1. `meal_appreciation_eater_thanks_the_actual_cook_once`
2. `meal_appreciation_each_shared_eater_thanks_only_the_cook`
3. `meal_appreciation_excludes_own_meals_snacks_and_uneaten_food`
4. `meal_appreciation_changes_only_eater_opinion_within_one_meal`
5. `meal_appreciation_clamps_disliked_cooks_and_new_batches`
6. `meal_appreciation_plate_collection_and_abandonment_grant_nothing`
7. `meal_appreciation_never_inserts_a_self_relationship`

`a_shared_meal_feeds_only_three_hungry_friends_at_distinct_table_positions` also counts exactly one cook-directed appreciation event for each invited eater while continuing from a loaded snapshot after every tick. This exercises the real scheduler and existing save continuation, including before and after portions finish.

`meal_appreciation_tuning_is_finite_bounded_and_preserves_save_identity` pins the shipped gain, rejects invalid values and checks that changing the gain leaves the structural content fingerprint unchanged. The existing schema omission tests require the new knob. The appended-slot test pins its encoding location.

The one-meal isolation test compares appreciation enabled against gain zero. Restoring only the eater's original opinion makes both complete snapshots and world hashes equal, including needs, cleanup, meal records, timing and random state. Diagnostics are observations rather than behavioral state.

## Fixture classification

The inherited runtime fixture changes only by the four-byte tuning float appended after the existing autonomy tuning. Its length changes from 23,008 to 23,012 bytes. This is an encoding change, not a world-state or save-format change.

| Fixture | Previous SHA-256 | New SHA-256 |
| --- | --- | --- |
| `crates/terri-data/tests/fixtures/inherited-runtime.pack` | `d6bb03b7a27253a13e0b9581786ea96f0ba428096afb25ab2309ba6205ca36c5` | `6ff17b687b515239ac1367b1ee0c01bf9f36317295a9bd315a6d7f6bb7a6cfa5` |

Regeneration command: `TERRI_WRITE_RUNTIME_FIXTURE=1 cargo test -p terri-data --test inherited_runtime`, using a process environment variable in PowerShell. The generator test proves that removing precisely those four bytes recovers the complete previous fixture. All three integration tests passed with exit code 0. Existing frozen published wire witnesses remain unchanged and explicitly reconstruct zero appreciation.

The first full workspace run exited 101 with an incorrect new byte-difference expectation: `0.125f32` differs from zero in only one byte. The corrected test uses `0.1875f32`, whose two changed byte positions are pinned. No production encoding changed to satisfy this assertion.

The first build after adding the required knob exited 101 and refused historical source that lacked it. Historical source expansion now explicitly supplies zero, while live source omission remains an error. Frozen source files were not edited. The final historical-content and save suites passed.

## Review

An independent read-only reviewer inspected the completion path, duplicate protection, save provenance, deterministic behavior and fixture proof. The reviewer found an obsolete sentence denying cooking gratitude in `SIM-RELATIONSHIPS.md`; that sentence was corrected. The follow-up review found no further issues. Execution evidence belongs to the checks below, not to that static review.


## Native and build checks

| Command | Exit | Result |
| --- | --- | --- |
| `cargo fmt --all -- --check` | 0 | Formatting passed. |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | Workspace and all targets passed with warnings denied. |
| `cargo test --workspace` | 0 | 2,460 passed, 0 failed, 1 ignored documentation test. |
| `py -3 check-doc-ids.py` | 0 | IDs unique and allocation-free. |
| `node --test scripts/build-changelog.test.mjs` | 0 | 12 passed, 0 failed. |
| `node scripts/build-changelog.mjs` | 0 | Public page generated locally. |
| `npm ci` in `web` | 0 | 48 packages installed; lockfile unchanged. Audit reported 2 moderate and 2 high vulnerabilities; no dependency changes made. |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | 0 | Final release wasm built and optimized after the schema adjustment. |
| `npm run typecheck` in `web` | 0 | TypeScript passed. |

No native golden world hash, structural content digest, saved action manifest, historical save bytes or frozen published pack witness changed. The native world-hash and wasm save-encoding golden tests passed unchanged. Gameplay worlds can diverge after a shared eater gains the new opinion; that is the intended social behavior, distinct from the runtime pack's encoding change.

The first web-suite run reported no completed file after nearly six minutes and was stopped using only verified task-owned process identities. Its wrapper returned -1. Isolated action-intent and audio-controller runs passed 8 and 254 tests respectively with exit code 0. A fresh full run uses the same one-worker and 20-second test limits plus a temporary progress reporter in the parent scratch folder. The initial delay's cause was not established; no dependency or test-expectation change was made for it.

Full output, diagnostic CPU profiles and the temporary progress reporter remain in the parent scratch folder, outside the repository. Native logs use `meal-workspace-final.log`, `meal-clippy-final.log`, `meal-fmt-final.log` and `meal-doc-ids-final.log`; other check logs use the `meal-` prefix. No browser or development server was started.


## Final web result and handoff

`npx vitest run --maxWorkers=1 --testTimeout=20000 --reporter=default --reporter=../../meal-progress-reporter.mjs`, run in `web`, exited 0: 270 files passed, 3,732 tests passed, none failed or skipped. Duration: 676.77 seconds. The added reporter only logs file start and completion; it lives outside the repository. The final log is `meal-vitest-final.log` in the parent scratch folder. Release-WebAssembly world-hash and bridge checks passed with their existing expectations; no wasm golden value was edited.

The staged text files report `i/lf w/lf` through `git ls-files --eol`. Staged whitespace and prohibited-dash checks pass. No dependency, lockfile, historical save, generated wasm or review video is included. The specification marks balance and other discretionary gameplay rules for owner confirmation. The coordinating session owns review and shipping; this task only creates a local commit and does not push, merge or open a pull request.
