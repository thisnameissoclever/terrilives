import { AudioController } from '../src/audio/audio-controller.ts';

const RATE = 48_000;
const NO_STORAGE = { getItem: () => null, setItem: () => {} };

function near(actual, expected, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.0001) {
    throw new Error(`${label}: expected ${expected}, rendered ${actual}`);
  }
  return { label, expected, actual };
}

// The first offline hold schedules a normal fade at an exact audio-clock time.
// Only that scheduling step reports running; the second hold exposes native
// suspension. This is rendered lifecycle evidence, not an OS-interruption test.
export async function proveReleaseInterruption(kinds = ['object', 'conversation']) {
  const results = [];
  for (const kind of kinds) {
    for (const interrupt of [false, true]) {
      const offline = new OfflineAudioContext(1, RATE / 2, RATE);
      const buffer = offline.createBuffer(1, RATE / 2, RATE);
      buffer.getChannelData(0).fill(1);
      let scheduling = true;
      let rendering = false;
      const port = {
        get currentTime() { return offline.currentTime; },
        get state() { return scheduling ? 'running' : offline.state; },
        destination: offline.destination,
        createGain: () => offline.createGain(),
        createBufferSource: () => offline.createBufferSource(),
        createOscillator: () => offline.createOscillator(),
        decodeAudioData: async () => buffer,
        resume: async () => {}, suspend: async () => {}, close: async () => {},
      };
      const controller = new AudioController(() => port, NO_STORAGE);
      const originalFetch = globalThis.fetch;
      const voice = { owner: 4, endLow: 80, endHigh: 0, first: 0, second: 1 };
      const frame = active => {
        if (kind === 'object') {
          controller.beginObjectSoundFrame();
          if (active) controller.observeObjectSound(41, 2);
          controller.endObjectSoundFrame();
        } else {
          controller.beginActivityFrame();
          if (active) controller.observeActivity(4, 'conversation', voice);
          controller.endActivityFrame();
        }
      };
      const retained = () => kind === 'object'
        ? controller.retainedObjectLoopCount() : controller.retainedConversationVoiceCount();
      try {
        await controller.unlockFromGesture();
        if (kind === 'object') {
          controller.installObjectLoopClips(new Map([
            [2, { buffer, gain: 0.2, loopStart: 0, loopEnd: 0.5 }],
          ]));
        } else {
          globalThis.fetch = async url => {
            if (!['audio/voice/release-a.wav', 'audio/voice/release-b.wav'].includes(url)) {
              throw new Error(`Unexpected fixture request: ${url}`);
            }
            return new Response(new ArrayBuffer(16));
          };
          await controller.loadVoiceLibrary(['release-a', 'release-b']);
        }
        frame(true);
        if (retained() !== 1) throw new Error(`${kind}: positive source was not exercised`);
        const beginRelease = offline.suspend(0.128);
        const duringRelease = offline.suspend(0.136);
        rendering = true;
        const rendered = offline.startRendering();
        await beginRelease;
        frame(false);
        if (retained() !== 1) throw new Error(`${kind}: normal fade was cut before interruption`);
        scheduling = false;
        await offline.resume();
        await duringRelease;
        if (offline.state !== 'suspended') throw new Error('Native release clock did not suspend');
        const resumeFrame = Math.round(offline.currentTime * RATE);
        if (interrupt) frame(false);
        const retainedAtSuspension = retained();
        await offline.resume();
        const samples = (await rendered).getChannelData(0);
        const plateau = kind === 'object' ? 0.14 : 0.1568;
        const releaseDuration = kind === 'object' ? 0.02 : 0.012;
        const tag = `${kind}, ${interrupt ? 'interrupted' : 'normal fade'}`;
        results.push(near(samples[4800], plateau, `${tag}: positive playing signal`));
        results.push(near(samples[6336], plateau * (1 - 0.004 / releaseDuration), `${tag}: fade before suspension`));
        results.push(near(samples[resumeFrame], interrupt ? 0 : plateau * (1 - 0.008 / releaseDuration),
          `${tag}: first resumed sample`));
        let maximumTail = 0;
        for (let i = resumeFrame; i < samples.length; i++) maximumTail = Math.max(maximumTail, Math.abs(samples[i]));
        if (interrupt) {
          results.push(near(maximumTail, 0, `${tag}: entire resumed tail is silent`));
          if (retainedAtSuspension !== 0) throw new Error(`${kind}: release-only nodes remained connected`);
        }
        results.push(near(samples[9600], 0, `${tag}: normal endpoint remains silent`));
      } finally {
        globalThis.fetch = originalFetch;
        controller.reset('load');
        if (rendering && offline.state === 'suspended') await offline.resume();
      }
    }
  }
  return results;
}
