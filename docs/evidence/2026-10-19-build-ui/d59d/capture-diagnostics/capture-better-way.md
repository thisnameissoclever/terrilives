# Chrome capture diagnosis

## Real goal

[G1] Obtain an unmodified image of the actual 390 by 844 game viewport with Keep building visibly keyboard-focused, then equivalent 390/434 dock and Back Walls evidence. The receipt identifies source `1fd2abb616be37a9c4ca328f795cf546d4aa9eba`; this review did not independently verify Git state.

## Diagnosis check

[D1] The focused JPEG is actually 390 by 218, 3,399 bytes, SHA256 `4D6B50F31F063750CC56D566FAFF65BE43C3B337A9E61E7673C59E477B490EA2`. System.Drawing decoded its original bytes. Direct image inspection shows the whole phone page reduced into roughly the upper-left 90 by 195 pixels, surrounded by dark pixels. The image viewer did not introduce the wrong dimensions. This file cannot establish matching-scale visual acceptance.

[D2] The earlier keyboard JPEG is actually 390 by 844, 28,101 bytes, SHA256 `30CE364732F339E394D313BD680F997C57F0386B32CA6AB1D0BC8827457D989F`. It has readable matching-scale controls but no Keep building outline. Its receipt explicitly records `focusVisible: false` and the entire dialog as the active element (`exit-dialog-390-keyboard.json:8-18`). Source intentionally focuses Keep after opening (`web/src/ui/build-exit.ts:300-308`) and declares the button with autofocus (`web/index.html:1610`). The earlier receipt therefore cannot establish the desired keyboard state.

[D3] The parent reports a later real Tab input established Keep as the active BUTTON with `:focus-visible` true and a solid 2px outline. I can see an outline around Keep in the reduced focused image, but cannot approve its appearance at the required scale. The parent also reports fresh CDP layout/content/visual metrics all 390 by 844, offset zero, scale and zoom one. Those measurements support a capture-surface mapping failure; they do not identify which provider operation caused it.

[D4] These were three unsuccessful acceptance attempts with different immediate failures: wrong focus, an evaluate timeout, and wrong raster geometry. They do not prove three repetitions of one browser defect. The evaluate timeout has no retained local error trace here. No evidence justifies changing application CSS or focus handling to address the wrong raster. The project explicitly requires decoded dimensions and visible contents to agree with receipts (`docs/lessons-learned.md:12740-12745`), plus independent image inspection (`docs/testing-protocol.md:236-241`).

## What was taken as fixed but is not

[F1] A high-level tab screenshot is not guaranteed by the available evidence to map one CSS viewport pixel to one saved raster pixel. DOM viewport metrics, native capture coordinates, and any provider resizing are separate boundaries.

[F2] Capturing through that wrapper is not the acceptance requirement. The requirement is original browser-rendered pixels at the measured viewport and scale. The same approved Chrome tab exposes documented CDP developer access. A read-only capture at that boundary can locate the failure without changing input, layout, visibility, or browser provider.

## Alternative routes

[ALT1] Diagnose and capture the measured Chrome compositor surface directly.

Mechanism: through the existing Cua `d59dCdp.send`, make one `Page.captureScreenshot` call with `{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:0,y:0,width:390,height:844,scale:1}}`. The clip describes the full already-measured visible viewport; it does not crop away a defect or resize a returned image. Preserve returned base64 image bytes exactly. Do not print the payload as text.

Work required: keep the before-capture metrics and focus receipt, decode and inspect the original returned PNG, then take one bounded after-capture receipt to bind focus and geometry. Require exactly 390 by 844 and actual visible Keep outline at the expected position. Retain the failed JPEG. If this works, apply the same explicit measured-viewport capture contract to the remaining authorized widths. Obtain the required fresh visual review.

Costs and risks: one new read-only mechanism and bounded verification. A correctly sized PNG can still contain stale, reduced, or clipped content; inspect its pixels. CDP may itself reveal the compositor mismatch. In that case, stop and retain the failure rather than changing parameters until something appears acceptable.

Makes easier or harder later: records the precise capture contract and separates Chrome output from wrapper behavior. It does not repair or validate the high-level screenshot wrapper; report that defect separately. This is a diagnostic route to the authoritative raster boundary, not a claim that a broken provider was fixed.

[ALT2] Repair the high-level screenshot provider's surface/scale mapping.

Mechanism: inspect its actual screenshot request, target selection, emulated viewport handling, and output transform. Compare its original browser response with its returned JPEG. Fix whichever boundary first diverges from the measured 390 by 844 viewport.

Work required: obtain provider implementation or diagnostic traces and authorization for that separate project. Add a reproducible capture contract check that covers a tall emulated viewport, keyboard input, and task-owned auxiliary-tab activation/closure, with known visible markers whose dimensions must survive capture. Do not assume the auxiliary tab caused this defect.

Costs and risks: outside this task's source ownership and currently unavailable evidence. The screenshot provider must not be patched speculatively or bypassed while claiming its defect is resolved.

Makes easier or harder later: repairs the reusable abstraction for every caller; takes longer and may require its maintainer. If direct Chrome capture also fails, the provider trace must include the lower compositor boundary rather than assuming JPEG transformation is responsible.

## Recommendation

[R1] Choose [ALT1], direct measured Chrome surface diagnosis, once. It tests the boundary below the suspect wrapper while preserving the same real page, focus, dimensions, browser, and current authorization. Accept only raw pixels that pass both dimensions and visible-state checks; success supplies valid task evidence but leaves the wrapper defect explicitly unresolved. If the direct capture also disagrees with the metrics, do not start another capture variation. Proceed with [ALT2], provider mapping diagnosis, as a documented external blocker, and complete independent work meanwhile.

## What I could not determine

[U1] I did not inspect the screenshot provider implementation, execute live browser operations, or reproduce the timeout. The parent supplied the current focus/layout readings and the exact generic CDP send documentation. The bytes and images were independently inspected. Whether auxiliary-tab activity, emulation setup, or wrapper resizing caused the divergence remains unknown.

[U2] No accepted new focused capture, refreshed dock/Back Walls review, or actual hidden-tab proof exists from this diagnosis. `visibility-observation.json` correctly says the attempted background observation remained visible. Earlier remembered visual-proof guidance was confirmed against current project testing rules; no historical runtime fact was used as current evidence.

**Next steps**: The root agent can run the single read-only CDP surface capture and apply the explicit acceptance checks. No page mutation or user decision is needed for that bounded diagnostic.
