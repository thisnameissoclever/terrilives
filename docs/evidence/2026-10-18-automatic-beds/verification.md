# Automatic beds and condition help verification

Observed 2026-10-18 in the Windows desktop worktree, starting from `10ced796b` and integrated with main `2b15dcfea` in `9cafc745d`. `source-hashes.json` identifies the inspected sources and release WebAssembly build.

## Simulation evidence

The three initial automatic-assignment tests failed with missing assignments before implementation. They passed after implementation: distinct double-bed places and individual -20 mood penalties; preservation of a manual assignment and automatic selection after clearing; unreachable place rejection and claims on newly added beds.

The actual game started with Tim and Bill assigned to distinct double-bed places and Casey assigned to the supported lower bunk. Selling that bunk in the task-owned paused test world and advancing one tick left Casey with `No assigned bed -20`. Tim and Bill kept their assignments and had no missing-bed condition. The condition contributes to overall mood. Sustained mood affects life satisfaction through the existing shared calculation.

## Interface evidence

The inspected actual game used `http://127.0.0.1:5194/?stress=0&audio=0`, with simulation paused. The viewport sizes were 1280 by 900 and 390 by 844. Audio was disabled for this task-owned page.

1. `desktop-number-help.png`: the Low spirits -18 number shows its signed mood effect and the mood range in short, literal text. The tooltip is legible above the selected row.
2. `missing-bed-condition.png`: Casey's missing-bed condition shows -20. The explanation agrees with that value.
3. `phone-number-help.png`: the condition label and number remain visible, and the explanation fits inside the phone viewport.

Real pointer checks confirmed that labels and the empty middle of the row show no help, while number hover shows help. Keyboard focus shows the explanation. Escape dismisses help while keeping Sim details open. Selection changes dismiss help. Live score updates change the explanation. Removing a condition closes its help. The controller retains one tooltip element.

A browser fault check expanded a numeric span to fill the row gap. The same gap check rejected that target. Restoring the span restored the passing result. This probe changed only task-owned browser styles.

An independent reviewer inspected all three captures and found no actionable visual defects. Code review identified repeated ownership scans, Escape ordering, selection cleanup and an unrelated encoding error; the corrections passed the reviewer's recheck. The revised tooltip text passed the banned-phrase and prose-structure scans.

The final integrated browser captures reported no console errors. The task-owned page and preview server were closed after verification.

## Deterministic ownership fault check

Deleting the stable-person sort made `automatic_assignment_uses_person_identity_after_entity_order_changes` fail: person zero had no assignment instead of the expected first place. The command exited 101. The source was restored byte for byte to SHA-256 `534bd78f0056b83392cd3361e00b11c5986f76feb6bc865a819dccaaee173865`. The six automatic-assignment tests passed with the restored mechanism.

## Save and construction checks

The broad pre-integration web run passed 3,734 tests and failed one window test. The broad native run passed 1,613 simulation tests and failed three cases: the grief fixture's unassigned bed affected its expected mood; a frozen V10 window test compared newer conversation state omitted by V10; and the V5 worker continuation compared newer state omitted by V5. The grief fixture now includes a reachable bed. Historical snapshot assertions remain, while exact current continuation uses the current format or the same historical migration on both sides.

The window failure exposed validation of owned reading before restoring its journey. Complete window validation now runs after V6 restores reading and social ownership, before candidate adoption. Early structural checks and older-format validation remain. The new owned-reading/window transaction regression and all 29 window regressions passed before integration. Independent review found no validation bypass. Upstream V17 player-order continuation was preserved during integration.

On the integrated release WebAssembly build, 281 affected web tests passed across 16 files, covering bed controls and bridge state, mood help, sleeping places, window round-trips, legacy saves, save workers, reading projection, player orders, failure bubbles, and Build sessions. Type checking, the production build, the 12 changelog tests and changelog build passed. The refreshed three captures and repeated pointer/focus checks also passed independent review.


## Final native verification

The integrated workspace run passed 1,731 simulation tests and the core, data and integration suites. The bridge suite exposed one old fixture that expected only the manual bed assignment. Its assertion now includes the two automatic assignments and explicitly preserves the manual assignment. Product code did not change after the simulation suite passed.

After that test-only correction, `cargo test --workspace --no-run --message-format=json` rebuilt the workspace test artifacts. The exact executable paths returned by Cargo were used to run the remaining targets: all 321 bridge tests passed; the migration example passed four tests and skipped its existing opt-in private-save test. That skipped test requires an explicitly supplied private save path. Workspace documentation tests also passed. These results combine the unchanged simulation suites with the rebuilt bridge and example targets; the original broad invocation itself exited with the old fixture failure.

Rust lint with warnings denied, formatting, 24 CI script tests and documentation identifiers passed. Full web coverage remains the earlier 3,734 passing tests plus one repaired failure; the final integrated browser build passed the 281 affected tests described above.
