import { ARCHITECTURE } from './architecture-data.js';
import { loadArchitectureFinishInputs } from './architecture-atlas.js';
import { architecturePatternIdentity, prepareArchitectureFinishes, type ActiveFinishes, type PatternResource } from './architecture-finishes.js';
import { spriteShaderSource, spriteBindGroupLayoutEntries, spritePipelineDescriptors } from './sprite-pipelines.js';
import type { LoadProgress } from '../load-progress.js';

export interface SpriteFinishPipelines {
  readonly opaque: GPURenderPipeline; readonly lowWall: GPURenderPipeline;
  readonly grime: GPURenderPipeline; readonly annotation: GPURenderPipeline; readonly layout: GPUBindGroupLayout;
}
interface PatternLease { readonly texture: GPUTexture; references: number; retained: boolean }
export interface SpriteFinishState {
  readonly pipelines: SpriteFinishPipelines; readonly bindGroup: GPUBindGroup; readonly table: GPUBuffer;
  readonly finishes: ActiveFinishes; readonly color: GPUTexture; readonly roles: GPUTexture;
}
export interface PreparedFloorFinishes {
  readonly finishes: ActiveFinishes; readonly device: GPUDevice; readonly generation: number;
}
interface Candidate { readonly state: SpriteFinishState; readonly previous: SpriteFinishState;
  readonly leases: PatternLease[]; readonly promotion: boolean }
interface InitialResources extends SpriteFinishState {
  readonly device: GPUDevice; readonly patterns: readonly GPUTexture[];
  readonly fixedEntries: readonly GPUBindGroupEntry[];
  readonly jointEntries: readonly Omit<GPUBindGroupEntry, 'binding'>[];
  readonly load?: typeof loadArchitectureFinishInputs;
}
const MEMORY_BUDGET = 128 * 1024 * 1024;
const resources: Readonly<Record<string, PatternResource>> = ARCHITECTURE.patterns;
const identity = (key: string): string => {
  const resource = resources[key];
  return resource ? architecturePatternIdentity(resource) : `initial:${key}`;
};

