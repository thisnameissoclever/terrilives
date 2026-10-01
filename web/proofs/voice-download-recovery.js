import { AudioController } from '../src/audio/audio-controller.ts';

const NO_STORAGE = { getItem: () => null, setItem: () => {} };
const IDS = ['sim-talking-1', 'sim-talking-2'];

// Uses real fetch, WAV decoding, and rendered samples. Only the first response
// for the second clip is replaced with 503; its retry is held across an end event.
// The lifecycle adapter avoids speaker output. It is not an autoplay-gate proof.
export async function proveVoiceDownloadRecovery() {
  const results = [];
  for (const endedBeforeRecovery of [false, true]) {
    const originalFetch = globalThis.fetch;
    const attempts = [0, 0];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const offline = new OfflineAudioContext(1, 48_000 * 10, 48_000);
    const context = {
      get currentTime() { return offline.currentTime; },
      get state() { return 'running'; },
      destination: offline.destination,
      createGain: () => offline.createGain(),
      createBufferSource: () => offline.createBufferSource(),
      createOscillator: () => offline.createOscillator(),
      decodeAudioData: bytes => offline.decodeAudioData(bytes),
      resume: async () => {}, suspend: async () => {}, close: async () => {},
    };
    const controller = new AudioController(() => context, NO_STORAGE);
    try {
      globalThis.fetch = async url => {
        const index = IDS.findIndex(id => url === `audio/voice/${id}.wav`);
        if (index < 0) throw new Error(`Unexpected proof request: ${url}`);
        attempts[index]++;
        if (index === 1 && attempts[index] === 1) return new Response('', { status: 503 });
        if (index === 1) await gate;
        return originalFetch(new URL(`../${url}`, window.location.href));
      };
      await controller.unlockFromGesture();
      await controller.loadVoiceLibrary(IDS);
      const initial = { owner: 4, endLow: 120, endHigh: 0, first: 0, second: 1 };
      controller.emit({ type: 'sim.conversation-started', simId: 4, voice: initial });
      controller.emit({ type: 'sim.conversation-ended', voice: initial });
      if (controller.activeConversationVoiceCount() !== 0 || attempts.join() !== '1,1') {
        throw new Error(`Initial failure or cooldown was not respected: ${attempts}`);
      }
      // A new observed conversation, not a timer, causes the retry after cooldown.
      await new Promise(resolve => setTimeout(resolve, 5_100));
      const current = { owner: 7, endLow: 220, endHigh: 0, first: 0, second: 1 };
      controller.emit({ type: 'sim.conversation-started', simId: 7, voice: current });
      if (attempts.join() !== '1,2') throw new Error(`Demand did not retry only the missing clip: ${attempts}`);
      if (endedBeforeRecovery) controller.emit({ type: 'sim.conversation-ended', voice: current });
      release();
      // Join the in-flight attempt rather than starting a second recovery path.
      await controller.loadVoiceLibrary(IDS);
      const active = controller.activeConversationVoiceCount();
      if (active !== (endedBeforeRecovery ? 0 : 1) || attempts.join() !== '1,2') {
        throw new Error(`Incorrect recovered ownership or fetch count: ${active}, ${attempts}`);
      }
      const output = (await offline.startRendering()).getChannelData(0);
      let peak = 0;
      for (const value of output) peak = Math.max(peak, Math.abs(value));
      if (!Number.isFinite(peak) || (endedBeforeRecovery ? peak !== 0 : peak < 0.001)) {
        throw new Error(`Incorrect rendered recovery output: ${peak}`);
      }
      results.push({ endedBeforeRecovery, attempts, activeAfterRecovery: active, renderedPeak: peak });
    } finally {
      release();
      controller.reset('load');
      globalThis.fetch = originalFetch;
    }
  }
  return results;
}
