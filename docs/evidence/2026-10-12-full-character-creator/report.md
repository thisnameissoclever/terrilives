# Full character creator: local verification

The October 13 owner review identified regressions that this verification missed: occupied fixture colors and outlines, character edge coverage, bubble placement, dish depth, and creator usability. The implementation is not visually accepted. The measurements below remain historical test receipts, but do not establish that the full creator is ready for delivery. Repairs and new transition comparisons are tracked in [the repair plan](../../superpowers/plans/2026-10-13-creator-repair.md).

Observed October 12-13, 2026 in `twcx/character-appearance-proof`, based on `622a0c4b`. This record describes uncommitted local changes. Nothing was pushed, merged, published or released. No dependencies were changed.

The full creator is implemented in the game. [Open the actual browser capture gallery](delivery/index.html), [creator interface](delivery/creator.png), [personality controls](delivery/personality.png), or [runtime contract](../../specs/2026-10-12-character-creator-runtime.md). These are captures of the implementation, not generated concept artwork.

## Implemented behavior

1. Identity, Appearance, Personality, Traits, Preferences, Household and Review share a private draft. The enlarged and game-size previews use the same configured character and renderer. Both presentations share skeleton, animation data and pose-solving code.
2. Appearance parameters change geometry, attached features and materials. Controls cover body proportions, facial features, hair, facial hair, clothing, shoes, accessories and colors. Walking and furniture interactions use configured limb lengths. The character does not shrink or revert to a neutral body during interactions.
3. New drafts randomize every supported field, including equal-probability presentation. The independent name pool contains 40 English/European names, 40 names common in the United States or Canada, and 20 less familiar pronounceable names. Global, section and field randomization respect locks. Undo restores the draft and its private random-generator state.
4. Existing characters preload their saved values. Personality, traits, conditions, needs, activity inclinations, preferences, skills and relationships connect to existing simulation mechanics. Combined activity influences show selected trait contributions multiplied by the explicit activity weight, without presenting that subtotal as a probability. The [browser check](choice-influences/report.json) verified a trait multiplier of 1.5 and activity weight of 0.5 produce approximately 0.75 while leaving simulation state unchanged.
5. Native validation finishes before mutation. Editing preserves untouched behavior and dynamic state; cancellation sends no edit. Save schema 9 stores appearance and pronouns, retains older loaders, and preserves a byte-exact schema-8 recovery backup before replacing an old primary save.

## Actual rendering and contact checks

The owner accepted the demonstrated chair intersections. That acceptance does not excuse missing facings or new contact defects. The final review covers all four facings, including rear views and rotated furniture.

The renderer now follows the source model's deformation order: configure the control mesh and rest joints, skin that mesh, evaluate subdivision, then reconstruct surface normals. Six direct comparisons between browser graphics output and reference surfaces had a maximum difference of 0.000002384 model units. See [surface comparisons](gpu/surface.json).

An independent [geometry-envelope review](envelope-review.json) evaluated 25,600 poses across both presentations and all 32 body-range corners, checking 728,708,864 control-mesh points. It found no failures. Enlarging the world render target to 384 square pixels preserved the same world pixel scale and left a conservative 22.64-pixel margin for the tested extrema. The tall fridge pose is visible in every facing.

The [final clip captures](final-clips/report.json) contain 64 views. The [actual game captures](game-activities/report.json) exercise showering, shared beds, shared sofas, cycling and rotated counters in four orientations. Shared occupants use distinct places and retain separate identities. The [bicycle motion receipt](motion/report.json) records two body configurations in all four facings using one shared animation; 256 actual frames and 32 quarter-cycle captures support its review. Review recordings are excluded from the repository.

Far-side wiping exposed a real depth defect: flat counter depth hid the hand and cloth even though their physical height was correct. Counters, kitchen sinks, stoves and dining tables now use depth exported from their pinned source geometry, registered to existing color coverage. Color and depth select the same nearest source pixel. Worktop grime uses its physical surface plane. The extra data fits into the existing supplementary texture page; production atlas files remain unchanged. The [before/after gallery](delivery/index.html) shows this repair without moving the cloth or body.

The final [registered-depth check](fixture-depth-check/report.json) passed 48 cases and 10,410 graphics readbacks. Maximum depth error was 0.000000055864 under the unchanged 0.0000002 limit. At a mathematically ambiguous pixel boundary, the reference calculation admits adjacent source owners only when propagated floating-point error crosses that boundary; it still checks coverage and depth. Independent review confirmed this treatment and reviewed all 12 final wiping captures.

## Functional verification

