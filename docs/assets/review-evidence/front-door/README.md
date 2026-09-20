# Front-door played verification

Local production preview, 2026-09-20. Base: `d5ec05b`. The browser ran the
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

## Checks

1. `cargo test --workspace --quiet`: 716 passed (69 core, 205 data,
   367 simulation, 75 WASM), with no failures; doc tests also passed.
2. `cargo clippy --workspace --all-targets -- -D warnings`: exit 0.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`:
   exit 0, release build.
4. `npm run typecheck`: exit 0. `npm test -- --maxWorkers=1`: 718/718 passed.
   `npm run build`: exit 0.
5. Sprite generator: 70/70 tests; atlas reproducibility check passed. Every
   previous sprite retains its identity, dimensions, density and decoded pixels.
6. Deliberate guard, open-state precedence, no-double-pay, fingerprint and
   renderer-depth mutations failed their named assertions and were restored.
   Automated focused mutation sweeps and GitHub checks remain release gates.

Public deployment verification is recorded separately after merge. These
local screenshots do not establish that GitHub Pages has updated.
