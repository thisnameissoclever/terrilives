# Voices volume verification

The owner approved a saved Voices control and the four-pack sound intake. This
change implements that control without changing the default mix. Effects still
governs all audio. Voices multiplies recorded conversations only and defaults
to 100%. Old version-1 preferences retain their mute and Effects settings.

## Local checks

All commands below exited 0 on the implementation based on `9fe41f2f`.

1. `npx vitest run tests/audio-controller.test.ts tests/audio-controls.test.ts tests/options-menu.test.ts tests/voice-clips.test.ts --maxWorkers=1`
   from `web/`: 150 tests passed across four files.
2. `npm run typecheck` from `web/`: passed.
3. `npm test -- --maxWorkers=1` from `web/`: 1,396 tests passed across 101 files.
4. `npm run build` from `web/`: production build passed.
5. `cargo fmt --check`: passed.
6. `cargo test --workspace --quiet`: 1,215 tests passed.
7. `cargo clippy --workspace --all-targets -- -D warnings`: passed.
8. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`:
   release build and optimization passed before the web build.
9. `python -B -m unittest discover -s <suite> -p 'test_*.py'` for
   `.github/scripts`, `assets/sprites/gen`, and `assets/models/{sims/sim-01,furniture,kitchen,bathroom,bedroom,office,living}`:
   all nine suites passed. Existing Pillow deprecation warnings remain.
10. `python assets/sprites/gen/build.py --check`: atlas current, 1,370 sprites.
11. `python check-doc-ids.py` and `git diff --check`: passed.

## Audio graph proof

With Vite serving `web/`, open `/proofs/index.html` in Chromium and evaluate:

```javascript
await (await import('/proofs/voice-volume.js')).proveVoiceVolume()
```

All 12 checks passed using the real controller graph and `OfflineAudioContext`.
Only clip input and decoding were substituted with a known ramp. No audio was
sent to speakers by this proof.

1. At 0.5 seconds, Voices 100%, 25%, and 0% produced amplitudes 0.0784,
   0.0196, and 0 respectively.
2. Procedural cue RMS stayed 0.0155111149 at all three Voices settings.
3. Effects zero and master mute each silenced both recordings and cues.
4. Lowering Voices to zero, then restoring it, resumed the current transport
   position, not the start of the recording.

These are signal and lifecycle checks, not subjective listening acceptance.

## Mutation and independent review

Five deliberate mutations each failed the relevant tests: bypassing the Voices
bus, forcing the saved level to 100%, resetting schedulers on preview, persisting
preview changes, and omitting failed-construction gain cleanup. Exact source
files were restored before the passing checks above.

Restored SHA-256 values:

1. `web/src/audio/audio-controller.ts`:
   `08c0672283b7281e9664715144cf38455f4093ebb8fca76c31a4afb193e51395`
2. `web/src/ui/audio-controls.ts`:
   `6cfd6e8be532bdb07424298a6195fe7c0f3f5feefe2f2eb4011c410e399aab95`

A separate read-only reviewer found no blocking code issues. Its documentation
correction, that Effects controls all sound rather than just cues and footsteps,
was applied. Its remaining rendered-control check is recorded below.

## Rendered controls

The task-owned local game used freshly built WASM. Keyboard Home followed by two
Right presses changed Voices from 100% to 10%, leaving Effects at 70%. Reloading
retained both values. The slider exposed `aria-valuetext="10%"` and a 44-pixel
height. Help correctly described Sound, Effects, and Voices.

Desktop and 390 by 844 mobile screenshots were inspected. Both controls fit the
Options panel without clipping. The rendered household remained intact; this
check does not approve unrelated artwork. No browser errors were reported.

1. [Desktop evidence](../assets/review-evidence/audio-voices-desktop.jpg)
2. [Mobile evidence](../assets/review-evidence/audio-voices-mobile.jpg)

Task-owned game and proof tabs were closed, the viewport override was reset,
and the local preview server was stopped. No user-owned game tab was changed.

## Separate intake status

[The intake report](2026-09-30-cc0-audio-intake-results.md) records the four
downloaded packs, source hashes, inventory, and five mechanically screened water
recordings. None of those recordings is shipped by this change. Selection,
listening, and event-specific integration remain separate work.
