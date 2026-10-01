# Toilet completion audio

The owner accepted the selected recording and directs delivery after relevant local checks and fresh-context adversarial review. This authorization permits release despite the failed whole-audio retained-memory assessment and unavailable 120 Hz calibration. Neither result becomes a pass, and authorization to release does not claim a separate in-game listening review. The completion and playback contract remains unchanged.

## Contract

1. Play one recorded flush only when an ordinary toilet `relieve_self` action makes a positive-to-zero remaining-tick transition. Start, cancellation, displacement, death, paused commands, missing targets and loading do not mean completion.
2. Author `completion_sound = "toilet_flush"` separately from sustained `sound_action`. Use a closed compiled category. Match the live target interaction and object definition to the active action, require a positioned SmartObject and eligible actor, and reject conflicting chain state. Invalid presentation identity must not alter gameplay completion or reservation release ordering.
3. Emit packed `(action, sourceEntity)` pairs into a bounded, retained-capacity, unsaved presentation buffer. Action code 1 means toilet flush. Cap at 64 events per tick and deduplicate the same source/action within a tick. Clear before each full tick, paused command flush and world replacement. Expose count, pointer and clear at the WASM boundary.
4. Drain after every fixed tick, including several ticks in one rendered frame. Acquire a fresh view and clear in `finally`. Sampling-disabled ticks discard events. No event queues survive mute, locked audio, pause, background, missing clips or decoding. Loading mid-use may later produce a real completion; loading completed use must not replay it.
5. Preload one selected flush recording after a successful audio gesture when unmuted and Effects is above zero. Simulation pause does not block preparation: the unlock gesture can precede closing Help or Options. Playback remains pause-gated. Cache success, coalesce in-flight requests, and use a five-second failure cooldown with retries only on a new gesture or completion demand. Do not fetch on every tick. A completed decode never triggers playback.
6. Play at the original rate, independent of simulation speed. Bound playback to four active voices, at most one per physical source. Use short edge fades. Pause, mute, Effects zero, background and Load stop active flush voices and clear source ownership. Other already-shipped audio keeps its existing behavior.
7. Preserve save bytes, world hashes, RNG continuation and the existing explicit content fingerprint. No dependencies, paid services, animation changes or player-visible copy changes.

## Verification

Public seams are content compilation, simulation tick/commands/save/load, WASM pointer/count/clear, bridge drain, AudioController events/lifecycle, and actual decoded Web Audio output. Use test-first cycles and independently kill identity and lifecycle guards with targeted mutations restored byte-exactly.

Cover real final tick versus start/intermediate/cancel, two simultaneous toilets, repeat uses, malformed zero timer, every exact-target guard, double drain, muted/unavailable drops, late decode, failure cooldown, multi-tick frames, disabled sampling, save/load and silent ordinary UI controls. Browser proof must use the compiled production game, a trusted unlock gesture, public game commands and an inspected screenshot. Signal proof must decode the actual selected recording and check finite samples, headroom, bounds and silence after stop boundaries. Auditory taste remains pending owner listening.

## Recording

Compare the two toilet-flush originals in rubberduck's already-approved 100 CC0 SFX pack. Preserve the selected original, archive and source hashes, author/license/source URL, decoded measurements and reproducible conversion. Do not interpret numerical measurements as having listened to a recording.

The source is rubberduck's [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx), CC0 1.0. Its page explicitly identifies two toilet-flushing recordings. Verified archive SHA-256: `a5c135878c132f1c59cca54e60061c296cd0ac27ad031ca2c41b8cd5cab3c706`.

| Source | Stereo frames at 48 kHz | Duration | Peak | RMS |
| --- | ---: | ---: | ---: | ---: |
| toilet_01.ogg | 336,789 | 7.0164375 s | 0.64494073 | 0.04409032 |
| toilet_02.ogg | 197,986 | 4.1247083 s | 0.75609422 | 0.05450888 |

Selected 02: its shorter duration reduces overlap and its final partial second falls to RMS 0.00006870. The owner accepted this recording after listening. Both contain finite, unclipped decoded samples. Numerical measurements alone do not establish pleasant timbre or absence of recording noise. In-game mix acceptance remains separate. Preserve the selected original at `assets/audio/toilet/toilet_02.ogg`, SHA-256 `9e4a1824ac584bb65ba32406155d37861df7e11b95ef62493246dd2da17f8dbc`.

