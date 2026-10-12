import { afterEach, expect, it, vi } from 'vitest';
import { ARCHITECTURE } from '../src/render/architecture-data.js';
import { closeArchitectureAtlas, loadArchitectureAtlas, validateArchitectureDevice, type ArchitectureAtlas } from '../src/render/architecture-atlas.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

const limits = { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256,
  maxSampledTexturesPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxStorageBufferBindingSize: 128 * 1024 * 1024 } as GPUDevice['limits'];
afterEach(() => vi.unstubAllGlobals());

it('checks direct caller texture, array, sampling and storage limits before GPU allocation', () => {
  const atlas = { color: { width: 2048, height: 3037 }, carrier: { width: 2048, height: 3037 },
    sprites: ARCHITECTURE.sprites, registration: new Float32Array(472 * 4),
    patterns: [{ width: 256, height: 256 }] } as unknown as ArchitectureAtlas;
  expect(() => validateArchitectureDevice(atlas, limits, 1700)).not.toThrow();
  expect(() => validateArchitectureDevice(atlas, { ...limits, maxStorageBuffersPerShaderStage: 3 }, 1700)).toThrow(/buffer counts/);
  expect(() => validateArchitectureDevice(atlas, { ...limits, maxStorageBuffersPerShaderStage: 4 }, 1700)).not.toThrow();
  expect(() => validateArchitectureDevice(atlas, { ...limits, maxTextureDimension2D: 2048 }, 1700)).toThrow(/dimensions/);
  expect(() => validateArchitectureDevice(atlas, { ...limits, maxTextureArrayLayers: 1 }, 1700)).toThrow(/layer/);
  expect(() => validateArchitectureDevice(atlas, { ...limits, maxSampledTexturesPerShaderStage: 4 }, 1700)).toThrow(/sampled/);
  expect(() => validateArchitectureDevice(atlas, { ...limits, maxStorageBufferBindingSize: 65536 }, 1700)).toThrow(/storage/);
  // 2,172 sprite records need 104,256 bytes; the old 32-byte estimate was 69,504.
  expect(() => validateArchitectureDevice(atlas, { ...limits, maxStorageBufferBindingSize: 100000 }, 1700)).toThrow(/storage/);
});

it('rejects device limits before allocating or fetching any architecture resource', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(loadArchitectureAtlas({ ...limits, maxTextureDimension2D: 2048 })).rejects.toThrow(/dimensions/);
  expect(fetch).not.toHaveBeenCalled();
});

it('closes each decoded image when a later resource fails', async () => {
  const close = vi.fn(); vi.stubGlobal('location', { href: 'http://proof.invalid/' });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2048, height: 3037, close })));
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('.r16f.gz')) throw new Error('Depth fetch failed');
    return new Response(new Uint8Array(1));
  }));
  await expect(loadArchitectureAtlas(limits, { baseUrl: '/' })).rejects.toThrow('Depth fetch failed');
  expect(close).toHaveBeenCalledOnce();
});

it('loads accepted color and depth only for default walls, then explicitly releases the decoded image', async () => {
  const close = vi.fn(), fetched: string[] = [];
  vi.stubGlobal('location', { href: 'http://proof.invalid/' });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2048, height: 3037, close })));
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    fetched.push(url.pathname);
    return new Response(url.pathname.endsWith('.r16f.gz') ? new Uint8Array(2048 * 3037 * 2) : new Uint8Array(1));
  }));
  const atlas = await loadArchitectureAtlas(limits, { baseUrl: '/' });
  expect(fetched).toEqual([`/${ARCHITECTURE.resources.color}`, `/${ARCHITECTURE.resources.depth}`]);
  expect(atlas.finishes?.resources).toEqual([]); expect(atlas.carrier).toBeUndefined();
  expect(atlas.registration?.length).toBe(472 * 4); expect(close).not.toHaveBeenCalled();
  closeArchitectureAtlas(atlas); expect(close).toHaveBeenCalledOnce();
});

