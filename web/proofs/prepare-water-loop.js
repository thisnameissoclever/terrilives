// Offline asset preparation only. This module is not imported by the game.
export function conditionWaterLoop(channels, overlapFrames) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2 ||
      !channels.every(channel => channel instanceof Float32Array && channel.length > 0 &&
        channel.length <= 480_000 && channel.length === channels[0].length &&
        channel.every(value => Number.isFinite(value) && Math.abs(value) <= 1)) ||
      !Number.isInteger(overlapFrames) || overlapFrames < 2 || overlapFrames * 2 >= channels[0].length) {
    throw new Error('Invalid channels or loop overlap');
  }
  const length = channels[0].length;
  const loopLength = length - overlapFrames;
  return channels.map(source => {
    const loop = new Float32Array(loopLength);
    for (let i = 0; i < loopLength; i++) {
      const blend = i / (overlapFrames - 1);
      loop[i] = i < overlapFrames
        ? source[loopLength + i] * (1 - blend) + source[i] * blend
        : source[i];
    }
    return loop;
  });
}

// Fixed 48 kHz signed PCM16 export; no normalization, gain boost or dithering.
export function encodeWaterWave(channels) {
  const frames = channels[0].length;
  const channelCount = channels.length;
  const bytes = new Uint8Array(44 + frames * channelCount * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => bytes.set(new TextEncoder().encode(value), offset);
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channelCount, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 48000 * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = Math.max(-32768, Math.min(32767, Math.round(channels[channel][i] * 32768)));
      view.setInt16(44 + (i * channelCount + channel) * 2, sample, true);
    }
  }
  return bytes;
}

export async function prepareWaterRecording(bytes) {
  const decoder = new OfflineAudioContext(2, 48000, 48000);
  const buffer = await decoder.decodeAudioData(bytes);
  const channels = Array.from({length: buffer.numberOfChannels}, (_, index) => buffer.getChannelData(index));
  const loop = conditionWaterLoop(channels, 4800);
  const wav = encodeWaterWave(loop);
  let encoded = '';
  for (let start = 0; start < wav.length; start += 4096) {
    encoded += String.fromCharCode(...wav.subarray(start, start + 4096));
  }
  const stats = samples => {
    let peak = 0, squareSum = 0, jump = 0;
    for (const channel of samples) {
      jump = Math.max(jump, Math.abs(channel[0] - channel.at(-1)));
      for (const value of channel) { peak = Math.max(peak, Math.abs(value)); squareSum += value * value; }
    }
    return {peak, rms: Math.sqrt(squareSum / (samples.length * samples[0].length)), endpointJump: jump};
  };
  return {base64: btoa(encoded), frames: loop[0].length, sampleRate:48000,
    channels: loop.length, original:stats(channels), edited:stats(loop)};
}
