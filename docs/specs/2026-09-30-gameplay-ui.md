# Gameplay UI and furniture corrections

Status: implemented and verified in the gameplay-ui worktree. Played evidence
and remaining owner visual approval are recorded below.

1. Simulation speed lives below Time and Funds in the left sidebar. Build and
   Exit build sit after the household and selected-person panels at the bottom.
   The responsive menu follows the same order. Exit build remains reachable
   during compact-screen editing; tool controls stay in their existing dock.
   Help points to the sidebar and its compact Menu rather than listing Build
   under Options.
2. A selected furniture piece is drawn only at its preview position, including
   refused positions. Its original base, foreground and selection ring are hidden.
   Cancel restores its original presentation without changing the simulation.
   A successful Confirm applies the placement and clears selection, including an
   unchanged placement. A refused command retains selection and explains why.
   Choosing another piece still commits a valid changed preview and selects it.
3. The selected person's current action and queued orders appear at the top right.
   The first card is larger. Labels come from simulation targets and authored
   interactions; only the served occurrence is removed from the waiting list, so
   repeated orders stay separate. A person with no current action shows their
   first waiting order as Next. The cards fade from 33% of viewport height to
   transparency at 55%, and cannot intercept canvas input. Build hides the cards.
   On phones, cards start below the status summary. Opening Menu hides them on
   every compact viewport, including short landscape screens.
   Follow-up: the card width is 192 pixels instead of 240, with padding and text
   reduced to match. Waiting player orders have no count limit, including save
   validation. Front placements preserve every previous waiting order.
   Rendering includes only enough rows for the visible region and one extra;
   the simulation stops before formatting hidden orders, and the bounded WASM
   display query transfers only that prefix. The stored queue remains unlimited.
   The complete query stays available for inspection. Recipe labels use the same row indices
   as the action menu. A suspended recipe cannot mask an active target or commute.
4. Every living household member receives a -20 Not enough beds moodlet while
   usable sleeping places are fewer than people. Occupied beds still count;
   people at work still count. Each placed object's capacity is the largest slot
   count among its sleep-tagged interactions, avoiding duplicate capacity from
   alternate sleep actions. The double bed counts as two; the current bunk
   supports only its lower bed and counts as one. Sofas do not count. The penalty
   clears as soon as there are enough places. Mood remains a read-only projection,
   so there is no new save field or separate clock. After integrating the current
   main branch, this moodlet participates in its existing sustained-mood effect
   on life satisfaction; there is no separate bed-shortage drain.
5. The bookcase's back touches one edge of its tile and rotates around the tile's
   center in quarter turns. Four corrected sprites append to the atlas and the
   bookshelf content selects them. Existing atlas records and gameplay footprints
   remain unchanged. Near cabinet panels cover the books in rear views.
6. Scrollable desktop and short-screen sidebars gain the actual scrollbar width.
   This preserves 220 CSS pixels of usable sidebar width, including when Windows
   uses a non-overlay scrollbar. Phone portrait retains its existing fluid width.

7. Selling the last fridge, stove or preparation surface is allowed. In-use
   commitments still have to finish or be cancelled before a sale. Missing
   remaining recipe stations cause abandonment without payout; autonomy skips
   recipes with missing stations while retaining waits for reserved stations.
8. The Load failed screenshot exposed a historical V1 wire incompatibility.
   A frozen pre-voice entity decoder restores the captured 2,607-byte save at
   tick 157. Known old fingerprints qualify; newer and unknown fingerprints
   cannot claim the old wire shape. Normal transactional world validation still
   applies. The original browser file is retained during verification.
   Tests compare every retained field directly against the historical decoder's
   source before normal layout migration, including random state and funds.

No dependency versions or simulation commands were changed. The current V5
save envelope stays unchanged; older V1 rows receive an explicit migration.

## Verification

All commands ran in the gameplay-ui worktree. Web commands ran in `web/`.

