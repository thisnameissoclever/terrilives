# Window release publication blocker

Observed on 2026-10-02. PR #206 merged at `303f6fb9`, but main CI run
`37050028163` failed before Pages publication. The cooking-contact test joined
recorded Windows backslash paths as literal Linux filenames. This left the live
game on its previous build, including the old window controls and thin walls.

Revision `59072eef41a9422ca35e06c16dd2e9461190ee7c` decodes model-relative
Windows and POSIX paths before joining them to the model directory. Absolute
paths and parent traversal remain rejected. Every existing producer, model,
sample hash and physical-contact assertion remains enforced.

## Local evidence

The implementing worker ran these checks serially and observed each exit.

| Check | Result | Exit |
| --- | --- | --- |
| Original path joined under `PurePosixPath` | Expected failure: backslash remains a literal filename | 1 |
| `python -B -m unittest discover -s assets/sprites/gen -p test_dining.py -v` | Five tests pass | 0 |
| Delete only separator decoding; repeat focused command | Three intended regressions fail | 1 |
| Restore exact bytes; repeat focused command | Five tests pass | 0 |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | 166 tests pass in 46.505 seconds | 0 |
| `python assets/sprites/gen/build.py --check` | 2445 historical and 472 architecture records unchanged; atlas up to date | 0 |

The restored working-file SHA-256 is
`f1f0de87013440f933c1523e654b8eca947a9a91a6f8df309495c28ae4e01d37`.
The producer, accepted proof and all 32 contact PNGs remain byte-identical to the
baseline. The proof SHA-256 remains
`a1c9bee625c13787ac9b9218f6e6d2aece7b7a68f190838b583d990d9d2b3163`.
No new Blender render or physical-art acceptance is claimed.

Rust, WebAssembly and browser checks are unrelated to this test-only path
decoder and were not repeated. The public October 2 note already describes the
window release; this internal publication fix adds no player behavior or new
public bullet. Fresh adversarial review approved `59072eef` with no actionable
findings after checking path semantics, immutable evidence and unchanged
assertions.

## Publication

PR #207 merged as `a1941ee3fbcb17b70ac899a4d09581df3715d445`. Main CI
`37060172496` and Pages run `37060998697` succeeded, including the deploy job.
GitHub deployment `6817693201` records that exact SHA. The public game serves
`index-CaloQlji.js`. An isolated live-browser check found the enabled Windows
control, all nine choices and successfully fitted a Sash window on the rear
wall at `(axis 0, x 0, y 3)`, with no browser errors. See [live.json](live.json).
The task-owned context closed in `finally`; no owner save was accessed.
