# Front-door played verification

Local production preview, 2026-09-20. Base: `d5ec05b`, then integrated with
main's bathtub rotation at `412bf5c`. The browser ran the
release WASM bundle with the shipped household and no filler Sims. Normal UI
controls covered lighting, speed, Save, Load and mobile camera panning. The
existing `?stress=0` frame interface also stepped real simulation ticks to
inspect crossings that otherwise last less than a second. No world state was
fabricated and no public-site save was reset.

## Observations

1. At tick 419 the leaf is ajar as Tim approaches. At 425 it is open; at 426
   he crosses the threshold. At 430 it closes behind his departure and at
   433 it is closed. Frame, hinge and threshold remain planted.
2. At tick 908 Tim returns at `(15.5,2)`. Both previous and current body
   samples start there, so the visible body does not reverse direction.
   He walks around the lamp to `(15,3)` and the door closes behind him.
3. Save at tick 908, advance to 916, then Load restores tick 908, the open
   leaf, the worker and funds of 120. Reloading the rebuilt production bundle
   also restores that crossing. Completing it does not pay another shift.
4. Pausing holds the leaf and pose. Reduced motion uses the open leaf during
   a closing interval, not an intermediate swing. Neutral and night lighting
   tint the door consistently with the room. At 390x844 the menu collapses
   and a camera drag reaches the door without covering the scene.
5. Bill and Casey complete a conversation with visible gestures and bubbles.
   Tim completes his post-work sleep, recovers energy to 100 and gets up.
   Existing furniture and wall runs retain their reviewed appearances.

Images are direct browser captures, not contact-sheet composites. Departure
captures precede the final presentation/resource separation, which leaves
their pixels unchanged. `return-restored.png` and `night.png` use the final
production bundle (`terri_wasm_bg-p4f1Acir.wasm`).

`integrated-return.png` shows the combined front door and rotated bathtub in
`terri_wasm_bg-BYf0czAQ.wasm`. Departure at 426 and return at 908 were inspected
again in this build. Saving the return succeeded with funds at 120; reloading
the page reported the saved game loaded, and UI Load restored tick 908 while
paused. No browser warnings or errors were recorded. The real
pre-bathtub browser fixture and rotated pre-door save path also pass through
the release WASM boundary tests; these are separate migration cases.

## Checks

1. `cargo test --workspace --quiet` after integration: 742 passed (69 core,
   206 data, one data integration, 389 simulation, 77 WASM), with no failures;
   doc tests also passed. Two additional portal boundary tests were then added;
   the focused portal suite passed 10/10.
