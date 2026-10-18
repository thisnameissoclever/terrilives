import staticDepth from '../../../assets/models/sims/character-repair/fixture-depth/manifest.json';
import aquariumDepth from '../../../assets/models/sims/character-repair/aquarium-depth/manifest.json';
import outdoorDepth from '../../../assets/models/sims/character-repair/outdoor-depth/manifest.json';
import shelfDepth from '../../../assets/models/sims/character-repair/shelf-depth/manifest.json';
import components from '../../../assets/models/sims/character-repair/components/manifest.json';
import droppedBooks from '../../../assets/models/sims/character-repair/dropped-book/manifest.json';
import {ATLAS_WIDTH,ATLAS_HEIGHT,ATLAS_PAGE_FILES,SPRITES} from './atlas.js';
import {FLOATS_PER_SPRITE} from './sprite-table-layout.js';
import {spriteDrawOffsetX,spriteDrawOffsetY} from './sprite-anchors.js';
import {spriteWidth,spriteHeight} from './sprite-size.js';
import {TILE_HALF_HEIGHT} from './iso.js';

const files=import.meta.glob<string>('../../../assets/models/sims/character-repair/{fixture-depth,aquarium-depth,outdoor-depth,shelf-depth,components,dropped-book}/*.rgba',{eager:true,query:'?url',import:'default'});
interface Rectangle {pageIndex:number;x:number;y:number;w:number;h:number}
interface Page {pageIndex:number;path:string;sha256:string;width:number;height:number}
interface Entry extends Rectangle {density:number;page:number}
interface State {atlasIndex:number;anchorOffset:readonly number[];pixelDensity:number;color:Rectangle;depth:Rectangle}
export interface FixtureDrawRecord {readonly sprite:number;readonly depth:number;readonly offsetX:number;readonly offsetY:number}
const pages:{folder:string;record:Page;layer:number}[]=[];
const entries:Entry[]=[];
const depths=new Map<number,number>(),shelves=new Map<number,number>();
const states=new Map<number,Map<string,FixtureDrawRecord>>(),dropped=new Map<number,FixtureDrawRecord>();

function addPages(folder:string,records:readonly Page[]):number {
  const start=pages.length;
  for(const [index,record] of records.entries()){
    if(record.pageIndex!==index||record.width>ATLAS_WIDTH||record.height>ATLAS_HEIGHT)throw new Error('Fixture companion page registration is invalid.');
    pages.push({folder,record,layer:ATLAS_PAGE_FILES.length+1+start+index});
  }
  return start;
}
function add(rect:Rectangle,density:number,pageBase:number):number {
  const page=pages[pageBase+rect.pageIndex]?.record;
  if(!page||density<=0||rect.x<0||rect.y<0||rect.w<=0||rect.h<=0||rect.x+rect.w>page.width||rect.y+rect.h>page.height)throw new Error('Fixture companion rectangle is invalid.');
  entries.push({...rect,density,page:pageBase+rect.pageIndex});return entries.length-1;
}
for(const [folder,manifest] of [['fixture-depth',staticDepth],['aquarium-depth',aquariumDepth],['outdoor-depth',outdoorDepth]] as const){
  if(manifest.state!=='complete')throw new Error('Fixture depth export is incomplete.');
  const pageBase=addPages(folder,manifest.pages);
  for(const row of manifest.sprites){
    const sprite=SPRITES[row.sprite];
    if(!sprite||sprite.name!==row.name||sprite.w!==row.w||sprite.h!==row.h||(sprite.pixel_density??1)!==row.pixelDensity||depths.has(row.sprite))throw new Error('Fixture depth registration differs from the color atlas.');
    depths.set(row.sprite,add(row,row.pixelDensity,pageBase));
  }
}
if(shelfDepth.state!=='complete')throw new Error('Shelf depth export is incomplete.');
const shelfPages=addPages('shelf-depth',shelfDepth.pages);
for(const facing of Object.values(shelfDepth.facings)){
  const source=SPRITES[facing.atlasIndex],density=source.pixel_density??1;
  if(facing.slots.length!==24||facing.shell.w!==source.w||facing.shell.h!==source.h)throw new Error('Shelf depth registration differs from its source.');
  shelves.set(facing.atlasIndex,add(facing.shell,density,shelfPages));
  for(const [index,slot] of facing.slots.entries()){
    if(slot.slot!==index||slot.w!==source.w||slot.h!==source.h)throw new Error('Shelf depth slots are not in physical slot order.');
    add(slot,density,shelfPages);
  }
}
function addState(row:State,colorPages:number,depthPages:number):FixtureDrawRecord {
  const source=row.atlasIndex;
  if(!SPRITES[source]||row.color.w!==row.depth.w||row.color.h!==row.depth.h)throw new Error('Fixture state color and depth have different registration.');
  return {sprite:add(row.color,row.pixelDensity,colorPages),depth:add(row.depth,row.pixelDensity,depthPages),
    offsetX:spriteDrawOffsetX(source)+(row.color.w/row.pixelDensity-spriteWidth(source))/2-row.anchorOffset[0],
    offsetY:spriteDrawOffsetY(source)+row.color.h/row.pixelDensity-spriteHeight(source)-row.anchorOffset[1]};
}
for(const [folder,manifest] of [['components',components],['dropped-book',droppedBooks]] as const){
  if(manifest.state!=='complete')throw new Error('Fixture state export is incomplete.');
  const colorPages=addPages(folder,manifest.colorPages),depthPages=addPages(folder,manifest.depthPages);
  for(const row of manifest.states){
    const record=addState(row,colorPages,depthPages);
    if('state' in row){const list=states.get(row.atlasIndex)??new Map<string,FixtureDrawRecord>();list.set(row.state,record);states.set(row.atlasIndex,list);}
    else dropped.set(row.atlasIndex,record);
  }
}

