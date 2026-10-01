import { AudioController } from '../src/audio/audio-controller.ts';

const RATE = 48000;
async function render({ambience = 1, voices = 1, effects = 0.7, muted = false, boundary = null}) {
  const offline = new OfflineAudioContext(1, RATE, RATE);
  let clockOwnsState = false;
  let interrupted;
  const interruption = new Promise(resolve => { interrupted = resolve; });
  const context = {
    get currentTime() { return offline.currentTime; },
    get state() { return clockOwnsState ? offline.state : 'running'; },
    onstatechange: null,
    destination: offline.destination, createGain: () => offline.createGain(),
    createOscillator: () => offline.createOscillator(), createBufferSource: () => offline.createBufferSource(),
    decodeAudioData: bytes => offline.decodeAudioData(bytes), resume: async () => {}, suspend: async () => {}, close: async () => {},
  };
  offline.onstatechange = event => {
    if (!clockOwnsState) return;
    context.onstatechange?.(event);
    if (offline.state === 'suspended') interrupted();
  };
  // Scheduling begins before native offline rendering, whose initial state is suspended.
  const controller = new AudioController(() => context, {
    getItem: () => JSON.stringify({version: 1, muted, effectsLevel: effects, voicesLevel: voices, ambienceLevel: ambience}),
    setItem: () => {},
  });
  await controller.unlockFromGesture();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = url => originalFetch(url === 'audio/ambience/indoor-air.wav'
      ? new URL('../audio/ambience/indoor-air.wav', window.location.href) : url);
    controller.observeRunningWorld(); await controller.loadAmbience();
  } finally { globalThis.fetch = originalFetch; }
  const counts = {active: controller.activeAmbienceCount(), retained: controller.retainedAmbienceCount(), starts: controller.ambienceStartCount()};
  const waiting = boundary ? offline.suspend(0.25) : null;
  if (boundary === 'suspended') clockOwnsState = true;
  const rendering = offline.startRendering();
  if (waiting) {
    await waiting;
    if (boundary === 'pause') controller.setObjectSoundsPaused(true);
    if (boundary === 'suspended') {
      await interruption;
    }
    if (boundary === 'release-suspended') {
      controller.setObjectSoundsPaused(true);
      const releaseWaiting = offline.suspend(0.3);
      clockOwnsState = true;
      await offline.resume(); await releaseWaiting;
      await interruption;
    }
    if (boundary === 'toggles') {
      for (let index = 0; index < 30; index++) {
        controller.setObjectSoundsPaused(true); controller.setObjectSoundsPaused(false); controller.observeRunningWorld();
        if (controller.activeAmbienceCount() > 1 || controller.retainedAmbienceCount() > 2) throw Error('Unbounded room ownership');
      }
      controller.reset('load');
    }
    await offline.resume();
  }
  const samples = (await rendering).getChannelData(0);
  controller.reset('load');
  if (controller.retainedAmbienceCount() !== 0) throw Error('Room nodes did not drain');
  return {samples, counts};
}
function rms(samples, start = 0.15, end = 0.23) {
  let energy = 0; const first = Math.round(start * RATE), last = Math.round(end * RATE);
  for (let index = first; index < last; index++) energy += samples[index] ** 2;
  return Math.sqrt(energy / (last - first));
}
function near(actual, expected, label) {
  if (Math.abs(actual - expected) > 1e-6) throw Error(`${label}: expected ${expected}, got ${actual}`);
  return {label, actual, expected};
}
export async function proveRoomAmbience() {
  const base = await render({}); const level = rms(base.samples);
  if (level < 0.002 || base.counts.active !== 1 || base.counts.starts !== 1) throw Error('Enabled room proof is silent');
  const checks = [];
  for (const [options, scale, label] of [
    [{ambience: 0.25}, 0.25, 'Independent quarter Ambience'],
    [{voices: 0}, 1, 'Voices bypass'], [{effects: 0.35}, 0.5, 'Effects routing'],
    [{ambience: 0}, 0, 'Ambience zero'], [{effects: 0}, 0, 'Effects zero'], [{muted: true}, 0, 'Master mute'],
  ]) checks.push(near(rms((await render(options)).samples), level * scale, label));
  const paused = await render({boundary: 'pause'});
  if (rms(paused.samples, 0.26, 0.30) < 0.0001) throw Error('Pause cut instead of fading');
  checks.push(near(rms(paused.samples, 0.36, 0.9), 0, 'Pause drained'));
  for (const boundary of ['suspended', 'release-suspended', 'toggles']) {
    const result = await render({boundary});
    checks.push(near(rms(result.samples, boundary === 'release-suspended' ? 0.31 : 0.26, 0.9), 0, `${boundary} resumed tail`));
  }
  const maximum = await render({ambience: 1, effects: 1});
  let peak = 0; for (const sample of maximum.samples) peak = Math.max(peak, Math.abs(sample));
  if (peak >= 1) throw Error('Maximum room level clips');
  return {checks, rms: level, rmsEffectsLevel: 0.7, peak, peakEffectsLevel: 1, peakAmbienceLevel: 1,
    counts: base.counts, subjectiveListening: 'not claimed'};
}
