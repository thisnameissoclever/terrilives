# E620 image-provenance rereview

**Approved. The mixed-image attribution finding is fixed. No actionable source or metadata finding remains in this scoped integration review.**

1. Walls now explicitly attributes its full desktop/mobile pair to `build-release-main-834` and both upstream detail images to `guide-controls-refresh-2026-10-20`. The historical `minus-fix` attribution no longer follows the replaced detail image.
2. All four Help fields explicitly name `build-release-help-e620`. The illustration figure points at the new `images/guide/help-build-exits-desktop.png` and mobile counterpart. Full viewport PNG dimensions are1440x960 and390x844; detail PNG dimensions are680x560 and358x560, agreeing with the recorded desktop/phone element rectangles. The two added crop records bind the actual full and detail image hashes, source snapshot, rectangle and original element-screenshot method. Old crop records remain as history.
3. Every recorded `imageSha256` in screenshots.json was recalculated against its current file and matched. Every new Help snapshot source-file and game-source hash also matched the current file after its stated CRLF normalization. All snapshot IDs from both7a9 ande620 are retained. The new Help snapshot explicitly describes the working-tree guide integration and native source834 rather than claiming a nonexistent final commit.
4. Pending refresh remains limited to `window-models`, `build-floors`, `build-room-outline` and `help-shortcuts`. This rereview does not imply those four groups were recaptured. Prior prose/changelog approval remains; no conflicting footer, Land or room-review instruction was introduced by this metadata correction.
5. `git diff --name-only HEAD -- crates content web/src web/index.html` remains empty. The game-source acceptance boundary therefore remains the reviewed local parent. Parent reports33 guide/changelog tests, guide/changelog builds and document-ID checks passed; current guide CSS/JavaScript, four-theme and no-script acceptance remain separately owned. This reviewer inspected metadata, file hashes and PNG headers, not the new pixels or browser operations.

Frozen metadata hashes:

| File | SHA-256 |
| --- | --- |
| docs/player/screenshots.json | 5d3d3297b6d465ad149f6afa689d1bd335c622c2ca3b0bcfd04b9fad7ca881b9 |
| docs/player/illustrations.json | 0ef5770b0803c78ad296cd12216c5485ab282fbd8dc8c7a5b4b8250f878cbfa5 |

Only this ignored report was written. No product, Git, metadata, images, tests or browser state were modified by this reviewer.

**Next steps**: Parent records final rendered-guide acceptance and completes the authorized merge, Pages deployment and public verification.
