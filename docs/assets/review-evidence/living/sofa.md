# Long sofa visual replacement

## Scope

Replace only `long_sofa.sprite` with four registered renders of a sage sofa.
Object definition 14, placed entity 11, price 280, 2x1 footprint, location
(10,0), SE base, three interaction slots and all action data remain unchanged.
The render center stays (10.5,0). The approved Sims, other furniture, walls,
collision and saves are unchanged by this batch.

The source is centered, long along Blender Y and facing local -X. SE therefore
faces game +Y into the living room. Unlike the old procedural art, NW and SW
are true opposing views rather than copies of the other fronts. Saved facing
values are preserved; reproducing that old visual defect is not a requirement.

## Source review

Candidate: `assets/models/living/owner-review-pending/long-sofa/candidate-01`.
Deterministic Blender 4.5.14 LTS authoring, no external image provider or paid
request. The accepted Sim supplies camera, lighting and recolored toon materials.
Four 1280x1408 RGBA originals become 320x352 textures on a 160x176 logical canvas.

1. Canonical proof SHA256:
   `b596582f7e72d3be24fcccba671e62435046aca2b527dde23728027029368abf`.
2. Saved model SHA256:
   `075abd2472f09d3933e541a7024f2bf9fb3b2dd67cc5b79d8c4a976f83041b76`.
3. Primary and independent source review passed at 91/100: consistent cushions,
   believable supports, actual front/rear occlusion, smooth padded silhouette
   and style agreement with the accepted dining set. Minor notes: tiny terminal
   dots at cushion seams and a faint rear frame join. No pixel repairs were made.
4. Final `scene-check-03.json`: 14 parts, 18 actual solid-contact witnesses,
   four grounded feet, pinned dimensions and centers, all four physical spans
   and ten rejected damaged copies. The initial journal records an Euler API
   error in the checker. The model did not change during the repair or rechecks.
5. Independent read-only review caught eleven in-memory layout mutations and
   verified all signed inputs, renders, model and catalog hashes. It also
   identified the need to pin part centers, not merely dimensions and contacts.

## Runtime evidence

`sofa-four-facing-gpu.png` is the actual GPU using fresh WASM placements and the
real frame builder. It covers SE/SW/NW/NE, save round trips, all five colourways,
a selected Build preview and the existing generic-use action. No GPU validation
or page errors were observed. No synthetic render rows stand in for furniture.

`sofa-room.png` and `sofa-played.png` show the production build with upstream
conversation-audio changes from main `216e1f95`. Bundle `index-CZX3pTTA.js`,
WASM `terri_wasm_bg-B0_9-sKE.wasm`. The actual Build controls cycled all four
facings and confirmed the original SE placement. After waiting for the command
to finish, the world hash was unchanged: `17846785325641893497`. An earlier
sample read the hash before command processing settled and is not used as proof.

The played check clicked the sofa, resumed, observed Tim using it, then paused
and zoomed. The queue read `Lie down: The Sectional Compromise`, activity 7,
visual action 0, interaction target 4294967295, position (9,0). This confirms
the existing standing generic-use pose, not a reclining animation. Eight web
tests now cover the active action as well as metadata, rotation, saving,
colourways and padding. A source label alone was insufficient evidence.

The Build preview retains the existing per-tile cyan selection rings. Their
internal diagonal can cross the sofa's front; it is an edit-mode overlay, not
part of the image or a clipped sofa. Ordinary placed and played views lack it.
No preview renderer change is included here.

Independent final visual review passed at 92/100 across the GPU board, whole
house and played close-up: scale, front direction, wall contact, all facings,
colourway readability and unclipped silhouette passed. The reviewer inspected
the captures and scene journal rather than independently replaying the UI.

All task-owned browser contexts were closed in finally blocks and both owned
preview servers were stopped. The development proof needed a stable reload
after rebuilding WASM; the successful capture followed the completed build.

## Preservation and verification

Atlas: 1,262 records, 8192x4225. SHA256:
`5fc981a1545a207f8b6605972e95d340bcf362083d7e83cd6df52d4fca41d89d`.
The new four indices are 1258 through 1261. All 1,258 prior names, dimensions,
densities and decoded sprite pixels retain prefix digest
`ca15e11ea383748e9e6cbd5971c067ebb37177ccc0fb54054195e94e6eec1e3c`.
Independent comparison also found all historical anchors, content bounds,
interaction profiles, paired layers, hand metadata and Sim clips unchanged.
Atlas coordinates changed because the existing packer rearranged rectangles.

These commands passed locally with exit 0 after integrating runtime main
`216e1f95`. Subsequent main `48e5e11f` changed documentation only.

1. `cargo test --workspace --quiet`: 1,214 tests.
2. `cargo fmt --all -- --check` and
   `cargo clippy --workspace --all-targets -- -D warnings`.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm --release`.
4. `npm --prefix web test -- --maxWorkers=1`: 1,318 tests in 94 files.
5. `npm --prefix web run typecheck` and `npm --prefix web run build`.
6. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`: 92 tests.
7. `python -B -m unittest discover -s assets/models/living`: five tests.

Clean staged tree `a9b66404668c57dcfe43d04d183af9a639034aaf` also passed the
fresh atlas check, all 92 sprite tests, all five layout tests and exact hashes
for all eight signed inputs without ignored files. Only this evidence
paragraph was added afterward. Documentation IDs and staged whitespace passed.

Merge and public deployment are separate states. Local evidence does not prove
that GitHub Pages is already serving this revision; release status belongs in
the pull request and the delivery report.
