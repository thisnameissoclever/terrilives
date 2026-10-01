# Cancellation during audio suspension

Status: implementation, local regression tests, rendered browser checks and independent review passed. Source publication is pending.

## Defect and scope

The controller gated every semantic event on audibility, including object stops and conversation ends. If an external interruption suspended audio while the visible simulation continued, the scheduler could forget an ended action while the controller retained its source or pending recording. Automatic return to a running context could then resume stale audio. Existing gesture-recovery tests did not cover this path.

The fix separates cancellation from playback admission. End events must clear matching desired or pending ownership regardless of audibility. A running clock retains the ordinary release fade. A stopped clock immediately releases the exact affected source; it must not retain a fade that cannot advance. Unrelated sources, replacement actions, decoded caches, gains, assets, pause policy and simulation state remain unchanged. Semantic events still cannot create or resume an audio context.

This does not introduce automatic recovery for new actions whose start events were dropped during suspension. That remains a separate context-transition issue requiring its own design and tests. Do not describe this cancellation repair as complete automatic interruption recovery.

## Reproduction

The baseline controller suite passed 150 tests. Before production edits, two public object-frame regressions failed: an ended active source retained one loop instead of zero, and an ended pending source created one buffer source after late decoding instead of zero. Equivalent conversation regressions retained two active pairs instead of one and created four sources instead of two after a late decode.

The native-clock proof is `web/proofs/audio-interruption.js`. With Vite serving `web/`, open `/proofs/index.html` and call `proveSuspendedObjectStop()` from that module. It uses a real `OfflineAudioContext` with an adapter only for initial scheduling, then exposes the native rendering clock's running and suspended states. The original controller failed with `Ended source retained nodes while native clock was suspended`. No acoustic judgment or operating-system interruption reproduction is implied.

## Verification

1. Active and pending object and conversation endings remain effective while playback is unavailable.
2. Cancellation preserves source/action or conversation-key matching and unrelated voices.
3. A stopped clock retains no nodes for the ended source; ordinary running fades remain continuous.
4. Late installation or decoding cannot revive ended ownership, and a fresh later observation remains playable.
5. Rendered samples prove the stopped object has no tail on native-clock resume, alongside a positive pre-interruption signal.
6. Full web tests, type check, production build, focused negative mutations and independent review pass. Inspect the actual game, close task-owned pages and servers, and record source merge separately from Pages deployment.

All six requirements above passed locally on 2026-10-01. Commands exited 0:

| Command | Result |
| --- | --- |
| `npm test -- --maxWorkers=1 tests/audio-controller.test.ts tests/object-loops.test.ts tests/voice-clips.test.ts` in `web/` | 216 focused tests passed |
| `npm test -- --maxWorkers=1` in `web/` | 1,582 tests in 112 files passed |
| `npm run typecheck` in `web/` | No type errors |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | Release WASM built; Rust source unchanged |
| `npm run build` in `web/` | Production bundle `index-1zaQNkT1.js` built |
| `node --check web/proofs/audio-interruption.js` | Proof syntax passed |
| `python check-doc-ids.py` and `git diff --check` | Passed |

The new native proof passed seven sample checks. A playing object rendered
`0.14000000059604645` before interruption and exactly zero throughout the resumed
tail. A pending object remained silent. Two conversations rendered
`0.3360000252723694` together; after one immediate cancellation, the other rendered
`0.1120000034570694` both on the first resumed sample and later. This proves
source-specific player disposal. Public controller-frame tests separately prove
the correct stop mode and pending-ownership cancellation.

Existing browser proofs also passed: ten object-envelope checks, eleven object
controller checks and ten conversation-fade cases. The production game was
opened in a fresh task-owned browser profile, its household and Options were
visually inspected, and Pause was confirmed. Effects remained 70% and Voices
100%. [Observed game](../assets/review-evidence/audio/suspended-cancellation/game.png).
Only the existing favicon requests returned 404. No game save was created or
loaded. Both proof and game browsers and their preview servers were closed.

Independent review found no required code changes. No assets, gains, simulation,
bed implementation or held toilet-audio code changed. Native tests and the full
120 Hz/retained-heap sweep were not rerun for this source-specific cancellation
repair. The browser samples do not establish operating-system interruption
behavior or listening acceptance, and do not waive PR 178's separate release hold.

## Regression sensitivity

Each deliberate mutation failed with exit 1 and was restored before final tests:

| Removed mechanism | Observed failure |
| --- | --- |
| Cancellation before the audibility return | Four active/pending controller regressions failed |
| Immediate object disposal | Expected two retained records, received three |
| Immediate conversation disposal | Expected one retained pair, received two |
| Exact pending conversation deletion | Expected two created sources, received four |
| Desired object deletion | Expected zero created sources, received one |
| Per-identity pending cancellation, replaced with clearing every pending pair | Expected two created sources, received zero |

The tests are `ends a playing object through frames while hardware is externally
suspended`, the pending-object and active/pending conversation frame counterparts
in `audio-controller.test.ts`, `immediately releases only the exact source and
action without waiting for its clock` in `object-loops.test.ts`, and `immediately
releases only the requested identity despite a source stop failure` in
`voice-clips.test.ts`. The two new browser proofs also failed on the original
implementation before passing with the repair.

Production file hashes before and after mutation matched exactly:

1. Controller: `63cf7edd727aa8d0f40997fc6da0c16c49562dc062dad3940764bd1494cb53b6`.
2. Object player: `2beff201749b2c7bf54d422f3a42508dcd0f222ce9f552b1a67b057f5037a3d3`.
3. Conversation player: `8b5d86c6a51477f12eef476ea336db2c04ce48f806f69fe86fe7ecd49926384b`.
