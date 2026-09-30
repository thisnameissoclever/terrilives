import { VoiceClipPlayer } from '../src/audio/voice-clips.ts';

// Runs silently in the browser's real audio renderer. A constant-one buffer
// makes the output samples equal the gain envelope, without mocking AudioParam.
export async function proveVoiceFades() {
  const sampleRate = 48_000;
  const cases = [
    ['start', 0],
    ['attack', 0.008],
    ['plateau', 0.5],
    ['second clip', 3],
    ['natural release', 5.596],
    ['natural end', 5.6],
    ['after end', 5.8],
    ['short pair', 0.004, [0.004, 0.004], 0.149333333333],
    ['attack-length pair', 0.004, [0.006, 0.006], 0.199111111111],
    ['short release pair', 0.008, [0.01, 0.01], 0.1792],
  ];
  const results = [];
  for (const [name, requestedStop, durations = [2.5, 3.1], fixedExpected] of cases) {
    const context = new OfflineAudioContext(1, sampleRate * 6, sampleRate);
    const clips = durations.map((seconds) => {
      const buffer = context.createBuffer(1, seconds * sampleRate, sampleRate);
      buffer.getChannelData(0).fill(1);
      return buffer;
    });
    const player = new VoiceClipPlayer(context, context.destination);
    player.setClips(clips);
    if (!player.play(0, 1)) throw new Error(`${name}: conversation did not start`);
    const suspended = context.suspend(requestedStop);
    const rendering = context.startRendering();
    await suspended;
    const stoppedAt = context.currentTime;
    player.stopAll();
    await context.resume();
    const samples = (await rendering).getChannelData(0);
    const stopSample = Math.round(stoppedAt * sampleRate);
    const before = stopSample === 0 ? 0 : samples[stopSample - 1];
    const atStop = samples[stopSample];
    const halfway = samples[stopSample + 288];
    const after = samples[stopSample + 577];
    const expectedGain = fixedExpected ?? 0.224 * Math.max(0, Math.min(1, stoppedAt / 0.012, (5.6 - stoppedAt) / 0.012));
    const tolerance = fixedExpected === undefined ? 0.0005 : 0.0012;
    const jump = Math.abs(atStop - before);
    const result = { name, stoppedAt, before, atStop, halfway, after, jump };
    results.push(result);
    if (jump > tolerance || Math.abs(atStop - expectedGain) > 0.0005) {
      throw new Error(`Interrupted envelope jumped: ${JSON.stringify(result)}`);
    }
    const remaining = Math.max(0, Math.min(0.012, durations[0] + durations[1] - stoppedAt));
    const expectedHalfway = remaining > 0 ? expectedGain * Math.max(0, 1 - 0.006 / remaining) : 0;
    if (Math.abs(halfway - expectedHalfway) > 0.0003) {
      throw new Error(`Interrupted envelope did not fade: ${JSON.stringify(result)}`);
    }
    if (Math.abs(after) > 0.00001) {
      throw new Error(`Interrupted envelope did not stop: ${JSON.stringify(result)}`);
    }
    for (let sample = stopSample + 1; sample <= stopSample + 577; sample += 1) {
      if (Math.abs(samples[sample] - samples[sample - 1]) > tolerance) {
        throw new Error(`Fade or natural end jumped: ${name}, sample ${sample}`);
      }
    }
  }
  return results;
}
