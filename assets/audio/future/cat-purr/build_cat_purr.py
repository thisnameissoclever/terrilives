"""Regenerate the unused cat-purr candidate kept for the future pets work.

The sound began as a rejected human-snore prototype on 2026-10-06. The owner
heard it as a cat purring and asked to keep it for pets. It is first-party:
seeded noise and a band-limited triangle wave, with no recorded source.

One purr cycle is a 0.95 s "inhale" of low-passed noise (380 Hz cutoff) mixed
with an 85 to 75 Hz triangle, both amplitude-modulated by a 26 Hz flutter;
then 0.3 s of silence; then a 0.8 s softer "exhale" of noise low-passed at
260 Hz. The file holds four cycles three seconds apart. Levels match what
the owner heard: the default Effects level of 0.7, raised 20 dB for audition.
Lower it to the intended mix level when the pets work wires it in.

Run with native Python 3 from the repository root:
    py -3 -B assets/audio/future/cat-purr/build_cat_purr.py
The output is byte-identical to the committed cat-purr-candidate.wav, because
the noise comes from Python's seeded generator; ASSETS.md records its hash.
"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 48000
SEED = 7
CYCLES = 4
CYCLE_SPACING_SECONDS = 3.0
EFFECTS_LEVEL = 0.7
AUDITION_BOOST = 10  # +20 dB
OUTPUT = Path(__file__).with_name("cat-purr-candidate.wav")


def triangle(start_hz, end_hz, seconds):
    count, out, phase = int(seconds * RATE), [], 0.0
    for i in range(count):
        hz = start_hz + (end_hz - start_hz) * i / count
        phase += 2 * math.pi * hz / RATE
        value, harmonic = 0.0, 1
        while harmonic * hz < RATE / 2 and harmonic < 40:
            value += ((-1) ** ((harmonic - 1) // 2)) * math.sin(harmonic * phase) / (harmonic * harmonic)
            harmonic += 2
        out.append(value * 8 / math.pi ** 2)
    return out


def lowpass_noise(rng, seconds, cutoff_hz, q=0.9):
    w = 2 * math.pi * cutoff_hz / RATE
    alpha = math.sin(w) / (2 * q)
    c = math.cos(w)
    b0 = (1 - c) / 2
    b1 = 1 - c
    b2 = b0
    a0 = 1 + alpha
    a1 = -2 * c
    a2 = 1 - alpha
    x1 = x2 = y1 = y2 = 0.0
    out = []
    for _ in range(int(seconds * RATE)):
        x = rng.uniform(-1, 1)
        y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1, y2, y1 = x1, x, y1, y
        out.append(y)
    peak = max(abs(v) for v in out) or 1
    return [v / peak for v in out]


def envelope(count, attack, release):
    seconds = count / RATE
    return [min(1.0, (i / RATE) / attack) * min(1.0, (seconds - i / RATE) / release) for i in range(count)]


def flutter(count, hz, depth):
    out = []
    for i in range(count):
        position = (i / RATE * hz) % 1.0
        out.append(1 - depth * (1 - (1 - abs(2 * position - 1))))
    return out


def scaled(signal, *gains):
    return [s * math.prod(g[i] for g in gains) for i, s in enumerate(signal)]


def purr_cycle(rng):
    count = int(0.95 * RATE)
    air = lowpass_noise(rng, 0.95, 380)
    tone = triangle(85, 75, 0.95)
    inhale = [a * 0.6 + t * 0.5 for a, t in zip(air, tone)]
    inhale = scaled(inhale, envelope(count, 0.3, 0.2), flutter(count, 26, 0.8))
    exhale = lowpass_noise(rng, 0.8, 260)
    exhale = scaled(exhale, envelope(len(exhale), 0.2, 0.5))
    return [v * 0.008 for v in inhale] + [0.0] * int(0.3 * RATE) + [v * 0.003 for v in exhale]


def main():
    rng = random.Random(SEED)
    total = [0.0] * int((CYCLE_SPACING_SECONDS * CYCLES + 0.5) * RATE)
    for cycle in range(CYCLES):
        start = int(cycle * CYCLE_SPACING_SECONDS * RATE)
        for i, sample in enumerate(purr_cycle(rng)):
            total[start + i] += sample * EFFECTS_LEVEL * AUDITION_BOOST
    with wave.open(str(OUTPUT), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in total))
    print(OUTPUT)


if __name__ == "__main__":
    main()
