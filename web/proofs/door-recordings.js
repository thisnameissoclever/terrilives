import { AudioController } from '../src/audio/audio-controller.ts';

// Real shipped files and browser graph, rendered without speaker output.
export async function proveDoorRecordings() {
  const results = [];
  for (const mode of ['open', 'close', 'four', 'load', 'mute', 'effects', 'background', 'pause']) {
    const offline = new OfflineAudioContext(2, 48000 * 2, 48000);
    const context = {
      get currentTime() { return offline.currentTime; }, get state() { return 'running'; },
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
        if (url !== 'audio/doors/close-thunk.wav') throw new Error('Unexpected request');
        requests++;
        return originalFetch(new URL(`../${url}`, window.location.href));
      };
      await controller.unlockFromGesture();
      controller.setEffectsLevel(1);
      controller.setVoicesLevel(0);
      controller.setGameSpeed(3);
      controller.beginPortalFrame();
      controller.observePortal(1, 2, 2, 2, 0);
      controller.endPortalFrame();
      await controller.loadDoorRecordings();
      if (requests !== 1 || controller.activeDoorVoiceCount() !== 0) throw new Error('Preload replayed a door');
      const count = mode === 'four' ? 4 : 1;
      for (let index = 0; index < count; index++) {
        controller.emit({type: mode === 'open' ? 'door.opened' : 'door.closed', doorId: String(index)});
      }
      if (controller.activeDoorVoiceCount() !== (mode === 'open' ? 0 : count)) throw new Error('Wrong voice count');
      if (controller.cuePlayCounts()['door-opened'] !== 0) throw new Error('Opening played a cue');
      const boundary = ['load', 'mute', 'effects', 'background', 'pause'].includes(mode);
      const suspended = boundary ? offline.suspend(0.1) : null;
      const rendering = offline.startRendering();
      if (suspended) {
        await suspended;
        if (mode === 'load') controller.reset('load');
        if (mode === 'mute') controller.setMuted(true);
        if (mode === 'effects') controller.setEffectsLevel(0);
        if (mode === 'background') await controller.setBackgrounded(true);
        if (mode === 'pause') controller.setObjectSoundsPaused(true);
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
          if (i >= 48000 * 0.32) afterEnd = Math.max(afterEnd, value);
          if (i >= 48000 * 0.12 && i < 48000 * 0.3) lateEnergy += value * value;
        }
      }
      const stopped = boundary && mode !== 'pause';
      if ((mode === 'open' ? peak !== 0 || lateEnergy !== 0 : peak < 0.001 || peak > count * 0.023) || afterEnd !== 0 ||
        (stopped ? afterBoundary !== 0 : mode !== 'open' && lateEnergy <= 0) || controller.activeDoorVoiceCount() !== 0) {
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
