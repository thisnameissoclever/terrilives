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

## Performance protocol

`web/proofs/prepare-architecture-baseline.py` materializes thirteen exact renderer and geometry dependencies from `22ffd8b6e5f9d03191f521f908a20e1bfc02c70a`. The former benchmark's live geometry import and post-await Canvas2D capture were invalid for final comparison. `createArchitectureBenchmark()` now verifies historical source hashes, records current render sources and copies the GPU presentation texture before yielding. Each image requires an opaque clear pixel and more than 1000 non-background pixels.

The historical case feeds identical pinned geometry to both renderers and requires exact pixel equality. The final stress case gives each revision the same 34x34 logical lot with all nine models on both axes, all three coverings and twelve furniture/Sim rows. Historical geometry uses historical IDs; current geometry uses current architecture. That case contains 1156 interior floor tiles, measures total feature cost and does not require equal pixels. It is deliberately larger than the actual 20x16 played lot and is not a clone of that save. The canvas fits the complete lot at the requested scale, and each result records its dimensions and input hashes.

Each visible animation-frame sample measures draw submission through GPU queue completion; presentation cadence is recorded separately. Equal warmup precedes alternating renderer order. The record contains raw samples, p50/p95, upload/draw counts and GPU allocation counts. Compare repeated rounds before accepting cost; more than 10% p95 growth requires investigation. JavaScript heap allocation, graphics-driver padding and GPU timestamp queries are not measured. Source review and existing fade tests cover retained per-frame fade buffers; they do not establish a heap-profiler measurement.

`final/task10-performance.json` retains the first final measurements at commit `0ec76988`, helper SHA-256 `1af9f52653e51462e8c74e1dd8c8912f6146f5c1a0966baaba43ece36e195cad`, on Windows Chromium 154 with an NVIDIA Lovelace adapter. Each complete case has four alternating rounds of 60 warmup and 120 measured frames per renderer. Source hashes, input hashes, actual resource dimensions and all phase-two samples are retained.

| Comparable scene | Canvas | Baseline pooled p95 | Current pooled p95 | Growth |
| --- | --- | --- | --- | --- |
| Historical geometry, scale 1.75 | 1176x973 | 5.380 ms | 4.700 ms | -12.6% |
| Final 34x34 stress scene, scale 1 | 2336x1648 | 5.285 ms | 6.235 ms | +18.0% |
| Final 34x34 stress scene, scale 1.75 | 4088x2884 | 6.780 ms | 7.465 ms | +10.1% |

The stress results exceed the investigation threshold. Individual round growth ranges from -30.9% to +33.6%, and the queue-completion measurement includes browser queue-fence/IPC latency. Root is investigating that distinction before drawing a performance conclusion. These results are not an acceptable-cost PASS. Exact historical pixels match at scale 1.75; GPU validation and uncaptured-error checks pass.

Every measured frame uses two draws, one submit and three buffer writes; no GPU buffer/texture allocation or texture upload occurs after warmup. Stress uploads decrease from 10,688 to 9,536 bytes per frame because the current short-wall batch has fewer pieces. Static/short row counts are 1225/154 historically and 1256/136 currently, with twelve dynamic rows each. The unchanged 8192x5658 RGBA atlas costs 185,401,344 unpadded bytes. Current architecture adds 23,969,792 accepted-color bytes and 11,984,896 paired-depth bytes, with no active alternate patterns/carrier and one 1x1 role placeholder. Depth attachments are `depth24plus`; case records give physical dimensions and a lower bound, not driver storage claims.

The initial historical-native phase has only observed per-round p95 summaries. A worker edited the helper's resource-label bookkeeping after declaring it frozen; Vite hot reload discarded the live raw results before extraction. Those summaries are marked incomplete, and root reloaded the helper for the complete phase-two cases. This coordination failure is not silently treated as retained raw evidence. Do not infer acceptable performance from the earlier small-scene Task 1 result, a refresh-limited cadence, or a successful helper import.

## Review and delivery boundaries

Independent final code/screenshot review and owner review remain pending. Desktop browser evidence does not establish physical phone or other GPU/browser coverage. A local production build does not establish deployment. The final build retains Vite's 500 kB chunk-size advisory (701.84 kB main JS, 128.75 kB gzip). WASM packaging recommends optional Cargo `description`, `repository` and `license` fields. Neither is a runtime failure; neither was suppressed or used to justify an unrequested dependency/build-system change. Cold-start download/parse cost remains separate from warmed frame timing.

The public source note is `docs/changelog/2026-10-01-windows-walls-floors.md`. It describes implemented behavior only. If delivery occurs on another date, update the intended-delivery filename before publication. Extra finish patterns, wall-painting controls, room-wide floor painting and looking-out interactions remain outside this change.
