# R7 natural visibility-save review

[S1] Current status: the owning worker executed ALT1, the task-window minimize control, once and it failed its 10-second acceptance deadline. The measured follow-up below supersedes the earlier conditional recommendation. Do not repeat the automated control or try another variation.

## Real goal

[G1] While a player has unconfirmed native Build edits and the review open, actually hiding the game must complete a product save containing the last confirmed world. Returning must retain the dirty draft and review. Existing bytes that happen to match that world do not establish a new save.

## Diagnosis check

[D1] The recorded outcome is an unexercised trigger. `.local-build/r7-visibility-save.log:2-13` reports matching 7,195-byte V16 data, active Build, visible review, `visibility: visible`, and `Saved game loaded`. `.local-build/r7-visibility-save-actual.log:2-6` reports `events: []` and the same load status. Neither establishes that visibility saving ran.

[D2] The worker reports three attempts: (1) CLI `tab-new` plus `tab-select`; (2) another instrumented `tab-select`; (3) explicit `context.pages()[1].bringToFront()`, followed by 30 seconds of waiting. The two supplied logs contain postchecks, not the complete action transcripts. I verified their results but cannot independently reconstruct the exact action order from those files.

[D3] Attempts 2 and 3 use the same underlying operation. The installed CLI implementation calls `tab.page.bringToFront()` inside `selectTab`; new tabs are real Playwright pages created with `browserContext.newPage()`. Source: installed `playwright-core/lib/coreBundle.js:66834-66849`. Logical page inventory does not establish native window placement or renderer visibility.

[D4] There is a concrete automation interference candidate. Installed Playwright enables `Emulation.setFocusEmulationEnabled({ enabled: true })` for main frames unless its `noDefaults` condition applies (`coreBundle.js:38891-38895`). The installed protocol describes that command as simulating a focused and active page (`types/protocol.d.ts:7255-7263`). This explains why another activation command can fail to exercise natural visibility. It is source-confirmed default behavior; the session's live launch and override state have not yet been independently observed. Calling it the proven runtime cause would exceed the evidence.

[D5] Product wiring is at the correct boundary. `web/src/main.ts:1359-1366` calls `persistence.save('Game saved')` only on a hidden edge and outside New game. `web/src/ui/persistence-controller.ts:133-152` refuses overlapping/protected saves, shows `Saving`, captures `sim.saveBytes()`, awaits the store, and then shows success. `web/src/bridge.ts:843-844` delegates to native `save_bytes()`. The worker publishes success after the write (`web/src/storage/save-worker.ts:89-94`); its write awaits writable close (`:167-176`). A new `Saving` then `Game saved` sequence after the hidden event is therefore a useful completion witness when competing saves are excluded.

[D6] Headed mode cannot be inferred from CLI page inventory. Installed CLI defaults to headless (`@playwright/cli/README.md:67-73`). The late metadata file `.local-build/r7-browser-runtime.json.log:2-30` confirms Chrome 155.0.8059.85, game target `3E426B10B78BBA3639C9A46A0ED8A5BF`, context `8A480153BEBBC41B446E44F3FDCA61F6`, and window `742959663`, normal at `(10,10)`, size `945x1012`. Separately, the owning worker reports daemon PID 80868 with `r7ui5193 --headed --browser=chrome`, child Chrome PID 78712, task profile `playwright_chromiumdev_profile-ujdujc`, no headless flag, and all three background-disabling flags. Those process facts were supplied by the worker; they are absent from the metadata file I read. The installed versions are CLI 0.1.22 and playwright-core 1.64.0-alpha-1790635538000, each from its local package.json.

## What was taken as fixed but is not

[F1] Page activation need not be the visibility trigger. The protocol supports minimizing one exact browser window, which is a separate mechanism from target activation.

[F2] Playwright's default active-page emulation is harness configuration, not required product behavior. Disabling that override on the one owned game target removes interference. The resulting configuration transition must not itself be counted as the natural hide event under test.

[F3] Existing file equality is insufficient. Retain a causal sequence: initially visible and idle, actual hidden event, product saving and completion, fresh file read, unchanged draft/review, restored visible state. The paused Build state excludes day progression as a competing autosave trigger; the owning worker must perform no manual save during the control.

## Alternative routes

[ALT1] Remove the task target's focus override, then minimize and restore its exact owned window.

Mechanism: use a Chromium page CDP session, disable focus emulation while arranging a stable visible starting state, then change the real window state. Require browser-generated trusted visibility events and product write completion.

Work required: record headed launch and ownership, resolve the game's window ID, inventory every page in that window, retain original window bounds, install read-only observers, minimize, await bounded evidence, and restore in `finally`. No source change, dependency change, synthetic event, or global hotkey is needed.

Costs and risks: temporarily hides that window. It is permitted only when every affected page/window belongs to this task. Runtime support and actual visibility remain to be demonstrated. Browser-disabling flags should be recorded; audio timing acceptance has stricter requirements than this save-trigger control.

