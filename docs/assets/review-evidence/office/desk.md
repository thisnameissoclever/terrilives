# Office desk verification

Candidate 01 replaces the existing desk art without changing gameplay roles,
its two-by-one footprint, (6,6) position, chair at (6,7), or save identity.
The working face now points SW toward the chair. The 0.78 top height is lower
than the kitchen counter's 0.86. The approved Sim model and rig are unchanged.

## Visual and mechanical evidence

1. `assets/models/office/owner-review-pending/desk/candidate-01/` retains four
   original views, editable model, hashed render inputs and contact results.
   Primary and adversarial review accepted the source at a subjective 92/100.
2. `scene-check.json` records 23 parts, six grounded supports, aligned drawer
   faces and evaluated geometry overlap at all required joins. Five deliberate
   displacements each failed for the intended detached part. Clean reload passed.
3. `desk-four-facing-gpu.png` uses the actual SpriteRenderer at 2x zoom, with
   SE, NW, SW and NE columns. GPU validation returned null and uncaptured errors
   were empty. SW/NE align with the fixed two-tile floor strip; SE/NW are source
   rotations rather than supported rotated placements. Both reviewers accepted.
4. `desk-played.png` shows the production build at Day 2, 09:11, with Bill using
   the desk through the normal Work menu action. Front direction, relative
   scale, chair clearance and floor contact passed both reviews. Resuming to
   09:57 completed Work and raised fun from 72.6 to 99. This remains a standing
   interaction, not a new seated animation or proof of hand contact.

Local bundle: `index-DbPv0pb2.js`; WASM: `terri_wasm_bg-DhyoNrh_.wasm`.
The first browser wait used the incorrect label "Working"; the actual existing
HUD label is "Using object". Correcting the check required no app change.
Only the favicon request returned 404; no application or GPU error was seen.
The existing zero-byte invalid-save fixture was not explicitly cleared; normal
play subsequently autosaved. This observation is not a save-migration test.
Both dedicated review tabs were closed after evidence capture.

## Regression checks

The four new records occupy 1213 through 1216 at 320x352 physical pixels,
160x176 logical size. All 1,213 prior records retain their metadata except
repacked X/Y and exact decoded pixels against parent `2709857`. This includes
the accepted Sims, bunk composites and corrected refrigerator.

Commands passed with exit code 0:

1. `cargo test --workspace` and `cargo fmt --all -- --check`.
2. `npm --prefix web test -- --maxWorkers=1`: 711 tests in 57 files.
3. `npm --prefix web run typecheck`.
4. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`: 65 tests.
5. `python -B -m unittest discover -s assets/models/office -p 'test_*.py'`: 3 tests.
6. `python check-doc-ids.py`.
7. `python assets/sprites/gen/build.py --check`: 1,217 sprites, 4096x7926.

The desk layout tests and placement regression failed before implementation.
Batch-order tests rejected an empty loader before implementation. Three batch
tests passed independently in adversarial review, including duplicate and
escaping catalog rejection.

Atlas SHA-256: `94a9cdb354527aa59d9bb8ae942483d8ed9a9434a2b09e7fec6ad8875af877c1`.
Only 266 vertical pixels remain below 8192. Future additions need to respect
the device texture-size limit without reducing accepted sprite resolution.
Publication requires separate green main CI, Pages and public verification.
