# Audio foundation

Status: implemented first slice. Focused Rust and Web tests, deliberate
mutations, production-browser performance, bounded retained-memory, scheduler,
and responsive visual gates pass locally. The clean 629-test Rust workspace,
503-test Web suite, TypeScript check, Clippy, WASM build, and production Web build
also pass locally. The ordinary-Chrome listening harness selects a stable
household Sim, stages a real walk, and passes settings persistence, but correctly
leaves hidden-tab silence as an owner-required action. Human listening, merge,
exact-head CI, and deployment evidence remain open.

## Decision

Terrilives uses the browser's native Web Audio API for its first sound layer.
Audio remains in the TypeScript presentation shell. The Rust simulation emits
no sound, owns no volume state, and stays deterministic and headless.

This slice establishes the durable plumbing without adding an audio library or
downloaded sound pack. It intentionally uses short procedural tones. Those
tones are acceptance candidates, not a permanent sound-design commitment.

## Current player surface

The HUD exposes two persistent controls:

1. `Sound: on/off` is master mute. It changes only the master gain between one
   and zero.
2. `Effects` is a zero-to-100 percent range for current cues and footsteps. It
   previews gain during drag, writes storage once on committed change, and
   plays one confirmation at the committed level.

Both controls remain visible in the desktop HUD and belong to the compact
mobile HUD. The range is at least 44 CSS pixels tall. The help dialog names both
controls. Browser storage denial leaves the current session setting usable.

The versioned preference key is `terrilives.audio-preferences.v1`. A malformed,
partial, out-of-range, or unknown-version record is ignored in full.

## Activation and browser lifecycle

1. A trusted pointer or keyboard gesture may create or resume the
   `AudioContext`.
2. Semantic events before activation are dropped. They are never queued for a
   delayed burst.
3. Event emission never creates or resumes the context.
4. Gesture listeners remain armed. If a device interruption or rejected tab
   resume suspends audio later, the next trusted gesture can recover it.
5. Hiding the document gates new voices synchronously, stops active voices,
   clears stride state, and requests context suspension.
6. Showing the document clears stride state again and requests resume only for
   a context that was previously gesture-activated.
7. Visibility requests are revisioned and serialized. The latest requested
   state wins even when an older browser promise settles late.
8. Pause stops simulation ticks. It does not suspend audio or cut off the Pause
   control's own confirmation.
9. Successful Load reads the replacement world's aligned stable identity and
   clears active world phase after replacement. Failed or cancelled Load
   changes no audio world state.

## Node graph and bounded playback

The graph is:

`procedural voice -> effects gain -> master gain -> destination`

The split is load-bearing. Effects may not change a future music, ambience, or
voice bus. Mute owns the master gain only.

Each cue creates one oscillator and one gain envelope, schedules a stop under
150 ms, and disconnects both nodes when ended or evicted. At most eight voices
remain active. A ninth event stops and disconnects the oldest voice instead of
building an invisible backlog.

The current semantic events are:

1. `command.staged`: a command entered the queue. This does not promise the
   resulting intent later started.
2. `command.rejected`: the input or queue rejected the command.
3. `ui.confirmed`: a selected immediate control completed.
4. `sim.footstep { simId, stepIndex }`: a stable Sim crossed one stride
   threshold.
5. `door.opened` and `door.closed`: reserved event shapes only. No current door
   transition emits them.

Canvas, keyboard, object-menu, Clear-orders, and Household-roster command
outcomes use the same staged/rejected distinction. Queue, speed, lighting,
unmute, and committed Effects changes use the current immediate confirmation.
Save, Load, Help, and every mobile-HUD action are not claimed as fully cued by
this slice.

## Footstep phase and stable identity

The shell samples positions after every 10 Hz fixed simulation tick. A rendered
frame may contain zero, one, or several fixed ticks; sampling at render cadence
is forbidden. Stopped Sims are still observed so their next movement starts
from the correct anchor.

Stride state uses stable `SimId`, never render row or entity index. Distance is
accumulated in world tiles. Every 0.42 tiles crosses one step threshold. An
update emits at most two steps and discards surplus whole strides instead of
replaying a machine-gun burst later. The next step index advances across the
discarded strides, keeping pitch identity deterministic.

Tracks are aligned typed arrays plus one retained Sim-ID-to-slot map. Normal
`begin`, `observe`, and `end` operations allocate no per-Sim object and no
collection proportional to agent count. Missing Sims are removed in place.

