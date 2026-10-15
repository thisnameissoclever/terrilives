# Prepared sleeping support and shared covers

The pure implementation prepares fitted sleeping matrices and three per-person cover grids before rendering: double-bed offsets `0` and `-0.77`, and bunk offset `0`. Occupancy changes combine those grids and update an existing cover's positions and normals. Drawing no longer needs the dense sleeping fit, posed body surface or blanket support queries once the required artifact is bound by the integration layer.

This changes when the existing calculations run. It preserves their output. Both source sleep clips have static playback and exactly one authored sample; preparation rejects a future animated clip rather than silently freezing it. Generic motion interpolation and `sleep-fit.ts` are unchanged.

## Geometry and identity

Compilation constructs the same `PreparedBody` union as a live person and selects the exact clothed, eyes-closed sleeping parts, with fixture pixels excluded and fixture support geometry retained separately. It computes the complete fitted Float32 skeleton, shapes the same control cage, then uses the existing Float32 skinning and subdivision evaluator. It does not substitute the older compact selected-mesh representation.

The artifact contains both sleeping clips' matrices, selected-part identity, anatomical height, full shape identity, and per-slot draped grids. Frozen plain arrays preserve every Float32 value and signed zero through structured clone. The runtime validates the selected mesh and source, then converts matrices to a cached Float32 array once per clip artifact. A missing or mismatched artifact throws.

Appearance identity includes presentation, every body and face field, and all geometric selectors, including hair, baldness, facial hair, garments, shoes, glasses, scars and earrings. Colors, undertone, freckles and freckle density are normalized because these are uniform-only edits in the current renderer. Source identity includes the body manifest and geometry hashes, and each sleeping clip's source, fixture metadata and authored animation data. Worker preparation checks these revisions against its loaded sources.

The two double-bed offsets reproduce `CharacterScenePlan`'s current sleeping-place mapping: place 0 has offset 0; place 1 has offset -0.77. Bunks use offset 0. Cover validators require this exact slot sequence and the existing 49-by-45 or 25-by-45 grid dimensions.

## Why independent drapes preserve the shared cover

The old implementation builds each grid entry with a maximum across occupants, storing every result in Float32. It then visits the fixed drape neighborhood in the original order, subtracting the same distance penalty and taking another Float32-stored maximum.

Finite Float32 rounding is monotone. Rounding a maximum therefore gives the maximum of the rounded values. Subtracting the same distance penalty also preserves order. Consequently, taking the maximum of separately prepared draped grids reproduces the original shared drape. The unchanged positive base height supplies the same floor and removes signed-zero tie ambiguity from the cover grids. Tests compare actual complete buffers, so this reasoning does not replace the numerical check.

The runtime cover updater retains all array identities, triangle order, border duplicates, material assignment, subdivision stencils and normal adjacency. It sums each triangle's double-precision cross product into the same vertices in the same order, applies the original `1 / Math.hypot(...)` normalization, and stores positions and normals into the existing Float32 vertex and cage arrays. It does not reconstruct `SupportSurface`, evaluate a sleeper, or run the drape neighborhood.

## Independent verification

The fixtures in `web/tests/fixtures/sleep-contact/` preserve the old pose evaluator, joint setup, interaction solver, sleeping fitter and cover builder. They use the unchanged shared math and surface evaluators. They do not import the new compiler, grid composer or cover updater. No live production source was patched to generate a reference.

