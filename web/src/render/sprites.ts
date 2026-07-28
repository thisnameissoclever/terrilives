/// <reference types="vite/client" />

import type { GpuContext } from './device.js';
import {
  BYTES_PER_INSTANCE,
  FLOATS_PER_INSTANCE,
  VERTICES_PER_QUAD,
  growCapacity,
  type InstanceArray,
} from './instances.js';
import shaderSource from './sprites.wgsl?raw';

const INITIAL_CAPACITY = 4096;

/**
 * The quad edge in screen pixels, uploaded as `Uniforms.tileSize` and
 * multiplied by the unit `CORNERS` in `sprites.wgsl`.
 *
 * Named because [V2] in `docs/gpu-verification.md` asserts a hardware
 * pixel count of exactly 576 against it: 24 x 24. A silent edit here
 * changes what that measurement means.
 */
const QUAD_SIZE_PX = 24;

/**
 * Draws every entity in a single instanced draw call. Depth comes from
 * the instance's z, so no CPU-side sorting is needed. See [D10]: at
 * 100k objects, not sorting beats sorting well.
 *
 * The pure parts of this - the instance layout and the capacity growth
 * rule - live in `instances.ts` so they can be tested without a GPU.
 * What remains here cannot be honestly tested outside a browser; see
 * `docs/testing-protocol.md` on why a mock would be worse than nothing.
 */
export class SpriteRenderer {
  private pipeline: GPURenderPipeline;
  private instanceBuffer: GPUBuffer;
  private capacity = INITIAL_CAPACITY;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private depthTexture: GPUTexture | null = null;

  /**
   * Scratch for the per-frame uniform upload, allocated once and mutated
   * in place. Layout matches `struct Uniforms` in `sprites.wgsl`:
   * viewport x, viewport y, tile width, tile height.
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
  private readonly uniformData = new Float32Array([
    0,
    0,
    QUAD_SIZE_PX,
    QUAD_SIZE_PX,
  ]);

  constructor(private readonly gpu: GpuContext) {
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
        targets: [{ format: gpu.format }],
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

    this.bindGroup = gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
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
    if (count === 0) return;
    this.ensureCapacity(count);

    const canvas = this.gpu.context.canvas as HTMLCanvasElement;
    this.uniformData[0] = canvas.width;
    this.uniformData[1] = canvas.height;
    this.gpu.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
    // dataOffset and size are in elements for a TypedArray source, so the
    // caller's scratch buffer may be longer than the live entity count.
    this.gpu.device.queue.writeBuffer(
      this.instanceBuffer,
      0,
      instances,
      0,
      count * FLOATS_PER_INSTANCE,
    );

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
    // One draw call for every entity on screen.
    pass.draw(VERTICES_PER_QUAD, count);
    pass.end();

    this.gpu.device.queue.submit([encoder.finish()]);
  }
}
