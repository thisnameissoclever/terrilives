import {CURRENT_SAVE_VERSION} from '../src/storage/save-header.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {hasClearablePlayerOrders} from '../src/ui/player-orders.js';
import {characterActionPlan} from '../src/render/character/action-plan.js';

it('projects native phases and clears accepted cancellation ownership while the exit remains saved',async()=>{
  const wasm=await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')}),handle=new SimHandle(12,12),sim=new SimBridge(handle,wasm.memory);
  try{
    expect(sim.spawnObject(4,4,'pool')).toBe(true);sim.spawnAgent(3,4,50);
    const actor=Array.from(sim.ids()).find((_,row)=>sim.kinds()[row]===0)!,pool=Array.from(sim.ids()).find((_,row)=>sim.kinds()[row]!==0)!;
    expect(sim.select(actor)).toBe(true);expect(sim.useObjectFirst(actor,pool,0)).toBe(true);sim.flushCommands();
    const row=()=>Array.from(sim.ids()).indexOf(actor);
    for(let tick=0;tick<100&&sim.poolPhases()[row()]!==1;tick++)sim.tick();
    expect(sim.poolPhases()[row()]).toBe(1);expect(sim.activities()[row()]).toBe(27);expect(sim.visualActions()[row()]).toBe(23);
    expect(sim.interactionTargets()[row()]).toBe(pool);expect(hasClearablePlayerOrders(sim)).toBe(true);
    for(let tick=0;tick<7;tick++)sim.tick();
    const elapsed=sim.poolElapsed()[row()];
    expect(sim.cancelIntents(actor)).toBe(true);sim.flushCommands();
    expect(sim.poolPhases()[row()]).toBe(4);expect(sim.poolElapsed()[row()]).toBe(elapsed);
    expect(hasClearablePlayerOrders(sim)).toBe(false);
    const bytes=handle.save_bytes();expect(Array.from(bytes.slice(8,10))).toEqual([CURRENT_SAVE_VERSION,0]);
    expect(handle.load_bytes(bytes)).toBe(true);expect(handle.save_bytes()).toEqual(bytes);
    expect(sim.poolPhases()[row()]).toBe(4);expect(sim.poolElapsed()[row()]).toBe(elapsed);
    const trailing=new Uint8Array(bytes.length+1);trailing.set(bytes);
    expect(handle.load_bytes(trailing)).toBe(false);expect(handle.save_bytes()).toEqual(bytes);
    for(let tick=0;tick<elapsed;tick++)sim.tick();
    expect(sim.poolPhases()[row()]).toBe(0);expect(hasClearablePlayerOrders(sim)).toBe(false);
  }finally{handle.free();}
});

