# Fresh Build UI source and specification review

Reviewed the frozen `final-source.diff` against base `2b15dcfea9b6a147eec87b11607118f3c3349e1d`, the two implementation reports, current Build/room/action-color/dock/string contracts, relevant lessons, and Testing Protocol section 9. Source reads outside the diff were limited to transaction, room-review, roster, input, and status-rendering integration. No source, index, HEAD, references, dependencies, browser sessions, servers, or test suites were changed or run.

## Strengths

1. Footer completion now uses native adoption before leaving. Confirmation refusal, room-review Back, and retained local room input remain distinct from successful completion. The actual-page tests inspect native session state and clock preservation instead of treating a clicked button as adoption.
2. The Land boundary intercepts selection before previews are cleared, resolves through the existing dialog, and ends/begins synchronously under the existing builder pause. The page blocks switching away from a pending Land purchase and preserves same-Land reselection.
3. Tooltip text is assigned through `textContent`; same-person progress changes update an open popup, while dismissed details stay closed during observer delivery. Roster node identity handles different people with identical names. Viewport limits and text wrapping are explicit, without adding a global store or a polling loop.
4. The icon repair keeps the existing button and accessible name and changes only the glyph presentation. Dock sizing changes only the requested minimum heights; its activity button has no added minimum-height row.
5. The evidence distinguishes focused mocked/controller checks, real module/page-binding tests, type checking, and actual browser acceptance. The reported 281 focused tests and 8 tooltip tests do not establish final full-suite, visual, deployment, or live success.

## Issues

1. **[P2] Guard held Enter when the decision opens and when Keep restores focus.** `web/src/ui/build-exit.ts:167` checks `guardActivationKey`, but the guard is set only after successful completion at lines 240, 285 and 293; `ask()` at line 300 and the Keep answer path at line 313 leave it unset. With dirty edits and keyboard focus on Land, holding Enter opens the dialog and focuses Keep building. The next repeated Enter is allowed to activate Keep, returns focus to Land, and another repeat can open the dialog again. This causes repeated decisions from one held activation, contrary to the explicit key-repeat requirement. This finding is derived from the native button-default path and source; this review did not run the browser. Arm the activation guard across keyboard-caused opening and Keep dismissal, retaining it until a fresh activation press. Add a regression that models native Enter activation after unprevented keydown, asserting that repeated Enter neither closes the newly opened dialog nor reopens it after a deliberate Keep.
2. **[P2] Finish the requested removal of redundant narration in the remaining Build controllers.** `web/src/ui/land-tool.ts:26` still publishes `Choose a strip of land.` beside the three literal side controls, and `web/src/ui/room-tool.ts:17` still publishes `Ready to build, with a doorway.` for the already valid outlined room. The matching static Land status remains at `web/index.html:1466`. These are the same generic choose/ready messages removed from Furniture, Buy and Floors, and no exception for them was approved. Remove these redundant status values and collapse their empty status elements. Preserve the actual Land quote, remaining funds, buying progress, refusal, and receipt; preserve room first/opposite-corner progress and the nonobvious instruction about choosing a doorway. The `Ready to build.` prefix at room-tool line 16 can be removed while preserving that doorway instruction. Update the affected focused assertions and copy inventory. Initial Wall/Window edge guidance supplies an otherwise nonobvious targeting rule; it can stay in optional Help without requiring a generic status duplicate.

No Critical findings were identified. The first finding concerns repeated interface activation rather than observed data loss. The second is incomplete requested scope rather than a native transaction defect.

## Declined to judge

1. Actual pixels, focus clearance, hover transfer, touch behavior, popup scrolling, camera/order isolation, and measured control border boxes: these require the separately assigned actual-game and independent visual passes; static source and mocked geometry cannot approve them.
2. The native room reconciliation, save migration, order, attendance, and conversation algorithms: unchanged in this frozen patch. I checked the web transaction integration and treated the supplied baseline CI evidence as historical evidence, without reauditing native internals.
3. Final full web/type/build/documentation/changelog results, final remote checks, deployment and live publication: root-owned acceptance/delivery steps were still pending when this review ran. Their completion is not inferred from the focused results.

## Assessment

**Ready to merge: With fixes.** Resolve the two bounded findings, then obtain a scoped source rereview and complete the already required final checks and played visual acceptance. The transaction and tooltip structure otherwise match the stated scope without a new framework, native changes, or dependencies.

**Next steps**: Root owns the fixes, focused regression verification, visual acceptance and delivery.
