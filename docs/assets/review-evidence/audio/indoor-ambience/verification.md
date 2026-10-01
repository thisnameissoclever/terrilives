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

## Interruption correction and identity experiment

Whole-branch review found that a paused release could freeze during audio-clock
interruption and resume without a simulation tick to observe the unavailable
clock. The original native proof manually supplied that missing observation.
Commit `cf991842` gives the controller ownership of context state events,
immediately clears all five families while unavailable and rejects stale-context
callbacks. The [fix report](final-fix-report.md) records red tests, three fault
deletions with exact restoration, 540 passing focused tests, typecheck and build.
Scoped independent review found the lifecycle issue and both minor findings
addressed, with no new breakage. Memory acceptance remains open.

`node web/output/playwright/verify-indoor-native.cjs native-lifecycle-fix.json`
passed, exit 0. The [corrected native result](native-lifecycle-fix.json) uses
actual OfflineAudioContext state events without an injected paused fixed tick.
All ten checks passed, including zero interrupted-release resumed tail. Peak at
Effects/Ambience 100% is 0.020989106968045235; reference RMS at Effects 70% remains
0.004350840998437651. This is not a physical-device or subjective listening test.

The [predeclared identity experiment](../../../../specs/2026-10-01-audio-lifecycle-memory-diagnostic.md)
then ran once on `index-D_MKRowA.js`, exit 0. Both modes matched all four world
hashes at ticks 60, 600, 1140 and 1680. [Raw samples](lifecycle-identity-diagnostic/diagnostic.json)
record four successful enabled room starts, none disabled, and zero retained
room sources at each drained endpoint. All audio-named native group counts
remained constant; enabled AudioBuffers stayed at 16 and GainNodes at four.
These are wrapper counts, not decoded-buffer byte totals.

The [identity summary](lifecycle-identity-diagnostic/identity-summary.json) tracks
new nodes through successive snapshots. Net closure counts are zero, but actual
closures changed identity. [Enabled](lifecycle-identity-diagnostic/enabled-owners.json)
and [disabled](lifecycle-identity-diagnostic/disabled-owners.json) retaining paths
put the small new plain objects under compiler allocation-site feedback; the
largest new arrays under Wasm feedback vectors. New closures belong to the
current renderer and pending timer/promise work. No accumulating ended audio
source cohort was identified in these sampled owners. This is finite, sampled
evidence, not a proof that every allocation is bounded.

| Interval | Enabled code growth | Disabled code growth | Enabled object growth | Disabled object growth |
| --- | ---: | ---: | ---: | ---: |
| 60 to 600 | 286,428 | 191,964 | 24 | 32 |
| 600 to 1140 | 62,480 | 65,524 | 56 | 28 |
| 1140 to 1680 | 104,256 | 93,580 | 56 | 56 |

Code did not plateau over these three intervals. Wasm linear-memory capacity
also grew substantially in both modes: enabled 5,242,880 to 119,144,448 bytes,
disabled 5,111,808 to 94,830,592. Matching world hashes do not imply identical
render counts or allocation history. These figures require separate attribution;
they are not evidence that new ambience owns that growth.

Eight raw snapshots remain local in
`web/output/playwright/indoor-ambience/lifecycle-identity-diagnostic-01/`:

1. `disabled-0060`: `1dceadf13b4afcfdbf62813da51345ab9c18e4e680e43c154f4a44a3f2d911c7`
2. `disabled-0600`: `ebab26e3fdc8c8277c41e24dfa32a3e21e6eb0e0ff09edff247df147f72644f3`
3. `disabled-1140`: `78ce806f114fe8b2d88bcd4f16130322415cac825051a9cdb526451ab264fbee`
4. `disabled-1680`: `08906ed6d9770619aa85b939b8f8805ddec5eb1de78dbeb31a8fded5dc24dd40`
5. `enabled-0060`: `f2a4d5844f46733b80d5e85e41d351dbfce86e34b6a737992cf774ab0676111c`
6. `enabled-0600`: `c78730e20a5203dca2d6b40aa348046f390e4e9fe2c1eb23e9b73005f3a84cc2`
7. `enabled-1140`: `3f81ce067e5d46565309990e5037ccc7176ce881f3f99c630d38d4e2ae6c2763`
8. `enabled-1680`: `c4e989905dbe2546b311eeffac2634f93817300f72e11c91e8ab89225c514024`

The separate lifecycle correction can be evaluated against main's existing
audio without importing ambience or PR 178. No failed gate is cleared by that
separation. All diagnostic browsers and the native-proof development server
were closed after their checks.

## Refresh after the existing-audio repair shipped

PR 185 merged the main-only lifecycle repair at `26145f4f`. This held branch
merged that exact main in `f613be61`, preserving one Event-compatible context
handler, room cleanup, context replacement and both parents' unique tests.
The [merge report](main-refresh-report.md) records 435 passing focused tests,
typecheck, syntax and documentation checks. No Rust build or memory sweep ran.

Root ran `node web/output/playwright/verify-merged-audio-native.cjs`, exit 0.
The [native result](native-main-refresh.json) has no page errors and passes ten
room checks, eighteen existing-source checks and the forced-failure cleanup
check. The full-level room peak remains `0.020989106968045235`; interrupted
tails remain zero. This verifies the merged audio wiring, not subjective sound
quality or memory acceptance. The task-owned browser and server were closed.

The separate simulation-removal-history correction is still being verified in
another worktree. Its artifact is not included here. The latest comparable raw
memory median remains 123,972 bytes against the unchanged 65,536-byte allowance.
Original failures and snapshots remain preserved; PR 184 stays draft and held.
