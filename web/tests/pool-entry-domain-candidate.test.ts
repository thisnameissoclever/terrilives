import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it.each([.2,.5,.6])('finds a phase %s candidate in its declared true-reach and source-posture domain',phase=>{
  let sources:{path:string;sha256:string}[]=[];
  if(process.env.POOL_DOMAIN_OUTPUT){
    const root=new URL('../../',import.meta.url),workspace=new URL('.superpowers/sdd/2026-10-21-editable-world-and-water/',root);
    const previous=JSON.parse(readFileSync(new URL('pool-oriented-leg-frame-v3-sources/manifest.json',workspace),'utf8'));
    const paths=previous.files.map((row:{path:string})=>row.path);
    paths.push('web/tests/pool-entry-domain-candidate.test.ts','web/src/render/character/contact-math.ts','web/src/render/character/sphere-box.ts',
      ...['pool-oriented-leg','pool-oriented-leg-math','pool-entry-domain','pool-support-observer','pool-arithmetic','pool-skin-arithmetic','pool-support-arithmetic','pool-exact-projection',
        'pool-exact-number','pool-foot-contact-frame','pool-limb-construction-arithmetic','pool-matrix-arithmetic','pool-matrix-producer','pool-knee-branch','pool-entry-search-plan'].map(name=>'web/src/render/character/'+name+'.ts'));
    sources=[...new Set<string>(paths)].map(path=>{
      const bytes=readFileSync(new URL(path,root)),copy=join(process.env.POOL_DOMAIN_OUTPUT!+'.sources',path);
      mkdirSync(dirname(copy),{recursive:true});writeFileSync(copy,bytes);
      return {path,sha256:createHash('sha256').update(bytes).digest('hex')};
    });
    writeFileSync(process.env.POOL_DOMAIN_OUTPUT+'.sources/manifest.json',JSON.stringify(sources,null,2));
  }
  const appearance=defaultAppearance('feminine'),body=new PreparedBody(poolBase,appearance);
  const selected=body.select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const geometry=[selected.body,selected.extra!],shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,top,geometry,poolFixture),started=performance.now();
  const candidates=compiler.compileNodeCandidates(phase),accepted=candidates.filter(candidate=>!candidate.unresolvedViolations.length&&candidate.supports.every(s=>s.satisfied));
  const records=candidates.map(candidate=>({posture:candidate.posture,fraction:candidate.fraction,legFrame:candidate.legFrame,roll:candidate.roll,projection:candidate.projection,
    planId:candidate.planId,knees:candidate.knees,basis:candidate.pose.basis,rest:candidate.pose.rest,contacts:candidate.contacts.map(c=>({limb:c.limb,target:c.target,surface:c.surface,part:c.patch.part,triangles:c.patch.sourceTriangles,frame:c.frame??null})),
    observation:candidate.observation,supports:candidate.supports,unresolvedViolations:candidate.unresolvedViolations,
    arithmetic:candidate.arithmetic.map(({geometry,...proof})=>proof)}));
  if(process.env.POOL_DOMAIN_OUTPUT){
    writeFileSync(process.env.POOL_DOMAIN_OUTPUT+'.'+phase+'.json',JSON.stringify({appearance,phase,sources,elapsedMs:performance.now()-started,search:compiler.searches.get(phase),records},null,2));
  }
  const failures=candidates.map(candidate=>({posture:candidate.posture,fraction:candidate.fraction,
    violations:candidate.unresolvedViolations.map(v=>[v.part,v.surface,v.signedClearance]),supports:candidate.supports.map(s=>({part:s.patchPart,surface:s.surface,satisfied:s.satisfied,gap:s.minimumGap,bound:s.arithmeticBound,reasons:s.reasons}))}));
  expect(accepted.length,JSON.stringify(failures,null,2)).toBeGreaterThan(0);
},60000);
