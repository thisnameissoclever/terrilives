# Indoor ambience verification

The implementation at `466a4b91` is not released. The retained-memory gate
failed; none of the diagnostics below replaces that result.

## Played and rendered checks

1. `node web/output/playwright/verify-indoor-ambience.cjs http://127.0.0.1:5221/?stress=0`
   passed, exit 0. [Report](game-ui.json). Startup made no room request or start;
   gameplay started one loop; Pause drained it. Keyboard adjustment persisted
   50% while Effects stayed 70% and Voices 100%, including on a new page.
2. Root inspected [the game](game.png), [desktop Options](options-desktop.png),
   [390px mobile Options](options-mobile.png) and
   [doubled Options text](options-enlarged-text.png). Labels remained readable
   and the range remained reachable with a 44px height. At doubled text its
   width was only 52px, so touch precision is limited; keyboard adjustment works.
   Text scaling was injected into this panel, not an operating-system setting.
3. `node web/output/playwright/verify-indoor-native.cjs` passed, exit 0.
   [Native report](native.json). Ten rendered checks covered gain ratios,
   Voices independence, silence boundaries, pause fade and suspended tails.
   The rapid-toggle ownership correction was included in this native check.
4. These checks do not establish subjective sound quality or 120 Hz performance.
   No household save was created or loaded. Every task-owned page closed in
   a finally block. The test page used an isolated browser context.

## Failed acceptance

`node scripts/audio-browser-proof.cjs memory --url http://127.0.0.1:5221/ --output web/output/playwright/indoor-ambience/memory.json`
exited 1. The [complete six-run report](memory.json) records raw pair
differences of 90,376, -237,816 and 69,120 bytes. Median 69,120 exceeds the
unchanged 65,536-byte allowance by 3,584. All structural checks passed:
one document, 1,446 nodes and 159 listeners at every paused endpoint; enabled
room playback was positive, disabled starts were zero, and room sources drained.

There was no repeat of this unmatched acceptance run. The corrected protocol's
first acceptance result is recorded below.

## Ownership diagnostic

A fresh-context review found that each context initializes a different crypto
world seed. The harness also stops at slightly different ticks. Its paired
whole-page subtraction therefore cannot establish audio ownership of the
difference, despite equal entity counts and equivalent visible HUDs.

One separate enabled/disabled diagnostic pair captured four heap snapshots
using the existing workload and endpoint collection. Snapshotting perturbs
execution; this run is not acceptance. See the [run](heap-diagnostic/diagnostic.json),
[grouped node changes](heap-diagnostic/ownership-summary.json), and
[non-weak retaining paths](heap-diagnostic/retaining-paths.json).

| Snapshot category | Enabled net self-size growth | Disabled net self-size growth |
| --- | ---: | ---: |
| Code | 320,592 bytes | 225,124 bytes |
| Ordinary objects | 216 bytes | 48 bytes |
| Closures | 0 bytes | 0 bytes |
| Arrays | 5,764 bytes | 3,336 bytes |

The dominant new instruction streams were retained by the production sprite
instance builder (53,184 bytes), fixed-tick audio sampler (21,184 bytes), and a
render function (12,224 bytes). Function identity was checked against bundle
`index-BiPUJ904.js`. One new 64-byte native AudioBuffer wrapper was retained by
the controller's intentional `objectLoopClips` cache, not the room player.
No accumulating ended room sources were identified in this pair.

This supports runtime code generation as a major contributor in the diagnostic.
It does not fully account for the original uninstrumented failure. In particular,
the pre-snapshot heap deltas do not exactly equal the later snapshot aggregates.
The release hold remains. No code category, allowance, or failed run was removed
from acceptance.

The raw snapshots remain in this worktree at
`web/output/playwright/indoor-ambience/heap-diagnostic/`. They are diagnostic
artifacts, not repository assets. SHA-256 identities:

