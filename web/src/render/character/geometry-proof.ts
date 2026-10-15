import type { Geometry } from './bundle.js';
import { shapeVertices,type ShapeParameters } from './shape.js';
import { configuredPoseForProof as configuredPose } from './pose.js';
import { evaluateSurface } from './surface.js';

/** CPU witness for physical tests; the browser independently applies these matrices in WGSL. */
export function posedPositions(geometry: Geometry, appearance: ShapeParameters, action: string, frame: number, top: number): Float32Array<ArrayBuffer> {
  const vertices = shapeVertices(geometry.cage, appearance, top);
  const bones = configuredPose(geometry.manifest, appearance, action, frame, top,undefined,geometry);
  return posedCageSurface(geometry,vertices,bones);
}

/** The production cover samples an already configured cage with the same Float32 arithmetic. */
export function posedCageSurface(geometry:Geometry,vertices:Float32Array<ArrayBuffer>,bones:Float32Array<ArrayBuffer>):Float32Array<ArrayBuffer> {
  const out = new Float32Array(vertices.length / 16 * 3);
  for (let i = 0, j = 0; i < vertices.length; i += 16, j += 3) {
    if (vertices[i + 15] === 10) { out.set(vertices.subarray(i, i + 3), j); continue; }
    for (let influence = 0; influence < 4; influence++) {
      const b = vertices[i + 6 + influence] * 16, w = vertices[i + 10 + influence];
      for (let r = 0; r < 3; r++) out[j+r] += w * (bones[b+r]*vertices[i] + bones[b+4+r]*vertices[i+1] + bones[b+8+r]*vertices[i+2] + bones[b+12+r]);
    }
  }
  return evaluateSurface(geometry,out);
}
