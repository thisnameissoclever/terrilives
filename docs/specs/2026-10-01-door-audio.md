# Recorded door transitions

The front and interior doors open silently and play only a filtered closing
thunk. The owner rejected the loud, high-pitched squeak in the initial recordings.
The originals remain preserved; the runtime loads only `audio/doors/close-thunk.wav`.
Listening approval remains a separate owner decision.

## Authority and event timing

Use the existing simulation-owned portal columns after each fixed tick. Door
identity is the near/far tile coordinate tuple, not row order, sprite or Sim.
New observations anchor silently. A transition from closed to any nonclosed
state emits a silent opening event; returning to closed plays closing. Intermediate opening,
open and closing states do not emit more sounds. A closing-to-opening reversal
therefore stays within one open excursion. Disappearance is silent; reappearance
anchors again. Invalid or conflicting observations discard the anchor.

This handles the existing snap-open and short-close cases without inventing
animation frames. Reduced-motion leaf choices do not change the audio sequence.
Load, audio unlock/recovery, mute, Effects zero, background and effective pause
clear historical state. Restoring audibility must not replay old transitions.
No simulation, save-format, bridge layout or renderer change is needed.

## Recordings and preparation

Both source files are from rubberduck's
[100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx), CC0 1.0. The page
identifies opening and closing door recordings. The verified archive is
`rubberduck-100-sfx.zip`, SHA-256
`a5c135878c132f1c59cca54e60061c296cd0ac27ad031ca2c41b8cd5cab3c706`.

| Archive entry | Frames at 48 kHz | Seconds | Decoded peak | RMS |
| --- | ---: | ---: | ---: | ---: |
| `door_open.ogg` | 21,698 | 0.452042 | 0.8123093 | 0.1147499 |
| `door_close_02.ogg` | 41,227 | 0.858896 | 0.8985110 | 0.0610266 |

The two chosen decodes contain finite samples below full scale. Closing
candidates 01 and 04 decoded above 1.0 in two samples each and were rejected.
Candidate 03 was shorter but had higher peak and RMS than 02. This is measured
screening, not proof of quiet room tone, pleasant timbre or lack of source distortion.

Originals remain unchanged in `assets/audio/doors/`. The preparation script
`scripts/prepare-door-audio.ps1` uses the existing task-owned Playwright CLI
page at Vite's `/proofs/index.html`. It verifies input hashes, decodes at 48 kHz,
checks duration/channels/sample bounds and exports stereo PCM16 using the shared
encoder from the water preparation module. It applies no trim, normalization,
filtering or dithering and refuses existing output files. `ASSETS.md` records
source and output hashes.

## Playback contract

The current `scripts/build-door-thunk.mjs` derives a 0.32-second, 48 kHz stereo
PCM16 impact from the preserved `close.wav`, with a two-pole 1 kHz low-pass filter
and edge fades. This replaces only the runtime selection, not the source files.

1. Opening must create no audio source or gain node and must not increment the
   opening play count. Keep observing opening state so the later close remains
   correctly anchored.
2. Feed Effects directly, not Voices, at gain 0.05 with short edge fades. Keep
   original playback rate at all game speeds. A single source's un-faded peak
   is below 0.023; four perfectly aligned sources stay below 0.092 before Effects.
3. Preload only the same-origin closing thunk after an audible portal observation
   and a trusted gesture. Cache the successful clip and keep one in-flight load.
   Failed files may recover on new demand after five seconds. Do not queue old
   door events for playback when decoding eventually finishes.
4. Keep at most four active door cues. Release source and gain nodes after
   completion or cancellation. Load, mute, Effects zero and backgrounding stop
   them. Pausing must prevent future door events; short already-started cues may
   finish, matching the existing short-cue policy.
5. Test the scheduler, fixed-tick adapter, one-shot player and controller through
   their public interfaces. Verify actual decoded WAV output and observe an
   in-game doorway before delivery. Record listening limitations separately.

## Verification

