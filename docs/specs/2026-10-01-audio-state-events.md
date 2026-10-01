# Audio interruption cleanup without simulation ticks

Status: main-based repair implemented locally; no new sound or ambience is included.
Independent native rendering and production-game inspection passed. This status
does not claim publication or listening acceptance.

## Defect and scope

Existing cleanup observes unavailable audio at fixed-tick boundaries. A paused
simulation has no such boundary. A browser interruption can therefore freeze
an existing sound or release fade and replay it on automatic recovery.

The related fix on held ambience PR 184 has controlled and native evidence,
but its room-specific proof is not acceptance for this main-based patch.
Implement and verify the existing four families independently: procedural
cues, recorded doors, object loops and conversations. Do not import ambience,
matched-memory probe changes, new assets, closed-context replacement behavior,
or any PR 178 code. Their release holds remain unchanged.

## Contract

1. The controller exclusively owns the state handler on the context it creates.
   Observe non-running states independently of simulation ticks or gestures.
   Dispose all active and release-only players and clear pending ownership and
   scheduler state. A returning running event never starts or resumes a sound.
2. Bind the handler after graph/player construction. Capture that context and
   ignore a queued callback if it no longer belongs to this controller. Clear
   the handler before abandoning a partially constructed graph and closing it.
   Do not add polling, timers, per-frame work or simulation state.
3. Global stop uses immediate conversation disposal, including existing release
   records. Normal audible fades and identity-specific semantic endings keep
   their existing behavior. Pause itself still permits short cues to finish.
4. After recovery, fresh world observations may restart currently demanded
   recordings. Old transients, elapsed movement, departed owners and late decode
   completion cannot reappear. Existing mute, Effects, Voices, visibility, Load,
   source-capacity and audio-unlock behavior remain intact. Controls stay silent.

## Evidence and delivery

Write four public-controller regressions that start positive sources, pause or
end into release, interrupt and automatically recover without a fixed tick or
new gesture. Test graph-construction failure/abandonment and a stale queued
handler. Delete cleanup, scheduler reset and stale-identity mechanisms separately
and prove the respective tests fail; restore exact source hashes.

Add a native proof for the existing object and conversation players/controller.
Use native state events, positive pre-interruption output and ordinary-fade
controls. Require zero output from the first resumed sample without injecting a
fixed-tick availability observation. Expose a named export through the existing
Vite proof page. A native controlled clock is not an operating-system test.

Run focused tests, the full main-based web suite once, typecheck, production
build and document checks. Rust is unchanged; reuse the verified main-matching
release WASM. Root independently renders the proof, inspects the actual game,
reviews the complete patch and delivers it. No subjective listening, 120 Hz or
held-feature memory acceptance is inferred from this repair. Those are separate
contracts, not unfulfilled feature claims in this change.

## Local regression evidence

The original controller failed seven public-controller regressions before
production edits. Object, conversation, door and procedural nodes remained
connected after paused interruption. Automatic recovery retained an old object,
late decoding started two stale voice sources, and graph construction had no
owned callback to detach. With the repair, all seven pass.

The named native export is `proveAudioStateEvents()` in
`web/proofs/audio-state-events.js`, served through `/proofs/index.html`. It forwards
actual `OfflineAudioContext` state events to the controller. The first controlled
hold schedules an ordinary fade at 128 ms while reporting running; the second
hold at 136 ms exposes native suspension. No fixed-tick availability observation
or new controller gesture is injected. Object and conversation each have a
positive playing sample, an intermediate release sample, a normal-fade control
and a silent resumed-tail requirement. The optional `kinds` argument allows
either family to be examined independently.

Before production edits, independent native execution failed with
`object, state-event interruption: first resumed sample: expected 0, rendered 0.08399999886751175`.
The original controller SHA-256 was
`8a19e9755ddad9ac8e98867a693def7e8e656278e12397385f98f679e0cc4096`.

Six compiling negative mutations failed assertions with exit 1 and were restored:

1. Deleting event cleanup left all four paused source families connected.
2. Deleting event scheduler reset prevented the fresh current object from starting.
3. Deleting captured-context identity protection let an abandoned callback stop
   the current procedural source.
4. Removing immediate global conversation disposal retained a release-only pair.
5. Deleting failure-path detachment left an owned handler on the abandoned graph.
6. Removing the running-event guard stopped freshly recovered current actions.

The three required mechanism restorations each matched controller SHA-256
`595ea22c083affa0528eb306b2eae376a8f77ffcc48b85402fe9bbf2806c3749`.
The final source after all six mutations matched that same hash.
Existing direct-cancellation and normal-fade regressions remain in the focused
controller, object and conversation suites. No player implementation, asset,
simulation code, ambience state or dependency version changed.

## Final local checks

Commands exited 0 on 2026-10-01:

| Command | Result |
| --- | --- |
| `npm test -- --maxWorkers=1 tests/audio-controller.test.ts tests/object-loops.test.ts tests/voice-clips.test.ts tests/frame-audio.test.ts tests/procedural-cues.test.ts tests/recorded-doors.test.ts` in `web/` | 298 tests in four matching files passed; procedural and door player regressions reside in the controller file |
| `npm test -- --maxWorkers=1` in `web/` | 1,713 tests in 114 files passed once after final restoration |
| `npm run typecheck` in `web/` | No type errors |
| `npm run build` in `web/` | Built `index-D6zT8jXc.js` with the supplied main-matching release WASM; no Rust rebuild |
| `node --check web/proofs/audio-state-events.js` | Proof syntax passed |
| `python check-doc-ids.py` | Documentation ids are unique and allocation-free |
| `git diff --check` | Passed |

Independent browser execution imported the named module and passed all 18 native
sample checks. Object and conversation output each became exactly zero from
the first resumed sample through the entire remaining render. Their ordinary
fade controls preserved the positive plateau and intermediate release samples.
Permanent receipts are under `docs/assets/review-evidence/audio/state-events/`.
Two attempts interrupted by Vite hot-reload navigation supplied no product
assertion result; they are not included as red or green evidence.

The proof establishes controlled native-clock behavior, not operating-system
interruption behavior, subjective listening approval or held-feature acceptance.
No retained-memory or 120 Hz sweep was rerun. Separate release holds remain intact.

Root inspected the built game and Options. The actual context handler was
installed. Paused simulation tick 12 remained tick 12 across native suspend and
resume without another gesture; all active and retained source-family counts
were zero after recovery. The lot, Sims and controls remained intact, Effects
was 70%, Voices was 100%, and no ambience control appeared. No page errors were
reported. Task-owned browser pages closed and both preview servers stopped.
