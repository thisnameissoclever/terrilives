# Dock mood, life satisfaction and household controls

Mood and life satisfaction now appear in the main Sim dock and survive Collapse. Desktop keeps the values beside the identity and buttons. Compact screens use one short two-column row. Moodlets remain in Overview. Sim details has Overview, Queue, People and Traits; New housemate opens from Options, including without a selected person. Dismissing it restores stranded focus to Options.

## Local verification

1. `npm --prefix web test` passed: 1,717 tests in 115 files, exit 0. This followed repair of an unrelated-sibling markup sentinel in Traits tests.
2. `npm --prefix web test -- tests/traits-panel.test.ts tests/compact-hud.test.ts` passed: 48 tests in two files, exit 0, after the final boundary repair. The full suite also passed after the review fixes to header wrapping and Help routes.
3. `npm --prefix web run typecheck` and `npm --prefix web run build` passed, exit 0. Final production assets: `index-s-Je_yvt.js`, `index-D5EfDF54.css`.
4. The native WebGPU browser proof in `web/proofs/dock-wellbeing.js` passed at ten viewport sizes, from 320 by 568 to 1280 by 800, including 601px desktop, 600px compact and short landscape. `local-browser.json` records measured bounds; no page or measured field overflow and no application page errors occurred.
5. Real roster selection, Collapse, all four detail tabs, Options, selected and unselected household creation, and cancellation focus passed. Twenty unchanged public frame refreshes preserved text-child identity and produced zero text mutations at paused tick 0.

The generated WASM was reused from the matching main source in the door-thunk worktree after an empty Rust/content/Cargo diff. SHA256: `da49265e97644cb5f3dcc2aef11ef0406a0682f468145d0df472640d929bf9dd`. No simulation or dependency change belongs to this patch.

## Screenshots and limits

| View | Dock height | Evidence |
| --- | --- | --- |
| 1280 by 800 | 90.39px | [Desktop](1280x800.png) |
| 800 by 700 | 117.36px | [Narrow desktop](800x700.png) |
| 390 by 844 | 136.59px | [Phone](390x844.png), [Overview](phone-overview.png) |
| 320 by 568 | 136.59px | [Small phone](320x568.png) |
| 320 by 568 with doubled leaf text | 287.38px | [Enlarged text](phone-text-200.png) |

The enlarged-text fixture sets visible leaf font sizes to twice their computed size and projects the longest mood label plus life satisfaction 12345.6. It tests wrapping and overflow without altering simulation state. Identity/activity retain their existing ellipsis and full title. This is a local rendering fixture, not physical-device or operating-system text-scaling acceptance. Browser pages close in the proof's finally block.

The adversarial review reproduced clipped desktop controls at 601px and 640px with doubled text. The header now wraps when necessary and reserves 60px for identity. The longest mood label also wraps rather than overflowing its column. The extended proof checks every header child and wellbeing field at 320, 601, 640, 800 and 1280px with doubled text; all fit. These fixtures enlarge dock height when needed; ordinary desktop and phone heights remain unchanged. Additional screenshots: [601px](601-text-200.png), [640px](640-text-200.png), [800px](800-text-200.png), [1280px](1280-text-200.png).

Build/load projection and controller ownership were inspected during review; this proof does not claim native browser round-trips through those unchanged paths. Live deployment verification is separate from this local evidence.

## Adversarial review

A fresh independent read-only reviewer returned PASS after the header, longest mood label, Help routes and tab-proof corrections. It inspected the final source, refreshed measurements, and enlarged 601px/320px screenshots. No unresolved merge blocker remained. Selection/load ownership, separate moodlet visibility, Collapse, Build visibility and Options focus restoration also passed source review.

## Production verification

PR 189 merged as `70f56b6ee1e96dff4f5182e8f678612bb3a2b0e8`. Pages skipped that revision and the next one after reviewed changes advanced main. The final release published `250c73b3f86e38c709f30d5682fb65acbb949e4b`, including this UI change. Main CI 36880551157 and Pages 36881825452 succeeded; the Pages log confirmed deployment of the current main tip. Main's mutation job was skipped, not passed.

The public entry was `index-D3yc7B0O.js`. The actual live WebGPU proof passed all ten ordinary viewport cases and five enlarged-text cases, all four detail tabs, real roster selection, Collapse, selected/unselected New housemate from Options, and cancellation focus. Twenty unchanged refreshes produced zero text mutations at paused tick 0; there were no application page errors or measured field overflow. Results: [production-browser.json](production-browser.json), [desktop](production-desktop.png), [phone](production-phone.png). The initial desktop measurement includes startup text projection; subsequent ordinary desktop and phone measurements match the local layout. No physical-device or operating-system text-scaling claim is made.

The game page closed in the proof's finally block. The preview server stopped, and the completed UI worktree was submitted for archival after synchronization with main. This production evidence concerns the deployed UI, not the held sleeping-place implementation in the ongoing development branch.
