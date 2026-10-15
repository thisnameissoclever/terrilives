# Annotation GPU contract checks

`node scripts/character-creator-repair/check-annotation-contracts.cjs` passed with exit code 0: twelve baseline, restoration and cleanup checks; four valid mutations detected; no uncaptured GPU errors. All seven recorded production-file SHA-256 hashes stayed unchanged.

The check runs the production sprite renderer and scene target on a disposable NVIDIA Lovelace GPU device, a 64x64 canvas, and an isolated Chrome browser context. Three existing activity-sprite crops receive synthetic bytes in the test renderer's own atlas texture. Production atlas records, shader composition, pipelines, draw ranges, resolve and picking remain in use. The receipt records the exact sprite records, input hashes, depths, positions and owner IDs.

1. A red annotation at depth 0.85 covers exactly 1,080 scene samples both with and without an opaque blue world quad at depth 0.05. Every covered color sample stays red. The expected coverage comes from the known source alpha and the fixed four-sample coverage pattern.
2. World surface depth and identity remain byte-identical before and after drawing annotations. Each checked attachment contains 65,536 bytes; the receipt includes their SHA-256 hashes.
3. Opaque annotation pixels pick person 41. An alpha-64/255 edge has annotation owners `[41,0,0,0]` and also picks person 41. Transparent padding has `[0,0,0,0]` and picks world owner 19. Uncovered scene space picks nobody.
4. Overlap owners `[83,41,41,41]` pick 83 because that annotation was drawn later. Reassigning the later annotation to the lower numbered person gives `[41,83,83,83]` and picks 41. Neither majority coverage nor numeric owner order determines the result.
5. The following frame with no annotations exposes no annotation texture for semantic picking and picks world owner 19. The next annotated frame reuses the existing texture allocation.
6. Resizing the canvas destroys the previous annotation texture exactly once and allocates a 130x128 scene texture. Renderer disposal destroys that replacement exactly once.

| Isolated mutation | Observed failure |
| --- | --- |
| Restore annotation depth testing against world geometry | Annotation owner 0 instead of 41 behind the nearer world quad |
| Draw and clear the annotation owner attachment over physical identity | Physical identity byte 8,256 becomes 0 instead of 19 |
| Write annotation owner zero in the production shader | Covered annotation picks world owner 19 instead of person 41 |
| Reverse annotation draw priority during production picking | Mixed edge picks owner 41 instead of later owner 83 |

Each valid mutation compiled, rendered without a GPU validation failure, and failed its named assertion. Every scoped method was restored. Visibility, physical attachment preservation, coverage and picking, overlap priority and next-frame behavior passed again after restoration. Browser, device and renderer cleanup ran in `finally` blocks.

`receipt.json` and `run-02.log` contain the accepted result. `run-01.log` and `rejected-mutation-receipt.json` retain the rejected first attempt: the baseline passed, but the depth-test mutation changed its pipeline while its pass hook targeted a duplicate Vite module class. The resulting GPU attachment mismatch was rejected as an invalid mutation. Binding hooks to the actual renderer scene prototype produced the valid second run. No invalid mutation was counted as a detected regression.

These checks prove annotation rendering and picking contracts with controlled source pixels. The saved-game half-bubble reproduction and player-facing visual review are separate evidence. No performance measurement was taken.