2. `cargo clippy --workspace --all-targets -- -D warnings`: exit 0.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`:
   exit 0, release build.
4. `npm run typecheck`: exit 0. `npm test -- --maxWorkers=1`: 719/719 passed.
   `npm run build`: exit 0.
5. Sprite generator: 70/70 tests; atlas reproducibility check passed. Every
   previous sprite retains its identity, dimensions, density and decoded pixels.
6. Deliberate guard, open-state precedence, no-double-pay, fingerprint and
   renderer-depth mutations failed their named assertions and were restored.
   The 40-mutant compiler sweep's two real survivors were closed with cardinal
   adjacency and strict south-bound tests; the final targeted mutant was caught.
   The 78-mutant portal sweep caught 65, left 10 and rejected three unviable
   mutations, with zero timeouts. Three survivors are equivalent, documented in
   `mutation-baseline.md`; the targeted rerun caught all seven real survivors.
   GitHub checks remain a release gate.

## Boundary-wall and Save V2 integration

Main advanced to boundary walls at `6951ba7` during the release. A fresh
production build (`terri_wasm_bg-B7Pz4Vp0.wasm`, `index-CA0mGe9L.js`) was
played in a separate local origin with the new walls and the animated door.
The changed walking routes also changed crossing times; the earlier tick
numbers above are evidence for their earlier build, not a timing requirement.

1. The return approached at tick 884, was visibly open with Tim crossing at
   889, and was closed by 900. Funds were 120. UI Save at 889, advance to 900,
   then confirmed UI Load restored the same visible crossing, pause and funds.
   `edge-wall-return.png` and `edge-wall-restored.png` capture these states.
2. The next natural departure was ajar at 1851, open at 1857 and closing at
   1862. The frame stayed planted and the leaf correctly occluded Tim through
   the threshold. `edge-wall-departure.png` captures the open crossing.
3. Reduced motion displayed the fully open leaf during the same closing
   interval. At 390x844 the Menu collapsed and camera dragging brought the door
   into view. `edge-wall-mobile-reduced.png` records that played combination.
4. Automatic lighting at tick 2760 tinted the closed door with the room;
   `edge-wall-night.png` records it. Funds were 240 after the second shift.
   No browser warnings or errors were recorded. Temporary viewport and media
   overrides were reset; the test tab and preview server were closed. The
   public origin's household was not reset or modified.
5. Native workspace: 809 tests passed (83 core, 217 data, one data integration,
   424 simulation, 84 WASM). Clippy and formatting checks passed. Release WASM
   build, TypeScript check and Vite production build passed. Browser suite:
   782/782 across 62 files, one worker and the unchanged five-second timeout.
   The blue/red palette verification now uses separate named cases with all
   image hashes and registration assertions retained.
6. A real previous-main V2 browser fixture loads through native and release
   WASM tests. New regressions reject saved walls or occupied cells that block
   a future career return, including workers still at home, without replacing
   the live world. Independent statement-deletion tests broke and then restored
   portal activation propagation and off-door return-segment validation.

The inherited bathtub rerun completed all 36 selected mutations: 28 caught,
eight reviewed equivalents missed, zero unviable and zero timeouts. A separate
comparison found no misses outside the committed baseline. Its isolated source
snapshot predates `04fd0c8`'s destination guard, which does not change the known-D
migration behavior exercised here. The separate eight-mutant portal-return
validation sweep at `04fd0c8` caught all eight, with no survivors, unviable
mutants or timeouts. Exact-head GitHub gates remain release checks, not claims
established by these screenshots. Equivalence arguments are recorded in
`mutation-baseline.md`.

Main's follow-up `c0eca30` was then merged without runtime changes. Its four
exercise-clearance tooling tests passed, as did documentation IDs and the diff
check. The latest main ref was fetched again before preparing publication.

After the reviewed migration-destination guard landed at `04fd0c8`, a fresh
`cargo test --workspace -j 1 --quiet` passed all 811 tests: 83 core, 217 data,
one data integration, 426 simulation and 84 WASM. Formatting and diff checks
also passed. The two additional simulation tests constrain migration ordering
and exact destination compatibility; they do not change the current household.

The final production bundle (`terri_wasm_bg-B10R6jV9.wasm`,
`index-iOYiGNd3.js`) passed Clippy, release WASM generation, TypeScript checking,
all 782 browser tests and the Vite build. It was then opened and inspected in
the same disposable local origin. Its existing saved household loaded normally.
The next return opened at 2338; at 2341 Tim visibly crossed and funds were 240.
UI Save, advance to the closed door at 2356, and confirmed UI Load restored
2341, the open crossing and the same funds. `final-return-restored.png` records
the restored game. Completing the crossing again left funds at 240. Browser
warning/error logs were empty. The test tab and preview server were closed;
the public household was not touched.

Public deployment verification is recorded separately after merge. These
local screenshots do not establish that GitHub Pages has updated.

PR CI at `60171e3` passed Rust and browser checks but shard 1 found one new
surviving mutation: the first OR in `edge_slot`'s negative-coordinate guard.
A no-allocation helper test now covers each negative axis independently of
unsigned upper bounds, reversed endpoints and valid controls. Applying the
exact mutation failed with an invalid `Some` index instead of `None`; restoring
the original production file restored its SHA256
`07dda1836221d6ff65da7e1855c0c84ccc76e4435f1d279b717d3c3649975181`.
All 84 core tests then passed. Independent review approved this as defensive
helper coverage, not proof of a reachable ordinary-lot defect. Production code
and the mutation baseline are unchanged by this test correction.
