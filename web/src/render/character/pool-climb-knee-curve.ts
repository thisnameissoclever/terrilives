import type {PoolCycleSource,PoolFoot} from './pool-cycle-source.js';
import {makePoolPoseProgram,poolIntervalProgramControls,type PoolPoseProgram} from './pool-pose-program.js';
import {resolvePoolLimbState} from './pool-contact-evaluator.js';
import {poolIntervalPreference,poolSkinMatrices,evaluatePoolPoseProgram} from './pool-contact-sample.js';
import {poolSourcePolicy} from './pool-source-policy.js';
import {fitPoolKneeOrbit,poolTriangleBarycentric,type PoolKneeObstacle} from './pool-knee-orbit-fit.js';
import {PoolSolidIndex,type Triangle} from './pool-solid.js';
import {posedCageSurface} from './geometry-proof.js';
import type {PoolSolid} from './pool-contact-types.js';
import type {Vec3} from './math.js';
import {configuredPoolChainReach} from './pool-entry-domain.js';
import {PoolTrialRefusal} from './pool-trial-work.js';

type Band={left:number;right:number;t:number;lo:number;hi:number};
type Sample={i:number;t:number;location:{action:string;phase:number};program:PoolPoseProgram};
const limit=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));

function clearOuterLip(source:PoolCycleSource,events:number[],samples:Sample[],values:number[],programs:Map<number,PoolPoseProgram>,lip:PoolSolid){
  const layer=source.geometry[0],part=layer.description.parts.find(p=>p.name==='Creator bare leg L')!;
  const first=events[0],last=events.at(-1)!,crest=new PoolSolidIndex(lip),margin=source.fixture.rails[0].radius/8;
  const approach=source.fixture.clips.pool_exit_0.samples.find(k=>k.phase===last/source.definition.clockUnits)!.limbs.footL.interval!;
  const peak=approach[0]*source.definition.clockUnits;
  const w=events.map(u=>{const t=limit(u<=peak?(u-first)/(peak-first):(last-u)/(last-peak),0,1);return t*t*(3-2*t);});
  const a=source.anatomy.footL,reach=configuredPoolChainReach(source.neutral.rest,a.upper,a.lower,a.end);
  const point=(m:Float32Array,id:number):Vec3=>[m[id*3],m[id*3+1],m[id*3+2]];
  const command=(p:PoolPoseProgram,h:number,dy:number)=>makePoolPoseProgram(p.preferenceBasis,p.controls.map((c,i)=>{
    if(i!==0)return c;const s=c.state,[x,y,z]=s.target;
    return {...c,state:{...s,...(h||s.kneeOrbit!==undefined?{kneeOrbit:h}:{}),target:[x,y+dy,z] as Vec3}};
  }),p.policy);
  const mesh=(s:Sample,h:number,dy:number)=>{
    const body=evaluatePoolPoseProgram(source.bundle,source.neutral.rest,source.neutral.inverse,command(s.program,h,dy),s.location);
    return posedCageSurface(layer,source.cages[0],poolSkinMatrices(body.world,source.neutral.inverse));
  };
  let allowable=Infinity;
  events.forEach((u,i)=>{
    if(!w[i])return;const p=programs.get(u)!,q=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,p.preferenceBasis,p.preferenceBasis,0,true);
    const [x,y,z]=p.controls[0].state.target,hip=q.world[a.upper],radius=reach.maximum-margin;
    allowable=Math.min(allowable,(hip[13]+Math.sqrt(Math.max(0,radius*radius-(x-hip[12])**2-(z-hip[14])**2))-y)/w[i]);
  });
  let amplitude=0;
  for(let pass=0;pass<3;pass++){
    let increase=0;
    for(const s of samples){
      const {i,t}=s,bias=(1-t)*w[i]+t*w[i+1];if(!bias)continue;
      const h=(1-t)*values[i]+t*values[i+1],current=mesh(s,h,amplitude*bias);
      let moved:Float32Array|undefined;
      for(let k=part.start;k<part.start+part.count;k+=3){
        const ids=[layer.indices[k],layer.indices[k+1],layer.indices[k+2]],tri=ids.map(id=>point(current,id)) as unknown as Triangle;
        if([0,1,2].some(axis=>tri.every(p=>p[axis]<lip.bounds[0][axis])||tri.every(p=>p[axis]>lip.bounds[1][axis])))continue;
        const hit=crest.triangleWitness(tri)?.point??tri.find(p=>crest.inside(p));if(!hit)continue;
        moved??=mesh(s,h,amplitude*bias+margin);
        const bary=poolTriangleBarycentric(hit,tri),slope=ids.reduce((sum,id,j)=>sum+bary[j]*(moved![id*3+1]-current[id*3+1])/margin,0);
        if(slope<=0)continue;
        const distance=crest.exitAlong(hit,[0,1,0])??lip.bounds[1][1]-hit[1];
        increase=Math.max(increase,(distance+margin)/(slope*bias));
      }
    }
    const next=Math.max(0,Math.min(allowable,amplitude+increase));if(next<=amplitude)break;amplitude=next;
  }
  if(amplitude>0)events.forEach((u,i)=>{if(w[i])programs.set(u,command(programs.get(u)!,values[i],w[i]*amplitude));});
}

