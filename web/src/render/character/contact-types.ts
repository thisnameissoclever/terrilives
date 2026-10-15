import type {Vec3} from './math.js';
import type {BikeDimensions} from './bike-fit.js';

export interface ContactLandmark { point:Vec3; weights:[string,number][]; region:number }
export interface ClipContacts {
  version:1;space:'rig';policy:'work'|'carry'|'wash'|'dining'|'mop'|'bag'|'exercise'|'seat'|'bath'|'recline'|'book'|'sleep'|'shower'|'seat_book'|'book_reach';
  landmarks:Record<'pelvis'|'back'|'mouth'|'palmL'|'palmR',ContactLandmark>;
  assemblies:Record<string,string>;
  dining?:{spoon:string;plate:string;length:number;food:Vec3};
  carry?:{assembly:string;translationMin:Vec3;translationMax:Vec3};
  surfaceWork?:{assembly:string;hand:0|1;axis:Vec3;range:[number,number]};
  bag?:{assembly:string;release:number;liftStart:number;liftEnd:number};
  mop?:{shaft:string;head:string;sleeve:string;rightFraction:number;leftRange:[number,number];leftPreferred:number};
  feet?:{kind:'floor'|'basin';forwardRange:[number,number]};
  bike?:BikeDimensions;
}
export interface ContactFrame {
  assemblies:Record<string,number[]>;raise?:number;lift?:number;
  shaft?:{bottom:Vec3;top:Vec3};palmL?:Vec3;palmR?:Vec3;
  handContact?:[number,number];handRegions?:[{mode:string;min:Vec3;max:Vec3}|null,{mode:string;min:Vec3;max:Vec3}|null];
  bookHeld?:boolean;
  heldAssembly?:string;
}
export interface ContactWitness {name:string;target:Vec3;actual:Vec3;error:number}
export interface PoseDiagnostics { contacts:ContactWitness[]; assemblies:Record<string,number[]> }
