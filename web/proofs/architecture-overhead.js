import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer as CandidateRenderer } from '../src/render/sprites.ts';
import { SpriteRenderer as BaselineRenderer } from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprites.ts';
import baselineManifest from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/manifest.json';
import baselineRendererSource from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprites.ts?raw';
import baselineShaderSource from './.architecture-baseline/22ffd8b6e5f9d03191f521f908a20e1bfc02c70a/sprites.wgsl?raw';
import candidateRendererSource from '../src/render/sprites.ts?raw';
import candidateShaderSource from '../src/render/sprites.wgsl?raw';
import { buildStaticInstances } from '../src/render/tiles.ts';
import { FLOATS_PER_INSTANCE, writeInstance } from '../src/render/instances.ts';
import { spriteIndex } from '../src/render/atlas.ts';
import { layeredDepth, LAYER_PROP } from '../src/render/iso.ts';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.ts';
import { acquireWithTimeout } from './owned-timeout.ts';
import manifest from '../../docs/assets/review-evidence/architecture/room-01/trial/candidate-08/manifest.json';

const colorUrl = new URL('../../docs/assets/review-evidence/architecture/room-01/trial/candidate-08/color.png', import.meta.url);
const depthUrl = new URL('../../docs/assets/review-evidence/architecture/room-01/trial/candidate-08/depth.r16f', import.meta.url);
const sha256 = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');
const textHash = value => sha256(new TextEncoder().encode(value));
const arrayHash = value => sha256(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));
const median = values => { const sorted=[...values].sort((a,b)=>a-b),middle=sorted.length/2; return (sorted[middle-1]+sorted[middle])/2; };

