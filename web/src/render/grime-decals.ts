import { ATLAS_WIDTH, ATLAS_HEIGHT, ATLAS_PAGE_FILES, SPRITE_CONTENT_BOUNDS } from './atlas.js';
import { FLOATS_PER_SPRITE } from './sprite-table-layout.js';
import { FLOATS_PER_INSTANCE, writeInstance, FOOTPRINT_PROJECTION, OFFSET_WALL_MASK,
  OFFSET_WALL_DEPTH_STEP, OFFSET_FOOTPRINT_SPAN, OFFSET_PROJECTION_ANCHOR_X } from './instances.js';
import { FLOOR_DEPTH, DEPTH_LAYER_STEP, LAYER_FOREGROUND, layeredDepth, screenX, screenY, TILE_HALF_HEIGHT } from './iso.js';
import { surfaceLayout } from './surface-items.js';
import { spriteDrawOffsetY } from './sprite-anchors.js';
import { spriteHeight } from './sprite-size.js';

export const GRIME_SPRITE_COUNT = 12;
export const GRIME_PAGE = ATLAS_PAGE_FILES.length;
const CELL_WIDTH=768, CELL_HEIGHT=512;
const DENSITIES=[12,24,48] as const;

export function grimeSpriteTable():Float32Array<ArrayBuffer> {
  const rows=new Float32Array(GRIME_SPRITE_COUNT*FLOATS_PER_SPRITE);
  for(let size=0;size<3;size++)for(let style=0;style<4;style++){
    const at=(size*4+style)*FLOATS_PER_SPRITE,x=(style%2)*CELL_WIDTH,y=Math.floor(style/2)*CELL_HEIGHT;
    rows.set([x/ATLAS_WIDTH,y/ATLAS_HEIGHT,(x+CELL_WIDTH)/ATLAS_WIDTH,(y+CELL_HEIGHT)/ATLAS_HEIGHT,
      CELL_WIDTH/DENSITIES[size],CELL_HEIGHT/DENSITIES[size]],at);
    rows[at+10]=GRIME_PAGE;
  }return rows;
}

export async function uploadGrimePage(device:GPUDevice,texture:GPUTexture):Promise<void> {
  const response=await fetch(`${import.meta.env.BASE_URL}grime/household-stains.png`);
  if(!response.ok)throw new Error(`Grime artwork returned ${response.status}`);
  const bitmap=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
  try {
    if(bitmap.width!==1536||bitmap.height!==1024)throw new Error('Grime artwork dimensions changed');
    device.queue.copyExternalImageToTexture({source:bitmap},{texture,origin:[0,0,GRIME_PAGE]},
      {width:bitmap.width,height:bitmap.height});
  }finally{bitmap.close();}
}

export interface GrimeSource {
  floorGrime():Uint32Array; surfaceGrime():Uint32Array; binWaste():Uint32Array;
  positions():Float32Array;sprites():Uint32Array;ids():Uint32Array;
  footprintWidths():Uint32Array;footprintDepths():Uint32Array;count:number;
}

export function grimeMarks(amount:number):number {return amount>0?1:0;}
let scratch=new Float32Array();
let opacity=new Float32Array();

/** Stains have their own depth and leave the underlying material colors intact. */
export function buildGrimeInstances(source:GrimeSource,width:number,gridSize:number,
  originX:number,originY:number,scale:number,spriteBase:number):{instances:Float32Array<ArrayBuffer>;opacity:Float32Array<ArrayBuffer>;count:number} {
  const floors=source.floorGrime(),surfaces=source.surfaceGrime(),bins=source.binWaste();
  const positions=source.positions(),sprites=source.sprites(),ids=source.ids();
  const widths=source.footprintWidths(),depths=source.footprintDepths();
  let marksNeeded=floors.length;
  for(let row=0;row<source.count;row++)marksNeeded+=grimeMarks(surfaces[row]??0)+Number(grimeMarks(bins[row]??0)>0);
  const capacity=marksNeeded*FLOATS_PER_INSTANCE;
  if(scratch.length<capacity)scratch=new Float32Array(capacity);
  if(opacity.length<marksNeeded)opacity=new Float32Array(marksNeeded);
  let count=0;
  function mark(x:number,y:number,depth:number,size:number,style:number,amount:number):number {
    const slot=count++;
    opacity[slot]=Math.max(0,Math.min(1,amount/1000));
    writeInstance(scratch,slot,x,y+(CELL_HEIGHT/DENSITIES[size]/2-TILE_HALF_HEIGHT)*scale,depth,spriteBase+size*4+style);
    return slot;
  }
  for(let i=0;i+1<floors.length;i+=2){
    const cell=floors[i],x=cell%width,y=Math.floor(cell/width),marks=grimeMarks(floors[i+1]);
    for(let n=0;n<marks;n++)mark(screenX(x,y,originX,scale)+(n?7:-3)*scale,
      screenY(x,y,originY,scale)+(n?3:-2)*scale,FLOOR_DEPTH-DEPTH_LAYER_STEP/4,0,
      (cell+n)%2===0?1:2,floors[i+1]);
  }
  for(let row=0;row<source.count;row++){
    if(!(surfaces[row]??0)&&!(bins[row]??0))continue;
    const layout=surfaceLayout(sprites[row]),x=positions[row*2],y=positions[row*2+1];
    if(layout && layout.kind!=='stove'){
      const prop=layout.props[0],bounds=SPRITE_CONTENT_BOUNDS[prop];
      const lift=spriteDrawOffsetY(prop)+TILE_HALF_HEIGHT-spriteHeight(prop)+(bounds[1]+bounds[3])/2+2;
      for(let n=0;n<grimeMarks(surfaces[row]??0);n++){
        const point=layout.points[(n+1)%layout.points.length];
        const slot=mark(screenX(x,y,originX,scale)+point[0]*scale,screenY(x,y,originY,scale)+(point[1]+lift)*scale,
          layeredDepth(x,y,gridSize,LAYER_FOREGROUND-.5),1,(ids[row]+n)%2===0?0:3,surfaces[row]);
        if(widths[row]!==depths[row]){
          const at=slot*FLOATS_PER_INSTANCE;scratch[at+OFFSET_WALL_MASK]=FOOTPRINT_PROJECTION;
          scratch[at+OFFSET_WALL_DEPTH_STEP]=layeredDepth(0,0,gridSize,1)-layeredDepth(1,0,gridSize,1);
          scratch[at+OFFSET_FOOTPRINT_SPAN]=(widths[row]-depths[row])/2;scratch[at+OFFSET_PROJECTION_ANCHOR_X]=point[0];
        }
      }
    } else if(grimeMarks(bins[row]??0)>0){
      const bounds=SPRITE_CONTENT_BOUNDS[sprites[row]];
      const top=spriteDrawOffsetY(sprites[row])+TILE_HALF_HEIGHT-spriteHeight(sprites[row])+(bounds?.[1]??0)+5;
      mark(screenX(x,y,originX,scale),screenY(x,y,originY,scale)+top*scale,
        layeredDepth(x,y,gridSize,LAYER_FOREGROUND-.5),2,3,bins[row]);
    }
  }
  return {instances:scratch,opacity,count};
}
