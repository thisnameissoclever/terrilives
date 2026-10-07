import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { buildInstances, instanceCount } from '../src/frame.ts';
import { SPRITES, SPRITE_ANCHORS, BATHROOM_SPRITES, spriteIndex } from '../src/render/atlas.ts';
import { AMBIENT_NEUTRAL } from '../src/render/daylight.ts';
import { acquireWithTimeout } from './owned-timeout.ts';

export async function bathUseProof(references) {
  const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 440;
  document.documentElement.dataset.phase = 'device';
  const gpu = await initDevice(canvas), errors = [], records = [];
  gpu.context.configure({device:gpu.device,format:gpu.format,alphaMode:'premultiplied',
    usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const bytesPerRow=Math.ceil(canvas.width*4/256)*256;
  const readback=gpu.device.createBuffer({size:bytesPerRow*canvas.height,
    usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  const board = document.createElement('div'); board.style = 'display:flex;flex-wrap:wrap;width:1600px;background:#17171c;color:white';
  try {
    document.documentElement.dataset.phase = 'renderer';
    const renderer = await SpriteRenderer.create(gpu);
    for (const ref of references) {
      document.documentElement.dataset.phase = ref.name + ' draw';
      const empty = spriteIndex(ref.empty), none = 0xffffffff;
      const palette = {blue:0,green:1,red:2}[ref.variant];
      const source = {
        count:2, positions:()=>new Float32Array(4), prevPositions:()=>new Float32Array(4),
        ids:()=>new Uint32Array([41,99]), kinds:()=>new Uint32Array([1,0]), sprites:()=>new Uint32Array([empty,0]),
        activities:()=>new Uint32Array(2), visualActions:()=>new Uint32Array([0,19]), facings:()=>new Uint32Array([0,ref.facing]),
        simIds:()=>new Uint32Array([none,palette]), carrying:()=>new Uint32Array([none,none]),
        foregroundSprites:()=>new Uint32Array([none,none]), interactionTargets:()=>new Uint32Array([none,41]), itemKinds:()=>[],
      };
      const profile = BATHROOM_SPRITES[empty][19];
      const frameSet = (profile.facingFrames?.[ref.facing] ?? profile.frames)[ref.variant];
      const ticksPerFrame = 2 * profile.halfCycleTicks / frameSet.length;
      const tick = 64 + ref.frame * ticksPerFrame - 99 % profile.halfCycleTicks;
      const targetScene=(profile.facingFrames?.[ref.facing]??profile.frames)[ref.variant][ref.frame];
      const [ax,ay]=SPRITE_ANCHORS[targetScene];
      const data = buildInstances(source,1,40+ax*2,40+ay*2-42,16,null,2,false,tick);
      const scene = data[19];
      const frames = (profile.facingFrames?.[ref.facing] ?? profile.frames)[ref.variant];
      if (scene !== frames[ref.frame] || data[0] !== -1e6) throw new Error('Wrong selected bath sample');
      renderer.draw(data,instanceCount(source,null),2,AMBIENT_NEUTRAL);
      document.documentElement.dataset.phase = ref.name + ' queue';
      const encoder=gpu.device.createCommandEncoder();
      encoder.copyTextureToBuffer({texture:gpu.context.getCurrentTexture()},
        {buffer:readback,bytesPerRow},{width:canvas.width,height:canvas.height});
      gpu.device.queue.submit([encoder.finish()]);
      await acquireWithTimeout(readback.mapAsync(GPUMapMode.READ),10000,()=>readback.unmap(),'Bath readback');
      const mapped=new Uint8Array(readback.getMappedRange()),actual=new Uint8ClampedArray(canvas.width*canvas.height*4);
      for(let y=0;y<canvas.height;y++)actual.set(mapped.subarray(y*bytesPerRow,y*bytesPerRow+canvas.width*4),y*canvas.width*4);
      readback.unmap();
      if(gpu.format.startsWith('bgra'))for(let i=0;i<actual.length;i+=4){const r=actual[i];actual[i]=actual[i+2];actual[i+2]=r;}
      const copy = document.createElement('canvas'); copy.width=400;copy.height=440;
      const ctx=copy.getContext('2d');ctx.putImageData(new ImageData(actual,400,440),0,0);
      const expected=document.createElement('canvas');expected.width=400;expected.height=440;
      const ec=expected.getContext('2d');ec.fillStyle='#17171c';ec.fillRect(0,0,400,440);
      document.documentElement.dataset.phase = ref.name + ' decode';
      const image=new Image();image.src=ref.image;await image.decode();
      ec.drawImage(image,40,40);
      document.documentElement.dataset.phase = ref.name + ' compare';
      const wanted=ec.getImageData(0,0,400,440).data;
      const bounds=SPRITES[scene], histogram=new Uint32Array(256);
      let maximum=0,count=0;
      // Isolate the occupied scene from separately drawn activity badges.
      if(bounds.w+40>400||bounds.h+40>440||image.width!==bounds.w||image.height!==bounds.h)throw new Error('Bath reference canvas does not fit');
      for(let y=0;y<440;y++)for(let x=0;x<400;x++) {
        const at=(y*400+x)*4;
        for(let c=0;c<3;c++){const d=Math.abs(actual[at+c]-wanted[at+c]);maximum=Math.max(maximum,d);histogram[d]++;count++;}
      }
      let p95=0,total=0;for(;p95<256;p95++){total+=histogram[p95];if(total>=Math.ceil(count*.95))break;}
      if(!Number.isFinite(maximum)||!Number.isFinite(p95)||maximum>6||p95>2)throw new Error(`${ref.name}: GPU comparison max${maximum},p95${p95}`);
      records.push({name:ref.name,scene,maximum,p95});
      document.documentElement.dataset.completed = String(records.length);
      if(ref.variant==='green') {
        const section=document.createElement('section');section.style.width='400px';
        const label=document.createElement('div');label.textContent=ref.name;section.append(label,copy);board.append(section);
      }
    }
    const validation=await gpu.device.popErrorScope();
    document.body.replaceChildren(board);document.body.style.margin='0';
    return {pass:!validation&&!errors.length,validation:validation?.message??null,errors,records};
  } finally {readback.destroy();gpu.device.destroy();}
}