The render buffer carries a `sim_ids` column aligned with every other row.
Household Sims contain their authored stable `SimId`; every non-Sim row contains
the `u32::MAX` sentinel. The Web shell reads a fresh zero-copy view after every
fixed tick, so WASM growth cannot leave a cached view behind. Steady ticks make
no `simIdOf` calls, and runtime topology changes cannot shift a separate lookup
out of alignment.

## Performance acceptance

Use a visible production build, not a hidden `requestAnimationFrame` loop.

1. Configure the display for 120 Hz. Before the active run, require a five-second
   paused calibration between 118 and 122 animation frames per second, with
   median interval from 8.0 to 8.7 ms. Report the active cadence rather than
   calling it 120 Hz by configuration alone.
2. Run `?stress=1000` for 600 fixed ticks. Discard the first 60; the sampler
   timer retains the final 540.
3. Require sampler p95 at or below 0.25 ms per tick and maximum at or below
   1.0 ms.
4. Repeat with `?stress=1000&audio=0`. This diagnostic switch disables only
   footstep sampling. The sampling-enabled whole-frame p95 may regress by at
   most 1.0 ms and neither run may place application work over 16.6 ms. A 120 Hz
   display interval is about 8.33 ms; the 16.6 ms application guard remains the
   existing project gate and is not a claim that every frame finishes inside
   one 120 Hz refresh interval.
5. Confirm no `simIdOf` call occurs in steady ticks.
6. Confirm no allocation grows with entity count and no scheduler typed-array
   capacity grows after warm-up. Fresh bridge view wrappers are required by
   [D11] and must not be misreported as literal zero allocation.
7. Run three alternating enabled/disabled retained-memory pairs. Measure
   quiescent paused endpoints after explicit garbage collection. Require the
   median enabled-minus-disabled retained JavaScript delta to remain within the
   predeclared 64 KiB allowance, with zero active voices, bounded track count,
   unchanged scheduler capacity, and no DOM or listener growth. Report broader
   page and WASM growth separately instead of assigning it to audio.
8. Separately run 40 stable walking Sims for 600 ticks so the scheduler's own
   retained state is exercised rather than inferred from autonomous stress Sims.

## Played acceptance

The human listening pass must confirm:

1. The first trusted gesture activates sound without replaying older events.
2. Staged and rejected cues are distinct and not abrasive.
3. Effects gain follows the slider during drag. One cue plays on commit at a
   nonzero level, not one cue per drag pixel.
4. Mute and Effects level apply immediately and survive reload.
5. Footsteps remain paced at 1x, 2x, and 3x without bursts after Pause, Load, or
   tab return.
6. A hidden tab is silent.
7. No cue clicks, pops, or machine-gun bursts under rapid input.
8. Every meaningful cue retains visible or text feedback.

The displayed visual pass covers 1280 by 720, 390 by 844, 568 by 320, and 240
by 568. Audio controls must remain reachable, correctly labelled, touch-sized,
and unable to starve the canvas in the compact HUD.

## Local evidence on 2026-08-19

1. The clean Rust workspace passes 629 tests. The Web suite passes 503 tests,
   with clean TypeScript, Clippy, WASM, and production Web builds.
2. Every newly required identity and path-scoring mutation failed its named
   focused test and exact source bytes were restored.
3. The production performance harness ran with 1,037 entities in Chrome 151 on
   a display configured at 120 Hz. Paused calibration achieved 119.99673 Hz with
   audio and 119.99964 Hz without it.
4. Sampling enabled achieved 120.00041 animation frames per second. Interval
   p95 was 8.400 ms; application-work p95 was 1.615 ms and maximum was 2.115 ms;
   zero application-work frames exceeded 16.6 ms. Sampler p95 was 0.100 ms,
   maximum was 0.175 ms, and steady `simIdOf` calls were zero.
5. Sampling disabled achieved 120.00068 animation frames per second. Interval
   p95 was 8.405 ms; application-work p95 was 1.640 ms and maximum was 2.630 ms;
   zero application-work frames exceeded 16.6 ms. The enabled-minus-disabled
   p95 regression was -0.025 ms.
6. Three enabled-minus-disabled retained JavaScript deltas were 10,896, 7,964,
   and 14,948 bytes. The 10,896-byte median passes the predeclared 65,536-byte
   allowance. Every endpoint had zero active voices, unchanged scheduler
   capacity, no DOM/listener growth, and no more than three retained tracks.
   Broader WASM growth occurred in both modes and is not attributed to audio.
