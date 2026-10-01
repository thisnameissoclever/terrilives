# Build controls verification, 2026-10-01

This record describes local verification on `twcx/build-context-controls`, based on `41df46edca2fd61315fb999fb5e1409397d34bcc`. The inspected frontend files are identified by [SHA-256 fingerprints](source-sha256.json). The owner approved the design and select-then-apply Floors workflow, then accepted the displayed implementation screenshots on 2026-10-01. These local checks do not establish publication.

## Automated results

Commands ran from the repository root unless the command specifies `web`. Windows Chrome used the existing bundled Playwright installation, a fresh disposable browser context, WebGPU with Direct3D 11, and muted audio. Each browser closed in `finally`. This evidence uses the running Vite game with freshly built WebAssembly; the production bundle was built separately.

| Command | Relevant result | Exit | Verdict |
| --- | --- | --- | --- |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Release WebAssembly package built | 0 | PASS |
| `npm --prefix web run typecheck` | TypeScript completed without diagnostics | 0 | PASS |
| `npm --prefix web test -- --maxWorkers=1 --reporter=json --outputFile=<evidence>/web-tests.json` | 1746 passed; 0 failed | 0 | PASS |
| `npm --prefix web run build` | Production game and changelog built | 0 | PASS |
| `cargo fmt --all -- --check` | No formatting differences | 0 | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | Completed without warnings | 0 | PASS |
| `cargo test --workspace` | 1281 tests passed; no failures | 0 | PASS |
| `python check-doc-ids.py` | Documentation ids are unique and allocation-free | 0 | PASS |
| `git diff --check` | No whitespace errors | 0 | PASS |
| `python -B -m unittest discover -s .github/scripts -p test_*.py` | 23 tests passed | 0 | PASS |
| `python -B -m unittest discover -s assets/sprites/gen -p test_*.py` | 126 tests passed | 0 | PASS |
| `python -B -m unittest discover -s assets/models/sims/sim-01 -p test_*.py` | 29 tests passed | 0 | PASS |
| `python -B -m unittest discover -s assets/models/furniture -p test_*.py` | 30 tests passed | 0 | PASS |
| `python -B -m unittest discover -s assets/models/kitchen -p test_*.py` | 15 tests passed | 0 | PASS |
| `python -B -m unittest discover -s assets/models/bathroom -p test_*.py` | 8 tests passed | 0 | PASS |
| `python -B -m unittest discover -s assets/models/bedroom -p test_*.py` | 13 tests passed | 0 | PASS |
| `python -B -m unittest discover -s assets/models/office -p test_*.py` | 8 tests passed | 0 | PASS |
| `python assets/sprites/gen/build.py --check` | Atlas matches: 1700 sprites, 8192x5658 | 0 | PASS |
| `node --test scripts/build-changelog.test.mjs` | 7 tests passed | 0 | PASS |
| `node scripts/build-changelog.mjs` | Completed successfully | 0 | PASS |
| `cargo tree -p terri-core --target x86_64-unknown-linux-gnu` | No wasm-bindgen, web-sys or js-sys in the resolved tree | 0 | PASS |
| `cargo tree -p terri-data --target x86_64-unknown-linux-gnu` | No wasm-bindgen, web-sys or js-sys in the resolved tree | 0 | PASS |
| `cargo tree -p terri-sim --target x86_64-unknown-linux-gnu` | No wasm-bindgen, web-sys or js-sys in the resolved tree | 0 | PASS |
| `cargo tree -p terri-core --target wasm32-unknown-unknown` | No wasm-bindgen, web-sys or js-sys in the resolved tree | 0 | PASS |
| `cargo tree -p terri-data --target wasm32-unknown-unknown` | No wasm-bindgen, web-sys or js-sys in the resolved tree | 0 | PASS |
| `cargo tree -p terri-sim --target wasm32-unknown-unknown` | No wasm-bindgen, web-sys or js-sys in the resolved tree | 0 | PASS |

The full web report is summarized in [web-tests-summary.json](web-tests-summary.json). The [Rust results](cargo-test-summary.txt), [repository checks](repo-checks.json), [production build](production-build.log) and [browser report](browser-verification.log) retain supporting output. Existing controller tests cover command drains, restrictions, refusal, loading and tool switching; the contextual tests exercise all five action sets, both rotation directions, noncontiguous facing support, floor selection without mutation, and pending or blocked guards.

## Browser geometry and input

