# Audio foundation

Status: implemented first slice. Build, mutation, responsive visual, sampler,
and paired feature-regression gates pass locally. The fresh production-browser
run was limited to a 60 Hz display at 3x and still failed the pre-existing
absolute 16.6 ms application frame target. Exact 120 Hz, the strict whole-heap
trend, human listening, merge, and deployment evidence remain open.

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
9. Successful Load rebuilds stable identity and clears active world phase after
   replacement. Failed or cancelled Load changes no audio world state.

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

The current stable-ID lookup is built once after startup population and rebuilt
after successful Load. It copies ID and kind columns before calling back into
WASM, because that call may grow memory and detach a live view. Steady ticks
make no `simIdOf` calls. Row mismatch skips sound rather than assigning another
person's identity.

This lookup assumes no live topology changes. Before runtime birth, death,
spawn, or despawn ships, add an aligned stable-Sim-ID render column or rebuild
the lookup on every topology change.

## Performance acceptance

Use a visible production build, not a hidden `requestAnimationFrame` loop.

1. Run `?stress=1000` for 600 fixed ticks at 120 Hz. Discard the first 60; the
   sampler timer retains the final 540.
2. Require sampler p95 at or below 0.25 ms per tick and maximum at or below
   1.0 ms.
3. Repeat with `?stress=1000&audio=0`. This diagnostic switch disables only
   footstep sampling. The sampling-enabled whole-frame p95 may regress by at
   most 1.0 ms and neither run may place a frame over 16.6 ms.
4. Confirm no `simIdOf` call occurs in steady ticks.
5. Confirm no allocation grows with entity count, no typed-array capacity grows
   after warm-up, and the measured heap has no upward trend. Four fresh bridge
   view wrappers per tick are expected and must not be misreported as literal
   zero allocation.
6. Separately run 40 stable walking Sims for 600 ticks so the scheduler's own
   retained state is measured. The bare stress agents do not carry authored
   stable identity.

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

1. Typecheck, 501 Web tests, the production Vite build, Rust formatting, and
   all workspace tests passed.
2. Every required mutation failed its named focused test and exact source bytes
   were restored before the clean suite ran.
3. The final production sampler bytes were rerun on clean browser origins with
   exactly 1,037 entities. The available browser presented at about 60 Hz, so
   3x speed collected more than 600 fixed ticks without fabricating frame time.
4. The sampling-enabled run retained the final 540 footstep samples at p95
   0.0151 ms and maximum 0.1350 ms. Both pass the 0.25 ms and 1.0 ms sampler
   limits.
5. After explicit garbage collection, 720 sampling-enabled ticks moved heap
   from 3,159,174 to 3,271,486 bytes. A paired 714-tick disabled run moved from
   3,246,870 to 3,357,466 bytes. The enabled run retained only 1,716 bytes more
   than the disabled baseline, but both trend upward. This rules out an obvious
   sampler-proportional leak; it does not satisfy the stricter whole-application
   no-upward-trend gate.
6. The final footstep-sampling-disabled rolling frame window measured p95
   26.7900 ms and maximum 28.0200 ms. Sampling enabled measured p95 26.0250 ms
   and maximum 26.7950 ms. The measured p95 delta was -0.7650 ms and therefore
   passes the 1 ms feature budget. Both runs fail the separate absolute 16.6 ms
   frame target.
7. Captured production renders at 1280 by 720, 390 by 844, 568 by 320, and 240
   by 568 show reachable controls, no horizontal overflow, and 44-pixel audio
   targets. Mute and Effects settings survived reload. The application logged
   no warning or error; Vite still reported the existing missing-favicon 404.
8. Tooling can verify scheduled voices, lifecycle, UI state, timing, and
   persistence but cannot judge whether the sounds are pleasant or distinct.
   The human listening checklist above remains an owner gate.

## Deliberate mutation gate

