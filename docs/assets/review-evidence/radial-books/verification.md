# Radial object actions and books: verification

Observed on 2026-10-09 in the implementation branch `twcx/radial-object-actions-books`, based on `faed1ccb192a027f80fd41970b967c64c2ebbea5`. The final changes and this record travel in the same commit. Tests use independent game worlds and temporary browser profiles; no personal household is accessed.

## Local checks

| Command or check | Result | Exit |
| --- | --- | --- |
| Locked dependencies installed with `npm ci` | No dependency or lockfile changes | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Release module built | 0 |
| `cargo test --workspace -- --test-threads=1` | Core, data and 1,298 simulation tests passed; initial boundary fixture expectations failed | 101 |
| `cargo test -p terri-wasm --lib -- --test-threads=1` after fixture corrections | 263 passed | 0 |
| `cargo test -p terri-sim reading::tests -- --test-threads=1` | 50 passed after reading review fixes | 0 |
| Book and priority regressions after mutation restoration | 46 book tests and 3 priority tests passed | 0 |
| Commerce boundary regressions after the raw-command ingress fix | 3 passed | 0 |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed | 0 |
| `cargo fmt --all -- --check` | Passed | 0 |
| `npm --prefix web test -- --maxWorkers=1 --reporter=default` | 180 files, 2,223 tests passed | 0 |
| Focused web tests after subsequent geometry/focus changes | Passed; includes measured keep-outs, offscreen anchors, enlarged navigation and paused reflow | 0 |
| `npm --prefix web run typecheck` | Passed | 0 |
| `npm --prefix web run build` | Passed | 0 |
| `node --test scripts/build-changelog.test.mjs` | Passed | 0 |
| `node scripts/build-changelog.mjs` | Public changelog generated | 0 |
| `python -B check-doc-ids.py` | Documentation IDs unique | 0 |

The unchanged sprite-generation suite was stopped after running beyond the relevant UI verification. No sprite sources, atlas files or generation code changed. Rendering masks are covered by native and web boundary tests. That optional generation sweep is not claimed as passed.

## Negative tests

Removing each mechanism caused its targeted regression to fail: hard reading priority, stale purchase revalidation, fresh-household starter grants and the actor-mode gate. Each source file was restored byte-for-byte, then its tests passed. The new raw commerce ingress test also failed before the guard was added and passed afterward. These witnesses protect ordering, ownership, prices and staging; they are not a full remote mutation sweep.

## Browser evidence

1. Desktop and 390 by 844 layouts show independent radial buttons. Offscreen anchors, expanded descriptions, status-panel growth and the Sim dock leave each control reachable. A fitting circle takes precedence over a compact layout.
2. A short desktop layout and the 200 percent equivalent layout use measured free space. The latter has a 640 by 400 CSS viewport at device pixel ratio 2; it is an emulation of enlarged desktop layout, not a claim about the browser's Settings value. Minimum action targets remain 44 CSS pixels.
3. Enter build mode selects the exact bookcase. A controller regression verifies that opening it discards an unsubmitted furniture preview without committing the move. Actor actions are disabled during Build. Menu focus stays on the same action when reflow changes page capacity.
4. A paused purchase adds one copy and subtracts the displayed price. Selling removes one eligible copy and credits the displayed payout. Saving and reloading retains the resulting three-copy household.
5. The authentic retained V5 household fixture restores five starter books on startup and manual loading. Current saving creates a byte-identical V5 recovery copy; reloading keeps five books.
6. A V7-compatible owned-book fixture uses the unchanged historical payload layout, an empty command queue and three owned books. Startup and manual loading keep three copies. The first current save preserves its exact V7 bytes and writes V8. Reloading adds no gifts. This constructed fixture supplements the genuine older fixtures; it is not described as a historical player's save.
7. A truncated V8 fixture is rejected. Saving is paused and its stored bytes remain unchanged.
8. Browser flows report no page exceptions. Task-owned pages and the preview server are closed after verification.

Independent source review covered native transactions, historical decoding, current saves and frontend lifecycle. Follow-up geometry review confirmed the measured-region approach and identified the focus path, which was repaired and exercised in the browser. Local, merge and publication verification are separate; publication is confirmed only after the deployed revision and public game are inspected.
