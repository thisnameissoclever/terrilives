import {characterDevicePipelines} from './device-pipelines.js';
import {CharacterMeshResources} from './mesh-resources.js';
import type { Geometry } from './bundle.js';
import { multiply,transform,add,scale,type Vec3 } from './math.js';
import { colorFields, neutralAppearance, type AppearanceProofV1 } from './appearance.js';
import {shapePoint} from './shape.js';
import { validateAppearance, type CharacterAppearanceV1 } from '../../character/schema.js';
import { configuredPose } from './pose.js';
import { hasBook, hasChair, sampleMotion } from './motion.js';
import { CHARACTER_FRAME, characterPixelScale } from './camera.js';
import { CHARACTER_OUTLINE_WIDTH } from './authored-surfaces.js';
import {releaseCharacterOnDeviceLoss} from './resources.js';
import {posedCageSurface} from './geometry-proof.js';

export class CharacterRenderer {
  private inspection: {color:GPUTexture;surface:GPUTexture;identity:GPUTexture;depth:GPUTexture}|null=null;
  private inspectionTargets(){
    if(!this.inspection){const texture=(format:GPUTextureFormat)=>this.device.createTexture({size:[this.width,this.height],format,
      usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
      this.inspection={color:texture('rgba8unorm'),surface:texture('r32float'),identity:texture('r32uint'),depth:texture('depth24plus')};}
    return this.inspection;
  }
  get color():GPUTexture{return this.inspectionTargets().color;}
  get surface():GPUTexture{return this.inspectionTargets().surface;}
  get identity():GPUTexture{return this.inspectionTargets().identity;}
  private get depth():GPUTexture{return this.inspectionTargets().depth;}
  get allocatedTextureBytes():number{return this.inspection?this.width*this.height*16:0;}

  private readonly mesh:CharacterMeshResources;
  private readonly uniforms:GPUBuffer;
  private readonly group:GPUBindGroup;
  private readonly pipeline:GPURenderPipeline;
  private readonly outline:GPURenderPipeline;
  private readonly scenePipeline:GPURenderPipeline;
  private readonly sceneOutline:GPURenderPipeline;
  private readonly data=new Float32Array(68);
  private appearance=neutralAppearance();
  private appearanceKey='';
  private closed=false;
  private readonly forgetLoss:()=>void;

  constructor(readonly device:GPUDevice,geometry:Geometry,readonly width:number,readonly height:number,
    private readonly framing:{zoom?:number;groundFraction?:number}={},shared?:CharacterMeshResources){
    this.mesh=shared??new CharacterMeshResources(device,geometry);this.mesh.retain();
    this.uniforms=device.createBuffer({size:272,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const pipelines=characterDevicePipelines(device);
    this.group=device.createBindGroup({layout:pipelines.layout,entries:[this.uniforms,this.mesh.skeleton,this.mesh.staticResources.buffers.materials]
      .map((buffer,binding)=>({binding,resource:{buffer}}))});
    this.pipeline=pipelines.fill;this.outline=pipelines.outline;this.scenePipeline=pipelines.sceneFill;this.sceneOutline=pipelines.sceneOutline;
    this.data.fill(1,12,44);
    this.forgetLoss=releaseCharacterOnDeviceLoss(device,()=>this.destroy());
  }
  get geometry():Geometry{return this.mesh.geometry;}
  get resources():CharacterMeshResources{return this.mesh;}
  createView(width:number,height:number):CharacterRenderer{return new CharacterRenderer(this.device,this.geometry,width,height,{},this.mesh);}
  setGeometry(geometry:Geometry):void{this.mesh.setGeometry(geometry);}
  setPoseSource(matrices:Float32Array<ArrayBuffer>):void{this.mesh.poseSource=matrices;}
  get poseMatrices():Float32Array<ArrayBuffer>{if(!this.mesh.lastMatrices)throw new Error('Character pose is unavailable.');return this.mesh.lastMatrices;}

  setAppearance(appearance: AppearanceProofV1, sourceColors: readonly typeof colorFields[number][] = []): void {
    this.appearanceKey = '';
    this.appearance = { ...appearance };
    this.mesh.configure({...appearance},this.geometry.manifest.version===2?(appearance.hairstyle==='bob'?9:8):null);
    this.data[60]=0;
    this.data.fill(1,12,44);
    {
      const sourceNames = ['Warm ochre skin', 'Chestnut hair planes', 'Washed sage overshirt', 'Slate cotton trousers', 'Warm charcoal shoes'];
      colorFields.forEach((key, group) => {
        if (sourceColors.includes(key)) return;
        const material = this.geometry.manifest.materials.find(m => m.name === sourceNames[group]);
        if (!material) throw new Error('Character color reference is missing');
        const reference = material.ramp.at(-1)?.colour ?? material.colour;
        const hex = appearance[key];
        for (let c = 0; c < 3; c++) {
          const srgb = parseInt(hex.slice(1 + c*2, 3 + c*2), 16) / 255;
          this.data[12 + group*4 + c] = Math.pow(srgb, 2.2) / Math.max(.001, reference[c]);
        }
      });
    }
  }

  setCharacterAppearance(appearance: CharacterAppearanceV1): void {
    validateAppearance(appearance);
    if (this.geometry.manifest.version !== 3) throw new Error('The full appearance requires the creator asset bundle.');
    const key=JSON.stringify(appearance);
    if(key===this.appearanceKey)return;
    const shape={presentation:appearance.presentation,...appearance.body,face:{...appearance.face}};
    this.mesh.configure(shape);
    this.data[60]=appearance.freckles?appearance.freckle_density/100:0;
    this.data.fill(1,12,44);
    const references = ['Warm ochre skin', 'Chestnut hair planes', 'Washed sage overshirt', 'Slate cotton trousers',
      'Warm charcoal shoes', '', 'Hazel iris', 'Creator facial hair'];
    const keys = ['skin', 'hair', 'shirt', 'trousers', 'shoes', null, 'eyes', 'facial_hair'] as const;
    keys.forEach((key, group) => {
      if (key === null) return;
      const material = this.geometry.manifest.materials.find(m => m.name === references[group]);
      if (!material) throw new Error(`Character color reference is missing: ${references[group]}`);
      const reference = material.ramp.at(-1)?.colour ?? material.colour;
      const rgb = appearance.colors[key];
      const undertone = key === 'skin' ? appearance.undertone : 'neutral';
      const tint = undertone === 'warm' ? [1.04, 1, .94] : undertone === 'cool' ? [.96, 1, 1.04] : [1, 1, 1];
      for (let c = 0; c < 3; c++) this.data[12 + group * 4 + c] = Math.pow(rgb[c] / 255, 2.2) * tint[c] / Math.max(.001, reference[c]);
    });
    this.appearanceKey=key;
  }

  restGeometry(): Float32Array<ArrayBuffer> { return this.mesh.deformed.slice(); }
  preparedSurface(action:string,frame:number):Float32Array<ArrayBuffer> {
    this.preparePose(action,frame,0,0,{});
    return posedCageSurface(this.geometry,this.mesh.deformed,this.poseMatrices);
  }
  anchors(facing:number,offset:Vec3=[0,0,0]):{head:Vec3;feet:Vec3;hand:Vec3} {
    if(!this.mesh.lastMatrices)throw new Error('Render a character before reading its anchors.');
    const bone=(name:string)=>{const index=this.geometry.manifest.bones.findIndex(bone=>bone.name===name);if(index<0)throw new Error('Missing anchor bone: '+name);return index;};
    const posed=(index:number,p:Vec3)=>transform(this.mesh.lastMatrices!.subarray(index*16,index*16+16),p);
    const foot=(side:string)=>{const index=bone('foot.'+side);return posed(index,shapePoint(this.geometry.manifest.bones[index].head,6,this.mesh.shape,this.mesh.top));};
    const rotate=(point:Vec3):Vec3=>{const p=add(point,offset),c=Math.cos(facing),s=Math.sin(facing);return [c*p[0]-s*p[1],s*p[0]+c*p[1],p[2]];};
    const hand=bone('hand.R');
    this.mesh.headEnvelope!.pose(this.mesh.lastMatrices);
    return {head:add(this.mesh.headEnvelope!.top(facing),rotate([0,0,0])),feet:rotate(scale(add(foot('L'),foot('R')),.5)),
      hand:rotate(posed(hand,shapePoint(this.geometry.manifest.bones[hand].tail,4,this.mesh.shape,this.mesh.top)))};
  }
  setFraming(zoom: number, groundFraction: number): void {
    if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(groundFraction) || groundFraction <= 0 || groundFraction >= 1) throw new Error('Invalid character framing.');
    this.framing.zoom=zoom;this.framing.groundFraction=groundFraction;
  }
  get allocatedBufferBytes(): number {
    return this.allocatedSharedBufferBytes+this.allocatedPrivateBufferBytes;
  }
  get allocatedSharedBufferBytes():number{return this.mesh.staticResources.bytes;}
  get allocatedPrivateBufferBytes():number {
    return this.mesh.privateBytes+this.uniforms.size;
  }
  get pixelScale(): number { return characterPixelScale(this.width, this.height) * (this.framing.zoom ?? 1); }
  get groundFraction(): number { return this.framing.groundFraction ?? CHARACTER_FRAME.groundY / CHARACTER_FRAME.height; }

  private preparePose(action:string,frame:number,facing:number,id:number,options:{offset?:Vec3;includeFixture?:boolean}):boolean {
    const metadata=this.geometry.manifest.clipMetadata?.[action];
    if(metadata?.playback==='static')frame=0;else if(metadata?.stepSamples)frame=Math.floor(frame);
    const key=action+':'+frame,changed=this.mesh.poseSource?this.mesh.lastMatrices!==this.mesh.poseSource:this.mesh.lastPoseKey!==key||!this.mesh.lastMatrices;
    const matrices = this.mesh.poseSource??(!changed?this.mesh.lastMatrices! : this.mesh.configured ? configuredPose(this.geometry.manifest, this.mesh.shape, action, frame, this.mesh.top, undefined, this.geometry,this.mesh.bikeContact,this.mesh.sleepContact) : new Float32Array(this.geometry.manifest.bones.length * 16));
    if (changed&&!this.mesh.configured&&!this.mesh.poseSource) {
      const poses=sampleMotion(this.geometry.manifest,action,frame).source;
      this.geometry.manifest.bones.forEach((bone, i) => matrices.set(multiply(poses[i], bone.inverseRest), i * 16));
    }
    if(changed){this.device.queue.writeBuffer(this.mesh.skeleton,0,matrices);this.mesh.lastPoseKey=key;this.mesh.lastMatrices=matrices;this.mesh.surfaceDirty=true;}
    this.data.set([this.width, this.height, this.pixelScale, this.groundFraction,
      facing, CHARACTER_OUTLINE_WIDTH, id, Number(hasBook(action))]);
    this.data.set([Number(this.appearance.hairstyle === 'bob'), Number(hasChair(action)), Number(this.geometry.manifest.version === 3), 0], 8);
    this.data.set([...(options.offset??[0,0,0]),Number(options.includeFixture!==false)],44);
    return changed;
  }
  prepareScene(action:string,frame:number,facing:number,id:number,
    placement:{width:number;height:number;x:number;y:number;scale:number;depth:number;step:number;light:Vec3},
    options:{offset?:Vec3;includeFixture?:boolean;fixtureToken?:number;fixtureColourway?:Vec3}={}):void {
    this.preparePose(action,frame,facing,id,options);
    this.data.set([placement.width,placement.height,placement.x,placement.y],48);
    this.data.set([placement.scale,placement.depth,placement.step,1],52);
    this.data.set([...placement.light,1],56);
    this.data.set([options.fixtureToken??0,...(options.fixtureColourway??[0,0,0])],64);
    this.device.queue.writeBuffer(this.uniforms,0,this.data);
    if(this.mesh.surfaceDirty){const encoder=this.device.createCommandEncoder();this.mesh.subdivision.encode(encoder);this.mesh.surfaceDirty=false;this.device.queue.submit([encoder.finish()]);}
  }
  drawScene(pass:GPURenderPassEncoder,phase?:'outline'|'fill'):void {
    pass.setBindGroup(0,this.group);pass.setVertexBuffer(0,this.mesh.vertex);pass.setVertexBuffer(1,this.mesh.skinCoordinates);pass.setIndexBuffer(this.mesh.staticResources.buffers.index,'uint32');
    if(phase!=='fill'){pass.setPipeline(this.sceneOutline);for(const range of this.mesh.outlineRanges)pass.drawIndexed(range.count,1,range.start);}
    if(phase!=='outline'){pass.setPipeline(this.scenePipeline);for(const range of this.mesh.fillRanges)pass.drawIndexed(range.count,1,range.start);}
  }
  drawSceneRange(pass:GPURenderPassEncoder,phase:'outline'|'fill',range:{start:number;count:number},bind=true):void {
    if(bind){pass.setBindGroup(0,this.group);pass.setVertexBuffer(0,this.mesh.vertex);pass.setVertexBuffer(1,this.mesh.skinCoordinates);pass.setIndexBuffer(this.mesh.staticResources.buffers.index,'uint32');
      pass.setPipeline(phase==='outline'?this.sceneOutline:this.scenePipeline);}
    pass.drawIndexed(range.count,1,range.start);
  }
  render(action = 'idle', frame = 0, facing = 0, id = 1, options:{offset?:Vec3;includeFixture?:boolean}={}): void {
    this.preparePose(action,frame,facing,id,options);this.data[55]=0;
    this.device.queue.writeBuffer(this.uniforms,0,this.data);
    const encoder = this.device.createCommandEncoder();
    if(this.mesh.surfaceDirty){this.mesh.subdivision.encode(encoder);this.mesh.surfaceDirty=false;}
    const pass = encoder.beginRenderPass({
      colorAttachments: [this.color, this.surface, this.identity].map(t => ({ view: t.createView(), loadOp: 'clear' as const, storeOp: 'store' as const, clearValue: [0, 0, 0, 0] })),
      depthStencilAttachment: { view: this.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
    });
    pass.setBindGroup(0, this.group); pass.setVertexBuffer(0, this.mesh.vertex);pass.setVertexBuffer(1,this.mesh.skinCoordinates); pass.setIndexBuffer(this.mesh.staticResources.buffers.index, 'uint32');
    pass.setPipeline(this.outline);
    for (const range of this.mesh.outlineRanges) pass.drawIndexed(range.count, 1, range.start);
    pass.setPipeline(this.pipeline);for(const range of this.mesh.fillRanges)pass.drawIndexed(range.count,1,range.start);
    pass.end(); this.device.queue.submit([encoder.finish()]);
  }

  async pick(x: number, y: number): Promise<number> {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const buffer = this.device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: this.identity, origin: [x, y] }, { buffer, bytesPerRow: 256 }, [1, 1]);
      this.device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
      return new Uint32Array(buffer.getMappedRange())[0];
    } finally { buffer.unmap(); buffer.destroy(); }
  }

  async surfacePositions(): Promise<Float32Array<ArrayBuffer>> {
    const buffer=this.device.createBuffer({size:this.geometry.vertices.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try {
      const encoder=this.device.createCommandEncoder();encoder.copyBufferToBuffer(this.mesh.vertex,0,buffer,0,this.geometry.vertices.byteLength);
      this.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const data=new Float32Array(buffer.getMappedRange()),out=new Float32Array(this.geometry.description.vertexCount*3);
      if(data.some(value=>!Number.isFinite(value)))throw new Error('GPU produced non-finite surface data');
      for(let i=0,j=0;i<data.length;i+=16,j+=3)out.set(data.subarray(i,i+3),j);
      return out;
    } finally{buffer.unmap();buffer.destroy();}
  }

  destroy(): void {
    if(this.closed)return;this.closed=true;this.forgetLoss();
    this.uniforms.destroy();this.mesh.release();
    if(this.inspection)for(const t of Object.values(this.inspection))t.destroy();
  }
}