`scripts/prepare-toilet-audio.ps1` validates that hash and frame count, then uses the existing task-owned Playwright CLI proof page and shared PCM encoder. It preserves all samples without filtering, trimming, normalization or dithering. Output `web/public/audio/toilet/flush.wav` has 791,988 bytes, stereo PCM16 at 48 kHz, SHA-256 `b0e3384721432cb34733619b6e415c1de78f06f4b5f11bb0486f863088d4fbb5`. The script refuses to overwrite an existing output. At gain 0.08 the rendered peak stays below 0.06050 for one source or 0.24200 for four aligned sources before Effects gain, including PCM16 quantization and browser conversion.

## Verification evidence

1. `npx vitest run tests/audio-memory-report.test.js tests/toilet-audio-assets.test.js --maxWorkers=1`: eight tests passed, exit 0. The memory tests first failed because excess and undrained flush voices were accepted. Removing each new report guard separately failed its regression, exit 1; restoration SHA-256 was `ea952bf07136c2511391d8f0cadebe85b97771ebc0855add67c5e3ff8392e5cd`. One-byte mutations to the original OGG and runtime WAV each failed the asset regression and were restored to their recorded hashes.
2. `proveToiletRecording()` in `web/proofs/toilet-recording.js`: seven real browser OfflineAudioContext renders passed, exit 0. One source peaked at 0.0604901239, four at 0.2419604957, with Effects 100%, Voices 0% and game speed 3x. Load, mute, Effects zero, background and pause at 0.1 seconds produced zero output after 0.2 seconds. Every case ended with zero voices, zero samples after the natural file end and exactly one preload request. The initial bound based on the original floating-point decode was too tight by 0.000000124 after PCM16 conversion; the documented bound includes that conversion without changing gain or source audio.
3. Production game at 1440x1000: actor 34 used exact toilet 29 through public commands. Cancellation left both completion events and played cues at zero. The first genuine final tick (57) emitted exactly `(1, 29)`, played one flush, held one voice and left the event buffer empty. Effective pause stopped that voice. No page errors occurred; the task-owned browser closed in `finally`. This probe found and verified the paused-preload correction in lesson L-preload-is-not-playback. Screenshot inspection confirms the existing standing generic use pose and briefly stale Walking HUD label; it does not establish a seated or flushing animation. The visual-work thread received those findings.
4. Final production proof after callback-identity and sampler-timing corrections passed on `index-Czdmmf1M.js` and `terri_wasm_bg-C7Tb9Vl0.wasm`. Cancellation remained silent; exactly `(1, 29)` at tick 55 played once, drained, and stopped on pause. No page errors. Inspected image: [final use scene](../assets/review-evidence/audio/toilet/use-final.png), SHA-256 `24f6a041076b68c81239718bba94880ba746bc1c5de28e3418a394a2fb63ff48`. The Sim still uses a generic standing pose; that is separate visual work. The seven current-source offline renders also passed after the callback fix.
5. `npm run typecheck`: PASS, exit 0. `npm test -- --maxWorkers=1`: PASS, exit 0, 114 files and 1,598 tests. `npm run build`: PASS, exit 0. Independent review found completion processing outside the audio sampler timer; the corrected timing boundary includes it and preserves disabled-event draining.
6. The first full retained-memory run failed: paired audio-specific JS growth 93,488 / 46,300 / 79,728 bytes, median 79,728 against 65,536. Structural limits and drained endpoints passed. Its warmup did not establish flush lifecycle coverage, and pairs used different random worlds. Diagnostics are investigating those measurement gaps without changing the 540 measured ticks or memory allowance. This is not a passing memory result.
7. Full Rust verification initially failed the compiled-content golden vector because the new optional presentation field adds a serialized byte. After adding that single annotated `None` byte to the content fixture, `cargo test --workspace -- --test-threads=1` passed all 1,249 tests, exit 0. Save golden vectors were not changed. The fingerprint and 120-tick differential save/hash/RNG continuation tests passed. `cargo fmt --all -- --check` passed, exit 0.
8. Focused fault injection killed 34 implementation mutations (19 Rust, 15 TypeScript), each restored byte-exactly. These covered identity, positive completion, metadata, buffer bounds/clearing, playback ownership, pause, stale callbacks, fetch cooldown, late-decode silence, disabled draining and timing boundaries. Four additional asset/report mutations also failed their intended assertions. This is targeted evidence, not a full remote mutation sweep.
9. A matched-initial-save lifecycle diagnostic exercised both natural flush ending and pause cleanup before measurement. The unchanged first 540-tick window still exceeded the allowance: 143,868 enabled minus 73,804 disabled = 70,064 bytes. A separate second 540-tick diagnostic grew by 7,724 audio-specific bytes. Both pairs retained equal DOM/listener counts and zero endpoint voices. Heap attribution is pending; the smaller second-window result does not replace or pass the first-window gate.
10. Independent harness review found that lifecycle preparation could leave the measured worlds at different ticks despite matching initial saves. The corrected protocol restores a shared measurement fixture before baseline collection, requires equal world hashes/ticks, fingerprints actual loaded JS/WASM responses and excludes snapshot-callback runs. Nine focused report tests passed; independently deleting each of those three guards failed with `expected true to be false`, exit 1, followed by byte-exact restoration.
11. The corrected full three-pair raw-heap check still failed, exit 1: differentials -15,252 / 71,236 / 67,664 bytes, median 67,664 against 65,536. Structural and coverage checks passed. Every run began at tick 60 with world hash `1157458679244961385`; measured intervals were 540 / 543 / 540 / 541 / 540 / 540 ticks due polling overshoot. Enabled flush counters advanced from 2 to 6; disabled counters stayed zero. No limit or metric was changed. After this third failure, further runs stopped for a fresh adversarial review.
12. Separate heap-snapshot diagnostics found stable audio native-object counts, no retained source nodes or closure-count growth, and substantial compilation of existing rendering/audio functions. That instrumented run's raw differentials were -14,208 then 65,248 bytes; it cannot explain the failed non-instrumented results. No compiler-category subtraction is justified or applied. Failed reports and attribution remain in task-local `.tmp/toilet-*.json` files.
13. `cargo clippy --workspace --all-targets -- -D warnings`: PASS, exit 0. Memory acceptance and delivery remain open.
14. Production performance proof completed both 540-tick, 1,037-entity runs. Audio sampling including completion dispatch measured p95 0.20 ms and maximum 0.30 ms. Enabled and disabled frame-work p95 were both 4.8 ms; neither had a work frame over 16.6 ms, and neither called `simIdOf`. The command exited 1 because this host measured 60 Hz rather than the required 118-122 Hz calibration. These work timings pass their limits; 120 Hz acceptance remains unverified, not passed.
15. Fresh whole-branch review approved the source with no additional material findings, while retaining the failed memory gate and unverified refresh/listening coverage. The Rule of Three review traced the same toilet player, controller, decoded clip and empty 76-byte Map backing stores across all three saved enabled snapshots; the fetch remained null. An apparent surviving voice object was a compiler allocation template whose fields referenced `system / Hole`, not live nodes. This supports bounded ownership in that diagnostic run only. Because the diagnostic getter performs expiry cleanup, zero counts alone do not prove natural `onended` reclamation.
16. One predefined four-condition causal diagnostic compared pre-feature `c3ba226b` with the current build, without retries. Pre-feature raw JS growth was 40,544 bytes disabled and 97,868 enabled, a 57,324-byte differential. Current growth was 48,316 disabled and 39,756 enabled, a -8,560-byte differential. Current minus pre-feature was -65,884 bytes. All conditions matched baseline tick 60/hash `15673571512124383760` and final tick 600/hash `13352472879687521638`, with unchanged DOM/listener counts and no page errors. Current enabled playback recorded four measured flushes. This single sample identifies no positive feature-specific regression; it neither proves lower memory use nor clears the failed acceptance check. Its frame-timestamp wrapper and omission of intermediate heap samples make it diagnostic-only. No compiler memory was subtracted, and no allowance changed.
17. One finite passive natural-ending proof passed with the actual player and decoded 197,986-frame recording. A single source and then four distinct sources each produced one trusted native `ended` event. Direct inspection found the ownership Map empty, each `onended` handler cleared and each source/gain disconnected exactly once. No cleanup getter, pause, stop or subsequent play ran before inspection. Native disconnect wrappers delegated unchanged to the actual methods; proof references and wrappers were released afterward. Browser and proof server closed in `finally`. This establishes natural callback cleanup for those cases, not whole-page memory acceptance. The [raw natural-ending report](../assets/review-evidence/audio/toilet/natural-ending.json) records hashes and instrumentation limits.

