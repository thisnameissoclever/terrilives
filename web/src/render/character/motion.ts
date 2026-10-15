import type { Bundle } from './bundle.js';
import { identity, inverseAffine, multiply } from './math.js';

function quaternion(m: readonly number[]): number[] {
  const trace=m[0]+m[5]+m[10];
  if(trace>0){const s=Math.sqrt(trace+1)*2;return [(m[6]-m[9])/s,(m[8]-m[2])/s,(m[1]-m[4])/s,s/4];}
  if(m[0]>m[5]&&m[0]>m[10]){const s=Math.sqrt(1+m[0]-m[5]-m[10])*2;return [s/4,(m[4]+m[1])/s,(m[8]+m[2])/s,(m[6]-m[9])/s];}
  if(m[5]>m[10]){const s=Math.sqrt(1+m[5]-m[0]-m[10])*2;return [(m[4]+m[1])/s,s/4,(m[9]+m[6])/s,(m[8]-m[2])/s];}
  const s=Math.sqrt(1+m[10]-m[0]-m[5])*2;return [(m[8]+m[2])/s,(m[9]+m[6])/s,s/4,(m[1]-m[4])/s];
}

/** Interpolate rotations on the unit sphere; matrix averaging would shorten limbs. */
export function interpolateTransform(a: readonly number[], b: readonly number[], t: number): number[] {
  if(t===0)return [...a];if(t===1)return [...b];
  const qa=quaternion(a),qb=quaternion(b);
  let dot=qa.reduce((sum,v,i)=>sum+v*qb[i],0);
  if(dot<0){for(let i=0;i<4;i++)qb[i]*=-1;dot=-dot;}
  dot=Math.min(1,Math.max(-1,dot));
  const theta=Math.acos(dot),sine=Math.sin(theta);
  const left=sine<.001?1-t:Math.sin((1-t)*theta)/sine;
  const right=sine<.001?t:Math.sin(t*theta)/sine;
  const q=qa.map((v,i)=>v*left+qb[i]*right),size=Math.hypot(...q);
  const [x,y,z,w]=q.map(v=>v/size);
  const out=[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,
    2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,
    2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,
    a[12]*(1-t)+b[12]*t,a[13]*(1-t)+b[13]*t,a[14]*(1-t)+b[14]*t,1];
  return out;
}

/** Object tracks can carry scale, such as a mop shaft whose length changes. */
export function interpolateAffine(a: readonly number[], b: readonly number[], t: number): number[] {
  if (t === 0) return [...a]; if (t === 1) return [...b];
  const left = [...a], right = [...b], sizes: number[] = [];
  for (let c = 0; c < 3; c++) {
    const la = Math.hypot(a[c*4], a[c*4+1], a[c*4+2]), lb = Math.hypot(b[c*4], b[c*4+1], b[c*4+2]);
    if (la < 1e-9 || lb < 1e-9) throw new Error('Degenerate prop transform.');
    sizes.push(la*(1-t)+lb*t);
    for (let r = 0; r < 3; r++) { left[c*4+r] /= la; right[c*4+r] /= lb; }
  }
  const out = interpolateTransform(left, right, t);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c*4+r] *= sizes[c];
  return out;
}

export function clipSample(count: number, frame: number, playback: 'loop'|'progress'|'static' = 'loop'): { index: number; next: number; t: number } {
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(frame) || frame < 0) throw new Error('Invalid clip sample.');
  const phase = playback === 'static' ? 0 : playback === 'progress' ? Math.min(frame, count-1) : frame % count;
  const index = Math.floor(phase), next = playback === 'loop' ? (index+1)%count : Math.min(index+1,count-1);
  return { index, next, t: phase-index };
}

export const TRANSITION_FRAMES=24;
export const isTransition=(action:string):boolean=>action==='sit_down'||action==='stand_up';
export const hasChair=(action:string):boolean=>isTransition(action)||['read','sit','standing_read'].includes(action);
export const hasBook=(action:string):boolean=>isTransition(action)||['read','stand_read','standing_read'].includes(action);

export function sampleMotion(bundle:Bundle,action:string,frame:number):{basis:number[][];source:number[][];seat:number;grip:number[][]} {
  if(!Number.isFinite(frame)||frame<0)throw new Error('Unknown character pose');
  if(bundle.clipMetadata?.[action]?.stepSamples)frame=Math.floor(frame);
  const custom=isTransition(action)||action==='standing_read';
  let basis:number[][],source:number[][],seat=action==='read'||action==='sit'?1:0;
  if(custom){
    let t=action==='standing_read'?0:Math.min(1,frame/TRANSITION_FRAMES);
    if(action==='stand_up')t=1-t;
    seat=t*t*(3-2*t);
    if(seat===1)return {basis:bundle.basisActions.read[0],source:bundle.actions.read[0],seat,grip:bundle.actions.read[0]};
    const standing=bundle.basisActions.stand_read[0].map(m=>[...m]);
    const root=bundle.bones.findIndex(b=>b.name==='root');
    const standingWorld=multiply(bundle.bones[root].rest,standing[root]);
    standingWorld[13]-=.355;
    standing[root]=multiply(inverseAffine(bundle.bones[root].rest),standingWorld);
    basis=standing.map((m,i)=>interpolateTransform(m,bundle.basisActions.read[0][i],seat));
    source=compose(bundle,basis);
    for(let i=0;i<bundle.bones.length;i++)if(bundle.bones[i].name.startsWith('foot'))source[i]=[...bundle.actions.read[0][i]];
  }else{
    const frames=bundle.actions[action],local=bundle.basisActions[action];
    if(!frames?.length||!local?.length)throw new Error('Unknown character pose');
    const {index,next,t}=clipSample(frames.length,frame,bundle.clipMetadata?.[action]?.playback);
    basis=local[index].map((m,i)=>interpolateTransform(m,local[next][i],t));
    source=frames[index].map((m,i)=>(i<17?interpolateTransform:interpolateAffine)(m,frames[next][i],t));
  }
  return {basis,source,seat,grip:custom?bundle.actions.read[0]:source};
}

function compose(bundle:Bundle,basis:readonly number[][]):number[][] {
  const poses:number[][]=[];
  for(let i=0;i<bundle.bones.length;i++){
    const bone=bundle.bones[i],parent=bone.parent;
    const local=parent<0?bone.rest:multiply(inverseAffine(bundle.bones[parent].rest),bone.rest);
    poses.push(multiply(parent<0?identity():poses[parent],multiply(local,basis[i])));
  }
  return poses;
}