The numbered results below document the initial two-recording implementation,
not current closing-only acceptance. Its signal levels and opening counters are
historical. The current offline proof requires zero opening output, exactly one
runtime file request, closing peak below 0.023 per source, and silence from
0.32 seconds onward. Controller regressions assert silent opening through both
portal transitions and direct events, then one closing source. Deleting the
opening guard and restoring the old closing URL must each fail that regression.

1. `npm test -- --maxWorkers=1` in `web/`: PASS, 111 files and 1,535 tests,
   exit 0. `npm run typecheck` and `npm run build`: PASS, exit 0. The real
   WASM regression observes front and interior crossings after memory growth,
   preserves save bytes and anchors silently after load.
2. Twenty-two deliberate runtime mutations each failed a regression, exit 1,
   before restoration. They covered each of four identity coordinates, initial
   anchoring, conflicting observations, reset, far-side projection, source cap,
   buffer validity, node disconnection, playback rate, attack envelope, global
   stop, retry cooldown, in-flight deduplication, HTTP errors, audible demand,
   frame finalization, controller reset, absent-track removal and state validity.
   Two additional byte mutations failed the source/output hash regressions.
   Removing the memory report's positive-track requirement also failed, proving
   that a disabled sampler cannot pass merely by staying within upper bounds.
   Removing each document/node/listener equality and the drained-endpoint guard
   separately failed the added report regressions. All 29 mutations were restored.
3. `proveDoorRecordings()` from `web/proofs/door-recordings.js` passed eight
   browser offline-render cases. Opening peaked at 0.0406171, closing at
   0.0449249 and four aligned closes at 0.1796997, with Effects 100%, Voices 0%
   and game speed 3x. All output ended before one second. Load, mute, Effects
   zero and backgrounding stopped output after the boundary. Pause allowed the
   existing short cue to finish. Every case released all door sources.
4. Inspected the production game at 1280x720, Day 1, 00:01 through 05:41.
   The kitchen doorway appeared open during movement and closed later. Runtime
   counters recorded five openings and six closings, four tracked portals and
   capacity four. Initial anchoring and asynchronous loading can omit the first
   opening; this is not a paired-event count assertion. Pause cleared live
   tracks to zero while retaining capacity four and stopped the shower loop.
   Resume continued gameplay. No browser warning or error was observed. A
   later bounded CDP polling request timed out, so it adds no further evidence.
   The task-owned page closed in a finally block.
5. The final build also clears obsolete hidden low/critical need labels when
   nothing with needs is selected. Two regression cases failed before the
   cleanup and passed afterward, including reselecting changed need values.
   At Day 1, 02:07, visual review confirmed the empty dock, seven empty warning
   spans and Bill's restored needs after roster selection. No browser warnings
   or errors were reported; the second task-owned page closed in a finally block.
6. `node scripts/audio-browser-proof.cjs memory --url http://127.0.0.1:5201/
   --output .tmp/door-memory-verified.json`: PASS, exit 0. Three alternating
   enabled/disabled pairs each measured 540 ticks after 60 warm-up ticks.
   Audio-specific retained JavaScript growth was 46,428, 82,292 and 59,356 bytes;
   median 59,356 stayed within the predeclared 65,536-byte allowance. Structural
   checks passed with 1,425 nodes and 157 listeners at every paused endpoint.
   Enabled runs observed four portals, retained capacity four and no more than
   four door sources. Disabled runs retained zero door tracks/capacity/sources.
   Every audio player drained at both endpoints. Broader page-memory measurement
   was unavailable; WASM grew in both controls and is not attributed to audio.

The first two memory reports failed structural comparisons despite passing
their retained-heap allowance. The first compared changing moodlet/action rows
and counted still-playing door listeners. The second exposed one bounded hidden
need-warning text node, confirmed by a fresh-context tree comparison. The final
harness compares equivalent empty panels and drained players; it keeps exact
DOM/document/listener equality. It does not suppress or subtract node growth.
Both task-owned preview servers were stopped after verification.

The browser signal checks prove output, levels, timing and lifecycle behavior.
They do not establish speaker playback quality or the owner's listening
approval. Visual observation does not claim a watched complete sleep or
conversation cycle. Full remote mutation testing is separate from these local
targeted mutations.
