import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import staticDepth from '../../assets/models/sims/character-repair/fixture-depth/manifest.json';
import aquariumDepth from '../../assets/models/sims/character-repair/aquarium-depth/manifest.json';
import outdoorDepth from '../../assets/models/sims/character-repair/outdoor-depth/manifest.json';
import shelfDepth from '../../assets/models/sims/character-repair/shelf-depth/manifest.json';
import components from '../../assets/models/sims/character-repair/components/manifest.json';
import dropped from '../../assets/models/sims/character-repair/dropped-book/manifest.json';
import {fixtureDepthSprite,fixtureDepthTable,fixtureSurfaceHeight,fixtureDrawRecord,shelfDepthSprite,surfacePropDepthOffset,FIXTURE_DEPTH_COUNT,FIXTURE_DEPTH_PAGE_COUNT} from '../src/render/fixture-depth.js';
import {SPRITES,spriteIndex,ATLAS_WIDTH,ATLAS_HEIGHT,ATLAS_PAGE_FILES} from '../src/render/atlas.js';
import {spriteWidth,spriteHeight} from '../src/render/sprite-size.js';
import {spriteDrawOffsetX,spriteDrawOffsetY} from '../src/render/sprite-anchors.js';
import {FLOATS_PER_SPRITE} from '../src/render/sprite-table-layout.js';
const directory=new URL('../../assets/models/sims/character-repair/',import.meta.url);
const digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const pages=new Map<string,Buffer>();
function page(folder:string,record:{path:string;sha256:string;width:number;height:number}):Buffer {
 const key=folder+'/'+record.path;let data=pages.get(key);
 if(!data){data=readFileSync(new URL(key,directory));pages.set(key,data);expect(digest(data)).toBe(record.sha256);expect(data.length).toBe(record.width*record.height*4);}
 return data;
}

const bundles=[['fixture-depth',staticDepth],['aquarium-depth',aquariumDepth],['outdoor-depth',outdoorDepth],['shelf-depth',shelfDepth],['components',components],['dropped-book',dropped]] as const;
const sourceHashes=new Map<string,string>();
const pageCases:{folder:string;record:{path:string;sha256:string;width:number;height:number}}[]=[];
for(const [folder,manifest] of bundles){
 const records='pages' in manifest?manifest.pages:[...manifest.colorPages,...manifest.depthPages];
 for(const record of records)pageCases.push({folder,record});
 if('sources' in manifest)for(const source of Object.values(manifest.sources))sourceHashes.set(source.path,source.sha256);
 if('source' in manifest)sourceHashes.set(manifest.source.path,manifest.source.sha256);
 if('coverageSources' in manifest)for(const [path,sha] of Object.entries(manifest.coverageSources))sourceHashes.set(path,sha);
}
it.each(pageCases)('verifies immutable $folder/$record.path bytes',({folder,record})=>{page(folder,record);});
it.each([...sourceHashes])('verifies immutable source %s',(path,sha)=>{
 expect(digest(readFileSync(new URL('../../'+path,import.meta.url)))).toBe(sha);
});
it('requires fixture coverage provenance to match the current sprite atlas',()=>{
 const atlasHash=digest(readFileSync(new URL('../../assets/sprites/atlas.toml',import.meta.url)));
 for(const manifest of [staticDepth,aquariumDepth,outdoorDepth])expect(manifest.atlasSha256).toBe(atlasHash);
});
it('binds all completed companion pages to valid appended atlas records',()=>{
 for(const [,manifest] of bundles)expect(manifest.state).toBe('complete');
 expect(pageCases.length).toBe(FIXTURE_DEPTH_PAGE_COUNT);
 const table=fixtureDepthTable();expect(table.length).toBe(FIXTURE_DEPTH_COUNT*FLOATS_PER_SPRITE);expect(FIXTURE_DEPTH_COUNT).toBe(412);
 for(let index=0;index<FIXTURE_DEPTH_COUNT;index++){
  const row=table.subarray(index*FLOATS_PER_SPRITE,(index+1)*FLOATS_PER_SPRITE);
  expect(row[0]).toBeGreaterThanOrEqual(0);expect(row[1]).toBeGreaterThanOrEqual(0);expect(row[2]).toBeLessThanOrEqual(1);expect(row[3]).toBeLessThanOrEqual(1);
  expect(row[10]).toBeGreaterThanOrEqual(ATLAS_PAGE_FILES.length+1);expect(row[10]).toBeLessThan(ATLAS_PAGE_FILES.length+1+FIXTURE_DEPTH_PAGE_COUNT);
 }
});

