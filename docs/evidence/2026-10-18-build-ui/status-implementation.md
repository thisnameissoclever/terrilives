# Selected-person status and dock sizing implementation

Scope released to the root agent for source review and actual-browser verification. No commits, pushes, dependency changes, native edits, servers, or browser sessions were created by this worker.

1. Added `web/src/ui/activity-tooltip.ts`, initialized by `createCompactHud(document)`. It owns a body-level text popup and reads the existing status button, selected name, and pressed roster button. The popup uses `textContent`, a tooltip role, `aria-controls`, `aria-expanded`, and a visible-only `aria-describedby` relationship.
2. A mouse hover or keyboard focus reveals clipped status text. Button activation pins or dismisses it, including touch after focus. While it remains open for the same selected Sim, status and reading-progress changes update the complete literal text and reflow the popup. Escape, outside presses, changed selection, a hidden dock, or removal of overflow dismiss it. Ordinary observers do not reopen a dismissed popup. The popup can be entered directly from the status without a hover gap. Pointer and activation events on the status stay out of game input.
3. Mutation observers watch status/name text, roster selection, and dock visibility; a resize observer watches the status. Window and visual viewport resize/scroll events refresh geometry. There is no polling loop or timer. Popup width caps at 420 CSS pixels and available visual viewport width; height caps at the available visual viewport height. Text wraps, including long unbroken titles, and a tall popup scrolls.
4. `compact-hud.css` resets the new button to the previous plain status appearance and adds visible keyboard focus. No activity-row minimum height was added. Only dock header and roster button minimum heights were reduced: desktop header 32 to 27 CSS pixels (15.625 percent), desktop roster 34 to 28 (17.647 percent), compact/coarse header and roster 44 to 36 (18.182 percent). Widths, horizontal padding, fonts, and gaps stay as authored. Actual border-box sizes remain a browser verification item.
5. Updated the existing compact-HUD markup assertion for the status button. The peer owns the index.html span-to-button change; this worker did not modify index.html or main.ts.

Commands run from `web/`, with a single worker and bounded heap:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=512'
npm test -- tests/activity-tooltip.test.ts --maxWorkers=1
```

1. Initial no-op scaffold: exit 1, six missing-popup failures. Tightened the test helper so the missing popup produced a direct assertion rather than a TypeError; exit 1, six expected missing-popup assertions.
2. Implemented controller: exit 0, 6/6 passed.
3. Added the readable-width regression before the width cap: exit 1, expected 420px but received 784px, other five tests passed.
4. Applied the width cap and final dock CSS changes: exit 0, 6/6 passed, at 11:58:44 local time on 2026-10-18.
5. `git diff --check -- web/src/ui/compact-hud.ts web/src/ui/compact-hud.css web/src/ui/activity-tooltip.ts web/tests/activity-tooltip.test.ts web/tests/compact-hud.test.ts`: exit 0, no whitespace errors.
6. Root review found that the initial status-change dismissal also closed the title on every reading percentage. Added hover/pinned regressions with three progress updates, literal markup, and changed geometry, plus Escape followed by another progress update. RED at 12:01:54: exit 1, both new cases failed because the popup was hidden, six existing cases passed. Restricted dismissal to selection changes and refreshed visible text before positioning. GREEN at 12:02:00: exit 0, 8/8 passed. The same selected Sim keeps the popup open; actual selection changes remain a separate dismissal regression. This is a source-level correction; actual reading/progress behavior remains for the root's browser verification.

The tests exercise controller behavior with a small DOM, observer-delivery, and geometry fixture. They cover no clipping, width/height clipping, literal markup, hover transfer, touch focus then toggle, event consumption, keyboard/Escape dismissal without observer reopening, repeated same-Sim progress text/reflow, identical-name/status selection changes, viewport offsets, resize, and hiding. They do not establish browser text clipping, CSS geometry, game input isolation, touch target dimensions, or visual quality.

The root agent retains full web tests, type checks, builds, actual-game desktop/phone/enlarged-text/visual viewport measurements, real hover/tap/keyboard verification, no-command/no-camera evidence, independent known-defective versus repaired image review, documentation/changelog updates, and delivery. This worker has released the focused test slot and these files for review.