| Check | Result | Exit |
| --- | --- | --- |
| `cargo fmt --all -- --check` | PASS | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | 0 |
| `cargo test --workspace` | PASS: 1,168 tests | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS: release WASM generated | 0 |
| `npm run typecheck` | PASS | 0 |
| `npm test -- --maxWorkers=1` | PASS: 1,232 tests in 84 files | 0 |
| `npx --no-install vitest run tests/help-panel.test.ts tests/mobile-hud.test.ts tests/options-menu.test.ts --maxWorkers=1` after the final Help correction | PASS: 78 tests in 3 files | 0 |
| `npm run build` | PASS: production bundle generated | 0 |
| `python -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | PASS: 85 tests | 0 |
| `python assets/sprites/gen/build.py --check` | PASS: 1,229 sprites, atlas up to date | 0 |
| `cargo tree -p <crate> --target <target>` for core, data and sim on Linux and wasm32 | PASS: no web dependencies | 0 |
| Scoped Rust mutation sweep below | PASS: 66 tested, 57 caught, 9 unviable, no survivors or timeouts | 0 |
| `python check-doc-ids.py` | PASS | 0 |
| `git diff --check` | PASS | 0 |

The owner requested local CI and fresh adversarial review, with GitHub CI and
review skipped. Unchanged Blender model-generator suites were skipped because
this change adds generated 2D bookcase sprites without modifying those models.
The full-repository remote mutation sweep was not run. The scoped local sweep
and its exact outcome are recorded in the verification folder.

The scoped run used cargo-mutants 27.1.0, one worker and full workspace tests:

```text
cargo mutants --package terri-core --package terri-sim --package terri-data --package terri-wasm --test-workspace true --in-diff .tmp/gameplay-ui/changed-rust.patch --copy-target false --jobs 1 --timeout-multiplier 4 --minimum-test-timeout 120 --build-timeout 600 --no-shuffle --output .tmp/gameplay-ui/automated-final
```

The nonempty-run, normalized survivor-baseline and zero-timeout gates passed.
`automated-gate.json` and `automated-outcomes.json` retain counts, timestamps,
individual outcomes and the tested diff hash. Main's later `f19f00b` update
touched only roadmap docs; integrating it did not change the tested game code.

Targeted mutation checks deliberately broke the following mechanisms, observed assertion
failures, and restored each source file. SHA-256 comparisons confirmed each
restored file was byte-identical to its pre-mutation bytes. The restored queue,
bed-shortage and builder tests all passed. Raw failure output is in
`docs/assets/review-evidence/gameplay-ui/verification/`.

1. Removing the served-order skip failed
   `cargo test -p terri-sim current_order_is_shown_once` (exit 101):
   `left: ["first: fixture", "second: fixture", "first: fixture", "first: fixture"]`,
   `right: ["first: fixture", "second: fixture", "first: fixture"]`.
2. Reversing the bed-capacity comparison failed
   `cargo test -p terri-sim bed_shortage_counts` (exit 101):
   `assertion failed: mood.moodlets.iter().any(|m| m.label == "Not enough beds" && m.score == -20.0)`.
3. Removing successful selection clearing failed
   `npx vitest run tests/builder.test.ts --maxWorkers=1` (exit 1):
   `AssertionError: expected 15 to be null`, including unchanged Confirm.
4. Disabling preview replacement failed that same builder command (exit 1):
   `AssertionError: expected [ 84, 215.5 ] to deeply equal [ -1000000, -1000000 ]`.

The played checks and remaining visual proof limits are recorded in
[A-gameplay-ui-corrections] in `docs/alpha-feel-notes.md`.


Follow-up verification also deliberately removed the historical decoder,
unlimited append acceptance, and missing-station abandonment. Each mutation
failed its regression assertion (exit 101); source hashes were identical after
restoration. The restored legacy, 514-order and 17 chain tests passed. Logs are
`legacy-decoder.log`, `unlimited-append.log` and `missing-station-abandon.log`
in the same verification folder.

Browser follow-up: the original port-4187 save now reports Saved game loaded.
Its 2,607 bytes retained SHA-256
`0a3419f23fb524354e6f21cacd5b9d99538e303430ab1dbeb45a6ccada196523`.
Read-only browser inspection confirmed this before closing the page with scripts
suspended so the page-hide save could not replace the file. A separate fresh
origin on port 59371 started with No save yet. Through its controls, 51 waiting
reading orders survived Save and reload. The only fridge and stove both sold,
for 150 and 130 Funds, and the resulting save loaded again. Desktop cards
measured 192 pixels wide, with the first larger and the existing 33%-55% fade.
On a 390 by 844 phone viewport, cards measured 118.55 pixels wide and began at
99 pixels below the 90.8-pixel summary. Exit build was visible above the editing
dock, and clicking it returned to play. Both task-owned preview servers stopped
and all task-owned game tabs closed; the viewport override was reset.

The final control-order pass is recorded at the end of
[A-gameplay-ui-corrections]. Its desktop, phone and short-landscape screenshots
show speed above the roster and Build after the person panels. The compact
Exit build round trips passed. The scrolling landscape menu retained 220
usable pixels beside its 15-pixel scrollbar. No task-owned page or preview
server remains running.

The follow-up review added 14 more deliberate failures, covering actual drawing
facing, all compact-menu scopes, sidebar ordering, recipe labels, live activity
priority, every retained historical field, bounded projection across all four
layers, and release-load continuation and rejection. Together with the earlier
seven, 21 manual mechanisms failed when broken and passed after restoration.
The verification folder's README maps each mechanism to its failure log.
