import { AudioController } from '../src/audio/audio-controller.ts';

const RATE = 48000;
const LOOP_FRAMES = 85594;
const NO_STORAGE = {getItem: () => null, setItem: () => {}};

// Real shipped WAV, fetch, decoder and playback graph. No speaker output.
// The running-state adapter deliberately does not test browser autoplay.
export async function proveShowerRecording() {
  return proveWaterRecording(1, 0.6);
}

export async function proveSinkRecording() {
  return proveWaterRecording(3, 0.35);
}

async function proveWaterRecording(action, gain) {
  const results = [];
  for (const boundary of [null, 'four-sources', 'load', 'mute', 'effects', 'background', 'pause']) {
    const offline = new OfflineAudioContext(2, RATE * 5, RATE);
    const context = {
      get currentTime() { return offline.currentTime; }, get state() { return 'running'; },
      destination: offline.destination,
      createGain: () => offline.createGain(), createOscillator: () => offline.createOscillator(),
      createBufferSource: () => offline.createBufferSource(),
      decodeAudioData: bytes => offline.decodeAudioData(bytes),
      resume: async () => {}, suspend: async () => {}, close: async () => {},
    };
    const controller = new AudioController(() => context, NO_STORAGE);
    const originalFetch = globalThis.fetch;
    let requests = 0;
    try {
      globalThis.fetch = url => {
        if (url !== 'audio/objects/shower-water.wav') throw new Error(`Unexpected request: ${url}`);
        requests++;
        return originalFetch(new URL(`../${url}`, window.location.href));
      };
      await controller.unlockFromGesture();
      controller.setVoicesLevel(0);
      controller.setEffectsLevel(1);
      const count = boundary === 'four-sources' ? 4 : 1;
      for (let sourceId = 1; sourceId <= count; sourceId++) {
        controller.emit({type:'object.sound-started', sourceId, action});
      }
      await controller.loadObjectRecordings();
      if (requests !== 1 || controller.activeObjectLoopCount() !== count) throw new Error('Load or source ownership failed');
      const stops = boundary !== null && boundary !== 'four-sources';
      const stopping = stops ? offline.suspend(0.5) : null;
      const rendering = offline.startRendering();
      if (stopping) {
        await stopping;
        if (boundary === 'load') controller.reset('load');
        if (boundary === 'mute') controller.setMuted(true);
        if (boundary === 'effects') controller.setEffectsLevel(0);
        if (boundary === 'background') await controller.setBackgrounded(true);
        if (boundary === 'pause') controller.setObjectSoundsPaused(true);
        await offline.resume();
      }
      const output = await rendering;
      let peak = 0, tailPeak = 0, repeatError = 0;
      for (let channel = 0; channel < 2; channel++) {
        const data = output.getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
          if (!Number.isFinite(data[i])) throw new Error('Nonfinite output');
          peak = Math.max(peak, Math.abs(data[i]));
          if (i >= RATE) tailPeak = Math.max(tailPeak, Math.abs(data[i]));
        }
        if (!stops) {
          for (let i = 2000; i < 4000; i++) repeatError = Math.max(repeatError, Math.abs(data[i] - data[i + LOOP_FRAMES]));
        }
      }
      if (peak < 0.001 || peak > count * 0.06421 * gain || repeatError > 0.00001 ||
          (stops ? tailPeak !== 0 : tailPeak < 0.001)) throw new Error(`Invalid rendered output: ${boundary}, ${peak}, ${tailPeak}, ${repeatError}`);
      results.push({action, boundary: boundary ?? 'one-source', requests, sources:count, peak, tailPeak, repeatError});
    } finally {
      controller.reset('load');
      globalThis.fetch = originalFetch;
    }
  }
  return results;
}
