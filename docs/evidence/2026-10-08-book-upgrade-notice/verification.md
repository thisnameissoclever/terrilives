# Book-upgrade notice removal verification

Observed 2026-10-08 on the Windows desktop host in the isolated `8b24/terrilives` worktree. Base revision: `0d5ca2892b735335b1eae8c5e52a00b271798e0b`.

## Local checks

| Command | Relevant output | Exit | Verdict |
| --- | --- | --- | --- |
| `npm ci --prefix web` | Installed the locked packages; no manifest or lockfile changes | 0 | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Release compilation and WASM optimization completed | 0 | PASS |
| `npm --prefix web test -- --maxWorkers=1 tests/book-bridge.test.ts -t 'imports legacy books'` before removal | Expected HTML not to contain `id="book-import-notice"`; one test failed on the unwanted element | 1 | EXPECTED FAIL |
| `npm --prefix web test -- --maxWorkers=1` after removal | 177 files and 2,199 tests passed | 0 | PASS |
| `npm --prefix web run typecheck` | TypeScript reported no errors | 0 | PASS |
| `npm --prefix web run build` | Production bundle generated | 0 | PASS |
| `node --test scripts/build-changelog.test.mjs` | 12 tests passed | 0 | PASS |
| `node scripts/build-changelog.mjs` | Changelog generated | 0 | PASS |
| `python -B check-doc-ids.py` | Documentation ids are unique and allocation-free | 0 | PASS |
| `git diff --check` | No whitespace errors | 0 | PASS |

The installed Vitest agent reporter withheld successful per-file progress. The suite completed in 420.44 seconds; the final summary above establishes its outcome. The production build retained its existing large-bundle warning. The locked dependency install reported existing advisories; no dependency changes were made.

## Browser checks

Playwright CLI used temporary sessions against the production preview at `http://127.0.0.1:4287/`. The historical input was `crates/terri-wasm/tests/fixtures/pre-voice-157.hex`. Fixture setup ran on an intercepted blank page before the game started; no real player storage was accessed.

1. Startup restoration displayed `Saved game loaded` and five owned books. The notice element and paragraph were absent. Saving and reloading retained five books.
2. The recovery file contained 2,607 bytes and matched the original fixture byte for byte. The continuation receipt is [browser-result.json](browser-result.json).
3. A separate session checked the primary slot immediately before and after manual Load. Both reads were version 1 and exactly matched the fixture. The loaded world contained five books and no notice. See [manual-load-result.json](manual-load-result.json).
4. [Desktop capture](desktop.png) used a 1280 by 800 viewport. [Narrow capture](narrow.png) used a 390 by 844 viewport; the status panel measured 182 by 83.1875 pixels and displayed the saved-game status without the paragraph.
5. Task-owned browser sessions were closed in cleanup blocks, and the task-owned preview server was stopped.

The initial probe incorrectly expected the open Build button to retain its label, reseeded a live slot before reloading, and later expected Options to remain open after Load. Those probe failures were retained locally and reviewed independently. Source confirms that Load closes Options and that visibility changes can save even while paused. The exact interleaving behind the initial unreadable recovery file was not instrumented. The accepted save check used blank-page fixture setup; manual historical-input provenance was verified in a separate session without reseeding a running game.

## Review

The independent final code review reported no actionable findings. Production changes remove only the notice element, display helper and its two call sites. Save conversion, storage, public interfaces and book behavior are unchanged. Publication is verified separately after merge; these local checks do not establish deployment.
