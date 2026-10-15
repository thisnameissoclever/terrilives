# Accepted chair fit and completed proof verification

Date: 2026-10-12. Local branch `twcx/character-appearance-proof`, based on `622a0c4b` with the source hashes in `implementation-hashes.json`. No production save, accepted model, production sprite or dependency was changed. The work remains local and unpublished.

## Acceptance and all four facings

The owner accepted all three demonstrated intersection levels: thighs inside the cushion, shirt against the arms and shirt against the back cushion. [acceptance.json](acceptance.json) ties that decision to the measured surfaces and screenshots. Raw geometric diagnostics remain intact; visual approval does not assert that the meshes are disjoint.

Independent visual review covered 72 seated views: both presentations, the complete height/build grid and all four facings. It found no additional visible clipping, scalp holes, detached hair, broken limb connections or conspicuous clothing tears. Final captures match all 216 earlier appearance images, including the 72 reviewed seated views, byte-for-byte in every RGB channel; see `visual-equivalence.json`.

1. [Shortest/widest, all facings](../four-facings/height-0-build-100.png).
2. [Neutral height/widest, all facings](../four-facings/height-50-build-100.png).
3. [Feminine simulation reading frame](simulation/feminine-read-0-00.png), with all four facings recorded in `simulation/result.json`.
4. [Masculine simulation reading frame](simulation/masculine-read-0-00.png), with the same four-facing coverage.

Both presentations consume the same animation data and pose code. The captures show different configured models using that shared implementation. Review animation loops are excluded from publication.

## Simulation and verification corrections

The manual preview originally reused the fixed-step driver but invented its own movement. It also used four ticks per reading frame where the game's authored cadence requires twelve. The proof now has distinct manual, simulation-walking and simulation-reading studies. Real simulation positions, previous positions, facing, identity and ticks drive the latter two through the shared signed-distance sampling rule. Manual reading also uses the correct cadence.

Reading owns a fresh authored household with an existing book and a legally placed armchair. Setup checks both command acceptance and the drained result. Walking uses the existing supported isolated movement fixture. Neither study loads a player's save or changes the unchanged-state simulation used to check appearance randomization. All owned simulation handles are freed.

`simulation/result.json` records 16 real studies and 936 sampled frames. Both presentations walk and read in all four directions. The reading samples cover complete animation cycles. Pause preserves state; randomization and undo preserve both paused simulation hashes. Tests compare 30/60 Hz presentation, actual simulation positions, reading cadence and fractional play followed by explicit stepping and resume. Selection reports the posed hip position, and benchmarking after a reading study keeps its six actors in view and restores the prior world image exactly.

The screenshot sweep now rejects incomplete coverage and caught capture failures before reporting success. Outline submission combines adjacent authored spans, reducing 56 draws to seven per character. It preserves exact triangle coverage on both original/runtime assets and produced 24 byte-identical GPU color comparisons across presentation, action and facing. This is a reduction in draw calls, not a claim of measured speed improvement.

## Final desktop measurement

Chrome uses the NVIDIA Lovelace adapter on the recorded RTX 4090 desktop with i7-13700KF and 64 GB of memory. The final workload draws six world characters and an enlarged seated preview, after the simulation/camera/cadence corrections. World canvas: 960 x 640; creator canvas: 608 x 800.

| Measurement | Final observation |
| --- | --- |
| Samples / duration | 3601 / 60.01 seconds |
| Render work median / 95th percentile / maximum | 7.750 / 9.815 / 12.340 ms |
| Samples above 16.6 ms | 0 |
| CPU submission, 95th percentile | 0.875 ms |
| Graphics completion wait, 95th percentile | 9.210 ms |
| Frame interval, 95th percentile | 16.730 ms |
| Character GPU buffers | 125,093,584 bytes |
| Dynamic textures, estimated | 16,039,936 bytes |
| JavaScript heap, whole page | 944,383,671 bytes |

Render-work timing includes CPU submission and waiting for submitted graphics work. Completion wait includes graphics processing and browser scheduling; it is not an isolated GPU timestamp. All sampled render work met the desktop target in this final run. The earlier runs and their outliers remain in the evidence; this observation does not promise future maximum latency. Phone performance and physical driver-memory reclamation remain unmeasured.

`submission-profile.json` contains sequential individual/combined-outline runs. Their 95th-percentile work times were approximately 9.965 and 10.060 ms. Different host/cache conditions prevent attributing that difference to the draw grouping. No repeat was used to select a preferred comparison result. The final run above was required by the later simulation and camera changes.

## Checks

| Command or check | Result |
| --- | --- |
| `node --test assets/models/sims/appearance-proof/test_capture_contract.cjs` | PASS, two tests, exit 0 |
| `npm --prefix web test -- --maxWorkers=1 character-simulation.test.ts sim-animation.test.ts frame.test.ts` | PASS, 116 tests at the integration checkpoint, exit 0 |
| `npm --prefix web test -- --maxWorkers=1 character-simulation.test.ts sim-animation.test.ts character-draw-ranges.test.ts` | PASS, final 12 tests including the added step/resume regression, exit 0 |
| `npm --prefix web run typecheck` | PASS, exit 0 |
| `npm --prefix web run build` | PASS, exit 0; existing large-chunk warning |
| `verify_simulation_studies.cjs` | PASS, 16 studies, camera restoration and final error checks, exit 0 |
| `verify-browser.cjs --output=docs/evidence/2026-10-12-character-appearance/accepted-followthrough` | PASS, 216 captures, no clipping/errors, depth/color/persistence checks, exit 0 |
| Five follow-through mutations | Each intended defect rejected, exact bytes restored; passing checks followed restoration |
| Protected source hash check | PASS, all 1,504 files unchanged |
| `git diff --check` | PASS, exit 0 |

The earlier full suite had 2,245 passing tests and one existing fixture-comparison timeout. Its unchanged isolated case passed. That full run is still recorded as a failure; these focused checks are not relabeled as a new full-suite pass. No deadline or assertion was relaxed.

Independent technical review findings were fixed and verified: failed-capture propagation, actual simulation sampling, valid reading fixtures, explicit-step timing, person position, benchmark visibility/restoration and final error assertions. No known blocker remains within the approved proof scope. [The full creator plan](../../../superpowers/plans/2026-10-12-full-character-creator.md) preserves the accepted chair fit and all prior creator requirements. It does not claim that the full creator has been implemented.
