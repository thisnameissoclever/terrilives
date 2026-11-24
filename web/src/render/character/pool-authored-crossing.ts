import type {PoolCycleSource} from './pool-cycle-source.js';
import type {PoolPoseProgram} from './pool-pose-program.js';
import type {PoolCrestLanding,PoolCrossingPrograms} from './pool-route-assembler.js';
import type {NumericBody} from './pool-numeric-recipe.js';
import type {SelectedPoolKnot} from './pool-selected-cycle.js';
import {PoolTrialRefusal,type PoolTrialWork} from './pool-trial-work.js';
import {canonicalPoolValue} from './pool-contact-identity.js';

export interface AuthoredPoolCrossing {
  model:string;
  body:{presentation:'masculine'|'feminine';height:number;build:number;hips:number;shoulders:number;torso:number};
  entry:readonly SelectedPoolKnot[];
  withdrawalBody:NumericBody;
}

function numerics(program:PoolPoseProgram){
  return {basis:program.preferenceBasis,controls:program.controls.map(c=>{
    const s=c.state,g=s.attached;
    return {upper:c.upper,lower:c.lower,end:c.end,anchor:c.anchor,legFrame:c.legFrame??null,target:s.target,
      orientation:s.orientation,pole:s.pole,grasp:g?{surface:g.geometry.surface,parameter:g.parameter,
        rawOrientation:g.rawOrientation,activeVertex:g.activeVertex}:null};
  })};
}

/** Rebuild a measured crossing from numerical author inputs, using this appearance and its real contact owners. */
export function authoredPoolCrossing(source:PoolCycleSource,landing:PoolCrestLanding,units:readonly number[],
  work:PoolTrialWork,authored:AuthoredPoolCrossing):PoolCrossingPrograms {
  const shape=authored.body;
  if(source.fixture.revisions.model!==authored.model||shape.presentation!==source.shape.presentation||
     (['height','build','hips','shoulders','torso'] as const).some(k=>shape[k]!==source.shape[k]))
    throw new PoolTrialRefusal('This appearance and pool model require their own selected crest controls.');
  const authoredUnits=authored.entry.map(k=>k.unit);
  if(authoredUnits[0]!==42000||authoredUnits.at(-1)!==62380||authoredUnits.some((u,i)=>!Number.isSafeInteger(u)||i>0&&u<=authoredUnits[i-1]))
    throw new Error('Authored pool crossing has an incomplete source clock.');
  if(source.definition.version!==16||source.definition.crestRoute.sampleUnits.some(u=>
    u>=42000&&u<=62380&&!authoredUnits.includes(u)))
    throw new Error('The authored pool crossing omits a required motion knot.');
  const programs=new Map<number,PoolPoseProgram>();
  for(const knot of authored.entry){
    work.reserve('bind authored pool crossing knot',{expansions:1});
    const program=source.materializeSelectedKnot(knot);
    if(knot.unit===42000){
      if(canonicalPoolValue(numerics(program))!==canonicalPoolValue(numerics(landing.program)))
        throw new PoolTrialRefusal('Authored crossing and selected exterior have different crest landing controls.');
      programs.set(knot.unit,landing.program);
    }else programs.set(knot.unit,program);
  }
  for(const unit of units){
    if(programs.has(unit))continue;
    const i=authoredUnits.findIndex(u=>u>unit);
    if(i<1)throw new Error('Requested crossing key is outside the authored interval.');
    const before=authoredUnits[i-1],after=authoredUnits[i];
    work.reserve('split authored pool crossing interval',{expansions:1});
    programs.set(unit,source.splitSelectedEntry(programs.get(before)!,programs.get(after)!,before,after,unit));
  }
  return {withdrawalBody:authored.withdrawalBody,at(unit){
    const program=programs.get(unit);if(!program)throw new Error('Missing selected pool crossing program at '+unit);return program;
  }};
}
