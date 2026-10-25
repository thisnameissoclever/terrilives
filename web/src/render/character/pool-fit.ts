import type {Bundle} from './bundle.js';
import type {PoseDiagnostics} from './contact-types.js';
import {fitAssembly} from './contact-math.js';
import {add,boneFrame,inverseAffine,length,multiply,scale,solveLimb,sub,transform,type Vec3} from './math.js';
import {shapePoint,type ShapeParameters} from './shape.js';
import {clipSample,interpolateTransform} from './motion.js';

const point=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];

/** Fit configured limbs to the authored rail, tread and free paddle trajectories together. */
export function fitPool(bundle:Bundle,appearance:ShapeParameters,top:number,source:number[][],
  rest:number[][],configured:number[][],action:string,frame:number,audit?:PoseDiagnostics):Float32Array<ArrayBuffer> {
  const index=(name:string)=>{const at=bundle.bones.findIndex(b=>b.name===name);if(at<0)throw new Error(`Missing pool joint: ${name}`);return at;};
  const inverse=rest.map(inverseAffine),matrices=configured.map(m=>[...m]),hip=index('hips');
  const shift=sub(point(source[hip]),point(matrices[hip]));
  for(let i=0;i<17;i++)matrices[i].splice(12,3,...add(point(matrices[i]),shift));
  const clip=bundle.clipMetadata![action],sample=clipSample(clip.rigs.length,frame,clip.playback);
  const left=clip.contactFrames[sample.index],right=clip.contactFrames[sample.next];
  const travel=(left.poolTravel??1)*(1-sample.t)+(right.poolTravel??1)*sample.t;
  const constraints:{center:Vec3;radius:number}[]=[];
  const limbs:{upper:number;lower:number;end:number;target:Vec3;reference:Vec3;contact:Vec3;rotation:number[];size:[number,number];name:string}[]=[];
  for(const side of ['L','R'])for(const arm of [false,true]){
    const sign=side==='L'?-1:1,upper=index((arm?'upper_arm.':'thigh.')+side),lower=index((arm?'forearm.':'shin.')+side),end=index((arm?'hand.':'foot.')+side);
    const sideIndex=side==='L'?0:1;
    const strength=arm?(left.handContact?.[sideIndex]??0)*(1-sample.t)+(right.handContact?.[sideIndex]??0)*sample.t:Math.max(0,Math.min(1,(1-travel)/.2));
    if(strength===0)continue;
    const region=arm?4:6,reference:Vec3=arm?[sign*.303,-.075,.737]:[sign*.124,-.10,.0191481];
    const authored=transform(multiply(source[end],bundle.bones[end].inverseRest),reference);
    const preferred=transform(multiply(matrices[end],inverse[end]),shapePoint(reference,region,appearance,top));
    const contact=add(scale(authored,strength),scale(preferred,1-strength));
    const rotation=interpolateTransform(matrices[end],source[end],strength);
    const local=transform(inverse[end],shapePoint(reference,region,appearance,top));
    const offset=sub(transform(rotation,local),point(rotation));
    const target=sub(contact,offset);
    const size=(id:number):number=>length(sub(shapePoint(bundle.bones[id].tail,arm?4:id===lower?6:3,appearance,top),shapePoint(bundle.bones[id].head,arm?4:3,appearance,top)));
    const sizes:[number,number]=[size(upper),size(lower)];
    constraints.push({center:sub(target,point(matrices[upper])),radius:sizes[0]+sizes[1]-.0001});
    limbs.push({upper,lower,end,target,reference,contact,rotation,size:sizes,name:(arm?'palm':'sole')+side});
  }
  const adjustment=fitAssembly([0,0,0],[-.10,-.18,-.20],[.10,.18,.16],constraints);
  if(!adjustment)throw new Error('Configured pool body cannot reach its authored supports.');
  for(let i=0;i<17;i++)matrices[i].splice(12,3,...add(point(matrices[i]),adjustment));
  for(const limb of limbs){
    const start=point(matrices[limb.upper]);
    const joint=solveLimb(start,limb.target,...limb.size,add(point(source[limb.lower]),adjustment));
    matrices[limb.upper]=boneFrame(start,joint,source[limb.upper]);
    matrices[limb.lower]=boneFrame(joint,limb.target,source[limb.lower]);
    matrices[limb.end]=[...limb.rotation];matrices[limb.end].splice(12,3,...limb.target);
    if(audit){
      const actual=transform(multiply(matrices[limb.end],inverse[limb.end]),shapePoint(limb.reference,limb.name.startsWith('palm')?4:6,appearance,top));
      audit.contacts.push({name:limb.name,target:limb.contact,actual,error:length(sub(actual,limb.contact))});
    }
  }
  const output=new Float32Array(bundle.bones.length*16);
  matrices.forEach((matrix,i)=>output.set(multiply(matrix,inverse[i]),i*16));
  return output;
}
