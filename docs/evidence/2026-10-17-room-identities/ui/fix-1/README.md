# R7 fix 1: retain review input when exiting a clean native draft

On 2026-10-18, the fresh task review identified one Important blocker at base `ac116ae9d44e6976bf316644ca2bc0e4c22be4a3`: after naming a final room in review, choosing Back and reversing the walls exactly, Exit could close Build and erase the retained name without prompting. Native dirtiness correctly became clean; the page omitted the separate review input owner.

The production fix is one additional `roomReview.hasChoices` check in the existing `BuildExit` dirty predicate. The native baseline, review preparation and controller ownership are unchanged. Presence of retained explicit input conservatively requires the existing exit decision until the player adopts or explicitly cancels it.

## Regression and checks

The existing page-binding fixture now executes the actual review-completion, review-request, retained-choice and replacement bindings from `main.ts`. It uses the real `RoomReviewController`, `BuildSession`, `BuildExit`, tool controllers and current native module. It does not duplicate the exit predicate or introduce a production test API.

1. RED runs `npm --prefix web test -- --maxWorkers=1 tests/main-build-wiring.test.ts`. Three new cases fail at the expected missing-dialog assertion; 18 cases pass, including the exact reversal without retained choices. The native draft and selection text are explicitly clean before Exit, while the review name remains pending.
2. GREEN runs `npm --prefix web test -- --maxWorkers=1 tests/main-build-wiring.test.ts tests/build-exit.test.ts tests/build-session.test.ts tests/build-session-state.test.ts tests/room-selection.test.ts tests/room-review.test.ts`. All 98 tests across six files pass.
3. `npm --prefix web run typecheck` exits 0. `git diff --check` also passes. Tests use one worker and `NODE_OPTIONS=--max-old-space-size=4096`.

The regression verifies that the actual canvas/document Escape route opens the exit dialog; Keep building retains the text and baseline; the public explicit-confirm operation opens a fresh native review even with no groups; updated choices are displayed before adoption; and commit/end/leave each occur once. A repeated confirmation while pending does not prepare another candidate. Actual dialog Discard and footer Cancel clear the choices through the page's replacement binding. Reversal without review choices remains clean and exits directly. Public async completion is awaited before native handle cleanup, including cleanup after an assertion failure.

[Receipts](receipts.json) preserve exact commands, exit codes, raw log hashes and LF-normalized [RED](red.log), [GREEN](green.log) and [typecheck](typecheck.log) logs. RED main bytes were reconstructed by reversing only the one-line change, then checked against the prior checkpoint's raw-file hash and normalized base Git blob. The new regression file did not change between RED and GREEN. No pre-run broad manifest is claimed.

The RED main hash is `d667efde03e57c0a2b07de3f369f57f98792a3e39e261cd42c97c2379c74bb05`; GREEN is `d0fc63d7b855b52e5d4b84b270c754de71f33070b955365cc0b338f33d104f93`. The unchanged native module is `6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1`.

## Scope and self-review

The implementation changes one main predicate, extends the actual-binding regression fixture, updates its existing source contract assertion and adds the general lesson about aggregating every local input owner. Self-review checked exact native reversal, retained text, fresh-token preparation, explicit clearing and async cleanup. No Rust, content, Wasm, dependency, layout, controller API or browser operation changed. No full-suite repeat, build, push or merge was performed.

Prior visual acceptance, physical-mobile limits and the unverified natural visibility-save trigger retain their original boundaries. This focused fix does not close those gates. Parent owns the scoped fresh re-review and R8 final broad integration.

**Next steps**: Parent re-reviews this committed fix and resumes R8. Source, index and heavy-slot ownership return to the parent after commit verification; no user action is needed.