7. The production 40-walker, 600-tick scheduler probe measured p95
   0.0099999905 ms per tick and maximum 0.150000006 ms, with 40 tracks in a
   fixed capacity of 64.
8. `scripts/audio-browser-proof.cjs` owns the repeatable production performance,
   memory, and scheduler runs. `scripts/audio-listening.ps1` plus
   `scripts/audio-listening-driver.cjs` own ordinary-Chrome mechanical evidence
   and the human listening record.
9. Captured production renders at 1280 by 720, 390 by 844, 568 by 320, and 240
   by 568 show reachable controls, no horizontal overflow, and 44-pixel audio
   targets. Mute and Effects settings survived reload. The application logged
   no warning or error; Vite still reported the existing missing-favicon 404.
10. Tooling can verify scheduled voices, lifecycle, UI state, timing, and
    persistence but cannot judge whether the sounds are pleasant or distinct.
    The human listening checklist above remains an owner gate.
11. The mechanical listening run selects stable Sim ID 0, stages its walk to a
    real object, proves Effects and mute persistence, then exits nonzero with
    `hidden-tab: owner-required`. Chrome 151 kept the game document `visible`
    after same-window targets created through Playwright, raw CDP, a trusted
    renderer link, and exact-window UI Automation. None of those failed harness
    attempts is counted as application evidence. During the owner run, the owner
    opens one ordinary same-window tab; the driver then requires the game to
    report `hidden`, its Web Audio context to report `suspended`, and 20 hidden
    semantic events to create zero oscillators.

## Deliberate mutation gate

Snapshot source bytes and restore them exactly after each mutation. At minimum,
prove the suite rejects:

1. Replacing the aligned render-row stable ID with the sentinel.
2. Returning entity IDs from the WASM stable-ID pointer.
3. Using render row as footstep identity.
4. Using entity ID instead of stable `SimId` in the Household roster.
5. Omitting one side of the full-footprint adjacent-distance perimeter.
6. Keying shared distance fields by agent rather than occupied source tile.
7. Reconstructing paths for every candidate instead of one winner.
8. Sampling outside the per-fixed-tick wrapper.
9. Removing synchronous background gating or foreground re-anchoring.
10. Collapsing effects and master gain into one node.
11. Removing oldest-voice eviction or node disconnection.
12. Removing either pointer or Household-roster outcome callback.
13. Removing the stopped-to-walking re-anchor after a socket-projected action.
14. Allowing an observation failure to leave a footstep frame open.
15. Removing transactional cleanup after a partial Web Audio cue failure.
16. Removing cleanup of a partially-created controller graph.
17. Removing cleanup of a voice registered before `stop()` fails.
18. Making the foreground SE branch run for every authored facing.
19. Making the foreground SE branch run for no authored facing.
20. Inverting the foreground SE comparison.

### Mutation evidence from 2026-08-19

Each case reports the four required steps: deleted mechanism, actual failure,
inverse-patch restoration, and exact restored bytes. The clean focused suite
then passed.

1. Aligned render-row stable ID mutation.
   1. Replaced every `RenderRow.sim_id` assignment with `NO_SIM_ID`.
   2. Actual Rust test failure:
      ```text
      stable_sim_ids_are_aligned_and_absent_rows_use_the_sentinel
      assertion left == right failed
        left: 4294967295
       right: 41
      ```
   3. Restored the authored `SimId` projection with the inverse patch.
   4. `terri-sim/src/lib.rs` restored to the hash below.
2. WASM stable-ID pointer mutation.
   1. Returned the entity-ID pointer from `sim_ids_ptr()`.
   2. Actual Rust test failure:
      ```text
      sim_ids_ptr_addresses_stable_identity_and_not_entity_ids
      assertion left == right failed
        left: [0, 1, 2, ..., 36]
       right: [0, 1, 2]
      ```
   3. Restored the `sim_ids` pointer with the inverse patch.
   4. `terri-wasm/src/lib.rs` restored to the hash below.
3. Footstep render-row identity mutation.
   1. Replaced `simIds[row]` with the render row number.
   2. Actual Vitest failure:
      ```text
      Expected: 7001:2:3:true, 7003:7:8:false
      Received: 0:2:3:true, 1:50:60:true, 2:7:8:false, 3:9:10:true
      ```
   3. Restored the aligned stable-ID read with the inverse patch.
   4. `frame-audio.ts` restored to the hash below.
