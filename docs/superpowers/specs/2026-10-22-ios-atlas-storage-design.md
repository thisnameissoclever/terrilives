# Bounded artwork storage for iPhone startup

## Intent and evidence

The affected player reports an iPhone 17 Pro running iOS 27.0.1. Loading appears before the page fails in Safari and Chrome. The earlier upload-completion change did not resolve the reported failure. It preserved a large permanent allocation.

Local profiling of the deployed game records the actual graphics allocations and process memory during startup. The dense atlas alone requests 880 MiB. A phone-sized rendered scene requests additional graphics storage. These measurements establish excessive resource demand; they do not reproduce or diagnose the original iPhone process termination by themselves.

The repair changes physical storage while preserving the complete logical atlas. It must retain every RGBA byte, sprite index, animation, picking rule, fixture-depth value, shader sampling rule, source asset and save format. It must not lower image density, rendering resolution or scene quality, remove models, or hide failures behind a reduced-feature mode.

## Storage representation

Use eight-by-eight logical image blocks with a one-pixel border. Every virtual page is 2048 by 2048 RGBA pixels. Include every original sprite page, the grime page with its existing zero padding, and all fixture companion pages in their existing order. Outside each copied source image, virtual pixels remain zero, matching initialized WebGPU texture storage.

Deduplicate identical bordered blocks by their exact bytes. Omit a block only when its complete bordered contents are zero. At virtual page edges, extend edge pixels into the border to retain clamp-to-edge filtering. Reserve lookup value zero for an omitted block; value N references physical slot N minus one.

Pack ten-by-ten physical cells into 2048-by-2048 RGBA8 pages, 204 cells per row. Leave the unused outer pixels zero. A little-endian Uint32 lookup has one entry per logical block, ordered by virtual layer, block row and block column. Store a four-byte `ATL1` header before its bytes in the downloaded file; the GPU receives the entries only. Gzip the file with a content-addressed filename. Publish the exact raw length and raw SHA-256 alongside the encoded filename.

Publish content-addressed PNGs for the physical pages. Keep the original atlas manifest, artwork and source receipts unchanged. A generated TypeScript manifest declares the source page names, companion hashes, layout constants, physical page files and hashes, unique block count, lookup descriptor and CPU coverage descriptor. The decoder validates the entire representation before allocating or uploading it. Invalid data fails explicitly without a dense fallback.

The additive `sources` records contain repository-relative POSIX `file`, `width`, `height` and `sha256` for every logical layer, including grime. Hash exact source file bytes. Keep original PNG names and companion identities comparable with the runtime catalogue; the complete local reconstruction check validates the derived resources against source files.

For the complete current catalogue, texture plus lookup storage must remain below 384 MiB. This is a resource budget for the derived representation, not an assertion about an iPhone's operating-system limit.

## CPU coverage

Generate the existing body, dish and indicator coverage from the same source pixels. Avoid decoding all original PNG pages on the device merely to reconstruct these masks.

The coverage payload starts with four bytes `ACV1`. Subsequent offsets are relative to the complete unpacked payload. Align Uint32 index spans to four bytes. The generated descriptor contains:

1. `bodies`: records with `sprite`, `opaque: [byteOffset, byteLength]`, `partialPixels: [byteOffset, elementCount]`, and `partialAlpha: [byteOffset, byteLength]`.
2. `dishes`: records with `sprite` and `alpha: [byteOffset, byteLength]`.
3. `indicators`: records with `sprite` and `bottomPixels`.

Body opaque bits use the existing least-significant-bit-first order. Partial indices are sorted little-endian Uint32 values; their alpha values remain between one and 254. Dish alpha remains unmodified bytes. Indicator bottoms retain the current alpha threshold of 32 and original density conversion. Deduplication may share identical spans. Validate complete records, source identities, bounds, alignment, lengths and ordering before installing any coverage.

## Runtime interface

`web/src/render/atlas-storage.ts` exports `loadAtlasStorage(device, progress?)`, returning `{ texture: GPUTexture, lookup: GPUBuffer }`. It validates the actual device dimensions, physical layer count, lookup storage size and source manifest. It loads coverage once, bounds encoded-page prefetch, and retains each decoded bitmap until its upload completes. It releases both resources and every bitmap on failure.

`loadAtlasTexture` in `sprites.ts` delegates to that resource interface. Its repo-internal callers and tests must be updated together. SpriteRenderer owns and destroys the returned texture and lookup buffer. The new fragment-visible lookup uses one additional storage binding; sampled-texture counts stay unchanged. Shared preflight constants must reflect the actual maximum storage-buffer count per shader stage.

The sampler preserves the existing virtual coordinates and array-layer identities. Integer loads return zero outside virtual bounds, then translate the logical block and local pixel to physical storage. Filtered loads translate coordinates into the bordered physical cell and retain the existing hardware sampler. Route every atlas access, including body layers, support masks, furniture, outlines and fixture depth, through these helpers. Other textures remain unchanged.

## Verification and delivery

1. Require codec tests to reject omitted borders, altered indices, changed pixels, invalid dimensions and corrupt payloads. Reconstruct every virtual source page byte-for-byte from the generated resources, including border checks.
2. Verify the real shader against dense reference textures at block seams, fractional coordinates, virtual page boundaries and array layers. Corrupt a border and require the comparison to fail.
3. Exercise actual startup with a controlled one-GiB graphics allocation budget. The current dense loader must fail this injected resource constraint; the repair must load and draw. Label this as controlled resource testing, not reproduction of the original iPhone's operating-system termination.
4. Compare the old deployed game and repaired local build with the same saved household, paused state, camera, viewport and rendering settings. Inspect actual color, surface and identity captures and obtain independent visual review. Retain selected stills and measurements, never review videos.
5. Run appropriate local asset, type, web and build checks. Add the derived-art verifier to the local artwork checks. Preserve all existing assertions or replace obsolete layout-specific assertions with tests of the new physical contract.
6. Review source changes before refreshing player-guide fingerprints. Update the public changelog for the measured memory reduction without claiming an unobserved iPhone recovery.
7. Complete independent code review, push, merge and verify automatic Pages publication. Keep hosted test workflows disabled. No dependency, toolchain or paid-test changes are authorized.

The physical iPhone remains an unavailable acceptance environment. Keep its observed failure, the controlled memory test and desktop rendering evidence distinct.
