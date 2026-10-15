import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {initDevice} from '../src/render/device.js';
import {CreatorSession} from '../src/ui/character-creator/session.js';
import {CreatorView} from '../src/ui/character-creator/view.js';
import {CreatorPreview} from '../src/ui/character-creator/preview.js';
import {defaultAppearance,type CharacterAppearanceV1} from '../src/character/schema.js';
import {CharacterContactOwner,CharacterContactRoster,sharedCharacterPreparation} from '../src/render/character/contact-admission.js';
import {loadPreparedCharacterState} from '../src/render/character/prepared-character-load.js';

async function start(){
  const wasm=await init(),handle=SimHandle.from_lot(),bridge=new SimBridge(handle,wasm.memory);
  const contacts=sharedCharacterPreparation(),roster=new CharacterContactRoster(contacts);await roster.prepareCurrent(bridge.characterAppearances());
  const gpu=await initDevice(document.querySelector<HTMLCanvasElement>('#bootstrap')!);
  const root=document.querySelector<HTMLElement>('#creator')!,result=document.querySelector<HTMLElement>('#result')!;
  const errors:string[]=[];gpu.device.addEventListener('uncapturederror',event=>{errors.push(event.error.message);result.textContent=event.error.message;});
  let view:CreatorView|null=null,session:CreatorSession|null=null,clipPreview:CreatorPreview|null=null,closed=false;
  let clipOwner:CharacterContactOwner|null=null;
  const closeView=()=>{view?.destroy();session?.destroy();clipPreview?.destroy();clipPreview=null;view=null;session=null;};
  const close=()=>{closeView();clipOwner?.dispose();clipOwner=null;};
  const open=(sim:number|null,seed=crypto.getRandomValues(new Uint32Array(1))[0])=>{
    close();const household=bridge.characterAppearances().map(row=>({sim_id:row.sim,name:bridge.characterSnapshot(row.sim)!.name}));
    session=new CreatorSession(bridge,seed,household,sim,entity=>{result.textContent=`Applied character at entity ${entity}.`;close();},new CharacterContactOwner(contacts,roster));
    view=new CreatorView(root,session,gpu.device,gpu.format,()=>{close();result.textContent='Cancelled.';});
    result.textContent='Isolated development household.';
  };
  document.querySelector('#new')!.addEventListener('click',()=>open(null));
  document.querySelector('#edit')!.addEventListener('click',()=>open(0));
  const tick=()=>{if(closed)return;handle.flush_commands();view?.afterCommands();roster.afterCommands(bridge.characterAppearances());requestAnimationFrame(tick);};requestAnimationFrame(tick);
  window.addEventListener('pagehide',()=>{closed=true;close();roster.dispose();handle.free();gpu.device.destroy();},{once:true});
  Object.assign(window,{creatorHarness:{open,close,errors,defaultAppearance,
    get draft(){return session?.draft;},get value(){return session?.draft.resolve();},
    worldHash:()=>bridge.worldHash().toString(),appearanceHash:()=>bridge.appearanceHash().toString(),
    save:()=>Array.from(handle.save_bytes()),load:(bytes:number[])=>loadPreparedCharacterState(Uint8Array.from(bytes),bridge,()=>{
      const candidate=SimHandle.from_lot(),source=new SimBridge(candidate,wasm.memory);
      return {loadBytes:(bytes:Uint8Array)=>source.loadBytes(bytes),characterAppearances:()=>source.characterAppearances(),flushCommands:()=>source.flushCommands(),free:()=>candidate.free()};
    },roster),
    snapshot:(sim:number)=>bridge.characterSnapshot(sim),
    drawClip:async(appearance:CharacterAppearanceV1,action:string,frame:number,facing:number)=>{
      closeView();clipOwner??=new CharacterContactOwner(contacts);root.innerHTML='<canvas width="608" height="800"></canvas><canvas width="96" height="128"></canvas>';
      const canvases=root.querySelectorAll('canvas');clipPreview=new CreatorPreview(gpu.device,gpu.format,canvases[0],canvases[1],{prepare:appearance=>clipOwner!.prepare(appearance)});
      await clipPreview.draw(appearance,facing,action,frame);
    },
  }});
  open(null,1413);
}
void start().catch(error=>{document.querySelector('#result')!.textContent=String(error);Object.assign(window,{creatorHarnessError:String(error)});});
