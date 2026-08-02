# Asset Provenance

Every third-party asset, its source, and its licence. Kept even where a licence
requires no attribution, because provenance questions are expensive to answer
retroactively and cheap to record now.

**CC0 assets are safe to commit to this public repository. Paid asset-store
content is not** - those licences generally forbid redistributing source, which
is fine inside a compiled build and a violation inside git. See TECH_STACK.md.

## Kenney Furniture Kit

- **Source:** https://kenney.nl/assets/furniture-kit
- **Licence:** CC0 1.0 Universal. Commercial use, modification, and
  redistribution permitted; no attribution required.
- **Downloaded:** 2026-07-28, 4.9 MB
- **Contents:** 140 models in five 3D formats, plus **560 pre-rendered
  isometric PNGs** at four rotations each, plus side-on renders.
- **What we use:** 39 isometric PNGs, scaled and packed into
  `assets/sprites/atlas.png`. Most use the `_SE` rotation; the north-facing
  kitchen run, walls, corners, and doorways also use selected `_SW` rotations.
  The 3D models are unused for now; [G5] in TECH_STACK.md expects characters
  to need real meshes once customisation arrives, and this pack is a candidate
  then.
- **The source zip is gitignored** (`assets/vendor/`). Only the derived atlas is
  committed, because committing both would put the same art in the repository
  twice. Re-download from the URL above and run
  `assets/sprites/build-atlas.ps1` to regenerate.

The complete borrowed set is the 39 non-`generated:` entries in `$SOURCES` in
`assets/sprites/build-atlas.ps1`. That declaration records both the atlas name
and exact Kenney source name, including every furniture facing, wall, corner,
and doorway. It is the authoritative per-sprite inventory because the same
list generates the atlas and both runtime manifests; a prose copy would drift
the next time a room gained a chair, which is precisely how this document
became stale once already.

## Generated, not borrowed

Nine sprites in the atlas are drawn by `build-atlas.ps1` rather than taken from
the kit.

- **`sim`.** The kit is 140 pieces of furniture and **contains no people at
  all**, so the one sprite the game most needs is the one nothing ships. It is
  a placeholder assembled from ellipses: head, torso, two arms, two legs, and a
  contact shadow, drawn at 4x and downsampled. [G5] in TECH_STACK.md already
  expects characters to become real meshes once customisation arrives, so this
  is deliberately the cheapest thing that reads as a person at 78 px.
- **`floor`.** The kit has `floorFull_SE`, and it is not usable: it is a
  208 x 146 slab whose visible side faces do not match the measured ground
  slope. Across 432 tiles even a small mismatch produces visible seams. The
  generated floor is an exact 64 x 42 diamond with a darker edge, matching
  `2 * TILE_HALF_WIDTH` by `2 * TILE_HALF_HEIGHT`, so the grid aligns with
  `worldToScreen` by construction.
- **`selectionRing`.** A 64 x 42 ellipse in the HUD accent sits on the same
  ground anchor as the floor without needing a second outlined character.
- **`indicatorTalk`, `indicatorEat`, `indicatorSleep`, and `indicatorWait`.**
  The kit contains no interface glyphs, so these activity bubbles are generated
  at the exact 26 x 26 slot the renderer uses.
- **`carried_ingredients` and `carried_dinner`.** These 18 x 18 badges make a
  chain's carried-item transition visible without pretending the furniture kit
  contains food UI art.

## The scale, and the one number it turns on

Every borrowed sprite is scaled by `64 / 118`: 64 px is one tile across
(`2 * TILE_HALF_WIDTH`), and **118 px is one metre in Kenney's renders**.

Their tile is not our tile. `grid.rs` says one tile is roughly one metre, and
measuring their furniture against real-world sizes puts their grid at about
1.7 m: an isometric box with footprint w by d renders `(w + d) * halfTile` wide,
so a 0.4 x 0.7 m toilet at 66 px and a 1.0 x 2.0 m bunk bed at 172 px both put
their half-tile near 60 px and their metre near 118.

Scaling by their **tile** instead - the obvious reading, and what the first pass
did - draws every piece of furniture at 58% of its size. The lot then reads as
an empty warehouse with doll's-house props in it, which is a rendering bug that
looks like a level-design problem.

**Scale both axes or neither.** Wall panels are 1.8 of our tile edges wide at
this scale, so a run of them overlaps and the top reads as overlapping boards.
Narrowing only their width to one tile edge was tried and is worse: the panels'
top and bottom edges are diagonals cut to the tile slope, and scaling x without
y re-slopes them, so the run opens into a picket fence with the floor showing
through.

## The manifest exists twice, on purpose

`build-atlas.ps1` writes three files in one pass:

| file | read by |
| --- | --- |
| `assets/sprites/atlas.png` | the renderer, as one texture |
| `assets/sprites/atlas.toml` | `terri-data`'s build script, to validate every object's `sprite` and resolve it to an index |
| `web/src/render/atlas.ts` | the renderer, for the rects |

Two manifests rather than one because the two readers cannot share a format
without a new dependency: `terri-data` already reads TOML and the web build has
no TOML parser. They are written from one in-memory list in one pass, so they
cannot disagree unless one is edited by hand - and `web/tests/atlas.test.ts`
reads the TOML and fails if they ever do.

**A sprite's index is its position in that list**, on both sides. Inserting a
sprite in the middle renumbers every sprite after it and silently redraws the
lot with the furniture shuffled, so the list in `build-atlas.ps1` is
append-only in spirit.
