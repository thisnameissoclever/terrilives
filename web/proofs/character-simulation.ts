import { SimBridge } from '../src/bridge.js';
import { SimHandle } from '../src/wasm/terri_wasm.js';
import { FixedStepDriver, advanceSimulationFrame, walkingFacing, READ_FRAME_TICKS } from '../src/frame.js';
import { distanceAnimationSample, tickAnimationSample } from '../src/render/sim-animation.js';
import { RIGGED_SIM_VARIANTS } from '../src/render/atlas.js';

export class MotionStudy {
  private driver = new FixedStepDriver(10,5);
  private alpha = 0;
  private active = false;
  private destroyed = false;
  constructor(readonly sim: SimBridge, private readonly handle: SimHandle, readonly entity: number,
    readonly mode: 'walk' | 'read') { this.driver.setSpeed(0); }
  get playing(): boolean { return this.active; }
  get gridSize(): number { return this.handle.lot_width(); }
  play(active: boolean): void { this.active=active;this.driver.setSpeed(active?1:0); }
  advance(milliseconds: number): void {
    if(!this.active)return;
    this.alpha=advanceSimulationFrame(this.driver,milliseconds,this.sim);
    if(this.sample().action!==this.mode)this.play(false);
  }
  step(): void {
    this.play(false);this.sim.tick();this.alpha=0;
    this.driver=new FixedStepDriver(10,5);this.driver.setSpeed(0);
  }
  sample() {
    const ids=this.sim.ids(),row=ids.indexOf(this.entity);
    if(row<0)throw new Error('Motion study person is missing');
    const current=this.sim.positions(),previous=this.sim.prevPositions(),visual=this.sim.visualActions()[row];
    const positionRow=visual===3?ids.indexOf(this.sim.readingSeats()[row]):row;
    if(positionRow<0)throw new Error('Seated simulation study has no supporting fixture');
    const x=previous[positionRow*2]+(current[positionRow*2]-previous[positionRow*2])*this.alpha;
    const y=previous[positionRow*2+1]+(current[positionRow*2+1]-previous[positionRow*2+1])*this.alpha;
    const facing=visual===5?walkingFacing(previous[row*2],previous[row*2+1],current[row*2],current[row*2+1],this.sim.facings()[row]):this.sim.facings()[row];
    const angle=[0,Math.PI/2,3*Math.PI/2,0,Math.PI][facing];
    if(angle===undefined)throw new Error('Unsupported simulation facing');
    const action=visual===5?'walk':visual===3?'read':visual===4?'stand_read':'idle';
    const tick=this.sim.clockTick()+this.alpha;
    const frame=action==='walk'?distanceAnimationSample(x,y,facing,8,RIGGED_SIM_VARIANTS.green.walk.cycleTiles!,false)
      :action==='read'||action==='stand_read'?tickAnimationSample(tick,this.entity%READ_FRAME_TICKS,4,2*READ_FRAME_TICKS/4,false):0;
    return {entity:this.entity,action,frame,facing,angle,x,y,tick,simulationTick:this.sim.clockTick(),alpha:this.alpha};
  }
  destroy(): void { if(!this.destroyed){this.destroyed=true;this.handle.free();} }
}

/** Build an owned test world using real game commands, never a player's save. */
export function createMotionStudy(memory: WebAssembly.Memory,mode:'walk'|'read',facing:number):MotionStudy {
  if(![1,2,3,4].includes(facing))throw new Error('Invalid motion study facing');
  const handle=mode==='walk'?new SimHandle(16,16):SimHandle.from_lot(),sim=new SimBridge(handle,memory);
  const require=(value:boolean,message:string)=>{if(!value)throw new Error(message);};
  try{
    let entity:number;
    if(mode==='walk'){
      require(sim.spawnObject(3,3,'armchair'),'Could not create walking destination');
      const starts=[[0,0],[1,3],[6,3],[3,1],[3,6]];
      sim.spawnAgent(...starts[facing] as [number,number],100);
      const action=sim.objectModel(0)!.actions.findIndex(a=>a.id==='take_the_chair');
      require(action>=0&&sim.useObject(1,0,action),'Could not direct study walking');
      entity=1;
    }else{
      const ids=Array.from(sim.ids());
      const chair=ids.find(id=>sim.objectModel(id)?.id==='armchair');
      const person=ids.find(id=>sim.simName(id));
      const book=sim.bookCopies()[0];
      require(chair!==undefined&&person!==undefined&&!!book,'Authored reading study resources are missing');
      entity=person!;
      // Spawn-only test worlds have no commerce occupancy grid or household identity.
      // Use an isolated authored lot for real book ownership and legal chair placement.
      const fixtureFacing=[0,3,1,0,2][facing];
      const locations:{x:number;y:number}[]=[];
      for(let y=1;y<handle.lot_height()-1;y++)for(let x=1;x<handle.lot_width()-1;x++)locations.push({x,y});
      locations.sort((a,b)=>(a.x-18)**2+(a.y-18)**2-((b.x-18)**2+(b.y-18)**2));
      const destination=locations.find(p=>sim.placementPreview(chair!,p.x,p.y,fixtureFacing).reason===null);
      require(!!destination,'No legal reading study location');
      require(sim.placeObject(chair!,destination!.x,destination!.y,fixtureFacing),'Could not queue study chair placement');
      sim.flushCommands();
      require(sim.lastPlacementResult()?.reason===null&&sim.objectFacing(chair!)===fixtureFacing,'Study chair placement was refused');
      require(sim.readBook(entity,chair!,'read',book.titleId,true),'Could not direct study reading');
      sim.flushCommands();
      require(sim.takeBookResults().every(r=>r.refusal===null),'Study reading request was refused');
    }
    const expected=mode==='walk'?5:3;
    for(let i=0;i<1000;i++){
      sim.tick();const row=sim.ids().indexOf(entity);
      if(sim.visualActions()[row]===expected&&sim.facings()[row]===facing)return new MotionStudy(sim,handle,entity,mode);
    }
    throw new Error(`Simulation did not reach ${mode} facing ${facing}`);
  }catch(error){handle.free();throw error;}
}
