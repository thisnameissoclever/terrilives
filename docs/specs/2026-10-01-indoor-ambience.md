# Indoor ambience

Root browser evidence and the unresolved memory diagnosis are recorded in
[verification](../assets/review-evidence/audio/indoor-ambience/verification.md).
The failed acceptance is preserved; this slice is not merged or deployed.

Status: implemented, delivery pending. Subjective listening is not approved.

## Intent and authority

The owner asked for broader household sound and delegated routine design,
implementation and delivery decisions. This slice adds a quiet indoor-air
texture and an independent saved Ambience control. It does not replace accepted
footsteps or voices. The generic ambient files in the approved archives have
not been identified by listening; they are not selected here.

The source is a first-party synthetic texture, not a claimed field recording.
Its subjective suitability remains provisional. No dependency, purchase,
download, host setting or saved-world change is required.

## Sound and graph

Use a deterministic eight-second mono, 48 kHz PCM16 loop of soft filtered noise.
Remove DC and strongly attenuate bass below 180 Hz. Roll off above 1800 Hz.
Do not add notes, clicks, beat-like pulses, simulated voices or random discrete
events. Use an offline overlap to make the seam continuous. Source RMS must be
between 0.03 and 0.07, peak below 0.30, absolute mean below 0.0001, and wrap
discontinuity below 0.002. Record measured values and source/runtime hashes.

The graph is `room source -> envelope -> Ambience -> Effects -> master`.
One house-wide source is sufficient for the current single-house game; this
does not pretend to implement room acoustics, camera attenuation or outdoors.
Playback rate stays 1 at all game speeds. Envelope gain is 0.15. Ambience
defaults to 25%, so Effects at its existing 70% default remains authoritative.
Voices affects conversations only. Maximum Ambience must remain unclipped.

## Ownership and lifecycle

A dedicated room-loop owner holds at most one active source and one fading
source. It owns every retained source until disconnected, including release-only
tails. It must not create an artificial placed-object ID or widen the authored
object action enum. Attack and normal pause release are 100 ms. A second start
may coexist with one fading source, but repeated toggles cannot grow ownership.
Dispose an oldest releasing source if necessary before a replacement starts.

Only an explicit ready, running-world observation can establish demand. A
gesture alone, successful audio initialization or loading the app must not
start or download the loop. The fixed-tick sampling path makes this observation
once per tick, inside the existing measured audio work. `?audio=0` remains a
complete silent control.

Pause and blocking overlays clear demand and fade the loop. Load, master mute,
Effects zero, backgrounding and a non-running audio clock clear demand and
disconnect all sources immediately. A new ready-world observation is required
after these boundaries. Ambience zero stops only ambience and leaves other
schedulers untouched; raising it waits for a new observation. Automatic browser
recovery cannot replay a frozen tail. Settings previews must not produce click
or confirmation sounds.

The controller owns an AudioContext `statechange` listener independently of
simulation ticks. A non-running context event clears demand, every retained
source family and scheduler ownership, including releases during simulation
pause. Detach the listener before abandoning its graph; stale callbacks must
not silence a replacement graph. A running event never establishes demand.

Load the texture on first audible demand. Coalesce in-flight work, cache a
successful decode and keep one five-second failed-load cooldown. Retry only
on a fresh transition into audible demand or an explicit later trusted gesture
while valid demand remains; do not retry every fixed tick. A late load may
start only for currently valid demand. Invalid duration or failed fetch/decode
must not break the game. Replacing a failed context must not let an old request
start playback into the abandoned graph. Independent recording families cannot
consume each other's response/decode test gates.

## Preferences and player controls

Add `ambienceLevel` to version-1 audio preferences. Existing valid mute,
Effects and Voices values survive a missing or invalid new field; only
Ambience falls back to 25%. Original malformed record/version rules stay.
Preview changes gain without storage writes; committed changes persist once.
Nonfinite programmatic values fall back to the default and finite values clamp
to 0..1.

