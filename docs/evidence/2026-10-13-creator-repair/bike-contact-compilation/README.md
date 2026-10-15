# Required bike contact compilation

Exercise fitting now completes before a configuration enters live rendering. A single worker compiles an immutable whole-cycle contact artifact; production pose sampling requires that artifact and throws if admission was missed. The synchronous solver remains available only through the explicit CPU proof entry point.

The compiler preserves the previous candidate order, arithmetic, divisions, tolerances, support samples, body ranges, and phase-zero fit outputs. One deliberate behavior change is recorded below: the artifact always uses authored phase zero as its fitting reference. The old cache used whichever animation phase happened to draw first.

## Input and ownership

`bike-contact-input.ts` extracts the measured hip, saddle, and sole surfaces, exact configured rest/pose measurements, foot orientations, and bike dimensions. It uses a selected-parts view of the immutable source geometry; input extraction does not copy the full selected character mesh or construct a fit. `pose-joints.ts` and `contact-landmark.ts` contain the shared setup used by extraction and rendering.

The versioned protocol includes the source, fixture, and shoe revisions, contact shape and selected shoe identity, canonical source phase, and a content hash that preserves negative zero. Both sides validate finite values and complete dense arrays, including vectors, matrices, triangle indices, and optional hip cycles. Sparse arrays and missing fields fail validation.

`BikeContactService.acquire(owner, appearance)` returns a generation lease. Current live bodies, staged commands, and the newest draft hold leases; releasing them removes unowned entries. The queue contains only current owned configurations, with at most one obsolete job already in flight. A rapid A-B-A edit reuses a matching job. Acquiring a ready configuration for a new owner makes `require()` succeed synchronously, allowing staged-to-live ownership transfer before releasing the staged pin. The worker is independent of graphics-device lifetime and terminates on service disposal. Failures remain explicit; the renderer cannot start a synchronous fallback search.

## Phase dependence found and resolved explicitly

The first real quarter-phase input comparison failed. The two foot orientation matrices contain tiny authored sample differences, and fractional interpolation also changes those coefficients. All other extracted contact values were exactly invariant, including signed zero. The largest orientation coefficient difference was `2.384185791015625e-7`.

The independent frozen old fitter was then run cold at each of 32 quarter phases. The extracted compiler matched every corresponding cold fit exactly. However, 31 of those 32 old fits differed from the phase-zero result. This disproved the earlier assumption that an old fit was independent of its first sampled phase. The earlier cached-cycle comparisons did not test that assumption.

The approved contract makes authored phase zero the deterministic fitting reference. Generic motion interpolation is unchanged. Production artifacts and `configuredPoseForProof` both use this contract; only the frozen characterization fixture retains the old first-entry behavior. [cold-neutral-phases.json](cold-neutral-phases.json) preserves the counterexample. [input-neutral-02.log](input-neutral-02.log) preserves the initial failed invariant check. The preceding [input-neutral.log](input-neutral.log) records a separate test-setup error: selecting an exercise view without the exercise manifest.

## Focused verification

