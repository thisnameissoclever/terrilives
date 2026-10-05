/// <reference types="vite/client" />
import { packBedLayers } from './bed-sprites.js';
import { packDiningSupport } from './dining-support.js';
import { FLOATS_PER_SPRITE } from './sprite-table-layout.js';
export { FLOATS_PER_SPRITE } from './sprite-table-layout.js';

import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  SPRITES,
  SPRITE_PAIRS,
  SPRITE_ANCHORS,
  BED_LAYERS,
  BED_LAYER_TRIMS,
  ATLAS_PAGE_FILES,
  SPRITE_DINING_SUPPORT,
  type AtlasSprite,
} from './atlas.js';
import type { GpuContext } from './device.js';
import {
  BYTES_PER_INSTANCE,
  FLOATS_PER_INSTANCE,
  COLOURWAY_ATTRIBUTE_OFFSET,
  TINT_ATTRIBUTE_OFFSET,
  WALL_ATTRIBUTE_OFFSET,
  VERTICES_PER_QUAD,
  growCapacity,
  decodeArchitectureMode,
  MAX_ARCHITECTURE_FINISH_SLOT,
  type InstanceArray,
} from './instances.js';
import { TILE_HALF_HEIGHT } from './iso.js';
import { AMBIENT_NEUTRAL, type Ambient } from './daylight.js';
import shaderSource from './sprites.wgsl?raw';
import { validateArchitectureAtlas, validateArchitectureDevice, type ArchitectureAtlas } from './architecture-atlas.js';
import { architecturePatternShader } from './architecture-finishes.js';

const INITIAL_CAPACITY = 4096;

/**
 * Returns the content-addressed public URL for the generated texture.
 *
 * GitHub Pages caches public files independently from Vite's hashed
 * JavaScript and ignores query strings in its edge cache key. Without a
 * content-addressed pathname, a returning browser can load a new atlas
 * manifest beside an older cached PNG and abort on the size check.
 */
export function atlasTextureUrl(baseUrl: string, page = 0): string {
  if (!Number.isInteger(page) || page < 0 || page >= ATLAS_PAGE_FILES.length) {
    throw new Error('atlas page index is out of range');
  }
  return `${baseUrl}${ATLAS_PAGE_FILES[page]}`;
}

/**
 * Packs the atlas manifest into the layout `struct Sprite` expects.
 *
 * Built once at start-up. `uv` is normalised because texture coordinates
 * are, while `size` uses logical pixels independent of texture density.
 */
export function packSpriteTable(
  sprites: readonly AtlasSprite[] = SPRITES,
  width = ATLAS_WIDTH,
  height = ATLAS_HEIGHT,
  pairs: Readonly<Record<number, { readonly furniture: number; readonly outline: number }>> = SPRITE_PAIRS,
  anchors: Readonly<Record<number, readonly [number, number]>> = SPRITE_ANCHORS,
  trims: Readonly<Record<number, readonly [number, number]>> = sprites === SPRITES ? BED_LAYER_TRIMS : {},
): Float32Array<ArrayBuffer> {
  // Sized by what the atlas holds. There is no cap to check against any
  // more: the shader's array is runtime-sized, so an atlas of any length
  // indexes correctly rather than clamping past the end.
  //
  // A storage buffer of length zero is invalid in WebGPU, and an empty
  // atlas is a build mistake rather than a state to render, so it is
  // rejected here where the message can say so.
  if (sprites.length === 0) {
    throw new Error(
      'the atlas manifest is empty; every sprite index would be out of ' +
        'range and nothing would draw',
    );
  }
  for (const [key, pair] of Object.entries(pairs)) {
    const body = Number(key);
    const references = [body, pair.furniture, pair.outline];
    if (references.some((i) => !Number.isInteger(i) || i < 0 || i >= sprites.length)) {
      throw new Error('paired sprite index is out of range');
    }
    for (const i of references) {
      if (trims[i]) throw new Error('trim registration cannot overlap a legacy pair role');
      if (sprites[i].w !== sprites[body].w || sprites[i].h !== sprites[body].h ||
          (sprites[i].pixel_density ?? 1) !== (sprites[body].pixel_density ?? 1) ||
          !anchors[i] || !anchors[body] || anchors[i][0] !== anchors[body][0] || anchors[i][1] !== anchors[body][1]) {
        throw new Error('paired sprite registration differs');
      }
    }
  }
  const table = new Float32Array(sprites.length * FLOATS_PER_SPRITE);
  for (const [key, offset] of Object.entries(trims)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= sprites.length
        || offset.length !== 2 || offset.some(value => !Number.isFinite(value) || value < 0)) {
      throw new Error('trim registration is invalid');
    }
  }
  sprites.forEach((sprite, index) => {
    const page = sprite.page ?? 0;
    if (!Number.isInteger(page) || page < 0 || page >= ATLAS_PAGE_FILES.length) {
      throw new Error('sprite page index is out of range');
    }
    const base = index * FLOATS_PER_SPRITE;
    table[base + 0] = sprite.x / width;
    table[base + 1] = sprite.y / height;
    table[base + 2] = (sprite.x + sprite.w) / width;
    table[base + 3] = (sprite.y + sprite.h) / height;
    table[base + 4] = sprite.w / (sprite.pixel_density ?? 1);
    table[base + 5] = sprite.h / (sprite.pixel_density ?? 1);
    if (pairs[index]) {
      table[base + 6] = pairs[index].furniture + 1;
      table[base + 7] = pairs[index].outline + 1;
    }
    table[base + 10] = page;
    if (trims[index]) {
      table[base + 8] = trims[index][0];
      table[base + 9] = trims[index][1];
      table[base + 11] = 1;
    }
  });
  return table;
}