/** Counts include every appended color and depth record, after the grime page. */
export const FIXTURE_DEPTH_PAGE_COUNT=pages.length;
export const FIXTURE_DEPTH_COUNT=entries.length;
let drawBase=0;
const resolved=new Map<FixtureDrawRecord,FixtureDrawRecord>();
function resolve(record:FixtureDrawRecord|undefined,base:number):FixtureDrawRecord|null {
  if(!record||base<=0)return null;
  if(drawBase!==base){resolved.clear();drawBase=base;}
  let absolute=resolved.get(record);
  if(!absolute){absolute={...record,sprite:base+record.sprite,depth:base+record.depth};resolved.set(record,absolute);}
  return absolute;
}
export function fixtureDepthSprite(sprite:number,base:number):number|null {
  const index=depths.get(sprite);return index===undefined||base<=0?null:base+index;
}
/** The next 24 records are the individual physical stock slots. */
export function shelfDepthSprite(sprite:number,base:number):number|null {
  const index=shelves.get(sprite);return index===undefined||base<=0?null:base+index;
}
export function fixtureDrawRecord(sprite:number,base:number,clip?:string,sample=0,replaceUpperBunk=false):FixtureDrawRecord|null {
  const variants=states.get(sprite);
  let state:string|undefined;
  if(clip==='fridge')state=components.families.fridge.clipSamples[Math.min(7,Math.max(0,Math.floor(sample)))];
  else if(clip==='exercise')state=components.families.bike.clipSamples[Math.floor(sample)%8];
  else if(clip==='bed_sleep'||clip==='bunk_sleep'&&replaceUpperBunk)state='cover-removed';
  return resolve(state===undefined?dropped.get(sprite):variants?.get(state),base);
}
export function fixtureSurfaceHeight(sprite:number):number|null {
  const name=SPRITES[sprite]?.name;
  if(name?.startsWith('offlineCounter'))return .86;
  if(name?.startsWith('offlineDiningTable'))return .79;
  if(name?.startsWith('offlineStove'))return .882;
  return null;
}
/** Surface props are authored at z=0; the layout is a projected pixel displacement. */
export function surfacePropDepthOffset(sprite:number,pointY:number):number {
  const height=fixtureSurfaceHeight(sprite);
  if(height===null)throw new Error('Surface prop has no authored support height.');
  return (pointY+height*Math.sqrt(1166))/TILE_HALF_HEIGHT;
}
export function fixtureDepthTable():Float32Array<ArrayBuffer>{
  const out=new Float32Array(FIXTURE_DEPTH_COUNT*FLOATS_PER_SPRITE);
  for(const [index,row] of entries.entries())out.set([row.x/ATLAS_WIDTH,row.y/ATLAS_HEIGHT,
    (row.x+row.w)/ATLAS_WIDTH,(row.y+row.h)/ATLAS_HEIGHT,row.w/row.density,row.h/row.density,0,0,0,0,pages[row.page].layer,0],index*FLOATS_PER_SPRITE);
  return out;
}
export async function uploadFixtureDepth(device:GPUDevice,texture:GPUTexture):Promise<void>{
  for(const {folder,record:page,layer} of pages){
    const url=Object.entries(files).find(([name])=>name.endsWith('/'+folder+'/'+page.path))?.[1];
    if(!url)throw new Error('Fixture companion page is missing.');
    const response=await fetch(url);if(!response.ok)throw new Error('Fixture companion page could not load.');
    const data=await response.arrayBuffer();
    if(data.byteLength!==page.width*page.height*4)throw new Error('Fixture companion page length is invalid.');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(digest!==page.sha256)throw new Error('Fixture companion checksum is invalid.');
    device.queue.writeTexture({texture,origin:[0,0,layer]},data,{bytesPerRow:page.width*4},{width:page.width,height:page.height});
  }
}
