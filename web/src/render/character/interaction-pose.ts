import type {Bundle,Geometry} from './bundle.js';
import {bikePedalPosition,type BikeFit} from './bike-fit.js';
import type {BikeFitResolver} from './bike-contact-types.js';
import {evaluateContactLandmark} from './contact-landmark.js';
import type {ClipContacts,ContactFrame,ContactLandmark,PoseDiagnostics} from './contact-types.js';
import {fitAssembly,reachableSegment} from './contact-math.js';
import {add,boneFrame,dot,identity,inverseAffine,length,multiply,scale,solveLimb,sub,transform,unit,type Vec3} from './math.js';
import {clipSample,interpolateAffine,interpolateTransform} from './motion.js';
import {shapePoint,type ShapeParameters} from './shape.js';
import {thighContactPatches,nearestReachableContact} from './resting-contact.js';
import {fitSleepingPose} from './sleep-fit.js';
import {fitRecliningPose} from './recline-fit.js';
import {fitSeatedPose} from './seat-fit.js';
import {fitDiningGrip} from './dining-contact.js';
import type {SeatFitResolver} from './seat-contact-types.js';

interface Context {bundle:Bundle;appearance:ShapeParameters;action:string;frame:number;top:number;source:number[][];rest:number[][];matrices:number[][];audit?:PoseDiagnostics;geometry?:Geometry;bikeFit:BikeFitResolver;seatFit?:SeatFitResolver}
type Matrices=number[][];
type Targets={wrists:[Vec3,Vec3];grips:[Vec3,Vec3];references:[Vec3,Vec3];hands:[number[],number[]];assemblies:Record<string,number[]>};
const sides=['L','R'] as const;
const pair=<T>(read:(side:'L'|'R',index:number)=>T):[T,T]=>[read('L',0),read('R',1)];
const point=(m:readonly number[]):[number,number,number]=>[m[12],m[13],m[14]];
const rotation=(m:readonly number[],p:Vec3):[number,number,number]=>sub(transform(m,p),point(m));
const translation=(p:Vec3)=>{const m=identity();m.splice(12,3,...p);return m;};
const mix=(a:Vec3,b:Vec3,t:number):Vec3=>add(scale(a,1-t),scale(b,t));

function sampleContacts(a:ContactFrame,b:ContactFrame,t:number):ContactFrame {
  if(t===0)return a;if(t===1)return b;
  const assemblies=Object.fromEntries(Object.entries(a.assemblies).map(([name,matrix])=>{
    if(!b.assemblies[name])throw new Error(`Missing assembly sample: ${name}`);
    return [name,interpolateAffine(matrix,b.assemblies[name],t)];
  }));
  return {assemblies,bookHeld:a.bookHeld,raise:(a.raise??0)*(1-t)+(b.raise??0)*t,lift:(a.lift??0)*(1-t)+(b.lift??0)*t,
    handContact:a.handContact&&b.handContact?[a.handContact[0]*(1-t)+b.handContact[0]*t,a.handContact[1]*(1-t)+b.handContact[1]*t]:undefined,
    handRegions:a.handRegions&&b.handRegions?pair((_,i)=>{
      const left=a.handRegions![i],right=b.handRegions![i];
      return left&&right?{mode:t<.5?left.mode:right.mode,min:mix(left.min,right.min,t),max:mix(left.max,right.max,t)}:left??right;
    }):undefined,
    shaft:a.shaft&&b.shaft?{bottom:mix(a.shaft.bottom,b.shaft.bottom,t),top:mix(a.shaft.top,b.shaft.top,t)}:undefined,
    palmL:a.palmL&&b.palmL?mix(a.palmL,b.palmL,t):undefined,palmR:a.palmR&&b.palmR?mix(a.palmR,b.palmR,t):undefined};
}

