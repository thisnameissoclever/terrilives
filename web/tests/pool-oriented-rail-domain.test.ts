import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {poolRootRayIntervals} from '../src/render/character/pool-entry-domain.js';
import {dot,sub,scale,type Vec3} from '../src/render/character/math.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

/** Necessary outer reach only; final anatomical min reach and actual surfaces remain independent. */
function outerIntervals(start:Vec3,direction:Vec3,from:Vec3,to:Vec3,radius:number,range:{minimum:number;maximum:number}){
  const edge=sub(to,from),p=sub(start,from),squared=dot(edge,edge),u0=dot(p,edge)/squared,ud=dot(direction,edge)/squared;
  const cuts=[range.minimum,range.maximum,...(ud===0?[]:[-u0/ud,(1-u0)/ud].filter(value=>value>range.minimum&&value<range.maximum))].sort((a,b)=>a-b),intervals=[];
  for(let index=1;index<cuts.length;index++){
    const minimum=cuts[index-1],maximum=cuts[index],middle=(minimum+maximum)/2,u=u0+ud*middle;
    const offset=u<0?p:u>1?sub(p,edge):sub(p,scale(edge,u0)),velocity=u>=0&&u<=1?sub(direction,scale(edge,ud)):direction;
    const a=dot(velocity,velocity),b=2*dot(offset,velocity),c=dot(offset,offset)-radius*radius;
    if(a===0){if(c<0)intervals.push({minimum,maximum});continue;}
    const discriminant=b*b-4*a*c;if(discriminant<=0)continue;
    const low=Math.max(minimum,(-b-Math.sqrt(discriminant))/(2*a)),high=Math.min(maximum,(-b+Math.sqrt(discriminant))/(2*a));
    if(low<high)intervals.push({minimum:low,maximum:high});
  }
  return {u0,ud,intervals};
}

it('derives necessary root intervals from actual allowed rail segments before another physical candidate',()=>{
  expect(outerIntervals([0,0,0],[1,0,0],[2,-1,0],[2,1,0],.5,{minimum:0,maximum:3}).intervals).toEqual([{minimum:1.5,maximum:2.5}]);
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const records=poolEntrySearchPlan(.2).slice(4,8).map(request=>{
    const domain=compiler.prepareLegDomain(.2,request),ray=poolRootRayIntervals(request.direction,domain.constraints)[0],hands=compiler.railRootDomain(domain);
    return {request,ray,footFrames:domain.footContacts.map(contact=>contact.frame),hands:hands.map(hand=>({...hand,segments:hand.segments.map(segment=>({...segment,
      outerReach:outerIntervals(hand.start,request.direction,segment.from,segment.to,hand.reach.maximum,ray)}))}))};
  });
  if(process.env.POOL_RAIL_DOMAIN_OUTPUT)writeFileSync(process.env.POOL_RAIL_DOMAIN_OUTPUT,JSON.stringify({scope:'Necessary maximum arm reach on actual allowed rail edges, across four declared oriented ray profiles. No hand/leg/full-node/support admission.',records},null,2));
});
