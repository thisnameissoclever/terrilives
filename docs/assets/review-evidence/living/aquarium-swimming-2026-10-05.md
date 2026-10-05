# Aquarium swimming verification, 2026-10-05

This batch extends released main `b04cc50ad8a576e76c78ef66a30ef8596d3cee50`.
It covers fish motion only. Media seating and fitted bathroom bodies are
separate batches in the [interaction design](../../../specs/2026-10-05-interaction-animation-expansion.md).
This record establishes local acceptance, not public deployment.

## Source and physical checks

`assets/models/living/owner-review-pending/aquarium/swimming-01/` retains eight
editable models, 32 original 768x960 RGBA renders, per-model production and
saved-scene receipts, the reduced motion board and four preview loops.
The original accepted aquarium and shared Sim files remain unchanged.

All eight samples retain 44 parts, 47 validated contacts and twelve
fish/facing sightline checks. Reopening each model at final camera registration
reports zero lid-blocked vertices and contained fish. The complete body, eyes
and tail move together; only tail tips deform relative to their attached roots.
The preview is calm station-holding swimming, not tank-wide roaming.

Primary and independent source review accepted the eight-sample loop. The
reviewer inspected the complete board, four previews and twelve originals,
including samples one and seven in every direction. A separate code reviewer
checked all render, model and scene-check hashes. Neither review claims owner
taste approval or physical refraction.

## Runtime and preservation

The new 32 records append at 2483..2514. Every texture is 192x240 at density
two, with the released tank's anchor and silhouette. Runtime holds each sample
for six simulation ticks in a 48-tick cycle. Pause freezes it; reduced motion
holds sample zero. The old two-frame records remain unchanged.

The production pixel guard rejects alpha changes, static-area RGB changes,
duplicate samples, frozen fish, incomplete scene checks, changed receipts,
wrong model identity and lid-hidden fish. It compares the new loop against the
released tank as well as against itself. Fish envelopes come from reopened
saved models at final camera registration, not the earlier construction pass.

`verify-main-prefix.py b04cc50ad8a576e76c78ef66a30ef8596d3cee50` passed for all
2,483 previous decoded sprites and twelve registration/interaction tables.
Architecture resources and normalized geometry retain their published digest.
The atlas still occupies seventeen 2048x2048 pages; no texture density changed.

## Executed local checks

Commands ran in the authorized worktree and exited zero unless noted:

1. `python -B -m unittest discover -s assets/models/living -p 'test_*.py'`:
   37 tests passed.
2. `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'`:
   the final staged-only suite passed 189 tests, including forged scene-check
   and model-identity regressions.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
   --mode no-install -- --locked -j 2`: fresh browser binary built.
4. `npm --prefix web run typecheck` and
   `npm --prefix web test -- --maxWorkers=1`: 1,971 tests in 147 files passed
   against that fresh binary. The production build passed with the existing
   large-bundle advisory.
5. `cargo test --workspace --locked -j 2`: 1,485 native tests passed.
   Formatting and strict Clippy passed.
6. Workflow contract suite: 23 tests passed. Changelog suite: twelve passed.
   Changelog generation and document-ID verification passed.

The first new sampling test failed because the runtime still selected its old
two-frame pair. Removing the completed runtime selector deliberately failed
all four facing tests; restoring it passed all seven aquarium tests. Deleting
the swimming alpha guard failed the changed-alpha regression; restoration
passed. These are targeted fault checks, not a full remote mutation sweep.

## Actual graphics and normal game

The real graphics renderer passed 42 cases: eight samples in four directions,
four night views, five colour choices and Build preview. No graphics validation
or page error was reported. Primary and independent reviewers inspected the
[board](aquarium-swimming-2026-10-05/gpu.png),
[native room](aquarium-swimming-2026-10-05/played-native.png) and
[close view](aquarium-swimming-2026-10-05/played-close.png).

Normal game controls started 1x playback and paused at Day 1, 00:42. A read-only
graphics-buffer observer saw all eight SE sample IDs: 2483, 2487, 2491, 2495,
2499, 2503, 2507 and 2511. No new sample appeared while paused. The aquarium
retains the room's accepted furniture style, with subtle motion at native zoom
and readable bodies and tails close up. A still image cannot certify perceived
temporal smoothness; sample progression and visual inspection are separate
evidence. No player save was overwritten. Owned browser contexts closed in
finally blocks.

## Staged-only verification

Git tree `ecaccc10b886da9b9f8f4c1abd9ce8cd82fc7ad3` was exported and extracted
without the worktree's ignored files. The full atlas freshness check, 189
sprite tests, 37 living-model tests and document-ID check passed there.
Only this verification paragraph and the related documentation lesson were
added afterward; the validated runtime and source inputs did not change.
