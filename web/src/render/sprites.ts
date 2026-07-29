/// <reference types="vite/client" />

import atlasImageUrl from '../../../assets/sprites/atlas.png';
import { ATLAS_HEIGHT, ATLAS_WIDTH, SPRITES } from './atlas.js';
import type { GpuContext } from './device.js';
import {
  BYTES_PER_INSTANCE,
  FLOATS_PER_INSTANCE,
  MAX_SPRITES,
  VERTICES_PER_QUAD,
  growCapacity,
  type InstanceArray,
} from './instances.js';
import { TILE_HALF_HEIGHT } from './iso.js';
import shaderSource from './sprites.wgsl?raw';

const INITIAL_CAPACITY = 4096;

/** Floats per entry of the `Atlas` uniform array: `uv` plus `size`. */
const FLOATS_PER_SPRITE = 8;

/**
 * Packs the atlas manifest into the layout `struct Sprite` expects.
 *
 * Built once at start-up. `uv` is normalised because texture coordinates
 * are, and `size` stays in pixels because the quad is drawn one texel to
 * one pixel - so the manifest's `w` and `h` are simultaneously the
 * sprite's extent in the atlas and its extent on screen.
 */
function packSpriteTable(): Float32Array<ArrayBuffer> {
  if (SPRITES.length > MAX_SPRITES) {
    throw new Error(
      `the atlas holds ${SPRITES.length} sprites and sprites.wgsl declares ` +
        `room for ${MAX_SPRITES}; WGSL clamps an out-of-range uniform array ` +
        `index instead of trapping, so the extras would silently draw as ` +
        `sprite ${MAX_SPRITES - 1}`,
    );
  }
  const table = new Float32Array(MAX_SPRITES * FLOATS_PER_SPRITE);
  SPRITES.forEach((sprite, index) => {
    const base = index * FLOATS_PER_SPRITE;
    table[base + 0] = sprite.x / ATLAS_WIDTH;
    table[base + 1] = sprite.y / ATLAS_HEIGHT;
    table[base + 2] = (sprite.x + sprite.w) / ATLAS_WIDTH;
    table[base + 3] = (sprite.y + sprite.h) / ATLAS_HEIGHT;
    table[base + 4] = sprite.w;
    table[base + 5] = sprite.h;
  });
  return table;
}

/**
 * Decodes `atlas.png` into a GPU texture.
 *
 * `createImageBitmap` rather than an `Image` element, because
 * `copyExternalImageToTexture` wants a decoded source and an `Image`'s
 * `onload` does not guarantee one. `premultiplyAlpha: 'none'` because
 * the blend mode configured below is straight alpha, not premultiplied;
 * getting that pair wrong darkens every antialiased edge in the game by
 * an amount too small to notice and too consistent to explain.
 */
