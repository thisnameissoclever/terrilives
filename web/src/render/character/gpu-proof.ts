import { CharacterCompositor } from './compositor.js';
import { CharacterRenderer } from './renderer.js';
import { layeredDepth, LAYER_SIM } from '../iso.js';
import { colorFields, neutralAppearance, type AppearanceProofV1 } from './appearance.js';
import { anatomicalHeight } from './shape.js';
import { posedPositions } from './geometry-proof.js';

export async function verifyRuntimeSurface(actor:CharacterRenderer, appearance:AppearanceProofV1, action:string, frame:number):Promise<{vertices:number;maxError:number}> {
  const expected=posedPositions(actor.geometry,appearance,action,frame,anatomicalHeight(actor.geometry.vertices));
  const actual=await actor.surfacePositions();let maxError=0;
  if(actual.length!==expected.length)throw new Error('GPU surface size differs from source operator');
  for(let i=0;i<actual.length;i+=3)maxError=Math.max(maxError,Math.hypot(actual[i]-expected[i],actual[i+1]-expected[i+1],actual[i+2]-expected[i+2]));
  if(!Number.isFinite(maxError)||maxError>2e-5)throw new Error(`GPU surface differs from skinned subdivision: ${maxError}`);
  return {vertices:actual.length/3,maxError};
}

export async function textureBytes(device: GPUDevice, texture: GPUTexture, width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const stride = Math.ceil(width*4/256)*256;
  const buffer = device.createBuffer({ size: stride*height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, [width, height]);
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange()), result = new Uint8Array(width*height*4);
    for (let row=0; row<height; row++) result.set(mapped.subarray(row*stride, row*stride+width*4), row*width*4);
    return result;
  } finally { buffer.unmap(); buffer.destroy(); }
}

/** A separately rendered material mask bounds every pixel allowed to change. */
export async function verifyColorIsolation(actor: CharacterRenderer): Promise<{ changedSkinPixels: number; unrelatedChanges: number }> {
  const { device, width, height, geometry } = actor;
  const mask = new CharacterRenderer(device, { ...geometry, manifest: { ...geometry.manifest,
    materials: geometry.manifest.materials.map(m => ({ ...m, group: 5, unlit: true,
      colour: m.group === 0 ? [1, 1, 1, 1] : [0, 0, 0, 1], ramp: [] })) } }, width, height);
  try {
    const a = neutralAppearance();
    mask.setAppearance(a, colorFields); mask.render('read', 0, 0);
    actor.setAppearance(a, colorFields); actor.render('read', 0, 0);
    const before = await textureBytes(device, actor.color, width, height);
    actor.setAppearance({ ...a, skin: '#69462f' }, colorFields.filter(field => field !== 'skin')); actor.render('read', 0, 0);
    const after = await textureBytes(device, actor.color, width, height);
    const allowed = await textureBytes(device, mask.color, width, height);
    let changedSkinPixels = 0, unrelatedChanges = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (before[i] === after[i] && before[i+1] === after[i+1] && before[i+2] === after[i+2]) continue;
      if (allowed[i] > 250 && allowed[i+1] > 250 && allowed[i+2] > 250) changedSkinPixels++;
      else unrelatedChanges++;
    }
    if (changedSkinPixels < 100 || unrelatedChanges) throw new Error(`Color isolation failed: skin=${changedSkinPixels}, unrelated=${unrelatedChanges}`);
    return { changedSkinPixels, unrelatedChanges };
  } finally { mask.destroy(); }
}

/** A constant-depth plane must divide the actual body by its independently read surface depth. */
export async function verifyDepthPartition(actor: CharacterRenderer): Promise<{ near: number; far: number; mismatches: number }> {
  const { device, width, height } = actor;
  const output = device.createTexture({ size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC });
  const depth = device.createTexture({ size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT });
  const compositor = new CharacterCompositor(device,'rgba8unorm',actor);
  try {
    compositor.place([0,0,width,height],[width,height],[3,3],16);
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({ colorAttachments:[{view:output.createView(),loadOp:'clear',storeOp:'store',clearValue:[1,0,1,1]}],
      depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:layeredDepth(3,3,16,LAYER_SIM)} });
    compositor.draw(pass);pass.end();device.queue.submit([encoder.finish()]);
    const [source, surfaceBytes, actual]=await Promise.all([
      textureBytes(device,actor.color,width,height),textureBytes(device,actor.surface,width,height),textureBytes(device,output,width,height)]);
    const surface=new Float32Array(surfaceBytes.buffer);
    let near=0,far=0,mismatches=0;
    for(let i=0;i<surface.length;i++) {
      if(source[i*4+3]<128||Math.abs(surface[i])<.0001)continue;
      const visible=surface[i]>0; if(visible)near++;else far++;
      for(let c=0;c<3;c++) {
        const expected=visible?source[i*4+c]:(c===1?0:255);
        if(Math.abs(actual[i*4+c]-expected)>1){mismatches++;break;}
      }
    }
    if(near<100||far<100||mismatches!==0)throw new Error(`Depth partition failed: near=${near}, far=${far}, mismatches=${mismatches}`);
    return {near,far,mismatches};
  } finally {compositor.destroy();output.destroy();depth.destroy();}
}

export async function pixelBounds(actor: CharacterRenderer): Promise<{ minX:number;minY:number;maxX:number;maxY:number;bodyPixels:number;fixturePixels:number }> {
  const bytes=await textureBytes(actor.device,actor.identity,actor.width,actor.height), ids=new Uint32Array(bytes.buffer);
  let minX=actor.width,minY=actor.height,maxX=-1,maxY=-1,bodyPixels=0,fixturePixels=0;
  for(let i=0;i<ids.length;i++) {
    if(ids[i]===0)continue;
    if(ids[i]>=0x80000000){fixturePixels++;continue;}
    bodyPixels++;const x=i%actor.width,y=Math.floor(i/actor.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
  if(bodyPixels<100||minX<=0||minY<=0||maxX>=actor.width-1||maxY>=actor.height-1)throw new Error('Character is missing or clipped by the render target');
  return {minX,minY,maxX,maxY,bodyPixels,fixturePixels};
}
