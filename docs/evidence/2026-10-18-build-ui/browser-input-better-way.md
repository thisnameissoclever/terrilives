# Browser input approach review

## Real goal

[G1] Players can leave or switch Build tools deliberately, read clipped activity text through mouse, keyboard, or touch, and use the smaller dock without accidental actions. Verification must establish the interaction actually exercised, preserve the household, and state which input and display conditions remain unobserved.

## Diagnosis check

[D1] Confirmed: the direct touch and repeated-key routes failed at the automation boundary. The retained errors explicitly reject `Input.dispatchTouchEvent` and raw `Input.dispatchKeyEvent`; the ordinary 900 ms Escape press produced one trusted `repeat:false` keydown. These failures do not establish a game defect or key-repeat coverage. Evidence: [failure log](touch-input-failures.md:4), [key receipts](receipts.json:1612), [input-limit receipt](receipts.json:1648).

[D2] Confirmed: mouse-to-touch emulation partially reached the page, then the ordinary input command hung. The receipt records a trusted `pointerdown` with `pointerType:touch` and trusted `touchstart`, with no recorded release or click. This is sufficient to reject the attempted tap as incomplete. It supports an input-state hypothesis, but does not identify whether the unfinished sequence lives in the target, helper, or browser session. Evidence: [partial sequence](receipts.json:1756).

[D3] Confirmed with a limit: both emulation flags were restored and later ordinary pointer input still timed out, while keyboard, DOM observation, and screenshots worked. Restoring configuration does not prove cancellation of an outstanding input sequence. No page-side capture or helper deadlock was measured. Evidence: [restoration and later failure](touch-input-failures.md:7).

[D4] Refuted: this evidence does not justify modifying the tooltip or Build controller to accommodate the failure. The tooltip deliberately uses mouse-only hover, shared button click activation, and pointerdown propagation control; it does not cancel pointerup. Build repeat handling consumes `event.repeat` supplied by the browser. The failed input tool cannot test those omitted events by inference. Evidence: [activity-tooltip.ts](../../../web/src/ui/activity-tooltip.ts:74), [shared activation](../../../web/src/ui/activity-tooltip.ts:91), [Build repeat handling](../../../web/src/ui/build-exit.ts:163).

[D5] The documented fresh-tab guidance is relevant but narrower than a confirmed fix. Browser Interaction Troubleshooting says to retain the selected browser and obtain/create a fresh tab for stale or missing targets or unavailable injected helpers. It does not promise that this exact `Input.dispatchMouseEvent` timeout is per-target. A fresh same-browser tab is a supported control experiment and possible test-environment recovery, not a demonstrated repair of the broken input mechanism. Evidence: `C:/Users/myema/.codex/plugins/cache/openai-bundled/browser/26.1013.40934/docs/browser-troubleshooting.md:3-6`.

[D6] The current IAB documentation exposes locator clicks and key presses, but no dedicated touch/tap operation or guaranteed OS key-repeat operation. The explicit raw-input rejections settle those attempted routes. An advertised emulation setting alone does not guarantee an end-to-end trusted touch sequence. I read the current selected-browser documentation through Cua; I sent no page input, changed no emulation, and created no tab.

## What was taken as fixed but is not

[F1] One task tab does not have to prove every input modality. The game DOM controller, browser default activation, automation transport, and hardware behavior are separate boundaries. The tooltip's shared click listener is valid evidence for button activation; actual touch still needs a completed trusted touch sequence. Existing tests explicitly emit fabricated controller events, so their touch and repeat cases remain controller evidence. Evidence: [touch controller test](../../../web/tests/activity-tooltip.test.ts:121), [fake key source](../../../web/tests/build-exit.test.ts:83), [held Enter controller case](../../../web/tests/build-exit.test.ts:230).

[F2] A screenshot of a rendered child tab does not establish that its pane was displayed to the user. Retain those images as rendered-page evidence and keep the root's displayed gameplay pass distinct. The project explicitly requires a displayed browser and inspection of the actual images. Evidence: [testing protocol](../../../docs/testing-protocol.md:207), [inspection requirements](../../../docs/testing-protocol.md:229).

[F3] A fourth variation of raw input is unnecessary. The real unresolved question is whether documented normal input still works on a clean target in the selected browser. Testing that narrower question can bound the incident without inventing product changes or claiming unsupported coverage.

## Alternative routes

[ALT1] One fresh same-browser control, using normal input only

Mechanism: Keep the original tab and its failure receipts intact while creating exactly one fresh task-owned tab through the existing selected IAB binding. Load the same actual game build and perform one ordinary semantic click on a visible, enabled, reversible control such as Help. Do not enable either touch emulation setting.

