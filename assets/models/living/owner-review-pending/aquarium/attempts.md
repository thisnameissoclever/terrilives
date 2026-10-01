# Aquarium candidate history

All attempts use locally authored Blender geometry, the approved Sim camera
and material family, and two frames in four directions. No image-generation
model, text prompt, external provider or paid request was used. Frame proofs
record exact source hashes, Blender version, camera and output hashes.

1. Candidate 01: rejected. Most fish are hidden by the opaque lid; the glass
   also mutes their colour. Originals and source snapshot are under rejected.
2. Candidate 02: rejected. Taller glass and lower coral fish improve the view
   but still leave fish silhouettes clipped by the lid. Transparent tank pixels
   also fall below the runtime alpha threshold. Not integrated into the game.
3. Candidate 03: rejected. Rear panes now provide an opaque water background
   and the cabinet faces its original direction. Fish remain blocked in SE,
   SW and NE. The saved model fails the new lid-ray check. The cabinet and
   alpha are identical between frames, but 16 low-amplitude RGB differences
   outside the SE fish projections also prevent acceptance.
4. Candidate 04: aborted before rendering. The new construction check tried
   to read an unsupported `Euler.length` property. The failed receipt records
   the exact error. Check rotation components individually instead.
5. Candidate 05: aborted before rendering. Converted plant curves had unwelded
   caps and failed the closed-mesh check. Welding coincident vertices and
   recalculating normals fixed the source rather than weakening that check.
6. Candidate 06: accepted for source art and isolated GPU rendering by primary
   and independent reviewers. The independent source-art score is 92/100,
   a subjective judgment rather than a calibrated metric. All three fish
   remain visible below the lid in both frames and all four directions.
   Cabinet pixels and alpha stay fixed. Normal played-room acceptance remains
   incomplete; this candidate has not been published or owner-approved.

After three failed visual attempts, a fresh-context adversarial review
identified the missing constraint: full body and tail sightlines under the
lid, measured for both frames from all four cameras before rendering again.
Candidate 06 passed those measurements, then visual review. Its two saved
models, eight originals and hash-bound proofs are retained in `candidate-06`.
The runtime board is `docs/assets/review-evidence/living/aquarium-gpu.png`
relative to the repository root. The full evidence record is beside it in
`aquarium.md`.

Candidates 01 through 05 are under `rejected`, including the failed receipts
for 04 and 05, which produced no images. Rejected Blender files remain local
and ignored; rejected originals and receipts are tracked. Candidate 01 and 03
include model-script snapshots. Candidate 02 has no retained script snapshot;
its original hashes are recorded, but exact source reconstruction is unproven.
There was no image prompt or image-generation model in any attempt. The model
generator was Blender 4.5.14 LTS, using the scripts named in each receipt.
