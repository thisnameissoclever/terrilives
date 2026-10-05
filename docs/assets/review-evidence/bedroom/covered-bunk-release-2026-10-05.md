# Covered bunk release checks

Inspected on 2026-10-05 in `twcx/covered-bunk-sleep`, based on main
`c83e32d70db6ef664e8829e85f8195bfa74e8bff`. This record covers the local delivery
candidate. Source merge and live publication require separate verification.

## Artwork and storage

The accepted source uses relaxed, sleeping-only scaled legs beneath one
continuous sage duvet. Feet are covered; the near-side ladder, head end,
single lower sleeping place, 2x1 footprint and shared standing rig are preserved.
The [source record](covered-bunk-sleep-2026-10-04.md) retains physical sampling,
rejected cloth forms and causal displacement controls.

The complete raw contribution batch contains 60 signed 1280x1408 RGBA PNGs.
Its actual worker exited and its immutable terminal receipt completed. All
16 scenes reconstruct within the existing quantization limits. The manifest
SHA-256 is `0d0e567ff39f8dcb1f85e04161ff536778e74d77e5b9a6f96cc552cc7ba024c4`.
Raw images are intentionally delivered for the strict importer; they are not
an ignored-local acceptance dependency.

Single-page allocation was rejected after both true area exhaustion and
bounded placement failures were measured. The general page allocator produces
17 pages of 2048x2048. The RGBA allocation is 272 MiB, compared with the prior
254.78125 MiB. Independent review checked every padded rectangle and 165,800
same-page comparisons. Density and decoded artwork were not reduced.

`verify-main-prefix.py c83e32d70db6ef664e8829e85f8195bfa74e8bff` proves all
2,453 prior sprite identities, dimensions, density, decoded RGBA bytes and
existing registration tables unchanged. The architecture resources and local
ordering are unchanged while their base index moves after the reviewed append.

## Automated and graphics evidence

1. The final local web suite passes 1,971 tests. Type checking and the production
   Vite build pass. The existing large-bundle warning remains.
2. Sprite tests pass 187 cases, including page-aware preservation digests.
   The generated atlas freshness check passes every page and both manifests.
3. Rust formatting, workspace Clippy with warnings denied, and the full
   workspace test suite pass. The browser simulation package was rebuilt into
   the actual imported `web/src/wasm` directory.
4. Actual GPU comparisons cover 72 occupied scenes: four facings, three
   clothing palettes, three scales and two furniture colorways. They sample
   303,678 framebuffer points from independently encoded original full owner
   renders. Maximum and worst 95th-percentile error are both one byte. Opaque
   neighboring gutters do not leak into cropped body contributions.
5. The additive-alpha control returns exactly `[64,64,64,255]`, with no
   validation error. The referenced-depth control returns red `[64,0,0,255]`,
   then blue `[0,0,255,255]` when only its page changes, then restored red.
   Reverting the shader to the colour sprite's page makes the positive and
   restored assertions fail. Restored shader SHA-256 is
   `94a49a41ff79c05ffd5d6165fdf29139c051012aed544bb4839183ac22f99552`.
6. The selected-owner ring regression first fails by 27 logical pixels, then
   passes after applying the registered 21-pixel body drop. The storage-budget
   regression rejects a 100,000-byte device boundary after using the actual
   48-byte sprite record instead of the old 32-byte estimate.

The depth fixture initially took asynchronous 2D snapshots of an attached
WebGPU canvas. Three captures returned transparent pixels despite visible
rendering. Fresh review identified the canvas-texture lifetime assumption.
The corrected fixture copies the actual GPU attachment before yielding and
maps the readback buffer afterward. No production rendering was weakened.

## Played and independent review

A dedicated task-owned browser context loaded a controlled household with
Bill assigned to the lower bunk and Tim and Casey to separate double-bed
places. The real game loaded its saved bytes. At paused Day 1, 00:54, the new
bunk covers Bill's feet, and his selection diamond encloses the visible lower
head rather than the empty upper pillow. The double-bed view retains both
sleepers and distinct activity bubbles with its selected head correctly marked.

Primary and independent review inspected the corrected played views and a
readable four-facing GPU sheet. No further visual revision was requested.
Code review caught and closed independent depth-page selection, storage stride
budgeting and signed-JSON newline preservation defects. The signed manifest and
comparison require `-text` attributes so clean checkouts retain their hashes.

Retained images are beside this record. Browser-sized phone checks are not
physical-device acceptance. The 390x844 browser view retains the occupied
lower sleeper and correctly positioned selection diamond. The owned browser
context was closed and the owned preview server was stopped.

## Staged checkout

Staged tree `6ac786851ce45bf50e4616b07eee247cb03fe17b` was archived and extracted
without ignored local inputs. Its generator freshness check, 187 sprite tests,
39 bedroom tests and documentation-ID check pass. Reviewed export hashes survive
the checkout. Subsequent changes add only this evidence and the phone image.

The remaining delivery proof is the exact remote merge and executed
Pages/public-byte verification.
