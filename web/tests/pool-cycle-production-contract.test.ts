import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {compilePoolCycle,poolCycleCoverage,type PoolCycleDiagnostic} from '../src/render/character/pool-cycle-compiler.js';
import {validatePoolContactArtifact} from '../src/render/character/pool-contact-protocol.js';
import {preparationFailure,restorePreparationFailure} from '../src/render/character/preparation-error.js';
import {schemaPoolArtifact} from './pool-contact-service-fixture.js';
import type {PoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import type {Bundle} from '../src/render/character/bundle.js';
import type {ShapeParameters} from '../src/render/character/shape.js';
import type {PoolFixtureV1} from '../src/render/character/pool-contact-types.js';

const failure=vi.hoisted(()=>({value:new TypeError('Original source construction failed')}));
vi.mock('../src/render/character/pool-cycle-source.js',()=>({PoolCycleSource:class {entry(){throw failure.value;}}}));
vi.mock('../src/render/character/pool-source-policy.js',async original=>({...await original<typeof import('../src/render/character/pool-source-policy.js')>(),poolSourceEvents:()=>[0,1]}));

it('counts all compiler observations and preserves strict validator summary agreement',async()=>{
 const input=await createPoolContactInput(defaultAppearance()),artifact=schemaPoolArtifact(input);
 const {entry,paddle,bridges}=artifact.graph;
 artifact.coverage=poolCycleCoverage([entry,paddle,...bridges]);
 expect(artifact.coverage).toMatchObject({samples:75,interpolationSamples:25,continuousBound:false});
 expect(()=>validatePoolContactArtifact(artifact)).not.toThrow();
 artifact.coverage.samples=50;
 expect(()=>validatePoolContactArtifact(artifact)).toThrow('summary does not match');
});

it('retains failed action, phase, stage and original cause through existing worker diagnostics',async()=>{
 const input=await createPoolContactInput(defaultAppearance()),request={version:1 as const,id:14,kind:'pool' as const,input};
 let caught:unknown;const rows:PoolCycleDiagnostic[]=[];
 try{compilePoolCycle(input,{} as Bundle,{} as ShapeParameters,2,[],{} as PoolFixtureV1,{} as PoolCycleDefinition,row=>rows.push(row));}catch(error){caught=error;}
 expect(rows.map(row=>({phase:row.phase,stage:row.stage,passed:row.passed}))).toEqual([
  {phase:0,stage:'entry-source',passed:false},{phase:1,stage:'entry-source',passed:false},
 ]);
 expect(rows.every(row=>(row.error?.cause as {cause:unknown}).cause===failure.value)).toBe(true);
 const response=preparationFailure(caught,{operation:'preparePoolContact',requestId:14,resource:'pool',inputKey:input.key});
 const restored=restorePreparationFailure(response,request);
 expect(restored.message).toContain('no paddle join');
 const contextual=restored.cause as Error;
 expect(contextual.cause).toMatchObject({action:'pool_enter',phase:0,stage:'entry-source',cause:{name:'TypeError',message:failure.value.message}});
 expect(((contextual.cause as {cause:Error}).cause).stack).toBe(failure.value.stack);
});
