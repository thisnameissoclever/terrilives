# Closing impact without hinge squeak

The owner requested removal of the loud, high-pitched door squeak on opening
and closing, retaining the impact on closure. Opening is silent. Closure uses
the prepared `close-thunk.wav`, derived from the preserved CC0 closing export.

## Preparation evidence

`node scripts/build-door-thunk.mjs` produced 15,360 stereo PCM16 frames at
48 kHz, 0.32 seconds, 61,484 bytes. SHA-256:
`3df7b05fe5101da61d0f06e523b52f0f038bee32c22fca2569107bf58f087cc3`.
The recipe retains the initial impact and decay, applies two cascaded 1 kHz
low-pass filters and 10 ms edge fades, and excludes the later noise. Original
source files and prior exports remain intact.

Over the same 15,360 left-channel frames, peak falls from 0.898499 to 0.440674.
A first-order 2.5 kHz high-pass energy comparison falls from 36.79813 to
0.40876. Signal energy remains 62.69538 versus 129.88407, preserving a nonzero
impact. At existing playback gain 0.05, the un-faded left-channel peak is
0.022034 before Effects. These are measured signal properties; speaker
listening acceptance requires the owner's listening feedback.

## Regression evidence

`npm --prefix web test -- --maxWorkers=1 tests/door-thunk-assets.test.js`:
PASS, 3 tests, exit 0. Tests verify the shorter nonzero impact, reduced sharp
energy, silent endpoints, exact reproducible bytes and rejected source changes.

Removing filtering by assigning `sample * envelope` instead of
`second * envelope` failed two assertions, exit 1: high-frequency energy was
36.797848 against a maximum 0.735963, and rebuilt bytes differed. Restoring
the mechanism passed all 3 tests. Generator SHA-256 before and after:
`8d69b781786774f5a40e4e2fa3d69b3edea32ff64cc348cc7bf85984ed58f7e5`.
The shipped WAV hash was unchanged throughout.

The displayed Chromium native proof `proveDoorRecordings()` passed eight cases:
opening peak 0; closing peak 0.02203369; four aligned closures peak 0.08813477.
All cases ended within 0.32 seconds and released their sources. Load, mute,
Effects zero and background stopped output after the boundary. The existing
short-cue pause policy allowed the current closing impact to finish. Each fresh
controller requested exactly one closing file. The proof page's only console
error was its absent favicon. The page closed in a finally block.

A displayed development game at `?stress=0` ran to tick 354. It requested only
`audio/doors/close-thunk.wav`, played seven closures, and played zero openings.
Four portal tracks retained capacity four and the final sampled door voice
count was zero. Root inspected the rendered house, people and door leaves at
Day 1, 00:14. This establishes visible gameplay and real scheduler activity;
it is not speaker listening approval. The game page closed in a finally block
and its task-owned server stopped. An earlier generated-bundle setup failure
was corrected before this run and is recorded in lessons learned.

## Controller and final build

1. Full web suite: `npm test -- --maxWorkers=1` in `web/`, PASS, 115 files and
   1,718 tests, exit 0. Final focused controller/door/assets tests after the
   typed test-spy correction: five files, 226 tests, exit 0. Typecheck, build,
   `python check-doc-ids.py` and `git diff --check` passed, exit 0.
2. Deleting the silent-opening guard failed the focused regression: expected
   zero buffer sources, received two. Restoring the old closing URL failed
   the exact request assertion. Both exited 1 and were restored. Final
   controller hash before and after:
   `e2cd1af20367a7af78f7663fd1853597f3bc4f08e782fc30b5390bb586fd4d4d`.
3. Root played the production build at `http://127.0.0.1:5223/?stress=0`,
   dismissed Help and selected 3x through visible controls. By tick 92 the
   real sampler had played one closing thunk and zero openings, with four
   portal tracks and one currently playing closing source. The sole door
   request was the new file. Root inspected the rendered production house
   and door leaves; the retained screenshot is
   `docs/assets/review-evidence/audio/door-thunk/production.png`.
4. Production entry was `index-B2A11WbB.js`, SHA-256
   `a8a5fcb7348c12693915bb196464373d4e4b9eea2c1ee7c5d8449360b4b9db0a`.
   Reviewed WASM SHA-256 remained
   `da49265e97644cb5f3dcc2aef11ef0406a0682f468145d0df472640d929bf9dd`.
   The production console errors were favicon 404s only. The page closed in
   a finally block and the preview server stopped.

No new memory acceptance sweep was required for this content replacement and
reduced clip catalog. Existing lifecycle tests and native rendered output
exercise the current controller; this result does not clear held audio PRs.
