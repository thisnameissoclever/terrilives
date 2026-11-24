import {expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {compilePoolPaddlePreference} from '../src/render/character/pool-pose-compiler.js';
import {observePool} from '../src/render/character/pool-observer.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';
import {poolPartKey} from '../src/render/character/pool-contact-identity.js';
import {interpolatePoolPose} from '../src/render/character/pool-contact-sample.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {inverseAffine,length,multiply,sub,type Vec3} from '../src/render/character/math.js';

it('compiles supported-size paddling legs above the actual basin floor without moving the airway under water',()=>{
  const failures=[],records=[];
  for(const [height,build,torso] of [[50,50,50],[0,100,0],[100,0,0],[100,100,0]]){
    const appearance=defaultAppearance('feminine');Object.assign(appearance.body,{height,build,torso});
    const body=new PreparedBody(poolBase,appearance),selected=body.select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,
      includeFixture:false,clip:'pool_paddle',swimwear:'two_piece'}),geometry=[selected.body,selected.extra!];
    const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
    const floor=poolFixture.solids.find(s=>s.kind==='floor')!.bounds[1][2];
    const compiled=compilePoolPaddlePreference(poolRig.manifest,shape,top,0,geometry,poolFixture.waterHeight,floor);
    const matrices=interpolatePoolPose(poolRig.manifest,compiled.rest,compiled.rest.map(inverseAffine),compiled.basis,compiled.basis,0);
    expect(matrices).toEqual(compiled.skin);
    const world=composeSkeletonPose(poolRig.manifest.bones,compiled.rest,compiled.basis);
    const jointErrors:{bone:string;offsetError:number;renderedError:number;arithmeticBound:number}[]=[];
    const position=(m:readonly number[]):Vec3=>[m[12],m[13],m[14]];
    world.forEach((matrix,bone)=>{
      const parent=poolRig.manifest.bones[bone].parent;if(parent<0)return;
      expect(compiled.basis[bone].slice(12,15)).toEqual([0,0,0]);
      const local=multiply(inverseAffine(world[parent]),matrix),expected=multiply(inverseAffine(compiled.rest[parent]),compiled.rest[bone]);
      const offsetError=length(sub(position(local),position(expected)));expect(offsetError).toBeLessThan(1e-12);
      const full=multiply(matrix,inverseAffine(compiled.rest[bone])),quantized=Array.from(matrices.slice(bone*16,bone*16+16));
      const exactReconstruction=multiply(full,compiled.rest[bone]),rendered=multiply(quantized,compiled.rest[bone]);
      const u=Number.EPSILON/2,gamma=8*u/(1-8*u),bounds=[0,1,2].map(axis=>{
        const coefficients=[...compiled.rest[bone].slice(12,15),1];let quantization=0,magnitude=0;
        for(let k=0;k<4;k++){quantization+=Math.abs(quantized[k*4+axis]-full[k*4+axis])*Math.abs(coefficients[k]);magnitude+=(Math.abs(quantized[k*4+axis])+Math.abs(full[k*4+axis]))*Math.abs(coefficients[k]);}
        return quantization+gamma*magnitude+Math.abs(exactReconstruction[12+axis]-matrix[12+axis]);
      });
      const renderedError=length(sub(position(rendered),position(matrix))),bound=Math.hypot(...bounds);
      expect(renderedError).toBeLessThanOrEqual(bound);
      jointErrors.push({bone:poolRig.manifest.bones[bone].name,offsetError,renderedError,arithmeticBound:bound});
    });
    const surfaces=geometry.map(geometry=>({geometry,points:posedCageSurface(geometry,shapeVertices(geometry.cage,shape,top),matrices)}));
    const observation=observePool(poolFixture,surfaces);
    records.push({appearance,frame:0,selectedParts:geometry.map(poolPartKey),jointErrors,observation});
    if(observation.violations.length)failures.push({height,build,torso,violations:observation.violations});
    for(const part of observation.parts.filter(part=>/nose|smile/i.test(part.name)))expect(part.minimum[2]).toBeGreaterThanOrEqual(poolFixture.waterHeight);
  }
  if(process.env.POOL_COMPILER_OUTPUT){
    const files=['pool-pose-compiler.ts','pool-canonical-pose.ts','pool-surface-coefficient.ts','pool-contact-sample.ts','pool-observer.ts','pool-solid.ts','pose-joints.ts','shape.ts','math.ts','motion.ts','geometry-proof.ts','surface.ts'];
    const sources=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(new URL('../src/render/character/'+file,import.meta.url))).digest('hex')]));
    writeFileSync(process.env.POOL_COMPILER_OUTPUT,JSON.stringify({coverage:'four body configurations at paddle frame zero; no interpolation claim',
      sources,body:poolRig.manifest.sourceSha256,fixture:poolFixture.revisions,
      paddle: createHash('sha256').update(JSON.stringify(poolRig.manifest.actions.pool_paddle)).digest('hex'),records},null,2));
  }
  expect(failures).toEqual([]);
},30000);
