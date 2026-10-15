import type {Geometry,MeshPart} from '../../../src/render/character/bundle.js';
import {evaluateSurface} from '../../../src/render/character/surface.js';
import {shapePoint,type ShapeParameters} from '../../../src/render/character/shape.js';
import {add,identity,inverseAffine,multiply,sub,transform,type Vec3} from '../../../src/render/character/math.js';
import {SupportSurface} from '../../../src/render/character/support-surface.js';

export interface BikeDimensions {axle:Vec3;radius:number;halfSpacing:number;pedalTop:number;flywheelFace:number}
export function bikePedalPosition(dimensions:BikeDimensions,angle:number,side:'L'|'R'):Vec3 {
  const phase=angle+(side==='R'?Math.PI:0);
  return [(side==='L'?-1:1)*dimensions.halfSpacing,dimensions.axle[1]+dimensions.radius*Math.sin(phase),dimensions.axle[2]+dimensions.radius*Math.cos(phase)];
}
export interface BikeFit {hip:Vec3;hipCycle?:Vec3[];pelvisRotation:number[];pitch:number;feet:[{rotation:number[];offset:Vec3;contact:Vec3},{rotation:number[];offset:Vec3;contact:Vec3}];reachMargin:number;supportSamples:number}
const cache=new WeakMap<Geometry,Map<string,BikeFit>>();
const position=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
const rotationX=(angle:number)=>{const c=Math.cos(angle),s=Math.sin(angle);return [1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1];};

function partSurface(geometry:Geometry,part:MeshPart,point:(index:number)=>Vec3):SupportSurface {
  const ids=[...new Set(geometry.indices.slice(part.start,part.start+part.count))],map=new Map(ids.map((id,index)=>[id,index]));
  const triangles:[number,number,number][]=[];
  for(let i=part.start;i<part.start+part.count;i+=3)triangles.push([map.get(geometry.indices[i])!,map.get(geometry.indices[i+1])!,map.get(geometry.indices[i+2])!]);
  return new SupportSurface(ids.map(point),triangles);
}

function sampleFit(fit:BikeFit,angle:number):BikeFit {
  if(!fit.hipCycle)return fit;
  const phase=((angle/(Math.PI*2)%1)+1)%1*fit.hipCycle.length,index=Math.floor(phase),t=phase-index;
  const a=fit.hipCycle[index],b=fit.hipCycle[(index+1)%fit.hipCycle.length];
  return {...fit,hip:[a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t,a[2]*(1-t)+b[2]*t]};
}

