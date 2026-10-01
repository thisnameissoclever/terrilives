// Isolated proof using the production SpriteRenderer and frame builder.
import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { SPRITES, SPRITE_PAIRS, spriteIndex } from '../src/render/atlas.ts';
import { FLOATS_PER_INSTANCE, writeInstance, writeArchitectureDepth, writeArchitectureFloor } from '../src/render/instances.ts';
import { layeredDepth, LAYER_PROP, LAYER_SIM, FLOOR_DEPTH } from '../src/render/iso.ts';
import { buildInstances, simBodySprite } from '../src/frame.ts';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.ts';
import { buildStaticInstances } from '../src/render/tiles.ts';
import manifest from '../../docs/assets/review-evidence/architecture/room-01/trial/candidate-08/manifest.json';

const colorUrl = new URL('../../docs/assets/review-evidence/architecture/room-01/trial/candidate-08/color.png', import.meta.url);
const depthUrl = new URL('../../docs/assets/review-evidence/architecture/room-01/trial/candidate-08/depth.r16f', import.meta.url);
const empty = new Float32Array();
const step = layeredDepth(0, 0, 16, LAYER_PROP) - layeredDepth(1, 0, 16, LAYER_PROP);
const entry = name => {
  const index = manifest.sprites.findIndex(s => s.name === name);
  if (index < 0) throw new Error(`Missing architecture sprite ${name}`);
  return { ...manifest.sprites[index], id: SPRITES.length + index };
};

function architectureRow(name, x, y, scale, ox, oy, { floor = false, low = false, opacity = 1 } = {}) {
  const s = entry(name), row = new Float32Array(FLOATS_PER_INSTANCE);
  writeInstance(row, 0, ox + ((x-y)*32 + s.w/4-s.origin[0])*scale,
    oy + ((x+y)*21 + s.h/2-s.anchor[1])*scale,
    floor ? FLOOR_DEPTH : layeredDepth(x,y,16,LAYER_PROP), s.id);
  if(floor) writeArchitectureFloor(row,0,x,y);
  else writeArchitectureDepth(row, 0, step, opacity, low);
  return row;
}

function join(rows) {
  const out = new Float32Array(rows.length*FLOATS_PER_INSTANCE);
  rows.forEach((r,i) => out.set(r,i*FLOATS_PER_INSTANCE));
  return out;
}

function referenceProps(scale, ox, oy) {
  const desk = spriteIndex('offlineDeskSW');
  const bed = spriteIndex('offlineBunk');
  const positions = new Float32Array([1,.1, 3.5,2, 3.5,3]);
  const source = { count: 3, positions: () => positions, prevPositions: () => positions,
    ids: () => new Uint32Array([30,40,7]), kinds: () => new Uint32Array([1,1,0]),
    sprites: () => new Uint32Array([desk,bed,spriteIndex('sim')]),
    activities: () => new Uint32Array([0,0,3]), visualActions: () => new Uint32Array([0,0,9]),
    facings: () => new Uint32Array([1,1,1]), interactionTargets: () => new Uint32Array([0xffffffff,0xffffffff,40]),
    simIds: () => new Uint32Array([0,0,1]), carrying: () => new Uint32Array([0xffffffff,0xffffffff,0xffffffff]), itemKinds: () => [],
    footprintWidths: () => new Uint32Array([2,2,1]), footprintDepths: () => new Uint32Array([1,1,1]) };
  const rows = buildInstances(source,1,ox,oy,16,null,scale).slice(0,3*FLOATS_PER_INSTANCE);
  if (!SPRITE_PAIRS[rows[2*FLOATS_PER_INSTANCE+3]]) throw new Error('Occupied bed reference is missing its paired composite');
  const standing = new Float32Array(FLOATS_PER_INSTANCE);
  const id = simBodySprite(spriteIndex('sim'),0,1,0,false,1.5,3.5);
  writeInstance(standing,0,ox+((1.5-3.5)*32+spriteDrawOffsetX(id))*scale,
    oy+((1.5+3.5)*21+spriteDrawOffsetY(id))*scale,layeredDepth(1.5,3.5,16,LAYER_SIM),id);
  const all = new Float32Array(rows.length+standing.length); all.set(rows); all.set(standing,rows.length);
  return all;
}

