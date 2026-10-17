import geometry from '../../../assets/models/kitchen/wall-registration.json';
import architecture from '../../../assets/models/architecture-depth.json';
import {spriteIndex} from './atlas.js';

export interface FixtureRegistrationSource {
  readonly count:number;
  positions():Float32Array;
  sprites():Uint32Array;
  lotRevision?():number;
  wallEdges?():Uint32Array|undefined;
  houseSize?():readonly [number,number];
  houseOrigin?():readonly [number,number];
}

export interface FixtureRegistration {
  readonly offsets:Float32Array;
  readonly infeasible:Uint8Array;
}

interface CachedRegistration extends FixtureRegistration {
  revision:number|undefined;count:number;edges:Uint32Array|undefined;house:readonly [number,number]|undefined;
  houseOrigin:readonly [number,number];limits:Float64Array;preview:Float32Array;
}
type Bounds=readonly [number,number,number,number];
const registrations=new WeakMap<object,CachedRegistration>();
const boundsBySprite=new Map<number,Bounds>();
const clearance=.01;
const halfWall=architecture.wallAndDoorDepth/2;
for(const fixture of geometry.fixtures){
  const [xmin,ymin]=fixture.minimum,[xmax,ymax]=fixture.maximum;
  boundsBySprite.set(spriteIndex(fixture.sprite),[-ymax,-ymin,-xmax,-xmin]);
  boundsBySprite.set(spriteIndex(fixture.sprite+'SW'),[xmin,xmax,-ymax,-ymin]);
  boundsBySprite.set(spriteIndex(fixture.sprite+'NW'),[ymin,ymax,xmin,xmax]);
  boundsBySprite.set(spriteIndex(fixture.sprite+'NE'),[-xmax,-xmin,ymin,ymax]);
}

export function kitchenFixtureBounds(sprite:number):Bounds|null {return boundsBySprite.get(sprite)??null;}

function wallConstraint(axis:number,wx:number,wy:number,bounds:Bounds,x:number,y:number,limits:Float64Array):void {
  const line=(axis===0?wx:wy)-.5,tangent=(axis===0?wy:wx)-.5;
  const center=axis===0?x:y,other=axis===0?y:x;
  const minimum=axis===0?bounds[0]:bounds[2],maximum=axis===0?bounds[1]:bounds[3];
  const tangentMin=axis===0?bounds[2]:bounds[0],tangentMax=axis===0?bounds[3]:bounds[1];
  if(other+tangentMax<=tangent-halfWall||other+tangentMin>=tangent+1+halfWall)return;
  if(center+maximum<=line-halfWall-clearance||center+minimum>=line+halfWall+clearance)return;
  const index=axis*2;
  if(center>=line)limits[index]=Math.max(limits[index],line+halfWall+clearance-center-minimum);
  else limits[index+1]=Math.min(limits[index+1],line-halfWall-clearance-center-maximum);
}

function measure(record:CachedRegistration,sprite:number,x:number,y:number,out:Float32Array,at:number):boolean {
  out[at]=0;out[at+1]=0;
  const bounds=boundsBySprite.get(sprite);if(!bounds)return true;
  const {limits,edges,house,houseOrigin}=record;
  limits[0]=-Infinity;limits[1]=Infinity;limits[2]=-Infinity;limits[3]=Infinity;
  if(house){
    // The house's implicit shell, where the house stands.
    for(let wy=0;wy<house[1];wy++)wallConstraint(0,houseOrigin[0],houseOrigin[1]+wy,bounds,x,y,limits);
    for(let wx=0;wx<house[0];wx++)wallConstraint(1,houseOrigin[0]+wx,houseOrigin[1],bounds,x,y,limits);
  }
  if(edges)for(let edge=0;edge+3<edges.length;edge+=4){
    // Door openings do not contain the full solid wall represented by an edge.
    if(edges[edge+3]===0)wallConstraint(edges[edge],edges[edge+1],edges[edge+2],bounds,x,y,limits);
  }
  if(limits[0]>limits[1]||limits[2]>limits[3])return false;
  out[at]=Math.max(limits[0],Math.min(limits[1],0));
  out[at+1]=Math.max(limits[2],Math.min(limits[3],0));
  return true;
}

/** Physical translations shared by a fixture, its contents, and contacting actors. */
export function fixtureRegistration(source:FixtureRegistrationSource):FixtureRegistration {
  let record=registrations.get(source);
  const revision=source.lotRevision?.();
  if(record&&revision!==undefined&&record.revision===revision&&record.count===source.count)return record;
  if(!record||record.offsets.length<source.count*2){
    record={offsets:new Float32Array(source.count*2),infeasible:new Uint8Array(source.count),revision:undefined,count:source.count,
      edges:undefined,house:undefined,houseOrigin:[0,0],limits:new Float64Array(4),preview:new Float32Array(2)};
    registrations.set(source,record);
  }
  record.offsets.fill(0);record.infeasible.fill(0);record.revision=revision;record.count=source.count;
  // Finish potentially allocating bridge calls before borrowing renderer views.
  record.edges=source.wallEdges?.()?.slice();record.house=source.houseSize?.();
  record.houseOrigin=source.houseOrigin?.()??[0,0];
  const positions=source.positions(),sprites=source.sprites();
  for(let row=0;row<source.count;row++)if(!measure(record,sprites[row],positions[row*2],positions[row*2+1],record.offsets,row*2)){
    // Native state remains loadable when an unchanged model cannot fit a narrow room.
    record.infeasible[row]=1;
  }
  return record;
}

/** Placement previews use the same measured origin as the resulting native object. */
export function fixturePlacementOffset(source:FixtureRegistrationSource,sprite:number,x:number,y:number):Float32Array {
  fixtureRegistration(source);
  const record=registrations.get(source)!;
  measure(record,sprite,x,y,record.preview,0);
  return record.preview;
}
