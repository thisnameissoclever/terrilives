# Aquarium: four facings and two fish frames

Candidate 06 passes source-art, construction and isolated GPU review. The
production gameplay check is incomplete, so this is not release acceptance.
Branch checkpoints do not establish merge or public deployment.

The existing `reference_shelf` persistence ID remains the aquarium, entity 27
at (6, 10), price 220 and a one-tile footprint. Watch the fish keeps its current
standing body art and gameplay. No approved Sim art, rig, save schema,
interaction tuning or shared exporter was changed.

## Source and construction

The cabinet, pale aqua tank, thin charcoal lid, two doors, plants, rocks and
three fish preserve the selected reference's identity. The model stays within
one tile. A -90 degree child rotation preserves the old SE door direction.
The tank's back-facing panes are an opaque aqua background; front panes use
a thin tint. This keeps the water above the renderer's alpha threshold and
does not claim physically accurate glass or refraction.

Both frames retain four 768x960 RGBA originals, an editable Blender model and
a proof binding 12 source inputs. Independent source review accepted the art
at a subjective 92/100. This score is neither a measured correctness rate nor
owner approval. The rejected attempts and their causes are recorded in
`assets/models/living/owner-review-pending/aquarium/attempts.md`.

1. Each saved scene passed 44-part construction checks and 47 evaluated
   contacts. All non-glass meshes are closed and connected; each glass pane
   is an intentional single sheet. The plinth reaches the floor.
2. Rays from every evaluated fish body, tail and eye vertex toward all four
   orthographic cameras hit no lid in either frame: 24 fish/view checks.
   Fish containment is checked separately from their visibility.
3. Six damaged scenes were rejected for the intended reasons: shifted root,
   floating plinth, detached handle, floating plant, escaped fish and fish
   hidden by the lid. Removing each of five guards broke that rejection
   proof. The clean saved model remained byte-identical.
4. The saved `scene-check.json` bounds use the final registered camera.
   `proof.json` embeds earlier construction checks whose pixel bounds precede
   final registration. Those earlier bounds are not motion-mask provenance.
5. Motion regions cover the union of both frames' projected fish bounds,
   rounded outward with four texture pixels of padding for outlines,
   downsampling and local shading. The paired textures have identical alpha
   and identical RGBA outside those regions. Each fish changes pixels not
   shared with another fish's region. This bounds incidental shading; it does
   not prove that every changed pixel inside a region is fish anatomy.

Frame 0 model SHA256:
`aaac96316d14220f8cc097b629c5696ea34e13d10ca9dac4060afaae8545e859`.
Frame 1 model SHA256:
`6d09de030c416d2fda3825418d25058c856cd1ce6dc9e47db23335bdddd476c1`.
Canonical proof digests:
`af0337623fe1bbf0cc33b418de72d0c023ff66a659f00582018d54f15ad8aaa7`
and `65b9281355635970ce6a6def1dc745ba1da5040c04c242eba50a95ffa243ab9c`.

## Renderer evidence and open gameplay check

`aquarium-gpu.png` contains 18 actual-renderer fixtures: two frames and a
midnight view per facing, five restored colourways and Build preview. GPU
validation and error lists were empty. Independent visual review accepted
all panels. Three fish remain recognizable; lighting darkens the whole object
at midnight. Source emission is zero, separately checked from received light.
The preview suppresses the original row and keeps the selected colourway.

These fixtures construct simulation state and invoke the real renderer. They
do not establish ordinary player interaction, perceived animation smoothness
or visibility beside the actual room's furniture. The production UI check
must still cover rotation, picking, paused save equality, Watch the fish,
normal 1x playback, faster playback, day/night and room-scale appearance.

The first local navigation failed before the preview server became ready.
After readiness was verified, the isolated GPU check succeeded. A later
attempt to load a saved Playwright verification script was denied because
the worktree is outside that browser tool's allowed file roots. The gameplay
check did not run. The denied path was not retried through another access
route. Both task-owned servers were stopped and browser contexts closed.

## Preservation and automated checks

Eight records append at 1370..1377, with SE/NW/SW/NE for frame 0 followed by
the same order for frame 1. Textures are 192x240 at density 2 on the existing
96x120 logical canvas. The 24-tick frame hold and 48-tick object cycle are
unchanged. Object animation has no entity phase; reduced motion uses frame 0.
The old procedural pair remains intact for existing references.

