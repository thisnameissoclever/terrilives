/// <reference types="vite/client" />

import {
  ATLAS_FILE_NAME,
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  SPRITES,
} from './atlas.js';
import type { GpuContext } from './device.js';
import {
  BYTES_PER_INSTANCE,
  FLOATS_PER_INSTANCE,
  TINT_ATTRIBUTE_OFFSET,
  VERTICES_PER_QUAD,
  growCapacity,
  type InstanceArray,
} from './instances.js';
import { TILE_HALF_HEIGHT } from './iso.js';
import { AMBIENT_NEUTRAL, type Ambient } from './daylight.js';
import shaderSource from './sprites.wgsl?raw';

const INITIAL_CAPACITY = 4096;

/** Floats per entry of the `Atlas` uniform array: `uv` plus `size`. */
const FLOATS_PER_SPRITE = 8;

/**
 * Returns the content-addressed public URL for the generated texture.
 *
 * GitHub Pages caches public files independently from Vite's hashed
 * JavaScript and ignores query strings in its edge cache key. Without a
 * content-addressed pathname, a returning browser can load a new atlas
 * manifest beside an older cached PNG and abort on the size check.
 */
export function atlasTextureUrl(baseUrl: string): string {
  return `${baseUrl}${ATLAS_FILE_NAME}`;
}

/**
 * Packs the atlas manifest into the layout `struct Sprite` expects.
 *
 * Built once at start-up. `uv` is normalised because texture coordinates
 * are, and `size` stays in pixels because the quad is drawn one texel to
 * one pixel - so the manifest's `w` and `h` are simultaneously the
 * sprite's extent in the atlas and its extent on screen.
 */
function packSpriteTable(): Float32Array<ArrayBuffer> {
  // Sized by what the atlas holds. There is no cap to check against any
  // more: the shader's array is runtime-sized, so an atlas of any length
  // indexes correctly rather than clamping past the end.
  //
  // A storage buffer of length zero is invalid in WebGPU, and an empty
  // atlas is a build mistake rather than a state to render, so it is
  // rejected here where the message can say so.
  if (SPRITES.length === 0) {
    throw new Error(
      'the atlas manifest is empty; every sprite index would be out of ' +
        'range and nothing would draw',
    );
  }
  const table = new Float32Array(SPRITES.length * FLOATS_PER_SPRITE);
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
 * Decodes the content-addressed atlas PNG into a GPU texture.
 *
 * `createImageBitmap` rather than an `Image` element, because
 * `copyExternalImageToTexture` wants a decoded source and an `Image`'s
 * `onload` does not guarantee one. `premultiplyAlpha: 'none'` because
 * the blend mode configured below is straight alpha, not premultiplied;
 * getting that pair wrong darkens every antialiased edge in the game by
 * an amount too small to notice and too consistent to explain.
 */
async function loadAtlasTexture(device: GPUDevice): Promise<GPUTexture> {
  // Generated under `web/public/` and served at the app's own base. Not a
  // bundler import: the atlas is a build output of the whole project, and
  // importing it from outside the Vite root made the dev server hand out a
  // `/@fs/<absolute path>` URL that exists only in dev. The digest in the
  // pathname is load-bearing because Pages ignores query strings in its edge
  // cache key.
  const url = atlasTextureUrl(import.meta.env.BASE_URL);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    // A bare `TypeError: Failed to fetch` names neither the URL nor the
    // reason, and the two reasons need opposite fixes: the dev server is
    // not running, or the file is not where the build put it.
    throw new Error(
      `could not reach the sprite atlas at ${url} - if this is the dev ` +
        `server, check it is still running and reachable from this device`,
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(
      `the sprite atlas at ${url} returned ${response.status}`,
    );
  }
  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  if (bitmap.width !== ATLAS_WIDTH || bitmap.height !== ATLAS_HEIGHT) {
    throw new Error(
      `${ATLAS_FILE_NAME} is ${bitmap.width}x${bitmap.height} but atlas.ts says ` +
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
   * viewport x, viewport y, anchor x, anchor y, then the camera scale at
   * float 4 (byte offset 16) with three floats of padding to the 16-byte
   * uniform stride.
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
  ]);

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
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              // [ML-tint]. One buffer, two attributes, interleaved -
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
            ],
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
      // 48: viewport, anchor, the camera scale padded to the 16-byte
      // uniform stride, then the ambient tint. Must match `uniformData`
      // above and `struct Uniforms` in sprites.wgsl. Too SMALL and WebGPU
      // rejects the bind group; too large is merely wasted.
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // The sprite table never changes after this: the atlas is a
    // committed artifact, so its rects are fixed for the session.
    const spriteTable = packSpriteTable();
    this.spriteBuffer = gpu.device.createBuffer({
      size: spriteTable.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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

  /**
   * @param ambient The hour of day as an rgba multiplier, from
   *   `ambientFor` in daylight.ts. Defaults to neutral, so a caller that
   *   does not care about the clock gets the pre-cycle appearance rather
   *   than an unlit world.
   */
  draw(
    instances: InstanceArray,
    count: number,
    scale = 1,
    ambient: Ambient = AMBIENT_NEUTRAL,
  ): void {
    const total = this.staticCount + count;
    if (total === 0) return;
    this.ensureCapacity(total);

    const canvas = this.gpu.context.canvas as HTMLCanvasElement;
    this.uniformData[0] = canvas.width;
    this.uniformData[1] = canvas.height;
    this.uniformData[4] = scale;
    this.uniformData[8] = ambient[0];
    this.uniformData[9] = ambient[1];
    this.uniformData[10] = ambient[2];
    this.uniformData[11] = ambient[3];
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
