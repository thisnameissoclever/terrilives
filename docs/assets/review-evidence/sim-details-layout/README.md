# Sim details layout and shyness grouping

The owner requested less prominence for shyness and a narrower default flyout. `git fetch origin` completed before editing; the fetched main revision was `6d2499d4`. The local privacy implementation and its simulation behavior remain intact.

Shyness now appears inside Personality, habits and bed. Its display belongs to the personal-details controller, so it follows the same visibility-gated periodic refresh and forced opening/Load refresh. The standalone Overview row and its HUD reads are removed.

The desktop sheet is 360 CSS pixels wide by default. Expanded personality allows 540 pixels for the table and bed controls. Hidden Overview content cannot keep another tab wide. Navigation wraps, and Close keeps its normal height. Compact screens use the available width.

## Verification

| Command or check | Exit | Result |
| --- | --- | --- |
| `npx --no-install vitest run tests/game-hud.test.ts tests/personal-details.test.ts tests/personal-details-bridge.test.ts tests/compact-hud.test.ts tests/bed-assignment.test.ts --maxWorkers=1 --reporter=dot` in `web` | 0 | PASS: 50 tests in five files |
| `npm run typecheck` in `web` | 0 | PASS |
| `npm run build` in `web` | 0 | PASS: final assets `index-DJ2qFRV6.css`, `index-D5fLQ38k.js`; existing WASM unchanged |
| `python check-doc-ids.py` | 0 | PASS |
| `git diff --check` | 0 | PASS |
| Headed Chrome at 1365x1000, 320x568, 390x844 and 640x400 | No page errors | PASS: widths, grouping, selection refresh, tab switching and Escape focus |
| Independent read-only source review | No findings | PASS |

The existing selection regression moved to the personal-details tests and also proves that clearing selection clears shyness. Hidden-panel coverage includes shyness reads. Rust tests and balance calibration were not repeated because this delta changes presentation only.

[Default desktop](desktop-default.png), [expanded personality](desktop-personality.png) and [compact screen](phone-personality.png) were visually inspected. [Initial browser readings](browser.json) include selection switching and Escape. [Final readings](browser-final.json) confirm the final Close alignment, all four viewport fits and zero horizontal overflow. Compact Close and tab controls remain 44 pixels high.

Owned QA browser contexts closed in finally. The separate owner-review preview on port 4185 remains available as requested. This evidence verifies layout behavior; the owner can inspect the appearance in that preview.
