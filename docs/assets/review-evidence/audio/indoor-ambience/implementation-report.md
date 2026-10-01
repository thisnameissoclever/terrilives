# Task 1 implementation report

Status: implementation complete locally; delivery held for retained-memory diagnosis and independent review.

## Scope and ownership

Worktree: `D:/VIBES/.worktrees/indoor-ambience/terrilives`, branch `twcx/indoor-ambience`. Main source base is `6df7c045`; design commit is `8a21a214`. This implementer owned Task 1 runtime, UI, source preparation, tests and docs. Root owned production/native browser verification and all external delivery. No dependencies, downloads, paid services, Rust source, saved-world contracts or held PR 178 changes were made. Root-owned `web/output/` is excluded from this commit.

The mandatory writing skills governed literal controls and reports; no unrelated game copy was rewritten. Relevant audio lifecycle, transactional cleanup, testing and owner-listening lessons were read before changes. An initial registry memory scan found historical delivery topics but supplied no current implementation facts.

## Implemented behavior

1. Dedicated RoomAmbiencePlayer owns one active and one fading source, with 100 ms attack/release and gain 0.15. Immediate stops disconnect every retained source, even without native end callbacks. Stop-time eviction prevents two simultaneous fading owners; stale callbacks cannot dispose a replacement.
2. Deterministic eight-second, mono 48 kHz PCM16 synthetic indoor air ships as audible content. Seeded noise is filtered at 180/1800 Hz, overlapped offline for 100 ms and DC-corrected. The generator refuses different existing bytes; it does not normalize or replace unrelated audio.
3. Graph: room source -> envelope -> Ambience -> Effects -> master. Ambience defaults to 25%. Voices does not affect room sound; source playback rate remains one at every simulation speed.
4. Only sampleSimAudioAfterTick's explicit world observation establishes demand, after all world columns are acquired. Initialization, standalone frame methods and gestures alone neither fetch nor start the texture. Existing standalone frame cleanup also disposes frozen room releases.
5. Pause and blocking overlays clear demand and fade. Load, mute, Effects zero, hidden tabs, non-running clock and Ambience zero invalidate appropriate demand and immediately release room nodes. Raising Ambience or recovering availability requires a fresh observation. Options itself remains non-pausing.
6. Loading is demand-driven, coalesces pending work and caches success. Failure has a five-second cooldown and cannot cause per-tick retries while unchanged demand persists. Fresh transitions or trusted gestures can retry. Context identity guards prevent stale completion from installing into a rebuilt graph; closed graph replacement detaches its room load gate.
7. Version-1 preferences preserve valid mute/Effects/Voices when ambienceLevel is missing or invalid. Ambience falls back to 0.25, finite programmatic values clamp, nonfinite values use the default. Preview never stores; commit stores once. UI ranges are silent and literal, with existing touch-sized/scrollable Options behavior.
8. Stress getters are ambienceVoices, retainedAmbienceVoices and ambienceStarts. Memory analysis requires positive enabled room playback, zero disabled starts, bounded counts and fully drained endpoints. The 65,536-byte allowance and exact DOM/document/listener equality are unchanged.

## Source identity and measurements

1. Runtime/source path: `web/public/audio/ambience/indoor-air.wav`, 768,044 bytes, 384,000 PCM16 mono frames at 48 kHz.
2. Source and production runtime SHA-256: `714374c981c63e1ac3a96e493687dfc4cca176aaeb12b14a984c00caed0dc42b`.
3. Editable generator SHA-256: `7179eecdc6b4382a9d9eaa1a1416d6462b2a0734afa6cc7a321eb22a1cde3d92`.
4. PCM RMS: 0.040930368192786046; peak: 0.155731201171875; mean: 0.000000021696090698242187; endpoint discontinuity: zero.

## Local checks

Commands ran from the worktree root unless the Web directory is named.

