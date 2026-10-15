# Cleanliness mechanics checks

The shared response curve and its mood, annoyance and daily-duty consumers are
implemented. The save/load fixture failure below was corrected, and the full
scoped native checks pass. Browser acceptance remains a separate check.

Every Cargo command below used `--locked -j 1` and the test argument
`--test-threads=1`.

| Command | Result | Log |
| --- | --- | --- |
| `cargo test --locked -j 1 -p terri-sim cleanliness_ -- --test-threads=1` before implementation | Expected FAIL, exit 101: four new behavior regressions failed; four existing tests passed | `cleanliness-red.log` |
| `cargo test --locked -j 1 -p terri-core cleanliness:: -- --test-threads=1` | PASS, exit 0: 2 tests | `core-green.log` |
| `cargo test --locked -j 1 -p terri-sim cleanliness_ -- --test-threads=1` after first implementation | PASS, exit 0: 8 tests | `cleanliness-green.log` |
| `cargo test --locked -j 1 -p terri-sim chores:: -- --test-threads=1` | FAIL, exit 101: 51 passed, 2 failed; both failures subsequently pass in focused checks | `chores-first.log` |
| `cargo test --locked -j 1 -p terri-sim domestic:: -- --test-threads=1` | Historical FAIL, exit 101: 46 passed, 3 failed; all three subsequently resolved | `domestic-first.log` |
| `cargo test --locked -j 1 -p terri-sim cleanliness_ -- --test-threads=1` after adding boundary coverage | FAIL, exit 101: 12 passed, 1 failed | `cleanliness-final.log` |
| `cargo test --locked -j 1 -p terri-sim grime_mood_scales_above_tolerance_even_without_dirty_floors -- --test-threads=1` | PASS, exit 0: 1 test | `grime-final.log` |
| `cargo test --locked -j 1 -p terri-sim complaints_are_directional_once_per_visit_and_stronger_for_neat_people -- --test-threads=1` | PASS, exit 0: 1 test | `complaints-final.log` |
| `cargo test --locked -j 1 -p terri-sim mess_diagnostics_survive_full_tick_and_report_clamping -- --test-threads=1` | PASS, exit 0: 1 test | `diagnostics-final.log` |
| `cargo test --locked -j 1 -p terri-sim dirty_settings_force_standing_and_complain_only_once_across_interruptions -- --test-threads=1` | PASS, exit 0: 1 test | `obstruction-final.log` |
| `cargo test --locked -j 1 -p terri-sim daily_choices_are_saved_once_and_do_not_reroll_after_personality_edits_or_load -- --test-threads=1` | PASS, exit 0: 1 test | `decisions-final.log` |

Scoped `rustfmt --check --edition 2021 --config skip_children=true` passed with
exit 0 over `cleanliness.rs`, `domestic.rs`, `domestic/tests.rs`, and the edited
chores files. `format.log` is empty because the check reported no differences.

## Resolved fixture review

`crates/terri-sim/src/domestic/tests.rs` contains
`cleanliness_same_pile_crossing_and_visit_memory_survive_save_load`. Its first
`loaded.load_snapshot_v6(sim.save_snapshot_v6()).unwrap()` originally returned
`SaveError::InvalidValue`.

The original fixture used `household()`, moved the observer to the counter
position, set cleanliness to zero, created a two-unit foreign dish pile, and
made the people busy with internal cooking chains before ticking and saving.
The intended assertions grow the same pile to three units, require one owner
reaction, then prove repeat ticks and reloads preserve visit memory and the
random stream. The corrected fixture now reaches and passes those assertions.

Three observed failures triggered the fresh-review rule:

1. The initial domestic suite rejected the fixture with `InvalidValue`.
2. Running the already built test binary with
   `--exact domestic::tests::cleanliness_same_pile_crossing_and_visit_memory_survive_save_load --test-threads=1 --nocapture`
   confirmed the same error, exit 1.
3. Replacing bare `ChainState::begin(0)` with the complete
   `recipe_actions::internal(pack, 0)` bundle still returned `InvalidValue`
   during the focused Cargo run. Missing recipe origin was a hypothesis, not a
   confirmed cause.

