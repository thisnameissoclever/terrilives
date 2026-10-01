# Autonomous bed use through release WASM

`scripts/bed-autonomy-proof.mjs` runs the actual starting household for four
days at seeds 7, 19 and 2301. It assigns Tim and Bill the two double-bed places
and Casey the lower bunk. The normal run issues no other commands and changes
no needs, positions, routes or action durations.

The optimized WASM SHA-256 is
`564035eedbc13836565dd93afda3bcb62aafc3d753f5c3f82d4d070411cd5eb1`.
The package is the same release build used for the starting-layout checks.
Run the script after building the local release WASM package; its JSON records
the binary hash so results can be tied to that build.

| Seed | Source ticks | Assigned sleep ticks, Tim / Bill / Casey | Shared double-bed sleep ticks | First shared tick |
| --- | ---: | --- | ---: | ---: |
| 7 | 5760 | 351 / 998 / 997 | 0 | None |
| 19 | 5760 | 392 / 726 / 674 | 200 | 1514 |
| 2301 | 5760 | 399 / 972 / 667 | 72 | 1152 |

All nine Sim/seed cases used their assigned place and left sleep at least twice.
An exit can include work preemption; it does not establish natural completion
of that sleep action. Seed 7 did not produce overlapping sleep. Tim also used
another sleeping place in seeds 7 and 2301; assignments are preferences, not
exclusive restrictions.

Every tick checks assignments, occupant uniqueness, and that each sleeping Sim
appears exactly once in the bed-place projection. The last check matters because
the projection collapses claimants into one occupant per place. It detects hidden
simultaneous sleepers, but cannot establish travelling-claim exclusivity.
Native save validation and admission tests cover that separate contract.

A second world loads the initial save and then ticks alongside the source.
Their hashes match every tick, and their complete save bytes match every 60
ticks and at the first overlap. At each day boundary and first overlap, the
second world advances one additional tick before reloading the source snapshot.
That rewind must restore exact bytes and hash. Both handles are freed in
`finally`.

## Counterfactual and review

`--old-layout` runs seed 2301 after moving the double bed to `(0, 6)`, SE,
through the public placement command. It confirms the move took effect before
assigning places. The replay and occupancy checks still pass, but assigned
sleep ticks become `0 / 419 / 753`. The script exits 1 at the assertion requiring
each Sim to naturally use their assigned place. This catches the original
inaccessible-place defect without forced sleep orders or patched state.

Independent review tightened the sleep-exit wording, required each sleeping
Sim to remain visible in the place projection, and required at least one
shared-bed interval across the seed set. The reload check also now starts from
a diverged world instead of reloading an already identical state.

| Command | Result |
| --- | --- |
| `node --check scripts/bed-autonomy-proof.mjs` | PASS, exit 0. |
| `node scripts/bed-autonomy-proof.mjs` | PASS, exit 0; 17,280 source ticks. See `autonomy-release-report.json`. |
| `node scripts/bed-autonomy-proof.mjs --old-layout` | Expected FAIL, exit 1; assigned-place assertion, observed ticks `0,419,753`. See `autonomy-old-layout-report.json`. |

This is bounded behavioral and replay evidence. It does not verify occupied
body fit, compositing, picking, browser performance or physical-device behavior.
The bed feature remains unpublished until occupied visuals pass review.
