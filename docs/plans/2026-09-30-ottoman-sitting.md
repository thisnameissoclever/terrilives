# Ottoman sitting animation

Add a seat-specific pose to the existing ottoman interaction. This is an offline
candidate and implementation plan, not a shipped animation or gameplay acceptance.
The aquarium batch is committed separately as `90951831`. Keep the ottoman
checkpoint separate on `twcx/ottoman-sitting`; neither checkpoint is a release.

## Scope and preservation

1. Preserve the approved ottoman, original Sim files, mesh geometry, weights,
   materials, rest skeleton and existing actions. Author `ottoman_sit` in a
   separately saved scene. Do not modify the shared `sit` clip to fit one object.
2. Preserve object ID `sofa`, entity 18, one-tile footprint, price, placement,
   effects, duration and declared slots. Runtime reservation still owns the
   whole object; this does not add simultaneous two-person seating.
3. Use the existing exact-target Sit action, wire code 8 and activity 11. Add a
   centered `seat` socket facing SW and a visual declaration only to
   `sofa.lounge`. Save fields, compatibility digest and bridge shape stay fixed.
4. Existing armchair, reading, exercise and sleeping profiles remain untouched.
   The renderer can select a separate profile by the active target's sprite.

## Measured source checkpoint

The unchanged generic Sit pose failed all four sampled frames. Its hip bottom
was 0.01929906 above the cushion maximum, soles were about 0.0191481 above the
floor, and each sample had ten body/furniture intersections. Original evidence
is retained in `output/ottoman-seat-fit-01/`; it is not approved occupied art.

Candidate `output/ottoman-sit-candidate-01/` moves the pelvis and solves the
limbs for this cushion while leaving object and root registration fixed. All
four samples have zero body/furniture intersections, minimum hip gap
0.0007991, near-support hull area 0.0178595, and sole gap 0.0001481. Bone length
error is below 0.000001. Source bytes and the recorded base-scene fingerprint
are unchanged. The four frame-zero views passed primary and independent visual
review. These tolerances measure geometric proximity, not cloth compression.

Seven damaged in-memory copies were rejected: the generic Sit action,
unsupported hips, a raised cushion, a sole below the floor, a hidden leg,
a shifted registered origin and a stretched thigh. Removing the sole-clearance
acceptance term let that specific damaged sample pass. The original candidate
and authoring script remained byte-identical.

Independent review requested finite floor-support patches and targeted checks
between hands and thighs, forearms and torso, and the two shoes. That study
found real palm/trouser intersections in candidate 01. Candidate 02 raises the
wrist targets by 0.055 without changing the accepted pelvis or leg fit. Its
hands read as loosely held above the thighs, not resting on them. Primary and
independent review accepted the four frame-zero views.

The stricter candidate-02 checker passes all four samples. It checks every
body/furniture pair and 12 selected body/body pairs, not every anatomical pair.
Each sole has 241 near-floor vertices with projected support area about
0.02831. It uses triangle crossings, bidirectional component winding and a
temporary torso envelope for the original 96-edge open neckline. Original
garment vertices and rendered geometry are unchanged. Eleven pure geometry
tests and seven Blender regression cases passed; deleting containment and
neck-cap-crossing guards made their respective damaged fixtures pass.

Keep generation completion separate from acceptance. The initial builder's
`fit_passed` flag does not establish full contact proof. The strict checker
must finish with `accepted: true`.

## Complete offline clip

The contribution batch completed 196 full-resolution originals: four empty
views plus beauty, body, furniture and outline passes for four samples in
four facings and three shirt colours. All source bindings still match after
synchronizing newer main changes. Each palette's physical samples match the
accepted checker receipt exactly.

All 48 occupied reconstructions pass the existing compositing limits. The
worst per-channel error is 21 and the worst 95th-percentile error is 9, below
the unchanged 64 and 12 limits. Furniture and outlines are identical across
palettes; body coverage is identical and all three shirt colours differ.
Eight raw-record validation tests pass. Six guard-deletion cases fail their
named tests; all eight tests pass after restoration with source bytes unchanged.
Removing only duplicate-key rejection survived because duplicate-path
rejection still caught the fixture. Removing both parts of duplicate identity
made its test fail. The surviving narrow mutation is not counted as killed.

Primary and independent review accepted all 48 source/sprite pairs. No art
revision was requested. Samples 0 and 2 repeat intentionally; the head and
hand movement returns through that centre pose. The first WebP preview used
300 ms per sample by mistake. The replacement reads `sample_fps: 2` from the
saved Blender action, uses 500 ms per sample, and proves all four decoded
review frames are unchanged. The original preview remains only as superseded
timing evidence.

Local evidence is under `output/ottoman-sit-candidate-02/`:

