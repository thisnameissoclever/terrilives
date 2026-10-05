import { AudioController } from '../src/audio/audio-controller.ts';

// Decode the shipped file and render its real graph without speaker output.
export async function proveToiletRecording() {
  const results = [];
  for (const mode of ['single', 'four', 'load', 'mute', 'effects', 'background', 'pause', 'suspended', 'interrupted']) {
    const offline = new OfflineAudioContext(2, 48000 * 5, 48000);
    let state = 'running';
    const context = {
      get currentTime() { return offline.currentTime; }, get state() { return state; },
      destination: offline.destination,
      createGain: () => offline.createGain(), createOscillator: () => offline.createOscillator(),
      createBufferSource: () => offline.createBufferSource(),
      decodeAudioData: bytes => offline.decodeAudioData(bytes),
      resume: async () => {}, suspend: async () => {}, close: async () => {},
    };
    const controller = new AudioController(() => context, {getItem: () => null, setItem: () => {}});
    const originalFetch = globalThis.fetch;
    let requests = 0;
    try {
      globalThis.fetch = url => {
        if (url !== 'audio/toilet/flush.wav') throw new Error(`Unexpected request: ${url}`);
        requests++;
        return originalFetch(new URL(`../${url}`, window.location.href));
      };
      await controller.unlockFromGesture();
      controller.setEffectsLevel(1);
      controller.setVoicesLevel(0);
      controller.setGameSpeed(3);
      await controller.loadToiletRecording();
      if (requests !== 1 || controller.activeToiletVoiceCount() !== 0) throw new Error('Preload replayed a flush');
      const count = mode === 'four' ? 4 : 1;
      for (let index = 0; index < count; index++) {
        controller.emit({type: 'object.completed', action: 1, sourceId: index});
      }
      if (controller.activeToiletVoiceCount() !== count) throw new Error('Wrong voice count');
      const boundary = !['single', 'four'].includes(mode);
      const suspended = boundary ? offline.suspend(0.1) : null;
      const rendering = offline.startRendering();
      if (suspended) {
        await suspended;
        if (mode === 'load') controller.reset('load');
        if (mode === 'mute') controller.setMuted(true);
        if (mode === 'effects') controller.setEffectsLevel(0);
        if (mode === 'background') await controller.setBackgrounded(true);
        if (mode === 'pause') controller.setObjectSoundsPaused(true);
        if (mode === 'suspended' || mode === 'interrupted') {
          state = mode;
          controller.beginActivityFrame(); controller.endActivityFrame();
          if (controller.activeToiletVoiceCount() !== 0) throw new Error('Frozen flush retained');
          state = 'running';
          controller.beginActivityFrame(); controller.endActivityFrame();
        }
        await offline.resume();
      }
      const rendered = await rendering;
      let peak = 0, afterBoundary = 0, afterEnd = 0, lateEnergy = 0;
      for (let channel = 0; channel < 2; channel++) {
        const samples = rendered.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) {
          const value = Math.abs(samples[i]);
          if (!Number.isFinite(value)) throw new Error('Nonfinite output');
          peak = Math.max(peak, value);
          if (i >= 48000 * 0.2) afterBoundary = Math.max(afterBoundary, value);
          if (i >= 197986) afterEnd = Math.max(afterEnd, value);
          if (i >= 48000 * 2) lateEnergy += value * value;
        }
      }
      // Include PCM16 quantization and browser conversion in the peak bound.
      if (peak < 0.001 || peak > count * 0.06050 || afterEnd !== 0 ||
        (boundary ? afterBoundary !== 0 : lateEnergy <= 0) || controller.activeToiletVoiceCount() !== 0) {
        throw new Error(`Invalid rendered ${mode}: ${JSON.stringify({peak, afterBoundary, afterEnd, lateEnergy})}`);
      }
      results.push({mode, requests, count, peak, afterBoundary, afterEnd, lateEnergy});
    } finally {
      controller.reset('load');
      globalThis.fetch = originalFetch;
    }
  }
  return results;
}
