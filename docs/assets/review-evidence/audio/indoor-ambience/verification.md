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

There was no second uninstrumented acceptance run.

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

Next technical work is an explicitly matched seed/tick comparison with world-hash
verification. It must preserve the workload length, raw allowance and structural
checks, and must not select a seed because it produces a passing result.