All commands ran from `web/` with `NODE_OPTIONS=--max-old-space-size=4096` and one worker. No deadline or comparison tolerance was increased.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm test -- --maxWorkers=1 tests/character-bike-contact-input.test.ts` | PASS, 243 tests, 55.11 s command duration | [log](input-phase-matrix.log), [measurements](input-phase-matrix.json) |
| `npm test -- --maxWorkers=1 tests/character-bike-contact-cold-phase.test.ts` | PASS, 1 test, 9.12 s | [log](cold-neutral-phases.log), [32 independent cold fits](cold-neutral-phases.json) |
| `npm test -- --maxWorkers=1 tests/character-bike-contact-service.test.ts tests/character-bike-contact-protocol.test.ts tests/character-bike-contact-compile.test.ts` | PASS, 95 tests, 57.43 s | [log](compiler-service-protocol.log), [64 compiled cycles](compiled-cycles.json) |
| `npm test -- --maxWorkers=1 tests/character-bike-contact-phase-impact.test.ts` | PASS, 1 test, 1.45 s | [log](phase-two-cpu-impact.log), [raw comparison](phase-two-cpu-impact.json) |

Each listed run returned exit code 0. Set `BIKE_CONTACT_INPUT_EVIDENCE=1` to emit input, characterization, and phase-impact records; set `BIKE_CONTACT_COMPILE_EVIDENCE=1` to emit compiler records. These flags overwrite their named evidence files and are unnecessary for ordinary checks.

The input matrix covers both presentations, loafers/laceups/trainers, all 32 body corners and eight seeded interior bodies, at every authored phase and quarter phase. Including the neutral reference, it records 241 configurations and 7,712 extractions. It checks nonorientation inputs strictly and records the orientation differences separately. Sparse selected-parts input and compact selected geometry agree. Inputs ignore unrelated face, hair, and color changes.

The 64 corner compiler cases compare complete fits with an independent frozen solver bound to the frozen old `SupportSurface`, including signed zero, and compare all 16 saved cycle phases with the retained golden receipt. Production sampling is tested with synchronous fitting forbidden. Missing artifacts throw. A once-compacted `PreparedBody` uses the same artifact as the raw selected-parts input, and arbitrary first-entry and re-entry phases agree with the canonical CPU proof path.

Service tests cover owner transfer, A-B-A reuse, 100 rapid draft replacements, cancelled extraction, stale completion, worker and preparation failures, retries, wrong artifact identity, disposal, and readiness diagnostics. Protocol tests reject incomplete and sparse payloads. Production source hashes are retained in [source-hashes.json](source-hashes.json).

Input extraction alone took 3.9468 ms median, 5.4832 ms p95, and 18.2331 ms maximum in this Node run; selected-parts view construction took 0.1602 ms median. Full compilation took 91.9926 ms median, 932.1761 ms p95, and 1478.6729 ms maximum across the corner cases. These are preparation costs, excluding source loading, and are not browser frame timings. The purpose of the admission boundary is to keep that variable compilation work off the rendering thread.

## CPU bound for the recorded phase-two GPU comparison

The saved neutral exercise scene first draws authored sample 2, then samples 3, 4, and 5. Its old cache therefore binds the fit to phase 2; the new artifact binds it to phase 0. The four scenes cannot honestly be described as exact old/new parity.

The independent CPU diagnostic regenerated the phase-zero and phase-two fits using the frozen old solver, checked them against the retained cold records, and preserved negative zero in [old-phase-two-fit-signed.json](old-phase-two-fit-signed.json). The original record used ordinary JSON and could not preserve that sign. The new export round-trips with strict equality using a reviver that maps `{ "negativeZero": true }` to `-0`.

The diagnostic then supplied only those two fits to the current pose evaluator, at samples 2, 3, 4, and 5, and evaluated the selected character's Float32 skinning and subdivision. No production source was changed. The neutral appearance is masculine, all five body values 50, loafers, and trousers. Shirt color does not enter the contact or position calculations.

| Sample | Changed vertices, of 58,861 | Largest vertex displacement, rig units |
| --- | ---: | ---: |
| 2 | 6,976 | `2.421152116249788e-7` |
| 3 | 8,403 | `1.8907453925087333e-7` |
| 4 | 9,703 | `2.1103037950796704e-7` |
| 5 | 7,622 | `1.9082797281243946e-7` |

Changed bone matrices belong only to thighs, shins, and feet. The largest matrix-coefficient difference is `2.384185791015625e-7`. Changed selected parts are shoe soles, shoes, apron stitches, trouser legs, and hems. Hip position, pelvis rotation, pitch, and the 28 support samples are exactly equal; reach margin differs by `2.78339451487142e-9` rig units.

Applying the documented isometric projection to those measured vertex differences gives at most `3.814697265625e-6` horizontal and `9.392915286523759e-6` vertical pixels at scale 1, across four facings. This is a mathematical projection of the CPU surface delta before outline extrusion and GPU arithmetic. It does not bound rasterized depth, reconstructed normals, edge coverage, or displayed color differences. Those require the separate raw GPU comparison and causal fit-injection control in [prepared-parity](../prepared-parity/README.md).

The signed export is an isolated diagnostic input, not a replacement production artifact or an acceptance baseline. The [causal GPU control](../prepared-parity/contact-phase2-causal/receipt.json) passed: replacing only the fit before scene load restored every old color, surface, physical-identity, and annotation attachment exactly in all four scenes. Restoring the original service method and reloading the last scene restored every canonical attachment exactly. The receipt records the consumed diagnostic calls, restoration, and unchanged production source hashes.

The separate [raw old-versus-canonical comparison](../prepared-parity/contact-phase-delta.json) still records real attachment differences. The four scenes change 11, 3, 13, and 19 surface samples, with maximum absolute difference `7.152557373046875e-7`; all changed surface samples belong to the exercising character, token 37. The last two scenes change two and one color samples, respectively, by at most `0.0001220703125`. Physical and annotation identity remain exact. All four displayed PNGs are pixel-identical. Causal restoration establishes that the reference-phase change explains these measured differences; pixel-identical screenshots do not erase the raw attachment differences.
