# Sim name hierarchy

Local UI verification on 2026-09-30 in the `2301/terrilives` worktree.
These screenshots show the implemented name styling, not the proposed control
layouts. Owner visual approval and publication remain pending.

1. Household buttons use 15px, weight 700. The selected-person heading uses
   20px, weight 700; status labels retain their existing size.
2. Traits was already collapsed in the source and running build before this
   change. Its default remains unchanged. Clicking Traits exposed the trait
   rows; clicking it again collapsed them.
3. At 390 by 844 and 320 by 568, household buttons measured 44px tall and the
   document had no horizontal overflow. The selected-person heading remained
   20px. At 844 by 390, the HUD stayed within the viewport and Traits remained
   collapsed.
4. The expanded mobile menu still covers much of the house. The requested
   control-layout mock-ups address that separately; this change does not
   implement a new layout.

| Command | Result | Exit |
| --- | --- | --- |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS | 0 |
| `npm run typecheck` in `web/` | PASS | 0 |
| `npx --no-install vitest run tests/traits-panel.test.ts tests/mobile-hud.test.ts tests/household-roster.test.ts tests/needs-panel.test.ts tests/options-menu.test.ts --maxWorkers=1` in `web/` | PASS: 124 tests in 5 files | 0 |
| `npm run build` in `web/` | PASS | 0 |
| `python check-doc-ids.py` | PASS | 0 |
| `git diff --check` | PASS | 0 |

The browser checks used the visible in-app browser at
`http://127.0.0.1:5174/`, served from this worktree. Initial status was
`No save yet`. The game was paused for layout captures. Desktop was
1280 by 720; additional captures are 390 by 844, 320 by 568 and 844 by 390.
Vite logged `ResizeObserver loop completed with undelivered notifications`
during initial startup and hot reload, including before the CSS edit.
No resulting loss of controls was observed. This pass did not investigate
that existing startup notification or test physical touch hardware.

The task-owned game tab was closed in a finally block, the viewport override
was reset, and the task-owned preview server was stopped. Port 5174 had no
listener afterward. No dependencies changed and no simulation code changed.

1. [Desktop](desktop.png)
2. [Phone, menu closed](phone-collapsed.png)
3. [Phone, selected person's details open](phone.png)
4. [Small phone](small-phone.png)
5. [Landscape](landscape.png)
