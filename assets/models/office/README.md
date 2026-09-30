# Office furniture

Continue the accepted offline-model-to-sprite pipeline. The desk replaces
existing art, not gameplay. Keep its two-by-one footprint, (6,6) placement,
eating-surface role, work action, save identity and approved Sims unchanged.

The design is an oak top and three-drawer pedestal with dark metal left
supports. Every rail has explicit support contacts. A long tabletop spans
local X; the front is local -Y. Use SW in the actual room so the long dimension
matches the reserved X footprint and the working face meets the existing chair.
SE/NW renders are source views, not valid rotated gameplay placements while
the footprint remains fixed. Height is 0.78 versus the kitchen counter's 0.86.

1. Test physical bounds, separate drawer fronts, rail endpoints and floor contact.
2. Render four views through the unchanged registered wide camera and Sim toon
   materials. Keep an editable saved model and input/output hash journal.
3. Probe evaluated geometry, including both ends of each rail and drawer pulls.
   Deliberately detach parts; require failures and an unchanged clean reload.
4. Review original views and game-size samples independently. Retain rejected
   candidates and reasons. The owner delegated acceptance; do not wait per asset.
5. Append accepted art without renumbering the existing bunk or static props.
   Review actual room scale, chair clearance, front direction and visible picking
   before publication. Artwork does not establish a seated work animation or
   arbitrary desktop placement support.

Render with background Blender and `render_desk.py -- <new-absolute-directory>`.
Then run `check_desk_scene.py -- <absolute-model.blend> <new-absolute-result.json>`
in background Blender. Require a passed result, deliberate broken-join failures
and unchanged model hash. Run `python -B -m unittest discover -s assets/models/office`
for layout checks.

Accepted desk art is the first entry in `../static-props-02.json`. Its batch
follows the reviewed bunk in `../atlas-batches.json`. That catalog is now frozen:
bookcase and cutaway-wall records follow it. New desk-chair art is in
`../static-props-03.json`, loaded after those wall records. Run
`python assets/sprites/gen/build.py` and the sprite tests after adding an entry.
Never insert into a batch that has published records after it. See
`docs/assets/review-evidence/office/desk.md` for actual played evidence and limits.

## Desk chair

`chair_layout.py` describes the armless slate-upholstered chair and its
five-spoke, paired-caster base. `chair_model.py` builds the rounded geometry
with the accepted shared toon materials. Its baked front is local -X, so the
standard SE export points game +Y as the old chair did. Existing placement
(6,7), NW facing, one-tile footprint, price and save identity are unchanged.

Render with `render_chair.py -- <new-absolute-directory>` in hidden background
Blender, then run `check_chair_scene.py -- <saved-model> <new-result.json>`.
Use the result files, not the launcher exit, to confirm completion. The checker
tests solid-overlap contacts, ten wheels touching the floor, rear-shell
concealment and six deliberately damaged scenes. Attachment alone is not
proof that a support stays hidden behind its covering surface.

Candidate 01 is rejected for rear-shell breakthrough. Candidate 02 fixed that
but failed runtime review: its NW image faced sideways to the desk. Both retain
their source scripts and rejection reasons. Candidate 03 corrects the authoring
basis without changing any saved facing or the shared exporter. Pure-layout
and saved-scene checks derive the physical front from the seat and back under
all four rotations, rather than trusting facing labels. Candidate 03 passes
primary and independent source review at 92/100.
Each has four separate originals, an editable scene, hashes and a review sheet.
The accepted set appends four sprites at records 1246 through 1249, protecting
all earlier decoded pixels with `test_office_chair_prefix.py`. The physical
192x240 textures render at logical 96x120 with density 2, using the unchanged
registered camera and world-origin anchor.

This chair has no interaction of its own. Static wheel geometry is not an
animation; an empty chair under a desk does not prove seated body fit. See
`docs/assets/review-evidence/office/chair.md` for runtime evidence and limits.
