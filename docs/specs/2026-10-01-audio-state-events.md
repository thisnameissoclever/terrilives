# Audio interruption cleanup without simulation ticks

Status: main-based repair planned; no new sound or ambience is included.

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
