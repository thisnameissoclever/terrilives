import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {bodyFields,defaultAppearance,type CharacterAppearanceV1} from '../src/character/schema.js';
import {observePool} from '../src/render/character/pool-observer.js';
import {observePoolInput,poolFixture} from './pool-observer-fixture.js';

it('records complete selected surfaces for the retained tall swimmer failure',()=>{
  const appearance=defaultAppearance('masculine');appearance.body={height:100,build:0,shoulders:0,hips:0,torso:100};
  const input=observePoolInput(appearance,'pool_paddle',0),started=performance.now();
  const observation=observePool(poolFixture,input.surfaces,input.supports);
  const record={appearance,clip:'pool_paddle',frame:0,phase:input.phase,elapsedMs:performance.now()-started,observation};
  if(process.env.POOL_OBSERVATION_OUTPUT)writeFileSync(process.env.POOL_OBSERVATION_OUTPUT,JSON.stringify(record,null,2));
  expect(observation.parts.length).toBeGreaterThan(10);
  expect(observation.parts.every(part=>part.minimum.every(Number.isFinite)&&part.maximum.every(Number.isFinite))).toBe(true);
  expect(observation.violations.some(v=>v.surface==='Pool basin floor'&&v.signedClearance<-.001)).toBe(true);
},60000);

it.skipIf(!process.env.POOL_OBSERVATION_CORPUS)('records the frozen body corners and phase boundaries without accepting a fitted trajectory',()=>{
  const output=process.env.POOL_OBSERVATION_CORPUS!,cases:{appearance:CharacterAppearanceV1;clip:string;frame:number;group:string}[]=[];
  for(const presentation of ['masculine','feminine'] as const)for(let corner=0;corner<32;corner++){
    const appearance=defaultAppearance(presentation);bodyFields.forEach((field,index)=>appearance.body[field]=(corner>>index&1)*100);
    for(const frame of [0,6])cases.push({appearance,clip:'pool_paddle',frame,group:'independent-body-corners'});
  }
  const neutral=defaultAppearance('feminine');
  for(const frame of [0,.999,1,1.001,3.999,4,4.001,7,10,15,19.199,19.2,19.201,23.999,24,24.001,30,35.999,36,36.001,40])
    cases.push({appearance:neutral,clip:'pool_enter',frame,group:'entry-contact-boundaries'});
  for(let origin=0;origin<12;origin++)for(const frame of [2,4,25,40])cases.push({appearance:neutral,clip:'pool_exit_'+origin,frame,group:'every-exit-origin'});
  const sources=Object.fromEntries(['../src/render/character/pool-fit.ts','../src/render/character/pool-observer.ts','../src/render/character/pool-solid.ts',
    '../../assets/models/sims/character-creator/clips/clips.json','../../assets/models/sims/character-creator/clips/pool/contacts-v1.json'].map(path=>
    [path,createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')]));
  writeFileSync(output,JSON.stringify({kind:'coverage',samples:cases.length,sources,continuousBound:false,
    limit:'Finite frozen-pose samples. All 32 independent body corners per presentation at paddle frames 0 and 6; neutral feminine entry boundaries and all exit origins. No swept or production-artifact containment claim.'})+'\n');
  let observed=0,failed=0,penetrating=0;
  for(const [index,row] of cases.entries()){
    const started=performance.now();
    try {
      const input=observePoolInput(row.appearance,row.clip,row.frame),observation=observePool(poolFixture,input.surfaces,input.supports);
      appendFileSync(output,JSON.stringify({kind:'observation',...row,phase:input.phase,elapsedMs:performance.now()-started,observation})+'\n');
      observed++;if(observation.violations.length)penetrating++;
    }catch(error){failed++;appendFileSync(output,JSON.stringify({kind:'pose-failure',...row,message:error instanceof Error?error.message:String(error)})+'\n');}
    if((index+1)%16===0)console.info(`Pool observation ${index+1}/${cases.length}; ${penetrating} samples penetrate; ${failed} pose failures.`);
  }
  appendFileSync(output,JSON.stringify({kind:'complete',observed,failed,penetrating})+'\n');
  expect(observed+failed).toBe(cases.length);expect(penetrating).toBeGreaterThan(0);
},600000);
