# Windows, walls and floors: local verification

The implementation is local on `twcx/windows-walls-floors`. The owner approved the nine concepts and candidate08 wall/floor checkpoint. Final combined game acceptance, push, merge and publication remain separate. No owner household was used as a fixture.

## Final serial checks

Commands run from the repository root, one heavy process at a time. Every next command waits for the preceding process's actual exit. Full command logs are retained locally under `.superpowers/sdd/2026-10-01-windows-walls-floors/task10-*.log`; the exact commands and results below are the portable record.

| Command | Result | Relevant output | Exit |
| --- | --- | --- | --- |
| `python -B -m unittest discover -s assets/models/architecture -p 'test_*.py'` | PASS | 16 tests, 0.432s | 0 |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | PASS | 140 tests, 22.779s | 0 |
| `python -B assets/sprites/gen/build.py --check` | PASS | 472 architecture records after 1700 historical records; 1700-sprite atlas, 8192x5658, up to date | 0 |
| `cargo fmt --all -- --check` | FAIL, then PASS | Initial failure required only moving `pub mod windows` after private `save_before_voice`; exact rustfmt ordering applied and rechecked | 1, then 0 |
| `cargo clippy --workspace --all-targets -j 1 -- -D warnings` | PASS | Finished dev profile in 1m 24s; no warnings | 0 |
| `cargo test --workspace -j 1` | PASS | 1315 tests: core 117, data 269, integration 1, sim 772, wasm 156; 0 failed/ignored; doc tests also pass | 0 |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS | Release compile 23.46s; package ready in 30.61s. Optional Cargo description/repository/license metadata advisory | 0 |
| `npm --prefix web test -- --maxWorkers=1` | FAIL, then PASS | Initial 130/131 files, 1848/1849 tests passed; stale fixed-grid assertion corrected. Final 131 files / 1849 tests pass in 28.30s | 1, then 0 |
| `npm --prefix web run typecheck` | PASS | `tsc --noEmit`, no diagnostics | 0 |
| `npm --prefix web run build` | PASS | 101 modules; 159ms; JS 701.84 kB / 128.75 kB gzip; WASM 2361.63 kB / 753.58 kB gzip. Existing 500 kB chunk advisory | 0 |
| `python check-doc-ids.py` | PASS | Documentation ids are unique and allocation-free | 0 |
| `node --test scripts/build-changelog.test.mjs` | PASS | 7 tests, 0 failures/skips | 0 |
| `node scripts/build-changelog.mjs` | PASS | Built `web/dist/changelog/index.html` | 0 |
| `git diff --check` | PASS | No whitespace errors | 0 |

The Python and generator checks preceded the Rust-only ordering correction; that correction changes no Python or asset input. The full Rust/web suites run after it. Passing suites are not repeated without a new relevant change or unresolved concern. The failed web run was repeated once after correcting its stale fixed-column assertion to require wrapping and shrinkable Build tabs; the final full suite passes. Before that repeat, `npm --prefix web test -- --maxWorkers=1 tests/room-tool.test.ts tests/window-tool-controls.test.ts` passed 34 tests in two files, exit 0. The correction changes only the test; Task 8 already supplies actual enlarged-text browser evidence.

Benchmark preparation (`python -B web/proofs/prepare-architecture-baseline.py`), `node --check web/proofs/architecture-overhead.js` and Vite's `ssrLoadModule('/proofs/architecture-overhead.js')` import smoke all passed, exit 0. The import smoke checks dependency resolution only, not GPU behavior. The temporary Vite server was closed.

## Pixel and played evidence

