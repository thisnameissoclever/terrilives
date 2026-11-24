import type {Bundle} from './bundle.js';
import {boneFrame,sub,type Vec3} from './math.js';

/** Keep knees below the water while longer legs extend toward the tap end. */
export function fitBathLegs(bundle:Bundle,matrices:number[][],source:number[][],
  lengths:readonly (readonly [number,number])[]):void {
  const point=(matrix:readonly number[]):Vec3=>[matrix[12],matrix[13],matrix[14]];
  const index=(name:string)=>{
    const result=bundle.bones.findIndex(bone=>bone.name===name);
    if(result<0)throw new Error('Missing bath bone: '+name);
    return result;
  };
  for(const [which,side] of (['L','R'] as const).entries()){
    const thigh=index('thigh.'+side),shin=index('shin.'+side),foot=index('foot.'+side);
    const hip=point(matrices[thigh]),ankleX=side==='L'?.145:-.145,kneeX=(hip[0]+ankleX)/2;
    const kneeZ=.40,ankleZ=source[foot][14],[upper,lower]=lengths[which];
    const upperForward=upper*upper-(kneeX-hip[0])**2-(kneeZ-hip[2])**2;
    const lowerForward=lower*lower-(ankleX-kneeX)**2-(ankleZ-kneeZ)**2;
    if(upperForward<=0||lowerForward<=0)throw new Error('Configured bath legs cannot reach the submerged posture.');
    const knee:Vec3=[kneeX,hip[1]+Math.sqrt(upperForward),kneeZ];
    const ankle:Vec3=[ankleX,knee[1]+Math.sqrt(lowerForward),ankleZ];
    matrices[thigh]=boneFrame(hip,knee,source[thigh]);
    matrices[shin]=boneFrame(knee,ankle,source[shin]);
    matrices[foot]=[...source[foot]];
    matrices[foot].splice(12,3,...ankle);
    const first=sub(knee,hip),second=sub(ankle,knee);
    if(![...first,...second].every(Number.isFinite))throw new Error('Non-finite configured bath legs.');
  }
}
