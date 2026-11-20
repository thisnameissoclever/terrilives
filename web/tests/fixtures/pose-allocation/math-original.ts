export type Vec3 = readonly [number, number, number];

export function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Blender exports columns; translation occupies elements 12 through 14. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return out;
}

export function transform(m: ArrayLike<number>, v: Vec3): [number, number, number] {
  return [0, 1, 2].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]) as [number, number, number];
}

export function add(a: Vec3, b: Vec3): [number, number, number] { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
export function sub(a: Vec3, b: Vec3): [number, number, number] { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
export function scale(a: Vec3, s: number): [number, number, number] { return [a[0]*s, a[1]*s, a[2]*s]; }
export function dot(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
export function length(a: Vec3): number { return Math.hypot(...a); }
export function unit(a: Vec3): [number, number, number] {
  const size = length(a); if (size < 1e-10) throw new Error('Degenerate bone axis'); return scale(a, 1/size);
}
export function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
export function inverseRigid(m: ArrayLike<number>): number[] {
  const out = identity();
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c*4+r] = m[r*4+c];
  const p = transform(out, [-m[12], -m[13], -m[14]]); out.splice(12, 3, ...p); return out;
}
/** Exported Blender rest bases contain small scale/shear terms; transpose is not their inverse. */
export function inverseAffine(m: ArrayLike<number>): number[] {
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
  const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)throw new Error('Singular bone transform');
  const rows=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const out=identity();for(let row=0;row<3;row++)for(let col=0;col<3;col++)out[col*4+row]=rows[row*3+col]/det;
  out.splice(12,3,...transform(out,[-m[12],-m[13],-m[14]]));return out;
}
export function boneFrame(head: Vec3, tail: Vec3, reference: ArrayLike<number>): number[] {
  const y = unit(sub(tail, head));
  let x = sub([reference[0], reference[1], reference[2]], scale(y, dot([reference[0], reference[1], reference[2]], y)));
  if (length(x) < 1e-6) x = cross(y, Math.abs(y[2]) < .8 ? [0, 0, 1] : [0, 1, 0]);
  x = unit(x); const z = cross(x, y);
  return [...x, 0, ...y, 0, ...z, 0, ...head, 1];
}

/** Solve a two-segment limb without stretching either segment. */
export function solveLimb(start: Vec3, end: Vec3, upper: number, lower: number, pole: Vec3): [number, number, number] {
  const delta = sub(end, start), distance = length(delta);
  if (distance >= upper + lower || distance <= Math.abs(upper - lower) || distance < 1e-8) {
    throw new Error(`Unreachable limb target: distance ${distance.toFixed(5)}, reach ${(upper+lower).toFixed(5)}`);
  }
  const axis = scale(delta, 1/distance);
  const raw = sub(pole, start);
  let projected = sub(raw, scale(axis, dot(raw, axis)));
  if (length(projected) < 1e-8) {
    const reference:Vec3 = Math.abs(axis[1]) < .95 ? [0,-1,0] : [1,0,0];
    projected=sub(reference,scale(axis,dot(reference,axis)));
  }
  const perpendicular=unit(projected);
  const along = (upper*upper-lower*lower+distance*distance)/(2*distance);
  return add(add(start, scale(axis, along)), scale(perpendicular, Math.sqrt(Math.max(0, upper*upper-along*along))));
}
