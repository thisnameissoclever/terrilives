import type {PoolCycleDefinition} from './pool-cycle-source.js';
import type {PoolFixtureV1} from './pool-contact-types.js';
import {poolSourcePolicy} from './pool-source-policy.js';

/** Verify the authored grasp change on every exit origin before configuring an actor. */
export function requirePoolOuterTransfer(motion:PoolCycleDefinition,fixture:PoolFixtureV1):void {
  if(motion.version!==16||!motion.forwardHop?.outerGripTransfer)return;
  const hop=motion.forwardHop,transfer=hop.outerGripTransfer!;
  const right=transfer.rightContactUnit/motion.clockUnits,left=transfer.leftContactUnit/motion.clockUnits,
    approach=transfer.leftApproachUnit/motion.clockUnits,outer=fixture.rails.map(r=>r.id);
  const end=hop.climbKeys.find(k=>k.entryUnit===hop.launchFromUnit)?.unit;
  if(end===undefined||end<=transfer.leftContactUnit)throw new Error('The left grasp must precede the exterior descent.');
  const join=end/motion.clockUnits,start=hop.climbKeys.find(k=>k.authoredUnit===58000)!.unit/motion.clockUnits;
  for(let i=0;i<12;i++){
    const action='pool_exit_'+i,clip=fixture.clips[action];
    const phases=new Set([start,right,approach,left,join,...clip.samples.map(s=>s.phase),...clip.intervals.map(s=>(s.start+s.end)/2)]);
    for(const phase of phases){
      if(phase<start||phase>join)continue;
      const p=poolSourcePolicy(fixture,action,phase),l=p.handL,r=p.handR;
      const fixed=p.footR.required&&p.footR.surface===motion.places.crest.surface;
      const leading=phase<right?r.mode==='approach'&&!r.required:r.required;
      const trailing=phase<=approach?(l.mode==='free'||phase===approach&&l.mode==='approach'&&!l.required):
        phase<left?l.mode==='approach'&&!l.required:l.required;
      if(!fixed||!leading||r.surface!==outer[1]||!trailing||phase>approach&&l.surface!==outer[0])
        throw new Error('The independent exit loses its installed sole or staggered rail grip in '+action+' at '+phase+'.');
    }
  }
}
