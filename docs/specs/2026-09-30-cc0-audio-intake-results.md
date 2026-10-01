# First household sound intake

The owner approved the four shortlisted packs and asked for routine decisions
to proceed without repeated questions. The guarded fetch completed at
2026-10-01 04:39 UTC (2026-09-30 locally). A later slice selected and edited
`water_flowing.ogg` as a provisional shower loop; see
`2026-10-01-shower-water-recording.md`. The measurements below describe the
unaltered intake, not listening approval or the edited runtime file.

## Provenance and inventory

All four source pages still name the expected author and declare CC0. Archive
SHA-256 values were independently recomputed after download and matched the
fetch manifest. Inventory found 432 audio files, totalling 34,133,411 bytes
uncompressed, in 443 ZIP entries. Downloads total 23,753,884 bytes.

| Pack | Source and author | Audio files | Download bytes | Archive SHA-256 |
| --- | --- | ---: | ---: | --- |
| `owlish-202-more-sfx` | [202 More Sound Effects](https://opengameart.org/content/202-more-sound-effects), OwlishMedia | 202 | 14,937,403 | `9428c1437137d9ea06ba94e13da12488d4c57990a1c32d83db9e7707e69fb3af` |
| `rubberduck-100-sfx` | [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx), rubberduck | 100 | 2,921,904 | `a5c135878c132f1c59cca54e60061c296cd0ac27ad031ca2c41b8cd5cab3c706` |
| `rubberduck-100-sfx-2` | [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2), rubberduck | 100 | 2,367,871 | `0fc61b4494e2e893c0c015ced4877b3f689c7d84a48cb61daecd7ddb52db797b` |
| `rubberduck-30-sfx-loops` | [30 CC0 SFX loops](https://opengameart.org/content/30-cc0-sfx-loops), rubberduck | 30 | 3,526,706 | `9c013474c7e56192a0d1b2840535a1e1d8b93166948d4a9f7136bb6c3d5421cd` |

The local intake directory is
`C:/Users/myema/AppData/Local/Temp/terrilives-cc0-audio-intake-51a73f4d-0049-4895-8449-5c075ba449c1`.
It contains four original archives, `intake-manifest.json`, and an `audition/`
directory with five unmodified excerpts. This is temporary storage, not a
durable asset library. If it is cleared, use the approved fetch procedure and
compare new hashes before relying on this report. Do not download again while
the verified originals remain available.

## Mechanical screening, not listening acceptance

Five explicitly named entries were extracted without overwriting files. Every
resolved target was checked to remain directly inside `audition/`. Chromium
decoded each OGG file through `OfflineAudioContext` at 48 kHz. All decoded as
stereo, all samples were finite, and none reached absolute amplitude 1. Values
below are measurements of the decoded, resampled data, not the original codec's
sample rate. RMS is the root mean square amplitude across both channels; it
describes average signal level, not perceived loudness.

| Entry | Pack | Seconds | Peak amplitude | RMS amplitude | Endpoint jump |
| --- | --- | ---: | ---: | ---: | ---: |
| `sfx100v2_loop_water_01.ogg` | `rubberduck-100-sfx-2` | 6.3672 | 0.23604 | 0.04674 | 0.01593 |
| `sfx100v2_loop_water_02.ogg` | `rubberduck-100-sfx-2` | 8.7336 | 0.17507 | 0.02618 | 0.03043 |
| `sfx100v2_loop_water_03.ogg` | `rubberduck-100-sfx-2` | 9.7069 | 0.41176 | 0.03621 | 0.01856 |
| `water_boiling.ogg` | `rubberduck-30-sfx-loops` | 4.4918 | 0.16987 | 0.01560 | 0.02543 |
| `water_flowing.ogg` | `rubberduck-30-sfx-loops` | 1.8832 | 0.06418 | 0.01399 | 0.00227 |

Endpoint jump is the larger channel's absolute difference between its first and
last sample. It flags seams for inspection; it neither proves an audible click
nor establishes a seamless loop. Peak headroom does not rule out distortion
already present in a source recording. Listening for voices, music, room noise,
unexplained impacts and suitability remains necessary. No acoustic judgment is
claimed from these measurements.

Entry SHA-256 values:

1. `sfx100v2_loop_water_01.ogg`: `955a367cf87f150f7868e2ecf5745ef13cec2c78a29304eda27e74f1fea06c57`
2. `sfx100v2_loop_water_02.ogg`: `32bc3462ebd2376d9b84e8f602969f8c2a475f589adee9804207e19116cda768`
3. `sfx100v2_loop_water_03.ogg`: `33b123860425a34ce8de43cfa075b0b4ffb7a3cf090be5c21213c9b99f3d2fa3`
4. `water_boiling.ogg`: `e75fb982ec50cca628ba18845e81211e12ed4cdc5080609d55ee2d60873320af`
5. `water_flowing.ogg`: `1a431f77d61661becdc87a5b1832d47f83a12a5c0b001077e41a202e739797a7`

## Next selection work

The flowing-water candidate now has a bounded provisional shower integration.
Assess the remaining candidates before integrating them. A filename containing "water" does not establish shower
character, and boiling is not interchangeable with every stove action. Inspect
door and kitchen one-shots from the first two packs separately. Preserve original
files, record edits and exact source entries in `ASSETS.md` for any selected
runtime clip, and test playback against authoritative source-object state.

The intake browser and loopback server were closed after the measurements.

## Offline candidate comparison

`scripts/build-audio-audition.cjs` builds a self-contained HTML review from the
five extracted originals. It does not download, trim, normalize, accept, or
install recordings. It verifies the entry hashes above, embeds the original
bytes, refuses existing output files, and requires output outside the repository.
Input entries must resolve directly inside the supplied audition directory.

```powershell
node scripts/build-audio-audition.cjs `
  "<intake-directory>/audition" `
  "$env:TEMP/household-sound-review.html"
```

Use a new output filename if it already exists. Open the generated HTML in a
browser. The review starts silent at 25% volume. Each candidate has an original
one-shot and a 15-second native-buffer repeat, with no seam repair or filtering.
Only one sample plays at a time. Stop all, page exit, and hidden-page events
cancel playback and invalidate pending decoding. Repetition is bounded by the
audio clock, not a JavaScript timer. These are audition controls, not a second
implementation of the game's source-owned recording player.

Decisions and notes remain in the page until downloaded as JSON. Closing or
reloading without downloading loses them. The export includes exact file hashes,
provenance, review volume, and which playback modes finished. Finished playback
does not prove anyone heard the recording. "Keep for editing" does not approve
shipping or replace the in-game mixing check.

The generated local comparison is
`C:/Users/myema/AppData/Local/Temp/terrilives-household-audition-20261001/index.html`.
It contains no saved judgments. The separate `automated-export-check.json` in
that directory is a test fixture explicitly labeled as such, not owner feedback.
No candidate has passed listening review in this run.

### Cooking semantics

The only current `stove_cooking` authoring site is the `Cook` step in
`content/chains.toml`, using the `hob` station to turn ingredients into dinner.
There is no authored boiling, frying, or baking distinction. The stove has no
standalone interaction. `water_boiling.ogg` remains a boiling-water candidate,
not a proven match for every cooking action. No new sound category is needed to
audition it; choosing a runtime match still requires deliberate content and
listening judgment.

### Comparison checks

1. Real Chromium decoded and started all five candidates. Switching recordings
   retained at most one started source. The repeat ended after 15,012 ms, and
   natural completion released its source.
2. With browser networking disabled after document load, an original completed
   and JSON export retained all five entries, the exact hash, typed notes,
   decision, and separate original/repeat completion flags.
3. An injected hidden-page event stopped playback. A delayed real decode
   completed after Stop all without reviving playback.
4. Native background behavior remains unverified: both headless Chromium and
   the in-app browser reported the audition page as visible after opening a
   second tab. This is not evidence of a successful native visibility test.
5. The page was visually inspected. These controls and signal tests provide no
   judgment of timbre, unwanted room sounds, loop quality, or the in-game mix.

Final local commands passed: `npm run typecheck`,
`npm test -- --maxWorkers=1` (1,434 tests in 103 files), `npm run build`,
`node --check scripts/build-audio-audition.cjs`, `python check-doc-ids.py`, and
`git diff --check`. Commands exited 0. The new four-test file passed again
after mutation restoration. No runtime source, dependency, Rust, WASM, or asset
inputs changed; native tests and the game performance sweep were not rerun.

Three deliberate generator mutations each made the focused suite exit 1:

1. Disable the SHA-256 guard: `rejects changed candidate bytes before publishing
   a review` failed with `expected [Function] to throw an error`.
2. Disable the repository-output guard: the rejection assertion failed with
   `expected [Function] to throw an error`.
3. Change exclusive `wx` publication to `w`: the existing-output assertion failed
   with `expected [Function] to throw an error`.

All three were restored. The generator SHA-256 before and after mutation was
`1D4788AC0F526421A51605F3CE90B1EFB5055F68F3A57B5120E393B90C92D2C2`.
Independent review found an unsafe fixed-path test cleanup, corrected before
delivery and documented in lesson L-test-cleanup-needs-owned-paths. The follow-up
review confirmed the correction. Test pages and the loopback server were closed;
the self-contained HTML remains available without that server.

PR 165's CI and Pages deployment both succeeded. The live game was inspected
at `https://thisnameissoclever.github.io/terrilives/`: its saved household loaded,
the isometric scene and controls rendered, and application logs had no warnings
or errors. No save, reset, object placement, or preference change was made during
that inspection, and the task-owned game tab was closed.
