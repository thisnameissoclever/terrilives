# Usage-driven grime verification

This local candidate is based on origin/main at 1a138df6. Main was pulled before
implementation, including its seated-media changes, and pulled again at the end;
the final pull reported Already up to date. This record does not claim a commit,
merge, deployment or owner acceptance of the new visuals.

## Behavior evidence

The native workspace passed, including 983 simulation tests and 177 WebAssembly
boundary tests. The final browser suite passed all 2,013 tests with one worker.
Two later interaction-specific tests and stronger gradual-wiping checks passed in
the final 43-test chore run. Formatting, lint with warnings as errors, type
checking, WebAssembly and production builds, release boundary tests, atlas
reproducibility, changelog checks and document IDs passed. Commands and exit codes
are in `checks.json`; the final added-test run is `coverage-final.log` and its lint
is `lint-coverage.log`.

The first final web run failed two fixtures that expected the previous optional
envelope length. Their exact byte boundaries were extended for the new field,
then the entire web suite passed. Historical nested records and released binary
fixtures were not rewritten. Earlier fixture attempts also exposed an unowned
walking path being replaced by autonomy. Its corrected test runs the actual
prepare/movement/apply phase and checks exact random state across tile entry,
arrival, standing and save/load.

Five temporary faults independently removed the walking hook, reversed completion
ordering, disabled wall contact, removed the surface multiplier and dropped patch
persistence. Each produced an assertion failure. Every file was restored to its
exact recorded SHA-256 bytes in a finally block. The initial walking mutation had
a missing semicolon and failed compilation; that attempt is retained separately
and is not counted as detection. Lint-only borrow scoping and test initializers,
a floor-status label, and the preview fixture were adjusted afterward; final
candidate hashes are separate from the mutation restoration hashes.

## Played captures

`browser-proof.json` records the actual simulation values used in the captures.
The selected Sim starts beside nine dirty tiles, with normal need drain,
personality, careers and autonomy. No frozen needs or forced-away housemates are
used in these browser captures. `Do now` is activated through the Chores panel.

All nine cells began at 1000 units. The first work tick reduced each to 958; after
12 work ticks each was 496; after 24 each was zero. Saving and loading at the
midpoint retained the exact world hash. A different housemate created 100 units
on cell 84 outside the patch, which cleaning correctly preserved. Needs declined
through the sequence. Console warnings and failed requests were empty.

The 10%, 50% and 100% captures show the same stain placements with increasing
opacity. Full-context and detail captures are included. Phone verification at
390 by 844 pixels reached the same nine values of 496, with no horizontal overflow
or graphics warnings. Isolated browser contexts closed in finally blocks. The
owner's existing preview on port 5193 remains available and paused; its saved
household was preserved.

These are sampled rendered states, not a recording of uninterrupted animation.
Surface fading is additionally verified through actual timed native work and
save/load tests. Every camera angle and nighttime lighting was not independently
played in this pass; existing renderer tests and the shared lighting path passed.

## Ordinary household measurements

`grime_balance` runs two seeds for three game days at cleanliness 0, 0.5 and 1.
It changes only cleanliness for the comparison and retains normal needs,
autonomy, careers, chore responsibility and preferences.

| Cleanliness | Final dirty tiles | Final floor grime units | Observed floor work ticks |
| --- | --- | --- | --- |
| 0, messiest | 48-57 | 8400-9600 | 247-392 |
| 0.5, neutral | 28-39 | 4300-5400 | 278-352 |
| 1, cleanest | 13-16 | 1700-1800 | 0 |

Both seeds recorded zero dirty tiles that had never been visited. These bounded
runs establish the expected direction and demonstrate reachable cleaning work;
they do not establish long-term balance for every household or layout.

## Independent review

The review found three defects: unstable ordinary completion order, diagonal
cleaning across blocked tile corners, and missing unavailability when a floor
plan was pruned after a partition. Each was fixed and covered by a regression.
The recheck found no remaining actionable issue in those fixes and verified all
five mutation restoration hashes. The reviewer separately inspected the five
opacity/cleaning detail captures and found no visual defect. It confirmed stable
stain placement, progressive transparency, retained floor/furniture appearance,
and no stain overlay on the selected Sim. Its visual review was of stills and the
recorded values, not an independent interactive play-through.
