# Character appearance proof follow-through

Date: 2026-10-12. Worktree: `D:/VIBES/.worktrees/5637/terrilives`. Branch: `twcx/character-appearance-proof`, based on `622a0c4b`, with local proof changes. This is development evidence, not a release receipt.

## Result

The [accepted-fit follow-through](accepted-followthrough/report.md) contains the latest simulation-driven studies, four-facing review, corrected capture checks and final desktop measurement. This page retains the earlier measurement run and its source evidence.

The remaining proof implementation and verification are complete, and the [full creator implementation plan](../../superpowers/plans/2026-10-12-full-character-creator.md) is prepared. The owner accepted the seated positioning and directed continued work using adversarial feedback. That placement is preserved.

The bob has been rebuilt with a skull cap, side part, swept fringe and seven tapered locks. Continuous walking, explicit sit-down/stand-up studies, world-visible selection and resource cleanup now have direct checks. Invalid saved drafts show an error and retain their bytes until the user explicitly starts a new draft.

**The owner accepted the demonstrated cushion and arm intersections after reviewing the paired browser screenshots and mesh sections.** The raw zero-intersection result remains unchanged, but those reviewed overlaps are no longer unresolved defects. The owner also required all four facings; independent visual review of all 72 seated configuration views found no additional visible blocker. The [acceptance record](accepted-followthrough/acceptance.json) ties the decision to the evidence. No body or fixture was shrunk, and no slider range was silently reduced.

## Actual renders

1. [Hair comparison](hair-comparison.png): previous and improved runtime hair, using real browser captures.
2. [Feminine reading frame](feminine-read-00.png), with sampled motion recorded in `motion-browser.json`.
3. [Masculine reading frame](masculine-read-00.png): the same configured-rig path.
4. [Standing range](actual-idle-range.png) and [seated range](actual-read-range.png): both presentations at minimum, neutral and maximum height/build.
5. [Interface](proof-interface.png), [game-size reading view](world-reading.png) and [foreground-wall view](world-wall.png).

Original PNGs are retained; they are the authoritative pixels for the endpoint comparisons. Review animation loops are excluded from publication. Both presentations' sit-down endpoints exactly match the seated-reading frame, and their standing endpoints exactly match the corresponding stand-up endpoint.

The adversarial visual review found a coherent improvement, with no visible floating locks or scalp holes in the four facing captures. It identified a slightly raised crown intersection as optional polish. This is recorded reviewer feedback, not a claim that the owner personally approved the new hair.

## Motion, picking and lifecycle

`motion-browser.json` records 3,096 sampled frames: 18 presentation/height/build configurations, four facings, continuous walk/read samples, the standing-reading endpoint, and both transitions. Every sampled frame remains inside the render target. GPU surface reads also agree with the independent CPU evaluation at the tested transition poses.

The motion tests use the same anatomical-height measurement as the renderer. They check actual shoe vertices during planted intervals, connected limb endpoints, configured limb lengths, both wrist-to-book targets, and exact transition joins. Transition time clamps at the endpoint instead of wrapping. Selecting a study does not claim to implement gameplay approach/navigation; that integration belongs to the full creator plan.

World picking uses the final scene depth. Among the sampled visible actor/fixture pixels, the foreground wall hides 81 actor samples and leaves 57 actor samples visible; 88 fixture samples retain separate ownership. Displayed person position comes from the actor's posed hip location, not the chair anchor.

Eight create/render/destroy cycles cover the renderer, compositor, world picker and transient readback buffers. All 152 tracked buffers/textures receive their destruction call, leaving zero tracked resources. This checks ownership and API cleanup, not the graphics driver's eventual physical-memory reclamation. The page also destroys its owned device and unconfigures both canvases on departure.

A root-coordinate mistake was caught during visual inspection: the first standing endpoint moved downward rather than forward. An independent standing-height/position test now guards that meaning, in addition to internal endpoint agreement. Rejected captures are retained under `rejected-local-root/` and are excluded from passing evidence.

## Appearance, storage and source preservation

The standard browser sweep contains 216 standing/walking/reading captures without clipping failures. The source deformation order remains configured cage → skinning → subdivision → surface normals. Original Blender operator comparisons remain within the established tolerance. Both presentation presets and their continuous ranges use actual geometry.

The browser checks field locks, global randomization, undo, exact reload, restored random-generator state, per-region source colors and unchanged simulation state. Recoloring skin changes 7,572 skin pixels and zero unrelated pixels in the diagnostic scene. The independent depth partition has zero mismatches.

`invalid-storage-browser.json` verifies empty and unsupported-version records. Neither displays a substitute character or overwrites the invalid bytes. Explicit **New random draft** recovery works, including from the source comparison URL: recovery removes `baseline`, preserves unrelated query parameters and starts without source-material overrides. Storage validation occurs before GPU allocation. Unit tests also verify that loading a saved record, including an invalid one, makes no new seed draw.

The stricter storage bootstrap was added after the broad captures. `bootstrap-followup.json` verifies that the captured rendering, controls and benchmark bodies were byte-identical at that storage-validation checkpoint; `bootstrap-before-validation.ts` retains that source snapshot. The new loader and recovery behavior have their own unit, mutation and browser checks, followed by the normal quick browser checks.

