import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {observePool} from '../src/render/character/pool-observer.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('fits the native entry support keys against actual rungs, rail edges and selected body surfaces',()=>{
  const appearance=defaultAppearance('feminine'),body=new PreparedBody(poolBase,appearance);
  const selected=body.select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'}),geometry=[selected.body,selected.extra!];
  const shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(poolBase.vertices);
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,top,geometry,poolFixture),records=[],failures=[];
  for(const phase of [0,.1,.2,.3,.4,.5,.6,.7,.8]){
    try{
      const pose=compiler.supportKey(phase),surfaces=geometry.map(g=>({geometry:g,points:posedCageSurface(g,shapeVertices(g.cage,shape,top),pose.skin)}));
      const observation=observePool(poolFixture,surfaces);records.push({phase,observation,diagnostics:compiler.diagnostics.get(phase)});
      if(observation.violations.length)failures.push({phase,violations:observation.violations});
    }catch(error){const failure={phase,error:String(error),diagnostics:compiler.diagnostics.get(phase)};records.push(failure);failures.push(failure);}
  }
  if(process.env.POOL_ENTRY_OUTPUT)writeFileSync(process.env.POOL_ENTRY_OUTPUT,JSON.stringify({appearance,records},null,2));
  expect(failures).toEqual([]);
},60000);
