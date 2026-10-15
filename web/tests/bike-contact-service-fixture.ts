import type {CharacterAppearanceV1} from '../src/character/schema.js';
import {identity} from '../src/render/character/math.js';
import {BIKE_CONTACT_SOLVER_REVISION,type BikeContactArtifactV1,type BikeContactInputV1} from '../src/render/character/bike-contact-types.js';
import {makeBikeContactInput,type BikeContactWorkerRequest,type BikeContactWorkerResponse} from '../src/render/character/bike-contact-protocol.js';
import {bikeContactAppearanceKey,type BikeContactTransport} from '../src/render/character/bike-contact-service.js';

export async function testInput(appearance:CharacterAppearanceV1):Promise<BikeContactInputV1>{
  const points:[number,number,number][]=[[0,0,0],[1,0,0],[0,1,0]],triangles:[number,number,number][]=[[0,1,2]];
  return makeBikeContactInput({version:1,solverRevision:BIKE_CONTACT_SOLVER_REVISION,sourcePhase:0,
    revisions:{source:'source-test',fixture:'fixture-test',shoes:appearance.footwear},shapeKey:bikeContactAppearanceKey(appearance),shoeKey:'test-shoe-parts',
    hip:[appearance.body.height/100,0,1],hipSurface:{points,triangles},saddle:{points,triangles},
    soles:[{points,source:identity()},{points,source:identity()}],thighOffsets:[[0,0,0],[0,0,0]],legLengths:[1,1],
    dimensions:{axle:[0,0,0],radius:.1,halfSpacing:.2,pedalTop:.02,flywheelFace:.1}});
}
export function testArtifact(input:BikeContactInputV1):BikeContactArtifactV1 {
  return {version:1,solverRevision:input.solverRevision,sourcePhase:0,key:input.key,revisions:{...input.revisions},shapeKey:input.shapeKey,shoeKey:input.shoeKey,
    fit:{hip:[0,0,.5],pelvisRotation:identity(),pitch:0,feet:[{rotation:identity(),offset:[0,0,0],contact:[0,0,0]},
      {rotation:identity(),offset:[0,0,0],contact:[0,0,0]}],reachMargin:.01,supportSamples:8}};
}
export class FakeBikeContactTransport implements BikeContactTransport {
  readonly requests:BikeContactWorkerRequest[]=[];
  private readonly pending=new Map<number,{resolve:(response:BikeContactWorkerResponse)=>void;reject:(error:unknown)=>void}>();
  maxActive=0;disposals=0;
  run(request:BikeContactWorkerRequest):Promise<BikeContactWorkerResponse>{
    this.requests.push(request);
    return new Promise((resolve,reject)=>{this.pending.set(request.id,{resolve,reject});this.maxActive=Math.max(this.maxActive,this.pending.size);});
  }
  complete(index:number,response?:BikeContactWorkerResponse):void {
    const request=this.requests[index],pending=this.pending.get(request.id);if(!pending)return;this.pending.delete(request.id);
    pending.resolve(response??{version:1,id:request.id,ok:true,artifact:testArtifact(request.input)});
  }
  fail(index:number,error:unknown):void {const request=this.requests[index],pending=this.pending.get(request.id);if(!pending)return;this.pending.delete(request.id);pending.reject(error);}
  dispose():void {this.disposals++;for(const pending of this.pending.values()){const error=new Error('Disposed fake transport.');error.name='AbortError';pending.reject(error);}this.pending.clear();}
}
