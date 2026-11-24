import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import key from '../../assets/models/sims/character-creator/pool_activity_key_v2.json';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {PoolEntryCompiler} from '../src/render/character/pool-entry-compiler.js';
import {derivePoolRailRegion} from '../src/render/character/pool-rail-region.js';
import {poolSurfacePoint} from '../src/render/character/pool-entry-anatomy.js';
import type {Vec3} from '../src/render/character/math.js';
import {poolBase,poolRig,poolFixture} from './pool-observer-fixture.js';

it('records the actual rail premise and the complete producer certified support',()=>{
  const appearance=defaultAppearance('feminine'),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const compiler=new PoolEntryCompiler(poolRig.manifest,shape,anatomicalHeight(poolBase.vertices),[selected.body,selected.extra!],poolFixture);
  const candidates=compiler.compileNodeCandidates(key.phase,{requestId:key.requestId,root:key.rootDelta as unknown as Vec3,trunkPitchDegrees:key.trunk.worldPitchDegrees,headSourcePhase:key.head.sourcePhase});
  expect(candidates).toHaveLength(1);const candidate=candidates[0];expect(candidate.unresolvedViolations).toHaveLength(0);
  const records=candidate.contacts.filter(contact=>contact.limb.startsWith('hand')).map(contact=>{
    const side=contact.limb==='handL'?1:-1,solid=poolFixture.solids.find(solid=>solid.id===contact.surface)!;
    const region=derivePoolRailRegion(poolFixture,contact.surface,[1,5],side),edge=region.edges.find(edge=>contact.parameter!>=edge.fromParameter&&contact.parameter!<=edge.toParameter)!;
    const plane=side*Math.max(...solid.vertices.map(point=>side*point[0])),from=solid.vertices[edge.from],to=solid.vertices[edge.to];
    expect(from[0]).toBe(plane);expect(to[0]).toBe(plane);expect(contact.target[0]).toBe(plane);
    const facets=region.triangles.filter(index=>solid.triangles[index].includes(edge.from)&&solid.triangles[index].includes(edge.to));expect(facets.length).toBeGreaterThan(0);
    const part=selected.body.description.parts.find(part=>part.name===contact.patch.part)!,vertices=[...new Set(selected.body.indices.subarray(part.start,part.start+part.count))];
    const gaps=contact.anatomy.surfaceCoefficients.map((coefficient,index)=>({vertex:vertices[index],homogeneous:coefficient[3],gap:side*(poolSurfacePoint(candidate.pose.world[contact.anatomy.end],coefficient)[0]-plane)}));
    const anchor=contact.patch.vertices.find(vertex=>vertex.coefficient.every((value,index)=>value===contact.anatomy.anchor[index]));expect(anchor).toBeDefined();
    const support=candidate.supports.find(support=>support.patchPart===contact.patch.part)!;expect(support.satisfied).toBe(true);expect(support.arithmeticBound).toBeGreaterThan(0);
    expect(candidate.arithmetic.some(proof=>'method' in proof&&proof.method==='constructive-rail-edge-v1'&&proof.part===contact.patch.part&&proof.surface===contact.surface)).toBe(true);
    return {limb:contact.limb,surface:contact.surface,part:contact.patch.part,bone:contact.anatomy.end,planeAxis:0,planeHeight:plane,side,
      sourceRailVertices:solid.vertices.length,allSourceVerticesInOppositeHalfSpace:solid.vertices.every(point=>side*(point[0]-plane)<=0),
      edge,from,to,allowedIncidentFacets:facets,parameter:contact.parameter,edgeAmount:(contact.parameter!-edge.fromParameter)/(edge.toParameter-edge.fromParameter),
      target:contact.target,orientation:contact.orientation,world:candidate.pose.world[contact.anatomy.end],inverse:candidate.pose.inverse[contact.anatomy.end],
      patchVertices:contact.patch.vertices.map(vertex=>vertex.id),anchorVertex:anchor!.id,palmVertices:vertices.length,positiveHomogeneous:gaps.every(gap=>gap.homogeneous>0),
      rawReferenceMinimumSignedGap:Math.min(...gaps.map(gap=>gap.gap)),rawReferenceExtrema:gaps.sort((a,b)=>a.gap-b.gap).slice(0,8),observedPatchGap:support.minimumGap};
  });
  if(process.env.POOL_RAIL_PREMISE_OUTPUT)writeFileSync(process.env.POOL_RAIL_PREMISE_OUTPUT,JSON.stringify({scope:'Actual rail premise and certified producer support. Raw coefficient/matrix gaps remain diagnostic; the owned constructive proof supplies the contact bound.',key,revisions:poolFixture.revisions,records},null,2));
});