4. Household-roster identity mutation.
   1. Replaced the stable Sim-ID column with entity IDs.
   2. Eight of ten focused tests failed. Representative output:
      ```text
      expected stable simId 0, 1, 2
      received entity IDs 3, 2, 10
      ```
   3. Restored `source.simIds()` with the inverse patch.
   4. `household-roster.ts` restored to the hash below.
5. Full-footprint distance perimeter mutation.
   1. Replaced the far-side sample with a duplicate of the near side.
   2. Actual Rust test failure:
      ```text
      distance mismatch from (1, 0) to (0, 0) with Footprint 1x1 on 8x7 grid
        left: Some(2)
       right: Some(0)
      ```
   3. Restored the far-side perimeter with the inverse patch.
   4. `terri-core/src/grid.rs` restored to the hash below.
6. Shared-source distance-field mutation.
   1. Included agent entity ID in the distance-field cache key.
   2. Actual Rust test failure:
      ```text
      shared_source_builds_one_distance_field_and_only_winners_build_paths
        left: (8, 1)
       right: (1, 1)
      ```
   3. Restored source-tile-only cache identity with the inverse patch.
   4. `terri-sim/src/systems/action.rs` restored to the hash below.
7. Winner-only path reconstruction mutation.
   1. Reconstructed and discarded one A* route for every object candidate.
   2. Actual Rust test failure:
      ```text
      shared_source_builds_one_distance_field_and_only_winners_build_paths
        left: (1, 9)
       right: (1, 1)
      ```
   3. Removed the candidate reconstruction with the inverse patch.
   4. `terri-sim/src/systems/action.rs` restored to the hash below.
8. Fixed-tick sampling mutation.
   1. Deleted footstep sampling from `frameSimulation.tick`.
   2. Actual Vitest failure:
      ```text
      samples after every fixed tick and never from paused command flushing
      AssertionError: expected main.ts to match the fixed-tick wiring pattern
      tests/frame-audio.test.ts:169:18
      ```
   3. Restored the complete sampling and timing block.
   4. `main.ts` restored to the hash below.
9. Foreground re-anchor mutation.
   1. Limited stride reset to the background edge only.
   2. Actual Vitest failure:
      ```text
      expected oscillators to have a length of 0 but got 1
      tests/audio-controller.test.ts:536:33
      ```
   3. Restored the reset on both visibility edges.
   4. `audio-controller.ts` restored to the hash below.
10. Effects and master graph mutation.
   1. Connected Effects directly to destination, bypassing master gain.
   2. Actual Vitest failure:
      ```text
      expected effects connections [destination] to deeply equal [master]
      tests/audio-controller.test.ts:299:34
      ```
   3. Restored `effectsGain.connect(masterGain)`.
   4. `audio-controller.ts` restored to the hash below.
11. Voice-cap mutation.
   1. Disabled oldest-voice eviction.
   2. Actual Vitest failure:
      ```text
      expected 9 to be 8 // Object.is equality
      tests/audio-controller.test.ts:332:43
      ```
   3. Restored the bounded eviction loop.
   4. `procedural-cues.ts` restored to the hash below.
12. Household-roster route mutation.
   1. Removed the roster's staged semantic outcome.
   2. Actual Vitest failure:
      ```text
      Target cannot be null or undefined.
      tests/frame-audio.test.ts:204:75
      ```
   3. Restored the staged callback and stale-feedback clear.
   4. `main.ts` restored to the hash below.
13. Socket-to-walk anchor mutation.
   1. Disabled the stopped-to-walking re-anchor.
   2. Actual Vitest failure:
      ```text
      expected two sim.footstep events to deeply equal []
      tests/footsteps.test.ts:77:25
      ```
   3. Restored the transition anchor and walking-state write.
   4. `footsteps.ts` restored to the hash below.
14. Sampler-finally mutation.
   1. Replaced `try/finally` with a fall-through `endFootstepFrame` call.
   2. Actual Vitest failure:
      ```text
      Expected: [begin, observe, end]
      Received: [begin, observe]
      tests/frame-audio.test.ts:165:19
      ```
   3. Restored `endFootstepFrame` inside `finally`.
   4. `frame-audio.ts` restored to the hash below.
15. Partial-cue cleanup mutation.
    1. Returned from the player catch block before transactional cleanup.
    2. Actual Vitest failure:
       ```text
       expected oscillator.disconnected false to be true
       tests/audio-controller.test.ts:385:50
       ```
    3. Restored partial oscillator and gain cleanup.
    4. `procedural-cues.ts` restored to the hash below.
