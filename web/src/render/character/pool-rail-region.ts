import type {PoolFixtureV1} from './pool-contact-types.js';

export interface PoolRailEdge {readonly from:number;readonly to:number;readonly fromParameter:number;readonly toParameter:number}
export interface PoolRailRegion {readonly surface:string;readonly triangles:readonly number[];readonly edges:readonly PoolRailEdge[]}

/** Resolve the evaluated tube's authored interval once in the preparation worker. */
export function derivePoolRailRegion(fixture:PoolFixtureV1,surface:string,parameter:readonly [number,number],innerSide:1|-1):PoolRailRegion {
  const solid=fixture.solids.find(s=>s.id===surface),rail=fixture.rails.find(r=>r.id===surface);
  if(!solid||!rail||rail.points.length<2)throw new Error('Missing authored pool handrail.');
  const adjacent=new Map<number,number[]>();
  solid.triangles.forEach((triangle,index)=>triangle.forEach(vertex=>{
    const list=adjacent.get(vertex);if(list)list.push(index);else adjacent.set(vertex,[index]);
  }));
  const faces=new Set<number>(),capVertices=new Set<number>(),pending=[0];
  while(pending.length){const face=pending.pop()!;if(faces.has(face))continue;faces.add(face);
    for(const vertex of solid.triangles[face]){capVertices.add(vertex);pending.push(...adjacent.get(vertex)!);}
  }
  const profile=capVertices.size,capFaces=profile-2,ringCount=solid.vertices.length/profile-2;
  const steps=(ringCount-1)/(rail.points.length-1),sideStart=2*capFaces;
  if(profile<3||profile>128||faces.size!==capFaces||!Number.isInteger(ringCount)||!Number.isInteger(steps)||steps<1
      ||[...capVertices].some(vertex=>vertex<0||vertex>=profile)
      ||solid.triangles.length!==sideStart+(ringCount-1)*profile*2)throw new Error('Pool handrail evaluated tube topology changed.');
  const base=(ring:number)=>(ring+2)*profile;
  const equalSet=(actual:readonly number[],expected:readonly number[])=>actual.length===expected.length&&actual.every(v=>expected.includes(v));
  for(let ring=0;ring<ringCount-1;ring++)for(let segment=0;segment<profile;segment++){
    const previous=(segment+profile-1)%profile,index=sideStart+(ring*profile+segment)*2;
    if(!equalSet(solid.triangles[index],[base(ring)+segment,base(ring+1)+segment,base(ring+1)+previous])
        ||!equalSet(solid.triangles[index+1],[base(ring)+segment,base(ring+1)+previous,base(ring)+previous]))
      throw new Error('Pool handrail face is outside its evaluated ring pair.');
  }
  const extreme=(ring:number,side:1|-1)=>{
    let chosen=base(ring);
    for(let i=1;i<profile;i++){const candidate=base(ring)+i;if(side*solid.vertices[candidate][0]>side*solid.vertices[chosen][0])chosen=candidate;}
    return chosen;
  };
  rail.points.forEach((point,index)=>{
    const a=solid.vertices[extreme(index*steps,1)],b=solid.vertices[extreme(index*steps,-1)];
    if(point.point.some((value,axis)=>(a[axis]+b[axis])/2!==value))throw new Error('Pool handrail mesh and authored controls differ.');
  });
  const first=parameter[0]*steps,last=parameter[1]*steps;
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<0||last>=ringCount||last<=first)throw new Error('Invalid authored pool handrail interval.');
  const triangles=Array.from({length:(last-first)*profile*2},(_,index)=>sideStart+first*profile*2+index);
  const edges=Array.from({length:last-first},(_,index)=>{
    const ring=first+index,from=extreme(ring,innerSide),to=extreme(ring+1,innerSide);
    if(!solid.triangles.slice(sideStart+ring*profile*2,sideStart+(ring+1)*profile*2).some(triangle=>triangle.includes(from)&&triangle.includes(to)))
      throw new Error('Pool handrail inner path is not an actual mesh edge.');
    return Object.freeze({from,to,fromParameter:ring/steps,toParameter:(ring+1)/steps});
  });
  return Object.freeze({surface,triangles:Object.freeze(triangles),edges:Object.freeze(edges)});
}
