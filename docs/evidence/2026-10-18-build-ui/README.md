# Build exit, activity text and compact controls

This dated record covers the follow-up to room identities on base `2b15dcfea9b6a147eec87b11607118f3c3349e1d`. It records local source review, actual game interactions, checks and capture limitations. It does not establish publication.

## Behavior

1. Footer Confirm keeps the build and exits; footer Cancel restores the confirmed build and exits. Contextual tool cancellation still clears only that selection.
2. Switching to Land resolves pending edits through Keep building, Discard changes or Confirm changes. Successful resolution starts a clean Land session while the builder pause remains active.
3. Keep building is neutral and initially focused. Red Discard precedes green Confirm. Keyboard activation guards cover opening, returning focus and completion.
4. Deliberate Back from room review preserves the draft and does not report a failed confirmation. Genuine refusals remain visible.
5. A clipped selected activity reveals full literal text through hover, focus or activation. The popup follows real progress and closes when dismissed or no longer relevant.
6. Dock header buttons measure 27px and person buttons 28px on desktop. Compact and coarse-pointer controls measure 36px. Widths and fonts remain unchanged. Build's minus uses a small SVG, and repetitive ready messages are removed.

## Checks and source review

The frozen full run passed type checking and 3,812 of 3,813 tests. Its sole failure required the former 44px compact dock height. The final test-only correction expects the requested 36px; all 54 tests in that file then passed. This is a failed full-run receipt followed by a passing focused correction, not a claim that the full suite was rerun locally. The production build passed with the existing asset-chunk warnings.

Documentation IDs, all 12 changelog tests and changelog generation passed. The release Wasm build passed; its digest is in `wasm-build-receipt.json`. This branch changes no native source or save format.

`fresh-code-review.md` records the initial findings. `fix-wave-review.md` accepts their fixes and the actual-browser Back and intrinsic-height corrections. The retained RED and GREEN records distinguish actual regression failures from an earlier fixture setup error. The two documentation discrepancies identified in that review were corrected in the canonical string inventory and Build confirmation specification.

## Browser and image evidence

`browser-report.md`, `browser-receipts.json` and `browser-final-source-hashes.json` record actual native-game interactions. Child browser rendering does not prove a displayed pane. The earlier parent-played images likewise predate explicit pane visibility verification. The displayed parent capture later verified visibility, but its saved image was distorted and is rejected.

`image-provenance.json` maps retained JPEG files to their original names, actual decoded dimensions and hashes. Several original filenames ended in `.png` despite containing JPEG bytes. Retained copies preserve those bytes under the correct extension. No video or trace archive is retained.

The blind minus review rejected `panel-62.jpg`, the isolated known defect, and accepted `panel-41.jpg` and `panel-87.jpg`. The corrected and restored images are byte-identical. `fresh-visual-review.md` records each accepted scope and rejects four final captures whose pixels disagree with their recorded viewport or state. Those rejected phone and Back-state claims require replacement evidence before full visual approval.

`root-replacement-dialog390.jpg` is also rejected. Its paired receipt records a 390px CSS viewport and a dialog button approximately 320px wide, but the saved image paints that button approximately 247px wide and leaves unused black space. Matching file dimensions alone cannot approve the layout. `browser-capture-better-way.md` records the capture diagnosis and limits.

Physical touch and operating-system held-key repeat were unavailable. Component tests and ordinary pointer or keyboard interactions do not substitute for those hardware checks. The optional long-name stress attempt did not establish a committed model change and does not establish an editor defect.
