# Bike and reading-chair release evidence

Reviewed 2026-09-10, using the owner-approved shared Sim and candidate-02
furniture designs. Publication status is verified separately from these images.

1. `gpu-phase-0.png` through `gpu-phase-7.png` use the actual Chrome WebGPU
   `SpriteRenderer`, shader and generated atlas. Columns are bike SE/NW/SW/NE,
   then chair SE/NW/SW/NE. Rows are green, blue, red, then empty furniture.
   The chair's four samples repeat across the eight bike samples. This is a
   GPU inspection fixture, not eight simultaneous in-game households.
2. `played-cycle.png` shows the household after real 1x playback advanced from
   tick 64 to 80. Both exact interaction targets remained active. A preceding
   half-second pause retained tick 64. Body clicking selected Bill; save/load
   restored tick 64 with Tim reading at object 26 and Bill cycling at object 22.
3. `reduced-motion.png` records the actual browser media setting enabled with
   both interactions active. On the built release, the bike crop remained
   byte-identical across eight simulation ticks with reduced motion enabled.
   Turning it off changed that crop after two ticks. The chair crop changed
   after twelve ticks, confirming its quieter reading motion. Unit tests also
   pin the selected samples and timing.
4. `production-build.png` is the built bundle `index-CBTJKkvY.js` served from
   the preview server, with both interactions active at tick 57. It uses atlas
   SHA256 `658091ca3f670f217e94b626428431187e15b3c6236f6aab6636fb7097e78e1f`.
5. The owner caught backward pedalling after the initial review. The bike now
   plays source phases 0,7,6,5,4,3,2,1, retaining the original resting pose.
   `forward-cycle-start.png` records tick 29 before real 1x playback advanced
   to tick 45 in the corrected build. Both interactions were then verified at
   tick 57. Earlier GPU phase images establish pose coverage, not forward
   motion; their original playback order was wrong. Chair order is unchanged.

Primary and fresh independent visual review found no blocking regressions in
the eight GPU phases or played wall-fit view. The chair motion is a subtle
reading loop, not page turning. Wall occlusion in the household is intentional;
stills cannot establish hidden physical clearance, which is tested offline.

The actual atlas loader was also exercised with GPU readback enabled solely
for inspection. Twelve partially transparent source pixels matched the decoded
PNG RGBA bytes exactly: maximum channel error 0. No WebGPU validation errors
were observed. The browser's only console errors were missing `favicon.ico`.

Mechanical checks before publication:

1. Full Rust workspace: 643 tests passed.
2. Web: 556 tests passed in 42 files with one worker; typecheck and Vite build passed.
3. Python: 36 sprite, 24 Sim and 30 furniture tests passed. Atlas freshness and
   documentation-ID checks passed.
4. All 847 preceding atlas records and decoded pixel crops matched their
   baseline. The new atlas has 1,087 sprites at 4096x6073, about 94.9 MiB of
   decoded RGBA storage. GPU dimension checks remain enabled.
5. The complete 584-pass batch yielded 144 independently compared pose/palette
   groups and eight empty facings. Furniture/outline bytes are palette-invariant;
   Sim bytes differ across all three shirt colours. The reconstruction is
   tolerance-bounded at antialiased edges, not byte-exact.
6. Evaluated bike contact: sixteen phases, four shoe meshes against six obstacles,
   no intersections; maximum pedal-centre support gap approximately 0.00000702.
   Deliberate lateral-pedal and missing-obstacle scene mutations failed, then
   the restored scene passed. Nine Python guard mutations also failed their
   intended assertions with source bytes unchanged after restoration.

Independent runtime source review passed specification and code-quality checks
with no P1/P2 findings. The render review's validation findings were addressed
with ownership, dependency, support and inventory checks. The first batch's
incomplete generation-time provenance remains explicitly documented in its
supplemental proof and the furniture README.

## Latest wall integration

Pulled origin/main `1631863` before publication. The combined atlas has 1,089
sprites at 4096x6073, SHA256
`71c2c448266c234483f5822ba7cb8bb4bdbc4926d9aa29d36bf8040120566993`.
The first 836 records match the HD branch, the next 13 match the committed
upstream wall crops, and all 240 furniture records retain their decoded pixels,
dimensions and density. The new wall sprites keep published indices 847/848;
unpublished furniture follows at 849. Both manifests and WASM were rebuilt.

`wall-integration.png` shows the combined production bundle `index-DkvbxJ6g.js`
at tick 57, with Tim reading at target 26 and Bill cycling at target 22. The
visible corner folds and continuous rear junctions retain the upstream design.
The direction correction remains in the generated playback tables. Current
checks pass: 39 sprite, 24 Sim, 30 furniture and 556 web tests, typecheck,
production build, atlas freshness and documentation IDs. The earlier 847-record
comparison above describes the pre-corner baseline, not this final atlas.