## Integration evidence and release authorization

### Main integration and interruption repair

On 2026-10-01, the branch incorporated main `6df7c045`, including the cooking
texture, silent-control policy, complete HUD normalization and automatic audio
recovery fixes. The merge retained the shared-world, bundle-fingerprint and
toilet-lifecycle requirements in the memory harness. Its limits did not change.

Independent review found that the new toilet player was missing from unavailable
frame cleanup. A playing flush could survive an externally suspended clock and
resume its old tail without a new completion. `prepareWorldAudioFrame` now stops
the toilet player alongside the other players. This defect is separate from the
failed whole-page retained-memory check; no causal link was established.

1. Red: `npm test -- --maxWorkers=1 tests/audio-controller.test.ts -t 'discards a flush'`
   failed with `expected false to be true` at the source-disconnection assertion,
   exit 1. Eight final cases cover all four standalone frame entry points in
   suspended and interrupted states. They require cleared ownership, no replay
   on automatic recovery and successful fresh completion from the same source.
2. Green: `npm run typecheck` passed, exit 0. `npm test -- --maxWorkers=1` passed
   1,748 tests in 117 files, exit 0. New tests inherited from main use the existing
   category-specific transport spy so independent toilet preloading cannot
   consume their response or alter their fetch/decode assertions.
