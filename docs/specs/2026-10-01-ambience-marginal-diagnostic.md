# Isolate room playback from existing audio

This is a causal diagnostic, not a replacement acceptance test. PR 184 remains
held after the 94,496-byte median failure. No limit or release condition changes.

## Why this experiment

The acceptance control `audio=0` bypasses both complete fixed-tick audio
samplers, not just ambience. Offline inspection of historical snapshots now
tracks compiled-code identities as well as object identities. It found a
45,632-byte renderer instruction stream replaced, rather than accumulated,
between ticks 600 and 1140. It also found 20,352-byte Sim-audio and 7,232-byte
portal-audio instruction streams surviving through tick 1680. Those functions
serve existing audio too. This supports more specific attribution, not a claim
that current growth is bounded or that ambience caused the whole differential.

## Fixed comparison

Run one pair on the frozen post-ECS production build `index-ChVIKHes.js`.
Use a fresh browser context for each condition, with every audio sampler enabled:

1. Ambience 25%, then Ambience 0%.
2. Identical preferences otherwise: Sound on, Effects 70%, Voices 100%, version 1.
3. Stress population 1,037; seed `(104729,130363)`; paused start at tick zero.
4. Reuse the acceptance runner's exact tick 60/600 endpoints, normal rendering,
   60-tick samples, normalized HUD, source draining and collection sequence.
5. Add baseline/final heap snapshots only, four total. Capture actual cue/source
   counters in both conditions. Preserve the raw samples and snapshot hashes.
6. Require matching endpoint hashes, positive existing-audio observations in
   both conditions, positive room starts at 25% and zero at 0%, and drained
   paused room sources. Close each context and the task-owned server afterward.

Setting the initial preference happens only in isolated test contexts. Do not
modify the user's saved settings, product source or acceptance runner. Use the
existing diagnostic wrapper's module exposure and snapshot interception.

## Decision and limits

Inspect new reachable source/callback/buffer owners and compiled-code identities.
An ended room source or repeated decoded asset surviving its release boundary
warrants a specific lifecycle regression. Growth in existing renderer/compiler
owners warrants investigation there, not an invented room cleanup fix.

A favorable raw delta in this one pair does not pass the six-run contract,
establish a plateau or authorize deployment. The snapshots themselves can alter
compilation timing; retain that limitation. Do not repeat this pair unchanged
or run another acceptance sweep without a demonstrated correction.
