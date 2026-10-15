# Bike support search optimization

The unchanged bike deadline tests pass after removing repeated queries of the fixed saddle. An isolated original fitter and the optimized fitter returned exactly equal complete results for both presentations, all 32 independent body corners, and all 16 tested phases: 64 cases and 1,024 comparisons. Candidate order, body queries, support counts, output values, tolerances, appearance ranges, and the existing 30-second deadlines remain unchanged.

## Change and provenance

`web/src/render/character/bike-fit.ts` now evaluates the saddle's existing ordered sample grid once per uncached fit. Every support candidate reuses those same heights. Undefined saddle samples remain in the grid, preserving the original body-query membership and ordering. The hip search, footwear search, periodic fallback, and cache keys were not changed.

1. Original production source SHA-256: `c3058cf5ae7a3c9b33e281a6bb1ff21a41c516a509764776a589f7cb82713cee`.
2. Tested optimized production source SHA-256: `463dfeabc25777535082f9267e9af3edc810e99348fdc7f44280a41f86d9a0fb`.
3. `web/tests/fixtures/bike-fit/original.ts` preserves the original implementation with only imports relocated. The provenance assertion reverses those import changes and normalizes checkout line endings before checking SHA-256 `54c93637b5408e37fee53a41390f8b3b59b17e98735ae8e44150308558032b67`. The original raw digest remains recorded separately.

## Verification

Both commands ran from `web` with `NODE_OPTIONS=--max-old-space-size=4096`, one worker, and the coordinated heavy-work lane reserved for these tests. No browser, Cargo command, dependency change, or live-source mutation ran in this work.

1. `npm test -- --maxWorkers=1 tests/character-clips.test.ts -t "fits configured trainers"`: **PASS**, exit 0; 2 passed, 45 deliberately skipped. Combined test time was 32.86 seconds, compared with 57.649 seconds in the earlier quiet failure receipt. Both existing cases retain their 30-second deadlines. The default reporter did not print separate case durations. See `deadline.log` and `../integration/prior-timeouts-quiet.log`.
2. With `BIKE_FIT_EVIDENCE=1`, `npm test -- --maxWorkers=1 --reporter=verbose tests/character-bike-fit-equivalence.test.ts`: **PASS**, exit 0; 65 passed in 82.96 seconds of test time. One assertion verifies original-source provenance; 64 cases compare all complete fit outputs at 16 phases each. See `equivalence.log` and `receipt.json`.

Each compared appearance uses trainers, shorts, a jacket, and short sleeves, matching the original regression test. All five body controls independently take 0 or 100. The comparison includes hip position, any complete periodic hip cycle, pelvis rotation, pitch, both foot rotations/offsets/contacts, reach margin, and support sample count. It uses strict equality without tolerance or output rounding. The test also requires fewer saddle top queries and exactly equal body bottom-query counts in every case. Query counting uses a temporary test-local method replacement restored in `finally`; it does not retain millions of mock-call records.

| Presentation | Original saddle queries | Optimized saddle queries | Body queries, unchanged | Original fit time | Optimized fit time | Reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Masculine | 19,917,252 | 26,784 | 19,917,252 | 26,731.28 ms | 14,775.74 ms | 44.72% |
| Feminine | 19,702,980 | 26,784 | 19,702,980 | 26,312.43 ms | 14,606.69 ms | 44.49% |

These paired times measure the fitters inside the instrumented equivalence run, including their cached phase calls. They are not gameplay frame times or a replacement for the separate desktop benchmark. The receipt retains both full outputs for every phase and exact timings and counts for each body corner.

The production source hash was checked again after both runs and still matched the tested optimized value. The heavy-work lane was released immediately afterward.
