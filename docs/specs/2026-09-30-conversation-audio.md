# Interrupted conversation audio

## Scope

Preserve the accepted recordings, playback gain (0.224), footsteps and silent
routine controls. Repair the recorded-voice player's interruption envelope and
failed-construction cleanup. No new sound library, dependency or paid service.

## Behavior

1. A stop retains the current attack, plateau or release level before fading
   to zero. The fade lasts at most 12 ms and cannot extend beyond the samples'
   natural completion.
2. Source nodes are owned immediately after creation. A failure assigning the
   buffer, setting rate, connecting, starting or scheduling stop reclaims the
   entire unpublished pair immediately. It does not wait for an end callback
   from a source that never started.
3. Natural attack/release edges are bounded to half the pair duration for very
   short buffers. Shipped multi-second clips retain their existing 12 ms edges.

The original stop used `cancelScheduledValues` and a future zero ramp without
a current-time anchor. Cancelling a future ramp removes the interpolation that
was producing the current value. This can create a discontinuity; see the
[Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#dom-audioparam-cancelscheduledvalues).
The replacement ramp ends at the interruption time and original envelope level,
preserving the preceding trajectory before the new fade begins.

## Reproduction and rendered evidence

`web/proofs/voice-fades.js` runs the actual `VoiceClipPlayer` through Chromium's
`OfflineAudioContext`, silently. Constant-one sample buffers expose the gain
envelope directly. This is rendered-sample evidence, not a listening opinion.

With Vite serving `web/` on port 5197:

```powershell
playwright-cli --session terri-audio-fades open http://127.0.0.1:5197/proofs/index.html
playwright-cli --session terri-audio-fades eval "async () => (await import('/proofs/voice-fades.js')).proveVoiceFades()"
playwright-cli --session terri-audio-fades close
```

Before the fix, stopping during attack reported an assertion error: sample
level `0.14894454` dropped directly to `0`. After repair it moved to `0.14933333`,
the expected next attack sample, then faded. Plateau and second-clip stops
remained at `0.224` at the interruption and reached `0.112` halfway through the
fade. All ten cases passed: start, attack, plateau, second clip, natural release,
natural end, after end, and three very short pairs. Consecutive-sample checks
also cover the natural endpoint, so shortening the buffer cannot hide a final
hard cut. The proof page's unrelated missing-favicon request returned 404.

The short-pair checks exposed a second envelope defect: overlapping attack and
release events at the same time were not safely represented by the original
schedule. Bounded edges remove that ambiguity. No shipped clip has that duration.

## Regression and mutation evidence

The initial interruption tests failed five cases. The new construction tests
then failed nine cases before cleanup was repaired. The final focused voice
suite contains 34 passing tests, including eleven failure-injection cases.

Five compiling mutations each exited 1 from assertions using
`npm test -- --maxWorkers=1 tests/voice-clips.test.ts -t <filter> --reporter=dot`:

| Removed mechanism | Actual failure |
| --- | --- |
| Current-time envelope anchor | Expected ramp time 10; received 15.6. Five failures. |
| Immediate source registration | Expected disconnected true; received false. Six failures. |
| Failed-construction teardown | Expected disconnected true; received false. Eleven failures. |
| Natural-end clamp | Expected 15.6; received 15.606. Three failures. |
| Short-buffer fade bound | Expected gain 0.224; received 0.0746667. Three failures. |

Each mutation was reversed with an inverse patch. After every restoration,
`web/src/audio/voice-clips.ts` matched SHA-256
`52bc38a5868a9409be878dadc5e8433e0af218b5ed4cc161626b30e5a7d5c713`.

The full web suite passed 1,272 tests across 89 files, followed by typechecking
and the production build. All commands exited zero. No Rust or simulation code
changed in this audio slice; the prior sleep integration's Rust gates passed.

## Remaining audio work

The household scheduler still represents all conversations with one selected
pair. A second conversation joining or leaving can restart that pair. New
housemates make this reachable; it needs per-conversation ownership, not more
volume tuning. Appliance recordings, broader sound content and device listening
remain separate work. This repair does not claim acoustic acceptance of the
whole game.
