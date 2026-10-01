import { ObjectLoopPlayer } from '../src/audio/object-loops.ts';
import { AudioController } from '../src/audio/audio-controller.ts';

const RATE = 48_000;
const NO_STORAGE = { getItem: () => null, setItem: () => {} };

function fixture() {
  const context = new OfflineAudioContext(1, RATE, RATE);
  const buffer = context.createBuffer(1, RATE / 10, RATE);
  buffer.getChannelData(0).fill(1);
  return { context, clips: new Map([
    [1, { buffer, gain: 0.2, loopStart: 0, loopEnd: 0.1 }],
    [2, { buffer, gain: 0.1, loopStart: 0, loopEnd: 0.1 }],
  ]) };
}

function near(actual, expected, label, tolerance = 0.0001) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, rendered ${actual}`);
  }
  return { label, expected, actual };
}

// Silent signal proof. A constant input exposes the actual rendered envelope.
export async function proveObjectLoops() {
  const results = [];
  for (const stopAt of [0.008, 0.128]) {
    const { context, clips } = fixture();
    const player = new ObjectLoopPlayer(context, context.destination);
    player.setClips(clips);
    if (!player.play(11, 1) || !player.play(22, 2)) throw new Error('Loops did not start');
    const stopping = context.suspend(stopAt);
    const rendering = context.startRendering();
    await stopping;
    const actualStop = context.currentTime;
    player.stop(11, 1);
    await context.resume();
    const samples = (await rendering).getChannelData(0);
    const at = Math.round(actualStop * RATE);
    const firstGain = 0.2 * Math.min(1, actualStop / 0.02);
    const otherGain = 0.1 * Math.min(1, actualStop / 0.02);
    results.push(near(samples[at], firstGain + otherGain, `Stop ${stopAt}: anchored gain`));
    results.push(near(samples[at] - samples[at - 1], 0, `Stop ${stopAt}: continuity`, 0.0004));
    const otherHalf = 0.1 * Math.min(1, (actualStop + 0.01) / 0.02);
    results.push(near(samples[at + 480], firstGain / 2 + otherHalf, `Stop ${stopAt}: half fade`));
    results.push(near(samples[at + 1000], 0.1, `Stop ${stopAt}: other source remains`));
    results.push(near(samples[24_000], 0.1, `Stop ${stopAt}: native loop repeats`));
    player.stopAll(true);
  }
  return results;
}

function controllerContext(offline) {
  return {
    get currentTime() { return offline.currentTime; },
    get state() { return 'running'; },
    destination: offline.destination,
    createGain: () => offline.createGain(),
    createBufferSource: () => offline.createBufferSource(),
    createOscillator: () => offline.createOscillator(),
    decodeAudioData: (bytes) => offline.decodeAudioData(bytes),
    resume: async () => {}, suspend: async () => {}, close: async () => {},
  };
}

function observe(controller, ...sources) {
  controller.beginObjectSoundFrame();
  for (const [id, action] of sources) controller.observeObjectSound(id, action);
  controller.endObjectSoundFrame();
}

export async function proveObjectLoopController() {
  const results = [];
  for (const boundary of ['load', 'mute', 'effects', 'background', 'pause']) {
    const { context, clips } = fixture();
    const controller = new AudioController(() => controllerContext(context), NO_STORAGE);
    await controller.unlockFromGesture();
    controller.installObjectLoopClips(clips);
    controller.setVoicesLevel(0);
    observe(controller, [11, 1], [11, 1]);
    const stopping = context.suspend(0.128);
    const rendering = context.startRendering();
    await stopping;
    if (boundary === 'load') controller.reset('load');
    if (boundary === 'mute') controller.setMuted(true);
    if (boundary === 'effects') controller.setEffectsLevel(0);
    if (boundary === 'background') await controller.setBackgrounded(true);
    if (boundary === 'pause') controller.setObjectSoundsPaused(true);
    // A late installation must not revive the old source at any boundary.
    controller.installObjectLoopClips(clips);
    await context.resume();
    const samples = (await rendering).getChannelData(0);
    results.push(near(samples[4_800], 0.14, `${boundary}: duplicate source, Voices zero`));
    results.push(near(samples[12_000], 0, `${boundary}: stopped and not revived`));
    controller.reset('load');
  }

  const { context, clips } = fixture();
  const controller = new AudioController(() => controllerContext(context), NO_STORAGE);
  await controller.unlockFromGesture();
  observe(controller, [11, 1]);
  observe(controller);
  controller.installObjectLoopClips(clips);
  const samples = (await context.startRendering()).getChannelData(0);
  results.push(near(Math.max(...samples), 0, 'Late clip does not revive an ended action'));
  controller.reset('load');
  return results;
}