Add a literal Ambience range and percentage output beside the existing audio
controls in Options. Keep every target at least 44 CSS pixels tall, preserve
keyboard and touch behavior, and allow the panel to scroll at small viewports
or enlarged text. Do not add permanent collapsed-HUD height. Help states that
Ambience adjusts room sound within the Effects mix. Retain Sound master mute
and the existing meanings of Effects and Voices.

## Proof and delivery

Test public player/controller, persistence, frame sampling and UI seams, plus
native OfflineAudioContext output. Cover silent startup, late decode across
every boundary, repeated stop/start, source failures, stale callbacks,
independent gain controls, source bounds and storage denial. Mutate the
load-bearing demand, lifecycle and gain-route guards and observe failures.

Expose active/retained ambience and successful start counters in the stress
diagnostics. Extend every relevant browser proof and fixture, including actual
positive enabled playback, zero disabled playback, bounded ownership and fully
drained paused endpoints. Do not weaken existing memory limits or structural
equality. Source integration is not permission to clear held PR 178.

Inspect the production game, desktop and small/enlarged-text Options, and record
the screenshots actually inspected. Close task-owned pages and servers. Run
the full relevant local suite, typecheck, production build and document checks;
obtain independent review, then commit, push and merge. Report source delivery,
Pages deployment and owner listening separately. No subjective listening or
120 Hz acceptance may be claimed without evidence.

## Implementation evidence, 2026-10-01

The source/runtime WAV is 768,044 bytes, SHA-256
`714374c981c63e1ac3a96e493687dfc4cca176aaeb12b14a984c00caed0dc42b`.
It has 384,000 mono PCM16 frames at 48 kHz. RMS is 0.0409303682, peak
0.1557312012, absolute mean 0.0000000217 and wrap discontinuity zero.
No external asset, dependency or simulation/save contract changed.

The public controller additions and fixed-tick observation are implemented.
The room player evicts older releases at replacement stop as well as bounding
replacement starts. Closed contexts are abandoned before rebuilding the graph,
and room requests from the old context cannot populate the replacement graph.
Stress getters are `ambienceVoices`, `retainedAmbienceVoices`, and `ambienceStarts`.
Memory reports require positive enabled playback, zero disabled starts, at most
one active/two retained room records and fully drained paused endpoints. Existing
64 KiB and exact document/node/listener equality limits are unchanged.

The single-worker full Web suite passed 1,746 tests in 116 files. TypeScript and
production Web build passed, using main-matching release WASM built offline.
Nine targeted mutations each failed their covering test and restored exact
pre-mutation SHA-256 bytes. Detailed commands, outputs and restoration hashes are
in `docs/assets/review-evidence/audio/indoor-ambience/implementation-report.md`.

The native browser export is `proveRoomAmbience` in `web/proofs/room-ambience.js`.
Root reports all ten rendered checks passed, including positive signal,
independent gain routing, positive pause fade, zero suspended/releasing resumed
tail, historical Effects-70% peak 0.0146923745 and bounded 30-toggle ownership. The proof
RMS at Ambience 100% and Effects 70% is 0.004350841. This is rendered-signal
evidence, not a claim of hearing or accepting the texture.

Review found that the historical interrupted-pause proof manually called a
fixed-tick audio method while simulation was paused. Production does not make
that call. That result did not prove paused interruption cleanup. The corrected
proof forwards native offline context state events without a simulated tick or
gesture during interruption, and measures maximum peak separately at Effects
100% and Ambience 100%. Root owns the fresh native result and memory diagnosis.

Root's first six-run memory acceptance failed: pair differentials 90,376,
-237,816 and 69,120 bytes produce a median of 69,120, above the unchanged
65,536-byte allowance by 3,584 bytes. Structural checks passed, including bounded
room ownership and identical paused endpoint document/node/listener counts
1/1,446/159. Delivery is held for causal diagnosis and independent review; this
failure is not resolved by a repeat run or a relaxed threshold. Root-owned
production UI evidence passed separately. Held PR 178 remains outside this slice.
