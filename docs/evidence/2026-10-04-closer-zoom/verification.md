# Closer camera zoom verification

Inspected on 2026-10-04 in the zoom branch based on
`8bb83ffb35846e9b4e59bc319937d140dce14bb0`. The production change raises the
shared maximum from 2.5x to 4x. The minimum remains 0.5x, the opening scale
remains 1x, and gesture speed, camera anchoring, art and saves are unchanged.

## Automated checks

| Command | Result |
| --- | --- |
| `npm --prefix web test -- --maxWorkers=1 tests/camera.test.ts` before the production change | Expected failure: three new tests rejected the old 2.5x ceiling. |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS, exit 0. |
| `npm --prefix web run typecheck` | PASS after rebuilding the imported package. |
| `npm --prefix web test -- --maxWorkers=1` | PASS, 144 files and 1,955 tests. |
| `npm --prefix web test -- --maxWorkers=1 tests/camera.test.ts tests/input.test.ts` | PASS, 112 tests, including the added 3.25x and 4x selection cases. |
| `cargo fmt --all -- --check` | PASS. |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS. |
| `cargo test --workspace` | PASS, including 125 core, 281 data, one data integration, 907 simulation and 171 browser-bridge tests. |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | PASS, 167 tests. |
| `python assets/sprites/gen/build.py --check` | PASS; historical and architecture atlases match committed output. |
| `python -B -m unittest discover -s assets/models/<group> -p 'test_*.py'` | PASS for `sims/sim-01`, `furniture`, `kitchen`, `bathroom`, `bedroom` and `office`. |
| `python -B -m unittest discover -s .github/scripts -p 'test_*.py'` | PASS, 23 tests. |
| `node --test scripts/build-changelog.test.mjs` | PASS, 12 tests. |
| `node scripts/build-changelog.mjs` | PASS. |
| `npm --prefix web run build` | PASS; existing large-bundle warning remains. |
| `python check-doc-ids.py` and `git diff --check` | PASS. |

The first package build used an unused output directory. Dependent checks
loaded old generated files: type checking failed, 70 web tests failed and
the browser reported a missing `window_placements` method. Rebuilding the
directory imported by the application resolved these failures. The initial
model test command also selected a parent directory with no tests; its exit
5 was not counted as a pass. The corrected group commands above passed.

## Guard deletion check

Replacing `Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))` with
`Math.max(MIN_ZOOM, scale)` caused six camera tests to fail, exit 1. The
pinch saturation assertion received 10 instead of 4. Restoring the guard
returned the source SHA-256 to
`a5dc44181ab79815fcfefa691ee901ba9255d7f6c6ed531fb41972341721c867`.
The restored camera and input tests passed. This is a targeted guard check,
not a claim that a full remote mutation sweep passed.

## Played browser checks

Checks used an owned local browser tab with the fresh imported simulation
package and the actual graphics renderer. Screenshots are retained beside
this record.

1. Desktop wheel zoom reached rendered scale 4 at 1280x720. The opening
   render remained scale 1. See [desktop-max.png](desktop-max.png).
2. A browser-dispatched two-finger touch gesture at 390x844 increased the
   rendered scale from 1 to 4. The browser page scale remained 1. This is
   phone-sized browser emulation, not a physical-device Safari check. See
   [phone-max.png](phone-max.png).
3. At 4x, a right-click at the projected counter position opened that
   counter's menu. Build zoom buttons changed scale from 4 to 3.5714285
   and back to 4. No furniture placement was committed.
4. At 3.25x, floor fill and object contours remained coherent. See
   [phone-fractional.png](phone-fractional.png). Panning worked and
   zooming out returned to 0.5x.
5. After the correct package reload, the browser reported no console
   errors. The owned tab was closed and the owned preview server stopped.

Independent source review found no blocker in the shared zoom paths,
scaled picking or camera bounds. Independent visual review inspected all
three screenshots and found no new floor gaps or contour defects.
Viewport cropping is expected at close zoom. The pre-existing lower-bunk
pose artifact visible in the desktop view is not changed by this patch.

These checks do not claim physical-device acceptance or publication.
Publication requires a separate executed Pages deployment and public-byte
verification.