it('unpacks the published gzip depth and role files and rejects ones of the wrong size', async () => {
  const texels = ARCHITECTURE.width * ARCHITECTURE.height;
  const depth = new Uint16Array(texels); depth[0] = 0x3c00; depth[texels - 1] = 0xbc00;
  const roles = new Uint8Array(texels); roles[1] = 2;
  let roleBytes: Uint8Array = gzipSync(roles);
  const counted: number[] = [];
  vi.stubGlobal('location', { href: 'http://proof.invalid/' });
  const finishKeys = [Object.keys(ARCHITECTURE.catalogue.finishes)[0]];
  const catalogue = ARCHITECTURE.catalogue as unknown as { finishes: Record<string, { patternKey: string }>;
    patterns: Record<string, { resource: string }> };
  const pattern = (ARCHITECTURE.patterns as Record<string, { width: number; height: number }>)[
    catalogue.patterns[catalogue.finishes[finishKeys[0]].patternKey].resource];
  // A two-byte body stands for a pattern image, one byte for the atlas images.
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => (blob.size === 2
    ? { width: pattern.width, height: pattern.height, close: vi.fn() } : { width: 2048, height: 3037, close: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => new Response(new Uint8Array(
    url.pathname.endsWith('.r16f.gz') ? gzipSync(depth) : url.pathname.endsWith('.r8.gz') ? roleBytes
      : new Uint8Array(url.pathname.includes('-pattern-') ? 2 : 1)))));
  const atlas = await loadArchitectureAtlas(limits, { baseUrl: '/', finishKeys,
    progress: { bytes: count => counted.push(count) } });
  expect(atlas.depth[0]).toBe(0x3c00); expect(atlas.depth[texels - 1]).toBe(0xbc00);
  expect(atlas.depth.length).toBe(texels); expect(atlas.roles?.[1]).toBe(2);
  // The count is what arrived over the network, not the unpacked size.
  expect(counted.reduce((sum, n) => sum + n, 0)).toBeLessThan(texels);
  roleBytes = gzipSync(roles.subarray(1));
  await expect(loadArchitectureAtlas(limits, { baseUrl: '/', finishKeys })).rejects.toThrow(/unpacks to/);
  roleBytes = roles.subarray(1);
  await expect(loadArchitectureAtlas(limits, { baseUrl: '/', finishKeys })).rejects.toThrow(/were expected/);
});

it('publishes depth and roles gzip-compressed, named by the hash of their unpacked bytes', () => {
  for (const key of ['depth', 'roles'] as const) {
    const file = ARCHITECTURE.resources[key];
    expect(file).toBe(`architecture-${ARCHITECTURE.hashes[key]}.${key === 'depth' ? 'r16f' : 'r8'}.gz`);
    const unpacked = gunzipSync(readFileSync(`public/${file}`));
    expect(createHash('sha256').update(unpacked).digest('hex')).toBe(ARCHITECTURE.hashes[key]);
    expect(unpacked.length).toBe(ARCHITECTURE.width * ARCHITECTURE.height * (key === 'depth' ? 2 : 1));
  }
});

it('keeps browser fixture pattern bytes identical to the accepted portable export', () => {
  for (const name of ['fixture-stripes', 'fixture-checks']) {
    const source = readFileSync(`../assets/models/architecture/export/depth-reviewed-01/${name}.pattern.png`);
    const served = readFileSync(`proofs/fixtures/architecture/${name}.pattern.png`);
    expect(createHash('sha256').update(served).digest('hex')).toBe(createHash('sha256').update(source).digest('hex'));
    expect(served.length).toBeGreaterThan(500);
  }
});

it('pins lossless RGBA references and original source padding without a canvas conversion', () => {
  const receipt = JSON.parse(readFileSync('proofs/fixtures/architecture/color-rgba.json', 'utf8'));
  const compressed = readFileSync('proofs/fixtures/architecture/color.rgba.bin');
  const rgba = gunzipSync(compressed);
  expect(receipt.sourcePngSha256).toBe(ARCHITECTURE.hashes.color);
  expect(createHash('sha256').update(compressed).digest('hex')).toBe(receipt.gzipSha256);
  expect(createHash('sha256').update(rgba).digest('hex')).toBe(receipt.rgbaSha256);
  expect(rgba.length).toBe(ARCHITECTURE.width * ARCHITECTURE.height * 4);
  expect(Object.keys(receipt.sources)).toHaveLength(168);
  expect(receipt.sources['junction.2222']).toEqual({ width: 320, height: 384,
    rgba_sha256: '1a346ffcc256a27240d32eff49a155128a755c74777cbe12f4fe0d9f07f8c882' });
});
