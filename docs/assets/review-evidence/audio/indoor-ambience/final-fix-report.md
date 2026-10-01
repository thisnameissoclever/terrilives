# Final indoor-ambience fix wave

Runtime and dist frozen after the final production build. The lifecycle fix,
maximum-level proof correction and independent missing-low-seed tests are
complete locally. Root owns fresh native verification, the predeclared lifecycle
identity diagnostic and delivery. No browser acceptance or subjective listening
is claimed here. The held raw memory median remains 123,972 bytes against the
unchanged 65,536-byte allowance. No six-run acceptance was rerun.

## Scope and mechanism

Worktree: `D:/VIBES/.worktrees/indoor-ambience/terrilives`.
Branch: `twcx/indoor-ambience`. Assigned base:
`76d541b0c4fbb1e55fd4e73d034042ada9157b99`; root added documentation-only
`7fd66e34` before this local fix commit. No Rust, dependency, main-worktree,
external write, push, PR or merge changes were made.

The controller owns its AudioContext `onstatechange` handler. Non-running
events immediately clear every retained player, demand and scheduler, regardless
of simulation ticks. The handler does not restart sound on recovery. Closed
graph replacement detaches the handler, and its captured context identity rejects
queued stale callbacks. Global player cleanup now immediately disposes release-only
conversations as well as active conversations.

Approved public seams: controller methods and observable browser node ownership;
frame integration; native offline output; memory analyzer metadata. Five new
regressions start positive room, object, conversation, door and procedural sources,
pause at 4.25, interrupt at 4.30 and recover automatically without a fixed tick or
new gesture. Sources must disconnect and clear callbacks. Room demand restarts
only after a new running-world observation.

The corrected room proof forwards native OfflineAudioContext state events during
interruption, without calling `beginFootstepFrame`. Peak is now rendered at
Effects 100% and Ambience 100%; the reference RMS remains Effects 70% and is
explicitly labeled. Twelve independent missing `seed.low` cases cover both
controls and both endpoints in all three repetitions, while retaining valid
`seed.high`. The production memory analyzer and its limits are unchanged.

## Red and correction evidence

Commands below run from `web/` unless stated otherwise. Each command's exit code
is recorded independently, even when the shell invocation contained later checks.

Before runtime changes:

```text
npx vitest run tests/audio-controller.test.ts -t 'context events discard' --maxWorkers=1
Exit 1: 5 failed | 226 skipped (231)
room, object, conversation, door, procedural all failed:
AssertionError: expected false to be true // Object.is equality
audio-controller.test.ts:42
expect(sources.every(source => source.disconnected && source.onended === null)).toBe(true)
```

The first implementation cleaned four families, but the conversation case still
failed at the same assertion: `1 failed | 4 passed | 226 skipped`, exit 1.
The cause was `stopEveryPlayer()` calling the voice player's default fading
`stopAll()`. Changing that boundary to `stopAll(true)` disposed existing releases.
The whole controller file then passed 231 tests, exit 0.

The first covering run passed 422 tests. Its subsequent typecheck reported
`TS18047: context is possibly null` in the captured mutable context, and
`TS2345: simId is missing` in the new conversation fixture. Capturing a non-null
context constant and supplying the required `simId: 4` corrected those errors.
Final typecheck passed. These errors did not change runtime behavior or contracts.

## Targeted fault detection and exact restoration

1. Deleted event handler `this.stopEveryPlayer()` only. Ran the same
   `context events discard` command: exit 1, all five cases failed the disconnected
   source assertion. Restored the statement.
2. Removed `this.context !== observedContext` from the handler guard.
   `npx vitest run tests/audio-controller.test.ts -t 'stale room completion' --maxWorkers=1`
   exited 1: `expected +0 to be 1` at line 75 after the abandoned callback silenced
   the replacement graph. Restored the guard.
3. Removed only the low-half comparison from the analyzer's `seeded` predicate.
   The existing metadata test failed first with
   `0:0:seed:change: expected true to be false`, exit 1. After adding independent
   omission cases, the same deliberate fault was applied and
   `npx vitest run tests/audio-memory-report.test.js -t 'missing low seed' --maxWorkers=1`
   exited 1: all 12 cases failed `expected true to be false` at line 93.
   Restored the low-half comparison.

