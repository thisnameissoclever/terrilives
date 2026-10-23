# Bounded Atlas Storage Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the isolated producer and runtime tasks. Do not run multiple implementers at once. Obtain task review and final independent code and visual review. The owner has explicitly delegated implementation choices and declined further questions.

**Goal:** Reduce startup artwork allocation while preserving every source pixel and all gameplay.

**Architecture:** Pack repeated and empty bordered image blocks into an immutable physical atlas, retaining logical coordinates through a lookup buffer. Export CPU coverage from original pixels. Keep shader filtering, renderer ownership and failure cleanup explicit.

**Tech Stack:** Existing Python, Pillow, NumPy, gzip, TypeScript, WebGPU, Vitest and local installed Chrome. Add no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-ios-atlas-storage-design.md`.

## Global constraints

1. Preserve exact RGBA pixels, logical indices, sampling, image density, scene resolution, saves, models and gameplay.
2. Logical pages are 2048 square; blocks are eight square with one-pixel borders; physical cells are ten square, 204 per row.
3. Lookup zero means transparent; N maps to physical slot N minus one. Raw lookup starts with `ATL1`; raw coverage starts with `ACV1`.
4. Current texture plus lookup storage must remain below 384 MiB. Controlled startup graphics allocation uses a one-GiB budget without claiming physical iOS reproduction.
5. No hosted tests, dependency or toolchain changes. Keep automatic deployment operational for relevant inputs. Preserve other worktrees and processes.

## Review focus

1. Empty blocks adjacent to visible content must retain their border samples.
2. Fractional sampling at tile seams and virtual edges must preserve color, depth and picking.
3. Invalid or incomplete files must not allocate excessive GPU memory or install partial masks.
4. Failed uploads and constructor failures must release all owned resources while retaining awaited bitmap lifetime.
5. Resizing, graphics recovery and floor-material changes must bind the same logical atlas correctly.

## Task 1: Derived assets and complete pixel reconstruction

**Owner:** Producer worker. Own `scripts/runtime_atlas.py`, `scripts/build-runtime-atlas.py`, `scripts/test_runtime_atlas.py`, generated `web/src/render/atlas-storage-metadata.ts`, and `web/public/atlas-storage/`.

**Produces:** `ATLAS_STORAGE` generated constant with `version`, `virtualSize`, `virtualLayers`, `tileSize`, `border`, `physicalSize`, `tilesPerRow`, `uniqueTiles`, `originalAtlasPages`, `companions`, `pages`, `lookup`, and `coverage`. Page records contain `file` and PNG `sha256`. Binary records contain `file`, unpacked `length` and unpacked `sha256`. Coverage also contains the `bodies`, `dishes`, and `indicators` records specified in the design. Companion records retain folder, path, width, height and sha256 in virtual-layer order.

- [ ] Write failing small-image codec tests for exact reconstruction, duplicate blocks, colored transparent pixels, halo-only content, edge clamping and corrupt mappings.
- [ ] Implement the producer and CLI `python -B scripts/build-runtime-atlas.py` and `--check`.
- [ ] Build actual resources and prove every virtual pixel and bordered block matches its source. Verify packed CPU masks against original alpha values.
- [ ] Keep generation bounded, retain original assets, and make check mode read only. Do not create a fake manifest or skip regeneration failures.
- [ ] Run focused tests, self-review and report the generated schema and source hashes for task review.

## Task 2: Runtime validation, upload and CPU masks

**Owner:** Runtime worker. Own `web/src/render/atlas-storage.ts`, new focused loader tests, and coverage installer additions in `body-coverage.ts`, `dish-coverage.ts` and `indicator-coverage.ts` with their tests. Do not edit SpriteRenderer, shaders, producer outputs or local runner.

**Consumes:** `ATLAS_STORAGE` and immutable resources from Task 1. **Produces:** `loadAtlasStorage(device: GPUDevice, progress?: LoadProgress): Promise<{ texture: GPUTexture; lookup: GPUBuffer }>`.

- [ ] Add failing tests for invalid source identity, dimensions, lookup values, payload length/hash, record bounds, physical array limits and storage binding limits.
- [ ] Implement complete validation before allocation or mask installation, bounded downloads, exact gzip handling and one-time CPU coverage.
- [ ] Preserve bitmap lifetime through queue completion and destroy both GPU resources on every failed path.
- [ ] Verify exact packed masks, duplicate/recovery loads, failed uploads and subsequent successful retry. Run focused tests and report for task review.

## Task 3: Renderer and real shader integration

**Owner:** Primary assistant. Own `sprites.ts`, `sprites.wgsl`, a focused atlas sampling helper if useful, `sprite-pipelines.ts`, shared resource limits, affected renderer tests, `fixture-depth.ts` source descriptors, main loading progress, local check catalog, docs and evidence.

- [ ] Add a controlled resource-budget startup check that rejects the current loader. Record the actual deployed source and baseline allocations.
- [ ] Consume the new texture and lookup resource, update ownership and progress, and add the fragment storage binding with matching preflight counts.
- [ ] Route every atlas integer and filtered access through the same virtual-to-physical sampler. Update all repo-internal loader callers and affected layout tests.
- [ ] Run the real GPU seam, border, layer and fractional comparison; require a deliberately broken border to fail.
- [ ] Run old/new actual-game comparisons with the same save and inspect captured images. Require startup to draw under the controlled resource budget.
- [ ] Add derived artifact checks to the local runner. Run appropriate local asset tests, type checks, full web suite, compiled-reference validation and production build after edits stop.

## Task 4: Review and delivery

**Owner:** Primary assistant.

- [ ] Obtain fresh independent whole-branch and visual review. Resolve findings before delivery.
- [ ] Update affected operational docs, lessons, dated evidence, player-reference review and truthful changelog. Give a specific guide no-change reason when behavior is unchanged.
- [ ] Refresh remote main, reconcile source and same-day notes, then push and merge without hosted tests.
- [ ] Verify merged remote state, automatic deployment and the public artifact. Leave the task checkout clean and retain original-device acceptance limits.
