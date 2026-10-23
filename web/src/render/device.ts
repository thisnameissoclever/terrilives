import {recordDiagnostic} from '../diagnostics.js';
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

/**
 * `navigator.gpu` exists but the browser would not hand this page an
 * adapter. Its own type because the advice differs from a missing WebGPU:
 * the usual cause is the browser blocking graphics for the site after a
 * driver crash or reset, which a browser restart clears.
 */
export class NoGpuAdapterError extends Error {
  constructor() {
    super('No WebGPU adapter found.');
    this.name = 'NoGpuAdapterError';
  }
}

async function acquireDevice(
  canvas: HTMLCanvasElement,
): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new NoGpuAdapterError();
  }
  recordDiagnostic('gpu.adapter',{maxTextureDimension2D:adapter.limits.maxTextureDimension2D});
  const device = await adapter.requestDevice({requiredLimits:{maxTextureDimension2D:adapter.limits.maxTextureDimension2D}});
  recordDiagnostic('gpu.device',{maxTextureDimension2D:adapter.limits.maxTextureDimension2D,
    vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,description:adapter.info?.description});
  device.addEventListener('uncapturederror',event=>recordDiagnostic('gpu.uncaptured-error',undefined,event.error));
  void device.lost.then(info=>recordDiagnostic('gpu.device-lost',{reason:info.reason,message:info.message},
    info.reason==='destroyed'?undefined:new Error(`Graphics device lost (${info.reason}): ${info.message}`)));
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Could not acquire a WebGPU canvas context.');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });
  return { device, context, format };
}

let deviceSequence=0;
export async function initDevice(canvas:HTMLCanvasElement):Promise<GpuContext> {
  const id=`graphics:${++deviceSequence}`;recordDiagnostic('gpu.acquire',{id,state:'start'});
  try{const result=await acquireDevice(canvas);recordDiagnostic('gpu.acquire',{id,state:'complete'});return result;}
  catch(error){recordDiagnostic('gpu.acquire',{id,state:'failed'},error);throw error;}
}