1. `disabled-baseline.heapsnapshot`: `fd281b2027d38ce99a5f5d5915f6445b8f388ba2d72477cff0d26dba2e00c8ed`
2. `disabled-final.heapsnapshot`: `45fe92b3957ab55c2c3a686260f7a552f9160b50c2472cc757ab6acfab8f336f`
3. `enabled-baseline.heapsnapshot`: `f7d47093fa2f5a5b69fc84aa3ab5c857c10c0dfdf446a9d6bda792303425d028`
4. `enabled-final.heapsnapshot`: `6a111554ce9664efeb4288830f92f93b5d90131610a3455409fd895b0631f92b`

## Matched protocol and failed acceptance

Commit `1ae3a702` repairs seed and tick matching without changing the workload,
allowance, rendering, optimization settings or source bounds. Its
[implementation report](matched-implementation-report.md) records 1,768 passing
tests, a later 70-test focused run including one additional seed-fixture test,
typecheck/build/doc checks and five assertion-failing guard deletions with exact
byte restoration. Independent task review approved the implementation.

`node web/output/playwright/verify-matched-audio-pair.cjs` passed, exit 0.
The [single-pair report](matched-pair.json) records seed `(104729,130363)`, ticks
60 and 600, baseline hash `1689968484302009063` and final hash
`6672627640496136405` in both modes. No page errors occurred; paused sources
drained. Root inspected both [enabled](matched-enabled.png) and
[disabled](matched-disabled.png) stress-world screenshots. These show the
deliberately crowded test population, not the ordinary three-person household.

`node scripts/audio-browser-proof.cjs memory --url http://127.0.0.1:5221/ --output web/output/playwright/indoor-ambience/memory-matched.json`
then failed, exit 1. The [six-run result](memory-matched.json) has comparable
seeds, exact endpoints and equal hashes in every pair, plus passing structural
checks. Raw differences are 218,048, 123,972 and 81,996 bytes. Median 123,972
exceeds the unchanged 65,536-byte limit. There was no repeat acceptance run.
This feature and the separate PR 178 remain release-held.

## Matched ownership diagnostic

One separate instrumented pair used the first predeclared seed and captured
baseline/final heap snapshots. It is diagnostic, not acceptance. Commands:

1. `node web/output/playwright/diagnose-indoor-heap.cjs matched-heap-diagnostic`
2. `node web/output/playwright/summarize-indoor-heap.cjs matched-heap-diagnostic`
3. `node web/output/playwright/trace-indoor-heap.cjs matched-heap-diagnostic`

All exited 0. The [run](matched-heap-diagnostic/diagnostic.json) matched the same
ticks and hashes as the first protocol check. [Grouped changes](matched-heap-diagnostic/ownership-summary.json)
show code self-size growth of 298,064 bytes enabled versus 208,416 disabled;
ordinary objects 40 versus 48; closures zero in both; arrays 4,512 in both.
There was no net growth in the audio-named groups selected by the diagnostic.
Those group totals do not prove absence of all leaks.

[Retaining paths](matched-heap-diagnostic/retaining-paths.json) identify the
largest new enabled instruction streams as `buildInstances` (47,616 bytes),
`sampleSimAudioAfterTick` (20,352) and `instanceCount` (12,864). Names were
resolved against production bundle `index-DqfSuUCT.js`. Pre-snapshot heap
growth was 331,320 versus 174,752 bytes; it does not exactly equal the later
snapshot aggregates. Instrumentation and compilation timing remain relevant.
No compiled-code category was subtracted from acceptance.

Raw snapshots remain local under
`web/output/playwright/indoor-ambience/matched-heap-diagnostic/`:

1. `disabled-baseline.heapsnapshot`: `d65e85748f31be4a6f544ebfba3522c8e4e51f916e0eb1e86f0d12e437b93373`
2. `disabled-final.heapsnapshot`: `a562209e8a887abf40a815c7251efcfd378b9165af0b9cba2175b78c0b73a184`
3. `enabled-baseline.heapsnapshot`: `258eff3993de87ca6a78abe53aa4b5c20810451db4153ac26b881a1440d647e0`
4. `enabled-final.heapsnapshot`: `9c94f3afb905f2bc8517555d95c53c1abbc2a164a3649342722f8932552f34ea`

Every diagnostic browser context closed in a finally block. The next decision
must follow ownership evidence and independent review, not another unchanged
acceptance attempt or a relaxed limit.
