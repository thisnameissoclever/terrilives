# Sink water audio

## Scope

Bathroom `sink/wash_hands` and `kitchen_sink/wash_up` play quiet flowing water
only during their actual interaction. Selecting a sink or clicking a menu stays
silent. Washing-up currently restores hygiene; this change does not implement
dirty dishes or change simulation behavior.

## Contract

1. Append `sink_water` to the closed authored vocabulary and render action 3.
   Preserve none 0, shower 1 and stove 2. The existing exact-target projection
   supplies the placed object's entity ID, not the actor's ID or position.
2. Reuse `audio/objects/shower-water.wav`, including its prepared loop seam.
   Shower gain stays 0.6; sink gain is 0.35 before Effects. Fetch and decode once
   for both actions, sharing the AudioBuffer. Keep manually installed clips.
3. Different sinks and showers own independent playback. Completion or
   cancellation stops only the departed source. Keep the existing four-active,
   eight-retained voice limits and 20 ms fades.
4. Pause, load, mute, zero Effects and background transitions clear ownership.
   A late download may populate the cache but cannot revive cancelled use.
   Resume requires a fresh source observation. Failed downloads retain the
   existing five-second cooldown and require new audible demand, not fixed-tick retries.
5. No save migration, gameplay state, random draw, new dependency, paid service
   or new asset bytes. Stove cooking remains silent pending its own selection.

## Verification

The catalog, source scheduler and controller tests first failed with sink
action 3 absent, then passed with the implementation. Both water actions have
the same lifecycle cases, including late completion after cancellation and
hardware context recovery. Mixed manual/default clips preserve manual choices;
simultaneous sinks and shower share one fetch/decode but stop independently.

`web/proofs/shower-recording.js` exposes `proveSinkRecording()` alongside the
existing shower proof. Chromium OfflineAudioContext renders the actual shipped
WAV through the production controller. Sink one-source peak is
0.02246246300637722 and four-source peak is 0.08984985202550888 at Effects 1.
Loop repeat error is zero. The output tail is exactly zero after load, mute,
zero Effects, background and pause. Shower peaks remain 0.03850708156824112
and 0.15402832627296448. These are playback measurements, not listening approval.

The stress lot still has three active household Sims. Its source-track bound
is three concurrent users now that both sinks are audible, rather than the
previous two authored source types. Four tracks fail the memory report's guard.

## Integrated checks

1. `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`
   and `cargo test --workspace`: PASS, exit 0; 1,242 Rust tests.
2. `npm test -- --maxWorkers=1`: PASS, exit 0; 1,557 web tests in 111 files.
   `npm run typecheck`, release `wasm-pack build crates/terri-wasm --target web
   --out-dir ../../web/src/wasm`, `npm run build`, `python check-doc-ids.py`
   and `git diff --check`: PASS, exit 0. No dependency was changed.
3. Eleven deliberate faults failed with assertion errors, exit 1, and were
   restored byte-identically: either sink annotation removed; sink mapped to
   shower; sink excluded from scheduler or clip validation; wrong sink gain;
   missing automatic sink fetch or sink demand recognition; default clips
   overriding manual clips; four source tracks allowed; Options gesture removed.
   Removing either annotation produced `(0, MAX)` instead of `(3, exact target)`;
   changing the mapping produced action 1 instead of 3. Removing automatic
   loading left zero voices instead of one; weakening the track bound returned
   true instead of false. Deleting Options open failed both onboarding variants.
4. A headed production build at 1440x1000 ran actual `UseObject` orders for
   agent 34. Handwashing reported action 3, exact bathroom source 32 and one
   loop, then completed naturally. Dishwashing reported action 3, exact kitchen
   source 4 and one loop, then cleared on cancellation. Pause drained active
   and retained loops. No page errors were reported. Both screenshots in
   `docs/assets/review-evidence/audio/sink-water/` were
   inspected; washing still has a generic standing pose, not a handwashing
   animation. The page and browser closed in `finally`.
5. The first browser attempts failed on a preview HTTP/HTTPS mismatch, a HUD
   covering a guessed canvas point, and Help hidden inside Options. Fresh-context
   review identified the visible Options controls. The shared memory setup now
   always opens/closes Options with real clicks before setting speed, independent
   of whether first-run Help appears. Tests cover both onboarding states.
6. Independent standards and spec reviews found no blocking issues. Full remote
   mutation sweeps remain separate from these local targeted checks. Neither
   waveform rendering nor visible playback counts establish listening approval.

7. `node scripts/audio-browser-proof.cjs memory --url http://127.0.0.1:5201/
   --output .tmp/sink-memory.json`: PASS, exit 0. Three alternating enabled/disabled
   pairs measured 540 ticks after 60 warm-up ticks. Audio-specific retained
   JavaScript deltas were 17,312, 140,768 and 65,208 bytes; the median 65,208
   stayed below the predeclared 65,536-byte allowance. This is a narrow pass,
   not evidence of zero retained allocation. Every endpoint had 1,434 DOM nodes,
   157 listeners and one document, with all players drained. Enabled runs
   observed one or two concurrent object loops; disabled runs observed zero.
   Broader page-memory measurement was unavailable; WASM grew in both controls
   and is not attributed to audio.
8. The production performance command exited 1 because its display acceptance
   requires calibration between 118 and 122 Hz, while both calibration and active runs
   measured 60 Hz. The 120 Hz gate is **unverified**, not passed. At the available
   refresh rate, sampler p95 was 0.20 ms and maximum 0.30 ms; application-work
   p95 was 4.70 ms in both enabled and disabled runs, with zero work frames over
   16.6 ms and zero steady identity queries. No display setting or acceptance
   threshold was changed. This limitation does not establish an audio regression.

The browser measurements above used the sink implementation over `1d97455d`.
Before delivery, main's later bed-fit documentation and compact-HUD focus fixes
through `fbc71315` were merged without conflict. Combined web checks passed:
1,564 tests, typecheck and production build, all exit 0. No Rust content or
audio logic changed during that integration.
