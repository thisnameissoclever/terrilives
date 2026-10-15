import type { Geometry } from './bundle.js';

export interface StaticCharacterBuffers {
  index: GPUBuffer; materials: GPUBuffer; ranges: GPUBuffer; weights: GPUBuffer;
  normalRanges: GPUBuffer; normalTriangles: GPUBuffer;
}
interface Entry { buffers: StaticCharacterBuffers; references: number; destroyed: boolean }
export interface StaticCharacterLease { buffers: StaticCharacterBuffers; bytes: number; release(): void }
interface DeviceResources { entries: WeakMap<Geometry, Entry>; live: Set<Entry>; lost: boolean }
const devices = new WeakMap<GPUDevice, DeviceResources>();
const owners=new WeakMap<GPUDevice,{lost:boolean;close:Set<()=>void>}>();

/** One device listener retains only live resources, never closed actor history. */
export function releaseCharacterOnDeviceLoss(device:GPUDevice,close:()=>void):()=>void {
  let state=owners.get(device);
  if(!state){
    state={lost:false,close:new Set()};owners.set(device,state);const current=state;
    void device.lost.then(()=>{current.lost=true;for(const release of current.close)release();current.close.clear();});
  }
  if(state.lost)throw new Error('Character graphics device has been lost.');
  state.close.add(close);const current=state;
  return ()=>current.close.delete(close);
}
function destroy(entry: Entry): void {
  if (entry.destroyed) return;
  entry.destroyed = true;
  for (const buffer of Object.values(entry.buffers)) buffer.destroy();
}

/** Share read-only geometry while each actor keeps its own deformation and pose buffers. */
export function acquireStaticCharacterBuffers(device: GPUDevice, geometry: Geometry): StaticCharacterLease {
  let state = devices.get(device);
  if (!state) {
    state = { entries: new WeakMap(), live: new Set(), lost: false }; devices.set(device, state);
    const resources = state;
    void device.lost.then(() => { resources.lost = true; for (const entry of resources.live) destroy(entry); resources.live.clear(); });
  }
  if (state.lost) throw new Error('Character graphics device has been lost.');
  let entry = state.entries.get(geometry);
  if (!entry) {
    const materialData = new Float32Array(geometry.manifest.materials.length * 28);
    geometry.manifest.materials.forEach((material, index) => {
      const offset = index * 28;
      materialData.set(material.colour, offset);
      for (let j = 0; j < 4; j++) {
        const stop = material.ramp[Math.min(j, material.ramp.length - 1)];
        materialData.set(stop?.colour ?? material.colour, offset + 4 + j * 4);
        materialData[offset + 20 + j] = stop?.position ?? j / 3;
      }
      const interpolation = ['CONSTANT', 'LINEAR', 'EASE'].indexOf(material.interpolation);
      if (interpolation < 0) throw new Error('Unknown character material interpolation');
      materialData.set([material.group, Number(material.unlit), interpolation, 0], offset + 24);
    });
    const created: GPUBuffer[] = [];
    const upload = (data: ArrayBufferView<ArrayBuffer>, usage = GPUBufferUsage.STORAGE) => {
      const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      created.push(buffer); device.queue.writeBuffer(buffer, 0, data); return buffer;
    };
    try {
      entry = { references: 0, destroyed: false, buffers: {
        index: upload(geometry.indices, GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX), materials: upload(materialData),
        ranges: upload(geometry.stencilRanges), weights: upload(new Uint8Array(geometry.stencilWeights)),
        normalRanges: upload(geometry.normalRanges), normalTriangles: upload(geometry.normalTriangles),
      } };
    } catch (error) { for (const buffer of created) buffer.destroy(); throw error; }
    state.entries.set(geometry, entry); state.live.add(entry);
  }
  entry.references++;
  const acquired = entry, resources = state;
  let released = false;
  return { buffers: acquired.buffers, bytes: Object.values(acquired.buffers).reduce((sum, buffer) => sum + buffer.size, 0), release() {
    if (released) return;
    released = true;
    if (--acquired.references === 0) {
      destroy(acquired);
      resources.entries.delete(geometry); resources.live.delete(acquired);
    }
  } };
}