1. `runtime/task6-gpu-candidate06.json`, `runtime/task6-gpu-mutations.json` and `runtime/task6-mode-fix.json` retain paired-depth, cutaway blending, finish identity and actual shader mode checks. Earlier rejected candidates remain identifiable.
2. `floors/task7-gpu-candidate02.json` retains floor ownership, world phase and material proofs. `floors/task7-recovery-candidate04.json` retains corrected resource-load/error recovery evidence; catalogue extension fixtures are not a shipped material library.
3. `windows/task8-ui-candidate03.json` and corrected desktop/touch screenshots retain chooser, focus and measured enlarged-text evidence.
4. `daylight/task9-gpu.json` records source revision `9f70b5236bbea569d7c7a08c28ee85461cadeb1f`, proof hash, Chrome 154 on Windows, six actual GPU cases, two intended causal mutations and restored passes. Exact neutral noon, daytime transmission, sealed interior, midnight, Flat and reduced-motion checks remain distinct.
5. `final/task10-game.json` records the actual production game at revision `9f70b5236bbea569d7c7a08c28ee85461cadeb1f`: all eighteen placements (nine models, both axes), 192 painted floor tiles, full/play walls, native/wheel-zoom views, noon/dusk/midnight/Flat and replacement preview screenshots. Actual Save and confirmed Load restore hash `6703224994745180037` and all eighteen windows/192 floors after removing one of each. The screenshot names are retained in that JSON. Wheel input demonstrates fractional/enlarged views; exact camera scale was not exposed by the game bridge.
6. The same record loads `pre-front-door-schema2.hex` and `pre-yard-600.hex` in isolated contexts, then exercises fit, replace, remove, paint and Room edits through the real public simulation bridge. Actual Save/Load controls restore hashes `10881304337073309849` and `10628574750815284266`. A rejected three-unit edit leaves the first hash unchanged. These edit operations are bridge-driven; Task 8 separately verifies the chooser gestures.
7. Final played evidence used Windows Chromium 154 at 1600x1100. Task 8 additionally covers 390x844 touch and doubled text. Task-owned contexts were closed and preview PID 83400 stopped after checking command identity. Physical phones and other GPUs remain unobserved.

## Performance investigation, 2026-10-01

The investigation is complete. The authored full stress scene showed desktop render-pass p95 around 3 ms, with substantial variation between blocks. The cause remains unresolved. Splitting its opaque draw did not improve timing consistently, so no production renderer change was justified. These measurements are not a universal acceptable-cost PASS; lower-end devices remain unobserved. The 10% p95 threshold triggered investigation, not an automatic rejection cap.

`web/proofs/prepare-architecture-baseline.py` materializes thirteen exact renderer and geometry dependencies from `22ffd8b6e5f9d03191f521f908a20e1bfc02c70a`. The former benchmark's live geometry import and post-await Canvas2D capture were invalid for final comparison. The replacement verifies historical source hashes, records current render sources and copies the GPU presentation texture before yielding. Each image requires an opaque clear pixel and more than 1000 non-background pixels.

The final stress scene is a 34x34 logical lot with all nine models on both axes, 1156 interior floor tiles, all three coverings and twelve furniture/Sim rows. It is deliberately larger than the actual 20x16 played lot and is not a clone of that save. Historical geometry uses historical IDs; current geometry uses current architecture. The canvas fits the complete lot at each requested scale. Source, input and pixel hashes remain attached to each receipt.

### Initial queue-completion measurements

[Initial performance evidence](final/task10-performance.json) retains the first final measurements at commit `0ec76988`, helper SHA-256 `1af9f52653e51462e8c74e1dd8c8912f6146f5c1a0966baaba43ece36e195cad`, on Windows Chromium 154 with an NVIDIA Lovelace adapter. Each complete case has four alternating rounds of 60 warmup and 120 measured frames per renderer. These intervals combine synchronous draw execution, GPU queue completion and JavaScript promise resumption. Presentation cadence is recorded separately. IPC is not established as the cause of growth.

| Comparable scene | Canvas | Baseline pooled p95 | Current pooled p95 | Growth |
| --- | --- | --- | --- | --- |
| Historical geometry, scale 1.75 | 1176x973 | 5.380 ms | 4.700 ms | -12.6% |
| Final 34x34 stress scene, scale 1 | 2336x1648 | 5.285 ms | 6.235 ms | +18.0% |
| Final 34x34 stress scene, scale 1.75 | 4088x2884 | 6.780 ms | 7.465 ms | +10.1% |