Before and after each controller fault, SHA-256 was exactly
`0BC65251D9ECE476ED489E7680420B9DE1B77A7DACB14BE53120E0331B1E41F9`.
Before and after each analyzer fault, SHA-256 was exactly
`E513BE85AC5A50633648AD9C92FBF759B59AE606B02DBB4DDE7C406563DB6F42`.
`git diff --numstat scripts/audio-browser-proof.cjs` produced no differences.
These deliberate faults were detected and restored; they were not failed repair
attempts. No fault remains in the tree.

## Final focused verification

1. `npx vitest run tests/audio-controller.test.ts tests/room-ambience.test.ts tests/frame-audio.test.ts tests/frame.test.ts tests/audio-memory-report.test.js tests/room-ambience-source.test.js tests/voice-clips.test.ts tests/object-loops.test.ts tests/recorded-doors.test.ts tests/procedural-cues.test.ts --maxWorkers=1`
   passed, exit 0: 501 tests in 8 actual matching files. The last two names have no
   matching files; their source families are covered by controller cases and the
   separate door suite below. This is not a claimed ten-file run.
2. `npx vitest run tests/door-audio.test.ts tests/door-audio-bridge.test.ts tests/activity-cues.test.ts tests/object-cues.test.ts --maxWorkers=1`
   passed, exit 0: 39 tests in 4 files. Total focused coverage is 540 tests in 12
   files. The pre-fix whole suite was reported as 1,768 passing by root; it was not
   rerun without a concrete cross-cutting concern.
3. `npm run typecheck` passed, exit 0, no diagnostics.
4. Root was notified before `npm run build`. Build passed, exit 0: Vite 8.1.5,
   88 modules, 276 ms; production entry `index-D_MKRowA.js` 406.26 kB.
   Dist/runtime frozen notice was sent immediately afterward. No preview server
   or browser was started by this worker.
5. From repo root, `node --check web/proofs/room-ambience.js` passed, exit 0.
   A Vite module/export smoke passed, exit 0:

   ```text
   node --input-type=module -e "const {createServer}=await import('vite'); const server=await createServer({server:{middlewareMode:true},appType:'custom'}); try { const proof=await server.ssrLoadModule('/proofs/room-ambience.js'); if(typeof proof.proveRoomAmbience!=='function') throw Error('Missing proof export'); console.log('Room proof Vite module/export smoke PASS'); } finally {await server.close();}"
   Room proof Vite module/export smoke PASS
   ```

   Two plain Node import attempts failed before using the supported Vite loader:
   strip-only Node rejected TypeScript parameter properties, then experimental
   transform-types could not resolve source `.js` imports to `.ts` files. Both
   exited 1. No dependency or source workaround was added. Module smoke does not
   render native audio; root owns that separate check.
6. From repo root, `python check-doc-ids.py` passed, exit 0:
   `Documentation ids are unique and allocation-free.`
7. From repo root, `git diff --check` passed, exit 0, no whitespace errors.

The spec now explains the context event owner and identifies the historical
paused proof's manual observation gap. Lesson
`L-paused-audio-proof-needs-native-lifecycle` records the cause, prevention and
causal verification. Root-owned evidence assets were not edited. This report is
local ignored handoff material and is not force-added.

Root subsequently reported native proof PASS, exit 0, in
`web/output/playwright/indoor-ambience/native-lifecycle-fix.json`: all ten checks,
interrupted-release resumed tail zero, Effects/Ambience-100% peak
0.020989106968045235 and Effects-70% reference RMS 0.004350840998437651.
This is root-reported rendered evidence, not this worker's subjective listening.
Root's three-epoch identity diagnostic is running against `index-D_MKRowA.js`;
runtime and dist remain frozen.

**Next steps**: Root verifies corrected native output and the predeclared identity
diagnostic. The failed memory gate stays held; delivery and subjective listening
remain separate decisions.
