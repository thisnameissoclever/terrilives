# Asset Provenance

Every third-party asset, its source, and its licence. Kept even where a licence
requires no attribution, because provenance questions are expensive to answer
retroactively and cheap to record now.

**CC0 assets are safe to commit to this public repository. Paid asset-store
content is not** - those licences generally forbid redistributing source, which
is fine inside a compiled build and a violation inside git. See TECH_STACK.md.

## There are no third-party visual assets

**As of 2026-08-03 this project ships no borrowed art.** Every sprite in
`assets/sprites/atlas.png` is drawn from primitives by `assets/sprites/gen/`,
so the atlas is a build output rather than a derived work.

That is a licensing simplification as much as an artistic one. No attribution
to carry, no source archive to keep out of git, no question about which pack a
given sprite came from, and no ambiguity about copyright: the sprites are the
output of a program in this repository, not of a model and not of somebody
else's kit.

The direction is Muted Line, chosen in [T-design-language]. Its palette, shape
language and character build live in `assets/sprites/gen/style.py`, which is
the style bible and is executable.
`docs/specs/2026-08-03-muted-line-implementation.md` is the plan it came from.

## What was here before, and why it is gone

The alpha shipped 39 isometric PNGs from the **Kenney Furniture Kit** (CC0,
https://kenney.nl/assets/furniture-kit), scaled and packed by
`assets/sprites/build-atlas.ps1`, plus nine sprites that script generated
because the kit had no equivalent: the sim, the floor, the selection ring, four
activity indicators and two carried-item badges.

It was replaced whole rather than restyled. Five treatments OF the borrowed
sprites were proposed first and rejected, on the grounds that a grade over
borrowed art is still borrowed art; the superseded
`docs/specs/2026-08-03-design-language-options.md` keeps that argument.

**`build-atlas.ps1` is deleted rather than kept for reference.** Left in the
tree it is a script that silently reverts the entire art direction when run,
which is a worse hazard than the small loss of convenience. Its contents are in
git history if the Kenney provenance is ever needed, and this section is the
record that it existed.

The kit's 3D models were never used. [G5] in TECH_STACK.md still names the pack
as a candidate if characters ever need real meshes, at which point this becomes
a live entry again.

## The generator

`assets/sprites/gen/` is four files and Pillow, nothing else:

| File | What |
| --- | --- |
| `style.py` | The palette, the line, the shading ramp, the character build. The style bible. |
| `iso.py` | The projection, the box/slab/cylinder primitives, and the anchoring rule. |
| `objects.py` | All 48 sprites, and the name contract they satisfy. |
| `build.py` | Packs the sheet and writes all three output files. |

```sh
python3 assets/sprites/gen/build.py            # write
python3 assets/sprites/gen/build.py --check    # fail if the committed atlas is stale
```

Unlike the PowerShell it replaces, this runs on Linux, so **CI runs `--check`
on every push**. The atlas stopped being a trusted blob and became a
reproducible build output, which the old pipeline could never offer.

## The names are a contract

`content/objects.toml` resolves 30 sprite names and `tiles.ts` asks for 6 more
by hand. terri-data fails the content build on a dangling reference, so
renaming or dropping an entry in `objects.SPRITES` breaks the game rather than
changing how it looks.

## Three sprites whose size IS the projection

Most sprites are whatever size their art comes out. Three are pinned, and
`web/tests/iso.test.ts` asserts all of them:

- **`floor`** is exactly `2 * TILE_HALF_WIDTH` by `2 * TILE_HALF_HEIGHT`,
  64 x 42. It is the one sprite whose dimensions are the ground plane, so a
  pixel of drift tiles the whole lot with seams.
- **`wallNS` and `wallEW`** are exactly one tile edge wide, 32 px, and taller
  than the sim. Wider and a run overlaps itself; shorter and the walls read as
  a skirting board.

`emit()` in `iso.py` takes an exact size for these, because a 1 px outline
overshoot is otherwise enough to break them silently.

## The anchoring rule

`sprites.wgsl` draws every quad bottom-centre anchored at the entity's screen
position plus half a tile down. So a tile's screen position is the CENTRE of
its diamond, and a sprite's bottom edge sits on that diamond's SOUTH corner.

The generator draws in tile-corner coordinates with the origin at the anchor
tile's centre, which puts the anchor at local corner (0.5, 0.5); multi-tile
objects grow toward negative x and y, up and back on screen. `emit()` crops to
the art, pads so the crop is symmetric about the anchor's x, and pins its
bottom to the anchor's row. It raises rather than accommodates when art falls
below that row, because an object drawn below its own contact point is standing
in the floor.

Three things learned building it, all of which looked fine in a preview and
were wrong in the game:

- A cylinder's base ellipse is centred on its contact point, so half of it
  falls below. It has to be lifted to SIT on the ground rather than straddle it.
- A wall panel outlined on all four sides puts a vertical ink line every 32 px
  down a run, which is the picket-fence read arriving by a new route. Wall
  panels are capped top and bottom only.
- A box's screen width is `(length + thickness) * TILE_HALF_WIDTH`, so any
  visible thickness pushes a wall panel past one tile edge. At this size a wall
  is a plane.

## The manifest exists twice, on purpose

`build.py` writes three files in one pass:

| file | read by |
| --- | --- |
| `assets/sprites/atlas.png` | the renderer, as one texture |
| `assets/sprites/atlas.toml` | `terri-data`'s build script, to validate every object's `sprite` and resolve it to an index |
| `web/src/render/atlas.ts` | the renderer, for the rects |

Two manifests rather than one because the two readers cannot share a format
without a new dependency: `terri-data` already reads TOML and the web build has
no TOML parser. They are written from one in-memory list in one pass, so they
cannot disagree unless one is edited by hand, and `web/tests/atlas.test.ts`
reads the TOML and fails if they ever do.

**A sprite's index is its position in that list**, on both sides. Inserting a
sprite in the middle renumbers every sprite after it and silently redraws the
lot with the furniture shuffled, so `objects.SPRITES` is append-only in spirit.

## What is not done

The sim is still one sprite in one pose, so everyone in the household looks
identical. The build numbers in `style.py` are already parameters and skin,
hair and clothing are meant to arrive as an instance tint, but per-instance
tint does not exist yet: an instance is one `vec4` with all four slots spent.
That is [ML-tint] and [ML-chars] in the implementation spec.

Walls are still tile-CENTRED panels, because that is what `tiles.ts` draws.
Moving them onto tile edges is [B7], a renderer change rather than an art one.