1. [Full browser flow](full-flow/report.json): create an extreme configured character, move in, play, save through browser storage, reload, edit, cancel and apply. [Native action roundtrips](full-flow/action-roundtrips.json) preserve walking, book fetching, reading and shelving across save/load, with matching continuation for 30 ticks per case.
2. [World checks](world/report.json): character identity picking, scene visibility and browser back/forward restoration. [Lifecycle checks](lifecycle/report.json): graphics-device loss, replacement, draft and lock preservation, keyboard focus, a 390 by 844 viewport, and at least 44-pixel visible touch controls.
3. [Resource checks](resources/report.json): five creator open/close cycles and 30 height edits. Each cancellation released all creator-owned buffers and textures. Appearance refresh took 25.34-83.44 ms in this check; changing geometry is not claimed to fit within one animation frame.
4. [Creator mutations](mutations/results.json): deliberately disabling atomic validation, edit preservation, private random state, random restoration, locks, parameter application, depth and reload preservation caused the intended checks to fail. [Two depth mutations](fixture-depth-check/mutations.json) also failed their intended checks. Sources were restored exactly and the corresponding checks passed afterward.
5. [Protected source hashes](final-checks/protected-sources-final.json): all 1,504 protected source and shipped sprite files remained unchanged. [Implementation hashes](implementation-hashes.json) identify the local implementation used for this report.

## Test receipts

Commands, exit codes and verdicts are retained in the linked receipts, with adjacent logs. Local web tests use one worker and a 4 GB Node heap. Native tests use one build job and one test thread.

The [full web run](final-checks/full-web-final.json) executed 2,355 tests in 205 files: 2,342 passed and 13 failed in nine files. Those failures referenced retired form wiring, the old save header, or old source-code boundaries. The assertions were updated to check current behavior and integration. [All nine affected files then passed their 246 tests](final-checks/full-web-corrections.json). The failed full-run receipt remains intact; this is not described as a second passing full-suite invocation.

The earlier [focused checks](final-checks/checks.json) passed 410 web tests, six Python tests, seven native creator tests and three native save tests. Renderer follow-through covered 159 tests across the [initial run](final-checks/depth-followthrough.json) and [corrected floor-source boundary check](final-checks/corrective-checks.json). No deadline or numeric acceptance tolerance was weakened.

The final [delivery checks](final-checks/delivery-checks.json) passed 69 creator tests, including the two new combined-influence cases; TypeScript checking; the web build; actual delivery captures; and browser lifecycle verification. The earlier worker compatibility checks include real native-produced save bytes and an immutable schema-8 worker fixture.

## Desktop performance

Measured on an Intel Core i7-13700KF with an NVIDIA RTX 4090, 64 GB installed memory, and Chrome 155.0.8059.39. The viewport was 2300 by 1200. The scene included six world characters, an animated 608 by 800 reading preview and a 96 by 128 sample. See [hardware](hardware.json).

| Measurement | 60-second paused-world sample | 15-second advancing-world sample |
| --- | ---: | ---: |
| Samples | 3,601 | 894 |
| CPU submission, 95th percentile | 1.220 ms | 1.520 ms |
| Submission plus graphics completion, 95th percentile | 8.025 ms | 10.120 ms |
| Preview, 95th percentile | 8.160 ms | 9.645 ms |
| Maximum graphics completion | 18.685 ms | 70.295 ms |
| Completion samples above 16.6 ms | 1 | 20 |

The advancing run moved native simulation ticks from 130 to 205 at five ticks per second and submitted six actors throughout. The [60-second receipt](performance/game-60000.json) and [advancing receipt](performance/game-15000-moving.json) retain the raw summaries. These completion timings include submission and waiting for graphics work; they are not isolated graphics-processor timestamp measurements. No other task-owned heavy check ran during measurement.

The measured 95th-percentile desktop target passes. Occasional slower frames remain, including the 70.295 ms maximum in the advancing run. This bounded sample does not establish all-day performance or every possible household.

World buffers occupied 96,019,040 bytes and dynamic textures an estimated 14,155,776 bytes. The [preview allocation check](performance/preview-allocation.json) adds 19,451,184 buffer bytes and an estimated 7,979,008 texture bytes. Combined totals are 115,470,224 buffer bytes and 22,134,784 dynamic texture bytes across 32 textures. JavaScript heap observations were about 1.45 GB and 1.64 GB respectively; WebAssembly memory was 2,293,760 bytes in the longer sample. Physical graphics-driver memory reclamation was not measured.

## Review boundary

Independent technical and adversarial visual reviews examined parameter application, source motion, contact targets, source-preserving depth registration, shared furniture, save compatibility, randomization, lifecycle behavior and the actual captures. Their actionable findings were repaired and checked. Both preview sizes receive matching facing values; [the recorded facing pairs](delivery/facing-sync.json) and [enlarged actual rear-view thumbnail](delivery/game-size-back-right-detail.png) make the small preview inspectable.

The final direction probe was corrected after review found its earlier log was empty. It now observes the application's loaded module, retains surrounding world draws separately, and requires exactly one ordered preview pair per turn. Each pair must match that turn's expected angle and its 32-bit stored graphics value. All four cases passed in the [corrected probe receipt](final-checks/facing-probe-check.json). The visual reviewer independently closed the earlier thumbnail-facing concern after inspecting its enlarged pixels.

Phone performance remains unmeasured. The desktop timing outliers and appearance-refresh costs above describe the inspected implementation. The subsequent owner review disproved its visual-readiness conclusion. Repair acceptance requires new whole-game transition comparisons and creator interaction checks; publication and release remain outside this authorization.
