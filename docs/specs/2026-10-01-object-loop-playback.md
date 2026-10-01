# Source-owned object recordings

## Scope and acceptance boundary

This slice connects the existing shower and stove sound state to a bounded
recording player. It does not select or ship a recording. The production clip
catalog remains empty until the CC0 intake, editing, and listening review are
complete. No placeholder oscillator, automatic download, or new dependency is
introduced. The audible household mix is unchanged with an empty catalog.

The owner requested autonomous sound improvements and approved routine selection
work. That does not turn a decoded waveform into an acoustically accepted asset.
See [the intake report](2026-09-30-cc0-audio-intake-results.md) for candidate
provenance and the remaining listening work.

## Playback contract

1. Rust remains authoritative for a placed object's source ID and sound action.
   The existing fixed-tick scheduler collapses duplicate users of one object,
   rejects conflicting actions, and emits a stop before changing actions.
2. A prepared clip supplies a decoded buffer, gain, and loop start/end times.
   Invalid duration, gain, or bounds produce no nodes. The player does not
   infer a shower from a filename or repair an unedited loop seam.
3. Each placed source owns its recording. Stopping it cannot stop another
   object, and a stale stop for an earlier action cannot stop its replacement.
4. Native buffer looping runs at normal recording speed. Fast-forward changes
   simulation duration, not the pitch of flowing water or cooking.
5. At most four loops are active, with at most eight records retained including
   still-audible release fades. Existing admitted sources keep their place. A
   still-active source rejected at capacity can start after capacity returns.
6. Short attack and release ramps avoid abrupt edges. A stop during attack
   preserves the current envelope before fading. Nodes remain connected until
   that fade has rendered, then disconnect. Global silence may reclaim them
   immediately, including when the audio clock is suspended.
7. Object recordings feed Effects directly, bypassing Voices. Master mute,
   Effects zero, hidden tabs, Load, and audio-context recovery clear pending
   source state as well as live playback. A late clip installation cannot revive
   an ended or cleared source.
8. Every effective pause, including Help, Build, and other blocking overlays,
   stops object loops. Resume waits for a new fixed-tick observation. Existing
   short cues and conversations retain their finish-on-pause behavior.
9. Desired source state is bounded by observed live objects, not the four-voice
   admission limit. Missing sources leave it at the next fixed tick. Audio
   node counts have their separate hard limits.

## Verification

The implementation must pass source ownership, capacity, lifecycle, partial
construction, and effective-pause tests. Browser signal proof lives in
`web/proofs/object-loops.js`; with Vite serving `web/`, open `/proofs/index.html`
and run `proveObjectLoops()` and `proveObjectLoopController()` from that module.
The fixtures use constant decoded buffers so output samples expose the real
gain envelope. This proof is silent and is not a listening review.

The first real browser run passed ten player checks and eleven controller
checks. An early stop at 8 ms retained its attack trajectory; a stop at 128 ms
faded the sustained source without changing the other object's level. The other
recording continued past its 100 ms buffer length, proving native repetition.
Controller output was 0.14 for a 0.2 clip through Effects at 70%, even with
Voices at zero and duplicate observations of the source. Load, mute, Effects
zero, backgrounding, and pause each produced silence by 250 ms and could not
be undone by late installation. An action that ended before installation also
remained silent.

### Final local checks

1. `npm run typecheck`: PASS, exit 0.
2. `npm test -- --maxWorkers=1`: PASS, 1,430 tests in 102 files, exit 0.
3. `npm run build`: PASS, exit 0.
4. `node --check scripts/audio-browser-proof.cjs` and
   `node --check web/proofs/object-loops.js`: PASS, exit 0.
5. `python check-doc-ids.py` and `git diff --check`: PASS, exit 0.
6. The final restored browser proof: PASS, ten player checks and eleven
   controller checks. The isolated page and test servers were closed afterward.

Rust, content, generated WASM, and atlas inputs did not change in this slice.
Their prior passing checks were not repeated. The full retained-memory and
120 Hz performance runs were not rerun; the harness now includes active and
retained object-loop counts, but this is not evidence of measured performance
with accepted recordings installed.

### Mutations and restoration

Six targeted code mutations each failed tests with exit 1:

1. Removing action matching from stop ended a replacement action.
2. Raising the retained limit from eight to eighty admitted a ninth record.
3. Disabling native looping violated the authored playback configuration.
4. Removing end-frame reconciliation left an eligible fifth source silent.
5. Removing global desired-state clearing revived sources across five boundaries.
6. Removing the effective-pause adapter's audio call left a loop active.

A seventh mutation set the stop envelope's anchor to zero. The real Chromium
render failed at 8 ms: expected summed amplitude 0.12, rendered 0.04. Restoring
the source restored all 21 signal checks.

One narrower mutation survived: removing only the conditional attack ramp
before the same-time `setValueAtTime(level, now)` did not change this Chromium
render. It is explicitly not counted as killed. This result does not establish
equivalence across browser audio implementations.

Exact restored SHA-256 values:

1. `web/src/audio/object-loops.ts`:
   `f377a487115e7e50880b28a94720a33bdef9cdee999925560ff8dc7a45459cfb`
2. `web/src/audio/audio-controller.ts`:
   `b49512dcc2f30d1d7869a8fd066a5dde0b8d4a87aac81aeae7126740db6718ef`
3. `web/src/audio/frame-audio.ts`:
   `bc20dd53cd7539456b65321b037ba0892de1c2b761a6617b1d1d6a52e6704345`

Independent read-only review approved the restored implementation. Its wording
correction distinguishes four active loops from up to eight retained records
whose release tails can still be audible.

### Production inspection

The built game loaded and rendered the household, including the existing local
sleep-check save. Help opened and closed; Build showed the paused state and
kept its clock at Day 2, 08:11 until exit. No objects or saved data were edited.
The household, night/day lighting, activity markers, and compact controls were
visually inspected. This sound change does not approve or alter their artwork.

[Build pause evidence](../assets/review-evidence/audio-object-loop-build-pause.jpg)

A separate fresh diagnostic game reported 37 entities and zero active/retained
object loops with the empty catalog. Its only console error was the existing
missing favicon. The in-app production check reported no console errors.
All task-owned browser tabs and both local preview servers were closed.
