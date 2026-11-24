import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {poolEntrySearchPlan} from '../src/render/character/pool-entry-search-plan.js';
import {poolRootRayIntervals} from '../src/render/character/pool-entry-domain.js';
import {clonePoolMatrix} from '../src/render/character/pool-matrix-producer.js';
import {translatePoolRoot} from '../src/render/character/pool-canonical-pose.js';
import {solvePoolOrientedFoot,poolLegFrameDiagnostic} from '../src/render/character/pool-oriented-leg.js';
import {interpolatePoolPose,interpolatePoolHierarchy,poolSkinMatrices} from '../src/render/character/pool-contact-sample.js';
import {samplePoolGraph,validatePoolGraph} from '../src/render/character/pool-motion-graph.js';
import {composeSkeletonPose} from '../src/render/character/pose-joints.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {observePool} from '../src/render/character/pool-observer.js';
import {scale} from '../src/render/character/math.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('observes actual graph stored keys against forced intervals and one-sided selected surfaces without admitting red nodes',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const geometry=[selected.body,selected.extra!],compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),geometry,poolFixture);
  const request=poolEntrySearchPlan(.2)[4],domain=compiler.prepareLegDomain(.2,request),interval=poolRootRayIntervals(request.direction,domain.constraints)[0];
  const nodes=[.4375,.5].map(fraction=>{
    const pose={...domain.node,basis:domain.node.basis.map(clonePoolMatrix),world:domain.node.world.map(matrix=>[...matrix])};
    translatePoolRoot(pose,scale(request.direction,interval.maximum*fraction));
    const plans=domain.footContacts.map(contact=>solvePoolOrientedFoot(pose,contact.anatomy.upper,contact.anatomy.lower,contact.anatomy.end,contact.frame!));
    return {pose,plans};
  });
  const controls=domain.footContacts.map((contact,index)=>{
    const endpoint=(node:typeof nodes[number])=>({target:contact.frame!.translation,pole:node.plans[index].pole,orientation:contact.frame!.orientation});
    return {...contact.anatomy,legFrame:'source-entry-0' as const,anchor:[0,0,0,1] as const,from:endpoint(nodes[0]),to:endpoint(nodes[1])};
  });
  const graph={poses:nodes.map(node=>({basis:node.pose.basis})),entry:{keys:[{phase:0,pose:0},{phase:1,pose:1}]},
    paddle:{keys:Array.from({length:13},(_,index)=>({phase:index/12,pose:1}))},bridges:Array.from({length:12},()=>({keys:[{phase:0,pose:1},{phase:1,pose:1}]}))};
  validatePoolGraph(graph);
  const stored=nodes.map(node=>poolSkinMatrices(composeSkeletonPose(poolRig.manifest.bones,node.pose.rest,node.pose.basis),node.pose.inverse));
  const surfaces=(skin:Float32Array<ArrayBuffer>)=>geometry.map((geometry,index)=>({geometry,points:posedCageSurface(geometry,domain.cages[index],skin)}));
  const storedSurfaces=stored.map(surfaces),records=[];
  for(const amount of [0,Number.EPSILON,.5,1-Number.EPSILON,1]){
    const sample=samplePoolGraph(graph,'entry',amount),{pose}=nodes[0],endpoint=amount<=.5?0:1;
    const forced=interpolatePoolPose(pose.bundle,pose.rest,pose.inverse,nodes[0].pose.basis,nodes[1].pose.basis,amount,controls);
    // This is requirePoolPose's exact selected-key branch, before its admission-only binding.
    const sampled=sample.left===sample.right?poolSkinMatrices(composeSkeletonPose(pose.bundle.bones,pose.rest,graph.poses[sample.left].basis),pose.inverse):forced;
    const forcedSurfaces=surfaces(forced),sampledSurfaces=surfaces(sampled),hierarchy=interpolatePoolHierarchy(pose.bundle,pose.rest,pose.inverse,nodes[0].pose.basis,nodes[1].pose.basis,amount,controls);
    const maximum=(left:ArrayLike<number>,right:ArrayLike<number>)=>{let result=0;for(let at=0;at<left.length;at++)result=Math.max(result,Math.abs(left[at]-right[at]));return result;};
    const observation=observePool(poolFixture,sampledSurfaces,domain.source.limbs),forcedObservation=observePool(poolFixture,forcedSurfaces,domain.source.limbs);
    const frame=domain.footContacts.map((contact,index)=>poolLegFrameDiagnostic(hierarchy.basis[contact.anatomy.lower],nodes[0].plans[index].localAxis));
    records.push({amount,sample,endpoint,skinDifferenceFromStored:maximum(forced,stored[endpoint]),sampledSkinDifferenceFromForced:maximum(sampled,forced),
      surfaces:forcedSurfaces.map((surface,index)=>({parts:surface.geometry.description.parts.map(part=>part.name),maximumPointDifferenceFromStored:maximum(surface.points,storedSurfaces[endpoint][index].points),
        maximumSampledPointDifferenceFromForced:maximum(sampledSurfaces[index].points,surface.points)})),frame,observation,forcedObservation});
    if(amount===0||amount===1){expect(sampled).toEqual(stored[endpoint]);expect(forced).toEqual(stored[endpoint]);}
    else expect(sampled).toEqual(forced);
    if(amount!==.5)for(let index=0;index<geometry.length;index++)expect(forcedSurfaces[index].points).toEqual(storedSurfaces[endpoint][index].points);
    expect(observation.violations.length).toBeGreaterThan(0);
  }
  const sharedGraph={...graph,entry:{keys:[{phase:0,pose:0},{phase:.5,pose:1},{phase:1,pose:0}]},
    paddle:{keys:Array.from({length:13},(_,index)=>({phase:index/12,pose:0}))},bridges:Array.from({length:12},()=>({keys:[{phase:0,pose:0},{phase:1,pose:0}]}))};
  validatePoolGraph(sharedGraph);
  const reverse=controls.map(control=>({...control,from:control.to,to:control.from})),sharedRecords=[];
  for(const phase of [.5-Number.EPSILON,.5,.5+Number.EPSILON]){
    const sample=samplePoolGraph(sharedGraph,'entry',phase),{pose}=nodes[0],right=phase>.5;
    const leftForced=interpolatePoolPose(pose.bundle,pose.rest,pose.inverse,nodes[0].pose.basis,nodes[1].pose.basis,phase<.5?phase/.5:1,controls);
    const rightForced=interpolatePoolPose(pose.bundle,pose.rest,pose.inverse,nodes[1].pose.basis,nodes[0].pose.basis,phase>.5?(phase-.5)/.5:0,reverse);
    const actual=sample.left===sample.right?stored[1]:right?rightForced:leftForced;
    const maximum=(left:ArrayLike<number>,right:ArrayLike<number>)=>{let result=0;for(let at=0;at<left.length;at++)result=Math.max(result,Math.abs(left[at]-right[at]));return result;};
    const leftSurfaces=surfaces(leftForced),rightSurfaces=surfaces(rightForced),actualSurfaces=surfaces(actual);
    if(phase===.5){expect(sample.left).toBe(1);expect(sample.right).toBe(1);expect(leftForced).toEqual(stored[1]);expect(rightForced).toEqual(stored[1]);}
    for(let index=0;index<geometry.length;index++){expect(leftSurfaces[index].points).toEqual(storedSurfaces[1][index].points);expect(rightSurfaces[index].points).toEqual(storedSurfaces[1][index].points);}
    sharedRecords.push({phase,sample,leftSkinDifferenceFromShared:maximum(leftForced,stored[1]),rightSkinDifferenceFromShared:maximum(rightForced,stored[1]),
      pointDifferences:actualSurfaces.map((surface,index)=>maximum(surface.points,storedSurfaces[1][index].points)),observation:observePool(poolFixture,actualSurfaces,domain.source.limbs)});
  }
  if(process.env.POOL_ENDPOINT_OUTPUT)writeFileSync(process.env.POOL_ENDPOINT_OUTPUT,JSON.stringify({scope:'Five finite actual graph samples plus three shared A-B-A boundary samples. Physically red nodes remain unbound; stored-key branch is the same compose/skin branch used by requirePoolPose. No endpoint bypass repair or physical admission.',controls,records,sharedRecords},null,2));
},30000);
