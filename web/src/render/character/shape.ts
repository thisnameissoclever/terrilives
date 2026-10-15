import type { Vec3 } from './math.js';
import { shapeHead, type FaceParameters } from './head-shape.js';

export interface ShapeParameters {
  presentation:'masculine'|'feminine';height:number;build:number;
  shoulders?:number;hips?:number;torso?:number;face?:FaceParameters;
}

/** The authored torso range preserves the fixed furniture's usable leg proportions. */
export const TORSO_PROPORTION_SHIFT = .05;

function range(value: number, low: number, high: number): number {
  return value <= 50 ? low + (1 - low) * value / 50 : 1 + (high - 1) * (value - 50) / 50;
}

/** Physical rest-space shape changes. The two halves meet at the neutral model. */
export function shapePoint(p: Vec3, region: number, a: ShapeParameters, neutralTop = 2.1): [number, number, number] {
  let [x, y, z] = p;
  if (region === 7 || region >= 10) return [x, y, z];
  const feminine = a.presentation === 'feminine';
  const torso = range(a.build, .85, 1.4);
  const shoulders = range(a.shoulders??a.build,.85,1.4);
  const hipGarment = range(a.hips??a.build,.85,1.4);
  const depth = range(a.build, .8, 1.5);
  const hips = range(a.hips??a.build, .9, 1.3) * (feminine ? 1.1 : 1);
  const limb = range(a.build, .9, 1.25);
  const shift = neutralTop * (.85 + a.height * .003 - 1);
  if (region === 1 || region === 8 || region === 9) {
    if (region === 1 && feminine) x *= 1 - .06 * Math.max(0, Math.min(1, (1.78 - z) / .3));
    [x,y,z]=shapeHead([x,y,z],region,a.face);
    return [x, y, z + shift];
  }
  if (region === 2) {
    const waist = feminine ? 1 - .09 * Math.exp(-(((z - 1.1) / .13) ** 2)) : 1;
    const smooth=(n:number)=>{const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};
    const shoulderWeight=smooth((z-1.10)/.20),hipWeight=1-smooth((z-.94)/.15);
    const width=torso+(shoulders-torso)*shoulderWeight+(hipGarment-torso)*hipWeight;
    x *= width * waist * (feminine ? .94 : 1); y *= depth;
    if (feminine && y < 0) y -= .018 * Math.exp(-(((z - 1.28) / .09) ** 2));
  } else if (region === 4) {
    const side = x < 0 ? -1 : 1;
    const center = side * (.32 - .09 * Math.max(0, Math.min(1, (z - .81) / .49)));
    x = center + side * .23 * (shoulders * (feminine ? .94 : 1) - 1) + (x - center) * limb;
    y *= limb;
  } else if (region === 3 || region === 6) {
    const center = Math.max(-.124, Math.min(.124, x));
    const legX = center * hips + (x - center) * (region === 6 ? 1 : limb);
    const t = region === 6 ? 0 : Math.max(0, Math.min(1, (z - .70) / .20));
    const blend = t*t*(3-2*t);
    x = legX * (1-blend) + x * hips * blend;
    if (region !== 6) y *= limb * (1-blend) + depth * blend;
  }
  if(region!==6&&a.torso!==undefined&&a.torso!==50){
    const sample=region===4?1.30:z;
    const weight=Math.max(0,Math.min(1,sample<=.86?(sample-.13)/.73:(1.4-sample)/.54));
    z-=(a.torso-50)/50*TORSO_PROPORTION_SHIFT*weight;
  }
  if (region !== 6) z = z <= .13 ? z : z < 1.4 ? z + shift * (z - .13) / 1.27 : z + shift;
  return [x, y, z];
}

/** Hair is an accessory and never changes the body's anatomical height reference. */
export function anatomicalHeight(vertices: Float32Array<ArrayBuffer>): number {
  let top = 0;
  for (let i=0;i<vertices.length;i+=16) if (vertices[i+15] === 1) top=Math.max(top,vertices[i+2]);
  if (!(top > 1)) throw new Error('Character has no anatomical head reference');
  return top;
}

/** Deform positions and differential normals once per appearance edit, never per frame. */
export function shapeVertices(source: Float32Array<ArrayBuffer>, a: ShapeParameters, top: number): Float32Array<ArrayBuffer> {
  const out = source.slice();
  for (let i = 0; i < source.length; i += 16) {
    const p: Vec3 = [source[i], source[i + 1], source[i + 2]], region = source[i + 15];
    const q = shapePoint(p, region, a, top); out.set(q, i);
    const n = [source[i + 3], source[i + 4], source[i + 5]];
    const axis = Math.abs(n[2]) < .8 ? [0, 0, 1] : [0, 1, 0];
    const cross = (u: number[], v: number[]) => [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const t = cross(axis, n), b = cross(n, t), eps = .0001;
    const qt = shapePoint([p[0]+t[0]*eps, p[1]+t[1]*eps, p[2]+t[2]*eps], region, a, top);
    const qb = shapePoint([p[0]+b[0]*eps, p[1]+b[1]*eps, p[2]+b[2]*eps], region, a, top);
    const normal = cross(qt.map((v, j) => v-q[j]), qb.map((v, j) => v-q[j]));
    const len = Math.hypot(...normal);
    if (len > 1e-12) out.set(normal.map(v => v / len), i + 3);
  }
  return out;
}
