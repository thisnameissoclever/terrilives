import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {observePool,type PoolObserverProfile} from '../src/render/character/pool-observer.js';
import {observePoolInput,poolFixture} from './pool-observer-fixture.js';

it.skipIf(!process.env.POOL_PROFILE_OUTPUT)('records cold and warm preparation/query costs',()=>{
  const appearance=defaultAppearance('feminine'),records=[];
  for(const [label,clip,frame] of [['cold-entry','pool_enter',15],['warm-entry','pool_enter',15],['warm-entry-next','pool_enter',15.25],
    ['cold-paddle','pool_paddle',0],['warm-paddle','pool_paddle',0],['warm-paddle-next','pool_paddle',.25]] as const){
    const input=observePoolInput(appearance,clip,frame),profile={} as PoolObserverProfile;
    const observation=observePool(poolFixture,input.surfaces,input.supports,profile);
    records.push({label,clip,frame,appearance,deformation:input.timingsMs,observer:profile,
      selectedVertices:observation.parts.reduce((n,p)=>n+p.vertices,0),selectedTriangles:observation.parts.reduce((n,p)=>n+p.triangles,0),violations:observation.violations.length});
  }
  writeFileSync(process.env.POOL_PROFILE_OUTPUT!,JSON.stringify({pid:process.pid,node:process.version,units:'milliseconds',records},null,2));
  expect(records.every(row=>row.observer.total>0)).toBe(true);
},120000);
