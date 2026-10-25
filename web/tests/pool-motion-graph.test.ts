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