/** Fit a periodic saddle-supported motion; use a stationary pelvis where feasible. */
export function fitBike(geometry:Geometry,a:ShapeParameters,top:number,rest:number[][],pose:number[][],source:number[][],dimensions:BikeDimensions,legLengths:[number,number],angle=0):BikeFit {
  const key=JSON.stringify([a.presentation,a.height,a.build,a.shoulders,a.hips,a.torso]);
  let entries=cache.get(geometry);if(!entries){entries=new Map();cache.set(geometry,entries);}const saved=entries.get(key);if(saved)return sampleFit(saved,angle);
  const bone=(name:string)=>{const id=geometry.manifest.bones.findIndex(b=>b.name===name);if(id<0)throw new Error(`Missing bike bone: ${name}`);return id;};
  const hips=bone('hips'),hipPosition=position(pose[hips]);
  const cage=new Float32Array(geometry.description.cageCount*3);
  for(let i=0;i<geometry.cage.length;i+=16)cage.set(shapePoint([geometry.cage[i],geometry.cage[i+1],geometry.cage[i+2]],geometry.cage[i+15],a,top),i/16*3);
  const surface=evaluateSurface(geometry,cage),surfacePoint=(i:number):Vec3=>[surface[i*3],surface[i*3+1],surface[i*3+2]];
  const fixture=geometry.fixtureGeometry??geometry;
  const hipPart=geometry.description.parts.find(p=>p.name==='Trouser hip bridge'),saddlePart=fixture.description.parts.find(p=>p.name.endsWith(' Bike saddle'));
  if(!hipPart||!saddlePart)throw new Error('Bike fitting requires the actual hip and saddle surfaces.');
  const hipTransform=multiply(pose[hips],inverseAffine(rest[hips]));
  const saddle=partSurface(fixture,saddlePart,i=>transform(source[fixture.vertices[i*16+6]],[fixture.vertices[i*16],fixture.vertices[i*16+1],fixture.vertices[i*16+2]]));
  const supports:{hip:Vec3;samples:number;pelvisRotation:number[]}[]=[];
  const supportAt=(bodySurface:SupportSurface,hx:number,hy:number)=>{
    const required:number[]=[],flat:number[]=[];
    for(let x=saddle.bounds[0]+.00625;x<saddle.bounds[1];x+=.0125)for(let sy=saddle.bounds[2]+.00625;sy<saddle.bounds[3];sy+=.0125){
      const seat=saddle.height(x,sy,'top'),body=bodySurface.height(x-hx,sy-hy,'bottom');
      if(seat!==undefined&&body!==undefined){required.push(seat-body);if(seat>=saddle.maximumZ-.001)flat.push(seat-body);}
    }
    if(required.length<8)return null;
    const z=Math.max(...required)+.0015,samples=flat.filter(value=>z-value<.0045).length;
    return samples>=8?{hip:[hx,hy,z] as Vec3,samples}:null;
  };
  for(let tilt=0;tilt<=35;tilt+=5){
  const pelvisRotation=rotationX(tilt*Math.PI/180);
  const hipSurface=partSurface(geometry,hipPart,i=>transform(pelvisRotation,sub(transform(hipTransform,surfacePoint(i)),hipPosition)));
  const forwardLimit=saddle.bounds[2]-hipSurface.bounds[3]+.015;
  for(let y=hipPosition[1];y>=forwardLimit;y-=.01){
    const support=supportAt(hipSurface,hipPosition[0],y);if(support)supports.push({...support,pelvisRotation});
  }
  }
  const localSoles=(['L','R'] as const).map(side=>{
    const id=bone('foot.'+side),inverse=inverseAffine(rest[id]),ids=new Set<number>();
    for(const part of geometry.description.parts)if(part.region===6&&/sole/i.test(part.name))for(let i=part.start;i<part.start+part.count;i++){
      const vertex=geometry.indices[i];if(geometry.vertices[vertex*16+6]===id)ids.add(vertex);
    }
    if(!ids.size)throw new Error('A configured shoe has no sole support geometry.');
    return {bone:id,points:[...ids].map(id=>transform(inverse,surfacePoint(id)))};
  });
  let best:BikeFit|undefined;
  const footwear:{pitch:number;feet:{rotation:number[];offset:Vec3;outward:number}[]}[]=[];
  for(let degrees=0;degrees<=70&&!best;degrees++){
    const pitch=degrees*Math.PI/180;
    const feet=localSoles.map((sole,i)=>{
      const sign=i===0?-1:1,rotation=multiply(rotationX(pitch),source[sole.bone]);rotation.splice(12,3,0,0,0);
      const points=sole.points.map(p=>transform(rotation,p)),low=Math.min(...points.map(p=>p[2]));
      const touching=points.filter(p=>p[2]<low+.0005),offset:Vec3=[touching.reduce((sum,p)=>sum+p[0],0)/touching.length,touching.reduce((sum,p)=>sum+p[1],0)/touching.length,low];
      const medial=Math.min(...points.map(p=>sign*p[0]));
      const outward=Math.max(0,dimensions.flywheelFace+.005-dimensions.halfSpacing+sign*offset[0]-medial);
      return {rotation,offset,outward};
    });
    if(feet.some(foot=>foot.outward>.045))continue;
    footwear.push({pitch,feet});
    for(const rear of [0,.02,.04,.06])for(const support of supports){
      let margin=Infinity;
      for(let i=0;i<2;i++){
        const sign=i===0?-1:1,foot=feet[i],thigh=bone('thigh.'+(i===0?'L':'R'));
        const hip=add(support.hip,transform(support.pelvisRotation,sub(position(pose[thigh]),hipPosition)));
        const center:Vec3=[sign*(dimensions.halfSpacing+foot.outward)-foot.offset[0],dimensions.axle[1]+rear-foot.offset[1],dimensions.axle[2]+dimensions.pedalTop-foot.offset[2]];
        const yz=Math.hypot(hip[1]-center[1],hip[2]-center[2])+dimensions.radius;
        margin=Math.min(margin,legLengths[i]-Math.hypot(hip[0]-center[0],yz));
      }
      if(margin<.002)continue;
      best={hip:support.hip,pelvisRotation:support.pelvisRotation,pitch,feet:feet.map((foot,i)=>({rotation:foot.rotation,offset:foot.offset,contact:[(i===0?-1:1)*foot.outward,rear,dimensions.pedalTop] as Vec3})) as BikeFit['feet'],reachMargin:margin,supportSamples:support.samples};break;
    }
  }
  if(!best){
    const bodySurface=partSurface(geometry,hipPart,i=>sub(transform(hipTransform,surfacePoint(i)),hipPosition));
    const forwardLimit=saddle.bounds[2]-bodySurface.bounds[3]+.015,count=64;
    for(let amplitude=.02;amplitude<=.140001&&!best;amplitude+=.02){
      for(let y=hipPosition[1];y>=forwardLimit&&!best;y-=.01){
        const cycle:Vec3[]=[],samples:number[]=[];
        for(let frame=0;frame<count;frame++){
          const support=supportAt(bodySurface,amplitude*Math.cos(frame/count*Math.PI*2),y);
          if(!support)break;cycle.push(support.hip);samples.push(support.samples);
        }
        if(cycle.length!==count)continue;
        for(const {pitch,feet} of footwear){
          if(best)break;
          for(const rear of [0,.02,.04,.06]){
            let margin=Infinity;
            for(let frame=0;frame<count&&margin>=.002;frame++)for(let i=0;i<2;i++){
              const phase=frame/count*Math.PI*2+i*Math.PI,sign=i===0?-1:1,foot=feet[i];
              const hip=add(cycle[frame],sub(position(pose[bone('thigh.'+(i===0?'L':'R'))]),hipPosition));
              const ankle:Vec3=[sign*(dimensions.halfSpacing+foot.outward)-foot.offset[0],dimensions.axle[1]+dimensions.radius*Math.sin(phase)+rear-foot.offset[1],dimensions.axle[2]+dimensions.radius*Math.cos(phase)+dimensions.pedalTop-foot.offset[2]];
              margin=Math.min(margin,legLengths[i]-Math.hypot(...sub(hip,ankle)));
            }
            if(margin<.002)continue;
            best={hip:cycle[0],hipCycle:cycle,pelvisRotation:identity(),pitch,feet:feet.map((foot,i)=>({rotation:foot.rotation,offset:foot.offset,contact:[(i===0?-1:1)*foot.outward,rear,dimensions.pedalTop] as Vec3})) as BikeFit['feet'],reachMargin:margin,supportSamples:Math.min(...samples)};break;
          }
        }
      }
    }
  }
  if(!best)throw new Error('No supported bike pose fits the configured body and shoes.');
  if(entries.size>=32)entries.delete(entries.keys().next().value!);entries.set(key,best);return sampleFit(best,angle);
}
