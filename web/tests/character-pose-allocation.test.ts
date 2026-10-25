import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {boneFrame,multiply,multiplyInto} from '../src/render/character/math.js';
import {interpolateTransform,sampleMotion} from '../src/render/character/motion.js';
import {configuredJointSetup,composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {configuredPose,configuredPoseForProof} from '../src/render/character/pose.js';
import {facesAway,nearestReachableContact,thighContactPatches,withinReach} from '../src/render/character/resting-contact.js';
import {configuredSurfaceScratch} from '../src/render/character/surface-query.js';
import {sameShape,snapshotShape} from '../src/render/character/shape.js';
import {boneFrame as originalBoneFrame,multiply as originalMultiply,type Vec3} from './fixtures/pose-allocation/math-original.js';
import {interpolateTransform as originalInterpolate} from './fixtures/pose-allocation/motion-original.js';
import {configuredJointSetup as originalJointSetup,composeSkeletonPose as originalCompose} from './fixtures/pose-allocation/joints-original.js';
import {configuredPose as originalPose,configuredPoseForProof as originalPoseForProof} from './fixtures/pose-allocation/pose-original.js';
import {nearestReachableContact as originalNearest,thighContactPatches as originalPatches} from './fixtures/pose-allocation/resting-contact-original.js';
import {queryConfiguredSurface} from './fixtures/pose-allocation/surface-query-original.js';
import {appearances,clipSubject,framesOf,library,manifest,sampledAllocationBytes} from './character-pose-allocation-fixture.js';

/*
 * The pose and contact code runs for every animated character on every
 * frame. Issue 305 measured it allocating hundreds of megabytes a second;
 * these tests pin the rewritten functions to the originals' exact output and
 * keep the per-call allocation bounded. `fixtures/pose-allocation/` holds the
 * originals as they were before the rewrite.
 */

const fixtureNames=['math','motion','joints','pose','interaction','resting-contact','surface-query'];
const fixtureDigest='d3a0d5be43a74c9dc0b12808eb388196faf48bf5e5e93c6ea1ff5e3be79f9d9f';
const bytes=(values:Float32Array|Float64Array)=>Buffer.from(values.buffer,values.byteOffset,values.byteLength);
const same=(actual:ArrayLike<number>,expected:ArrayLike<number>)=>{
  expect(actual.length).toBe(expected.length);
  for(let i=0;i<expected.length;i++)if(!Object.is(actual[i],expected[i]))throw new Error(`element ${i}: ${actual[i]} is not ${expected[i]}`);
};
function random(seed:number):()=>number {
  return ()=>{seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
}
const next=random(305);
const value=()=>(next()-.5)*4;
function rotation(scale=1):number[] {
  const q=[value(),value(),value(),value()],size=Math.hypot(...q),[x,y,z,w]=q.map(v=>v/size);
  return [1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,value()*scale,value()*scale,value()*scale,1];
}

it('keeps the frozen originals unchanged',()=>{
  const text=fixtureNames.map(name=>readFileSync(new URL(`./fixtures/pose-allocation/${name}-original.ts`,import.meta.url),'utf8').replaceAll('\r\n','\n')).join('\n');
  expect(createHash('sha256').update(text).digest('hex')).toBe(fixtureDigest);
});

describe('the rewritten math matches the originals bit for bit',()=>{
  it('multiplyInto stores what multiply returns, signed zeros, NaN and infinities included',()=>{
    const specials=[0,-0,1,-1,NaN,Infinity,-Infinity,1e-300,-1e300];
    for(let trial=0;trial<2000;trial++){
      const a=Array.from({length:16},()=>trial%5===0?specials[Math.floor(next()*specials.length)]:value());
      const b=Array.from({length:16},()=>trial%7===0?specials[Math.floor(next()*specials.length)]:value());
      const into=new Float64Array(20);multiplyInto(into,a,b,2);
      same(into.subarray(2,18),originalMultiply(a,b));same(multiply(a,b),originalMultiply(a,b));
    }
  });

  it('interpolateTransform matches across every quaternion branch, both hemispheres and nearly equal rotations',()=>{
    const pairs:[number[],number[]][]=[];
    for(let trial=0;trial<3000;trial++){const a=rotation();pairs.push([a,rotation()],[a,a.map(v=>v+1e-9*value())]);}
    // Rotations by a half turn about each axis select the four quaternion branches.
    const turns=[[1,0,0,0,0,1,0,0,0,0,1,0],[1,0,0,0,0,-1,0,0,0,0,-1,0],[-1,0,0,0,0,1,0,0,0,0,-1,0],[-1,0,0,0,0,-1,0,0,0,0,1,0]].map(m=>[...m,.25,-.5,1,1]);
    for(const a of turns)for(const b of turns)pairs.push([a,b]);
    const branches=new Set<string>();
    for(const [a,b] of pairs){
      const trace=a[0]+a[5]+a[10];branches.add(trace>0?'trace':a[0]>a[5]&&a[0]>a[10]?'x':a[5]>a[10]?'y':'z');
      for(const t of [0,1,next(),1e-7,.5])same(interpolateTransform(a,b,t),originalInterpolate(a,b,t));
    }
    expect([...branches].sort()).toEqual(['trace','x','y','z']);
  });

  it('boneFrame matches, including the fallback when the reference is parallel to the bone',()=>{
    let fallbacks=0;
    for(let trial=0;trial<5000;trial++){
      const head:Vec3=[value(),value(),value()],axis=[value(),value(),value()],tail:Vec3=[head[0]+axis[0],head[1]+axis[1],head[2]+axis[2]];
      const parallel=trial%4===0;if(parallel)fallbacks++;
      const reference=parallel?[axis[0]*2,axis[1]*2,axis[2]*2,0,...rotation().slice(4)]:rotation();
      same(boneFrame(head,tail,reference),originalBoneFrame(head,tail,reference));
    }
    expect(fallbacks).toBeGreaterThan(0);
    expect(()=>boneFrame([0,0,0],[0,0,0],rotation())).toThrow('Degenerate bone axis');
  });

  it('composeSkeletonPose matches for every authored action and frame',()=>{
    let rows=0;
    for(const [action,frames] of Object.entries(manifest.basisActions))for(const basis of frames){
      const actual=composeSkeletonPose(manifest.bones,manifest.bones.map(bone=>bone.rest),basis),expected=originalCompose(manifest.bones,manifest.bones.map(bone=>bone.rest),basis);
      expect(actual.length,action).toBe(expected.length);actual.forEach((row,i)=>same(row,expected[i]));rows+=actual.length;
    }
    expect(rows).toBeGreaterThan(100);
  });
});

describe('the configured pose is unchanged',()=>{
  const clips=[...Object.keys(manifest.actions),...Object.keys(library.clips)];
  const bodies=appearances();
  it.each(clips)('poses %s exactly as before for every body corner and phase',clip=>{
    let poses=0;
    for(const [index,appearance] of bodies.entries()){
      // The bookcase family has many clips; every second body keeps the suite fast without losing a presentation.
      if(clip.startsWith('fetch_')||clip.startsWith('shelve_'))if(index%2)continue;
      const {geometry,shape,top}=clipSubject(clip,appearance);
      for(const frame of framesOf(clip)){
        const expected=originalPoseForProof(geometry.manifest,shape,clip,frame,top,undefined,geometry);
        const actual=configuredPoseForProof(geometry.manifest,shape,clip,frame,top,undefined,geometry);
        if(!bytes(actual).equals(bytes(expected)))throw new Error(`${clip} ${appearance.presentation} ${JSON.stringify(appearance.body)} frame ${frame} differs`);
        poses++;
      }
    }
    expect(poses).toBeGreaterThan(0);
  },60000);

  it('poses the production path without contact artifacts exactly as before',()=>{
    for(const clip of ['walk','talk','bath','shower','cook_v2','mop','sofa_recline','fetch_3','book_walk'])for(const appearance of bodies.slice(0,3)){
      const {geometry,shape,top}=clipSubject(clip,appearance);
      for(const frame of framesOf(clip))expect(bytes(configuredPose(geometry.manifest,shape,clip,frame,top,undefined,geometry)))
        .toEqual(bytes(originalPose(geometry.manifest,shape,clip,frame,top,undefined,geometry)));
    }
  },60000);
});

describe('the reused rest setup',()=>{
  it('returns the same frozen rows on every frame of one body shape, and fresh pose rows',()=>{
    const {geometry,shape,top}=clipSubject('walk',people()[0]),first=configuredJointSetup(geometry.manifest,shape,'walk',0,top),second=configuredJointSetup(geometry.manifest,shape,'walk',3.5,top);
    for(const key of ['heads','tails','rest','inverse'] as const){expect(second[key]).toBe(first[key]);expect(Object.isFrozen(first[key])&&first[key].every(row=>Object.isFrozen(row))).toBe(true);}
    expect(second.matrices).not.toBe(first.matrices);expect(second.matrices[0]).not.toBe(first.matrices[0]);
    expect(()=>{(first.rest[0] as number[])[0]=2;}).toThrow(TypeError);
  });

  it('recomputes when the same shape object is edited in place',()=>{
    const {geometry,top}=clipSubject('walk',people()[0]),appearance=people()[0];
    const shape={presentation:appearance.presentation,...appearance.body,face:{...appearance.face}};
    const before=configuredJointSetup(geometry.manifest,shape,'walk',1,top);
    shape.height=shape.height===100?0:100;
    const edited=configuredJointSetup(geometry.manifest,shape,'walk',1,top),expected=originalJointSetup(geometry.manifest,{...shape,face:{...shape.face}},'walk',1,top);
    expect(edited.rest).not.toBe(before.rest);edited.rest.forEach((row,i)=>same(row,expected.rest[i]));edited.matrices.forEach((row,i)=>same(row,expected.matrices[i]));
    shape.face.jaw=shape.face.jaw===0?100:0;
    const face=configuredJointSetup(geometry.manifest,shape,'walk',1,top),faceExpected=originalJointSetup(geometry.manifest,{...shape,face:{...shape.face}},'walk',1,top);
    expect(face.heads).not.toBe(edited.heads);face.heads.forEach((row,i)=>same(row,faceExpected.heads[i]));
  });

  it('compares every value shapePoint reads',()=>{
    const appearance=people()[0],shape={presentation:appearance.presentation,...appearance.body,face:{...appearance.face}},saved=snapshotShape(shape);
    expect(sameShape(saved,{...shape,face:{...shape.face}})).toBe(true);
    for(const key of ['height','build','shoulders','hips','torso'] as const)expect(sameShape(saved,{...shape,[key]:(shape[key]??50)+1}),key).toBe(false);
    expect(sameShape(saved,{...shape,presentation:shape.presentation==='feminine'?'masculine':'feminine'})).toBe(false);
    for(const key of Object.keys(shape.face))expect(sameShape(saved,{...shape,face:{...shape.face,[key]:'changed'}}),key).toBe(false);
    expect(sameShape(saved,{...shape,face:undefined})).toBe(false);
  });
});

describe('the bath contact',()=>{
  function bathCases(){
    return people().flatMap(appearance=>{
      const {geometry,shape,top}=clipSubject('bath',appearance);
      return framesOf('bath').map(frame=>({geometry,shape,top,...configuredJointSetup(geometry.manifest,shape,'bath',frame,top)}));
    });
  }

  it('finds the same thigh candidates in the same order as the original surface query',()=>{
    let points=0;
    for(const {geometry,shape,top,matrices,inverse} of bathCases()){
      const expected=originalPatches(geometry,shape,top,matrices,inverse),actual=thighContactPatches(geometry,shape,top,matrices,inverse);
      for(const side of [0,1]){
        expect(actual.counts[side]).toBe(expected[side].length);same(actual.points[side].subarray(0,actual.counts[side]*3),expected[side].flat());points+=actual.counts[side];
      }
    }
    expect(points).toBeGreaterThan(1000);
  });

  it('writes the selected vertices the original query computes, and reuses its buffers',()=>{
    const [{geometry,shape,top,matrices,inverse}]=bathCases(),parts=geometry.description.parts.filter(part=>part.name.startsWith('Creator bare leg '));
    const expected=queryConfiguredSurface(geometry,parts,shape,top,matrices,inverse),actual=configuredSurfaceScratch(geometry,parts,shape,top,matrices,inverse);
    for(const part of parts)for(let at=part.start;at<part.start+part.count;at++){const vertex=geometry.indices[at];same(actual.subarray(vertex*3,vertex*3+3),expected.subarray(vertex*3,vertex*3+3));}
    expect(configuredSurfaceScratch(geometry,parts,shape,top,matrices,inverse)).toBe(actual);
    expect(thighContactPatches(geometry,shape,top,matrices,inverse).points[0]).toBe(thighContactPatches(geometry,shape,top,matrices,inverse).points[0]);
  });

  it('chooses the original contact, including ties, unreachable and non-finite candidates',()=>{
    let chosen=0,empty=0;
    for(let trial=0;trial<3000;trial++){
      const count=1+Math.floor(next()*40),list:Vec3[]=[];
      for(let i=0;i<count;i++){
        const pick=next();
        list.push(pick<.1&&list.length?list[Math.floor(next()*list.length)]:pick<.13?[NaN,0,0]:pick<.15?[1e-160,2e-160,0]:[value(),value(),value()]);
      }
      const points=new Float64Array(list.flat()),preferred:Vec3=[value(),value(),value()],offset:Vec3=[value()/4,value()/4,value()/4],shoulder:Vec3=[value(),value(),value()];
      const upper=.5+next(),lower=.5+next();
      const expected=originalNearest(list,preferred,offset,shoulder,upper,lower),actual=nearestReachableContact(points,count,preferred,offset,shoulder,upper,lower);
      if(expected===null){expect(actual).toBeNull();empty++;}else{same(actual!,expected);chosen++;}
    }
    expect(chosen).toBeGreaterThan(100);expect(empty).toBeGreaterThan(10);
  });

  it('decides facing and reach exactly as Math.hypot does at the thresholds',()=>{
    const reference=(n0:number,n1:number,n2:number)=>{const size=Math.hypot(n0,n1,n2);return size<1e-10||n2*(1/size)<.35;};
    const near=(x:number,steps:number)=>{let y=x;for(let i=0;i<Math.abs(steps);i++)y=steps>0?y+Math.abs(y)*Number.EPSILON:y-Math.abs(y)*Number.EPSILON;return y;};
    const normals:[number,number,number][]=[[0,0,0],[0,0,-0],[NaN,0,1],[0,NaN,1],[0,0,NaN],[Infinity,0,1],[0,0,Infinity],[1e-300,0,1e-300],[1e200,1e200,1e200],[0,0,1e-10],[0,0,9.9999e-11]];
    // Normals whose upward fraction is within a few units in the last place of 0.35.
    for(let trial=0;trial<4000;trial++){
      const horizontal=Math.sqrt(1-.35*.35),angle=next()*Math.PI*2,size=10**(next()*24-14);
      normals.push([near(Math.cos(angle)*horizontal*size,trial%9-4),Math.sin(angle)*horizontal*size,near(.35*size,(trial>>4)%9-4)]);
      normals.push([value(),value(),value()]);
    }
    for(const n of normals)expect(facesAway(...n),String(n)).toBe(reference(...n));
    const low=.2,high=1.4;
    for(let trial=0;trial<4000;trial++){
      const direction=[value(),value(),value()],size=Math.hypot(...direction),target=[low,high][trial%2]*(1+(trial%7-3)*Number.EPSILON);
      const d=direction.map(v=>v/size*target) as [number,number,number],exact=Math.hypot(...d);
      expect(withinReach(...d,low,high)).toBe(!(exact>=high||exact<=low));
    }
    expect(withinReach(NaN,0,0,low,high)).toBe(true);
  });
});

/*
 * V8's sampling heap profiler, with garbage-collected objects included,
 * counts what each pose call allocates once the code is warm. The originals
 * allocated 140 to 280 KB for a standing pose and 10 MB for a bath pose; the budgets
 * leave room for sampling noise and slower compilation while failing if the
 * rest setup, contact surface or composition allocates per call again.
 */
describe('per-call allocation',()=>{
  const budgets:Record<string,number>={talk:40_000,walk:64_000,bath:300_000,cook_v2:220_000,mop:340_000,sofa_recline:120_000};
  it.each(Object.entries(budgets))('poses %s within %i bytes a call',(clip,budget)=>{
    const {geometry,shape,top}=clipSubject(clip,people()[1]);
    const perCall=medianBytesPerCall(frame=>configuredPose(geometry.manifest,shape,clip,frame,top,undefined,geometry),framesOf(clip));
    expect(perCall).toBeLessThan(budget);
  },120000);

  it('measures the original allocation it guards against',()=>{
    const {geometry,shape,top}=clipSubject('bath',people()[1]);
    const perCall=medianBytesPerCall(frame=>originalPose(geometry.manifest,shape,'bath',frame,top,undefined,geometry),framesOf('bath'),3);
    expect(perCall).toBeGreaterThan(budgets.bath*4);
  },120000);
});

/**
 * The median of three sampled windows of at least 120 calls each, after 30
 * warm-up passes over the clip's frames, so a single collection or
 * compilation in one window cannot decide the verdict.
 */
function medianBytesPerCall(pose:(frame:number)=>unknown,frames:readonly number[],warmup=30):number {
  for(let round=0;round<warmup;round++)for(const frame of frames)pose(frame);
  const rounds=Math.ceil(120/frames.length),windows:number[]=[];
  for(let window=0;window<3;window++){
    let calls=0;
    const allocated=sampledAllocationBytes(()=>{for(let round=0;round<rounds;round++)for(const frame of frames){pose(frame);calls++;}});
    windows.push(allocated/calls);
  }
  return windows.sort((a,b)=>a-b)[1];
}

function people(){return appearances();}
