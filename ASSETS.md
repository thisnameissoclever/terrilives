# Asset Provenance

Every third-party asset, its source, and its licence. Kept even where a licence
requires no attribution, because provenance questions are expensive to answer
retroactively and cheap to record now.

**CC0 assets are safe to commit to this public repository. Paid asset-store
content is not** - those licences generally forbid redistributing source, which
is fine inside a compiled build and a violation inside git. See TECH_STACK.md.

## Current visual sources

**Current provenance, 2026-09-20:** the primitive-only account below
describes the earlier generator migration, not the full current asset set.
The approved shared Sim now comes from the editable Blender source and rig in
`assets/models/sims/sim-01/`, including the retained Tripo hair source.
Its README records immutable source hashes, material-only shirt variants and
offline animation exports. High-resolution Blender renders are downsampled to
RGBA frames at twice their logical dimensions, validated and packed into the
same 2D atlas. This candidate branch contains 1,225 records at 4096x7928 physical
pixels; the older counts below are historical. Existing sprite identities,
logical dimensions and unrelated decoded pixels remain unchanged.

New furniture work is specified in
`docs/specs/2026-09-10-bike-chair-four-facings.md`. Approved local bike and chair
models now supply four empty facings, eight cycling poses and four reading
poses per facing, in all three shirt colours. Their independently rendered
visible Sim, furniture and shared-outline contributions are combined in one
GPU sprite draw. Source/provenance limitations and export instructions are in
`assets/models/furniture/README.md`; played evidence is under
`docs/assets/review-evidence/furniture/`. These assets are integrated on main;
the review notes record played verification, including the later wall changes.
Neither workflow requires runtime 3D rendering.

The reviewed bunk now uses that composite mechanism for its unchanged lower
sleep socket. Four empty facings, 48 occupied bodies and 24 shared contribution
layers append at 1137 through 1212. Its editable source, rejected first model,
support checks and complete render evidence are in `assets/models/bedroom/`.
The strict `bunk-reviewed.json` catalog binds accepted image files to all 48
successful independent reconstruction comparisons. Previous decoded sprites,
including the corrected refrigerator, are byte-identical. Runtime evidence is
in `docs/assets/review-evidence/bedroom/bunk.md`; publication is separate.

The oak and metal desk adds four static rotations at indices 1213 through
1216. Its working face points SW toward the existing chair, retaining its
two-by-one footprint and position. Source, connected-support checks and
independent review are in `assets/models/office/`; played and GPU evidence is
in `docs/assets/review-evidence/office/desk.md`. Work remains a standing action.
The append order is defined in `assets/models/atlas-batches.json`: the frozen
first static catalog, the bunk batch, then `static-props-02.json`. Adding new
props must not renumber the bunk or any earlier sprite.

The four half-wall records occupy indices 1217 through 1220. The front-door
frame and closed, ajar and open leaves append at indices 1221 through 1224.
They are original procedural artwork in
`assets/sprites/gen/front_door.py`, using the existing Pillow generator with
no imported asset, new dependency or licensing cost. The four logical
112x109 sprites share one fixed hinge and threshold registration. The prefix
tests preserve the earlier 1,217-record furniture prefix and the four
half-wall records; the door test pins the reviewed four-record tail. This is a
static sprite door animated by the simulation, not a new runtime 3D system.

The static bathroom batch also includes the reviewed stacked washer/dryer in
`assets/models/bathroom/owner-review-pending/laundry/candidate-02/`. Its four
rotations and room-relative scale passed independent review; the object stays
decorative. Verification is recorded in `docs/assets/review-evidence/bathroom/laundry.md`.

Kitchen replacements follow the same offline authoring workflow in
`assets/models/kitchen/`. The refrigerator's candidate 03 contains four true
rotations, an editable model and hashed render inputs. On 2026-09-17 the owner
delegated per-object acceptance to primary and adversarial review. Its four
static views are integrated after all 1,089 previous sprites, preserving those
decoded pixels and registration tables. The source proof is pinned in the
first static batch, `assets/models/static-props.json`. Played and GPU evidence is in
`docs/assets/review-evidence/kitchen/`; live deployment is a separate check.

