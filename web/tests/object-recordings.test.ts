import { describe, expect, it, vi } from 'vitest';
import { loadObjectRecordings } from '../src/audio/object-recordings.js';

describe('object recordings', () => {
  it('loads only shower water with the authored gain and full edited loop', async () => {
    const bytes = new ArrayBuffer(16);
    const buffer = { duration: 7.25 };
    const fetchBytes = vi.fn(async () => bytes);
    const decode = vi.fn(async () => buffer);
    const clips = await loadObjectRecordings(fetchBytes, decode);
    expect(fetchBytes.mock.calls).toEqual([['audio/objects/shower-water.wav']]);
    expect(decode).toHaveBeenCalledWith(bytes);
    expect([...clips]).toEqual([[1, { buffer, gain: 0.6, loopStart: 0, loopEnd: 7.25 }]]);
  });

  it.each(['fetch', 'decode'] as const)('rejects a %s failure without fabricating a clip', async failure => {
    const fetchBytes = vi.fn(async () => {
      if (failure === 'fetch') throw new Error('unavailable');
      return new ArrayBuffer(16);
    });
    const decode = vi.fn(async () => { throw new Error('invalid recording'); });
    await expect(loadObjectRecordings(fetchBytes, decode)).rejects.toThrow();
    expect(decode).toHaveBeenCalledTimes(failure === 'fetch' ? 0 : 1);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid decoded duration %s', async duration => {
    const clips = await loadObjectRecordings(async () => new ArrayBuffer(16), async () => ({ duration }));
    expect(clips.size).toBe(0);
  });
});
