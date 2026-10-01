import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer as CandidateRenderer } from '../src/render/sprites.ts';
import { SpriteRenderer as BaselineRenderer } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprites.ts';
import { buildStaticInstances as historicalGeometry } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/tiles.ts';
import { spriteIndex } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/atlas.ts';
import { spriteDrawOffsetX, spriteDrawOffsetY } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprite-anchors.ts';
import baselineManifest from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/manifest.json';
import { buildStaticInstances } from '../src/render/tiles.ts';
import { loadArchitectureAtlas, closeArchitectureAtlas } from '../src/render/architecture-atlas.ts';
import { architectureSprite } from '../src/render/architecture.ts';
import { ARCHITECTURE } from '../src/render/architecture-data.ts';
import { writeInstance } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/instances.ts';
import { layeredDepth, LAYER_PROP } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/iso.ts';
import { acquireWithTimeout } from './owned-timeout.ts';

const baselineSources = import.meta.glob('./.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/*.{ts,wgsl}', { query: '?raw', import: 'default', eager: true });
const candidateSources = import.meta.glob('../src/render/*.{ts,wgsl}', { query: '?raw', import: 'default', eager: true });
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))].map(x => x.toString(16).padStart(2, '0')).join('');
const percentile = (values, fraction) => [...values].sort((a,b) => a-b)[Math.ceil(values.length*fraction)-1];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const visible = () => assert(document.visibilityState === 'visible', 'Benchmark requires a visible document throughout');
const bounded = (promise, name) => acquireWithTimeout(promise, 15000, () => {}, name);

// The same logical lot is consumed by each revision. The old renderer never sees new IDs.
function makeLot(finalScene, cutaway) {
  const size = finalScene ? 34 : 8, shell = [], windows = [], lines = [], floors = [];
  const catalogue = Array.from({length:9}, (_,i) => ({id:i+1, label:`Window ${i+1}`, width:architectureSprite(i+1,0,'front',false)[0].width}));
  let start = 1;
  if (finalScene) for (const model of catalogue) {
    windows.push({axis:0,x:0,y:start,model:model.id}, {axis:1,x:start,y:0,model:model.id});
    for (let j=0;j<model.width;j++) lines.push(0,0,start+j, 1,start+j,0);
    start += model.width+1;
  }
  const opened = new Set(Array.from({length:lines.length/3},(_,i)=>lines.slice(i*3,i*3+3).join(',')));
  for(let i=0;i<size;i++) for(const edge of [[0,0,i,0],[0,size,i,0],[1,i,0,0],[1,i,size,0]])
    if(!opened.has(edge.slice(0,3).join(','))) shell.push(...edge);
  for(let x=0;x<size;x++) for(let y=0;y<size;y++) floors.push(x,y,1+(x%3));
  return { lot:{width:size,height:size,house:[size,size],walls:new Uint32Array(),edges:Uint32Array.from(shell),windows:Uint32Array.from(lines),floors:Uint32Array.from(floors),coveringLooks:new Float32Array(9),showCutAwayWalls:!cutaway}, architecture:{windows,catalogue}, size };
}