The final focused command, run from `web/` with a 4 GiB heap and one worker, was:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
$env:SLEEP_CONTACT_EVIDENCE='1'
npm test -- --maxWorkers=1 tests/character-sleep-contact.test.ts tests/character-sleep-cover-outline.test.ts
```

Result: **PASS, 81 tests, exit code 0, 76.79 seconds**. [Raw log](focused.log); [all 64 body-corner records](exact-corners.json).

1. Both presentations and all 32 body corners produce exact old fitted matrices and exact full cover buffers for both clips and all three slots.
2. Eleven head/style profiles in both presentations cover every hairstyle, baldness, beard, glasses, garments, shoes, and extreme face controls. Their complete matrices and covers also match.
3. Six integer/fractional phases per clip reproduce the same authored static pose. Artifact sampling is checked with the synchronous fitter forbidden.
4. Mixed sleepers, reversed occupant order, removal, empty covers and reentry preserve every vertex, cage, index, stencil and normal-adjacency byte. The updater retains the original array objects.
5. Thirty-two synthetic cases exercise support heights near Float32 boundaries and both grid sizes. Separately prepared drapes match the old shared calculation exactly.
6. Identity and protocol tests cover geometric invalidation, uniform-only reuse, stale source keys, missing fields, sparse arrays, nonfinite and non-Float32 payloads, wrong slot offsets, stale selected parts, and rejection of an animated sleep source.

The first smoke run hit the unchanged 30-second test deadline while Vitest recursively compared large byte arrays. [That failure is retained](smoke.log). The assertion was changed to native `Buffer.equals`, which compares the same complete bytes exactly; cases and deadlines were unchanged. [The repeated smoke run passed](smoke-02.log), then the full matrix passed.

Compilation of both poses and all three grids took 273.8063 ms median, 356.8962 ms p95 and 389.4358 ms maximum across the 64 recorded cases in Node. Source loading and metadata hashing are outside that measurement. These are preparation costs, not rendering costs or desktop frame evidence.

The first shared typecheck ran during the integration edits and returned exit code 2. [Its log](typecheck.log) records one test-only readonly assertion in this change, which was corrected, plus admission/proof types still being migrated by the integration owner. A later shared typecheck is required before claiming repository-wide type safety. [Source and fixture hashes](source-hashes.json) identify this pure implementation.

The integration layer owns the single-worker queue, owner leases, admission, graphics resources and recovery. Exact browser attachments, first bed entry, occupancy changes and the 16.6 ms desktop target require the coordinated runtime checks. These CPU results do not claim that the earlier unexplained release-frame burst was caused by sleeping.

## Chrome worker argument-limit correction

The first combined-preparation browser run failed during startup with `Maximum call stack size exceeded`. The [preserved worker stack](worker-stack-01/report.json) identifies the first `Math.max(...points)` call in the `SupportSurface` constructor, reached through the sleeping cover compiler. The neutral masculine prepared body union contains 74,748 vertices; its largest individual part has 16,947. Node's successful matrix run did not establish that this many function arguments would fit the actual Chrome worker's stack.

The correction replaces only the five unbounded extrema spreads with a scalar pass. Each step still calls `Math.min` or `Math.max`, preserving their signed-zero, NaN and infinity behavior. Empty inventories retain the same infinite extrema; sparse outer-array entries retain the old NaN result. Triangle preparation, bucket order, barycentric arithmetic, division and query tolerances are unchanged.

Focused command:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
npm test -- --maxWorkers=1 tests/character-support-surface-extrema.test.ts tests/character-sleep-contact.test.ts -t 'extrema|million-point|unused point|curl|rounding|keys every|rejects malformed'
```

Result: **PASS, 7 tests, 75 intentionally unselected, exit code 0, 2.64 seconds**. [Raw log](worker-extrema-fix.log). A million-point inventory reproduces the old constructor's `RangeError`; the corrected constructor returns the exact expected extrema. Additional tests compare old/new empty, finite, nonfinite, sparse and signed-zero results, and preserve triangle query results with 150,000 irrelevant vertices. Actual sleeping geometry smoke checks also pass.

The test lane was returned to the integration owner for real Chrome worker and startup verification. The prior 81-test matrix remains recorded above; it preceded this scalar extrema correction. [Correction hashes](worker-extrema-fix-hashes.json) retain the changed constructor and focused regression source separately from the preceding source receipt.
