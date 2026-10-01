# Solid door verification

Status: implemented and independently reviewed; the owner approved the visuals
and authorized delivery on 2026-10-01. Publication is verified separately.

The replacement model has a solid oak leaf, hardware on both faces, a joined
casing and a threshold fitted inside the opening. It exports four orientations
and nine swing poses at density 3. Surface-depth textures place the leaf and
casing by their evaluated geometry; a floor tag keeps the threshold beneath
feet. The two horizontal doorways now join the three vertical interior doors
and front door in the shipped house. Save format and gameplay collision rules
are unchanged.

## Visual evidence

The first candidate's outline was too heavy, and its threshold extended past
the casing. The revised candidate uses 1.4-pixel physical brown contours in
place of 4-pixel contours, lighter panel contrast, and a threshold bounded by
the casing faces and jambs. The editable source and generation instructions
are in `assets/models/doors/README.md`.

The displayed production build was inspected at play zoom, under flat light
and automatic night lighting, with reduced motion and a 390 by 844 viewport.
It reported no page errors or horizontal overflow. The recorded native cycles
include a vertical crossing at ticks 144 through 156 and horizontal crossings
at ticks 192 through 216, ending closed. These are samples from actual Sims
and production rendering, advanced one fixed tick at a time while paused.
They verify door presentation, not a general playthrough or every household
activity.

The captured vertical route has an abbreviated close: native openness remains
1 through ticks 152 to 155, then reaches 0 at 156. The renderer interpolates
between ticks, but this paused capture does not prove a gradual closing swing
on that route. The horizontal sequence includes intermediate closing amounts.
The existing short-walk limitation remains documented in the interior-door spec.

1. [House and floor joins](../assets/review-evidence/solid-doors/house.png).
2. [Four orientations](../assets/review-evidence/solid-doors/orientations.png).
3. [Crossing frames](../assets/review-evidence/solid-doors/crossings.png) and
   [animated capture](../assets/review-evidence/solid-doors/crossings.gif).
4. [Night](../assets/review-evidence/solid-doors/night.png) and
   [small viewport](../assets/review-evidence/solid-doors/small.png).

## Executed checks

All commands below exited 0. The full workspace suite passed before adding
one further interpolation test; the entire simulation crate then passed
again with that test. Remote CI and the full remote mutation sweep have not
run because this change has not been submitted.

| Check | Command or browser entry | Result |
| --- | --- | --- |
| Native workspace | `cargo test --workspace` | PASS: 1,257 tests |
| Final simulation crate | `cargo test -p terri-sim` | PASS: 732 tests, including the added interpolation/load test |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| Formatting | `cargo fmt --all -- --check` | PASS |
| Release WASM | `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS |
| Web suite | `npm --prefix web test -- --maxWorkers=1` | PASS: 1,764 tests in 118 files |
| TypeScript | `npm --prefix web run typecheck` | PASS |
| Production bundle | `npm --prefix web run build` | PASS |
| Atlas tests | `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | PASS: 127 tests |
| Existing model suites | Same unittest command with `-s assets/models/sims/sim-01`, `furniture`, `kitchen`, `bathroom`, `bedroom`, and `office` | PASS: 100 tests total |
| Atlas freshness | `python assets/sprites/gen/build.py --check` | PASS: 1,472 sprites, 8192 by 6141 atlas |
| Door WebGPU | `doorDepthProof()` from `/proofs/door-depth.js` | PASS: 864 cases, no validation error |
| Existing GPU paths | `footprintDepthProof()` and `doorTraversalProof()` | PASS: 180 footprint cases and 10 wall traversal cases |
| Changelog | `node --test scripts/build-changelog.test.mjs`; `node scripts/build-changelog.mjs` | PASS: 7 tests and generated page |
| Document IDs | `python check-doc-ids.py` | PASS |

## Causal checks

The original 420-case proof missed casing, edge-on leaf and threshold
visibility. Fresh-context adversarial review caught those gaps. The final
864-case proof brackets posts, headers, broad leaf faces and solid end faces
in both draw orders, for every pose/orientation at scales 1, 1.75 and 3. A
threshold must cover the floor marker but yield to the actor marker.

| Deliberate regression | Observed failure |
| --- | --- |
| Remove surface correction | 628 of 864 GPU cases fail |
| Remove threshold floor ordering | 216 GPU cases fail |
| Discard threshold coverage | 216 GPU cases fail |
| Remove previous-tick advancement | Native prior-openness assertion fails, exit 101 |
| Advance previous amount during paused refresh | Native prior-openness assertion fails, exit 101 |
| Set restored previous amounts to zero | Native load assertion fails, exit 101 |
| Remove horizontal portal rows | Native portal assertions fail, exit 101 |
| Ignore render interpolation | Expected sprite 1394, received 1410; web test exit 1 |
| Keep horizontal empty doorway panel | Unexpected `doorwayJoinedEW`; web test exit 1 |

Each mutation was restored byte-for-byte, with restored SHA-256 recorded in
[GPU receipts](../assets/review-evidence/solid-doors/gpu-mutations.json) and
[invariant receipts](../assets/review-evidence/solid-doors/invariant-mutations.json).
The restored GPU baseline passed all 864 cases; native and web suites passed
after restoration. Deleting only the adoption copy survived because portal
initialization also resets previous values. Corrupting the observable loaded
values failed; the redundant copy is not claimed as independently protected.

Early browser runs timed out or navigated during hot reload. Those runs are
errors, not mutation kills. The final runner starts an isolated Vite server
with `watch: null` and `hmr: false` for each shader variant, owns one browser,
records progress, and closes both before restoring the source in `finally`.

## Independent review

The adversarial reviewer inspected source, revised room/model images, GPU
samples and mutation receipts. They confirmed the lighter line weight and
removed threshold projections, found no remaining production defect, and
verified restored source hashes. Their first review required the additional
casing, edge-on and threshold-visibility checks above. A later evidence check
caught a truncated vertical capture; the final production capture extends
through closing and was reviewed again without a new production finding.
The owner approved the reviewed visuals and authorized delivery on 2026-10-01.