1. `contributions/raw-proof.json`: 196 originals, source signatures and contacts.
2. `offline-export/export-proof.json`: 48 reconstructions and three review boards.
3. `offline-export/guard-deletion-proof.json`: rejection tests and deletion results.
4. `action-cadence.json` and `offline-export/cadence-proof.json`: saved timing,
   output durations and unchanged decoded pixels.
5. `offline-export/full-clip-authored-cadence.webp`: corrected review animation.

At this offline checkpoint, nothing was installed in the runtime atlas. Local
import was completed later as recorded below; GPU and played-action acceptance
remain open. Source packaging must retain stable bindings before release.

## Native integration checkpoint

The local content edit now declares the centered seat and target-bound Sit
visual. One compiled-content test pins the existing price, footprint, duration,
slots, advertised effects, placement and compatibility fingerprint. Four native
simulation tests cover every facing, unchanged logical coordinates, immediate
V5 restoration with a committed colour and a separate pending colour command,
player-order cancellation and autonomous sitting preservation. These tests pass;
the runtime atlas still lacks the occupied ottoman profiles.

Native `Sim::flush_commands` only applies commands. Tests of the browser's paused
command boundary must also call `sync_render_buffer_after_commands`, as the real
WASM wrapper does. A cancel only interrupts the matching queued player order.
The initial test incorrectly expected an empty-order cancel to stop autonomous
sitting; correcting the fixture did not require a gameplay change.

Deleting the content visual declaration made the compiled-content test fail
with `None` instead of `Some(CompiledVisual { action: Sit, ... })`, and all four
native tests fail with action 0 instead of 8. Restoring the declaration restored
the original file hash and passing tests. A separate mutation batch failed its
restoration check and was invalidated; its compilation errors are not evidence
of test sensitivity. See lesson `L-mutation-restore-must-fail-closed`.

The corrected proof, `output/ottoman-native-mutations-02.json`, catches seven
specific mutations: missing object match, missing interaction match, missing X
or Y interpolation reseed, missing final V5 render refresh, retained player use
after cancellation, and incorrectly cancelled autonomous use. Every mutated
version compiled, ran one exact test and failed the expected assertion. Each
transaction restored the entire original file and hash, then passed all four
focused tests before the next mutation. Cardinally adjacent starting positions
exercise both coordinate axes. The earlier invalid batch remains separately
recorded in `output/ottoman-native-mutations-invalid-01.json`.

The complete Rust workspace passed 1,220 tests before the final test-only
strengthening of the immediate colour restore assertion. The strengthened four
native tests also pass. This does not establish WASM-renderer or played acceptance.

After fast-forwarding to `a199fc4d978ae2229db3f50f4fb896506be53ca4`, the full
Rust workspace passed 1,226 tests, including the strengthened fixtures. Upstream
added Sim details and audio work; no source-contact or accepted image bytes
changed. The native mutation receipt remains bound to its original pre-sync
inputs at `9fdf635cfb8bbc524020dea678a6177e02d7a6f4`; it was not rewritten to
claim those mutations ran against the newer main revision. The only upstream
change in its mutated Rust files was the new `pub mod details` declaration.
Formatting, document-ID and staged/unstaged whitespace checks passed after the
merge. The latest WASM and web checks remain pending atlas integration.

## Promotion decision

Independent source review recommends an immutable candidate bundle and an
explicit historical-path mapping, not rewriting accepted receipts after moving
their producer scripts. Retain the exact model, archived producer/checker/exporter,
contact and comparison receipts, encoded textures and corrected cadence evidence.
Each recorded historical path must resolve to one byte-identical tracked file;
missing or ambiguous mappings must fail without consulting the local `output/`
tree. Archived Windows path identifiers need explicit normalization and duplicate
alias rejection. Preserve byte-sensitive source and JSON line endings in Git.

A separate replay command can materialize those inputs in a fresh directory and
execute the unchanged recipe. It must not overwrite accepted evidence. Preserve
the rejected candidate-01 model required by the occupancy regression. Keep the
production import receipt distinct from the historical generation journal.

Use the existing clean-build evidence tier: tracked receipts and encoded exports
must rebuild the atlas without Blender or ignored full-resolution originals.
Full original-to-export verification remains a separate local check of all 196
originals. Do not describe the clean build as re-encoding originals it does not
contain. The originals remain available locally and are not discarded.

The new ottoman profiles alone use `halfCycleTicks: 10`: four samples at two
samples per second with ten simulation ticks per second. Keep armchair/common
Sit at 24. Normal playback must use the raw simulation clock, with no second
speed multiplier. Reduced motion selects sample zero. A real-WASM two-object
test must distinguish armchair and ottoman profiles while both Sims report Sit.

## Implementation and evidence sequence

