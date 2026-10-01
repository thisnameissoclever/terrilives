# Task 1 implementation report

Status: implementation and local checks passed. Browser matched-pair verification and complete corrected acceptance belong to root and are not claimed here. Indoor ambience and PR 178 remain held.

## Scope and ownership

Worktree: `D:/VIBES/.worktrees/indoor-ambience/terrilives`, branch `twcx/indoor-ambience`, base `bb4597401f06ad8e8bd943383578e4a93354c9b0`. One implementer edited runtime, harness, tests and docs. No children, dependency changes, Rust rebuild, browser acceptance, push, PR or merge. Root's untracked `web/output/` is excluded. This report stays ignored scratch evidence, not force-added.

## Implemented behavior

1. `FixedStepDriver.advance` and `advanceSimulationFrame` accept an optional non-negative safe-integer tick budget. The loop cannot overshoot; exhausting the budget drops accumulated time and returns alpha zero. Zero runs no ticks. Unbudgeted behavior and paused command flushing remain covered.
2. `stress-memory-probe.ts` parses both decimal U32 words only with `stress`, rejects incomplete or invalid opted-in values, and owns a validated target without a second speed state. Ordinary pages ignore seed parameters and retain fresh browser entropy.
3. Probe pages start paused at zero consistently across driver, overlay ownership and controls. `runUntilTick` validates before selecting 3x through existing controls. Every frame receives the remaining budget; completion selects Pause through the same path, retaining audio fades and normal queued-command settling. Blocking overlays still own temporary suspension.
4. Memory runner signature remains `runMemory(browser, baseUrl, audioEnabled, repetition)`. Fixture seeds are `(104729,130363)`, `(155921,196613)`, `(262147,327673)` in order. Warm-up stops exactly at 60; the measured interval stops at 600. Intermediate 60-tick cadence, visible rendering, normal fixed-tick sampling, audio clocks, trusted gestures, HUD normalization and draining remain unchanged.
5. Every snapshot records `seed: {low, high}`, `tick`, and decimal-string `worldHash`. Endpoint seed/tick/hash omissions and mismatches reject comparability before attribution: `comparable: false`, errors, empty pairs, null median and false acceptance. The 65,536-byte allowance and existing DOM/source/playback guards are unchanged.
6. Updated matched-memory and audio-foundation specs and lessons. Corrected indoor-ambience's historical implementation-report pointer to its durable evidence path without revising that report or its failed result.

## TDD evidence

Commands ran from `web/` with one worker and installed tools.

1. `npx --no-install vitest run tests/frame.test.ts --maxWorkers=1 -t 'finite tick budget'`: exit 1 before implementation. Assertion: `expected 0.5 to be +0`. After implementation: exit 0, 1 passed.
2. `npx --no-install vitest run tests/stress-memory-probe.test.ts --maxWorkers=1`: exit 1 before creating the helper, missing module. This establishes missing capability, not an assertion-based mutation proof. After helper implementation: all parser/target tests passed.
3. `npx --no-install vitest run tests/audio-memory-report.test.js --maxWorkers=1 -t 'attribution rejects'`: first exit 1 because fixture export was absent; after exporting seeds but before comparator implementation, exit 1 with `expected undefined to be true`. After comparator implementation: pass. The comparator deletion proofs below establish rejection sensitivity independently.

## Mutation evidence

Each mechanism was removed independently, its focused test returned exit 1 with an assertion, and its exact original line was restored. The first restoration utility used trim on the captured source line, losing indentation; this was corrected and the complete five-case sequence was repeated with preserved leading whitespace. Only the repeated sequence below is the byte-restoration proof.

1. budget loop, `web/src/frame.ts`.
   Command: `npx --no-install vitest run tests/frame.test.ts --maxWorkers=1 -t 'finite tick budget'`, exit 1.
   Actual failure: `AssertionError: expected "vi.fn()" to be called 1 times, but got 3 times`.
   Before SHA-256: `2B7BC83C785A0A5DD37FCC7D26D1424FD4BBA258D02893F53A7C58628D26B0E1`.
   Restored SHA-256: `2B7BC83C785A0A5DD37FCC7D26D1424FD4BBA258D02893F53A7C58628D26B0E1`. Exact match: yes.

2. budget discard, `web/src/frame.ts`.
   Command: `npx --no-install vitest run tests/frame.test.ts --maxWorkers=1 -t 'finite tick budget'`, exit 1.
   Actual failure: `AssertionError: expected 2.5 to be +0 // Object.is equality`.
   Before SHA-256: `2B7BC83C785A0A5DD37FCC7D26D1424FD4BBA258D02893F53A7C58628D26B0E1`.
   Restored SHA-256: `2B7BC83C785A0A5DD37FCC7D26D1424FD4BBA258D02893F53A7C58628D26B0E1`. Exact match: yes.

3. seed guard, `scripts/audio-browser-proof.cjs`.
   Command: `npx --no-install vitest run tests/audio-memory-report.test.js --maxWorkers=1 -t 'attribution rejects'`, exit 1.
   Actual failure: `AssertionError: 0:0:seed:change: expected true to be false // Object.is equality`.
   Before SHA-256: `E513BE85AC5A50633648AD9C92FBF759B59AE606B02DBB4DDE7C406563DB6F42`.
   Restored SHA-256: `E513BE85AC5A50633648AD9C92FBF759B59AE606B02DBB4DDE7C406563DB6F42`. Exact match: yes.