A `better-way` review initially could not start because all agent slots were
occupied. After the worker returned, the parent obtained fresh review and fixed
the fixture as described below. Save validators remain unchanged.

## Scope and remaining proof

No dependency, save-schema, skills, commit or push changes were made. The new
response adds no saved state or random draws. Tests cover thresholds at
cleanliness 0, 0.5 and 1, room dilution, unchanged maxima, collective dish load,
actual owners, daily-decision draws, urgent needs, bin cutoff and explicit small
cleanup orders. Existing lifecycle tests passed during the scoped suites.

The parent owns WebAssembly integration and live browser acceptance. The latest
complete native scopes passed before the additional review tests below:

| Command | Result | Log |
| --- | --- | --- |
| `cargo test --locked -j 1 -p terri-core cleanliness -- --test-threads=1` | PASS, exit 0: 2 tests | `../integration/core-cleanliness.log` |
| `cargo test --locked -j 1 -p terri-sim domestic::tests -- --test-threads=1` | PASS, exit 0: 49 tests | `../integration/domestic.log` |
| `cargo test --locked -j 1 -p terri-sim chores:: -- --test-threads=1` | PASS, exit 0: 53 tests | `../integration/chores.log` |


## Save fixture correction

The fresh review identified two invalid fixture assumptions: an internal cooking origin that the loader correctly rejects, and a person standing on the counter's blocked tile. The corrected fixture uses authored queued cooking commands and walkable floor in the same room. Production save validation remains unchanged.

PASS, exit 0: `cargo test --locked -j 1 -p terri-sim cleanliness_same_pile_crossing_and_visit_memory_survive_save_load -- --test-threads=1`. One test passed, including both save/load boundaries, the exact annoyance value, unchanged random state, and repeat-visit assertions. The fixture review is resolved; full integration checks remain with the parent.

## Review coverage and mutations

Two added credit tests use distinct duty owners and helpers with opposite
cleanliness values. After the helper removes 500 dirt from one surface, 100 dirt
remains on another. A neat owner's duty remains unsettled despite a tolerant
helper; a tolerant owner's duty is covered despite a neat helper. The tests
also preserve the owner's identity and daily decision, record the actual helper
when credit is earned, and keep the remaining dirt intact.

The added obstruction test admits diners through the actual dining code. One
dish blocks a chair, producing a standing claim. At cleanliness zero, the single
dish has no ordinary mess penalty, but the separate obstruction surcharge gives
a mood penalty of exactly 1. Clearing only the claim's obstruction returns the
ordinary penalty to zero while the dish remains.

| Command and code state | Result | Log |
| --- | --- | --- |
| `cargo test --locked -j 1 -p terri-sim cleanliness_group_credit_ -- --test-threads=1`, original production | PASS, exit 0: 3 tests | `owner-helper-green.log` |
| Same command, duty-owner selection replaced with the performer's SimId | Expected FAIL, exit 101: both new tests failed in opposite directions; the old same-person test passed | `owner-helper-mutant.log` |
| `cargo test --locked -j 1 -p terri-sim cleanliness_tolerates_one_dish_but_keeps_its_real_seat_obstruction_penalty -- --test-threads=1`, original production | PASS, exit 0: 1 test | `obstruction-threshold-green.log` |
| Same command, obstruction surcharge changed from 0.5 to 0 | Expected FAIL, exit 101: actual `None`, expected `Some(1.0)` | `obstruction-threshold-mutant.log` |
| `cargo test --locked -j 1 -p terri-sim cleanliness_ -- --test-threads=1`, both production files restored | PASS, exit 0: 16 tests | `cleanliness-review-final.log` |

Both temporary mutations restored the original production bytes in `finally`
blocks. `owner-helper-mutation.json` and `obstruction-threshold-mutation.json`
record matching before/after SHA-256 hashes. Neither mutation remains in the
working tree. This review added tests and corrected this evidence report; it
made no lasting production changes.
