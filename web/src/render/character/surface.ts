import type { Geometry } from './bundle.js';

/** Apply the exported subdivision operator after the cage has been deformed and skinned. */
export function evaluateSurface(geometry: Geometry, cagePositions: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const out=new Float32Array(geometry.description.vertexCount*3);
  const indices=new Uint32Array(geometry.stencilWeights),weights=new Float32Array(geometry.stencilWeights);
  for(let vertex=0;vertex<geometry.description.vertexCount;vertex++) {
    const start=geometry.stencilRanges[vertex*4],count=geometry.stencilRanges[vertex*4+1];
    for(let k=start;k<start+count;k++) {
      const source=indices[k*2]*3,weight=weights[k*2+1];
      for(let axis=0;axis<3;axis++)out[vertex*3+axis]+=cagePositions[source+axis]*weight;
    }
  }
  return out;
}
