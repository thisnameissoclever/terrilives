# Covered bunk authoring attempts

These 2026-10-04 attempts use local Blender 4.5.14 LTS, build `62c1db4208e8`,
not an image-generation provider. There is no text prompt. The source is the
near-ladder authoring model; the pose comes from the approved double-bed recipe.
The dated [evidence record](../../../../../../docs/assets/review-evidence/bedroom/covered-bunk-sleep-2026-10-04.md)
defines the source hashes and proof limits.

1. `rejected/preview-01/source` contains the first six images. Primary and
   independent appearance review accepted the relaxed body and one duvet.
   Physical review rejected the geometry for 946 evaluated cloth/mattress
   triangle crossings. `rejected/preview-01/bunk_sleep_cloth.py` reproduces
   the original cloth and matches the recorded script hash
   `31ee38f2901ab1dbb4d191ea8b9d1827daed92c458615ce84c837f294a677c57`.
2. The side-hem correction was rejected before another image batch. Its
   diagnostic records retain 332 mattress triangle crossings at the foot wrap.
   The inward thickness reached into the mattress despite valid visible
   surface bounds. No correctness percentage was assigned; this was a physical
   clearance failure, not a visual style comparison.
3. `source-probe-02` contains the corrected source images and immutable render
   receipt. Raising the inset side hems and extending the foot wrap outside
   the mattress removed measured cloth/body and cloth/furniture crossings.
   Primary and independent review accepted all four covered facings. This is
   source-stage acceptance only. Production export, ownership, recoloring,
   game-scale review and publication remain separate requirements.

Uncovered images intentionally hide upper furniture for whole-body diagnosis.
Never use those images as game assets. Do not replace rejected files or relabel
their old physical proof as a fresh run.
