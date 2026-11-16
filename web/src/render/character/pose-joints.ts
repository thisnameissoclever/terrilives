import type {Bone,Bundle} from './bundle.js';
import {boneFrame,inverseAffine,multiply} from './math.js';
import {sameShape,shapePoint,snapshotShape,type ShapeParameters} from './shape.js';
import {sampleMotion} from './motion.js';

function region(name:string):number {
  if(name==='root'||name==='book'||name.startsWith('prop:'))return 7;
  if(name==='head')return 1;
  if(name.startsWith('foot'))return 6;
  if(/arm|hand/.test(name))return 4;
  if(/hips|thigh|shin/.test(name))return 3;
  return 2;
}

/** Each bone's rest frame relative to its parent's, `inverse(rest[parent]) * rest[i]`; a root keeps its own rest frame. */
function parentLocals(bones:readonly Bone[],rest:readonly (readonly number[])[],inverse:readonly (readonly number[])[]):Float64Array<ArrayBuffer>[] {
  const locals:Float64Array<ArrayBuffer>[]=[];
  for(let i=0;i<bones.length;i++){
    const parent=bones[i].parent;
    if(parent>=i||parent< -1)throw new Error('Skeleton must be in parent-first order');
    locals.push(Float64Array.from(parent<0?rest[i]:multiply(inverse[parent],rest[i])));
  }
  return locals;
}

/*
 * Private copies of `multiply` for composing a pose. The shared helper is
 * called with every kind of array in the renderer, so V8 compiles its element
 * reads generically and boxes each number it reads; these see only the pose
 * path's arrays and stay unboxed. Each element starts at zero and sums its
 * four products in `multiply`'s order, so the results are bit-identical.
 */
const animated=new Float64Array(16),world=new Float64Array(16);
function localTimesBasis(a:Float64Array<ArrayBuffer>,b:readonly number[]):void {
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let sum=0;for(let k=0;k<4;k++)sum+=a[k*4+r]*b[c*4+k];animated[c*4+r]=sum;}
}
function parentTimesAnimated(a:readonly number[]):void {
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let sum=0;for(let k=0;k<4;k++)sum+=a[k*4+r]*animated[c*4+k];world[c*4+r]=sum;}
}
const toRow=(m:Float64Array<ArrayBuffer>):number[]=>[m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],m[8],m[9],m[10],m[11],m[12],m[13],m[14],m[15]];

/**
 * World transforms from parent-relative rest frames and sampled bases. Each
 * returned row is a fresh array, because pose solvers edit them in place.
 */
function composeFromLocals(bones:readonly Bone[],locals:readonly Float64Array<ArrayBuffer>[],basis:readonly number[][]):number[][] {
  const poses:number[][]=[];
  for(let i=0;i<bones.length;i++){
    const parent=bones[i].parent;
    if(parent>=i||parent< -1)throw new Error('Skeleton must be in parent-first order');
    localTimesBasis(locals[i],basis[i]);
    if(parent<0){poses.push(toRow(animated));continue;}
    parentTimesAnimated(poses[parent]);poses.push(toRow(world));
  }
  return poses;
}

export function composeSkeletonPose(bones:readonly Bone[],rest:readonly number[][],basis:readonly number[][]):number[][] {
  return composeFromLocals(bones,parentLocals(bones,rest,rest.map(inverseAffine)),basis);
}

/**
 * The configured skeleton's rest joints depend only on the bundle, the body
 * shape and the anatomical top, never on the animation frame. They are
 * computed once per shape and frozen, so a solver that tried to edit them
 * would throw instead of corrupting the next frame.
 */
type Point=[number,number,number];
interface RestSetup {shape:ShapeParameters;top:number;heads:Point[];tails:Point[];rest:number[][];inverse:number[][];locals:readonly Float64Array<ArrayBuffer>[]}
const restSetups=new WeakMap<Bundle,WeakMap<ShapeParameters,RestSetup>>();
const frozenRows=<T extends number[]>(rows:T[]):T[]=>Object.freeze(rows.map(row=>Object.freeze(row))) as unknown as T[];

function restSetup(bundle:Bundle,a:ShapeParameters,top:number):RestSetup {
  let shapes=restSetups.get(bundle);if(!shapes){shapes=new WeakMap();restSetups.set(bundle,shapes);}
  const saved=shapes.get(a);if(saved&&saved.top===top&&sameShape(saved.shape,a))return saved;
  const bones=bundle.bones;
  const heads=bones.map(b=>shapePoint(b.head,region(b.name),a,top));
  const tails=bones.map(b=>shapePoint(b.tail,b.name.startsWith('shin')?6:region(b.name),a,top));
  const rest=bones.map((b,i)=>boneFrame(heads[i],tails[i],b.rest));
  const inverse=rest.map(inverseAffine);
  const setup:RestSetup={shape:snapshotShape(a),top,heads:frozenRows(heads),tails:frozenRows(tails),rest:frozenRows(rest),inverse:frozenRows(inverse),
    locals:parentLocals(bones,rest,inverse)};
  shapes.set(a,setup);return setup;
}

/**
 * Shared rest joints and sampled source transforms for rendering and contact
 * preparation. `heads`, `tails`, `rest` and `inverse` are shared, frozen rows;
 * `sample`, `source` and `matrices` are fresh for each call.
 */
export function configuredJointSetup(bundle:Bundle,a:ShapeParameters,action:string,frame:number,top:number){
  const sample=sampleMotion(bundle,action,frame),setup=restSetup(bundle,a,top);
  const matrices=composeFromLocals(bundle.bones,setup.locals,sample.basis);
  return {sample,source:sample.source,heads:setup.heads,tails:setup.tails,rest:setup.rest,inverse:setup.inverse,matrices};
}
