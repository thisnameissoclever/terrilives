# Domestic integration mutation receipts

Each mutation removed the named production mechanism, ran the command below,
observed the pasted assertion failure, and restored the original source bytes
in a `finally` block. SHA-256 values identify those restored bytes at the time
of each check. Later main integration changed some files; these hashes are
restoration receipts, not hashes of the final tree. The release WASM was rebuilt
after restoring the command-preemption mutation.

## Terminal snack recovery

Changed the snack candidate's terminal survival flag to false.

Command: `cargo test -p terri-sim staged_snack_risk_waits -- --test-threads=1`.
Exit: 101. Actual failure:

```text
---- systems::action::staged_snack_tests::staged_snack_risk_waits_for_terminal_recovery_and_includes_counter_travel stdout ----
adjacent fridge cannot feed a Sim before prep and eating finish
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 743 filtered out; finished in 0.01s
```

Restored `systems/action.rs`:
`1f204e1c0cb7465b10c765b240a96aae0a0407fbbe6dd819abc36e9592651bee`.

## Visible snack repetition

Disabled the canonical visible snack row alias for chain habituation.

Command: `cargo test -p terri-sim snack_and_meal_leave_real_dishes -- --test-threads=1`.
Exit: 101. Actual failure:

```text
---- domestic::tests::snack_and_meal_leave_real_dishes_and_every_work_stage_round_trips stdout ----
finishing a snack must affect its visible action's repetition
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 743 filtered out; finished in 0.81s
```

Restored `systems/chain.rs`:
`8ed483bec96d7bf93261a37cd93a47bc733e3fbd605d855e4a146c1ee8e7afba`.

## Interaction command identity

Replaced the bridge's interaction index with zero.

Command in `web/`: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/bridge.test.ts -t "sends the interaction index"`.
Exit: 1. Actual failure:

```text
FAIL tests/bridge.test.ts > SimBridge > sends the interaction index through to the simulation unclamped
AssertionError: expected 8 to be greater than 8.25
Test Files  1 failed (1)
Tests  1 failed | 49 skipped (50)
```

Restored `web/src/bridge.ts`:
`606c5b8e1bf483efb35d7fd1274fc07e4102484383923eee1b6698924fe1b1a4`.

## Player command preemption

Removed `serve_intents` from the simulation schedule and built release WASM.

Command in `web/`: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/bridge.test.ts -t "directs a sim at an object"`.
Exit: 1. Actual failure:

```text
FAIL tests/bridge.test.ts > SimBridge > directs a sim at an object, overriding what it chose for itself
AssertionError: expected 8.5 to be less than 8.25
Test Files  1 failed (1)
Tests  1 failed | 49 skipped (50)
```

Restored `crates/terri-sim/src/lib.rs`:
`ab79eca0b2836c49020c79743de328038bd4db09625d5896e76346c8c3ff606d`.

## Historical clip registration

Changed one already-published idle clip's first frame index.

Command: `python -B -m unittest discover -s assets/sprites/gen -p test_lamp_prefix.py`.
Exit: 1. Actual failure:

```text
FAIL: test_keeps_prior_registration_and_interaction_metadata (test_lamp_prefix.LampPrefixTests.test_keeps_prior_registration_and_interaction_metadata) (table='RIGGED_SIM_CLIPS')
AssertionError: 'f0951460c80125bcd85d23e179d0a6ecad96875a3496a8b58e8ea1fd5470bb0e' != 'd8ec8a721fc7a86da06d15eb2ee23127063032ad3582c369ee32a4a881648d7e'
Ran 2 tests in 0.389s
FAILED (failures=1)
```

Restored `web/src/render/atlas.ts`:
`04be26b4bda4bcebc1a7d62f5cccb2853c0b7e11b46bfb223145238e2542223a`.

## Authored cooking activity

Restored the generic pose activity override that masked authored preparation,
cooking and washing metadata.

Command: `cargo test -p terri-sim every_shipped_chain_step_projects_activity -- --test-threads=1`.
Exit: 101. Actual failure:

```text
---- activity_tests::every_shipped_chain_step_projects_activity_only_while_running_at_its_exact_station stdout ----
assertion `left == right` failed: cook_dinner step 1
  left: (7, 10)
 right: (22, 10)
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 752 filtered out; finished in 0.00s
```

## Exact table collection claim

Changed the cleanup helper's exact saved surface comparison to an impossible
entity, removing activity recognition at the actual table collection step.

Command: `cargo test -p terri-sim cleanup_collects_each_surface -- --test-threads=1`.
Exit: 101. Actual failure:

```text
---- domestic::tests::cleanup_collects_each_surface_and_washes_only_its_claimed_dishes stdout ----
assertion `left == right` failed
  left: 7
 right: 17
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 752 filtered out; finished in 0.50s
```

Both final activity checks restored `crates/terri-sim/src/lib.rs`:
`9f08858a19c666e1d656477b1b6570124b34bb54459ce92bf765de7dbf937f61`.
The normal activity and cleanup regressions passed afterward, including table
collection metadata after save/load.
