import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {canonicalPoolPreference,canonicalPoolSample,composePoolCandidate,properPoolRotation,requireInactivePoolBone,solvePoolHierarchyLimb} from '../src/render/character/pool-canonical-pose.js';
import type {Geometry} from '../src/render/character/bundle.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {add,cross,dot,inverseAffine,length,sub,type Vec3} from '../src/render/character/math.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

it('canonicalizes every pinned pool sample before fitting, including exact endpoints and inactive book',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,
    includeFixture:false,clip:'pool_enter',swimwear:'two_piece'}),geometry=[selected.body,selected.extra!];
  const top=anatomicalHeight(poolBase.vertices),hip=poolRig.manifest.bones.findIndex(b=>b.name==='hips');
  expect(poolRig.manifest.basisActions.pool_paddle[0].some((m,i)=>i!==hip&&m.slice(12,15).some(v=>v!==0))).toBe(true);
  for(const [action,frames] of Object.entries(poolRig.manifest.actions).filter(([name])=>name.startsWith('pool_'))){
    for(let frame=0;frame<frames.length;frame++){
      const candidate=canonicalPoolPreference(poolRig.manifest,shape,top,action,frame,geometry);
      candidate.basis.forEach((matrix,index)=>{
        if(poolRig.manifest.bones[index].parent>=0)expect(matrix.slice(12,15)).toEqual([0,0,0]);
        for(let column=0;column<3;column++)expect(Math.hypot(...matrix.slice(column*4,column*4+3))).toBeCloseTo(1,12);
        const columns=[0,1,2].map(i=>matrix.slice(i*4,i*4+3) as unknown as Vec3);
        expect(dot(columns[0],columns[1])).toBeCloseTo(0,12);expect(dot(columns[1],columns[2])).toBeCloseTo(0,12);
        expect(dot(columns[2],columns[0])).toBeCloseTo(0,12);expect(dot(cross(columns[0],columns[1]),columns[2])).toBeCloseTo(1,12);
      });
      for(let axis=0;axis<3;axis++)expect(candidate.world[hip][12+axis]).toBeCloseTo(frames[frame][hip][12+axis],12);
      expect(candidate.basis.at(-1)).toEqual([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    }
  }
});

it('carries source root and hips travel exactly once through neutral and extreme configured pelvis offsets',()=>{
  const bundle=poolRig.manifest,root=bundle.bones.findIndex(b=>b.name==='root'),hips=bundle.bones.findIndex(b=>b.name==='hips');
  for(const [height,torso,build] of [[50,50,50],[0,0,100],[100,0,0],[100,100,100]]){
    const appearance=defaultAppearance('feminine');Object.assign(appearance.body,{height,torso,build});
    const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,
      {wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_paddle',swimwear:'two_piece'});
    for(const [rootTravel,hipTravel] of [[[.2,-.1,.3],[0,0,0]],[[0,0,0],[.1,.2,-.3]],[[.2,-.1,.3],[.1,.2,-.3]]]){
      const basis=bundle.basisActions.pool_paddle[0].map(matrix=>[...matrix]);basis[root].splice(12,3,...rootTravel);basis[hips].splice(12,3,...hipTravel);
      const source=composeSkeletonPose(bundle.bones,bundle.bones.map(b=>b.rest),basis);
      const candidate=canonicalPoolSample(bundle,shape,anatomicalHeight(poolBase.vertices),{basis,source},[selected.body,selected.extra!]);
      const expected=source[hips].slice(12,15) as unknown as Vec3,actual=candidate.world[hips].slice(12,15) as unknown as Vec3;
      expect(length(sub(actual,expected))).toBeLessThan(1e-12);
      const expectedRotation=properPoolRotation(source[hips]),actualRotation=properPoolRotation(candidate.world[hips]);
      expectedRotation.forEach((v,i)=>expect(actualRotation[i]).toBeCloseTo(v,12));
      if(hipTravel.some(v=>v!==0)){
        const wrong=candidate.basis.map(matrix=>[...matrix]);for(let axis=0;axis<3;axis++)wrong[root][12+axis]+=hipTravel[axis];
        const twice=composeSkeletonPose(bundle.bones,candidate.rest,wrong)[hips].slice(12,15) as unknown as Vec3;
        expect(length(sub(twice,expected))).toBeGreaterThan(.1);
      }
    }
  }
});
it('constructs a proper rotation rather than preserving raw endpoint scale or reflection',()=>{
  const rotation=properPoolRotation([1.0001,0,0,0,.0002,.9999,0,0,0,0,1,0,4,5,6,1]);
  expect(rotation.slice(12,15)).toEqual([0,0,0]);expect(Math.hypot(...rotation.slice(0,3))).toBeCloseTo(1,14);
  expect(()=>properPoolRotation([-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])).toThrow();
});

it('checks effective book influence only on selected draw ranges and refuses an active book surface',()=>{
  const cage=new Float32Array(64),stencilWeights=new ArrayBuffer(32),ids=new Uint32Array(stencilWeights),weights=new Float32Array(stencilWeights);
  for(let i=0;i<4;i++){cage[i*16+6]=i===3?16:0;cage[i*16+10]=1;ids[i*2]=i;weights[i*2+1]=1;}
  const geometry={cage,stencilWeights,stencilRanges:new Uint32Array([0,1,0,0,1,1,1,0,2,1,2,0,3,1,3,0]),indices:new Uint32Array([0,1,2,0,2,3]),
    description:{parts:[{name:'Selected skin',start:0,count:3}]}} as unknown as Geometry;
  expect(()=>requireInactivePoolBone([geometry],16)).not.toThrow();
  const active={...geometry,description:{...geometry.description,parts:[{name:'Selected book',start:3,count:3}]}} as Geometry;
  expect(()=>requireInactivePoolBone([active],16)).toThrow('effective influence');
});

it('solves actual non-Y child offsets through the hierarchy and reaches the prepared target',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_paddle',swimwear:'two_piece'});
  const pose=canonicalPoolPreference(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),'pool_paddle',0,[selected.body,selected.extra!]);
  const index=(name:string)=>poolRig.manifest.bones.findIndex(b=>b.name===name),upper=index('thigh.L'),lower=index('shin.L'),end=index('foot.L');
  pose.rest[lower][12]+=.01;pose.rest[end][14]+=.02;pose.inverse=pose.rest.map(inverseAffine);composePoolCandidate(pose);
  const start=pose.world[upper].slice(12,15) as unknown as Vec3,target=add(start,[0,-.25,.1]),pole=add(start,[.2,0,0]);
  solvePoolHierarchyLimb(pose,upper,lower,end,target,pole,pose.world[end]);
  expect(length(sub(pose.world[end].slice(12,15) as unknown as Vec3,target))).toBeLessThan(1e-12);
  for(const bone of [upper,lower,end])expect(pose.basis[bone].slice(12,15)).toEqual([0,0,0]);
});