async function loadAtlasTexture(device: GPUDevice): Promise<GPUTexture> {
  const response = await fetch(atlasImageUrl);
  if (!response.ok) {
    throw new Error(`could not fetch the sprite atlas: ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  if (bitmap.width !== ATLAS_WIDTH || bitmap.height !== ATLAS_HEIGHT) {
    throw new Error(
      `atlas.png is ${bitmap.width}x${bitmap.height} but atlas.ts says ` +
        `${ATLAS_WIDTH}x${ATLAS_HEIGHT}; every sprite rect would be wrong`,
    );
  }
  const texture = device.createTexture({
    size: { width: bitmap.width, height: bitmap.height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    { width: bitmap.width, height: bitmap.height },
  );
  bitmap.close();
  return texture;
}

/**
 * Draws every sprite on screen in a single instanced draw call. Depth
 * comes from the instance's z, so no CPU-side sorting is needed. See
 * [D10]: at 100k objects, not sorting beats sorting well.
 *
 * The pure parts of this - the instance layout and the capacity growth
 * rule - live in `instances.ts` so they can be tested without a GPU.
 * What remains here cannot be honestly tested outside a browser; see
 * `docs/testing-protocol.md` on why a mock would be worse than nothing.
 */
export class SpriteRenderer {
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  /** The atlas rect table, uploaded once; the atlas cannot change. */
  private readonly spriteBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private capacity = INITIAL_CAPACITY;
  private instanceBuffer: GPUBuffer;
  private depthTexture: GPUTexture | null = null;

  /**
   * The floor and the walls, uploaded once and then left alone.
   *
   * They live at the FRONT of the instance buffer and the per-frame
   * entities are written after them, so the whole frame is still one
   * `draw` of `staticCount + count` instances.
   *
   * Kept as a field rather than written and forgotten because growing
   * the instance buffer destroys and reallocates it, which loses
   * whatever was in it; `ensureCapacity` re-uploads from here.
   */
  private staticInstances: InstanceArray = new Float32Array(0);
  private staticCount = 0;

  /**
   * Scratch for the per-frame uniform upload, allocated once and mutated
   * in place. Layout matches `struct Uniforms` in `sprites.wgsl`:
   * viewport x, viewport y, anchor x, anchor y.
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
   * of erroring.
   */
  private readonly uniformData = new Float32Array([0, 0, 0, TILE_HALF_HEIGHT]);

  /**
   * Builds the pipeline and uploads the atlas.
   *
   * Asynchronous, and a static factory rather than a constructor,
   * because decoding a PNG is. Everything the first `draw` needs is
   * finished by the time this resolves, so no frame can ever sample an
   * empty texture.
   */
  static async create(gpu: GpuContext): Promise<SpriteRenderer> {
    const texture = await loadAtlasTexture(gpu.device);
    return new SpriteRenderer(gpu, texture);
  }

  private constructor(
    private readonly gpu: GpuContext,
    atlasTexture: GPUTexture,
  ) {
    const module = gpu.device.createShaderModule({ code: shaderSource });

    this.pipeline = gpu.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: BYTES_PER_INSTANCE,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
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
    });

    this.instanceBuffer = gpu.device.createBuffer({
      size: this.capacity * BYTES_PER_INSTANCE,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.uniformBuffer = gpu.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // The sprite table never changes after this: the atlas is a
    // committed artifact, so its rects are fixed for the session.
    const spriteTable = packSpriteTable();
    this.spriteBuffer = gpu.device.createBuffer({
      size: spriteTable.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    gpu.device.queue.writeBuffer(this.spriteBuffer, 0, spriteTable);

    this.bindGroup = gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.spriteBuffer } },
        {
          binding: 2,
          // Linear, and the atlas is drawn at exactly one texel per
          // pixel, so this only ever interpolates when an entity sits on
          // a fractional tile between ticks. `clamp-to-edge` matters:
          // `repeat` would wrap a sprite at the right edge of the atlas
          // round to the left one.
          resource: gpu.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
          }),
        },
        // The bind group keeps the texture alive, so nothing here holds
        // a second reference to it.
        { binding: 3, resource: atlasTexture.createView() },
      ],
    });
  }

  /**
   * Uploads the lot's floor and walls once, for the whole session.
   *
   * They are static for as long as the page lives, so they are **not**
   * rebuilt per frame. `buildInstances` runs every frame under [D11]'s
   * no-allocation rule, and [V11] measured what happens when something
   * on that path allocates without anybody checking: 57.76 MB over 2,394
   * frames from a two-element array. Several hundred wall and floor
   * quads rebuilt sixty times a second would be a far larger version of
   * the same mistake, for geometry that cannot change.
   */
  setStaticGeometry(instances: InstanceArray, count: number): void {
    this.staticInstances = instances;
    this.staticCount = count;
    this.ensureCapacity(count);
    this.uploadStatic();
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

  draw(instances: InstanceArray, count: number): void {
    const total = this.staticCount + count;
    if (total === 0) return;
    this.ensureCapacity(total);

    const canvas = this.gpu.context.canvas as HTMLCanvasElement;
    this.uniformData[0] = canvas.width;
    this.uniformData[1] = canvas.height;
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
    // One draw call for the whole room: floor, walls, objects and sims.
    pass.draw(VERTICES_PER_QUAD, total);
    pass.end();

    this.gpu.device.queue.submit([encoder.finish()]);
  }
}
