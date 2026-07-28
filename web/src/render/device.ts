/**
 * WebGPU device acquisition. Deliberately unforgiving: every failure mode
 * throws with a distinct message, because "nothing rendered" is otherwise
 * indistinguishable between a missing browser feature, a missing adapter,
 * and a canvas that never got a context.
 */

export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function initDevice(
  canvas: HTMLCanvasElement,
): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('No WebGPU adapter found.');
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Could not acquire a WebGPU canvas context.');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });
  return { device, context, format };
}
