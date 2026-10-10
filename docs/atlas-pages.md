# Sprite texture pages

The sprite catalogue keeps one stable index for each image or scene. The
physical images occupy bounded 2048x2048 texture pages. Moving an image to
another page changes its stored coordinates, not its logical size, anchor,
pixel density, gameplay identity or decoded RGBA pixels.

`assets/sprites/gen/build.py` writes the TOML and TypeScript catalogues in one
pass. Each sprite declares its page. The manifest declares the ordered page
filenames; every filename contains the SHA-256 of that page's bytes. The
unversioned `atlas.png` is page zero, not the complete catalogue.

## Generation and verification

Run `python assets/sprites/gen/build.py` to regenerate the pages and metadata.
Run the same command with `--check` to compare every page and both catalogues.
Do not edit generated metadata or retain an obsolete texture for tests.

The deterministic shelf allocator preserves record order and never rotates
images. Every padded rectangle must fit its selected page. Oversized input
fails explicitly; do not lower density to conceal a capacity failure.

Use `atlas_pixels.AtlasPages` for source-pixel verification. Select a page
from the sprite record before cropping. The reader also supports historical
single-image catalogues and an injected byte reader for Git revisions. Keep
existing preservation digests unchanged when only storage moves.

## Renderer contract

The browser loads the pages into a `texture_2d_array`, an ordered set of 2D
images. This does not turn the game into a live 3D model renderer. Validate
page dimensions and the device's actual array-layer limit before fetching
or allocating. Close every decoded bitmap and destroy partial allocations
when loading fails.

Each sprite record contains twelve floats: UV bounds, logical dimensions and
legacy pair references, then crop registration and page metadata. Shared
layout constants define the corresponding byte count. Architecture resources
remain separate; their storage-limit check includes the complete sprite table.

Every sampled reference selects its own page. This includes pair furniture,
ink, covered-bed bodies, dining masks and surface-depth images. A colour
sprite and its referenced depth image need not occupy the same page.

## Registered sparse contributions

Covered bunk bodies retain their original full-scene placement while storing
only their nonzero image rectangle and two zero-valued border texels. Crop
offsets use logical pixels in separate registration fields; they never reuse
legacy pair-index fields. Keep visible-owner coverage in its full registered
canvas for picking and overlays.

Untrimmed contributions retain the direct UV calculation. Trimmed contributions
map scene coordinates into their own rectangle and return zero outside it.
Require exact full-image restoration, fractional GPU comparisons and opaque
neighbor controls before accepting a new trim.

For GPU readback, submit a texture-to-buffer copy immediately after drawing,
before yielding. Await buffer mapping afterward. A presented canvas texture
may expire before an asynchronous 2D snapshot reads it.

The dated [covered-bunk release evidence](assets/review-evidence/bedroom/covered-bunk-release-2026-10-05.md)
records the inspected source, preservation results, device measurements and
runtime proof boundaries.

## Coverage file

Coverage records say which pixels of a scene belong to each body, bed, chair
or fixture. Picking and dining support sample them, and the renderer uploads
the half-float scene alpha among them. Their bytes do not live in the
TypeScript catalogues. The generator writes every coverage table's bytes to
one gzip-compressed file, `web/public/coverage-<sha256>.bin`, named by the
SHA-256 of the compressed bytes like the atlas pages. It removes obsolete
`coverage-*.bin` files on a normal run and reports them in `--check`.

Each record in `BED_COVERAGE`, `SPRITE_PAIR_MASKS`, `SEATING_MASKS`,
`SHELF_COVERAGE` and `BATHROOM_MASKS` keeps its size, its nonzero box, its
optional `bitDepth` or `encoding`, and an `offset` into the decompressed
bytes. Values are row-major within the box, little-endian for 16-bit and
half-float records, and every record starts on a four-byte boundary.
Identical byte runs are stored once, so equal offsets mean equal values.
`web/src/render/coverage-file.ts` names the file and its decompressed length.

The generator compresses the file itself because GitHub Pages does not
compress binary files, and the raw bytes are about 70 MB of mostly zeros.
Different zlib builds can compress the same bytes differently, so `--check`
and a normal run compare decompressed bytes and keep a committed file that
still holds the current payload.

The browser downloads the file with the atlas pages during "Loading furniture
and people", where it counts as one more file. `coverage-payload.ts` unpacks
it once and keeps it for the session; `SpriteRenderer.create` waits for it,
and nothing samples coverage before a renderer exists. Node tests read the
same committed file through `web/tests/setup/coverage-payload.ts`, and the
Python tests restore each record's base64 `values` through
`atlas_test_tables.table`.
