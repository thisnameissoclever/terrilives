# Character appearance proof evidence

Date: 2026-10-11. Worktree: `D:/VIBES/.worktrees/5637/terrilives`. Branch: `twcx/character-appearance-proof`, based on `622a0c4b`. This report describes an uncommitted development candidate, not a release.

## Decision

**The proof has not passed its acceptance gates.** Real, saved parameters do change the rendered character, and the browser now uses the same deformation order as the Blender source. The current seated pose does not accommodate the full proposed range without intersections. The feminine hair also needs further artwork before it approaches the approved concept direction.

Retain the full slider ranges and the failed evidence. Do not expand the full creator, claim the artwork is accepted, or publish this candidate. The failed pose does not establish that the chair cannot accommodate these bodies.

## Inspect the actual output

1. [Standing range](actual-idle-range.png): both presentations at minimum, neutral and maximum height/build. These are composed browser captures, not generated concepts.
2. [Reading range](actual-read-range.png): the same settings against the fixed chair. Some intersections are subtle from this facing; use the contact measurements rather than the image alone.
3. [Development interface](proof-interface.png), [world view](world-reading.png) and [foreground wall](world-wall.png).
4. [Blender source reference](blender-source-idle-SE.png). The `source-original-*.png` and `source-runtime-*.png` files show the unchanged original and simplified meshes in all four browser facings. They expose differences; they are not a numerical image-fidelity pass.

The current bob is a closed procedural shell. Its volume and surface detail are below the concept reference. The renderer preserves material ramp interpolation, but its lighting and outlines are not demonstrated to match Blender pixel-for-pixel. Neither the source-position tests nor the performance measurement approves those artistic differences.

## Confirmed mechanisms

1. The runtime export contains real control vertices, bone weights, rest transforms, animation and subdivision coefficients. It skins the configured control cage before evaluating subdivision, matching the source modifier order. Blender comparisons cover 20 operators and 60 sampled source poses; the largest recorded position difference is approximately 0.000002 model units. See `assets/models/sims/appearance-proof/export-v2/subdivision-parity.json`.
2. The browser reads its actual GPU vertex output and compares it with an independent CPU evaluation. This tests standing, walking and reading across the full 62,701-vertex runtime surface. It does not test Blender lighting or contact quality.
3. Height and build continuously deform the model. Height uses an anatomical reference independent of hair, preserves head size and spans 85%-115%. The compound build control retains the proposed torso, hip and limb ranges. The selected hairstyle and five material colors are independent record fields.
4. Both views use the same configured geometry and animation. Dynamic color, depth and identity are distinct textures. The source chair retains fixed geometry and dimensions; actor and fixture identities are distinct in the preview.
5. The draft stores appearance, random-generator state, locks and undo independently of the simulation. Source-material diagnostics preserve override state per region. Invalid values are rejected before changing appearance or undo history. The page uses proof-specific storage only.
6. Deliberately disabling parameter upload, lock protection, reload preservation and depth variation makes the corresponding check fail. `mutations.json` records the commands, expected rejection and exact source restoration. The first depth mutation removed a shader binding and failed for the wrong reason; the corrected mutation retained the binding and disabled only its depth contribution. Both logs are retained.
7. `source-preservation.json` verifies all 1,504 protected model/source/sprite inputs against the baseline hashes. Production sprite data and the accepted `.blend` were not regenerated or overwritten.

## Failed physical gate

`contacts.json` records 72 seated surfaces: both presentations, the nine height/build combinations, and four reading frames. Only 32 meet the limited basic-support check. The complete gate remains false.

Short configurations intersect the seat cushion. Several maximum-build configurations intersect the chair arms or back cushion. Some otherwise clear configurations have no back contact. The checker preserves the accepted support tolerances and transforms contact footprints into the chair's coordinate system.

Minimum hand-to-book distances are evidence of proximity only. They do not establish contact area or supporting direction. Likewise, the source character is a clothed shell, so independent body/garment clearance cannot be established without an underlying body surface. Complete walking-foot contact, full-cycle sliding measurements and standing/seated transitions remain unverified. World-visible picking through occluders is also unverified; the candidate exposes preview picking only.

The next seating implementation must solve hip placement, torso/back articulation, knees, feet and hand/book targets together against complete surfaces. It must preserve limb lengths, body size and furniture geometry. Repeated hip-offset adjustments are not an adequate solution. If a complete solve finds no feasible pose, preserve that evidence before asking to alter a range, chair or interaction rule.

