import { coverageBytes, type EncodedCoverage } from './bed-sprites.js';

/**
 * Pack original half-float coverage without assigning one texture layer per pose.
 * `payload` defaults to the loaded coverage file; tests pass their own.
 */
export function uploadJointAlpha(device: GPUDevice, ids: Readonly<Record<number, number>>,
  coverage: readonly EncodedCoverage[], payload?: Uint8Array<ArrayBuffer>): { texture: GPUTexture; layers: Readonly<Record<number, number>>;
    registration: Float32Array<ArrayBuffer> } {
  const unique = new Map<string, number>(), records: EncodedCoverage[] = [];
  const layers: Record<number, number> = {};
  for (const [sprite, id] of Object.entries(ids)) {
    if (coverage[id]?.encoding !== 'float16') throw new Error('Joint scene alpha requires half-float coverage');
    const record = coverage[id];
    // The generator stores identical bytes once, so equal offsets mean equal values.
    const key = `${record.size[0]}:${record.size[1]}:${record.offset}`;
    if (!unique.has(key)) { unique.set(key, records.length); records.push(record); }
    layers[Number(sprite)] = unique.get(key)!;
  }
  const extent = Math.max(1, ...records.flatMap(record => record.size));
  const area = records.reduce((sum, record) => sum + record.size[0] * record.size[1], 0);
  const side = Math.min(device.limits.maxTextureDimension2D,
    Math.max(2 ** Math.ceil(Math.log2(extent)), Math.min(2048, 2 ** Math.ceil(Math.log2(Math.max(1, Math.sqrt(area)))))));
  if (extent > side) throw new Error('Joint scene alpha exceeds device texture dimensions');
  const registration = new Float32Array(Math.max(1, records.length) * 4);
  let x = 0, y = 0, rowHeight = 0, page = 0;
  const order = records.map((record, id) => ({ record, id })).sort((a, b) => b.record.size[1] - a.record.size[1]);
  for (const { record, id } of order) {
    if (x + record.size[0] > side) { x = 0; y += rowHeight; rowHeight = 0; }
    if (y + record.size[1] > side) { x = 0; y = 0; rowHeight = 0; page++; }
    registration.set([x, y, page, 0], id * 4);
    x += record.size[0]; rowHeight = Math.max(rowHeight, record.size[1]);
  }
  if (page + 1 > device.limits.maxTextureArrayLayers) throw new Error('Joint scene alpha exceeds device texture layers');
  const texture = device.createTexture({ size: [side, side, page + 1], format: 'r16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  try {
    for (let id = 0; id < records.length; id++) {
      const record = records[id], raw = coverageBytes(record, payload);
      if (record.box.join(',') !== [0, 0, ...record.size].join(',') || raw.length !== record.size[0] * record.size[1] * 2) {
        throw new Error('Joint scene alpha dimensions differ from its full scene');
      }
      device.queue.writeTexture({ texture, origin: Array.from(registration.subarray(id * 4, id * 4 + 3)) }, raw,
        { bytesPerRow: record.size[0] * 2 }, { width: record.size[0], height: record.size[1] });
    }
    return { texture, layers, registration };
  } catch (error) { texture.destroy(); throw error; }
}