Snapshot source bytes and restore them exactly after each mutation. At minimum,
prove the suite rejects:

1. Holding live ID or kind views across `simIdOf`.
2. Using raw entity ID as footstep identity.
3. Sampling outside the per-fixed-tick wrapper.
4. Removing synchronous background gating or foreground re-anchoring.
5. Collapsing effects and master gain into one node.
6. Removing oldest-voice eviction or node disconnection.
7. Removing either pointer or Household-roster outcome callback.
8. Removing the stopped-to-walking re-anchor after a socket-projected action.
9. Allowing an observation failure to leave a footstep frame open.
10. Removing transactional cleanup after a partial Web Audio cue failure.
11. Removing cleanup of a partially-created controller graph.
12. Removing cleanup of a voice registered before `stop()` fails.
13. Making the foreground SE branch run for every authored facing.
14. Making the foreground SE branch run for no authored facing.
15. Inverting the foreground SE comparison.

### Mutation evidence from 2026-08-19

Each case reports the four required steps: deleted mechanism, actual failure,
inverse-patch restoration, and exact restored bytes. The clean focused suite
then passed.

1. Live ID and kind view mutation.
   1. Deleted the bounded `Uint32Array.from` copies before `simIdOf`.
   2. Actual Vitest failure:
      ```text
      expected null to be 7003 // Object.is equality
      tests/frame-audio.test.ts:123:39
      ```
   3. Restored both copies with the inverse patch.
   4. `frame-audio.ts` restored to the hash below.
2. Raw entity identity mutation.
   1. Replaced stable lookup with the raw entity ID column.
   2. Actual Vitest failure:
      ```text
      Expected: 7001:2:3:true, 7003:7:8:false
      Received: 41:2:3:true, 43:7:8:false, 44:9:10:true
      tests/frame-audio.test.ts:55:19
      ```
   3. Restored `identities.simIdAt` and its null guard.
   4. `frame-audio.ts` restored to the hash below.
3. Fixed-tick sampling mutation.
   1. Deleted footstep sampling from `frameSimulation.tick`.
   2. Actual Vitest failure:
      ```text
      samples after every fixed tick and never from paused command flushing
      AssertionError: expected main.ts to match the fixed-tick wiring pattern
      tests/frame-audio.test.ts:169:18
      ```
   3. Restored the complete sampling and timing block.
   4. `main.ts` restored to the hash below.
4. Foreground re-anchor mutation.
   1. Limited stride reset to the background edge only.
   2. Actual Vitest failure:
      ```text
      expected oscillators to have a length of 0 but got 1
      tests/audio-controller.test.ts:536:33
      ```
   3. Restored the reset on both visibility edges.
   4. `audio-controller.ts` restored to the hash below.
5. Effects and master graph mutation.
   1. Connected Effects directly to destination, bypassing master gain.
   2. Actual Vitest failure:
      ```text
      expected effects connections [destination] to deeply equal [master]
      tests/audio-controller.test.ts:299:34
      ```
   3. Restored `effectsGain.connect(masterGain)`.
   4. `audio-controller.ts` restored to the hash below.
6. Voice-cap mutation.
   1. Disabled oldest-voice eviction.
   2. Actual Vitest failure:
      ```text
      expected 9 to be 8 // Object.is equality
      tests/audio-controller.test.ts:332:43
      ```
   3. Restored the bounded eviction loop.
   4. `procedural-cues.ts` restored to the hash below.
7. Household-roster route mutation.
   1. Removed the roster's staged semantic outcome.
   2. Actual Vitest failure:
      ```text
      Target cannot be null or undefined.
      tests/frame-audio.test.ts:204:75
      ```
   3. Restored the staged callback and stale-feedback clear.
   4. `main.ts` restored to the hash below.
