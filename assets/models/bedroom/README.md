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
