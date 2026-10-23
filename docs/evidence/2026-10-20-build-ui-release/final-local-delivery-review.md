# Final local delivery review

Reviewed head: `1cb7b7a3dcbbac856001eac1cbd888676cfcd6fc`.
Compared with local `origin/main`: `97c2879d8d8c602895a10ef4843e86412ba1d4a8`.
The root agent owns the fresh remote fetch, final checks, visual review, Git operations and deployment. This reviewer made no repository source changes and dispatched no workflow.

## Verdict

No new actionable source defect found in the inspected release boundaries. The owner's latest instruction permits relevant local checks and a fresh adversarial review instead of waiting for remote CI. A container migration is unnecessary for that delivery route. Do not change runtime identity merely to make an unused remote campaign pass.

This is a scoped review of unresolved release risks. It does not repeat the closed model, executor, budgeting and transport reviews or claim an independent line-by-line review of every retained evidence file.

## Inspected boundaries

1. `web/src/ui/build-exit.ts`, `build-session.ts`, `build-tools.ts` and their wiring in `web/src/main.ts`: footer actions leave only after successful confirmation or rollback; the Land destination resolves the batch and starts another under the existing pause; asynchronous review cancellation invalidates the pending destination. Repeated activation is blocked while confirmation is pending. Existing behavioral tests exercise confirmation refusal, rollback refusal, duplicate activation and cancellation of pending Land intent.
2. `web/src/ui/activity-tooltip.ts`, dock markup/CSS and its tests: measured clipping controls availability; text uses `textContent`; selected-person changes close the popup; Escape does not reopen it during background refresh; viewport movement and resize reposition it. Touch activation and keyboard propagation have behavioral coverage. Actual physical touch and operating-system key repeat remain outside the evidence.
3. `.github/workflows/ci.yml` and mutation tool/runner/recovery/qualification code: preparation and workers retain the eight existing global slots; fixture and production identities remain distinct; exact runtime changes refuse execution; qualified fixture discovery cannot substitute synthetic proof; interruption tests freeze records before signaling and reject cleanup failure. The final transport patch retains independent original artifacts, stable completed-job availability anchors and bounded HTTP error handling. Its local focused tests and guard-removal controls are retained in the dated evidence.
4. `.github/workflows/pages.yml`: the existing manual `validated_sha` route requires the main ref and exact workflow commit. It still runs the site build and actual deployment, with a final stale-revision check. Local-CI authorization does not justify skipping that deployment or treating a skipped deployment step as success.

## Minimum remaining verification

1. Complete one integrated local CI-script run on the final source if the root agent has not already done so. The current anchor patch has focused checks; the last recorded full Linux script suite predates that patch. Use `.github/scripts` unittest discovery with one process. This covers the changed Python orchestration without another exhaustive game mutation campaign.
2. Finish the remaining static-guide screenshots and no-script reading with the now-authorized existing browser tool. Inspect the actual images and obtain the scoped fresh visual verdict. Retain the accepted gameplay frames and their stated limitations.
3. Recheck the delivery date, current main and changelog before the final push/merge. If integration changes relevant game inputs, run the affected checks. Reuse the existing passing game build, type checks and tests when their source is unchanged.
4. After merge, execute Pages publication through its supported route. Verify the deployment step ran, compare live JavaScript/Wasm bytes with the actual Pages artifact, verify the live game, and synchronize this checkout cleanly to remote main.

## Explicit evidence limits

The latest actual remote fixture failed on a real hosted-image mismatch. It establishes neither successful Linux interrupted/resumed fixture qualification nor exhaustive production mutation coverage. The local process fixtures and API simulations cannot establish GitHub scheduler or upload behavior. Under the owner's revised local-check delivery authorization, these remain reported operational limits rather than fabricated passing gates or a reason to hold the UI release for another remote sweep.

The retained evidence contains whitespace in original transcripts and nested historical diff files. A broad `git diff --check` therefore reports those records. The scoped check over `.github`, `web`, `docs/player` and `docs/mutation-campaign.md` passes. Do not rewrite raw historical evidence to make a cosmetic check green.