8. Socket-to-walk anchor mutation.
   1. Disabled the stopped-to-walking re-anchor.
   2. Actual Vitest failure:
      ```text
      expected two sim.footstep events to deeply equal []
      tests/footsteps.test.ts:77:25
      ```
   3. Restored the transition anchor and walking-state write.
   4. `footsteps.ts` restored to the hash below.
9. Sampler-finally mutation.
   1. Replaced `try/finally` with a fall-through `endFootstepFrame` call.
   2. Actual Vitest failure:
      ```text
      Expected: [begin, observe, end]
      Received: [begin, observe]
      tests/frame-audio.test.ts:165:19
      ```
   3. Restored `endFootstepFrame` inside `finally`.
   4. `frame-audio.ts` restored to the hash below.
10. Partial-cue cleanup mutation.
    1. Returned from the player catch block before transactional cleanup.
    2. Actual Vitest failure:
       ```text
       expected oscillator.disconnected false to be true
       tests/audio-controller.test.ts:385:50
       ```
    3. Restored partial oscillator and gain cleanup.
    4. `procedural-cues.ts` restored to the hash below.
11. Partial controller-graph cleanup mutation.
    1. Deleted both `safelyDisconnect` calls from failed graph construction.
    2. Actual Vitest failure:
       ```text
       expected gain.disconnected false to be true
       tests/audio-controller.test.ts:486:44
       ```
    3. Restored both best-effort disconnections.
    4. `audio-controller.ts` restored to the hash below.
12. Registered-voice cleanup mutation.
    1. Disabled the `voice !== null` transactional cleanup branch.
    2. Actual Vitest failure:
       ```text
       expected activeVoiceCount 1 to be 0
       tests/audio-controller.test.ts:404:43
       ```
    3. Restored `finishVoice(voice, true)` for the registered voice.
    4. `procedural-cues.ts` restored to the hash below.
13. Foreground SE branch always selected.
    1. Replaced `facing == "SE"` with `true` in the foreground resolver.
    2. Actual Rust test failure:
       ```text
       assertion `left == right` failed: foreground sprite must follow placement facing Some("SW")
         left: Some(6)
        right: Some(7)
       ```
    3. Restored the exact guard with the inverse patch.
    4. `compile.rs` restored to the hash below.
14. Foreground SE branch never selected.
    1. Replaced `facing == "SE"` with `false` in the foreground resolver.
    2. Actual Rust test failure:
       ```text
       every imported facing must compile: FacingSpriteMissing {
           object: "fridge", facing: "SE", sprite: "bed_foregroundSE"
       }
       ```
    3. Restored the exact guard with the inverse patch.
    4. `compile.rs` restored to the hash below.
15. Foreground SE comparison inverted.
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

1. `frame-audio.ts`:
   `271f2112fffad11c1639fdd53c88a0492c33029345749e7b661ccf01ec33f290`
2. `footsteps.ts`:
   `c0bd4534096e30d590991be39ab5597eaf6bf0505aed2992869e57dec2ead8e7`
3. `audio-controller.ts`:
   `566e8ced59dc8c22b3dd0fbe6c6aa3a1911c788fba63615ff67c90f28f9cde8a`
4. `procedural-cues.ts`:
   `04d0581d8dd478e3ec636f6cfce0622b9633569e8bbe19c9e4a0ee0614d13489`
5. `main.ts`:
   `226c7c751fa3576d4074b095c1153bbab14e393ae49a4142a99babc8cf5d6f34`
6. `compile.rs`:
   `93856db8a410d9dc48bd575ac83c1f2705b3de3c2fe7bfc830a034e3701325b1`

## Open work

1. Replace the startup/Load lookup with an aligned stable-Sim-ID render column
   before dynamic topology.
2. Wire door events only after the front door has authoritative open and close
   state.
3. Add ambience, object loops, alarms, music, and nonverbal Sim voices.
4. Add independent music, ambience, and voice controls without changing the
   current Effects meaning.
5. Replace or refine procedural tones only after the event and lifecycle layer
   passes listening acceptance.
