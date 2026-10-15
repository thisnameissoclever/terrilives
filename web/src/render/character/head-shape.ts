import type { CharacterAppearanceV1 } from '../../character/schema.js';
import type { Vec3 } from './math.js';

export type FaceParameters=CharacterAppearanceV1['face'];
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const bell=(v:number,center:number,width:number)=>Math.exp(-(((v-center)/width)**2));

/** Rest-space feature landmarks measured from the accepted sculpt and attached marks. */
export function shapeHead(point:Vec3,region:number,face?:FaceParameters):[number,number,number] {
  const [x,y,z]=point;
  if(!face||(face.shape==='oval'&&face.eyes==='almond'&&face.brows==='soft'&&face.nose==='straight'&&face.mouth==='neutral'
    &&face.cheeks===50&&face.jaw===50&&face.chin===50&&face.eye_size===50&&face.brow_thickness===50
    &&face.nose_width===50&&face.mouth_fullness===50&&face.ears===50))return [x,y,z];
  const front=clamp((-y-.06)/.08),side=x<0?-1:1;
  const cheek=bell(z,1.60,.10),jaw=bell(z,1.47,.09),chin=bell(z,1.45,.065);
  const cheekAmount=(face.cheeks-50)/50,jawAmount=(face.jaw-50)/50,chinAmount=(face.chin-50)/50;
  const silhouette=face.shape==='round'?.07*bell(z,1.57,.15):face.shape==='angular'?.10*jaw-.025*cheek:0;
  let dx=x*(silhouette+.09*jawAmount*jaw+.08*cheekAmount*cheek);
  let dy=-.018*cheekAmount*cheek*front*clamp(Math.abs(x)/.12);
  let dz=-.035*chinAmount*chin*front;
  if(region===1){
    const eyeX=side*.091,eyeZ=1.689;
    const eye=bell(x,eyeX,.065)*bell(z,eyeZ,.037)*front;
    const eyeSize=(face.eye_size-50)/50;
    dx+=(x-eyeX)*(.30*eyeSize+(face.eyes==='round'?-.18:0))*eye;
    dz+=(z-eyeZ)*(.30*eyeSize+(face.eyes==='round'?.16:0))*eye;
    if(face.eyes==='soft')dz-=.008*clamp((x-eyeX)*side/.045)*eye;

    const brow=bell(x,side*.088,.058)*bell(z,1.755,.025)*front;
    const ax=Math.abs(x);
    // Quadratic centerlines fitted to the accepted eyebrow's rest vertices.
    const browY=1.41697844313*ax*ax+.12167892998*ax-.19870742989;
    const browZ=-4.75522238911*ax*ax+.81095593344*ax+1.72349743897;
    const thickness=(face.brow_thickness-50)/50*.8;
    dy+=(y-browY)*thickness*brow;dz+=(z-browZ)*thickness*brow;
    const arch=1-Math.min(1,((ax-.088)/.05)**2);
    if(face.brows==='arched')dz+=.014*arch*brow;
    if(face.brows==='straight')dz-=.009*arch*brow;

    const nose=bell(x,0,.043)*bell(z,1.624,.045)*front;
    dx+=x*((face.nose_width-50)/50*.4+(face.nose==='broad'?.22:0))*nose;
    if(face.nose==='button'){dy+=.011*nose;dz+=.009*nose;}
    if(face.nose==='broad')dy-=.005*nose;

    const mouth=bell(x,0,.048)*bell(z,1.544,.020)*front;
    const mouthY=.06119203162*x*x+.00000021808*x-.17948384735;
    const mouthZ=7.49217378102*x*x+.00000152579*x+1.53998058644;
    const fullness=(face.mouth_fullness-50)/50*.85+(face.mouth==='full'?.35:0);
    dy+=(y-mouthY)*fullness*mouth;dz+=(z-mouthZ)*fullness*mouth;
    if(face.mouth==='upturned')dz+=.01*clamp(Math.abs(x)/.037)*mouth;

    const ear=clamp((Math.abs(x)-.145)/.04)*bell(z,1.660,.10)*bell(y,.013,.075);
    const size=(face.ears-50)/50*.30;
    dx+=(x-side*.205)*size*ear;dy+=(y-.013)*size*ear;dz+=(z-1.660)*size*ear;
  }
  return [x+dx,y+dy,z+dz];
}