`source-preservation.json` verifies all 1,504 protected model/source/sprite files unchanged. No accepted character file, production atlas, real game save, dependency version or host configuration was modified.

## Furniture findings

`contacts.json` retains 72 complete seated-surface witnesses and hashes their evaluated source and asset inputs. The scope is fixed-fixture clearance, finite hip support, the accepted source sole registration and hand/book proximity. Back distance is diagnostic for the owner-accepted forward-leaning pose; continuous back contact is not imposed as a new requirement.

Only 32 of the 72 cases pass the combined support/no-intersection check. The largest sampled vertex penetrations are approximately 0.0483 model units into the seat, 0.0266 into an arm, and 0.0150 into the back. These are vertex samples, not proven maxima over triangle interiors. The report does not describe them as numerical contact noise.

`local-fit-constraint.json` verifies that the trouser hip bridge is entirely weighted to the hips. Changing knees, arms or spine therefore cannot remove every recorded overlap at a fixed hip transform. This does not prove universal chair capacity or infeasibility. The production plan preserves the approved chair fit and requires comparison of new bodies and interactions against that reference. It does not authorize an inward projection that simply makes a body smaller.

There is no additional requirement to build an unseen body beneath the clothed source model or certify contact pressure. Visible clothing, joints, poses and actual fixture intersections are the relevant evidence.

## Desktop measurement

Chrome 155.0.8059.39 reports the NVIDIA/Lovelace adapter on this RTX 4090 desktop. The recorded host is an Intel i7-13700KF with 64 GB of memory. The workload uses six world characters plus the enlarged seated preview, with fractional animation phases. World canvas: 960×640; preview: 608×800.

| Measurement | Result |
| --- | --- |
| Samples over approximately 60 seconds | 3,554 |
| Render work: median / 95th percentile / maximum | 7.155 / 9.280 / 154.535 ms |
| Samples above the 16.6 ms target | 11 |
| Frame interval, 95th percentile | 16.8 ms |
| Character GPU buffers | 125,093,584 bytes |
| Dynamic textures, estimated | 16,039,936 bytes |
| Reported JavaScript heap | 601,138,965 bytes, including the proof page and existing scene data |
| Unexpected browser/GPU errors | 0 |

Render-work timing includes CPU submission and waiting for the submitted GPU work. The favorable percentile is not an all-frames budget pass: the recorded stalls remain visible in `browser.json`. Physical driver-memory reclamation and phone performance remain unverified. The production plan includes sharing immutable buffers and measuring the complete game workload before expanding the catalog.

## Checks and independent review

| Command or check | Result |
| --- | --- |
| `python -B -m unittest discover -s assets/models/sims/appearance-proof -p "test_*.py" -v` | PASS, 6 tests, exit 0 |
| `npm --prefix web test -- --maxWorkers=1 character-` | PASS, 22 tests at that checkpoint, exit 0 |
| Updated `character-motion.test.ts` | PASS, 4 tests including the added grip check, exit 0 |
| `character-draft-storage.test.ts` and `character-appearance.test.ts` | PASS, 12 tests including the 2 new storage checks, exit 0 |
| `character-contact-witness.test.ts` after receipt changes | PASS, exit 0 |
| `npm --prefix web run typecheck` | PASS, exit 0 |
| `npm --prefix web run build` | PASS, exit 0; existing large-chunk warning remains |
| `npm --prefix web test -- --maxWorkers=1` | 2,245 passed, one existing fixture comparison timed out; exit 1 |
| Unchanged isolated fixture comparison under the same deadline | PASS, 2.87 ms, exit 0 |
| Browser motion/selection/cleanup and appearance sweeps | PASS, exit 0 |
| Invalid-storage error/recovery browser check | PASS, exit 0 |

The focused checks cover 25 distinct appearance tests after the follow-ups. The full-suite failure is retained in `web-tests.log`; it is not relabeled as a full-suite pass. The failed case exceeded its existing five-second deadline at 5,823 ms without a reported assertion mismatch. Lightweight host measurements showed ongoing CPU/disk activity but do not establish the cause of that stall. The subsequent direct file-read/hash/assertion profile returned matching bytes in under a millisecond; that diagnostic does not reconstruct earlier host conditions.

Ten deliberate faults were rejected: missing parameter upload, ignored locks, disabled depth contribution, discarded saved values, snapped walking phase, ignored world occlusion, leaked subdivision resources, missing forward standing placement, detached book grips and treating empty storage as missing. Each mutation restored exact source bytes. `mutations.json` and the individual failure logs retain the evidence. Relevant normal checks passed after restoration.

Independent reviews challenged the hair, motion, verification method and full creator plan. Their actionable findings were addressed: coherent hair locks; world-space root placement; actual height in motion tests; correct frame seeking; broader cleanup coverage; explicit preset transactions; override preservation; complete physical-control inventory; and exact numeric command encoding compatible with existing Rust equality semantics.

The full creator itself is not implemented by this proof. Its reviewed implementation plan preserves all previously agreed requirements, including the selected layout, personality metrics, existing-character preloading, independent randomization, locks and the 40/40/20 name pool. Publication and production integration remain outside this local proof's authorization.