Later effect: gives the browser harness a reusable natural hide control. It directly corrects the automation interference instead of adding another activation attempt.

[ALT2] Have the owner hide the verified task window while an automated evidence observer waits.

Mechanism: after removing the same automation override and establishing visible state, a human performs an actual same-window switch or minimize. The harness observes the resulting event and save completion without manufacturing either.

Work required: show the exact owned game window and provide one short action prompt, with the observer already armed. Restore visibility and inspect the stored baseline afterward.

Costs and risks: needs the owner present. Manual action is not automatically valid proof; the exact same event, state, completion and bytes assertions still apply. Prior project experience already found that automation target placement could leave visibility unchanged (`docs/lessons-learned.md:6355-6381`).

Later effect: remains a valid human acceptance gate when this browser cannot expose reliable automated window control. It does not repair an unexplained automation failure; that limitation remains explicitly recorded.

## Recommendation

[R1] Use ALT1, the task-window minimize control, only after the ownership and launch preconditions below are verified. The installed API contract supports it, and the installed default focus override gives a specific reason to change the harness configuration before testing. Do not run a fourth tab-selection variant. If disabling the override cannot establish real visible state, or one minimize/restore control produces no trusted hidden edge, stop automated visibility attempts and retain ALT2, the owner-operated visibility control, as the remaining gate. No product patch is justified by the supplied evidence.

## Executable precondition and control for the owning worker

[P1] The installed API contract supports `page.context().newCDPSession(page)` on Chromium (`types/types.d.ts:10343-10351`). `Browser.getWindowForTarget` without a target ID resolves the attached session's target (`types/protocol.d.ts:2334-2348`). `Browser.setWindowBounds` accepts `windowState: 'minimized'`; minimized/maximized/fullscreen cannot be combined with geometry (`:2354-2364`). These paths are under `C:/Users/myema/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core/`.

[P2] Run the following read-only inventory in the existing session's `run-code` callback before any window mutation. Do not select pages or infer ownership solely from URL. Compare its output with the task session's launch record and browser PID/profile. `Browser.getBrowserCommandLine` requires `--enable-automation`; an unavailable response means obtain the task process command line from its known PID instead, not guess headed state.

```js
const rows = [];
for (const p of page.context().pages()) {
  const s = await p.context().newCDPSession(p);
  try {
    rows.push({
      url: p.url(),
      target: await s.send('Target.getTargetInfo'),
      window: await s.send('Browser.getWindowForTarget'),
      state: await p.evaluate(() => ({
        visibility: document.visibilityState,
        hidden: document.hidden,
        focused: document.hasFocus(),
      })),
    });
  } finally { await s.detach(); }
}
console.log(JSON.stringify(rows));
```

[P3] Once ownership is proven, retain the exact game Page object and its CDP session. Arrange its window in the foreground, disable its focus emulation using the supported command below, and require `document.visibilityState === 'visible'`. Any hidden edge produced while removing emulation belongs to setup. Let its save finish, restore visible state, and prepare the intended dirty Build/review through the product again if needed. Confirm native Build is active and dirty, review visible, persistence idle, baseline bytes retained independently, and current status is not already `Game saved`. The existing `Saved game loaded` status is a suitable starting witness. The installed protocol exposes no getter for focus emulation. Preserve the original value by verified provenance: normal Playwright launch enables it, and the worker must confirm that no earlier command changed it. If that cannot be established, stop rather than claim exact restoration of an unknown setting.

```js
const s = await game.context().newCDPSession(game);
const originalFocusEmulation = true; // Only after P3 provenance is verified.
try {
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  // Establish the visible/idle starting state, then execute P4-P6 here.
  // P5 has its own inner finally to restore the exact window bounds.
} finally {
  try {
    await s.send('Emulation.setFocusEmulationEnabled', {
      enabled: originalFocusEmulation,
    });
  } finally { await s.detach(); }
}
```

[P4] Arm a document `visibilitychange` observer recording `{state, isTrusted, time}` and a MutationObserver on `#save-status` recording each new status and time. They may write task-only observer data on `window`; they must not dispatch events, alter document visibility, change the status element, call Save, or intercept product saving. Take the pre-action record only after setup events and writes have settled.

[P5] The following is the window operation and bounded wait, not a standalone complete test. `game`, `s`, task ownership, and the observer predicates must already satisfy P2-P4. Use `polling: 100`, since the default animation-frame polling may stop while hidden. The 10-second deadline is a failure boundary, not a proposed retry or longer workaround.

