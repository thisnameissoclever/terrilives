# Lessons Learned


## [L-proof-test-discovery] Check runner discovery when adding standalone proof tests

**What happened.** A proof helper's Node test passed when run directly, but its
`.test.mjs` filename also matched the web suite's Vitest discovery. Vitest ran
the file and then failed because it contained no Vitest suite.

**Root cause.** Proof-only changes were assumed to be isolated from production
checks without inspecting the existing test runner's file discovery.

**Prevention.** Give standalone tests a name outside other runners' discovery
patterns and document their explicit command. Treat new test files as relevant
to any suite that might discover them.

**Verify.** Run the standalone command and the affected suite after adding or
renaming a test file. Record runner failures even when individual tests pass.

## [L-nested-build-actions] Test action reachability across nested build controls

**What happened.** Selecting a window opened its nested chooser, hid ordinary
wall actions and diverted their shortcuts. Returning to wall controls cleared
the selection, so supported whole-window conversions could not be invoked.

**Root cause.** Controller tests covered each tool's actions independently but
did not follow selection, nested entry, return and the next ordinary edit.

**Prevention.** Preserve the selected boundary separately from a multi-unit
object's canonical anchor. Test the complete transition between related tools,
including pending commands and selection changes after replacement.

**Verify.** Select middle and end segments on both axes. Return to wall controls
and convert or remove the whole window, placing a doorway on the chosen segment.
Confirm pending commands and refused rear-shell edits cannot change ownership.

## [L-preserved-art-routing] Verify active rendering before describing compatibility

**What happened.** Documentation claimed old floor artwork remained active for
yard, street and historical layouts, although the game selected authored floor
materials in those locations. The historical sprite data was preserved.

**Root cause.** Asset preservation and renderer tests with architecture disabled
were mistaken for the routing used by the running game after Load.

**Prevention.** Distinguish preserved asset data from active appearance. Trace
the game setup and Load paths through material selection before documenting
which art a saved layout displays.

**Verify.** Check both the caller's architecture options and each zone's material
mapping. Compare the resulting behavior with the approved visual requirements.

## [L-benchmark-appearance-identity] Derive benchmark appearance from shipped content

**What happened.** A rendering stress fixture supplied zero-filled floor colour
settings. The fixture exercised desaturation while its results were initially
discussed as the cost of the shipped artwork.

**Root cause.** Zero was assumed to mean an unchanged appearance. Colour strength
uses one as its identity, and authored materials compare settings with their
baked content baseline.

**Prevention.** Derive the default workload from checked-in content. Give altered
appearance workloads explicit names and retain their input values and hashes.

**Verify.** Assert that default authored floor instances encode zero relative
colour adjustment. Report default and altered appearance measurements separately.

## [L-proof-freeze-includes-metadata] Keep browser proof sources frozen until extraction

**What happened.** A benchmark helper changed after its freeze was announced.
The change only labeled resource measurements, but the development server
reloaded the proof page and discarded its in-memory sample arrays.

**Root cause.** The worker treated measurement metadata as independent from an
active proof. The controller initially stored a tool response without checking
that it contained results rather than an execution error.

**Prevention.** Freeze the entire imported proof, including measurement metadata,
until results have been extracted and the controller confirms page cleanup.
Check every tool response before claiming that evidence was saved.

**Verify.** Record the loaded proof revision with each case. Validate result shape
before writing the receipt. If a reload destroys samples, identify the lost data
and keep surviving summaries distinct from complete raw measurements.

## [L-render-benchmark-pins-geometry] Freeze every input producer in a baseline

**What happened.** A historical renderer benchmark imported the current geometry
builder. Later architecture changes could therefore alter its supposedly fixed
historical scene and send new sprite identifiers to the old renderer.

**Root cause.** Only renderer sources were pinned. The benchmark treated its
geometry builder as neutral infrastructure even though that builder defined the
work being measured.

**Prevention.** Pin the geometry producer and its imports with the renderer.
Record source and input hashes. Distinguish identical-input renderer overhead
from a comparison of old and new artwork for the same logical scene.

**Verify.** Historical input bytes remain identical between renderer variants.
Read pixels before yielding the presentation texture, require distinct foreground
and clear pixels, and compare warmed samples in alternating order.

## [L-enlarged-text-needs-measured-fonts] Verify the controls actually grew

**What happened.** Increasing the root font size left fixed-pixel window labels
unchanged. Doubling their computed sizes then exposed a clipped Build tab.

**Root cause.** The test assumed root-relative sizing, while some controls used
fixed font sizes and fixed column counts.

**Prevention.** Measure representative computed font sizes before accepting an
enlarged-text check. Let control rows wrap according to their labels and available
width. Inspect both the scrollable choices and the actions needed to use them.

**Verify.** Double the original computed font sizes, including fixed-size labels.
At narrow and desktop widths, reach every choice and action, read complete labels,
and confirm that keyboard focus remains usable after an action hides its control.

## [L-resource-readiness-needs-coherent-frames] Keep static and moving objects in the same view

**What happened.** Delaying a material load stopped static camera updates while
moving objects continued using the new camera. Loading another world could also
leave its Sims drawn over the previous room.

**Root cause.** One resource-ready flag gated only part of a frame and treated
preview resources as prerequisites for an otherwise renderable scene.

**Prevention.** Separate preview readiness from placed-scene readiness. Keep the
current complete scene responsive while a preview loads. If a loaded scene lacks
required resources, suspend its simulation and complete presentation together,
show an actionable loading/error state, and restore the current camera before
revealing it. Release only the pause reason owned by that operation.

**Verify.** Delay and reject a material request. Check camera movement, resize,
Load, Retry and a second Load before the first request completes. Assert that
static and moving objects share the same transform, obsolete resources are
discarded, and unrelated pauses remain active.

## [L-baked-art-needs-independent-identity] Compare finishes with the artwork they represent

**What happened.** An injected catalogue fixture selected alternate materials,
but additions to the default production catalogue were classified as baked art.

**Root cause.** The implementation compared the editable catalogue with itself.
The fixture used a separate object and therefore missed the production path.

**Prevention.** Preserve baked-art identity independently from editable finish
definitions. Exercise catalogue additions through the default production lookup,
including a new palette for an existing pattern and a new pattern.

**Verify.** Both additions must request alternate resources and use shared carrier
geometry. Original descriptors must retain the accepted pixels. Reinstating the
self-comparison must fail those assertions.

## [L-test-session-exit-before-build] Wait for the active check to finish

**What happened.** A production build started while the full web test session
was still running, despite the requirement to run heavy checks serially. A later
test-file rename also remained pending when dependent tests started, producing
file-not-found and obsolete-file discovery failures.

**Root cause.** A yielded command was treated as ready for the next check before
its session returned an exit code. An existing atlas test also timed out earlier
in that run; its timing does not establish that the later overlap caused it.

**Prevention rule.** Keep the current heavy command's session ID until it returns
an exit code. Apply the same rule to mutations that subsequent checks depend on.
Use one command per execution call and one validation owner after edits freeze.
Start the next command only after the current session's completion is observed.

**How to verify.** Record the full run's actual failed result and the unchanged
isolated test's result separately. Confirm that the final serial suite passes;
an isolated pass is not a passing full-suite run.

## [L-window-height-follows-owning-wall] Match aperture art to its wall

**What happened.** Cutaway mode shortened rear windows while their surrounding
walls stayed full height, leaving large notches in the room silhouette.

**Root cause.** Window selection used the global cutaway setting, while rear
shell segments deliberately remained full height. Individual source-raster
comparisons verified both forms but could not detect the wrong combination.

**Prevention rule.** Derive an opening's height from its owning wall. Test rear
and interior openings together under the same scene settings.

**How to verify.** In cutaway mode, require rear windows on both axes to remain
full height and interior windows to use their low forms. Inspect the assembled
room in full and cutaway views, including the joins beside each opening.

## [L-framebuffer-proofs-need-positive-controls] Prove what a pixel sample contains

**What happened.** Architecture depth and opening checks appeared to pass while
sampling transparent or background pixels. A blending check returned the same
color for its background, opaque and faded cases. The replacement capture then
failed because an empty renderer draw did not clear the target. A later source
comparison reported two incorrect edge pixels because its reference image had
lost color precision during a browser canvas conversion.

**Root cause.** The proof copied a presentation canvas after yielding and reused
a two-dimensional canvas without clearing its previous image. It also assumed
that drawing no instances would issue a clear pass, although the renderer returns
early in that case. Comparing two samples did not establish what either showed.
The reference canvas also multiplied translucent colors by alpha and divided
them back, losing integer precision before comparison with the original texture.

**Prevention rule.** Copy the graphics texture before yielding to presentation.
Read independent byte snapshots with explicit row alignment and channel order.
Create the proof's empty background explicitly. Require an opaque background, a
distinct marker and a sample matching the expected source surface before using
their differences as evidence. Decode source references losslessly and verify
their hashes; do not relax tolerances to accommodate a lossy reference path.
Count samples excluded at exact raster boundaries. An aligned camera can put
every pixel on a source-texel boundary, leaving no stable color witnesses.
Report color comparison as unobserved in those explicit cases, retain physical
coverage and order checks, and require color witnesses at offset camera origins.

**How to verify.** Draw a known marker in front of and behind an authored surface.
Require the surface sample to match its source texel. Check a clear-only frame
after a populated frame, and require faded-panel samples to differ from both.
Deliberately reverse depth and enable faded-wall depth writes; each must fail
its intended pixel assertion after the capture controls pass.

## [L-queued-commands-must-survive-save] Check stored command bounds before queueing

**What happened.** A new window command could enter the queue with a span that
overflowed its coordinate type, although the save loader rejected that span.
A save captured before command processing could therefore contain a command
that the same game could not reload.

**Root cause.** Queue admission checked individual fields but left their
combined representational bound to later placement validation.

**Prevention rule.** Validate stored command invariants at every public queue
entry point. Keep those checks separate from ordinary placement refusals, which
depend on the world when the command is applied. Clear an earlier edit result
only after accepting the new command.

**How to verify.** Submit an overflowing span through both typed and raw command
entry points. Require rejection, an unchanged queue and the previous result.
Save and reload accepted pending commands before processing them; compare their
fields and resulting world with uninterrupted execution.

## [L-guard-mutations-need-isolation] A failing test must reach the intended mutation

**What happened.** A split-ownership guard mutation was reported as detected, but
its test failed on clean input before reaching the overlapping-piece case. A
separate material test asserted values that it had constructed itself.
A room-edit mutation later failed on a front-door landing conflict before it
could test preservation of a window model.

**Root cause.** Deleting the assertion also removed initialization from the same
line. The mutation runner accepted the test name in failure output without proving
which case failed. The material test bypassed production classification entirely.
The room fixture combined the intended wall-junction conflict with an unrelated
landing conflict, so a changed refusal did not prove model preservation.

**Prevention rule.** Separate state initialization from assertions. Require clean
input to remain valid under a guard deletion, then require the named bad-input
case to expose the missing guard. Test material ownership through production
classification and exported carrier data.
For transaction tests, establish that the candidate is valid except for the
specific condition under test. Test metadata preservation through an otherwise
valid edit, separately from refusal behavior.

**How to verify.** Delete only the overlap check and observe the overlap assertion
fail after clean validation passes. Misclassify glazing as a paintable surface or
neutralize an excluded material and require the ownership test to fail. Restore
exact source bytes and rerun the clean tests.
Removing a junction check must permit the otherwise-valid crossing edit.
Dropping descriptors during an unrelated room edit must fail the model-identity
assertion. Neither test may rely on a different refusal occurring first.

## [L-mixed-height-wall-mesh] Partition joined solids at shared height boundaries

**What happened.** A mixed-height wall junction failed the exporter’s planar-normal
check even though the individual wall arms were valid.

**Root cause.** Adjacent cells used different vertical subdivisions. Their internal
faces did not cancel when joined, so bevel evaluation produced an invalid surface.

**Prevention rule.** Partition every adjoining cell at the same cut-height plane
before removing shared faces. Preserve the evaluated-normal assertion.

**How to verify.** Export all absent, short and full arm combinations. Check the
mixed-height junction’s shared face ownership and planar normals, then inspect its
source image and joined in-game appearance.

## [L-approved-concept-features] Check defining geometry against the approved image

**What happened.** The first complete twin-casement export had the approved paired
leaves and handles but omitted the horizontal bars visible in the approved image.

**Root cause.** The constructor followed the short model description without checking
every defining feature in the visual reference.

**Prevention rule.** Compare each model with its approved image before accepting the
batch. Record structural features in the source tests as well as the review sheet.

**How to verify.** Require the leaf bars in the geometry test. Inspect every authored
orientation at source resolution and native game scale after export.

## [L-repeated-wall-shading] Inspect evaluated normals on reusable wall pieces

**What happened.** Full-height wall segments formed a flat top geometrically,
but their repeated dark bands looked like notches when joined in the browser.
A distant-light comparison did not remove the bands.

**Root cause.** An architecture Weighted Normal modifier bent evaluated corner
normals toward the closed segment ends even though the top polygon was flat.
The lighting ramp exaggerated the resulting variation on each repeated piece.

**Prevention rule.** Inspect evaluated corner normals as well as polygon normals.
Preserve authored bevel faces and consistent planar shading on reusable pieces.
Do not change the lighting or hide joins with larger sprites before establishing
whether the surface, normals or texture ownership caused the discontinuity.

**How to verify.** Assert planar corner normals agree with their face normals
during export. Inspect joined full-height walls on both axes in the actual
renderer, including caps and exposed ends, at native and enlarged scale.

## [L-floor-coverage-needs-shared-edges] Tile coverage must survive pan and zoom

**What happened.** Floor sprites showed dark joins. Exported alpha ownership
removed most gaps, and a fractional-origin browser test passed, but the actual
room still had holes. Per-tile fragment clipping then failed two fractional-zoom
cases after appearing correct at native scale.

**Root cause.** Export texel coverage does not establish framebuffer coverage.
Neighboring fragments also calculated their local boundaries independently from
rounded screen centers, so complementary inequalities could both reject a pixel.
The first coverage test omitted the camera positions that exposed the defect.

**Prevention rule.** Give adjacent floor sprites identical shared vertices from
canonical world corners and one camera transform. Let rasterization own the shared
edge. Do not expand tiles, bias the camera, or loosen coverage assertions to hide
holes. After three failed approaches, obtain a fresh architectural review.

**How to verify.** Retain the failing fractional origins alongside native and
fractional pan/zoom cases. Check reversed draw order, contrasting materials,
missing tiles and the immediate exterior boundary. Inspect an actual furnished
room as well as isolated coverage tests.

## [L-preview-fixture-identity] Give each reviewed export its own resource paths

**What happened.** A browser proof loaded a previous candidate's cached JSON
manifest with the next candidate's color and depth textures. The renderer rejected
their disagreeing dimensions.

**Root cause.** Replacing a fixture directory did not invalidate Vite's transformed
JSON module. The resource paths stayed the same while their contents changed.

**Prevention rule.** Publish each review candidate under a distinct immutable
directory and reference that candidate's manifest and textures together. Keep
dimension and byte-length validation at the renderer boundary.

**How to verify.** Compare the served manifest dimensions with the decoded image
and depth byte count. Run the isolated browser proof after switching candidate
paths, and retain the candidate identity and hashes with its result.

## [L-architecture-export-isolation] Validate the whole source render before packing

**What happened.** The first architecture trial retained fragments of the reference
Sim's eyes. A second trial clipped wide panels and floor patches at the source
canvas edge. Both candidates were rejected before owner review.

**Root cause.** Visibility drivers overrode individual objects' `hide_render`
settings. Source framing also accounted for wall height without enough room for
the projected ground extent of wider pieces.

**Prevention rule.** Isolate preserved reference meshes and curves in a
render-hidden collection, following the existing static-export pipeline. Validate
the complete alpha bounds before cropping or packing each color/depth pair.

**How to verify.** Require every source image's alpha bounds to sit strictly
inside the canvas. Inspect both wall axes and all width classes, retain rejected
candidate evidence, and compare the reference rig hash before and after export.

## [L-concept-context-is-art-direction] Surroundings in a concept sheet affect approval

**What happened.** A window-selection sheet showed the proposed windows inside
substantial beveled plaster walls. The owner approved all nine windows but pointed
out that the surrounding walls looked better than the actual game, then requested
matching wall and floor work.

**Root cause.** The sheet was labeled concept art, but its surrounding architecture
still implied an in-game appearance the current renderer did not provide. A label
alone did not establish the difference between a proposed object and its context.

**Prevention rule.** Identify proposed changes to surrounding art when presenting
asset concepts. Before producing a full coordinated asset set, show a small room
through the actual renderer with existing furniture and a Sim for scale. Preserve
approved object choices separately from approval of new surrounding materials.

**How to verify.** The windows/walls/floors spec records all nine window approvals
and identifies floor finishes as proposals. Its implementation plan requires a
rendered room checkpoint before the full architecture batch. Compare that room
with the approved board at native game scale, including joins, depth and lighting.
## [L-audio-observer-can-clean-up] A cleanup counter is not a passive observer

**What happened.** Memory-proof wording treated a zero voice count after playback
as proof that the natural `onended` handler had released ownership.

**Root cause.** The count getter calls expiry cleanup. Pause also stops voices.
Either operation can clear the records before the assertion observes them.

**Prevention rule.** Trace the observation path as well as the playback path.
Label getter-assisted and pause-assisted cleanup accurately. To prove natural
cleanup, wait for native ended events and inspect ownership directly before
calling a cleanup getter, pause, stop or another play operation. Do not use a
passing narrow lifecycle proof to override a failed whole-page memory budget.

**How to verify.** Check one real decoded voice and a four-source batch. After
their native ended events, require an empty ownership Map, cleared handlers and
disconnected nodes without invoking a cleanup helper. Preserve raw memory
failures separately from this lifecycle evidence.

## [L-audio-memory-matched-baseline] Match the measured world after audio preparation

**What happened.** The audio memory check warmed random worlds for a fixed time
without proving that new playback paths had run. A replacement lifecycle
warmup started both controls from one save, but waiting for natural audio to
end could still leave the measured worlds at different ticks.

**Root cause.** Shared starting data was mistaken for equivalent measurement
conditions. Audio completion uses real time while the simulation continues.
Another autonomous action can extend only the sound-enabled preparation.

**Prevention rule.** Exercise the required playback and cleanup paths, then
restore a shared measurement fixture before collecting the baseline. Require
matching baseline world hashes and ticks. Never reload during the measured
interval. Fingerprint the JS and WASM response bodies actually loaded, not a
later refetch. Mark heap-snapshot callback runs diagnostic-only and reject
them from acceptance.

**How to verify.** Keep failed reports. Negative report tests must reject
mismatched worlds, builds, incomplete lifecycle preparation and instrumented
runs. Preserve the original 540-tick measured window and 65,536-byte raw JS
growth allowance. A smaller second window or V8 compiler-category growth is
diagnostic evidence, not permission to replace or subtract from that gate.

## [L-audio-timer-covers-completion] Measure every fixed-tick audio path

**What happened.** Review found completion-event draining before the audio
sampler's timer started. Overall frame timing included it, but the dedicated
audio budget did not.

**Root cause.** The new completion path was added beside the existing Sim and
portal samplers without extending their measurement boundary.

**Prevention rule.** A fixed-tick audio budget must include completion transport,
dispatch and playback setup, not just the older observation paths. Disabled
audio still drains transient events without emitting sound.

**How to verify.** Assert the ordering of the timing boundary and all audio
paths, including disabled sampling. Run the production timing proof and report
unavailable refresh-rate coverage separately from measured audio work.

## [L-preload-is-not-playback] Paused overlays can supply the first audio gesture

**What happened.** The first toilet completion reached the browser but stayed
silent; the second played. Unit playback and decoded-signal checks had passed.

**Root cause.** The recording loader reused the playback gate, which rejects
simulation pause. Trusted input is handled in capture phase, before Help or
Options closes. That gesture unlocked audio while the overlay still paused the
game, so it did not preload. The first completion started a fetch and was
correctly discarded rather than replayed late.

**Prevention rule.** Separate permission to prepare a recording from permission
to play it. A running, unmuted context with nonzero Effects may preload while
the simulation is paused. Actual playback must still honor pause and all other
silence boundaries. Do not patch a proof by adding an unrelated extra gesture.

**How to verify.** Unlock while paused, await exactly one decode, and require
zero played voices. Resume and complete actual toilet use; require its exact
source event and a played cue on that first completion. Keep cancellation,
late-decode and paused-playback rejection tests.
## [L-build-controls-intrinsic-space-and-focus] Allocate actual control space and retain focus

**What happened.** Compact Build controls overlapped the panel with enlarged text. Container moves lost keyboard focus in Options, zoom controls and Build-panel descendants.

**Root cause.** A desktop display selector overrode the compact camera grid. The action positioner bounded its box below the actual buttons' height. Independent fixed boxes could not allocate shared space. DOM reparenting then removed the active control without restoring focus.

**Prevention.** Compare selector specificity at responsive boundaries. Allocate intrinsic control height in one short-screen grid, reserve visible game space, and scroll tool content below navigation. Preserve a focused descendant across the complete move when it remains visible and enabled. Do not treat a smaller container as evidence that its children fit.

**Verify.** Measure every button, its hit target and nearby panels with doubled text, long feedback and expanded disclosures. Check focus through Options opening and closure, and across 701px/700px in both directions for selectors, Shortcuts and Exit build. Deliberately break pending guards, input ownership, hiding and unchanged-frame guards; retain failures and verify byte-identical restoration. See the dated [Build controls evidence](assets/review-evidence/build-controls/README.md).

## [L-changelog-has-its-own-tested-history] Published Markdown needs a site history

**What happened.** Adding a generated changelog to a site whose CI skips Markdown exposed two publication gaps: notes would not trigger Pages, and comparing notes only from the last tested game would repeatedly redeploy later unrelated documentation.

**Root cause.** The existing classifier had one history because all served content was game code. The changelog introduces independently editable, published Markdown.

**Prevention rule.** Keep game checks based on the newest successful main push whose web job passed. Compare published notes from the newest successful main push whose changelog or web job passed. Report both `code` and `site`; Pages must use `site` when deciding whether newer content makes an artifact stale. Check all published notes before allowing publication.

**How to verify.** The change-classifier tests use real Git commits to add, edit and delete notes, then add unrelated documentation after a tested note. Notes require site publication without game tests, later unpublished docs skip, and untested code cannot hide behind either. Deleting the published-note classification must fail these assertions. The Pages contracts require successful push CI, the triggering SHA and the generated artifact.
## [L-floor-help-viewport-transition] Compact floor help must follow viewport changes

**What happened.** The played renderer check changed a desktop viewport to 390px
and found keyboard instructions still visible in the floor tool.

**Root cause.** Floor controls received the initial compact state, but the shared
media-query change listener updated the other build controls without them.

**Prevention rule.** Wire every responsive build control into both initial state
and the existing viewport-change listener. Keep instruction text unchanged.

**How to verify.** Run floor-control and compact-HUD tests, then resize the running
game from desktop to a small viewport and back. Verify touch help replaces keyboard
help on the small viewport and keyboard help returns on desktop. The live transition
check remains separate from unit tests of setCompact.

## [L-packed-instance-count] The packer must publish the draw count

**What happened.** Floor-tool highlights were packed into the instance array but
left outside the uploaded live prefix. Wall and room highlights still drew.

**Root cause.** Main rebuilt the draw count in a second traversal with a separate
highlight argument list that omitted the floor tool. Counting also repeated world
column reads and interaction selection after packing had already done that work.

**Prevention rule.** Publish the final written slot from the packer, including the
last highlight writer. Draw the borrowed array with that count immediately. Update
count on every frame and the pointer on growth; reuse the result object. Keep legacy
verification helpers outside the production draw path.

**How to verify.** Execute main's actual packing and draw statements with a floor
highlight and assert two uploaded ring rows with no recount. Test independent exact
counts and rows, one real interaction update, growth followed by shrink and empty
frames, and the legacy wrapper. Delete each publishing mechanism and reintroduce
the production recount separately; each covering test must fail an assertion.
Update production-wiring assertions that counted the old duplicate call sites;
they must require one preview/highlight argument list rather than preserving the
removed recount as a test expectation.
## [L-generated-copy-needs-directory] Create the generated bundle directory before copying

**What happened.** The new door checkout could not import generated WASM glue;
27 test files and the displayed game failed to start.

**Root cause.** Root copied several generated files to `web/src/wasm` before
creating that directory. PowerShell treated the destination as one file.

**Prevention rule.** Create and verify the destination directory first. Check
the generated file inventory and WASM hash before starting tests or a preview.

**How to verify.** Require all five bundle files at their expected paths and
the reviewed WASM SHA-256. Preserve the mistaken copy in ignored scratch, then
run the failed checks against the corrected bundle.

## [L-door-output-policy-is-separate-from-transition-state] Silent opening still anchors the close

**What happened.** The owner rejected the initial door recordings as loud and
high-pitched, asking for silent opening and only the closing impact.

**Root cause.** The initial selection retained the squeak and played both
transition types. Signal bounds alone did not establish listening acceptance.

**Prevention rule.** Keep simulation transition tracking independent of sound
selection. Silence opening in the controller without removing the scheduler's
opening anchor; load only the filtered closing asset. Preserve original files.

**How to verify.** After preloading, opening must create zero source and gain
nodes and keep its play count at zero. The next close must create exactly one
source, with the only fetch URL `audio/doors/close-thunk.wav`. Delete the silent
opening guard and restore the old URL separately; both must fail the regression.

## [L-door-install-ownership] One checkout has one dependency installer

**What happened.** Root and a worker started locked dependency installs in the
same new audio checkout. One run emitted extraction warnings; the other failed
with ENOTEMPTY, and the following test could not find Vitest.

**Root cause.** Setup ownership was not communicated before dispatch. Each
installer removed files the other was extracting.

**Prevention rule.** Root completes dependency setup before delegating tests,
or explicitly assigns installation to the worker. Never overlap installs in
one checkout. Infrastructure failures do not count as a behavioral RED test.

**How to verify.** After both original installs finish, run one serial locked
install. Require clean exit and the actual focused tests to start before
recording regression evidence. The serial recovery installed 48 packages in
911 ms with exit 0 and no warnings.

## [L-audio-state-events-cover-paused-worlds] A paused simulation cannot observe browser interruption

**What happened.** A browser interruption while simulation ticks were paused
froze existing sources and release-only recordings. Native resume replayed the
object release at `0.08399999886751175` rather than zero without a new gesture.

**Root cause.** Global unavailability was observed only at fixed-tick boundaries
and explicit gestures. A paused world supplied neither, so the player graph and
scheduler history remained owned throughout the stopped audio clock.

**Prevention rule.** Bind one controller-owned context state handler after player
construction. Non-running events immediately dispose every player, clear pending
ownership and reset every scheduler. Running events admit no playback. Detach
failed graphs before close and guard callbacks by captured context identity.

**How to verify.** Start positive object, conversation, door and procedural
sources, pause or end into release, then interrupt and recover through context
state events without a fixed tick or another gesture. Render resumed samples
alongside ordinary-fade controls. Delete event cleanup, scheduler reset and the
captured-context guard independently; each covering regression must fail.

## [L-binary-tests-need-bounded-diffs] Compare large binary artifacts without printing every byte

**What happened.** A deliberately changed audio seed caused a deep byte-array
assertion to spend excessive time formatting hundreds of thousands of values.
The task-owned test was stopped and the source restored.

**Root cause.** The assertion requested a structural diff of a complete WAV
when the useful evidence was whether the bytes matched.

**Prevention rule.** Use byte equality plus a fixed content hash for large
reproducible artifacts. Assert header fields and signal bounds separately.
Keep negative CLI checks isolated from the real runtime asset.

**How to verify.** Changing the seed must fail the equality assertion promptly;
silence must fail the signal bound; removing the publication guard must fail an
isolated differing-output test without modifying the shipped WAV.

## [L-audio-retained-is-not-active] Silence boundaries must include release-only nodes

**What happened.** A recording ended normally, began fading, then the browser
suspended audio. Its remaining release resumed later despite an empty audio
frame. Both object and conversation output reproduced the tail.

**Root cause.** The scheduler had removed the owner and the player had removed
its active record. Only the separate collection of draining nodes still held
the release. Active counts and repeated exact-owner stops could not find it.

**Prevention rule.** Global unavailable-frame cleanup must inspect retained
records and immediately dispose active and draining nodes. Preserve default
fades on a running audible clock and keep direct stops identity-specific.

**How to verify.** End while running, suspend midway through the release,
process an empty frame, and render the resumed samples. Require zero across
the entire resumed tail, alongside a positive normal-fade control. Cover
throwing stops and stale callbacks as well as retained counts.

## [L-browser-cli-page-argument] Check the CLI callback signature

**What happened.** Two cleanup callbacks destructured `{ page }`, received
undefined and failed before closing their task-owned page. Explicit session
close then closed both browsers.

**Root cause.** The callback shape was borrowed from a different browser API.
This installed CLI passes the page directly, not an object containing it.

**Prevention rule.** Check `playwright-cli run-code --help` before authoring
its callback. Use `async (page) => { try { ... } finally { await page.close(); } }`.
Keep session close as a fallback, and never include another task's browser.

**How to verify.** A task-owned `about:blank` callback returns its URL and closes
the page in `finally` without an exception. The corrected callback passed that
check before this lesson was recorded.

## [L-audio-observations-require-playback-availability] Do not consume starts that cannot play

**What happened.** An action first observed during external audio suspension
could remain silent after the browser resumed automatically. Gesture-driven
recovery worked and concealed the missing automatic path.

**Root cause.** Playback rejected an inaudible start after the scheduler had
already recorded it. The unchanged next action could not emit another start.

**Prevention rule.** Gate observations across every scheduler family on the
same global playback predicate, while always finishing begin/end frames. Let
absence handling release ownership and phase. Never reset an open frame from
inside emission. At the first unavailable frame boundary, also stop unfinished
procedural and door cues; otherwise their frozen tails can overlap fresh audio.
Keep direct cancellation independent of playback availability.

**How to verify.** Begin and replace actions while suspended, then return to
running without a gesture. Require current actions to start, departed actions
to stay silent, and footsteps/doors to re-anchor without replay. Include native
rendered samples as well as controller and nested fixed-tick sampler tests.

## [L-audio-cancellation-without-playback] End ownership even when sound cannot play

**What happened.** Object and conversation end events were discarded while an
externally suspended audio context could not play. Their schedulers forgot the
ended actions, but native loops or pending recordings could survive and resume.

**Root cause.** One audibility gate controlled both playback admission and
ownership cancellation. Gesture-driven recovery hid the missing terminal path
in earlier tests. A normal fade also cannot finish on a suspended audio clock.

**Prevention rule.** Process exact-source cancellation independently of playback
availability. Clear pending ownership first. Preserve normal fades when the
clock runs; release the affected nodes immediately when it does not.

**How to verify.** End an action through public frame APIs during suspension,
return to running without a gesture, and settle a late recording load. Require
no revived source or retained nodes. Render samples across native suspension
to distinguish real cleanup from an active-count change that hides a frozen fade.

## [L-audio-decode-detaches-input] Capture encoded metadata before decoding

**What happened.** A paper-recording screening report showed zero encoded bytes
for four successfully decoded files.

**Root cause.** `decodeAudioData` detached its input ArrayBuffer before the
report read `byteLength`. The zero described the consumed buffer, not an empty
source file.

**Prevention rule.** Capture encoded byte length and hash before decoding. Keep
source-file identity separate from decoded frames, channels and duration.

**How to verify.** Compare reported byte counts and hashes with the original
files, then check decoded sample counts and finite-value bounds separately.
Keep the corrected measurement report rather than silently interpreting zero
as a valid source size.

## [L-audio-proof-visible-gesture] Discover visible controls before driving audio checks

**What happened.** A production sink check first used the wrong preview URL
scheme, then tried a canvas point covered by the HUD, then tried Help while its
Options panel was closed. Three attempts failed before testing sink playback.

**Root cause.** The harness guessed control reachability from DOM presence.
The existing memory helper also relied on optional first-run Help for audio
activation; synthetic speed changes cannot supply a trusted user gesture.

**Prevention rule.** Check the server's printed URL and take a fresh UI snapshot.
Use the shared setup to dismiss first-run Help if present, then open and close
the visible Options control. Do not force hidden clicks or disable autoplay.

**How to verify.** Test setup with and without first-run Help. In the actual
game, require the intended sink action, exact source ID and positive loop count
before checking stop behavior. A screenshot or zero final voices alone is insufficient.

## [L-audio-catalog-status] Keep sound status accurate across summary documents

**What happened.** The full-game systems summary still described shower water
as silent and door sounds as absent after both had been integrated.

**Root cause.** Detailed audio specs were updated without reconciling the
cross-system summary. Its older statement contradicted the implementation.

**Prevention rule.** When adding an audible source, search FEATURES,
GAME-SYSTEMS, TIM-TODO, ARCHITECTURE and ASSETS for its earlier status. Keep
technical playback, owner listening acceptance and public deployment distinct.

**How to verify.** Trace each current status statement to authored content and
the runtime catalog. A selected recording may be provisional, but must not
still be described as missing or silent.

## [L-memory-endpoints-need-equivalent-ui] Compare matching HUD and audio states

**What happened.** The door-audio memory run passed its retained-heap allowance
and scheduler bounds but failed exact DOM-node and listener comparisons.

**Root cause.** The selected person's moodlets and action cards changed during
the run, including in audio-disabled controls. Pause intentionally allowed short
recordings to finish, so a 250 ms delay still counted door `onended` listeners.
After those differences were removed, a tree comparison found one hidden
` (low)` text node retained in the deselected needs panel. This was bounded
view state, not a memory leak. The empty-panel lifecycle now clears obsolete
warning labels; selecting a person again renders their current warnings.

**Prevention rule.** At both paused measurement endpoints, clear selection through
the public simulation command and wait for empty moodlet/action rows. Restore
selection before the measured gameplay interval. Wait boundedly for all audio
players to drain before collection. Retain exact node/document/listener equality;
subtracting every connected node would hide connected leaks.

**How to verify.** Enabled and disabled browser pairs must pass with equivalent
endpoints. Negative report fixtures independently add one node, document or
listener; deleting each equality check must fail its regression. Clone fixture
endpoints separately so modifying the final sample cannot also change baseline.

## [L-door-proof-needs-live-tracks] A bounded scheduler must also be exercised

**What happened.** Independent review found that the new door memory checks
would accept an audio-enabled run with zero door tracks throughout.

**Root cause.** Upper bounds constrain growth but cannot prove the fixed-tick
sampler ran. Omitting the sampler would satisfy every zero-friendly limit.

**Prevention rule.** Require a positive observed track sample in enabled runs,
alongside live-count, retained-capacity and voice bounds. Keep disabled controls
silent. Test geometry coordinates independently and churn removed identities
to distinguish reusable storage from a growing history.

**How to verify.** The memory-report regression rejects all-zero enabled door
samples. Removing that guard must fail the regression with expected false,
received true. The actual browser run must also exercise portal tracks.

## [L-provisional-audio-is-not-listening-approval] Keep evidence limits separate from authorization

**What happened.** Successive audio slices left household objects silent despite
the owner's authorization to select and deliver routine sound improvements.

**Root cause.** An assistant-authored checklist expanded the human-listening
gate for replacing accepted cues into a ban on all additive provisional sounds.

**Prevention rule.** Follow the actual approval boundary. A small additive sound
may ship under existing selection authority after provenance, editing, measured
mixing and lifecycle checks, while explicitly retaining unverified subjective
acceptance. Do not claim to have heard audio when only waveform data is available.

**How to verify.** Trace one real game interaction to its exact source-owned
recording, test decoded output and lifecycle silence, and document provenance
and the listening limitation. Keep replacement of accepted cues separately gated.

## [L-browser-export-return-value] Return structured data from the CLI callback

**What happened.** Three water-export attempts failed: unavailable `require`, a
large base64 command argument, and console output that was not a structured result.

**Root cause.** The export assumed Node globals and console forwarding inside
the Playwright CLI callback instead of using its supported route and return APIs.

**Prevention rule.** After three similar failures, obtain fresh-context better-way
review before another attempt. Serve the source through `page.route`, decode in
the browser, and return the result. Do not embed binary sources in shell arguments.

**How to verify.** A small sentinel return must appear under `### Result`; then
the exported WAV must match its measured frame count and recorded SHA-256 digest.

## [L-browser-proof-public-urls] Resolve served recordings as browser URLs

**What happened.** The recovery browser proof retried both recordings because
its supposed successful input never decoded. Two fixture runs failed.

**Root cause.** Vite rewrote `new URL(..., import.meta.url)` as a bundled asset
reference. Public WAV files were not in that source-relative asset map.

**Prevention rule.** For a browser proof requesting served public files, resolve
the runtime URL against the page location. Check the transformed fixture and a
direct fetch/decode before treating a fixture failure as a production defect.

**How to verify.** The recovery proof must fetch the successful WAV only once,
retry the failed WAV once, and render nonzero samples for the surviving pair.

## [L-voice-cache-holes-need-recovery] Array length does not prove recordings loaded

**What happened.** A temporary download or decode failure could leave affected
conversations silent until page reload. Even explicitly loading the library
again made no new requests.

**Root cause.** Failed recordings retained their array indices as undefined
slots, but the controller checked array length rather than slot contents. The
game also had no recovery trigger after initial loading.

**Prevention rule.** Check decoded slots, preserve successes, and retry missing
recordings from a bounded semantic demand path. Keep download completion separate
from permission to play: ended or invalidated interactions must stay silent.

**How to verify.** Fail one recording, recover the network, and start a new
conversation after the cooldown. Only the missing file should be fetched again.
Hold recovery across end, mute, Effects zero, Load, and background boundaries;
the old conversation must not return. The browser proof in
`docs/specs/2026-10-01-voice-download-recovery.md` also checks real decoded samples.

## [L-test-cleanup-needs-owned-paths] A rejection test must not delete its target blindly

**What happened.** Review found an audition-builder test that used a fixed
repository output filename and deleted it in `finally`. If that path already
contained an owner's file, the builder would correctly refuse to overwrite it,
but test cleanup would delete it anyway. No owner file was deleted in this run.

**Root cause.** The test treated a path it named as a file it owned, including
when the production guard correctly prevented creation.

**Prevention rule.** Create a uniquely owned temporary directory for each
filesystem fixture and clean up only that directory. A failed operation does
not establish ownership of its target. Never delete a fixed-path sentinel
merely to leave a test clean.

**How to verify.** The repository-output test creates an `audition-test-*`
directory with `mkdtempSync`, registers that exact root for cleanup, and asserts
the rejected output was never created. A separate existing-output test proves
the builder leaves the original bytes unchanged.

## [L-audio-clear-before-hardware] Invalidate pending ownership before changing browser gains

**What happened.** New object-loop regression tests injected a failure into
gain automation during mute and Effects-zero changes. The old ordering touched
the browser gain before clearing pending playback. Both tests reproduced a
late recording installation starting a source whose ownership should have
been invalidated.

**Root cause.** A synchronous audio hardware failure skipped the cleanup that
followed it. The preference changed, but the pending source survived.

**Prevention rule.** Clear desired and pending ownership and stop owned players
before a fallible browser operation at a global silence boundary. Hardware
cleanup remains failure-isolated; logical invalidation must not depend on it.

**How to verify.** Inject gain-cancellation failures at mute and Effects zero,
restore the preference, then install a previously missing recording. No source
may start until a fresh fixed-tick observation. Also require every previously
retained object node to be released at global silence boundaries.

## [L-carry-forward-audio-approval] Execute approved routine work without reopening the decision

**What happened.** Automatic continuation turns repeated the pending Voices
slider and four-pack download questions. The owner approved both and explicitly
asked for ordinary decisions to use judgment rather than more questions.

**Root cause.** The approval state was not recorded in the intake contract, and
continuation messages repeated the same request without a new decision to make.

**Prevention rule.** Carry explicit approval into the task's current docs and
execute the approved work. Do not ask again about the same slider design, pack
set or routine implementation details. Keep costs, dependencies, destructive
actions and materially different scope subject to their separate rules.

**How to verify.** The intake spec records the approved set, the results identify
the downloaded hashes, and the Voices default preserves existing preferences
and the accepted mix without asking the owner to choose implementation details.

## [L-conversation-identity-is-not-a-household-mask] Track the actual interaction instance

**What happened.** A second conversation starting or ending could restart an
unrelated recorded pair. The household-wide talker mask also collapsed IDs
above 30, despite the allocator issuing new IDs throughout the household's life.

**Root cause.** Playback inferred conversation identity from aggregate activity
and selected clips instead of the simulation's initiator/partner relationship.
A small maximum household size was mistaken for a bound on stable identifiers.

**Prevention rule.** Project authoritative interaction identity onto both
participants and retain it through scheduling, pending loads and playback.
Keep wide identity integers exact across the Rust/JavaScript boundary. An
individual end event must not invoke household-wide cleanup.

**How to verify.** Run two simultaneous pairs with the same clips and end either
without restarting the other. Repeat clips in a later instance, reorder rows,
use IDs above 30 and completion tokens above `2^53`, then test load cancellation.
Render real audio samples while one pair ends and the other remains active.
See `docs/specs/2026-09-30-conversation-audio-ownership.md` for evidence.

## [L-audio-envelope-needs-rendered-proof] A scheduled fade may still produce a hard cut

**What happened.** Conversation stops scheduled a fade but cancelled the ramp
that supplied its starting level. A real offline audio render exposed an
immediate 0.149-to-zero jump. Construction failures also abandoned source nodes
created before their registration in the cleanup list.

**Root cause.** Tests inspected ramp calls rather than rendered samples, and
the failure fixture covered gain creation but not partial source construction.
Very short buffers also let natural attack and release endpoints overlap.

**Prevention rule.** Preserve the exact envelope value and trajectory when
cancelling automation; finish the fade before the samples end. Register nodes
at creation, before any later operation can fail. Bound envelope edges for
short buffers instead of assuming every input is a full-length recording.

**How to verify.** Run the real `OfflineAudioContext` proof in
`web/proofs/voice-fades.js` at attack, plateau, release and natural completion.
Inject failures into each source-construction stage and require immediate
disconnection. Delete the anchor, ownership, teardown, end clamp and short-edge
bound independently; each regression must fail. Evidence and restoration hashes
are in `docs/specs/2026-09-30-conversation-audio.md`.

## [L-chronotype-lifecycle-and-sign] Test the schedule's meaning and its full lifecycle

**What happened.** Content declared early-riser and night-owl offsets, but
household creation left both at zero and saves omitted the field. Independent
review also found that the phase calculation reversed the intended timing.

**Root cause.** The compiler and curve helper had tests, but the compiled field
was not traced through spawning, saving, loading and hashing. Arithmetic tests
copied the implementation's plus sign instead of specifying when an early or
late schedule should reach a known point on the curve. Old docs still called
the enabled curve disabled.

**Prevention rule.** For each behavior-bearing field, test authored input through
the runtime lifecycle. Define the sign in player terms before testing arithmetic.
Preserve historical defaults explicitly; do not infer missing saved state from
current content. Recheck current configuration when updating old status notes.

**How to verify.** Starters and newcomers receive exact authored offsets; V5
retains arbitrary signed offsets and their owners, while older saves retain
zero. Test the same evening curve point at clock ticks 1230, 1320 and 1500 for
offsets -90, 0 and +180. Removing propagation, persistence, hash input, ordering
validation or correct phase direction must fail a focused regression. See
`docs/specs/2026-09-30-sleep-schedules.md` for the evidence contract.
## [L-sprite-label-not-direction] Saved facing codes do not prove an asset's physical front

**What happened.** Replacement chair art kept the NW code, passed four-view
mapping tests and left the saved world unchanged, but faced sideways to its desk.

**Root cause.** The old base sprite faced game +Y; the new model's standard SE
export faced +X. Review checked distinct rotations and labels without tracing
the physical front through the Blender camera and the existing game convention.

**Prevention rule.** Preserve the existing physical meaning of every saved
facing. Fix the individual model's authoring basis, not the lot placement or
shared exporter. Derive its front from visible geometry, not a metadata label.

**How to verify.** The chair's seat-to-back vector test fails on the sideways
source, then passes after its baked -90 degree turn. Check the saved model's
front vector under all four export rotations and inspect it beside the desk.
An unchanged save hash proves no state change, not a correct rendered direction.

## [L-hidden-support-envelope] Attached supports can still break through a visible surface

**What happened.** The office chair passed every attachment test, but close
review found a faint mark on its rear shell. The hidden spine protruded about
0.005 model units through that face.

**Root cause.** Positive overlap proves a joint exists, not that a support stays
inside the part meant to conceal it.

**Prevention rule.** Check both contact and the hidden support's outer envelope.
Keep a deliberate clearance from the visible rear surface, including bevels.

**How to verify.** The original source fails the spine-clearance test. The saved
scene checker also rejects a rearward displacement. Inspect the rear-facing
original images after rerendering; a passing bound is not visual acceptance.

## [L-short-wall-transparency] Test the bound pipeline, not just its descriptor

**What happened.** Short walls needed local transparency without reviving the
furniture clipping problem. Review also found that a renderer early return
ignored wall-only frames and that Load inherited the previous world's fades.

**Root cause.** Opaque rendering assumptions survived the addition of a second
layer. A single transparent wall drawn last cannot prove depth writes are off,
and camera rebuilds are not the same lifecycle event as replacing a save.

**Prevention rule.** Share an explicit pipeline layout. Draw short walls after
opaque geometry, with depth testing but no depth writes; apply opacity after
coverage testing. Keep the wall raster height in its depth projection. Retain
fades through camera changes, but reset them after successful world replacement.

**How to verify.** Two equal-depth 25% surfaces must yield 43.75% combined
coverage, including with no opaque instances. Mutating the bound pipeline to
write depth fails that GPU check. Separate actor/socket proximity tests cover
multiple panels, interpolation, reduced motion and Load. Use the isolated
`web/proofs/index.html` harness rather than booting another game underneath
GPU probes, and close disposable contexts in `finally`.

## [L-release-monitor-missing-checks] A pushed PR is not a running release

**What happened.** The selection fix was pushed, but its CI never appeared and
the task stopped. The owner had to ask for work to continue.

**Root cause.** An empty check list was treated as pending CI without confirming
a run existed, and no release continuation was active.

**Prevention rule.** Confirm the exact-head CI run exists. When event delivery
fails, use the repository's existing workflow-dispatch path. Carry the authorized
release through checks, merge, Pages and live verification; keep continuation
active across hosted waits rather than requiring another owner message.

**How to verify.** Record the run ID and tested SHA, then the merge SHA and actual
deployment step. Copilot review runs do not substitute for CI.

## [L-builder-selection-handoff] Switching furniture must resolve its pending preview

**What happened.** Selecting another item discarded a moved preview, even when
the move was valid. The owner expected selection to act like Confirm.

**Root cause.** Selection replaced editor state without resolving the outgoing
edit. Preview and placement were separate, but their handoff had no contract.

**Prevention rule.** Commit a valid changed preview through the existing command
path before switching; cancel an invalid preview and switch immediately. Keep
the deferred target until the result arrives, and clear it on Load. Do not queue
placements for unchanged items or duplicate a completed manual confirmation.

**How to verify.** Real-WASM tests cover movement, rotation, invalid cancellation,
command-time rejection, rapid reselection, Load reset and dropdown state. Removing
the valid-preview guard failed with selected object 15 instead of 22. Restored
builder.ts SHA256 is 8DC185DBEAC1B512188BD91330DC3DB981CB6FD55F6A3D10EFB1E67C882A9524.

## [L-wide-furniture-depth] Wall-plane depth needs compatible furniture depth

**What happened.** The first clipping correction restored the laundry, toilet
and desk chair, but the user found the desk and bunk still cut off on the right.
The first occupied follow-up also let the upper mattress cover half a sleep icon.

**Root cause.** Tests covered one-tile furniture against wall planes, while
multi-tile art still used one depth at its center. A wall could therefore win
against the nearer end of a wide object. Occupied UI indicators inherited the
same constant-depth assumption even after the furniture was corrected.

**Prevention.** Give rectangular furniture a per-column depth derived from its
oriented physical footprint. Apply its owner's projection to occupied composites,
foregrounds, indicators and previews. Keep each sprite's canvas registration.
Do not move furniture or bias whole walls to conceal ordering defects.

**Verification.** Exercise real frame construction for desk and bunk in all four
facings, both wall axes, both sides and three zooms. Include occupied contribution
masks and indicator-only comparisons, not merely the empty bed's silhouette.
Keep the prior one-tile, corner and doorway checks. Mutation-test disabled and
reversed projection, width/depth swaps, anchor omission, wrong occupied ownership,
stale row fields and missing indicator projection. Review close-up played images.

## [L-builder-preview-overlap] Preview geometry and drawing must agree

**Superseded.** [L-furniture-preview-replacement] replaces this overlap-only
presentation rule. Drawable move previews hide their original even when refused
or nonoverlapping; the following account records the earlier behavior.

**What happened.** The first played builder pass showed old chair arms behind
a rotated candidate, and old table artwork beneath a partially overlapping
move. The initial valid tint also obscured surface detail.

**Root cause.** Drawing both complete objects at intersecting footprints is not
a useful preview. An origin-only replacement rule missed partial intersections.

**Prevention.** For valid overlapping candidates, replace only the selected
object's presentation. Share one rectangle-intersection predicate between
instance counting and drawing, including foreground layers. Keep the original
marker, world state and cancellation behavior intact. Invalid or nonoverlapping
candidates retain the original artwork.

**Verification.** Real chair, foreground-object and rectangular-table tests
assert matching draw counts, untouched other rows and byte-identical saves.
Played desktop and 390x844 phone checks confirm clean artwork and readable
controls. Evening and reduced-motion checks are separate visual observations.

## [L-atlas-append-provenance] Reconcile provenance after another sprite batch merges

**What happened.** Asset notes retained a 1,221-record total and door indices
1217 through 1220 after main inserted four half-wall sprites before the door.

**Root cause.** The generated atlas and prefix tests were reconciled during
integration, but the human-readable provenance count was not.

**Prevention rule.** When merging an appended asset batch, verify the total,
each new interval, dimensions and preserved prefix against the generated
manifest before publishing its provenance notes.

**How to verify.** The manifest has 1,225 records: half walls at 1217 through
1220 and the door at 1221 through 1224, in a 4096x7928 atlas. All five prefix
tests pass, including the complete 1,221-record pre-door pixel digest.

## [L-instance-stride-integration] Share row offsets across renderer integration tests

**What happened.** Integrating wall-plane depth expanded instance rows from
eight to ten floats. Portal rendering used the shared writer correctly, but
three portal tests still addressed fields with the old eight-float stride.

**Root cause.** Hard-coded test offsets duplicated the instance layout. The
new wall fields also needed explicit zero values on reused portal rows so
frame and leaf sprites retained their existing depth ordering.

**Prevention rule.** Allocate and index integration fixtures with
`FLOATS_PER_INSTANCE` and the named field offsets. Prefill reused rows with
sentinels and assert both portal layers clear `OFFSET_WALL_MASK` and
`OFFSET_WALL_DEPTH_STEP`, alongside their geometry, lighting and depth checks.

**How to verify.** All three portal tests pass with shared offsets. Removing
the wall-mask write and the wall-depth-step write separately makes the
corresponding assertion fail with `expected -999 to be +0`. Restoring both
writes returns the source to its recorded SHA-256 and passes all three tests.

## [L-builder-shortcuts-preserve-tab] Recognize shortcuts before blocking them

**What happened.** The initial pending/modal guard consumed Tab in Build mode.

**Root cause.** It returned handled for every key before identifying edit keys.

**Prevention.** Recognize the editor's actual shortcuts first. A blocked editor
may consume those shortcuts, but must leave unrelated native navigation alone.

**Verification.** Regression tests distinguish Tab from edit keys while pending
or blocked. In the actual game, Tab reaches Help's close control and Escape
closes Help without also exiting Build.

## [L-browser-probes-read-clock] Inspect method semantics before runtime probes

**What happened.** A local visual-review probe called `tick()` intending to read
time. That method advances the simulation by one tick, even during a shell pause.

**Root cause.** The probe inferred a getter from its name instead of checking
the bridge contract. The correct read-only method is `clockTick()`.

**Prevention.** Read the bridge method before invoking it in a browser probe.
Do not attribute a direct debug step to a broken player pause.

**Verification.** The disposable household was restored through the game's
Load confirmation to tick 2476 with its saved chair and bike directions. No
public save was touched; later clock observations use `clockTick()`.

## [L-asset-checkpoints-need-current-status] Keep rejected art history distinct

**What happened.** Feature and architecture notes still described the old
mirrored bike's failed non-SE contacts after its four-direction replacement
and eight-phase cycling animation had integrated on main.

**Root cause.** An earlier checkpoint's limitation remained phrased as current
status outside the replacement asset's own release notes.

**Prevention.** When replacing an asset, search feature, architecture and source
README files for the old limitation. Preserve dated rejection evidence while
linking to the replacement's actual acceptance record. Keep available art,
runtime integration, player controls and public deployment as distinct claims.

**Verification.** Compare these summaries with the furniture authoring README,
`docs/assets/review-evidence/furniture/README.md` and the current manifests.
The builder's player-rotation controls still require their own played check.

## [L-serialized-golden-field-order] Map fields before updating byte fixtures

**What happened.** Integrating saved boundary walls with furniture facing left
the content serialization golden test failing. Its expected empty `wall_edges`
vector byte had been inserted near the placement coordinates rather than after
`CompiledLot.front_door`.

**Root cause.** The literal was edited by visual proximity instead of tracing
the serialized struct's field order. Production serialization was correct.

**Prevention.** Map each added field to its position in the serialized record
before changing a golden vector. Keep the exact byte assertion; do not change
the production wire format merely to match a mistaken fixture.

**Verification.** After correcting only the literal position,
`cargo test -p terri-data -j 1 --quiet` passed 225 unit tests and one integration
test. Historical save fixtures remain separate compatibility checks.

## [L-runtime-direction-needs-an-authored-base] Existing art facings can already own rotated geometry

**What happened.** Applying a quarter-turn directly to every directional
placement would rotate the current SW bathtub twice and turn the desk's
existing 2x1 footprint into the chair at (6,7).

**Root cause.** Earlier placement directions changed only art; object
definitions and later art replacements already carried their reviewed
collision shapes. Direction codes alone did not identify the geometry's base.

**Prevention rule.** Author the base direction and transform by the relative
turn. Include that base in save compatibility, preserve historical source
geometry independently, and compare all authored render rows with the prior
release before claiming defaults survived.

**How to verify.** Run the relative-base geometry tests, the 34-object prior
release render comparison, and real pre-builder and pre-bathtub byte fixtures.
Change one base direction and require old digest bridges to close.

## [L-migration-pins-both-endpoints] Reconstructing a known source does not approve the destination

**What happened.** Final front-door review found that the old bathtub migration
removed destination portals to reconstruct its historical source digest. That
could pass the source check after a later portal landing or identity changed,
outside the intended exact destination bridge. The current reviewed household
was unaffected; this was a future migration-contract gap.

**Root cause.** Normalizing newly introduced structural fields erased the
evidence needed to distinguish reviewed and unreviewed destinations. A later
grid rejection was not a replacement for the content-compatibility decision.

**Prevention rule.** Pin both ends of a structural migration before rebuilding
the source shape. New reviewed destination digests must be added deliberately;
presentation-only changes should remain accepted without new exceptions.

**How to verify.** The A-to-B and A-to-D controls load, including presentation
changes that retain D. Changed portal identity, added portals and moved landings
must fail with `IncompatibleContent` before final grid validation. The original
test failed with `InvalidGrid` instead; it passes with the exact B/D gate.

## [L-atlas-palette-test-granularity] Verify independent palettes independently

**What happened.** The combined blue/red palette check exceeded its unchanged
five-second limit at 5.358 seconds, while 779 other browser tests passed.

**Root cause.** One test bundled two independent 148-frame manifests, including
296 small PNG reads and 961 assertions. This identified an over-broad test
unit, not a production rendering regression or a proven Windows I/O defect.

**Prevention rule.** Give each independently authored palette a named test.
Retain every file hash, registration and interaction-anchor assertion; retain
the global registry and atlas bounds in their own small case. Do not suppress
checks or widen the global timeout to get a green result.

**How to verify.** The full one-worker suite passes 782 tests with the original
five-second budget. If an individual palette times out, investigate the source
of that delay rather than repeatedly subdividing or increasing the allowance.

## [L-door-landing-edge-validation] A clear tile can still be across a wall

**What happened.** Integrating boundary walls with animated doors exposed a
compiler gap: the landing tile could be empty but separated from the doorway
by a solid edge. The regression accepted both a derived horizontal landing
and an explicit vertical landing that should have been refused.

**Root cause.** The door compiler checked occupied cells, while main's new
architecture also represents barriers between cells.

**Prevention rule.** Validate the doorway-to-landing step with the same grid
edge rules used by movement. Carry presentation activation through every save
restore path, including the new architecture envelope. Validate future career
returns against the final restored grid even when the worker is currently at
home: a save without a current path can still encode a blocked future landing.

**How to verify.** `portal_landings_cannot_cross_solid_wall_edges` must reject
both solid-edge cases and accept their doorway-edge counterparts. Load an
actual pre-door V2 browser save and confirm its saved architecture is retained;
reloading an active doorway must preserve its drawing state. Solid saved edges
and blocked V1 landing cells must fail transactionally for career households;
their open controls must still load and return normally.

## [L-door-arrival-needs-independent-axis-tests] A working route can hide an untested coordinate

**What happened.** The front-door release passed ordinary tests and its played
departure/return check, but CI found eight surviving mutations in the career
arrival predicate. The shipped return changes only the Y coordinate.

**Root cause.** A single route did not independently constrain both sides of
the X-or-Y distance check, and no test pinned its inclusive arrival tolerance.

**Prevention rule.** Exercise an X-only return, a Y-only return, an exact
nonzero doorway position, and each tolerance boundary separately. Assert the
resulting career state and settled position, not only the rendered door state.

**How to verify.** The two career arrival regressions must pass; the targeted
mutation run must catch all eight changed comparisons and coordinate
subtractions. The 2026-09-20 correction caught 8/8 without a baseline exception.

## [L-wall-plane-depth-closeups] Review wall contact at object scale

**What happened.** The shipped boundary-wall layout passed a whole-room
visual review, but walls visibly cut off the laundry stack, toilet tank and
desk chair. The user caught the missing silhouettes in close-ups.

**Root cause.** A wall panel and an adjacent object could share the same
anchor depth. Walls drew first and won the equal-depth test. A constant depth
for an entire panel also cannot describe both sides of its physical plane.
Moving every wall backward would expose objects on the wrong side.

**Prevention rule.** Give edge-wall fragments depth from their authored plane,
including exposed far arms at junctions. Review close-ups as well as the room.
Do not reposition furniture or alter artwork to hide a depth-buffer defect.

**How to verify.** Run `web/proofs/wall-occlusion.js` through the real browser
renderer. Check foreground and background objects on both axes, three zooms,
all nine joins, and Sims crossing both door orientations. Disable the wall
depth calculation and require the same pixel checks to fail; restore and
compare source hashes. Retain close-up screenshots and an independent review.

## [L-layout-schema-exporter-impact] Include offline asset tools in schema impact scans

**What happened.** Main CI stopped publication because the exercise-bike
clearance test still indexed the removed `lot['wall']` field. The corresponding
offline preview exporter had the same stale assumption. Local Rust, web and
sprite suites passed but did not include this separate model-test suite.

**Root cause.** The impact scan covered runtime content consumers but missed
offline art tooling. Running only the atlas generator tests was not equivalent
to the CI step, which runs seven Python suites.

**Prevention rule.** Search all content readers, including model exporters,
when changing authored schemas. Run the complete asset-test command list from
CI on a staged-only export before claiming reproduction acceptance.

**How to verify.** Check current wall geometry independently, retain the old
clearance regression as historical proof, and run sprite, Sim, furniture,
kitchen, bathroom, bedroom and office suites. Do not delete a stale test just
to make CI green; update the production consumer it exposed.

## [L-edge-contact-legacy-and-bounds] Keep strict new geometry separate from legacy contact

**What happened.** Final review found two contact-validation defects: finite
extreme target coordinates could overflow rectangle arithmetic, and rejecting
off-lot contact changed behavior in custom legacy worlds that allow such objects.

**Root cause.** A valid float is not necessarily a valid grid coordinate. The
new boundary rule also tightened a historical API outside its intended scope.

**Prevention rule.** Check edge-world target bounds before integer rectangle
arithmetic. Retain the old contact rule when no solid barriers exist; do not
silently apply new placement constraints to legacy saves.

**How to verify.** Test positive and negative finite extremes for walking and
active contact. Test path and distance-field contact on all four outside edges,
then add a solid barrier and require rejection. Remove each compatibility
fallback separately and require its regression to fail.

## [L-edge-wall-save-contract] Save architecture before reclaiming wall tiles

**What happened.** Moving interior walls to cell boundaries required freeing
28 cells. The old save format held one combined collision bitmap, so changing
authored content alone could not distinguish wall occupancy from custom data.

**Root cause.** The structural content fingerprint describes referenced
definitions, not ownership of a saved collision cell. Inferring wall ownership
from a partial pattern could silently alter a customized household.

**Prevention rule.** Persist explicit architecture in a new schema and retain
the old decoder. Upgrade only a frozen, complete source-layout match. Preserve
custom layouts without reinterpreting them. Back up original wire bytes before
the first overwrite, and pause saving after failed loads.

**How to verify.** Compare complete snapshots across the upgrade, test custom
collision/placement differences, reload the new format without remigration,
and load bytes produced by a previous browser build. A filesystem mock proves
write ordering, not real-browser recovery. Test the retained backup through
the actual loader as well. Origin-wide locks serialize cooperating workers;
they do not prevent stale progress from a second game tab.

## [L-wall-edge-arrival-and-fractional-turns] Validate contact where movement ends

**What happened.** Cardinal pathfinding could still begin with a diagonal
segment when a Sim changed direction between tile centers. Review also found
that a saved path could end across a wall and start an object interaction.

**Root cause.** Cell-to-cell path validity does not prove the actual first
movement segment or the final interaction contact. A person being approached
can also move after the route was calculated.

**Prevention rule.** Anchor new fractional routes at the rounded source
center before turning. Validate remaining saved segments and static-object
endpoints. Recheck moving social partners at arrival rather than rejecting
legitimate saves containing stale social approaches. Public spawn operations
must not create geometry their own save loader rejects.

**How to verify.** Test both wall axes, reversed segments and endpoint contact.
Remove the anchor and boundary checks separately and require failures. Test
empty/exhausted object paths, redirected conversation partners, unchanged RNG
on rejected arrivals, and accepted spawn/save/load round trips. Retain the
whole played-stretch save test to catch over-strict validation.

## [L-half-wall-raster-identity] Derive wall halves from the full raster

**What happened.** Independently rasterized wall halves did not reproduce
the existing full wall exactly along diagonal edges.

**Root cause.** Polygon endpoint rounding differed between the full panel and
its separately drawn halves.

**Prevention rule.** Render the existing full wall, then clear the unwanted
half. Keep shared pixels consistent and give each geometric half one owner.

**How to verify.** Opposite halves must reconstruct the full panel pixel for
pixel. Check every previous decoded sprite remains unchanged after packing,
then inspect joins and doorway apertures in the actual GPU view.

## [L-browser-artifact-paths] Use explicit temporary paths for review screenshots

**What happened.** A browser screenshot write to the task worktree was denied.
A later relative filename resolved into the canonical checkout instead.
Only that newly created screenshot was removed after an identical copy was
retained in the permitted temporary directory and task evidence folder.

**Root cause.** The browser tool's output root differs from the shell worktree.
A relative artifact filename does not reliably identify either location.

**Prevention rule.** Use an absolute path under the browser tool's permitted
temporary output directory. Copy the returned artifact to the task worktree
using its full path. The owner explicitly authorized this workflow; routine
artifact copies do not require another approval. Do not modify unrelated files.

**How to verify.** Check the returned file path, compare source/destination
hashes, and confirm no screenshot was left in a different checkout.

## [L-visible-border-is-not-placeable-floor] Trace wall gaps to the grid before moving furniture

**What happened.** Kitchen furniture looked one tile away from the exterior
wall, and moving the run toward it was proposed before checking placement.
The kitchen was already on row zero. The apparent extra room was an
unplayable decorative floor border with the wall at Y=-1.5.

**Root cause.** Visual floor coverage was mistaken for valid placement space.
Moving saved furniture also has a separate hazard: Save V1 stores positions
and collision state, and reattaches authored facing by exact id and position.

**Prevention rule.** Compare floor rendering, wall coordinates and legal grid
bounds before choosing a placement fix. With owner approval, move the floor
edge and exterior walls together. Do not move sprites into blocked space or
change rectangular footprints without an explicit save-migration design.

**How to verify.** Floor count equals width times height; wall ends meet the
slab at four zoom levels; camera framing and pan bounds use that same extent.
Inspect kitchen contact, divider joins and lighting in the played build.
Existing save positions, grid dimensions and interaction footprints stay
unchanged for this renderer correction.

## [L-retired-asset-review-command] Retire review tools with their rendering contract

**What happened.** The bunk stopped using a separate foreground sprite, but
the Sim evidence README still instructed readers to run a generator requiring
that removed field and the old procedural sprite name.

**Root cause.** Runtime references were updated without checking documentary
scripts that also consumed the object definition.

**Prevention rule.** Search review scripts and documentation when replacing
asset contracts. Remove obsolete generators and label their retained images
historical; point to the current supported workflow rather than inventing a
compatibility layer that combines incompatible furniture.

**How to verify.** Search for the retired command and check every remaining
reference. The current bedroom workflow must validate the reviewed composite,
without requiring `bedBunkForeground` or overwriting historical evidence.

## [L-bed-body-envelope] Distinguish furniture proportions from sleeping fit

**What happened.** A replacement double bed passed isolated source review but
looked too short and square beside the approved Sim. Room review rejected it.

**Root cause.** Width and footprint checks did not compare mattress length
with the actual body. The idle Sim measures 2.07411 from soles to hair, longer
than the fixed two-tile bed envelope allows for a fully extended sleeper.

**Prevention rule.** Measure the immutable character before settling furniture
proportions. Do not shrink the body, extend into unreserved walking tiles or
claim a plausible folded pose is already proven. Static artwork and occupied
animation require separate acceptance evidence.

**How to verify.** Keep the height probe and source hash. Reject the first
1.60x1.76 mattress with length/aspect guards and compare its 1.50x1.86 successor
in the actual room. Before adding sleep, evaluate all visible body parts over
all samples and slots for support, lane clearance, frame collisions and body
intersections, then inspect their GPU composites.

The 2026-10-01 relaxed-leg diagnostic confirmed the consequence: a more natural
2.03865-long pose exceeds the unchanged 1.86 mattress by 0.17865. Arm clearance
had distracted both visual reviewers from an excessively folded whole-body
pose; their earlier visual pass was withdrawn. Review the entire silhouette
before certifying individual contacts. Bed length and reserved floor space
need an owner decision rather than further tightening the pose. Evidence:
`assets/review-evidence/bed-assignment/visual-contract.md`.

## [L-storage-attachment-gaps] Check contact before and after beveling

**What happened.** The first nightstand render had tiny gaps behind its drawer
fronts and between the book spine and pages. The attachment test rejected it
before integration.

**Root cause.** Independently chosen panel thicknesses and offsets did not
overlap their supporting solids. At game size the missing contact was subtle.

**Prevention rule.** Test part contact before exporting. Then test the evaluated
saved meshes because a bevel can remove a contact that raw boxes appear to have.
Keep rejected originals and source snapshots instead of overwriting evidence.

**How to verify.** Bedroom layout tests reject candidate 01's detached fronts.
The saved-scene checker finds interior contact witnesses and rejects displaced
drawer, handle and foot parts, then reloads the unchanged passing model.

## [L-multitile-model-origin] Match the render row, not the placement tile

**What happened.** The first replacement bathtub passed isolated source and
GPU checks, but its played-room view extended past the exterior floor edge.
Independent room review rejected it before publication.

**Root cause.** The model added a half-tile offset to span a 2x1 footprint.
`Sim::sync_render_buffer` already centers each object row on its footprint.
The isolated fixture omitted that runtime centering, so it concealed the
double offset instead of testing the actual placement.

**Prevention rule.** Trace placement coordinates through the render buffer
before choosing the model origin. Center multi-tile models on the emitted
row; do not add the footprint offset again. Camera scale and object location
are separate contracts. Enlarging a source canvas must change neither.

**How to verify.** The tub at (14,9) emits a row at (14.5,9). After SE rotation,
its centered 1.84x0.82 shell stays inside the occupied world bounds
X=[13.5,15.5], Y=[8.5,9.5]. Use that row in the GPU fixture, retain a played
room image, and require independent review against the visible floor edge.
The geometry test must reject candidate 01's extra half-tile offset.

## [L-camera-visible-headroom] Do not frame transparent sprite padding

**What happened.** A 160x176 source canvas made the whole-lot camera test fail
even though the new object was a low bathtub.

**Root cause.** Camera setup used rectangle height, ignoring registration
and transparent padding. It treated the tub's empty source margin as tall art.

**Prevention rule.** Compute camera headroom from the registered vertical
anchor minus the visible content top. Preserve legacy rectangle behavior
only for sprites without content bounds or a content-top record.

**How to verify.** `spriteFramingHeight` returns equal headroom for equivalent
art with different padding and pixel densities. The real-atlas camera test
must keep the whole lot in the default 1280x720 viewport. Inspect that view
after changes, as well as zoomed object views.

## [L-signed-render-checkout-bytes] Verify signed artifacts after Git checkout

**What happened.** The bunk built locally but a staged-only checkout rejected
its reviewed manifest hash. Git's text normalization converted its CRLF bytes
to LF, breaking the manifest, journal and comparison-report acceptance chain.

**Root cause.** The review binds exact file bytes, while the repository applies
LF conversion by default. A working-tree check alone cannot exercise that boundary.
Architecture generation exposed a second path: an unconditional Windows text
write changed an unchanged historical manifest from LF to CRLF. Git's normalized
diff did not show the byte change.

**Prevention rule.** Mark byte-signed manifests and journals as `-text` before
staging. Preserve the signed originals rather than rewriting their evidence or
weakening hash validation. Finish staging before exporting the index for review.
If those files were already staged under text conversion, explicitly re-stage
them with `git add --renormalize` after changing attributes; ordinary `git add`
may retain the cached normalized blob when the working file has not changed.
Generators must preserve an existing text file when its generated content is
unchanged. Pin the encoding and newline convention when a write is necessary.

**How to verify.** Export the completed index to a new isolated directory and
run the atlas freshness check there. Confirm it reports the new sprite count,
not the previous index's count. Missing raw render intermediates must not prevent
accepted-export import, but must still fail full generation verification.
For byte-preserved historical files, compare raw hashes before and after a normal
generation run as well as a check-only run. Do not use a clean Git diff as the
only evidence of byte identity.

## [L-room-relative-asset-review] Review the room, not only isolated facings

**What happened.** Primary and adversarial review accepted a refrigerator that
faced the adjacent counter and looked too small beside the kitchen run. The
owner caught both in the played game.

**Root cause.** Review verified four internally consistent views and a working
interaction, then treated those as sufficient room-fit evidence. The lot's
default SE refrigerator facing was retained even though every other station
faces SW into the room. Shared camera settings also did not guarantee a
consistent physical scale: the fridge was only 0.76 counter widths.

**Prevention rule.** Compare every replacement with its actual room, neighbors
and a standing Sim. Trace the usable face toward accessible room space. Check
relative widths, heights, ground contact and hardware overhang. A functional
interaction and an isolated four-facing board cannot substitute for that check.

**How to verify.** The shipped kitchen fridge must compile to its SW sprite.
The saved replacement must measure about 0.912 wide and 1.944 tall against the
1.0-wide, 0.86-high counter. Retain a whole-room screenshot and a close view
showing aligned fronts, side clearance and a nearby Sim; obtain independent
review of those images. The old model must fail the new size check.

Gotchas and hard-won context. Read this before starting work; it is cheaper
than rediscovering any of it.

Entries are append-only. **Do not renumber, and do not add a numbered one.**

## How to id a new entry

A new lesson's id is a short kebab-case SLUG of what it is about, not a
number:

```
## [L-save-target-union] A validator that models one case of a union ...
```

Pick the slug from the lesson's own subject. Two words is usually
enough. It never needs to be looked up, reserved, or agreed with anyone,
which is the entire point.

**Why the numbers stopped.** `[L1]`-`[L74]` were allocated by taking the
next free integer, so every branch working in parallel read the same
"next" number and wrote there. It collided on 2026-07-29 (two different
`[L41]`s, main's renumbered to `[L49]`), and the workaround recorded
here at the time - claim the number in a tiny commit first - did not
hold: on **2026-08-01 it collided three more times in one afternoon**,
as PRs #26, #28 and #27 each appended what they believed was the next
number. Each collision cost a renumber, a sweep of the cross-references,
and a fresh ~35-minute CI cycle. A counter cannot be shared by branches
that cannot see each other. A slug needs no allocator, so there is
nothing to race for.

**The numeric series is CLOSED at `[L74]`** - no dash, which is how all
74 of them are written here. `docs/alpha-feel-notes.md` writes its
sessions the other way, `[A-24]`, in all 24 of them. Neither is being
changed: each file is internally consistent, ~60 files cite these
exactly as written, and `check-doc-ids.py` normalises the dash away when
it compares two ids so a cross-format duplicate is still caught.

**Every existing id keeps its number for ever** - 60 files across
`crates/`, `web/src/` and `docs/` cite them, and a citation that rots is
worse than an ugly id.
`check-doc-ids.py` fails the build if a number past the close appears, or
if any id is used twice.

**Ids are also nicer this way**, which is a bonus rather than the
reason: `[L-preview-serves-original-root]` says what it is at the
citation site, and `[L67]` says nothing until you go and look. That is
`docs/glossary.md`'s naming rule - a label names the thing - applied to
the labels the docs use on themselves.

Appends to this file are merged with git's `union` strategy (see
`.gitattributes`), so two branches each adding an entry at the end merge
without a conflict at all. The one thing that costs: if two branches
edit the SAME existing lines, union keeps both versions rather than
raising a conflict. This file is append-only precisely so that stays
rare.

---

## [L1] Bare `cargo` does not link on this machine - RESOLVED 2026-07-27

**Status: fixed.** Adding the "Desktop development with C++" workload to VS
Community 2026 installed the desktop x64 CRT across all three toolsets
(14.44.35207, 14.51.36231, 14.52.36520). `cargo test --workspace` now passes
unwrapped. **The vcvars workaround below is no longer needed**; it is retained
because the diagnosis is what matters if this recurs.

**Watch item:** toolset 14.52.36520 appears to be the Preview build tools, and
`rustc` selects the newest toolset, so that is the one now in use. It is
complete today. Preview toolsets ship incomplete more often than releases, so
if this breaks again after a VS update, check this first.

**What happened:** Every cargo command failed at link time with `LNK1104: cannot
open file 'msvcrt.lib'`. It was rediscovered independently twice, costing
time both times.

**Root cause:** `rustc` auto-selects the **newest** Visual Studio install it
finds, with no check that the toolset is complete. Visual Studio Community 2026
(18.8) at `C:\Program Files\Microsoft Visual Studio\18\Community` shipped
toolset 14.51.36231 with only `lib\onecore`, no `lib\x64`, so the desktop x64
CRT is absent. A complete VS 2022 BuildTools install exists but is older, so
rustc ignores it.

**Workaround** (until [T21] in TIM-TODO.md is done): run cargo through the VS
2022 build environment. From PowerShell:

```
cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && cargo test --workspace'
```

The Bash tool mangles that quoted path; from Bash, write a small batch wrapper
in the scratchpad and invoke it via PowerShell instead. `vcvars64.bat` also
prints `'vswhere.exe' is not recognized` on this machine. Linking still
succeeds, but any tool that resolves components through vswhere will fail here
first.

**Permanent fix:** Visual Studio Installer, Modify on VS Community 2026,
Workloads tab, tick "Desktop development with C++". Note there is no "MSVC
v145" - VS 2026 renamed it to **"MSVC Build Tools for x64/x86 (Latest)"**, and
`v143`/`v142`/`v141` are legacy toolsets. Also **untick "MSVC Build Tools for
x64/x86 (Preview)"**, because a preview toolset alongside the release one
recreates exactly the "newest but incomplete" condition that caused this.

**How to verify:** in a new terminal,
`Get-ChildItem "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\*\lib\x64\msvcrt.lib"`
should print a path, and `cargo test -p terri-core` should pass unwrapped.

**Prevention rule:** CI runs on Linux and will never catch this class of
problem. Local toolchain breakage must be recorded here, not in a subagent's
transcript where the next agent cannot see it.

---

## [L2] A test file Rust never compiles is a false green, not a red

**What happened:** The M0 plan's Task 2 created `clock.rs` containing a test
module in one step, then added `pub mod clock;` to `lib.rs` in a later step.
The intervening "run the test and verify it fails" checkpoint would have
reported success with `0 filtered out`, because **Rust does not compile a `.rs`
file that no `mod` declaration references.** The checkpoint would have looked
red-then-green while never having compiled the test at all.

**Root cause:** TDD plans written top-down naturally introduce the file before
wiring it into the module tree, but Rust's module system makes wiring a
precondition for the file existing at all.

**Prevention rule:** in Rust, **declare `pub mod foo;` in the same step that
creates `foo.rs`**, never later. When verifying a red checkpoint, read the test
*count*, not just the exit status: `0 passed; 0 failed` is not a red, it is a
test that never ran.

**How to verify:** a genuine red for a missing symbol reports a compile error
such as `E0433: failed to resolve: use of undeclared type`. If you instead see
`0 filtered out` with no compile error, the test is not wired in.

---

## [L3] `bevy_ecs::World::try_query` returns `None` on unregistered components

**What happened:** Found during Task 1 API verification, before it could cause
damage. The M0 determinism test hashes world state and compares two runs. Had
it used `try_query` without eagerly registering components, a world that never
spawned a `Hunger` would have produced **zero rows**, and the test would have
passed by comparing two identical empty hashes - permanently green while
testing nothing.

**Root cause:** `try_query` returns `None` if **any** component in the query is
unregistered, including one behind `Option<&T>`. Registration normally happens
lazily on first spawn, so the failure only appears in worlds that never spawned
that component - exactly the edge cases a determinism test should cover.

**Prevention rule:** call `world.register_component::<T>()` in `Sim::new()` for
every component any query touches. `World::query` (requiring `&mut World`)
self-registers and does not have this problem; only `try_query` (taking
`&World`) does. **Any test that can pass on empty input needs an assertion that
the input was not empty.**

**How to verify:** spawn nothing, run the determinism test, and confirm it
still exercises rows rather than trivially comparing two empty hashes.

---

## [L5] A determinism test that runs twice in one process tests nothing

**What happened:** Three separate times, a test named for determinism could not
observe the mechanism it existed to protect. Each was caught in review, not by
running the suite, because each was permanently green.

1. `pathfinding_is_deterministic` compared two `find_path` calls. `find_path` is
   pure and takes `&self`, so the two **cannot** disagree by construction.
   Deleting the A* f-score tie-break left every test passing.
2. The world-hash determinism test compared two runs' hashes. Two empty hashes
   compare equal, so it would have passed if the hash saw zero rows.
3. `select_action`'s agent sort, score tie-break, and in-tick double-claim guard
   all had zero coverage. Deleting any of the three left all 27 tests green.

**Root cause:** within one process, iteration order is deterministic for a fixed
archetype and spawn order. So a two-run comparison compares **two identical
wrong answers**. The failure modes these tests target are cross-*version*,
cross-*target*, and cross-*history*, none of which a same-process A/B can see.

**Prevention rule: pin determinism with a golden assertion, never with a
self-comparison.** Assert the one specific output - the exact path, the exact
winning entity - for an input where the mechanism actually fires. That is
stable only if the mechanism exists, so deleting it fails the test.

**The ECS-specific trap, which is subtle:** a test that spawns N entities
sequentially puts them all in one archetype, where table order already equals
index order. Such a test passes with the sort deleted. **You must induce
archetype churn to make the two orders differ** - insert then remove a component
on one entity, which swap-removes it from its table and re-appends it at the
back. Two lines reproduce what a few minutes of gameplay does naturally, since
agents change archetype every time `Target`, `Path`, or `Eating` is added or
removed. Without the sort, who wins a contended object becomes a function of
interaction history.

**How to verify: mutation-test it.** Delete the mechanism, confirm the test
fails, restore, confirm the tree is byte-identical. **A test claiming to pin a
mechanism it cannot detect is worse than no test**, because it also removes the
suspicion that would otherwise prompt someone to check.

---

## [L4] `cargo tree` reports an inert web dependency path for `terri-core`

**What happened:** The project's load-bearing rule is that `terri-core` and
`terri-sim` never depend on `wasm-bindgen` or `web-sys`. A naive
`cargo tree | grep` check appears to violate it:

```
terri-core -> bevy_ecs -> bevy_reflect -> bevy_reflect_derive -> uuid -> js-sys -> wasm-bindgen
```

**Root cause:** the path is real in the dependency graph but inert in every
build. `bevy_reflect_derive` is a proc-macro, so it always builds for the
**host**, where `uuid`'s `cfg(all(target_arch = "wasm32", target_os =
"unknown"))` block is inactive. `Cargo.lock` also records unactivated optional
dependencies regardless of feature resolution, so the lockfile names web crates
that never link.

**Prevention rule:** the CI purity check must name **explicit targets**
(`x86_64-unknown-linux-gnu` and `wasm32-unknown-unknown`), never bare
`cargo tree` and never `--target all`. A check that fails spuriously trains
everyone to ignore it, which is worse than no check.

**How to verify:** `cargo tree -p terri-core --target wasm32-unknown-unknown`
and the same for the host target should both be clean of `wasm-bindgen`,
`web-sys`, and `js-sys`.

**Precision correction, measured during Task 7 on cargo 1.94.1:** a *bare*
`cargo tree` is clean. `--target` defaults to the **host** platform, so on both
this Windows box and CI's Linux runner the inert path is already filtered out.
The path only appears under `--target all`. [L4]'s prevention rule is unchanged
and still right - naming explicit targets is what makes the check mean something
rather than accidentally depending on whatever host it runs on - but do not
expect a bare `cargo tree | grep` to be the thing that fails.

---

## [L6] The world-hash sort is pinned by a cross-history test, not by the A/B

**What happened:** Task 7 added `Sim::world_hash` and the determinism test
[D12] calls the highest-value test in the project. Mutation-testing it confirmed
[L5] exactly: **deleting `rows.sort_by_key` in `world_hash` left
`identical_scenarios_produce_identical_world_hashes` green.** Two scenarios
built identically in one process share an archetype layout, so both hash their
rows in the same wrong order and agree. The brief's empty-world guard does not
help here either - the rows are present, just misordered.

**What does catch it:** `hash_ignores_archetype_layout_and_entity_history`.
Two runs reach the same tick count by different histories - run B additionally
spawns a bystander entity, ticks, despawns it, and insert/removes `Eating` on
its lowest-index agent to swap-remove that agent to the back of its table.
Neither touches what the simulation computes (the bystander matches no system's
query, and the insert/remove pair happens between ticks), but both change ECS
iteration order. With the sort deleted, this test fails; with it present, it
passes.

**The part that keeps it honest:** the test asserts its own precondition. Before
comparing hashes it asserts the two worlds' **raw, unsorted iteration orders
still differ** at that moment, and that they hold the same entity set. Without
that assertion the test would silently decay into a second copy of the A/B if
the two layouts ever reconverged over 500 ticks. Measured: they do not
reconverge at 500 ticks, but that is an observation, not a guarantee, which is
why the assertion is there rather than a comment.

**Prevention rule:** for any state-digest function, the test that pins the
canonical ordering must compare **two worlds with different histories**, and
must assert that their underlying iteration orders actually differ. A
same-process A/B pins reproducibility only. Reproducibility is not the property
Layer 2 needs; layout-insensitivity is.

**How to verify:** delete `rows.sort_by_key` in `Sim::world_hash` and run
`cargo test -p terri-sim`. Exactly
`determinism_tests::hash_ignores_archetype_layout_and_entity_history` must fail.
If instead everything is green, the sort is unprotected again. Note this pins
one mechanism out of four; see [L7] for the other three.

**Scope correction, Task 7 review:** the wording above and the test's own
comment both overclaimed. "Two worlds holding the same logical state hash the
same even when they reached it by different histories" is only true when
**entity index allocation also coincides**. `world_hash` keys its rows on
`Entity::index_u32()`, and that index *is* allocation history, so the
motivating scenario named in the comment - a peer that joined late - would
allocate different indices for the same logical entities and hash differently.
Entity generation is unhashed as well, so a despawn/respawn that reuses an
index aliases with the original. What the test actually pins is narrower and
still worth having: **insensitivity to archetype/table layout, given the same
set of entity indices.** Layer 2 will need a stable network id in place of the
raw index before the broader claim becomes true. Both files now say so; do not
let the broad phrasing creep back.

---

## [L7] An untested guard is indistinguishable from no guard

**What happened:** this is the **fifth** recorded instance of the same trap
([L2], [L3], [L5], [L6]), and the new part is where it hid. [L3] said "any test
that can pass on empty input needs an assertion that the input was not empty",
so Task 7 dutifully added one to both hash determinism tests:

```rust
let empty = Sim::new_with_lot(24, 24);
assert_ne!(a.world_hash(), empty.world_hash(), "the hash is seeing no entities");
```

That guard was inert. `world_hash` writes the clock tick **before** the entity
rows, and `empty` was **never ticked**, so it sat at tick 0 while `a` was at
tick 500. The clock term alone made the two digests differ. The guard passed
unconditionally, for a reason that had nothing to do with entities.

Measured consequence, before the fix: **deleting the entire row-collection
block and the emit loop from `world_hash` left all three determinism tests
green.** So did deleting only `write_f32(x)`/`write_f32(y)`, and so did
deleting only `write_f32(hunger)`. Of the four mechanisms in `world_hash` - row
collection, position writes, hunger write, `sort_by_key` - exactly one, the
sort, was actually pinned, and by [L6]'s cross-history test rather than by the
guard. The guard written specifically to catch the other kind of failure caught
nothing.

**Root cause, and this is the generalisable part: a guard is a mechanism like
any other, so an unverified guard carries exactly as much weight as an
unverified test - none.** [L5] already said to mutation-test the *mechanism*.
Nobody mutation-tested the *guard*, because a guard reads like scaffolding
rather than like a claim. It is a claim.

The specific shape of the failure: the guard compared two digests that differed
in **an unrelated term** (the clock). A differential guard is evidence about
the term it names only if **every other term is held constant**. Otherwise it
passes for the wrong reason, and passing for the wrong reason is silent.

**Prevention rule:**

1. **Mutation-test the guard, not just the mechanism.** Delete the thing the
   guard claims to protect and confirm the guard is what fails. If some other
   test fails first, the guard itself still has no evidence behind it.
2. **A differential guard must hold every other input constant.** If the digest
   covers a clock and some rows, either advance the control world to the same
   tick or freeze the clock, and assert that equality as a precondition. Better
   still, write a test that can only move for one reason:
   `hash_observes_entity_state_not_only_the_clock` never ticks at all, mutates
   one field on one entity and restores it, so the row block is the only thing
   that can move the digest.
3. **Count the mechanisms and check them off individually.** "The suite is
   green" says nothing about coverage. `world_hash` has four; write the list
   down and mutate each one separately.

**How to verify:** apply each of these four mutations to `Sim::world_hash`
independently, run `cargo test -p terri-sim`, restore, and confirm the file is
byte-identical (`git hash-object`) before the next one.

| mutation | must fail |
| --- | --- |
| delete the `if let Some(...)` row collection and the emit loop | `identical_scenarios...`, `hash_ignores_archetype_layout...`, `hash_observes_entity_state...` |
| delete `write_f32(x)` and `write_f32(y)` | `hash_observes_entity_state...` |
| delete `write_f32(hunger)` | `hash_observes_entity_state...` |
| delete `rows.sort_by_key` | `hash_ignores_archetype_layout...` |

If a mutation leaves the suite green, say so plainly rather than adjusting the
test until it looks right. A test tuned until it passes is how this entry came
to be written.

**The same failure shape in CI, found in the same review.** The [D1] web-purity
check was written as `if cargo tree ... | grep -E ...`. A pipeline used directly
as an `if` condition is **exempt from `errexit`**, and `pipefail` does not help
because grep's no-match exit 1 is the rightmost status anyway. Reproduced with a
stub `cargo` exiting 101: the old form ran all four iterations and exited **0**,
so a renamed crate, a crate moved out of the workspace, a bad target triple, or
a registry hiccup would have made the check vacuously green - the identical
"passes for the wrong reason" pattern, in YAML instead of Rust. The fix is to
capture first, `tree=$(cargo tree ...)`, which puts the failure back under
`errexit`; the same stub then yields exit 101. **Prevention rule: never put a
command whose failure matters inside an `if` condition or the left side of a
pipe.** How to verify: put a stub `cargo` that exits non-zero first on `PATH`
and confirm the step still fails.

---

## [L8] `git hash-object` proves content, not what cargo will run

**What happened:** A mutation-testing harness restored source files with
`shutil.copy2`, which preserves mtime. Cargo's freshness check is mtime-based,
so the restored file looked **older** than the artifact built from the mutant,
and a plain `cargo test --workspace` afterwards silently ran the **mutated
binary** against unmutated source. The tree was provably correct by
`git hash-object` and the tests were red anyway.

**Root cause:** content identity and build identity are different things. Any
verification that ends at "the bytes match" has checked the wrong invariant if
what happens next is a build.

This instance landed red, which is the safe direction and is why it was caught.
**The symmetric case is a false green:** restore a file, get a stale artifact
that still contains the fix, and conclude a mutation was caught when it was not.
That would silently corrupt every row of a mutation-testing table, which is
precisely the evidence this project now relies on.

**Prevention rule:** any harness that edits source in place and relies on cargo
to rebuild must **touch the file after restoring it**, stamping a fresh mtime.
Applying a mutation is safe by accident, because writing the file stamps it; the
restore is the dangerous half. Assert the suite is green after every restore,
not only that the bytes match.

**How to verify:** after restoring, confirm both that `git status` is clean and
that the suite passes. If the bytes are identical but the tests are red, you are
running a stale artifact, not observing a real failure.

---

## [L9] `git checkout <path>` is not a mutation restore; it is a discard

**What happened:** During Task 8's mutation verification, a second mutation was
applied to `crates/terri-sim/src/lib.rs` with a script and then "restored" with
`git checkout crates/terri-sim/src/lib.rs`. That command restores the file from
the **index**, and the index held the *committed* version, so it did not undo
the mutation - it reverted the entire task's uncommitted work in that file:
the `render_buffer` module declaration, the `render` field, `sync_render_buffer`,
`render_buffer()`, and the new golden-vector test. All of it, silently, exit 0.

The loss was caught because `git hash-object` on the restored file printed a
hash that did not match the pre-mutation one. Without that check the next step
would have been a commit of a half-finished task.

**Root cause:** this project's mandated workflow is to mutation-test on an
**uncommitted** tree ([L5] rule 1, run before the task's own commit). Every git
command that "restores a file" restores it to a committed or staged state, which
on an uncommitted tree is the *start of the task*, not the state one line ago.
The mental model "checkout undoes my last edit" is right only when the last edit
is the only uncommitted change to that file - which during a task is exactly the
condition that does not hold.

**Prevention rule:**

1. **Restore a mutation by inverting the exact edit**, never with `git checkout`,
   `git restore`, `git stash`, or `git reset --hard`. If a harness needs a
   restore mechanism, have it snapshot the file's bytes to the scratchpad
   *before* mutating and write those exact bytes back.
2. **Record `git hash-object <file>` before applying any mutation and assert it
   again after restoring.** This is what caught the loss, and it is cheap. [L8]
   already required the byte check for a different reason; it earns its place
   twice.
3. If a mutation is worth running against a large uncommitted change, consider
   committing the task first and mutating on top, so `git checkout` is a correct
   restore rather than a trap. Amending afterwards is cheaper than reconstructing
   lost work.

**How to verify:** apply a mutation, restore it, and confirm `git hash-object`
matches the value recorded before the mutation. If it instead matches
`git hash-object HEAD:<path>`, the restore reverted the whole task.

---

## [L10] `--target web` has no importable `memory`, and three things detach, not one

**What happened:** Task 9's brief specified
`import { memory } from './wasm/terri_wasm_bg.wasm'`. That cannot resolve.
`wasm-pack --target web` emits a `_bg.wasm` whose import section names
`./terri_wasm_bg.js`, a glue module **only produced for `--target bundler`**.
Under Vitest the failure is
`Cannot find module './terri_wasm_bg.js' imported from src/wasm/terri_wasm_bg.wasm`,
and it would fail the same way under a Vite browser build.

**Root cause:** the two wasm-pack targets ship different module topologies.
`--target web` puts the glue in `terri_wasm.js` and expects you to call
`init()`; the `.wasm` is an asset it fetches, not an ES module a bundler links.
`terri_wasm_bg.wasm.d.ts` still declares `export const memory`, so the import
typechecks and only fails at resolve time - the type declaration describes the
bundler layout regardless of which target was built.

**Prevention rule:** get the `WebAssembly.Memory` from what `init()` resolves
to. It resolves to the instance's export object, so `(await init()).memory` is
the real `WebAssembly.Memory`. `SimBridge` takes it as a constructor argument
rather than reading a module-level global, which also makes it injectable in
tests. If the build ever moves to `--target bundler`, the direct import becomes
available and the constructor argument can go; do not assume it works before
checking which target `wasm-pack` was invoked with.

**The second half, which is the more valuable part.** "Do not cache the view"
undersells the problem. **Three** things must be re-read on every access, and
caching any one of them is the same bug:

| cached | what breaks | which assertion catches it |
| --- | --- | --- |
| `memory.buffer` | old `ArrayBuffer` detaches on growth | `TypeError: Cannot perform Construct on a detached ArrayBuffer` |
| the pointer | the `Vec` reallocates on growth and moves | `pos.some((v) => v !== 0)` |
| the length | spawns change the entity count | `pos.length` |

The `WebAssembly.Memory` object itself **is** stable across growth, which is why
it is safe to hold; its `.buffer` is not. Measured on this build: a 64x64 sim
starts at 1179648 bytes and grows at the **256th** spawned agent, reaching
1507328 bytes by 2000.

The pointer row is the one that nearly slipped. With a stale pointer the view
still has the right **length**, so `expect(pos.length).toBe(4000)` passes; it
points at zeroed static memory, so only `expect(pos.some((v) => v !== 0))`
fails. A growth test that checked length alone would have missed one of the
three mechanisms entirely. Count the mechanisms and mutate each separately,
per [L7].

**How to verify:** in `web/src/bridge.ts`, independently (a) cache the three
views in constructor fields, (b) cache `memory.buffer`, (c) cache the pointers,
(d) cache the count. Run `cd web && npm test` after each and restore by writing
back a byte snapshot, never with `git checkout` ([L9]). Expected: (a), (c), (d)
each fail 5 of 6 tests; (b) fails exactly the two growth tests and leaves the
other four green, which is what proves those two are the growth guard rather
than incidentally-passing duplicates of the others.

---

## [L11] Two samples cannot tell "lags by one" from "frozen at the first"

**What happened:** the **sixth** instance of the family ([L2], [L3], [L5], [L6],
[L7]), and the first one where the test's *shape* was right and only its
*length* was wrong. `prev_positions_lag_by_one_sync` synced twice and asserted
`prev == frame 1` while `positions == frame 2`. A reviewer deleted
`std::mem::swap(&mut self.render.prev_positions, &mut self.render.positions)`
from `sync_render_buffer` and **all 31 `terri-sim` tests stayed green**,
including that one.

**Root cause, and it is arithmetic rather than ECS trivia.** Without the swap,
`prev_positions` is written by one branch only: the reseed that fires when the
row count changes. Sync 1 reseeds (0 != 2) and leaves prev holding frame 1.
Sync 2 finds the lengths equal, writes nothing, and prev *still* holds frame 1 -
which is exactly what the test asserted. **Two observations are consistent with
two different hypotheses**, "prev lags by one frame" and "prev is frozen at the
first frame", and they only diverge on the third. A test cannot discriminate
between hypotheses that agree on every sample it takes.

The consequence would have been total and silent. `prev_positions` would freeze
at the last frame where the entity count changed, so Task 12 would tween every
entity from its spawn position towards its current position, every frame,
forever, with the suite green throughout.

**Why the automated backstop did not help, which is the part worth keeping:**
`cargo mutants` does **not** emit statement-deletion mutants. It rewrites
expressions and return values. So its "0 survivors" on this file was
simultaneously true and no evidence at all about a deleted statement. Rule 2 of
`testing-protocol.md` already says the tool is a backstop and not a replacement
for hand mutation; this is the concrete shape of what it cannot see. **Whole
statements whose only effect is on state - `swap`, `clear`, `sort`, `push`,
`insert` - are outside its mutation grammar and must be deleted by hand.**

**Prevention rule: for any invariant of the form "X lags/leads/differs from Y
by exactly N", the test needs at least N + 2 observations.** N + 1 is where the
relation first becomes expressible; N + 2 is the first point where a *frozen*
or *saturated* alternative predicts something different. State the degenerate
alternative out loud - "what else would produce these same numbers?" - and add
samples until it is excluded.

**How to verify:** delete the `std::mem::swap` line from `sync_render_buffer`
and run `cargo test -p terri-sim`. Exactly
`render_buffer::tests::prev_positions_lag_by_one_sync` must fail, with
`left: 0.0, right: 3.0` - 0.0 being the frozen first frame and 3.0 the correct
lagged one. Restore from a scratchpad byte snapshot, never with `git checkout`
([L9]), and touch the file ([L8]).

---

## [L12] `debug_assert!` is not a boundary check, because the shipped build is release

**What happened:** `Sim::world_hash` encodes "this entity has no `Hunger`" as
the **in-band** value `-1.0`, and guards the collision with a `debug_assert!`.
That was sufficient through Task 7, when nothing outside Rust could construct a
`Hunger`. Task 8 exported `SimHandle::spawn_agent(x, y, hunger)` to JavaScript
and made the value caller-supplied, at which point the guard became inert on
the only target that ships: `wasm-pack build` produces a **release** build, and
`debug_assert!` compiles out of it. Measured before the fix, in `--release`:
an agent spawned with `Hunger(-1.0)` and a Hunger-less entity at the same
position both digested to `0xCA2474BB3E44B36C`.

The same export made `f32::NAN` reachable, and NaN does not self-heal.
`f32::clamp` **propagates** NaN rather than replacing it, so a clamp alone is
not a fix; `advertise.rs` documents where it ends up, since NaN loses every
comparison and the agent "would simply never choose to do anything, forever,
with no panic and no log".

**Root cause:** adding an FFI export silently reclassifies every argument from
"internal, therefore trusted" to "external, therefore hostile", but nothing in
the type system or the build marks the reclassification. The old guard was not
weakened by the change; the change moved the guard to the wrong side of the
boundary and to the wrong build profile.

**Prevention rule:**

1. **Validate at the crate where untrusted input enters, which is
   `terri-wasm`.** `terri-core` and `terri-sim` keep the right to assume their
   inputs are valid; that assumption is what makes them testable. Pushing
   validation down into them would spread boundary concerns through the whole
   simulation.
2. **`debug_assert!` documents an invariant; it does not enforce one.** If a
   value can arrive from outside Rust, the check must survive `--release`.
3. **A NaN check is a separate branch from a range clamp.** `x.clamp(lo, hi)`
   returns NaN for NaN input, so "I clamped it" is not "it is in range".
4. Whenever a new argument is added to a `#[wasm_bindgen]` function, ask which
   `debug_assert!`s downstream of it just became unreachable.

**How to verify:** replace `sanitize_hunger` in `crates/terri-wasm/src/lib.rs`
with the identity function and run `cargo test -p terri-wasm --release`. Four
tests must fail, and
`hunger_from_js_cannot_alias_the_world_hash_no_hunger_sentinel` must fail with
`left` and `right` **equal** - that equality is the collision itself. The
`--release` flag is load-bearing: in a debug build `terri-sim`'s
`debug_assert!` panics first, so the test fails for the wrong reason and you
never observe the digest collision the boundary actually has to prevent. Do the
same with `sanitize_coord`; exactly the two coordinate tests must fail.

---

## [L13] The native golden hash vector never crossed the boundary it was written for

**What happened:** `world_hash_matches_its_golden_vector`'s doc claimed it was
"a cross-platform check for free: CI runs on Linux and this machine is
Windows". True, and irrelevant to the risk Task 8 introduced. The platform pair
that now matters is **native versus wasm32**, and that test runs natively on
both sides of its own comparison, so wasm was never in it.

The gap was concrete rather than theoretical. `FnvHasher::write_f32` calls
`f32::round`, which is **round-half-away-from-zero** in Rust and does *not* map
to wasm's `f32.nearest` (**round-half-to-even**), so rustc must emit a
different code path on wasm32. Every position and every hunger level in the
digest passes through that call.

**Measured outcome: they agree.** Rebuilding the identical scenario through the
JavaScript API - `new SimHandle(24, 24)`, `spawn_object(18, 14)`, eight
`spawn_agent(1 + i, 1, 30 + 5 * i)`, 100 `tick()` - yields
`0xEF601D504790_5825`, the same constant the native test asserts. This is a
reassuring result, not a vacuous one: it was verified by mutation, and it means
the quantizer's `round` call is not currently landing on a half-way value where
the two rounding modes differ. It is **not** a proof that they never will. The
quantizer multiplies by 10 000 before rounding, and a coordinate that lands
exactly on `n + 0.5` after that scaling would diverge.

**Prevention rule:** a golden vector pins the boundary it is *evaluated*
across, not the boundary it *mentions*. If two build targets consume the same
constant, assert it from both, and say in each place that the other exists -
otherwise the next person to legitimately move the constant updates one copy
and the pair silently stops being a comparison.

**Numbers in this entry are stale by design; the procedure is not. Noted at
the M1a close-out, 2026-07-28.** `0xEF601D5047905825` was the vector when this
was written and it has legitimately moved twice since: to
`0x6C3757F1848175C1` when `Hunger` became `Needs` (M1a Task 2), and to
`0x2FC669EFA7254F2D` when all seven needs started decaying (M1a Task 7). Both
moves were re-observed on native and on wasm32 separately rather than assumed
equal, which is the practice this entry exists to establish. The
`expected 14804735595947770788n to be 17248818803464230949n` below is likewise
the failure output of that era. **Read every constant here as an example of
the shape, and take the current value from
`crates/terri-sim/src/lib.rs`.** A golden vector that never moves is a golden
vector nobody is exercising.

**How to verify:** the constant now appears twice, in
`crates/terri-sim/src/lib.rs` and `web/tests/bridge.test.ts`, each pointing at
the other. To confirm the web side is real rather than decorative, delete
`hasher.write_f32(y)` from `world_hash`, run
`wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`,
then `cd web && npm test`: exactly the boundary test fails, with
`expected 14804735595947770788n to be 17248818803464230949n`. Restore, rebuild,
re-run. Skipping the rebuild is the [L8] trap wearing a different hat, since
`npm test` reads the previously emitted `.wasm` and has no idea the Rust source
moved.

---

## [L14] "The page loaded with no console errors" is not evidence a renderer ran

**What happened:** Task 10's browser check was specified as "load the page,
confirm no console or WebGPU validation errors". That check passed immediately
and meant nothing. The agent-driven Browser pane runs the tab **hidden**, and a
hidden tab is not composited, so `requestAnimationFrame` **never fires**.
`SpriteRenderer.draw` sits inside the rAF callback, so it had not been called
once. Measured: `document.visibilityState === 'hidden'` and **0 rAF callbacks
per second**. The canvas read back as `0,0,0,0` across all 921 600 pixels.

A green "no errors" here is the project's recurring failure shape ([L5], [L6],
[L7], [L11]) in a new costume: **the check passed because the code under test
never executed.** Nothing about the console output distinguishes "the pipeline
is correct" from "the pipeline never ran".

**Second, self-inflicted half.** The first probe called
`canvas.getContext('2d')` to ask "is this a WebGPU canvas?". `getContext`
**permanently binds a canvas to the first context type requested**, so that
probe would have made every later `getContext('webgpu')` return `null` and
broken `initDevice` for the rest of the page's life. A diagnostic that mutates
the thing it measures is worse than no diagnostic. The non-destructive form is
`canvas.getContext('webgpu')`, which is idempotent and returns the existing
context.

**Prevention rule, for every GPU verification in this project:**

1. **Drive the draw yourself; never rely on rAF in an agent-driven browser.**
   Dynamic-import the real modules from the Vite dev server
   (`await import('/src/render/sprites.ts')`), build a canvas, and call `draw`
   directly. This exercises the shipped code path, not a mock.
2. **Wrap GPU work in explicit error scopes** rather than reading the console.
   `device.pushErrorScope('validation')` / `popErrorScope()` returns the error
   object, so "no validation error" becomes an assertion with a value behind it
   instead of an absence of log lines.
3. **Read pixels back and assert on them.** `ctx2d.drawImage(webgpuCanvas, 0, 0)`
   then `getImageData` works, is non-destructive to the source canvas, and turns
   "it rendered" into arithmetic. Await `queue.onSubmittedWorkDone()` and one
   macrotask first, because a WebGPU canvas presents at the end of the task.
4. **Assert a pixel count, not just a colour.** A 24x24 tile must cover exactly
   576 pixels. That catches a collapsed or degenerate triangle, which a
   "some orange is present" check does not.

**How to verify a depth-buffer claim specifically,** since [D10] rests on it:
draw two overlapping quads, hold **draw order constant**, and swap only their
depth values. The winner must flip. If the winner never changes, painter's order
is deciding and the depth buffer is inert. Measured on this pipeline: agent at
depth 0.1 beats object at 0.9, and object at 0.1 beats agent at 0.9, with the
agent written to instance slot 0 both times.

**Measured facts worth keeping.** The WGSL in `sprites.wgsl` compiles clean on
Chrome/NVIDIA Ada: a module-scope `const CORNERS = array<vec2<f32>, 6>(...)`
indexed by a runtime `@builtin(vertex_index)` is legal, and the trailing `;`
after a `struct` declaration parses. Preferred canvas format here is
`bgra8unorm`. Clear colour `0.09, 0.09, 0.11` reads back as exactly `23, 23, 28`.

---

## [L15] A mutation that loops forever hangs the harness, because Windows kills only the direct child

**What happened:** Task 10's mutation set included removing the `Math.max`
floor from `growCapacity`, which turns `while (next < needed) next *= 2` into an
infinite loop when capacity is 0. Python's `subprocess.run(timeout=...)` fired,
killed `npm.cmd`, and then **blocked forever** anyway: the `node` grandchild
running vitest survived, held the inherited stdout pipe open, and the reader
threads never saw EOF. The harness had to be killed from outside, leaving the
mutation applied on disk.

Two smaller traps came with it. `subprocess.run(text=True)` decoded vitest's
UTF-8 box-drawing output with the console's **cp1252** codepage and killed both
reader threads with `UnicodeDecodeError`, silently emptying the captured output
so every mutation's evidence was blank. And the machine had ~95 unrelated
`node.exe` processes running, so "kill all node" was never an option.

**Prevention rule for mutation harnesses on this machine:**

1. **Redirect subprocess output to a file and decode it yourself** with
   `errors="replace"`. Do not use `text=True` with vitest or cargo.
2. **Kill the process tree, not the process:** `Popen`, poll against a deadline,
   then `taskkill /F /T /PID <pid>`. `/T` is the load-bearing flag.
3. **Identify your own processes by command line before killing anything.**
   `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*vitest*' }`
   pins the exact PIDs. Never kill by image name on this box.
4. **A mutation whose detection is a hang is still a detection, but say so
   plainly.** Report it as TIMEOUT rather than FAIL. The test never goes green,
   which is what "the mutation was caught" means, but in CI a hang burns the job
   timeout instead of printing an assertion, so it is a weaker signal than a
   failure and should be described as one.

**How to verify:** apply the `let next = current;` mutation to `growCapacity`
in `web/src/render/instances.ts` and run `npm test` under a deadline. Expected:
the suite never terminates. Restore from a scratchpad byte snapshot, never with
`git checkout` ([L9]), and confirm `git hash-object` matches the pre-mutation
value.

**Addendum, M0 close-out: the restore must be in a `finally`, and the
harness must not print.** Rule 1 above says to decode *subprocess* output
with `errors="replace"`. That is not the whole of it - the harness then
**printed** vitest's captured output to a cp1252 console, died with
`UnicodeEncodeError` mid-report, and skipped its own restore, leaving
`depthCompare: 'greater'` on disk. Caught by `git status`, so the cost was
one minute, but the same crash one step earlier in a longer run is how a
mutation gets committed.

Two rules, and the second matters more than the first:

1. **Write the report to a UTF-8 file and read it afterwards. Never
   `print()` captured tool output on this machine.** Both directions of
   the console codepage are hostile, not just the decode side.
2. **Put the restore in a `finally`, so reporting cannot precede it.** The
   restore is the invariant; the report is a side effect. Any harness
   where a formatting bug can skip the restore is one exception away from
   the [L9] failure it was written to avoid.

---

## [L16] The Task 11 brief shipped an inverted depth mapping and a test that pinned it

**What happened:** the M0 plan's Task 11 section (`worldDepth` in
`docs/plans/2026-07-26-m0-walking-skeleton.md`, and the brief cut from it)
specified `return (wx + wy) / maxSum`, with a doc comment reading "Tiles farther
from the camera (lower x + y) get smaller values and therefore draw behind,
since the pipeline compares with 'less'." That sentence is self-refuting.
`sprites.ts` sets `depthCompare: 'less'` against `depthClearValue: 1.0`, so the
**smaller** depth wins the pixel; [L14] and [V3] in
`docs/gpu-verification.md` measured exactly that. Smaller
values draw **in front**, not behind. The prose states the correct intent and
the code does the opposite of it.

The projection settles which end is which, so this is not a matter of taste.
`worldToScreen` returns `(wx + wy) * TILE_HALF_HEIGHT`, `sprites.wgsl` flips Y
(`1.0 - screen.y / u.viewport.y * 2.0`), and `main.ts` puts `originY` at 80, near
the top. So screen y grows downward, a larger x + y draws lower on the screen,
and lower on the screen is nearer the camera. Near must take the smaller depth.
Shipped as written, every entity would have been occluded by whatever was
**behind** it: a sim standing in front of the fridge would be drawn inside it.

**The part that makes this another instance of [L5], [L6], [L7], [L11]:** the
brief's own test was `expect(worldDepth(0, 0, 64)).toBeLessThan(worldDepth(10,
10, 64))` under the name *"gives farther tiles smaller depth so they draw
behind"*. It would have passed. It names the invariant correctly, asserts its
negation, and goes green - so it would have converted the bug from a visible
mistake into a pinned requirement, and the next person to fix the rendering
would have had to delete a test to do it. The brief's other five tests were all
compatible with the inversion too: three of them (`clamps out-of-grid...`,
`keeps depth finite...`) did not exist, and "keeps depth inside the clip range"
passes for either sense because both are in [0, 1].

**Root cause:** the sense of a depth value is not a property of the depth
function. It is a joint property of four things in four different files - the
compare op and clear value in `sprites.ts`, the Y flip in `sprites.wgsl`, the
sign of the y term in `iso.ts`, and the choice of `originY` in `main.ts`. Nobody
reviewing `worldDepth` alone can tell whether it is inverted, and the type
system connects none of them. `number` in [0, 1] is `number` in [0, 1].

**Prevention rule:**

1. **For any value whose meaning is fixed elsewhere - depth, winding order,
   handedness, a sort key read by a comparator you did not write - state the
   external convention in the test, then derive the assertion from it.** The
   test name here is `orders the far corner behind the near corner for a
   less-than test`: it carries `less` in the name, so a reader can check the
   claim against `sprites.ts` without re-deriving the whole chain.
2. **A doc comment that contradicts the code next to it is a defect report, not
   a typo.** Two independent statements of intent disagreed here and the
   disagreement was visible in six lines of adjacent text. Read the comment
   against the code before trusting either.
3. **A brief is an input, not an authority.** Where a brief's code and its stated
   requirement disagree, the hardware behaviour that Task 10 measured settles it.
   Implement the requirement and report the deviation loudly.

**How to verify:** invert `worldDepth` in `web/src/render/iso.ts` back to the
brief's `Math.min(1, Math.max(0, nearness))` and run `cd web && npm test`. Four
tests must fail, the first with
`AssertionError: expected 0 to be greater than 0.15873015873015872`. Restore
from a scratchpad byte snapshot, never with `git checkout` ([L9]).

---

## [L17] A spawn outside the lot is a silent no-op, and it looks like a render bug

**What happened:** Task 12's brief set `GRID = 16` and then spawned the fridge
at `(24, 20)`, eight tiles outside the lot it had just declared. The
coordinates were correct for the `GRID = 32` the plan used before [L16]'s
sibling correction shrank the lot to fit the canvas; nothing re-checked them
when the constant moved.

**Measured, in the browser, on the shipped wasm build:** a sim with the fridge
at (24, 20) leaves the agent at (2, 3) after **40 ticks**, exactly where it
spawned. With the fridge at (12, 10) the same agent reaches (12, 3) over the
same 40 ticks. No panic, no log, no validation error, and nothing in the render
buffer looks wrong - both entities are present and drawn in the right places.

**Root cause:** `TileGrid::is_walkable` is false out of bounds, so `find_path`
returns `None` on its destination check, so `select_action` hits its
`let ... else { continue }` and the agent never gets a `Target`. The agent then
stands still forever while its hunger decays. This is deliberate at every
individual step, and the composite behaviour is indistinguishable, on screen,
from "interpolation is broken" or "the sim is not ticking" - which are the two
things Task 12 actually changed, so it would have been diagnosed there.

`sanitize_coord` does not catch it and should not: [L12] settled that the
boundary replaces **non-finite** coordinates only, because a finite out-of-lot
coordinate is a legitimate request that the sim handles by not pathing to it.
Clamping would silently relocate an object the caller asked for. The cost of
that correct policy is that lot size and spawn coordinates are a joint
constraint that nothing checks.

**Prevention rule:** when the lot size changes, re-check every hardcoded spawn
coordinate against it in the same edit. More generally, treat "the agent never
moves" as a **pathing** symptom before a rendering one: the render path cannot
make an entity hold still, since it only draws what the render buffer says.

**How to verify:** set `sim.spawnObject(24, 20)` in `web/src/main.ts` with
`GRID` at 16, tick 40 times, and read `positions()`. Slot 1 stays at its spawn
coordinates. Restore to (12, 10) and it moves.

---

## [L18] The instance array is f32, so an f64 expectation is not equal to it

**What happened:** three `frame.test.ts` assertions failed on their first
otherwise-green run with `expected 0.800000011920929 to be 0.8`. `worldDepth`
computes in JavaScript's f64 and the instance array is a `Float32Array`, so
storing the value rounds it.

**Root cause, and the reason it is worth an entry:** the obvious fix is
`toBeCloseTo`, and it is the wrong one. It would have made the tests pass and
would also have accepted a depth wrong by far more than a rounding step, on the
one value whose entire job is deciding what covers what. That is the project's
recurring shape again - a test loosened until it passes stops being able to
fail.

**Prevention rule:** compare against `Math.fround(expected)`. The assertion
stays exact, and it states the real contract, which is what the GPU reads
rather than what JavaScript computed. `frame.test.ts` wraps this as `stored()`
with the reasoning next to it.

**How to verify:** replace `stored(...)` with its argument in any of the three
depth assertions in `web/tests/frame.test.ts`; the test fails on the f32
rounding rather than on anything about the code under test.

---

## [L19] A perf harness running faster than reality hides every periodic cost

**What happened:** Task 13's first measurement of the M0 exit criterion drove
the frame body flat out from a hidden tab, per [L14]'s rule that you must drive
the draw yourself rather than trust `requestAnimationFrame`. It produced
141,767 frames in 20 seconds - **7,088 fps** - and reported p95 0.255 ms
against a 16.6 ms budget. Every number was real, the draw call really ran, and
the conclusion was still not supported.

**Root cause, and it is arithmetic rather than tooling.** The simulation ticks
at a fixed 10 Hz, and `FixedStepDriver` decides how many ticks a frame owes
from **elapsed wall time**. So the tick rate is 10 per second no matter how
fast frames are produced, and the *proportion of frames that pay for a tick* is
`10 / fps`:

| drive rate | frames that tick | is a tick frame inside p95? |
| --- | --- | --- |
| 60 fps | 1 in 6, 16.7% | yes, comfortably |
| 120 fps | 1 in 12, 8.3% | yes, p95 sits inside the slowest 8.3% |
| 7,088 fps | 1 in 709, 0.14% | **no** - not until about p99.9 |

At 7,088 fps the 95th percentile lands entirely among frames that did nothing
but interpolate and draw. The single most expensive thing a frame can do had
been sampled out of the statistic. Driving *harder* made the test *weaker*,
which is the opposite of the intuition that a stress harness should run flat
out. Re-measured at a realistic cadence, p95 moved from 0.255 ms to 1.335 ms -
a 5x difference that changed no code. **Tick inclusion is not the whole of
that 5x; see the magnitude correction below, which the project's own final
numbers force.**

This is the same family as [L5], [L6], [L7], [L11] and [L14]: the measurement
was green because the expensive path was not in the sample. It is a new costume
because nothing was broken, mocked, or skipped - the harness simply chose a
frame rate, and the frame rate silently chose which costs the percentile could
see.

**Prevention rule:**

1. **A frame-time percentile is only meaningful at the frame rate it will ship
   at.** Before trusting one, compute `10 / fps` (more generally, the duty
   cycle of every periodic cost) and check that the percentile you are quoting
   is above it. If p95 sits below the tick duty cycle, it is measuring the
   cheap frames only.
2. **Say the achieved frame rate next to every frame-time number.** A p95
   without an fps is uninterpretable, for exactly this reason.
3. **Prefer a real, visible browser for the final number.** Driving frames by
   hand is the right *diagnostic* and [L14] still stands, but a genuine
   vsync-paced `requestAnimationFrame` run gets the duty cycle right for free
   and needs no reasoning about pacing at all.

**How to verify:** with the preview server up, load `?stress=1000` and drive
`globalThis.__terriStress.step()` in a loop with no pacing; p95 reads about
0.25 ms. Pace the same loop to one call per 16.667 ms and p95 reads about
1.3 ms, against an identical build. The measured artefact is the harness, not
the renderer. **Expect that 1.3 ms not to reconcile with the headline 0.33 ms;
the correction below is why, and reproducing the discrepancy is part of the
procedure rather than a sign you did it wrong.**

**Magnitude correction, M0 close-out review.** The entry above attributes the
whole 0.255 -> 1.335 ms shift to tick frames entering the percentile
population. The project's own final measurement rules that out. Over 7,202
real rAF frames the **worst single frame of any kind was 0.805 ms**, and at
120 fps a tick lands on 1 frame in 12, so tick frames are inside that sample
and are bounded by it. A tick frame on this machine therefore costs **at most
0.805 ms**, which is strictly less than the 1.335 ms the paced hidden-tab run
reported for its p95. At least 0.5 ms of the 1.08 ms gap - **roughly half of
it** - cannot be tick cost.

The remainder is harness and hidden-tab overhead. Two plausible contributors,
neither of which was isolated: a tab that is not composited runs at background
scheduling priority, and 16.7 ms of idle between paced frames lets caches,
branch predictors and clock speed go cold in a way that 0.14 ms of idle does
not. [F6] in the Task 13 report blames the same environment for a single
123.7 ms frame that never once appears under real rAF, so the environment is
already known to inflate this statistic.

**The rule is unchanged and still the valuable part:** compute the duty cycle
of every periodic cost, check the percentile you are quoting sits above it,
and say the achieved frame rate next to every frame-time number. What is
withdrawn is the *number*. "Pacing the harness cost 5x" is not supported;
"pacing the harness changed the statistic by 5x, of which roughly half is the
harness measuring itself" is what the data says.

The deeper form of the mistake is worth naming, because it is the same family
as everything above: **a corrected measurement is still a measurement, and it
needs its own control.** Having found one explanation that predicted the right
direction, I stopped looking, and attributed 100% of an effect to a cause that
could account for at most half of it. Rule 3 of `testing-protocol.md` applies
to explanations too - name the alternative that predicts the same numbers,
then find the observation that separates them. Here the separating
observation already existed in the same report, three sections down.

**Measured facts worth keeping, from the visible-Chrome run.** 1,002 entities,
1280x720, release build: 7,202 rAF frames in 60.02 s (a sustained 120 fps, so
no frames dropped), mean 0.261 ms, p95 0.33 ms, p99 0.405 ms, max 0.805 ms,
**zero frames over 16.6 ms**. One draw call and one queue submit per frame with
`instanceCount = 1002`. The first 240-frame window reports p95 6.21 ms and the
next reports 0.32 ms, so pipeline and JIT warm-up costs roughly one window and
must be discarded rather than averaged in. JS heap oscillated between 1.84 and
2.62 MB with no trend across 12 five-second marks.

---

## [L20] Two ways a browser probe silently measures something other than the page

Both found during the M0 close-out, both in the same hour, both with the
same shape as everything above: the probe ran, returned a number, and the
number was about the wrong thing.

### Half one: an edited module is a *different* module, so patching the class patches nobody

To observe the shipped `requestAnimationFrame` loop without changing
source, `SpriteRenderer.prototype.draw` and `SimBridge.prototype.tick`
were patched from a dynamic import of the real modules - [L14] rule 1,
and what Tasks 10 and 12 relied on. The tick patch worked and produced a
complete 259-tick trace. **The draw patch counted zero, over 26 seconds
in which the page demonstrably drew 3,104 times.**

The cause is Vite's dev-server cache busting. A module the server has
invalidated since start-up is served to importers under a **timestamped
URL**, and a URL is a module's identity:

```
http://localhost:5173/src/render/sprites.ts?t=1785191946008   <- what main.ts got
http://localhost:5173/src/render/sprites.ts                   <- what the probe got
```

Two URLs, two module records, two `SpriteRenderer` classes, two
prototypes. `sprites.ts` had been edited during the session and
`bridge.ts` had not, which is the entire reason one patch worked and the
other did not. The `.js` and `.ts` specifiers are also distinct records
(`sprites === (await import('/src/render/sprites.js'))` is **false**),
so the same trap is reachable without editing anything.

The dangerous direction is not the zero. It is a probe that builds a
"real module" harness, gets a plausible number, and has actually
measured a **second, parallel copy** of the code - possibly a stale one -
while believing it observed the page.

**Prevention rule:**

1. **Count frames with platform globals, not module exports.**
   `GPURenderPassEncoder.prototype.draw` and `GPUQueue.prototype.submit`
   have exactly one identity per page and cannot be duplicated by a
   bundler. They are also closer to the claim: what reached the GPU.
2. **Any module-identity probe must assert its own identity**, by
   observing something only the page's instance can produce. The tick
   patch was self-verifying by accident - it returned the page's real
   agent walking the page's real lot - and the draw patch was not.
3. **Dump `performance.getEntriesByType('resource')` when a probe reads
   zero**, before believing the zero. The two URLs are right there.
4. Restarting the dev server clears the timestamps, which fixes it and
   also hides it. Prefer rule 1.

### Half two: the heap profiler hides exactly the allocations you are hunting

[D11] forbids per-entity allocation on the render path, and the question
was whether `worldToScreen`'s returned tuple survives escape analysis.
The first CDP sampling run reported **0 sampled bytes over 2,395 frames**
of a full web page - which was caught only because a page allocating
literally nothing for twenty seconds is not a plausible reading.

`HeapProfiler.startSampling` takes `includeObjectsCollectedByMajorGC` and
`includeObjectsCollectedByMinorGC`, and **both default to false**. The
default profile is therefore *surviving* allocations only, so a
short-lived per-frame temporary that the scavenger reaps is reported as
zero bytes. That is precisely the "nothing allocates" versus "the
scavenger keeps up" ambiguity the profile exists to settle, and the
default answers it wrong in the reassuring direction.

With both flags true the same page reported 58.54 MB, of which **57.76 MB
was the tuple**. The expectation that escape analysis would eliminate it
was simply false. See [V11] in `docs/gpu-verification.md`.

**Prevention rule:** when a measurement of a *hot* path returns zero,
treat the instrument as the suspect before the code. State the expected
magnitude first - here, 2.4 million calls times a few tens of bytes,
which is tens of megabytes and thousands of samples - so that "zero" is
recognisable as impossible rather than as good news. An instrument
configured to exclude the phenomenon under study is the same failure as a
test that cannot fail.

**How to verify:** revert `buildInstances` to call `worldToScreen` and
re-run the profile on `?stress=1000` with both include flags set;
`buildInstances` reads tens of MB. Drop the flags and it reads 0 with the
identical code. The two configurations disagree about the same program,
and only one of them is answering the question asked.

---

## [L21] A mutation that fails to compile is not evidence about the test

**What happened:** A task brief instructed "remove `NeedId::Comfort` from the
`ALL` array, confirm `all_lists_every_variant_in_index_order` fails." The
mutation did fail the build - but with
`error[E0308]: expected an array with a size of 7, found one with a size of 6`,
because `ALL` is declared `[NeedId; NEED_COUNT]`. **The test never ran.**

Logged naively, that is a "caught" row that is entirely true and says nothing
about whether the test works. The implementer noticed and found the mutation
that actually exercises it: replace `Comfort` with a duplicate of another
variant, which preserves the length and is also the realistic copy-paste slip.
That one failed the test properly, at index 6.

**Root cause:** mutation testing asks "does the test suite notice this change?"
A change the *compiler* rejects never reaches the suite, so it answers a
different question. The stronger the types, the more often this happens - which
means it happens most in exactly the code where you are most tempted to trust a
green mutation report.

**Prevention rule:** a mutation is only evidence if the code **compiles**. When
designing one, ask what the type system already prevents and mutate around it.
For a fixed-size array, change a member rather than the count. For an enum,
substitute a variant rather than removing one. **If a mutation produces a
compile error, that is an inconclusive result, not a pass** - record it as such
and design another.

Note the compile error is still a real guard worth having. The point is only
that it is a *different* guard than the test, and finding one does not verify
the other.

**How to verify:** read the failure output, not the exit code. `error[E0308]`
means the type system caught it; a test-name-and-assertion failure means the
test did.

---

## [L22] Snapshot harnesses must key on the full path, not the filename

**What happened:** A mutation harness stored snapshots keyed on
`parent_dir + filename`. In this workspace `crates/terri-sim/src/lib.rs` and
`crates/terri-wasm/src/lib.rs` both reduce to `src__lib.rs`, so they collided
and one restore wrote the other file's contents.

**Root cause:** Rust workspaces put same-named files in every crate by
construction - `lib.rs`, `mod.rs`, `error.rs`. Any key short of the full
repo-relative path collides, and it collides *silently*, because writing a
valid Rust file over another valid Rust file usually still compiles.

**Why it was caught:** [L9]'s rule of asserting `git hash-object` after every
restore. The hash did not match, the run stopped, and nothing was lost. The
recovery deliberately avoided `git checkout` - the tree held uncommitted work -
and instead replayed the edits from `HEAD`, each asserting a unique match, then
re-verified byte identity plus a golden vector that independently pins the
affected function.

**Prevention rule:** key snapshots on the **full repo-relative path**, with
separators replaced rather than dropped. And keep asserting the hash after every
restore: that assertion is what turned a silent cross-file corruption into a
stopped run.

**How to verify:** snapshot two same-named files from different crates and
confirm the harness produces two distinct keys.

---

## [L23] A crate can compile on a serde feature a *sibling* dependency turned on

**What happened:** `terri-data`'s manifest was written with
`serde = { workspace = true, features = ["std"] }`, deviating from the Task 3
brief's plain `serde = { workspace = true }`. The reasoning was that the
workspace entry is `default-features = false`, so `String`, `Vec` and `BTreeMap`
would have no `Deserialize` impls. Removing the feature to confirm that, per
`testing-protocol.md` rule 1, produced the **opposite** of the expected result:
`cargo build -p terri-data` succeeded anyway.

`cargo tree -p terri-data -e features` says why:

```
terri-data
|-- postcard feature "alloc"
|   +-- serde feature "alloc"
```

`postcard`'s `alloc` feature enables `serde/alloc`, and feature unification hands
it to `terri-data`. The derives compiled because of a dependency that has nothing
to do with them.

**Root cause:** Cargo unifies features across a package's whole dependency graph,
so a crate's declared features describe what it *asked for*, never what it
*gets*. Nothing warns when the two differ. The failure only appears later, when
whoever removes or re-scopes the unrelated dependency gets a compile error in
code they did not touch, naming a trait impl they did not know was conditional.

**The compounding trap:** `cargo test -p terri-data` passes under **both**
configurations, because the `toml` dev-dependency drags in `serde/std` for the
test target. Dev-dependencies are unified into the lib build when building tests
and are absent from `cargo build`, so the test command is systematically more
permissive about features than the build command. Checking a feature question
with `cargo test` answers a different question.

**Prevention rule:** declare every feature your own code needs, even when it
already builds without it, and verify feature questions with `cargo build`
(no dev-dependencies) rather than `cargo test`. When a feature looks redundant,
run `cargo tree -e features` before deleting it; "it compiles without this" is
not evidence the crate does not need it.

**How to verify:** drop `features = ["std"]` from `serde` in
`crates/terri-data/Cargo.toml` and run `cargo build -p terri-data`. It succeeds.
Then also set `default-features = false` on `postcard`'s `alloc` feature, or
remove `postcard` from `[dependencies]`, and it stops succeeding. Two edits are
needed to observe a requirement that one manifest line claims to own.

---

## [L24] A brief's own tests can be blind to the property the same brief calls load-bearing

**What happened:** the **seventh** instance of the family ([L2], [L3], [L5],
[L6], [L7], [L11]), and the new part is where the blind spot originated. Task 3's
instructions stated, in bold, that `InteractionDef::advertises` must be a
`BTreeMap` rather than a `HashMap`, because the compiled pack is serialised in
iteration order and feeds a determinism hash. The same brief supplied three
tests. Swapping in a `HashMap` left **all three green**:

```
test schema::tests::parses_a_needs_file ... ok
test schema::tests::an_object_may_declare_no_interactions ... ok
test schema::tests::parses_an_object_with_a_sparse_advert ... ok

test result: ok. 3 passed; 0 failed
```

The two assertions that touch the map are `advertises.get("hunger")` and
`advertises.len()`, and both behave identically under either map type. The
brief argued for the mechanism carefully and then tested everything about the
map except it.

**Root cause:** a brief that explains *why* a choice matters reads as though it
has covered the choice. Prose justification and test coverage are independent,
and the more convincing the prose, the less likely anybody checks the tests
against it. [L16] recorded a brief whose code contradicted its own stated
requirement; this is the quieter version, where the code is right and nothing
holds it in place.

**Prevention rule:** for every property a brief calls load-bearing, find the test
that would fail if it were violated **before** writing any code. If there is not
one, that is the first thing to add, and it is not scope creep. Expect the
predicted test count in a plan to be a floor rather than a target.

**How to verify:** apply `use std::collections::HashMap as BTreeMap;` to
`crates/terri-data/src/schema.rs` (an alias keeps every use site identical, so
the mutation is a single clean variable) and run `cargo test -p terri-data`.
Exactly `schema::tests::advert_iteration_is_sorted_not_hash_ordered` must fail,
with a `left` showing hash order and a `right` showing sorted order. If the
suite is green, the ordering is unprotected again.

Note the test is probabilistic against a `HashMap`, though not against the
correct code: seven keys have 5040 orderings and one of them is sorted, so it
fails about 99.98% of runs. It is fully deterministic under `BTreeMap`. The
airtight version is a golden vector over a compiled pack, which needs the
compile step to exist first.

---

## [L25] The Bash tool is Git Bash, so PowerShell here-string syntax lands as a literal argument

**PowerShell search follow-up, 2026-09-17.** Positional wildcard paths passed to
native `rg` are not expanded like Bash paths; unquoted brace lists may fail
PowerShell parsing before `rg` runs. Three repeated search failures triggered
a fresh-context review. Use literal directory arguments and quoted `-g`
patterns owned by `rg`, or enumerate already discovered filenames. Verify with
`rg --files DIRECTORY -g 'PATTERN'` before searching uncertain filenames.

**2026-09-20 recurrence.** The same literal-wildcard mistake recurred during
builder release checks. Fresh review confirmed the existing rule, not a new
repository problem. Use directory-scoped discovery before content lookup;
never turn a no-match result into guesses at adjacent module filenames.

**2026-10-01 recurrence.** Guessed roadmap, package and checker paths failed
during bed integration review. The README already linked `docs/FEATURES.md`
and `docs/specs/`; file discovery found root `check-doc-ids.py` and
`web/package.json`. Fresh review confirmed that filename assumptions caused
the failures. Start with the README index and a directory-scoped file list,
then verify each selected path exists before reading it.

**What happened:** a commit was made from the Bash tool with
`git commit -m @'...'@`, which is PowerShell here-string syntax. Bash has no such
form, so `@` was passed through as an ordinary character: the commit subject
became a bare `@` and the real subject dropped to line two, silently, with
exit 0.

**Root cause:** this environment exposes a PowerShell tool and a Bash tool side
by side, and the two take different quoting for exactly the operation that most
needs multi-line strings. Neither shell errors on the other's syntax here; both
produce a valid command with the wrong content.

**Prevention rule:** in the Bash tool use a quoted heredoc,
`git commit -F - <<'EOF'`, and in the PowerShell tool use `@'...'@` with the
closing delimiter at column 0. Pick the form from the tool, not from habit. After
any scripted commit, run `git log -1 --format=%s` and read the subject back;
`git commit` reports success for a message that is entirely wrong.

**How to verify:** `git log -1 --format=%B | head -3` after committing. A subject
line consisting of a stray delimiter character is the signature of this mistake.

---

## [L26] A wall of rejection tests says nothing about what the validator builds

**What happened:** Task 4's brief supplied twelve tests for `compile`, and
eleven of them assert that bad content is *rejected*: unknown need, missing
decay, duplicate id, zero duration, zero slots, non-finite, negative. The
coverage of the failure paths is genuinely thorough. Mutating the single line
that maps a validated need onto its slot in the pack -
`decay[id.index()] = def.decay_per_tick` changed to `decay[0] = ...` - left
**all twelve green**.

The mutation is not subtle. It makes six of the seven needs decay at `NaN` and
the seventh at hunger's rate, for every agent, forever. It survived because the
one fixture every test shares gives all seven needs the same decay rate of
`0.1`, so a value written to the wrong slot is indistinguishable from one
written to the right slot.

**Root cause:** a validator has two halves - what it refuses, and what it
produces from what it accepts - and they need separate tests. Rejection tests
are easy to enumerate, because each one is named by an error variant, so a
brief that works down the error enum feels complete when it has covered every
variant. Nothing in that process ever looks at the output. The eighth instance
of the family ([L2], [L3], [L5], [L6], [L7], [L11], [L24]), and the specific
new lesson is that **an error enum is a checklist for half the surface**.

Compounding it: uniform fixtures are the natural thing to write, and they are
exactly what makes a mapping unobservable. `full_needs()` giving every need
`0.1` is the tidier fixture and the blind one.

**Prevention rule:** for any function returning `Result<T, E>`, count the tests
that inspect `T`. Enumerating `E` is not coverage. Where the output is a
mapping - index to value, name to slot, id to position - **the fixture must
make every key distinguishable**, or the test cannot tell the mapping from a
constant. Distinct values per key, and where order matters, a source order that
differs from the expected output order.

**How to verify:** in `crates/terri-data/src/compile.rs`, change
`decay[id.index()]` to `decay[0]` and run `cargo test -p terri-data`. Exactly
`decay_rates_land_at_their_own_need_index` and
`a_compiled_pack_serialises_to_a_stable_golden_vector` fail; the twelve tests
from the brief all pass. Both of those were added for this reason.

---

## [L27] `cargo mutants` only mutates the packages you name

**What happened:** CI's mutation sweep ran
`cargo mutants --package terri-core --package terri-sim`. That list was correct
when it was written and silently stopped being correct when `terri-data` gained
a validator: the new crate held the project's most branch-heavy code, every
branch of it a [D9] guarantee, and the mandated backstop was not looking at it.
Nothing failed. The sweep reported success over the packages it was told about.

Note this is not the same as `--test-workspace true`, which was already set and
which controls *which tests judge* a mutant. That flag was doing its job; the
package list decides *what gets mutated*, and no flag makes it follow the
workspace.

**Root cause:** an explicit allowlist in CI is a snapshot of the crate layout on
the day it was written, and adding a crate is exactly the moment nobody rereads
the CI file. The failure is silent in the worst direction: the gate still passes,
so it reads as evidence.

**Prevention rule:** adding a workspace member is incomplete until the crate is
named in every CI loop that takes a package list - the mutation sweep and the
dependency-purity check both do here. Run the sweep against the new crate before
adding it, so it joins with a measured survivor count rather than an assumed one.

**How to verify:** `cargo mutants --package <new-crate> --test-workspace true`
should report a survivor count you have read. `terri-data` reported 16 mutants,
1 missed on first run - `check_number`'s `value < 0.0` mutated to `<= 0.0`,
meaning nothing in the suite pinned whether zero is legal content. It is: a
decay rate of zero is a need that does not decay. A test now says so, and the
crate joined CI at 13 caught, 3 unviable, 0 missed.

---

## [L28] A build-time validation gate converts caught mutants into unviable ones

**What happened:** M1a Task 5 gave `terri-data` a `build.rs` that includes
`src/compile.rs` via `#[path]` and aborts the build on invalid content. The
sweep was re-run afterwards. No test changed, and neither `compile.rs` nor
`pack.rs` changed:

```
terri-data alone
  Task 4: 16 mutants tested: 13 caught,  3 unviable, 0 missed
  Task 5: 17 mutants tested:  6 caught, 11 unviable, 0 missed

all three packages
  Task 4: 266 mutants: 18 missed, 235 caught, 13 unviable
  Task 5: 267 mutants: 18 missed, 222 caught, 27 unviable
```

**Thirteen** mutants moved from **caught** to **unviable**, matching the
235-to-222 fall exactly. Seven are in `terri-data`, among them
`compile.rs:65:12: delete ! in compile` (the missing-need loop) and
`compile.rs:94:35: replace == with != in compile` (the zero-duration check).

**The other six are in `terri-core`, and that is the part worth remembering.**
`NeedId::index`, `NeedId::as_str` and `NeedId::from_name` were all caught by
`terri-core`'s own tests before this task, and are now unviable:

```
crates/terri-core/src/needs.rs:36:9: replace NeedId::index -> usize with 0
  content is invalid: needs.toml declares 'energy' more than once
crates/terri-core/src/needs.rs:54:9: replace NeedId::from_name -> Option<NeedId> with None
  content is invalid: needs.toml declares unknown need 'hunger'
```

**Root cause:** `compile.rs` is now compiled into two units, the library and the
build script, and the build script also pulls in `terri-core` as a build
dependency. When `cargo mutants` mutates either crate, the mutated code runs
inside `build.rs` against the real `content/*.toml`, rejects it, and the package
never builds. `cargo mutants` classifies any build failure as unviable, so the
mutant never reaches the test suite that used to kill it.

The blast radius is therefore **not confined to the crate that owns the build
script**. It covers everything the build script transitively depends on, which
is exactly the direction nobody looks: the change was made in `terri-data` and
the evidence quietly degraded in `terri-core`.

**Why this is not a regression in safety and is one in evidence.** Every one of
those mutants is still detected, and the build gate detecting them is precisely
the [D9] guarantee the build script exists to provide. But by [L21], an unviable
mutant says nothing about the tests. The sweep can no longer tell you whether
`rejects_a_missing_need_decay` and its siblings still work, and the CI gate
stays green either way, because unviable is neither caught nor missed. That is
this project's recurring shape wearing yet another costume: **the check still
passes, over less.**

**Prevention rule:** when a validator gains a build-time caller that consumes
real data, re-measure the **whole sweep's** caught/unviable split and record
both numbers, not just the missed count and not just the crate you edited. A
fall in *caught* with a matching rise in *unviable* means coverage moved out of
the test suite and into the build. No `cargo mutants` flag converts a build
failure back into a catch; `--help` offers only `-V, --unviable`, which lists
them. Do not delete the tests that used to catch those mutants on the grounds
that the sweep has stopped crediting them: they are still the only thing that
would catch a regression if the build gate were ever relaxed, and the sweep will
not tell you when they rot.

**How to verify:** run the sweep, then

```
grep -lE "content is invalid" mutants.out/log/*.log | wc -l
```

Every hit is a mutant killed by `build.rs` rather than by a test. Measured here:
**13**, which is exactly the fall in *caught* from 235 to 222. If that count and
the fall in caught disagree, something other than the content gate also changed.
Anything unviable for a different reason shows an `error[E...]` instead, which
is the ordinary [L21] case and was already there.

---

## [L29] A field read for exactly one purpose is only observable through that purpose

**What happened:** the **ninth** instance of the family ([L2], [L3], [L5], [L6],
[L7], [L11], [L24], [L26]), found during M1a Task 6 by the mandatory hand sweep
rather than by review or by `cargo mutants`, and found in code written minutes
earlier.

Task 6 made an object offer a *list* of interactions, so `select_action` records
which one won in `Target::interaction` and `follow_path` resolves that index
when it starts the meal. A test was written for exactly that -
`the_interaction_recorded_at_selection_is_the_one_that_fills` - with a fixture
object offering a weak `nibble` and a strong `feast`. It asserted the agent ends
up performing the second one.

Replacing `interactions[target.interaction as usize]` with `interactions[0]` in
`follow_path` left **all 91 workspace tests green**, that one included.

**Root cause, and it is narrower and more useful than "the fixture was weak".**
`follow_path` reads the resolved interaction for **one** value: its
`duration_ticks`. Everything else flows through `Eating`, whose `interaction`
field is copied from `Target` and re-resolved by `tick_interactions`. The
fixture gave both interactions a duration of **15**, so the wrong lookup
returned a different object with the same number in the only field anybody read.
The test asserted `Eating.interaction == 1` and got it, because that field never
passed through the mutated expression at all.

So the test exercised the line, the line returned the wrong value, and the
assertion could not see it. **The reachable-but-unobservable case is not the
same as the untested case, and it does not look different from the outside.**

The generalisable rule: *before writing the fixture, ask which single value the
code under test actually extracts, and make the candidates differ in **that**
value.* Making them differ in something adjacent - here, the advertised delta -
feels like the same thing and is not, because the delta reaches the assertion by
a route that bypasses the mutated line.

**Prevention rule:**

1. For any lookup, indirection or index resolution, **name the field the caller
   reads** and give the fixture's alternatives different values *for that
   field*. A fixture whose candidates agree on the read field cannot test the
   read.
2. `cargo mutants` would not have found this either. It rewrites expressions,
   and `interactions[i]` to `interactions[0]` is a constant substitution inside
   an index expression that is outside its grammar, exactly as statement
   deletion is ([L11]). Hand mutation is what caught it, which is rule 1 of
   `testing-protocol.md` earning its place for the ninth time.
3. When the fix is to make a fixture's values differ, **say in the test comment
   that the difference is load-bearing and that the equal version was measured
   green.** Otherwise the next reader tidies the two durations back to one
   constant and the test silently returns to being decorative.

**How to verify:** in `crates/terri-sim/src/systems/movement.rs`, replace
`interactions[target.interaction as usize]` with `interactions[0]` and run
`cargo test -p terri-sim`. Exactly
`systems::interact::tests::the_interaction_recorded_at_selection_is_the_one_that_fills`
must fail, with
`left: Eating { object: ObjectDefId(0), interaction: 1, remaining_ticks: 4 }`
against `right: ... remaining_ticks: 14`. Then set both fixture interactions to
the same `duration_ticks`, apply the same mutation, and confirm the suite is
green again - that second half is the finding, not the first. Restore from a
scratchpad byte snapshot, never with `git checkout` ([L9]), and touch the file
([L8]).

---

## [L30] An equivalent mutant stops being equivalent when the code around it changes shape

**What happened:** `crates/terri-sim/src/systems/action.rs`'s
`replace < with <= in select_action` had been in `docs/mutants-baseline.txt`
since M0, and correctly so. The clause is

```rust
score == best_score && object.index() < best_e.index()
```

and while an object carried a single advert, the two sides were always
**different entities**. Distinct entity indices are never equal, so `<` and
`<=` agree on every input the program can produce. It was an equivalent
mutant: unkillable, and rightly recorded as accepted debt rather than chased.

M1a Task 6 gave an object a *list* of interactions and made `select_action`
score each one, so the same clause now also compares an object **against
itself**. There `idx < idx` is false and `idx <= idx` is true, and the
difference decides which of two equally good interactions an agent performs -
a real determinism property, silently governed by declaration order in
content. The mutant became killable, and nothing killed it.

Nothing in the sweep said so. It reported the entry as missed, exactly as it
had for five milestones, and the `comm` against the baseline was clean. **A
survivor that was already a survivor produces no signal when its meaning
changes.**

**Root cause:** "equivalent mutant" is a judgement about the code *as it was*,
not a property of the line. A baseline entry records the judgement and not the
argument behind it, so nothing prompts a re-read when the argument expires.
Same family as [L27] and [L28]: the check still passes, over something
different from what it used to cover.

**Prevention rule:** when a change widens what an existing expression compares -
a new caller, a new loop, a new pair of operands - **look up whether that
expression already has a baseline entry, and re-derive the argument for it**.
If the argument no longer holds, the entry is a missing test, not debt.
Practically: grep `docs/mutants-baseline.txt` for the file you are editing
before you start, not after the sweep.

Corollary for `docs/mutation-baseline.md`: an accepted-survivor entry should
record *why* it is unkillable, because that sentence is what a future reader
can check against the new code. "Equivalent" alone cannot expire visibly.

**How to verify:** replace `<` with `<=` in that clause and run
`cargo test -p terri-sim`. Exactly
`systems::action::tests::a_tied_later_interaction_cannot_displace_an_earlier_one_on_the_same_object`
must fail, with `left: 1, right: 0`. Delete that test and the same mutation
leaves the workspace green, which is the state the baseline described.

---

## [L31] Widening a mechanism does not fail the tests that only covered part of it

**What happened:** M1a Task 7 widened `decay_needs` from hunger alone to all
seven needs. The brief predicted, correctly, which tests would go red, and every
one of them did. What no prediction covered was `hunger_never_goes_negative`,
because it stayed **green** - and it stayed green while silently losing six
sevenths of the surface it was written to protect.

That test pinned the floor at zero. Before this task there was exactly one need
that could reach the floor, so covering hunger covered the mechanism. After it
there are seven, and the test still covered one. Measured: make `Needs::drain`
clamp hunger and write the other six straight into the array, and
`no_need_goes_negative` is the **only** failure in the workspace, at
`energy fell past the floor, left: -68.0002`. Read where that lands - the loop
reaches *energy*, so hunger's assertion passed, and hunger's assertion is the
whole of what `hunger_never_goes_negative` checked. The version it replaces was
green under that mutation, and so was everything else, all 93 of them.

The golden vectors cannot help here and it is worth knowing why: their scenario
runs 100 ticks from full, which never drives any need below zero, so a broken
floor is simply not on their path.

**Root cause:** a red test announces that it needs attention. A test that merely
**narrowed** announces nothing, because passing is what it did yesterday too.
Task 6 saw this coming for the tests it could make fail - it deliberately left
`hunger_decays_at_the_rate_content_declares` asserting that the other six needs
do *not* move, so Task 7 would have to update it on purpose ([C2] in that
report). That device works, and it only works for the tests somebody thought to
point at the change.

Same family as [L27], [L28] and [L30] - "the check still passes, over less" -
but the trigger is new. Those were CI package lists and mutation-baseline
entries, artefacts a reader already treats as configuration. This is an ordinary
unit test with a name that still reads as true.

**Prevention rule:** when a change takes a mechanism from operating on one
instance to operating on N, **grep for the tests naming that mechanism and ask
of each whether its fixture still spans the mechanism's whole domain**. Do this
for the tests that stay green; the red ones will find you. A test whose name
carries the single instance - `hunger_never_goes_negative`, `..._for_hunger`,
`..._the_first_...` - is the visible marker, and renaming it to the general
claim is the fix, not a tidy-up.

**How to verify:** in `crates/terri-core/src/needs.rs`, change `drain` to
`if id == NeedId::Hunger { self.set(id, next) } else { self.0[id.index()] = next }`
and run `cargo test --workspace`. Exactly
`systems::needs::tests::no_need_goes_negative` must fail. Note `terri-core`'s
own `needs_clamp_to_range` stays green under it, because it too only drains
hunger. Restore from a scratchpad byte snapshot, never with `git checkout`
([L9]), and touch the file ([L8]).

---

## [L32] Most accepted mutation debt was cheaper to kill than to keep arguing for

**What happened:** the M1a close-out triaged all 16 surviving mutants properly
for the first time, instead of confirming the count had not grown. **Eleven of
the sixteen died to four small tests and no production change at all.** They
had been in `docs/mutants-baseline.txt` for five milestones, each behind a
one-line justification in `docs/mutation-baseline.md` that read as settled:

| Baselined as | Actually |
|---|---|
| "No consumer until M3" (`is_hour_boundary`) | 12 lines of test, and the "tick 0 is a boundary" decision was undocumented in code |
| "Unused accessors" (`width`, `height`) | Reachable all along; a **square** fixture made them interchangeable |
| "Real test gap", pathfinding (4) | Three of the four were one direct assertion on `heuristic` |
| "Hash (2)" | A latent NaN/`i64::MIN` digest collision, one `assert_ne!` away |

None of that required insight. It required someone to ask, per survivor,
"what would kill this?" rather than "is this the same set as last time?"

**Root cause, and it is about the gate rather than about the code.** The CI
gate is *no new survivors*, which is the right gate: a wall of known noise gets
ignored, and that is the failure this whole discipline exists to prevent. But
"no new survivors" makes an existing survivor **free**. Nothing costs anything
until the day the set changes, so an entry written once is never re-read, and
the cheapest possible action at every sweep is to confirm the diff is empty.
The file drifts from a ledger of deliberate decisions into a list of things
nobody has looked at, and it looks identical either way.

The two flavours compound. A **wrong** justification ([L30]: an equivalent
mutant that stopped being equivalent) and a **lazy** one ("unused accessors")
produce the same green diff, so no amount of watching the gate distinguishes
them.

**Prevention rule:**

1. **If the argument for accepting a survivor is shorter to write than the test
   that would kill it, write the test.** That is a genuinely usable threshold,
   and it disqualified eleven of sixteen entries here.
2. **"Nothing uses it" is a reason to test it, not a reason to baseline it.**
   An unused public function is behaviour with *no* constraint on it rather
   than weak constraint, and it will acquire its first caller in a task that is
   busy doing something else.
3. **Re-derive every accepted argument at each milestone close-out, and say in
   the file which ones you actually re-derived and which you carried on
   trust.** [L30] says an argument expires; this says the expiry is invisible
   unless someone schedules the check. The close-out is the schedule.
4. Where the survivor is genuinely equivalent, **write down the condition that
   would end the equivalence** - "`NEIGHBOURS` is closed under negation",
   "`score_advertisement` is a plain product over a clamped urgency" - so the
   next reader can check one sentence instead of re-deriving the proof.

**How to verify:** the eleven closures are listed with their killing tests in
`docs/mutation-baseline.md`. The survivor count went from 16 to 5 with no
production code changed, so `cargo test --workspace` before and after the
tests differs by exactly 4 tests and the world-hash golden vectors do not move.

---

## [L33] A round trip cannot pin a wire format, because it is self-consistent under any encoding

**What happened:** the **tenth** instance of the family ([L2], [L3], [L5], [L6],
[L7], [L11], [L24], [L26], [L29]), and this time the blind test arrived already
carrying a comment stating the property it did not check.

M1b Task 1's brief supplied `commands_round_trip_through_postcard`, whose own
comment reads: "Commands are the wire format for the save-file command log and,
later, for multiplayer. A silent encoding change would break a replay long after
the commit that caused it." The surrounding prose called the test load-bearing
twice.

Swapping the order of `SimCommand::Select` and `SimCommand::UseObject` in the
enum - a two-line edit, and the single most likely way this format changes by
accident - renumbers the postcard variant index of every command. Under that
mutation `Select(Some(7))` encodes as `[1, 1, 7]` instead of `[0, 1, 7]`, so
every previously written command log would replay as different commands. **The
round-trip test passed.** So did the queue test. Nothing in the workspace went
red.

**Root cause:** a round trip asserts that the serialiser and the deserialiser
agree *with each other*. They are generated from the same derive, so they agree
by construction under **any** encoding. The encoding is a free variable that
appears on both sides of the assertion and cancels. This is testing-protocol
rule 3's "relation between two computed values" in its purest form, and it is
unusually convincing because the two computed values genuinely are the thing you
care about - they are just both downstream of the thing that changed.

Note that `cargo mutants` would not have found this either. Reordering the
members of a type declaration is outside its grammar, exactly as
statement-deletion is (protocol rule 2).

**Prevention rule:** for any type whose bytes are **persisted or sent**, a round
trip is necessary and never sufficient. Pin the bytes with a golden vector
beside it:

1. Assert exact `expected` byte slices for at least one value of every variant.
2. Include a value **above 127**, which is what makes the assertion sensitive to
   varint-ness and to integer width. `SetSpeed(200)` is two bytes if the field
   is ever widened from `u8` to `u32`, and one byte otherwise; `SetSpeed(2)`
   cannot tell the two apart.
3. Say in the type's doc comment that variant order and field widths **are** the
   wire format, so the next person to insert a variant in the middle reads it
   before rather than after.

**How to verify:** swap any two variants of `SimCommand` and run
`cargo test -p terri-core command`. `command_encoding_is_pinned_by_a_golden_byte_vector`
fails naming the changed bytes; `commands_round_trip_through_postcard` passes.
Restore from a scratchpad byte snapshot, never with `git checkout` ([L9]), and
touch the file ([L8]).

---

## [L34] A suite whose inputs are all integers cannot detect rounding

**What happened:** `screenToWorld` shipped with three tests, including a
round-trip over six coordinate pairs. Wrapping both results in `Math.round`
left all three green. A fourth test with a fractional input caught it
immediately.

**Root cause:** every input was a point that `worldToScreen` had produced from
**integer** world coordinates, so the correct answer was always an integer and
rounding was a no-op. Adding more coordinate pairs would not have helped - the
suite was not too small, its **input domain was degenerate**. Six points that
all share the property you failed to vary are one point.

This differs from the earlier entries in this file. [L5] and [L7] are about the
shape of the assertion; this one is about the shape of the **inputs**. A test
can assert exactly the right thing, causally, and still be blind because nothing
it feeds in can distinguish the two implementations.

**Why it matters that the mutation was realistic:** the caller wants a tile
index, so "just make `screenToWorld` round to the tile" is the obvious-looking
simplification someone makes later while tidying. The suite would have approved
it, and picking would then be correct at tile centres and wrong everywhere else -
which reads as a rendering problem, not an input one.

**Prevention rule:** for any function over a continuous domain, **ask what
property every input shares**, and add one that breaks it. Integers hide
rounding and truncation. Positive values hide sign errors. Symmetric values hide
transposition. Zero hides almost everything.

**How to verify:** apply the degenerate implementation - round it, take the
absolute value, transpose the arguments - and check the suite fails. If it
passes, the inputs are the problem, not the assertions.

---

## [L35] A hand-designed mutation must be survivable by the shipped content, or the build gate answers instead of the test

**What happened:** M1b Task 3 added lot validation to `terri-data`'s
`compile.rs`, which `build.rs` runs against the real `content/*.toml`. To
verify the new `rejects_a_wall_outside_the_lot` test, the bounds check
`x >= lot.width || y >= lot.height` was transposed to
`x >= lot.height || y >= lot.width`. The shipped lot is 24 wide and 18 tall
with walls out to `x = 23`, so the transposed check rejects real content and
the build aborted:

```
thread 'main' panicked at crates\terri-data\build.rs:67:29:
content is invalid: lot.toml has a wall at (18, 8), outside the 24x18 lot
```

**The test never ran.** Logged naively that is a "caught" row that is
entirely true and says nothing about whether the test works.

**Root cause:** this is [L21]'s shape with the compiler swapped out for the
content gate, and it is worth its own entry because the defence is
different. [L21] says to design a mutation around what the *type system*
prevents, and the fix there is structural: change an array member rather
than its length. Here nothing about the mutation is ill-typed. What blocks
it is a *value* in a data file, so the fix is arithmetic: pick a mutation
whose accept/reject boundary the shipped content sits comfortably inside.

`x >= lot.width` mutated to `x > lot.width` is the version that works. It is
an off-by-one, so the shipped lot (`max x = 23`, width 24) still passes and
the build succeeds, while the test's deliberate `(5, 1)` on a 5x3 lot sits
exactly on the boundary and fails. Same line, same operator, conclusive
instead of inconclusive.

**Prevention rule:** before applying a mutation to code that a build script
runs over shipped content, ask **"does the real content still pass this?"**
If not, the build gate will answer and the test will not. Prefer boundary
mutations (`>=` to `>`, `<` to `<=`) over ones that change meaning wholesale
(transposition, negation), because the shipped content usually sits well
away from the boundary while the test fixture sits on it.

Where the wholesale mutation is the one you actually need to guard against -
a transposition genuinely is the realistic bug here - **put the guard
somewhere the build gate cannot reach.**
`is_wall_matches_both_coordinates_of_a_declared_wall` in `pack.rs` asserts
the transposes and the cross products of its fixture's walls, and `pack.rs`
is not on `build.rs`'s validation path, so that test stays conclusive.

**How to verify:** read the failure output, not the exit code. A panic from
`build.rs` saying "content is invalid" means the gate caught it; a test name
and an assertion means the test did. Only the second is evidence about the
test.

---

## [L36] A golden vector over a one-candidate fixture cannot see a change to how candidates are ranked

**What happened:** M1b Task 3b's brief predicted, in bold, that switching
`select_action` from Euclidean distance to A* path length would move the
world-hash golden vectors, and instructed that both copies be updated
deliberately. **They did not move.** `0x2FC6_69EF_A725_4F2D` before the
change and `0x2FC6_69EF_A725_4F2D` after it, on native and on wasm32, with
the wasm rebuilt first ([L8], [L13]).

The prediction was reasonable and the fixture is what refutes it.
`build_scenario` in `crates/terri-sim/src/lib.rs` is a 24x24 **open** room
holding **one** smart object and eight agents. Three things follow, and all
three have to hold:

1. With one object there is nothing to rank, so the metric can only act
   through the `ACTION_THRESHOLD` comparison. It does change that - agent 4
   clears the threshold at Euclidean 21.4 tiles and fails it at a path
   length of 30 - but only the lowest-index agent that clears it ever gets
   the object, because the rest find it in `claimed` and skip.
2. That agent's walk is **30 tiles at 0.25 tiles per tick = 120 ticks**, and
   the vector is taken at tick 100. It is still walking. Nothing else in the
   scenario ever selects anything.
3. Movement always used A*. So the agent's position at tick 100 is the same
   under both metrics, every other agent is stationary, and the digest is
   bit-identical.

**Root cause:** a golden vector pins *what the simulation computes in that
scenario*, and a scenario with one candidate exercises no comparison between
candidates. This is [L27], [L28], [L30] and [L31] again - "the check still
passes, over less" - but the trigger is new and worse, because the check did
not merely narrow: it never covered the mechanism at all, and its *stability*
was read as reassurance. A vector that does not move is normally evidence
that nothing changed.

**Prevention rule:**

1. **Before predicting that a golden vector will move, name the mechanism and
   check the fixture exercises it.** "Does this scenario contain two things
   the change would order differently?" is a one-line check and it is the
   whole of it.
2. **An unchanged golden vector after a deliberate behaviour change is a
   finding, not a relief.** Work out why before writing it down as a pass.
   The two answers - "the change is inert" and "the fixture is blind" - look
   identical from the outside and mean opposite things.
3. Do not fix this by tuning the fixture until the vector moves. The vector's
   job is a stable reference scenario; the mechanism's job belongs to a test
   named for it. Task 3b's
   `an_object_behind_a_wall_loses_to_a_further_one_the_agent_can_walk_to` is
   that test, and it is what mutation-verifying the metric proved.

**How to verify:** revert `let distance = steps.len() as f32;` in
`crates/terri-sim/src/systems/action.rs` to the Euclidean form and run
`cargo test --workspace`. Exactly one test fails, and it is **not**
`world_hash_matches_its_golden_vector`. Restore from a scratchpad byte
snapshot, never with `git checkout` ([L9]), and touch the file ([L8]).

**It recurred at M1c Task 3, on the same fixture, against the same
prediction, and that is why this entry is worth more than its first
instance.** That brief said in bold that both vectors "will move" when
`select_action` switched from argmax to a softmax-weighted draw - the central
change of a whole milestone. They did not: `0x2FC6_69EF_A725_4F2D` before and
after, native and wasm32, wasm rebuilt first. **One object means every agent
that gets a candidate gets exactly one, and a one-candidate draw has one
answer at every temperature and every seed.** The check in prevention rule 1
would have taken ten seconds and was not run either time.

Two things follow for whoever is next. First, this scenario is now known
*not* to cover candidate ranking or candidate sampling, so stop expecting it
to; ranking is pinned by
`an_object_behind_a_wall_loses_to_a_further_one_the_agent_can_walk_to` and
sampling by
`a_higher_scoring_object_is_chosen_more_often_and_a_lower_one_still_sometimes`.
Second, its blindness became load-bearing in a new way: softmax calls
`f32::exp`, which is a platform libm call with no cross-target bit-identity
guarantee, and this vector is compared across native and wasm32. It stays
safe *because* the fixture has one candidate, whose weight is `exp(0.0)` -
exactly 1.0 on every target. Adding a second object to `build_scenario` would
change what the vector is exposed to, not just what it covers.

**A second, smaller instance from the same task, recorded because the shape
recurs.** A boundary test for `lot_width` and `lot_height` built its own
`SimHandle::new(width, height)` out of the two numbers under test and then
asked whether a corner was inside it. That helper is **self-consistent under
a swap of the pair**: with both accessors transposed it constructs an 18x24
lot, agrees with itself, and passes. Measured. The fix was to ask the
question of `from_lot()`'s real lot instead. **A control that rebuilds its
world from the values it is testing is not a control.**

---

## [L37] A WebGPU canvas read outside a rAF callback is black, and the screenshot is what proves it

**What happened:** Task 3b's browser check read the canvas back with
`drawImage` + `getImageData` from a plain `page.evaluate`, and got
`0,0,0` across all 921,600 pixels - the exact reading [L14] records for a
renderer that never ran. The frame counters in the same probe said 1,114
rAF callbacks, 1,114 `draw` calls and 1,114 `submit` calls, and the
Playwright screenshot taken seconds later plainly showed eight blue
diamonds and an orange sim.

**Root cause:** a WebGPU canvas presents at the **end of the task**, so a
readback issued in an arbitrary task samples a surface with nothing in it.
Task 10's notes already said to await `queue.onSubmittedWorkDone()` and a
macrotask; what they did not say is that the failure is not a *dim* or
*partial* reading, it is the identical all-zero reading that means "the
renderer never ran". The two most different diagnoses in this project
produce the same 921,600 zeroes.

**Prevention rule:**

1. **Do the readback inside a `requestAnimationFrame` callback registered
   during a frame**, so it runs after the page's own callback has drawn.
2. **Never accept an all-zero canvas without a second, independent
   instrument.** A frame counter on a platform global and a screenshot are
   both cheap, and here they disagreed with the readback immediately. This
   is [L20]'s "when a measurement of a hot path returns zero, treat the
   instrument as the suspect" with a different instrument.
3. State the expected magnitude first. Eight 24x24 quads is 4,608 pixels
   and one sim is 576; "zero" is then recognisable as impossible rather
   than as a finding about the page.

**How to verify:** move the `drawImage` out of the rAF callback in the
Task 3b browser script and re-run against a page that is demonstrably
drawing. The colour tally collapses to a single `0,0,0` entry while the
submit counter keeps climbing.

## [L38] A borrowed asset pack's grid is not this project's grid, and the difference reads as a level-design problem

**What happened:** Task 3c scaled Kenney's isometric furniture by their
floor tile, which is the obvious reading: their `floorFull` renders 208 px
across and our tile diamond is 64 px, so the factor is 64/208. Everything
tiled, nothing overlapped, and the rendered lot looked wrong in a way that
had nothing obviously to do with scaling: an enormous empty floor with
doll's-house props scattered on it. The first instinct was that
`content/lot.toml` had authored too big a lot.

**Root cause:** **their tile is about 1.7 m and ours is roughly 1 m.**
`grid.rs` says so about ours; theirs has to be measured, and can be. An
isometric box of footprint w by d renders `(w + d) * halfTile` wide, so
their 0.4 x 0.7 m toilet at 66 px and their 1.0 x 2.0 m bunk bed at 172 px
both put their metre near 118 source pixels rather than 208. Scaling by
their tile therefore drew every object at 58% of its real size. Nothing in
the pipeline could notice: the atlas packed, the manifests agreed, every
test passed, and the only symptom was an aesthetic judgement about a room.

**Prevention rule:**

1. **Scale a borrowed pack by a shared physical unit, not by its grid.**
   Derive the unit from two objects of known real size and check they
   agree; one object cannot distinguish a scale error from an unusual
   model.
2. **Say what the unit is in the file that applies it.** `build-atlas.ps1`
   names 118 px as one metre and shows the arithmetic, so the next person
   changing the scale is changing a measured quantity rather than a magic
   number.
3. **A rendering bug can present as a content bug.** Before re-authoring
   content because the picture looks wrong, check that the picture is
   drawing the content at the right size.

**Also recorded here because it cost a second iteration:** scale both axes
of a borrowed isometric sprite or neither. Their wall panel is 1.8 of our
tile edges wide at the metre scale, so a run of them overlaps; narrowing
only the width to one tile edge looks like the fix and is worse, because
the panel's top and bottom edges are diagonals cut to the tile slope and
scaling x without y re-slopes them. The run then opens into a picket fence
with the floor showing through.

**How to verify:** set `$KENNEY_METRE_PX` in `assets/sprites/build-atlas.ps1`
to 208, regenerate, and look at the page. Every object shrinks to 58% while
the floor, which is generated at exactly 64 x 32, does not move at all.

---

## [L39] A PCG output hides a low-bit state difference for one extra draw

**What happened:** M1c Task 1's `a_resumed_rng_continues_the_same_sequence`
compares a `SimRng` restored from a save against a reference that was never
serialised. It was written with eight draws and a comment predicting that a
save which dropped the `inc` field would agree on the first draw and part
company from the second. Running that mutation - `#[serde(skip)]` on `inc` -
showed the first **two** draws agree, and the third is where it breaks:

```
resumed   [3398805763, 2211399277, 3474744281, 1141141794, ...]
reference [3398805763, 2211399277, 3248241063, 2122662297, ...]
```

The test caught the mutation, so nothing shipped wrong. What was wrong was the
stated reason, and the reason is what a later reader would use to decide how
many draws are enough.

**Root cause:** the output function is
`rotate_right((((old >> 18) ^ old) >> 27) as u32, old >> 59)`, which keeps only
bits 27 and up. After one step the two generators' states differ by exactly
`inc`, which is 2469 for seed 1234, so the difference lives entirely in the
bottom twelve bits of `old` and never reaches bit 27. It only becomes visible
once the `wrapping_mul` carries it upward, one step later.

**Prevention rule:** [L11] and testing-protocol rule 7 say to take N + 2
observations, where N comes from the relation under test. This is the case
where **N is larger than the mechanism suggests, because the function under
test discards part of its input.** Any transform that truncates, shifts,
rounds, quantises or hashes can swallow a real state difference for one or
more steps, so a divergence test sized by reasoning alone will be sized too
small.

Do not derive the sample count. **Apply the mutation, read the index where
divergence actually starts, and take comfortably more than that.** Then write
the measured index into the test, not the predicted one.

Note the shape this shares with [L34]: both are tests whose assertions are
correct and whose *inputs* cannot express the difference. There it was a
degenerate input domain; here it is a domain too short in time.

**How to verify:** put `#[serde(skip)]` on `SimRng::inc` in
`crates/terri-core/src/rng.rs` and run `cargo test -p terri-core --lib`. The
two printed vectors agree at indices 0 and 1 and differ from index 2, so a
one-draw or two-draw version of that test would pass the mutation.

---

## [L40] A threshold picked before the distribution was measured decides everything, and the suite has no opinion

**What happened:** M1c's alpha feel pass (Task 6) measured a 12 000-tick
behaviour trace of the shipped lot for the first time. **Two of the three
knobs it had to retune were wrong in the same way, and the whole test suite
was green throughout both.**

1. `choice_temperature` was 0.15, and `content/tuning.toml` justified it with
   a worked example: "two candidates 0.165 apart go to the better one about
   75% of the time". The arithmetic was correct and the 0.165 was a **guess**.
   Measured, the gap between the top two candidates in real play is 0.0045 at
   the 10th percentile, 0.032 at the median and 0.142 at the 90th - the guess
   sat *above the 90th percentile* of what the game produces. Softmax is
   exponential in the difference, so at the real gaps the sim was choosing
   almost uniformly: one recorded six-way decision spread from p 0.143 to
   p 0.191 across all six options. The mechanism was correct, the temperature
   was tuned against a distribution nobody had looked at, and the result was a
   sim that picked at random while every test asserting "weighted, not argmax"
   passed.
2. `min_interaction_ticks` was 25 because 2.5 real seconds sounded like the
   shortest visible action. Measured, that floor sat above the **entire**
   sampled band of the fridge (9 to 21 ticks), the toilet (7 to 17) and the
   sink (5 to 11), which are the three most-used objects. **31 of 51
   interactions ran for exactly 25 ticks with no variance at all**, so [D-4]
   was inert for 61% of them, and because the refill divides by the *content*
   duration each also delivered `floor / duration_ticks` times its advertised
   benefit - the fridge gave 67 hunger instead of 40.

**Root cause.** Both are the same shape and it is a new one for this file. The
recorded family ([L5] through [L36]) is about tests that cannot observe a
mechanism. Here every mechanism is observable and every test observes it
correctly. What nothing observes is the **distribution of the inputs the
mechanism runs on**, and a threshold's entire meaning is where it falls in that
distribution. A limit with all the real data on one side of it is not a limit;
it is the mechanism. `min_interaction_ticks` stopped being a floor and became
the duration, and no assertion about "the floor clamps short interactions" can
tell those two apart, because both are true.

Note the second one had a *documented rationale* attached, which made it worse
rather than better: [L24] recorded that prose justification and test coverage
are independent, and this is the same trick played on a number. A comment
explaining why 0.15 is right reads exactly like evidence that somebody checked.

**Prevention rule:**

1. **A threshold is a claim about a distribution. Before shipping one, measure
   the distribution and write the percentiles next to the value.** Not the
   range - the range is nearly always wide enough to look fine. The percentiles
   of the quantity the threshold is actually compared against.
2. **Ask which side of the threshold the real data lies on.** If it is all on
   one side, the threshold is not a bound, it is a constant, and everything
   downstream is a function of it rather than of the mechanism it guards.
3. **A worked example in a comment is not a measurement**, and one containing
   an invented input value is a guess wearing a measurement's clothes. Say
   where each number came from.
4. **Keep the guard that refuses to be decorative.** The one test that fired
   correctly here was
   `an_interaction_shorter_than_the_real_time_floor_is_stretched_up_to_it`,
   whose precondition asserts that the fixture's *longest possible* draw is
   still under the floor. Lowering the floor to 12 made that false and the test
   went red with "the clamp is not what decides this test" - which is the
   protocol's rule 4 doing its job on a tuning change rather than on a code
   change. Without it the test would have kept passing while quietly becoming a
   statement about something else.

**How to verify:** run `cargo run -p terri-sim --example trace -- 12000`.

**AMENDED, 2026-07-29.** This rule used to end "the trace harness is not in the
repo, deliberately - a stale committed instrument is worse than none", and the
branch that added `crates/terri-sim/examples/trace.rs` cited *this lesson* as
the reason for committing it. A review caught the contradiction: four comments
pointed at [L40] to justify the opposite of what [L40] said.

The original reasoning was wrong, and the way it was wrong is instructive. A
stale instrument is worse than none only if nobody notices it is stale - and an
instrument in the repo is exactly the thing a reviewer can re-run and catch. It
was re-run on this branch and it *did* disagree with four recorded figures,
which is how those got corrected. A harness that is deleted after every pass
cannot be re-run, so its numbers can never be falsified; that is the worse
failure, not the better one.

So: **keep the harness, and treat disagreement between it and a recorded number
as the number being stale.** Do not defend the number. Reproduce it by building
`Sim::new_from_shipped_lot()`, spawning the agent `web/src/main.ts` spawns, and
ticking 12 000 times while logging, per tick, the best score any candidate
offers. The measured percentiles are recorded in `content/tuning.toml` beside
each value and in `docs/alpha-feel-notes.md`; if a re-measurement disagrees with
them, the content changed and the knobs need re-deriving rather than defending.

---

## [L41] A guard shadowed by a second guard is only testable where the shadow is absent

**What happened:** M1b Task 4 added the autonomy override of [D-3]: a
player-issued intent suppresses `select_action`. Two mechanisms implement it
and they overlap almost completely.

1. `serve_intents` runs first and turns the front intent into a `Target`.
2. `select_action` skips any agent whose `IntentQueue` is non-empty.

`select_action`'s query already carries `Without<Target>`, so on almost every
tick mechanism 1 alone is sufficient and mechanism 2 decides nothing. The
milestone's headline test - `a_queued_intent_suppresses_autonomy`, the one the
task brief specified - passes with the emptiness filter **deleted**, because
the agent it checks has a `Target` by the time selection runs. Written as
specified, the task would have shipped an untested guard behind a test whose
name claims to cover it, which is exactly the failure family
`docs/testing-protocol.md` exists for.

The guard was verified only after asking, deliberately, *on what input is this
line the thing that decides?* The answer turned out to be a state the obvious
fixtures never reach: an agent whose intent names an object another agent has
reserved. It waits, so it has no `Target`, no `Eating` and an instruction it
still means to carry out - and with the filter gone it wanders off to something
else instead.
`a_sim_waiting_for_a_reserved_object_does_not_fall_back_to_autonomy` is that
fixture, and deleting the filter makes it red with the sim holding a target for
the wrong object.

**Root cause:** this is [L34]'s shape - a suite whose inputs all share a
property cannot detect a change that only shows on inputs lacking it - but the
property is invisible in a way [L34]'s was not. There, the shared property was
of the *fixture data* (all integers, all open grids), which a reader can see by
looking at the fixtures. Here it is a property of the *pipeline*: an earlier
system's effect masks a later system's guard, so the shared property is "the
earlier mechanism worked", which every fixture has because the code is correct.
**Defence in depth and untested code are indistinguishable from inside the
suite**, and the more thorough the earlier mechanism, the more completely the
later one is hidden.

**Prevention rule:**

1. When two mechanisms both enforce one rule, do not test the rule - test each
   mechanism. For each one, name the input on which it is **the only thing**
   standing between the code and the wrong answer. If no such input exists, the
   mechanism is dead code and should be deleted rather than tested.
2. That input is usually a *failure* of the other mechanism, not a variation of
   the happy path. Ask what happens when the earlier system cannot do its job:
   here, "the object is busy" was the only state that reached the later guard.
3. Write the answer into the comment beside the guard, naming the test. A
   reader who cannot see why a line matters is one refactor away from deleting
   it as redundant - and they would be right about every tick but one.

**How to verify:** delete the guard and run the whole workspace, not the test
whose name mentions it. If everything stays green, the guard is unprotected
regardless of how many tests appear to be about it.

---

## [L42] A "did the commands do anything" guard can be satisfied by the one command that changes no world state

**What happened:** M1b Task 5's replay test is the milestone's determinism
guarantee: a recorded command script must replay to the same world hash. The
equality on its own is [L5]'s shape - two runs in one process - so it was
surrounded by guards, one of which was meant to be the strong one:

```rust
assert_ne!(a, run_unscripted(TICKS), "the scripted run must differ ...");
```

`run_scripted` returns a tuple: the world hash **and** the selected entity's
index, because `world_hash` does not observe `Selected` and the selection had
to be asserted somewhere. That convenience quietly broke the guard. The script
holds three commands - `Select`, `UseObject`, `CancelIntents` - and only the
first has an effect that reaches the *tuple* without reaching the *hash*.

Measured during the task's hand-mutation pass: with the `UseObject` and
`CancelIntents` arms replaced by no-ops and only `Select` left working, the
tuples still differed and the assertion stayed green. The guard was answering
"did **any** command do anything" when the claim it exists to defend is "did
the commands change the **world**". Two thirds of the drain could have been
deleted with that line reporting success.

It was caught because the mutation pass ran a mutation nobody had predicted a
failure for - "only Select works" - rather than only the ones with a named
victim test, and then read *which assertion* fired rather than being satisfied
that the test went red. The per-command causal guards below it (drop the
`UseObject`, drop the `CancelIntents`, each must change the outcome) are what
actually caught it.

**Root cause:** the return value carried two things at different levels of
consequence - simulation state, and a projection of it that nothing in the
simulation reads - and a single `assert_ne!` over the pair cannot say which one
moved. A disjunction is the weakest assertion shape there is: it is satisfied by
its easiest term, and the easiest term here was the one with no causal power at
all.

**Prevention rule:**

1. **Never assert a difference over a tuple whose fields differ in
   consequence.** Assert on the field that carries the claim. If two fields both
   need asserting, that is two assertions.
2. When a test bundles a value into its result "because it had to be checked
   somewhere", check whether any *other* assertion in that test now ranges over
   the bundle. Adding a field to a return type silently weakens every
   inequality over it.
3. A mutation pass should include at least one mutation with **no predicted
   victim**. The ones with a named test confirm what you already believe; the
   unpredicted one is what finds the guard that was never load-bearing.

**How to verify:** disable every mechanism the test claims to cover except the
cheapest one, and confirm the test still fails. If it passes, the guard is
measuring the cheap mechanism.

---

## [L43] A full mutation sweep stopped early is not a partial answer, it is a clean-looking one

**What happened:** M1b Task 5 found, and killed, a guard whose second clause
nothing constrained: `intent.object == target.object && intent.interaction ==
target.interaction` in `drain_commands`. Its own report and the code comment it
left both noted, correctly, that **`tick_interactions` uses the same
comparison** for the same reason.

The twin was never swept. Task 5's full sweep was stopped at 204 of roughly 420
mutants after 45 minutes, and its report says so honestly - it records that
`advertise.rs` was past the stopping point and reasons about which baseline
entries the prefix could and could not have reached. `interact.rs` was further
past it still and is not mentioned at all.

M1b Task 6 ran the first sweep since to complete, and it reported:

```
crates/terri-sim/src/systems/interact.rs:139:52: replace && with || in tick_interactions
```

Six survivors, five of them the baseline's. The sixth had been sitting in
`main` for two tasks with a green CI gate over it the whole time, because
`missed.txt` from a stopped run contains only what was reached, and the gate
compares set difference against the baseline. **A survivor the sweep never
tested is indistinguishable, in that file, from one it cleared.**

The relaxed form is a real bug and the same one Task 5 fixed: `UseObject`
always names interaction 0 and an autonomously chosen interaction is 0 on every
single-interaction object, so a sim finishing the meal it chose for itself with
a click for a *different* object waiting behind it would have that click
silently discarded. The player's instruction disappears with no error.

**Root cause:** two failures compounding, and the second is the one worth
remembering.

1. A finding of the form "this exact comparison also appears over there" was
   written down and not acted on. It is the single cheapest lead a mutation
   sweep ever produces - the bug's location is already known - and it was left
   as prose.
2. **A stopped sweep's `missed.txt` was compared against a full baseline.** The
   comparison is only sound when the run covers at least what the baseline
   covers. Task 5 knew this and reasoned about it for the *entries in* the
   baseline; the case it could not reason about is the entry that is not in the
   baseline yet, because there is nothing to notice its absence against.

**Prevention rule:**

1. When a sweep or a review finds an unconstrained guard, **grep for the same
   comparison elsewhere in the same commit** and either kill or sweep every
   copy. A twin named in a comment is a to-do, not an observation.
2. A sweep that did not finish may **add** to the baseline argument and must
   never be treated as **clearing** anything. Record the stopping point as a
   list of files not reached, so the next task can sweep those first rather
   than re-deriving what was missed.
3. Prefer a **scoped sweep that finishes** over a full sweep that does not. The
   scoped run over every file a task touched is minutes, not an hour, and it
   answers the question the gate actually asks. Run both; believe the scoped
   one about your own changes and the full one about everything else.

**How to verify:** `cargo mutants --package terri-sim -f
crates/terri-sim/src/systems/interact.rs --test-workspace true --timeout 60`
reports 21 mutants, 21 caught, 0 missed. Before
`a_finished_interaction_pops_only_the_intent_that_named_the_object_it_finished`
it reported one missed, and that test fails on the `||` mutant and on deleting
`queue.pop()`, which is what stops it being a one-sided assertion.

---

## [L44] Scaling elapsed time and shrinking the step are the same arithmetic, so a step count cannot tell them apart

**What happened:** M1b Task 7 added the speed controls, whose one binding
constraint is [D2]: speed multiplies how many simulation steps run, and never
how long a step is. The test written for it asserted both halves - the step
count scales with speed, and `stepDurationMs` does not - and the hand-written
mutation for it was a driver that implements "2x" by halving `stepMs` instead
of doubling the accumulator.

It was killed, and **by the wrong assertion**. The failure was
`expected [10, 20, 29] to deeply equal [10, 20, 30]`: at 3x the mutated
driver's step is `100/3 = 33.333...`, which is not exact in binary64, so a
1,000 ms frame lost one tick to rounding. The count assertion caught a
floating-point artifact, not the violation.

**Root cause, and it is arithmetic rather than an oversight.** For an
accumulator driver, scaling the elapsed time by `k` and dividing the step by
`k` produce *identical* observable behaviour:

```
ticks   = floor(k*d / S)         = floor(d / (S/k))
alpha   = (k*d mod S) / S        = (d mod (S/k)) / (S/k)
```

Both the step count and the interpolation alpha agree at every elapsed time
and under every frame pacing. **The count half of the test is therefore
vacuous with respect to the thing it was written for**, and it only appeared
to work because 100/3 is inexact. Speed 2 - where 100/2 is exact - is the case
that shows it: a mutation confined to 2x produced the *identical* count
`[10, 20, 30]` and was caught only by `expected [100, 50, 100] to deeply equal
[100, 100, 100]`.

This is the [L11] family with a new denominator: two mechanisms that agree on
every sample the obvious instrument can take.

**Prevention rule:**

1. **A driver's step duration must be observable, or [D2] is unpinned.**
   `FixedStepDriver.stepDurationMs` exists for exactly this and for nothing
   else; it is the only assertion that separates the constraint from its
   violation.
2. When a mutation is killed, **check which assertion killed it**, not just
   that the test went red. A pass/fail is not evidence about which line is
   load-bearing, and here the two answers were different.
3. When designing the mutation, **pick the arithmetic where the two candidate
   mechanisms are exactly equal**, not where they merely should be. Inexact
   division hid the equality at 3x and revealed it at 2x.

**How to verify:** confine the dt-violation to speed 2 -
`stepMs = base / 2` when `multiplier === 2`, with the accumulator left
unscaled at that speed - and run
`npm test -- -t "multiplies the number of steps"`. The count assertion on
line 305 passes; the duration assertion on line 309 fails. Delete the
duration assertion and the mutation survives the whole suite.

---

## [L45] Chrome no longer carries CSS property accessors where a probe expects them, and the probe reads zero

**What happened:** Task 7's browser check counted panel writes by wrapping the
`width` setter on `CSSStyleDeclaration.prototype`. It reported **0 bar writes
over 3,743 frames** while the bars were visibly moving on screen and the
screenshot showed all seven of them.

`Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'width')` is
`undefined` in current Chrome, and so is the whole prototype chain above an
element's `style`: the individual CSS property attributes are not own
properties of that object. Nothing threw. The patch simply never installed,
and the counter it initialised stayed at its initial value, which is the
reading that means "the panel never wrote a bar".

**Root cause:** the same shape as [L20] half two and [L37] - an instrument
that cannot observe the phenomenon returns the number that means the
phenomenon did not happen. A patch that silently declines to install is worse
than one that throws, because the zero it leaves behind is a plausible
measurement.

**Prevention rule:**

1. **A monkey-patch must record that it installed**, and the probe must print
   that flag beside the count. `patchedOn: null` next to `widthWrites: 0` is a
   broken instrument; `patchedOn: "CSSStyleDeclaration"` next to
   `widthWrites: 0` is a finding about the page.
2. Prefer an observer over a patch where one exists. A `MutationObserver` with
   `attributeFilter: ['style']` sees what the page actually wrote and does not
   depend on where the engine chooses to define an accessor.
3. Best of all, count the thing at its **source**: the panel calls `needsOf`
   exactly once per read and nothing else on the page calls it, so wrapping
   that is a direct count of reads rather than a proxy for one. Measured that
   way: 97 reads in 10 s over 1,202 frames, one read per 12.4 frames, against
   a 100 ms tuned interval.

**How to verify:** in any current Chrome,
`Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'width')`
returns `undefined`, and walking `Object.getPrototypeOf(document.body.style)`
to the top finds no own `width` descriptor on any link of the chain.

---

## [L46] A harness that supplies its own clock measures nothing, and the frame counter still climbs

**What happened:** M1b Task 8's play session drove the frame loop through
`__terriStress.step()` in a tight loop, 250 times, and reported that every
click was ignored and the sim was frozen at one position. Both conclusions
were false. `step()` called `performance.now()` internally, so successive
calls passed deltas of roughly zero milliseconds, the fixed-step accumulator
never reached one step, and the simulation advanced almost no ticks. The
commands were sitting in the staging queue because nothing was draining it.

**Root cause:** the same family as [L14], with one crucial difference.
[L14] is "the frame callback never fires, so the counter reads zero and the
harness reports a flawless p95 over no data" - a *frozen* instrument, and
`timer.frames` was added specifically so a zero would be visible. Here the
counter climbed to 250. A moving counter reads as a working harness, so the
tell that saved [L14] was absent. The instrument was not stopped; it was
running on a clock that never advanced.

Worth naming precisely: `frame(nowMs)` derives elapsed time from the *gap*
between calls, so a harness that supplies the wall clock and a harness that
supplies nothing are the same thing when the harness is faster than the
wall clock. Real rAF works only because the browser spaces the calls.

**Prevention rule:**

1. **A behaviour harness must own the clock; a timing harness must not.**
   These are opposite requirements and one function cannot default to both.
   `step(nowMs?)` now takes an optional timestamp: omit it to measure what a
   frame costs, pass a monotonic sequence to make the simulation actually
   run.
2. **Never accept a frame count as evidence that a simulation advanced.**
   They are different quantities and this is the case that separates them.
   Assert on something the simulation owns - the tick count, the clock
   resource, or a need level that must have decayed.
3. A harness's first assertion should be that its subject *moved*. This
   session's first run would have failed instantly on "the sim's position
   after N steps differs from its position before".

**How to verify:** call `step()` in a loop with no delay and read a need
level before and after. With the clock defaulted it barely changes; with a
monotonic `nowMs` at 16.67 ms per step it decays at the tuned rate.

---

## [L47] A mapping that is the identity by coincidence is a bug with a scheduled arrival date

**What happened:** picking a clicked entity means finding the render-buffer
row standing on a tile and then naming that entity in a `Select` or
`UseObject` command. The buffer is sorted by entity index and carried no id
column, so the row number was the only thing available - and it is correct,
exactly, for as long as live entity indices run `0..count` with no gaps.
Nothing in the shipped game despawns, so that held on every world a player
could produce. It would have gone in green.

**Root cause:** the coincidence is load-bearing and invisible. Row number and
entity index are both `u32`, both are indices, and they are equal in every
test anyone would naturally write - so no type error, no failing assertion,
and no wrong behaviour until the first despawn leaves a hole. After that,
every click past the hole selects or directs *a different live entity*, which
is the worst available failure: not a crash, not a no-op, but a plausible
wrong answer.

M1d adds death. The expiry date was already on the calendar.

**Prevention rule:**

1. **When two identifier spaces coincide, export the mapping rather than
   relying on the coincidence.** `RenderBuffer::ids` costs one `u32` per
   entity and removes the whole class.
2. **A fixture for a mapping must break the coincidence**, or it cannot see
   the identity mutation. `a_row_is_not_its_entity_index_once_an_index_is_freed`
   despawns the *second* of four entities on purpose: despawning the last
   would leave rows 0..2 still equal to indices 0..2, and the test would pass
   against `push(row_number)`. It asserts `ids != [0, 1, 2]` first, as a
   precondition, so it cannot go quietly green if entity-index reuse ever
   closes the hole. This is [L34] applied before the fact rather than after.
3. Ask of any index crossing a boundary: **whose numbering is this, and what
   makes it survive the other side's edits?**

**How to verify:** replace `ids[row]` with `row` in `pickAt` and the web
suite fails; replace `push(*index)` with a row counter in
`sync_render_buffer` and the Rust test fails.

---

## [L48] Two different states that render identically will be conflated by the measurement as readily as by the player

**What happened:** measuring how fast a click retargets a *busy* sim needed a
way to tell a busy sim from a free one. Position is all the render buffer
exports, and a sim using an object stands on that object's tile - so "busy"
was classified as "standing on an object's tile". The resulting latencies ran
2, 4, 4, 5, 14, 16, 43 and 124 ticks, up to 12.4 real seconds, and supported
a confident and completely wrong conclusion: that clicks on a working sim are
ignored for a very long time.

The sim in those cases was **idle**, standing on a tile it had finished with.
Re-measured against a need actually *rising* - the only externally visible
sign of an interaction - interrupting a genuinely busy sim takes 1 to 18
ticks, and a Rust test now pins that a click preempts on the tick it arrives.

**Root cause:** the two states are one picture. Nothing in the exported state
distinguishes "using the sofa" from "standing on the sofa having finished",
so any classifier built from exported state must conflate them. The error was
not the arithmetic; it was believing an observable existed.

**Prevention rule:**

1. **Before measuring a state, name the observable that distinguishes it from
   its neighbours** - and if there isn't one, that absence is the finding.
   Here it is a real finding: a player cannot tell either, and multi-step
   interactions turn "which step is this sim on" into something the player
   must be able to read.
2. **Prefer a simulation-side test to an outside-in measurement for a
   simulation question.** The preemption question took hours from the outside
   and produced the wrong answer; from inside it is one deterministic test
   with three assertions and no timing at all.
3. Treat a wide spread in a latency measurement as a **classifier** problem
   before treating it as a *subject* problem. A 60x range (2 to 124) across
   supposedly identical conditions means the conditions were not identical.

**How to verify:** `a_click_preempts_an_interaction_already_running` in
`crates/terri-sim/src/systems/command.rs` asserts the retarget, the dropped
`Eating` and the released `Reserved` on the tick the command arrives. Its
`tick_until_interacting` helper is the distinction the outside-in pass
lacked.

## [L49] A need nothing advertises is invisible to the suite for the same reason it is inert

**What happened:** `content/needs.toml` declared `social`, `content/tuning.toml`
gave it a decay rate of 0.035 a tick, and no interaction in
`content/objects.toml` advertised it. It drained to zero at about tick 2 857 -
4.8 minutes at 1x - and stayed pinned there for the rest of every session. It
had done so since the need was declared. 188 tests were green.

**Root cause: the two facts are one fact.** Selection scores an agent's deficit
against what objects advertise, so a need no object advertises contributes
nothing to any score. Having no behavioural effect is exactly what makes it
untestable by any behavioural test - there is no observable difference between
"declared and unsatisfiable" and "not declared", from inside the simulation.
Every test in the suite asks a question about behaviour, so none of them could
have a reason to notice. This is not a coverage gap that more behavioural tests
would close; more of them would all be equally blind.

The general shape: **content that exists and does nothing is invisible to any
test that observes what the game does.** `every_declared_object_is_placed_on_the_lot`
already existed for the same class one layer out - an object nothing places
cannot be chosen - which is the precedent that made the fix obvious once the
class was named.

It was found by a human watching the game for twenty minutes and writing down
what it did, recorded as [C2] in `docs/alpha-feel-notes.md`. That instrument
found three things the suite structurally could not.

**Prevention rule:**

1. **Check declarations against uses, statically, over the compiled pack.** Not
   over behaviour - a static check is the only kind that can see content whose
   defining property is having no behaviour.
   `every_declared_need_can_be_satisfied_by_some_interaction` in
   `crates/terri-data/src/lib.rs` is the instance.
2. **Require the delta to be POSITIVE, not merely present.** A delta may legally
   be negative - the shower's `energy = -12.0` is a cost that scoring weighs - so
   "the need appears in some advert list" is satisfied by a need that can only
   ever be *drained*, which is exactly as unfillable. Energy is separately
   advertised `+100` by the bed, so the weaker rule passes today and would go on
   passing through the content edit that broke it.
3. **When a declaration/use check is added, say in the failure message what both
   ways out are.** This one names the need and offers "advertise it" or "stop
   declaring it", because those were the two coherent fixes and whoever trips it
   next inherits the same choice rather than a bare assertion.

**A second finding, about the tuning rather than the gap.** The delta was first
set to 14 by arithmetic - solve `delta * deficit^3 / time_cost` against the
measured median score - and the measurement said the estimate was in the right
band but the *direction of the knob* was backwards. **A smaller social delta
makes the television MORE dominant, not less:** 8 gave it 30.1% of all
interactions, 14 gave 21.1%, 24 gave 14.4%. Because urgency is cubed, halving
the delta buys back only a cube root of deficit, so the sim holds the need lower
*and* visits more often, since each visit delivers less. Anyone reasoning "keep
the placeholder small so it does not distort behaviour" would have tuned it in
precisely the wrong direction, and no test would have said so. See [L40], which
is the same lesson about a different knob.

**How to verify:** set the television's `watch_tv` advert back to
`{ fun = 30.0 }` and run `cargo test -p terri-data every_declared_need`; it
fails naming `social`. Set it to `{ social = -24.0, fun = 30.0 }` - present in
the advert list, so the weaker "appears at all" rule would pass - and it fails
identically, which is what pins rule 2 above. Restore by inverting the exact
edit and confirm `git hash-object content/objects.toml` matches the value from
before the mutation ([L9]), then touch the file ([L8]).

The trace harness behind the delta table is not in the repo, per [L40]:
rebuild it as `Sim::new_from_shipped_lot()` plus the agent `web/src/main.ts`
spawns, 12 000 ticks. It reproduces [O1]'s 121 interactions exactly on the
no-advert content, which is what makes the four rows comparable.

## [L50] A hanging test suppresses every assertion that already failed in the same run

**What happened:** three `rng.rs` mutants - `next_u32 -> 0`, `next_u32 -> 1` and
`replace >= with < in SimRng::range` - reported TIMEOUT in every sweep from M1c
Task 1 to M1b Task 7, about seven runs. They cost 180s of the mutation job each
time and were invisible to the gate, which compares `missed.txt` while a
timeout lands in `timeout.txt`. `docs/mutation-baseline.md` recorded them
correctly as detections, and concluded: *"An unbounded rejection loop is
inherent to debiased sampling and is not worth capping."*

**That conclusion rested on a misreading of the outcome column.** Measured
properly - each mutant applied alone, each test run alone under an 8s deadline -
**all three fail real assertions.** `next_u32 -> 0` fails 14 tests,
`next_u32 -> 1` fails 15, and the comparison flip fails 2, among them
`a_golden_sequence_pins_the_algorithm` and
`range_is_uniform_at_a_bound_that_divides_badly_into_2_32`. Every one of the
three was already killed by an assertion.

**Root cause: the outcome column describes the worst-behaved test in the run,
not the strength of the detection.** `cargo test` does not exit until every
test finishes, so one test spinning inside `SimRng::range`'s unbounded
rejection loop means the process never reports the failures that had already
happened. The hanging tests and the detecting tests were **different tests**.
TIMEOUT therefore said "something in this run hangs", and was read as "this
mutant is only detected by a hang", which is a different and much weaker claim.

The inconsistency this created is worth seeing. `roll_wander_path`, one crate
away, bounds its re-roll loop and its doc comment says the bound *"is what
stops that becoming a hang"*, citing [L15]. The identical argument had already
been accepted for the identical shape of bug; it did not transfer, because a
rejection loop and a re-roll loop do not look alike.

Once the assertions were known to exist, the cap was free. A rejection needs a
draw below `2^32 % bound`, which is under `2^31` for every bound, so one
rejection is always less likely than a coin flip and 128 in a row is under
2^-128. It cannot fire on a working generator and it changes no draw, so no
golden hash and no replay moved.

**Prevention rules:**

1. **A TIMEOUT is a statement about the run, not about the mutant. Find the
   hanging test before concluding anything.** Run each test alone under a
   deadline; expect the hang and the detection to be in different tests.
2. **Bound every loop in production code, and panic on overrun** - however
   unreachable the bound is, and with the arithmetic for "unreachable" written
   next to it. `debug_assert!` will not do: `wasm-pack` builds release, so per
   [L12] the shipped target would keep the hang while `cargo mutants`, which
   builds debug, reported it fixed.
3. **Make the guard reachable by a test.** The cap can only fire on a broken
   generator, so `range`'s loop was extracted as `draw_below_bound(bound,
   draw)` taking its draws from a closure. A test hands it `|| 0`; without
   that seam the cap would be an untested guard, indistinguishable from no
   guard.
4. **Gate on `timeout.txt` as well as `missed.txt`.** Zero tolerance, not a
   second baseline: the fix for a hang is a bound, and an allowance that can
   grow invites raising `--timeout` instead.

**How to verify:** apply any of the three mutations to
`crates/terri-core/src/rng.rs` and run `cargo test -p terri-core --lib`. Before
the cap it never terminates; after it, `draw_below_bound` panics and the run
reports failures. Do it under the [L15] harness rules - output to a file,
`taskkill /F /T` the tree, restore in a `finally` - and confirm
`git hash-object crates/terri-core/src/rng.rs` matches the pre-mutation value.

---

## [L51] A detector needs a must-be-negative case and a must-be-positive case, asserted in the same run

**What happened:** three instruments built to verify the alpha's rendering and
behaviour were wrong before they were right, and each was wrong in a way that
produced a confident answer.

1. A pixel test for "is anything drawn here" classified emptiness as
   `alpha < 128`. The WebGPU render target is **opaque**, so alpha is 255 on
   every pixel of the canvas. It reported zero gaps in the floor and zero gaps
   in the walls, and both were vacuous. The tell was a fourth number printed
   beside them - `paintedCoveragePct: 100` - which cannot be true of a
   704 x 462 lot on a 1280 x 720 canvas.
2. A text render of the frame, built to inspect the layout cheaply, showed
   apparent **gaps in the wall runs** - exactly the defect the pass had just
   claimed to fix. Artifacts: it sampled one pixel in ten across and one in
   fifteen down, and binned antialiased edge pixels as background. A dense
   per-column scan found 0 gaps in 864 columns.
3. A behaviour-trace harness classified every tick of every meal as a wander
   pause, because it tested for the `Wander` marker before the `Eating` one. It
   reported 52.3% of a run paused against 0.2% interacting, for 124 interactions
   averaging 30 ticks - two numbers that cannot both be true.

**Root cause:** each detector had only one kind of case. Nothing in the run
established that it could say "no" when the answer was no, or "yes" when the
answer was yes - so its output was unfalsifiable, and a vacuous pass looked
identical to a real one.

**Prevention rule:** a detector must assert, in the same run that uses it, both
that it reports **negative on a case that must be negative** and **positive on a
case that must be positive**. The column scan that finally settled the wall
question does this structurally: it prints the empty-column count next to the
notch count, and a broken classifier moves both to absurd values at once. The
colour-based pixel test asserts the canvas corners read as background and the lot
centre does not, before it reports anything.

This is [L3], [L7] and [L34]'s family, but the rule is sharper than "test your
tests": it names the two specific cases to include. Where a detector's output is
a count, print a second count that must move the other way.

**How to verify:** invert the classifier - swap background for foreground - and
confirm the sanity assertions fail rather than the counts merely changing.

---

## [L52] A hand-mutation harness must be calibrated on a mutation that is known to be caught

**What happened:** this task's hand-mutation pass over the web shell - five
mutations of the new `interaction` argument, each applied, tested and reverted by
a script - reported **"NOTHING FAILED" for all five**. Taken at face value that
would have meant the entire TypeScript side of the change was untested, and the
honest response would have been to write five more tests.

All five were in fact caught. The script scraped vitest's output for lines
beginning with `Ãƒâ€”`, which the reporter in use does not emit; the failure lines
are `FAIL  tests/<file> > <suite> > <name>`. Applying one mutation by hand and
reading the raw output took under a minute and showed the named test failing with
the expected diff.

A second, quieter instance in the same script: it captured output as text with
the platform's default `cp1252` codec, vitest writes UTF-8 box-drawing
characters, and the resulting `UnicodeDecodeError` killed the runner thread
**after the mutation had been written and before it was reverted**. The
mutation sat in `web/src/input.ts` until the next `grep`.

**Root cause:** the harness had no positive control. Its "no test failed" branch
and its "the parser matched nothing" branch produce the same output, which is
[L51]'s missing must-be-positive case applied to a tool rather than to a
detector - and it is worse here, because the failure direction is *reassuring*.
A parser that silently matches nothing reports every mutation as undetected,
which reads as "write more tests" rather than as "fix the harness". The
unreverted mutation is the ordinary version of the same thing: the revert was in
the happy path instead of a `finally`.

**Prevention rule:** any script that decides whether a mutation was caught must
**first run a mutation whose answer is known**, and abort if the answer comes
back wrong. Calibrating on a known-caught mutation is one extra iteration and it
converts a silent parser into a loud one. Two corollaries:

- Put the revert in a `finally`, and hash the file before and after so
  "restored byte-identical" is printed rather than assumed. Testing-protocol
  rule 1 asks for that assertion; it also has to survive the runner crashing.
- Decode subprocess output as UTF-8 explicitly on Windows. `capture_output=True,
  text=True` uses the ANSI code page, and every modern test runner emits box
  drawing.

**How to verify:** point the harness at a mutation that a named test definitely
catches - here, hardcoding `interaction: 0` back into `drain_commands` - and
confirm it reports that test by name. If it reports nothing, the harness is
broken, not the suite.

---

## [L53] A rule that is correct for every case the fixture can express is not a correct rule

`tiles.ts` decided which of two wall sprites a tile draws:

```ts
return isWall(x, y - 1) || isWall(x, y + 1) ? 'wallNS' : 'wallEW';
```

One panel per tile, ties resolved towards north-south. It had a paragraph of
comment justifying the tie-break, three tests, and it was **wrong**, and neither
the comment nor the tests could tell.

The lot it was written against had two wall runs meeting at a single L corner.
At an L corner the tile has a neighbour on one side of each axis, so either
panel closes the join and both possible rules produce an identical picture. The
fixture was an L. The tests asserted the corner's sprite with
`expect(...).toContain(ns)`, which the correct rule also satisfies.

Then the lot became five rooms. Its spine runs east-west across the lot with
three north-south dividers hanging off it, and a T-junction tile has neighbours
on BOTH sides of one axis. All three took the north-south panel, so the spine had
three panels turned ninety degrees in the middle of it and read as a wall with
holes punched through it - at exactly the three places a viewer looks first.

**What caught it was a screenshot.** Not a test, not a review, not the type
system: a PNG of the running game, looked at. The full gate was green before and
after.

### The fix was also wrong, and that is the more useful half

The obvious repair was to draw BOTH panels at a junction tile, reasoning that a
32 px panel on a 64 px tile diamond leaves room for two - one on the tile's east
half, one on its west, abutting rather than overlapping. Tests were written, the
gate went green, a new screenshot was taken, and it **looked** fixed.

It was not. `sprites.wgsl` centres every quad on its anchor, so two panels
written at the same tile occupy the same 32 px rather than two halves. Measured
off the atlas: only 356 of the second panel's 2540 opaque pixels - 14% - fall
where the first is transparent. A pixel diff of the before and after frames
matched that exactly: 726 pixels changed in the whole 1280 x 720 frame, every one
inside the three junction boxes, and the most exposed box changed by precisely
356. So 86% of the "fix" was hidden behind the panel it was meant to replace, and
the junction still read as the wrong orientation.

What ships is a third rule: at a junction, the run that PASSES THROUGH wins - a
T has neighbours on both sides of one axis and one side of the other, and that
asymmetry is the answer. One panel per tile, which also avoids [V12]'s depth
conflict, since two quads at one tile share a depth and `depthCompare` is
`less`.

### What to take from it

1. **"Correct on every input the fixture can express" is the trap, and it is not
   the same as [L34].** [L34] is about a fixture whose values coincide, so a
   transposition is invisible. This is about a fixture whose SHAPE excludes the
   case - an L-shaped wall run cannot contain a T-junction, however its
   coordinates are chosen. Ask what shapes the fixture cannot be, not only what
   values it happens to hold.
2. **`toContain` cannot see a missing element.** The original bug was an absent
   panel, and "the answer includes X" is satisfied by the too-small answer as
   well. Reach for an exact list whenever the defect you fear is omission.
3. **A comment that argues for a tie-break is a signal that the tie is real.**
   The old comment said a corner "qualifies both ways" and then explained which
   way it was given. That sentence contained the whole bug.
4. **A screenshot is not a measurement, and it will confirm what you expect.**
   The second wrong version was signed off on an after-shot that looked better.
   The pixel diff took two minutes and was decisive. When the claim is "this
   changed what is drawn", diff the pixels and predict the number first - the
   356 matching on both sides is what turned a hunch into a finding.

**How to verify:** the fixture set is now an L, a T, a **transposed** T - because
the T alone cannot see "always prefer east-west at a junction", where the
through-run already is east-west - and a free-standing tile. See [B5] in
`docs/specs/2026-07-30-the-house-design.md`.

---

## [L54] Halving a delta and halving a rate are different operations

The house gained five comfort objects and all five went unused, because comfort
never dropped low enough for `deficit^3` to make them worth anything. Two of the
three fixes were right. The third was to **halve the five new comfort deltas**,
on the reasoning that a smaller top-up means a sim has to sit down more often, so
comfort settles at a lower level where the seats are worth choosing.

That reasoning is sound and the change was still wrong, because it ignored what
the five objects were being compared *against*. Score is

```
delta * deficit^3 / (distance / TILES_PER_TICK + duration + 1)
```

so what decides between two seats at similar distance is `delta / duration` - a
rate. The five new seats had durations from 41 to 78 ticks; the pre-existing
ottoman sofa is 34 comfort in 50 ticks, a rate of 0.667. Halving put the two
biggest new seats at about 0.37, which is not "less generous", it is **strictly
dominated**. Over 120 000 ticks the ottoman took 72 uses and those two took
zero.

So the first pass had comfort objects that were never wanted, and the second had
comfort objects that were wanted and never best. The fix was to raise the two
deltas until their RATES matched the field - 37 in 62 ticks and 43 in 72, both
0.597 against the ottoman's 0.667 and the armchair's 0.707 - which left the
supply where pass two had put it while spreading the demand.

**The rule:** when tuning a value that appears in a numerator over a duration,
tune the quotient. Halving a numerator is only a halving if every alternative
was halved too, and the alternatives here included an object that predated the
change by two milestones.

**How to verify:** compute `delta / duration` for every object advertising the
need before and after any delta edit, and check the ordering has not inverted.
The trace's candidate table prints per-need contributions at a fixed moment,
which is the same information from the other end.

---

## [L55] Arithmetic that cannot be called cannot be pinned with a golden value

`select_action` carried the habituation multiplier inline:

```rust
let benefit_scale = 1.0 - hab * (1.0 - content.0.tuning.habituation_floor);
let delta = if *delta > 0.0 { delta * benefit_scale } else { *delta };
```

Two lines, eight mutants, **seven of them surviving the entire workspace
suite** - confirmed by hand-mutation, not just by the sweep. This is the
mechanic that makes sims rotate between objects instead of repeating one, and
nothing constrained its arithmetic at all.

Three separate reasons nothing caught it, and each is worth recognising on
sight.

**1. The test that names the behaviour computes it itself.**
`habituation_scales_the_benefit_and_leaves_a_cost_at_full_strength` exists for
exactly this rule. It never calls `select_action`. It computes
`BENEFIT * scale` in the test body and compares that against other values it
also computed, so it is green with the production guard deleted. Rule 3 and
[L5]'s family, in a test whose name is a promise it does not keep.

**2. The end-to-end check has one candidate.** The world-hash golden vector's
scenario holds a single object, so a wrongly scaled score has nothing to
out-rank, the sim's choice is identical at any multiplier, and the digest does
not move. [L36] already recorded that this scenario cannot see how candidates
are ORDERED; it cannot see how they are WEIGHTED either.

**3. A behavioural test would not have been enough.** The obvious repair -
"habituate the sim on A, assert it picks B" - passes for three of the four
`benefit_scale` mutants, because they all still produce a multiplier below 1
for a partly habituated sim. Only magnitudes separate them: at full
habituation the four give 1.55, -0.818, -0.45 and -1.22 against the correct
0.45. Two of those are negative, which turns a benefit into a repellent.

### The rule

**A multiplier needs a golden value, and a golden value needs a callable
function.** Arithmetic inlined into a system whose only observable output is a
discrete choice can be bounded in sign and nothing more, because a choice
throws away the magnitude that produced it.

So: when a formula is the mechanic rather than a step in one, give it a name
and a signature. `benefit_scale(habituation, floor)` and
`scaled_delta(delta, scale)` are three lines of code between them, and pinning
them takes six assertions at the ends of the range and the midpoint.

The smell to watch for is a test whose body performs the operation it is
testing. If the fixture computes `expected` using the same arithmetic the
production code uses, the test is a statement about arithmetic in general
rather than about this program.

**How to verify:** hand-mutate the extracted function and confirm a NAMED test
fails. Calibrate the harness first on a mutation known to be caught ([L52]) -
and beware that `cargo test` prints `error: test failed` to **stderr**, so a
harness that scans stderr for "error:" before reading the failing-test names
reports every real kill as a compile error. That happened on the first run of
this very check.

## [L56] Two sessions fixed the same finding independently, and neither could have known

**What happened:** [C3] of `docs/alpha-feel-notes.md` - an agent beaten to an
object being told nothing was worth doing - was fixed **twice**, in parallel, by
two sessions working in two git worktrees off the same branch. Neither fix was
pushed while the other was being written. The two arrived at structurally the
same core change, down to the same variable, the same guard placement, and the
same three test cases including the empty-room control.

The duplication cost a full implementation. What made it recoverable is that the
two differed in what they added around the core fix, so one could be reduced to
the difference rather than thrown away: this branch keeps only the knob deciding
how much a contested object is worth and the marker recording that an agent's
best option is somebody else's, both of which the other fix lacks.

**Root cause:** parallel worktrees make it cheap to run several sessions at once,
and there is no cheap way for one to see what another has committed but not
pushed. A worktree's branch is invisible to `git branch -r`, absent from the PR
list, and reachable only by reading another checkout's local refs - which
nothing prompts anyone to do. **The findings list itself was the collision
point:** a numbered list of known defects is exactly the artifact two sessions
will independently pick the most interesting item from.

**Prevention rule:**

1. **Before implementing a numbered finding from a shared list, check every
   worktree's local branch, not just the remote.** `git worktree list` then
   `git log --oneline <remote>..<each local branch>` is two commands and it is
   the whole check. A branch that exists only in another checkout still contains
   the work.
2. **Push early on a branch nobody else can see.** An unpushed commit is
   invisible to every collision check anybody else could reasonably run,
   including the one above if they check the remote instead of the worktree.
3. **When duplication is found, diff the two before choosing.** The instinct is
   to keep the one that landed first and discard the other whole. The useful
   question is what each has that the other does not: here one had a tuning knob
   and a marker, the other had unrelated duration work in the same commit, and
   the answer was to keep the first fix and port only the difference.
4. This is a process failure rather than a code one, and it does not have a test.
   That is why it is written down.

**How to verify:** `git worktree list` shows every checkout. For each, compare
its branch against the remote it tracks. Any commit that appears there and not
on the remote is work no PR and no remote-branch listing will show you.

**A second, smaller observation from the same collision.** The two independent
implementations chose different names for the same concept - one called a taken
object "busy", the other "contested" - and the merged result had to pick one.
Naming is where parallel work diverges first and most visibly, and it is the
cheapest thing to standardise in advance if a findings list is going to be split
across sessions.

## [L57] A hand-mutation restored with `mv` reports the mutant's verdict against the original's source

**What happened.** Verifying two M2d guards by hand-deletion (they are
query filters and statement blocks, outside cargo-mutants' grammar): the
deletion failed the named test as hoped, the file was restored with
`mv file.bak file`, and the next `cargo test` run FAILED the same test
again - against source code that was demonstrably correct, confirmed by
a probe example that showed the mechanism working perfectly. Fifteen
minutes went to debugging phantom breakage in correct code.

**Root cause.** `mv` preserves the backup's modification time, which
predates the mutated build. Cargo's freshness check therefore considered
the mutated binary current and reran IT, while every tool reading the
file - grep, diff, the editor - showed the restored, correct source. The
test output and the source code were describing two different programs.

**Prevention rule.** After restoring a hand-mutated file, force the
rebuild: `touch` the file, or restore by writing content rather than by
renaming. Treat a hand-verification's second run as valid only if the
test output shows the crate actually recompiled. The same trap arms
itself in reverse: a hand-mutation applied with a backdated mtime would
"pass" without the mutant ever being built, making the whole
verification vacuous.

**How to verify.** Both orders of the M2d verification were rerun with a
`touch` between: delete guard, test fails; restore plus touch, test
passes, with a visible `Compiling terri-sim` line in each run.

## [L58] Humour shipped without the owner's eyes is a bug report waiting in a flyout

**What happened.** Every interaction label was written as a deadpan
joke in the game's intended register - "Take the good chair", "Shower
at length", "Soak until reconsidered" - and shipped through several
milestones unreviewed, because labels rode along with balance work.
The first time the owner actually played over the network, the labels
were the first thing he hit: one was ambiguous enough to misread
("TAKE the good chair"), others were "cringy and awkward", and the
direction was blunt - stop trying to be clever in interaction names.
All nineteen labels were rewritten to plain verb phrases the same day.

**Root cause.** Two errors compounding. First, jokes were placed where
they had the least room to work: a menu row is read in half a second
and the game renders no object descriptions, so a joke premised on
"there is exactly one good chair" had no way to establish itself.
Second and larger: tone is art direction, and art direction is one of
the five things the rules of engagement explicitly reserve to the
owner - shipping humour without his eyes on it was a scope violation
that happened to be spelled like content.

**Prevention rule.** Player-visible STRINGS are two categories with
different rules. Functional text (labels, buttons, errors) is plain
and says exactly what happens - the startup-failure card got this
right on the same day the labels got it wrong. Voice text (goal item
11's dark comedy) is drafted, shown to the owner, and only shipped
approved. Nothing in the second category ships as a side effect of a
milestone about mechanics.

**How to verify.** content/objects.toml's header carries the rule;
every current label is a plain verb phrase; the memory file
interaction-labels-stay-plain.md carries the standing direction.


## [L59] An undisplayed browser pane fires no animation frames, and headless WebGPU dies on reload

**What happened.** The M2e PR 3 played watch tried to run in the app's
browser pane while nobody had it displayed. The page loaded, the tools
answered, and the game silently never ticked: the pane only composites
when shown, an uncomposited page gets no requestAnimationFrame, and
the whole driver hangs off rAF. Twenty minutes went to "why is the sim
frozen" before the screenshot error's own text - "the Browser pane is
not displayed, so the page is not compositing frames" - was taken at
face value. The fallback, Playwright's headless Chromium, rendered and
ran perfectly ONCE; every subsequent reload in the same browser
process hit the no-WebGPU startup card, because the first page's GPU
device is never released and headless Chromium will not hand out a
second adapter. A separate self-inflicted confusion stacked on top:
under ?debug=1 the stats overlay starts VISIBLE, so the reflexive
backtick press HID it, and its frozen textContent then read as a
frozen simulation while the pixels were moving fine.

**Root cause.** Three tools with three quiet failure modes - pane
needs display, headless WebGPU is one-shot per process, the overlay
toggle is stateful - and all three fail as SILENCE rather than error.

**Prevention rule.** For an autonomous browser watch: use Playwright,
treat the browser process as single-use (one navigation per watch; if
a reload is needed, expect the WebGPU card and get a fresh process),
and read the startup-failure card FIRST on any frozen-looking page -
the game says out loud when it has no GPU. Never diagnose through the
?debug=1 overlay without first confirming it is updating (two reads a
second apart must differ while unpaused). What pixels cannot show,
pin with a boundary test through the release wasm instead - the
shipped-day career test is the pattern.

**How to verify.** [A-14]'s watched-session paragraph records the
episode; web/tests/bridge.test.ts runs the shipped day through the
release artifact.

## [L60] Names shipped that only their author understood, and nothing defined them

**What happened.** The owner played two sessions and both times the
report was about WORDS rather than behaviour. The debug overlay called
a sim's traits `wears:` ("wtf is wears? that's a terrible name for it
unless it's referring to a t-shirt"), and printed personality
multipliers as two rows of seven `1.00`s labelled `drain:` and
`satisfaction:` - which he read, correctly, as broken statistics,
because a column of neutral values labelled like a reading looks like a
reading that failed. The replacement line naming why a sim was stuck
then shipped as `standing:`, which he caught in the same breath:
"can't you see how that would be confusing?" It was also carrying a
pending-order count, which is not a stall reason at all.

Then the real question: was any of this written down anywhere? It was
not. The project had 59 lessons and 13 design specs recording every
decision in obsessive detail - and no glossary. To learn what a drain
multiplier was, a reader had to find [S4] inside a spec named after a
July date. The documentation was organised for its author, keyed by
IDs, which is the same failure as the labels, one level up.

**Root cause.** Naming was treated as a side effect of implementing,
so labels came out as whatever the implementation called the thing
internally, and the definition lived in the head of whoever wrote it.
Nothing in the process ever asked "would this word mean anything to
somebody who did not write it?"

**Prevention rule.** `docs/glossary.md` now exists and carries the
naming rules as its last section: a label names the thing rather than
the implementation's mood; one label means one thing (if it needs "and
also", it is two lines); a number's label says what the number DOES
(`drains: fun x1.30`); show deviations, never rows of defaults; and
**every player-visible or developer-visible word gets a glossary
entry** - if it is not in there, either name it better or document it,
those being the only two options. Functional text stays plain; the
comedy lives in object names and the authored voice pass ([L58]).

**How to verify.** `docs/glossary.md` defines every term the overlay
prints; the overlay's own test asserts the current labels
(`traits:`, `drains:`, `refills:`, `stalled:`, `orders waiting:`); and
README.md points at the glossary first, so the next reader lands on
definitions rather than on decisions.

## [L61] A sweep is per code change, not per pull request

**What happened.** Three CI failures in one afternoon, all the same
shape: a change made AFTER the branch's local mutation sweep went out
untested, and the sharded sweep in CI found the survivors instead of
me. First the M2f overlay accessors, then `stall_reason_of` and
`queued_orders_of` (added mid-conversation for the owner), then the
busy check that fixed the stale stall reason - each one a small,
obviously-correct edit made in response to live feedback, each one
pushed within minutes of being written.

**Root cause.** The sweep was being treated as a PR-shaped ritual -
"sweep before opening the PR" - rather than as a gate on code. Every
one of these changes landed after that moment, and none of them felt
big enough to re-run a three-minute sweep for. The pattern is
strongest exactly when feedback is arriving quickly, which is also
when the pressure to push fast is highest.

**Prevention rule.** Re-run the targeted sweep before EVERY push that
changes Rust, not once per branch: `git diff origin/main HEAD --
crates/ > patch` then `cargo mutants ... --in-diff patch`. It costs
two to three minutes against a CI round trip of fifteen, and the
sweep is the only gate that sees the class of bug these were -
accessors nothing reads back, and boolean chains whose terms are only
partly exercised.

**How to verify.** The last push of this session ran the sweep first
(21 mutants, 21 caught) and CI agreed. A red mutants shard on a
branch whose last local sweep was clean means the sweep was run
before the change rather than after it.

## [L62] A mouse gesture is not a feature contract

**What happened.** The simulation had object actions, queued orders, camera
gestures, need meters and failure handling, but much of that disappeared for
anyone who did not already know the source code. Full actions required a
right-click, queueing required Ctrl or Cmd, the menu could extend beyond a
viewport corner, its focus stayed on the page body, need meters exposed no
numeric accessibility values, and the running canvas announced fallback text
claiming WebGPU was unsupported. The features existed mechanically and failed
as a game interface.

**Root cause.** Input was implemented per event handler rather than as a
player capability matrix. Desktop mouse success was treated as proof of an
interaction even though touch, keyboard, responsive placement, focus return,
screen-reader state, discovery, and visible rejection feedback were separate
contracts.

**Prevention rule.** Every new player action must name its mouse, touch, and
keyboard routes, its visible discovery path, accepted and rejected feedback,
and its focus behavior. Any floating surface is checked at all four viewport
corners. Any visual meter publishes min, max, current value, and readable
state. Canvas fallback warnings are rendered only after an actual startup
failure, never left in the live accessibility tree.

**How to verify.** Unit tests cover long-press firing and cancellation, queue
mode, menu clamping, command rejection, need-meter values, keyboard target
selection, and save status. [A-16] records the visible desktop and phone-size
passes, bottom-right menu bounds, focus return, and keyboard action workflow.

## [L63] A paused frame is not allowed to become hidden simulation time

**What happened.** The first household-roster pause fix drained commands once
per rendered frame. Two quiet bugs came with it. Refreshing the render buffer
after an empty drain swapped the interpolation samples and snapped a moving sim
to the tick endpoint. Worse, `UseObject` followed by `CancelIntents` produced a
different saved world when the two commands landed in separate rendered frames
instead of one batch. The browser frame rate had become simulation state while
the simulation clock still claimed it had not moved.

**Root cause.** The existing drain was deterministic within one tick-sized
batch, but nobody had required it to be associative across batch boundaries.
The render sync also bundled two unrelated jobs: refreshing activity metadata
and advancing the previous/current position pair.

**Prevention rule.** Any command-only pause path must satisfy both invariants:
splitting or joining an ordered command stream cannot change the saved world,
and a command-only render refresh cannot advance interpolation history. Factor
browser frame coordination into a testable function; do not leave the paused
branch as untested entry-point wiring.

**How to verify.** `split_and_batched_paused_drains_produce_the_same_saved_world`
compares complete save snapshots, the WASM interpolation-pair regression pins
both position samples, and the web frame test requires paused frames to flush
without ticking while running frames tick without a command-only flush.

## [L64] Serializing storage does not serialize the state captured before storage

**What happened.** The OPFS wrapper queued every worker operation, but two
player operations could still overlap outside that queue. An autosave could
capture the current world while Load was reading, then write that discarded
world back after Load applied the older slot. A manual Save could likewise
capture bytes while New game was clearing, then run behind the clear and
resurrect the slot.

**Root cause.** The lock began at `store.save`, after `sim.saveBytes()` had
already chosen which world would be written. It ended when storage returned,
without owning the later `sim.loadBytes()` state swap. The serialized I/O queue
was correct inside its boundary; the boundary was simply too small.

**Prevention rule.** Save, Load, autosave, visibility save, and clear share one
controller-owned operation boundary. Acquire it before capturing or reading
bytes, keep it through the world swap, suppress automatic saves while it is
held, and disable persistence controls until release. Keep the worker queue as
defense in depth, not as proof that player operations cannot race.

**How to verify.** Use deferred storage promises. While Load is pending, cross
a simulated day and prove no save bytes are captured or queued. While clear is
pending, attempt manual Save and prove the only storage operation after the
initial restore remains clear. In both cases, assert all persistence controls
are disabled until the owner operation settles.

## [L65] A validator that models one case of a union rejects the other two silently

**What happened.** `Target` names one of three things - a chain station
(the `CHAIN_STEP` sentinel), an object's interaction, or another SIM for
a conversation - and `follow_path` has dispatched on all three since
M2f. The save validator was written when only the middle case existed
and was never revisited when the other two arrived. The result was not
a crash and not a wrong answer: it was **28.4% of all ticks producing a
snapshot the game refused to load**, discovered only when the alpha
acceptance pass saved at every tick of a 36 000-tick run instead of at
one.

**Root cause.** The union has no type. `Target { object: Entity,
interaction: u32 }` is one struct whose meaning depends on what the
entity IS and on a sentinel value, so nothing in the compiler notices
when a new arm is added at the producer and not at the consumer. Two
more consumers shared the same blind spot: queued `Intent`s, and
habituation keys, both of which address an object by FLYOUT ROW - a
fourth index space, running past the interactions into the chains.

**Prevention rule.** When a field's meaning is decided at run time by a
sentinel or by the kind of the thing it points at, every reader of that
field is a place the union must be re-stated. Adding an arm at the
producer means grepping for every reader before the PR, and a doc
comment on the field naming its arms is the cheapest way to make the
next reader look. Where an index space exists in more than one place -
interactions, flyout rows, the social table - give it ONE named helper
that all callers share, so a widening happens once.

**How to verify.** Save at every tick of a played run, not at one
chosen tick, and assert COVERAGE before asserting success: the new test
fails loudly if nobody happened to walk to a chat during the window,
because a vacuous pass is what let this ship.

## [L66] Measuring a milestone's own numbers is not measuring the game

**What happened.** Every one of the ten shipped alpha criteria was
measured when it landed, in a session written for it: [A-14] measured
the career's money, its time share, and its satisfaction, and concluded
"shipped as measured." It never looked at whether the working sim's
NEEDS survived the job. They did not - she hit zero on six of seven and
lived at or under 5 on hunger for 27.3% of her life, from the day the
career shipped. The trace harness had been printing `<-- floor near
zero: somebody is barely being served` on that run the entire time, and
I read past it three milestones running, because the number I had come
to check was a different number.

**Root cause.** A milestone's measurement is written by the person who
just built the milestone, and it asks the questions that milestone was
about. The career pass asked "does the job cost time?" - the right
question, answered correctly. Nobody asked "is this household still
liveable with a job in it?", because that question does not belong to
any one milestone.

**Prevention rule.** A feature's own session cannot be its only
measurement. When a system lands that competes for a shared resource -
time, an object, a need - the NEXT session re-measures the things that
resource already fed, and a whole-game acceptance pass runs against the
finished set rather than against each part in turn. Warnings a harness
prints unprompted are findings; if one is not worth acting on, the
harness should stop printing it.

**How to verify.** `docs/specs/2026-08-01-alpha-acceptance-findings.md`
is the shape: every criterion re-run on one build, each judged against
evidence gathered now rather than against the milestone that shipped
it.

## [L67] The preview server serves the ORIGINAL project root, not the worktree

**What happened.** Working from a git worktree under
`.claude/worktrees/`, I built this branch's `web/dist`, started the
preview through the Browser pane, and measured the save/load fix in the
page. It failed - reproducibly, at exactly the same tick every run,
with a failure rate matching the PRE-fix measurement. An hour went into
chasing a bug that was not there: the preview was serving the SHARED
working tree's `dist`, on another branch, without the fix.

**Root cause.** `preview_start` resolves its launch configuration
relative to the session's original project root rather than the
worktree's cwd, so `npm --prefix web run preview` ran in the shared
checkout. Every symptom pointed the wrong way - a clean rebuild did not
change the served bundle, restarting the server did not change it, and
clearing OPFS, caches and service workers changed nothing, because none
of those were the mechanism.

**Prevention rule.** In a worktree, confirm WHICH build is being served
before drawing any conclusion from the browser, and confirm it by
identity rather than by having just built:

```bash
curl -s http://localhost:4173/ | grep -o 'assets/index-[^"]*'
```

Compare that filename against `ls web/dist/assets/`. If they differ,
the server is serving somebody else's tree. A bundle hash that does not
move after a real source change is the tell, and it is a stronger
signal than any amount of cache-clearing.

**How to verify.** Run the app's own build from the worktree
(`web/node_modules/.bin/vite preview --port 4173`) so the served
`index-*.js` matches the local `dist`, then re-measure. The
before/after this produced is in [A-19]: 2 013 refused saves of 6 000
on the shared build, 0 of 6 000 on this one.

## [L68] Disabling a clicked submitter can cancel the default action it was about to perform

**What happened.** The persistence operation guard correctly disabled an
already-open Load confirmation as soon as Load began. In visible Chromium, the
world loaded and the status changed to `Saved game loaded`, but the modal stayed
open over it. The button's click handler acquired the lock and disabled the
same button before the browser completed the form's native `method=dialog`
submission.

**Root cause.** Button state and dialog lifecycle were treated as independent.
They are ordered parts of one activation: a click listener runs before the
submitter's default action. Making the submitter disabled inside that listener
can invalidate the default action that would close the dialog.

**Prevention rule.** When a confirmed action synchronously disables its own
submitter, do not depend on a later form default. Prevent that default and close
the dialog explicitly before acquiring or publishing the busy state. Apply the
same ordering to every sibling confirmation that shares the control-state
helper.

**How to verify.** Delay storage-worker message delivery by several seconds,
confirm Load, and inspect immediately. The dialog must already be closed while
the status reads `Loading` and Save, Load, and New game are disabled. After the
delayed response, the status must read `Saved game loaded` and all applicable
controls must recover.

## [L69] A readable overlay is still gameplay if the clock keeps moving behind it

**What happened.** First-run Help opened over a simulation already running at
1x. Reading and capturing the nine instructions advanced several game hours,
changed needs, and sent the selected sim into her work shift before the player
could issue a first order. Manual Help also focused Got it at the bottom of a
scrollable surface, while first-run Help did not move focus into the dialog at
all.

**Root cause.** The overlay was treated as visual UI only. Its hidden flag and
button focus were wired independently from the fixed-step driver, so no owner
held simulated time for the interval in which game input was blocked. The Load
and New game dialogs shared the same lifecycle gap because native modal dialogs
block interaction, not JavaScript animation frames.

**Prevention rule.** Every blocking surface names its complete ownership
interval and suspends the shell driver for that interval. Preserve the speed
the player selected, do not record browser reading time as a replayable pause,
focus the beginning of the surface, support Escape, and restore the opener when
it closes. Confirmed asynchronous work owns the pause until the work settles,
not merely until its confirmation disappears.

**How to verify.** In a visible browser, record the clock, hold each blocking
surface open for longer than one tick, and prove the text does not change.
Verify the initial focus target, Escape behavior, focus return, selected-speed
restoration, and a compact viewport. Unit-test overlapping owners so one modal
cannot resume time while another still owns it.

## [L70] The outer timeout must cover the mutation campaign, not one mutant

**What happened.** A targeted `cargo mutants` run covered three changed Rust
files and expanded to 320 mutants. Each mutant had the intended 60-second
timeout, but the shell wrapper itself had a 15-minute timeout. The wrapper
killed a healthy run after 78 completed mutants, discarding work that Cargo
Mutants cannot resume.

**Root cause.** The per-mutant timeout and the orchestration timeout were
treated as if they bounded the same thing. They do not: one bounds a single
synthetic defect, while the other must cover the baseline build plus every
planned defect. Whole-file targeting made two large `lib.rs` files much wider
than the changed lines suggested.

**Prevention rule.** List or inspect the planned mutant count before a scoped
campaign and size the outer timeout for the complete campaign with margin. For
multiple independent files, use separate output directories and concurrent
processes when the machine can support them. Never describe a partial
`outcomes.json` as a completed gate.

**How to verify.** A completed output directory has a non-null `end_time` in
`outcomes.json`, its completed count matches the planned count in
`mutants.json`, and `missed.txt` plus `timeout.txt` have both been inspected.

## [L71] Null cannot explain why a projection has no view

**What happened.** The mood panel returned `null` both when no person was
selected and when a selected entity produced invalid boundary data. Its render
path therefore overwrote the intentional selection prompt with `Mood
unavailable`, even though those states ask the player to do different things.
The same read also requested the text projection after an empty numeric result
had already proved there was nothing valid to align.

**Root cause.** Absence was modeled as one sentinel instead of a state with a
reason. That made the renderer guess at copy and made the boundary reader keep
working after it already knew the result.

**Prevention rule.** Player-facing projections use a discriminated state for
unselected, unavailable, and ready data. Treat an authoritative empty boundary
result as a short-circuit before allocating dependent projections.

**How to verify.** With no selection, the panel keeps `Select a person to see
their mood.` and performs no projection reads. With an empty numeric result for
a selected entity, it reads no labels and shows `Mood unavailable`. Unit tests
assert both the distinct copy and the boundary call counts.

## [L72] A fresh WASM view is stale after the next allocating boundary call

**What happened.** Keyboard target discovery read fresh zero-copy ID and kind
views, then kept them while asking WASM for person, object, and interaction
labels. A string allocation can grow linear memory and detach both views during
the first row. The loop then silently lost the remaining keyboard targets. Load
also kept the previously armed raw entity index even though restore may reuse
that index for a different live entity.

**Root cause.** The bridge rule said not to cache a view, but the caller treated
"freshly read" as a lifetime guarantee. It is not: a view is valid only until
the next call that may grow memory. Separately, an entity index was treated as
stable across wholesale world replacement even though it identifies storage,
not identity.

**Prevention rule.** Copy aligned primitive projection rows before performing
dependent string calls. Any operation that replaces the world clears transient
UI selections and targets before reconciling restored panels. Stable `SimId`
belongs in state that must survive Load; raw entity indices do not.

**How to verify.** Transfer and detach the original ID and kind buffers during
the first label lookup and prove the complete keyboard target list still
returns. Arm a target, clear it as the successful-Load path does, and prove the
status is hidden and `current()` returns no target.

## [L73] A full-screen failure card is not a modal until the dead page beneath it is inert

**What happened.** Startup failures covered the viewport with a clear recovery
card, but keyboard focus stayed on the page body and every canvas and HUD
control underneath remained in the tab order. A sighted player saw one terminal
surface while assistive technology exposed two interfaces, one of them dead.

**Root cause.** The failure renderer was treated as emergency visual output.
It created styled elements but declared no dialog semantics, moved no focus,
and did not disable the interface that startup had left behind.

**Prevention rule.** A terminal full-screen failure owns the whole document.
Expose it as an `alertdialog` with an accessible name and description, focus
the dialog itself, and make every pre-existing sibling inert before appending
it. Close any open native dialog first: top-layer order beats every z-index and
can otherwise leave the failure surface unfocusable. Render through
`parent.ownerDocument` so the contract remains testable and correct outside the
ambient global document.

**How to verify.** Render into a structural fake document and prove the card is
the active element, its title/detail/hints are referenced by ARIA attributes,
every previous child is inert, and a pre-existing open native dialog is closed.
In a compact visible browser, force startup to fail with a modal already open
and confirm the whole message remains scrollable with no focusable controls
behind it.

## [L-shared-counter-ids] A counter cannot be shared by branches that cannot see each other

**What happened.** Both accreting docs numbered their entries by taking
the next free integer. It collided on 2026-07-29 (two different
`[L41]`s) and the fix recorded at the time was a convention: claim the
number in a tiny commit before writing the entry. That convention held
for three days. On **2026-08-01 the same thing happened three times in
one afternoon** - PRs #26, #28 and #27 each appended what they honestly
believed was `[A-17]`, and the last one through renumbered twice, each
time re-running a ~35-minute CI cycle for a conflict that had nothing to
do with its code.

**Root cause.** "Take the next free number" is an allocation, and an
allocator needs a single point that hands ids out. Parallel branches
have no such point: each reads the same file, sees the same maximum, and
picks the same successor. The convention could not have worked, because
it asked authors to serialise something the tool does not serialise for
them. This is the same shape as any lock-free allocation bug - the read
and the write are not atomic with respect to another writer.

**Prevention rule.** An id that identifies an entry in a document
several branches append to must be **derivable from the entry's own
content** rather than from the document's state. A kebab-case slug of
the subject is: two authors writing about different things cannot
produce the same one, and no lookup or reservation is needed. Keep the
old numbers for ever - here, ~60 files cite them, and a citation that
rots is worse than a mixed scheme.

A second, independent change removes the merge conflict itself:
`merge=union` on the file, so two appends at the end combine instead of
conflicting. The id scheme and the merge strategy fix different halves -
the scheme removes the renumbering and the reference sweep, the strategy
removes the conflict.

**How to verify.** `check-doc-ids.py`, run in the `rust` CI job, fails
on four things, each demonstrated against a deliberately broken copy: a
number past the closed series, an id that merely STARTS with a number
(`[L74-something]` is the same allocation wearing a slug's clothes), the
same id twice, and - as a negative - a fenced EXAMPLE of the format,
which must not be counted as an id at all. The union merge was verified
on a scratch repository rather than assumed: two branches each appending
an entry merge with exit 0, zero conflict markers, and both entries
present.

**The guard needed a guard.** Its first version tested only for a purely
numeric id, so `[L74-something]` walked past it, and it counted the
format example inside this file's own code fence as a real id - which
would have reported a duplicate against the first genuine entry to use
that name. Review caught both. A checker written from the failure you
just had sees that failure and no other; the cheap correction is to ask
what ELSE satisfies the rule you wrote, before the rule is the thing
everyone trusts.

## [L74] A shipped checkbox left open becomes counterfeit backlog

**What happened.** The feature overview correctly described save/load, time
controls, seven-need behavior, and player-facing blocked-state feedback as
shipped in its status prose, while later roadmap bullets and architecture
comments still described the same work as unfinished. A fresh audit therefore
produced contradictory recommendations depending on which paragraph it read.

**Root cause.** Milestone implementation updated the detailed design and the
top-level status summary, but did not search sibling roadmap bullets and source
comments that shared the same completion claim. Historical plans also retained
unchecked execution steps, which made a text search look more like a current
backlog than an archive of how the work was built.

**Prevention rule.** When a feature ships, impact-scan documentation and source
comments for every statement about whether it exists, who reads it, and what is
still deferred. Treat old plan checkboxes as historical evidence unless the
requirements index explicitly names them as live work.

**How to verify.** Search current non-archive documentation for each shipped
feature name. The requirements index, feature overview, architecture, and code
comments must agree on its status and on any deliberately deferred extension.

## [L-render-buffer-live-prefix] A reused render buffer has no meaningful trailing slots

**What happened.** A selection-ring test read the slot immediately after the
live instance count and expected it not to contain an old ring. Adding an
earlier test that legitimately drew a ring made the assertion depend on test
order even though the renderer still uploaded exactly the correct live prefix.

**Root cause.** `buildInstances` deliberately reuses a high-water-mark scratch
buffer. Slots after `instanceCount` are unspecified leftovers, not part of the
frame. The test treated physical array capacity as rendered output and tested a
cleanup behavior the production contract neither promises nor needs.

**Prevention rule.** When a producer returns reusable storage plus a separate
live count, assert only within that count. Do not inspect or clear trailing
capacity unless a consumer can actually read it; needless clearing adds frame
work and merely makes an invalid test look stable.

**How to verify.** Draw a frame with extras, then a smaller frame without them.
Assert the second `instanceCount` and its live prefix. Permit any value beyond
that prefix, and verify the draw call receives the same live count.

The current production API is `buildInstanceBatch`: its reused result publishes
the written count with the borrowed array. Calls through either building API
invalidate both fields. Production consumes that count instead of the legacy
`instanceCount` helper.

## [L-save-presentation-boundary] Tick state and presentation state are different save boundaries

**What happened.** A movement-animation test rendered the pre-save and
post-Load frames with interpolation alpha 1, then the acceptance note described
that as proof that any exact pre-save screen position returns. A real paused
frame can retain an alpha between 0 and 1, while the save format correctly owns
the simulation tick state only.

**Root cause.** The test proved deterministic reconstruction from the saved
tick-end position, but the prose silently widened that contract to include the
renderer-only fractional sample. Load reseeds previous and current position to
the saved tick endpoint; it cannot recreate an interpolation alpha that was
never part of the simulation snapshot.

**Prevention rule.** State save/load evidence at the ownership boundary it
actually exercises. A simulation snapshot may reproduce tick state exactly
without preserving transient presentation state. If exact presentation is a
requirement, name it explicitly and persist or reconstruct every input that
creates it.

**How to verify.** Test the restored walking transform against the saved tick
position and document that boundary. Separately inspect whether the product
requires between-tick interpolation state to survive Save; do not infer that
contract from an alpha-1 fixture.

## [L-current-versus-roadmap-docs] Architecture needs status at the claim

**What happened.** The architecture and stack documents opened by calling the
playable-alpha systems implemented, then described parallel scheduling,
room-graph pathfinding, multi-lot streaming, a toon shader, and a ten-year soak
as if they were current. The source deliberately used a single-threaded
schedule, one-lot A*, a sprite atlas, and no such soak gate.

**Root cause.** Long-range design and shipped implementation shared sections
without local status labels. A true top-level disclaimer was too far from each
specific claim to stop a reader from treating planned machinery as available.

**Prevention rule.** Put `shipped` or `planned` beside an architectural claim
whenever both states live in one document. If the current implementation is a
smaller precursor, name both at the point of comparison. Do not rely on an
introductory status paragraph to govern hundreds of lines of mixed tense.

**How to verify.** Compare the schedule, renderer, pathfinder, art pipeline, and
test-gate sections against their source configuration. A reader should be able
to answer what runs today without consulting git history or inferring tense.

## [L-fingerprint-changes-need-their-own-migration] A better save hash can still delete every old save

**What happened.** Replacing the whole-content Save V1 fingerprint with a
narrow structural digest made future balance and art patches compatible, but
the first draft compared existing saves directly against the new algorithm.
Every public save still carried an old full-pack value, so the release meant to
stop invalidation would have invalidated all of them one more time.

**Root cause.** The design treated the fingerprint as content metadata and
forgot that its algorithm is itself persisted wire behavior. Keeping schema
version 1 does not make a newly computed number comparable with an old one.

**Prevention rule.** Treat any persisted digest-algorithm change as a migration.
Inventory every public value the old algorithm emitted, verify the wire shape,
and map each legacy value only to the exact reviewed new structural shape.
Recognition enters ordinary validation; it never bypasses it.

**How to verify.** Reconstruct historical fingerprints independently, feed a
serialized old value through the public byte loader, assert every reference is
validated, and assert the next save carries the new digest. Change the target
structural digest and prove the legacy bridge closes.

## [L-save-digest-must-follow-post-load-reads] A save digest owns current-content reads after Load too

**What happened.** The repaired Save V1 digest covered every numeric row held
inside the snapshot, but its first audited version still missed two structural
facts read from current content after reconstruction: which objects serve each
chain station role, and where a career sends a worker to leave the lot. Moving
a role or the front door therefore left the digest unchanged while a restored
chain or future shift quietly followed different geometry. The household-name
migration had the same boundary mistake in miniature: it recognized an old
name without first proving the save itself was old.

**Root cause.** The compatibility inventory stopped at fields serialized in
`SaveSnapshotV1`. A restored world is not self-contained; later systems still
consult the current content pack. Those reads are part of the save contract
whenever the snapshot persists the state that will reach them.

**Prevention rule.** Trace restored state forward through every system that can
resume it. Hash any unsaved structural current-content value that gives that
state meaning, or persist a stable authored id in the next schema. Gate a
one-time data migration on the legacy format discriminator, never on a user
value that future editing may deliberately reproduce.

**How to verify.** Move a station role and the front door independently and
prove each moves the digest. Load every known legacy fingerprint and prove the
old household names migrate. Then load the current fingerprint with Tim
deliberately named Terri and prove Load leaves that name alone.

## [L-name-the-state-in-content] Infer behavior from authored identity, not a convenient number

**What happened.** Sleeping was inferred from an interaction whose dominant
positive advert was energy. That happened to identify beds, but it would also
classify a future coffee machine as sleep, slowing need decay and drawing Zzz
over a sim drinking espresso.

**Root cause.** A numeric consequence was used as the activity's identity even
though content already had an authored tag vocabulary for identity.

**Prevention rule.** When multiple systems need to know what an action IS, give
content one explicit semantic tag and share the predicate. Do not reverse-engineer
identity from balance numbers that designers are expected to tune.

**How to verify.** Hold every advert constant and vary only the authored tag.
Scoring, need decay, and activity presentation must agree on the tagged case and
reject the untagged twin.

## [L-check-glyphs-at-the-size-they-ship] Enlarged art can conceal a collapsed icon

**What happened.** The first Zzz activity glyph read correctly when inspected
enlarged but collapsed into an ambiguous mark in its 26-pixel shipping bubble.

**Root cause.** Review measured the source drawing rather than the rasterized
bounds, stroke separation, and silhouette at the actual render scale.

**Prevention rule.** Judge small UI art at one-to-one shipping size before
approving it. Enlarged inspection is useful for defects, but it is not evidence
of legibility.

**How to verify.** Regenerate the atlas, crop the glyph at native size, inspect
its occupied bounds and separated strokes, then view it in the real bubble on
the page at normal zoom.

## [L-generated-image-contract-is-pixels] PNG bytes are packaging, not artwork

**What happened.** The atlas reproducibility gate reported the committed image
as stale under Pillow 12 even though the regenerated and committed 512 by 500
images had no differing pixel. Their SHA-256 hashes differed because the PNG
encoder packaged identical RGBA data differently.

**Root cause.** The gate compared a compressed file format byte for byte when
the generator's contract is the decoded sprite pixels. Encoder and zlib output
are implementation details unless file-byte identity is itself a requirement.

**Prevention rule.** Compare generated raster images by dimensions, mode, and
decoded pixels. Keep exact comparison for textual manifests whose bytes are the
authored contract. Do not regenerate a correct image merely to appease the
currently installed compressor.

**How to verify.** Record that the old and new PNG byte hashes differ, prove an
RGBA pixel diff has no bounding box, and run the generator check successfully.
Then alter one generated pixel and prove the same check fails.

## [L-test-the-visible-speed-control] Click the label the player can actually use

**What happened.** A browser acceptance pass clicked the visually hidden radio
input behind the speed controls. Pause happened to accept that synthetic click,
but 1x did not, which looked like a product defect where the simulation could
never resume. Clicking the visible 1x label resumed immediately and the clock
advanced normally.

**Root cause.** The speed inputs are intentionally transparent and have
`pointer-events: none`; their labels are the 44-pixel player-facing targets.
The first check exercised an automation shortcut that a pointer user cannot
take, then treated its failure as evidence about the visible control.

**Prevention rule.** Browser acceptance must operate the visible label or use
the documented keyboard path for custom-styled radio controls. Do not infer a
player-facing defect from a synthetic click on a hidden, pointer-disabled
input.

**How to verify.** Pause through the visible Pause label, choose the visible 1x
label, and verify both the checked state and clock advancement. Keep the unit
test for option values, but do not mistake it for browser hit-target coverage.

## [L-test-symmetric-presentation-rules-both-ways] One direction does not prove a symmetric rule

**What happened.** Conversation rendering tests covered positive x, positive y,
and only the higher-index side of a coincident pair. Mutation testing showed
that negative y's opposite-facing arm, the lower-index coincidence result, and
the requirement that both conversation participants be agents could all change
without a failing test.

**Root cause.** The fixtures demonstrated representative happy paths, but each
rule had a sibling path hidden by symmetry or by valid production data. The
implementation looked symmetric; the evidence was not.

**Prevention rule.** For directional presentation rules, exercise both signs
and both sides of every deterministic tie. For component joins, include one
well-formed near miss where exactly one required component is absent.

**How to verify.** Run the render-buffer tests with positive and negative y
talkers, coincident pairs in both entity-index orders, and an authored talk
whose positioned partner lacks `Agent`. Then mutation-test `terri-sim/src/lib.rs`
and require the new facing and participant-guard mutations to be caught.

## [L-stagger-before-frame-division] Different first frames do not prove staggered transitions

**What happened.** The first eating-frame calculation added an entity-id parity
after dividing the simulation tick by the frame duration. Adjacent sims could
start on different frames, but every one of them still crossed a frame boundary
on the same tick.

**Root cause.** The test checked only the initial frame difference. It did not
observe the transition ticks, so a phase flip looked like a true time offset.

**Prevention rule.** Apply a stable entity phase to the simulation tick before
dividing by frame duration. When animation staggering matters, test the timing
of transitions as well as the starting pose.

**How to verify.** Use three consecutive entity ids and record their frame
changes across two full cycles. Each id must transition on a distinct tick,
Pause must freeze the result, and reduced motion must still select frame zero.

## [L-exercise-geometry-on-both-axes] A rectangular fixture can still leave one axis untested

**What happened.** Eating faced the centre of a 2 by 1 dining table, and the
directional test proved that the width changed the answer. Mutation testing
still found six surviving arithmetic changes in the centre calculation. The
one-tile depth made every depth offset zero, while several wrong width offsets
continued to point in the expected direction.

**Root cause.** The fixture was non-square, but its assertion observed only the
final facing category. It did not force every operator on both axes to change
that category.

**Prevention rule.** For geometry collapsed into a direction, distance, or
bucket, use non-unit dimensions on both axes and choose boundary-adjacent probe
points. Each load-bearing arithmetic operator must have at least one probe
whose observable result changes when that operator changes.

**How to verify.** Use a 3 by 2 footprint and probe from three positions that
separate the correct centre from width-offset, depth-sign, and depth-scale
mutants. Run a mutation filter over the centre helper and require every viable
mutant to be caught.

## [L-career-tests-follow-events-not-guessed-ticks] Travel time is not shift time

**What happened.** The release-WASM career test proved Tim was off the lot at
tick 600, then assumed he would be home by tick 900. Local idle wandering
changed his deterministic position when the 06:00 shift began, so his walk to
the front door took longer and the assertion found him legitimately still at
work. The career itself remained correct and the 12,000-tick shipped trace
still completed and paid every shift.

**Root cause.** The test silently treated `shift_start + shift_ticks` as the
return time, then added a guessed commute margin. Authored behavior says the
sim walks to the door first and is gone for `shift_ticks` after arrival. The
clock therefore schedules departure, while the path and movement speed decide
clock-in. A deterministic random-sequence change can move that arrival without
changing the career contract at all.

**Prevention rule.** Test event-owned lifecycles by their observable events.
Use an exact tick only when the schedule owns that exact tick. When travel
precedes a fixed-duration phase, prove the intermediate phase, then wait within
an authored outer bound for completion and assert its effects. Do not turn one
seed's path length into an undocumented product promise.

**How to verify.** The release-WASM test still requires Tim to be `AT_WORK` at
tick 600 with no money paid. It then observes the first return before the
1,440-tick day wraps and requires the row to be visible plus Funds to equal one
exact 120-credit paycheck. Removing the return, hiding flag, countdown, or
payout still fails; changing an unrelated earlier random draw does not.

## [L-split-subsumed-path-guards] Do not join a prefilter to the real invariant

**What happened.** The local-wandering mutation sweep replaced
`distance == 0 || distance > radius` with `&&`, and the whole workspace stayed
green. The two predicates cannot both be true, so the mutation removed the
early rejection. The later path validation still rejected both cases: the
empty-path check rejected the origin, and the walked-path cap rejected every
endpoint outside the radius because a four-neighbor path cannot be shorter than
its Manhattan distance. The survivor was behaviorally equivalent, not evidence
that the locality tests had missed a long route.

**Root cause.** One `if` combined two prefilters whose gameplay consequences
were already subsumed by a later, stronger invariant. The expression invited a
Boolean mutant that could delete both prefilters without changing accepted
paths. The origin check also protected the path finder from an empty route,
while the distance check merely avoided unnecessary A* work; writing them as
one gameplay guard overstated what the code owned.

**Prevention rule.** Keep independent early exits separate, and name whether a
guard owns behavior or only avoids work. When a hand mutation survives, prove
whether a later invariant subsumes it before adding a contrived assertion.
Equivalent mutants should be removed by clearer code when possible, not hidden
behind a baseline entry that makes the suite look more precise than it is.

**How to verify.** The two early exits are separate statements, the wall-detour
test still fails when the walked-path cap is removed, and a targeted
`cargo mutants` sweep over `idle.rs` must report no missed or timed-out mutants.

## [L-mobile-fit-is-not-mobile-reflow] Reachable controls can still bury the game

**What happened.** The original phone acceptance proved that every control fit
inside a 390 by 844 viewport. Later roster, relationship, persistence, Queue,
and Help features all joined the same 212-pixel vertical sidebar. Nothing
overflowed horizontally, but the overlay consumed more than half the screen in
both axes and left the house awkward to play.

**Root cause.** The mobile rule narrowed the desktop column without changing
its one-dimensional composition. Acceptance checked presence and viewport
bounds, not the remaining canvas aperture, hit ownership, expanded-panel
behavior, or accumulated height after new features landed.

**Prevention rule.** Treat mobile usability as a geometry budget. Responsive
HUD checks must measure how much uninterrupted canvas remains, prove that the
aperture reaches the stage, keep visible targets at least 44 pixels, and open
the largest dynamic panels before declaring the layout usable. Short landscape
and 200% text sizing are separate budgets; if fixed rows exceed the height, the
HUD needs a reachable scroll boundary rather than visible overflow into the
body's clip. An equal grid with `minmax(0, 1fr)` does not itself preserve a
44-pixel target; fixed control groups need a 44-pixel track minimum and wrapping
when the width cannot hold every item. Re-run those budgets whenever a
persistent HUD section is added.

**How to verify.** At 390 by 844, require a full-width folded canvas band of at
least 400 CSS pixels, no horizontal overflow, reachable bottom controls, and
44-pixel targets. Open Needs and People separately and together, pan through
the remaining aperture, repeat at 320 by 568, 568 by 320, and wide landscape,
double inherited text with Needs open, and prove Help remains reachable by
scrolling. Then hand-mutate each load-bearing layout rule and require the
geometry gate to fail.

## [L-restore-css-mutations-by-context-and-hash] Repeated declarations make blind restoration unsafe

**What happened.** During the mobile mutation audit, a one-line restoration of
`grid-template-columns` matched another identical declaration in the same media
query. The intended game-action rule remained mutated while the HUD column rule
changed instead.

**Root cause.** The restore patch identified a repeated CSS value without its
owning selector. A successful patch application proved only that some matching
line changed, not that the original file had returned.

**Prevention rule.** Scope manual CSS mutations and their restorations with the
owning selector, and record the authored file hash before the first mutation.
Do not continue to final validation until the restored hash matches exactly.

**How to verify.** After every hand-mutation sequence, compare SHA-256 for the
authored file, inspect the scoped diff, rebuild, and rerun the unmutated geometry
gate. A clean-looking browser frame is not byte restoration.

## [L-shadows-belong-to-one-light-before-composition] Occlusion is not a global tile flag

**What happened.** The first [ML-pools] implementation built one union of every
object's `+x` shadow band, then applied that mask while spreading every light.
A lamp west of a tile marked it shadowed, and a television east of the same
tile was dimmed too. The field still looked plausible in single-source tests;
the two-light overlap test exposed the wrong `0.10` where the television's
unshadowed `0.12` should have won.

The first correction materialised one `ShadowCaster` object per render row.
That moved the calculation off the frame-hot path but still violated [D11]'s
stronger rule: zero-copy views do not become permission to rebuild every row as
a JavaScript object during startup and Load.

**Root cause.** Shadow state was represented after composition when it belongs
to one source contribution before composition. The convenient global mask
could not say which side of a caster a light occupied. The convenient caster
array then copied row-shaped bridge data into heap-shaped JavaScript data.

**Prevention rule.** Compute occlusion inside each source's contribution, then
combine completed contributions by the lighting rule, here `max`. Keep bridge
work columnar: rescan fresh typed-array views or use reusable primitive scratch
columns. Do not materialise per-entity objects merely because the calculation
runs less often than a frame.

**How to verify.** Put a lamp west and a weaker light east of the lamp's shadow
tile. The east light's stronger unshadowed value must survive regardless of row
order. Add ordinary multi-tile furniture between a lamp and a probe so deleting
the caster path brightens the probe, and place an agent in the same geometry so
accepting agents as casters darkens it. A static scan of `lighting.ts` must find
no per-row object construction, retained WASM view, second draw, or second
submit.

## [L-semantic-overlays-need-their-own-lighting-contract] World tint is not UI contrast

**What happened.** The first local-light build kept the sage selection ring in
the same ambient and pool lighting as the floor beneath it. At midnight that
ring measured roughly 1.38:1 against the floor. The command target still
existed, but it was no longer reliably visible in the exact scene where the
new lighting mattered most.

**Root cause.** Selection was treated as another world sprite even though it
communicates player state. A colour that identifies selection at noon does not
automatically provide enough luminance contrast after the floor and overlay
take the same night multiply. Local light can narrow that difference again.

**Prevention rule.** Give semantic canvas overlays an explicit lighting and
contrast contract. Keep the identity colour if it helps recognition, but add
an independently legible key when the overlay must survive the full ambient
range. Measure both the darkest floor and the brightest local pool; checking
only one end leaves the other failure available.

**How to verify.** Select a Sim at midnight outside a pool and beside the
strongest source. Sample rendered pixels from the legibility key and the
adjacent floor, and require at least 3:1 in both scenes. Muting the key or
letting it inherit world emissive must make the focused renderer test or the
displayed contrast gate fail.

## [L-media-query-events-need-a-cheap-convergence-path] Preference events can go missing

**What happened.** The lighting control listened for the reduced-motion media
query's `change` event. One embedded-Chromium run delivered it and forced Flat;
a clean focused retry changed `matchMedia(...).matches` but never called the
application listener, leaving `Light: auto` visible under reduced motion. A
separate diagnostic listener received the browser event, which made the
failure intermittent and particularly unpleasant to reason about.

**Root cause.** Presentation state converged only through one browser event.
The frame already read the same media-query value for animation, but the light
controller trusted event delivery as if it were simulation data. In an embed
or emulation path, that trust was stronger than the platform evidence.

**Prevention rule.** Keep the normal event listener for immediate response,
but give accessibility preferences a cheap idempotent convergence path when
their current value is already read regularly. Cache the last reflected value;
steady frames do one comparison and never rewrite the DOM or static buffer.

**How to verify.** Delete the frame-loop synchronization while leaving the
event listener intact, change emulated reduced motion after startup, and watch
the button remain Auto in the affected embed. Restore the cached check and
require reduce to produce disabled `Light: flat` with `aria-pressed=true`, then
require no-preference to restore enabled `Light: auto` without reload.

## [L-live-region-feedback-needs-a-recovery-transition] Repeating an error requires an empty state between announcements

**What happened.** Displayed acceptance found that the queue-full error stayed
visible after a later accepted replacement. Review then found the second half:
assigning the same queue-full text after another rejection might not announce
anything because the live region never changed. Persistence and command
feedback also wrote the same status element, so a day-boundary autosave could
replace a same-frame rejection.

**Root cause.** The first implementation modeled the simulation's rejection
correctly but treated its DOM text as a permanent flag. It had no player-action
transition that retired the old announcement, and it gave unrelated
asynchronous owners one shared output surface.

**Prevention rule.** A transient live-region error needs four named parts: the
authoritative failure event, the player event that clears it, a real empty DOM
state before an identical repeat, and one status owner per asynchronous
domain. When frame order matters, put it behind a small tested orchestration
seam instead of relying on line placement in an entry point.

**How to verify.** Drive rejection, accepted replacement, and the same later
rejection through the real command routes. Require the live-region text to
transition from the exact error to empty and back to the exact error. At a day
boundary, require the frame seam to run command drain, persistence update, then
feedback consumption, with autosave visible only in the persistence region.

## [L-shared-component-is-not-an-activity-name] Storage names are not player semantics

**What happened.** The shared `Eating` component carries every ordinary object
interaction. Render sync treated that implementation name as the fallback
activity, so using a toilet, shower, television, sink, bookshelf, or reading
chair could say `Eating` and draw a fork bubble.

**Root cause.** The classifier named the storage mechanism instead of the
authored action. Exact visual metadata already distinguished eating, and the
sleep tag already distinguished sleeping, but the remaining branch collapsed
unrelated uses into `EATING`.

**Prevention rule.** Derive player-facing activity from validated authored
identity. When a shared component has several semantic owners, give the
unclassified remainder a distinct append-only code. Never let an entity
component's historical name become UI text or art selection by default.

**How to verify.** Hold the component and exact-target shape steady while
varying only authored interaction metadata across snack, shower, bed, and
terminal dinner fixtures. Hand-change the generic fallback to `EATING` and
require the ordinary-use matrix to fail. Remove the code 3 fork mapping and
require the frame test to fail. Restore both mutations and require the focused
Rust and Web suites to pass.

## [L-a-sha-query-label-is-not-an-immutable-deployment] A query label does not pin mutable Pages content

**What happened.** Post-merge notes called a GitHub Pages URL with
`?rev=<merge-sha>` revision-pinned. The application does not read `rev`, and
Pages publishes one mutable site. After PR 47 deployed, the old PR 46-labelled
URL returned the same current document metadata as the PR 47-labelled URL.

**Root cause.** The SHA query was useful as a cache-busting and observation
label, then its human meaning was mistaken for a server-side routing guarantee.
Nothing in the application, workflow, or host retained an immutable build at
that URL.

**Prevention rule.** Call these URLs SHA-labelled public sessions and record
that they were opened immediately after the named deployment. Cite the Actions
run as proof that an exact SHA built and deployed. Use `revision-pinned` only
when the host actually routes to immutable content and that behavior has been
verified.

**How to verify.** Inspect which query parameters the application reads, then
request old and current SHA-labelled URLs after a later deployment. If their
content hash, ETag, or `Last-Modified` value is identical, the query is only a
label. The immutable evidence is the successful workflow run tied to the exact
head SHA, not the mutable Pages response.

## [L-transform-motion-is-not-a-character-animation] Moving a sprite is not the same as animating its body

**What happened.** The walking slice was described as a walking animation even
though it only lifted the unchanged character sprite during travel. The seated
reading pose was also called acceptable after mechanical and atlas inspection,
but the owner saw the deployed result and rejected its distorted neck and head
silhouette. Eating technically moved the hand, yet had no visible food in it,
and every action pose changed too quickly to read comfortably at 1x speed.

**Root cause.** Implementation categories such as `visual_action`, distinct
sprite indices, and deterministic phase changes were allowed to stand in for
the player's visual meaning. The checks proved that pixels changed on schedule;
they did not prove that legs and arms formed a believable walk, that a held
prop explained the eating gesture, or that a seated silhouette looked human.

**Prevention rule.** Name each motion precisely. A transform-only body lift is
a footfall effect, not a walk cycle. A walk cycle requires visibly different
limb silhouettes in the character frames. Action art must show the object that
explains the gesture, preserve believable anatomy, and remain on screen long
enough to read at 1x. Owner visual review may reject code-complete art, and that
rejection reopens acceptance rather than becoming a documentation footnote.

**How to verify.** Inspect the deployed action at 1x through the normal player
route. Require walking legs and arms to change shape, food to remain visible in
the eater's hand, and seated reading to retain a normal neck and head silhouette
at ordinary zoom. Watch at least two full pose holds for each action, then repeat
at 2x and 3x. Record any visual rejection explicitly and do not call that art
accepted or shipped until the replacement passes the same played check.

## [L-protect-the-complement-of-an-art-exception] An allowed redraw needs a guard around everything else

**What happened.** The animation-repair contract allowed seated-reading pixels
98 through 121 to change while requiring every other legacy sprite through 146
to remain fixed. The first generator checks pinned names, dimensions, Chat, and
the dinner prop, but did not causally protect all remaining decoded pixels. A
review confirmed that the generated atlas was currently correct, yet a future
floor, wall, object, or character-pixel regression could still pass the stated
gate.

**Root cause.** The test guarded memorable examples rather than the complete
complement of the exception. The written invariant covered 123 protected
sprites; the implementation checked only a few highlighted subsets.

**Prevention rule.** When an append-only atlas permits one in-place redraw,
hash the names, dimensions, and decoded pixels of every legacy sprite outside
the allowed range. Keep focused semantic checks too, but do not mistake them
for full prefix protection.

**How to verify.** Change one decoded pixel in any protected legacy crop and
run the generator check. It must fail on the protected-record digest. Restore
the pixel and confirm the atlas reproduces exactly; only the explicitly allowed
range may differ from its recorded predecessor.

## [L-implementation-docs-do-not-create-owner-requirements] An implementation note is not owner authority

**What happened.** A responsive-layout spec described the CSS-only mobile dock
as a contract. When the owner asked for collapsed small-screen controls, that
sentence was treated as a conflicting requirement and used to stop for
confirmation. The same claim was repeated after the owner explicitly said it
had never been their requirement.

**Root cause.** A document that recorded what the code did was granted authority
over why the product should do it. No owner decision, acceptance note, or
source instruction supported that elevation. The rendered phone evidence also
showed that the documented choice had failed its actual purpose.

**Prevention rule.** Repository specs describe implementation and accepted
behavior unless they cite an owner decision explicitly. They do not invent
owner intent. When a direct owner instruction conflicts with an uncited design
choice, follow the instruction, inspect the current behavior, and update the
document. Do not make the owner disprove provenance the document never had.

**How to verify.** Trace any claimed owner requirement to the message, issue,
or acceptance record where the owner stated it. If no such source exists,
classify the text as a project decision rather than owner authority. Confirm
that the replacement behavior is documented, causally tested, and played at
the viewport where the old choice failed.

## [L-a-save-digest-exception-does-not-migrate-the-world] Accepting a fingerprint does not rebuild an old snapshot

**What happened.** The aquarium mock wanted a wider cabinet, and the exercise
bike looked like an obvious new object. Both changes also needed public Save V1
households to keep loading. A compatibility-fingerprint bridge initially
looked like the migration mechanism, but old snapshots restore their own entity
list and blocked-tile grid. A new bike would be absent from every old household,
and a widened aquarium would still carry the old one-tile collision map.

**Root cause.** A digest gate answers whether current code may interpret a
snapshot. It does not rewrite the snapshot. Object existence, identity,
position, footprint collision, and active references remain whatever the save
serialized unless an explicit migration changes them.

**Prevention rule.** Before accepting a changed content digest, inventory every
structural fact the save owns. Either keep those facts identical, as this slice
does by repurposing two inert persistence slots, or write a versioned migration
that reconstructs and validates entities, collision, paths, and references. Do
not call a relaxed fingerprint check a world migration.

**How to verify.** Load a fixture carrying the prior structural digest and
compare entity indices, persistence IDs, positions, and every blocked-grid bit
before issuing either new action. Confirm the bridge does not run unrelated
legacy household renaming. Save again and require the current digest while the
same entity and collision identities remain intact. Remove or alter one
reviewed interaction and require the digest bridge to close.

## [L-an-old-fingerprint-does-not-own-new-content-rows] Preserve source-shape rules through save validation

**What happened.** The aquarium and exercise bike reused two formerly inert
object IDs. Their old fingerprints were accepted against the new pack, then
saved interaction references were checked only against that new pack. A
corrupt pre-feature snapshot could therefore claim row zero on an object that
had no rows when the snapshot format was produced, and Load would reinterpret
it as a new action.

**Root cause.** Fingerprint provenance was reduced to a yes-or-no compatibility
answer before row validation. The validator knew the destination pack but had
discarded the source shape, so it could not distinguish a current row from a
historically impossible one.

**Prevention rule.** When compatibility accepts more than one structural
shape, retain a source-shape classification through every validation path.
Reject references that the accepted source could not have authored before
reconstructing any state. Do not let destination bounds manufacture history.

**How to verify.** For each of the five accepted pre-feature fingerprints and
both repurposed objects, forge row zero independently in `Target`, `Eating`,
`Intent`, queued `UseObject`, `Habituation`, and Personality dispositions.
All 60 loads must return `InvalidContentReference` and leave a running
simulation byte-for-byte unchanged. A valid prior-structural snapshot must
still cross the public WASM byte loader, retain its names, and resave with the
current digest.

## [L-generated-public-assets-need-content-addressed-urls] Bind generated manifests to cached public files

**What happened.** Vite gave the JavaScript bundle a content hash, but the
generated sprite texture remained a stable `atlas.png` URL. GitHub Pages caches
that public file for ten minutes. A returning browser could therefore load the
new manifest beside the previous PNG and abort because their dimensions did
not match.

**Root cause.** Reproducible generation proved the committed PNG and manifest
agreed at build time. It did not bind the two independent HTTP cache entries at
runtime.

**Prevention rule.** Content-address every generated public asset consumed by
hashed code. On a host whose CDN ignores query strings in its cache key, the
digest must be in the pathname rather than only in a query. Alternatively, let
the bundler own and hash the asset. A human query label on the page URL does not
revise subresource requests.

**How to verify.** Hash the committed PNG bytes in the Web test, require the
generated filename and duplicate runtime file to match, and require the
renderer URL to use that exact path. Request two cold, never-before-used query
variants from the deployed stable path; if the CDN reports cache hits, queries
are not a release boundary. Mutate either the filename digest or path
construction and require the focused test to fail.

## [L-rgba-animation-guards-must-read-rgba] Alpha-only image checks miss color motion

**What happened.** The aquarium validator used Pillow's default RGBA
`getbbox()`, which considers alpha only. The tank is opaque across both frames,
so an RGB-only change to water, glass, lid, or cabinet pixels could evade the
motion boundary. The additional cabinet crop still left most of the tank
outside a causal guard.

**Root cause.** A convenient image-difference helper had channel semantics that
did not match the art contract. The check described fish-only motion while
measuring transparency changes and one broad vertical boundary.

**Prevention rule.** Inspect all four channels when color stability matters,
and define the allowed motion as reviewed pixel regions. Reject every changed
pixel outside those regions rather than inferring safety from one bounding
coordinate.

**How to verify.** Change one RGB value outside the three fish-motion regions
without touching alpha and run the generator check. It must fail with the
escaped pixel coordinate. Restore the mutation and require exact regeneration.

## [L-restored-countdowns-must-enter-a-valid-update-state] Validate before decrementing

**What happened.** Save validation accepted `AtWork { remaining_ticks: 0 }`.
The career system decrements before checking for completion, so the next debug
tick panicked and a release build wrapped to `u32::MAX`, leaving the Sim at
work for years of game time.

**Root cause.** Serialization preserved the integer type but not the live
component's positive-domain invariant. The update loop assumed every restored
component came from the constructor that enforces that invariant.

**Prevention rule.** Validate saved countdowns against the domain required by
their first update operation. A decrement-before-check counter must restore as
strictly positive, or the system must use saturating subtraction and define
zero as a legal completion state.

**How to verify.** Require one remaining work tick to load and zero to fail
with `InvalidValue`. Remove the validation and require the focused boundary
test to fail before exercising the dangerous update.

## [L-visual-acceptance-must-follow-shared-generator-changes] Art evidence expires when shared drawing code changes

**What happened.** The selected aquarium and exercise-bike mockups looked
convincing, but the deployed procedural sprites did not preserve their readable
silhouettes. The aquarium became a white display cube under a brown roof and the
bike collapsed into a small dark knot. A later shared character rewrite then
changed the previously reviewed exercise body into a standing Sim that bobbed
in front of the machine. Dimensions, sprite indices, animation timing, and the
older atlas complement guard all continued to pass.

**Root cause.** Acceptance focused on ingredient lists and isolated technical
contracts. The durable pixel guard protected the complement of the intentional
art exceptions, but nothing pinned the reviewed exception pixels themselves.
The played captures were also treated as permanent evidence even after shared
generator code changed the current atlas bytes.

**Prevention rule.** Compare the selected reference and the current runtime at
the same scale and state. Pin the exact decoded pixels of every corrective art
candidate, including action bodies that depend on shared character code. Do not
call those pixels owner-approved until the owner accepts them. Any later change
to a shared generator invalidates prior played art evidence until the affected
object and body composites are replayed.

**How to verify.** Inspect current native crops, object-and-rider composites,
and played 1x actions beside the selected references. Require a deliberate
pixel mutation in the aquarium, bike, or exercise body to fail the reviewed
subset digest. Require a whole-body exercise translation to fail the planted
upper-body invariant, and require a frozen pedal leg to fail the lower-body
motion check. Restore the source byte-identically and regenerate the exact
content-addressed atlas.

## [L-atlas-height-can-invalidate-a-camera-fit-contract] Check the model before believing an impossibility

**What happened.** The Clear Line atlas pass increased the tallest sprite from
132 to 136 pixels. The camera's conservative 16 by 12 lot extent therefore grew
from 720 to 724 pixels, and the desktop regression test - which required both
its top and bottom to fit inside a 720-pixel canvas - failed with a negative
two-pixel top bound. The first reading was that no camera origin could satisfy
both assertions, because the modeled extent was four pixels taller than the
viewport, and the test was relaxed to accept up to four pixels of centered
overflow.

**That reading was wrong, and the second fix is the one in the tree.** The
extent was never 724 pixels. It reserved the atlas's tallest sprite above the
boundary row at world -1, and `tiles.ts` draws nothing out there but the floor,
two wall panels and the north-west corner. Furniture cannot stand at a negative
coordinate; the earliest tile it can occupy is (0, 0), two half-tile rows lower,
which is 42 pixels of head start. The picture is 697 pixels and fits with 23 to
spare.

**Root cause.** A bound documented as "deliberately conservative" was never
re-examined once it started binding. Conservative bounds are cheap while they
have slack and become load-bearing the moment they do not, and this one encoded
a placement the coordinate system makes impossible. The failing test was then
read as a stale assertion rather than as a true report about a wrong model, so
the first fix moved the assertion to match the model instead of the other way
round - and in doing so wrote "unavoidable" into four documents about a two-pixel
clip that was entirely avoidable.

**Prevention rule.** Treat maximum sprite width and height as renderer inputs,
not merely atlas metadata; when either changes, run the full Web suite and
recalculate every fixed-viewport budget. When a budget stops fitting, derive the
bound from scratch before concluding the fit is impossible - in particular, ask
which coordinates each reserved term can actually be drawn at. Only once the
model is confirmed tight is the choice between automatic scaling and centered
overflow a real product decision.

**How to verify.** At 136 pixels the two-row bound gives 697 pixels for the
16 by 12 lot, so `cameraOrigin` must place the whole extent on a 720-pixel
canvas with a non-negative top and a bottom no greater than 720, centered.
Reserving one height for both rows must fail. `BOUNDARY_SPRITE_NAMES` must be
checked in both directions against what `buildStaticInstances` emits: a missing
boundary piece is reserved for at the wrong row, and an extra one that never
leaves the lot rebuilds the over-reservation. The obsolete tile-only centering
formula must remain observably clipped.

## [L-pages-must-follow-green-ci] A successful static build is not a releasable revision

**What happened.** GitHub Pages deployed `f38c64a` while the CI run for the
same revision failed the desktop camera-extent test. The site remained
playable, but the public release boundary claimed a revision the test boundary
had rejected.

**Root cause.** The Pages workflow and CI both triggered independently on a
push to `main`. Pages only built the static bundle, so it had no dependency on
the CI conclusion and could finish first or succeed while CI failed.

**Prevention rule.** Production Pages builds must be triggered by completion
of the `CI` workflow on `main`, must run only when that CI conclusion is
successful and its event was a push, and must check out the triggering run's
exact `head_sha`. Immediately before deployment, compare that SHA with the live
`main` ref and skip it when an overlapping or re-run CI job has made the
artifact stale. Do not substitute the newest default-branch revision.

**How to verify.** Follow AGENTS.md's delivery rule: with owner merge authority,
passing relevant local checks and no known failures, do not wait for duplicate
remote checks before merging. Publication still requires successful main CI.
Confirm the Pages run's triggering revision, that its actual
`actions/deploy-pages` step ran successfully, and that the public HTML loads
that revision's content-addressed assets. In a controlled test branch, force CI to fail and
confirm the downstream Pages build job is skipped.

**Follow-up, 2026-09-30.** PR 168's Pages run `36823477227` completed with a
successful workflow conclusion but skipped publication: PR 169 had advanced
main from `8ea22167` to `9496d9ac` while it built. An initial delivery update
mistook the workflow conclusion for deployment. The public HTML check caught
the mismatch before closeout. A successful workflow, build, environment record
or enclosing job is not proof that its conditional publication step ran.
Read the step outcome and live assets, and follow the newer tested revision
when the stale-artifact guard skips the old one. Never redeploy the stale
artifact to make its status look complete.

## [L-seated-state-needs-a-seated-silhouette] A socket position cannot make straight legs read as sitting

**What happened.** The first armchair candidate used the right seat socket,
lowered torso, `Sitting` HUD label, and deterministic activity code, but the
played composite still looked like a standing Sim placed in front of a chair.
The legs remained nearly vertical, so the most important anatomical cue
contradicted every technical signal.

**Root cause.** The implementation treated lower hip coordinates and floor
contact as sufficient evidence of a seated pose. Those invariants protected
placement but did not require a visible hip-to-knee-to-foot angle in the final
person-and-furniture composite.

**Prevention rule.** Review body art composited with its real furniture before
accepting an object action. A seated pose must expose an intentional knee angle,
credible cushion contact, and planted shoes without hiding the object. Reject
the slice even when sockets, labels, indices, and tests are correct if the
silhouette tells a different story.

**How to verify.** Run the real action at normal and close zoom, pause both
animation phases, and compare the runtime composite with the pose reference.
The hips must meet the cushion, the knee must visibly break the straight leg
line, the feet must stay near the base, and the chair arms must remain readable.

## [L-audio-follows-fixed-ticks-and-world-boundaries] Audio phase belongs to simulation travel, not rendered frames

**What happened.** The first audio wiring nearly sampled footsteps once per
rendered frame, resolved stable identity through one Rust call per agent on
every tick, stopped all voices when Pause was selected, and reset walking phase
only when a tab became hidden. Each choice looked reasonable alone. Together
they would undercount 2x and 3x travel, become quadratic at town scale, cut off
an already-playing cue when Pause was selected, and let hidden ticks contribute
to the first sound after tab return.

**Root cause.** Playback lifecycle, world lifecycle, and simulation phase were
treated as one concern. They are three. UI audio remains usable while the world
is paused. World replacement changes render rows. Walking phase advances
only with fixed ticks and travelled distance. Browser visibility is an
asynchronous hardware boundary whose stale promises can settle out of order.

**Prevention rule.** Sample movement after every fixed tick and never from a
render frame or paused command flush. Carry stable `SimId` in an aligned render
column, read it with the other row data, and key stride state by that value. Keep
UI and world boundaries distinct.
Gate hidden audio synchronously, serialize context state changes, and clear
stride history on both visibility edges. Keep trusted-gesture recovery armed
after the first successful activation.

**How to verify.** Split identical travel across 1x, 2x, and 3x tick batches and
require identical step indices. Require no `simIdOf` call during steady ticks.
Hide, sample several moving positions, show, and require the first visible
sample to anchor without sound. Reject an automatic foreground resume, then
require a later trusted gesture to recover. Deliberately remove each guard and
require its focused test to fail before restoring the original bytes.

## [L-performance-features-need-a-disabled-baseline] Attribute a regression before blaming the new feature

**What happened.** The first 1,037-entity footstep-sampling browser run exceeded
the 16.6 ms application-work target. The paired run with footstep sampling
disabled missed by the same amount. Profiling the full fixed tick found the
actual cost: 1,000 idle agents scored 34 objects with one A* search per pair,
about 34,000 route searches on a selection tick. Release-WASM fixed-tick p95 was
24.5844 ms. The audio sampler was cheap throughout.

**Root cause.** One absolute performance number answers whether the whole game
meets its frame budget. It does not answer which subsystem caused a miss. A
feature can satisfy its bounded regression budget while an older renderer or
simulation bottleneck fails the application-wide gate. The stale stress comment
still described a one-object lot, so the workload had changed while its cost
model had not.

**Prevention rule.** Keep both gates. Run the identical production scenario
with the feature enabled and explicitly disabled, then report the delta and
both absolute results. When both modes fail similarly, profile the complete
frame and fixed-tick phases before changing the feature under review. Stress
comments and fixtures must name the current object count and the cost it causes.

**How to verify.** Pin entity count, viewport, speed, warm-up, and measurement
window. Require the feature-specific sampler budget and enabled-versus-disabled
delta independently. Also require each whole-frame run to meet the absolute
target. Vary placed-object count across 0, 1, 10, and 34 or profile the selection
phase directly; a cost that scales with agent-object pairs names the subsystem.

The corrective implementation builds one breadth-first distance field per
occupied source tile, scores every object and person from that field, and runs
the existing adjacent A* only for the chosen winner. Exhaustive small-grid tests
require every field distance to match the old A* length. A focused mutation test
requires eight agents on one source tile to build one field and one winning
path, not eight fields or nine paths. After the repair, release-WASM fixed-tick
p95 is 1.3716 ms and the visible production run sustains about 120 animation
frames per second with application-work p95 1.615 ms enabled and 1.640 ms
disabled.

## [L-aligned-row-metadata-beats-repeated-sparse-queries] Recurring row metadata belongs in the row

**What happened.** The first footstep design rebuilt stable identity at startup
and Load by calling `simIdOf` for each render row. Moving those calls into every
fixed tick would have crossed WASM once per row and scanned the Rust ECS query
once per call. At town scale that shape becomes quadratic. Keeping a separate
lookup also made live topology changes a second alignment problem.

**Root cause.** Stable Sim identity was treated as sparse metadata because only
Sims use it. The render buffer is already the authoritative aligned row set;
reconstructing one parallel relationship outside it adds boundary calls and a
new synchronization obligation.

**Prevention rule.** Metadata consumed with every render row travels as an
aligned primitive column. Use an explicit sentinel for rows where it does not
apply. Re-create the zero-copy view after every potentially growing WASM
boundary under [D11]. Reserve sparse lookup calls for infrequent queries rather
than recurring row traversal.

**How to verify.** Render household and object rows together. Require the Sim
rows to expose their authored `SimId`, non-Sim rows to expose `u32::MAX`, and the
WASM pointer to address that exact column rather than entity IDs. Mutate the row
fill to the sentinel, mutate the pointer to entity IDs, use row number in the
footstep sampler, and use entity IDs in the roster; each focused test must fail.
Instrument `simIdOf` during a 600-tick production stress run and require zero
steady-tick calls.

## [L-audio-node-failures-need-transactional-cleanup] Sound failure must remain presentation failure

**What happened.** The first audio implementation caught context creation and
resume failures but allowed a later oscillator or parameter exception to escape
the cue player. A failure after registering a voice could retain dead nodes, and
an exception during fixed-tick sampling could leave the footstep frame open.

**Root cause.** Web Audio node construction was treated as one operation. It is
a sequence of fallible browser calls: allocate, schedule, connect, register,
start, and stop. Catching only the first and last boundary leaves half-built
graphs between them.

**Prevention rule.** Construct every cue transactionally. Track which nodes and
voices exist, disconnect the exact partial state on any failure, close abandoned
contexts, contain final cue errors at the controller, and close sampler frames
in `finally`. Sound may be dropped; the simulation frame may not be dropped.

**How to verify.** Inject failures on the second controller gain, during cue
parameter scheduling, and after a voice is registered but before its stop is
scheduled. Require the context to close, every created node to disconnect, zero
voices to remain, and the sampler end hook to run. Delete each cleanup branch,
paste the actual failing assertion, restore it, and verify exact source hashes.

## [L-paired-facing-sprites-need-the-same-facing-matrix] Parallel sprite fields need parallel facing evidence

**What happened.** The foreground sprite resolver copied the primary sprite's
unsuffixed SE convention and directional suffix rules, but its tests covered
only a placement with no authored facing. Three guard mutations survived: the
SE branch could run always, never run, or invert its comparison. The primary
sprite tests stayed green because they never observed the foreground field.

**Root cause.** Two fields implemented the same presentation rule through
separate branches, while only one field received the complete facing matrix.
Code similarity was mistaken for shared evidence.

**Prevention rule.** When parallel presentation fields resolve from the same
facing, test every supported facing against both fields in the same fixture.
Include the absent-facing fallback and any exceptional naming convention such
as the unsuffixed SE sprite.

**How to verify.** Compile one foreground-bearing placement with no facing and
with SE, SW, NW, and NE. Require the primary and foreground atlas indices to
match their respective variants. Replace the foreground SE guard with true,
false, and `facing != "SE"`; each mutation must fail this test.

## [L-browser-automation-cannot-claim-a-hidden-tab-from-target-placement] A new target is not proof of a hidden document

**What happened.** The audio listening harness needed to prove that hiding the
game suspends its Web Audio context and prevents new voices. Default Playwright
Chrome disables background throttling, so the harness launched ordinary Chrome
and attached over the Chrome DevTools Protocol instead. Four automation routes
created another page: Playwright page creation, raw target creation, a trusted
renderer link, and the exact owned Chrome window's New tab button through
Windows UI Automation. Some routes even proved equal Chrome window IDs and a
selected new tab. Chrome 151 still reported the game document as `visible`.

**Root cause.** Browser target creation, window placement, accessibility
selection, document visibility, and Web Audio lifecycle are separate facts.
Automation can successfully perform the first three without producing the last
two. Counting a created or selected target as a hidden-tab pass would test the
harness's optimism instead of the application.

**Prevention rule.** Hidden-tab acceptance requires direct evidence from every
relevant layer: an ordinary Chrome launch without background-disabling flags,
the same native browser window, `document.visibilityState === "hidden"`, a
suspended game `AudioContext`, and zero new oscillator nodes while semantic
events are attempted. After repeated automated placement failures, stop changing
tab mechanisms. Require one explicit owner tab switch and let the harness verify
the resulting state. Never convert an automation limitation into an application
pass or failure.

**How to verify.** Run `scripts/audio-listening.ps1 -MechanicalOnly`. It must
select a non-sentinel stable Sim ID, stage a real walk, record settings
persistence and `hidden-tab: owner-required`, then exit nonzero. Run the owner
workflow, open exactly one same-window tab when prompted, and require equal CDP
window IDs, hidden document state, suspended context state, zero oscillator
growth across 20 hidden events, visible state on return, running context state
before the recovery event, one foreground recovery oscillator, and a human
judgment that no hidden or catch-up sound occurred.

## [L-listening-fixtures-must-prove-the-audible-identity] An agent row is not necessarily an audible Sim

**What happened.** The first owner-listening setup selected the first render row
whose kind was agent. Under the stress fixture, that row could be a synthetic
agent with the `u32::MAX` no-Sim sentinel. The walk command could therefore be
staged for a row that the stable-identity footstep sampler must deliberately
ignore, producing a silent listening test that looked like an audio failure.

**Root cause.** The fixture selected by broad render kind instead of the exact
identity contract used by the feature. A visually valid agent row is not enough
for audio; footsteps require an authored, stable Sim ID.

**Prevention rule.** A listening fixture must select a row that satisfies every
identity predicate required by the audible path. For footsteps, require agent
kind and a non-sentinel aligned Sim ID. Fail setup immediately if no such row
exists or if the real walk command is not admitted to the command queue. Never
ask a human to diagnose sound from an unproven game state.

**How to verify.** Run the mechanical listening workflow under the stress
fixture. Its report must name the chosen stable Sim ID and record that the real
walk command was staged before any owner prompt appears. Mutate selection back
to the first agent row; the fixture must fail when a sentinel stress row sorts
first instead of continuing into a misleading silent listening session.

## [L-owner-review-requires-a-reachable-build] An acceptance request needs an artifact the owner can open

**What happened.** The audio handoff asked the owner to complete a listening
review after the feature branch was pushed, but the branch had not been merged
or deployed and no local preview was left running. The requested review was
therefore impossible to begin from the supplied handoff.

**Root cause.** Engineering acceptance and owner access were treated as
separate closing steps. The handoff described the listening gate without first
proving that the exact candidate build was reachable through a visible browser.

**Prevention rule.** Before requesting owner visual, interaction, or audio
review, provide a reachable build of the exact candidate. Use a verified local
production preview when merge is blocked, or the verified public deployment
after merge. Open the page for the owner, keep its server alive, and state any
trusted gesture the browser requires.

**How to verify.** Resolve the candidate commit, start its production build on
a dedicated loopback port, require HTTP 200, open that URL in a visible browser,
and confirm the review controls exist. Only then ask the owner to review it.
For public review, cite the successful deployment run tied to the exact merge
SHA and open the mutable Pages site immediately afterward.

**Privacy handoff recurrence, 2026-10-01.** The completion message said the
implementation was ready for review but linked only an evidence document after
stopping the verification server. The owner needed a playable link. Automated
verification cleanup must be followed by a separate owner-review preview when
requesting interactive review. Give its clickable URL in the handoff and keep
that server available. For this correction, the production page and exact
`terri_wasm_bg-C0oUKkc1.wasm` asset both returned HTTP 200 on port 4185.

## [L-isolated-audio-must-work-without-accidental-layering] Judge one voice before a crowd hides its shape

**What happened.** Several overlapping movement cues read as pleasant
footsteps, but one autonomous Sim walking alone produced an unexplained thud
about once per second. The stride scheduler was working as designed: normal
travel crossed its 0.42-tile threshold at roughly that cadence. The cue itself
was a 45 ms sine sweep from about 105 Hz down to 72 Hz, so an isolated event was
almost entirely bass energy. A cluster supplied the rhythm that the single cue
did not contain.

**Root cause.** The listening pass judged the layered result without also
auditioning one semantic voice at its ordinary cadence. Correct scheduling can
still expose a bad sound shape when activity becomes sparse.

**Prevention rule.** Every repeated game cue must pass three listening states:
one isolated event, its normal single-source cadence, and the busiest legal
overlap. Keep sustained activity cues below the fixed-tick rate and represent a
shared scene once rather than once per participant. A crowd must not be needed
to make one cue intelligible.

**How to verify.** Drive one Sim across exactly one stride threshold and require
the scheduled footstep frequencies to remain above the rejected bass-only
range. Then hold one two-Sim conversation and one multi-Sim sleep scene across
their full cadence windows. Require one conversation voice every eight ticks
and one household sleep breath every 30 ticks, with no per-participant doubling
and no retained cadence after Load or background reset. Finish with owner
listening at ordinary Effects volume; frequency assertions cannot decide
whether the result is pleasant.

## [L-audio-cadence-narrows-a-source-but-does-not-name-it] Trace every cue near the reported rhythm

**What happened.** After the bass-heavy footstep was replaced, the owner heard
another intermittent thud at roughly one-second intervals. The closest code
match was not another stride. Exercise emitted a square pulse from 150 to 210
Hz every seven fixed ticks, or 0.7 seconds at normal simulation cadence, while
the visible pedal pose held for eight ticks. An
autonomous Sim using the bike made that cue appear only sometimes, which made
it sound unexplained when attention was elsewhere.

**Root cause.** The investigation initially associated rhythm with footsteps
instead of comparing every cue whose scheduled period and bass content fit the
report. Timing is useful evidence, but several systems can share a cadence. The
sound scheduler also duplicated an animation interval as a different literal,
so the audible cue drifted against the pedal motion.

**Prevention rule.** When a repeated sound is reported without an obvious
source, list every semantic cue within the reported cadence range, then compare
waveform, frequency, gain, and the gameplay condition that activates it. Do not
name the source from rhythm alone. Give each low-frequency repeated cue an
isolated scenario before combining it with autonomous play.

**How to verify.** Hold one Sim in the exercise action and suppress unrelated
movement. The candidate must use the 520 to 340 Hz triangle sweep at 0.014 peak
gain on the shared eight-tick pedal-frame interval, never the rejected 150 to
210 Hz square pulse. Then listen during ordinary
autonomous play and confirm the periodic thud is gone. The numeric assertion
proves the rejected shape cannot return; only owner listening can accept the
replacement.

## [L-hidden-radio-harnesses-must-use-the-widget-event] Drive the control contract, not an invisible input box

**What happened.** The ordinary-Chrome audio listening harness tried to select
3x with Playwright's `check()` operation. The speed radio is intentionally
absolute-positioned, transparent, and unable to receive pointer events. Its
following 44-pixel label is the player-facing target. Playwright resolved the
input but repeatedly reported that the Pause label intercepted its synthetic
click.

**Root cause.** The listening harness treated an invisible form input as a
click target even though this widget's actual contract is the input's checked
state followed by its `change` event. The sibling performance harness already
used that contract, but the listening path had drifted.

**Prevention rule.** When browser verification drives a visually hidden native
input, do not aim pointer automation at its invisible box. Reuse the same
programmatic checked-state and bubbling `change` event path across every harness,
or click the visible associated label when the purpose of the test is pointer
hit testing. Audit sibling entry points before accepting a browser-control fix.

**How to verify.** Run `scripts/audio-listening.ps1 -MechanicalOnly` in ordinary
Chrome. Every Pause, 1x, 2x, and 3x transition must complete without an
intercepted-pointer timeout, and the resulting report must still show a staged
walk plus persisted audio settings. A separate screenshot run should reach the
exercise action and capture rendered canvas pixels after the 3x change.

## [L-listening-evidence-must-name-the-cue-and-action] An oscillator does not identify what the player heard

**What happened.** Conversation, sleep, eating, reading, and exercise had unit
coverage, but the owner could hear only footsteps during ordinary play. The
listening harness staged a walking command and watched Web Audio globally. It
did not put each other action into a known live render state, and an oscillator
count could not distinguish the requested cue from autonomous footsteps or a
different activity cue.

**Root cause.** The browser proof stopped at two weak signals: command queuing
and anonymous audio-node creation. A queued command may later be dropped, while
an oscillator proves only that some procedural cue started. Silence was treated
as gain alone even though retained cadence is also presentation state.

**Prevention rule.** An activity-listening fixture must discover Sims and
interactions from fresh bridge views, stage one exact command, observe the
intended entity's exact visual action and activity, require the named semantic
cue counter to increase, and require Chrome to report a new oscillator. Reset
every cadence scheduler on both edges of master mute and Effects zero so the
first audible tick describes the action currently on screen. Keep acoustic
isolation as a separate claim until the harness can prove it.

**How to verify.** Run `scripts/audio-listening.ps1 -MechanicalOnly` in
ordinary Chrome. Walking, conversation, eating, standing reading, exercise,
and lower-bunk sleep must each pass exact render-state, semantic-cue, and Web
Audio checks. The run must still report `hidden-tab: owner-required` rather
than converting the browser automation limitation into a pass. Then run the
owner workflow and judge each isolated sample at 1x.

## [L-routine-events-do-not-all-need-cues] Semantic feedback is not a demand for a click sound

**What happened.** Successful commands, menu choices, speed changes, unmute,
and Effects release all played the same short confirmation tone. At that
frequency the cue became clutter, and its character sounded more like failure
than success.

**Root cause.** The event-to-cue mapping treated every staged command and
completed control as an audible event. Semantic events are useful for state,
testing, and accessibility even when silence is the correct sound design.

**Prevention rule.** Do not map broad success or completion categories to a
blanket click. Routine success remains silent unless a control has a specific
sound-design reason to speak. Reserve the current interface cue for rejected
actions and keep it brief and lower in gain.

**How to verify.** After audio unlock, emit `command.staged` and `ui.confirmed`
and require zero oscillator creation. Emit `command.rejected` and require one
90 ms triangle voice from 520 to 680 Hz at 0.07 peak gain. In the owner workflow,
change speed, release Effects, and unmute without hearing a cue; then attempt
Clear orders with no selected Sim and hear one quiet rejection.

## [L-audio-isolation-must-respect-live-action-ownership] A spare bed is not a universal mute button

**What happened.** The listening harness tried three times to park unrelated
Sims on the double bed before each activity sample. One run was blocked by Help;
two more timed out after command cancellation because a Sim's self-chosen live
action could continue and consume the bed's limited interaction capacity.

**Root cause.** The setup assumed cancelling queued intents interrupted the
currently chosen action, and it assumed one object could accept every unrelated
Sim. Neither assumption belongs to the bridge contract.

**Prevention rule.** Do not isolate a listening fixture by issuing unrelated
gameplay commands unless current-action interruption and target capacity are
both explicit, tested contracts. Preserve exact action, semantic cue, and Web
Audio evidence, but describe acoustic isolation as open when autonomous sources
can still overlap.

**How to verify.** The listening driver contains no parking helper or parking
claim. Its mechanical run stages every named activity successfully without
waiting for unrelated Sims to occupy the bed, while the owner instructions do
not claim that other autonomous sounds have been suppressed.

## [L-approval-gated-network-tests-must-inject-the-network] An approval-shaped flag is not a safe test boundary

**What happened.** A duplicate-pack regression test spawned the real CC0 intake
CLI with its approval flag. The duplicate preflight did not exist yet, so the
first occurrence downloaded a 2.9 MB archive into a unique temporary directory
before the second occurrence failed. The file did not enter the repository,
but the network request itself was outside the owner's approval.

**Root cause.** The test relied on expected validation order to prevent a real
side effect. Passing a production approval-shaped flag to a subprocess left
the global `fetch` implementation live. The test was intended to prove that
network was unreachable, but its design gave the network no enforceable test
double.

**Prevention rule.** Never run an approval-bearing CLI path in a test while its
real network, billing, publishing, or destructive dependency is available.
Expose an in-process runner, inject a dependency that throws if called, and
assert that its call count remains zero. Keep subprocess tests on read-only or
explicitly refused paths. Owner approval must come from the conversation and
cannot be manufactured by a test argument.

**How to verify.** Call the intake runner with duplicate and unknown IDs plus an
injected fetch function that increments a counter and throws. Both requests
must fail with their preflight error and leave the counter at zero. The only
subprocess cases may list the manifest or prove that a download without the
approval flag is refused.

## [L-delegated-workspace-management] Routine workspace work is not an owner approval gate

**What happened.** Animation work stopped to ask about creating a clean worktree
after the owner had already approved the model and asked for continued execution.
The owner had to return and explicitly repeat that workspace management was
delegated.

**Root cause.** Preserving a dirty checkout was confused with needing a new
product decision. Creating an isolated worktree from a verified baseline did
not require the owner to choose an animation direction or accept a risk to
their existing edits.

**Prevention rule.** Once routine workspace management is delegated, inspect
the branch, preserve existing edits, create the isolated worktree and continue.
Keep actual approval boundaries separate: new spending, foreground computer
control, destructive changes and decisions outside the approved scope.

**How to verify.** Record the new branch and baseline check, then compare the
original checkout's status before and after. The next owner message should
concern an artifact or a real blocker, not permission to resume authorized work.

## [L-atlas-straight-alpha-copy] Packing RGBA frames must not apply alpha twice

**What happened.** Preparing smooth Blender frames exposed an atlas compositor
that pasted each RGBA crop using that same crop as its mask. A pixel with alpha
128 became alpha 64 and its color channels were halved.

**Root cause.** A compositing operation was used where non-overlapping atlas
rectangles required an exact byte copy. Existing opaque sprites concealed the
error. The two translucent crops, `bookcaseClosedWide` and `aquariumCabinet1`,
also passed through it.

**Prevention rule.** Copy non-overlapping RGBA atlas rectangles without a
second alpha mask. Preserve fractional alpha from the source renderer through
the PNG export and atlas assembly.

**How to verify.** `test_compose_preserves_straight_rgba` must fail when the
source crop is restored as the paste mask. Check atlas freshness afterward.
The corrected alpha changes the two existing translucent crops but does not
change their source art, dimensions, names or indices.

## [L-rig-pixel-registration] A preview crop is not a physical ground anchor

**What happened.** The approved idle preview used [19,88] as a bottom-centre
anchor. Compositing it with real furniture put the character about twelve
pixels too low. Padded animation canvases introduced another apparent shift.

**Root cause.** Image boundaries were treated as model landmarks. Furniture
also uses 38 vertical pixels per unit while the model camera projects about
34.147, so equal source Z values did not establish matching seat height.

**Prevention rule.** Project the model origin through the actual camera, add
the renderer's 21-pixel tile-front drop, and record that physical pixel anchor.
Allow fractional anchors outside the crop. Share registration between drawing,
picking and attachments; use opaque content bounds for bubbles. Convert source
units before claiming furniture contact, then inspect a real composite.

**How to verify.** Test padded and unpadded landmark equality at several zoom
levels, negative-direction gait and save/load reconstruction. Render chair and
bed composites using compiled sockets and the same registration math.

## [L-held-prop-depth] A correct hand coordinate does not establish occlusion

**What happened.** Eating food tracked the exported grip but appeared over the
back of the head in a rear-facing view.

**Root cause.** The held-prop renderer always put food in front of the entire
body, regardless of the camera-space hand position.

**Prevention rule.** Export the grip's depth order with its coordinates and use
the same selected body sample for both. Never hide a depth defect by moving the
food away from the hand. A single body/prop order must still be visually checked
for cases requiring more detailed occlusion.

**How to verify.** Inspect snack and dinner composites for every facing and
sample. Tests must cover both front and rear depth signs, preserve layer ordering,
and keep the selection ring at the physical ground point.

## [L-toon-shirt-palette] Inspect the controlling shader before recoloring

**What happened.** Shirt-variant setup assumed a standard Principled shader,
then tried the Emission input. Three setup attempts failed before rendering;
the linked-input guard prevented a misleading export.

**Root cause.** The approved toon material uses a Color Ramp upstream of
Emission. Neither a presumed Principled color nor the linked Emission default
owns the visible shirt color.

**Prevention rule.** Inspect the actual graph first. For this model, transform
only the original shirt ramps' RGB values, retaining positions, interpolation,
alpha and links. After three similar failures, obtain fresh-context review
before another attempt. Preserve each source palette independently so a red
variant cannot accidentally inherit the previous blue transformation.

**How to verify.** Assert the expected linked graph, compare all non-shirt
material state and model geometry, preserve source/green-export hashes, and
inspect the rendered colors at native size. Preserving per-channel shading
ratios is not a claim that different colors have identical perceived brightness.

## [L-rider-fit-needs-the-lot] Isolated contact can pass while the wall fails

**What happened.** Two rider fits put the original bike grips in the approved
character's head. Moving the controls forward cleared the isolated model, but
the played scene hid the console and bars inside the adjacent divider wall.

**Root cause.** Contact was fitted in a model-and-prop image without the lot's
spatial envelope. A projected hand target also left its three-dimensional
depth underconstrained; exact pixel coincidence did not prove a plausible arm.

**Prevention rule.** Fit the character, reachable controls and neighboring
surfaces together. Preserve save-compatible positions and footprints. After
three related failures, use fresh-context architectural review before another
variation. Do not force every part visible when correct occlusion hides it,
and do not treat a mirrored prop as a four-facing model.

**How to verify.** Check one occupied and one unoccupied SE view against the
actual wall before exporting all palettes. Verify anatomical reach, projected
contact, head clearance, and visible attachment, then repeat in the played
build. Keep failed facings and rejected previews labeled as failures.

## [L-hashed-source-checkout] Byte proofs must survive Git checkout

**What happened.** Final staging normalized the approved source manifest's
Windows newlines, changing its bytes. The preservation proof also contained
Windows path separators that a Linux checkout would treat as filename text.

**Root cause.** Raw-file hashes and host-native path strings were combined
with a repository-wide text normalization rule.

**Prevention rule.** Mark immutable byte-hashed source artifacts `-text` where
their original bytes must remain unchanged. Emit portable relative paths with
`as_posix()`. Do not update approved-source hashes merely to excuse checkout
changes. This exception applies only to the accepted source manifest, not to
ordinary code or documentation.

**How to verify.** Compare the source file's raw Git object ID with its staged
object ID, then run preservation checks against files exported from the index.
After changing attributes, explicitly restage the affected artifact with
`git add --renormalize`; ordinary staging can retain its old normalized blob.
Run the same tests in Linux CI before publishing.

## [L-atlas-buffer-comparison] Compare binary assets as bytes

**What happened.** The web CI atlas test exceeded its five-second limit after
the character atlas grew to 1,451,685 bytes. All other 533 web tests passed.

**Root cause.** Generic recursive `toEqual` walked the PNG's Buffer entries.
The same assertion took 2.8 seconds locally, versus 5 milliseconds for the
test using native `Buffer.equals`. The CI failure reported a timeout, not a
hash mismatch.

**Prevention rule.** Use direct byte equality for binary artifacts. Preserve
the independent SHA-256 and served-filename assertions; do not extend the
timeout or replace exact equality with a visual tolerance.

**How to verify.** Flip one byte in the in-memory served PNG and run the
content-address test: it must fail with `expected false to be true`. Restore
the mutation and run the full web suite, then confirm Linux CI passes.

## [L-empty-reference-visibility] Hide a reference collection, not driven object flags

**What happened.** The first empty furniture renders retained floating eye
outlines from the Sim used for fitting, although the preview set each mesh's
`hide_render` flag. The occupied renders were unaffected.

**Root cause.** Saved visibility drivers re-evaluated during rendering and
overrode the individual object flags. An empty-view switch competed with the
accepted model's expression and prop visibility ownership.

**Prevention rule.** Move the complete Sim reference into a dedicated collection
and hide that collection for empty views. Preserve the individual driven state.
Never remove stray pixels from an image to disguise faulty scene visibility.

**How to verify.** Render every empty facing and inspect the full canvas,
including above the object. Then restore the collection and check the occupied
expressions and props. Hash and nonempty-image checks alone cannot catch this.

## [L-drape-support-has-width] A correct cloth section does not prove a supported towel

**What happened.** A towel's U-shaped section cleared its handle tube, but the
sheet extended along the handle into its upward bend. The assumed support was
straight while the actual tube changed height across the towel's width.

**Root cause.** A two-dimensional section test was treated as proof for the
whole three-dimensional attachment.

**Prevention rule.** Give the towel an actual straight support segment, keep
its full width inside that segment, and leave the gripping area clear. Test
the width and section independently. Do not call a constructed drape a cloth
simulation.

**How to verify.** Trace the actual support endpoints and tube radius against
the complete cloth surface, then inspect the fold and both tails from all four
rotations. A passing radius test alone is insufficient.

## [L-boundary-panel-endpoints] A corner post cannot close a gap between panel ends

**What happened:** the back corner had a visible gap and a stray upright;
both open ends exposed triangular floor wedges beyond the wall bases.

**Root cause:** tile-centred panels were placed at x = -1 and y = -1,
while the floor ring extended to -1.5. Both runs also omitted their corner
segment. The narrow corner sprite could not span the missing half-panels.

**Prevention rule:** derive exterior wall placement from the slab edges and
check actual panel endpoints. Keep integer lighting samples separate from
fractional draw positions, and update both camera framing and pan bounds
when the topmost panel anchor changes.

**How to verify:** run the tile and camera tests; removing the outward
half-tile shift, omitting a corner segment, or restoring the old camera
headroom must fail. Inspect all three corners in the rendered build at
native and fractional zoom. See `docs/wall-boundary-verification.md`.


## [L-joined-walls-and-atlas-gutters] Wall connectivity and texture sampling both affect seams

**What happened:** interior dividers stopped short at junctions, doorway
sprites drew full-height seams beside their openings, and fractional zoom
revealed dark lines between otherwise touching wall panels.

**Root cause:** choosing one straight panel discarded junction arms; outlining
every doorway polygon also outlined its shared edges. Linear filtering then
sampled transparent atlas gutters at sprite boundaries. Atlas-wide sampler
clamping did not constrain samples to the individual sprite rectangle.

**Prevention rule:** represent all incident arms in a joined sprite, outline
only exposed doorway edges, and clamp filtered samples to the sprite's edge
texel centres. Preserve the existing atlas prefix when adding architecture.
When another branch has already appended animation records, append new wall
records after that complete upstream prefix. Resolve the generator sources,
then regenerate outputs; verify upstream pixels, indices and animation tables
against the fetched commit before publishing.

**How to verify:** test every elbow, T and crossroad, compare door seam pixels
with straight wall pixels, and inspect fractional zoom. A 106-pixel wall strip
contained four dark seam pixels before the shader clamp and none afterward.
Removing junction selection, the shader clamp, a visible arm, or the pixel
preservation guard must fail the relevant regression check. Require the named
assertion to fail; a worker-start timeout is not a caught mutation.

## [L-rider-shoe-envelope] Pedal contact points do not prove shoe clearance

**What happened.** The approved bike still looked plausible at the review pose,
but evaluated shoe meshes intersected the flywheel housing throughout a cycle.

**Root cause.** The pedal centres cleared the housing while the shoes' inward
extent did not. Point constraints cannot establish clearance for a solid foot.

**Prevention rule.** Fit pedal spacing to the full evaluated shoe envelope and
include the wheel covers, not only the main housing. Extend the pedal spindles
physically; do not hide intersections with sprite masks or change the Sim.

**How to verify.** Test the inward envelope against the outer wheel face, then
check evaluated mesh intersections at sixteen phases. Inspect the full cycle
from all four cameras before accepting the exported animation.

The same probe must measure the evaluated sole underside against the pedal
top. An ankle joint is not a contact surface. The original guessed ankle height
embedded the sole by 0.02835 units; the approved shoe's measured ankle-to-sole
offset is 0.110852 units. Include both lateral and vertical checks before a batch.

## [L-portable-artifact-proof-paths] Shared manifests need platform-neutral paths

**What happened.** A density export passed on Windows but its proof JSON used
backslashes, which the Linux test runner would treat as filename characters.

**Root cause.** Native `str(Path)` formatting leaked into a shared file format.

**Prevention rule.** Serialize relative artifact paths with `.as_posix()` and
keep native filesystem paths out of portable manifests.

**How to verify.** Test both Windows and POSIX path serialization, reject
backslashes in committed artifact references, and verify every referenced hash.

The door exporter repeated this defect because its input hashes used native
path strings and the Windows asset checks only tested local resolution. Door
manifest tests now interpret references as POSIX paths even on Windows and
reject backslashes, absolute paths and parent traversal. Keep this check at
the serialized boundary rather than normalizing invalid references in consumers.

## [L-independent-render-validation] A correct composite can hide incorrect ownership

**What happened.** Adversarial review showed that swapping the Sim and furniture
layers still passed their reconstruction comparison. The contact checker also
accepted matching sole/pedal heights without proving horizontal support.

**Root cause.** Addition is symmetric, so reconstruction cannot identify which
layer belongs to which object. A height comparison omits two spatial axes, and
an empty obstacle list makes collision testing vacuously pass.

**Prevention rule.** Check ownership independently: furniture and outline pixels
must remain identical across shirt palettes, while the visible Sim contribution
must change. Cast through the pedal centre to the evaluated sole, require the
expected obstacle/shoe inventory, and retain mesh-intersection checks.

**How to verify.** Swap owners, zero the body, move a pedal sideways, and remove
the obstacle inventory. Each must fail its named guard. Restore the original
bindings and confirm both unchanged source bytes and a passing ordinary run.
The 2026-09-10 scene mutations rejected a 0.5-unit lateral displacement and all
six renamed obstacles; the restored sixteen-phase scene passed.

## [L-complete-render-inputs] Hash the render dependency closure before a batch

**What happened.** The first furniture journal hashed five scripts and the rig,
but omitted imported pose/palette helpers and camera registration data.

**Root cause.** The journal tracked obvious entry points rather than every input
that could alter a pixel. A resumed batch could otherwise mix incompatible
poses or camera settings.

**Prevention rule.** Use the dependency wrapper before rendering and check the
same set afterward and on resume. Record Blender build and colour-management
settings. Preserve an old incomplete journal and label supplemental post-render
verification as post-render; never claim it recorded history it did not observe.

**How to verify.** Change a dependency hash or leave the generation proof in its
running state. Export must reject it. Existing batch supplemental evidence
explicitly records the narrower Git comparison and its historical limitation.

## [L-authored-action-before-name] Resolve visual actions before inferring transitions

**What happened.** Review raised a possible sit-pose regression for the reading
chair from the interaction name `settle_in`.

**Root cause.** The name suggested a transition, but shipped content declares
`read` and the Rust projection maps it directly to the reading visual action.

**Prevention rule.** Trace the authored action and its runtime projection before
adding animation scope or reporting a missing transition.

**How to verify.** Inspect the exact object's interaction declaration and the
corresponding compiled-action mapping, not a similarly named test fixture.

## [L-motion-direction-review] Correct poses can still play in the wrong direction

**What happened.** The owner spotted backward pedalling after the bike's poses,
contacts, facings and compositing had passed review.

**Root cause.** Still-image review established physical contact but did not
establish the intended direction of travel through the cycle. Increasing source
phase moved the top pedal toward the rear of the bike rather than the front.

**Prevention rule.** Review the temporal sequence as well as each pose. At the
top of a forward pedal cycle, the pedal must next travel toward the handlebars.
The runtime bike order is now 0,7,6,5,4,3,2,1; source phase zero remains the
resting/reduced-motion pose. Chair order, geometry and sprite identities stay
unchanged.

**How to verify.** Assert the complete cycling order for every facing and shirt
colour, assert reading order stays 0,1,2,3, then play the built animation. A
paused pose or an unordered contact sheet cannot satisfy this check.

## [L-wall-corner-definition] Closed joins still need a visible change of plane

**What happened:** continuous wall faces blended together at actual corners
after the unwanted panel seams were removed.

**Root cause:** both wall axes shared one flat face color. Removing every
vertical mark also removed the cue that distinguished adjoining planes.

**Prevention rule:** shade actual junctions and connecting end panels, rather
than every tile seam. Keep the fold inside the existing silhouette. The
south-west elbow has both arms on the left in screen space, so its soft
shadow must extend left as well.

**How to verify:** inspect the back corner, both exterior divider joins and
interior junctions in flat and night lighting. Pixel tests require visible
contrast within three columns and an unchanged alpha mask. Removing the
crease must fail both tests. Straight walls, doorways and non-wall assets
must retain their prior pixels.

**Visibility correction:** the first corner pass also marked rear T-junctions.
Connectivity alone does not prove a visible corner: a north branch behind an
east-west run, or a west branch behind a north-south run, leaves the near face
flat. Suppress the crease in these two cases. The regression renders both
orientations and requires exact agreement with the unshaded wall, while
separate contrast checks retain the approved creases on visible corners.

## [L-audio-target-interaction-must-match-action-state] Validate each side of a compound identity guard

**What happened.** The mutation gate changed the ordinary object-sound guard
from rejecting either a chain sentinel or an interaction mismatch to rejecting
only when both conditions were true. Existing sound tests still passed.

**Root cause.** The malformed fixtures covered a missing SmartObject and a
wrong object role, but every ordinary fixture used matching interaction indices.
They never isolated the second half of the compound guard with an otherwise
valid sound-producing object and target.

**Prevention rule.** When presentation state is valid only if two independently
owned identities agree, test each mismatch separately while every later lookup
would otherwise succeed. A fixture that fails an earlier lookup cannot prove a
later identity guard.

**How to verify.** Give the ordinary sound projection helper one interaction
index and its valid shower target another. The helper must return no sound.
Changing the guard's `||` to `&&` must make that focused regression fail by
projecting the shower sound from mismatched state. Keep a separate render-sync
test for the public buffer contract; outer presentation policy can suppress a
malformed combination before it exposes this lower-level identity defect.

**Outer projection correction.** The helper test cannot protect the call-site
eligibility guard. Include a non-agent render row carrying otherwise valid
ordinary-action and shower-target components; it must still project no sound.
Changing either outer `&&` to `||` must make that render-buffer regression fail.

## [L-audio-boundaries-and-proofs-must-cover-every-scheduler] Scheduler families change as one contract

**What happened.** Recovery from an externally suspended browser audio context
reset object-sound state but retained footstep and activity cadence. The
retained-memory proof also measured footsteps and object sounds while omitting
personal-activity track count and capacity.

**Root cause.** Activity and object schedulers were added after the original
footstep lifecycle. Two explicit scheduler lists evolved independently: the
audible re-entry branch and the browser proof's diagnostics. Each list was
partially updated, so neither represented the complete controller contract.

**Prevention rule.** Explicit global lifecycle boundaries use the controller's
single all-scheduler reset. Fixed-tick observations must also apply the same
availability gate to every scheduler, so automatic context recovery cannot
retain silent history. Every bounded-state proof must sample
and constrain every retained scheduler's live count and capacity. Adding a
scheduler requires updating both contracts in the same change.

A category gain adjustment is different: Voices can reach zero while the global
audio context and simulation remain active. Keep its bounded transport running
and do not reset unrelated footsteps or personal activity. Master mute, Effects
zero, backgrounding and world replacement still use the global lifecycle.

**How to verify.** Populate footstep, personal-activity, and object-sound state;
externally suspend the context; continue sampling while inaudible; then recover
through a trusted gesture. Recovery must clear all three schedulers, the next
footstep must anchor without playing, and the current personal activity must
restart at entry cadence. The browser memory report must include stable
footstep, activity, and object-sound capacities and bounds of three, three, and
two live tracks respectively.

## [L-duration-ticks-prices-and-advertises] An interaction's duration is two knobs wearing one name

**What happened.** The voice clips took over how long a conversation runs,
stretching a chat from about 3.5 seconds to about 6.7. To stop conversations
paying out double, `chat`'s `duration_ticks` was raised from 40 to 67 and the
advert was left alone. That was described, in advance and in writing, as
holding the economy still while only the length changed. It did nothing of the
kind: sims stopped talking altogether, and
`every_tick_of_a_played_stretch_produces_a_loadable_save` failed with "nobody
walked over to talk in 2000 ticks".

**Root cause.** `duration_ticks` is read by two systems that want opposite
things from it. `tick_interactions` divides the advert by it to get a delivery
RATE, so raising it pays out less per tick. `score_advertisement` also divides
by it - the score is `urgency * delta / (travel + duration_ticks + 1)` - so
raising it makes the interaction less ATTRACTIVE. Raising the duration alone
dropped chat from 0.75 social a tick to 0.448, just below the television's
0.436, and selection stopped choosing the thing it was supposed to prefer.

The deeper error was the framing offered before any code was written. Holding
the per-tick rate and holding the per-conversation total are mutually exclusive
once the real duration doubles, because payout is rate times duration. The
option presented as "keeps the balance where it was tuned" was not available at
all; only a choice between two different balances was.

**Prevention rule.** Never change `duration_ticks` without scaling
`advertises` by the same factor, unless making the interaction less attractive
is the actual intent. Know what that scaling does and does not buy: it holds
the delivery rate exactly, and it holds the SCORE only at zero distance,
because scoring divides by `travel_ticks + duration_ticks + 1`. A longer
interaction scaled this way becomes progressively more attractive the further
a sim has to walk to reach it. Anything paid once per completion rather than
per tick - relationship gain, the hobby payout - also arrives less often per
unit of played time, in proportion to the length change. The rate is what the content comments pin and what fixes
the ordering between competing interactions; the total per use follows from the
rate and the length and cannot be pinned separately. Before offering a tuning
option, check every system that reads the number, not just the one the change
is about.

**How to verify.** Change a `duration_ticks` in `content/` without touching its
`advertises`, and run `cargo test -p terri-sim --lib`. If nothing fails, the
interaction was not one anybody chose. For `chat` specifically, the guard is
`every_tick_of_a_played_stretch_produces_a_loadable_save`, which asserts its
own fixture is not vacuous and therefore notices when sims stop socialising.

## [L-a-blocked-browser-promise-may-never-settle] Caching an in-flight promise assumes it settles

**What happened.** Sound never played on Android and no later tap recovered it,
while desktop was unaffected. The audio unlock was wired to `pointerdown`,
which grants user activation for a mouse and never for a finger, so on a phone
`AudioContext.resume()` was called with nothing behind it. That alone would
have been a missed tap. What made it permanent was the controller caching the
returned promise and handing it to every later gesture: Chrome does not reject
a blocked resume, it parks the resolver and never settles the promise, so the
cache never cleared and no later gesture ever reached the browser again.

Audio was also wired last in startup, after the WASM, WebGPU and atlas awaits,
so a gesture during a slow phone load was discarded and any startup failure
took audio down with it.

**Root cause.** Two assumptions, neither stated and neither tested. First, that
an operation which fails does so observably; the existing test covered a resume
that *rejects*, which settles, and never covered one that hangs. Second, that
the set of events granting user activation could be modelled in a local
allowlist; the real rule includes clauses a list cannot carry, such as Blink
withholding activation when a scroll claimed the gesture.

**Prevention rule.** Never cache an in-flight promise returned by a browser API
whose failure mode is "does nothing". Let each user gesture make its own call
and keep failure free. Where the browser publishes the state a gate consults,
read that state rather than predicting it: `navigator.userActivation.isActive`
is the flag the autoplay gate itself uses. Wire anything that depends on a user
gesture before the awaits that can throw or take seconds.

**How to verify.** Give the fake context a `resume()` that returns a promise
which never settles. Two successive `unlockFromGesture()` calls must produce
two `resume()` calls; restoring the cached-attempt branch must make that fail
with one. Separately, a `pointerup` reported by the browser as carrying no
activation must produce no attempt at all.

**Investigation correction.** A measurement taken to refute the activation
theory showed `isActive` true during a touch `pointerdown`, which looked
decisive and was worthless: the same sample had `hasBeenActive` already true,
so the page had been activated earlier and the transient window was simply
still open. Any reading about what a gesture granted requires proving the page
was virgin first. The same run also reported no context being built at all,
which was a race against startup rather than a finding. Check the preconditions
of a surprising measurement before letting it overturn a mechanism you can read
in the browser's own source.

## [L-measuring-a-control-is-not-operating-it] Click the button before calling it fixed

**What happened.** The help dialog was restyled to centre it and pin its
confirm button. Acceptance measured the button's rectangle against the dialog
and the viewport, at two viewport sizes, and read the markup and the CSS. All
of it passed, and the button was dead: "Got it" closed the dialog and the
dialog stayed on screen, then reappeared on every later load despite the
dismissal being stored.

**Root cause.** The restyle put `display: flex` on the dialog to build its
header, scrolling body and pinned footer. A browser hides a closed dialog with
`dialog:not([open]) { display: none }` from its own stylesheet, and an
unconditional author `display` outranks that, so the element kept rendering
after `close()`. Every part of the behaviour worked except the one that was
never exercised: the click, the `close()`, and the stored preference were all
correct.

The acceptance gap is the general point. Geometry, computed styles, markup
structure and the unit tests all describe the control at rest. None of them
operates it. A control that is measured but never used is not verified, and a
styling change to a `<dialog>`, `<details>`, `<select>` or anything else whose
open and closed states the browser styles for you is exactly where that gap
bites, because the failure appears only in the state the check never entered.

**Prevention rule.** Acceptance for an interactive element has to include
driving it: activate the control, then assert the resulting state, not only
the state it started in. For anything with a browser-managed open or closed
state, assert the closed state explicitly, because that is the one an author
`display` rule silently captures. Never set an unconditional `display` on a
`<dialog>`; key layout declarations to `[open]`.

**How to verify.** Dismiss the dialog and require `getComputedStyle(dialog)
.display` to be `none` and its bounding height to be zero, not merely that
`dialog.open` went false. Reload afterwards and require it stays closed.
Reopen it and require it returns at the first instruction. Moving the layout
`display` back onto the unconditional rule must fail the closed-state check.

**Related.** A stale module in an already-open browser tab reported a
constructor arity error from a file that had since been corrected, which sent
the first minutes of this investigation at a phantom. Confirm what the server
actually serves, and retest in a fresh tab, before believing a console trace
that names a file you have already fixed.

---

## [L-a-mode-must-cover-every-order-it-names] Queue mode queued objects and replaced talks

**What happened.** The Queue button and the Ctrl or Cmd modifier were
documented as appending each new order. The object branch of the flyout
dispatcher honoured that. The talk branch sent a cancel before every talk
order regardless, with a comment saying Queue mode "only applies to object
actions". Five Chat picks in Queue mode were one chat five times over, and
the player's report was that queueing "doesn't seem to actually queue". It
shipped that way because the branch had a test pinning the exception, so the
suite was green while the mode lied.

**Root cause.** A player-facing mode was implemented per command kind rather
than at the one place every order passes through. The exception was
deliberate, tested and documented in a code comment, and never written where
the player could read it: the glossary and the Help text both said "each new
order". A tested exception to a rule the player is told is a bug with a
receipt.

**Prevention rule.** A mode the player can see applies to every order it
names, or the player-visible text says which orders it does not. Implement
such a mode at the single dispatch point that every order variant calls, so a
new order kind cannot opt out by accident. When a code comment says a mode
"only applies to" some subset, check the glossary and the Help text say the
same; if they do not, the comment is the defect.

**How to verify.** In Queue mode, pick the same talk row several times and
count conversations: each pick must become its own conversation, in sequence.
`a_run_of_queued_chat_orders_runs_as_that_many_separate_conversations_in_sequence`
pins it against the simulation, and the `dispatchMenuAction` suite pins that
the shell sends one append per pick with no cancel among them.

---

## [L-asset-checkpoint-status] Historical visual gates need an explicit date and scope

**What happened.** The furniture README still described game-scale and played
checks as open after later evidence recorded them. The provenance overview
also retained the pre-wall atlas count of 1,087 rather than 1,089.

**Root cause.** An offline review's limitations were written as current status,
then the later runtime evidence was recorded elsewhere without reconciling
the overview.

**Prevention rule.** Preserve historical evidence, but label its scope and link
to the later checks. Update the current provenance overview when an accepted
asset batch changes. Keep pending replacements explicitly separate from the
integrated production set.

**How to verify.** Compare the current overview with the committed atlas and
latest played evidence. Search authoring READMEs for unresolved-gate wording
and check whether it describes a dated checkpoint or an actual remaining task.
Never infer a successful deployment from either an offline render or a commit.

## [L-small-model-attachments] Small details still need physical support

**What happened.** The first stove candidate looked coherent at game scale,
but independent review found knob indicators in front of their supporting
faces. Follow-up geometry inspection found coil rings above their burner wells.

**Root cause.** Small decorative parts were positioned by centre coordinates
without checking their full extents against the surfaces supporting them.
Downsampling hid the gaps rather than correcting them.

**Prevention rule.** Check contacts in the saved scene, not only in the source
script or final sprite. Preserve rejected candidates so a new guard can prove
it fails on the original defect. Smooth shading alone does not guarantee that
an outline renderer will remove every small contour mark.

**How to verify.** Run the saved-scene attachment checker against both retained
stove candidates. Candidate 01 must fail 12 coil and four indicator contacts;
candidate 02 must pass. Inspect the high-resolution source and game-size views
separately and record any residual contour defect without calling it fixed.

---

## [L-static-prop-review-guards] Model review must survive atlas import

**What happened.** The refrigerator looked correct in four source views, but
its initial import made transparent canvas margins clickable. Adversarial
review then demonstrated that mirroring survived a symmetric image fixture,
and a changed camera proof still carried the same acceptance status.

**Root cause.** Source appearance, input hit boxes and provenance are separate
contracts. Uniform rectangles cannot reveal reflection. Projected origin alone
does not establish camera scale or perspective, and a review label does not
bind to the exact reviewed batch.

**Prevention rule.** Export visible alpha bounds alongside padded sprites.
Use off-centre landmarks in transformation fixtures. Bind acceptance to the
canonical proof digest and validate image hashes separately. Derive runtime
anchors from both camera projection and shader placement: this renderer adds
21 logical pixels before subtracting the sprite anchor, so bare projected
origin is not the runtime anchor.

**How to verify.** Click visible content and blank margins in all four facings.
Run `check_prop_mutations.py`: mirroring, wrong facing order, omitted tile
compensation and disabled proof/pixel guards must each fail, with production
bytes unchanged afterward. Inspect the actual GPU output and played placement.

---

## [L-browser-proof-source-contract] Read UI contracts before automating verification

**What happened.** Refrigerator browser checks timed out on a pointer-disabled
radio, a nonexistent menu role, and an incorrectly capitalized load status.
After fixing those selectors, an immediate clock read briefly showed the
pre-load value because the HUD and persistence status update separately.

**Root cause.** The verification code guessed roles and messages instead of
using the existing DOM and controller contracts. Status success was also
treated as simultaneous with every displayed projection of simulation state.

**Prevention rule.** Inspect source-backed controls and exact status messages.
Click the visible speed label, target the ordinary action buttons, and confirm
load through its real dialog. Prove restoration causally by advancing state
after a save, then waiting for both persistence completion and restored state.

**How to verify.** Save while paused, advance the clock, pause and load. Require
`Saved game loaded`, a closed confirmation dialog, enabled controls, the saved
clock and saved activity. An unchanged screenshot alone cannot prove loading.

For ordinary object use, the HUD says `Using object`, not the interaction's
menu label. Chain steps have named status text; ordinary interactions do not.
Inspect the activity formatter and job priority before waiting for a label.
Record the command, target, arrival and completion separately.

---

## [L-surface-contact-not-bounds] Overlapping bounds do not establish support

**What happened.** Adversarial review found that the sink's attachment checker
would accept a drain raised above the bowl floor. A retained mutation test
confirmed the defect before the check was changed.

**Root cause.** The basin's overall bounding box includes its empty interior.
A floating part can overlap that box without touching any supporting surface.

**Prevention rule.** Trace the evaluated support surface beneath small fittings
and compare its hit height with the fitting's underside. Bounds remain useful
for coarse rejection, but do not claim they prove contact with a recessed bowl.
Check the faucet flange and lever base against the actual worktop too.

**How to verify.** The saved sink must pass. Raising the drain, faucet flange or
lever base by 0.1 must fail the corresponding support assertion. The retained
seven-mutation probe must pass after all intended failures are caught, and
the original saved model hash must remain unchanged.

---

## [L-raised-lid-clearance] Test the raised pose against nearby solids

**What happened.** The first toilet candidate raised its lid through the cistern.
The tank hid most of the lid while its top protruded through the cap. Primary
visual review rejected the batch before it reached the atlas.

**Root cause.** The parts were individually plausible, but their coordinates
were chosen without checking the rotated lid against the tank's front plane.

**Prevention rule.** Place the hinge at the lid's rear edge and check the whole
raised lid against adjacent solids in the saved scene. Do not count a part
hidden inside another solid as ordinary camera occlusion. Bounds can establish
separation here, though overlapping bounds alone do not prove collision.

**How to verify.** The retained candidate 01 must fail with `Lid intersects
cistern`. A corrected candidate must have positive clearance from both tank
and cap, pass visual review in all four rotations, and fail when the lid is
displaced into the tank in memory. Preserve every rejected candidate.

Candidate 02 cleared the tank but still intersected the lower ceramic neck.
The initial checker passed because it named only the tank and cap. Check the
full set of nearby solids, including supports below and behind a moving part;
a passing check establishes only the relationships it actually tests.

---

## [L-isolate-renderer-probes] Do not replace the DOM while game startup is running

**What happened.** A four-facing renderer probe replaced the page body while
the game was still starting. The renderer reported no GPU error, but the game
then failed because its save-status element had been removed and replaced the
probe with an error screen. That screenshot was rejected.

**Root cause.** The test fixture and application bootstrap both owned the same
document. Successful GPU submission did not establish what remained visible.

**Prevention rule.** Give isolated renderer probes their own minimal document
without the application bootstrap. Import the real renderer and atlas there.
Keep played verification in a separate ordinary production-build tab.

**How to verify.** Require both a clean GPU error scope and a screenshot that
actually shows the expected four facings. Inspect the played game separately
for load errors and correct interaction behavior.

---

## [L-control-layout-clearance] Keep functional controls in distinct panel areas

**What happened.** Laundry candidate 01 put its detergent drawer over the
washer indicator, leaving only a dark sliver visible. Primary review rejected
the batch before integration.

**Root cause.** The generic control strip was built first and the drawer was
added afterward without checking its footprint against the existing controls.

**Prevention rule.** Lay out all controls together. Test their actual horizontal
or vertical clearances in the saved model, not only contact with the panel.
Supporting each control does not prove the controls are mutually usable.

**How to verify.** Candidate 01 must fail the washer control-clearance check.
The replacement must show separate drawer, dial and indicator in both front
views, and moving the drawer back over the display must fail the checker.

---

## [L-bunk-contact-and-export] Check occupied solids and preserve export evidence

**What happened.** The first bunk model's flat duvet intersected the unchanged
sleeping body. Later review also found that the contribution renderer could
resume under a different Blender build and that the importer did not consume
the full-scene comparison evidence.

**Root cause.** Empty furniture review cannot establish occupied fit. The
initial contact checker did not require a complete named obstacle inventory
or a contact footprint. Source hashes alone did not identify the render
environment; an unconsumed proof field did not enforce an acceptance gate.

**Prevention rule.** Inspect every visible evaluated body part against the full
furniture inventory. Record sampled support counts and spans, then deliberately
displace bedding and structure to verify failure. Require the same Blender
version/build on resume. Bind the accepted manifest, raw proof and complete
recombination report in the production import, not just in documentation.

**How to verify.** Candidate 01 stays rejected and retained. Candidate 02 passes
all four sampled poses, sixteen source views and the actual occupied room;
three contact mutations and four structural mutations fail. The complete
reviewed-loader test must accept a valid fixture and reject changed bindings,
dependencies, raw images and comparison implementation. Keep the old render
journal when fixing provenance code; never relabel it as a fresh run.

## [L-all-refs-history-is-not-shipped-history] Check ancestry before claiming a feature is on main

**What happened.** The front-door continuation described furniture rotation as
already on main after finding its commits in a history search across all refs.
The implementation existed only on an unmerged local branch.

**Root cause.** Commit discovery was mistaken for release provenance.

**Prevention rule.** Fetch, then check the feature commit's ancestry against
`origin/main` before describing it as merged. A local branch can contain useful
implementation without being part of the deployed game.

**How to verify.** `git merge-base --is-ancestor <feature> origin/main` must exit
zero for a merged claim. Verify the merge's Pages deployment separately for a
live claim. The builder round should reuse the unmerged facing implementation
after reconciling it with current main.

## [L-portal-runtime-boundaries] Door metadata needs an active lot and a visible-transition test

**What happened.** The first integrated door build drew the shipped doorway
inside empty test rooms. Review also found that a returning worker's first
visible interval interpolated outward before the inward walk began.

**Root cause.** Shared content definitions were mistaken for active scene
instances. The interpolation test checked individual positions but not the
hidden-to-visible transition that consumes both the previous and current rows.

**Prevention rule.** Activate portal instances with the authored lot, not with
the content registry. Save restoration must restore that active-lot contract.
At a visibility boundary, test both interpolation endpoints. A routing field
such as the return landing is structural content even when nested under a
table named `visual`; use the existing reviewed migration mechanism when
adding it to the compatibility digest.

**How to verify.** Empty-room render tests must retain their original instance
counts. The final hidden work sample and first visible return sample must both
begin at the physical threshold, followed by inward movement. Changing only
the landing must change compatibility, while the specifically reviewed
pre-door public save remains loadable.

## [L-cancelled-mutation-sweeps-are-not-local-test-results] Distinguish verification costs and coverage

**What happened.** PR83 waited on two full eight-shard mutation sweeps after
a documentation-only correction triggered another run. The owner asked about
cost, cancelled the runs, then explicitly authorized deployment using the
completed local checks and exact-head Rust/web checks.

**Root cause.** Every PR update triggers the full Rust mutation workflow,
including documentation updates. Ordinary tests, targeted local mutations and
a full mutation sweep are different evidence; none should be described as an
identical rerun of the others. Long silent waits obscured that distinction.

**Prevention rule.** Report which checks ran, which remain incomplete, and
why they matter. Standard hosted runner minutes in this public repository are
free under GitHub's current billing rules; storage and account-wide charges
are separate. Do not claim an account-wide billing audit from runner labels.
Honor the owner's explicit release exception without calling cancelled checks
green. Do not restart cancelled sweeps or alter standing workflow policy
without authorization.

**How to verify.** PR83's release comment records five successful mutation
shards and three cancelled shards. Main CI 35528602122 and actual Pages deploy
35528743259 passed for d5ec05b; the fetched public atlas hash matched the
reviewed asset. Future reporting must identify the actual revision and checks.

## [L-shell-error-parameters-must-change-on-retry] Check the failed parameter before retrying

**What happened.** A source-reading command repeatedly passed the word `fifty`
to PowerShell's numeric `Select-Object -First` argument.

**Root cause.** The next command preserved the invalid argument instead of
correcting the parameter named in the error.

**Prevention rule.** Compare the error's parameter and value with the proposed
retry. Use numeric literals for line windows, or symbol-centered `rg -n -A`
searches. After three failures, get a fresh review instead of another variant.

**How to verify.** `1..5 | Select-Object -Skip 2 -First 2` emits 3 and 4.
The corrected `-First 50` source read succeeds; no repository edits are needed.

## [L-placement-helper-empty-footprints] Test geometry helper preconditions directly

**What happened.** The placement mutation sweep let either nonzero-dimension
guard in `fits` become an always-true unsigned comparison.

**Root cause.** The integration fixtures use valid compiled furniture, whose
positive dimensions never exercise the private helper's empty-rectangle checks.

**Prevention rule.** Keep integration tests for real furniture and add direct
helper tests for invalid dimensions and checked arithmetic. Test width and depth
independently, with an exact boundary-fit control. Do not describe these synthetic
inputs as a defect observed in the shipped household.

**How to verify.** Each width/depth `> 0` to `>= 0` mutation fails the new
`footprint_fit_requires_nonzero_dimensions_and_checked_bounds` assertion. Restoring
the exact production source passes all 26 placement tests. No production or
mutation-baseline change is required.

The same campaign exposed missing north-side approach coverage. A literal full
2x2 perimeter now constrains every usable side, then separately removes a solid
wall contact and an occupied approach. Each `y - 1` mutation to addition or
division fails before source restoration; all 27 placement tests then pass.
An integration check requiring some reachable contact is not proof that the
helper enumerates every contact the placement policy promises to protect.

## [L-continuous-wall-rejection-boundaries] Separate the conditions that reject a route

**What happened.** PR84's full mutation sweep found two unconstrained wall
checks: the upper endpoint of a collinear wall segment and the OR joining
walkable-center and open-segment requirements during fractional replanning.

**Root cause.** A test spanning the entire wall still collided when the upper
bound was shortened. Successful replan examples did not distinguish independent
reasons to refuse an anchor.

**Prevention rule.** Exercise a segment entirely inside each relevant boundary
region, not only one spanning it. For combined rejection guards, construct each
failure independently and assert the other condition is valid. Cover horizontal
and vertical walls, reverse travel, endpoint contact and clear-side controls.

**How to verify.** The new collinear upper-half test fails when `low + 1.0`
becomes `low * 1.0`. The new anchor test fails when OR becomes AND. Each exact
mutation was tested independently; restoring the unchanged production file
passes all 86 core tests. Neither change adds a mutation-baseline allowance.

## [L-wall-approach-completeness] Validate every reachable side of a footprint

**What happened.** The full wall mutation sweep could inflate an object's
interaction rectangle and silently omit its south-side contact.

**Root cause.** Existing connectivity fixtures did not isolate an unreachable
south approach while leaving the other sides reachable. Five other survivors
only weakened a redundant bounds filter; the shared interaction predicate
still rejected those coordinates before adjacency arithmetic.

**Prevention rule.** Test all usable contacts, not just whether an object has
one reachable side. Keep bounds ownership in the shared grid predicate rather
than maintaining duplicate filters with indistinguishable rejection paths.

**How to verify.** The south-contact fixture rejects `(2,3)` behind a divider
and accepts the same lot with a second opening. The exact depth subtraction
mutation fails that assertion. The redundant bounds filter was removed after
independent review of negative coordinates, upper boundaries and signed casts;
the blocked-cell and interaction checks remain. No baseline allowance was added.

## [L-edge-slot-signed-bounds] Check signed coordinates before unsigned indexing

**What happened.** PR84's mutation sweep found that changing the first OR in
`edge_slot`'s negative-coordinate guard to AND escaped ordinary grid tests.

**Root cause.** With small dimensions, the later unsigned upper-bound checks
also reject a negative coordinate after its cast. Those tests did not constrain
the helper's independent signed-coordinate rejection.

**Prevention rule.** Test scalar index helpers independently of allocations.
Include each negative axis, reversed endpoints and valid controls. Keep the
claim narrow: extremely large scalar bounds test a defensive helper contract,
not a reachable failure in an ordinary allocated household grid.

**How to verify.** The new `edge_slots_reject_negative_coordinates_independently_of_unsigned_bounds`
test uses no allocation. Changing only the first OR to AND returns an invalid
index and fails its assertion. Restoring the original source passes all 84 core
tests. No production behavior or mutation baseline changes are needed.

## [L-saved-wall-independent-guards] Isolate saved-layout validation conditions

**What happened.** PR84's full mutation sweep found 21 unconstrained conditions
in saved-wall validation and the frozen migration destination check.

**Root cause.** End-to-end invalid saves could fail at a later guard and hide a
weakened earlier condition. Contact examples did not distinguish an object flush
with a boundary from one extending past it, or internal edges from its perimeter.

**Prevention rule.** Pair each refusal with a valid control. Test independent
axes, exact boundaries, repeated path tiles and inactive targets. Use narrow
helper tests when later fingerprint or geometry checks mask the helper contract;
do not present those scalar cases as reachable ordinary-household defects.

**How to verify.** The 20 reported architecture mutations all fail new assertions,
with zero survivors or timeouts. The wall-migration OR-to-AND mutation separately
fails the `16x0` destination assertion. Restored production files pass all 432
simulation tests. Production validation and the mutation baseline are unchanged.

## [L-spawn-wall-perimeter-controls] Internal walls and perimeter walls are different cases

**What happened.** The final PR84 mutation shard found three unconstrained
object-spawning checks: the depth boundary, its extent arithmetic, and requiring
both adjacent tiles of a solid edge to lie inside the object's footprint.

**Root cause.** Refusal examples alone did not prove that valid perimeter edges
remain accepted. A weakened guard could over-reject those placements while
still passing internal-wall tests.

**Prevention rule.** Test solid edges on every perimeter side as accepted cases,
internal edges on both axes as refusals, and internal doorways as accepted
controls. A refused public spawn must preserve save bytes, entity count and
both render buffers rather than merely return false.

**How to verify.** The three exact reported mutations all fail the perimeter
test after successful compilation, with zero survivors or timeouts. Native
WASM-boundary tests pass 86/86 after restoring the original source. These are
test-only changes; neither production validation nor the baseline is relaxed.

## [L-capture-health-is-not-visibility] Test capture directly before declaring it unavailable

**What happened.** Three live screenshot attempts failed on September 21.
Subsequent release heartbeats checked only browser visibility and repeatedly
reported capture unavailable until September 27. A harmless same-browser
page then captured successfully, followed by the save-safe live game LOOK.

**Root cause.** A suspected correlation between hidden presentation and the
original timeout became a permanent diagnosis. The monitor checked a proxy
instead of the failed capability and had no useful recovery test.

**Prevention rule.** Treat historical failures as historical. A visibility flag
does not establish screenshot health. After investigating repeated failures,
use a bounded direct capture on a harmless page to test recovery without
touching protected application state. Do not repeat an unsupported diagnosis
or infer when recovery occurred from a later successful test.

**How to verify.** Capture and inspect an ordinary non-game page in the same
browser. Separately verify the deployed game under the documented save-safety
procedure, including unchanged pre/post hashes. Record actual results and
remove stale blocker instructions from the recurring monitor.

## [L-live-verification-autosave] Ordinary play can violate save-preservation requirements

**What happened.** A live front-door check advanced the public household across
midnight while trying to capture a crossing. The primary save was automatically
written at 2026-09-21T03:09:33.828Z. No Save button was clicked, but that did not
preserve the file. A V1 recovery copy was created before the V2 overwrite.

**Root cause.** Verification treated ordinary UI playback as save-neutral without
checking the midnight and hidden-tab autosave paths. Pausing also does not prevent
the visibility handler from saving. Exact-minute HUD polling missed brief events;
the HUD updates less often than simulation ticks at accelerated speed.

**Prevention rule.** Before opening a live game under a save-preservation constraint,
inspect startup, periodic and visibility-triggered writes. Perform gameplay on a
disposable local origin. Keep public checks read-only and do not assume closing a
paused tab is write-free. Preserve identified recovery bytes and seek direction
before replacing a user's save.

**How to verify.** Record public save hashes and metadata through a non-game,
same-origin document before and after the check. Require unchanged bytes. Exercise
midnight and hidden-tab behavior only on disposable saves. This incident's owned
tab was script-disabled before closure; no recovery write was attempted.

## [L-builder-export-contracts] Test the values returned to the browser

**What happened.** The builder mutation gate found uncovered V1 truncation,
preview foreground, facing-mask and lot-revision behavior at the WASM boundary.

**Root cause.** Internal placement tests did not prove what the browser actually
reads. A missing foreground needs an explicit negative sentinel, and revision
checks must observe a real edit rather than only the initial zero value. The
historical V1 repair must not append bytes to a truncated nonempty counter list.

**Prevention rule.** Test the exported values with missing and present controls,
individual supported direction bits, actual accepted edits and malformed public
load requests. Build masks from the unique one-hot direction values; OR and XOR
are indistinguishable when those values cannot overlap.

**How to verify.** The four distinguishable mutations must fail assertions after
successful compilation. Restore the exact source, then run the complete native
and release-mode WASM suites. The equivalent OR/XOR operator was removed through
the disjoint-bit sum, not counted as a caught mutation or added to the baseline.

## [L-shared-socket-bounds] Keep repeated validation on one predicate

**What happened.** The builder mutation sweep found five unconstrained OR
operators across authored and rotated interaction-point bounds checks.

**Root cause.** The later direction check repeated the authored check at the
base facing, masking changes to the earlier predicate. Rotation fixtures also
failed to isolate each negative axis. Removing the early check would change
which diagnostic wins when content has more than one error.

**Prevention rule.** Share the bounds predicate while retaining both call sites
and their order. Test every rejection axis independently, with accepted origin
and fractional upper-tile controls. Keep compiler-level rotation tests without
lot placements, so placement validation cannot mask a missing direction check.

**How to verify.** Change each of the shared predicate's three OR operators to
AND separately; each must fail an assertion. Remove the direction-check call
and require the unplaced rotated-socket test to fail. Restore exact source bytes
and rerun the complete data suite. Do not add a mutation-baseline allowance.

## [L-layout-migration-passive-conversation-partners] Preserve both sides of saved activities

**What happened.** The first bathtub-rotation migration rejected an active
conversation on the newly occupied tile. It could also move the passive
participant away from the speaker, leaving a gap or placing them together.

**Root cause.** Only the initiator carries `Socialising`; the passive partner
has a reservation. Inspecting each entity's own active-action component missed
the relationship. Treating this as an unsupported custom world would reject
an ordinary shipped-world save.

**Prevention rule.** Build contact constraints from both ends of saved
relationships before relocating anyone. Preserve the untouched partner where
possible and choose a reachable adjacent location for the affected person.
Keep timers, voice clips, reservations and queued actions unchanged. Validate
the original content references before migrating their fingerprint.

**How to verify.** Test both initiator and passive-partner relocation with
stationary partners on either side. Deleting passive-contact registration must
fail the distance assertion. Also sample running source worlds and retain a
save produced by the previous browser build; freshly encoded fixtures alone
do not establish that an old runtime's actual bytes load.

## [L-cleanup-removes-only-what-it-owns] A cleanup deleted a component it no longer owned

**What happened.** The first measured run with the larger trait library froze
Casey on the toilet at tick 1799. She never moved again, she held the only
toilet's reservation, and within a day every bladder in the house was at zero.
Every unit test passed and the page looked normal for its first half hour.

**Root cause.** A conversation's initiator carries `Target{partner}`, and
`tick_social` removed `Target` whenever a talk ended or was disturbed. It never
checked that the Target it removed was still the one it had put there.
`start_shift` takes `Target` from every sim whose Target names a departing
worker, which includes a sim already talking to them. That sim kept
`Socialising`, chose something new on the same tick, and then lost the NEW
Target to the talk's cleanup. Beside the object she had already arrived, so she
was left `Eating` with no `Target`, which `tick_interactions` never counts
down. Across the room she would have walked her leftover path as a stroll while
the object stayed reserved for nobody. The bug was on main already; a
Chatterbox made the timing likely.

**What I got wrong first.** I fixed the caller: I made `start_shift` skip sims
that were already talking. It worked, and the reviewer pointed out that it left
the cause in place, that the same pair had already destroyed a target once
before, and that my whole-household test could not see the across-the-room
form at all. Both were true.

**Prevention rule.** A system that removes a component on its way out removes
it only while the component is still the one it owns; check the value, not the
presence. When a fix lands in a caller, ask what the callee would do for the
next caller. After any change to who lives in the shipped house, run
`cargo run --release -p terri-sim --example trace -- 120000` on main and on the
branch and read the need floors first: a sim whose every need sits at zero is a
stuck sim. Do not read a 12000-tick run; a one-tick change in timing reshuffles
it, and [A-trait-library] has two such runs that disagree.

**How to verify.** Make `owns_target` always true in `tick_social`. Then
`a_talk_that_ends_removes_the_target_it_owns_and_no_other` fails,
`a_shift_start_ends_a_running_talk_without_stranding_the_talker` fails in both
its positions, and `the_shipped_household_never_strands_a_sim_or_an_object`
fails at tick 1799 naming Casey. With the rule in place, 300000 ticks of the
shipped household never leave anybody using an object with no target.
Separately, the build replays a household saved by the previous public build
field for field for 1800 ticks. That proves old saves keep their meaning; it
does not test this fix, because that household has no conversation running at
its shift start.

## [L-content-additions-move-the-save-digest] Adding a trait refuses every save

**What happened.** Appending twelve traits to `content/traits.toml` made five
save-bridge tests fail at once. Without a bridge the build would have refused
every existing save on load.

**Root cause.** The compatibility digest in `crates/terri-data/src/lib.rs`
hashes every trait id with its kind, along with object interaction rows, the
social list, voice clips and chains. It is one global hash, so a pure addition
moves it as surely as a destructive edit does. The file says so; I read it
after writing the content.

**Prevention rule.** Before adding any trait, object interaction, social
interaction, voice clip or chain, read the digest's doc comment and plan the
bridge in the same change: pin the source by removing the addition and
requiring the previous public digest, pin the new digest as a golden value,
add the new digest to every reviewed-destination list that names the old one,
and check in a real save written by the previous public build.

**How to verify.** `removing_the_appended_traits_reproduces_the_previous_public_digest`
and `the_trait_library_digest_is_pinned` in terri-data, and
`actual_pre_trait_library_saves_load_with_exactly_their_saved_traits` in
terri-wasm. Deleting the bridge clause fails the first crate's bridge test.

## [L-unpushed-work-is-invisible-work] Two sessions built the same feature

**What happened.** I built furniture turning for about two days on a local
branch and never pushed it. In that time another session merged 85 commits to
main, ending in PR 85, which moves and rotates furniture in Build mode. It
also took command wire code 7 and introduced Save V3, both of which my branch
claimed differently. A trial merge conflicted in 22 files. The owner had to
interrupt and tell me to fetch. The branch was shelved unpushed.

**Root cause.** I fetched once, at the start of the increment. The rule that a
push costs a long mutation sweep pushed me to batch everything into one push
at the end, so for two days nobody could see that the item was taken.

**Prevention rule.** Fetch at the start of every working session and before
each major step of a long increment, and read what landed. Before picking an
item, check open pull requests, unmerged remote branches, and the status of
sibling worktrees whose branch sits at main's tip. Claim the item by pushing
its design as a draft pull request before writing code; a push with no Rust
change gives the mutation sweep nothing to do.

**How to verify.** PR 87 was opened as a draft holding only its design, one
commit after the fetch that found PR 85.

## [L-first-3d-character-checkpoint] Review the actual silhouette before developing the rig

**What happened.** The first local Blender character render clipped its hair
and shoes. After framing was corrected, independent visual review found that
the pale rectangular soles read as separate plates beneath the feet. Fitted
rounded soles resolved that objection. The owner-design checkpoint was still
open at that point; the reviewer approved showing the early candidate, not
shipping it.

**Root cause.** Camera-space padding had not been checked after all model
transforms, and a rounded box was used for a sole whose outline needed to follow
the shoe. Valid geometry and successful rendering did not establish a convincing
silhouette.

**Prevention rule.** Inspect all physical facings with safe frame margins and
labeled native-size samples. Give structural shapes their intended outline,
then obtain independent visual review. Preserve owner-direction questions such
as head size, eyes and hair for the requested early pause instead of developing
a full rig around an unapproved design.

**How to verify.** Check the source PNG alpha bounds against every frame edge;
visually trace shoe-to-sole contact in all facings; inspect the enlarged and
native-size outputs. Record the review verdict separately from owner approval.

## [L-small-character-feature-construction] Facial contrast and garment contact need separate checks

**What happened.** The owner found the first Blender Sim's eyes too intense,
its front hair blobby, and its neckline and collar unconvincing. Replacing the
collar blocks with fabric-shaped panels initially introduced a different defect:
parts of the panel edges disappeared into the shirt. That draft was rejected
internally before the next owner checkpoint.

**Root cause.** Stacked eye layers and contour strokes accumulated contrast;
separate oval hair pieces remained visibly separate; collar blocks and later
panel vertices were positioned without following the actual shirt surface.

**Prevention rule.** Judge feature contrast after contour rendering and size
reduction. Shape a continuous hair surface when a continuous sweep is intended.
Build collar folds as thin surfaces with deliberate contact and clearance, not
thick blocks. A simpler hair cap can still look helmet-like, so removing blobs
alone does not establish owner acceptance.

**How to verify.** Compare unchanged-camera before/after renders, inspect both
front facings for eye intensity and complete collar contours, then check all
four silhouettes and labeled native-size samples. Keep the owner's style verdict
separate from the independent reviewer's readiness-to-show verdict.

## [L-preserve-personality-in-visual-revisions] Correct the defect without replacing the character

**What happened.** A request for less intense eyes and less blobby front hair
produced small low-contrast eyes and a smooth, flattened hairstyle. The owner
preferred the original face and fuller hair, asking for a small front curl
instead of the separate oval locks. Independent show-readiness review had not
established that the revised character retained its appeal.

**Root cause.** The revision treated reduced detail and contrast as improvements
by themselves. It changed the character's expression and silhouette more than
the requested correction required.

**Prevention rule.** Preserve the preferred baseline's expressive features and
volume. Replace the defective local shape, such as three disconnected-looking
hair ovals, with an intentional connected form. Keep unrelated successful fixes.
Do not flatten a hairstyle merely to remove bumps. Reviewers must compare
personality and shape against the owner's preferred baseline, not only look for
mechanical defects.

**How to verify.** Show a same-camera original-versus-revision comparison, check
the change from all four physical rotations, and inspect frame padding after
adding any protruding curl. Separate the owner's preference from a reviewer's
technical readiness verdict. Pause again for owner feedback before rigging.

The follow-up curl tests exposed a second distinction: a separate curved mesh
can look like a piece resting on the head, while a connected hairline notch can
be mechanically correct without looking like a curl. A fresh-context review
changed the construction after three misses; a second visual reviewer still
rejected the new silhouette. Stop that modeling track and clarify the desired
shape instead of calling the topology correction a visual success.

Review-board generation must also preflight complete source status and all
four source hashes. An existing comparison filename can contain an older test
after a failed composition. Inspect images only after verifying the current
composition succeeded, and label rejected output as rejected.

The owner supplied a better next step: generate several visual concepts first,
let them choose, and approximate the selected design in Blender. Constrain the
concepts to broad sculptable masses, clear rooted attachments and tapered
solid locks. Avoid fine strands, simulated hair or decorative complexity that
the local model cannot reasonably reproduce. A close visual match is the goal;
pixel-identical reconstruction is not required. Label concepts separately from
actual model renders and retain prompts, references and review notes. Concept
selection does not waive later four-facing and rigging verification.

**Outcome.** Approximating the selected concept by hand in Blender did not
succeed; see [L-concept-to-hair-shape]. The hair that shipped came from a
different source method: a capped, owner-authorized hair-only Tripo
experiment, whose one generation was fitted to the retained Blender body and
approved on 2026-09-09. The record is in
`docs/specs/2026-09-07-sim-hairstyle-direction.md`.

On 2026-09-21 the owner established paid generation as a standing, approved
option rather than a one-off. Prefer non-paid methods; when they are of
insufficient quality, paid generation is a legitimate route and need not be
treated as exceptional. Each paid run still spends money, so ask the owner to
approve that specific run and its cost before submitting it.

## [L-concept-to-hair-shape] A clear concept does not validate the construction method

**What happened.** After the owner chose the small-front-curl illustration,
three Blender drafts still produced inflated lobes, a blunt or pointed fringe,
and unwanted gaps from other angles. Joining the meshes and improving their
shading did not establish the intended rolled shape. The drafts were rejected
before another owner approval request.

**Root cause.** The construction began with swept rounded sections and treated
their connectedness as progress toward the visual target. A taper is not a curl,
and a single connected mesh can still have the wrong silhouette. An oblique
render can also make a front overhang look like a defect at the rear; image
position alone does not locate the defective part in model coordinates.

**Prevention rule.** Specify the rolled section, its underside and its hooked
tip in model coordinates, then inspect opposite angles before detailing.
Evaluate shading separately from shape. After three materially similar misses,
preserve the source and renders and seek fresh-context review of the
construction rather than continuing to move the same control points.

**How to verify.** Compare the actual model with the selected concept, inspect
all four rotations and reduced-size samples, and distinguish gaps caused by
incorrect construction from intentional curl clearance. Hash and padding checks
are mechanical evidence only. A new checkpoint still requires independent
visual review and the owner's response before rigging.

The follow-up connected-cage trial closed the large silhouette gap but still
failed visual review: it resembled a smooth cap with a pinched crest, without
the selected roll and side wave. A changed construction method is not itself
evidence that another long sequence of parameter revisions is justified. Stop
that track, preserve the failed set, and request the necessary source-method or
spending decision before expanding the scope.

**Outcome.** That decision was taken. Local modeling stopped after attempt 13
without reaching the concept, and the owner authorized a capped hair-only
Tripo experiment. Its one generation cost USD 0.60, was fitted to the Blender
body, and was approved. Details are in
`docs/specs/2026-09-07-sim-hairstyle-direction.md`. Paid generation has since
been established as a standing option; see
[L-preserve-personality-in-visual-revisions].

## [L-store-blender-background-proof] Verify the background script, not the launcher exit

**What happened.** The protected Store-package Blender executable returned
`Access is denied`. After the owner authorized the installed Store launcher,
it executed a hidden background script successfully in Blender 4.5.13 LTS.

**Root cause.** Direct access to the package executable and execution through
the installed app launcher are distinct launch paths. A detached launcher's
return does not establish that the Python script or its renders completed.
PowerShell can also return success for a later command after a launch error.

**Prevention rule.** Respect a launch permission failure and obtain authorization
before changing routes. Do not change Windows permissions or copy protected
binaries. For the authorized Store launcher, use `Start-Process -WindowStyle
Hidden` and `--background`, with absolute script and output paths. Do not open
an interactive Blender window without separate foreground permission. The
full command, including `--threads 2` and `--python-exit-code 1`, is in
`assets/models/sims/sim-01/README.md`; copy it from there rather than from
this summary.

**How to verify.** Require a newly written script result with
`bpy.app.background` true and the Blender version. For actual renders, also
require the script's complete status, every expected output, hashes and visual
inspection. A launcher process ID or successful shell exit alone is insufficient.

## [L-a-blind-digest-proves-false-equalities] A hash that cannot see something lets tests call two worlds equal

**What happened.** Adding the saved walls to the world hash for the Walls tool
failed two save tests. Each round-tripped the shipped house through the old V1
record and asserted the restored world had the same hash. A V1 record carries
no wall edges, so the restored house had no walls at all. The assertion had
only ever held because the hash could not see walls.

**Root cause.** A test that compares digests proves equality only of what the
digest reads. When state lives outside the digest, "same hash" silently means
"same except that", and a test can pass for years while asserting something
false.

**Prevention rule.** When a digest gains a field, expect failures and read each
one as a question about the test, not the digest: was the test's claim ever
true? When a test compares two worlds through a lossy format, compare what that
format carries, or use the format the game writes.

**How to verify.** `fridge_art_replacement_restores_authored_and_dynamic_objects_without_save_changes`
keeps its V1 load and compares V1 records, and adds a V3 round trip that
compares hashes;
`load_during_settle_in_reconstructs_the_socketed_render_endpoint_before_another_tick`
keeps V1 on purpose, because its fixture is only valid there, and compares V1
records. With the wall hash in place, turning either back into a V1 world-hash
comparison makes it fail.

**It happened again, the other way round (PR 96).** The world hash never read
which object a placed entity is, because the lot content fixed that. Buying
made it a player's choice, and the review bought a radio and a desk chair, same
price, same tile, in two copies of one household: equal hashes, different
saves. The rule that would have caught it: **when a feature makes some state a
player's choice for the first time, check the digest reads that state.**
`the_world_hash_sees_which_object_was_bought` fails if the object-kinds
section is removed from `world_hash`.

## [L-an-edit-must-pass-the-loader] A lot edit's own rules accepted walls the loader refused

**What happened.** The first review of the Walls tool found two walls the
validator accepted that left a save the V3 loader refused: one between where a
sim's walk ends and the object it is walking to, and one between the front door
and its landing while another way in stayed open. The player could not resume
the game. Both came up in ordinary play of the shipped household.

**Root cause.** I built the wall validator from the furniture validator's
rules and added the ones I could think of. The loader has its own, older rules
about walls, walks and the front door, and nothing tied the two lists
together. Any rule only the loader knew was a way to write a save it refuses.

**Prevention rule.** An edit that writes saved state must pass the loader's
checks on the candidate state, by calling them rather than copying them. Test
the invariant directly: every edit the validator accepts leaves a save the
loader accepts, over the real household at more than one moment.

**How to verify.** Remove the `candidate_grid_loads` call from
`validate_wall_edit`. `a_wall_between_where_a_walk_ends_and_what_it_is_walking_to_is_refused`
and `every_wall_the_shipped_household_accepts_leaves_a_save_that_loads` fail;
the second names the vertical line at x 14, y 6, at tick 180. The front-door
test does not, because the door rule now refuses that wall first. The
household test also fails on its own if its ticks stop holding a wall that
only the loader refuses: the trait library moved the household once already
and silently emptied the ticks it first used.

## [L-a-list-refreshed-in-silence] The Furniture list missed a bought chair

**What happened.** In the played check of the Buy tool, a chair bought with
nothing selected in the Furniture tool did not appear in that tool's list. The
list showed two chairs where the lot had three.

**Root cause.** The furniture builder re-read its object list whenever the lot
changed, but only told its controls to redraw from inside the preview query,
which runs only when something is selected. Until buying existed, nothing
added or removed an object, so a stale list was never visible.

**Prevention rule.** A controller that changes what its view shows tells the
view in the same branch, not only in the branch that happened to exist first.
When a feature adds a new way for shared state to change, check every view
that reads that state for how it hears about the change.

**How to verify.** Remove the `else` branch that calls `hooks.changed()` after
`refreshObjects()` in `FurnitureBuilder.afterCommands`.
`tells its controls when a lot change refreshes the object list with nothing
selected` in `web/tests/builder.test.ts` fails.

## [L-a-test-that-waits-must-be-bounded] A test's clock loop hung two mutants

**What happened.** PR 95's household wall test advanced the game with
`while tick < stop { sim.tick() }`. The mutation sweep replaced `Sim::tick`
and `advance_clock` with nothing; the clock never moved, the loop never ended,
and both mutants burned the 60-second timeout. The shard's hang check failed
the whole pull request after an hour of CI.

**Root cause.** A loop whose exit depends on the code under test is a loop the
mutation sweep can break. The test assumed the one thing a mutant exists to
remove.

**Prevention rule.** A test that waits for the simulation to reach a state
counts its steps and asserts afterwards: `for _ in from..stop { tick }` then
`assert_eq!(clock, stop)`. Never `while` or `loop` on simulation state.

**How to verify.** Make `Sim::tick` return at once.
`every_wall_the_shipped_household_accepts_leaves_a_save_that_loads` fails in
seconds with "one tick per `Sim::tick`" instead of timing out.

## [L-derive-after-the-restore-is-whole] Doors drawn from walls went missing after a Load

**What happened.** Interior doors are drawn from the saved walls. Straight
after a Load a house showed its doorways doorless for one tick: the portal
bridge test caught a loaded world with one portal row where the live one had
four.

**Root cause.** The loader syncs the render buffer while it restores the
entities, and only afterwards puts the saved walls in. Nothing drawn before
had depended on the walls, so the order never mattered.

**Prevention rule.** Presentation derived from saved state is rebuilt once the
restore is whole, not at whatever point the loader happens to sync. When a
view starts reading a piece of saved state, check where the loader installs
that state relative to its render sync.

**How to verify.** Remove the `sync_portals` call at the end of `Sim::adopt`
in `crates/terri-sim/src/lib.rs`, which all three loaders go through.
`a_loaded_house_shows_its_doors_before_the_first_tick` (the V2 and V3 loaders)
and `a_migrated_v1_house_shows_its_doors_before_the_first_tick` (the V1 loader)
fail.

**Second instance, found by review.** The first fix put the rebuild at the end
of the V2 and V3 restore, and the V1 loader, which moves the cell-wall house to
edge walls in a later step, still drew its doors late. The rebuild now sits in
the one place every loader passes through after the restore is whole: a fix
for an ordering bug belongs after the last step of every path, not after the
step where the bug was first seen.

## [L-restore-without-counting-up] A Load counted up to a saved number

**What happened.** PR 97's mutation sweep failed on two mutants that time out
rather than fail: both let a count above the limit through `exceeds_limit`,
the loader's bound on saved counts. With the bound off, the save test that
feeds `issued_sim_ids = u32::MAX` took 15.6 seconds on a desktop and over the
60 second limit on a CI
runner, because restoring the sim id allocator called `issue` once per issued
identity. PRs 98 and 99 passed the same shard only because their runners were
faster.

**Root cause.** The restore did work proportional to a number read from the
save, and only the validation bound kept that number small. A check that
guards cost as well as correctness is one the sweep will break.

**Prevention rule.** Restore a saved counter by setting it, never by
replaying it. When a loader must loop over a saved number, loop over data the
save actually contains, whose length the decoder has already paid for. The
one exception is the entity slots in `restore_with_facings`: the ECS hands
indices out in order, so the loader spawns one per index up to the last saved
or retired index, bounded by validation's checks that every entity index and
every retired index is under `MAX_ENTITIES`, and a comment on the loop says
so.

**How to verify.** With `exceeds_limit` returning false,
`invalid_snapshots_are_rejected_without_touching_the_running_sim` in
`crates/terri-sim/src/save.rs` fails in well under a second, and
`a_resumed_allocator_matches_one_that_issued_as_many` in
`crates/terri-core/src/components.rs` covers `SimIdAllocator::resumed`.

## [L-sprite-keyed-tables-miss-new-directions] Rotation added sprites that a lighting table never learned

**What happened.** The furniture builder let the player turn objects, and a
turned object is drawn with its direction's own sprite. The shell's lighting
knew the floor lamp and the television by one sprite each, the default
direction, so a turned lamp or television lit nothing around it at night and
lost its glow. Nothing failed: the lighting tests only placed unturned
lights, and nobody turned a light and waited for night.

**Root cause.** Rotation changed which sprite an object is drawn with, and
the change was checked in the simulation and the renderer's draw path, not in
the shell tables that key on sprite numbers to mean "this object".

**Prevention rule.** When an object gains sprites (a direction, a frame, a
variant), search the shell for every lookup keyed on a sprite number or name
(`spriteIndex(` and tables indexed by `sprites[...]`) and decide for each
whether it means the object or that exact picture. A table that means the
object must list every sprite the object can be drawn with.

**How to verify.** "lights every direction of a light and nothing else" in
`web/tests/buy-tool.test.ts` asks the real simulation which picture it draws
for every catalogue item in every direction, and checks the lighting against
those. Dropping a turn from `inEveryDirection` in `web/src/render/lighting.ts`
fails it, as does the per-turn case in `web/tests/lighting.test.ts`.

## [L-probe-a-library-accessor] A library accessor was read by its name, then explained by a guess

**What happened.** The selling design saved where fresh entity indices start,
read from `Entities::len()`, and had the loader retire every gap in the saved
numbering. The first test failed: after a sale the next spawn took an index
well below that bound. I explained it as the ECS freeing indices of its own and
wrote that into the design, the architecture notes, a test comment and this
lesson. Review probed it and found the ECS frees nothing of its own here.

**Root cause.** `Entities::len()` is the length of the ECS's internal entity
record list, which grows in chunks (64 for 37 entities), not the next index. I
read the accessor by its name and, when the test disagreed, reached for a
cause that fit instead of probing the one I had.

**Prevention rule.** Before designing around a library accessor, probe what it
returns in the case that matters. When a test contradicts a design, confirm the
cause with a direct probe before writing it down anywhere. The shipped design
saves the retired indices instead, which needs no allocator internals.

**How to verify.** `a_sold_index_is_never_handed_out_again` spawns and drains
after a sale, and
`after_two_sales_a_save_and_a_load_the_next_purchase_matches_continuous_play`
compares a loaded world's next purchase with continuous play, both in
`crates/terri-sim/src/placement/sale_tests.rs`. Replacing `despawn_no_free` in
the sale with `despawn` fails both.

## [L-list-every-picture-of-an-object] The colourway design missed the placement ghost

**What happened.** The colourways design listed the pictures an object's
colourway must reach: its own row, its foreground layer and the furniture
layer inside a sim using it. It said the placement ghost keeps its tints and
nothing more. In play, recolouring the chosen sofa changed nothing on screen,
because while an object is chosen the Furniture tool hides it and draws the
ghost in its place.

**Root cause.** The list was built from the render buffer's rows, and the
ghost is not a row: the shell draws it from the builder's preview.

**Prevention rule.** When a change must reach every picture of an object,
list the pictures from the frame's writers (`writeInstance` callers in
`web/src/frame.ts` and `web/src/render/`), not from the simulation's rows,
and play the change with the object chosen as well as not.

The first fix took the colourway from the row the ghost replaced, which the
frame only has while the ghost is valid and on the object's own tiles; review
found it, and main now passes the chosen object's colourway to the frame.
Test the picture where the player sees it, in every state it can be in, not
the writer alone.

**How to verify.** "draws the ghost in the given colourway, valid or not, on
its tiles or elsewhere" in `web/tests/footprint-depth.test.ts` drives the
whole frame; "draws the candidate in the colourway of the chosen object" in
`web/tests/placement-preview.test.ts` covers the writer. Removing the ghost's
colourway write fails both.

## [L-build-where-the-tests-read] Web tests passed against a WebAssembly build nobody had made

**What happened:** while building the yard, `wasm-pack` was run with
`--out-dir ../../web/src/wasm-pkg`, a folder nothing reads. CI, the Pages build
and the web tests all load `web/src/wasm`, so every `vitest` run in that stretch
tested the WebAssembly left there by an earlier build. The yard's web tests
passed while seven of them were wrong against the real 20 by 16 lot; a build
into `web/src/wasm` showed them failing at once.

**Root cause:** the out-dir was typed from memory rather than copied from
`.github/workflows/ci.yml`, and a stale build is silent: `vitest` has no idea
the Rust moved. This is [L8] again, reached by building somewhere else rather
than by not building.

**Prevention rule:** build with exactly the command CI runs,
`wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`,
from the repository root, before every web test run that follows a Rust
change. Wait for that command to finish successfully before starting Vitest,
type checking or Vite. Starting them concurrently still reads the previous
binary: the cutaway-wall integration hit six stale-binding/save-tail failures
after merging newer autonomy code because its web suite ran before WASM finished.

**How to verify:** after the build, the timestamp of
`web/src/wasm/terri_wasm_bg.wasm` is newer than the last Rust edit, and a web
test that reads a boundary value you just changed, such as
`houseSize()` in `web/tests/bridge.test.ts`, fails before the change and
passes after.

## [L-a-rule-read-the-picture] A wall rule read the presentation-only portal rows

**What happened:** the yard's rule that the front door's line never becomes a
wall first found that line through `ActivePortals`, the portal rows the
renderer draws from. A world built without them, such as `Sim::new()` loading
the same save, accepted the wall the game refused, and the two worlds' digests
parted. Review caught it before merge.

**Root cause:** the helper was written for the door's swing, which is
presentation and rightly reads `ActivePortals`, and was then reused by a
simulation rule. The `ActivePortals` doc comment in
`crates/terri-sim/src/portals.rs` already says career routing reads the
content's portals, not the presentation rows; a new rule did not check which
side of that line it stood on.

**Prevention rule:** a rule that decides what the simulation does reads only
simulation state and the content, the way `check_new_walls` finds the front
door: `content.lot.front_door` matched to its portal in `content.portals`.
When a helper serves both the picture and a rule, it takes its source from
the rule's side.

**How to verify:** `the_front_doors_line_is_kept_without_the_doors_art` in
`crates/terri-sim/src/placement/wall_tests.rs` loads one save into
`Sim::new()` and into the shipped lot, asks both for the same wall, and
compares the refusals and the digests; it fails if `front_door_lines` reads
`ActivePortals` again.

## [L-run-every-gate-ci-runs] The yard passed every local gate and failed CI's asset tests

**What happened:** the yard grew the lot from 16 by 12 to 20 by 16. Every
local gate passed, and CI's rust job failed: two tests in
`assets/models/sims/sim-01/test_exercise_wall.py` read `content/lot.toml`
and the bike art's exporter asserted the lot was 12 tiles tall.

**Root cause:** the local gate list was written from memory, as fmt, clippy,
the Rust tests, the doc ids, WebAssembly, the typecheck and the web tests.
CI's rust job also runs every asset folder's Python tests and the sprite
atlas check, which read content too.

**Prevention rule:** run the gates by reading `.github/workflows/ci.yml`, or
with a script built from it, never from a list in memory. A content change,
such as the lot's size, reaches the asset tests as surely as the Rust ones.

**How to verify:** before a push, the `Sprite atlas is reproducible` step's
seven `unittest discover` commands and `build.py --check` pass locally
alongside the rest.

## [L-a-new-rule-meets-old-saves] The street's rule would have stranded a house the yard build saved

**What happened:** the street slice made every lot edit keep the street's
exit open, and sent every commute there. The yard build, which ships first,
lets furniture stand on that tile. Review loaded such a save: the worker
missed every shift, and almost every edit anywhere was refused as blocking
someone's route, with nobody in sight.

**Root cause:** the new rule was written for houses built under it. A save
made before the rule existed could already break it, and the rule treated
that as a state it could never be in: the commute had no second way out,
and the edit check refused anything that did not also mend the break.

**Prevention rule:** a rule about saved state meets worlds saved before it
existed. It needs a way to carry on when the old world breaks it, such as the
commute leaving by the door, and an edit is refused only for breaking it now,
never for leaving an old break as it was.

**How to verify:** `furniture_saved_on_the_exit_sends_the_worker_by_the_door`
in `crates/terri-sim/src/systems/street_tests.rs` fails if the edit check drops
its "reaches now" condition, or if the commute stops falling back to the
door.

## [L-move-markup-by-its-tree] A moved block of markup left its closing tag behind

**What happened:** a review fix moved the Options flyout's markup to the top of the page. The script cut from the block's opening comment to the first `</div>` with four spaces of indent after the panel. That text also matched inside the panel's own six-space closing tag, so the cut ended one tag early. The wrapper's closing tag stayed where the block used to be, and the whole sidebar ended up inside the flyout's wrapper, fixed to the window's right edge. Every test passed, and the branch was pushed. The next played check showed the sidebar at x = 1240 on a 1280-pixel window.

**Root cause:** the script found the end of an element by matching text, and indentation is not structure. The tests checked that ids came in the right order in the file, which a misplaced closing tag does not change.

**Prevention rule:** move markup by its tree, not by a text pattern: find the matching close by counting tags, and check the moved block opens and closes exactly once. A test about where markup sits checks nesting, not just order.

**How to verify:** `holds only the gear and its panel, closing before the sidebar opens` in `web/tests/options-menu.test.ts` walks the div tags from the wrapper to its matching close and fails if the sidebar, the Build dock, the right-click flyout or the debug overlay is inside it.
## [L-check-preview-worktree-before-copy-review] A familiar port can serve another checkout

**What happened.** The object-copy browser check initially opened port 5174 and found the old labels. That listener belonged to another worktree, while the new content and browser-code tests had passed in this checkout.

**Root cause.** A known project port was treated as proof of which checkout it served.

**Prevention rule.** Check the listener's process command and source path before assessing a local change. Leave another task's server alone. Use an available project-approved preview port for the build under review, with an isolated browser context to preserve household saves.

**How to verify.** Confirm the server process points to the intended checkout, then check the loaded build and a distinguishing visible change. For this slice, port 4173 serves this checkout's production build and the object menu shows Washing machine above the description.
## [L-generic-skills-still-need-tool-mirrors] Check skill packaging before a documentation merge

**What happened.** The writing-style skill was merged as documentation with CI skipped at the owner's request. The subsequent full browser suite found its missing `.claude` mirror and a mirror test that required cloud-runtime wording in every skill.

**Root cause.** The new skill was validated on its own, without finding the repository's skill-packaging test. That test also generalized a requirement belonging only to the original cloud-run skill.

**Prevention rule.** For a project skill, inspect both discovery directories and run the focused mirror test even when CI is intentionally skipped. Keep tool-neutral skills identical; test runtime-specific wording only on the skill that needs it.

**How to verify.** `npm --prefix web test -- --maxWorkers=1 tests/agent-skill-mirrors.test.ts` must pass. Removing either discovery copy must fail the inventory check; changing either copy's instructions must fail the mirror check.


## [L-disclosure-hover-owns-action-surface] Keep actions stationary after hovering a description

**What happened.** The object description opened on hover, but collapsed as the pointer moved toward the action below it. That moved action rows underneath the pointer.

**Root cause.** Hover dismissal belonged to the disclosure alone, although the player was still using the surrounding menu. Reserving viewport placement did not preserve action positions inside the menu.

**Prevention rule.** Keep hover previews open while the pointer traverses their containing action surface. Remove boundary listeners when replacing the disclosure. Check movement from descriptive text to an action, not just whether the text opens.

**How to verify.** The object-identity regression test retains expansion after leaving the disclosure and closes it after leaving the boundary. A real browser traversal must leave the first action's rectangle unchanged and still activate that action.


## [L-finish-authorized-delivery] Complete the requested delivery before closing the task

**What happened.** The writing guidance was merged, but the related object implementation was left uncommitted. The owner had to ask twice to finish delivery.

**Root cause.** The documentation-only CI skip was treated as a reason to stop the implementation at local validation, rather than apply normal checks and finish the remaining delivery.

**Prevention rule.** Keep each deliverable and its publication state explicit. When the owner directs the work through merge, continue through commit, push, CI, and merge without introducing another approval request for the same scope.

**How to verify.** Before closing, verify the PR is merged, the remote main contains the implementation, and the task checkout is clean and synchronized. Report any actual remaining blocker directly.

## [L-bounds-belong-to-the-generator] Each importer remembered content bounds for its own sprites only

**What happened:** the empty reading chair was picked from the transparent space above its art, and the placement buttons floated about 36 pixels above it. The furniture importer recorded content bounds for every occupied frame, the ones interaction picking was written for, and none for the four empty facings. Nothing failed, because picking and camera framing quietly fall back to the whole padded canvas. The first kitchen import had missed bounds the same way.

**Root cause:** bounds were a table each importer had to fill for the sprites it knew about, and a missing entry meant "use the canvas" rather than an error. A survey of the shipped atlas found 833 of its 1,225 sprites with transparent space above their art and no bounds, 687 of them Sim frames.

**Prevention rule:** the atlas generator now cuts the transparent band above the art off every sprite that still has no box, after all importers run, and keeps the boxes they did record. It cuts only that band: a sprite draws nothing on the south half of its own tile, and trimming to the art would take the front of the trashcan's tile out of its click target. Sim body frames are left whole, because their animation frames share one envelope and the click target must not move between frames, which the picking tests in `web/tests/input.test.ts` pin.

**How to verify:** `test_every_sprite_whose_art_misses_the_canvas_top_has_bounds` in `assets/sprites/gen/test_content_bounds.py` scans the shipped atlas and fails on the pre-fix table, listing all 833 sprites. 146 sprites gained a box. "an empty reading chair is not picked through the transparent space above its art" in `web/tests/interaction-production.test.ts` fails when `pickSprite` ignores bounds.

## [L-mutant-cap-must-scale] One mutation timeout was timing two different commands

**What happened:** PR 116 reported eight mutants as hangs that had passed for months, among them two `rect_distance` clamps and `SimRng::from_seed`, which `docs/mutation-baseline.md` proves equivalent. Nothing about them loops. The first fix written for it was wrong in a way worth recording: it replaced the fixed cap with a multiple of the unmutated run, which would have set the cap to 20 seconds and timed out nearly everything. Reading the argv in the sweep's own `outcomes.json` is what settled it.

**Root cause:** the cap was timing two different commands. Each mutant is tested with `cargo test --workspace`, which takes about 57 seconds on the CI runner, so a mutant no test kills pays a full suite and one caught by a late test pays most of one. The unmutated baseline is not that command: cargo-mutants runs only the packages it will mutate, 1.2 seconds for `terri-core`, 0.4 for `terri-data`, over 60 for a shard holding a `terri-sim` mutant. The one fixed 60 second cap sat a few seconds above the workspace suite, so three added tests were enough to push eight mutants past it; and it sat below the baseline of any shard with a `terri-sim` mutant, which aborted that sweep before a single mutant ran. An aborted sweep still writes an empty `missed.txt` and `timeout.txt`, so four of PR 116's eight shards and six of PR 117's tested zero mutants and reported green.

**Prevention rule:** the cap is `max(120 seconds, 4 x the unmutated run)`, and both halves are load-bearing. The floor carries the ordinary shard, because the multiplier is measured against the smaller command and four times 1.2 seconds resolves to the tool's 20 second minimum. The multiplier carries the `terri-sim` shards, whose baseline alone is over a minute. A step now fails any shard whose sweep tested zero mutants, because an empty output file is not evidence. And `Timeout` in this tool means "hit the cap", not "looped": read the timings before hunting for a loop.

**How to verify:** locally, `cargo mutants --package terri-core -f crates/terri-core/src/clock.rs --test-workspace true --timeout-multiplier 4 --minimum-test-timeout 120 --build-timeout 600 -j1` prints "Auto-set test timeout to 120s" and catches all 11 mutants; without the floor it prints 20s. On CI, download a shard's `mutants-out-shard-N` artifact: `total_mutants` must be above zero, `timeout.txt` must be empty, and a survivor's test phase should sit near the workspace suite rather than exactly on the cap. The evidence here: PR 116 shard 0 tested 423 mutants with 52 at exactly 60.0 seconds; PR 117 shards 2 to 7 recorded `total_mutants` 0 with a 60.0 second baseline.
## [L-set-the-exception-aside-not-the-reach] A broad check was narrowed to admit one exception

**What happened.** Moving the person and How they feel toggles' 44-pixel flex rules into the block every compact screen matches tripped the test that the short Build dock panel scrolls whole, which asserted that nothing in that block was `display: flex`. The first fix narrowed that assertion to rules whose selector held `#builder-dock`. Fresh-context review added `.builder-actions { display: flex; }` to the block, a dock descendant with no prefix, and every test stayed green; the original assertion would have caught it.

**Root cause.** A proxy check that guards a whole region was rewritten to name the region's parts, so its reach shrank to whatever convention the parts happened to follow. The legitimate exception was one rule; the narrowing excluded everything that did not look like the dock.

**Prevention rule.** When a broad check blocks a legitimate change, set the one legitimate case aside and keep the check's original reach: strip or mask the exception, then run the old assertion unchanged. Never rewrite the check in terms of what it should catch; it will catch only that.

**How to verify.** After changing any test's matcher, add the thing the old matcher caught somewhere the new one does not name, run the test, and require it to fail; then restore the file and compare its hash. `web/tests/mobile-hud.test.ts`, "leaves the short panel to scroll whole", is the worked example.

## [L-close-audible-browser-tests] Close game instances when browser verification ends

**What happened.** Two isolated object-copy test tabs were left open after verification. The owner heard game audio continuing while the task waited for CI.

**Root cause.** Isolated storage was treated as sufficient cleanup. Reloading a game also resumed its runtime, and the test pages were never closed.

**Prevention rule.** Close each task-owned game page in a finally block when its browser check ends. Shut down task-owned preview servers once no further local checks need them. Never leave an audible game running during CI waits, and never close another task's pages or servers.

**How to verify.** Enumerate browser pages and confirm the task-specific test URLs are absent. Verify the owned preview port has no listener. For this incident, both object-copy test tabs were closed and the verified Vite preview process on port 4173 was stopped.


## [L-local-validation-does-not-require-duplicate-ci-wait] Do not block authorized delivery on duplicate remote checks

**What happened.** The object identity implementation passed local Rust and web tests, typechecking, builds, browser checks, and targeted mutation checks. Delivery then stalled waiting for a remote mutation shard, despite the owner's direction to finish.

**Root cause.** Remote CI completion was made an additional approval gate. Local evidence, additional remote mutation coverage, and the owner's merge authority were not kept distinct.

**Prevention rule.** Follow AGENTS.md: do not wait for duplicate remote checks after equivalent local validation passes. When the owner explicitly authorizes merging with a remaining remote check pending, merge and report its pending state accurately. Do not require another confirmation or extend the wait.

**How to verify.** Record the local validation and exact PR head, merge when authorized, verify the merged PR and clean synchronized checkout, and report any still-pending remote checks without claiming they passed.

## [L-death-test-fixtures-and-runner] Prove the fixture crosses the boundary

**What happened.** The initial count-order test stayed green with sorting removed. Moving a fixture to another archetype still happened to enumerate it in index order. An early test command also ran at the repository root, causing npx to fetch a runner into its cache.

**Root cause.** The ordering test did not first prove its input order differed, and the web command used the wrong working directory.

**Prevention.** Perturb table order by moving an entity out and back, assert the raw order is unsorted, then test canonical count order. Run the project's installed web tools from `web/` with package downloads disabled.

**Verification.** The death mutation record documents removal of the ordering mechanism and the failing assertion. The project manifest and lockfile remain unchanged; the final web checks use its installed Vitest.

### [L-death-selection-and-warning-layout] Removal must clear the visible identity

The first death play check removed selection correctly but left the dead person's name on the empty needs panel. The panel hid its content without resetting its caption. Reset every visible part of an empty selection, and test a transition from a named person to no selection rather than only starting empty. Verify the literal caption after death in the browser. The same check found warnings squeezed into the three-column roster: long functional warnings need the full row, verified at the actual HUD width.

The old startup check also rejected saves after the last person died. An empty household is now a valid world with a New housemate action. Restoring the old guard reproduced the browser failure; removing it allowed reload and a new move-in. Removal work must trace startup assumptions as well as live queries.

Review also found New housemate availability cached after a full household lost someone. Refresh it from the living count during frame updates; exercise full, one-free and empty states, and remove the frame wiring to prove the regression detects it.

## [L-mood-command-batching] Waiting state must follow the order it describes

Adding occupied-item mood exposed two cancellation cases: an autonomous wait has no player order to cancel, and an order staged earlier in the same paused command batch is not yet in the live queue. Clearing every waiting marker discarded autonomous frustration; checking only the live queue made batched and separately flushed commands disagree. Cancel only waiting owned by a current or staged order, or an active chain. Verify all three sources, an autonomous wait that survives Clear orders, and equivalent batched and split command sequences. The mood projection must also stop penalizing a freed or sold item without requiring a clock tick.

## [L-domestic-transition-saves] Claims must be valid at the action boundary

**What happened.** Integration review found cleanup claims surviving paused cancellation, room memory retaining washed dish identities, and dirty furniture or the last washing station remaining sellable. An early bulk source edit also matched an unrelated similarly shaped declaration.

**Root cause.** Claim cleanup was left to the next simulation tick, and text edits used patterns broader than the intended type or transition. A save or paused command can occur before that next tick.

**Prevention.** Maintain claim ownership at cancellation, replacement, washing, sale and death themselves. Validate both the claim-to-chain and chain-to-claim directions. Use small, context-specific patches and inspect each changed declaration before compiling.

**Verification.** Save and reload after every domestic work tick, after paused cancel/reissue, and exactly when washing finishes. Reject duplicated or unowned claims transactionally. Prove furniture refusal and ownership-aware reservation release. Remove the transition mechanism deliberately, observe the regression fail, and restore byte-identical source.

## [L-dish-art-needs-support-and-motion] Passing simulation tests does not make the dishes look right

**What happened.** The first domestic preview showed oversized gray stacks hanging over furniture edges. The owner rejected it. Pickup also hid the surface pile without showing a carried load, and the first replacement wash pose held its plate over the counter lip.

**Root cause.** One procedural stack represented every quantity. The renderer used one guessed screen offset for different furniture and cameras. Tests checked sprite presence, not physical support, scale, hand contact or action continuity. The visual review was deferred to the owner.

**Prevention.** Derive support points from authored furniture geometry and its export camera. Bake hand-held props into the rig when correct hand occlusion requires it. Inspect normal-scale gameplay, all furniture facings, mixed occupancy, lighting, near/far occlusion and ordered pickup-through-washing frames. Use a fresh-context adversarial reviewer before reporting visual work as complete.

**Verification.** Run the surface geometry, export registration and cleanup conservation tests; then inspect the real GPU fixture and a played meal. The plate must fit inside the surface, remain visible during transport, sit over the basin while washing, and disappear only on completion. Record rejected evidence as rejected, regardless of passing behavior tests.

## [L-shared-food-scheduler-boundary] Test the handoff through the actual scheduler

**What happened.** An idle invited guest could start a new snack while the cook's finished meal waited for table assignment. The original shared-meal test assigned the table directly before ticking, so it bypassed the failing boundary.

**Root cause.** Acceptance required a dining table before the collection step could use an already-known counter. Table selection ran later in the tick, after ordinary food selection. Making guests simply wait would also have stranded them if the cook was cancelled before choosing a table.

**Prevention.** Require only the resources needed by the current step. Let the prepared meal own its table assignment, publish that assignment within the station-selection pass, and make every diner honor it. Preserve ongoing activities and explicit orders.

**Verification.** Finish a guest's non-food activity on the cook's real plating-completion tick. On the next tick the idle guest must claim prepared food rather than start a snack. Save and reload with a collected portion while the table is occupied, cancel the cook, release the table, and prove the guest still eats exactly once.

The fresh review also caught table selection borrowing the newest retained
meal by cook identity. A cook can have an older unclaimed meal and a newer
solo meal. Save an explicit current batch association, clear it at completion
and cancellation, and bind only that batch. Reject duplicate batch identities
and mismatches between a serving cook's target and the batch's table. Tests
must distinguish old leftovers, current food and already-finished guest claims.

Played verification then showed the cook finishing before the last guest
arrived. Serialized pickup and travel can exceed the cook's eating time.
Starting independent eating countdowns does not provide a shared meal. Save
a one-way dining-start decision and retain each present diner's full eating
interval while active participants gather. Exclude player interruptions and
busy guests; urgent needs and insufficient free seats must release the group.
Verify a sustained four-person eating interval, save/load during gathering,
and each release condition. A one-tick overlap is not an adequate assertion.

## [L-autonomy-positive-choices] Random seeds do not fix deterministic eligibility

**What happened.** New games repeated because startup used a constant seed, while
threshold gates and per-target argmax choices also excluded alternatives.

**Root cause.** Weighted selection happened after irreversible deterministic
filtering. A random generator cannot select a choice that never enters its pool.

**Prevention.** Keep physical eligibility separate from utility. Normalize targets
and their interactions separately, retain positive exploration, and reserve an RNG
bucket for microscopic probabilities so rounding cannot exclude them.

**Verification.** Compare traces across seeds and after save/load; sample both
interactions on one object; measure survival and comfortable choice diversity.

## [L-mutation-compile-baseline] A compiler error is not a caught mutation

**What happened.** A mutation harness attempted three deletions while newly added
fixtures failed to compile, producing no executed assertion evidence.

**Root cause.** A nonzero cargo exit was treated as sufficient detection.

**Prevention.** Require a compiling, passing baseline; abort on compilation errors.
Accept detection only when the named test actually fails with an assertion.
Restore original bytes in a finally block and verify them after each deletion.

**Verification.** Record the failing test and assertion, plus byte restoration,
for every mutation. Compilation failure remains unverified evidence.


## [L-autonomy-causal-fixtures] Saved state and traces must survive varied decisions

**What happened.** Wider autonomous sampling invalidated fixtures that relied on
an incidental selected action. Appended save data moved hard-coded tail offsets;
legacy migration intentionally consumed restored RNG draws. A low-instinct trace
also crashed while auditing a person who had already died.

**Root cause.** Tests treated one old random sequence as a state guarantee, and
trace diagnostics assumed every initially recorded person remained alive.

**Prevention.** Explicitly command the action a persistence fixture needs. Derive
serialized suffix boundaries where possible, distinguish current-save continuation
from legacy migration, and query live components before auditing an original ID.
Use probability assertions for eligibility and record the seed for exact choices.

**Verification.** Run replay and save/load tests, including zero and failed loads;
complete traces through a death. Count short completion transitions separately
from occupied-target waits when diagnosing apparent stillness.
## [L-roadmap-status-reconciliation] A shipped slice must leave the future-work lists

**What happened.** The roadmap audit on 2026-09-30 found floors, windows, sales,
colourways, the yard and street still listed as future work in parts of
FEATURES.md and GAME-SYSTEMS.md, despite their individual entries recording merges.
The restart list still prioritised older acceptance work, and the systems summary
still called the save format V3 when the writer was V5.

**Root cause.** Delivery updated individual feature paragraphs without reconciling
the overview tables, milestone bullets, remaining-work lists and suggested order.
Subjective completion percentages concealed which slices had actually shipped.

The same omission affected audio: TIM-TODO.md still called recorded voices
unbuilt and described merged source identity as a candidate branch. After PR152,
the audio foundation's graph section and FEATURES.md also retained the former
household-wide conversation limit despite their more detailed ownership contract.

**Prevention.** After a merge, update the feature entry and every current status or
dependency claim that names it. Mark the delivered slice complete while keeping
the larger system partial when extensions remain. Keep historical evidence dated
and separate from current priorities; keep owner acceptance separate from code status.

**Verification.** Compare the roadmap with merged PRs, the live command enum,
save-version constant and content. Search both roadmap files for the feature's
name and ID, stale branch references and future-tense claims, including TIM-TODO.md
and the current specification's overview sections. Ensure summary and
detail agree, and run `python check-doc-ids.py` after the documentation update.
## [L-furniture-preview-replacement] Furniture previews must replace their source at every destination

**What happened.** Moving furniture to a separate tile left the original visible,
so the piece appeared duplicated. Confirm also kept the piece selected.

**Root cause.** Replacement was conditional on a valid overlapping footprint.
The successful placement path refreshed selection instead of clearing it.

**Prevention rule.** Any drawable move preview owns the piece's presentation.
Hide its old base, foreground and marker until the preview ends. Keep simulation
state unchanged until Confirm succeeds, then clear selection.

**How to verify.** Builder tests cover non-overlapping and refused previews,
foreground layers, unchanged saved bytes on Cancel, successful deselection, and
selection handoff. Inspect a moved piece in the running game before confirming.

## [L-powershell-source-search-correction] PowerShell source-search correction (2026-09-30)

**What happened.** Three searches passed wildcard paths to ripgrep and failed.
**Root cause.** PowerShell left the wildcard in the literal path argument.
**Prevention rule.** Apply the existing lesson at the first failure: pass a real
folder and use ripgrep's `-g` filter. The fresh-context review confirmed this.
**How to verify.** `rg --files web/tests -g '*frame*'` returns the matching files.

## [L-append-corrected-bookcase-art] Preserve historical atlas records when replacing live furniture art

**What happened.** Replacing four bookcase records broke historical prefix checks.
**Root cause.** Those tests preserve old atlas identities and decoded pixels, not
just the objects currently using them. Replacing records after one validation
pass still changed the final atlas that other historical tests inspect.
**Prevention rule.** Append corrected art under new sprite names, and point the
object's presentation at them. Keep old records unchanged and retain the existing
fingerprint and save compatibility checks.
**How to verify.** Run the complete sprite generator suite, the atlas freshness
check, content compilation, and save compatibility tests. Check all four facings.


## [L-screenshot-errors-are-unfinished-verification] Resolve visible errors before presenting proof

**What happened.** A UI screenshot contained Load failed, but the result treated
that visible failure as an incidental limitation. The owner had to point it out.
**Root cause.** A previous voice change appended an option inside every saved
entity without versioning that row. The old V1 bytes no longer decoded.
**Prevention rule.** Investigate visible runtime errors before presenting a
screenshot as proof. Freeze historical row types; appending inside repeated rows
requires explicit migration rather than a default on the new field.
**How to verify.** Load the captured bytes through the public loader, compare all
saved entities and replay after resaving, reject malformed and unknown formats,
and reload the browser origin without clearing its saved file.

## [L-last-provider-sales-respect-owner-choice] Handle missing stations instead of denying sales

**What happened.** A last-provider sale restriction blocked removal of the only
fridge or stove without the owner's request.
**Root cause.** The recipe runtime waited indefinitely for a missing station,
and the sale validator hid that flaw behind a gameplay restriction.
**Prevention rule.** Do not impose that restriction. Abandon impossible unfinished
recipes without payout and exclude incomplete recipes from autonomous selection.
**How to verify.** Sell the only appliances, save and load the result, and test
missing future stations separately from existing stations that are reserved.

## [L-action-cards-project-live-state-and-visible-rows] Verify projections against their source

**What happened.** Review found queued recipes labelled unavailable, suspended
recipes masking active actions, and an unrestricted card list that could throw
when spread into a DOM call. Bookcase and menu tests also passed mutations that
restored their defects; the save test compared two already-migrated copies.
**Root cause.** Labels omitted the recipe menu rows and preferred persistent
recipe state over active commitments. Rendering ignored the viewport boundary.
Tests substituted expected facing, inspected only the first matching media
block, or omitted a direct comparison with the decoded historical source.
**Prevention rule.** Follow the actual menu indices and active components.
Preserve all stored orders while formatting and transferring only the bounded
visible window. Limiting DOM rows after fetching the whole queue leaves the
hidden work proportional to queue length. Observe
the transform actually sent to drawing and every containing CSS scope. Compare
every retained save field with its historical source before migration.
**How to verify.** Recipe and interruption tests, a 200,000-order render test,
all retained historical fields, and actual drawing-facing assertions are backed
by recorded failing mutations and byte-identical restoration. Browser checks
cover expanded menus on phone portrait and short landscape viewports.

The final played pass also exposed stale Help and string-inventory references
to Build under Options. Moving a control requires updating its navigation
instructions and inventory as well as its layout. Verify the actual Help text
and search all current control-location references before delivery.

## [L-heavy-verification-runs-stay-sequential] Keep target copying away from timed file tests

**What happened.** Two atlas file tests exceeded their five-second timeout while
a mutation run was copying the existing Cargo target directory. Their assertion
checks had not failed. A quiet rerun passed all 14 atlas tests in 112 milliseconds;
the subsequent full web run passed all 1,232 tests.
**Root cause.** Heavy verification jobs overlapped on a shared host. The observed
timing points to file I/O contention; it does not establish an atlas defect.
**Prevention rule.** Run heavy build and test gates sequentially. Use a separate
mutation build without copying the large target directory. Do not increase test
timeouts to conceal an overloaded verification run.
**How to verify.** Complete the ordinary web suite before starting mutation
compilation, and retain both the failure and the quiet-run result.

## [L-autonomy-tests-cover-order-and-startup-wiring] Test the path that can actually regress

**What happened.** Fresh-context review found two coverage gaps despite passing
unit tests: migration fixtures already used sorted storage, and fresh-game tests
bypassed the production constructor call.
**Root cause.** Fixtures made the sorting mechanism unnecessary, while separate
helper and constructor tests left their connection untested.
**Prevention rule.** Deliberately scramble storage when ordering matters. Exercise
the production connection as well as each endpoint when randomness crosses layers.
**How to verify.** Removing the migration sort and replacing startup seeds with
constants each produce the intended assertion failure. Restore exact source bytes
and rerun both tests; evidence is in `docs/autonomy-mutation-evidence.md`.

## [L-control-mockups-need-a-space-budget] Size the controls before polishing the mock-up

**What happened.** The first desktop and mobile control mock-ups devoted too
much screen space to panels. The owner preferred the household console's
organization but rejected its bulk and unused space.

**Root cause.** The review prioritized grouping and visual polish without
holding the result to a measured share of the game viewport. Stating pixel
targets in an image prompt did not ensure the resulting geometry met them.

**Prevention rule.** Define the default panel footprint before drawing it.
Keep frequent readouts visible and put secondary detail behind explicit
disclosures. Remove duplicate content and excess padding first; use separate
desktop control sizes and mobile touch targets. Treat pixel labels in a
concept as intentions until the rendered geometry is checked.

**How to verify.** Measure the bottom strip, world controls and uninterrupted
canvas at each target viewport. Compare collapsed and expanded states, check
44px mobile hit areas, and verify that world selection still reaches the
canvas outside the controls. The compact console revision targets a 96px
desktop strip at 1440 by 900; its image is not implementation evidence.


## [L-compact-hud-collapse-and-css-coverage] Folding UI must preserve warnings and test coverage

The compact HUD's first pass hid the household roster on Collapse and retained
only the selected Sim's critical-needs summary. That lost another household
member's death warning. Moving responsive rules into a new stylesheet also
left the existing Build guards reading only index.html. Adversarial review
caught both before delivery.

Root cause: presentation boundaries moved without moving every dependent
warning and test boundary. Preserve household-wide warnings outside the
collapsible body, independent of selection. Scan every shipped stylesheet when
a guard claims to protect a CSS invariant; keep exceptions limited to exact
legitimate selectors. Opening panels must coordinate on activation, not depend
on an incidental pointerdown that keyboard activation never sends.

Verify with a non-selected endangered member and no selection while collapsed;
keyboard activation from Options into Sim details; and deliberate illegal flex
and hidden-state rules injected into the additional stylesheet. Each guard must
fail, then the exact original bytes must be restored. The compact HUD evidence
records those failures and the final passing suite.

## Dining table support and picking checks (2026-09-30)

Adversarial in-memory mutations showed that a grounded leg could still extend
through the tabletop while passing contact tests. Positive contact alone does
not establish a part's correct dimensions. The table checks now pin every
leg's evaluated dimensions and reject widened and taller saved-scene copies,
as well as detached parts and a wrong authored basis. Verify by running the
dining layout suite and `check_table_scene.py`; the latter must catch eight
damaged copies and reload the byte-identical clean model.

A picking test clicked above the entire wide image, so it did not test blank
padding inside that image. The corrected point is within the registered canvas
but above the visible art. Deliberately extending only the top content bound
must now make the test fail in every facing. Test the claimed boundary, not a
point the outer rectangle would reject anyway.

## Sofa rotation and supported-part positions (2026-09-30)

The old long sofa reused one front for SE/NW and another for SW/NE. Replacing
it with a real rotating model cannot preserve those incorrect opposing views.
Trace the shipped default's physical front and game coordinate transform;
preserve facing values, footprint and origin, then document which old pictures
were wrong. Verify all four actual placements and saved rotations, not merely
four differently named PNGs.

Independent review also found that dimension and contact checks would allow a
cushion to slide into its neighbor while remaining supported. Pin the saved
part centers as well. `check_sofa_scene.py` must reject an overlapping-cushion
copy, alongside disconnected, oversized, rotated and missing parts. Keep the
clean source byte-identical. Interaction labels are not animation evidence:
execute the actual action and inspect the body's visual code before claiming
that a sofa provides a reclining pose.

## Media support graphs and meaningful rejection tests (2026-10-01)

The first media validator checked exact coordinates before physical contact.
Detached-part tests therefore passed without proving the contact guard worked.
Check semantic floor/contact rules first and require the intended rejection
message. Deleting either guard must then break the negative-test proof, not
merely reveal another assertion that the harness accepts as equivalent.

Nonempty support lists and pairwise overlap also failed to establish ground
support. An independent in-memory mutation floated a cyclic radio assembly
above its feet while every initial pure test passed. Pin the cabinet's four
foot supports and recursively reject cycles. Verify both the deliberately
floating graph and a separate grille/rib cycle fail; reload the clean saved
model and require byte-identical source afterward.

Browser visual proofs need a separate document if they replace page contents.
Replacing the live game's body leaves its animation loop updating missing UI
nodes, and its viewport CSS can clip a review board. Use an isolated HTML
harness for GPU captures, then ordinary production controls for played proof.
Read control types from the current DOM: Light is a button, not a select.
Committed-facing evidence must wait for the actual simulation facing, not
only the Build preview label. Active-action evidence must check the first
queue entry; finding the action later in the queue proves only that it waits.

## Armchair fit and finite support neighborhoods (2026-10-01)

Two chair candidates looked plausible in stills while their evaluated solids
intersected the unchanged sitting body. The first collided at arms, trousers
and hips; the second still buried the hip bridge slightly in the cushion.
Fit the furniture to the approved pose, then test all visible body geometry
against every chair solid. Do not hide limbs, offset the Sim or exempt a
colliding body part. Candidate 03 clears both triangle-crossing and containment
checks; raised-seat and raised-arm copies must fail those same guards.

Support proximity and exact coplanarity are different questions for a rounded
rigid hip above a nearly flat cushion. A tiny closest gap can coexist with a
wider near-support neighborhood. Independently review those tolerances and
state that they approximate visual support, not simulated compression. Do not
infer area from X/Y extents alone: diagonal collinear points have both extents.
Require a finite projected hull area and test diagonal and duplicate samples.
Verify every seated sample and retain failed candidate evidence. Describe the
unchanged shoe-floor gap honestly rather than calling it exact floor contact.

When replacement art retires the last shipped foreground overlay, keep generic
foreground tests with explicit fixtures. Do not give their body and foreground
the same sprite ID: that lets a cross-wired pointer or reconstruction pass.
Independent review caught this in the first migrated armchair fixtures. Use
distinct valid IDs and assert their difference. Verify the foreground tests
still pass, and delete preview foreground suppression to prove the browser
fixture catches the resulting duplicate layer.

## [L-floor-lamp-solids-and-verifier-contract] Inspect hidden construction and the current browser contract

**What happened.** A floor-lamp render passed visual review while its base
contained an internal wire edge and its stand continued through the bulb.
The saved-scene and code reviews caught these separately. Browser proof
also failed after assuming a clock accessor name, clicking behind the help
dialog and reading the original object row during a Build preview.

**Root cause.** Revolving zero-radius profile rings produced degenerate
geometry. A convenient continuous stand hid incorrect construction inside
the shade. The browser helper guessed interface behavior instead of reading
the actual bridge and controls.

**Prevention.** Use single axis vertices, check closed meshes and evaluated
contacts, and require intentional clearance around internal parts. Keep
source-art acceptance separate from physical and runtime acceptance. Read
the clock and control contracts before scripting: `clockTick()` reads time,
`tick()` advances it, confirmation clears furniture selection, and the help
dialog intercepts clicks. Preview art replaces the original object instance;
inspect the live output, not its suppressed row. After repeated helper
failures, obtain a fresh-context approach review before another attempt.

**Verify.** Lift the lamp base, detach supports, and cap the shade opening;
each saved-scene check must fail for its intended cause. Deleting ground,
contact and opening guards must break that rejection proof. In the browser,
reselect before each rotation, wait for the applied command, and compare
paused save bytes after a complete turn. Use the natural clock for the played
pass and always close task-owned pages.

## [L-coat-rack-facing-and-contact] Preserve the authored direction and measure surface contact

**What happened.** The coat rack's first model rotated its crossbar 90 degrees
relative to the old SE sprite. A saved-scene checker then rejected a supported
upright at an almost exact base joint. The GPU proof also confused received
room light with an object's own emission.

**Root cause.** The shared exporter rotates its authored basis; a one-tile
footprint does not expose that mismatch. Bounds differed by a floating-point
seam before the old contact check could apply its inside tolerance. The
instance light field combines emission and received illumination.

**Prevention.** Trace the old physical direction before authoring, and bake
needed corrections into the model rather than changing saved facings. Accept
exact joints through evaluated surface-distance evidence, not loose bounds.
Check a drape's whole fold and connectivity as well as interior support
samples. Compare source emission separately from the final light value.

**Verify.** Inspect all four source views and the played room. Lift the base,
detach the rail, float or penetrate the fabric, overhang its edge, and add a
disconnected scrap; require each rejection. Delete the corresponding guards
to prove that the negative tests notice. Preserve the original model bytes.

## [L-plant-containment-and-instance-identity] Check container fill and distinguish shared sprites

**What happened.** A plausible plant render hid soil floating above its pot's
floor. Independent review then identified that contact alone could allow soil
to shift through the wall. Two placed plants also made the prior sprite-only
GPU lookup unsuitable. The first connectivity check needed an explicit Blender
vertex lookup table, and a preview test guessed the wrong suppression value.

**Root cause.** Visible appearance did not establish internal support. Connected
objects can still intersect the wrong surface. A sprite is shared artwork,
not a unique instance identifier. Blender mesh indices and renderer suppression
both have explicit contracts that the new tests initially missed.

**Prevention.** Fit fill geometry to the actual container and verify floor
support separately from containment. For this convex planter, test evaluated
soil vertices against the evaluated outer hull; do not generalize that hull
test to concave vessels. Build mesh lookup tables before indexed access. Resolve
GPU rows by entity ID; previews park the replaced row off-screen and append a
new body, while the other plant must stay unchanged.

**Verify.** Lift the soil, move it sideways, detach a branch or leaf, and delete
the corresponding guards. Require specific failures, not unrelated exceptions.
Rotate and recolour both plants independently, test preview suppression, and
compare the paused save after a complete turn through production controls.

## [L-restored-render-state-must-match-components] Check the load boundary before a frame repairs it

**What happened.** Ottoman recolour tests found that V5 loading retained the
saved colour component and world hash but exposed colourway zero through the
render buffer. The Build preview used the component and disagreed with the
normal object until a frame refreshed the buffer.

**Root cause.** Base restoration prepared rendering before the V5 loader added
colourways. Existing save tests checked components and hashes; subsequent ticks
or paused-frame flushes concealed the stale derived data.

**Prevention.** Refresh the complete candidate's render metadata at the end of
V5 restoration, after validating and restoring every field. Do not tick or drain
saved commands to repair a load. Compare component and rendered state directly
at the API return boundary, before normal frame processing.

**Verify.** Save differently recoloured objects with a pending recolour command.
Load and immediately compare component values, render columns, save bytes, world
hash and clock. The pending command must remain pending. Native and real-WASM
tests must fail when the final metadata refresh is removed.

## [L-shelf-support-does-not-prove-clearance] Check both sides of a fitted object

**What happened.** Independent bookcase review made a supported book taller
in memory. The layout tests still passed although it entered the shelf above.
The candidate itself had 0.002 clearance and needed no art change. An initial
reading test also incorrectly treated a socket-only render column as a general
gameplay target, and two proposed picking points missed the intended padding.

**Root cause.** Support and source-derived dimensions do not independently
establish fit. Render columns and picking bounds have narrower contracts than
their names suggest.

**Prevention.** Check the actual free space above every supported book as well
as contact beneath it. Read the projection contract before asserting a target:
standing reading has no socket. Choose negative picking points inside the
registered canvas but outside the actual facing's content bounds.

**Verify.** Raise a book's top while preserving its supported bottom; require
the explicit overhead-clearance failure. Delete that guard and require the
negative proof to notice. Test standing reading with its exact active queue,
visual action, activity and ordinary adjacent position. Test front and rear
padding separately because their projected bounds differ.

## [L-mutation-budget-must-span-prs] Bound mutation runners across the repository

**What happened.** Several PRs each started an eight-shard mutation sweep.
Their combined runner use delayed main CI and Pages for roughly two hours.
Review of the fix also found that a manual sweep on main shared its outer
workflow group with push CI, so waiting mutation jobs could still hold up
deployment after runner use was bounded.

**Root cause.** Per-PR cancellation removes obsolete heads of that PR; it does
not bound work across different PRs. A shared group with the default pending
queue would cancel another PR's waiting shard. Grouping manual and push runs
together also serializes work that has different delivery responsibilities.

**Prevention.** Share one mutation group per shard across the repository, use
`queue: max` with cancellation disabled in those groups, and separate events
in the outer workflow group. Keep all eight shards and all mutation gates.
The queue holds at most 100 pending jobs per group; cancellation at that limit
is incomplete evidence. Existing dispatched runs retain their configuration.

**Verify.** Run the CI script tests. Remove the shared budget, make it unique
per run, replace pending jobs, enable cancellation, add a ninth shard, stop
invoking the guards, cancel main runs, or remove event isolation. Each fault
must fail a named assertion, and the original workflow bytes must be restored.
Check that GitHub accepts the updated workflow. This validates configuration;
it does not measure account-wide runner availability or promise a queue delay.

## [L-dom-fault-parent-ownership] A DOM fault probe needs real parent ownership

**What happened.** A Sim details fault intended to stop reordering existing
habit rows initially passed. The fault checked `parentElement`, but the test
double exposed only its internal `parent` field. It therefore appended every
row on every render, which happened to produce the right order.

**Root cause.** The probe was different in the test double from a real DOM.
Its passing result did not establish that the intended defect was covered.

**Prevention.** Keep ownership properties used by a fault faithful to browser
semantics. Record an uncaught probe as incomplete evidence, inspect the cause,
and fix the fixture or the probe before claiming detection.

**Verify.** `personal-details.test.ts` now exposes `parentElement` from actual
parent ownership. Replacing ordered insertion with append-only-when-unparented
fails the named row-reuse and ordering assertion. Production bytes were
restored exactly, then the full web suite passed. Browser scrolling and Sim
switching provide separate evidence for the actual DOM.

## [L-dialog-focus-visible-return] A hidden opener cannot receive modal focus

**What happened.** Escape or Keep playing in Load and New game closed the
dialog but left keyboard focus on the document body. Returning to Traits
after selecting the maximum traits could likewise target a disabled checkbox.

**Root cause.** Options hid the original modal openers. Only confirmed storage
operations had an explicit visible focus return; cancellation relied on the
browser. The Traits page assumed its first checkbox remained enabled.

**Prevention.** Test cancellation separately from confirmation and choose a
visible, enabled return target after a disclosure or page change. A confirmed
operation retains its pause and focus ownership until it settles. Preserve
focus that the player deliberately moves elsewhere.

**Verify.** Execute the actual Load and New game close listeners, checking
cancelled and pending operations independently. Fill Traits without selecting
its first row, go Back, then Next. Removing either focus return or either
operation guard, and restoring unconditional first-row focus, each caused a
named assertion failure. All five faults were restored byte-for-byte before
the full web suite passed.

## [L-save-presence-boundary-after-later-fields] Padding rules belong to a field boundary

**What happened.** Review of the planned bed-save format caught a rule rejecting
every padded decode whose sleeping-place record was present. That works while
the record is last, but would refuse complete bed-era saves after another
feature appends fields.

**Root cause.** The rule used total padding as a proxy for whether padding
completed this particular field.

**Prevention rule.** Track the historical presence boundary of each appended
record. Padding only later fields may retain an earlier, physically complete
record; padding must never manufacture that record from a truncated payload.

**How to verify.** Test a complete bed-era payload after appending later fields,
as well as every interior truncation of the grouped bed record. This was a
documentation correction before implementation, not a shipped loader defect.

## [L-unchanged-text-node-churn] Unchanged text assignments still replace nodes

**What happened.** The cooking-audio memory check failed exact DOM equality in
an audio-disabled control: 1,435 nodes became 1,434. Paused HUD panels repeatedly
assigned the same text, despite a comment claiming those writes were no-ops.

**Root cause.** Assigning an element's `textContent` replaces its text child even
when the string is unchanged. A render between garbage collection and the DOM
counter sample exposed the detached old node. A focused probe reproduced the
one-node difference using only the `needs-caption` writer.

**Prevention.** Compare the actual DOM text before assigning. Do not add a second
cached UI state, change the memory allowance, or accept a failed equality check
because its count declined. Text refreshes must still repair changed DOM values.
Include open disclosures in the writer inventory: personal details and bed
assignment retained the same redundant writes after the always-visible HUD
was fixed. Both now use the shared text guard, with repeated-refresh controls
that also require changed values to appear immediately.
The native personal-details browser control replaced 23 text children and
emitted 460 text mutations over 20 unchanged public refreshes. The shared text
guard reduced both to zero while still repairing changed text; see
`assets/review-evidence/personal-details-text/README.md`.

**Verify.** Check text-child identity across repeated unchanged public updates,
then change the source value and verify the text updates. The causal diagnostic
had 250/250 stable samples when unchanged writes were suppressed; production
acceptance also requires the unchanged whole-game memory check after the repair.

## [L-memory-endpoints-need-complete-projection] Await the whole UI projection before measuring

**What happened.** After redundant text writes were fixed, the memory proof
still saw one fewer DOM node at an audio-disabled endpoint. Its baseline had
the selected person's `Office clerk` career text; the final endpoint did not.

**Root cause.** Clearing simulation selection does not synchronously update
independently throttled panels. The normalizer checked only rows and warnings
which could already be empty, accepting a partially updated presentation.

**Prevention.** Establish the complete semantic endpoint before collecting:
all selected-person fields and rows cleared, derived summaries updated, and
audio drained. Do not repair an invalid baseline by relaxing exact equality,
freezing the page, or adding a delay that merely makes the race less likely.

**Verify.** A fixture with the old subset ready and stale career text must stay
unready. Reject each other incomplete panel and missing required node. Retained
node, document and listener changes in either direction must still fail the
unchanged acceptance calculation. Then exercise the actual browser transition.

## [L-audio-player-merge-interruption-coverage] Reconcile new players with newer lifecycle fixes

**What happened.** Refreshing the held toilet-flush branch brought in main's
automatic audio-recovery fixes, but unavailable-frame cleanup omitted the new
toilet player. Its active recording could resume a frozen tail after recovery.

**Root cause.** Git merged the files without a textual conflict at this method.
The old branch tested explicit gesture recovery, while main's newer cleanup
handled browser-driven recovery. Neither branch had tested the combined player
set through that boundary.

**Prevention.** During integration, compare every player against every lifecycle
boundary. Automatic recovery without a gesture needs its own test. Keep
unrelated recording preload out of category-specific fetch/decode test gates.

**Verify.** Deleting toilet cleanup fails eight public-controller cases across
four frame entry points and two hardware states. Native offline rendering also
rejects the retained flush; the restored code produces zero post-cancellation
output. Keep modeled interruption evidence distinct from real OS interruption,
and do not use this repair to clear unrelated retained-memory acceptance.
The ECS lifecycle browser check repeated this timing mistake with the selected
name: one frame applied the command before the throttled panel refreshed. Wait
for the displayed name to match the clicked person before asserting the panel,
while separately checking that paused simulation time stayed fixed.

## [L-flex-controls-enlarged-text] Reserve control width and let labels wrap

**What happened.** Separating the New housemate instinct labels fixed their
run-together text, but an initial non-wrapping flex row failed at 320px with
the fieldset text doubled from 13px to 26px. The full random-value label
overflowed the dialog and reduced the slider to zero width.

**Root cause.** The output could not shrink, while the slider could shrink
without a lower bound. Ordinary phone text fit and concealed the failure.

**Prevention.** Give an interactive slider a useful minimum width and let
long labels wrap. Check both automatic and manual values with enlarged text;
their output lengths differ substantially.

**Verify.** In a local doubled-text fixture at 320 by 568, the corrected
random-value row kept a 150px slider without horizontal overflow. The manual
value 100 retained a 102px by 44px slider and accepted keyboard input. The
fixture changes only the fieldset font size; it is separate from the shipped
page and is not a claim about browser or operating-system text scaling.
## [L-contained-fish-can-still-be-invisible] Measure sightlines before rerendering

**What happened.** Three aquarium candidates kept hiding fish beneath an
opaque lid in at least one rotation. Taller glass, stronger colours and small
height changes improved individual pictures without solving all four views.

**Root cause.** The layout tests proved that fish fit inside the water, not
that the fixed downward-looking camera could see their complete silhouettes.
Far-side positions need more clearance than centre positions. Transparency
also has to survive the runtime's alpha threshold, not merely a PNG viewer.

**Prevention.** After repeated similar failures, obtain fresh-context review
and measure the missing invariant. Trace sightlines from the evaluated body,
tail and eyes through every camera direction before rendering another batch.
Keep the selected exterior where possible; reposition the contents only after
checking whole-body clearance, separation and the other interior objects.

**Verify.** The rejected third candidate must fail the lid-ray diagnostic.
Require both new frames to clear it, then inspect reduced sprites and actual
GPU output. Compare all RGBA channels outside fish-motion regions. Geometry
checks do not establish rendered readability or owner approval.

Record which camera stage produced projected coordinates. The aquarium's
embedded pre-render checks run before final canvas registration. Their clear
lid sightlines remain valid because the view direction is unchanged, but
their pixel bounds cannot define runtime motion masks. Reopen the saved,
registered scene and require the masks to match those final projections.

## [L-bed-pending-focus] Preserve focus before disabling command controls

**What happened.** Keyboard activation of Assign in the first bed-assignment
surface moved browser focus to BODY while the simulation command was pending.
The successful result left Assign disabled, so focus never returned.

**Root cause.** Disabling the fieldset disabled its focused native button.
Controller-only tests covered command feedback but did not instantiate the
DOM surface or exercise its event listeners and focus transitions.

**Prevention.** Before disabling controls that own focus, move it to an enabled
section. After feedback, return it to the chooser only if it is still on that
section. Do not take focus back after the user has navigated elsewhere. Test
the real surface callbacks and keyed options as well as controller state.

**Verify.** Actual keyboard Assign and Clear return to the chooser at desktop,
phone and short landscape sizes. Removing any of the three change/click
listeners, the pending-focus handoff or result-focus recovery must fail a
named DOM assertion. All five faults failed and original bytes were restored.

## [L-bed-migration-fixture-ownership] Pin every claimant in historical save fixtures

**What happened.** A historical single-bed migration fixture directed one Sim,
but left two others autonomous. A second Sim claimed the new second place;
the legacy loader correctly rejected the resulting two-claimant state.
Another malformed-save test retained a sleep-place row after changing its
owner to an exclusive action, allowing row-count validation to mask the
exclusive-owner check it was meant to exercise.

**Root cause.** The fixtures specified one directed action without accounting
for all autonomous claims created by the same tick.

**Prevention.** Isolate the intended historical claimant and assert its exact
active-place list before loading. In malformed fixtures, remove unrelated
invalid state so the intended validation mechanism is responsible for refusal.

**Verify.** Every historical loader preserves the isolated walk and running
sleep. Removing the mixed exclusive/sleep owner guard must make its targeted
atomic-refusal test fail, independently of active-row count validation.

## [L-bed-model-world-axes] Confirm bed lanes in world coordinates before routing

**What happened.** The first place-access proposal used the double bed's world
X perimeter for its two sleeping lanes. Asset review found that default-SE
world X runs from head to foot; the sleeping lanes meet the world Y edges.
The plan was corrected before navigation code or assets were changed.

**Root cause.** Model-local lane names were treated as world-tile axes without
checking the existing model's registration.

**Prevention.** Agree the mapping from model-local lanes to base-facing tile
approaches with the asset owner before routing or generating occupied art.
Transform the agreed tiles by relative object facing, not camera orientation.

**Verify.** Default-SE place zero maps model-local positive X to approaches
`(0, -1)` and `(1, -1)`; place one maps model-local negative X to `(0, 2)` and
`(1, 2)`. Prove all four placed facings during navigation and occupied-art
verification. Agreement on axes alone does not establish pose fit.


## [L-fingerprint-fixtures-by-role] Classify every digest expectation before changing a hash

**What happened.** The sleeping-access digest update exposed old expected-current
values in the data, simulation and WASM suites on successive runs. The two WASM
assertions printed whole worlds even though only their fingerprint differed.

**Root cause.** The initial impact scan covered compatibility tables and their
nearby tests, but missed whole-snapshot comparisons against historical fixtures.
Historical source constants and expected current outputs had been treated as
one search problem despite requiring opposite edits.

**Prevention.** Inventory digest literals and whole-snapshot fixture assertions
across all crates before rerunning. Preserve source bytes and frozen-algorithm
pins. Update only the explicitly migrated current output, then compare the
remaining world unchanged. After repeated fallout, use a fresh-context reviewer
rather than continuing one assertion at a time.

**Verify.** Parse or isolate large snapshot differences before changing an
expectation. Pin both current and reconstructed migration endpoints, prove the
unmodified historical source loads, and require unrelated metadata changes to
close the bridge without replacing the live world.

## [L-bed-lifecycle-exact-state] Ownership preservation needs identity, not counts

**What happened.** Shared-bed lifecycle tests caught missing release calls but
could still accept swapped permanent assignments or a changed partner place.
The vanished-target cleanup test also failed to prove leases existed before
testing their removal. Independent review caught these assertion gaps.

**Root cause.** Counts and component presence were used to claim preservation
of specific owners and state. Cleanup assertions did not establish the state
they intended to clear.

**Prevention.** Compare the complete assignment map and exact surviving target,
place and action. Account explicitly for the expected duration decrement.
Before cleanup, assert the specific claims, paths and shared marker exist.
For a multi-tick handoff, check the surviving action on every tick. Two replay
copies can agree while both freeze or restart the same countdown.

**Verify.** Swap assignment ordinals while retaining their count, corrupt the
surviving partner's place, and omit admission's place insertion. Each fault must
fail its named lifecycle assertion. Restore source bytes and rerun the suite.
## [L-privacy-legacy-geometry-and-contact] Derived events must respect retained legacy worlds

**What happened.** Review found that privacy regions merged the frozen legacy house through its doorway gaps, and a failed legacy conversation approach could leave the new unmet-need penalty.

**Root cause.** The new region builder assumed explicit doorway records; old layouts store wall cells. The conversation hook trusted arrival acceptance, although legacy movement preserves historical random draws even when contact has failed.

**Prevention.** Check every retained layout representation when deriving geometry. Preserve the frozen house's known doorways without rewriting its save. Gate new social consequences on live reservation, target state and contact independently of compatibility behavior.

**Verification.** The legacy room test first failed with one region instead of five, then passed for both frozen layout variants without changing saved architecture. The invalid-arrival regression first created a relationship penalty, then passed while preserving the original voice and duration draws.

## [L-save-tail-offset-fixtures] Appended fields move historical test cuts

Adding shyness after waiting exposed native and browser save tests whose byte cuts still treated waiting as the final field. They cut a valid older field boundary or a different record and reported a loader failure. The loader preserved its canonical-padding rule; the fixtures were out of date. On every appended field, scan all native and real-WASM byte fixtures, update historical boundary tables and record offsets, and retain tests that cut inside each variable-length list. Verify whole historical fields load, record/length truncations fail atomically, and nonempty older floors, family and mortality survive. The final suites include shyness record truncation and real-WASM stat reads.

## [L-privacy-browser-fixture-reads] Verify the control and refresh the whole panel

Privacy verification repeated the earlier hidden-radio lesson: a Pause label looked like a button, but three button locators timed out. Fresh review identified the native radio and visible label; clicking the label paused the actual driver. Inspect the role before repeated locator attempts and search the existing control lessons. The first fast fixture captures also reused the previous need/action panel because synthetic frame times did not advance past its refresh interval. Use monotonically increasing behavior-frame timestamps, assert a fresh need/action reading as well as the new stat, and inspect actual relationship meter values. The corrected four captures show the expected victim, affinity, shyness and current mood; task-owned browsers and preview servers close afterward.

## [L-relationship-phase-and-evidence-boundaries] Check the state at the event, and identify the assertion being changed

**What happened.** Review found that newly changed occupancy could grant an emergency privacy exception before checking an alternative, and that contact eligibility missed active chain work and later trusted a conversation already interrupted by a player order. A cancellation test also kept failing because a text replacement changed a similar assertion in a different test. Historical save-tail offsets were briefly incremented twice by overlapping replacements.

**Root cause.** Selection-time knowledge was treated as current at movement time, and a transient conversation marker was treated as proof of live participation. Broad text matching confused repeated assertions and byte offsets with unique locations.

**Prevention.** Revalidate alternatives against current ordered occupancy. Resolve helped needs from the actual live action, including chains and both conversation roles. Before changing a test, inspect its enclosing function and preserve its causal claim. Update save boundaries in one explicit table, rather than chained replacements.

**Verification.** The late-occupancy and redirected-partner tests failed before their guards existed and pass afterward. Mid-wait replay crosses cache expiry and action completion. Historical whole-tail saves load while partial lengths and records fail. Cancellation tests forbid a completion event while permitting the separately recorded proximity effect. On Windows, finish a task-owned native run before rebuilding its executable; the linker cannot replace a running file.

## [L-relationship-fixtures-and-need-attribution] Validate geometry and separate need causes

**What happened.** A browser fixture generator was initially placed in a crate without the serializer dependency, then wrote an oversized path and diagonal reading contacts. Three failures triggered fresh review. Long household runs also reported more minutes with an empty essential need, which could not be attributed from a combined Hunger-or-Energy counter.

**Root cause.** Hand-built components skipped the placement and contact contract. An aggregate need counter concealed both the need and the current activity. Review also found a real access edge: an unrelated blocked goal could prevent a hungry Sim from selecting food behind the same privacy boundary.

**Prevention.** Keep serialization examples at the existing serialization boundary. Block fixture furniture footprints, assert cardinal interaction contact and round-trip every generated save through the production loader. Break empty needs down by need, activity and recent waiting before claiming starvation or dismissing the result. Change to an urgent goal before deciding whether it qualifies for a privacy emergency.

**Verification.** All five browser fixtures load after checked construction, without dependency or loader changes. The urgent-goal regression first retained the TV target, then selected the fridge while preserving normal emergency checks. Native balance output separates empty Hunger/Energy by activity and notes privacy waits in the preceding two hours; temporal association alone is not a causal claim.

Changing to an urgent goal also needs stable priority. Comparing two critical needs by their raw levels caused food and sleep targets to alternate, restarting the privacy wait clock. Preserve the current critical goal unless another need enters the desperate class while the current goal is above it. The regression keeps the same goal through ten blocked minutes and then crosses under the normal emergency rule; removing that priority guard fails the test.

The balance harness initially inferred completion from any final-step disappearance and omitted chains still active at cutoff. Its JSON summary also dropped recovery contributions and some negative causes. Observe the terminal countdown, report outstanding chains and progress intervals, and retain every cause before drawing an access or balance conclusion. All 168 final runs reproduced identical hashes and prior metrics after adding those read-only observations; the report distinguishes pooled privacy frequency from individual-layout results and reused validation seeds from an untouched holdout.


## [L-privacy-autonomy-integration] Preserve published behavior when integrating simulation features

**What happened:** integrating privacy development with newer autonomy and sleep changes exposed a stroll detour that discarded the distance already walked, save fixtures that cut at outdated offsets, and replay fixtures that omitted the newly required self-preservation component. The previous relationship calibration no longer described the integrated simulation.

**Root cause:** privacy routing and historical-save tests were written against an older runtime. A successful textual merge could not preserve the newer behavioral constraints or validate changed pacing.

**Prevention:** keep published V5 fields in their original order and append unpublished state after them. Derive historical cuts from each serialized field, with an independent test pinning the published prefix. Retain a stroll's completed path prefix when applying a detour. Current-world test fixtures must include current behavioral components; migration tests should omit them deliberately.

**Verification:** run the published instinct/chronotype prefix test, privacy save/load continuation and whole-stroll budget regression. Recalibrate the full deterministic household matrix after changes to action selection or sleep scheduling; do not carry forward older pacing results as current acceptance.


## [L-calibration-opportunities-and-censoring] Measure whether recovery can occur before changing rates

**What happened:** after integrating newer autonomy, recovery took much longer despite few bathroom incidents. The furnished fixture provided little independent Social relief. One mutation check also reported a survivor after a Windows line-ending mismatch left the source unchanged.

**Root cause:** recovery depends on eligible contact, not just its reward rate. Critical Social blocked positive effects for much of the fixture run. The mutation runner verified its search anchor but did not verify that the replacement changed any bytes.

**Prevention:** record critical minutes by need, first actual positive contact, effective per-run tuning and unfinished durations. Give ordinary fixtures independent need relief, retain the original as an explicit stress case, and disclose that adding a television changes multiple decisions rather than isolating Social causality. Check that every mutation changes source before compiling, then restore and verify the original bytes.

**Verification:** matched fixture runs retain all seeds and outcomes. Summary statistics label completed-only durations and also report a cohort mean lower bound using the observation horizon for unfinished cases. Diagnostic additions reproduce prior RUN records and hashes. The corrected published-save-order mutation fails its historical-prefix assertion.


## [L-browser-repl-handle-capture] Pass the current browser into persistent helpers

**What happened:** a browser check immediately addressed a closed page although a newly created page was visibly open. The browser itself had no recorded error. Earlier fast captures also refreshed the person panel too soon to replace stale action text.

**Root cause:** helpers defined in an earlier REPL cell retained that cell's old page binding. Reassigning the top-level page name did not update the captured reference. A two-cell object probe reproduced the difference between the current binding and the closure's value.

**Prevention:** pass the current page and a mutable frame-clock holder explicitly into each helper. Bind local refresh functions to that argument and advance synthetic timestamps monotonically. Inspect first-run dialogs and use the visible Pause label before loading controlled saves. Keep cleanup in finally, even when assertions fail.

**Verification:** all five controlled cases use the current page, assert fresh selected-person text, and reproduce their saved world hashes after 40 ticks. Reading shows its current action and shyness; privacy shows the affected direction and mood reason. Close owned contexts and stop only the owned preview server, verifying its port is closed.


## [L-recovery-measurement-requires-an-actual-loss] Do not count clamped penalties as recovery

**What happened:** the household trace counted eight privacy victim records as immediate recoveries even though their actual clamped loss was already within the 0.01 recovery tolerance. This understated the mean duration of the measurable recoveries. Its median and P90 definitions also differed from the balance summarizer.

**Root cause:** the observer opened a recovery interval for every privacy record instead of checking its actual effect. Separate reporting code had independently chosen different percentile conventions.

**Prevention:** preserve all incidents and contributions, but report losses already within tolerance separately. Open recovery intervals only for larger actual losses, retain unfinished intervals, and use the same median and nearest-rank percentile definitions across reports.

**Verification:** repeating the 120,000-tick trace retains the same world hash and every non-recovery observation. The corrected population is 59 finished, 33 unfinished and eight already within tolerance, compared with the previous 67 finished and 33 unfinished. Controlled matrix results remain unchanged.


## [L-privacy-bed-integration-fixtures] Match navigation tests to their actual mode and ownership

**What happened:** bed integration tests initially guessed component fields and equality support, then assumed every route anchors fractional positions and every autonomous admission chooses place zero. A partner-preservation fixture also started sleep away from its bed. Independent review caught privacy substitutions bypassing survival-first place selection and the authored facing fallback.

**Root cause:** player-order examples were copied into autonomous-route tests without checking their different preconditions. Legacy grids deliberately retain their old fractional movement behavior. Bed ownership is per physical place, while older privacy code assumed one reservation per object.

**Prevention:** inspect component definitions and navigation contracts before constructing fixtures. Use matching saved architecture and grid edges when testing anchoring. Establish sleep through normal arrival at a valid contact. Compare complete surviving action state. Use the same admission, access, survival-risk and base-facing rules for privacy substitutes and ordinary autonomy; release only the departing owner's claim.

**Verification:** four-facing privacy tests check separate admissions, exact approaches, coherent fractional anchoring and replay. Other cases preserve a sleeping partner, reject an inaccessible free place, choose safety before assignment, retain player routes, and use authored base facing without an explicit component. Historical bed-era byte fixtures load nonempty claims and assignments without fabricating missing privacy state.


## [L-browser-speed-control-role] Inspect the actual control before choosing a locator

**What happened:** a browser harness timed out looking for a Pause button. The outer tool timeout reset the session before Playwright could report the missing element. A first explanation blamed disabled animation frames; source inspection showed the Pause control is a radio label.

**Root cause:** visible text was mistaken for an accessibility role. A later unscoped Overview selector matched both the compact details button and the tab inside the sheet.

**Prevention:** inspect control type and scope before writing a locator. Use the actual speed label, verify its radio is checked, and scope tab selectors to their container. Keep browser rendering active while the simulation driver is paused. Set action timeouts shorter than the enclosing tool timeout and close owned contexts in finally.

**Verification:** normal clicks dismiss Help, select Pause and open the intended tab. Five controlled browser cases keep the simulation at tick one during observation and reproduce 40-tick saved replays. Captures show the current person and action; no owned game page or listening preview server remains.
Freezing only the partner's timer must also fail the full-tick handoff test.

## [L-bed-access-needs-the-shipped-house] Check place access in the actual starting lot

**What happened.** Isolated navigation and full-tick fixtures passed, but the
release-WASM household could use only one double-bed place. Its north-side
approach crossed the bedroom wall. Moving the bed down one tile then isolated
a floor pocket behind the nightstand; moving it right as well covered Bill's
spawn. The content compiler rejected both trial positions.

**Root cause.** The authored per-place access policy had been verified against
test geometry without checking the starting furniture, walls and household
spawns together. The first layout corrections considered those constraints
one at a time.

**Prevention.** Before moving furniture, map the complete footprint, solid wall
edges, spawns and reachable contact tiles. Include the unmodified starting
household in behavior tests. Keep historical fixture positions independent of
new-game layout changes; a source fixture must not acquire today's furniture
positions while claiming yesterday's save format. Use the shared frozen
placement manifest for historical constructor inputs and expected grown
worlds; keep the production source validator independent. Check exported wall
tiles against actual runtime furniture, not current prefab placements.

**Verify.** The actual shipped household must naturally admit and sleep two
ordered Sims at distinct places, preserve exact assignments, and replay after
save/load. Returning the bed to `(0, 6)` must fail that check. Load actual bytes
captured before the layout change and require identical re-saved bytes and
world hash. Keep the frozen bathtub source at its historical bed position.

## [L-personality-stats-belong-in-details] Match a stat's prominence to the player's current task

**What happened.** Shyness was added as a standalone Overview row beside mood
and life satisfaction. The owner questioned that prominence and found the
default Sim details sheet unnecessarily wide.

**Root cause.** The display followed the new implementation field rather than
its role as one personality characteristic. The sheet used one fixed desktop
width for both the summary and detailed tables.

**Prevention.** Group personality statistics with personality details. Keep
the default summary compact, and widen it when a visible section needs more
space. Move data ownership with the display so a hidden detail does not add
periodic reads. Keep navigation and Close reachable at the smaller width.

**Verify.** Opening personality shows the selected person's shyness; switching
or clearing selection cannot retain another person's value. The desktop sheet
measures 360 pixels by default and 540 while personality is expanded. Other
tabs and collapsing restore 360. Compact viewports have no horizontal overflow
and retain 44-pixel controls.
For autonomous runs, require actual shared-sleep observations across the seed
set and count sleep exits without calling them completed actions. A place map
can hide duplicate claimants; require every sleeping Sim to appear exactly once
in its occupancy projection. Reload a deliberately advanced twin to prove that
loading restores state, rather than merely accepting an identical snapshot.

## [L-bed-projection-is-semantic] Keep sleep ownership independent of body art

**What happened.** Review of the planned sleep-place column found that reusing
the socket projection would omit the double bed, which has no occupied-art
contract yet. Requiring activity 5 or a positive countdown would also narrow
existing valid state.

**Root cause.** Semantic sleep tags, authored visuals and pending action
completion are separate contracts. Numeric entity indices also omit generations.

**Prevention.** Derive a separate exact bed/place pair from validated running
ownership. Preserve independent visuals, shared capacity across alternate sleep
actions, zero-tick actions awaiting completion and full target entity identity.

**Verify.** Cover alternate nap slots, independent visual metadata, immediate
Load and memory growth. Replace a despawned bed at the same raw index; its old
target must remain invalid. A deliberate raw-index lookup must fail that test.

## [L-bed-colour-is-not-coverage] Verify colour reuse before budgeting joint sprites

**What happened.** Independent review of the proposed double-bed export found
that accepted bunk furniture samples already differ in RGB inside common opaque
regions. Reusable RGB multiplied by genuine visibility cannot exactly reproduce
those images. The proposal remained unimplemented.

**Root cause.** A proposed image-count reduction separated colour from visibility
without first measuring colour stability in the established shaded export.
An emission output can still receive colour derived from lighting or occlusion.

**Prevention.** Preserve per-scene RGB for the pilot. Compare reused-colour and
per-scene-colour reconstructions against the same beauty render, with an
identical-state noise control. Keep shading residuals separate from coverage.
Prove independent occupant palettes before counting colour reuse.

**Verify.** Compare fully opaque interiors separately from partial edges after
actual resampling. Keep input hashes and per-region errors. The accepted bunk
comparison disproves exact equality only; it does not prove a second-body shadow
failure or settle the double bed's visual tolerance or atlas budget.

## [L-bed-lanes-are-a-construction] Keep pose convenience separate from physical fit

**What happened.** A double-bed pose passed its lane and crossing screens but
looked tense. Review found that the elbow solver was limited by lane edges,
while fixed abdomen hand transforms and an upper-only elbow arc further
restricted the available pose. Earlier wording had promoted a starting
envelope into a mandatory whole-body shape.

**Root cause.** A sufficient construction for separation and simple picking
became an implicit physical requirement. Contact certificates then encouraged
preserving hand transforms that had never passed whole-pose visual review.

**Prevention.** Preserve actual body, bed, support, collision and walking-space
invariants. Treat contact frames and search domains as authoring choices, and
lane ordering as conditional on proved containment. Inspect a credible early
silhouette before extensive certification. Any route without containment needs
direct interbody separation and jointly derived visible-owner picking.

**Verify.** Inspect active constraint residuals, actual rendered posture and
complete evaluated meshes. Test independent samples, owner-map swaps, row
reordering and one occupant leaving. A relaxed search limit is not acceptance;
neither is a kinematic angle bound or a phase-zero lane pass.
## [L-native-link-proof-needs-activation] Tab inventory alone cannot verify a new-window link

**What happened.** Three clicks on a native Changelog link produced no new tab in the in-app browser's inventory. The link had focus, no overlay and no cancellation handler. Treating the inventory alone as the result left product activation unresolved.

**Root cause.** The verification conflated the renderer's new-window request with the host exposing its resulting tab. The host's disposition was not observed.

**Prevention.** Register the browser's new-window event before activation, then record the resolved URL, requested window name and trusted user gesture. Verify the destination separately when the host does not expose the popup. Do not change ordinary link behavior to accommodate missing host evidence, or claim visible navigation from an activation event alone.

**Verify.** The unchanged anchor emits `Page.windowOpen` with the expected project changelog URL, `_blank` and `userGesture=true`. The requested destination renders 25 entries. Evidence: `docs/assets/review-evidence/changelog/link-activation.json` and the verification README. Visible popup creation in the in-app host remains unobserved.

## [L-standalone-ecs-removal-history] Standalone ECS needs an update boundary

**What happened.** A matched 1,037-entity workload grew WebAssembly capacity from 5,308,416 bytes at tick 60 to 118,095,872 at tick 1,680 without a browser or audio. A native allocation counter found 71,003,186 live requested bytes and 2,482,699 retained component-removal messages at the final checkpoint.

**Root cause.** The game uses Bevy ECS without Bevy App. Neither the full-tick schedule nor the paused command schedule maintained the world's trackers. Repeated marker removals appended lifecycle messages indefinitely. Save size and world hashes omitted that bookkeeping, so stable saves did not establish stable memory use.

**Prevention.** Call `World::clear_trackers()` once after each completed full or paused schedule, after deferred commands have applied. Preserve the newest removal window. Future readers must respect those boundaries; a reader running only on full ticks can miss removals during repeated paused drains.

**Verify.** Exercise the real public methods, switching selection repeatedly. Require the last boundary's removal to survive, older records to expire, and the current buffer to be empty after rotation. Paused calls must preserve the clock, needs and random generator. Delete maintenance, rotate twice, and move rotation before the schedule; each must fail. Compare matched release-WASM hashes and saved bytes. Report WASM capacity, native live requested allocation, and browser/audio memory separately. Evidence: `docs/assets/review-evidence/ecs-lifecycle/README.md`.

The first batch-equivalence fixture started and ended on the same person. Review caught that reversed command order would leave its assertions green. Give ordering fixtures different first and last outcomes, assert the intended final result, and reverse the actual command iteration to prove the test detects it.

## [L-activity-identity-needs-complete-presentation] Every active interaction needs a visible identity

**What happened.** Shower, toilet, bath, TV, radio and several seated uses had
no head bubble. Dinner preparation and cooking also appeared inactive. The old
aquarium glyph was visibly off center.

**Root cause.** Activity presentation depended on the small set of authored
body animations. Generic object use and sitting intentionally had no bubble;
non-eating chain work had no activity identity. Existing glyphs lacked a
complete small-size visual inventory and a centered fish geometry check.

**Prevention.** Author presentation-only activity metadata on every executable
interaction and chain work step. Validate the exact runtime target and chain
role, retain body-action precedence, and give generic uses a visible fallback.
Keep new artwork appended after the historical atlas records. Review each
activity/icon pair in the release renderer as well as in the art sheet.
The owner clarified that walking is travel toward an action, not an action
requiring a bubble. Show activity and waiting icons; suppress travel bubbles.

**Verify.** Count and test every shipped interaction and dinner step, remove
ordinary and chain identity checks, reverse body precedence, and remove a
renderer mapping; each must fail. Check all glyphs at game size in different
lighting and zoom levels. Push the fish into its rim and require the geometry
test to fail. Confirm save bytes, structural fingerprints and historical
atlas pixels stay unchanged. Evidence:
`docs/assets/review-evidence/activity-bubbles/README.md`.
## [L-markup-tests-own-boundaries] Bound markup assertions by the element they test

**What happened.** Removing Household from Sim details broke a Traits assertion even though Traits was unchanged. A second assertion silently included the rest of the page.

**Root cause.** Both tests used the unrelated Household section as their slice endpoint. When that marker disappeared, JavaScript's negative slice endpoint included unrelated Build markup.

**Prevention.** Find the tested section or disclosure's own closing tag and assert that both endpoints exist before slicing. Do not rely on a sibling remaining in the layout.

**Verify.** The Traits section and disclosure assertions now validate their boundaries; the full 1,717-test web suite and final 48-test focused suite pass after Household removal.

## [L-clipped-headers-need-field-bounds] Page width alone does not prove controls fit

**What happened.** The first dock proof passed ten ordinary sizes and enlarged phone text. Adversarial review found that doubled text at 601px and 640px pushed Collapse past the window and reduced the selected identity to zero width.

**Root cause.** A non-wrapping header combined fixed wellbeing width with non-shrinking buttons. The page clipped overflow, so document scroll width stayed unchanged. The longest desktop mood label also overflowed its column.

**Prevention.** Allow the header to wrap, reserve identity width, and let wellbeing labels wrap. Measure each visible header child's bounds, not only page scroll width. Include narrow desktop as well as phones in enlarged-text fixtures.

**Verify.** The extended native proof rejects the original clipped Collapse bounds and checks all header controls and wellbeing fields at 320, 601, 640, 800 and 1280px with doubled text. All fit after the fix, while ordinary dock heights stay unchanged.
## [L-door-surface-and-floor-depth] Door geometry needs surface depth, 2026-10-01

The first door correction put the whole frame on a vertical depth plane. The
floor threshold then cut through the leaf, casing and a walking Sim's feet.
The original GPU samples tested the panel plane, so their passing result did
not establish correct floor or casing behavior. A replacement model also
inherited the character scene's 4-pixel ink at a smaller canvas scale, making
the door look much heavier than the furniture. Its threshold projected past
the casing and left visible tabs at the floor joins.

Use the evaluated model's surface depth for upright geometry, and tag flush
floor surfaces separately. Fit the threshold inside the casing faces and
aperture. Match contour width at runtime pixel density, rather than copying
the source scene's physical pixel setting. Inspect the model inside the room,
including the bottom corners, both crossing directions and edge-on poses.

Verification must bracket leaf faces, edge-on slab ends, casing posts and the
header in both draw orders. Threshold checks need both an actor in front and
a floor sample behind; otherwise deleting the threshold can falsely pass.
See `web/proofs/door-depth.js`, `test_door_assets.py` and the solid-door
verification record. Owner visual approval remains separate from these checks.

For GPU mutations, own the browser and server lifecycle. Mutating source while
a game or proof page remains connected to hot reload can navigate the page
during evaluation. A stalled run is an error, not a killed mutation. Use an
isolated server with watching and hot reload disabled, write progress and
results, close the owned browser/server, and restore source bytes in `finally`.

During release integration, generator checks were started before atlas conflict
regeneration finished and rejected conflict markers. The rebuilt atlas also
exposed a bed test that fixed the total sprite count despite checking a preserved
prefix. Complete generated files before testing consumers. Keep the prefix's
pixel and metadata checks exact while allowing later records to append. The
combined generator suite verifies both the released bed art and new door art.

## [L-synthetic-actions-need-state-ownership] Keep synthetic action fixtures valid after ownership changes

**What happened.** Integrating shipped activity projection into the held sleeping-place branch made one Load test reject its synthetic double-bed save. The fixture supplied Eating and Target but omitted SleepPlace. An attempted global text replacement matched two Load sequences and was rejected; the shell still launched an unchanged suite.

**Root cause.** Modern sleeping-place saves record exact active ownership. A directly constructed action does not pass through admission, which normally supplies that ownership. The failed patch and verification commands were also combined without an error boundary.

**Prevention.** Complete synthetic sleep actions with a valid place marker; never weaken modern missing-row validation to accept malformed fixtures. Anchor repairs inside the named test. Apply and verify in separate tool steps so a failed edit cannot launch an unchanged run.

**Verify.** The immediate ordinary-activity Load test passes with SleepPlace(0) only on sleep-tagged interactions. The existing shared-sleep test still rejects missing and conflicting rows transactionally. Full integration verification passes 109 core, 272 data, one data integration, 768 simulation and 153 WASM tests. The merged web suite passes 1,777 tests in 121 files after rebuilding its generated WASM. These checks remain separate from the already deployed UI acceptance.

## [L-integration-tests-need-matching-wasm] Regenerate WASM before testing changed Rust projections

**What happened.** After activity-bubble main was integrated into the held sleeping-place branch, the Rust suite passed but five web tests expected new literal activities and observed older generic activity codes.

**Root cause.** The web tests execute generated release WASM. The ignored package was the known older held-branch artifact, not the newly merged Rust/content source. A native Rust build does not refresh that package.

**Prevention.** When Rust or embedded content changes, build the WASM package in the owning worktree before running dependent web tests. Do not copy a main-only artifact into a branch with additional ABI fields or use an unverified sibling binary.

**Verify.** Rebuild with `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`, record its hash, and run the actual release-WASM bridge/activity tests. Keep source, generated artifact and deployed acceptance provenance separate.
## [L-domestic-integrated-actions-need-terminal-scoring] Score the food that actually arrives

**What happened.** Main integration exposed an instant-fridge survival score
for the longer snack chain and repetition tracked against a hidden chain row.
Public command fixtures also assumed every need started low; public spawning
only makes hunger low.

**Root cause.** Older fixtures and scorer assumptions described the one-step
action rather than the staged runtime. Main's current public boundary differed
from the internal test builder.

**Prevention.** Score all required work and travel before terminal recovery.
Use the visible snack identity for repetition, preserve ordinary custom-pack
behavior when the chain is absent, and establish the actual autonomous choice
before asserting player-command preemption. Read the public initial needs;
do not infer them from a helper name.

**Verify.** A starving Sim beside a fridge still incurs staged snack risk;
moving the counter farther increases it. Completed snacks change the visible
habituation row. The public command fixture first walks east for food, then
reverses west for a valid bed order; an invalid interaction preserves the
autonomous direction. Removing terminal scoring, the row alias, command
identity or intent dispatch fails the corresponding regression. Receipts:
`docs/assets/review-evidence/domestic/integration-mutations.md`.

## [L-domestic-presentation-needs-exact-claimed-station] Body motion and action identity compose

**What happened.** Integrating authored activity bubbles hid preparation,
cooking and washing identities behind a generic pose activity. Collecting
dishes from a table also lost its cleanup bubble because the table is not a
preparation counter.

**Root cause.** Pose fallback ran before metadata, and ordinary station-role
validation could not recognize a saved cleanup surface at another object type.

**Prevention.** Preserve explicit eating precedence, let generic domestic poses
use authored activity metadata, and permit the cleanup collection exception
only for the cleaner's exact saved surface at step zero. Ordinary Wash hands
remains distinct from the cleanup chain that removes persistent dishes.

**Verify.** Exhaust every shipped chain step and its activity/body pair. Reach
actual table collection through the runtime and retain the washing identity
after reload. Deliberately reinstate the generic override and break the exact
claim comparison; both assertions fail. Review actual moving wash frames with
the media preference recorded, rather than treating identical screenshots as
animation evidence.


## [L-domestic-opportunities-and-physical-seats] Verify opportunities and furniture contact

**What happened.** Low own-cleanup odds combined with busy room entry consuming
its opportunity, so dishes accumulated. Logical dinner inventory also appeared as
a floating badge during cooking, while table capacity counted walkable contacts
rather than physical chairs.

**Root cause.** Entry bookkeeping preceded the idle decision; rendering treated
inventory as a universal prop. Dining had no exact chair or dirty-setting ownership.

**Prevention rule.** Persist a pending episode decision until the Sim can act,
consume it once, and tie furniture use to a real reachable chair and setting.
Keep inventory semantics separate from contacting animation props. Reservation
ownership comes from each exact Target, not a bare Reserved marker. Keep published
postcard records frozen and append new envelope state instead.

**Verification.** Test busy entry followed by idle, new and old own mess, urgent
needs, simultaneous seat claims, wrong-facing chairs, dirty settings, interruption,
no-table shared meals and every save transition. Reject forged route endpoints and
duplicate claims. Inspect integrated animated captures independently; a successful
sprite export does not establish that the plate, hand, chair and table meet.

## [L-cooking-physical-contact] Derive animation contact from the visible models

**What happened.** The first stirring pose left the utensil disconnected from
the visible palm and the pot even though each asset exported successfully.

**Root cause.** The pose used a wrist origin as its grip and guessed the stove
target independently from the supported pot's position.

**Prevention rule.** Use the visible palm as the grip and one measured contact
definition for the character, utensil and furniture. Compose those models before
baking sprites. Keep the accepted character mesh unchanged when adjusting poses.

**Verification.** Inspect every phase in every direction. Measure grip and bowl
contact, test evaluated meshes for furniture collisions, and inspect the final
browser rendering after rebuilding both the sprite atlas and simulation.
## [L-long-term-score-needs-exact-restoration] Defaults and restoration use different constructors

**What happened.** Introducing a neutral starting score exposed fixtures that assumed an empty ledger or no upper bound. A tuning comment also expressed a per-tick rate in real-time hours while the simulation clock uses game minutes.

**Root cause.** Creation, save restoration and test setup shared a default constructor with different intended meanings. Small per-tick values also approach the precision limit of a single-precision floating-point score near its ceiling.

**Prevention.** Apply neutral values and trait offsets only when creating a Sim. Restore saved scores directly, validate them before changing the live world, and define saturation explicitly. Give test fixtures an explicit score. State rates in game ticks and game days; check that small losses still change a score at its maximum.

**Verify.** Restore zero, an in-range score and an old total above the ceiling twice. Exercise trait offsets through the public move-in command. Run the actual neglect system at 100 with the shipped small rate. Measure month-scale extreme mood and year-scale ordinary mood. Deliberately replace exact restoration with additive restoration and omit creation offsets; the causal assertions must fail. See [dated evidence](assets/review-evidence/dock-controls/README.md).
### [L-privacy-domestic-composition] Merge station ownership and save contracts together

Privacy and domestic work developed independently. A role-only privacy detour could
choose the wrong meal counter, retain collected dishes through an urgent substitute,
and omit dish resentment from causal diagnostics. Their V5 extensions also occupied
the same tail slot. Preserve published wire order, decode reviewed local formats by
source fingerprint, and share fixed-station/capacity/seat rules. Refresh routing
snapshots after claims change; retain the incident baseline for same-tick ordering.
Verify authentic historical bytes, transactional interior-cut rejection, owned pickup,
distinct dining seats, cleanup interruption and full-tick diagnostic clamping.

Balance fixtures must include facilities required by newly integrated mechanics.
Without a dish sink, the formerly adequate household could never clean its dishes.
Repeated mess resentment then dominated relationship pacing. Check furniture roles
before calibrating, measure every relationship cause, and tune existing consequence
coefficients rather than weakening an unrelated fixed penalty. Preserve noticing,
mood and cleanup rules; verify the full seed cohorts after composition.
When a penalty shrinks, move a clamping fixture close enough to the bound that
the requested change still crosses it. Keep separate requested/actual assertions.
## [L-published-save-tail-wins] Integrate unpublished tails after released fields

**What happened.** Held sleeping-place state and released domestic state both appended a V5 field after chronotypes. A mechanical union would place one record where released saves encode the other. The sleeping-access fingerprint also made released meal saves look like old recipes to the staged-meal migration.

**Root cause.** Positional serialization and exact content migration each have publication order. Two independent additions cannot share a tail position or treat every accepted digest as the same recipe.

**Prevention.** Preserve released domestic before unpublished sleeping state. Extend padding boundaries for both records, keeping actual absence distinct from explicit modern None. Use an exact same-recipe route for the released domestic digest; earlier recipes still require their program-counter mapping.

**Verify.** Load the checked-in released domestic save and compare every retained field immediately, changing only the destination digest and added empty sleeping record. Require stable resave and replay. Keep authentic pre-meal fixtures, every interior sleeping cut and explicit-None rejection. Delete the presence guard and current-recipe route separately; the named tests must fail.

## [L-fixture-events-before-clock-bounds] Wait for the event a fixture requires

**What happened.** After integrating sleeping-place admission, a domestic test sampled two guests at a fixed 180 ticks and saw one collected portion. The diagnostic showed both claims intact; the second guest was at the counter with seven collection ticks left.

**Root cause.** The shared fixture let guests run ordinary autonomy before injecting their completion actions. The starting route and random choices were not fixed, so the old tick count did not define completed collection.

**Prevention.** In the retention test, wait within a bound for both collections and keep the table locked throughout. Then hold the completed state for an additional interval to prove retention. Keep exact ownership, carrying, step, Load and eventual delivery assertions. Complete synthetic sleep actions with their ownership marker and require completion to remove it.

**Verify.** Both collections must complete within the route/work bound, the table remains unclaimed, and both portions remain uneaten during the subsequent 180 ticks. The original fixed-bound checkpoint remains in the diagnostic log; increasing a timeout alone does not establish retention.
## [L-pose-pole-is-not-elbow-position] Measure solved joints and complete garments

**What happened.** Two proposed narrower double-bed poses retained essentially
the original body width. A third narrowed the body but still missed its lane
margin and failed the bone-scale assertion at the next breathing sample.

**Root cause.** A two-link limb solver projects its bend pole around the
shoulder-to-wrist axis. Reducing pole X does not necessarily reduce elbow X.
The second failure came from hand scale channels exceeding the existing
tolerance, not a comparable measured change in bone length. An unchanged-pose
trace subsequently located a small distortion in the saved rest matrices;
absolute-matrix assignment redistributed it through parent-relative scale
channels. A new rotation-only adapter preserves the saved rig and passes the
control without loosening the scale limit.

**Prevention.** Solve and inspect the joint geometry before interpreting a pole
coordinate as a body bound. Measure every visible cuff and sleeve at every
sample. Keep length, scale-channel and evaluated-surface checks separate; do
not relax a failed limit or omit a garment to make a candidate pass. Preserve
rejected studies and obtain a fresh architectural review after three failures.
Save the measurements before asserting the acceptance bound. Otherwise a
rejected pose records only a failure and requires an avoidable diagnostic replay
to identify which part exceeded the limit. A successful width screen also says
nothing about whether the posture looks relaxed or the hands actually rest on
the body.

When solving contact, include raised details in the actual support surface.
The double-bed trial brought a palm onto the shirt body but through its breast
pocket. Symmetric wrist targets cannot be presumed valid for asymmetric
clothing. Keep contact-only records separate from collision-cleared survivors,
and verify the final root residual: a changing ray-hit set can create a sign
bracket without a converged contact solution.

Contact-frame axes have an order of authority. A hand support frame can make
the surface normal primary, but a bone frame must preserve the exact joint
direction and project its roll reference around that direction. Reusing the
surface-first frame for a forearm moved both wrists away from otherwise valid
inverse-kinematics targets. Test oblique direction/normal inputs, assert the
authored joint positions before surface checks, and keep rejected receipts
immutable. Width and bone-length checks alone did not detect this error.

A candidate selector must include every coupled screening constraint that
determines its parameter. The first evaluated elbow-height diagnostic selected
lower endpoints because the forearms cleared the garments, even though cuffs
or full-arm lane bounds still failed. The root algorithm was functioning; its
objective was incomplete. Use named residuals for shaft clearance, cuff
clearance and complete arm bounds, retain the limiting residual, and leave
continuous-surface collision and visual review as separate acceptance gates.
Do not require sleeves to clear their own designed shoulder attachment, or
use that attachment to excuse new pocket, collar or opposite-arm collisions.
Evaluate the actual modifier stack, including blended elbow and wrist ends;
skinning an averaged smooth surface is not equivalent to smoothing after skinning.

**Verify.** The preserved double-bed studies and bone diagnostic in
`docs/plans/2026-10-01-double-bed-pilot.md` identify the rejected configurations,
exact failed channels and unchanged sources. No pose or joint compositing
acceptance follows from these screening results.

## [L-trial-evidence-before-evaluation] Retain failed measurements before validating them

**What happened.** A bedside-arm probe rejected a hand outside the bedding
projection but lost the offending raw samples. An earlier runner had the same
problem with a missing-hit assertion. Later, the corrected evidence runner
stopped on a Windows denial while replacing its status file; that failure
retained its numbered raw trials and final failure record.

**Root cause.** The first probes kept samples in local variables and attached
them to the report only after the calculation returned successfully. An outer
exception handler could not save data it never received. The later file-access
denial has no confirmed cause; concurrent reading is a possible sharing conflict,
not proof of a permission configuration defect or geometry failure.

**Prevention.** Attach a trial and all named point coordinates before evaluation.
Retain hit, miss and unfinished states, explicit null gaps on misses, counts,
parameters and tracebacks. Persist raw evidence before classifying the result,
and rethrow failures. Keep numbered raw files and hashes instead of repeatedly
rewriting every large array. Persistence itself can fail; do not convert such
failures into a rejected geometric family, accepted result or silent retry.

**Verify.** Inject two hits and one miss, a callback exception midway through
sampling, and an assertion after measured bounds. Each must retain the completed
and pending evidence and still fail. A supported control must complete. The
four controls in `output/test_bed_trial_evidence.py` pass and received independent
review. They do not prove filesystem durability after process termination.

When progress evidence has readers, give every persistence revision its own
exclusively created path and write the terminal receipt once. Wait for the
actual writer process to exit before reading its terminal manifest and hashes.
An open reader cannot block replacement of an older revision if no replacement
is attempted. This is an ownership protocol, not a retry or permission change;
creation failures must still propagate. Partial or missing terminal evidence
must remain incomplete. Keep sample-before-classification and terminal-failure
revisions separately, and test publication failures as well as in-memory
callbacks. Apply the same record-before-evaluate boundary inside side-ray and
per-object surface helpers, not only in their caller.

## [L-deformed-mesh-internal-contacts] Check within each changed mesh as well as between parts

**What happened.** A static two-person bed pose passed an early source-image
review and complete interbody separation. Its full audit then reported hundreds
of internal sleeve contacts, while both forearms had none. A follow-up source
comparison stopped because the retained rest and posed triangle lists differed.
The cause and acceptable attachment classification remain unresolved.

**Root cause.** Tests between named objects do not inspect a mesh folding through
itself. A visually plausible garment and unchanged weights do not prove that its
deformed surface is valid. Triangle numbering also cannot be assumed stable
between evaluated poses without checking the actual topology and tessellation.

**Prevention.** Inspect internal contacts in each changed blended mesh before
accepting a pose. Keep normal shared-edge contacts distinct from unexpected
crossings. Establish source polygon and vertex correspondence before comparing
contacts across poses; stop on mismatched topology rather than borrowing indices.
Use a shared invertible-transform replay to classify eligible rigid inherited
joins, not a blanket exception for connected parts. Keep early visual acceptance
separate from full contact acceptance.

**Verify.** The static pilot retains all four internal sleeve/forearm checks,
39 complete rigid-part replays and the failed source comparison in the output
directories listed in `docs/plans/2026-10-01-double-bed-pilot.md`. Resolve the
reported sleeve contacts against a verified source before proceeding to accepted
animation or compositing work.

The independent replay subsequently traced these folds to the orientation
convention: the upper arm's prescribed world roll was nearly 180 degrees from
the torso-inherited rest orientation. The small apparent change in joint
direction hid a large axial twist inside the blended sleeve. Construct a limb's
orientation relative to its parent's deformed rest frame, not an unrelated world
normal. Carry the roll convention through the chain; fixing only the shoulder
can transfer the twist to the elbow. Re-solve surface contact after changing roll,
because identical joint positions do not imply identical palm or cuff surfaces.

## [L-sleep-silhouette-before-certification] Review the whole sleeping posture first

**What happened.** Detailed arm/contact work continued on a double-bed pose whose
knees were drawn up conspicuously. The owner rejected the cramped posture after
earlier independent reviews had accepted its early visual appearance.

**Root cause.** Review concentrated on the recently changed arms and numerical
fit. The inherited folded legs escaped a whole-body naturalness check. Passing
separation and mattress bounds does not establish a plausible sleeping posture.

**Prevention.** Before extensive contact certification, render the whole body
from at least two useful facings and assess head, torso, hips, knees and feet
together. For a relaxed back-sleeping baseline, start with mostly extended legs
and a slight bend. Measure the complete body against the mattress. Do not force
an implausible curl to conceal a proportion mismatch or silently resize approved
art. Preserve rejected poses and distinguish visual rejection from physical fit.

**Verify.** Retain the straight-leg and slight-bend bounds, corresponding source
images and independent whole-body review under the double-bed pilot. Neither an
arm-only pass nor an old interbody certificate transfers to a changed full pose.

## [L-occupied-bedding-replaces-flat-duvet] Lift the existing blanket over the sleeper

**What happened.** An occupied-bed draft added a shaped blanket over the Sim but
left the existing flat green duvet underneath. Its first foot edge also left
the shoes exposed. The owner correctly identified two blankets where one was
intended.

**Root cause.** The static bedding was treated as an immutable support layer
rather than the unoccupied form of the duvet. The first occupied surface only
covered the body from above and did not continue down around the foot end.

**Prevention.** Establish which visible bed parts are mattress, pillow, sheet
and duvet before authoring occupancy. Replace the flat duvet and its folded
edge with one occupied form. Fit the body to the remaining mattress and pillows;
hiding a supporting layer invalidates its previous contact evidence. Continue
the cloth over the feet and sides. Do not solve the appearance by leaving a
floating body concealed underneath.

**Verify.** Retain uncovered and covered views of the same pose. Check that the
flat duvet objects are absent from occupied rendering, the mattress remains,
feet are covered, and the new support and blanket-clearance measurements are
explicitly distinguished from full physical acceptance.

## [L-sleep-contributions-linear-filtering] Compose visible contributions before display transfer

**What happened.** A three-owner bed draft added separately display-transformed
RGB layers and then applied the outline. It looked close but differed by up to
32 channel levels at source resolution. A plausible beauty-colored partition
also failed an explicit fractional-filtering counterexample.

**Root cause.** The Standard sRGB display transfer is nonlinear. Applying it
to each contribution before addition changes mixed edges. Applying an ink-over
product after filtering also does not commute with filtering the original
joint scene. Matching texel centers is not sufficient.

**Prevention.** Convert genuine owner RGB to scene-linear space, premultiply by
measured coverage, and bake shared ink attenuation into fills before filtering.
The outline remains a separate visible additive contribution. Sum contributions,
unpremultiply once and apply display transfer once. Keep independent furniture
recoloring in its existing display-color semantics, without coloring Sims or
ink. Preserve true pre-ink fill coverage separately for picking.

**Verify.** Repeat a complete scene to measure noise, compare no-ink and ink
controls in both color spaces, and sample fractional coordinates. The bounded
test reduced the source discrepancy to under two levels; 8-bit game-size
encoding had maximum display-premultiplied error four and p95 one. Seventy-two
fractional cases had maximum 3.021 and p95 below 0.645. These are pilot results,
not a certificate for unrendered facings or the runtime shader. Retain negative
tests for missing ink, swapped owners and the old filtering formula.

## [L-render-witness-pixel-footprint] A visible triangle point is not an interior pixel

**What happened.** A body triangle centroid passed a camera ray test but landed
on a duvet boundary in the raster image. The raw owner-coverage check correctly
rejected it rather than accepting an ambiguous label.

**Root cause.** World-point visibility does not establish that the whole pixel
footprint belongs to the same surface. Antialiasing included the neighboring
duvet even though the centroid's ray hit the shirt.

**Prevention.** Trace the actual pixel center and surrounding footprint through
the registered orthographic camera. Select interior surface witnesses; do not
relax an ownership threshold to accommodate a bad probe.

**Verify.** Require the unchanged raw coverage validator to pass the stronger
geometry probes, and independently swap owner image labels to demonstrate
rejection. A commutative RGB sum cannot detect an owner-label swap itself.

## [L-render-entrypoint-collision] Check tracked names before adding an exporter

**What happened.** An occupied-bed exporter initially reused the tracked
empty-bed renderer's filename. The collision was found before commit and the
original entrypoint was restored byte-for-byte.

**Root cause.** A plausible new filename was treated as unused without checking
tracked files and documentation references first.

**Prevention.** Check the repository inventory before creating a source file.
Keep static empty-bed and occupied-bed entrypoints distinct. Preserve the safe
terminal-publication protocol when promoting an experimental helper; copying
its purpose without its synchronization and rename steps is not equivalent.

**Verify.** The empty-bed renderer has no diff against its original. The new
publisher's forced fsync failure leaves no terminal receipt, and a second
writer cannot replace an existing terminal result.
## [L-sleep-projection-must-reach-render-buffer] Test authored visual opt-ins through the native bridge

**What happened.** The compiler accepted an explicit sleeping visual, but the native projection still emitted the ordinary body code. Synthetic renderer rows could exercise the art without revealing that the played game never selected it.

**Root cause.** Compiler acceptance and native visual projection used separate action mappings.

**Prevention.** Trace a new authored visual through compilation, native projection and a freshly built WebAssembly bridge. Keep semantic sleeping identity independent of visual identity.

**Verify.** The shipped-interaction assertion requires sleep activity 5 and visual 9 for the explicitly authored bed. Removing its projection arm fails that assertion; restoration passes. See the covered-bed runtime evidence.

## [L-additive-alpha-filter-before-clamp] Preserve additive alpha through CPU filtering

**What happened.** An eight-bit CPU sum clamped bed alpha before bilinear filtering, while the shader filtered each contribution before summing. Picking could disagree with the visible discard boundary.

**Root cause.** Clamping and filtering do not commute. Additive reconstruction weights can sum above one even when final output alpha is bounded.

**Prevention.** Retain unclamped summed alpha in a wider representation. Filter before clamping. Divide reconstructed RGB by actual summed alpha and clamp only output alpha. Keep grayscale owner masks separate from reconstruction alpha.

**Verify.** The boundary test fails when CPU alpha is clamped. A controlled texture through the production shader fails when the denominator is clamped. Real-art image comparisons alone did not detect the denominator fault; retain the numeric control.

## [L-shared-scene-picking-uses-draw-row] Pick against the entity row that draws a shared scene

**What happened.** Shared bed owners retained separate logical rows, but only one row drew the scene. Picking used the selected logical row's layer and order, producing a different tie with nearby entities than the renderer.

**Root cause.** Logical ownership was mistaken for physical draw order after multiple entities became one scene.

**Prevention.** Retain each owner's semantic identity and raw coverage. Also retain the actual shared draw row and use its layer and order when comparing unrelated entities.

**Verify.** The overlapping-entity test fails when it uses logical row depth instead of actual draw row depth. Restoring the mechanism passes. Check both visible owners and a remaining sleeper after the other leaves.
## [L-public-changelog-is-for-players] Release history must explain the player experience

**What happened.** The first public changelog included PR references, development details and a visual layout the owner rejected. The owner requested mockups before further design work and approved the compact accordion with dark and light themes, dark by default.

**Root cause.** The maintenance guide explicitly asked for PR links. Repository activity was treated as public release copy, and the appearance was shipped without an approved visual direction.

**Prevention.** Describe what a player can do or notice, preserve feature restrictions, and keep implementation and review evidence in internal documentation. Consolidate same-day changes. Before every push, map each significant player-facing result to a committed note, including follow-up changes since the last push. Reconcile delivery dates and other branches' notes before merging. The guide's decision table covers draft refinements, delayed delivery, later changes to shipped behavior and corrections to published text. The generator rejects common development references and duplicate dates. These checks supplement editorial review; they cannot decide whether a sentence matters to a player. Respect an explicit mockup approval boundary before implementing a new design.

**Verify.** Build the real history with no PR or commit references. Deliberately remove the copy and date guards and confirm their tests fail. Inspect the approved accordion on desktop and phone in both themes, confirm dark is the fresh default and light persists, and open both current and historical links.
## [L-composite-atlas-bounds] Complete atlas metadata after appending physical layers

**What happened.** The full atlas suite rejected covered-bed layers without padding bounds and scene bounds measured against furniture-only alias texels.

**Root cause.** New physical images were appended after the existing bounds pass. A composite alias reuses one layer's texture rectangle while rendering several layers, so the historical single-image assertion no longer measured its actual silhouette.

**Prevention.** Finish physical-layer metadata before packing. Retain the shared scene's combined bounds, and independently measure its support from all visible layer images. Preserve old records and Sim whole-canvas exclusions.

**Verify.** The original full-suite failures name the missing physical records and mismatched scene aliases. The corrected atlas passes all 130 generator tests, including the independently pinned original sprite prefix.

## [L-audio-policy-documentation] Check documented sound transitions against playback code

**What happened.** The task list still described door-opening recordings after the sound design changed to silent opening and a closing thunk.

**Root cause.** Updating the sound contract did not update every maintained description of the same behavior.

**Prevention.** Search maintained documentation when changing sound timing, source or gain. Check each claim against the actual playback transition. Compare fixed-tick availability checks with browser audio-context state-event cleanup, including while paused. Keep proposed sound content distinct from released behavior.

**Verify.** Search for the old behavior and inspect each remaining reference. Historical evidence may retain its original claim; maintained task and feature descriptions must match current playback. Exercise browser state changes while paused before claiming interruption cleanup; preserve the distinction from directly verified operating-system events.

## [L-calibration-load-and-rate-composition] Verify timed checks without unrelated simulation load

**What happened.** An atlas source-hash test exceeded its existing timeout while eleven native calibration processes ran. The unchanged test passed after those processes ended, followed by the complete web suite. Recovery calibration also reached conflicting cohort bounds when only the contact rate changed.

**Root cause.** Host contention was mistaken for a potential test defect, and existing neutral drift imposed a different recovery rate at neutral and positive starting affinity.

**Prevention.** Separate heavy simulations from timed browser and asset checks. Measure the complete relationship contribution before changing a timeout or choosing a coefficient. Preserve symmetric, strictly positive neutral drift and disclose changes to unattended friendship and grudge lifetimes.

**Verify.** Retain the loaded failure and unloaded passing logs. Compare all predeclared cohorts after a joint coefficient change, including subsequent incidents, incomplete recoveries and layout-specific results.
## [L-dining-save-and-contact-integration] Preserve dining claims across legacy saves and privacy routes

**What happened.** Adding strict dining claims exposed old saves that contained active diners without those claims. A privacy detour could also substitute a different dining endpoint, and food-carrying picking initially used the ordinary body pose.

**Root cause.** Three consumers treated the same physical interaction differently: loading restored only the historical action, routing selected a generic furniture approach, and picking omitted the displayed carrying pose.

**Prevention.** Append new save fields after every published field. Adopt valid legacy diners before re-saving, while retaining strict validation for current saves. Preserve the exact reserved endpoint through privacy detours. Use the same pose predicate in rendering and picking. Compare receipt-bound producer hashes with Git index bytes; a matching working file does not prove that staged newline conversion preserves the receipt.

**Verify.** Load an old active diner, tick, re-save and reload repeatedly. Check seated and standing detours, including blocked endpoints. Pick a carried-food silhouette outside the ordinary body's bounds. Deliberately disable each mechanism and require its regression test to fail.

## [L-dining-chair-fit-and-owned-occlusion] Fit the pose to the actual occupied furniture

**What happened.** Seated diners sank through dining chairs even though the animation review had accepted their appearance. Exposed rear rails also drew behind the entire Sim.

**Root cause.** The generic sitting pose was fitted to a lower armchair cushion. Whole body and chair sprites could not express their partial occlusion. The review checked animation and registration without measuring complete furniture collisions. Its table checks also omitted the half-tile offset beside each side setting.

**Prevention.** Fit each seated pose to the actual support surface. Check every evaluated body part against every named furniture solid and require a finite hip support footprint. Derive relative table placements from runtime footprint centres and every legal setting. Render reciprocal body, furniture and outline contributions from the complete occupied scene. Use the same visible ownership for picking. Treat a screenshot and a passing source test as different evidence; neither establishes the other.

**Verify.** The generic pose must fail for seat penetration. Raising the seat or removing a required solid must fail physical acceptance. Both side offsets must pass in every phase and facing. Compare the actual graphics shader with an independent full-scene render; removing the chair contribution must fail. Pick a visible torso, shoe, rear rail and exposed seat separately. Inspect complete ordered motion and record the exact source hashes.

The supporting table must also appear in the rendered test scene. A chair-only comparison cannot reveal a plate or hand hidden by the table. Preserve complete occupied colours while assigning tabletop geometry to its actual supporting depth. Picking must apply that depth even where antialias pixels belong to chair wood. Deliberately remove table support and the drawn hand contribution separately; both must fail their contact comparisons. Use named geometry ownership to select hand pixels; a skin-colour filter also selects food and wood. Report whole-scene outline differences separately from physical contact acceptance.

## [L-render-reference-framing] Preserve physical pixel scale when expanding reference canvases

**What happened.** Enlarged dining reference canvases still cropped the table because an aspect-ratio change also enlarged the projected scene.

**Root cause.** Blender's automatic camera fit selects its controlling dimension from the canvas aspect ratio. Scaling the orthographic camera by height alone changed pixel density when a portrait canvas became landscape.

**Prevention.** Measure evaluated geometry across every reference state before choosing a canvas. Preserve the camera pose and assert the projected world-unit basis on both axes after resizing. Leave margin for strokes and filtering. Check rendered alpha borders before marking the producer receipt complete.

**Verify.** Project the same world origin and unit vectors through the original and expanded cameras. Require matching pixel scale and complete raw and encoded alpha borders. A completed file count does not replace those checks.

## [L-audio-memory-matched-endpoints] Compare memory at identical simulation endpoints

**What happened.** Paired audio memory runs matched their initial world but sometimes ended on different game ticks. Remote polling paused the game only after the requested interval had elapsed.

**Root cause.** The harness validated the initial tick and world hash but omitted the same checks at the final endpoint. Different final game state can retain different interface data even when audio ownership is bounded.

**Prevention.** Pause through the existing speed control from a page-local frame observer. Require the exact measured tick interval and matching final world hashes. Reject overshoot as an invalid run. Keep the raw memory limit unchanged; do not reload state or subtract allocations to manufacture a passing comparison.

**Verify.** The report tests reject a missing endpoint, a changed final tick and a changed final world hash. Use a frozen production build for the predefined paired assessment. Preserve earlier failed results separately from any corrected measurement.

## [L-memory-diagnostics-must-isolate-observer-changes] Keep measurement changes separate from runtime attribution

**What happened.** A smaller audio memory result came from a diagnostic that omitted intermediate observations and changed endpoint waiting. The result could not explain a failure measured under the original protocol. A later comparison changed only intermediate explicit garbage collection, the browser's reclamation of unused objects, while preserving observations and endpoint collection.

**Root cause.** The first diagnostic changed several measurement conditions at once. Equal game states did not remove browser history, elapsed-time or pending measurement-request differences. The runtime cause of the memory failure remains unknown.

**Prevention.** Predeclare finite conditions before running a diagnostic. Change one measurement intervention at a time. Assert the retained observations and endpoint collection calls. Inspect enabled and disabled growth separately before interpreting their difference. Record timed-out measurement requests and differing initial memory capacities. Keep diagnostic results separate from acceptance results; do not relax a limit or retry for a favorable sample.

**Verify.** Require matching initial and final game ticks, world hashes and loaded build hashes. Require unchanged within-run structural bounds. Preserve raw enabled and disabled values. Report whether a lower difference came from lower enabled growth or movement in the disabled control. Do not claim causation from one observation per condition. Dated evidence: [audio memory protocol diagnostic](assets/review-evidence/audio/toilet/2026-10-01-protocol-diagnostic.md).
## [L-causal-evidence-must-survive-capture] Record each invariant independently

A review found that a combined bound mutation stopped at its first assertion, leaving the second bound without observed failure evidence. Some dock failures lacked committed excerpts, and one browser result capture wrote `undefined` instead of the returned measurements. The checks had run, but the records overstated what they retained. Mutate independent guards separately, preserve failure output with source restoration digests, and parse generated evidence before claiming its contents. Verify each claimed invariant has an observed failure and every result file contains the expected non-empty structure.

## [L-combined-render-modes-and-atlas-capacity] Verify combined graphics contracts before merging

**What happened.** Independently valid door and dining changes reused one drawing mode and exceeded the combined texture capacity.

**Root cause.** Renderer mode values had no shared collision check. Separate branches checked their own artwork budgets; fixed animation envelopes and shelf gaps consumed enough space to prevent the combined build.

**Prevention.** Name renderer modes and check their distinct values against shader declarations. Preserve published sprite identities and decoded pixels during integration. Share exact duplicate texture rectangles, trim new animation envelopes with matching registration, and use a rectangle packer that can reclaim vertical gaps. Measure capacity before producing the atlas. Do not raise the portable texture limit or discard accepted artwork to make a merge pass.

**Verify.** Reconstruct trimmed frames in their original canvases byte-for-byte. Check padded rectangles for overlap. Compare published sprite pixels and registration with the remote base. Execute door and dining graphics proofs against the same combined shader. Deliberately collide the modes and remove carried-food selection to verify that the regression tests reject both defects.

## [L-suspended-work-is-not-the-active-action] Validate completion against the executing action

**What happened.** Real toilet uses emitted no completion sound when they interrupted cooking or dish cleanup.

**Root cause.** Audio eligibility rejected every actor with `ChainState`. The ordinary interruption contract retains that component so the recipe can resume; `Eating` and an ordinary `Target` describe the action currently executing.

**Prevention.** Validate current action identity and active work separately from suspended commitments. Keep active `StepWork` and chain-step targets ineligible. Do not reject a saved recipe counter merely because it is present.

**Verify.** Interrupt cooking and dish cleanup with a toilet order. Save and load during that toilet use. Require one completion event, matching continuation hashes, and resumed work that finishes. Restore the old blanket guard temporarily and require the interruption regression to fail.

## [L-architecture-main-composition] Integrate every architecture reader and drawing mode, 2026-10-02

**What happened.** The held architecture branch collided with released bed command tags and door/dining drawing modes. Incoming room-region code still read the old window-only variant; horizontal hinged doors also lost frame ownership when the authored geometry path was selected. Cached contextual controls missed window change notifications.

**Root cause.** Both branches appended contracts independently, and newer readers assumed the published layout version remained the newest version.

**Prevention.** Published tags take precedence; append held tags afterward in serialization and hashing. Reserve distinct CPU/GPU drawing modes and bindings. Scan every legacy window reader after integrating main, expand canonical owners at every physical-boundary consumer, and preserve axis-specific ownership. Notify cached context controls from every active controller.

**Verify.** Assert released bed bytes and appended window bytes, distinguish adversarially matching queued hash fields, partition wide windows on both axes, suppress only the matching hinged frame, and refresh contextual fit/remove capabilities through real command drains. Regenerate logical architecture IDs after the complete incoming atlas while checking the frozen original pixel digest.

## [L-shared-shader-interstage-locations] Check varying locations after renderer integration, 2026-10-02

**What happened.** Actual GPU pipeline creation rejected the combined shader because architecture registration and ground origin reused covered-bed and dining output locations 8 and 9. Local TypeScript, unit, native and asset checks had passed; no GPU case had run successfully.

**Root cause.** Both renderer branches extended the shared vertex/fragment output struct independently. Resolving instance modes and resource bindings did not resolve the separate interstage location namespace.

**Prevention.** Preserve published bed/dining locations 8 through 10 and place architecture registration/ground origin at 11 and 12. Check every output field for uniqueness and portable location/component budgets after combining renderer branches. Actual pipeline compilation remains necessary.

**Verify.** The shared-output regression checks all thirteen fields, verifies unique locations and budgets, and rejects both original duplicate-location faults. Run the actual combined GPU pipeline before accepting any rendering case; a compilation failure means zero accepted GPU cases.

### [L-ui-proof-transitions-and-capture] Verify each UI state and inspect the requested artifact

**What happened.** A release walkthrough waited for the wrong Save text, then tried to close Options after Load had already closed it. A visual fixture also treated a serialized speed command and a transient canvas copy as screenshot readiness.

**Root cause.** The harness inferred UI transitions and browser scheduling from simulation commands. Independent operation, rendering and screenshot claims were tied to one long sequence, so a later harness error obscured earlier passing assertions.

**Prevention.** Read the current transition handlers before automating them. Use the actual Pause control for browser time. Split operation and presentation acceptance into independent cases. Check every fixture command's queue acceptance. Preserve partial assertions and overall failures accurately. Treat a canvas copy as diagnostic when the requested screenshot has its own capture path.

**Verify.** Record current state, clock and resource readiness before and after capture. Inspect the saved screenshot and its nonbackground pixels outside controls. Each deliberate mechanism mutation must fail its intended assertion, restore exact source bytes and pass the restored control. See the October 2 architecture publication evidence.

### [L-proof-paths-have-serialization-semantics] Decode recorded paths before joining them

**What happened.** A cooking-art proof recorded Windows relative paths. Its Linux verification test treated each backslash as part of a filename, failing publication even though the immutable art and hashes were correct.

**Root cause.** A recorded path was treated as a native filesystem path without decoding its separator convention. Local Windows tests concealed the difference.

**Prevention.** Emit forward-slash relative references for new portable receipts. Decode supported legacy separator conventions at the reader boundary. Preserve accepted producer and artifact hashes; reject absolute paths and parent traversal rather than bypassing provenance checks.

**Verify.** Exercise both separator forms with PurePosixPath even on Windows. Removing separator decoding must fail those tests and the actual recorded-input witness. Restore exact source bytes and require the full importer suite and generator check to pass.

### [L-candidate-guard-before-receipt-write] Reject existing candidates before the first write

**What happened.** A door exporter rejected an existing manifest only after its entrypoint replaced the candidate's status receipt. Rejection could damage accepted provenance without rendering anything.

**Root cause.** The immutability guard was inside the rendering function rather than before the entrypoint's first side effect.

**Prevention.** Check existing candidate receipts and destinations before writing running status, creating output files or opening the render operation. A rejected rerun must leave every accepted byte unchanged.

**Verify.** Invoke the rejection path against an existing candidate and compare its file hashes before and after. Require a fresh complete receipt for new exports and preserve prior candidates.

### [L-hashed-artifact-git-transport] Verify provenance bytes after Git filters

**What happened.** Sixteen newly hashed producer and receipt files passed local art verification, but Git would change their Windows line endings before a Linux checkout. Accepted manifest and input hashes would then fail publication.

**Root cause.** Verification bound working-file bytes without proving the bytes that Git would deliver.

**Prevention.** Audit the complete hash-bound dependency closure through Git clean filters. Preserve exact accepted bytes with scoped attributes, or define canonical emission before generating receipts. Do not normalize accepted artifacts afterward and rewrite their hashes.

**Verify.** Compare raw and clean object identities, then run production importers from exact staged Git bytes. Include manifests, producer sources, status, audits and audit scripts in the closure.

### [L-depth-witness-flat-surface] Place analytic depth witnesses on the intended surface

**What happened.** A near-parallel native door view projected a flat-panel witness onto raised moulding after a small seating change. The renderer matched its actual source surface; the analytic plane described another surface.

**Root cause.** The witness position was not tied to an unambiguous authored flat region.

**Prevention.** Select a model-defined panel center and retain source pixel and failing depth observations. Do not widen depth tolerances to conceal occlusion by another solid.

**Verify.** Preserve the original failure, identify the physical surface, and repeat with the intended witness. Removing surface projection must still fail; exact restoration must pass the same bracket checks.

### [L-mutation-cleanup-byte-gate] Verify restoration before continuing mutation work

**What happened.** A Windows write error interrupted a mutation runner's cleanup, leaving modified material source bytes behind. The cause of the isolated OS error was not established.

**Root cause.** A failed cleanup invalidates the assumption that later checks run against the accepted source, regardless of earlier mutant outcomes.

**Prevention.** Stop source-dependent work after a cleanup failure. Restore a verified original snapshot and compare every bound input before continuing. Preserve partial-run failures separately from a later passing run.

**Verify.** Compare exact source bytes and render-input hashes, require restored controls to pass, and never report unrecorded mutant outcomes as completed evidence.

### [L-wasm-build-import-target] Build the package the application imports

**What happened.** A simulation rebuild completed in an unused output directory. Type checking, web tests and the running game still loaded older generated files and reported missing methods.

**Root cause.** The build command used a remembered output path instead of the application's current import path.

**Prevention.** Inspect the application import and the repository's build command before rebuilding generated packages. Use that exact output directory before starting dependent checks.

**Verify.** Confirm the generated declaration and binary are in the imported directory. Run type checking and the web suite, then reload the game and check that it starts without missing-method errors.

## [L-frozen-prefix-versus-generated-offset] Preserve historical artwork without freezing derived table offsets

**What happened.** An accepted furniture batch could not enter the current generator because architecture used one base length both to freeze released pixels and to assign drawing IDs.

**Root cause.** The preservation boundary and the current combined texture-table length represented different contracts but shared one value.

**Prevention.** Keep the released prefix count and digest immutable. Validate new records through explicitly pinned, reviewed extension catalogs. Generate architecture drawing IDs after the combined base while retaining stable saved model identities. Reject mismatched offsets before resource loading.

**Verify.** Change a frozen pixel or extension catalog digest and require failure. Compare all prior registration tables and decoded sprite pixels. Compare architecture descriptors after removing only drawing IDs, then exercise the real renderer and load a save from the released build.

## [L-packing-fragmentation-versus-capacity] A failed placement policy does not prove a full texture

**What happened.** Adding eight unchanged aquarium frames made the existing rectangle policy fail despite sufficient padded area. A bottom-left policy fit the same rectangles without overlaps or artwork changes.

**Root cause.** One placement heuristic fragmented the remaining free space. Its failure was reported as a texture-height failure.

**Prevention.** Distinguish oversized rectangles, true padded-area exhaustion and policy infeasibility. Preserve successful existing placements, then try a bounded deterministic alternative for admissible input. Do not raise hardware limits or reduce accepted artwork to hide optimizer incompleteness.

**Verify.** Retain the actual size fixture, require bounds and padded non-overlap, and remove the alternative policy to reproduce the failure. Check successful prior layouts exactly and prove all released pixels and registration survive full generation.

## [L-inset-cloth-needs-evaluated-clearance] Check the thickness inside a cloth hem

**What happened.** An occupied bunk preview looked valid, but its evaluated
duvet crossed the mattress. Raising the inset side hems removed those crossings;
the foot hem still crossed because the thickness extended inward from the
visible cloth surface.

**Root cause.** Generated vertex bounds described the outside surface only.
The inset sides could not hang below the mattress top, and the foot wrap did
not reserve space for its inward thickness.

**Prevention.** Establish whether each hem rests on the mattress or wraps
outside it. Reserve thickness on the correct side of each surface. Check the
evaluated cloth against the body, bedding and frame after every modifier.
Keep visual acceptance separate from physical-clearance acceptance.

**Verify.** Require zero evaluated cloth triangle crossings. Displace the cloth
into the body and require failure. Retain rejected geometry evidence and add
regression tests for side support and inward foot thickness. The dated
[covered-bunk source evidence](assets/review-evidence/bedroom/covered-bunk-sleep-2026-10-04.md)
records the measured failures and correction.

## [L-paged-references-own-their-page] Route every referenced image independently

**What happened.** The first paged renderer sampled a door's depth rectangle
from its colour page. Existing door pairs happened to share a page, so ordinary
tests did not expose the incorrect assumption. A storage guard also retained
the old record byte size after the table layout grew.

**Root cause.** Colour/depth co-placement was treated as a contract, and the
storage budget duplicated a layout constant rather than sharing its definition.

**Prevention.** Read page identity from every sampled reference. Share the
record stride between packing and allocation checks. Preserve signed export
bytes through Git attributes before testing a clean checkout.

**Verify.** Place colour and depth controls on different pages. Require distinct
positive, page-only negative and restored outputs. Revert the shader reference
and require failure. Test a device budget between the old and new byte totals.

## [L-owner-overlay-needs-registered-body-drop] Project overlays into the visible owner's space

**What happened.** A selected lower-bunk sleeper's diamond surrounded the empty
upper pillow. The owner marker was correct, but its draw position omitted the
registered body drop and included an unrelated upward offset.

**Root cause.** The overlay used ground-projection coordinates while its
visible-owner marker was derived from registered sprite pixels.

**Prevention.** Apply the same body-registration transform to owner overlays.
Keep intentional activity-bubble lift separate from selection placement.

**Verify.** Assert the visible-owner centre at fractional scale. Inspect both
bunk and double-bed selections after shared placement changes.

## [L-gpu-readback-before-yield] Copy the current canvas attachment before waiting

**What happened.** A depth fixture returned transparent 2D snapshots even though
the attached WebGPU canvas visibly rendered its control. Adding an animation
frame wait did not establish capture ownership.

**Root cause.** The capture yielded before copying a transient presented canvas
texture. The repository already had an explicit GPU-buffer readback procedure.

**Prevention.** Configure copy-source usage in the fixture. Submit the texture
copy immediately after drawing. Await buffer mapping only after the copy is
submitted. Reuse the established capture procedure instead of adding waits.

**Verify.** Require the expected opaque pixel, a discriminating negative control
and exact restoration. Retain failed capture results separately from product
rendering failures.

## [L-static-proof-is-not-current-activity-scope] Date static-art limitations

**What happened.** The dining-furniture instructions said the table replacement
added neither seated eating nor table dishes, after a later domestic feature
had implemented both. That statement could misdirect a new animation task.

**Root cause.** A source-art checkpoint's exclusions were left phrased as current
runtime limitations after another workflow extended the same furniture.

**Prevention.** Label checkpoint-specific exclusions as historical. Link the
current interaction workflow. Inspect the live action and projection consumers
before treating an old source-art record as a restriction on gameplay.

**Verify.** The dining README now distinguishes its historical static proof
from the domestic seated-meal workflow. Check current action selection and
occupied-scene rendering alongside their existing behavioral regressions.

## [L-patches-use-current-formatted-source] Refresh patch context after formatting

**What happened.** Repeated patch attempts could not match function signatures
and expressions that a formatter had rearranged. A separate edit also used
an inaccurately remembered sentence as its anchor.

**Root cause.** Edits were prepared from remembered or pre-formatting text
rather than the current file. Failed patches were harmless, but repeated
guesses wasted work and could have matched another declaration.

**Prevention.** Read the exact owning function immediately before editing it.
Use local, function-owned patch context. Separate fixture construction changes
from new tests. Discard the old text snapshot after formatting.

**Verify.** Fresh-context review identified the actual multiline signatures.
The source-based patches preserved existing fixtures and passed all media
front, cone, availability and route tests.

## [L-independent-float-reference] Keep comparison references independent of storage

**What happened.** Dark seated scenes failed the comparison limit even though
the floating-point layer sum matched the original render. The reference had
been rounded through the production image encoding before comparison.

**Root cause.** Quantizing both the reference and the tested output introduced
different rounding errors. That measured the reference conversion as if it
were a rendering defect.

**Prevention.** Filter the original full-scene reference in floating-point,
premultiplied colour. Apply the display conversion once. Keep the production
storage conversion only on the output being tested.

**Verify.** Test literal dark colours and transparent pixels independently.
Retain the same comparison limits and check every exported palette and facing.

## [L-placement-fixture-grid] Build placement fixtures with coherent collision occupancy

**What happened.** A new occupied-chair move test received UnsupportedLayout
before it reached the ownership check. Changing the saved wall resource did
not resolve the failure.

**Root cause.** Dynamic object spawning intentionally does not block footprint
tiles. The placement validator requires the live grid to match the complete
furniture and architecture inventory; an empty wall resource was already the
fixture's default.

**Prevention.** Use the lot constructor for placement policy fixtures. Keep
low-level geometry fixtures separate. Prove that idle move and sale succeed
before expecting the occupied version of those operations to fail.

**Verify.** The constructor-backed media fixture accepts idle movement and
sale, then returns InUse during both travel and active seated use.

## [L-gpu-reference-scope] Match the renderer's reference and capture semantics

**What happened.** A seating graphics check disagreed at faint silhouette
pixels and a subsequent canvas snapshot stalled.

**Root cause.** The reference drew coverage that the production shader discards
below half opacity. It also filtered display colours instead of linear,
premultiplied contributions. The capture yielded before copying the transient
canvas attachment, contrary to the established buffer-readback procedure.

**Prevention.** Keep independent original-beauty reconstruction and decoded-layer
shader fidelity as separately named gates. Model sampling, opacity discard and
background composition in the shader reference. Submit a full texture copy
before yielding. Reject out-of-frame references and non-finite measurements.

**Verify.** Compare complete frames without removing edge pixels. Retain the
original error limits. A texel-aligned shader check does not establish numerical
fidelity at fractional zoom or a final-pixel comparison against original beauty.

## [L-validation-fixture-layout] Exercise the layout branch that owns the guard

**What happened.** Removing a standing-media save guard left its regression
green. The fixture used a legacy layout that did not run wall-aware contact
validation.

**Root cause.** The test reached the save API but not the specific validator
whose behavior it claimed to protect.

**Prevention.** Construct a coherent wall-aware lot when testing wall-aware
restoration. Assert a non-perimeter route endpoint so ordinary contact cannot
accidentally satisfy the check. Remove the consumer's validation calls, not
only the helper under test.

**Verify.** The corrected fixture restores both travel and active use. Deleting
the standing-contact consumer calls rejects its travel save. Restoring the
calls returns the test to green without modifying runtime behavior.
## [L-browser-evidence-export-boundary] Preserve completed checks when report export fails

**What happened.** A browser proof completed its guarded dish-cleanup checks and
saved screenshots, then failed while importing a filesystem module to write its
report. Some screenshot labels also lagged the simulation state sampled by the
proof.

**Root cause.** The browser callback ran in a JavaScript virtual machine without
a dynamic-import handler. A failed callback did not return its local results.
Simulation stepping also did not wait for every presentation update.

**Prevention.** Return plain data from browser callbacks and persist it through
the controller's file tools. Capture each visual state after its presentation
update. If export fails after checks completed, retain the failed tool status,
the original guarded callback and artifact hashes. Distinguish control-flow
evidence from visible pixels; never invent discarded values or a successful
return.

**Verify.** Require assertions before each capture, a normal structured return,
and controller-side file verification. Where an earlier export failed, inspect
the exact callback ordering and recorded error before making completion claims.

## [L-chore-lifecycle-save-invariants] Reconcile chore state at every ownership transition

**What happened.** Independent review found stale dish starts after cancellation
and death, floor plans invalidated by room edits, outdated furniture contacts,
lost contents after bin sales, unsupported saved tasks and duplicate midnight
settlement. A final ownership check found chore interruption could erase a
newly installed commute path.

**Root cause.** The new chore resource shared existing movement and domestic
state without covering every transition that changes their owners or targets.
Runtime cleanup and load validation enforced different invariants.

**Prevention.** Reconcile records on cancellation, death, furniture movement,
sale and topology edits. Transfer conserved contents before removing sources.
Validate only task variants the runtime constructs. Defer daily settlement for
real active work and reject credit to settled episodes. Release shared paths
only when no other activity owns them.

**Verify.** Exercise actual furniture and wall commands, interruption and real
washing across midnight. Save and reload at transition boundaries. Assert both
the remaining resource state and movement ownership. Independently remove each
guard, require its regression to fail, and restore exact original source bytes.

## [L-transparent-body-picking] Do not let transparent character corners intercept furniture clicks

**What happened.** Right-clicking visible table wood beside a Sim opened only
Nothing. The isolated menu regression reproduced the same result.

**Root cause.** Character picking treated the sprite's whole rectangle as solid,
including transparent padding beside the head. The nearer Sim won that pick
and its self menu hid the table's cleanup action.

**Prevention.** Sample the displayed body frame's decoded alpha before assigning
depth priority. Keep exact alpha for antialiased edges and existing paired-body
and covered-bed ownership. Retain compact masks rather than the full atlas image.

**Verify.** Click exposed table wood through a transparent body corner and require
Clean up. Check that opaque body pixels still select the Sim, dish piles retain
their fixed targets, and the behavior scales with zoom. Removing the alpha guard
must reproduce the original Nothing menu.


## Playable previews must preserve household needs

**What happened.** A chore demonstration disabled need drain and forced other
housemates away. The playable preview concealed ordinary household behavior.

**Root cause.** An isolated regression fixture was presented as a gameplay demo.

**Prevention.** Preserve normal personalities, need drain, autonomy and careers
in playable previews. Seed only the mess needed to show a feature. Reserve frozen
fixtures for narrow automated tests. State when a dialog pauses game time.

**Verify.** Observe each need declining during normal ticks, then play chores in
that household. Require table actions to reflect real chairs and prepared food.

## Revalidate cleaning contact after building walls

**What happened.** A retained wiping endpoint could pass geometric adjacency
checks after a wall blocked contact. Failed grouped work could count as neglect.

**Root cause.** Retained contacts used weaker checks than initial routing, and
route failures discarded tasks without updating the daily duty episode.

**Prevention.** Reuse the grid's edge-aware contact predicate and preserve route
unavailability when terminating work, including build-mode pruning.

**Verify.** Insert a wall during a chore. Require contact rejection and an
unavailable daily outcome across midnight, without deleting grime.


## Usage-driven dirt needs event and geometry boundaries

**What happened.** Review found unordered ordinary completions sharing a random
stream, diagonal cleaning across blocked tile corners, and a cancelled floor
plan losing its unavailable-duty status after a room partition.

**Root cause.** New dirt rolls made interaction iteration order observable.
Wall-edge intersection alone did not represent legacy blocked wall tiles. The
floor-plan pruning branch omitted an outcome update already present for objects.

**Prevention.** Order completion events by stable entity identity. Check both
wall edges and diagonal intermediate cells. Carry duty unavailability through
all topology-driven task removal paths.

**Verify.** Reverse insertion order for two identical completion bundles and
require identical dirt targets. Block the orthogonal cells beside a diagonal.
Partition a suspended cleaner's room and cross midnight without a neglect charge.

## Test movement inside its actual lifecycle

**What happened.** A bare test path was eligible for replacement by autonomy.
Calling movement alone then failed because its interpersonal phase was absent;
reusing that schedule after loading another world violated its world binding.

**Root cause.** The fixture bypassed the ownership and lifecycle boundaries that
production movement uses.

**Prevention.** Use the established prepare, movement, apply phase when isolating
walking. Create a fresh schedule for a newly loaded world. Compare the exact
random-stream state as well as the resulting dirt amount.

**Verify.** One final tile entry consumes one roll. Arrival, path removal,
standing and save/load consume none. Deleting the movement hook must fail the test.

## Verify the body motion when delivering an activity

**What happened.** Cleaning logic and fading grime worked while the cleaner
still used an idle body pose.

**Root cause.** Work-state and effect checks were treated as evidence for the
whole activity without observing the Sim's motion.

**Prevention.** Review each activity's body clip, tool contact and furniture
overlap in the running game. An activity label or disappearing dirt does not
prove an animation. Derive work poses from the real activity lifecycle so
travel, pause, cancellation and save/load remain consistent.

**Verify.** Capture several work samples in every supported direction. Confirm
the tool moves with the hands, the furniture hides the appropriate body parts,
pause holds the pose, and cancellation removes the tool and closes moving lids.

Native visual fixtures must call `sync_render_buffer()` after `Sim::tick()`
before inspecting render rows. The browser handle performs both steps; the
native simulation tick alone leaves the previous projection cached. Construct
ordinary household members through `spawn_household()` to retain identity and
personality initialization.

## Preserve logical outline thickness and review the whole character

**What happened.** A cleaning export rendered at four pixels per logical pixel
using outlines authored for sixteen. Heavy ink filled the eyes, and a flat
dark mop head concealed its cotton underside. Both passed a review focused
on hand contact and furniture overlap.

**Root cause.** The exporter changed render density without scaling outline
width. Regrouping the character also removed the hair from its outline-selection
collection. Visual review criteria omitted facial readability and tool identity.

**Prevention.** Keep outline width divided by render density constant. Preserve
authored line-selection membership when reorganizing scene collections. Show
the full character and recognizable tool at native game size, ordinary zoom
and close zoom. Give independent reviewers the owner's rejected capture as
well as the new candidate, and require explicit checks of face and tool identity.

**Verify.** Compare the approved outline settings and visible eye-white pixels
in front-facing exported frames. Check every palette and facing, then inspect
played captures at multiple zoom levels. Tests for hand contact and depth do
not establish appearance quality.

A point aligned with a tool does not prove a grip. A rigid relaxed hand cannot
close its fingers by changing its orientation. Use a fitted grip pose or
action-specific closed hand geometry, then check enclosure around the tool,
opposing thumb placement, contact gaps and wrist continuity. Cotton strands
should gather and hang; repeated radial loops create petals rather than yarn.

## Preserve a separate save before a live development reload

**What happened.** Texture and browser-module updates reloaded a paused game.
Startup selected 1x speed, and autosave replaced the saved point as time advanced.

**Root cause.** Saving into the game's single slot was treated as a backup.
The same slot remains writable by autosave after a development reload.

**Prevention.** Keep a separate copy of the save bytes before updating a live
preview. Restore that copy when appropriate and reapply Pause after all reloads.
Use isolated browser contexts for fixtures and automation.

**Verify.** Compare the retained save's world hash after restoration and check
the visible Pause control. A Saved game loaded message alone does not prove
that the original time or state was restored.

## [L-pinned-hash-search-includes-strings] Search for a moved hash in every written form

**What happened.** Hashing personality effects moved the world hash of a released-main save that a web test loads. A search for pinned hash values matched only numeric and bigint literals, so it missed that test, which compares the hash as a decimal string, and the implementer reported that no web test pinned a moved value. The web suite failed on that test until the pin was updated.

**Root cause.** The search assumed every pinned hash is written as a number literal. A test can also pin a hash as a quoted decimal string.

**Prevention.** When a change can move a hash, record the old value from a run before the change and search the repository for its exact text in decimal and hexadecimal, inside or outside quotes. Run every suite that loads a pinned save against a rebuilt package before claiming no pin moved.

**Verify.** The search for the old value returns each pin, and each suite that loads a saved fixture passes against the rebuilt package.

## [L-one-mutation-writer-per-worktree] Run one source-mutating agent per worktree at a time

**What happened.** Two implementers worked in one worktree at once, and each ran guard-deletion checks that rewrote `crates/terri-sim/src/lib.rs` and restored its saved bytes afterwards. One agent's backups in the shared scratchpad replaced the other agent's mutation script, and the second agent had to wait until the source files matched HEAD before it could compile or mutate anything.

**Root cause.** A save-and-restore mutation harness assumes it is the only writer of the file and of its scratch directory. A second agent in the same worktree breaks both assumptions: a restore can write back bytes that hold the other agent's mutation, and one crate build compiles both agents' changes into each other's test runs.

**Prevention.** Allow one agent at a time to write source files in a worktree, including mutation harnesses. Give parallel implementers separate worktrees, and give each harness its own scratch directory.

**Verify.** Before a mutation run, confirm that `git status` shows only your own changes and record `git hash-object` for each target file. After restoring, confirm the hash matches the recorded value and that no other process changed the file during the run.

## [L-per-completion-effect-needs-mid-activity-read] Read a per-completion effect while the activity runs

**What happened.** The first test of learning from a conversation recorded the first tick on which either participant's practice rose and asserted that it equalled one attempt. Review showed that a `practise` call moved into the per-tick delivery would also raise practice by exactly one attempt on that first tick, so the test passed for the wrong code. The rewritten test reads practice while the chat runs and again after it ends.

**Root cause.** A site that runs every tick and a site that runs once at completion produce the same value on the first tick that changes anything. A first-change read cannot tell them apart.

**Prevention.** For an effect that must happen once per completed activity, assert the value mid-activity, while the activity is still under way, and again at a fixed tick after it ends, against an exact count of completions. Prove the test by moving the call into the per-tick path and to the activity's first tick, and confirm that each move fails it.

**Verify.** `a_social_completion_teaches_both_participants` in `crates/terri-sim/src/skills_tests.rs` reads practice at tick 28 during the chat and at tick 60 after it. Moving the call into the per-tick delivery fails it with `nothing learned while the chat runs`, as recorded in `docs/specs/2026-10-05-skills-verification.md`.

## [L-walk-direction-is-state-not-position] Record which way a walk goes; do not read it off where it ends

**What happened.** One `Commuting` marker covered both the walk out to a shift and the walk home, and `commute_and_work` told them apart by whether the worker's position was within a hundredth of a tile of the door or the street's exit when its path ran out. A worker a fraction of a tile from the door's centre when the shift started got the empty commute, arrived on the shift tick where it stood, was read as home from work, and lost the shift unpaid. A calendar test draft on a lot without wall edges hit it at tick 88 of a 30-tick day; the shipped lot's walls route every commute onto the tile's centre first, which is why the played game never showed it.

**Root cause.** A direction known at the moment a walk starts was discarded and reconstructed from a tolerance check on the walk's end. Any end position outside the tolerance, including the start position of a zero-step walk, turned a departure into a return.

**Prevention.** When two walks share a marker and a mover, write the direction into the marker when the walk starts (`Commuting::Outbound`, `Commuting::Inbound`) and read only that at the end. Keep a tolerance check for what it measures, a position, and never use it to decide which lifecycle an event belongs to. On load, where a save carries one bit, derive the direction from the saved walk's destination, which is authored, not from the position, which is wherever movement left it.

**Verify.** `a_worker_a_fraction_off_the_door_at_shift_start_still_clocks_in_and_is_paid_once` and `an_outbound_commute_that_has_ended_clocks_in_wherever_the_worker_stands` in `crates/terri-sim/src/systems/career.rs` fail with `left: None` when the positional check is put back into the outbound arm; `a_worker_mid_step_on_the_door_at_shift_start_still_goes_to_the_street` in `crates/terri-sim/src/systems/street_tests.rs` pins the shipped lot.
## Keep chore state available during mood-based decisions

**What happened.** Daily cleaning decisions omitted grime and chore feelings,
while the public mood display included them.

**Root cause.** The chore scheduler temporarily removed its state resource.
Mood derivation looked up that missing resource rather than receiving the
scheduler's current state.

**Prevention.** Pass the owned state explicitly to mood derivation while a
resource is outside the world. Keep public and scheduler mood inputs identical.

**Verify.** Run the normal daily-decision path with the same person, needs,
profile and random draw, between the clean and grimy probabilities. Dirt and
recent chore feelings must change the decision without adding random draws.

## Verify asset receipts against staged Git bytes

**What happened.** Asset checks passed against working files, but Git's newline
conversion changed newly staged producers and manifests bound by raw SHA-256.

**Root cause.** The accepted files lacked the exact-byte attributes already
used for older model receipts. Git's cached index also needed renormalization
after the attributes changed.

**Prevention.** Protect every byte-hashed producer and receipt from newline
conversion. Compare its staged blob with the receipt before delivery, and
renormalize only the newly protected files when the index already holds them.

**Verify.** Read each approved input from Git's index and require its hash to
match the same receipt as the working file. A local-only asset check is
insufficient evidence for a clean checkout.

## Give recovery tests a real activity owner

**What happened.** A repetition-recovery test expected a snack score to decay
while an empty order queue allowed autonomy to complete another snack.

**Root cause.** An empty player queue and full Hunger do not prohibit food;
exploration can still choose it. The observed increase was another completed
use rather than a failure of decay.

**Prevention.** Give the person a valid directed activity during a recovery
interval when the test requires no new use of the measured activity. Keep the
normal simulation running and retain a per-tick monotonicity assertion.

**Verify.** Record the first upward score transition and the active chain.
Require the recovery scenario to avoid renewed use, then verify its score and
mood heal without disabling production systems.


## Release fixture ownership before replacing an autonomous target

**What happened.** A busy-table meal test left the cook's Sit order waiting,
then failed when a guest used a chair. Changing the activity duration did not
fix the missing ownership precondition.

**Root cause.** CancelIntents deliberately preserves an autonomous ordinary
activity. The fixture manually replaced that activity's target without releasing
its reservation, leaving an unowned table marker that blocked the real Sit order.
The original injected cook target bypassed admission and masked the bad fixture.

**Prevention.** Release the previous target through the existing reservation
mechanism before replacing it in a fixture. Establish busy surfaces through real
orders and physical-place routes. When sustained occupancy is the precondition,
use a bounded authored duration in test-only content and install identical
content before restoring the comparison world.

**Verify.** Require the cook's actual Sit target at each guest's first meal
claim. Require both guests to perform standing work, save during that work,
and compare original and restored hashes through consumption. Trace the
reservation owner when admission fails; do not clear markers blindly.


## Match an order's owner as well as its activity

**What happened.** Retaining generic chain orders until completion let a queued
whole-house cleanup be mistaken for the owner of an active pile or surface
cleanup. Retained orders also displaced a First floor chore on the next tick.

**Root cause.** Activity identity alone does not distinguish different scopes
or a timed chore that temporarily interrupts the same generic activity.

**Prevention.** Use existing saved scope and chore ownership in serving,
resumption, settlement and queue display. Let waiting orders preserve the
current movement. Validate a First request before releasing existing work.

**Verify.** Queue whole-house cleanup after a pile or surface, preserve repeated
orders behind a First chore, and require actual physical cleanup before the
waiting order runs. Save and reload each transition with matching hashes.
## [L-organic-sounds-need-recordings] Body sounds need a recording, not a tone

**What happened.** The owner asked for the sleeping sound to become a quieter, lower snore. A lower, softer triangle sweep was rejected as not snore-like. Three synthesized two-part snores, built from tones, flutter and filtered noise, were rejected too; one of them sounded like a cat purring and was kept for pets. A CC0 recording, measured and filtered to keep its energy low, was accepted.

**Root cause.** A snore is a noisy, irregular sound from soft tissue. Envelope and pitch changes to one oscillator could make the cue quieter and lower, but not make it read as a snore. Frequency assertions and a design argument could not decide that; only listening could.

**Prevention.** For a body or animal sound, search CC0 sources for recordings first and audition them with the owner before synthesizing. Measure each candidate's energy above 1 kHz and 2 kHz before offering it, because the owner wants very few high-pitched sounds in a game left playing in the background. Send rendered audio files for listening rather than describing a waveform.

**Verify.** Each offered candidate has a recorded licence and a band-energy measurement, and the owner chose the shipped sound by ear. For the snore, ASSETS.md, "Sleeping snore recordings", records both.
