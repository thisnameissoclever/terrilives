# Head-envelope scan optimization

The first-phase head-envelope scan preserves every compared anchor exactly while reducing time spent inside `top()` by 68.24% in its focused comparison. The check covers 27,072 original/current anchor pairs and their bubble positions at three scales. The second phase, recorded below without replacing that evidence, also reduces pose evaluation while preserving complete posed-point arrays byte-for-byte. These are CPU hot-path results; the normal-game benchmark must separately establish the 16.6 ms frame target.

## Measured cause

The retained `../performance/synthetic-before-head.cpuprofile` spans 8,869.182 ms and contains 3,306 samples. It attributes 1,759.479 ms of self time and 1,767.709 ms of inclusive time to `HeadEnvelope.top()`. The complete `CharacterRenderer.anchors()` path accounts for 1,982.687 ms, about 70.2% of the 2,823.640 ms attributed to the main game frame. `HeadEnvelope.pose()` contributes 209.336 ms. The profile also contains 3,834.371 ms marked `(program)` and 1,962.181 ms marked `(idle)`; those samples were not assigned to a particular application function in this review.

The previous scan called `projectedHeadHeight` for every candidate vertex during both fill and outline passes. Each call recalculated sine and cosine for the unchanged facing, and both passes allocated coordinate tuples for vertices that could not win. The repair calculates facing trigonometry once, reads point components directly, and allocates candidate coordinates only when they replace the winner. Projection arithmetic, traversal order, strict-greater tie handling, visibility, the outline-candidate bound, normal calculation, and outline extrusion are unchanged. No vertices or required bubble geometry are skipped. Pose caches, renderer construction, and geometry selection were left unchanged.

## Independent equivalence check

`web/tests/fixtures/head-envelope/original.ts` preserves the pre-change class with relocated imports. The test reverses that relocation, normalizes checkout line endings, and checks original SHA-256 `7fa11f798a1d15260a3da51b4e992ae8c3b0a99aa2079213af9426ae3797d3b2`. Tested optimized source SHA-256 is `f9139123e9a3b6acd54b20e8675c5006fdfcd9ec91a383d9b084404666b1470a`; it remained unchanged after verification.

1. The 24 appearances cover masculine and feminine presentation; curl, bob, wave, crop, quiff, and Bald; and low/high representative cases with all five body controls and numerical face controls set to 0 or 100. Low faces are round, high faces angular, and glasses are present.
2. There are 279 source-pose samples across 95 named animations. Each exported base or production animation supplies first, midpoint, and last samples when distinct, including fractional interpolation. The synthetic sit-down, stand-up, and standing-read paths are included. This covers every animation name, not every authored frame or the continuous motion between sampled frames.
3. Each appearance also supplies actual configured reading, walking, and reclining poses. The source-pose coverage tests the changed envelope against the exported motions; it does not claim to repeat every configured contact solver for every appearance and action.
4. Original and current envelopes receive identical configured cage coordinates and bone matrices. Each pose is checked at all four facings with strict equality of the complete returned position. Bubble anchors also match exactly at scales 0.75, 1, and 2.5, with the four-logical-pixel gap checked independently from the returned head height. Cache reuse is checked as object identity.
5. The receipt retains every old/new anchor and bubble anchor, appearance case, animation name, frame, source/configured classification, and timing. Both `top()` calls are timed without method or math instrumentation. Their order alternates to avoid always giving one implementation the first call. These are aggregate unit timings, not graphics frame times.

| Hair selection | Original `top()` time | Optimized `top()` time | Reduction |
| --- | ---: | ---: | ---: |
| Curl | 5,140.55 ms | 1,678.72 ms | 67.34% |
| Bob | 3,320.70 ms | 998.04 ms | 69.94% |
| Wave | 2,927.81 ms | 847.97 ms | 71.04% |
| Crop | 2,289.66 ms | 686.07 ms | 70.04% |
| Quiff | 2,657.12 ms | 793.54 ms | 70.14% |
| Bald | 2,722.18 ms | 1,049.39 ms | 61.45% |
| Total | 19,058.03 ms | 6,053.73 ms | 68.24% |

## Verification

From `web`, with `NODE_OPTIONS=--max-old-space-size=4096` and `HEAD_ENVELOPE_EVIDENCE=1`:

```text
npm test -- --maxWorkers=1 --reporter=verbose tests/character-head-envelope-equivalence.test.ts tests/character-surfaces.test.ts
```

**PASS**, exit 0: 30 tests in two files, 43.83 seconds of test time. The new provenance/equivalence checks and existing outline, freckle, projected-head, skin-weight, and graphics-resource tests all passed. See `checks.log` and `receipt.json`.

