# Fresh release adversarial review

Reviewed HEAD `1cb7b7a3dcbbac856001eac1cbd888676cfcd6fc` against main `97c2879d8d8c602895a10ef4843e86412ba1d4a8`. Read-only source review; only this ignored report was written. No product, Git, dependencies, tests or browser state were changed. Parent retains the active local check and visual-review slots.

## Verdict

One P2 behavior finding needs resolution before an unconditional source approval. No critical or data-loss defect was found. This review does not require a remote mutation campaign or a container redesign under the owner's revised delivery authorization.

## Spec finding

1. **[P2] Corrected room-review validation can silently cancel the footer's successful exit.** At `web/src/main.ts:1776`, every room-review refusal calls `buildExit.clearExitIntent()`. That increments the same continuation counter checked at `web/src/ui/build-exit.ts:267`; it invalidates ordinary footer confirmation as well as the pending Land destination. Reproduction path from the source: footer Confirm opens a split/merge review; enter an empty name and choose Update review; `RoomReviewController.confirm()` refuses it and runs `refused` (`web/src/ui/room-review.ts:113`); correct the name, Update review, then Confirm changes. Native commit succeeds and resolves the still-pending review promise, but `finish()` sees the changed generation and returns without leaving Build. The new documented footer contract says the final review Confirm changes completes exit (`docs/specs/2026-10-13-build-confirmation.md:5`). Preserve the rule that a failed Land decision cannot launch Land later, while allowing an ordinary corrected review to complete the advertised footer exit, or explicitly resolve and reestablish that intent. This is a source-derived defect; I did not execute this correction sequence. Existing invalid-name page-binding coverage stops at a pre-review refusal and does not cover correction followed by adoption. Add the actual page/native correction sequence and assert commit, one exit and unchanged clock; separately retain the failed-Land stale-destination control.

## Standards and other examined paths

1. No additional actionable standards defect found in the inspected paths. Footer Confirm/Cancel share the builder exit guard; native End remains the rollback/adoption boundary. Land gates before clearing previews, keeps the builder pause across End/Begin, blocks pending-purchase switching and clears superseded destinations.
2. Review Back explicitly records cancellation, preserves raw choices and clears false failure status. Retained review-local choices participate in exit dirtiness, including exact geometry reversal.
3. `crates/` and `content/` are identical to the supplied main in this diff. The release does not introduce a new native save format or historical adoption change. Browser confirmation still requests the native committed save projection; the changed status handling does not alter its bytes.
4. Activity tooltip source keeps text separate from orders and simulation state, limits focusability to actual clipping, tracks selected person/text, permits hover transfer and dismisses on outside interaction/Escape. CSS preserves compact/coarse minima separately from desktop sizing. Pixel and physical-input claims need their own evidence.
5. Current guide/Help describe footer exits, Land decision choices, explicit land purchase and room-review Back consistently. The October 20 changelog covers the visible UI changes. The source finding above is an exception to the advertised successful-exit behavior.
6. Inspected workflow/helper seams retain explicit fixture versus production scope, digest/source/run authentication, original-plan identity, native admission before production worker execution and complete aggregation checks. Fixture qualification cannot supply game mutation coverage. I did not exhaustively rereview every helper line or execute hosted workflows.

## Verification boundaries

1. Parent reports current integrated local script checks running in `.local-build/build-ui-followup/final-local-script-tests.log`. That file had no final result during this review. Confirm its exit status before delivery; do not call an in-progress run passed.
2. Parent's current guide receipt names this exact HEAD and records light/dark phone and desktop captures plus a no-JavaScript check. A separate fresh visual reviewer owns pixel acceptance. This source review is not that visual acceptance.
3. Relevant previous game gates may be reused only across unchanged game inputs, as recorded in the delivery ledger. The correction finding would require affected tests and renewed applicable gates if repaired.
4. Linux interruption/recovery qualification, native measured admission and exhaustive mutation coverage are not established by local script tests. State that boundary in the PR and closeout; they are not newly imposed release gates under the owner's later authorization.
5. Executed Pages deployment and actual public asset/game verification remain parent-owned delivery work. No publication claim is made here.

**Next steps**: Parent resolves the bounded room-review exit finding, records final local check results and fresh visual approval, then completes the authorized merge and live verification.


