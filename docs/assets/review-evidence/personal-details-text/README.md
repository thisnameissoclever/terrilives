# Personal-details text refresh

The open Personality and habits panel assigned identical text on every refresh.
It now uses the existing `setTextIfChanged` helper for dynamic leaf text. The
helper reads the actual DOM, so externally changed text is repaired. Factors,
sleep timing, repetition, row removal and selection behavior remain live. This
change does not add the separately held bed-assignment controls.

The new surface test failed before the fix: each unchanged dynamic leaf
received 20 writes over 20 refreshes, instead of zero. It passes after the fix
and requires changed sleep timing, drain and repetition values to update in the
same refresh. Existing tests still cover changed selection, row removal,
hidden-panel reads and load refresh. These are causal checks of text writes,
not a memory budget.

`native-text.json` contains the browser control pair from the built game:

| Measurement | Original | Fixed |
| --- | ---: | ---: |
| Unchanged paused refreshes | 20 | 20 |
| Observed text leaves | 30 | 30 |
| Leaves whose text child was replaced | 23 | 0 |
| Native text mutation records | 460 | 0 |

Both runs stayed at simulation tick 0 and preserved every observed text value.
Both repaired a deliberately changed factor cell to `100%` on the next frame.
No application page errors occurred. The browser's missing favicon request was
an unrelated 404. The same browser probe ran before and after; the readable
version is `web/proofs/personal-details-text.js`. Run it on a task-owned built
game page with `?stress=0&audio=0`. It opens the panel through real controls,
drives the existing frame hook while paused, uses a native MutationObserver,
and closes its page in `finally`. Its output is a measurement; require zero
replacements and mutations when checking the fixed build.

The browser provider's file loader only recognizes the original checkout root.
The proof therefore used its supported inline-code interface from this managed
worktree. No tool permission or browser profile was changed. Both game pages
closed and the task-owned preview server stopped after verification.

## Validation

1. `npm --prefix web test -- --maxWorkers=1 tests/personal-details.test.ts`: original exit 1 with the intended unchanged-write assertion; fixed exit 0, 13 tests.
2. `npm --prefix web test -- --maxWorkers=1`: exit 0, 1,714 tests in 114 files.
3. `npm --prefix web run typecheck` and `npm --prefix web run build`: exit 0. Fixed entry bundle `index-D0iZPFMF.js`.
4. The Rust, content, asset and lockfile diff from main `c0949f05` is empty. The verified release WASM and bindings from PR #186 were reused after checking source equality and SHA-256 `da49265e97644cb5f3dcc2aef11ef0406a0682f468145d0df472640d929bf9dd`. No stale bed-feature binary was used. The completed Rust/asset validation for that unchanged input is recorded in `../ecs-lifecycle/README.md` and main CI run `36865105430`.

The separate ambience JavaScript-memory gate remains failed. This panel is
normally closed in that workload; these results do not attribute its remaining
growth to personal details or alter its acceptance limit.

## Production verification

PR #187 merged at `6d2499d407d74f85d00929ac0bfde2bd4fe508dd`.
Main CI `36867567115` and Pages `36868086093` completed successfully.
On 2026-10-01 at 13:30 UTC, the public game loaded `index-DtZqWziq.js`.
The committed proof ran through the browser provider's file interface from
the original checkout, which is within that provider's allowed workspace.

The live result matched the fixed local measurement: 20 unchanged paused
refreshes, 30 observed leaves, zero text-child replacements and zero native
text mutations. The deliberately changed cell returned to `100%`; simulation
time remained at tick 0 and the proof reported no page errors. The browser
console contained the separate favicon 404. `production-text.json` retains
the result and proof hash. The task-owned page closed in `finally`; only the
original blank tab remained. No preview server was needed for this check.

This proves the deployed panel behavior. It does not complete the separately
held bed artwork, ambience-memory acceptance or a whole-game performance test.