The stress results exceeded the investigation threshold. Individual round growth ranged from -30.9% to +33.6%. Exact historical pixels match at scale 1.75; GPU validation and uncaptured-error checks pass. The zero-filled covering-look fixture used here requests an altered desaturated appearance, so these are not default authored-look measurements.

The initial historical-native phase has only observed per-round p95 summaries. A worker edited the helper's resource-label bookkeeping after declaring it frozen; Vite hot reload discarded the live raw results before extraction. Those summaries are marked incomplete, and root reloaded the helper for the complete phase-two cases. This coordination failure is not silently treated as retained raw evidence.

### Direct GPU timestamps and controlled interventions

The final proof API is documented in [architecture-overhead.md](../../../../web/proofs/architecture-overhead.md). It requests and verifies the optional WebGPU `timestamp-query` feature. Three arms share the final canvas, camera and dynamic rows: pinned renderer/historical geometry, current renderer with exactly the same historical geometry bytes, and current renderer/authored geometry. Historical-arm pixels must match exactly. Each arm receives 60 warmup and 120 sampled visible frames per block; rotating orders balance arm positions. Each bounded round is extracted immediately.

Synchronous draw CPU time, GPU render-pass elapsed time and rAF cadence are separate distributions. The proof preallocates 240 query slots, two 1920-byte query buffers and sample arrays. It resolves, copies and maps once after each measured arm block, with no per-frame fence or readback. GPU timestamps exclude pre-pass queue waiting, uploads and JavaScript resumption, but pass elapsed time may include GPU preemption or scheduling. They are not pure occupied shader time. Raw uint64 timestamps and zero-duration samples remain in the evidence. Observed 65,536 ns divisibility is descriptive, not a claim of precise timer resolution. Do not add or subtract CPU/GPU/component p95s as component contributions, or infer acceptance from approximately 60 Hz cadence.

| Receipt and profile | Rounds | GPU pass pooled p95: baseline historical / current historical / current authored |
| --- | --- | --- |
| [Initial timestamp investigation](final/task10-gpu-timing.json), altered zero-look, scale 1 | 6 per arm | 0.131072 / 0.131072 / 3.145728 ms |
| Same receipt, altered zero-look, scale 1.75 | 6 per arm | 3.604480 / 3.473408 / 3.604480 ms |
| [Shipped appearance](final/task10-authored-timing.json), scale 1 | 6 per arm | 0.131072 / 0.131072 / 3.080192 ms |
| [Component selection](final/task10-component-timing.json), floors, scale 1 | 3 per arm | 0.131072 / 0.131072 / 0.196608 ms |
| Same receipt, walls, scale 1 | 3 per arm | 0.065536 / 0.065536 / 0.196608 ms |
| Same receipt, complete scene recheck, scale 1 | 3 per arm | 0.131072 / 0.131072 / 3.145728 ms |

The corrected `shipped-content` appearance is parsed from `content/lot.toml`, source SHA-256 `24dd17ab87a3dc08b29be17ed512af34889b3adca3677b1cf16b59dd2bd759b4`; fixture SHA-256 is `fdfe40221a04e1b11c456b57108865bb6f59ec502500240bcfe742822813bbe2`. Both geometry producers receive the same Float32 triples. Configuration requires all 1156 authored floor rows to encode exactly zero colourway shifts. The earlier zero-look profile remains explicitly available as altered-look evidence. The authored native CPU draw p95 was 0.530 ms, separate from the 3.080192 ms GPU pass p95. One authored block was much lower than the others, and historical blocks included quantized zeros; pooled values do not erase that variation.

Component selection uses each producer's actual floor-count prefix. Floors keeps 1156 opaque floor rows and no short walls; walls keeps 69 historical or 100 authored opaque wall rows and 154 or 136 short-wall rows. Every selection retains the same twelve dynamic rows and full canvas/camera. Appearance identity is checked before filtering. The complete-scene recheck followed the selected workloads in the same context and reproduced the higher authored pass p95. The selected workloads do not identify an individual shader instruction cost or establish additive component timing.

