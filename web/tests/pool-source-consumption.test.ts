import {readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {prepareClipFamily,type ClipLibrary,type ClipParts,type ProductionClip} from '../src/render/character/clip-runtime.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {requirePoolMatrixRepresentation} from '../src/render/character/pool-matrix-producer.js';
import {poolUpper} from '../src/render/character/pool-arithmetic.js';
import {poolBase,poolRig,poolLibrary,poolFixture} from './pool-observer-fixture.js';

function actualCompiler(){
  const capsule=JSON.parse(readFileSync(process.env.POOL_V2_SOURCE_CAPSULE!,'utf8')) as {controls:{action:string;index:number;sample:ProductionClip['samples'][number]}[];joinSamples:ProductionClip['samples'][number][]};
  const parts=JSON.parse(readFileSync(new URL('../../assets/models/sims/character-creator/clips/pool/parts.json',import.meta.url),'utf8')) as ClipParts,library=structuredClone(poolLibrary) as ClipLibrary;
  const normalize=(sample:ProductionClip['samples'][number])=>({...structuredClone(sample),rig:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],props:{},eyesClosed:false,bookVisible:false});
  for(const control of capsule.controls)if(control.action==='pool_enter')library.clips.pool_enter.samples[control.index]=normalize(control.sample);
  capsule.joinSamples.forEach((sample,index)=>{library.clips.pool_enter.samples[4+index*2]=normalize(sample);});
  const manifest=prepareClipFamily(poolBase,null,parts,library,'pool').manifest,rig={...poolRig,manifest,supplemental:{...poolRig.supplemental!,manifest}};
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const selected=new PreparedBody(poolBase,appearance).select(rig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  return new PoolEntryCompiler(manifest,shape,top,[selected.body,selected.extra!],poolFixture);
}

it.skipIf(!process.env.POOL_V2_SOURCE_CAPSULE)('retains the actual authored trunk and head instead of replacing them with source zero',()=>{
  const compiler=actualCompiler(),domain=compiler.prepareLegDomain(.2,poolEntrySearchPlan(.2)[4]),spine=compiler.bundle.bones.findIndex(bone=>bone.name==='spine'),head=compiler.bundle.bones.findIndex(bone=>bone.name==='head');
  const hips=compiler.bundle.bones.findIndex(bone=>bone.name==='hips');expect(domain.node.basis[hips]).toEqual(domain.seed.basis[hips]);
  const actual=domain.node.basis[spine],intended=domain.seed.basis[spine],actualError=requirePoolMatrixRepresentation(actual),sourceError=requirePoolMatrixRepresentation(intended);
  for(let at=0;at<16;at++)expect(Math.abs(actual[at]-intended[at])).toBeLessThanOrEqual(poolUpper(actualError[at]+sourceError[at]));
  expect(domain.node.basis[head]).toEqual(domain.seed.basis[head]);
  expect(domain.node.basis[0]).toEqual(domain.seed.basis[0]);
});

it.skipIf(!process.env.POOL_V2_SOURCE_CAPSULE)('observes the actual already-positioned neutral source with zero extra diagnostic root travel',()=>{
  const compiler=actualCompiler(),candidates=compiler.compileNodeCandidates(.2,{requestId:4,root:[0,0,0]});
  const records=candidates.map(candidate=>({projection:candidate.projection,knees:candidate.knees,basis:candidate.pose.basis,rest:candidate.pose.rest,contacts:candidate.contacts.map(contact=>({limb:contact.limb,target:contact.target,pole:contact.pole,orientation:contact.orientation,surface:contact.surface,frame:contact.frame,railFrame:contact.railFrame})),observation:candidate.observation,supports:candidate.supports,unresolved:candidate.unresolvedViolations,arithmetic:candidate.arithmetic.map(({geometry,...proof})=>proof)}));
  if(process.env.POOL_SOURCE_CONSUMPTION_OUTPUT)writeFileSync(process.env.POOL_SOURCE_CONSUMPTION_OUTPUT,JSON.stringify({scope:'One actual authored neutral source transfer with zero extra root delta; no full source track, interval, artifact or played claim.',search:compiler.searches.get(.2),records},null,2));
  expect(candidates).toHaveLength(1);expect(candidates[0].projection.sourceDisplacement).toEqual([0,0,0]);
  expect(candidates[0].unresolvedViolations).toHaveLength(0);expect(candidates[0].supports.every(support=>support.required&&support.satisfied)).toBe(true);
},30000);
