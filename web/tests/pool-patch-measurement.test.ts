import {writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {cross,dot,length,scale,sub,type Vec3} from '../src/render/character/math.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';
import {poolSelectedVertices} from '../src/render/character/pool-surface-coefficient.js';

it.skipIf(!process.env.POOL_PATCH_OUTPUT)('measures rigid selected skin facets before choosing physical patches',()=>{
  const appearance=defaultAppearance('feminine'),body=new PreparedBody(poolBase,appearance);
  const geometry=body.select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,
    includeFixture:false,clip:'pool_enter',swimwear:'two_piece'}).body;
  const top=anatomicalHeight(poolBase.vertices),shape={presentation:appearance.presentation,...appearance.body,face:appearance.face};
  const cage=shapeVertices(geometry.cage,shape,top),matrices=new Float32Array(geometry.manifest.bones.length*16);
  for(let i=0;i<geometry.manifest.bones.length;i++)for(const offset of [0,5,10,15])matrices[i*16+offset]=1;
  const points=posedCageSurface(geometry,cage,matrices),indices=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights);
  const selectedVertices=poolSelectedVertices(geometry);
  const point=(id:number):Vec3=>[points[id*3],points[id*3+1],points[id*3+2]],records=[];
  for(const name of ['foot.L','foot.R','hand.L','hand.R']){
    const bone=geometry.manifest.bones.findIndex(b=>b.name===name),owned=new Set<number>();
    for(const vertex of selectedVertices){
      const offset=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];let total=0,foreign=false;
      for(let s=offset;s<offset+count;s++)for(let slot=0;slot<4;slot++){
        const source=indices[s*2]*16,w=weights[s*2+1]*cage[source+10+slot];
        if(w===0)continue;
        if(cage[source+6+slot]!==bone)foreign=true;else total+=w;
      }
      if(!foreign&&total>0)owned.add(vertex);
    }
    const vertices=[...owned],facets=[];
    for(const part of geometry.description.parts)for(let at=part.start;at<part.start+part.count;at+=3){
      const ids=Array.from(geometry.indices.subarray(at,at+3));if(!ids.every(id=>owned.has(id)))continue;
      const a=point(ids[0]),normal=cross(sub(point(ids[1]),a),sub(point(ids[2]),a)),area=length(normal)/2;
      if(area===0)continue;
      let n=scale(normal,1/(2*area));if(n[2]<0)n=scale(n,-1);
      const distances=vertices.map(id=>dot(n,sub(point(id),a))),minimum=Math.min(...distances),maximum=Math.max(...distances);
      facets.push({triangle:at/3,vertices:ids,area,normal:n,minimum,maximum,center:scale(ids.map(point).reduce((sum,p)=>[sum[0]+p[0],sum[1]+p[1],sum[2]+p[2]] as Vec3,[0,0,0] as Vec3),1/3)});
    }
    const bounds=[0,1,2].map(axis=>[Math.min(...vertices.map(id=>point(id)[axis])),Math.max(...vertices.map(id=>point(id)[axis]))]);
    const palmParts=geometry.description.parts.filter(part=>part.name.startsWith('Relaxed palm'));
    const eligible=name.startsWith('foot')?owned:new Set(palmParts.flatMap(part=>Array.from(geometry.indices.subarray(part.start,part.start+part.count))).filter(id=>owned.has(id)));
    const supportAxis=name.startsWith('foot')?2:1,minimum=Math.min(...[...eligible].map(id=>point(id)[supportAxis]));
    const candidates=[...eligible].filter(id=>point(id)[supportAxis]===minimum),center=scale(candidates.map(point).reduce((sum,p)=>[sum[0]+p[0],sum[1]+p[1],sum[2]+p[2]] as Vec3,[0,0,0] as Vec3),1/candidates.length);
    const anchor=candidates.sort((a,b)=>length(sub(point(a),center))-length(sub(point(b),center))||a-b)[0];
    const patch=facets.filter(f=>f.vertices.includes(anchor)),patchVertices=[...new Set(patch.flatMap(f=>f.vertices))];
    const patchArea=patch.reduce((sum,f)=>sum+f.area*Math.abs(f.normal[supportAxis]),0);
    const partNames=geometry.description.parts.filter(part=>Array.from(geometry.indices.subarray(part.start,part.start+part.count)).some(id=>owned.has(id))).map(part=>part.name);
    const forefoot=patch.filter(f=>f.vertices.every(id=>point(id)[1]<=point(anchor)[1]));
    records.push({name,partNames,vertices:vertices.length,facets:facets.length,bounds,
      forefootTriangles:name.startsWith('foot')?forefoot.map(f=>f.triangle):[],
      extremeOneRing:{supportAxis,anchor,anchorPoint:point(anchor),vertices:patchVertices,triangles:patch.map(f=>f.triangle),
        projectedArea:patchArea,maximumSourceGap:Math.max(...patchVertices.map(id=>point(id)[supportAxis]-minimum)),
        bounds:[0,1,2].map(axis=>[Math.min(...patchVertices.map(id=>point(id)[axis])),Math.max(...patchVertices.map(id=>point(id)[axis]))])},
      lowestFacets:facets.sort((a,b)=>a.center[2]-b.center[2]).slice(0,20)});
    expect(vertices.length).toBeGreaterThan(3);expect(facets.length).toBeGreaterThan(0);
  }
  writeFileSync(process.env.POOL_PATCH_OUTPUT!,JSON.stringify({source:'selected skin after configured shape and subdivision',appearance,parts:geometry.description.parts.map(part=>part.name),records},null,2));
});