[Final batching intervention](final/task10-split-timing.json), commit `07aef230e363d72eda1c82a887a8ba870ffb3b86`, changes only the proof's current/authored opaque draw: one range of 1268 instances becomes 1156 floors followed by the remaining 112 instances. Pipeline, bindings, pass, submission, row order and short-wall draw are unchanged. Every configuration proves exact combined/split pixel equality, unchanged input bytes and two versus three draws. The same-context sequence was combined0, split0, split1, combined1, combined2, split2; each mode occupies all three arm positions and the middle pair reverses treatment order. Temporal drift remains possible.

| Current authored batching | Per-round GPU pass p95 | Pooled GPU pass p95 |
| --- | --- | --- |
| Combined | 3.407872, 0.065536, 2.424832 ms | 3.211264 ms |
| Split floors | 2.490368, 2.752512, 3.801088 ms | 3.473408 ms |

The split did not reproduce the selected-component workloads' low cost consistently. Attribution experiments stopped after this intervention. All four timestamp receipts report GPU validation PASS and no uncaptured errors; their task-owned browser contexts were closed. The task-owned Vite server was stopped after identity verification. Validation is distinct from performance acceptance.

### Resources and proof checks

The complete combined scene uses two draws, one submit and three buffer writes per measured frame; the split proof adds one draw. No GPU buffer/texture allocation or texture upload occurs after warmup. Stress uploads decrease from 10,688 to 9,536 bytes per frame because the current short-wall batch has fewer pieces. Static/short row counts are 1225/154 historically and 1256/136 currently, with twelve dynamic rows each. The unchanged 8192x5658 RGBA atlas costs 185,401,344 unpadded bytes. Current architecture adds 23,969,792 accepted-color bytes and 11,984,896 paired-depth bytes, with no active alternate patterns/carrier and one 1x1 role placeholder. Depth attachments are `depth24plus`; receipts give physical dimensions and a lower bound, not driver storage claims.

JavaScript heap allocation and graphics-driver padding are unmeasured. Source review and existing fade tests cover retained per-frame fade buffers; they do not establish a heap-profiler measurement. Physical phones, lower-end GPUs and other GPU/browser combinations remain unobserved.

Proof-only follow-ups passed `node --check web/proofs/architecture-overhead.js`, `node --test web/proofs/architecture-benchmark-metrics.test.mjs` (7 tests), `python -B -m unittest discover -s web/proofs -p 'test_architecture_profiles.py'` (2 tests), and `python -B web/proofs/prepare-architecture-baseline.py --check-profile`, all exit 0. Vite SSR import smoke also passed and its temporary server closed. These cover timing arithmetic, balanced arm order, component selection, opaque range coverage and content-derived profile identity. No passing production suite was repeated for the proof-only changes. Final helper SHA-256 is `3b2a29d5fe1dcefdf3b089ec9b3ef25d0af5da50c5178bb1f9faf9455ae06d4f`; it remains frozen.

## Final review corrections

Back now returns from Windows to the ordinary wall controls with the exact
clicked or navigated line selected. W and D use the same transition. A doorway
occupies that selected unit and restores the rest of its window to wall; Remove
wall opens the whole span where permitted. Remove window and its Backspace/Delete
shortcuts retain their solid-wall result. Pending commands retain selection and
result ownership. A shorter replacement reconciles a selected, now-uncovered tail
to the remaining window's first line. Room refusal code 20 now asks the player
to remove the window before changing the room.

The composed controller and button tests use real WASM for all three widths on
both axes, including selection from every covered unit, exact doorway position,
ordinary removal, rear-shell refusals, queued-command guards, navigation and
shorter replacements. The checks below do not replace final browser review.