Run `scripts/verify-build-controls.cjs` with `PLAYWRIGHT_MODULE` pointing to an existing Playwright installation. `GAME_URL` selects the running game, and `HEADED=1` displays Chrome. The evidence run used:

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:HEADED = '1'
node scripts/verify-build-controls.cjs 'C:/Users/myema/.codex/visualizations/2026/10/01/01a0f829-0992-7362-8f7d-9481810ffedc'
```

Exit 0: **PASS, 51 layout states**. The [measurements](game-layout-evidence.json) include all five tools, expanded Shortcuts, doubled text with long refusal messages, a long selection-name fixture, and device pixel ratios 2 and 3 with emulated touch. All measured contextual targets were at least 44.00px in both dimensions. Content centers differed from button centers by at most 0.008px. Bounds and hit testing excluded overlap with panels, world controls, zoom and viewport edges.

| Viewport | Build panel outer width | Minimum measured selection space |
| --- | --- | --- |
| 1440x900 | 304 | 73.81px |
| 1280x800 | 304 | 73.81px |
| 701x800 | 304 | 73.81px |
| 700x800 | 684 | 73.81px |
| 390x844 | 374 | 73.81px |
| 320x568 | 304 | 73.81px |
| 844x390 | 828 | 73.81px |

The final column measures the clear vertical gap between arc controls or the grid's free game area. Across the enlarged-text checks, the grid retained at least 24px of clear game space and a tool-content scroll area of at least 44px. These measurements establish reachable controls and a visible selection area; they do not promise that an entire large furniture sprite fits on a short screen at maximum zoom.

Real game actions verified a furniture sale, floor application, Clear, selection without further painting, pan tracking, and zoom by 1.12 anchored to desktop game space beside the panel. Choose item returned focus to the catalogue. Help and Options suspended contextual controls. Focus survived disabled or hidden actions, tool changes, layout reparenting, Options closure and resize. A steady 20-frame sample produced zero contextual DOM writes and zero panel-bound reads. Empty space passes input through; button pointer presses did not escape to the document handler.

Options, the Sim dock and its four detail tabs, object menus, both housemate form pages and confirmation dialogs were exercised at 320x568. The existing Sim-dock breakpoint remains separate from Build's 700px/480px breakpoint. No JavaScript page exception was recorded.

## Deliberate mutations and restoration

Each mutation changed production code, ran its targeted test, retained the actual failure, and restored the original bytes in `finally`. [mutations.json](mutations.json) records the exact command, exit code and matching before/after SHA-256 values.

| Mechanism deliberately broken | Observed failure | Exit | Result |
| --- | --- | --- | --- |
| Floor pending guard on Clear | Selection became null while a command was pending | 1 | DETECTED; byte-identical restoration |
| Unchanged-frame return | Placement ran 21 times where one was expected | 1 | DETECTED; byte-identical restoration |
| Button pointer ownership | Pointer escaped once where zero was expected | 1 | DETECTED; byte-identical restoration |
| Hiding when the model is absent | Context controls remained visible after Clear | 1 | DETECTED; byte-identical restoration |

Failure logs: [pending guard](mutation-pending-floor-clear.log), [unchanged frames](mutation-unchanged-frame.log), [pointer ownership](mutation-pointer-ownership.log), [hidden controls](mutation-hidden-controls.log). The restored [contextual suite](restored-guards.log) passed. The final browser pass also used restored sources.

An earlier CSS-only deletion survived because another hiding rule remained. That deletion did not remove the hiding mechanism. The hidden-control mutation above forces the actual presentation state visible and is detected. This is targeted mutation evidence; no full Rust mutation sweep or remote continuous-integration run was performed for these local frontend changes.

## Review corrections and acceptance limits

The browser setup initially failed to account for first-run Help owning input. Verification now closes that modal through its normal control before Build. Enlarged text then exposed a CSS specificity conflict and an action box shorter than its content. A shared compact grid now allocates intrinsic button space. Follow-up review found focus loss during reparenting; the corrected implementation preserves focused visible controls and has a browser assertion for the transition.

Screenshots show the actual game and real controls. Long-name and long-refusal text are verification fixtures, not authored content changes. Automated bounds, focus and controller checks passed. The owner accepted the displayed screenshots on 2026-10-01. Physical-phone use and spoken screen-reader output remain unverified. No Rust command, save format, content schema or dependency file changed.

Task-owned browser instances closed in `finally`. The task-owned Vite process was stopped after verification, and port 5174 had no listening process. Other tasks' pages and servers were left alone.

## Screenshots

| State | Image |
| --- | --- |
| Desktop Walls | [desktop-walls.png](desktop-walls.png) |
| Desktop Furniture | [desktop-furniture.png](desktop-furniture.png) |
| Desktop Buy | [desktop-buy.png](desktop-buy.png) |
| Desktop Room | [desktop-room.png](desktop-room.png) |
| Desktop Floors | [desktop-floors.png](desktop-floors.png) |
| Phone, 390x844 | [phone.png](phone.png) |
| Small phone, 320x568 | [small-phone.png](small-phone.png) |
| Doubled text, 320x568 | [phone-large-text.png](phone-large-text.png) |
| Doubled text, short landscape | [landscape-large-text.png](landscape-large-text.png) |
| Help, collapsed reference | [help.png](help.png) |
| Help, expanded reference | [help-shortcuts.png](help-shortcuts.png) |
| Object menu | [object-menu.png](object-menu.png) |
| Housemate traits and family | [housemate-traits.png](housemate-traits.png) |
