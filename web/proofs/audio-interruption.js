import { AudioController } from '../src/audio/audio-controller.ts';
import { VoiceClipPlayer } from '../src/audio/voice-clips.ts';

const RATE = 48_000;
const NO_STORAGE = { getItem: () => null, setItem: () => {} };

function observe(controller, ...sources) {
  controller.beginObjectSoundFrame();
  for (const [id, action] of sources) controller.observeObjectSound(id, action);
  controller.endObjectSoundFrame();
}

function near(actual, expected, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.0001) {
    throw new Error(`${label}: expected ${expected}, rendered ${actual}`);
  }
  return { label, expected, actual };
}

// Silent rendered proof: after rendering starts, state comes from the native clock.
// The initial adapter unlock only allows scheduling before startRendering().
export async function proveSuspendedObjectStop() {
  const results = [];
  for (const pending of [false, true]) {
    const offline = new OfflineAudioContext(1, RATE / 2, RATE);
    let rendering = false;
    let unlocked = false;
    const port = {
      get currentTime() { return offline.currentTime; },
      get state() { return rendering ? offline.state : unlocked ? 'running' : 'suspended'; },
      destination: offline.destination,
      createGain: () => offline.createGain(),
      createBufferSource: () => offline.createBufferSource(),
      createOscillator: () => offline.createOscillator(),
      decodeAudioData: bytes => offline.decodeAudioData(bytes),
      resume: async () => { unlocked = true; },
      suspend: async () => {},
      close: async () => {},
    };
    const controller = new AudioController(() => port, NO_STORAGE);
    const buffer = offline.createBuffer(1, RATE / 10, RATE);
    buffer.getChannelData(0).fill(1);
    // Action 2 avoids network demand; its prepared fixture exposes the same player path.
    const clips = new Map([[2, { buffer, gain: 0.2, loopStart: 0, loopEnd: 0.1 }]]);
    try {
      await controller.unlockFromGesture();
      if (!pending) controller.installObjectLoopClips(clips);
      observe(controller, [41, 2]);
      const stopped = offline.suspend(0.128);
      rendering = true;
      const rendered = offline.startRendering();
      await stopped;
      if (offline.state !== 'suspended') throw new Error('Native clock did not suspend');
      const stopFrame = Math.round(offline.currentTime * RATE);
      observe(controller);
      if (pending) controller.installObjectLoopClips(clips);
      if (controller.activeObjectLoopCount() !== 0 || controller.retainedObjectLoopCount() !== 0) {
        throw new Error('Ended source retained nodes while native clock was suspended');
      }
      await offline.resume();
      const samples = (await rendered).getChannelData(0);
      results.push(near(samples[4800], pending ? 0 : 0.14, `${pending ? 'Pending' : 'Playing'}: before interruption`));
      let maximum = 0;
      for (let frame = stopFrame; frame < samples.length; frame++) maximum = Math.max(maximum, Math.abs(samples[frame]));
      results.push(near(maximum, 0, `${pending ? 'Pending' : 'Playing'}: no resumed tail`));
    } finally {
      controller.reset('load');
      if (rendering && offline.state === 'suspended') await offline.resume();
    }
  }
  return results;
}

export async function proveSuspendedConversationStop() {
  const offline = new OfflineAudioContext(1, RATE, RATE);
  const clips = [1, 0.5].map(value => {
    const buffer = offline.createBuffer(1, RATE, RATE);
    buffer.getChannelData(0).fill(value);
    return buffer;
  });
  const player = new VoiceClipPlayer(offline, offline.destination);
  player.setClips(clips);
  try {
    if (!player.play(0, 0, 1, 'ended') || !player.play(1, 1, 1, 'continuing')) {
      throw new Error('Both conversation fixtures must start');
    }
    const stopped = offline.suspend(0.128);
    const rendered = offline.startRendering();
    await stopped;
    const stopFrame = Math.round(offline.currentTime * RATE);
    player.stopConversation('ended', true);
    if (player.activeConversationCount() !== 1 || player.retainedConversationCount() !== 1) {
      throw new Error('Suspended cancellation must dispose only the ended conversation');
    }
    await offline.resume();
    const samples = (await rendered).getChannelData(0);
    return [
      near(samples[4800], 0.336, 'Both conversations before interruption'),
      near(samples[stopFrame], 0.112, 'Only continuing conversation on first resumed sample'),
      near(samples[24000], 0.112, 'Continuing conversation remains uninterrupted'),
    ];
  } finally {
    player.stopConversation('ended', true);
    player.stopConversation('continuing', true);
    if (offline.state === 'suspended') await offline.resume();
  }
}