16. Partial controller-graph cleanup mutation.
    1. Deleted both `safelyDisconnect` calls from failed graph construction.
    2. Actual Vitest failure:
       ```text
       expected gain.disconnected false to be true
       tests/audio-controller.test.ts:486:44
       ```
    3. Restored both best-effort disconnections.
    4. `audio-controller.ts` restored to the hash below.
17. Registered-voice cleanup mutation.
    1. Disabled the `voice !== null` transactional cleanup branch.
    2. Actual Vitest failure:
       ```text
       expected activeVoiceCount 1 to be 0
       tests/audio-controller.test.ts:404:43
       ```
    3. Restored `finishVoice(voice, true)` for the registered voice.
    4. `procedural-cues.ts` restored to the hash below.
18. Foreground SE branch always selected.
    1. Replaced `facing == "SE"` with `true` in the foreground resolver.
    2. Actual Rust test failure:
       ```text
       assertion `left == right` failed: foreground sprite must follow placement facing Some("SW")
         left: Some(6)
        right: Some(7)
       ```
    3. Restored the exact guard with the inverse patch.
    4. `compile.rs` restored to the hash below.
19. Foreground SE branch never selected.
    1. Replaced `facing == "SE"` with `false` in the foreground resolver.
    2. Actual Rust test failure:
       ```text
       every imported facing must compile: FacingSpriteMissing {
           object: "fridge", facing: "SE", sprite: "bed_foregroundSE"
       }
       ```
    3. Restored the exact guard with the inverse patch.
    4. `compile.rs` restored to the hash below.
20. Foreground SE comparison inverted.
    1. Replaced `facing == "SE"` with `facing != "SE"`.
    2. Actual Rust test failure:
       ```text
       every imported facing must compile: FacingSpriteMissing {
           object: "fridge", facing: "SE", sprite: "bed_foregroundSE"
       }
       ```
    3. Restored the exact guard with the inverse patch.
    4. `compile.rs` restored to the hash below.

Restored SHA-256 values were:

1. `terri-sim/src/lib.rs`:
   `1780a1c6f69c8ad441121c0a7cf6928aa866a7f781b063d263c422dae486c907`
2. `terri-wasm/src/lib.rs`:
   `92329eae53cfacf5e99172a9c77c856db6269372693000d0824acdf7a204d3b4`
3. `frame-audio.ts`:
   `7038a487338fbd8da3c627f9fc48d1a6286bbb9bfc45b515a88e026344d3d33d`
4. `household-roster.ts`:
   `3cb743827251c1a651556fb202ac94ac40be71b0fdd3e693e277ec2c9776456b`
5. `terri-core/src/grid.rs`:
   `ffb545c848e9954e432ee8f2fb43ec7cd525ea304be22d3417d602c88fc28466`
6. `terri-sim/src/systems/action.rs`:
   `22cfc533d5e9062f04ae753d78388df5ad6eb463f940ed5952101609da2f56ce`
7. `footsteps.ts`:
   `dcbe168f22adf08a750fab7565ce36409ab9d5d952fbf33581718caab816da22`
8. `audio-controller.ts`:
   `e53fa4fca26271bb5a6a2851385e60b799ef562d2b49cad3f1939c46ee9fb228`
9. `procedural-cues.ts`:
   `04d0581d8dd478e3ec636f6cfce0622b9633569e8bbe19c9e4a0ee0614d13489`
10. `main.ts`:
   `2909ca34eb5037d2c589706d613949b8fee2f98815970e249cda1369dfc95f06`
11. `compile.rs`:
   `93856db8a410d9dc48bd575ac83c1f2705b3de3c2fe7bfc830a034e3701325b1`
12. `audio-browser-proof.cjs`:
   `5e9d97601637e19cdbb0bdb99d2f14f27da05dad02ff8843c9ee6739bd8e0d1a`
13. `audio-listening.ps1`:
   `2658d3f2457c86a9d3f591250b7902f27f68eb7ab57d35c8a6e9aae131a2ffb7`
14. `audio-listening-driver.cjs`:
   `ef09bc2a19eb064faccf03c324c4b79f1a8909a66525bfa8d3f0de5d2b70011a`

## Open work

1. Wire door events only after the front door has authoritative open and close
   state.
2. Add ambience, object loops, alarms, music, and nonverbal Sim voices.
3. Add independent music, ambience, and voice controls without changing the
   current Effects meaning.
4. Replace or refine procedural tones only after the event and lifecycle layer
   passes listening acceptance.
