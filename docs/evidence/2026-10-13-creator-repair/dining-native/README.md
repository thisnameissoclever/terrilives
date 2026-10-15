# Dining setting completion repair

The normal queued cook action reproduced the reported defect: a diner occupied physical setting 1, then its completed dish received setting 0. The native repair preserves the occupied setting through completion. Rebuilt-WASM game verification remains part of the root integration pass.

`tick_chain_steps` queued reservation release before `domestic::completed`. Release removed `SavedDiner`. The terminal closure also removed `ActiveRecipe`, which includes the `ChainState` needed to recognize a dining claim. Moving reservation release alone would therefore leave another cause of the same loss.

The completion system now captures the setting while the claim and recipe still exist, matching both the completing Sim and its exact station. It passes that value to dish creation after the existing teardown. Reservation and cancellation order, random draws, and save schemas are unchanged. Standing meals without an assigned setting retain the existing assignment path.

The impact scan found two production calls to `domestic::completed` in `systems/chain.rs` and two direct plating calls in `domestic/tests.rs`. All four were updated. The plating tests supply no dining setting. The pre-fix source copies retain the existing worktree edits present when this subtask started; `final-source-hashes.json` identifies the tested source after formatting.

## Verification

Commands ran from `D:/VIBES/.worktrees/5637/terrilives`.

| Check | Exact command | Result | Evidence |
| --- | --- | --- | --- |
| Behavioral red | `cargo test --locked -j 1 -p terri-sim dining::completion_tests -- --test-threads=1 --nocapture` | Expected FAIL, exit 101: 2 passed, 1 failed; actual `[(1, 0)]`, expected `[(1, 1)]` | `red.log` |
| Focused green | Same command | PASS, exit 0: 3 tests | `green.log` |
| Final formatted source lifecycle | `cargo test --locked -j 1 -p terri-sim -- dining:: domestic:: reservations:: systems::chain:: --test-threads=1` | PASS, exit 0: 114 tests | `lifecycle.log` |
| Multi-owner release and golden hash | `cargo test --locked -j 1 -p terri-sim -- reservations_tests:: world_hash_matches_its_golden_vector --test-threads=1` | PASS, exit 0: 14 tests | `ownership-and-golden.log` |
| Formatting | `rustfmt --edition 2021 --config skip_children=true --check crates/terri-sim/src/systems/chain.rs crates/terri-sim/src/domestic.rs crates/terri-sim/src/dining.rs crates/terri-sim/src/domestic/tests.rs crates/terri-sim/src/dining/completion_tests.rs` | PASS, exit 0 | Tool output |
| Patch whitespace | `git diff --check -- crates/terri-sim/src/systems/chain.rs crates/terri-sim/src/domestic.rs crates/terri-sim/src/dining.rs crates/terri-sim/src/domestic/tests.rs crates/terri-sim/src/dining/completion_tests.rs` | PASS, exit 0 | Tool output |

The 114-test lifecycle run includes the three new tests. There are 128 distinct passing tests in the final two Cargo runs.

The new tests cover:

1. All six cooking stages through normal queued commands, at all four physical settings and all four table rotations. Each of the 16 cases checks the occupied chair, one attributed table dish, its exact saved setting, its public `dish_piles` visual setting, released reservations, and an immediate exact save/hash round-trip.
2. Paused cancellation during seated eating at the same 16 combinations. It releases the table and chair claims without creating a completed meal dish, then saves and reloads exactly.
3. Another person's setting and another table's setting. Both cases reach seated eating normally, introduce one mismatched claim, then run the actual completion system directly so prior maintenance cannot conceal a missing ownership check. Neither setting is borrowed.

The initial test build had a fixture-only `i32`/`usize` grid-coordinate mismatch, corrected before the behavioral red run. That compiler output remains in `fixture-compile-error.log`.

## Integration follow-up

No WASM rebuild, GPU review, Clippy run, or live-source mutation was performed in this native lane. The root agent reserved the build/review coordination and prohibited production-source mutations while review browsers were live.

For the guard-deletion checks after that boundary, the detecting test is `dining::completion_tests::queued_meal_completion_does_not_borrow_another_person_or_tables_setting`. Independently removing either `diner.person == sim.index_u32()` or the station-equality condition from `tick_chain_steps` should fail that test by borrowing setting 3 instead of retaining the no-claim fallback. Preserve and restore the exact source bytes around each mutation. The baseline red already demonstrates that the normal queued completion test detects the missing setting-transfer mechanism.

Lesson for the root documentation update: completion outputs may need identity that generic teardown deliberately destroys. Capture the exact identity before releasing ownership and removing activity state. Test the first post-completion state through the normal scheduler, including cancellation and save/load boundaries.
