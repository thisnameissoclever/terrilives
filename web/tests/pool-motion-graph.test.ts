import {expect,it} from 'vitest';
import {samplePoolGraph,validatePoolGraph,type PoolCanonicalGraph} from '../src/render/character/pool-motion-graph.js';

function graph():PoolCanonicalGraph<string>{
  const poses=['outside','return',...Array.from({length:11},(_,index)=>'paddle'+(index+1))];
  const paddle=Array.from({length:13},(_,index)=>({phase:index/12,pose:index===0||index===12?1:index+1}));
  const bridges=Array.from({length:12},(_,origin)=>({keys:[paddle[origin],{phase:1,pose:1}].map((key,index)=>({...key,phase:index}))}));
  return {poses,entry:{keys:[{phase:0,pose:0},{phase:1,pose:1}]},paddle:{keys:paddle},bridges};
}
const endpoints=(sample:ReturnType<typeof samplePoolGraph>)=>[sample.left,sample.right,sample.amount];

it('shares exact entry, loop and all twelve bridge endpoints',()=>{
  const value=graph();expect(()=>validatePoolGraph(value)).not.toThrow();
  expect(endpoints(samplePoolGraph(value,'entry',1))).toEqual(endpoints(samplePoolGraph(value,'paddle',0)));
  expect(endpoints(samplePoolGraph(value,'paddle',1))).toEqual(endpoints(samplePoolGraph(value,'paddle',0)));
  for(let origin=0;origin<12;origin++){
    expect(endpoints(samplePoolGraph(value,'exit',0,origin))).toEqual(endpoints(samplePoolGraph(value,'paddle',origin/12)));
    expect(endpoints(samplePoolGraph(value,'exit',.1,origin))).toEqual(endpoints(samplePoolGraph(value,'entry',1)));
  }
});

it('uses the exact canonical entry sampler for every fractional reverse tail',()=>{
  const value=graph();value.poses.push('middle');value.entry.keys.splice(1,0,{phase:.317,pose:13});
  for(let origin=0;origin<12;origin++)for(const phase of [.10001,.123,.577,.999,1]){
    expect(endpoints(samplePoolGraph(value,'exit',phase,origin))).toEqual(endpoints(samplePoolGraph(value,'entry',(1-phase)/.9)));
  }
});

it('rejects a mismatched loop, wrong origin and invalid shared reference',()=>{
  const loop=graph();loop.paddle.keys.at(-1)!.pose=2;expect(()=>validatePoolGraph(loop)).toThrow(/loop/);
  const origin=graph();origin.bridges[3].keys[0].pose=2;expect(()=>validatePoolGraph(origin)).toThrow(/origin/);
  const reference=graph();reference.entry.keys[0].pose=99;expect(()=>validatePoolGraph(reference)).toThrow(/reference/);
});

it('keeps reduced-motion paddling and every bridge on the common return pose',()=>{
  const value=graph();
  for(let origin=0;origin<12;origin++)for(const phase of [0,.049,.099,.1]){
    expect(endpoints(samplePoolGraph(value,'exit',phase,origin,true))).toEqual(endpoints(samplePoolGraph(value,'paddle',origin/12,0,true)));
  }
});

it('follows a separately authored climb-out after every paddle origin and never rewinds the airborne hop',()=>{
  const g=graph();
  const takeoff=g.poses.push('takeoff')-1,air=g.poses.push('airborne')-1,climbing=g.poses.push('inside ladder')-1;
  g.entry.keys.splice(1,0,{phase:.6,pose:takeoff},{phase:.8,pose:air});
  g.climbOut={keys:[{phase:.1,pose:1},{phase:.28,pose:climbing},{phase:1,pose:0}]};g.takeoffPhase=.6;
  validatePoolGraph(g);
  for(let origin=0;origin<12;origin++){
    expect(samplePoolGraph(g,'exit',0,origin).left).toBe(samplePoolGraph(g,'paddle',origin/12).left);
    expect(samplePoolGraph(g,'exit',.1,origin).left).toBe(1);
    expect(samplePoolGraph(g,'exit',.28,origin).left).toBe(climbing);
    expect(samplePoolGraph(g,'exit',.28,origin,true).left).toBe(climbing);
    expect(samplePoolGraph(g,'exit',1,origin).left).toBe(0);
    expect(samplePoolGraph(g,'exit',.64,origin).track).toBe(g.climbOut);
  }
  expect(samplePoolGraph(g,'entry',.8).left).toBe(air);
  g.climbOut.keys[0].pose=climbing;expect(()=>validatePoolGraph(g)).toThrow('settled swim pose');
});

it('requires the native takeoff key and both shared endpoints for an authored climb-out',()=>{
  const g=graph();g.climbOut={keys:[{phase:.1,pose:1},{phase:1,pose:0}]};
  expect(()=>validatePoolGraph(g)).toThrow('takeoff');
  g.takeoffPhase=.6;expect(()=>validatePoolGraph(g)).toThrow('takeoff');
  g.entry.keys.splice(1,0,{phase:.6,pose:2});g.takeoffPhase=.5;expect(()=>validatePoolGraph(g)).toThrow('takeoff');
  g.takeoffPhase=.6;g.climbOut.keys[1].pose=2;expect(()=>validatePoolGraph(g)).toThrow('standing');
});

it('schedules each authored exit on its own clip clock without feeding its cuts into entry',async()=>{
  const {poolReplaySchedule}=await import('../src/render/character/pool-replay-schedule.js');
  const limb={mode:'free',surface:null,region:null,interval:null,intervalSpace:'clip-phase'};
  const limbs=Object.fromEntries(['handL','handR','footL','footR'].map(l=>[l,limb]));
  const clip=(phases:number[])=>({playback:'progress',samples:phases.map(phase=>({phase,travel:phase,limbs})),
    intervals:phases.slice(1).map((end,i)=>({start:phases[i],end,limbs}))});
  const entry=[0,.6,.75,1],exit=[0,.1,.27,.8,1];
  const fixture={clips:{pool_enter:clip(entry),pool_paddle:{...clip([0,1]),playback:'loop'},
    ...Object.fromEntries(Array.from({length:12},(_,i)=>['pool_exit_'+i,clip(exit)]))}};
  const definition={version:16,clockUnits:100000,paddle:{samples:12},forwardHop:{entryUnits:[0,60000,75000,100000],bridgeEndUnit:10000,
    climbOutUnits:[0,10000,27000,80000,100000],climbKeys:[0,10000,27000,80000,100000].map(unit=>({unit,authoredUnit:unit})),
    footTransitions:[],kind:'separate-climb-out',takeoffUnit:60000,standingUnit:100000}};
  const schedule=poolReplaySchedule(fixture as unknown as Parameters<typeof poolReplaySchedule>[0],definition as unknown as Parameters<typeof poolReplaySchedule>[1]);
  expect(schedule.entryUnits).toEqual(definition.forwardHop.entryUnits);expect(schedule.reverseComparisons).toBe(0);
  for(let i=0;i<12;i++){
   const nodes=schedule.jobs.filter(j=>j.kind==='node'&&j.action==='pool_exit_'+i);
   expect(nodes.map(j=>j.phase)).toEqual(exit);expect(nodes[2].left).toBe('climb/27000');expect(nodes.at(-1)!.left).toBe('entry/0');
  }
});
