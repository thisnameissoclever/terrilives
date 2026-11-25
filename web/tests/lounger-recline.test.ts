import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {withLoungerRecline} from '../src/render/character/clip-runtime.js';
import {posedCageSurface} from '../src/render/character/geometry-proof.js';
import {length,sub,transform} from '../src/render/character/math.js';
import {configuredPose} from '../src/render/character/pose.js';
import {configuredRestSetup} from '../src/render/character/pose-joints.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight,shapeVertices} from '../src/render/character/shape.js';
import {poolBase,poolLibrary,poolRig} from './pool-observer-fixture.js';

it('fits extended legs and swimwear to the Sunstrip deck for short, neutral and tall bodies',()=>{
  const rig=withLoungerRecline(poolRig,poolLibrary.clips.sofa_recline);
  for(const presentation of ['feminine','masculine'] as const)for(const [height,width] of [[0,0],[0,100],[50,50],[100,0],[100,100]]){
    const appearance=defaultAppearance(presentation);
    Object.assign(appearance.body,{height,build:width,hips:width,shoulders:width,torso:width});
    const shape={presentation,...appearance.body,face:appearance.face};
    const swimwear=presentation==='feminine'?'two_piece':'trunks';
    const selected=new PreparedBody(poolBase,appearance).select(rig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,
      includeFixture:false,clip:'lounger_recline',swimwear});
    expect(selected.extra?.description.parts.every(part=>part.conditions?.some(condition=>condition.swimwear?.includes(swimwear)))).toBe(true);
    expect(selected.extra?.description.parts.length).toBeGreaterThan(0);
    const top=anatomicalHeight(poolBase.vertices),matrices=configuredPose(rig.manifest,shape,'lounger_recline',0,top,undefined,selected.body);
    const {heads}=configuredRestSetup(rig.manifest,shape,top);
    const pivot=(name:string)=>{
      const bone=rig.manifest.bones.findIndex(bone=>bone.name===name);
      return transform(matrices.subarray(bone*16,bone*16+16),heads[bone]);
    };
    const headBone=rig.manifest.bones.findIndex(bone=>bone.name==='head');
    const [headX,headY,headZ]=heads[headBone];
    const [_,lean,rise]=sub(transform(matrices.subarray(headBone*16,headBone*16+16),[headX,headY,headZ+1]),pivot('head'));
    const headPitch=Math.atan2(rise,lean)*180/Math.PI;
    expect(headPitch).toBeGreaterThan(35);
    expect(headPitch).toBeLessThan(58);
    expect(pivot('head')[2]-pivot('hips')[2]).toBeGreaterThan(.20);
    for(const side of ['L','R']){
      const thigh=pivot('thigh.'+side),knee=pivot('shin.'+side),ankle=pivot('foot.'+side);
      expect(thigh[1]).toBeGreaterThan(knee[1]);
      expect(knee[1]).toBeGreaterThan(ankle[1]);
      expect(length(sub(thigh,ankle))/(length(sub(thigh,knee))+length(sub(knee,ankle)))).toBeGreaterThan(.88);
    }
    let nearestDeck=Infinity,nearestBack=Infinity;
    const tilt=40*Math.PI/180,backStart=.42-.09*Math.sin(tilt),backEnd=backStart+.62*Math.cos(tilt);
    for(const geometry of [selected.body,selected.extra!]){
      const surface=posedCageSurface(geometry,shapeVertices(geometry.cage,shape,top),matrices);
      const ids=new Set(geometry.description.parts.flatMap(part=>Array.from(geometry.indices.subarray(part.start,part.start+part.count))));
      for(const id of ids){
        const [x,y,z]=surface.subarray(id*3,id*3+3);
        if(Math.abs(x)>.29)continue;
        if(y>=-.88&&y<=.45)nearestDeck=Math.min(nearestDeck,z-.42);
        if(y>=backStart&&y<=backEnd)nearestBack=Math.min(nearestBack,z-.33-.09*Math.cos(tilt)-(y-backStart)*Math.tan(tilt));
      }
    }
    expect(nearestDeck).toBeGreaterThanOrEqual(-.003);
    expect(nearestDeck).toBeLessThan(.012);
    expect(nearestBack).toBeGreaterThanOrEqual(-.003);
    expect(nearestBack).toBeLessThan(.045);
    const points=posedCageSurface(selected.body,shapeVertices(selected.body.cage,shape,top),matrices);
    const torso=selected.body.description.parts.find(part=>part.name==='Creator bare torso')!;
    const torsoGap=Math.min(...Array.from(selected.body.indices.slice(torso.start,torso.start+torso.count),id=>{
      const [x,y,z]=points.subarray(id*3,id*3+3);
      return Math.abs(x)<=.29&&y>=backStart&&y<=backEnd
        ? z-.33-.09*Math.cos(tilt)-(y-backStart)*Math.tan(tilt) : Infinity;
    }));
    expect(torsoGap).toBeLessThan(.065);
    for(const name of ['Creator bare foot L','Creator bare foot R']){
      const part=selected.body.description.parts.find(part=>part.name===name)!;
      const bottom=Math.min(...Array.from(selected.body.indices.slice(part.start,part.start+part.count),id=>points[id*3+2]));
      expect(bottom).toBeCloseTo(.424,2);
    }
  }
});
