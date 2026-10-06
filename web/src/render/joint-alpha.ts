import type { EncodedCoverage } from './bed-sprites.js';

/** Full registered half-float images preserve joint silhouette coverage. */
export function uploadJointAlpha(device: GPUDevice, ids: Readonly<Record<number, number>>,
  coverage: readonly EncodedCoverage[]): { texture: GPUTexture; layers: Readonly<Record<number, number>> } {
  const unique = new Map<number, number>(), layers: Record<number, number> = {};
  for (const [sprite, id] of Object.entries(ids)) {
    if (coverage[id]?.encoding !== 'float16') throw new Error('Joint scene alpha requires half-float coverage');
    if (!unique.has(id)) unique.set(id, unique.size);
    layers[Number(sprite)] = unique.get(id)!;
  }
  const width = Math.max(1, ...Array.from(unique.keys(), id => coverage[id].size[0]));
  const height = Math.max(1, ...Array.from(unique.keys(), id => coverage[id].size[1]));
  if (unique.size > device.limits.maxTextureArrayLayers || width > device.limits.maxTextureDimension2D
      || height > device.limits.maxTextureDimension2D) throw new Error('Joint scene alpha exceeds device texture limits');
  const texture = device.createTexture({ size: [width, height, Math.max(1, unique.size)], format: 'r16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  try {
    for (const [id, layer] of unique) {
      const record = coverage[id], raw = Uint8Array.from(atob(record.values), value => value.charCodeAt(0));
      if (record.box.join(',') !== [0, 0, ...record.size].join(',') || raw.length !== record.size[0] * record.size[1] * 2) {
        throw new Error('Joint scene alpha dimensions differ from its full scene');
      }
      device.queue.writeTexture({ texture, origin: [0, 0, layer] }, raw,
        { bytesPerRow: record.size[0] * 2 }, { width: record.size[0], height: record.size[1] });
    }
    return { texture, layers };
  } catch (error) { texture.destroy(); throw error; }
}