Candidate 03 corrects the owner's reported room-fit defects: the refrigerator
is uniformly 20% larger in model space, and its kitchen placement faces SW into
the room rather than SE into the counter. Its four existing records are
replaced deliberately; all other decoded art remains unchanged. Source and
whole-room acceptance are recorded in `fridge-room-fit.md` in that evidence
directory. Gameplay footprint, camera and save format remain unchanged.

The stove's candidate 02 adds four further views at indices 1093 through 1096.
Its editable model preserves the kitchen's blue-grey enamel and cream hob,
with four coil burners, attached controls and a bottom-hinged oven door.
Primary and adversarial review accepted the closed static views. Played
verification completed the cooking chain, but no new cooking or oven-opening
animation is claimed. The previous 1,093 decoded sprites remain unchanged.

Counter and kitchen-sink candidate 01 add eight views at indices 1097 through
1104. They share the stove's palette and worktop height. The sink has an actual
opening and recessed basin, with saved-scene support checks for the drain and
faucet bases. Primary and adversarial review accepted the static source views.
The previous 1,097 decoded sprites remain unchanged. This does not implement
surface-item placement, dishwashing motion or new hand-contact animation.

The bathroom pedestal sink's candidate 01 adds four views at indices 1105
through 1108. Its warm ceramic shell includes a recessed basin and closed
underside, with a supported pedestal, drain and faucet. Primary and adversarial
review accepted the source and four-facing GPU renders. Played verification
confirmed the existing wash-hands interaction still raises hygiene to 100.
The previous 1,105 decoded sprites remain unchanged. Sources and limitations
are in `assets/models/bathroom/`; retained evidence is in
`docs/assets/review-evidence/bathroom/`. No hand-contact or water animation is
included in this static replacement.

The toilet's candidate 03 adds indices 1109 through 1112. It uses the same warm
ceramic, a recessed bowl, an open seat and an upright lid with checked hinge
contacts and clearance from the cistern and supports. Two rejected candidates
remain archived beside it with their failed checks and review notes. The
previous 1,109 decoded sprites remain unchanged. The existing interaction was
played to completion; seated use and flushing animations are not included.

The shower's candidate 01 adds indices 1113 through 1116. Its recessed tray,
two opaque panels and attached metal fittings use the same bathroom palette.
Primary and adversarial review accepted the four static rotations and GPU
renders. Played verification confirmed the existing shower action raises
hygiene. All 1,113 previous decoded sprites remain unchanged. Water, glass
transparency and a showering pose are not part of this static replacement.

## Historical primitive-only migration

**As of 2026-08-12 this project ships no borrowed art.** Every sprite in
`web/public/atlas.png` is drawn from primitives by `assets/sprites/gen/`, so
the atlas is a build output rather than a derived work.

That is a licensing simplification as much as an artistic one. No attribution
to carry, no source archive to keep out of git, no question about which pack a
given sprite came from, and no ambiguity about copyright: the sprites are the
output of a program in this repository, not of a model and not of somebody
else's kit.

The direction is Muted Line, chosen in [T-design-language]. Its palette, shape
language and character build live in `assets/sprites/gen/style.py`, which is
the style bible and is executable.
`docs/specs/2026-08-03-muted-line-implementation.md` is the plan it came from.

## Sim voice recordings

**Twelve nonverbal clips, recorded by Tim Woodruff, owned outright.** They are
first-party rather than borrowed, so there is no pack, archive or upstream
licence to trace; the provenance that matters is what was done to them between
the microphone and the repository.

| Field | Value |
| --- | --- |
| Runtime path | `web/public/audio/voice/sim-talking-{1..12}.wav` |
| Author and rights holder | Tim Woodruff |
| Recorded | 2026-09-11, one microphone, one session |
| Source masters | Audacity project directory, outside the repository |
| Delivered as | 48 kHz stereo 32-bit float WAV |
| Shipped as | 48 kHz **mono** 16-bit WAV, 40.3 seconds total, 3.8 MB |

Every edit was made by `scripts/voice-clip-intake.cjs`, which is the only thing
that has touched them. In order:

1. **Folded to mono.** All twelve were single-microphone takes saved as stereo:
   the two channels differed by less than -80 dB, so folding is lossless rather
   than a mixing decision. The tool measures that difference and leaves a
   genuinely stereo file alone.
2. **Trimmed to the voiced range and padded at the END to a whole number of
   ticks.** Clips must be a whole number of ticks because their lengths ARE
   compiled durations - see `content/voice.toml`. Padding goes at the end only,
   because a clip has to start on its first audible sample.
3. **Level-matched DOWNWARD to -33.2 LUFS**, the loudness of the quietest clip
   in the set. Nothing was boosted, deliberately: raising a clip raises its
   noise floor and room tone with it, and the quietest recording would have
   needed about 11 dB. Gains applied ran from 0.00 to -7.43 dB, closing an
   original spread of 7.5 LU.

Loudness is measured as ITU-R BS.1770 defines it, with block gating, rather
than by peak. The unedited originals are preserved outside the repository.

**These are not a mix level.** The clips sit at a consistent loudness so that
random selection does not jump; how loud Sims are in the game is a separate
playback gain, and retuning it must not mean reprocessing the audio.

## There are no third-party audio assets

**As of 2026-09-11 the game ships no BORROWED audio.** The Sim voice clips
above are first-party and recorded for this project. The current Web Audio
layer synthesizes its cues at runtime. Four compact CC0 archives are proposed
in `docs/specs/2026-09-06-cc0-audio-intake.md`, but a proposed or downloaded
archive is not a game asset and is not a provenance entry here.

When an individual recording is accepted, this file must name its pack, source
page, author, licence, archive SHA-256, exact archive entry, every material edit,
and final runtime path. Only reviewed files used by the game belong in the
repository; source packs remain outside it.

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

`assets/sprites/gen/` is five production files, one one-off QA helper, and
Pillow, nothing else:

| File | What |
| --- | --- |
| `style.py` | The palette, the line, the shading ramp, the character build. The style bible. |
| `iso.py` | The projection, the box/slab/cylinder primitives, and the anchoring rule. |
| `chars.py` | Character anatomy and pose drawing for idle, walking, talk, eating, reading, exercise, and fish-watching bodies. |
| `objects.py` | The 368-entry procedural registry and 13 appended wall drawers; furniture, props, directional variants, and character-pose names that delegate into `chars.py`. The complete atlas includes imported Sim frames. |
| `build.py` | Packs the sheet and writes all four output files. |
| `_qa_dump.py` | A one-off native and enlarged crop helper. It is not part of generation or CI. |

**The image and the manifest live apart, on purpose.** The PNG is in
`web/public/` so the dev server, `preview` and the production build all serve
it from the app's own origin at a plain relative URL. It used to sit beside
the manifest in `assets/` and be pulled in by a TypeScript import from outside
the Vite root, which makes Vite serve it through `/@fs/<absolute path>` - a
dev-only mechanism that bakes the developer's filesystem layout into a URL and
needs `server.fs.allow` opened up. The manifest stays in `assets/` because
terri-data's build script reads it, and nothing in Rust ever reads the image.

```sh
python3 assets/sprites/gen/build.py            # write
python3 assets/sprites/gen/build.py --check    # fail if the committed atlas is stale
```

Unlike the PowerShell it replaces, this runs on Linux, so **CI runs `--check`
on every push**. The atlas stopped being a trusted blob and became a
reproducible build output, which the old pipeline could never offer.

## The names are a contract

`content/objects.toml` resolves 30 sprite names. The shell resolves its floor,
walls, selection ring, indicators, carried badges, three people, authored
action frames, and food props by name. terri-data fails the content build on a dangling object
reference, while TypeScript startup and tests fail on a missing shell sprite,
so renaming or dropping an entry breaks the build rather than quietly changing
how the game looks.

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
- A sprite can be visually wider than its collision footprint. The retired
  personal reference shelf did exactly that and appeared to enter the west
  wall. Its aquarium replacement keeps the historical one-tile save footprint
  but biases the opaque cabinet and glass toward the open side of the tile.

## The manifest exists twice, on purpose

`build.py` writes four files in one pass:

