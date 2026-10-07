import { afterEach, expect, it, vi } from 'vitest';
import { uploadJointAlpha } from '../src/render/joint-alpha.js';
import type { EncodedCoverage } from '../src/render/bed-sprites.js';

afterEach(() => vi.unstubAllGlobals());

it('packs hundreds of distinct poses within one array layer and preserves every source byte', () => {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 });
  const writes: { origin: number[]; bytes: Uint8Array }[] = [];
  let size: readonly number[] = [];
  const texture = { destroy: vi.fn() };
  const device = { limits: { maxTextureArrayLayers: 1, maxTextureDimension2D: 128 },
    createTexture: (descriptor: { size: readonly number[] }) => { size = descriptor.size; return texture; },
    queue: { writeTexture: (destination: { origin: number[] }, bytes: Uint8Array) => {
      writes.push({ origin: destination.origin, bytes: bytes.slice() });
    } },
  } as unknown as GPUDevice;
  const coverage: EncodedCoverage[] = Array.from({ length: 300 }, (_, id) => {
    const values = new Uint16Array(16).fill(id + 1);
    return { size: [4, 4], box: [0, 0, 4, 4], encoding: 'float16',
      values: btoa(String.fromCharCode(...new Uint8Array(values.buffer))) };
  });
  coverage.push(coverage[0]);
  const result = uploadJointAlpha(device, Object.fromEntries(coverage.map((_, id) => [id, id])), coverage);
  expect(size[2]).toBe(1);
  expect(writes).toHaveLength(300);
  expect(result.layers[300]).toBe(result.layers[0]);
  const occupied = new Set<string>();
  for (let id = 0; id < 300; id++) {
    const [x, y, layer] = writes[id].origin;
    expect(layer).toBe(0);
    expect(Array.from(result.registration.slice(id * 4, id * 4 + 3))).toEqual([x, y, layer]);
    expect(new Uint16Array(writes[id].bytes.buffer)).toEqual(new Uint16Array(16).fill(id + 1));
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const pixel = `${x + dx}:${y + dy}`;
      expect(occupied.has(pixel)).toBe(false);
      occupied.add(pixel);
      expect(x + dx).toBeLessThan(size[0]);
      expect(y + dy).toBeLessThan(size[1]);
    }
  }
});
