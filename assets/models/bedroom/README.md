# Bedroom storage models

Continue the existing offline Blender-to-sprite workflow. Keep Sims, gameplay,
positions and footprints unchanged. Both storage objects remain decorative;
closed drawers do not imply a new inventory or opening animation.

The nightstand measures 0.52 wide, 0.48 deep and 0.52 high, near the existing
bed's duvet height. The dresser is 0.88 wide, 0.50 deep and 0.95 high, giving
it a larger silhouette beside standing Sims. Hardware is included in the
one-tile bounds. Both have warm oak surfaces, satin pulls and four short feet.
The nightstand carries one closed teal book.

1. Run `python -B -m unittest discover -s assets/models/bedroom -p 'test_*.py'`
   before export. This checks physical size, separate drawer fronts and part
   contact before adding bevels.
2. Run background Blender with two threads and `--python render_storage.py --
   nightstand ABSOLUTE_NEW_DIRECTORY`, or use `dresser`. Never overwrite a
   candidate. The unchanged kitchen exporter records source hashes, camera,
   saved model and four genuinely rotated 768x960 originals.
3. Run `check_storage_scene.py` through background Blender with kind, saved
   model and a new JSON result path. Require actual inside-solid witnesses
   after beveling, grounded feet, height and footprint checks. Three deliberate
   displacements must fail; reloading the original must pass without changing
   its hash. These sampled contacts are not an exhaustive collision proof.
4. Build a board using `../kitchen/review_fridge.py`. Inspect all four originals
   and game-size samples, then obtain independent adversarial review.
5. Only accepted source batches enter `../static-props.json`, appended after
   earlier records. Integration still needs renderer and played-room review.

Canonical front is local -Y. At unchanged (2,6), the nightstand should face SW
away from the spine wall; the dresser at (0,10) stays SE into the bedroom.
The existing nightstand placement is beside the bed's outer/foot end, not its
pillows. This batch does not silently relocate or rotate the bed to change that.

Nightstand candidate 01 is rejected for detached drawer fronts and book spine.
Its files and changed source are retained with the rejection reason. Candidate
02 corrects those contacts. The owner delegated per-object acceptance to the
primary and adversarial reviewers; the historical `owner-review-pending` folder
name does not require waiting for the owner.

## Double bed

`render_double_bed.py` uses the unchanged bathroom wide exporter and its
160x176 logical canvas. Pass one new absolute output directory after `--`.
Use `../bathroom/review_wide_static.py DIRECTORY "Double bed"` for the board,
and `check_double_bed_scene.py MODEL NEW_RESULT_JSON` through background Blender.
The checker covers evaluated supports and four deliberate detachments.

Candidate 01 was rejected after room review: its 1.60x1.76 mattress looked too
short and square beside Bill. Its original sources and evidence are retained.
Candidate 02's centered frame is 1.62 wide and 1.95 long; its mattress is
1.50x1.86, raising its length-to-width ratio from 1.10 to 1.24.
Headboard is at local +Y, foot at -Y. Two separate linen pillows and a sage
duvet preserve the existing colors while correcting the old single-width art.
The duvet top is 0.55, its folded edge 0.568, and pillows 0.59. These are
different surfaces, not one maximum-height value. The runtime centers the
unchanged 2x2 placement at (0.5,6.5); do not add another model offset.

The existing double-bed action has two slots but no sleeping pose or foreground.
This artwork does not fix that animation gap. A future two-sleeper implementation
needs distinct body positions and correct occlusion. One shared sleep socket
or the current single-owner composite path would overlap both occupants.

`probe_sim_height.py MODEL NEW_RESULT_JSON` measures the immutable idle Sim
without saving it. `sim-height-reference.json` records a 2.07411 sole-to-hair
height. The mattress is 10.3% shorter; this is not full-extension adult fit.
Do not shrink the Sim or extend the frame into unreserved walking tiles.
A folded sleep pose may fit, but that requires separate evidence. Evaluate
every visible body part, sample, facing and assigned slot. A starting envelope
reserves 0.03 at each end and side: 1.80 long by 0.69 wide per sleeper lane.
Require supported head/torso, no frame penetration or sleeper intersection,
unchanged rig scale and actual GPU occlusion review before calling sleep done.

## Bunk

Candidate 02 replaces the old split bunk with the same registered composite
mechanism as the bike and reading chair. The existing one-slot sleep action,
centered socket, 2x1 footprint and Sim rig are unchanged. A rigid translation
of the whole sleeping rig centers its folded pose on the mattress. This is
a clothed nap atop a fitted sheet, not a simulated blanket or a claim that
the bed accommodates a fully extended adult. SW/NE source rotations remain
review views, not valid gameplay placements with the fixed 2x1 footprint.

1. `render_bunk.py NEW_DIRECTORY` through background Blender generates four
   empty views. `check_bunk_scene.py MODEL NEW_RESULT_JSON` checks actual
   supports and four deliberate detachments.
2. `probe_bunk_sleep.py MODEL NEW_DIRECTORY --all-views` checks every sampled
   sleep pose and generates sixteen beauty views. Three displaced bedding
   or platform cases must fail. `review_bunk_sleep.py DIRECTORY` assembles
   a hash-checked review board without repainting originals.
3. `render_bunk_contributions.py MODEL NEW_DIRECTORY` through background
   Blender exports four empty views and 48 groups of beauty/body/furniture/
   outline, across four facings, four samples and three palettes. `--pilot`
   limits this to one sample/facing in all three colors. Resume is allowed
   only with identical source hashes and Blender version/build.
4. `export_bunk.py INPUT OUTPUT` independently compares all occupied groups,
   checks palette ownership and preserves 2x texture density. It removes only
   verified transparent padding: 320x352 becomes 200x272; the logical anchor
   changes from (80,144.00044) to (50,124.00044). No visible texel is discarded.
5. Independent acceptance records exact manifest, raw-proof and comparison
   hashes in `bunk-reviewed.json`. The atlas uses the strict reviewed loader,
   not the lower-level image loader. It rejects changed inputs, incomplete
   coverage, stale hashes and failed reconstruction evidence. Full local
   acceptance additionally calls `offline_bunk.verify_bunk_generation` from
   `assets/sprites/gen`, requiring every original render's bytes and readable
   1280x1408 RGBA PNG data. Import rejects duplicate resolved raw paths and
   requires all four valid contact samples, exact obstacle inventories,
   no excluded geometry/collisions, and supported torso, soles and head.
   Equal image hashes are allowed for palette-independent contributions. CI imports
   the accepted export and does not claim to rerender or inspect raw images.
   Full-resolution contributions and rejected source models remain local;
   journals, source helpers, accepted model, review images and exports are tracked.

Candidate 02 shipped in PR #81; see `docs/assets/review-evidence/bedroom/bunk.md` for evidence and
`docs/plans/2026-09-17-bunk-asset.md` for the full plan. Never combine this composite with
the old `bedBunkForeground`; that would draw incompatible furniture twice.

Candidate 03 moves the ladder and matching guard opening to local -X, the
near long side in the placed SE view. The head remains at +Y. Its geometry
and sixteen occupied source views passed primary and independent review.
Runtime integration and publication are separate gates; do not treat the
candidate 02 release evidence as proof for this revision.
The candidate 03 runtime review is recorded in
`docs/assets/review-evidence/bedroom/bunk-near-ladder.md`.