| file | read by |
| --- | --- |
| `web/public/atlas.png` | canonical generated texture used by tests and tools |
| `web/public/atlas-<sha256>.png` | byte-identical runtime texture at an immutable public pathname |
| `assets/sprites/atlas.toml` | `terri-data`'s build script, to validate every object's `sprite` and resolve it to an index |
| `web/src/render/atlas.ts` | the renderer, for the rects |

Two manifests rather than one because the two readers cannot share a format
without a new dependency: `terri-data` already reads TOML and the web build has
no TOML parser. They are written from one in-memory list in one pass, so they
cannot disagree unless one is edited by hand, and `web/tests/atlas.test.ts`
reads the TOML and fails if they ever do.

The generated TypeScript also carries the SHA-256 digest and content-addressed
filename of the exact `web/public/atlas.png` bytes. The renderer requests the
hashed pathname. GitHub Pages caches the public PNG independently from Vite's
hashed JavaScript and ignores query strings in its edge cache key; without a
content-addressed path, a returning browser can pair a new manifest with an
older texture for several minutes and abort on the dimension check.

**A sprite's index is its position in that list**, on both sides. Inserting a
sprite in the middle renumbers every sprite after it and silently redraws the
lot with the furniture shuffled, so `objects.SPRITES` is append-only in spirit.
The three ordinary people remain at 1, 48, and 49; conversation occupies 50
through 73; eating occupies 74 through 97; seated reading occupies 98 through
121; the reading indicator remains 122; standing reading occupies 123 through
146; directional walking occupies 147 through 170; and `heldSnack` is 171.
The aquarium's second object frame is 172; the exercise and fish-watching
indicators are 173 and 174; directional exercise bodies occupy 175 through
198; directional fish-watching bodies occupy 199 through 222; and the current
directional furniture suffix occupies 223 through 310. The original moving-box
and personal-reference-shelf records at 24 and 32 are the two intentional
in-place redraws. A decoded-pixel complement digest pins every other record
through 171. A second corrective-subset digest pins both aquarium frames, all
four bike facings, and all exercise bodies, so later shared art passes cannot
silently undo the corrected tank, bike, or pedal cycle.

## What is not done

The household now has three stable baked looks. Walking has directional arm and
leg frames; conversation has directional talk frames; authored snack and
terminal dinner actions combine directional hand-to-mouth frames with visible
food props; the reading chair has seated book frames; and the bookshelf has
upright book frames. The exercise bike has socket-aligned pedalling bodies, and
the aquarium has object-facing watcher bodies plus a subtle two-frame fish
cycle. The selected concept images were visual references only; no pixels from
them enter the generated atlas. Other object categories still use the ordinary
body. They need their own authored action, anchor, and occlusion contract rather
than inheriting art from a broad status label. Per-instance tint and emissive
strength are already live for night lighting, but player-selected character
appearance is not yet content.

Interior walls use tile-centred anchors. Boundary walls follow the outer slab
edges; extending the authored interior layout onto tile edges remains [B7].

## Joined interior walls and doorway frames

Indices 836 through 844 contain the nine elbow, T-junction and crossroad
sprites. Their names encode cardinal bits shared with `tiles.ts`: north 1,
east 2, south 4, west 8. Indices 845 and 846 are `doorwayJoinedNS` and
`doorwayJoinedEW`, with an outlined passage and no border at the panel seam.
The older doorway entries remain available to preserve every existing index.

Junction sprites carry a narrow vertical fold shadow where the visible faces
form a corner. Rear-only branches leave the continuous near face unmarked:
north behind an east-west run, or west behind a north-south run.
`wallCornerStartNS` and `wallCornerStartEW` append at indices 847
and 848 for dividers meeting exterior walls and the back corner. These shade
only the connecting end; ordinary panels and doorways keep their clean edges.
The shadow ends at the skirting and stays within the existing wall silhouette.

`validate_joined_walls_contract` hashes all 836 prior records, including names,
dimensions and decoded pixels. It also checks junction arm coverage, doorway
openings, and exact agreement between doorway and wall edge columns. Atlas
packing may move rectangles without changing their source pixels or indices.

Linear texture sampling is clamped to each sprite's edge texel centres in the
fragment shader. Clamping only to the whole atlas does not prevent transparent
gutters from darkening panel joins at fractional zoom.