/** Owns only replaceable finish bindings and the bounded device-lifetime pattern cache. */
export class SpriteFinishResources {
  private current: SpriteFinishState;
  private promoted: boolean;
  private generation = 0;
  private disposed = false;
  private preparing = false;
  private readonly patterns = new Map<string, PatternLease>();
  private readonly variants = new Map<number, SpriteFinishPipelines>();
  private readonly candidates = new Map<PreparedFloorFinishes, Candidate>();
  private readonly allocations = new Map<GPUTexture | GPUBuffer, number>();
  private readonly device: GPUDevice;
  constructor(private readonly initial: InitialResources) {
    this.device = initial.device; this.current = initial;
    this.promoted = initial.color.depthOrArrayLayers > 1;
    this.variants.set(initial.patterns.length, initial.pipelines);
    this.track(initial.color, initial.color.width * initial.color.height * initial.color.depthOrArrayLayers * 4);
    this.track(initial.roles, initial.roles.width * initial.roles.height);
    this.track(initial.table, initial.finishes.table.byteLength);
    initial.patterns.forEach((texture, index) => {
      this.track(texture, texture.width * texture.height * 4);
      this.patterns.set(identity(initial.finishes.resources[index]), { texture, references: 0, retained: true });
    });
  }
  get state(): SpriteFinishState { return this.current; }
  private assertLive(generation = this.generation): void {
    if (this.disposed || generation !== this.generation) throw new Error('Floor resources belong to a disposed graphics device');
  }
  private track<T extends GPUTexture | GPUBuffer>(resource: T, bytes: number): T { this.allocations.set(resource, bytes); return resource; }
  private release(resource: GPUTexture | GPUBuffer): void {
    if (this.allocations.delete(resource)) resource.destroy();
  }
  private retire(values: readonly (GPUTexture | GPUBuffer)[]): void {
    // Keep retired allocations in the budget until submitted readers have completed.
    void this.device.queue.onSubmittedWorkDone().then(() => { for (const value of values) this.release(value); },
      () => { for (const value of values) this.release(value); });
  }
  private releaseLeases(leases: readonly PatternLease[]): void {
    const retired: GPUTexture[] = [];
    for (const lease of leases) {
      lease.references--;
      if (!lease.references && !lease.retained) {
        for (const [key, entry] of this.patterns) if (entry === lease) this.patterns.delete(key);
        retired.push(lease.texture);
      }
    }
    this.retire(retired);
  }
  private async checked<T>(work: () => T): Promise<T> {
    this.device.pushErrorScope('validation'); this.device.pushErrorScope('out-of-memory');
    let value!: T, failure: unknown;
    try { value = work(); } catch (error) { failure = error; }
    // Pop in the same turn so unrelated frames cannot enter these scopes.
    const memory = this.device.popErrorScope(), validation = this.device.popErrorScope();
    const errors = await Promise.all([memory, validation]);
    if (failure) throw failure;
    const error = errors.find(Boolean); if (error) throw new Error(`Floor graphics preparation failed: ${error.message}`);
    return value;
  }
  private async pipelines(count: number): Promise<SpriteFinishPipelines> {
    const cached = this.variants.get(count); if (cached) return cached;
    const { layout, descriptors } = await this.checked(() => {
      const module = this.device.createShaderModule({ code: spriteShaderSource(count) });
      const layout = this.device.createBindGroupLayout({ entries: spriteBindGroupLayoutEntries(count) });
      return { layout, descriptors: spritePipelineDescriptors(module, this.device.createPipelineLayout({ bindGroupLayouts: [layout] })) };
    });
    const [opaque, lowWall, grime, annotation] = await Promise.all([
      this.device.createRenderPipelineAsync(descriptors.opaque), this.device.createRenderPipelineAsync(descriptors.lowWall),
      this.device.createRenderPipelineAsync(descriptors.grime), this.device.createRenderPipelineAsync(descriptors.annotation),
    ]);
    this.assertLive();
    const result = { opaque, lowWall, grime, annotation, layout }; this.variants.set(count, result); return result;
  }
  async prepare(keys: readonly string[], progress?: LoadProgress): Promise<PreparedFloorFinishes> {
    this.assertLive();
    if (this.preparing) throw new Error('Floor preparations must be serialized');
    const generation = this.generation, previous = this.current, finishes = prepareArchitectureFinishes(keys, this.device.limits);
    const missing = finishes.resources.filter(key => !this.patterns.has(identity(key)));
    const promotion = finishes.keys.length > 0 && !this.promoted;
    const pixels = ARCHITECTURE.width * ARCHITECTURE.height;
    const planned = finishes.table.byteLength + missing.reduce((sum, key) => sum + resources[key].width * resources[key].height * 4, 0)
      + (promotion ? pixels * 9 : 0);
    // Include depth, registration, retained cache, candidates and queued retirement.
    const resident = pixels * 2 + ARCHITECTURE.sprites.length * 16 + [...this.allocations.values()].reduce((sum, bytes) => sum + bytes, 0);
    if (resident + planned > MEMORY_BUDGET) throw new Error('Architecture retained and preparing resources exceed the resident memory budget');
    this.preparing = true;
    let color = this.current.color, roles = this.current.roles, table: GPUBuffer | undefined;
    const owned: GPUTexture[] = [], leases: PatternLease[] = [];
    try {
      for (const key of finishes.resources) {
        const lease = this.patterns.get(identity(key)); if (lease) { lease.references++; leases.push(lease); }
      }
      if (promotion) await this.checked(() => {
        color = this.track(this.device.createTexture({ size: { width: ARCHITECTURE.width, height: ARCHITECTURE.height, depthOrArrayLayers: 2 },
          format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }), pixels * 8);
        owned.push(color);
        roles = this.track(this.device.createTexture({ size: { width: ARCHITECTURE.width, height: ARCHITECTURE.height },
          format: 'r8uint', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING }), pixels);
        owned.push(roles);
        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToTexture({ texture: this.current.color }, { texture: color }, [ARCHITECTURE.width, ARCHITECTURE.height, 1]);
        this.device.queue.submit([encoder.finish()]);
      });
      await (this.initial.load ?? loadArchitectureFinishInputs)(finishes, missing, promotion, async input => {
        this.assertLive(generation);
        try { await this.checked(() => {
          if (input.kind === 'roles') {
            this.device.queue.writeTexture({ texture: roles }, input.bytes, { bytesPerRow: ARCHITECTURE.width }, [ARCHITECTURE.width, ARCHITECTURE.height]);
          } else {
            let texture = color;
            if (input.kind === 'pattern') {
              texture = this.track(this.device.createTexture({ size: { width: input.bitmap.width, height: input.bitmap.height }, format: 'rgba8unorm',
                usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }), input.bitmap.width * input.bitmap.height * 4);
              const lease = { texture, references: 1, retained: false };
              this.patterns.set(identity(input.key), lease); leases.push(lease);
            }
            this.device.queue.copyExternalImageToTexture({ source: input.bitmap },
              { texture, origin: { z: input.kind === 'carrier' ? 1 : 0 } }, [input.bitmap.width, input.bitmap.height]);
          }
        });
        } finally { await this.device.queue.onSubmittedWorkDone(); }
        this.assertLive(generation);
      }, { progress });
      this.assertLive(generation);
      const pipelines = await this.pipelines(finishes.resources.length); this.assertLive(generation);
      const bindGroup = await this.checked(() => {
        table = this.track(this.device.createBuffer({ size: finishes.table.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }), finishes.table.byteLength);
        this.device.queue.writeBuffer(table, 0, finishes.table);
        return this.device.createBindGroup({ layout: pipelines.layout, entries: [
          ...this.initial.fixedEntries, { binding: 5, resource: color.createView({ dimension: '2d-array' }) },
          { binding: 6, resource: roles.createView() }, { binding: 8, resource: { buffer: table } },
          ...finishes.resources.map((key, index) => ({ binding: 11 + index, resource: this.patterns.get(identity(key))!.texture.createView() })),
          ...this.initial.jointEntries.map((entry, index) => ({ ...entry, binding: 11 + finishes.resources.length + index })),
        ] });
      });
      this.assertLive(generation);
      const candidate = { finishes, device: this.device, generation };
      this.candidates.set(candidate, { state: { pipelines, bindGroup, table: table!, finishes, color, roles }, previous, leases, promotion });
      return candidate;
    } catch (error) {
      this.releaseLeases(leases); this.retire([...owned, ...(table ? [table] : [])]); throw error;
    } finally { this.preparing = false; }
  }
  publish(candidate: PreparedFloorFinishes, rebuildGeometry: () => void): void {
    this.assertLive(candidate.generation);
    const next = this.candidates.get(candidate);
    if (!next || candidate.device !== this.device) throw new Error('Unknown floor preparation');
    if (next.previous !== this.current) throw new Error('Stale floor preparation');
    const previous = this.current; this.current = next.state;
    try { rebuildGeometry(); } catch (error) { this.current = previous; throw error; }
    this.candidates.delete(candidate);
    for (const lease of next.leases) lease.retained = true;
    this.releaseLeases(next.leases);
    if (next.promotion) this.promoted = true;
    this.retire([previous.table, ...(next.promotion ? [previous.color, previous.roles] : [])]);
  }
  discard(candidate: PreparedFloorFinishes): void {
    const next = this.candidates.get(candidate); if (!next) return;
    this.candidates.delete(candidate); this.releaseLeases(next.leases);
    this.retire([next.state.table, ...(next.promotion ? [next.state.color, next.state.roles] : [])]);
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    for (const resource of this.allocations.keys()) this.release(resource);
    this.candidates.clear(); this.patterns.clear(); this.variants.clear();
  }
}
