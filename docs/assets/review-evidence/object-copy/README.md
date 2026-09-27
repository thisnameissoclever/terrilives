# Object identity verification

Local verification on 2026-09-22 for the first three object identities. These are local checks for `twcx/object-type-and-description`; the PR records remote CI and merge status. After the preview, the owner directed this slice to be shipped on 2026-09-22.

## Automated checks

All commands below exited 0 unless explicitly marked as an intentional mutation failure.

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace --quiet` | PASS, 1,076 tests |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS |
| `npm --prefix web run typecheck` | PASS, including final hover-boundary change |
| `npm --prefix web test -- --maxWorkers=1` | PASS, 78 files and 1,161 tests after the hover-boundary fix and integration of then-current main |
| `npm --prefix web test -- --maxWorkers=1 tests/object-identity.test.ts tests/buy-tool.test.ts tests/object-menu.test.ts` | PASS, 83 tests after the final hover-boundary change |
| `npm --prefix web run build` | PASS, including final hover-boundary change |
| `python check-doc-ids.py` | PASS |
| `git diff --check` | PASS |

Two temporary mutations demonstrated that the important compatibility checks can fail. Disabling blank-text rejection failed `object_identity_round_trips_and_rejects_blank_copy` with exit 101. Including descriptions in the save digest failed `the_fingerprint_allows_names_art_balance_and_string_table_reordering` with exit 101. Both files were restored byte-for-byte, and each targeted test then passed with exit 0.

## Browser checks

Playwright used isolated browser contexts against this checkout's production preview at `https://localhost:4173`. Existing household saves and the other worktree's server on port 5174 were left alone.

1. Desktop: type, model and description appear separately. Hover opens the description; Shift+Tab reaches it from the first action, Enter pins it, Tab preserves it, and Escape closes the menu.
2. Pointer movement: moving from the description onto the first action retains expansion. The action rectangle remained exactly `x=645, y=605, width=216, height=44` before and after traversal, and clicking it closed the washing-machine menu as intended.
3. Touch at 390 by 844: tapping the summary opens the description; tapping again closes it.
4. Short screen at 320 by 360: the expanded menu fits within the viewport and retains the summary position. The menu is scrollable if needed.
5. Buy controls: all three models have the correct type and description; selection changes replace the details, filtering clears an excluded selection, and redraws retain expansion. Prices remain 300, 140, and 120 respectively for the washing machine, armchair, and dining table.
6. Mobile Buy layout: the disclosure has no horizontal overflow after making the rotating arrow square.

## Screenshots

1. [Washing-machine menu](washing-machine-menu.png)
2. [Desktop shop](washing-machine-shop.png)
3. [Touch menu](mobile-washing-machine.png)
4. [Short screen](short-screen-description.png)
5. [Mobile shop](mobile-shop.png)

The screenshots show local browser output. The owner directed the implementation to be committed, pushed, and merged after receiving the copy and menu preview.

## Delivery

PR [#122](https://github.com/thisnameissoclever/terrilives/pull/122) merged as `6573e7973a14237313053e939798aaca02c5eda6` on 2026-09-22. Nine remote jobs had passed and mutation shard 0 was still pending when the owner explicitly directed the merge. The pending full mutation sweep is distinct from the passing local targeted mutation checks.
