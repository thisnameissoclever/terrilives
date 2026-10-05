# Neutral-seat export implementation plan

> For agentic workers: use subagent-driven-development for this isolated export task. The controller owns native behavior and renderer integration.

**Goal:** Export complete, physically reviewed neutral seating without replacing accepted dining or reading profiles.

**Architecture:** Preserve immutable furniture and character inputs. Render reciprocal visible contributions, encode them in scene-linear premultiplied colour and append a separately reviewed seat catalogue. Share the existing low-level additive layer renderer; keep physical seat and media target identities separate.

**Tech stack:** Existing Blender, Python/Pillow, TypeScript and Rust. No new dependencies.

**Spec:** `docs/specs/2026-10-05-interaction-animation-expansion.md`.

## Global constraints

1. Work only in `D:/VIBES/.worktrees/terrilives/bike-chair-four-facings`.
2. Preserve approved standing models, signed historical producers, source bytes, published sprites and gameplay footprints.
3. No paid requests, dependency changes, browser control, attribution, force pushes or source edits outside assigned ownership.
4. The running `assets/models/seating/render_neutral_seats.py` input files must remain unchanged.
5. Every exported object requires four facings, four samples and green, blue and red variants.
6. Use scene-linear premultiplied visible-additive encoding. Whole-scene comparison maximum error is six and 95th-percentile error is two, measured in premultiplied display bytes.
7. Shared ink attenuates fills before filtering. Do not add a second attenuation after filtering.
8. Preserve existing action profiles. New neutral action eight belongs in a separate action-specific catalogue.

## Review focus

1. Corrupt, duplicate or traversal references must fail before image import.
2. Missing samples, phases, palettes or body-line ownership must fail.
3. Camera registration, physical density, clipping borders and source identity must stay bound to accepted inputs.
4. Palette changes must not change geometry, furniture or ink ownership.
5. Click ownership must distinguish visible body, furniture and body-owned ink.

### Task 1: Encode and import neutral seating

**Ownership:** Create only `assets/models/seating/render_neutral_ink.py`, `seat_export_contract.py`, `export_neutral_seats.py`, `test_export_contract.py`, `assets/sprites/gen/offline_seating.py` and `test_offline_seating.py`. Diagnostic scripts and reports may be created under this task's ignored workspace. Do not edit the running producer, pose/contact/profiles files, build.py, generated atlas, native code, web code, existing model producers, index or Git refs. The controller commits the coherent batch after review.

**Inputs:** The running full batch is `assets/models/seating/review/batch-01/proof.json`. Its five objects are dining, office, sofa, ottoman and reading. Armchair keeps accepted existing profiles. Each entry records source/model hashes, camera, logical canvas, anchor, twelve contact samples and 192 renders. Probe batches must be rejected. Standard logical canvas is 96x120; sofa is 160x176. Raw density is eight and export density is two. Exact accepted fit diagnostics are under `output/media-seat-diagnostics/` and `output/seated-leg-rethink/`; these do not replace full-batch contact checks.

**Rendering:** The new editable source stores action `neutral_media_<kind>`, samples one through four, loop endpoint five, and collections `Neutral seated body` and `Neutral seat furniture`. Add a separate body-owned ink pass against each saved new model, preserving whole-scene occlusion. Use green geometry in all four facings and samples; prove geometry/alpha equality before sharing that ink across palettes. Do not change the running producer. Use the hidden Store launcher at `C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe` with background mode, two threads and Python exit code one. A detached launcher is not process completion.

**Encoding:** Reuse `bedroom/double_bed_linear.encode` and `reconstruct`. Validate against independent full-scene beauty using `double_bed_layers.comparison` on premultiplied display results, enforcing the stricter six/two limits. Use lossless originals; do not repair pixels, resize characters, drop frames or weaken checks. Validate original PNG dimensions, mode, readability, full hashes and alpha borders. Validate complete named body/solid contacts and anatomical bone lengths from receipts. Preserve current source and dependency hashes; record new exporter dependencies separately.

**Output:** Write a new export directory under `assets/models/seating/export/`. Retain a manifest, comparison metrics, exact source and ink receipts, reviewed layer references and visible-owner masks. One group owns furniture, body and shared ink. An alias may reuse the furniture texture; it is a scene record, not a baked full-scene image. Do not put neutral profiles into `INTERACTION_SPRITES`.

**Importer interface:** `load_neutral_seats(manifest_path) -> NeutralSeatExport`; `records(export) -> list[(name, PIL.Image, width, height)]`; `tables(export, sprites) -> dict` with `anchors`, `tops`, `bounds`, `density`, `profiles`, `layers`, `coverage`, `masks`. `profiles` maps existing empty sprite indices to action eight profiles, using existing `InteractionProfile` fields `action`, `halfCycleTicks`, `frames`. `layers` maps scene indices to `[furniture, body, -1, ink]`. `coverage` maps scene indices to body/furniture/ink/body-ink mask indices; `masks` uses the existing `EncodedCoverage` representation. Derive target names from exact shipped content facings, retaining standard suffix conventions and the special reading-chair names. The controller connects these to separate `SEATING_SPRITES`, `SEATING_LAYERS` and `SEATING_COVERAGE` tables.

**Symmetric ottoman:** An ottoman has no back or physical front. Add optional
`facingFrames`, mapping native body-facing values one through four to variant
frame arrays. Bind each empty ottoman sprite to all body-facing arrays after
verifying quarter-turn physical symmetry. With body turn minus 90 degrees,
source facing SE maps to body three, NW to four, SW to two and NE to one.
Backed seats retain their fixed-front `frames`. The controller supplies optional
facing columns and selects the corresponding arrays; do not rotate saved
furniture or encode media-facing choices as meal settings.

- [ ] Write failing contract/import tests for duplicate samples, changed hashes, incomplete palettes, source/camera mismatch, unsafe paths, body-line ownership and shared-ink filtering.
- [ ] Demonstrate each relevant failure before implementing its guard.
- [ ] Implement the ink producer, complete export and strict importer within ownership.
- [ ] Run focused tests during iteration and the complete affected Python suites before reporting.
- [ ] Perform self-review and write exact commands, exit codes, failures and results to the task report.
- [ ] Return a short status and report path. The controller dispatches independent task review and handles commit/publication.
