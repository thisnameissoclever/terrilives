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

Shard 0 subsequently reported two additional shared-wall survivors: the upper
bound of collinear wall overlap and the combined rejection guard in route
anchoring. New regressions cover upper-half wall travel, endpoint contact,
reverse directions, both wall axes and independently invalid anchor conditions.
Each exact mutation failed its respective test. The same production SHA256 was
restored, and all 86 core tests passed. These are additional test corrections;
the prior visual bundle's runtime behavior is unchanged.

Shard 3 found a further missing south-side connectivity assertion in the lot
compiler. Its new fixture rejects an isolated south approach while all other
sides remain reachable; opening a second crossing is the positive control.
The exact depth subtraction-to-addition mutation fails the new test. All 218
data tests and the data integration test passed after restoring the operator.
Five bounds-filter survivors were independently reviewed as redundant with the
shared grid interaction predicate, which rejects out-of-grid contacts before
adjacency arithmetic. The duplicate filter was removed, with no new baseline
allowance. Final exact-head verification follows this correction batch.

Shard 5 exposed 21 further missing assertions in saved-wall validation. Five
new architecture tests distinguish internal furniture edges from the perimeter,
preserve repeated path steps and not-yet-active targets, reject invalid legacy
wall cells, and constrain each contact origin and footprint extent independently.
The exact 20 reported architecture mutations were rerun: all 20 caught, with
zero misses, unviable mutations or timeouts. Production architecture code is
unchanged. Restored tests passed 16/16.

The remaining survivor weakened the frozen wall-migration destination's height
guard. A separate helper test holds the walls and other dimension valid while
varying one dimension at a time. Its exact OR-to-AND mutation failed at `16x0`;
restoring the file restored SHA256
`fd5289c7ad74283f1cd9d538cde3d432bdf646a0a2d90271547aedb7e3a17e7e`.
Independent review confirmed the fixture isolation and narrow helper contract.
All 432 simulation tests then passed, as did formatting and diff checks. These
tests add no baseline exceptions and make no production behavior changes.

The combined correction batch then passed a fresh
`cargo test --workspace -j 1 --quiet`: 821 tests (86 core, 218 data, one data
integration, 432 simulation and 84 WASM), with zero failures. Documentation
IDs, formatting and the diff check passed. Remote exact-head checks remain
pending at publication of this batch.

The earlier run's final shard 7 found three more missing object-spawning
assertions. Public-boundary tests now accept solid walls on every perimeter
side, reject internal walls on both axes without changing the world or render
buffers, and accept internal doorways. The exact three mutations were caught
with assertion failures after successful compilation; none survived or timed
out. Restoring the original production source restored SHA256
`f815a9e530e21349629b93774f71255abc69ed9cffdb552efa9a08c3f423d785`.
All 86 native WASM-boundary tests passed. Independent source review approved
the test fixtures and refusal observations. A fresh combined workspace run
passed 823 tests, and the unfiltered release-mode WASM-boundary suite passed
all 86 tests. The three source mutations and tests add no baseline exceptions.

## Main's wall-depth correction

Main advanced to `1d4b9ed` before release. Its physical wall-plane depth and
40-byte instance rows were integrated unchanged. Portal tests now use shared
row offsets and prove that both door layers clear the wall-only fields.
Removing either field write independently fails the new sentinel assertion.
TypeScript, all 786 browser tests across 63 files and the production build
passed. Native sources are unchanged from the 823-test correction checkpoint.

The frozen production bundle `index-CYOG9N3u.js` with the existing
`terri_wasm_bg-B10R6jV9.wasm` was played in a fresh disposable origin at port
4192. No fresh WASM generation is claimed for this renderer-only merge.
Departure was opening at 400 and open at 406. The returning leaf was open at
887 before payment; at 891 Tim visibly crossed and funds were 120. Save at 891,
advance to 894/closed, and confirmed Load restored 891/open and funds 120.
Completing the crossing again left funds at 120. The door frame, leaf and body
retained their depth ordering while nearby furniture kept its full silhouette.
`wall-depth-departure.png` and `wall-depth-return-restored.png` record the pass.
Browser warnings/errors were empty. The test tab and preview server were closed.
Exact-head CI and public Pages acceptance remain pending.

## Public deployment verification, 2026-09-21

PR84 merged as `d26b60e214a7d713824f825879b75aa80a73c81e` after all ten
exact-head checks passed. Main CI35553958873 passed. Pages35554122223 attempt2
deployed that revision successfully after the first deploy attempt failed on a
GitHub artifact-service connection reset. The live page loaded the build log's
exact `index-CQrKOF-Y.js` and `terri_wasm_bg-jwUx5N9Q.wasm` assets.

The existing household loaded and the rendered door, furniture depth and day/night
lighting were inspected. Browser warnings/errors were empty. Live crossing timing
was not captured reliably; the previously recorded local crossing evidence remains
the animation proof. Fixed-minute polling was stopped after three failed attempts.

The live check violated the save-preservation constraint: crossing midnight
triggered autosave. Read-only metadata confirmed primary modification at
03:09:33.828Z, 2863 bytes, SHA256
`4b67509107c1b2aa373d850588c340429c2728496643e207b2685316e83d6953`.
The migration preserved a 2714-byte V1 backup at 03:09:33.826Z, SHA256
`0b702b4fe41e7d77af0ad24cf55868e9c18e1ca4cccb3cf6b6d128d3a40a8719`.
No recovery write was attempted. Playback stopped; script execution was disabled
in the owned tab before closing it to prevent the hidden-tab save handler from
running. Further gameplay checks use disposable local saves. See
`L-live-verification-autosave` in lessons-learned.md.
