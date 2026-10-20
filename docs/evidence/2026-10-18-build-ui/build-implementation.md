# Build UI implementation handoff

Source frozen and test slot released at 2026-10-18 12:05 Pacific. No commits, pushes, dependency changes, native edits, generator edits, asset edits, browser servers or full builds were made by this worker. Root owns documentation, retained visual evidence, review, delivery and live verification.

## Source scope

1. `web/src/ui/build-exit.ts`: footer Confirm adopts then leaves; footer Cancel restores/ends then leaves. Failures keep Build open. A one-shot destination uses the existing dialog and native confirmation path, then synchronously ends the old native session and invokes the new session callback under the existing builder pause. Back, refused commit, Load, dismissal and superseding intent invalidate that callback. Existing pointer guards remain; held Enter/Space after completion cannot activate the newly focused control. Dialog heading is a required binding, with the existing exit heading or literal Switch to Land? destination heading.
2. `web/src/ui/build-tools.ts`: optional `beforeSelect` intercepts both mouse and programmatic tool selection before any preview is cleared, including Furniture. `web/src/main.ts` supplies the Land gate, avoids prompting on same-Land reselection, blocks switching away during a Land purchase, preserves room-local inputs, and begins Land in a fresh native batch without resuming the builder pause or advancing ticks.
3. `web/index.html`: safe neutral Keep building first, red Discard changes second, green Confirm changes last. Zoom-out is an ASCII-only inline SVG minus with its existing accessible label. The dock activity element is now the empty button agreed with the status worker. Help describes footer exit and the Land boundary accurately.
4. `web/src/ui/build-controls.css`: empty generic status rows collapse; SVG centers in the existing zoom control. `builder.ts`, `buy-tool.ts` and `floor-tool.ts` remove the approved redundant generic statuses. No compact HUD/controller files were edited by this worker.
5. Tests: `build-exit-destination`, `build-exit`, `main-build-wiring`, `action-intent`, `builder` and `buy-tool` changed. The actual page-binding test executes the complete real tool-switch assignment, including destination wiring, against the freshly rebuilt V17 module.

## Verification

1. New mocked destination/footer/markup tests initially failed all 13 cases. `red.txt` records the old behavior. The final file has 14 cases after splitting icon checking into its own test.
2. `icon-red.txt` records an independent failure against the exact pre-change `HEAD:web/index.html` retained in `before-index.html`. It rejects the actual mojibake button rather than a synthetic glyph fixture.
3. Final focused command: `NODE_OPTIONS=--max-old-space-size=2048 npx.cmd vitest run tests/build-exit-destination.test.ts tests/build-exit.test.ts tests/main-build-wiring.test.ts tests/action-intent.test.ts tests/wall-tool.test.ts tests/window-tool-controls.test.ts tests/builder.test.ts tests/buy-tool.test.ts tests/floor-tool.test.ts --maxWorkers=1`. All 9 files and 281 tests passed. Output: `focused-final.txt`.
4. The first actual-module family had one stale expectation that footer Cancel kept Build open; it was updated to require leaving. Native Land tests cover Confirm/Discard/Keep, clean switch, invalid raw name retained on Keep, same-tool reselection, blocking Walls and Furniture behind a pending Land purchase, and review continuation cancellation on Back/Load/graphics dismissal. They assert native session state and clock preservation.
5. Final `NODE_OPTIONS=--max-old-space-size=4096 npx.cmd tsc --noEmit` passed, exit 0; output file `typecheck-final.txt` is empty on success. An initial 1GB bound exhausted the heap before diagnostics. The 4GB run completed with about 17GB physical memory free at the preceding host check.
6. No source browser pass or independent visual review was performed by this worker. These remain root-owned acceptance work, including actual before/fixed pixels, focused text at desktop/phone sizes, native identity/ownership purchase proof and stale-Load behavior in the real page.

## Encoding diagnosis