/** Same historical inputs, same device, alternating warmed pipeline batches. */
export async function architectureOverheadProof() {
  if(document.visibilityState!=='visible') throw new Error('Benchmark requires a visible document');
  const stage = label => { globalThis.__architectureOverheadProgress={label,time:performance.now()}; };
  const bounded = (label,promise) => { stage(label); return acquireWithTimeout(promise,10000,()=>{},label); };
  const canvas=document.createElement('canvas');canvas.width=460;canvas.height=390;
  const frames=120,warmupFrames=120,rounds=12;
  let gpu,color;
  try {
    stage('Acquire benchmark GPU');
    gpu=await acquireWithTimeout(initDevice(canvas),10000,value=>value.device.destroy(),'Acquire benchmark GPU');
    const submitted = label => bounded(label,Promise.race([gpu.device.queue.onSubmittedWorkDone(),
      gpu.device.lost.then(info=>{throw new Error(`Benchmark device lost: ${info.reason}`);})]));
    gpu.device.pushErrorScope('validation');
    const colorResponse=await bounded('Fetch benchmark color',fetch(colorUrl));
    if(!colorResponse.ok) throw new Error(`Benchmark color HTTP ${colorResponse.status}`);
    color=await acquireWithTimeout(createImageBitmap(await colorResponse.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'}),10000,value=>value.close(),'Decode benchmark color');
    const depthResponse=await bounded('Fetch benchmark depth',fetch(depthUrl));
    if(!depthResponse.ok) throw new Error(`Benchmark depth HTTP ${depthResponse.status}`);
    const architecture={color,depth:new Uint16Array(await depthResponse.arrayBuffer()),width:manifest.width,height:manifest.height,sprites:manifest.sprites};
    const baseline=await bounded('Create baseline renderer',BaselineRenderer.create(gpu));
    const candidate=await bounded('Create candidate renderer',CandidateRenderer.create(gpu,architecture));
    const renderers={baseline,candidate};
    const sources={baseline:baselineManifest,
      baselineRendererSHA256:await textHash(baselineRendererSource),baselineShaderSHA256:await textHash(baselineShaderSource),
      candidateRendererSHA256:await textHash(candidateRendererSource),candidateShaderSHA256:await textHash(candidateShaderSource),
      trialColorSHA256:manifest.color_sha256,trialDepthSHA256:manifest.depth_sha256};
    if(sources.baselineRendererSHA256!==baselineManifest.files['sprites.ts'] || sources.baselineShaderSHA256!==baselineManifest.files['sprites.wgsl'])
      throw new Error('Baseline source snapshot does not match its pinned manifest');
    const cases=[];
    for(const scale of [1,1.75,3]) {
      canvas.width=Math.ceil(460*scale);canvas.height=Math.ceil(390*scale);
      const ox=230*scale,oy=112*scale;
      const historical=buildStaticInstances({width:6,height:6,walls:new Uint32Array(),edges:new Uint32Array(),showCutAwayWalls:false},ox,oy,16,scale);
      const props=new Float32Array(12*FLOATS_PER_INSTANCE);
      for(let i=0;i<12;i++) {
        const x=(i%4)+1,y=Math.floor(i/4)+1;
        const id=spriteIndex(i%3===0?'offlineDeskSW':i%3===1?'offlineBunk':'sim');
        writeInstance(props,i,ox+((x-y)*32+spriteDrawOffsetX(id))*scale,
          oy+((x+y)*21+spriteDrawOffsetY(id))*scale,layeredDepth(x,y,16,LAYER_PROP),id);
      }
      const inputs={staticsSHA256:await arrayHash(historical.instances),lowWallsSHA256:await arrayHash(historical.lowInstances),
        dynamicsSHA256:await arrayHash(props),staticCount:historical.count,lowCount:historical.lowInstances.length/FLOATS_PER_INSTANCE,dynamicCount:12,
        width:canvas.width,height:canvas.height,scale,ambient:[1,1,1,1],skyShade:0};
      for(const renderer of Object.values(renderers)) renderer.setStaticGeometry(historical.instances,historical.count,historical.lowInstances);
      const batch = async (name,count,label) => {
        const start=performance.now();
        for(let i=0;i<count;i++) renderers[name].draw(props,12,scale);
        await submitted(label);
        return performance.now()-start;
      };
      for(const name of ['baseline','candidate']) await batch(name,warmupFrames,`Warm ${name} ${scale}`);
      const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
      const context=copy.getContext('2d',{willReadFrequently:true});
      const pixels={};
      for(const name of ['baseline','candidate']) {
        await batch(name,1,`Compare ${name} ${scale}`);
        context.clearRect(0,0,copy.width,copy.height);context.drawImage(canvas,0,0);
        pixels[name]=await arrayHash(context.getImageData(0,0,copy.width,copy.height).data);
      }
      const batches=[];
      for(let round=0;round<rounds;round++) {
        const order=round%2===0?['baseline','candidate']:['candidate','baseline'];
        const timing={round,order};
        for(const name of order) timing[name]=await batch(name,frames,`Batch ${round} ${name} ${scale}`);
        timing.deltaPerFrame=(timing.candidate-timing.baseline)/frames;
        batches.push(timing);
      }
      const deltas=batches.map(b=>b.deltaPerFrame),mean=deltas.reduce((a,b)=>a+b,0)/rounds;
      const deviation=Math.sqrt(deltas.reduce((sum,value)=>sum+(value-mean)**2,0)/(rounds-1));
      const halfWidth=2.201*deviation/Math.sqrt(rounds);
      const unchangedInputs=inputs.staticsSHA256===await arrayHash(historical.instances) &&
        inputs.lowWallsSHA256===await arrayHash(historical.lowInstances) && inputs.dynamicsSHA256===await arrayHash(props);
      cases.push({inputs,pixels,pixelsEqual:pixels.baseline===pixels.candidate,unchangedInputs,batches,
        summary:{baselineMedianPerFrame:median(batches.map(b=>b.baseline/frames)),candidateMedianPerFrame:median(batches.map(b=>b.candidate/frames)),
          pairedMeanDeltaPerFrame:mean,pairedDeltaRange:[Math.min(...deltas),Math.max(...deltas)],approximatePairedMean95Interval:[mean-halfWidth,mean+halfWidth]}});
    }
    const error=await bounded('Resolve benchmark validation',gpu.device.popErrorScope());
    stage('Complete');
    return {pass:!error&&cases.every(c=>c.pixelsEqual&&c.unchangedInputs),error:error?.message??null,sources,cases,
      framesPerBatch:frames,warmupFramesPerRenderer:warmupFrames,pairedRounds:rounds,
      timingScope:'CPU submissions plus GPU completion, shared device/canvas, alternating order. Upload and compilation excluded by warmup. Not GPU timestamps.',
      uncertainty:'Approximate paired t interval (11 degrees of freedom); scheduling, thermal drift and correlated batches limit inference. One machine and browser session.',
      userAgent:navigator.userAgent,visibility:document.visibilityState};
  } finally { color?.close();gpu?.device.destroy(); }
}