Work required: The tab owner records its ID, URL, source/build identity, viewport, fresh DOM target, and before/after state. Prefer a control whose visible result is unambiguous. A successful Help opening followed by its normal close is sufficient for the input control; it need not replay the household preparation.

Costs and risks: A new game page can share origin storage with the original. Do not import, reset, overwrite saves, or reproduce setup through persistence changes. Keep only one game actively running. This restores a usable verification surface if successful; the original automation defect remains unresolved.

Makes easier or harder later: If the control succeeds while the retained old-target failure is unchanged evidence, the failure is consistent with target-associated state rather than a total browser input outage. It does not prove the precise helper defect. If the fresh target fails with the same dispatch timeout, stop pointer testing immediately. That raises a browser/session-level hypothesis, but still does not prove its root cause. Do not create a second fresh tab, retry the old target, switch automation technology, restart browsers, or try new raw input methods.

[ALT2] Report bounded coverage and complete exact-modality acceptance on suitable hardware

Mechanism: Keep the successful actual-game mouse and keyboard evidence, controller tests, and visual inspection. Mark real touch tap and trusted OS repeat as unverified. Use a physical touch browser and physical keyboard for those two remaining acceptance checks when available and authorized.

Work required: For touch, tap clipped activity, tap it again, tap outside, and verify progress updates while open, with no game action beneath it. For held keys, hold Enter through a Build exit dialog opening and deliberate Keep activation/focus restoration; repeat must not trigger the newly focused control. Check held Escape separately. Observe state and actual repetition; a duration parameter or repeated independent keypresses does not prove repeat semantics.

Costs and risks: Requires a suitable device or owner session. It leaves an explicit acceptance gap until then. Do not describe a mouse click as touch, a controller fake as trusted browser input, or a screenshot as proof of physical behavior.

Makes easier or harder later: Keeps release evidence truthful and avoids contaminating normal pointer QA with experimental emulation. The existing physical-device acceptance distinction is documented for native mobile callouts. Evidence: [touch acceptance lesson](../../../docs/lessons-learned.md:11914).

[ALT3] Repair the browser input provider before requiring automated touch acceptance

Mechanism: Supply the tool maintainer with the unsupported-method errors and incomplete trusted sequence. Require a documented touch operation with complete start/end or cancellation semantics, plus documented repeated-key support, before adding those modalities to automated acceptance.

Work required: A maintainer reproduces normal click before emulation, the partial touch conversion, restoration, and normal click after restoration in an isolated target, then fixes and validates the input lifecycle. The fresh-target result from [ALT1] One fresh same-browser control would narrow the report. No browser-use source inspection or provider modification is authorized in this task.

Costs and risks: External maintenance and uncertain timing. This is the route that can repair the input mechanism itself; a new tab only recovers the test environment.

Makes easier or harder later: Establishes reusable supported touch and repeat verification. It cannot be completed by speculative changes to game event listeners.

## Recommendation

[R1] Take [ALT1] One fresh same-browser control exactly once, then use [ALT2] Report bounded coverage for any modality the tool still cannot produce. The normal pointer recovery question is worth one clean control because it determines whether ordinary browser QA can continue safely. The attempts already establish that further raw touch/key variations are the wrong track. If the fresh control succeeds, finish only the remaining normal mouse/keyboard checks and the displayed visual pass; retain the touch/repeat gap explicitly. If it fails, stop input recovery, retain the tool incident, and continue independent checks. Do not patch the game without a reproduced game defect. [ALT3] Repair the browser input provider remains the actual mechanism fix if automated touch becomes mandatory.

[R2] Cleanup belongs to the tab owner in a finally block: remove any observation listeners, restore temporary viewport overrides, and close task-owned verification pages when their evidence is retained. Preserve existing failure artifacts and task save data. Do not close user Chrome tabs or another task's pages, restart shared browsers, or stop another task's server. This review performed no input, tab resets, server operations, or repository source/index/ref/dependency mutations.

## What I could not determine

[U1] Exact timeout cause and scope remain unverified. The retained sequence lacks release events; it does not reveal an input-helper lock, pending CDP response, pointer capture owner, or browser-session state. The single clean-target control can narrow scope. Provider-level diagnostics would be needed to establish the mechanism.

[U2] No completed trusted tap or trusted repeated Enter sequence is present in the reviewed receipts. The current source and controller tests cannot fill that gap. No undocumented API was guessed or attempted.

[U3] I did not replay gameplay, judge the screenshots, or approve overall Build/UI delivery. This review covers the failed verification approach and its bounded recovery path only.

**Next steps**: The root agent can authorize the tab owner to perform [ALT1] One fresh same-browser control once, retain its result, and follow [R1] Recommendation without further input-method experiments.