/** One owned visible canvas; call runRound separately, then dispose in finally. */
export async function createArchitectureBenchmark() {
  visible();
  const canvas = document.createElement('canvas'); canvas.width=1280;canvas.height=900;document.body.append(canvas);
  let gpu, atlas, baseline, candidate, readback, active = null;
  const restore = [], errors = [], resources = {baseline:[],candidate:[]};
  const counts = () => ({drawCalls:0,submits:0,bufferUploads:0,bufferUploadBytes:0,textureUploads:0,gpuBufferAllocations:0,gpuTextureAllocations:0});
  let observed=counts();
  const hook = (object,name,wrapped) => { const original=object[name];object[name]=wrapped(original);restore.push(()=>{object[name]=original;}); };
  try {
    gpu=await acquireWithTimeout(initDevice(canvas),15000,value=>value.device.destroy(),'Benchmark device');
    gpu.context.configure({device:gpu.device,format:gpu.format,alphaMode:'premultiplied',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    gpu.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
    hook(gpu.device,'createBuffer',original=>function(desc){ observed.gpuBufferAllocations++;return original.call(this,desc); });
    hook(gpu.device,'createTexture',original=>function(desc){ observed.gpuTextureAllocations++;if(active) resources[active].push({format:desc.format,size:desc.size});return original.call(this,desc); });
    hook(gpu.device.queue,'writeBuffer',original=>function(buffer,offset,data,dataOffset=0,size){ observed.bufferUploads++;observed.bufferUploadBytes+=(size??(data.length??data.byteLength)-dataOffset)*(data.BYTES_PER_ELEMENT??1);return original.call(this,buffer,offset,data,dataOffset,size); });
    hook(gpu.device.queue,'writeTexture',original=>function(...args){observed.textureUploads++;return original.apply(this,args);});
    hook(gpu.device.queue,'copyExternalImageToTexture',original=>function(...args){observed.textureUploads++;return original.apply(this,args);});
    hook(gpu.device.queue,'submit',original=>function(...args){observed.submits++;return original.apply(this,args);});
    hook(GPURenderPassEncoder.prototype,'draw',original=>function(...args){observed.drawCalls++;return original.apply(this,args);});
    const sources = {baseline:baselineManifest,candidate:{}};
    for(const [path,source] of Object.entries(baselineSources)) assert(await hash(source)===baselineManifest.files[path.split('/').pop()],`Pinned baseline changed: ${path}`);
    for(const [path,source] of Object.entries(candidateSources)) sources.candidate[path.split('/').pop()]=await hash(source);
    gpu.device.pushErrorScope('validation');
    active='baseline';observed=counts();baseline=await bounded(BaselineRenderer.create(gpu),'Baseline renderer');const baselineSetup={...observed};
    atlas=await acquireWithTimeout(loadArchitectureAtlas(gpu.device.limits,{baseUrl:'/'}),15000,closeArchitectureAtlas,'Architecture atlas');
    const atlasBytes={color:atlas.width*atlas.height*4,depth:atlas.depth.byteLength,carrier:atlas.carrier?atlas.width*atlas.height*4:0,roles:atlas.roles?.byteLength??0,patterns:(atlas.patterns??[]).map(x=>x.width*x.height*4),activePatternCount:atlas.patterns?.length??0,resources:ARCHITECTURE.resources};
    active='candidate';observed=counts();candidate=await bounded(CandidateRenderer.create(gpu,atlas),'Candidate renderer');const candidateSetup={...observed};
    closeArchitectureAtlas(atlas);atlas=null;active=null;
    let bytesPerRow=Math.ceil(canvas.width*4/256)*256;
    readback=gpu.device.createBuffer({size:bytesPerRow*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const metadata={sources,atlasBytes,resources,setup:{baseline:baselineSetup,candidate:candidateSetup},userAgent:navigator.userAgent,limits:{maxTextureDimension2D:gpu.device.limits.maxTextureDimension2D,maxSampledTexturesPerShaderStage:gpu.device.limits.maxSampledTexturesPerShaderStage},canvas:{width:canvas.width,height:canvas.height},allocationScope:'Counts GPU buffers/textures. JS heap allocation is not measured. Timing includes renderer draw submission and queue completion, excludes rAF scheduling; cadence is separate.'};
    const renderers={baseline,candidate};let configured;
    const capture=async renderer=>{
      active=renderer===baseline?'baseline':'candidate';
      renderer.draw(configured.props,12,configured.scale);
      const encoder=gpu.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:gpu.context.getCurrentTexture()},{buffer:readback,bytesPerRow},{width:canvas.width,height:canvas.height});gpu.device.queue.submit([encoder.finish()]);
      await bounded(readback.mapAsync(GPUMapMode.READ),'Benchmark readback');
      const mapped=new Uint8Array(readback.getMappedRange()),pixels=new Uint8Array(canvas.width*canvas.height*4);
      for(let y=0;y<canvas.height;y++) pixels.set(mapped.subarray(y*bytesPerRow,y*bytesPerRow+canvas.width*4),y*canvas.width*4);
      readback.unmap();
      let changed=0;for(let i=4;i<pixels.length;i+=4) if(pixels[i]!==pixels[0]||pixels[i+1]!==pixels[1]||pixels[i+2]!==pixels[2])changed++;
      assert(pixels[3]===255&&changed>1000,'Framebuffer must contain opaque clear and visible geometry');
      active=null;
      return {sha256:await hash(pixels),nonBackgroundPixels:changed,corner:[...pixels.slice(0,4)]};
    };
    return {metadata,
      async configure({scene='historical',scale=1,cutaway=true}={}) {
        visible();assert(['historical','final'].includes(scene)&&[1,1.75,3].includes(scale),'Known benchmark case');
        const data=makeLot(scene==='final',cutaway);
        canvas.width=Math.ceil((data.size*64+160)*scale);canvas.height=Math.ceil((data.size*42+220)*scale);
        assert(canvas.width<=gpu.device.limits.maxTextureDimension2D&&canvas.height<=gpu.device.limits.maxTextureDimension2D,'Scene exceeds device canvas limit');
        readback.destroy();bytesPerRow=Math.ceil(canvas.width*4/256)*256;
        readback=gpu.device.createBuffer({size:bytesPerRow*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        const ox=canvas.width/2+.37,oy=120*scale+.19;
        const old=historicalGeometry(data.lot,ox,oy,data.size,scale);
        const previous={instances:old.instances.slice(0,old.count*16),count:old.count,lowInstances:old.lowInstances.slice()};
        const current=scene==='historical'?previous:buildStaticInstances({...data.lot,architecture:data.architecture},ox,oy,data.size,scale);
        const next={instances:current.instances.slice(0,current.count*16),count:current.count,lowInstances:current.lowInstances.slice()};
        const props=new Float32Array(12*16);
        for(let i=0;i<12;i++){const x=1+i%4,y=1+Math.floor(i/4),id=spriteIndex(i%3===0?'offlineDeskSW':i%3===1?'offlineBunk':'sim');writeInstance(props,i,ox+((x-y)*32+spriteDrawOffsetX(id))*scale,oy+((x+y)*21+spriteDrawOffsetY(id))*scale,layeredDepth(x,y,data.size,LAYER_PROP),id);}
        baseline.setStaticGeometry(previous.instances,previous.count,previous.lowInstances);candidate.setArchitectureCamera(ox,oy);candidate.setStaticGeometry(next.instances,next.count,next.lowInstances);
        configured={scene,scale,cutaway,props};
        const pixels={baseline:await capture(baseline),candidate:await capture(candidate)};
        if(scene==='historical') assert(pixels.baseline.sha256===pixels.candidate.sha256,'Identical historical input pixels differ');
        return {...configured,props:undefined,canvas:{width:canvas.width,height:canvas.height},depthAttachmentBytesLowerBound:canvas.width*canvas.height*3,pixels,pixelsEqual:pixels.baseline.sha256===pixels.candidate.sha256,windows:data.architecture.windows.length,inputHashes:{baseline:await hash(previous.instances),candidate:await hash(next.instances),baselineLow:await hash(previous.lowInstances),candidateLow:await hash(next.lowInstances),props:await hash(props)},counts:{baseline:{static:previous.count,low:previous.lowInstances.length/16},candidate:{static:next.count,low:next.lowInstances.length/16}}};
      },
      async runRound({round=0,warmup=60,frames=120}={}) {
        assert(configured&&frames>=30&&frames<=120&&warmup>=0&&warmup<=120,'Configure first; use bounded frame counts');
        const order=round%2?['candidate','baseline']:['baseline','candidate'],result={round,order,frames,warmup};
        for(const name of order){
          const elapsed=[],cadence=[];let last;
          observed=counts();active=name;
          for(let i=0;i<warmup+frames;i++) {
            await bounded(new Promise(resolve=>requestAnimationFrame(resolve)),'Visible animation frame');visible();
            const start=performance.now();renderers[name].draw(configured.props,12,configured.scale);await bounded(gpu.device.queue.onSubmittedWorkDone(),'Frame completion');
            if(i>=warmup){elapsed.push(performance.now()-start);if(last!==undefined)cadence.push(start-last);}
            last=start;if(i===warmup-1)observed=counts();
          }
          result[name]={p50:percentile(elapsed,.5),p95:percentile(elapsed,.95),cadenceP95:percentile(cadence,.95),samples:elapsed,counters:{...observed}};
        }
        active=null;result.p95Growth=(result.candidate.p95/result.baseline.p95)-1;result.requiresInvestigation=result.p95Growth>.1;
        assert(errors.length===0,errors.join('; '));return result;
      },
      async finish(){ const error=await bounded(gpu.device.popErrorScope(),'Benchmark validation');return {resources,validationError:error?.message??null,uncapturedErrors:errors,pass:!error&&errors.length===0}; },
      dispose(){for(const fn of restore.reverse())fn();readback.destroy();candidate.destroy();gpu.device.destroy();canvas.remove();}
    };
  } catch(error){if(atlas)closeArchitectureAtlas(atlas);for(const fn of restore.reverse())fn();readback?.destroy();candidate?.destroy();gpu?.device.destroy();canvas.remove();throw error;}
}
