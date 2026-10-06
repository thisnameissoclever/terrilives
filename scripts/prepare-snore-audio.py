"""Cut the sleeping snores from the retained CC0 recording.

Source: "snore.wav" by sirplus, https://freesound.org/people/sirplus/sounds/20545/,
CC0 1.0. The repository keeps Freesound's public high-quality MP3 preview of
it at assets/audio/snore/sirplus-snore-20545-preview.mp3; the original WAV
needs a Freesound account to download.

For each snore window below, the script decodes the preview with FFmpeg,
removes rumble under 40 Hz, rolls off everything above 1.2 kHz so no
high-pitched breath or mouth noise survives, fades the edges, and scales the
clip so its loud part has the same RMS level as every other snore. The game's
runtime gain then sets the mix level. Output is mono 16-bit PCM at 48 kHz in
web/public/audio/sleep/.

Requires native Python 3 with numpy, and ffmpeg on PATH. Check with:
    ffmpeg -version
    py -3 -c "import numpy"
Run from the repository root:
    py -3 -B scripts/prepare-snore-audio.py
FFmpeg's MP3 decoder can differ slightly between versions, so a rerun may not
be byte-identical; web/tests/snore-audio-assets.test.js pins the committed
files' hashes and must be updated with any regenerated output.
"""
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/audio/snore/sirplus-snore-20545-preview.mp3"
OUTPUT_DIR = ROOT / "web/public/audio/sleep"
RATE = 48000
# (start seconds, end seconds) of each snore and its exhale in the source.
WINDOWS = [(1.9, 6.0), (7.6, 11.8), (14.6, 19.0), (20.2, 25.4), (25.9, 29.6)]
TARGET_ACTIVE_RMS = 0.1
FADE_IN_SECONDS = 0.05
FADE_OUT_SECONDS = 0.4


def decode(start, end):
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise SystemExit("ffmpeg is not on PATH")
    duration = end - start
    filters = ",".join([
        "highpass=f=40",
        "lowpass=f=1200:poles=2",
        "lowpass=f=1200:poles=2",
        f"afade=t=in:d={FADE_IN_SECONDS}",
        f"afade=t=out:st={duration - FADE_OUT_SECONDS:.3f}:d={FADE_OUT_SECONDS}",
    ])
    raw = subprocess.run(
        [ffmpeg, "-v", "error", "-ss", f"{start}", "-t", f"{duration}", "-i", str(SOURCE),
         "-af", filters, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
        check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def active_rms(samples):
    """RMS of the 50 ms frames within 20 dB of the loudest: the snore itself."""
    hop = RATE // 20
    frames = np.array([np.sqrt(np.mean(samples[i:i + hop] ** 2)) for i in range(0, len(samples) - hop, hop)])
    loud = frames[frames > frames.max() * 0.1]
    return float(np.sqrt(np.mean(loud ** 2)))


def write(path, samples):
    pcm = np.clip(np.round(samples * 32767), -32767, 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(pcm.tobytes())


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for index, (start, end) in enumerate(WINDOWS, start=1):
        samples = decode(start, end)
        samples *= TARGET_ACTIVE_RMS / active_rms(samples)
        peak = float(np.abs(samples).max())
        if peak >= 1:
            raise SystemExit(f"snore {index} would clip at peak {peak:.3f}")
        path = OUTPUT_DIR / f"snore-{index}.wav"
        write(path, samples)
        print(f"{path.relative_to(ROOT)}  {len(samples) / RATE:.2f} s  peak {peak:.3f}")


if __name__ == "__main__":
    main()
