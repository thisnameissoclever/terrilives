# Stove static replacement

Reviewed 2026-09-17. Primary and adversarial review accepted candidate 02 under
the owner's delegated review policy. No per-object owner gate remains.
This is local production-build evidence, not proof of a live deployment.

Publication was subsequently verified on 2026-09-17. PR #71 merged as
`fcd2a78a2791b659bf31a06b27477b8b82f29e6d`. Main CI run 35293085843 and Pages
run 35293217237 passed, including the deploy step. The live household loaded
`index-Bvrt0ZBM.js` and returned the atlas with HTTP 200 and SHA-256
`c35e86dd0f609578731180956809bcaf637e5f28d833cd02f0d260f2518fa01e`.
`stove-live.png` shows that household under flat lighting. The sole console
error was the missing favicon, and the dedicated tab was closed. This does
not claim publication of the later counter or bathroom batches.

## Visual and played checks

1. `stove-four-facing-gpu.png` shows the actual atlas through WebGPU at 2x
   camera zoom, in SE, NW, SW and NE order. Indices are 1093 through 1096.
   A validation error scope returned null, no uncaptured GPU errors were
   recorded, and the fixture was visibly drawing. This is an isolated renderer
   fixture, not four stove placements in the household.
2. `stove-played.png` shows the built bundle `index-Ct5JH38D.js` at Day 1,
   01:56. The stove aligns with the adjacent counter tops and keeps its original
   tile. Tim is at the stove during `Cook dinner - step: Cook (carrying
   ingredients)`. The reviewer found no blocking placement, scale or depth defect.
3. Using the roster, canvas keyboard target, fridge menu and visible 1x/Pause
   controls, Tim progressed from Get ingredients at 00:01 to Cook at 01:36,
   Eat dinner at 03:02, and completion at 03:58. The final activity was
   `Deciding what to do`, with hunger and comfort both 100. The intermediate
   screenshot supports the Cook checkpoint; the other checkpoints were read
   from the live HUD and need meters, not inferred from that screenshot.
4. This changes only `stove.sprite` in content. The existing cooking chain,
   roles, placement, footprint and save schema remain unchanged. No new oven
   motion, stirring or hand-contact animation is claimed.

The fixture tab and production-check tab belong to this task and are closed
after verification. The two pre-existing local task servers remain available
for subsequent kitchen work.

## Source checks and regressions

Atlas: 1,097 sprites, 4096x6168, SHA256
`c35e86dd0f609578731180956809bcaf637e5f28d833cd02f0d260f2518fa01e`.

1. The saved-scene checker rejects candidate 01 for 12 floating coils and four
   floating knob indicators. Candidate 02 passes with four burner wells, 12
   supported coils, four attached indicators and seven hinged door parts.
   Both candidate directories retain their JSON results.
2. Kitchen authoring: 10 tests pass. The new hinge tests were observed failing
   before implementation, then passing; opening moves outward about a fixed
   lower hinge. Review-label coverage proves labels change without altering
   any reviewed source pixels.
3. Sprite suite: 49 tests pass. Prefix checks preserve the previous 1,093
   records and decoded pixels, including the accepted refrigerator. Five
   loader mutations still fail their intended assertions; source bytes remain
   unchanged and all nine ordinary loader tests pass afterward.
4. Web suite: 675 tests in 49 files pass with one worker. Four-facing stove
   tests cover appended indices, density, tile anchor and transparent-margin
   picking. The new stove test failed before import and passed after generation.
5. Rust workspace: 687 tests pass. Typecheck, WASM build, production build,
   atlas freshness and documentation ID checks pass. Commands exited 0.

Minor retained limitation: tiny burner-rim ticks remain at full source size.
They are not conspicuous in the 192x240 sprite samples. Both reviewers accepted
the static result at a subjective 90/100; this score is not an objective
measurement or a claim of perfect geometry.
