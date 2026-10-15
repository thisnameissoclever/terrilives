import {add,identity,multiply,sub,transform,type Vec3} from './math.js';
import {SupportSurface} from './support-surface.js';
import type {BikeContactArtifactV1,BikeContactInputDataV1,BikeContactInputV1,BikeFit} from './bike-contact-types.js';
import {validateBikeContactInput,validateBikeContactInputData} from './bike-contact-protocol.js';

const rotationX=(angle:number)=>{const c=Math.cos(angle),s=Math.sin(angle);return [1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1];};

/** Expensive whole-cycle construction. Production calls this only inside its contact worker. */
export function compileBikeFit(input:BikeContactInputDataV1):BikeFit {
  validateBikeContactInputData(input);
  const {hip:hipPosition,dimensions,legLengths}=input;
  const saddle=new SupportSurface(input.saddle.points,input.saddle.triangles);
  const saddleSamples:Readonly<{x:number;sy:number;seat:number|undefined}>[]=[];
  for(let x=saddle.bounds[0]+.00625;x<saddle.bounds[1];x+=.0125)for(let sy=saddle.bounds[2]+.00625;sy<saddle.bounds[3];sy+=.0125)
    saddleSamples.push({x,sy,seat:saddle.height(x,sy,'top')});
  const supports:{hip:Vec3;samples:number;pelvisRotation:number[]}[]=[];
  const supportAt=(bodySurface:SupportSurface,hx:number,hy:number)=>{
    const required:number[]=[],flat:number[]=[];
    for(const {x,sy,seat} of saddleSamples){
      const body=bodySurface.height(x-hx,sy-hy,'bottom');
      if(seat!==undefined&&body!==undefined){required.push(seat-body);if(seat>=saddle.maximumZ-.001)flat.push(seat-body);}
    }
    if(required.length<8)return null;
    const z=Math.max(...required)+.0015,samples=flat.filter(value=>z-value<.0045).length;
    return samples>=8?{hip:[hx,hy,z] as Vec3,samples}:null;
  };
  for(let tilt=0;tilt<=35;tilt+=5){
    const pelvisRotation=rotationX(tilt*Math.PI/180);
    const hipSurface=new SupportSurface(input.hipSurface.points.map(point=>transform(pelvisRotation,point)),input.hipSurface.triangles);
    const forwardLimit=saddle.bounds[2]-hipSurface.bounds[3]+.015;
    for(let y=hipPosition[1];y>=forwardLimit;y-=.01){
      const support=supportAt(hipSurface,hipPosition[0],y);if(support)supports.push({...support,pelvisRotation});
    }
  }
  let best:BikeFit|undefined;
  const footwear:{pitch:number;feet:{rotation:number[];offset:Vec3;outward:number}[]}[]=[];
  for(let degrees=0;degrees<=70&&!best;degrees++){
    const pitch=degrees*Math.PI/180;
    const feet=input.soles.map((sole,i)=>{
      const sign=i===0?-1:1,rotation=multiply(rotationX(pitch),sole.source);rotation.splice(12,3,0,0,0);
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
        const sign=i===0?-1:1,foot=feet[i];
        const hip=add(support.hip,transform(support.pelvisRotation,input.thighOffsets[i]));
        const center:Vec3=[sign*(dimensions.halfSpacing+foot.outward)-foot.offset[0],dimensions.axle[1]+rear-foot.offset[1],dimensions.axle[2]+dimensions.pedalTop-foot.offset[2]];
        const yz=Math.hypot(hip[1]-center[1],hip[2]-center[2])+dimensions.radius;
        margin=Math.min(margin,legLengths[i]-Math.hypot(hip[0]-center[0],yz));
      }
      if(margin<.002)continue;
      best={hip:support.hip,pelvisRotation:support.pelvisRotation,pitch,feet:feet.map((foot,i)=>({rotation:foot.rotation,offset:foot.offset,contact:[(i===0?-1:1)*foot.outward,rear,dimensions.pedalTop] as Vec3})) as BikeFit['feet'],reachMargin:margin,supportSamples:support.samples};break;
    }
  }
  if(!best){
    const bodySurface=new SupportSurface(input.hipSurface.points,input.hipSurface.triangles);
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
              const hip=add(cycle[frame],input.thighOffsets[i]);
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
  return best;
}

export function compileBikeContact(input:BikeContactInputV1):BikeContactArtifactV1 {
  validateBikeContactInput(input);
  return {version:1,solverRevision:input.solverRevision,sourcePhase:0,key:input.key,revisions:{...input.revisions},shapeKey:input.shapeKey,shoeKey:input.shoeKey,fit:compileBikeFit(input)};
}
