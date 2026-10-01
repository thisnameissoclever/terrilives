import { AudioController } from '../src/audio/audio-controller.ts';

const SAMPLE_RATE = 48_000;
const VOICE = { owner: 4, endLow: 80, endHigh: 0, first: 0, second: 1 };

// Exercises the controller's real graph against silent, rendered browser audio.
async function render({ voicesLevel, effectsLevel = 0.7, muted = false, cue = false, changes = [] }) {
  const offline = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
  const clip = offline.createBuffer(1, SAMPLE_RATE, SAMPLE_RATE);
  const data = clip.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = index / SAMPLE_RATE;
  const context = {
    get currentTime() { return offline.currentTime; },
    get state() { return 'running'; },
    destination: offline.destination,
    createGain: () => offline.createGain(),
    createOscillator: () => offline.createOscillator(),
    createBufferSource: () => offline.createBufferSource(),
    decodeAudioData: async () => clip,
    resume: async () => {},
    suspend: async () => {},
    close: async () => {},
  };
  const controller = new AudioController(() => context, {
    getItem: () => JSON.stringify({ version: 1, muted, effectsLevel, voicesLevel }),
    setItem: () => {},
  });
  await controller.unlockFromGesture();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new ArrayBuffer(16));
    await controller.loadVoiceLibrary(['proof-a', 'proof-b']);
  } finally {
    globalThis.fetch = originalFetch;
  }
  controller.emit(cue ? { type: 'command.rejected' } : { type: 'sim.conversation-started', simId: 4, voice: VOICE });
  const suspended = changes.map(([at, level]) => ({ waiting: offline.suspend(at), level }));
  const rendering = offline.startRendering();
  for (const change of suspended) {
    await change.waiting;
    controller.previewVoicesLevel(change.level);
    await offline.resume();
  }
  const samples = (await rendering).getChannelData(0);
  controller.reset('load');
  return samples;
}

function near(actual, expected, label) {
  if (Math.abs(actual - expected) > 0.00002) {
    throw new Error(`${label}: expected ${expected}, rendered ${actual}`);
  }
  return { label, expected, actual };
}

function rms(samples) {
  let energy = 0;
  for (let index = 0; index < 4_800; index += 1) energy += samples[index] ** 2;
  return Math.sqrt(energy / 4_800);
}

export async function proveVoiceVolume() {
  const checks = [];
  const cueLevels = [];
  for (const [voicesLevel, expected] of [[1, 0.0784], [0.25, 0.0196], [0, 0]]) {
    const samples = await render({ voicesLevel });
    checks.push(near(samples[24_000], expected, `Voices ${voicesLevel} at 0.5s`));
    cueLevels.push(rms(await render({ voicesLevel, cue: true })));
  }
  if (cueLevels[0] < 0.001) throw new Error('Procedural baseline is silent');
  checks.push(near(cueLevels[1], cueLevels[0], 'Procedural cue bypasses quarter Voices'));
  checks.push(near(cueLevels[2], cueLevels[0], 'Procedural cue bypasses zero Voices'));
  for (const options of [{ effectsLevel: 0 }, { muted: true }]) {
    for (const cue of [false, true]) {
      const samples = await render({ voicesLevel: 1, cue, ...options });
      checks.push(near(Math.max(...samples.map(Math.abs)), 0, `${JSON.stringify(options)} cue=${cue}`));
    }
  }
  const resumed = await render({ voicesLevel: 1, changes: [[0.25, 0], [0.5, 0.5]] });
  checks.push(near(resumed[9_600], 0.03136, 'Before voice silence'));
  checks.push(near(resumed[19_200], 0, 'During voice silence'));
  checks.push(near(resumed[36_000], 0.0588, 'Voice resumes at current position'));
  return { checks, cueLevels };
}
