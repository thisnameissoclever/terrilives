import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {compilePoolPaddleTrack,sampleCompiledPaddle} from '../src/render/character/pool-paddle-track.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('assembles exact loop closure and observes actual prepared interval sampling for representative bodies',()=>{
  const records=[],failures=[];
  for(const [height,build,torso] of [[50,50,50],[0,100,0],[100,0,0],[100,100,0]]){
    const appearance=defaultAppearance('feminine');Object.assign(appearance.body,{height,build,torso});
    const body=new PreparedBody(poolBase,appearance),selected=body.select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_paddle',swimwear:'two_piece'});
    const started=performance.now(),compiled=compilePoolPaddleTrack(poolRig.manifest,{presentation:appearance.presentation,...appearance.body,face:appearance.face},anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
    expect(sampleCompiledPaddle(compiled,poolRig.manifest,0)).toEqual(sampleCompiledPaddle(compiled,poolRig.manifest,1));
    const invalid=compiled.observations.filter(o=>o.surface.violations.length||o.airwayMinimum<poolFixture.waterHeight);
    records.push({appearance,milliseconds:performance.now()-started,poses:compiled.poses.length,intervals:compiled.intervals.length,boundaryTransforms:compiled.boundaryTransforms,observations:compiled.observations});
    if(invalid.length)failures.push({appearance,invalid});
  }
  if(process.env.POOL_TRACK_OUTPUT)writeFileSync(process.env.POOL_TRACK_OUTPUT,JSON.stringify({continuousBound:false,records},null,2));
  expect(failures).toEqual([]);
},60000);
