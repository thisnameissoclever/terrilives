# Double-width bed artwork

Candidate 02 corrects a visual/data mismatch: the object occupies 2x2 tiles,
but its old generator used the same 1.90x0.86 span as the single-width bunk.
The new centered oak frame is 1.62x1.95 with a 1.50x1.86 mattress and two
separate pillows. The sage and linen colors remain consistent with the room.

## Scope

Only the double bed's sprite changes in content. Its ID, name, position (0,6),
2x2 footprint, two slots, 210-tick action and need effects remain unchanged.
The runtime already centers its row at (0.5,6.5). This model adds no offset.
No approved Sim art, bunk layer, socket or save schema changes.

**Unfinished behavior:** the existing double-bed action has no authored body
pose. Bill still stands beside the bed while its HUD says Sleeping. This
static replacement does not claim lying, two-body occupancy, duvet interaction
or enter/exit animation. That requires distinct per-slot body positions; a
shared single socket would put both sleepers in the same place.

## Source and saved model

Proof SHA-256: `6c7f216df0c4302dd53b3e6de700081792aac300359657bd9144924f28f6bf81`.
Model SHA-256: `3ad570674e768e07bbd6e2d9cac6dfd58a9b59e3202f2be4d5d782dd7f973d9f`.

All four 1280x1408 RGBA originals use the unchanged registered wide camera,
lighting and toon material process. Primary and independent source review
accepted candidate 02 at a subjective 91/100; subsequent room review accepted
its floor contact, wall and approach clearance, facing and relative scale.
This score is a visual judgment, not a probability of correctness.

Candidate 01 was rejected after comparison with Bill. Its near-square
1.60x1.76 mattress looked short; original source files, model, renders and
rejected room/GPU images remain in its directory with `SHORT_SQUARE_MATTRESS`.
Candidate 02 raises the length-to-width ratio from 1.10 to 1.24.

The read-only idle-Sim probe measures 2.07411 from soles to hair and confirms
the immutable model hash. The 1.86 mattress is 10.3% shorter, so it cannot be
claimed to fit a fully extended adult. A folded pose remains plausible but
unproven. No model shrink or overhang into walking tiles conceals that limit.
The bedroom README records per-slot bounds, support and collision gates for
future sleep work.

The saved-scene checker finds evaluated-mesh interior contact witnesses,
four floor contacts, a double-width mattress and separated pillows. It rejects
four moved parts: foot, pillow, duvet fold and headboard inset. A clean reload
passes without changing the saved model hash. These sampled probes are not
an exhaustive collision or future animation-clearance guarantee.

## Actual renderer and played game

`double-bed-four-facing-gpu.png` draws SE, NW, SW, NE on four 2x2 floor patches
through the real SpriteRenderer. The fixture includes the actual half-tile
offset on both axes. GPU validation returned null; no uncaptured errors were
observed. Each model stays centered and inside the four floor tiles.

`double-bed-played.png` shows the production preview at 07:22, with Bill at
the foot of the bed for adult-scale comparison. `double-bed-default-camera.png`
retains the 1280x720 whole-lot vertical framing. The bundle is
`index-BuioeoZq.js`, with `terri_wasm_bg-BAuqpmk2.wasm`.

Using normal controls, Bill selected The Restorative Unit / Go to bed, reached
Sleeping at 07:21, and resumed Walking at 11:00. Energy rose
from 67.6 to 100 and comfort from 86.5 to 92.4. This checks the existing action,
not a correct sleeping pose. The one console error was a development-server
favicon.ico 404 before navigating to the production preview.
The previously documented invalid-save fixture remains untouched; browser
save migration is not claimed. The dedicated review tab was closed.

## Regression checks

All commands passed with exit code 0:

1. `cargo test --workspace --quiet`: 689 tests.
2. `npm --prefix web test -- --maxWorkers=1`: 706 tests in 56 files.
3. `npm --prefix web run typecheck` and `npm --prefix web run build`.
4. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
5. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`: 52 tests.
6. `python -B -m unittest discover -s assets/models/bedroom -p 'test_*.py'`: 5 tests.
7. `python -B assets/sprites/gen/build.py --check`: 1,137 sprites, 4096x6803.

Four new views append at indices 1133 through 1136. A direct comparison to
Git parent `bfc5527` confirms unchanged metadata except repacking coordinates
and identical decoded pixels for all 1,133 previous records. The prefix test
also pins the previous record set. The new picking tests failed before import
and pass with all four registered views and transparent margins.

Atlas SHA-256: `69ff8dcd012b7f3fef99fb95e46822411d5f842482b62e9dbaff7268a5d5fdf5`.
Publication requires separate green main CI, Pages and live verification.

## Published verification

PR #80 merged as `d09c065590c098380ece30b58d7ad801e76b9686`. Main CI
35306090738 passed. Pages 35306253099 passed, including the actual deploy
step reporting success for that revision.

The public game loaded `index-D7ZIWSni.js` and `terri_wasm_bg-CajaJaKP.wasm`
on 2026-09-17. Its atlas returned HTTP 200 and the downloaded bytes matched
the SHA-256 above. `double-bed-live.png` shows the double bed, storage and
corrected kitchen in the running household, paused using normal controls.
The saved game loaded; no console ERROR entries were recorded. The dedicated
tab was closed. This verifies the published static bed art, not a new sleeping
animation or seated interaction.