1. Before edits, explicit Node UTF-8 decoding found the source zoom text as U+00E2 U+02C6 U+2019. Live HTTP 200 served the same corrupt text with `text/html; charset=utf-8` and UTF-8 meta. Existing local dist still contained correct U+2212. This distinguishes stored source corruption from response-header decoding and from the stale local artifact.
2. Git history narrows the introduction to commit `135235fe4`: its parent contains U+2212; that commit contains the three corrupt characters. `encoding-history.txt` records both. Those characters match UTF-8 minus bytes decoded as Windows-1252 and then stored as UTF-8. That transformation is supported by the bytes; the exact editor or command that performed it was not observed.
3. `rg` over `web/index.html`, `web/src/main.ts` and `web/src/ui` initially found only this mojibake instance and now finds none for the audited sequences (`â`, `Ã`, `Â`, replacement character). Other Build icons did not show that signature. The repair uses an SVG path expressed in ASCII rather than another encoding-sensitive text glyph; the UTF-8 document boundary remains intact.
4. Scripts and receipts: `encoding-check.cjs`, `encoding-history.cjs`, `encoding-current.txt`, `encoding-history.txt`, `before-index.html`, `icon-red.txt`. The current live URL remained defective during this worker's check; no live fix is claimed.

## Copy audit inventory

| Removed or shortened copy | Reason and retained information |
| --- | --- |
| Changes remain pending until Confirm. | Repeated on Build entry, room edits, architecture refresh and static footer. Build controls already identify the draft; optional Help retains confirmation rules. |
| Changes confirmed. | Success now exits Build; the resulting mode change is visible. Native refusal and recovery text remain. |
| Pending changes cancelled. Build mode remains open. | Both redundant and false under the approved footer behavior. Successful cancellation exits; rollback failure displays the native error or a retry instruction. |
| Choose furniture to move or rotate. / Ready to place. | Furniture selector, preview and Place control show these states. Placement refusal, active-use sale restrictions, rotation artwork restriction and command receipts remain. |
| Choose something to buy. / Ready to buy. | Catalogue, selected model, preview and Buy control already show this state. Price, funds, gameplay benefits, station requirements, availability, capacity, progress and purchase failures remain. |
| Choose a tile. | Floors tool and optional Help retain the action. Selected tile's current material and covering refusal remain because current material can differ from the proposed covering. |
| You have changes that are not confirmed. Discarding them undoes every change since the last Confirm, including purchases and sales. | Shortened to Discarding changes undoes this batch, including purchases and sales. The dialog choices identify the pending decision; purchase/sale consequences remain explicit. |
| Upcoming actions. The preview shows as many as fit; all waiting orders remain queued. | Shortened to All waiting orders remain queued, including those that do not fit in the preview. Preserves the hidden-queue consequence while dropping the label narration. |

Retained after static/controller UI review: useful native errors and restrictions, pending-command progress and receipts, room boundary timing, shared Outside semantics, room doorway selection guidance, Land dimensions/price/remaining funds and purchase confirmation, missing-person empty states, optional Help/Shortcuts, keyboard/touch controls, accessible names, authored books, object/model descriptions and personality content. Authored product facts and names were not rewritten. Status-worker-owned activity overflow copy and dock sizing were coordinated separately. The broader catalogue facts remain because they affect purchase decisions; visible descriptions of the item are not interchangeable with those facts.

## Remaining root work

1. Update canonical docs/changelog/lessons to the approved exit and Land behavior and source-encoding lesson.
2. Inspect actual before/fixed screenshots, obtain fresh independent source and visual review, and finish full validation and delivery. Final native identity, owner, purchase and live proof belong to that acceptance pass.
3. Preserve the defective live/source receipts and actual negative icon test alongside final evidence as useful. No review video was created.

**Next steps**: Root owns acceptance and delivery. This worker has released all owned source files and the test/typecheck slot.

## Coherent review fix wave, 2026-10-18