The atlas contains 1,378 records at 8192x4826. Atlas SHA256:
`2bcad1f957d8b6b97692837afc36a88b9c4d7dd8a0fffde7984ff383f90b800a`.
All 1,370 prior record names, dimensions, densities and decoded crops, plus
nine registration/interaction tables, passed independent preservation review.
The source/renders/model hashes and content-addressed atlas duplicate also
matched. Independent in-memory checks caught 12 individual-fish freezes,
four alpha changes and four RGB-only escapes from the motion regions.

Passed locally before this documentation update, all command exits 0:

1. `cargo test --workspace`: 1,215 tests across five nonempty suites.
2. `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings`.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
4. `npm --prefix web test -- --maxWorkers=1`: 1,384 tests across 102 files.
5. `npm --prefix web run typecheck` and `npm --prefix web run build`.
6. `python -B -m unittest discover -s assets/models/living`: 34 tests.
7. `python -B -m unittest discover -s assets/sprites/gen`: 122 tests.
8. `python -B assets/sprites/gen/build.py --check`: current 1,378-record atlas.
9. `python check-doc-ids.py` and `git diff --check`.

The source-layout, frame-motion and integration tests were observed failing
before their implementations or new atlas records existed. The 20 restored
facing/colour combinations preserve save bytes, world hash, placement and
footprint. A real WASM active-watch save restores the same action beside the
tank. Those automated state checks do not close the played acceptance gap.

Staged-only tree `146d1d887a3a35d96f00637744f80ee3a3703238` passed atlas
freshness, all 122 sprite tests, 34 living-model tests and documentation IDs
without ignored local originals. Both sets of 12 source inputs, eight images,
two models, saved construction receipts and the atlas duplicate matched their
hashes. All 12 motion regions exactly matched the saved-camera projections
with the stated padding. The verification command exited 0. This paragraph
was added afterward and changes no source, artwork or runtime code.

Independent review found no documentation mismatch at the original base,
`9fe41f2f33599a9fee667f6e87ef80381a58e24c`.

## Integration with newer main

The worktree subsequently fast-forwarded to
`9fdf635cfb8bbc524020dea678a6177e02d7a6f4`, preserving the staged aquarium
changes separately from an untracked ottoman animation prototype. Main added
conversation-volume controls, source-owned object recording playback and an
offline sound-audition tool. No aquarium source, sprite or Rust file changed
upstream. Existing remote documentation was retained during the union merge.

The combined tree passed `npm --prefix web test -- --maxWorkers=1` with 1,440
tests in 104 files, `npm --prefix web run typecheck`, and
`npm --prefix web run build`, all exit 0. The new JavaScript bundle is
`index-B3oQVLEC.js`; the WASM remains `terri_wasm_bg-Dr1PaD1j.wasm`. Document-ID
and staged/unstaged whitespace checks also passed. The unchanged Rust and
asset suites were not repeated merely because unrelated audio code arrived.
The earlier isolated GPU evidence predates this synchronization. Played
verification still has not run, and these checks do not claim it has.

The next synchronization fast-forwarded to
`a199fc4d978ae2229db3f50f4fb896506be53ca4`, including Sim details, conversation
download recovery, shower audio and clarified Pages publication evidence.
The aquarium's staged source and pixels remain unchanged. Its atlas still
hashes to `2bcad1f957d8b6b97692837afc36a88b9c4d7dd8a0fffde7984ff383f90b800a`.
The tracked-work checkpoint is retained at
`d6cf83cc8ff474505fa85bec8990af2d3b059174`; restoring it preserved newer main
documentation and kept the separate ottoman content/tests unstaged.

The bundle and web results above predate this second synchronization. The new
Sim-details bridge requires a matching rebuilt WASM module before another web
acceptance run. No browser verification, source merge or deployment is claimed.

The current base is `d0c7f45d0df141418364e38412308272bc588874`. A fresh WASM
build and the combined aquarium/ottoman tree passed Rust tests, Clippy,
formatting, 1,577 web tests, type checking and the production build. The aquarium
source and its eight decoded sprite records are unchanged. The separate
ottoman integration appends after this aquarium checkpoint; its additional
sprites are not part of the 1,378-record aquarium atlas described above.
Played-room verification remains pending because the browser access question
has not been resolved. The branch may be saved without treating it as a release.
