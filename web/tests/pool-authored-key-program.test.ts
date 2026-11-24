import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import key from '../../assets/models/sims/character-creator/pool_activity_key_v2.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {evaluatePoolPoseProgram,interpolatePoolPoseProgram,poolIntervalPreference,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {poolSourcePolicy} from '../src/render/character/pool-source-policy.js';
import {poolNodeProgramControls} from '../src/render/character/pool-pose-program.js';
import {solvePoolOrientedFoot} from '../src/render/character/pool-oriented-leg.js';
import {solveCertifiedPoolRail} from '../src/render/character/pool-rail-construction-arithmetic.js';
import {derivePoolRailArithmetic} from '../src/render/character/pool-rail-support-arithmetic.js';
import {derivePoolSupportArithmetic,poolViolationsBeyondArithmetic} from '../src/render/character/pool-support-arithmetic.js';
import {observePoolPatchSupport} from '../src/render/character/pool-support-observer.js';
import {observePoolSource} from '../src/render/character/pool-observer.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import type {Vec3} from '../src/render/character/math.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('evaluates the actual neutral pre-control program once for key, forced sides and constant interior with four owned supports',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const domain=compiler.prepareLegDomain(key.phase,poolEntrySearchPlan(key.phase)[key.requestId]);
  const candidate=compiler.compileNodeCandidates(key.phase,{requestId:key.requestId,root:key.rootDelta as unknown as Vec3,trunkPitchDegrees:key.trunk.worldPitchDegrees,headSourcePhase:key.head.sourcePhase})[0];
  const program=candidate.program,controls=poolNodeProgramControls(program);
  expect(program.policy).toEqual(poolSourcePolicy(poolFixture,'pool_enter',key.phase));
  expect(program.policy.footL.mode).toBe('release');expect(program.policy.footL.required).toBe(true);
  const stored=evaluatePoolPoseProgram(poolRig.manifest,candidate.pose.rest,candidate.pose.inverse,program),storedSkin=poolSkinMatrices(stored.world,stored.inverse);
  expect(candidate.pose.world).toEqual(stored.world);
  expect(candidate.pose.basis).toEqual(stored.basis);
  expect(candidate.skin).toEqual(storedSkin);
  expect(candidate.knees).toHaveLength(2);
  expect(candidate.unresolvedViolations).toHaveLength(0);
  expect(candidate.supports.every(support=>support.required&&support.satisfied)).toBe(true);
  const records=[];
  for(const fraction of [0,.5,1]){
    const actual=interpolatePoolPoseProgram(poolRig.manifest,candidate.pose.rest,candidate.pose.inverse,program,program,fraction);
    const skin=poolSkinMatrices(actual.world,actual.inverse),surfaces=compiler.geometry.map((geometry,index)=>({geometry,points:posedCageSurface(geometry,domain.cages[index],skin)}));
    const observation=observePoolSource(poolFixture,surfaces,{action:'pool_enter',phase:key.phase});
    const replay=poolIntervalPreference(poolRig.manifest,candidate.pose.rest,candidate.pose.inverse,program.preferenceBasis,program.preferenceBasis,fraction,true);
    for(const contact of candidate.contacts){const {upper,lower,end}=contact.anatomy;
      if(contact.frame)solvePoolOrientedFoot(replay,upper,lower,end,contact.frame);
      else solveCertifiedPoolRail(replay,upper,lower,end,contact.railFrame!,contact.pole,{fixture:poolFixture,geometry:compiler.geometry[0],cage:domain.cages[0],patch:compiler.anatomy[contact.limb].patch,support:domain.source.limbs[contact.limb]});
    }
    const replaySkin=poolSkinMatrices(replay.world,replay.inverse);
    let maximumSelectedPointDifference=0;
    const pointDifferences:{part:string;reference:'stored'|'replay';vertex:number;axis:number;actual:number;expected:number}[]=[];
    for(const [index,surface] of surfaces.entries()){
      const retained=posedCageSurface(surface.geometry,domain.cages[index],storedSkin);
      const replayPoints=posedCageSurface(surface.geometry,domain.cages[index],replaySkin),seen=new Set<string>();
      for(const part of surface.geometry.description.parts)for(let at=part.start;at<part.start+part.count;at++)for(let axis=0;axis<3;axis++){
        const coordinate=surface.geometry.indices[at]*3+axis;maximumSelectedPointDifference=Math.max(maximumSelectedPointDifference,Math.abs(surface.points[coordinate]-retained[coordinate]));
        for(const [reference,values] of [['stored',retained],['replay',replayPoints]] as const)if(surface.points[coordinate]!==values[coordinate]&&!seen.has(part.name+reference)){
          seen.add(part.name+reference);pointDifferences.push({part:part.name,reference,vertex:surface.geometry.indices[at],axis,actual:surface.points[coordinate],expected:values[coordinate]});
        }
      }
    }
    const proofFailures:{limb:string;error:string}[]=[];
    const arithmetic=candidate.contacts.flatMap(contact=>{
      try{return [contact.frame
        ?derivePoolSupportArithmetic(poolFixture,surfaces[0],domain.cages[0],replay,contact.patch,domain.source.limbs[contact.limb],contact.frame,observation)
        :derivePoolRailArithmetic(poolFixture,surfaces[0],domain.cages[0],replay,compiler.anatomy[contact.limb].patch,domain.source.limbs[contact.limb],contact.railFrame!,observation)];}
      catch(error){proofFailures.push({limb:contact.limb,error:error instanceof Error?error.message:String(error)});return [];}
    });
    const supports=candidate.contacts.map(contact=>observePoolPatchSupport(poolFixture,surfaces,contact.patch,domain.source.limbs[contact.limb],key.phase,observation,arithmetic));
    records.push({fraction,maximumMatrixReplayDifference:Math.max(...actual.world.flatMap((matrix,bone)=>matrix.map((value,at)=>Math.abs(value-replay.world[bone][at])))),
      maximumStoredSkinDifference:Math.max(...skin.map((value,at)=>Math.abs(value-storedSkin[at]))),maximumSelectedPointDifference,
      maximumReplaySkinDifference:Math.max(...skin.map((value,at)=>Math.abs(value-replaySkin[at]))),pointDifferences,
      actualBasis:actual.basis,replayBasis:replay.basis,actualWorld:actual.world,replayWorld:replay.world,proofFailures,observation,supports,unresolved:poolViolationsBeyondArithmetic(observation,arithmetic),arithmetic:arithmetic.map(({geometry,...proof})=>proof)});
  }
  if(process.env.POOL_PROGRAM_OUTPUT)writeFileSync(process.env.POOL_PROGRAM_OUTPUT,JSON.stringify({scope:'Three finite actual neutral node-program evaluations with exact key/forced/interior/proof output parity. No moving interval, bound artifact, source transfer or played claim.',key,shape,top:compiler.top,source:poolRig.manifest.sourceSha256,bones:poolRig.manifest.bones,rest:candidate.pose.rest,inverse:candidate.pose.inverse,program,producerBasis:candidate.pose.basis,controls,records},null,2));
  for(const record of records){expect(record.maximumMatrixReplayDifference).toBe(0);expect(record.maximumStoredSkinDifference).toBe(0);expect(record.maximumSelectedPointDifference).toBe(0);expect(record.proofFailures).toHaveLength(0);expect(record.unresolved).toHaveLength(0);expect(record.supports.every(support=>support.required&&support.satisfied)).toBe(true);}
},30000);