Source packaging is now implemented in
`assets/models/living/owner-review-pending/ottoman/sitting-02/`. The package maps
119 files, preserves 96 archived files byte-for-byte and binds 23 existing shared
inputs. Fourteen loader tests and three replay tests pass. Eleven
deleted guards fail their named assertions, then all 17 tests pass with unchanged
source hashes. The separate `source-tests` replay ran all 19 archived geometry
and raw-record tests from fresh copied inputs. Full Blender replay and production
receipt/importer integration were still open at that checkpoint. See the package README for commands and
the distinction between the original 25-input render journal and two supplemental
import-time dependencies found during packaging.

Independent review closed two replay-wrapper findings after correction: changed
source/catalog pairs now retain a failed journal and subprocess output, and
relative Blender executable paths resolve once before the working directory
changes. The full living-model suite passed 51 tests. At that checkpoint, the
aquarium's 88-file batch remained staged separately and ottoman additions were
unstaged. Later branch commits preserve that separation. No new runtime, GPU
or browser acceptance was claimed by the source-packaging checkpoint.

1. Promote the separate action authoring and strict contact checker with the
   completed clearance study and regression fixtures. Pin original model and rig hashes,
   preserve existing actions, and test damaged copies plus deleted guards.
2. Render all four samples, four facings and three shirt colours using the
   registered camera. Keep beauty, body, furniture and outline contributions,
   plus four empty reference renders. Review the complete animation, not only
   frame zero. Validate bounds, source bindings and compositing against beauty.
3. Add a reviewed manifest and importer. Keep empty ottoman records 1358..1361
   unchanged; append occupied records after the accepted atlas tail. Add exactly
   four Sit profiles referencing those existing empty records. A missing facing,
   frame or colour must fail the build, not use the ill-fitting generic clip.
4. Preserve every existing decoded sprite and historical profile entry. Later
   prefix tests need an explicit allowance for the four new ottoman profile keys,
   not broadly regenerated metadata baselines.
5. Add exact-target contract tests through compiled content, simulation
   projection and renderer selection. Cover all facings, cancellation, unchanged
   logical position, immediate save restoration, pending commands, reduced
   motion and armchair-versus-ottoman profile selection under the same action.
6. Update the ottoman browser proof, interaction coverage, living source README
   and feature documentation. Keep the original static-art receipt historical
   and link a separate seating receipt.
7. Run the relevant repository checks, independent code and visual review, then
   real production UI playback. Source renders and isolated GPU fixtures do not
   establish played acceptance. Close owned browser contexts and preview servers.
8. Commit this coherent batch separately from the aquarium. Verify refs and
   normal merge under the owner's local-check delivery instruction. Report source
   merge and public deployment separately.

## Local atlas checkpoint

The reviewed receipt and shared seating importer now append 72 occupied records,
reusing the four existing empty ottoman records. The local atlas has 1,450 records
at 8192 by 5261 pixels. All 1,378 earlier decoded sprites and their non-packing
metadata remain unchanged. Armchair exports and cadence are unchanged.

All 157 sprite tests pass. The receipt proof catches 28 deliberately broken
guards and passes all 32 restored tests. Full original verification decodes all
196 raw PNGs, reproduces the encoded pixels and matches all 48 retained occupied
comparisons. These are source and export checks, not played acceptance.

After integrating main revision `2021647fbd94801a181b8b2186691d06e13d78a0`,
the fresh WASM build and the initial 23 focused ottoman/interaction-production tests passed.
They exercise actual interaction targets, all four facings and three shirt
colours, four animation samples, reduced motion, save restoration and concurrent
armchair/ottoman profile selection. Subsequent review added independent
cancellation in both directions, bringing that suite to 24 tests. The worktree
then integrated main `d0c7f45d`; full Rust, web, lint, type and production-build
checks passed. Ten deliberate runtime/proof-tool defects and four atlas faults
failed their intended assertions. A clean source export rebuilt the atlas and
passed 157 sprite plus 51 living-model tests. Browser review remains open. See the separate
[sitting evidence](../assets/review-evidence/living/ottoman-sitting.md).

## Current browser boundary

A later copied-source job reproduced all four contact samples and seven
occupancy cases through the authorized detached Store launcher. All four copied
models reported no external resources; original and copied inputs stayed
unchanged. The collector and its rejection tests passed independent review.
See the [contact replay evidence](../assets/review-evidence/living/ottoman-sitting.md#copied-source-contact-replay).
This closes contact replay only, not full render replay or played acceptance.

The aquarium's saved gameplay-check script was denied by the browser tool's
file-access rules. The user has been asked whether the supported inline-code
interface may be used instead; no answer is recorded. Do not retry through
another path or treat offline work as permission to bypass that denial. This
plan leaves browser-dependent acceptance open until that question is resolved.