1. `npm ci --offline --ignore-scripts --no-audit --no-fund` in web: exit 0, 48 packages installed from the existing lockfile/cache. PASS.
2. `$env:CARGO_TARGET_DIR='D:/VIBES/terrilives/target'; wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm --offline`: exit 0, optimized release build completed in 20.14 seconds. Shared target was reserved by root before compilation and released immediately afterward. PASS.
3. Baseline `npx vitest run tests/audio-controller.test.ts tests/object-loops.test.ts tests/audio-controls.test.ts tests/frame-audio.test.ts --maxWorkers=1` in web: exit 0, 255 tests passed in four files. PASS.
4. TDD player test initially failed with missing room-ambience module; its implementation passed. Controller ready-world test initially failed with `controller.observeRunningWorld is not a function`, then passed. Generator test initially failed with missing build-room-ambience.mjs, then passed. Stronger stop-time fade bound failed with `expected 2 to be 1`, then passed after stop-time eviction. These were intentional red checks, not acceptance failures.
5. Final focused controller run: `npx vitest run tests/audio-controller.test.ts --maxWorkers=1`: exit 0, 226 tests passed. Covers pending decode across seven boundaries, stale context, retry cadence, cache/coalescing, malformed duration, independent object loading and preference fallback.
6. Final player/source runs passed 11 player tests and three source tests. Source checks include exact bytes/hash, signal bounds and isolated publication refusal without touching the runtime WAV.
7. Final controls/frame/report run: `npx vitest run tests/audio-controls.test.ts tests/frame-audio.test.ts tests/audio-memory-report.test.js --maxWorkers=1`: exit 0, 97 tests passed. PASS.
8. `npx vitest run --maxWorkers=1` in web: exit 0, 1,746 tests passed in 116 files, duration 21.37 seconds. This was the single full-suite run. PASS.
9. `npm run typecheck` in web: exit 0, tsc --noEmit. PASS.
10. `npm run build` in web: exit 0, Vite production bundle including the actual WAV. Final runtime bundle is `index-BiPUJ904.js`; source and dist WAV hashes match. PASS.
11. `python check-doc-ids.py`: exit 0, `Documentation ids are unique and allocation-free.` PASS. An earlier invocation from web failed because the script resolves docs relative to cwd; rerunning at repository root corrected the invocation, not the guard.
12. `git diff --check`: exit 0, no output. PASS.

## Targeted mutations and exact restoration

Every mutation was applied with apply_patch, ran its covering test, was restored with the inverse patch, and had equal before/after SHA-256. The final controller differs from these hashes only by a subsequent comment correction; no executable behavior changed after this mutation series. Logs below are actual covering-test output excerpts.

### 1. demand

File: `web/src/audio/audio-controller.ts`. Command: `npx vitest run tests/audio-controller.test.ts -t 'room demand requires' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `e411b303bc1c4d272176391e86643300a28bd2ccafbe5523537137381f2aba7b`.

```text
AssertionError: expected "vi.fn()" to be called once, but got 0 times
 Test Files  1 failed (1)
      Tests  1 failed | 225 skipped (226)
```

### 2. invalidation

File: `web/src/audio/audio-controller.ts`. Command: `npx vitest run tests/audio-controller.test.ts -t 'late room decode' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `e411b303bc1c4d272176391e86643300a28bd2ccafbe5523537137381f2aba7b`.

```text
AssertionError: expected [ FakeBufferSource{ …(10) } ] to have a length of +0 but got 1
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed | 219 skipped (226)
```

### 3. cleanup

File: `web/src/audio/audio-controller.ts`. Command: `npx vitest run tests/audio-controller.test.ts -t 'room demand requires' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `e411b303bc1c4d272176391e86643300a28bd2ccafbe5523537137381f2aba7b`.

```text
AssertionError: expected 1 to be +0 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 225 skipped (226)
```

### 4. gain-route

File: `web/src/audio/audio-controller.ts`. Command: `npx vitest run tests/audio-controller.test.ts -t 'late room decode' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `e411b303bc1c4d272176391e86643300a28bd2ccafbe5523537137381f2aba7b`.

```text
AssertionError: expected [ FakeGain{ …(3) } ] to deeply equal [ FakeGain{ …(3) } ]
 Test Files  1 failed (1)
      Tests  7 failed | 219 skipped (226)
```

### 5. fixed-tick

File: `web/src/audio/frame-audio.ts`. Command: `npx vitest run tests/frame-audio.test.ts -t 'establishes room demand' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `f0749dbecd12ea5da0edcdb388a37761ad41ca8d73d56212c467f9045e7729da`.

```text
AssertionError: expected "vi.fn()" to be called once, but got 0 times
 Test Files  1 failed (1)
      Tests  1 failed | 21 skipped (22)
```

### 6. room-bound

File: `web/src/audio/room-ambience.ts`. Command: `npx vitest run tests/room-ambience.test.ts -t 'bounds rapid' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `8dda2345c80a6c0024d9b30160289715d074462d23cbe121e6f9d3ca74b31d1e`.