3. Mutation: deleting the new toilet cleanup failed all eight cases, exit 1,
   and the browser render proof rejected `Frozen flush retained`. Restoring it
   passed all eight cases and restored controller SHA-256
   `b2937f134cc6b19a072f179e3526f70a3e2d7d3c08aa6173730e13e924a26758`.
4. `proveToiletRecording()` passed nine native OfflineAudioContext renders.
   Both new interruption cases had positive output before cancellation and zero
   output after 0.2 seconds, including after resumption. Single and four-source
   peaks stayed 0.0604901239 and 0.2419604957. The suspended/interrupted state
   labels are modeled; this does not claim operating-system interruption proof.
5. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`,
   `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
   `cargo test --workspace`, and `npm run build` all passed, exit 0.
   The production JavaScript bundle is `index-ROiUXfBB.js`.
6. The [production lifecycle report](../assets/review-evidence/audio/toilet/refresh-game.json)
   recorded two genuine completions for toilet 29 at ticks 51 and 238. Each
   played one flush, the first drained naturally, and pause drained the second.
   There were no page exceptions. The [game screenshot](../assets/review-evidence/audio/toilet/refresh-game.png)
   was inspected at 1440x1000: household and controls remained readable; the
   generic standing interaction poses remain a separate visual limitation.
7. `python check-doc-ids.py` and `git diff --check` passed, exit 0. Independent
   source review found no remaining material integration findings. Task-owned
   browser pages and both preview/proof servers were closed.

### Release decision

On 2026-10-01 the owner directs completion and merge after relevant local checks
and fresh-context adversarial review, without waiting for duplicate GitHub checks
or review. This is a feature-specific release exception for the failed raw-memory
assessment and unavailable 120 Hz calibration, not a changed allowance or a claim
that those checks passed. The whole-audio measurement does not establish a
flush-specific leak. Preserve the failed reports and diagnostic limits. Do not
repeat the unchanged assessment to seek a favorable sample. Correct valid source
findings before delivery. Keep recording acceptance separate from subjective
acceptance of the in-game mix.

The dated [current-main verification record](../assets/review-evidence/audio/toilet/2026-10-01-verification.md)
contains the inspected revisions, exact measurements, playback evidence, review
findings and unavailable checks. Quieter footsteps and cancellation of indoor
background noise are delivered separately; neither depends on releasing this feature.

The [authorized release record](../assets/review-evidence/audio/toilet/2026-10-01-release.md)
records current-main integration, local verification, fresh review and the owner's
release exception. Historical evidence above retains its inspected revisions and
original outcomes.

Durable raw reports are [matched memory](../assets/review-evidence/audio/toilet/memory-matched.json), [causal comparison](../assets/review-evidence/audio/toilet/causal-comparison.json), and [performance](../assets/review-evidence/audio/toilet/performance.json). Task-local scripts, fixture saves, failed earlier runs and snapshots remain under `.tmp/toilet-*`; the temporary pre-feature checkout has been archived. Diagnostic browsers and production servers are closed.
