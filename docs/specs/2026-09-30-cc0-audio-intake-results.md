# First household sound intake

The owner approved the four shortlisted packs and asked for routine decisions
to proceed without repeated questions. The guarded fetch completed at
2026-10-01 04:39 UTC (2026-09-30 locally). No pack or excerpt is shipped yet.

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

Assess these candidates for bathroom water and cooking before editing or
integrating them. A filename containing "water" does not establish shower
character, and boiling is not interchangeable with every stove action. Inspect
door and kitchen one-shots from the first two packs separately. Preserve original
files, record edits and exact source entries in `ASSETS.md` for any selected
runtime clip, and test playback against authoritative source-object state.

The intake browser and loopback server were closed after the measurements.