/** Captures stay in the disposable browser context; no storage or game state. */
export async function architectureRoomProof({ scale = 1, show = true, cutaway = true, probes = true } = {}) {
  const stage = label => {
    globalThis.__architectureProofProgress = { label, time: performance.now(), scale, probes };
    console.debug('Architecture proof:', label);
  };
  const bounded = async (label, promise) => {
    stage(label);
    let timer;
    try {
      return await Promise.race([promise,new Promise((_, reject) => {
        timer=setTimeout(()=>reject(new Error(`Architecture proof timed out: ${label}`)),10000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(460*scale); canvas.height = Math.ceil(390*scale);
  const gpu = await bounded('Acquire GPU',initDevice(canvas));
  const submitted = label => bounded(label,Promise.race([gpu.device.queue.onSubmittedWorkDone(),
    gpu.device.lost.then(info=>{throw new Error(`Architecture proof device lost: ${info.reason}; ${info.message}`);})]));
  let color;
  try {
  gpu.device.pushErrorScope('validation');
  const colorResponse=await bounded('Fetch trial color',fetch(colorUrl));
  if(!colorResponse.ok) throw new Error(`Trial color HTTP ${colorResponse.status}`);
  color = await bounded('Decode trial color',createImageBitmap(await colorResponse.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
  const depthResponse=await bounded('Fetch trial depth',fetch(depthUrl));
  if(!depthResponse.ok) throw new Error(`Trial depth HTTP ${depthResponse.status}`);
  const depth = new Uint16Array(await depthResponse.arrayBuffer());
  const architecture = { color, depth, width: manifest.width, height: manifest.height, sprites: manifest.sprites };
  const started = performance.now();
  const renderer = await bounded('Create SpriteRenderer',SpriteRenderer.create(gpu, architecture));
  stage('Read carpet reference pixels');
  const atlasCopy=document.createElement('canvas'); atlasCopy.width=color.width; atlasCopy.height=color.height;
  const atlasContext=atlasCopy.getContext('2d',{willReadFrequently:true}); atlasContext.drawImage(color,0,0);
  const materialRanges={};
  for(const material of ['carpet','tile']) {
    const s=entry('floor-'+material);
    const pixels=atlasContext.getImageData(s.x,s.y,s.w,s.h).data;
    const minimum=[255,255,255],maximum=[0,0,0];
    for(let i=0;i<pixels.length;i+=4) if(pixels[i+3]===255)
      for(let c=0;c<3;c++) { minimum[c]=Math.min(minimum[c],pixels[i+c]);maximum[c]=Math.max(maximum[c],pixels[i+c]); }
    materialRanges[material]={minimum,maximum};
  }
  color.close();
  const uploadMilliseconds = performance.now()-started;
  const copy = document.createElement('canvas');
  const ctx = copy.getContext('2d',{willReadFrequently:true});
  const results=[];
  const capture = async (rows, drawScale, x, y) => {
    renderer.setStaticGeometry(rows,rows.length/FLOATS_PER_INSTANCE);
    renderer.draw(empty,0,drawScale);
    await submitted('Complete probe draw');
    copy.width=canvas.width; copy.height=canvas.height; ctx.drawImage(canvas,0,0);
    return [...ctx.getImageData(x,y,1,1).data];
  };
    if (probes) {
      canvas.width=640; canvas.height=640;
      for (const probeScale of [1,1.75,3]) for (const [surface,name,point,formula] of [
        ['front face','straight-x',[.15,.06,1.1],(x,y)=>x/32+.12],
        ['back face after rotation','straight-y',[.06,.15,1.1],(x,y)=>.12-x/32],
        ['top cap','straight-x',[.2,0,2],(x,y)=>(y+76)/21],
        ['sill','sash-x',[.1,.105,.66],(x,y)=>(y+.66*38)/21],
      ]) {
        stage(`Depth probe ${surface} at ${probeScale}`);
        // Avoid exact source-texel boundaries at every tested scale: a float32
        // interpolation may choose either neighbor on the mathematical boundary.
        const ox=320.37,oy=380.37;
        const px=Math.floor(ox+(point[0]-point[1])*32*probeScale);
        const py=Math.floor(oy+((point[0]+point[1])*21-point[2]*38)*probeScale);
        const s=entry(name);
        // Nearest texel center, independently mapped back through the fixed projection.
        const sourceX=((px+.5-ox)/probeScale+s.origin[0])*2;
        const sourceY=((py+.5-oy)/probeScale+s.origin[1])*2;
        const sourceBoundaryDistance=Math.min(Math.abs(sourceX-Math.round(sourceX)),Math.abs(sourceY-Math.round(sourceY)));
        if(sourceBoundaryDistance<.001) throw new Error(`Ambiguous source texel boundary: ${surface}, ${probeScale}`);
        const tx=Math.floor(sourceX),ty=Math.floor(sourceY);
        const lx=(tx+.5)/2-s.origin[0],ly=(ty+.5)/2-s.origin[1];
        const expectedSum=formula(lx,ly);
        const expectedDepth=layeredDepth(0,0,16,LAYER_PROP)-expectedSum*step;
        const arch=architectureRow(name,0,0,probeScale,ox,oy);
        const marker=new Float32Array(FLOATS_PER_INSTANCE);
        writeInstance(marker,0,px+.5,py+.5,expectedDepth-.012*step,spriteIndex('floor'),1,0,1);
        const markerPixel=await capture(marker,probeScale,px,py);
        const front=await capture(join([arch,marker]),probeScale,px,py);
        marker[2]=expectedDepth+.012*step;
        const behind=await capture(join([arch,marker]),probeScale,px,py);
        const frontWins=front.every((v,c)=>v===markerPixel[c]);
        const wallWins=behind.some((v,c)=>Math.abs(v-markerPixel[c])>5);
        results.push({surface,scale:probeScale,sourceBoundaryDistance,expectedSum,frontWins,wallWins,pass:frontWins&&wallWins});
      }
      const floorCases=[];
      for(const s of [1,1.75,3]) for(const origin of [[230*s,112*s],[320.37,240.37],[320.5,240.25]])
        floorCases.push({scale:s,origin,contrast:false,missing:false});
      for(const s of [.75,1.25,2.25,2.7]) for(const origin of [[320.125,240.375],[320.5,240.25]])
        floorCases.push({scale:s,origin,contrast:true,missing:false});
      for(const s of [1,1.75,3]) floorCases.push({scale:s,origin:[320.5,240.25],contrast:true,missing:true});
      canvas.width=1024;canvas.height=720;
      for(const test of floorCases) {
        const probeScale=test.scale,[ox,oy]=test.origin;
        stage(`Joined floor at ${probeScale}, ${ox}, ${oy}`);
        const rows=[];
        renderer.setArchitectureCamera(ox,oy);
        const endpoints=new Map(); let sharedEndpoints=0;
        for(let y=0;y<3;y++) for(let x=0;x<3;x++) {
          if(test.missing&&x===1&&y===1) continue;
          const material=test.contrast&&(x+y)%2?'tile':'carpet';
          rows.push(architectureRow('floor-'+material,x,y,probeScale,ox,oy,{floor:true}));
          for(const [cx,cy] of [[0,0],[1,0],[0,1],[1,1]]) {
            const gx=x+cx-.5,gy=y+cy-.5,key=`${gx},${gy}`;
            const projected=new Float32Array([ox+(gx-gy)*32*probeScale,oy+(gx+gy)*21*probeScale]);
            if(endpoints.has(key)) {
              const previous=endpoints.get(key);
              if(previous.some((v,i)=>v!==projected[i])) throw new Error('Shared canonical floor endpoint changed');
              sharedEndpoints++;
            } else endpoints.set(key,projected);
          }
        }
        await capture(join(rows),probeScale,0,0);
        stage(`Read joined floor at ${probeScale}`);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        await capture(join([...rows].reverse()),probeScale,0,0);
        const reversed=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let checked=0,holes=0,outsideChecked=0,leaks=0,orderDifferences=0,missingChecked=0;
        for(let i=0;i<pixels.length;i++) if(pixels[i]!==reversed[i]) orderDifferences++;
        for(let py=0;py<canvas.height;py++) for(let px=0;px<canvas.width;px++) {
          const sx=(px+.5-ox)/probeScale,sy=(py+.5-oy)/probeScale;
          const gx=(sx/32+sy/21)/2,gy=(sy/21-sx/32)/2;
          const at=(py*canvas.width+px)*4;
          const inside=gx>-.5&&gx<2.5&&gy>-.5&&gy<2.5;
          const missing=test.missing&&gx>.5&&gx<1.5&&gy>.5&&gy<1.5;
          // Only exact mathematical edge hits are left to the hardware's
          // top-left ownership rule. Every neighboring pixel is checked.
          const onOuterEdge=[gx+.5,gx-2.5,gy+.5,gy-2.5].some(d=>Math.abs(d)<1e-6);
          const onMissingEdge=test.missing&&[gx-.5,gx-1.5,gy-.5,gy-1.5].some(d=>Math.abs(d)<1e-6);
          if(onOuterEdge||onMissingEdge) continue;
          if((!inside&&gx>-.7&&gx<2.7&&gy>-.7&&gy<2.7)||missing) {
            outsideChecked++;
            if(missing) missingChecked++;
            if([23,23,28].some((background,c)=>Math.abs(pixels[at+c]-background)>2)) leaks++;
          }
          if(!inside||missing) continue;
          checked++;
          // On a material boundary either adjacent material may own an exact
          // edge hit, but it must still cover the pixel without background.
          const onMaterialEdge=[gx+.5,gy+.5].some(v=>Math.abs(v-Math.round(v))<1e-6);
          const material=test.contrast&&(Math.floor(gx+.5)+Math.floor(gy+.5))%2?'tile':'carpet';
          const range=materialRanges[material];
          if(onMaterialEdge) {
            if([0,1,2].some(c=>pixels[at+c]<Math.min(materialRanges.carpet.minimum[c],materialRanges.tile.minimum[c])-2)) holes++;
          } else if([0,1,2].some(c=>pixels[at+c]<range.minimum[c]-2||pixels[at+c]>range.maximum[c]+2)) holes++;
        }
        results.push({surface:'canonical floor coverage',...test,checked,holes,outsideChecked,leaks,missingChecked,sharedEndpoints,orderDifferences,
          pass:checked>1000&&holes===0&&outsideChecked>150&&leaks===0&&orderDifferences===0&&sharedEndpoints>0&&(!test.missing||missingChecked>100)});
      }
    }
    canvas.width=Math.ceil(460*scale); canvas.height=Math.ceil(390*scale);
    const ox=230*scale,oy=112*scale;
    const statics=[];
    for(let y=0;y<6;y++) for(let x=0;x<6;x++) {
      const material=x<3?'oak':y<3?'tile':'carpet';
      statics.push(architectureRow('floor-'+material,x,y,scale,ox,oy,{floor:true}));
    }
    statics.push(architectureRow('room-x',2.5,-.5,scale,ox,oy));
    statics.push(architectureRow('room-y',-.5,2.5,scale,ox,oy));
    const low=[];
    for(let n=0;n<6;n++) {
      const target=cutaway?low:statics;
      target.push(architectureRow((n===2?'doorway':'straight')+'-x'+(cutaway?'-low':''),n,5.5,scale,ox,oy,{low:cutaway}));
      target.push(architectureRow('straight-y'+(cutaway?'-low':''),5.5,n,scale,ox,oy,{low:cutaway}));
    }
    const props=referenceProps(scale,ox,oy);
    renderer.setArchitectureCamera(ox,oy);
    stage('Build historical room control');
    const historical=buildStaticInstances({width:6,height:6,walls:new Uint32Array(),
      edges:new Uint32Array(),showCutAwayWalls:!cutaway},ox,oy,16,scale);
    renderer.setStaticGeometry(historical.instances,historical.count,historical.lowInstances);
    const historicalBegin=performance.now();
    for(let i=0;i<30;i++) renderer.draw(props,props.length/FLOATS_PER_INSTANCE,scale);
    await submitted('Complete historical room timing');
    const historicalRenderMilliseconds=(performance.now()-historicalBegin)/30;
    renderer.setStaticGeometry(join(statics),statics.length,join(low));
    const begin=performance.now();
    for(let i=0;i<30;i++) renderer.draw(props,props.length/FLOATS_PER_INSTANCE,scale);
    await submitted('Complete trial room timing');
    const renderMilliseconds=(performance.now()-begin)/30;
    copy.width=canvas.width; copy.height=canvas.height; ctx.drawImage(canvas,0,0);
    if (show) {
      document.body.replaceChildren(); document.body.style='margin:0;background:#17171c;color:#eee;font:14px system-ui;';
      const caption=document.createElement('p');
      caption.textContent=`Architecture room candidate | ${scale}x | ${cutaway?'Play cutaway':'Full shell'} | Walls and floors await owner review`;
      caption.style='margin:12px'; copy.id='architecture-room';
      document.body.append(caption,copy);
    }
    const error=await bounded('Resolve GPU validation',gpu.device.popErrorScope());
    stage('Complete');
    return { pass:!error&&results.every(r=>r.pass), error:error?.message??null, results,
      measurements:{uploadMilliseconds,renderMilliseconds,historicalRenderMilliseconds,
        timingScope:'30 CPU submissions plus GPU completion; historical art uses the candidate renderer; not GPU timestamp timing',
        colorTextureBytes:manifest.color_texture_bytes,
        depthTextureBytes:manifest.depth_texture_bytes,historicalSpriteCount:SPRITES.length,trialSpriteCount:manifest.sprites.length},
      room:{scale,cutaway,staticCount:statics.length,lowCount:low.length,referenceCount:props.length/FLOATS_PER_INSTANCE,
        desk:[1,.1],occupiedBed:[3.5,2],standingSim:[1.5,3.5]}, image:copy.toDataURL() };
  } finally { color?.close(); gpu.device.destroy(); }
}
