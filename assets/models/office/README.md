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
follows the reviewed bunk in `../atlas-batches.json`. Run
`python assets/sprites/gen/build.py` and the sprite tests after adding an entry.
Never insert it into the frozen first static catalog. See
`docs/assets/review-evidence/office/desk.md` for actual played evidence and limits.
