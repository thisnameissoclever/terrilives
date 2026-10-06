# Cat purr, kept for pets

`cat-purr-candidate.wav` is an unused sound kept on purpose for the future pets work, `[S-pets]` in [GAME-SYSTEMS.md](../../../../docs/GAME-SYSTEMS.md). Do not delete it as an unreferenced asset. Nothing in the game loads it yet. The test `web/tests/future-audio-assets.test.js` fails if the file is removed or changed; update its hash there when you regenerate the sound.

The owner chose it on 2026-10-06. It started as a rejected prototype for a human snore, and the owner heard it as a cat purring and asked to keep it for when pets arrive.

| Property | Value |
| --- | --- |
| File | `cat-purr-candidate.wav`, 1,200,044 bytes |
| SHA-256 | `7025a85b832e12e498a854d9edee454a67531f46c31e7b4ccd6717ecedf4d860` |
| Format | Mono, 16-bit PCM, 48 kHz, 12.5 seconds |
| Content | Four purr cycles, three seconds apart |
| Licence | First-party synthesis; no recorded or third-party source |

Each cycle is a fluttering low rumble of about one second, a short pause, then a softer breath. The rumble is muffled noise below about 380 Hz mixed with a low tone near 80 Hz, both pulsed 26 times a second. Nothing in it is high-pitched, which suits a game left playing in the background.

## Level

The file is 20 dB louder than the default Effects level so it is easy to audition. When pets wire it in, set a runtime gain well below 1, or regenerate it without the boost. Judge the final level by ear at ordinary Effects volume.

## Regenerate or adjust

[`build_cat_purr.py`](build_cat_purr.py) rebuilds the file byte for byte with native Python 3 and no extra packages:

```bash
py -3 -B assets/audio/future/cat-purr/build_cat_purr.py
```

Its constants set the cycle count, spacing and audition boost. A single looping cycle at mix level is likely what the game will want; changing the script changes the file, so update the hash here and in [ASSETS.md](../../../../ASSETS.md) when you do.

## When pets pick this up

1. Copy or regenerate the sound into `web/public/audio/` beside the other runtime recordings, at its runtime level.
2. Register it in the audio catalog and play it from the cat's purring action.
3. Move this entry in ASSETS.md from future assets to the runtime list, and delete this folder only once the runtime copy is the documented source.