No browser, graphics benchmark, Cargo command, dependency change, or live-source mutation ran in this check. The coordinated test lane was released after completion, and the production source was frozen for the parent task's normal-driver benchmark.

## Phase 2: scalar pose accumulation

The next normal-driver profile identified `HeadEnvelope.pose()` as the largest named self cost: 895.692 ms, compared with 319.445 ms in the optimized `top()`. Pose evaluation still called `Float64Array.fill` once per vertex and read and wrote the point array for every contribution and coordinate. The second phase uses three scalar accumulators per vertex and stores their final values once. Each coordinate retains the original multiplication, addition, and contribution order. The accumulators and destination use the same double-precision representation. Visibility, topology, matrices, cache invalidation, and initialization are unchanged. Redundant initial configuration remains for the separate lifecycle review.

The same isolated pre-optimization class remains the reference. The focused test now also compares the complete `Float64Array` backing bytes immediately after every pose. It compared 6,768 posed arrays, totaling 7,938,620,352 bytes, with no differences. All 27,072 anchor comparisons and bubble checks at three scales passed again. Original/current pose calls alternate order and are timed separately from point comparison and top evaluation.

| Operation in the phase-two run | Original | Current | Reduction |
| --- | ---: | ---: | ---: |
| Pose evaluation | 3,797.17 ms | 2,280.85 ms | 39.93% |
| Pose and top evaluation combined | 17,766.60 ms | 6,908.01 ms | 61.12% |

The combined comparison includes both optimizations against the untouched original class. It is not an additional 61.12% improvement over phase one. Absolute timings differ between runs; the comparisons above use paired measurements from this second run only.

With `NODE_OPTIONS=--max-old-space-size=4096` and `HEAD_ENVELOPE_EVIDENCE=phase-2`, the same command above **passed**, exit 0: 30 tests in two files, 32.43 seconds of test time. The new evidence is in `checks-phase-2.log` and `receipt-phase-2.json`. The original `checks.log` and `receipt.json` remain intact.

The tested phase-two source SHA-256 is `72701a983a1c25c9376727c1266473c52f4b83283e2653a8537ee0877e9282ae`, checked again after the run. The lane was released and production source frozen. No browser or graphics test ran in this phase; normal-game frame acceptance remains separate.

## Prepared geometry visibility masks

`HeadEnvelope.setVisibleParts(parts?: readonly MeshPart[])` adds context selection for prepared union geometry. Omitting the argument restores all parts. Each immutable part-array identity receives a cached ordered head-vertex list and selected normal adjacency. The original first-insertion vertex order and last-part outline/region metadata are preserved when indices overlap. Normal queries exclude hidden triangles and treat vertices absent from the selected head as the original compact envelope did. Hidden-bone flags and the existing hair-region policy still apply.

A mask change clears facing results without rebuilding shape, skin contributions, or posed points. Reapplying the current array is a no-op; returning to a previously used array reuses its cached selection without reading union indices again. `configure()` preserves the selected context while refreshing shape-dependent data.

The independent compact-reference selector is frozen in `web/tests/fixtures/head-envelope/variants-original.ts`. Reversing its relocated imports and restoring CRLF produces the earlier source hash `4ea9897df300ea987e489b023d8319b2c50eb73e34ea4650fe2be590057dfc4c`. The automated test pins its LF-normalized hash `5ce731aaf2093da3457b65064cbc59d5ef84d42806501e8c8836c283d07f0c9f`, so the comparison is independent of the concurrently revised prepared-rig selector.

1. Six hairstyle cases cover both presentations and low/high body endpoints through six contexts: open/closed eyes, clothed/bare, mop grip, and a reading prop. All four facings match the original compact selected envelope exactly: 576 comparisons. Mask changes also preserve the prepared point bytes and each contribution-array reference.
2. Synthetic shared-index cases verify exact tie order, last-part outline and region metadata, selected normal adjacency, hidden-bone flags, immutable-mask reuse, selection persistence through configuration, empty selection, and restoration with `undefined`.
3. Existing full posed-point/anchor equivalence and character-surface tests ran again to check default behavior. Earlier evidence files were not replaced.

From `web`, with a 4 GiB heap and evidence generation disabled:

```text
npm test -- --maxWorkers=1 --reporter=verbose tests/character-head-visible-parts.test.ts tests/character-head-envelope-equivalence.test.ts tests/character-surfaces.test.ts
```

**PASS**, exit 0: 41 tests in three files, 87.68 seconds of test time. See `checks-visible-parts.log`. The tested head-envelope source SHA-256 is `64b4d020563941e14e97740bec2839a2176162f73b46c88a03bcc5ffff656b8d`. The lane was released after the run; renderer, world, preview, and prepared-rig integration belong to their separate owner and verification.