/** Enforce the portable atlas ceiling and the actual device before allocation. */
export function validateAtlasDimensions(width: number, height: number, deviceLimit: number): void {
  const limit = Math.min(8192, deviceLimit);
  if (width > limit || height > limit) {
    throw new Error(`atlas ${width}x${height} exceeds texture dimension limit ${limit}`);
  }
}

export function validateAtlasPageCount(count: number, deviceLimit: number): void {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(deviceLimit)
      || deviceLimit < 1 || count > deviceLimit) {
    throw new Error(`atlas array layer count ${count} exceeds array layer limit ${deviceLimit}`);
  }
}

/**
 * Decodes the content-addressed atlas PNG into a GPU texture.
 *
 * `createImageBitmap` rather than an `Image` element, because
 * `copyExternalImageToTexture` wants a decoded source and an `Image`'s
 * `onload` does not guarantee one. `premultiplyAlpha: 'none'` because
 * the blend mode configured below is straight alpha, not premultiplied;
 * getting that pair wrong darkens every antialiased edge in the game by
 * an amount too small to notice and too consistent to explain.
 */
export async function loadAtlasTexture(device: GPUDevice): Promise<GPUTexture> {
  validateAtlasDimensions(ATLAS_WIDTH, ATLAS_HEIGHT, device.limits.maxTextureDimension2D);
  validateAtlasPageCount(ATLAS_PAGE_FILES.length, device.limits.maxTextureArrayLayers);
  let texture: GPUTexture | undefined;
  try {
    for (let page = 0; page < ATLAS_PAGE_FILES.length; page++) {
      const url = atlasTextureUrl(import.meta.env.BASE_URL, page);
      let response: Response;
      try {
        response = await fetch(url);
      } catch (cause) {
        throw new Error(
          `could not reach the sprite atlas at ${url} - check the server and device connection`,
          { cause },
        );
      }
      if (!response.ok) {
        throw new Error(`the sprite atlas at ${url} returned ${response.status}`);
      }
      const bitmap = await createImageBitmap(await response.blob(), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      try {
        if (bitmap.width !== ATLAS_WIDTH || bitmap.height !== ATLAS_HEIGHT) {
          throw new Error(
            `${ATLAS_PAGE_FILES[page]} is ${bitmap.width}x${bitmap.height} but atlas.ts says ` +
              `${ATLAS_WIDTH}x${ATLAS_HEIGHT}; every sprite rect would be wrong`,
          );
        }
        texture ??= device.createTexture({
          size: {
            width: bitmap.width,
            height: bitmap.height,
            depthOrArrayLayers: ATLAS_PAGE_FILES.length,
          },
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture, origin: [0, 0, page] },
          { width: bitmap.width, height: bitmap.height },
        );
      } finally {
        bitmap.close();
      }
    }
    return texture!;
  } catch (error) {
    texture?.destroy();
    throw error;
  }
}

/**
 * Draws opaque sprites, then short walls in a second instanced draw. Depth
 * starts at the instance's z; edge walls project along their authored plane,
 * and elongated furniture uses its footprint's column midpoint. See
 * [D10]: at 100k objects, not sorting beats sorting well.
 *
 * The pure parts of this - the instance layout and the capacity growth
 * rule - live in `instances.ts` so they can be tested without a GPU.
 * What remains here cannot be honestly tested outside a browser; see
 * `docs/testing-protocol.md` on why a mock would be worse than nothing.
 */
export class SpriteRenderer {
  private readonly pipeline: GPURenderPipeline;
  private readonly lowWallPipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  /** The atlas rect table, uploaded once; the atlas cannot change. */
  private readonly spriteBuffer: GPUBuffer;
  private readonly bedBuffer: GPUBuffer;
  private readonly diningBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private capacity = INITIAL_CAPACITY;
  private instanceBuffer: GPUBuffer;
  private depthTexture: GPUTexture | null = null;
  private readonly ownedTextures: GPUTexture[];
  private readonly ownedBuffers: GPUBuffer[];
  private readonly finishCount: number;
  private destroyed = false;

  /**
   * The floor and opaque walls, uploaded once and then left alone.
   *
   * They live at the FRONT of the instance buffer and the per-frame
   * entities are written after them. The opaque draw uses
   * `staticCount + count` instances; short walls follow in their own draw.
   *
   * Kept as a field rather than written and forgotten because growing
   * the instance buffer destroys and reallocates it, which loses
   * whatever was in it; `ensureCapacity` re-uploads from here.
   */
  private staticInstances: InstanceArray = new Float32Array(0);
  private staticCount = 0;
  private lowWalls: InstanceArray = new Float32Array();
  private lowWallCount = 0;

  /**
   * Scratch for the per-frame uniform upload, allocated once and mutated
   * in place. Layout matches `struct Uniforms` in `sprites.wgsl`:
   * viewport x, viewport y, anchor x, anchor y, then the camera scale at
   * float 4 (byte offset 16), the shared architecture camera origin at 5/6,
   * and one float of padding to the 16-byte uniform stride.
   *
   * [D11] forbids per-frame allocation on the render path, and this is
   * the one allocation there that **no optimiser can remove**: the array
   * is handed to `writeBuffer`, so it escapes into a call the engine
   * cannot see through. It was a fresh `new Float32Array([...])` every
   * frame until the M0 close-out review; at 120 fps that was 120 escaping
   * 16-byte allocations a second, for four numbers of which two change.
   *
   * The viewport pair is rewritten each frame rather than cached because
   * the canvas can be resized under the caller at any time, and a stale
   * viewport silently rescales every quad's clip-space position instead
   * of erroring. The scale is rewritten each frame for the same reason:
   * it is the caller's camera, and a cached copy is a zoom that applies
   * to the sprite sizes one frame after it applied to the positions.
   */
  private readonly uniformData = new Float32Array([
    0,
    0,
    0,
    TILE_HALF_HEIGHT,
    1,
    0,
    0,
    0,
    // The ambient tint, floats 8 to 11 (byte offset 32). Neutral until a
    // caller passes an hour, so a renderer driven without one looks the
    // same as it did before the cycle existed rather than black.
    1,
    1,
    1,
    1,
    // [OS-daylight]: the sky's interior shade now, float 12 (byte offset
    // 48), and padding. Zero until a caller passes one, which draws every
    // instance fully exposed, as before.
    0,
    0,
    0,
    0,
  ]);

  /**
   * Builds the pipeline and uploads the atlas.
   *
   * Asynchronous, and a static factory rather than a constructor,
   * because decoding a PNG is. Everything the first `draw` needs is
   * finished by the time this resolves, so no frame can ever sample an
   * empty texture.
   */
  static async create(gpu: GpuContext, architecture?: ArchitectureAtlas): Promise<SpriteRenderer> {
    if (architecture) {
      validateArchitectureAtlas(architecture);
      validateArchitectureDevice(architecture, gpu.device.limits, SPRITES.length);
      validateAtlasDimensions(architecture.width, architecture.height, gpu.device.limits.maxTextureDimension2D);
    }
    const texture = await loadAtlasTexture(gpu.device);
    const textures = [texture], buffers: GPUBuffer[] = [];
    try { return new SpriteRenderer(gpu, texture, architecture, textures, buffers); }
    catch (error) {
      for (const resource of textures) resource.destroy();
      for (const resource of buffers) resource.destroy();
      throw error;
    }
  }

  private constructor(
    private readonly gpu: GpuContext,
    atlasTexture: GPUTexture,
    architecture?: ArchitectureAtlas,
    textures: GPUTexture[] = [],
    buffers: GPUBuffer[] = [],
  ) {
    this.ownedTextures = textures;
    this.ownedBuffers = buffers;
    this.finishCount = architecture?.finishes?.keys.length ?? 0;
    this.uniformData[13] = SPRITES.length;
    const patternCount = architecture?.patterns?.length ?? 0;
    const module = gpu.device.createShaderModule({ code: shaderSource.replace(
      '// ARCHITECTURE_PATTERN_BINDINGS', architecturePatternShader(patternCount)) });
    const bindGroupLayout = gpu.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 7, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ...Array.from({ length: patternCount }, (_, index): GPUBindGroupLayoutEntry => ({
        binding: 11 + index, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' },
      })),
      { binding: 9, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 10, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ] });
    const layout = gpu.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    const descriptor: GPURenderPipelineDescriptor = {
      layout,
      vertex: {
        module,
        entryPoint: 'vs',
        constants: { maxArchitectureFinishSlot: MAX_ARCHITECTURE_FINISH_SLOT },
        buffers: [
          {
            arrayStride: BYTES_PER_INSTANCE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              // [ML-tint]. One buffer with interleaved attributes -
              // not a second vertex buffer. Both halves belong to the
              // same instance and are written together by
              // `writeInstance`, so splitting them across buffers would
              // mean two uploads and two chances for the counts to
              // disagree, for nothing.
              {
                shaderLocation: 1,
                offset: TINT_ATTRIBUTE_OFFSET,
                format: 'float32x4',
              },
              { shaderLocation: 2, offset: WALL_ATTRIBUTE_OFFSET, format: 'float32x4' },
              // [RC-render]: the colourway shift, all zero for the art as drawn.
              { shaderLocation: 3, offset: COLOURWAY_ATTRIBUTE_OFFSET, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        constants: { maxArchitectureFinishSlot: MAX_ARCHITECTURE_FINISH_SLOT },
        targets: [
          {
            format: gpu.format,
            // Straight (non-premultiplied) alpha, matching the
            // `premultiplyAlpha: 'none'` the atlas is decoded with. Only
            // the antialiased fringe of each sprite reaches this: the
            // shader discards anything below half alpha, so the interior
            // is opaque and the depth buffer still decides what covers
            // what.
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    };
    this.pipeline = gpu.device.createRenderPipeline(descriptor);
    this.lowWallPipeline = gpu.device.createRenderPipeline({ ...descriptor,
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    this.instanceBuffer = gpu.device.createBuffer({
      size: this.capacity * BYTES_PER_INSTANCE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    buffers.push(this.instanceBuffer);

    this.uniformBuffer = gpu.device.createBuffer({
      // 64: viewport, anchor, the camera scale padded to the 16-byte
      // uniform stride, the ambient tint, then the sky's shade. Must match
      // `uniformData` above and `struct Uniforms` in sprites.wgsl. Too SMALL
      // and WebGPU rejects the bind group; too large is merely wasted.
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    buffers.push(this.uniformBuffer);

    // The sprite table never changes after this: the atlas is a
    // committed artifact, so its rects are fixed for the session.
    const historical = packSpriteTable();
    const extra = architecture ? packSpriteTable(architecture.sprites, architecture.width, architecture.height, {}, {}) : new Float32Array();
    const spriteTable = new Float32Array(historical.length + extra.length);
    spriteTable.set(historical); spriteTable.set(extra, historical.length);
    this.spriteBuffer = gpu.device.createBuffer({
      size: spriteTable.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    buffers.push(this.spriteBuffer);
    gpu.device.queue.writeBuffer(this.spriteBuffer, 0, spriteTable);

    const architectureSize = { width: architecture?.width ?? 1, height: architecture?.height ?? 1 };
    const architectureDepth = gpu.device.createTexture({ size: architectureSize,
      format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    textures.push(architectureDepth);
    gpu.device.queue.writeTexture({ texture: architectureDepth }, architecture?.depth ?? new Uint16Array(1),
      { bytesPerRow: architectureSize.width * 2 }, architectureSize);
    const architectureColor = gpu.device.createTexture({ size: { ...architectureSize,
      depthOrArrayLayers: architecture?.carrier ? 2 : 1 }, format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    textures.push(architectureColor);
    if (architecture) gpu.device.queue.copyExternalImageToTexture({ source: architecture.color },
      { texture: architectureColor }, architectureSize);
    if (architecture?.carrier) gpu.device.queue.copyExternalImageToTexture({ source: architecture.carrier },
      { texture: architectureColor, origin: { z: 1 } }, architectureSize);
    const roleSize = architecture?.roles ? architectureSize : { width: 1, height: 1 };
    const roles = gpu.device.createTexture({ size: roleSize, format: 'r8uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    textures.push(roles);
    gpu.device.queue.writeTexture({ texture: roles }, architecture?.roles ?? new Uint8Array(1),
      { bytesPerRow: roleSize.width }, roleSize);
    const storage = (data: Float32Array<ArrayBuffer>): GPUBuffer => {
      const buffer = gpu.device.createBuffer({ size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      buffers.push(buffer); gpu.device.queue.writeBuffer(buffer, 0, data); return buffer;
    };
    const registration = storage(architecture?.registration
      ?? new Float32Array(Math.max(1, architecture?.sprites.length ?? 0) * 4));
    const finishes = storage(architecture?.finishes?.table ?? new Float32Array(8));
    const patternTextures = (architecture?.patterns ?? []).map(bitmap => {
      const texture = gpu.device.createTexture({ size: { width: bitmap.width, height: bitmap.height },
        format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.RENDER_ATTACHMENT });
      textures.push(texture);
      gpu.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture },
        { width: bitmap.width, height: bitmap.height });
      return texture;
    });
    const bedTable = packBedLayers(SPRITES.length + (architecture?.sprites.length ?? 0), BED_LAYERS);
    this.bedBuffer = gpu.device.createBuffer({ size: bedTable.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    buffers.push(this.bedBuffer);
    gpu.device.queue.writeBuffer(this.bedBuffer, 0, bedTable);
    const diningTable = packDiningSupport(SPRITES.length + (architecture?.sprites.length ?? 0), SPRITE_DINING_SUPPORT);
    this.diningBuffer = gpu.device.createBuffer({ size: diningTable.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    buffers.push(this.diningBuffer);
    gpu.device.queue.writeBuffer(this.diningBuffer, 0, diningTable);
    this.bindGroup = gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.spriteBuffer } },
        {
          binding: 2,
          // Linear filtering smooths motion and fractional zoom. The shader
          // clamps to each sprite's texel centres; sampler clamp-to-edge
          // alone protects only the outside of the complete atlas.
          resource: gpu.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
          }),
        },
        // The bind group keeps the texture alive, so nothing here holds
        // a second reference to it.
        { binding: 3, resource: atlasTexture.createView({ dimension: '2d-array' }) },
        { binding: 4, resource: architectureDepth.createView() },
        { binding: 5, resource: architectureColor.createView({ dimension: '2d-array' }) },
        { binding: 6, resource: roles.createView() },
        { binding: 7, resource: { buffer: registration } },
        { binding: 8, resource: { buffer: finishes } },
        ...patternTextures.map((texture, index) => ({ binding: 11 + index, resource: texture.createView() })),
        { binding: 9, resource: { buffer: this.bedBuffer } },
        { binding: 10, resource: { buffer: this.diningBuffer } },
      ],
    });
  }

  /**
   * Uploads the lot's floor and walls, once per CAMERA change.
   *
   * They are static between camera moves, so they are **not** rebuilt
   * per frame - `main.ts`'s dirty flag calls this only when the zoom,
   * the pan or the window actually moved. `buildInstances` runs every
   * frame under [D11]'s no-allocation rule, and [V11] measured what
   * happens when something on that path allocates without anybody
   * checking: 57.76 MB over 2,394 frames from a two-element array.
   *
   * `instances` is `tiles.ts`'s reused scratch, so the field below
   * ALIASES it: the held reference always sees the latest rebuild's
   * content, and the pair stays coherent because every rebuild comes
   * straight back through here with its own count. The re-upload in
   * `ensureCapacity` therefore re-sends current data, never a stale
   * snapshot.
   */
  setStaticGeometry(instances: InstanceArray, count: number, lowWalls: InstanceArray = new Float32Array()): void {
    this.validateFinishSlots(instances, count);
    this.validateFinishSlots(lowWalls, lowWalls.length / FLOATS_PER_INSTANCE);
    this.staticInstances = instances;
    this.staticCount = count;
    this.lowWalls = lowWalls;
    this.lowWallCount = lowWalls.length / FLOATS_PER_INSTANCE;
    this.ensureCapacity(count);
    this.uploadStatic();
  }

  private validateFinishSlots(rows: InstanceArray, count: number): void {
    for (let index = 0; index < count; index++) {
      const mode = decodeArchitectureMode(rows[index * FLOATS_PER_INSTANCE + 8]);
      if (mode && mode.finishSlot > this.finishCount) throw new Error('Architecture finish slot was not loaded');
    }
  }

  /** Release only this renderer's resources. The caller owns the shared device. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.depthTexture?.destroy();
    this.instanceBuffer.destroy();
    for (const resource of this.ownedTextures) resource.destroy();
    for (const resource of this.ownedBuffers) resource.destroy();
  }

  /** Shared camera origin for opt-in canonical floor vertices. Ordinary sprites ignore it. */
  setArchitectureCamera(originX: number, originY: number): void {
    this.uniformData[5] = originX;
    this.uniformData[6] = originY;
  }

  private uploadStatic(): void {
    if (this.staticCount === 0) return;
    this.gpu.device.queue.writeBuffer(
      this.instanceBuffer,
      0,
      this.staticInstances,
      0,
      this.staticCount * FLOATS_PER_INSTANCE,
    );
  }

  private ensureCapacity(count: number): void {
    const grown = growCapacity(this.capacity, count);
    if (grown === this.capacity) return;
    this.capacity = grown;
    this.instanceBuffer.destroy();
    this.instanceBuffer = this.gpu.device.createBuffer({
      size: this.capacity * BYTES_PER_INSTANCE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    // A destroyed buffer takes the static block with it. Re-uploading is
    // what keeps the floor and the walls on screen after the first frame
    // that pushes the entity count past a power of two.
    this.uploadStatic();
  }

  private ensureDepth(width: number, height: number): GPUTexture {
    if (
      this.depthTexture &&
      this.depthTexture.width === width &&
      this.depthTexture.height === height
    ) {
      return this.depthTexture;
    }
    this.depthTexture?.destroy();
    this.depthTexture = this.gpu.device.createTexture({
      size: { width, height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    return this.depthTexture;
  }

  /**
   * @param ambient The hour of day as an rgba multiplier, from
   *   `ambientFor` in daylight.ts. Defaults to neutral, so a caller that
   *   does not care about the clock gets the pre-cycle appearance rather
   *   than an unlit world.
   * @param skyShade How much of the day's light a fully shaded instance
   *   loses this frame ([OS-daylight]); 0 draws every instance fully lit.
   */
  draw(
    instances: InstanceArray,
    count: number,
    scale = 1,
    ambient: Ambient = AMBIENT_NEUTRAL,
    skyShade = 0,
  ): void {
    const total = this.staticCount + count;
    if (total + this.lowWallCount === 0) return;
    this.ensureCapacity(total + this.lowWallCount);

    const canvas = this.gpu.context.canvas as HTMLCanvasElement;
    this.uniformData[0] = canvas.width;
    this.uniformData[1] = canvas.height;
    this.uniformData[4] = scale;
    this.uniformData[8] = ambient[0];
    this.uniformData[9] = ambient[1];
    this.uniformData[10] = ambient[2];
    this.uniformData[11] = ambient[3];
    this.uniformData[12] = skyShade;
    this.gpu.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    if (count > 0) {
      // dataOffset and size are in elements for a TypedArray source, so
      // the caller's scratch buffer may be longer than the live entity
      // count. The byte offset is where the static block ends.
      this.gpu.device.queue.writeBuffer(
        this.instanceBuffer,
        this.staticCount * BYTES_PER_INSTANCE,
        instances,
        0,
        count * FLOATS_PER_INSTANCE,
      );
    }
    if (this.lowWallCount > 0) {
      this.gpu.device.queue.writeBuffer(this.instanceBuffer, total * BYTES_PER_INSTANCE, this.lowWalls);
    }

    const depth = this.ensureDepth(canvas.width, canvas.height);
    const encoder = this.gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpu.context.getCurrentTexture().createView(),
          clearValue: { r: 0.09, g: 0.09, b: 0.11, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.instanceBuffer);
    // Opaque floor, rear walls, objects and Sims establish depth first.
    pass.draw(VERTICES_PER_QUAD, total);
    if (this.lowWallCount > 0) {
      pass.setPipeline(this.lowWallPipeline);
      pass.draw(VERTICES_PER_QUAD, this.lowWallCount, 0, total);
    }
    pass.end();

    this.gpu.device.queue.submit([encoder.finish()]);
  }
}
