import type { Bundle, Geometry } from './bundle.js';
import { add, boneFrame, inverseAffine, length, multiply, scale, solveLimb, sub, transform, type Vec3 } from './math.js';
import { type ShapeParameters } from './shape.js';
import { hasBook, isTransition } from './motion.js';
import {solveInteraction} from './interaction-pose.js';
import type {PoseDiagnostics} from './contact-types.js';
import {configuredJointSetup} from './pose-joints.js';
import {fitBike} from './bike-fit.js';
import {requireBikeContact,sampleBikeContact} from './bike-contact-sample.js';
import type {BikeContactArtifactV1,BikeFitResolver} from './bike-contact-types.js';
import type {SleepContactArtifactV1} from './sleep-contact-types.js';
import {requireSleepPose} from './sleep-contact-sample.js';
export {composeSkeletonPose} from './pose-joints.js';

/** Production pose sampling never constructs a contact fit. */
export function configuredPose(bundle:Bundle,a:ShapeParameters,action:string,frame:number,top:number,audit?:PoseDiagnostics,geometry?:Geometry,bikeContact?:BikeContactArtifactV1,sleepContact?:SleepContactArtifactV1):Float32Array<ArrayBuffer> {
  if(action==='bed_sleep'||action==='bunk_sleep'){
    if(!Number.isFinite(frame)||frame<0)throw new Error('Unknown character pose');
    if(audit){audit.contacts=[];audit.assemblies={};}
    if(!geometry)throw new Error('Sleeping support requires selected geometry.');
    return requireSleepPose(sleepContact,geometry,a,top,action);
  }
  const resolve:BikeFitResolver=(geometry,shape,top,_rest,_pose,_source,_dimensions,_lengths,angle)=>sampleBikeContact(requireBikeContact(bikeContact,geometry,shape,top),angle);
  return configuredPoseWithBike(bundle,a,action,frame,top,audit,geometry,resolve);
}

/** CPU asset and contact tests opt into synchronous construction explicitly. */
export function configuredPoseForProof(bundle:Bundle,a:ShapeParameters,action:string,frame:number,top:number,audit?:PoseDiagnostics,geometry?:Geometry):Float32Array<ArrayBuffer> {
  return configuredPoseWithBike(bundle,a,action,frame,top,audit,geometry,fitBike);
}

function configuredPoseWithBike(bundle: Bundle, a: ShapeParameters, action: string, frame: number, top: number, audit:PoseDiagnostics|undefined, geometry:Geometry|undefined, bikeFit:BikeFitResolver): Float32Array<ArrayBuffer> {
  if(audit){audit.contacts=[];audit.assemblies={};}
  const {sample,source,heads,tails,rest,inverse,matrices}=configuredJointSetup(bundle,a,action,frame,top);
  const clip = bundle.clipMetadata?.[action];
  const bones = bundle.bones, index = (name: string) => {
    const found = bones.findIndex(b => b.name === name); if (found < 0) throw new Error(`Missing bone ${name}`); return found;
  };
  const result = new Float32Array(bones.length * 16);
  if(clip)return solveInteraction({bundle,appearance:a,action,frame,top,source,rest,matrices,audit,geometry,bikeFit});
  const positions = matrices.map(m=>[m[12],m[13],m[14]] as [number,number,number]);
  // The authored foot path is a physical ground/contact target, not a scaled pose translation.
  for(let i=0;i<bones.length;i++) if(bones[i].name.startsWith('foot')) {
    positions[i]=[heads[i][0]+source[i][12]-bones[i].head[0],source[i][13],source[i][14]];
    matrices[i]=[...source[i]]; matrices[i].splice(12,3,...positions[i]);
  }
  const hip = index('hips');
  const bodyScale = 1 + top * (.85 + a.height*.003 - 1) / 1.27;
  const seated = sample.seat > 0;
  const transition = isTransition(action) || action === 'standing_read';
  const upperLeg = index('thigh.L');
  // Shorter thighs need a forward seat position while the feet remain on the floor.
  const seatTravel = seated ? sample.seat * Math.min(0, length(sub(tails[upperLeg], heads[upperLeg]))
    - length(sub(bones[upperLeg].tail, bones[upperLeg].head))) : 0;
  const readHip = heads[hip][2] + bundle.actions.read[0][hip][14] - bones[hip].head[2];
  let rootShift = seated ? sample.seat * (.404 + .126*bodyScale - readHip) : 0;
  if (action === 'walk' || transition) {
    // Lower the pelvis only as a pose adjustment when shorter legs need more knee room.
    for (const side of ['L', 'R']) {
      const thigh = index(`thigh.${side}`), shin = index(`shin.${side}`), foot = index(`foot.${side}`);
      const reach = length(sub(tails[thigh], heads[thigh])) + length(sub(tails[shin], heads[shin])) - .001;
      const dx = positions[thigh][0] - positions[foot][0], dy = positions[thigh][1] - positions[foot][1];
      if (reach*reach <= dx*dx+dy*dy) throw new Error('Stride exceeds configured leg reach');
      rootShift = Math.min(rootShift, positions[foot][2] + Math.sqrt(reach*reach-dx*dx-dy*dy) - positions[thigh][2]);
    }
  }
  for (let i = 0; i < positions.length; i++) {
    if (bones[i].name === 'root' || bones[i].name === 'book' || bones[i].name.startsWith('foot') || bones[i].name.startsWith('prop:')) continue;
    positions[i][1] += seatTravel; positions[i][2] += rootShift; matrices[i].splice(12, 3, ...positions[i]);
  }
  if (seated || action === 'walk' || transition) for (const side of ['L', 'R']) {
    const thigh = index(`thigh.${side}`), shin = index(`shin.${side}`), foot = index(`foot.${side}`);
    const start = positions[thigh], end = positions[foot];
    const pole = add(start, [0, -1, 0]);
    const knee = solveLimb(start, end, length(sub(tails[thigh], heads[thigh])), length(sub(tails[shin], heads[shin])), pole);
    matrices[thigh] = boneFrame(start, knee, source[thigh]);
    matrices[shin] = boneFrame(knee, end, source[shin]);
  }
  if (hasBook(action)) {
    const spine = index('spine'), book = index('book');
    const oldSpine: Vec3 = [source[spine][12], source[spine][13], source[spine][14]];
    const oldBook: Vec3 = [source[book][12], source[book][13], source[book][14]];
    const delta = sub(oldBook, oldSpine);
    const bookPosition = add(positions[spine], [delta[0], delta[1]*bodyScale, delta[2]*bodyScale]);
    matrices[book].splice(12, 3, ...bookPosition);
    const bookMovement = multiply(matrices[book], inverseAffine(sample.grip[book]));
    for (const side of ['L', 'R']) {
      const upper = index(`upper_arm.${side}`), fore = index(`forearm.${side}`), hand = index(`hand.${side}`);
      const wrist = transform(bookMovement, [sample.grip[hand][12], sample.grip[hand][13], sample.grip[hand][14]]);
      const shoulder = positions[upper];
      const elbow = solveLimb(shoulder, wrist, length(sub(tails[upper], heads[upper])), length(sub(tails[fore], heads[fore])),
        positions[fore]);
      matrices[upper] = boneFrame(shoulder, elbow, source[upper]);
      matrices[fore] = boneFrame(elbow, wrist, source[fore]);
      matrices[hand] = multiply(bookMovement, sample.grip[hand]);
    }
  }
  bones.forEach((_, i) => result.set(multiply(matrices[i], inverse[i]), i*16));
  return result;
}