```js
const original = await s.send('Browser.getWindowForTarget');
if (original.bounds.windowState === 'minimized')
  throw new Error('Control requires an initially visible game window');
try {
  await s.send('Browser.setWindowBounds', {
    windowId: original.windowId,
    bounds: { windowState: 'minimized' },
  });
  // Wait for the armed observer's trusted hidden edge and a subsequent
  // Saving -> Game saved sequence; then read OPFS while still hidden.
  // game.waitForFunction(predicate, undefined, { polling: 100, timeout: 10000 })
} finally {
  await s.send('Browser.setWindowBounds', {
    windowId: original.windowId,
    bounds: { windowState: 'normal' },
  });
  const { left, top, width, height, windowState } = original.bounds;
  await s.send('Browser.setWindowBounds', {
    windowId: original.windowId,
    bounds: { left, top, width, height },
  });
  if (windowState !== 'normal') await s.send('Browser.setWindowBounds', {
    windowId: original.windowId,
    bounds: { windowState },
  });
}
```

[P6] Acceptance requires all of: trusted hidden edge after the action, actual hidden state, new saving/completion sequence, fresh stored bytes exactly equal to the independently retained committed baseline, dirty draft and review retained, then trusted visible edge and visible state after restoration. A completed protocol call is not acceptance. Existing byte equality alone fails the control, as does a save caused only by disabling emulation. Record any CDP/restore error verbatim and retain the original window state for recovery. Restore the harness's known original focus-emulation setting only after recording the natural return, or close the task session during its normal cleanup.

## What I could not determine

[U1] The late metadata establishes game target identity and window bounds; the worker supplied headed launch and task-process provenance. A same-window inventory of all affected pages and confirmation that no previous command changed focus emulation still belong to the owning worker's preflight. The protocol has no getter for the original emulation value. I did not interact with the browser, run tests/builds, or alter source/index/HEAD.

[U2] Neither installed declarations nor static product wiring prove that minimizing this particular running Chrome instance will produce a visibility transition. The proposed bounded control must establish that. If it does not, the honest remaining gate is one observed natural hide/save/return cycle while the native dirty Build review stays open.

## Measured follow-up after the single window control

[M1] The action transcript matches the supplied control source. `.local-build/r7-natural-visibility-control.js:3-14` checks window `742959663` and the retained two-page ownership inventory, brings the game forward, sends focus-emulation disable, and checks visible/idle dirty review. `.local-build/r7-natural-visibility-result.log` records the expected game and blank page in the same context/window, followed by initial `visible`, `hidden: false`, `Saved game loaded`, active Build, dirty Build, and visible review. The inventory is read from previously retained `window.__r7Ownership`; the game window identity and initial game state are queried during this control.

[M2] The minimize command returned without a reported protocol error, but the logs do not prove the native window reached minimized state. Source line 24 sends `Browser.setWindowBounds` and immediately waits for the visibility/save predicate at line 25. There is no `Browser.getWindowBounds` or `getWindowForTarget` read between that command and restoration. The recorded `windowState: normal` is the pre-action value, not a measurement while minimized. Say "the minimize command succeeded" rather than "the browser was verified minimized."

[M3] The acceptance predicate timed out with `TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.` The result contains `phase: restore`, `observed.events: []`, and `observed.statuses: []`. Thus no trusted hidden/visible event or save-status mutation was recorded during the observed interval. The logs establish the initial visible state; they do not contain a separate document-state sample during the failed wait. Do not strengthen this into continuous proof that document visibility stayed visible.

[M4] No fresh storage comparison or returned-state acceptance ran. The OPFS read at source lines 26-29 is after the failed wait, so it was skipped. The natural-return wait, final draft/review sample, and restored-window read at lines 37-39 were also skipped when the inner timeout propagated. Existing native/controller/manual-save byte evidence remains separate; this control adds no visibility-save byte proof.

[M5] Cleanup commands ran without a reported command error. Lines 30-36 request normal state and the original `(10,10,945,1012)` bounds in `finally`. Lines 41-44 request focus emulation `true`, detach the CDP session, disconnect the observer, remove its listener, and retain results. `focusEmulationRestored: true` proves the restoration command resolved. It does not independently measure the effective setting, for which the inspected protocol has no getter. Likewise, no post-restoration bounds read is present on this failure path. Report successful restoration commands, not independently verified restored window state.

[M6] The proposed focus-emulation explanation remains unproven. Removing the one target's override and issuing the supported window command did not produce the required evidence. This result neither establishes a product save defect nor shows that a real natural hide failed to save: the prerequisite hide itself was not demonstrated. No further automated variant is recommended.

[M7] The remaining gate is owner-operated natural visibility acceptance, ALT2 from the original review. With an observer armed on the exact task-owned game and a visible, idle, dirty Build review, the owner actually hides that game using its browser/window controls, then returns. Acceptance still requires the observed trusted hidden edge and hidden state, a new product save completion, freshly read committed-baseline bytes, retained dirty draft/review, and natural visible return. A human action alone is not a pass; if it produces no measured transition, the gate stays open. Keep this explicit acceptance task separate from the already passing native, controller, OPFS, manual-save and autosave checks. This is the remaining human gate, not an instruction for another autonomous tab/window experiment.

**Next steps**: Leave natural visibility saving unverified pending the owner-operated observed hide/save/return cycle. The automated route is closed; no further browser action is requested from the worker.