4. tick guard, `scripts/audio-browser-proof.cjs`.
   Command: `npx --no-install vitest run tests/audio-memory-report.test.js --maxWorkers=1 -t 'attribution rejects'`, exit 1.
   Actual failure: `AssertionError: 0:0:tick:change: expected true to be false // Object.is equality`.
   Before SHA-256: `E513BE85AC5A50633648AD9C92FBF759B59AE606B02DBB4DDE7C406563DB6F42`.
   Restored SHA-256: `E513BE85AC5A50633648AD9C92FBF759B59AE606B02DBB4DDE7C406563DB6F42`. Exact match: yes.

5. hash guard, `scripts/audio-browser-proof.cjs`.
   Command: `npx --no-install vitest run tests/audio-memory-report.test.js --maxWorkers=1 -t 'attribution rejects'`, exit 1.
   Actual failure: `AssertionError: 0:0:worldHash:change: expected true to be false // Object.is equality`.
   Before SHA-256: `E513BE85AC5A50633648AD9C92FBF759B59AE606B02DBB4DDE7C406563DB6F42`.
   Restored SHA-256: `E513BE85AC5A50633648AD9C92FBF759B59AE606B02DBB4DDE7C406563DB6F42`. Exact match: yes.

The frame hash predates a subsequent comment-only budget description; no mechanism changed after mutation proof. Seed low/high changes and omissions are exercised independently at both endpoints and all three repetitions. Literal fixture values are independently pinned. Original door/source, ambience-positive-playback, disabled-playback, retained-voice, and exact DOM equality fixtures still pass and still reject their mutations.

## Checks

1. Initial focused driver/probe/analyzer command: `npx --no-install vitest run tests/frame.test.ts tests/stress-memory-probe.test.ts tests/audio-memory-report.test.js --maxWorkers=1`, exit 0, 160 passed.
2. First full suite: `npx vitest run --maxWorkers=1`, exit 1, 115 files / 1,766 tests passed, 2 tests failed. Existing frame-audio source contract expected a three-argument frame call; new-game-seed source extraction omitted the new probe binding. Root approved updating these impacted test contracts. Their replacements retain ordinary entropy/no-budget assertions and add probe behavior; no production workaround was added.
3. Corrected focused suite: `npx --no-install vitest run tests/frame.test.ts tests/frame-audio.test.ts tests/new-game-seed.test.ts tests/stress-memory-probe.test.ts tests/audio-memory-report.test.js --maxWorkers=1`, exit 0, 5 files / 190 tests passed.
4. Corrected full suite: `npx vitest run --maxWorkers=1`, exit 0, 117 files / 1,768 tests passed in 20.92s. A final literal fixture-seed test was added afterward without runtime changes; `npx --no-install vitest run tests/audio-memory-report.test.js --maxWorkers=1` then passed all 70 tests (exit 0). Do not confuse that final targeted addition with inclusion in the preceding full count.
5. `npm run typecheck`, exit 0, `tsc --noEmit` clean.
6. `npm run build`, exit 0, Vite production build clean. Bundle `dist/assets/index-DqfSuUCT.js`; 88 modules transformed. Root was notified before build and before starting browser verification. Runtime/dist are frozen for its verification.
7. Root `python check-doc-ids.py`, exit 0: `Documentation ids are unique and allocation-free.`
8. Root `git diff --check`, exit 0, no whitespace errors.
9. Impact scan: `rg -n 'advanceSimulationFrame|\.advance\(' src tests -g '*.ts'` from web found main wiring and frame tests. The full suite exposed the additional source-wiring contracts described above. No remaining changed signature requires callers to supply a budget.

## Review and limits

Self-review checked all implementation/test/doc diffs, backward compatibility, startup entropy, control ownership, endpoint settling, fixture metadata and retained-source guards. Safe target validation is performed before state/control changes. No direct browser `sim.tick()` loop, frozen rendering, changed optimization, allowance, workload or cherry-picked seed was introduced. The harness preserves natural compilation timing variation; a failed corrected raw gate remains a failure.

Root still owns independent review, one real matched enabled/disabled pair's endpoint hashes, complete corrected browser acceptance and any delivery. Subjective sound quality remains a separate owner acceptance decision. No local assertion or production build proves those gates.

## Local handoff

Implementation/tests/docs committed locally as `1ae3a7020c3d48b66012bf10d52923e87561446d`.
`git diff --cached --check` passed before commit; post-commit `git status --short`
contains only root's preserved `?? web/output/`. No push, PR or merge occurred.
The commit contains 13 files; this ignored report is excluded.

Root subsequently reported its first real pair passed: seed `(104729,130363)`,
ticks 60/600, baseline hash `1689968484302009063`, final hash
`6672627640496136405`, equal in both runs. Root reported no page errors, drained
ambience endpoints and both screenshots inspected. This is root-supplied live
evidence, not a browser run by this implementer. Root's full six-run acceptance
is running at handoff; its outcome remains unclaimed here.
