# First shower-water recording

This adds one provisional flowing-water recording to normal shower use. The
owner authorized autonomous sound improvements and routine recording selection.
No accepted cue is replaced. Final timbre and mix acceptance remain unverified:
the agent can measure decoded samples but cannot hear them in this runtime.

## Delivery decision

The previous empty-catalog rule turned a listening checklist into a publication
blocker even for additive work. Fresh-context review recommended delivering one
bounded shower recording under the owner's existing authorization, with the
perceptual limitation stated explicitly. The recording is provisional, not
claimed to be approved by listening. Replacing accepted cues still requires the
existing listening gate. Generic stove cooking stays silent; boiling water is
not a confirmed match for that action.

## Source and edit

The original is rubberduck's `water_flowing.ogg` from
[30 CC0 SFX loops](https://opengameart.org/content/30-cc0-sfx-loops). The author's
page identifies flowing water and declares CC0. Its source is retained unchanged
at `assets/audio/shower-water/water_flowing.ogg`, with SHA-256
`1a431f77d61661becdc87a5b1832d47f83a12a5c0b001077e41a202e739797a7`.
Archive provenance is in `2026-09-30-cc0-audio-intake-results.md`.

Chromium decodes the original at 48 kHz. The offline preparation module blends
the last 4,800 frames into the first 4,800 frames with complementary linear
weights, then keeps the remaining middle section. This shortens the loop by
100 ms and makes the wrap follow two adjacent original samples. It preserves
the channel count and does not normalize or boost samples. The output is signed
16-bit PCM WAV. Continuity does not establish pleasant repetition.

`scripts/prepare-shower-water.ps1` drives this editor through the existing
Playwright CLI and refuses to overwrite output. The browser must already be
serving `web/proofs/index.html` through Vite. The source hash is checked before
processing; runtime output is `web/public/audio/objects/shower-water.wav`.

## Runtime contract

1. Use only authored `shower_water` source identity. Stove actions and ordinary
   controls must not request this asset or produce this recording.
2. Fetch from the same origin only after a playable shower start. No fetch before
   a gesture, while muted, with Effects zero, while hidden, or during effective
   pause. Keep one in-flight load, cache success, and allow a new shower start
   to retry after a five-second failure cooldown. Do not retry from fixed ticks.
3. Install through the existing source-owned player. A late decode may start only
   still-owned sources; end, Load, mute, Effects zero, background, context recovery,
   and pause invalidate old ownership. Manual installed clips remain authoritative.
4. Play the prepared loop at its original rate with clip gain 0.6, then the
   current Effects gain. Voices must not change it. Keep the four-active-loop
   and eight-retained-loop limits, including release fades.
5. Test actual decoded output for repetition, finite samples, bounded combined
   level, and silence after lifecycle boundaries. These are technical checks,
   not claims about acoustic suitability or physical-device listening.

## Verification record

The prepared WAV has 85,594 stereo frames at 48 kHz, 342,420 bytes, SHA-256
`0dcbeceb5338db019627829c0b4227fb6de7232e3881df2aa622a7180476e315`.
Before PCM16 rounding, peak amplitude is 0.0641763 and RMS amplitude is 0.0138910.
The edit preserves the original peak and makes the wrap an ordinary adjacent
source-sample transition. Its endpoint jump is 0.0204603, greater than the
original 0.00226826; a lower endpoint-jump number is not claimed.

1. `npm test` in `web`: PASS, exit 0, 105 files and 1,473 tests. This includes
   the loader, controller ownership/retry cases, offline editor and actual WAV
   hash/header/level checks. `npm run typecheck` and `npm run build`: PASS,
   exit 0. No Rust or dependency change.
2. Fourteen loader/controller mutations each failed assertions with exit 1:
   demand gating, cooldown check, duplicate starts, in-flight deduplication,
   cached/manual clips, manual precedence, global cancellation, ended-source
   cancellation, pause cancellation, shower-only relevance, per-tick retry,
   cooldown assignment, HTTP status, and catalog mapping/gain. Source files
   were restored after each mutation.
3. Four asset/editor mutations also failed assertions with exit 1: removing
   the crossfade, allowing overlap below two frames, reversing stereo channels,
   and changing one byte of the generated WAV. The WAV was restored in `finally`
   and its hash matched the value above. The full passing suite followed restoration.
4. `proveShowerRecording()` from `web/proofs/shower-recording.js` ran in Chromium
   through the task-owned Playwright CLI at Vite's `/proofs/index.html`: PASS
   for all seven cases. One source fetched once, peaked at 0.0385071 and repeated
   with zero measured error. Four sources still fetched once and peaked at
   0.1540283 with Effects 100%, Voices zero. Load, mute, Effects zero,
   background and pause each rendered exact silence from one second onward.
   The context adapter does not establish browser autoplay or speaker output.
5. Actual production game: selected Casey, directed Take a shower, observed
   Using object, authored action 1/source 30, and one active/retained object
   loop. `docs/alpha-feel-notes.md` records the visible standing-beside-shower
   limitation. An attempted semantic Pause locator did not match, so no extra
   in-game pause result is claimed. The task-owned game/proof pages and servers
   were closed afterward.
6. Independent read-only review found no actionable runtime defect and requested
   the additional editor/channel/file-corruption mutation checks above. Acoustic
   suitability, pleasant repetition and owner listening approval remain unverified.

After integrating main `8ea22167` (Sim details), the first integration run exposed
the expected stale local WASM export. Rebuilding with `wasm-pack build
crates/terri-wasm --target web --out-dir ../../web/src/wasm` resolved it. The final
`npm test -- --maxWorkers=1` passed all 1,494 tests in 107 files; typecheck, build,
and documentation ID checks also passed with exit 0. The audio source hashes
remained unchanged from independent review.
