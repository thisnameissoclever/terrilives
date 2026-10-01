import { AudioController } from '../src/audio/audio-controller.ts';

const RATE = 48_000;
const NO_STORAGE = { getItem: () => null, setItem: () => {} };

function near(actual, expected, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.0001) {
    throw new Error(`${label}: expected ${expected}, rendered ${actual}`);
  }
  return { label, expected, actual };
}

// Native state events reach the controller without a simulation observation.
// The first hold only schedules an ordinary fade; the second exposes suspension.
// Offline rendering is controlled-clock evidence, not an OS interruption test.
export async function proveAudioStateEvents(kinds = ['object', 'conversation']) {
  const results = [];
  for (const kind of kinds) {
    for (const interrupt of [false, true]) {
      const offline = new OfflineAudioContext(1, RATE / 2, RATE);
      const buffer = offline.createBuffer(1, RATE / 2, RATE);
      buffer.getChannelData(0).fill(1);
      let scheduling = true;
      let rendered;
      const port = {
        get currentTime() { return offline.currentTime; },
        get state() { return scheduling || !interrupt ? 'running' : offline.state; },
        onstatechange: null,
        destination: offline.destination,
        createGain: () => offline.createGain(),
        createBufferSource: () => offline.createBufferSource(),
        createOscillator: () => offline.createOscillator(),
        decodeAudioData: async () => buffer,
        resume: async () => {}, suspend: async () => {}, close: async () => {},
      };
      offline.onstatechange = event => port.onstatechange?.(event);
      const stateEvent = state => new Promise(resolve => {
        const listener = () => {
          if (offline.state !== state) return;
          offline.removeEventListener('statechange', listener);
          resolve();
        };
        offline.addEventListener('statechange', listener);
      });
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
            if (!['audio/voice/state-a.wav', 'audio/voice/state-b.wav'].includes(url)) {
              throw new Error(`Unexpected fixture request: ${url}`);
            }
            return new Response(new ArrayBuffer(16));
          };
          await controller.loadVoiceLibrary(['state-a', 'state-b']);
        }
        frame(true);
        if (retained() !== 1) throw new Error(`${kind}: positive source was not exercised`);
        const beginRelease = offline.suspend(0.128);
        const duringRelease = offline.suspend(0.136);
        const firstSuspendedEvent = stateEvent('suspended');
        rendered = offline.startRendering();
        await beginRelease;
        await firstSuspendedEvent;
        frame(false);
        if (retained() !== 1) throw new Error(`${kind}: ordinary fade was cut early`);
        scheduling = false;
        const runningEvent = stateEvent('running');
        await offline.resume();
        await runningEvent;
        const interruptedEvent = stateEvent('suspended');
        await duringRelease;
        await interruptedEvent;
        const resumeFrame = Math.round(offline.currentTime * RATE);
        const retainedAtSuspension = retained();
        await offline.resume();
        const samples = (await rendered).getChannelData(0);
        const plateau = kind === 'object' ? 0.14 : 0.1568;
        const releaseDuration = kind === 'object' ? 0.02 : 0.012;
        const tag = `${kind}, ${interrupt ? 'state-event interruption' : 'ordinary fade control'}`;
        results.push(near(samples[4800], plateau, `${tag}: positive playing signal`));
        results.push(near(samples[6336], plateau * (1 - 0.004 / releaseDuration), `${tag}: fade before suspension`));
        results.push(near(samples[resumeFrame], interrupt ? 0 : plateau * (1 - 0.008 / releaseDuration), `${tag}: first resumed sample`));
        if (interrupt) {
          let maximumTail = 0;
          for (let i = resumeFrame; i < samples.length; i++) maximumTail = Math.max(maximumTail, Math.abs(samples[i]));
          results.push(near(maximumTail, 0, `${tag}: entire resumed tail`));
          if (retainedAtSuspension !== 0) throw new Error(`${kind}: release-only nodes remained connected`);
        }
        results.push(near(samples[9600], 0, `${tag}: endpoint remains silent`));
      } finally {
        globalThis.fetch = originalFetch;
        controller.reset('load');
        offline.onstatechange = null;
        if (rendered && offline.state === 'suspended') await offline.resume();
        if (rendered) await rendered;
      }
    }
  }
  return results;
}
