import { afterEach, expect, it, vi } from 'vitest';
import { ARCHITECTURE } from '../src/render/architecture-data.js';
import { prepareArchitectureFinishes } from '../src/render/architecture-finishes.js';
import { SpriteFinishResources } from '../src/render/sprite-finish-resources.js';
afterEach(() => vi.unstubAllGlobals());

function fixture(colorSize: { width: number; height: number } = { width: ARCHITECTURE.width, height: ARCHITECTURE.height }) {
  vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 8 });
  vi.stubGlobal('GPUBufferUsage', { COPY_DST: 1, STORAGE: 2 });
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
  const textures: { destroy: ReturnType<typeof vi.fn>; createView: () => object; width: number; height: number; depthOrArrayLayers: number; format: string }[] = [];
  const makeTexture = (d: GPUTextureDescriptor) => {
    const size = d.size as GPUExtent3DDict;
    const t = { width: size.width, height: size.height ?? 1, depthOrArrayLayers: size.depthOrArrayLayers ?? 1,
      format: d.format, destroy: vi.fn(), createView: () => ({}) }; textures.push(t); return t;
  };
  const queue = { writeBuffer: vi.fn(), writeTexture: vi.fn(), copyExternalImageToTexture: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: vi.fn(async () => {}) };
  const device = { limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256, maxSampledTexturesPerShaderStage: 16, maxStorageBufferBindingSize: 128 * 1024 * 1024 },
    queue, createTexture: vi.fn(makeTexture), createBuffer: vi.fn(() => ({ destroy: vi.fn() })), createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})), createRenderPipelineAsync: vi.fn(async () => ({})),
    createBindGroup: vi.fn(() => ({})), pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => null),
    createCommandEncoder: vi.fn(() => ({ copyTextureToTexture: vi.fn(), finish: () => ({}) })) } as unknown as GPUDevice;
  const color = makeTexture({ size: colorSize, format: 'rgba8unorm', usage: 0 });
  const roles = makeTexture({ size: { width: 1, height: 1 }, format: 'r8uint', usage: 0 });
  const load = vi.fn(async (_active, missing, promotion, consume) => {
    if (promotion) { await consume({ kind: 'carrier', bitmap: { width: ARCHITECTURE.width, height: ARCHITECTURE.height } });
      await consume({ kind: 'roles', bytes: new Uint8Array(1) }); }
    for (const key of missing) await consume({ kind: 'pattern', key, bitmap: { width: 256, height: 256 } });
  });
  const manager = new SpriteFinishResources({ device, color: color as unknown as GPUTexture, roles: roles as unknown as GPUTexture,
    table: device.createBuffer({ size: 32, usage: 0 }), patterns: [], finishes: prepareArchitectureFinishes([], device.limits),
    pipelines: { opaque: {} as GPURenderPipeline, lowWall: {} as GPURenderPipeline, grime: {} as GPURenderPipeline, annotation: {} as GPURenderPipeline,
      layout: {} as GPUBindGroupLayout }, bindGroup: {} as GPUBindGroup, fixedEntries: [], jointEntries: [{ resource: {} as GPUTextureView }, { resource: { buffer: {} as GPUBuffer } }],
    load });
  return { manager, device, load, textures, color, roles };
}

it('promotes architecture once and reuses retained patterns and pipeline variants on reselect', async () => {
  const f = fixture(), first = await f.manager.prepare(['floor.outdoor-patio']);
  expect(f.load.mock.calls[0][1]).toEqual(['tiles']); expect(f.load.mock.calls[0][2]).toBe(true);
  f.manager.publish(first, () => {}); await Promise.resolve(); await Promise.resolve();
  expect(f.color.destroy).toHaveBeenCalledOnce(); expect(f.roles.destroy).toHaveBeenCalledOnce();
  const count = f.textures.length;
  f.manager.publish(await f.manager.prepare([]), () => {});
  const second = await f.manager.prepare(['floor.outdoor-patio']); f.manager.publish(second, () => {});
  expect(f.textures).toHaveLength(count);
  expect(f.load.mock.calls.slice(1).every(call => call[1].length === 0 && call[2] === false)).toBe(true);
  expect(f.device.createRenderPipelineAsync).toHaveBeenCalledTimes(4);
});

