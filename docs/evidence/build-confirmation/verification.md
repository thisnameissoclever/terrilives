# Build confirmation verification

Observed 2026-10-13 on the Windows desktop worktree `twcx/253-build-confirm-cancel`, based on `04160fe215fb8238e8b9aaff2f8493e7ff6a20d4`. This record covers issue #253. Owner confirmation is still required before merge and issue closure.

## Candidate identity

| File | SHA-256 |
| --- | --- |
| `web/src/main.ts` | `E83729B3A18A697EB380D56AADED86A08412A3EC768C46D612243CBF34ED748A` |
| `web/src/ui/build-session.ts` | `6CF2CF575E4EEE65B66E1F8C23EA73FAC5454D19AF7B2583B537AEDF67585E70` |
| `web/src/ui/build-controls.css` | `A4538EF6FE7EE2C2EBA69129A165C5C1B74F3C71D306B6F2A12F1FFABFFDF48A` |
| Compiled `terri_wasm_bg.wasm` | `BE94B5FE9F22288908941CC7F0CD3AAE6E5206A9FE5B23CA24B819A547F64EF7` |

## Automated checks

| Command | Result | Exit | Verdict |
| --- | --- | --- | --- |
| `cargo test --workspace -j 1` | 1,794 passed before an obsolete assertion rejected newly valid perimeter solids | 101 | FAIL, corrected below |
| `cargo test -p terri-sim -j 1 placement_invalid_saved_edges_refuse_without_panicking` | Corrected cases cover perimeter doorways and an off-plot solid; one passed | 0 | PASS |
| `cargo test -p terri-wasm -j 1` | 263 unit and four example tests passed; one private-save test ignored | 0 | PASS |
| `cargo test --workspace --doc -j 1` | Four crate documentation-test targets completed; zero tests | 0 | PASS |
| `cargo fmt --all -- --check` | No formatting differences | 0 | PASS |
| `cargo clippy --workspace --all-targets -j 1 -- -D warnings` | Finished without warnings | 0 | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` with `CARGO_BUILD_JOBS=1` | Release package built from the final Rust source | 0 | PASS |
| `npm run typecheck` in `web` | No TypeScript errors | 0 | PASS |
| `npm test -- --maxWorkers=1 tests/build-session.test.ts tests/build-session-state.test.ts tests/builder.test.ts tests/builder-controls.test.ts tests/build-context.test.ts tests/room-tool.test.ts tests/wall-tool.test.ts tests/floor-tool.test.ts tests/window-tool-controls.test.ts tests/sky.test.ts tests/options-menu.test.ts` in `web` | 219 tests passed | 0 | PASS |
| `npm test -- --maxWorkers=1` in `web`, with `NODE_OPTIONS=--max-old-space-size=2048` and native compilation idle | 2,277 passed; one atlas lookup test timed out | 1 | FAIL |
| `npm run build` in `web` | Production bundle built; existing large-chunk advisory remains | 0 | PASS |
| `python check-doc-ids.py` | Documentation IDs unique | 0 | PASS |
| `node --test scripts/build-changelog.test.mjs` | 12 passed | 0 | PASS |
| `node scripts/build-changelog.mjs` | Public notes generated | 0 | PASS |
| `git diff --check` | No whitespace errors | 0 | PASS |

Native test coverage totals 2,062 distinct passing tests and one explicitly ignored private-save example. The original workspace command remains recorded as failed; its corrected case and the remaining targets were run separately without repeating 1,302 passing simulation tests.

The full web suite is not green. `tests/atlas.test.ts`, `returns each sprite its own index`, took 7,172 ms against its existing 5,000 ms limit. Atlas source, generator, manifest, test, package files, and test setup are unchanged from the base revision. The linear lookup over 30,887 records makes the exhaustive test perform 477,018,828 name comparisons. No timeout, tolerance, test sampling, or atlas implementation was changed. An untouched-checkout baseline run was not performed. The final small control cleanup was checked by the focused suite and production browser run, not by another full suite rerun.

## Regression and mutation evidence

1. The initial perimeter regression failed with three walls instead of four. Complete physical outlines pass, including all four sides, reversed corners, save/load, and later removal/rebuilding.
2. Replacing the committed-save provider with the draft world failed three state/persistence tests, including `Uint8Array [2]` versus expected `[1]`. Restoring the file passed all four state tests.
3. Removing the rollback load failed confirmed-batch retention (`[3]` versus `[2]`) and rejected-rollback handling. Restoring the file passed all four state tests.
4. Removing the physical doorway guard accepted invalid saved perimeter doorways; the regression failed with `Ok(())` versus `Err(InvalidGrid)`.
5. Removing rear-perimeter full-height rendering failed both renderer regressions. Restored renderer suites passed 31 tests.
6. Disabling explicit perimeter editing failed removal of a confirmed room wall. Removing implicit rear-shell protection incorrectly permitted its removal. Both native mutations exited 101 and were restored.

Every temporary source mutation was restored byte-for-byte and checked with SHA-256. The restored perimeter, room, wall, saved-architecture, and yard migration suites passed. These targeted mutations do not substitute for the remote mutation sweep.

## Production browser checks

Playwright exercised the built bundle through a task-owned localhost preview. Game sound was muted. Each task-owned browser page was closed in a `finally` block, and the preview server was stopped after verification.

1. Creating a wall produced `Wall built.`. Cancel restored `No wall on this line.`.
2. Confirm retained the wall. Changing it into a doorway and choosing Exit build restored `A wall stands on this line.` on re-entry. Escape also reverted the later doorway edit.
3. The Room tool built and confirmed a room reaching the south plot boundary. The far wall existed, could be removed, and was restored by Cancel.
4. At 1280 by 900, 390 by 844, and 844 by 390, Cancel preceded Confirm at the bottom of the flyout. Both buttons had positive dimensions, remained inside the viewport, and were the actual hit targets at their centers.
5. Inactive window controls remained hidden on both compact layouts. The window-placement label is Place Window.
6. The browser console reported only a missing `favicon.ico` response, not an application exception.

Final captures: [desktop](desktop.png), [phone portrait](phone.png), [phone landscape](landscape.png), and [confirmed perimeter room](perimeter-room.png). These demonstrate the candidate; they do not constitute owner approval.

## Review and delivery boundary

Independent static review found an unchanged furniture preview incorrectly blocking a recolor confirmation and confirmed perimeter walls initially being unremovable. Both findings were corrected and reviewed again with no remaining actionable findings. Review did not replace runtime tests.

The branch is linked to #253; delivery uses a draft pull request. Merge and issue closure remain withheld until the owner confirms the fix. The atlas full-suite failure must remain disclosed when assessing merge readiness.
