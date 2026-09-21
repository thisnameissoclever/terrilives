# Sim hair direction: preserved evidence

These files were copied out of the local `.tmp/` scratch folder on 2026-09-21,
when `.tmp/` was added to `.gitignore`. Until then they existed only on one
machine, although `docs/specs/2026-09-07-sim-hairstyle-direction.md` cited them
as the record of the hairstyle decision.

## Files

| File | What it is |
| --- | --- |
| `concept-prompts.md` | The four prompts that produced the concepts in `docs/assets/sim-hairstyles/`, copied verbatim, so its input paths are the original local ones. The first input was a local pre-hair render that was not preserved; a new concept round should use the approved Sim as its identity reference instead. The second is tracked as `docs/assets/aquarium-exercise-bike/reference-aquarium.png`. |
| `concept-records.json` | The concept round's scoring record: each concept's score and concerns, the reviewer's verdict, the owner's selection and the SHA-256 of every input and output. The generator's local output paths were removed and the file paths made repository-relative. |
| `tripo-source-prompt.md` | The prompt that isolated the selected hair from concept 01 to serve as the Tripo input. |
| `four-facing-study.png` | The approved model at four physical rotations, with sprite-size samples. Together with `assets/models/sims/sim-01/source/approved-comparison.png` it is the accepted source checkpoint. |
| `visual-review.json` | The two review verdicts, the remaining concerns and the owner's approval on 2026-09-09. |

## The Tripo generation

- **Authorization:** a hair-only experiment capped at USD 2, within the
  original USD 10 test ceiling, given on 2026-09-07 and resumed on 2026-09-09.
- **Request:** `image_to_model`, model `v3.1-20260211`, detailed geometry and
  texture quality, PBR on, model and texture seed 17091, face limit 200000,
  quad output, smart low-poly and part generation all off.
- **Cost:** 60 credits at USD 0.01 per credit, so USD 0.60. The charge matched
  the reported credits and the balance change exactly. Nothing was left
  frozen and there was no unexpected charge.
- **Input:** SHA-256
  `742c846dd8652f982ba646a5c0a71673e57c2ca68250af00ebf41448b2fe5f4d`.
- **Output:** `output-pbr_model.glb`, SHA-256
  `4973f5bbe9a9a822b8a08fd864eac3faf6baa350cd6ad2589e580a00f548950f`, tracked
  byte for byte as `assets/models/sims/sim-01/source/original-hair.glb`. The
  fitted scene is tracked as `approved-neutral.blend` in the same folder.

## What was not copied, and why

The raw request, submission, task, download and spend logs remain in the local
`.tmp/sim-tripo-hair-20260909/` folder. This repository is public, and those
logs carry the account balance and provider identifiers, namely a client ID, a
task ID and an upload token, which add nothing as evidence. Everything a reader
needs from them is summarized above.

The scripts that called the provider are there too. They hard-code this one
experiment's budget checks, so they would need reworking before any later
paid run rather than being reusable as they stand.
