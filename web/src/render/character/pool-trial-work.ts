import type {PoolPoseProgram} from './pool-pose-program.js';
import type {PoolReplayJob} from './pool-replay-schedule.js';

export interface PoolTrialLimits {captures:number;expansions:number;observations:number;reverseComparisons:number;milliseconds:number}
type Charge=Partial<Omit<PoolTrialLimits,'milliseconds'>>;
const categories=['captures','expansions','observations','reverseComparisons'] as const;

/** Expected physical incompatibility only. Input, arithmetic, publication and callback failures are fatal. */
export class PoolTrialRefusal extends Error {}
export class PoolTrialStopped extends Error {
  constructor(readonly outcome:'cancelled'|'exhausted',stage:string,details:unknown){
    super('Pool preparation '+outcome+' before '+stage,{cause:details});
  }
}

export class PoolTrialWork {
  private readonly started:number;
  private readonly used={captures:0,expansions:0,observations:0,reverseComparisons:0};
  private readonly limits:Readonly<PoolTrialLimits>;
  constructor(limits:PoolTrialLimits,private readonly signal?:AbortSignal,private readonly now=()=>performance.now()){
    if([...categories,'milliseconds' as const].some(k=>!Number.isSafeInteger(limits[k])||limits[k]<0))throw new Error('Invalid pool preparation budget.');
    this.limits=Object.freeze({...limits});this.started=now();
  }
  snapshot(){return {...this.used,milliseconds:this.now()-this.started};}
  reserve(stage:string,charges:Charge={}):void {
    if(Object.keys(charges).some(k=>!categories.includes(k as typeof categories[number])))throw new Error('Unknown pool budget reservation category.');
    const consumed=this.snapshot();
    const details={consumed,requested:{...charges},limits:this.limits};
    if(this.signal?.aborted)throw new PoolTrialStopped('cancelled',stage,details);
    if(!Number.isFinite(consumed.milliseconds)||consumed.milliseconds<0)throw new Error('Invalid pool preparation clock.');
    let over=consumed.milliseconds>=this.limits.milliseconds;
    for(const key of categories){
      const n=charges[key]??0;
      if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid pool preparation reservation.');
      if(n>this.limits[key]-this.used[key])over=true;
    }
    if(over)throw new PoolTrialStopped('exhausted',stage,details);
    for(const key of categories)this.used[key]+=charges[key]??0;
  }
}

interface Stamp {
  readonly issuer:PoolTrialReceipts;readonly owner:object;readonly job:PoolReplayJob;readonly left:PoolPoseProgram;readonly right:PoolPoseProgram;
}
const issuers=new WeakMap<object,Stamp>();
export class PoolTrialReceipts {
  private live=true;
  constructor(private readonly owner:object){}
  revoke():void {this.live=false;}
  issue<T extends object>(observation:T,job:PoolReplayJob,left:PoolPoseProgram,right:PoolPoseProgram):T {
    if(!this.live)throw new Error('Pool receipt owner has been disposed.');
    if(issuers.has(observation))throw new Error('Pool observation already has a live replay issuer.');
    issuers.set(observation,{issuer:this,owner:this.owner,job,left,right});
    return observation;
  }
  require(observation:object,job:PoolReplayJob,left:PoolPoseProgram,right:PoolPoseProgram):void {
    const s=issuers.get(observation);
    if(!this.live)throw new Error('Pool receipt owner has been disposed.');
    if(s?.issuer!==this||s.owner!==this.owner||s.job!==job||s.job.kind!==job.kind||s.job.id!==job.id||s.job.action!==job.action||
      s.job.phase!==job.phase||s.job.fraction!==job.fraction||s.left!==left||s.right!==right)
      throw new Error('Pool observation belongs to a different owner, scheduled operation or ordered program pair.');
  }
}
