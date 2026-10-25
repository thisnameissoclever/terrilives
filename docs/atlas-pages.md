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

New sprite records also need a pinned entry in `historicalExtensions` in
`assets/models/architecture/architecture.json`. Architecture starts after the
complete sprite catalogue, so an undeclared tail would change its base index
without satisfying the historical-art contract. Keep the frozen prefix digest
unchanged. Conversation icons use a catalogue of reviewed names, dimensions
and decoded pixel hashes; their loader rejects any changed image before the
architecture suffix is generated.

The deterministic shelf allocator preserves record order and never rotates
images. Every padded rectangle must fit its selected page. Oversized input
fails explicitly; do not lower density to conceal a capacity failure.

Use `atlas_pixels.AtlasPages` for source-pixel verification. Select a page
from the sprite record before cropping. The reader also supports historical
single-image catalogues and an injected byte reader for Git revisions. Keep
existing preservation digests unchanged when only storage moves.

## Renderer contract

The source pages remain the logical coordinate system. Run
`python -B scripts/build-runtime-atlas.py` after changing source artwork or
the sprite catalogue. The producer packs identical eight-pixel square blocks
once, including a one-pixel border for filtering. It includes grime and fixture
color and depth pages in their original logical order. It drops only blocks
whose complete bordered contents are zero. Original artwork stays unchanged.

`web/src/render/atlas-storage-metadata.ts` declares the physical PNG pages,
source identities, block lookup and CPU coverage. The runtime also pins the
unversioned grime image's source hash; update that reviewed pin and its source
identity test after an intentional grime artwork change. Binary filenames hash the
compressed bytes; binary descriptors hash the decompressed bytes. PNG
filenames and descriptors hash the encoded PNG bytes. Run the producer with
`--check` to reconstruct every logical pixel and border and compare CPU masks
with original alpha. Check mode writes nothing. Local artwork verification
includes these checks.

The browser uploads physical pages into a `texture_2d_array` and uses a
read-only storage buffer to translate logical coordinates. All integer and
filtered accesses use the same translation, including fixtures, furniture,
outlines and support masks. Borders retain the original linear filtering
across block seams. Character models and architecture remain separate.

Validate source identities, dimensions, array layers, storage binding size,
payload hashes, lookup references and complete CPU coverage before allocation
or mask installation. Invalid files fail explicitly. Keep the representation's
texture and lookup storage below 384 MiB. The renderer owns both graphics
resources and releases them on failure and destruction.

The loader waits for each graphics upload to finish before closing its bitmap
or starting the next page upload. Compressed downloads can prefetch four pages.
Body, dish and indicator coverage comes from an exact derived alpha payload,
so startup does not decode the original source pages to rebuild CPU masks.
See the dated
[startup upload comparison](evidence/2026-10-21-ios-startup-memory/README.md)
for the earlier upload-pacing measurements and their iPhone diagnosis limits.

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

## Wall and floor depth and role files

The architecture export ships two texture-sized binaries beside its PNGs: the
half-float depth file and the one-byte material-role file. Both are mostly
zeros and GitHub Pages does not compress binary files, so
`offline_architecture.py` publishes them gzip-compressed as
`architecture-<sha256>.r16f.gz` and `architecture-<sha256>.r8.gz`. The depth
file goes from about 12.4 MB to 0.27 MB, and the role file from about 6.2 MB
to 0.09 MB. Startup always loads the depth file. The role file loads only for
a floor finish that is not baked into the color texture; every covering in
the current catalogue is baked, so players do not download it today.

Unlike the coverage file, these names hold the SHA-256 of the unpacked bytes,
which the reviewed manifest already records as `ARCHITECTURE.hashes`, so a
different zlib build never renames them. `--check` and a normal run compare
unpacked bytes and keep a committed file that still holds them. A normal run
removes generator-owned `architecture-*` files the export no longer names, and
`--check` reports them.

`architecture-atlas.ts` unpacks both with `gzip-file.ts` into buffers of the
exact texture size, and accepts uncompressed bytes from a server that already
decoded them. The loading screen counts the bytes the page receives: the
compressed size on GitHub Pages, the unpacked size under Vite's own servers,
which label `.gz` files as gzip-encoded.
