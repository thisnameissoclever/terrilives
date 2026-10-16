import type {Geometry,MeshPart} from './bundle.js';
import {neutralAppearance} from './appearance.js';
import {anatomicalHeight,shapeVertices,type ShapeParameters} from './shape.js';
import {HeadEnvelope} from './head-envelope.js';
import {freckleCoordinates} from './freckles.js';
import {SubdivisionGpu} from './subdivision-gpu.js';
import {acquireStaticCharacterBuffers,releaseCharacterOnDeviceLoss,type StaticCharacterLease} from './resources.js';
import {outlineDrawRanges} from './draw-ranges.js';
import {authoredOutline} from './authored-surfaces.js';
import type {BikeContactArtifactV1} from './bike-contact-types.js';
import type {SleepContactArtifactV1} from './sleep-contact-types.js';

interface ShapeSource {dependent:boolean;head:boolean;fixedCage?:Float32Array<ArrayBuffer>}
const shapeSources=new WeakMap<Geometry,ShapeSource>();
function shapeSource(geometry:Geometry):ShapeSource {
  const saved=shapeSources.get(geometry);if(saved)return saved;
  let dependent=false,head=false;
  for(let at=15;at<geometry.cage.length;at+=16){const region=geometry.cage[at];
    if(region!==7&&region<10)dependent=true;if(region===1||region===8||region===9)head=true;}
  const source={dependent,head};shapeSources.set(geometry,source);return source;
}

/** Deformation belongs to the live person; cameras own only their uniforms and targets. */
export class CharacterMeshResources {
  readonly vertex:GPUBuffer;
  readonly skinCoordinates:GPUBuffer;
  readonly skeleton:GPUBuffer;
  readonly subdivision:SubdivisionGpu;
  readonly staticResources:StaticCharacterLease;
  readonly headEnvelope:HeadEnvelope|null;
  readonly top:number;
  shape:ShapeParameters=neutralAppearance();
  configured=false;
  deformed:Float32Array<ArrayBuffer>;
  lastPoseKey='';
  lastMatrices:Float32Array<ArrayBuffer>|null=null;
  poseSource:Float32Array<ArrayBuffer>|null=null;
  surfaceDirty=true;
  bikeContact:BikeContactArtifactV1|undefined;
  sleepContact:SleepContactArtifactV1|undefined;
  seatContact:import('./seat-contact-types.js').SeatContactArtifactV1|undefined;
  outlineRanges:{start:number;count:number}[]=[];
  fillRanges:{start:number;count:number}[]=[];
  private references=0;
  private closed=false;
  private shapeKey='';
  private readonly ownsSkeleton:boolean;
  private readonly headSelections=new Map<string,readonly MeshPart[]>();
  private readonly forgetLoss:()=>void;
  private readonly shapeSource:ShapeSource;
  constructor(readonly device:GPUDevice,public geometry:Geometry,options:{top?:number;skeleton?:GPUBuffer}={}){
    this.shapeSource=shapeSource(geometry);
    const upload=(data:ArrayBufferView<ArrayBuffer>,usage:GPUBufferUsageFlags)=>{
      const buffer=device.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,data);return buffer;
    };
    this.vertex=upload(geometry.vertices,GPUBufferUsage.VERTEX|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
    this.skinCoordinates=upload(freckleCoordinates(geometry),GPUBufferUsage.VERTEX);
    this.staticResources=acquireStaticCharacterBuffers(device,geometry);
    this.ownsSkeleton=!options.skeleton;
    this.skeleton=options.skeleton??device.createBuffer({size:512*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    this.subdivision=new SubdivisionGpu(device,geometry,this.vertex,this.staticResources.buffers.index,this.skeleton,this.staticResources.buffers);
    this.top=options.top??anatomicalHeight(geometry.vertices);
    this.deformed=geometry.cage;
    this.headEnvelope=geometry.description.parts.some(part=>[1,8,9].includes(part.region))?new HeadEnvelope(geometry):null;
    this.setParts(geometry.description.parts);
    this.forgetLoss=releaseCharacterOnDeviceLoss(device,()=>this.destroy());
  }
  retain():void {if(this.closed)throw new Error('Character mesh is closed.');this.references++;}
  release():void {if(--this.references===0)this.destroy();}
  setGeometry(geometry:Geometry):void {
    if(this.geometry===geometry)return;
    if(this.geometry.vertices!==geometry.vertices||this.geometry.cage!==geometry.cage)throw new Error('Prepared body buffers changed.');
    const samePose=this.geometry.manifest===geometry.manifest&&this.geometry.description.parts===geometry.description.parts;
    this.geometry=geometry;if(!samePose){this.lastPoseKey='';this.lastMatrices=null;}
    this.setParts(geometry.description.parts);
  }
  private setParts(parts:readonly MeshPart[]):void {
    this.fillRanges=outlineDrawRanges(parts.map(part=>({...part,outline:true})));
    this.outlineRanges=outlineDrawRanges(parts.map(part=>({...part,outline:authoredOutline(part.name)})));
    this.prepareHeadSelection(parts);
  }
  prepareHeadSelection(parts:readonly MeshPart[]):void {
    if(!this.headEnvelope)return;
    const head=parts.filter(part=>[1,8,9].includes(part.region)),key=head.map(part=>part.start).join(',');
    let selected=this.headSelections.get(key);if(!selected){selected=head;this.headSelections.set(key,selected);}
    this.headEnvelope.setVisibleParts(selected);
  }
  configure(shape:ShapeParameters,hairRegion:number|null=null):void {
    const source=this.shapeSource;
    const key=source.dependent?JSON.stringify([shape.presentation,shape.height,shape.build,shape.shoulders,shape.hips,shape.torso,source.head?shape.face:null,hairRegion]):'fixed';
    if(key===this.shapeKey)return;
    this.shapeKey=key;this.shape=shape;this.configured=true;this.lastPoseKey='';this.lastMatrices=null;
    // Identity regions still need the original differential-normal calculation, exactly once.
    this.deformed=source.dependent?shapeVertices(this.geometry.cage,shape,this.top):(source.fixedCage??=shapeVertices(this.geometry.cage,shape,this.top));
    this.subdivision.update(this.deformed);
    this.headEnvelope?.configure(this.deformed,hairRegion);
  }
  updateFixedGeometry():void {
    if(this.shapeSource.dependent)throw new Error('Only fixed geometry may update its prepared cage.');
    this.deformed=shapeVertices(this.geometry.cage,this.shape,this.top);
    this.subdivision.update(this.deformed);this.surfaceDirty=true;
  }
  get privateBytes():number {return this.subdivision.allocatedBufferBytes+this.vertex.size+this.skinCoordinates.size+(this.ownsSkeleton?this.skeleton.size:0);}
  private destroy():void {
    if(this.closed)return;this.closed=true;this.forgetLoss();this.subdivision.destroy();this.vertex.destroy();this.skinCoordinates.destroy();
    if(this.ownsSkeleton)this.skeleton.destroy();this.staticResources.release();
  }
}