it('discards an abandoned promotion, preserves live textures, and rolls back failed geometry publication', async () => {
  const f = fixture(), before = f.manager.state, next = await f.manager.prepare(['floor.outdoor-patio']);
  expect(() => f.manager.publish(next, () => { throw Error('geometry'); })).toThrow('geometry');
  expect(f.manager.state).toBe(before); f.manager.discard(next);
  await Promise.resolve(); await Promise.resolve();
  expect(f.color.destroy).not.toHaveBeenCalled(); expect(f.roles.destroy).not.toHaveBeenCalled();
  expect(f.textures.slice(2).every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
});

it('keeps shared resident patterns alive when a later candidate is discarded and rejects use after disposal', async () => {
  const f = fixture(); f.manager.publish(await f.manager.prepare(['floor.outdoor-patio']), () => {});
  const pattern = f.textures.at(-1)!;
  const next = await f.manager.prepare(['floor.outdoor-patio']); f.manager.discard(next);
  await Promise.resolve(); await Promise.resolve(); expect(pattern.destroy).not.toHaveBeenCalled();
  f.manager.destroy(); expect(pattern.destroy).toHaveBeenCalledOnce();
  await expect(f.manager.prepare([])).rejects.toThrow(/disposed/);
});

it('retires promoted textures only after their queued readers complete', async () => {
  const f = fixture(), next = await f.manager.prepare(['floor.outdoor-patio']);
  let release!: () => void;
  vi.mocked(f.device.queue.onSubmittedWorkDone).mockReturnValue(new Promise<undefined>(resolve => { release = () => resolve(undefined); }));
  f.manager.publish(next, () => {}); expect(f.color.destroy).not.toHaveBeenCalled();
  release(); await Promise.resolve(); await Promise.resolve(); expect(f.color.destroy).toHaveBeenCalledOnce();
});

it('reuses the pattern and pipelines when another finish changes its palette and period', async () => {
  const f = fixture(); f.manager.publish(await f.manager.prepare(['floor.outdoor-patio']), () => {});
  const color = f.manager.state.color, count = f.textures.length, previous = [...f.manager.state.finishes.table];
  const next = await f.manager.prepare(['floor.tiles']); f.manager.publish(next, () => {});
  expect(f.manager.state.color).toBe(color); expect(f.textures).toHaveLength(count);
  expect([...f.manager.state.finishes.table]).not.toEqual(previous);
  expect(f.device.createRenderPipelineAsync).toHaveBeenCalledTimes(4);
  expect(f.load.mock.calls.at(-1)![1]).toEqual([]);
});

it('rejects a candidate prepared against a state that was subsequently replaced', async () => {
  const f = fixture(), promoted = await f.manager.prepare(['floor.outdoor-patio']), oldBase = await f.manager.prepare([]);
  f.manager.publish(promoted, () => {});
  expect(() => f.manager.publish(oldBase, () => {})).toThrow(/stale/i);
  f.manager.discard(oldBase); expect(f.manager.state.finishes.keys).toEqual(['floor.outdoor-patio']);
});

it('counts retained and preparing allocations together before fetching', async () => {
  const f = fixture({ width: 4096, height: 4096 });
  await expect(f.manager.prepare(['floor.outdoor-patio'])).rejects.toThrow(/retained and preparing/);
  expect(f.load).not.toHaveBeenCalled(); expect(f.textures).toHaveLength(2);
});

it('cleans partial resources on pipeline validation failure and can explicitly retry', async () => {
  const f = fixture(); vi.mocked(f.device.createRenderPipelineAsync).mockRejectedValueOnce(new Error('invalid shader'));
  await expect(f.manager.prepare(['floor.outdoor-patio'])).rejects.toThrow('invalid shader');
  await Promise.resolve(); await Promise.resolve();
  expect(f.textures.slice(2).every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
  expect(f.color.destroy).not.toHaveBeenCalled();
  f.manager.publish(await f.manager.prepare(['floor.outdoor-patio']), () => {});
  expect(f.manager.state.finishes.keys).toEqual(['floor.outdoor-patio']);
});

it('rejects an old-device preparation after destruction without leaking or double-destroying its textures', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  f.load.mockImplementationOnce(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); });
  const next = f.manager.prepare(['floor.outdoor-patio']); await ready;
  f.manager.destroy(); release(); await expect(next).rejects.toThrow(/disposed/);
  await Promise.resolve(); await Promise.resolve();
  expect(f.textures.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
});

it('fences attempted image uploads before the loader closes a bitmap on validation failure', async () => {
  const f = fixture(), order: string[] = [];
  vi.mocked(f.device.queue.copyExternalImageToTexture).mockImplementation(() => { order.push('copy'); });
  vi.mocked(f.device.queue.onSubmittedWorkDone).mockImplementation(async () => { order.push('fence'); });
  vi.mocked(f.device.popErrorScope).mockImplementation(async () => order.at(-1) === 'copy' ? { message: 'invalid copy' } as GPUError : null);
  f.load.mockImplementationOnce(async (_active, _missing, _promotion, consume) => {
    try { await consume({ kind: 'carrier', bitmap: { width: ARCHITECTURE.width, height: ARCHITECTURE.height } }); }
    finally { order.push('close'); }
  });
  await expect(f.manager.prepare(['floor.outdoor-patio'])).rejects.toThrow('invalid copy');
  expect(order.slice(0, 3)).toEqual(['copy', 'fence', 'close']);
});