export function solveInteraction(context:Context):Float32Array<ArrayBuffer> {
  const {bundle,appearance,action,frame,top,source,rest,audit}=context,clip=bundle.clipMetadata![action],contacts=clip.contacts;
  if(contacts?.version!==1||contacts.space!=='rig')throw new Error(`Missing contact contract: ${action}`);
  const sampled=clipSample(clip.rigs.length,clip.stepSamples?Math.floor(frame):frame,clip.playback),rig=interpolateAffine(clip.rigs[sampled.index],clip.rigs[sampled.next],sampled.t);
  const contactFrame=sampleContacts(clip.contactFrames[sampled.index],clip.contactFrames[sampled.next],sampled.t);
  const bones=bundle.bones,index=(name:string)=>{const id=bones.findIndex(bone=>bone.name===name);if(id<0)throw new Error(`Missing contact bone: ${name}`);return id;};
  const inverse=rest.map(inverseAffine),originalInverse=bones.map(bone=>bone.inverseRest),matrices=context.matrices.map(matrix=>[...matrix]);
  const evaluate=(landmark:ContactLandmark,pose:Matrices,configured:boolean):Vec3=>{
    return evaluateContactLandmark(bones,landmark,pose,configured?inverse:originalInverse,configured?appearance:undefined,top);
  };
  const applyShift=(shift:Vec3)=>{for(let i=0;i<17;i++)matrices[i].splice(12,3,...add(point(matrices[i]),shift));};
  const supported=['dining','seat','seat_book','bath','recline','exercise'].includes(contacts.policy);
  if(supported){
    const old=evaluate(contacts.landmarks.pelvis,source,false),current=evaluate(contacts.landmarks.pelvis,matrices,true);
    const shift:[number,number,number]=[0,0,old[2]-current[2]];
    if(contacts.policy==='bath'){
      const spine=index('spine'),normal=unit(rotation(multiply(source[spine],originalInverse[spine]),[0,1,0]));
      const delta=sub(evaluate(contacts.landmarks.back,source,false),evaluate(contacts.landmarks.back,matrices,true));
      if(Math.abs(normal[1])<.1)throw new Error('Bath back support has no usable wall normal.');
      shift[1]=(dot(delta,normal)-normal[2]*shift[2])/normal[1];
    }
    applyShift(shift);
  }
  let seatedFit=false;
  if(contacts.policy==='seat'||contacts.policy==='seat_book'||contacts.policy==='dining'){
    if(!context.geometry)throw new Error('Seating requires its actual support geometry.');
    if(contacts.feet)seatedFit=(context.seatFit??fitSeatedPose)(context.geometry,appearance,top,clip.family,matrices,rest,rig,source,contacts.feet.forwardRange);
  }
  const boneLength=(id:number)=>length(sub(shapePoint(bones[id].tail,bones[id].name.startsWith('shin')?6:3,appearance,top),shapePoint(bones[id].head,3,appearance,top)));
  let bikeFit:BikeFit|undefined;
  if(contacts.policy==='exercise'){
    if(!context.geometry||!contacts.bike)throw new Error('Bike fitting requires its contact geometry.');
    const angle=-frame/clip.rigs.length*Math.PI*2;
    for(const side of sides){
      const pedal=index('prop:exercise:Bike pedal '+side),spindle=index('prop:exercise:Bike pedal spindle '+side),crank=index('prop:exercise:Bike crank '+side);
      const position=bikePedalPosition(contacts.bike,angle,side),shift=sub(position,point(source[pedal]));
      source[pedal].splice(12,3,...position);source[spindle].splice(12,3,...add(point(source[spindle]),shift));
      source[crank][13]=(contacts.bike.axle[1]+position[1])/2;source[crank][14]=(contacts.bike.axle[2]+position[2])/2;
    }
    bikeFit=context.bikeFit(context.geometry,appearance,top,rest,matrices,source,contacts.bike,
      [boneLength(index('thigh.L'))+boneLength(index('shin.L')),boneLength(index('thigh.R'))+boneLength(index('shin.R'))],angle);
    const hip=point(matrices[index('hips')]),rotation=[...bikeFit.pelvisRotation];
    rotation.splice(12,3,...sub(bikeFit.hip,transform(rotation,hip)));
    for(let i=0;i<17;i++)matrices[i]=multiply(rotation,matrices[i]);
  }
  if(contacts.policy==='sleep'){
    if(!context.geometry)throw new Error('Sleeping requires the actual mattress and body surfaces.');
    fitSleepingPose(context.geometry,appearance,top,matrices,rest,rig,source);
  }
  if(contacts.policy==='recline'){
    if(!context.geometry)throw new Error('Reclining requires the actual sofa and body surfaces.');
    fitRecliningPose(context.geometry,appearance,top,matrices,rest,rig,source);
  }
  if(contacts.policy!=='recline'&&contacts.policy!=='sleep'&&!seatedFit){
    if(!supported){
      let lowering=0;
      for(const side of sides){const thigh=index('thigh.'+side),shin=index('shin.'+side),foot=index('foot.'+side),hip=point(matrices[thigh]),ankle=point(source[foot]),reach=boneLength(thigh)+boneLength(shin)-.001;
        const horizontal=(hip[0]-ankle[0])**2+(hip[1]-ankle[1])**2;
        if(horizontal>=reach*reach)throw new Error(`The ${action} stance exceeds leg reach.`);
        lowering=Math.min(lowering,ankle[2]+Math.sqrt(reach*reach-horizontal)-hip[2]);}
      applyShift([0,0,lowering]);
    }
    for(const side of sides){
      const thigh=index('thigh.'+side),shin=index('shin.'+side),foot=index('foot.'+side),hip=point(matrices[thigh]);
      let ankle:Vec3=point(source[foot]);const upper=boneLength(thigh),lower=boneLength(shin);
      if(bikeFit){
        const which=side==='L'?0:1,fit=bikeFit.feet[which],name='prop:exercise:Bike pedal '+side;
        const pedal=point(source[index(name)]);ankle=sub(add(pedal,fit.contact),fit.offset);
      }
      if(contacts.feet){
        const start:Vec3=[ankle[0],source[thigh][13],ankle[2]],line:Vec3=[0,1,0];
        const feasible=reachableSegment(start,line,hip,upper+lower-.001,contacts.feet.forwardRange);
        if(!feasible)throw new Error(`No supported foot position is reachable for ${action}.`);
        const preferred=ankle[1]-start[1];ankle=add(start,scale(line,Math.max(feasible[0],Math.min(feasible[1],preferred))));
      }
      const knee=solveLimb(hip,ankle,upper,lower,point(source[shin]));
      matrices[thigh]=boneFrame(hip,knee,source[thigh]);matrices[shin]=boneFrame(knee,ankle,source[shin]);
      matrices[foot]=[...(bikeFit?bikeFit.feet[side==='L'?0:1].rotation:source[foot])];matrices[foot].splice(12,3,...ankle);
    }
  }
  const armLengths=sides.map(side=>{
    const upper=index('upper_arm.'+side),fore=index('forearm.'+side);
    const size=(id:number)=>length(sub(shapePoint(bones[id].tail,4,appearance,top),shapePoint(bones[id].head,4,appearance,top)));
    return [size(upper),size(fore)] as const;
  });
  const references=pair<Vec3>(side=>contactFrame[side==='L'?'palmL':'palmR']??contacts.landmarks[side==='L'?'palmL':'palmR'].point);
  const sourceGrips=pair<Vec3>((side,i)=>transform(multiply(source[index('hand.'+side)],originalInverse[index('hand.'+side)]),references[i]));
  const restingPatches=contacts.policy==='bath'&&context.geometry?thighContactPatches(context.geometry,appearance,top,matrices,inverse):null;
  if(contacts.policy==='bath'&&!restingPatches)throw new Error('Bath hands require actual thigh contact surfaces.');
  function targets(pose:Matrices):Targets|null {
    const hands=pair((side,i)=>interpolateTransform(pose[index('hand.'+side)],source[index('hand.'+side)],contactFrame.handContact?.[i]??1));
    const offsets=pair<Vec3>((side,i)=>rotation(hands[i],transform(inverse[index('hand.'+side)],shapePoint(references[i],4,appearance,top))));
    let grips:[Vec3,Vec3]=[[...sourceGrips[0]],[...sourceGrips[1]]];const assemblies:Record<string,number[]>={};
    if(contactFrame.handContact)for(const [i,side] of sides.entries()){
      const hand=index('hand.'+side),free=transform(multiply(pose[hand],inverse[hand]),shapePoint(references[i],4,appearance,top));
      const engagement=contactFrame.handContact[i];grips[i]=mix(free,grips[i],engagement);
      const region=contactFrame.handRegions?.[i];
      if(region&&engagement>0){
        const min=mix(free,region.min,engagement),max=mix(free,region.max,engagement);
        const fitted=fitAssembly(grips[i],min,max,[{center:add(point(pose[index('upper_arm.'+side)]),offsets[i]),radius:armLengths[i][0]+armLengths[i][1]-.001}]);
        if(!fitted)return null;grips[i]=fitted;
      }
    }
    const moveAssembly=(name:string,delta:Vec3)=>{
      const original=contactFrame.assemblies[name];if(!original)throw new Error(`Missing held assembly: ${name}`);
      assemblies[name]=multiply(translation(delta),original);grips=[add(grips[0],delta),add(grips[1],delta)];
    };
    if(contacts.policy==='book_reach'&&contactFrame.heldAssembly){
      const delta=sub(point(pose[index('spine')]),point(source[index('spine')]));
      const spheres=sides.flatMap((side,i)=>contactFrame.handContact?.[i]===0?[]:[{center:sub(point(pose[index('upper_arm.'+side)]),sub(grips[i],offsets[i])),radius:armLengths[i][0]+armLengths[i][1]-.001}]);
      const shift=fitAssembly(delta,add(delta,[-.10,-.15,-.12]),add(delta,[.10,.15,.12]),spheres);if(!shift)return null;
      const original=contactFrame.assemblies[contactFrame.heldAssembly];if(!original)throw new Error('Moving book assembly is missing.');
      assemblies[contactFrame.heldAssembly]=multiply(translation(shift),original);
      for(let i=0;i<2;i++)if(contactFrame.handContact?.[i]!==0)grips[i]=add(grips[i],shift);
    }else if(contacts.policy==='book'||contacts.policy==='seat_book'||contacts.policy==='book_reach'&&contactFrame.bookHeld){
      const delta=sub(point(pose[index('spine')]),point(source[index('spine')]));
      const spheres=sides.map((side,i)=>({center:sub(point(pose[index('upper_arm.'+side)]),sub(grips[i],offsets[i])),radius:armLengths[i][0]+armLengths[i][1]-.001}));
      const shift=fitAssembly(delta,add(delta,[-.10,-.15,-.12]),add(delta,[.10,.15,.12]),spheres);
      if(!shift)return null;
      grips=[add(grips[0],shift),add(grips[1],shift)];
      pose[index('book')]=[...source[index('book')]];pose[index('book')].splice(12,3,...add(point(source[index('book')]),shift));
    }else if(contacts.surfaceWork){
      const work=contacts.surfaceWork,i=work.hand,original=contactFrame.assemblies[work.assembly];
      if(!original)throw new Error('Wiping cloth assembly is missing.');
      const origin=point(original),preferred=dot(origin,work.axis),start=sub(sub(grips[i],offsets[i]),scale(work.axis,preferred));
      const feasible=reachableSegment(start,work.axis,point(pose[index('upper_arm.'+sides[i])]),armLengths[i][0]+armLengths[i][1]-.001,work.range);
      if(!feasible)return null;
      const chosen=Math.max(feasible[0],Math.min(feasible[1],preferred)),delta=scale(work.axis,chosen-preferred);
      assemblies[work.assembly]=multiply(translation(delta),original);grips[i]=add(grips[i],delta);
    }else if(contacts.policy==='carry'||contacts.policy==='wash'||contacts.policy==='bag'){
      const spine=index('spine'),bodyDelta=sub(point(pose[spine]),point(source[spine]));
      const preferred:Vec3=contacts.policy==='wash'?[0,0,0]:contacts.policy==='bag'?scale(bodyDelta,contactFrame.lift??0):bodyDelta;
      const bound=contacts.carry;
      const min=add(preferred,bound?.translationMin??[-.1,-.15,-.12]),max=add(preferred,bound?.translationMax??[.1,.15,.12]);
      const spheres=sides.map((side,i)=>({center:sub(point(pose[index('upper_arm.'+side)]),sub(grips[i],offsets[i])),radius:armLengths[i][0]+armLengths[i][1]-.001}));
      const delta=fitAssembly(preferred,min,max,spheres);
      if(!delta)return null;
      moveAssembly(bound?.assembly??contacts.bag!.assembly,delta);
    }else if(contacts.policy==='dining'){
      const dining=contacts.dining!,raised=contactFrame.raise??0,mouth=evaluate(contacts.landmarks.mouth,pose,true),bowl=mix(dining.food,mouth,raised);
      const shoulderShift=pose[index('upper_arm.R')][12]-source[index('upper_arm.R')][12];
      const x=.14-.06*raised+shoulderShift*raised,lateral=bowl[0]-x-offsets[1][0],square=dining.length*dining.length-lateral*lateral;
      if(square<=0)throw new Error('The spoon cannot reach the mouth with its authored length.');
      const radius=Math.sqrt(square),angle=.35+(Math.PI-.35)*raised;
      grips[1]=[x+offsets[1][0],bowl[1]+radius*Math.cos(angle),bowl[2]+radius*Math.sin(angle)];
      const original=contactFrame.assemblies[dining.spoon];if(!original)throw new Error('Eating spoon assembly is missing.');
      const preferred=boneFrame(grips[1],bowl,original),shoulder=point(pose[index('upper_arm.R')]);
      const fit=fitDiningGrip(sub(grips[1],offsets[1]),bowl,shoulder,Math.abs(armLengths[1][0]-armLengths[1][1])+.001,armLengths[1][0]+armLengths[1][1]-.001);
      if(!fit)return null;
      hands[1]=multiply(fit.rotation,hands[1]);offsets[1]=transform(fit.rotation,offsets[1]);
      grips[1]=add(fit.wrist,offsets[1]);assemblies[dining.spoon]=multiply(fit.transform,preferred);
    }else if(contacts.policy==='mop'){
      const mop=contacts.mop!,shaft=contactFrame.shaft;if(!shaft)throw new Error('Mop shaft contacts are missing.');
      const direction=sub(shaft.top,shaft.bottom),wristStart=sub(shaft.bottom,offsets[0]);
      const feasible=reachableSegment(wristStart,direction,point(pose[index('upper_arm.L')]),armLengths[0][0]+armLengths[0][1]-.001,mop.leftRange);
      if(!feasible)return null;
      grips[0]=add(shaft.bottom,scale(direction,Math.max(feasible[0],Math.min(feasible[1],mop.leftPreferred))));
      grips[1]=add(shaft.bottom,scale(direction,mop.rightFraction));
    }else if(contacts.policy==='bath'||contacts.policy==='seat'){
      for(const [i,side] of sides.entries()){
        const thigh=index('thigh.'+side),restPoint=transform(multiply(bones[thigh].rest,inverseAffine(source[thigh])),sourceGrips[i]);
        const preferred=transform(multiply(pose[thigh],inverse[thigh]),shapePoint(restPoint,3,appearance,top));
        if(restingPatches){
          const contact=nearestReachableContact(restingPatches[i],preferred,offsets[i],point(pose[index('upper_arm.'+side)]),...armLengths[i]);
          if(!contact)return null;grips[i]=contact;continue;
        }
        const direction=unit(sub(point(pose[index('shin.'+side)]),point(pose[thigh])));
        const feasible=reachableSegment(sub(preferred,offsets[i]),direction,point(pose[index('upper_arm.'+side)]),armLengths[i][0]+armLengths[i][1]-.001,[-.08,.08]);
        if(!feasible)return null;
        grips[i]=add(preferred,scale(direction,Math.max(feasible[0],Math.min(feasible[1],0))));
      }
    }
    return {grips,wrists:[sub(grips[0],offsets[0]),sub(grips[1],offsets[1])],references,hands,assemblies};
  }
  let solvedTargets:Targets|undefined,solvedPose:Matrices|undefined;
  if(contacts.policy!=='recline'&&contacts.policy!=='sleep'&&contacts.policy!=='shower'){
    const pivot=point(matrices[index('spine')]);
    const candidate=(angle:number,roll=0):{pose:Matrices;targets:Targets}|null=>{
      const c=Math.cos(angle),s=Math.sin(angle),turn=[1,0,0,0,0,c,s,0,0,-s,c,0,0,pivot[1]-c*pivot[1]+s*pivot[2],pivot[2]-s*pivot[1]-c*pivot[2],1];
      const rc=Math.cos(roll),rs=Math.sin(roll),lean=[rc,0,-rs,0,0,1,0,0,rs,0,rc,0,pivot[0]-rc*pivot[0]-rs*pivot[2],0,pivot[2]+rs*pivot[0]-rc*pivot[2],1];
      const combined=multiply(lean,turn);
      const pose=matrices.map((matrix,i)=>i<17&&(['spine','head'].includes(bones[i].name)||/arm|hand/.test(bones[i].name))?multiply(combined,matrix):matrix);
      const wanted=targets(pose);if(!wanted)return null;
      if(contacts.policy==='book_reach'&&!contactFrame.bookHeld&&!contactFrame.heldAssembly){
        const spheres=sides.flatMap((side,i)=>contactFrame.handContact?.[i]===0?[]:[{center:sub(wanted.wrists[i],point(pose[index('upper_arm.'+side)])),radius:armLengths[i][0]+armLengths[i][1]-.001}]);
        for(const side of sides){const thigh=index('thigh.'+side),shin=index('shin.'+side);spheres.push({center:sub(point(pose[index('foot.'+side)]),point(pose[thigh])),radius:boneLength(thigh)+boneLength(shin)-.001});}
        const shift=fitAssembly([0,0,0],[-.15,-.16,-.15],[.15,.10,.05],spheres);if(!shift)return null;
        for(let i=0;i<17;i++)if(!bones[i].name.startsWith('foot')){pose[i]=[...pose[i]];pose[i].splice(12,3,...add(point(pose[i]),shift));}
        for(const side of sides){
          const thigh=index('thigh.'+side),shin=index('shin.'+side),foot=index('foot.'+side),hip=point(pose[thigh]),ankle=point(pose[foot]);
          const upper=boneLength(thigh),lower=boneLength(shin),distance=length(sub(hip,ankle));
          if(distance<=Math.abs(upper-lower)+.000001||distance>=upper+lower-.000001)return null;
          const knee=solveLimb(hip,ankle,upper,lower,point(source[shin]));pose[thigh]=boneFrame(hip,knee,source[thigh]);pose[shin]=boneFrame(knee,ankle,source[shin]);
        }
      }
      if(!sides.every((side,i)=>{if(contactFrame.handContact?.[i]===0)return true;const distance=length(sub(wanted.wrists[i],point(pose[index('upper_arm.'+side)])));return distance<armLengths[i][0]+armLengths[i][1]-.000001&&distance>Math.abs(armLengths[i][0]-armLengths[i][1])+.000001;}))return null;
      return {pose,targets:wanted};
    };
    const pitchSolution=(roll:number)=>{
      let solution=candidate(0,roll);
      if(contacts.policy==='bath')return solution;
      for(let degrees=1;degrees<=45&&!solution;degrees++)for(const sign of [1,-1]){
        const angle=sign*degrees*Math.PI/180,found=candidate(angle,roll);if(!found)continue;
        let low=sign*(degrees-1)*Math.PI/180,high=angle;
        for(let i=0;i<14;i++){const middle=(low+high)/2;if(candidate(middle,roll))high=middle;else low=middle;}
        solution=candidate(high,roll)??found;break;
      }
      return solution;
    };
    let solution=pitchSolution(0);
    if(!solution&&['mop','book_reach'].includes(contacts.policy))for(let degrees=1;degrees<=20&&!solution;degrees++)for(const sign of [1,-1]){
      const found=pitchSolution(sign*degrees*Math.PI/180);if(!found)continue;
      let low=sign*(degrees-1)*Math.PI/180,high=sign*degrees*Math.PI/180;
      for(let i=0;i<12;i++){const mid=(low+high)/2;if(pitchSolution(mid))high=mid;else low=mid;}
      solution=pitchSolution(high)??found;break;
    }
    if(!solution)throw new Error(`Configured contacts are unreachable for ${action}.`);
    solvedPose=solution.pose;solvedTargets=solution.targets;
    for(let i=0;i<17;i++)matrices[i]=solvedPose[i];
    for(const [i,side] of sides.entries()){
      if(contactFrame.handContact?.[i]===0)continue;
      const upper=index('upper_arm.'+side),fore=index('forearm.'+side),hand=index('hand.'+side),shoulder=point(matrices[upper]),wrist=solvedTargets.wrists[i];
      const elbow=solveLimb(shoulder,wrist,armLengths[i][0],armLengths[i][1],point(matrices[fore]));
      matrices[upper]=boneFrame(shoulder,elbow,source[upper]);matrices[fore]=boneFrame(elbow,wrist,source[fore]);
      matrices[hand]=[...solvedTargets.hands[i]];matrices[hand].splice(12,3,...wrist);
      if(audit){const actual=transform(multiply(matrices[hand],inverse[hand]),shapePoint(references[i],4,appearance,top));audit.contacts.push({name:'palm'+side,target:solvedTargets.grips[i],actual,error:length(sub(actual,solvedTargets.grips[i]))});}
    }
  }
  const output=new Float32Array(bones.length*16),rigInverse=inverseAffine(rig);
  bones.forEach((bone,i)=>{
    if(i<17){output.set(multiply(rig,multiply(matrices[i],inverse[i])),i*16);return;}
    let matrix=[...source[i]];const sourceName=bone.name.slice(`prop:${clip.family}:`.length),assembly=contacts.assemblies[sourceName],updated=solvedTargets?.assemblies[assembly];
    if(updated){const delta=multiply(updated,inverseAffine(contactFrame.assemblies[assembly]));matrix=multiply(rig,multiply(delta,multiply(rigInverse,matrix)));}
    if(!clip.visibility[sampled.index][i-17])matrix[15]=-1;
    else if(clip.fixtureOwners?.[sampled.index][i-17])matrix[15]=2;
    output.set(matrix,i*16);
  });
  if(audit)audit.assemblies=solvedTargets?.assemblies??{};
  return output;
}