## Measurements and verification records

`browser.json` contains the complete browser sweep, hardware adapter identity, texture and buffer allocation estimates, frame samples and error list. `browser-quick.json` contains the focused browser checks. The graphics card is an NVIDIA GeForce RTX 4090; Chrome reports NVIDIA/Lovelace. The world canvas is 960 by 640 pixels and the enlarged preview is 608 by 800 pixels.

The performance workload renders six world characters plus the enlarged seated preview. Render-work timing includes CPU submission and waiting for the submitted GPU work. Frame intervals are recorded separately. Allocation estimates cover character buffers and dynamic textures, not total driver/browser memory. This is a desktop measurement only; phone performance and complete memory recovery remain unverified.

The final run uses Chrome 155.0.8059.39 on Windows 11, an Intel i7-13700KF, 64 GB of installed memory and the RTX 4090. `hardware.json` records the host and driver details. No other task's processes were stopped to obtain the result.

| Final browser measurement | Observed |
| --- | --- |
| Captures | 216; zero clipping failures |
| Unexpected browser/GPU errors | 0 |
| Skin-color causal check | 7,572 changed skin pixels; zero unrelated changed pixels |
| Performance samples | 3,594 over approximately 60 seconds |
| Render work, median / 95th percentile / maximum | 7.75 / 9.615 / 33.61 ms |
| Samples over the 16.6 ms target | 3 |
| Frame interval, 95th percentile | 16.75 ms |
| Character GPU buffers | 121,570,288 bytes |
| Dynamic textures, estimated | 16,039,936 bytes |
| Reported JavaScript heap | 595,364,263 bytes; includes the whole proof page |

The 95th percentile is below the desktop target. The maximum is not. This result does not establish an all-frames budget or phone suitability.

`local-checks.json` and its logs record regression-test and web-build commands and exits. The focused command is `npm --prefix web test -- --maxWorkers=1 character-`; Python checks use `python -B -m unittest discover -s assets/models/sims/appearance-proof -p "test_*.py" -v`. Type checking uses `npm --prefix web run typecheck`.

| Check | Result | Exit |
| --- | --- | --- |
| `python -B -m unittest discover -s assets/models/sims/appearance-proof -p "test_*.py" -v` | PASS: 5 tests | 0 |
| `npm --prefix web test -- --maxWorkers=1 character- atlas.test.ts` | FAIL overall: all 19 appearance tests pass; 11 atlas tests pass and 3 exceed the existing five-second deadline | 1 |
| `npm --prefix web test -- --maxWorkers=1 bridge.test.ts` | PASS: 94 tests in 11 matched bridge files, using release WebAssembly | 0 |
| `npm --prefix web run typecheck` | PASS | 0 |
| `npm --prefix web run build` | PASS; existing large-chunk warning remains | 0 |
| `python -B assets/models/sims/appearance-proof/check_mutations.py` plus the corrected `depth` case | PASS: all four intended defects detected and files restored exactly | 0 for the corrected depth run; initial aggregate 1 retained |

The three atlas failures are explicit `Test timed out in 5000ms` reports, not reported assertion mismatches. Their assertions and deadlines were not changed. The complete release web suite was stopped before finishing; `web-tests-full-incomplete.log` preserves that incomplete run. There is no full-suite pass claim. These timing failures remain a regression-verification limitation even though independent protected-file hashes match.

An earlier broad run used development WebAssembly and reported four slow bridge failures before it was stopped. Its result is not counted as a release regression pass. Release verification uses `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`. An interrupted browser sweep caused by editing the running page is also excluded from acceptance evidence.

## Independent review

The technical reviewer confirmed the corrected subdivision order, persisted random state/locks and shared animation clock. Review found and prompted fixes for per-region source colors, incomplete witness invalidation, and invalid-edit undo history. The reviewer separately confirmed the physical failures and declined to judge artistic acceptance, universal chair capacity, phone performance or full creator readiness.

This remains a failed proof awaiting an owner decision about the next focused iteration. The evidence supports real configurable geometry; it does not support a promise that the approved visual polish and furniture behavior are already achieved. The complete creator requirements remain in the existing proposal, including the selected layout, personality mechanics, existing-character preload, locks, independent randomization and the 40/40/20 name pool.

All task-owned verification browsers exited through their cleanup blocks. The isolated preview server was stopped after capture. Changes remain local and uncommitted; nothing was published or released.