it.skipIf(!process.env.POOL_REVIEW_FIXTURES)('loads every retained native review fixture with the matching release WASM',async()=>{
  const folder=process.env.POOL_REVIEW_FIXTURES!,wasmBytes=readFileSync('src/wasm/terri_wasm_bg.wasm');
  const wasm=await init({module_or_path:wasmBytes}),handle=new SimHandle(12,12),sim=new SimBridge(handle,wasm.memory);
  const manifest=JSON.parse(readFileSync(join(folder,'manifest.json'),'utf8')) as {schema:number;files:{file:string;actor:number;pool?:number;hasEpisode?:boolean;phase?:number;elapsed?:number;exitOrigin?:number}[]};
  const files=[];
  try{
    expect([22,32,CURRENT_SAVE_VERSION]).toContain(manifest.schema);
    for(const fixture of manifest.files){
      const bytes=readFileSync(join(folder,fixture.file));expect(sim.loadBytes(bytes),fixture.file).toBe(true);
      const current=sim.saveBytes();
      if(manifest.schema===CURRENT_SAVE_VERSION)expect(current,fixture.file).toEqual(new Uint8Array(bytes));
      else {
        expect(Array.from(current.subarray(8,10))).toEqual([CURRENT_SAVE_VERSION,0]);
        expect(sim.loadBytes(current),fixture.file+' current continuation').toBe(true);
        expect(sim.saveBytes(),fixture.file+' stable current resave').toEqual(current);
      }
      expect(sim.prevPoolPhases()).toEqual(sim.poolPhases());expect(sim.prevPoolElapsed()).toEqual(sim.poolElapsed());
      if(fixture.pool!==undefined){const row=Array.from(sim.ids()).indexOf(fixture.actor);
        expect(row).toBeGreaterThanOrEqual(0);expect(sim.poolPhases()[row]).toBe(fixture.phase);
        expect(sim.poolElapsed()[row]).toBe(fixture.elapsed);expect(sim.poolExitOrigins()[row]).toBe(fixture.exitOrigin);
      }
      files.push({file:fixture.file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    writeFileSync(join(folder,`wasm-receipt-v${CURRENT_SAVE_VERSION}.json`),JSON.stringify({schema:manifest.schema,outputSchema:CURRENT_SAVE_VERSION,wasmSha256:createHash('sha256').update(wasmBytes).digest('hex'),
      generatorSha256:createHash('sha256').update(readFileSync('../crates/terri-wasm/examples/pool_review_saves.rs')).digest('hex'),
      publicLoadRoundtrip:true,previousProjectionReset:true,files},null,2));
  }finally{handle.free();}
});

it('feeds actual previous/current native phases to fractional display through pause, cancellation, release and load',async()=>{
  const wasm=await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')}),handle=new SimHandle(12,12),sim=new SimBridge(handle,wasm.memory);
  try{
    expect(sim.spawnObject(4,4,'pool')).toBe(true);sim.spawnAgent(3,4,50);
    const actor=1,pool=0,idle=sim.saveBytes(),row=()=>Array.from(sim.ids()).indexOf(actor);
    const display=(alpha:number,reducedMotion=false)=>{const r=row();return characterActionPlan({
      action:sim.visualActions()[r],activity:sim.activities()[r],entity:actor,facing:1,x:3,y:4,tick:sim.clockTick()+alpha,
      reducedMotion,fixtureModel:'pool',wholeSeat:false,readingStage:0,carriedBook:false,carriedDishes:false,carriedDinner:false,
      shelfSlot:0,reachRemaining:0,reachTotal:0,progress:0,poolAlpha:alpha,poolExitTicks:sim.poolExitTicks(),
      poolPhase:sim.poolPhases()[r],poolElapsed:sim.poolElapsed()[r],poolExitOrigin:sim.poolExitOrigins()[r],
      prevPoolPhase:sim.prevPoolPhases()[r],prevPoolElapsed:sim.prevPoolElapsed()[r],prevPoolExitOrigin:sim.prevPoolExitOrigins()[r],
    },clip=>clip==='pool_paddle'?12:41);};
    expect(sim.useObjectFirst(actor,pool,0)).toBe(true);sim.flushCommands();
    for(let i=0;i<100&&sim.poolPhases()[row()]!==2;i++)sim.tick();
    expect(sim.poolPhases()[row()]).toBe(2);
    expect(display(.5)).toEqual({clip:'pool_enter',sample:39,fixture:true});
    for(let i=0;i<17;i++)sim.tick();
    const before=display(.625),still=display(.625,true);
    expect(before).toEqual({clip:'pool_paddle',sample:4.625,fixture:true});
    expect(sim.setSpeed(0)).toBe(true);sim.flushCommands();expect(display(.625)).toEqual(before);
    expect(sim.cancelIntents(actor)).toBe(true);sim.flushCommands();
    expect(display(.625)).toEqual(before);expect(display(.625,true)).toEqual(still);
    expect(sim.setSpeed(1)).toBe(true);sim.flushCommands();expect(display(.625)).toEqual(before);
    sim.tick();expect(display(.5)).toEqual({clip:'pool_exit_5',sample:.5,fixture:true});
    expect(display(.5,true)).toEqual({clip:'pool_exit_0',sample:.5,fixture:true});
    const bytes=sim.saveBytes();expect(sim.loadBytes(bytes)).toBe(true);
    expect(sim.prevPoolPhases()).toEqual(sim.poolPhases());expect(sim.prevPoolElapsed()).toEqual(sim.poolElapsed());
    expect(display(.25)).toEqual(display(.75));
    for(let i=0;i<sim.poolExitTicks()&&sim.poolPhases()[row()]!==0;i++)sim.tick();
    expect(sim.poolPhases()[row()]).toBe(0);
    expect(sim.prevPoolTargets()[row()]).toBe(pool);
    expect(display(.5)).toEqual({clip:'pool_exit_5',sample:39.5,fixture:true});
    expect(sim.loadBytes(idle)).toBe(true);
    expect(sim.prevPoolPhases()[row()]).toBe(0);expect(sim.poolPhases()[row()]).toBe(0);
  }finally{handle.free();}
});