/** Fit the single interpolated swivel curve. At fraction t the actual command is (1-t)*left+t*right. */
export function fitClimbKneeCurve(source:PoolCycleSource,programs:Map<number,PoolPoseProgram>):void{
  const motion=source.definition;if(motion.version!==16||!motion.forwardHop?.launchFromUnit)return;
  const plan=motion.forwardHop.climbKeys;
  const turn=plan.filter(k=>k.authoredUnit>=58000&&k.authoredUnit<=64000).map(k=>k.unit);
  if(turn.length<3||!turn.some(u=>programs.get(u)!.controls.slice(0,2).some(c=>c.state.kneeOrbit)))return;
  function fitWindow(events:number[],limb:PoolFoot,obstacles:readonly PoolKneeObstacle[]){
    const control=limb==='footR'?1:0;
    const initial=events.map(u=>programs.get(u)!.controls[control].state.kneeOrbit??0),values=[...initial];
    // A momentarily clear isolated key need not straighten the knee between two steered neighboring stances.
    for(let i=1;i<values.length-1;i++)if(values[i]===0){
      let a=i-1,b=i+1;while(a>0&&!initial[a])a--;while(b<initial.length-1&&!initial[b])b++;
      if(initial[a]*initial[b]>0)values[i]=initial[a]+(initial[b]-initial[a])*(events[i]-events[a])/(events[b]-events[a]);
    }
    const bands:Band[]=[],samples:Sample[]=[];
    for(let i=0;i<events.length-1;i++){
      const a=programs.get(events[i])!,b=programs.get(events[i+1])!;
      for(const t of [0,.25,.5,.75,...(i===events.length-2?[1]:[])]){
        const phase=t===0?events[i]/motion.clockUnits:t===1?events[i+1]/motion.clockUnits:
          events[i]/motion.clockUnits+(events[i+1]/motion.clockUnits-events[i]/motion.clockUnits)*t;
        const location={action:'pool_exit_0',phase},policy=poolSourcePolicy(source.fixture,location.action,phase);
        if(!policy[limb].required&&!['free','approach'].includes(policy[limb].mode))continue;
        let program=t===0?a:t===1?b:undefined;
        if(!program){
          const pose=poolIntervalPreference(source.bundle,source.neutral.rest,source.neutral.inverse,a.preferenceBasis,b.preferenceBasis,t,true);
          const controls=poolIntervalProgramControls(a,b).map(c=>{
            const {from,to,...chain}=c;let {state}=resolvePoolLimbState(c,t,location);
            if(state.attached)state=source.heldClimbWrist(state.attached.source.limb==='handL'?'handL':'handR',location.action,phase,state);
            return {...chain,state};
          });
          program=makePoolPoseProgram(pose.basis,controls,policy);
        }
        samples.push({i,t,location,program});
      }
    }
    type Fit=Pick<ReturnType<typeof fitPoolKneeOrbit>,'clear'|'angle'|'kneeOrbit'|'allowed'>;
    const memo=new Map<string,Fit>();
    const fit=(sample:typeof samples[number],tangent:number)=>{
      const key=sample.i+':'+sample.t+':'+tangent;
      let result=memo.get(key);
      if(!result){
        const {program,location}=sample,angle=2*Math.atan(tangent);
        try{const r=fitPoolKneeOrbit(source,program,location,limb,angle,program.policy[limb].required?'installed':'free-goal',obstacles);
          result={clear:r.clear,angle:r.angle,kneeOrbit:r.kneeOrbit,allowed:r.allowed};}
        catch(error){if(!(error instanceof PoolTrialRefusal))throw error;result={clear:false,angle,kneeOrbit:tangent,allowed:[]};}
        memo.set(key,result);
      }
      return result;
    };
    const weight=(t:number)=>t===0||t===1?samples.length+1:1;
    const score=(curve:readonly number[])=>samples.reduce((sum,s)=>{
      const h=(1-s.t)*curve[s.i]+s.t*curve[s.i+1],result=fit(s,h);
      return sum+(result.clear&&Math.abs(result.kneeOrbit-h)<1e-12?0:weight(s.t));
    },0);
    let best=[...initial],bestMisses=score(best);
    if(!bestMisses)return;
    for(let iteration=0;iteration<=3;iteration++){
      let added=0;
      let misses=0;
      for(const sample of samples){
        const {i,t}=sample,current=(1-t)*values[i]+t*values[i+1];
        let fitted=fit(sample,current);
        if(fitted.clear&&Math.abs(fitted.kneeOrbit-current)<1e-12)continue;
        misses+=weight(t);
        if(!fitted.clear){
          const baseline=(1-t)*initial[i]+t*initial[i+1];
          const alternative=[...new Set([baseline,initial[i],initial[i+1],0])].map(v=>fit(sample,v)).filter(r=>r.clear)
            .sort((a,b)=>Math.abs(a.kneeOrbit-current)-Math.abs(b.kneeOrbit-current))[0];
          if(!alternative)continue;
          fitted=alternative;
        }
        const range=fitted.allowed.find(([lo,hi])=>fitted.angle>=lo&&fitted.angle<=hi);
        if(!range)throw new Error('The configured knee swivel left its reported angular interval.');
        bands.push({left:i,right:i+1,t,lo:fitted.kneeOrbit>current?fitted.kneeOrbit:Math.tan(range[0]/2),
          hi:fitted.kneeOrbit<current?fitted.kneeOrbit:Math.tan(range[1]/2)});added++;
      }
      if(misses<bestMisses){best=[...values];bestMisses=misses;}
      if(!added||iteration===3)break;
      for(let pass=0;pass<32;pass++){
        let moved=false;
        for(const b of bands){
          const l=1-b.t,r=b.t,value=l*values[b.left]+r*values[b.right],delta=limit(value,b.lo,b.hi)-value;
          if(Math.abs(delta)<1e-7)continue;
          const x=b.left===0?0:l,y=b.right===values.length-1?0:r,den=x*x+y*y;if(!den)continue;
          values[b.left]=limit(values[b.left]+delta*x/den,-1,1);values[b.right]=limit(values[b.right]+delta*y/den,-1,1);moved=true;
        }
        if(!moved)break;
      }
    }
    // A bounded right/left adjustment is useful when a clear endpoint lies on a different
    // angular band from the least-squares solution. Verify both incident edges before keeping it.
    for(let pass=0;bestMisses&&pass<2;pass++){
      const previous=bestMisses;
      for(const s of samples){
        const h=(1-s.t)*best[s.i]+s.t*best[s.i+1],r=fit(s,h);
        if(!r.clear||Math.abs(r.kneeOrbit-h)<1e-12)continue;
        for(const [id,amount] of [[s.i+1,s.t],[s.i,1-s.t]]){
          if(!amount||id===0||id===events.length-1)continue;
          const endpoint=samples.find(sample=>sample.i===id&&sample.t===0);
          if(!endpoint)continue;
          const angle=limit(best[id]+(r.kneeOrbit-h)/amount,-1,1),end=fit(endpoint,angle);
          if(!end.clear)continue;
          const trial=[...best];trial[id]=end.kneeOrbit;
          const misses=score(trial);if(misses<bestMisses){best=trial;bestMisses=misses;break;}
        }
      }
      if(bestMisses===previous)break;
    }
    events.forEach((u,i)=>{
      if(best[i]===initial[i])return;
      const p=programs.get(u)!;
      programs.set(u,makePoolPoseProgram(p.preferenceBasis,p.controls.map((c,k)=>k===control?{...c,state:{...c.state,kneeOrbit:best[i]}}:c),p.policy));
    });
    if(bestMisses&&limb==='footL'&&obstacles.length)clearOuterLip(source,events,samples,best,programs,obstacles[0].solid);
  }
  fitWindow(turn,'footR',[]);fitWindow(turn,'footL',[]);
  const outer=plan.findIndex(k=>k.entryUnit===motion.forwardHop!.launchFromUnit),at=plan[outer]?.unit;
  const approach=at===undefined?undefined:source.fixture.clips.pool_exit_0.samples.find(s=>s.phase===at/motion.clockUnits)?.limbs.footL.interval;
  if(!approach)return;
  const first=plan.findIndex(k=>k.unit===Math.round(approach[0]*motion.clockUnits));
  if(first<2||outer<=first)throw new Error('The outside shin route is missing its approach bounds.');
  const plate=source.fixture.solids.find(s=>s.id===motion.places.crest.surface)!;
  fitWindow(plan.slice(first-2,outer+1).map(k=>k.unit),'footL',[{solid:plate,axis:1,side:-1}]);
}