```text
AssertionError: expected 2 to be 1 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 10 skipped (11)
```

### 7. positive-report

File: `scripts/audio-browser-proof.cjs`. Command: `npx vitest run tests/audio-memory-report.test.js -t 'requires positive room' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `d9b191e1209afca8d9f2ea5f6fd15ae937487c8fd4f3a378b48962520a6bbb79`.

```text
AssertionError: expected true to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 65 skipped (66)
```

### 8. source-seed

File: `scripts/build-room-ambience.mjs`. Command: `npx vitest run tests/room-ambience-source.test.js -t 'ships the exact' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `7179eecdc6b4382a9d9eaa1a1416d6462b2a0734afa6cc7a321eb22a1cde3d92`.

```text
AssertionError: expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 2 skipped (3)
```

### 9. publication

File: `scripts/build-room-ambience.mjs`. Command: `npx vitest run tests/room-ambience-source.test.js -t 'refuses to replace' --maxWorkers=1` in web. Exit 1: expected FAIL. Restored bytes: PASS.

Before/after SHA-256: `7179eecdc6b4382a9d9eaa1a1416d6462b2a0734afa6cc7a321eb22a1cde3d92`.

```text
AssertionError: expected [Function] to throw an error
 Test Files  1 failed (1)
      Tests  1 failed | 2 skipped (3)
```

## Root-owned evidence and acceptance hold

1. Production UI check: root reports exit 0. Startup had zero requests/starts; running world had one source and one request; Pause drained retained count to zero. Keyboard Ambience 25 -> 0 -> 50 persisted while Effects stayed 70 and Voices 100, and a new page restored 50. Root inspected four desktop/mobile/enlarged-text screenshots. Range heights were 44 CSS px. Root owns the temporary evidence under web/output/playwright/indoor-ambience and will preserve selected evidence under docs before delivery. This implementer did not claim independent pixel inspection.
2. Native export: `proveRoomAmbience`, module `web/proofs/room-ambience.js`. Root reports exit 0 and ten rendered checks; this implementer read native.json. RMS at Ambience 1/Effects 0.7 was 0.004350840998437651; peak 0.014692374505102634; active/retained/starts 1/1/1. Quarter Ambience and half Effects scaled exactly, Voices zero was unchanged, pause fade had positive signal then zero, suspended/releasing resumes had zero tails, and 30 toggles stayed bounded. Public WAV URL was corrected before execution to use window.location.href under the existing Vite public-URL lesson.
3. Six-run memory acceptance: FAIL, exit 1. This implementer read memory.json. Pair deltas were 90,376 / -237,816 / 69,120 bytes. Median 69,120 exceeds unchanged 65,536 allowance by 3,584. StructuralPass was true: room ownership bounded, disabled starts zero, endpoint sources drained and all document/node/listener counts 1/1,446/159. Root is doing causal diagnosis, not rerunning for luck; no threshold was relaxed. This is a real delivery hold, not a passed acceptance check.
4. Root's fresh review identified different crypto world seeds and tick endpoints across the paired memory runs; the current subtraction cannot attribute that excess specifically to audio. One diagnostic pair with baseline/final heap snapshots is pending and is not acceptance. The failed acceptance remains on hold.
5. Independent slice/whole-branch review remains root-owned and pending. Subjective listening and fresh 120 Hz acceptance remain unclaimed. No external push, PR, merge or Pages deployment happened in this task.

## Self-review and handoff

All AudioPreferences, AudioSettings, AudioControls constructors and SimAudioFrameSink callers/doubles were searched and updated explicitly. The new player uses no fake placed-object identity and does not widen the action enum. All task files were reviewed for ownership, current gain routing, lifecycle boundaries, retry cadence and saved-preference compatibility. Root-owned output remains unstaged. The two lessons record stop-time fade ownership and inventory-first browser proof discovery. Summary docs and the source spec now distinguish implemented local content from delivery and listening approval.

Concern: retained-memory acceptance is above budget. Do not deliver until causal diagnosis and independent review resolve that hold. This implementation remains available for root review; the coherent local commit will be reported separately after committing.

**Next steps**: Root diagnoses the retained-memory failure and performs independent review before external delivery. Nothing is requested directly from the owner by this implementation handoff.

Review follow-up: corrected the remaining FEATURES.md sentence to list music
controls alone as future work. Document IDs and diff checks passed; no runtime
tests were repeated for this documentation-only correction. Root-owned evidence,
spec links and lessons changes remain unstaged by this implementer.
