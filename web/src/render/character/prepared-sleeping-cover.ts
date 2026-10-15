import type {Geometry} from './bundle.js';
import {createSleepingCoverFromContributions,updateSleepingCoverFromContributions} from './sleep-cover.js';
import {CharacterRenderer} from './renderer.js';
import {identity} from './math.js';
import {defaultAppearance} from '../../character/schema.js';
import {CharacterMeshResources} from './mesh-resources.js';
import {anatomicalHeight} from './shape.js';

/** A physical fixture owns its cover topology and GPU mesh across occupancy changes. */
export class PreparedSleepingCover {
  readonly geometry:Geometry;
  private readonly views:CharacterRenderer[]=[];
  private contributions:readonly ArrayLike<number>[]=[];
  private closed=false;
  readonly metrics={updates:0};
  constructor(device:GPUDevice,scene:Geometry,readonly bunk:boolean,width:number,height:number){
    this.geometry=createSleepingCoverFromContributions(scene,[],bunk);
    const mesh=new CharacterMeshResources(device,this.geometry,{top:anatomicalHeight(scene.vertices)});
    const renderer=new CharacterRenderer(device,this.geometry,width,height,{},mesh),matrices=new Float32Array(this.geometry.manifest.bones.length*16);
    for(let index=0;index<matrices.length;index+=16)matrices.set(identity(),index);
    renderer.setCharacterAppearance(defaultAppearance());renderer.setPoseSource(matrices);this.views.push(renderer);
  }
  view(index:number,width:number,height:number):CharacterRenderer {
    if(this.closed)throw new Error('Sleeping cover is closed.');
    if(!this.views[index]){if(index!==this.views.length)throw new Error('Sleeping cover views must be consecutive.');this.views.push(this.views[0].createView(width,height));}
    const view=this.views[index];if(view.width!==width||view.height!==height)throw new Error('Sleeping cover view size differs.');return view;
  }
  update(contributions:readonly ArrayLike<number>[]):void {
    if(this.closed)throw new Error('Sleeping cover is closed.');
    if(contributions.length===this.contributions.length&&contributions.every((value,index)=>value===this.contributions[index]))return;
    this.contributions=contributions.slice();updateSleepingCoverFromContributions(this.geometry,contributions,this.bunk);
    this.views[0].resources.updateFixedGeometry();this.metrics.updates++;
  }
  get renderer():CharacterRenderer{return this.views[0];}
  destroy():void {if(this.closed)return;this.closed=true;for(const view of this.views)view.destroy();this.views.length=0;}
}