it('registers every static, aquarium and outdoor frame and samples separate near and far counter surfaces',()=>{
 for(const manifest of [staticDepth,aquariumDepth,outdoorDepth])for(const row of manifest.sprites){
  expect(SPRITES[row.sprite].name).toBe(row.name);expect(SPRITES[row.sprite].w).toBe(row.w);expect(SPRITES[row.sprite].h).toBe(row.h);
  expect(row.x+row.w).toBeLessThanOrEqual(ATLAS_WIDTH);expect(row.y+row.h).toBeLessThanOrEqual(ATLAS_HEIGHT);
  expect(fixtureDepthSprite(row.sprite,40000)).not.toBeNull();expect(row.minSum).toBeGreaterThanOrEqual(-2);expect(row.maxSum).toBeLessThanOrEqual(2);
 }
 const proof=JSON.parse(readFileSync(new URL('../../assets/models/kitchen/owner-review-pending/counter/candidate-01/proof.json',import.meta.url),'utf8'));
 for(const row of staticDepth.sprites.filter(row=>row.name.startsWith('offlineCounter')))for(const sum of [-.5,.5]){
  const data=page('fixture-depth',staticDepth.pages[row.pageIndex]);
  const x=Math.floor(proof.origin_pixels[0]/4),y=Math.floor(proof.origin_pixels[1]/4+(21*sum-.86*Math.sqrt(1166))*2);
  const at=((row.y+y)*staticDepth.pages[row.pageIndex].width+row.x+x)*4;
  expect(data[at+3]).toBeGreaterThan(0);expect((data[at]*256+data[at+1])/65535*4-2).toBeCloseTo(sum,1);
 }
 expect(fixtureDepthSprite(spriteIndex('offlineCounter'),0)).toBeNull();expect(fixtureSurfaceHeight(spriteIndex('offlineCounter'))).toBe(.86);
});

it('keeps shelf shell and all 24 stock depth records consecutive and independently masked',()=>{
 const table=fixtureDepthTable();
 for(const facing of Object.values(shelfDepth.facings)){
  const shell=shelfDepthSprite(facing.atlasIndex,40000)!;
  for(const [index,row] of [facing.shell,...facing.slots].entries()){
   const at=(shell-40000+index)*FLOATS_PER_SPRITE;
   expect(table[at]).toBe(row.x/ATLAS_WIDTH);expect(table[at+1]).toBe(row.y/ATLAS_HEIGHT);
   const data=page('shelf-depth',shelfDepth.pages[row.pageIndex]);let covered=0,minimum=Infinity,maximum=-Infinity;
   for(let y=0;y<row.h;y++)for(let x=0;x<row.w;x++){
    const at=((row.y+y)*2048+row.x+x)*4;if(!data[at+3])continue;covered++;
    const value=(data[at]*256+data[at+1])/65535*4-2;minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);
   }
   expect(covered).toBeGreaterThan(0);expect(covered).toBeLessThan(row.w*row.h);expect(minimum).toBeCloseTo(row.minSum,3);expect(maximum).toBeCloseTo(row.maxSum,3);
  }
 }
});

it('selects actor-free moving components and preserves source anchor registration',()=>{
 const table=fixtureDepthTable();
 for(const row of components.states){
  const clip=row.family==='bike'?'exercise':row.family==='bed'?'bed_sleep':row.family==='bunk'?'bunk_sleep':'fridge';
  const sample=row.family==='fridge'?components.families.fridge.clipSamples.indexOf(row.state):row.sample;
  const draw=fixtureDrawRecord(row.atlasIndex,40000,clip,sample,true)!;expect(draw).not.toBeNull();
  expect(table[(draw.sprite-40000)*FLOATS_PER_SPRITE]).toBe(row.color.x/ATLAS_WIDTH);
  expect(table[(draw.depth-40000)*FLOATS_PER_SPRITE+1]).toBe(row.depth.y/ATLAS_HEIGHT);
  expect(draw.offsetX).toBeCloseTo(spriteDrawOffsetX(row.atlasIndex)+(row.color.w/row.pixelDensity-spriteWidth(row.atlasIndex))/2-row.anchorOffset[0]);
  expect(draw.offsetY).toBeCloseTo(spriteDrawOffsetY(row.atlasIndex)+row.color.h/row.pixelDensity-spriteHeight(row.atlasIndex)-row.anchorOffset[1]);
 }
 for(const facing of ['','NW','SW','NE']){
  const fridge=spriteIndex('offlineFridge'+facing);
  expect(fixtureDrawRecord(fridge,40000,'fridge',7)).toBe(fixtureDrawRecord(fridge,40000,'fridge',0));
  expect(fixtureDrawRecord(spriteIndex('offlineBunk'+facing),40000,'bunk_sleep',0)).toBeNull();
  expect(fixtureDrawRecord(spriteIndex('offlineDoubleBed'+facing),40000,'bed_sleep',0)).not.toBeNull();
 }
});

it('registers reconstructed dropped books and converts prop layout pixels at the authored support height',()=>{
 for(const row of dropped.states){
  const draw=fixtureDrawRecord(row.atlasIndex,40000)!;expect(draw).not.toBeNull();
  expect(draw.offsetX-spriteDrawOffsetX(row.atlasIndex)).toBeCloseTo((row.color.w/row.pixelDensity-spriteWidth(row.atlasIndex))/2-row.anchorOffset[0]);
  expect(draw.offsetY-spriteDrawOffsetY(row.atlasIndex)).toBeCloseTo(row.color.h/row.pixelDensity-spriteHeight(row.atlasIndex)-row.anchorOffset[1]);
 }
 for(const [name,height] of [['offlineCounter',.86],['offlineDiningTable',.79],['offlineStove',.882]] as const){
  for(const sum of [-.6,0,.6])expect(surfacePropDepthOffset(spriteIndex(name),sum*21-height*Math.sqrt(1166))).toBeCloseTo(sum,8);
 }
});