1. Read the complete fresh source review. Held Enter is now guarded when the shared dialog opens and whenever a deliberate Keep restores focus. The regression models the browser's button default: an uncancelled Enter keydown dispatches a keyboard click. Both Exit and Land must keep the newly opened decision during repeats, keep it closed after deliberate Keep despite repeats on the restored opener, and allow a fresh activation. Existing Space and pointer cases remain in the passing BuildExit family.
2. Finished copy removal in `land-tool.ts`, `room-tool.ts`, `index.html` and `build-controls.css`. Removed Land's Choose a strip of land. initial/static status and its duplicate Choose a strip beside the lot, read its price, then use Buy land. touch hint beside literal side buttons. Removed Ready to build, with a doorway. and the Ready to build. prefix. Empty status/hint rows collapse. Retained first/opposite-corner progress, Choose a line of the outline for a doorway., Land quotes, remaining funds, buying progress, failures, receipts and optional Help.
3. Added an explicit review cancellation marker owned by `BuildSession`, exposed through `confirmationCancelled` and recorded by `noteReviewCancellation()` only while confirmation is active. The existing RoomReview completed(false) callback records deliberate Back/reset and clears exit/destination intent. The actual `confirmBuildBatch` status function now treats that cancellation as a blank status, while invalid input and native refusal retain their useful errors. Every fresh confirmation resets the marker. Native API and boolean confirmation return shapes are unchanged.
4. Expanded the actual-module/page-binding harness to execute the complete production `confirmBuildBatch` function. Back preserves native draft geometry, committed bytes and raw review text, while clearing false failure narration. A subsequent native preparation refusal must reset the cancellation marker and show its error. Separate invalid-name confirmation also remains visibly refused.
5. Root additionally assigned one roster padding correction after actual browser measurement found intrinsic content forced 31px despite min-height 28px. Changed only vertical padding from 4px to 2px in `compact-hud.css`; horizontal padding, font, line height, width, gaps, desktop min-height 28px and compact/coarse min-height 36px remain unchanged. Actual rendered dimensions and focus clearance still require the browser worker's fresh measurement. Tooltip controller was untouched.

Verification and receipts:

1. `NODE_OPTIONS=--max-old-space-size=2048 npx.cmd vitest run tests/build-exit.test.ts tests/main-build-wiring.test.ts tests/room-tool.test.ts tests/build-exit-destination.test.ts --maxWorkers=1`: exit 1, initial RED. Five failures included the expected held Enter, two Rooms copy and static Land cases; the Back test initially exposed a missing `confirmRefusal` harness binding. That binding was corrected before accepting a behavioral RED result.
2. Retained the exact staged prewave `main.ts` read-only in `prewave-main.ts`. `BUILD_MAIN_SOURCE=../.local-build/build-ui-followup/prewave-main.ts NODE_OPTIONS=--max-old-space-size=2048 npx.cmd vitest run tests/main-build-wiring.test.ts --maxWorkers=1 -t 'ordinary review Back'`: exit 1, semantic RED. The actual old page function displayed The changes could not be confirmed. Try Confirm again. after ordinary Back. Receipt: `back-status-red.txt`.
3. `NODE_OPTIONS=--max-old-space-size=2048 npx.cmd vitest run tests/build-exit.test.ts tests/main-build-wiring.test.ts tests/room-tool.test.ts tests/build-exit-destination.test.ts tests/build-session.test.ts tests/land-tool.test.ts --maxWorkers=1`: exit 0, all 6 files and 175 tests passed. Receipt: `fix-wave-green.txt`.
4. `NODE_OPTIONS=--max-old-space-size=4096 npx.cmd tsc --noEmit`: exit 0 after all source changes, receipt `fix-wave-typecheck.txt` (empty on success). `git diff --check` passed; only existing CRLF-normalization warnings were printed.
5. No full suite, full build, staging, commits, pushes, native or generated edits were performed in this wave. The Git index was not changed. Root owns canonical documentation updates, source rereview, full gates and actual visual acceptance.

Source freeze and explicit release: all assigned source and the focused-test/typecheck slot are released after the checks above. Root may begin its final gates and the browser worker may recapture roster dimensions, held-key behavior and the Back status.