| Command | Result | Relevant output | Exit |
| --- | --- | --- | --- |
| `npm --prefix web test -- --maxWorkers=1 tests/window-tool.test.ts` | RED | 4 failures / 5 passes before implementation: nested W/D, retained selection and Room-specific reason | 1 |
| Same focused command after the initial fix | FAIL | 3 failures / 6 passes: the new tests prematurely read a wall result before drain and expected a Doorway-specific refusal in the shared wall status | 1 |
| `npm --prefix web test -- --maxWorkers=1 tests/window-tool.test.ts tests/window-tool-controls.test.ts tests/wall-tool.test.ts tests/room-tool.test.ts` | PASS | 4 files / 98 tests, 2.18s; result checks now follow the documented drain contract and refusal checks use previews and unchanged saves | 0 |
| `npm --prefix web test -- --maxWorkers=1` | FAIL, FAIL, then PASS | First two runs (31.70s and 27.38s): 1854 tests passed but Vitest also discovered a Node test file and rejected its empty Vitest suite. Final run: 131 files / 1854 tests passed, 26.97s | 1, 1, then 0 |
| `node --test web/proofs/architecture-benchmark-metrics.node-test.mjs` | FAIL, then PASS | Premature first call could not find the renamed file. After rename completion: 7 tests, 0 failures/skips, 63.78ms | 1, then 0 |
| `python check-doc-ids.py` | PASS | Documentation ids are unique and allocation-free | 0 |
| `node --test scripts/build-changelog.test.mjs` | PASS | 7 tests, 0 failures/skips | 0 |
| `node scripts/build-changelog.mjs` | PASS | Built `web/dist/changelog/index.html` | 0 |
| `python -B web/proofs/prepare-architecture-baseline.py` | PASS | Pinned renderer sources unchanged; current appearance profile regenerated | 0 |
| `python -B web/proofs/prepare-architecture-baseline.py --check-profile` | PASS | Profile matches checked-in content | 0 |
| `git diff --check` | PASS | No whitespace errors | 0 |

The Node proof tests retain their byte-identical implementation and direct Node
runner. Their filename is now `architecture-benchmark-metrics.node-test.mjs` so
Vitest does not collect them. The second failed full run began before the
search-and-rename command returned; it had already discovered the old filename.
That was a command-sequencing mistake. The final Node and web runs started only
after the preceding process had returned an actual exit code. Earlier recorded
commands retain their original filenames as historical evidence. Typecheck and
production build for this final batch remain pending with the coordinating agent.

Current documentation now distinguishes preserved historical sprite data from
the game's active floor routing: all loaded layouts use authored floor materials,
with grass for unpainted yard and asphalt for street. `content/lot.toml` changed
only in comments. A Python `tomllib` comparison against `git show HEAD:content/lot.toml`
confirmed identical parsed values. A JSON comparison of the appearance fixture
against HEAD, removing only `source.sha256` from both objects, also passed; both
assertion checks exited 0. Its source hash changed from
`24dd17ab87a3dc08b29be17ed512af34889b3adca3677b1cf16b59dd2bd759b4` to
`d74c671ed346f398f036a569ca50b591ebaf342d3fd59174576d4cbc02f05840`.
Profile values, rendering inputs and the dated timing receipts are unchanged.
No GPU benchmark, Rust check or asset-generation test was repeated for these
controller, documentation and test-discovery corrections. The approximately
3 ms authored GPU-pass result above remains unexplained; this batch makes no
performance improvement claim.

## Review and delivery boundaries

Independent final code/screenshot review and owner review remain pending. Desktop browser evidence does not establish physical phone or other GPU/browser coverage. A local production build does not establish deployment. The final build retains Vite's 500 kB chunk-size advisory (701.84 kB main JS, 128.75 kB gzip). WASM packaging recommends optional Cargo `description`, `repository` and `license` fields. Neither is a runtime failure; neither was suppressed or used to justify an unrequested dependency/build-system change. Cold-start download/parse cost remains separate from warmed frame timing.

The public source note is `docs/changelog/2026-10-01-windows-walls-floors.md`. It describes implemented behavior only. If delivery occurs on another date, update the intended-delivery filename before publication. Extra finish patterns, wall-painting controls, room-wide floor painting and looking-out interactions remain outside this change.
