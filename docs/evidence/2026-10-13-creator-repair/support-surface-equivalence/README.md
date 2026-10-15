# Compiled support-surface queries

Support-surface queries are faster and retain exact results, but the measured neutral first bike fit still takes about 63 ms in the Node comparison. This repair does not establish the 16.6 ms whole-frame target. The parent task owns the next actual-game first-fit profile and performance decision.

## Cause and change

The retained `../performance/prepared-profile/moving.cpuprofile` spans 24,664.772 ms. Its sampled `fitBike` subtree totals 134.430 ms. `SupportSurface.height()` accounts for 100.373 ms of self time, plus 3.508 ms in its per-query callback. Together those account for 77.3% of the sampled fit. Sparse geometry query work accounts for about 3.173 ms. This separates the remaining query cost from the already repaired geometry evaluation.

`support-surface.ts` now computes immutable triangle edge differences and determinants at construction and stores candidates in numeric X/Y bucket maps. Each query avoids constructing a string bucket key, mapping triangle indices back to points, and recomputing those fixed coefficients. Sparse maps retain bounded allocation for widely separated geometry; no large dense target or coordinate threshold was introduced.

The same triangles enter the same buckets in the same order, including degenerate candidates. Queries retain the original divisions, multiplication/addition order, barycentric tolerance, determinant tolerance, top/bottom reduction, and final finite-result check. There is no reciprocal substitution, plane equation reformulation, candidate pruning, changed sample grid, or fallback. Production changes are confined to `web/src/render/character/support-surface.ts`.

## Independent references

1. `web/tests/fixtures/support-surface/original.ts` preserves the old surface implementation. Reversing its relocated import and normalizing checkout line endings yields SHA-256 `9e3a5ad79cb1fd0ec4d41f127166288700c85d64a30474891f18855f24b57d67`.
2. `web/tests/fixtures/support-surface/bike-original.ts` preserves the current sparse bike fitter before this surface change, with its surface import bound to that frozen old class. Its other imports are relocated. Reversing those changes and normalizing line endings yields SHA-256 `eae951a918bef165c15a1ea935041d6005530b56c0b0ca5fca504f479a15e696`. Both sides therefore do not share the changed surface implementation.
3. The frozen golden fixture extracts all 64 body corners, 16 phases per corner, and query counts from the earlier bike-fit receipt. The original receipt hash is `82ff54c69a97b5960167a8b79d49073e4a722cfe42de901c2998fc196fc2fe89`; the extracted fixture hash is `bcf8cad384b6b53734e7e6cc72c20b9bd3609ce40f11f6e03b7b48d88e033b94`. The test pins both values.

## Exactness and timing

The surface comparison checks 16 actual posed saddle, hip, and trainer-sole surfaces across masculine/feminine presentation and low/high body endpoints, plus a synthetic edge-case surface. It includes dense grids, vertices and nearby points, triangle centroids and edge midpoints, bucket boundaries, outside points, degenerate and reversed triangles, overlapping layers, sparse distant coordinates, non-finite queries, and signed zero. All 516,108 top/bottom height comparisons match with `Object.is`; bounds and maximum height also match.

The complete bike comparison covers both presentations, all 32 independent body corners, and all 16 phases. Every original/current fit object matches strictly, including any complete periodic hip cycle, both foot transforms, contact offsets, reach margin, and support counts. Serialized outputs also match the frozen golden values. JSON cannot distinguish signed zero; the direct old/current comparisons and dedicated height tests supply that check.

Query counts remain exactly 53,568 top queries and 39,620,232 bottom queries across those 64 fits. The reductions below come from doing the same work more cheaply, with no reduction in query or candidate coverage.

| Measured work | Original | Current | Reduction |
| --- | ---: | ---: | ---: |
| Six alternating dense-query batches over the 17 surfaces | 3,308.91 ms | 1,093.03 ms | 66.97% |
| Complete 64-corner fits, including cached phase calls | 21,470.39 ms | 9,676.72 ms | 54.93% |
| Neutral masculine first fit, ordinary loafers | 147.99 ms | 62.83 ms | 57.55% |
| Neutral feminine first fit, ordinary loafers | 140.32 ms | 63.36 ms | 54.85% |

Each neutral fit executes exactly 837 top and 219,294 bottom queries on both implementations. The masculine neutral appearance matches the profiled first-exercise geometry: all body controls at 50, ordinary face values, curl hair, overshirt, rolled sleeves, trousers, and loafers. Fit timing includes test-local query counters; the dense-query batches have no query instrumentation. Original/current call order alternates. These are paired Node timings, not graphics-frame measurements.

The expensive periodic-fit corners remain costly: the largest current aggregate fit time is 951.04 ms. That is a remaining performance failure for synchronous first use, not an accepted delay. The parent must determine the next change from actual-game evidence rather than treating these unit timings as final acceptance.

## Checks and retained artifacts

Both commands ran from `web` with `NODE_OPTIONS=--max-old-space-size=4096` and one worker.

1. With `SUPPORT_SURFACE_EVIDENCE=1`, `npm test -- --maxWorkers=1 --reporter=verbose tests/character-support-surface-equivalence.test.ts`: **PASS**, exit 0; 70 tests, 37.14 seconds of test time. See `checks.log` and `receipt.json` for dense heights, full current fit outputs, frozen-golden matches, query counts, and paired timings.
2. After adding the neutral first-use cases, with `SUPPORT_SURFACE_EVIDENCE=neutral`, `npm test -- --maxWorkers=1 --reporter=verbose tests/character-support-surface-equivalence.test.ts -t "neutral first-fit"`: **PASS**, exit 0; 2 passed, 70 deliberately skipped, 535 ms of test time. See `neutral.log` and `receipt-neutral.json`. The initial 70-case receipt was preserved.

The tested source SHA-256 is `7d69ea22cc7d3e6b1d97ee2479c471ad1bea9b429997bf1d15d7e4403ce1eab2`, unchanged after both runs. No head, prepared-rig, renderer, or bike-fit production file was edited. No browser, graphics test, dependency change, live-source mutation, or deadline change occurred. The coordinated heavy-work lane was explicitly released after verification.
