const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const out=path.resolve('docs/evidence/2026-10-12-full-character-creator/game-activities');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),rows=fs.existsSync(path.join(out,'report.json'))?JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8')).rows:[],errors=[];
 try{const context=await browser.newContext({viewport:{width:1600,height:1150}});
  const cases=[{id:'shower',model:'shower',interaction:0,action:0,activity:12,clip:'shower',people:[1]},
   {id:'shared-bed',model:'double_bed',interaction:0,action:9,clip:'bed_sleep',people:[1,2]},
   {id:'shared-sofa',model:'long_sofa',interaction:1,action:8,clip:'seat_sofa_sit',people:[1,2]},
   {id:'exercise',model:'moving_box',interaction:0,action:6,clip:'exercise',people:[1]},
   {id:'wipe-counter',model:'counter',action:15,clip:'wipe_counter',people:[1],fixtureBytes:Array.from(fs.readFileSync('docs/evidence/2026-10-12-full-character-creator/fixtures/dirty-counter.sav'))}];
  for(const scenario of cases)for(let facing=0;facing<4;facing++){
   if(rows.some(row=>row.scenario===scenario.id&&row.setup.facing===facing))continue;
   if(process.env.CASE_FILTER&&!process.env.CASE_FILTER.split(',').includes(scenario.id))continue;
   const page=await context.newPage();page.on('pageerror',e=>errors.push(`${scenario.id}/${facing}: ${e}`));
   try{await page.goto('http://127.0.0.1:5187/?stress=0');await page.waitForFunction(()=>window.__terriStress,null,{timeout:120000});if(await page.locator('#help-panel').evaluate(el=>el.open))await page.locator('#close-help').click();await page.getByText('Pause',{exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const setup=await page.evaluate(async({scenario,facing})=>{
     const sim=window.__terriStress.sim,{default:init,SimHandle}=await import('/src/wasm/terri_wasm.js'),{defaultAppearance}=await import('/src/character/schema.ts');await init();const fresh=SimHandle.from_lot();try{if(!(await window.__terriStress.characters.loadBytes(scenario.fixtureBytes?Uint8Array.from(scenario.fixtureBytes):fresh.save_bytes())))throw Error('Fresh fixture refused');}finally{fresh.free();}
     const fixture=Array.from(sim.ids()).find(id=>sim.objectModel(id)?.id===scenario.model),originalRow=Array.from(sim.ids()).indexOf(fixture),x=sim.positions()[originalRow*2],y=sim.positions()[originalRow*2+1];
     const candidates=[];for(let cy=0;cy<13;cy++)for(let cx=0;cx<16;cx++)candidates.push({x:cx,y:cy});candidates.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));const verifiedBed=[null,{x:1,y:9},{x:0,y:8},{x:1,y:9}];const verifiedSofa=[null,null,{x:10,y:1},{x:10,y:0}];const preferred=scenario.id==='shared-bed'?verifiedBed[facing]:scenario.id==='shared-sofa'?verifiedSofa[facing]:null;const spot=preferred??candidates.find(p=>sim.placementPreview(fixture,p.x,p.y,facing).reason===null);if(!spot)throw Error('No legal rotated fixture location');
     if(!sim.placeObject(fixture,spot.x,spot.y,facing))throw Error('Placement not queued');sim.flushCommands();if(sim.lastPlacementResult()?.reason!==null||sim.objectFacing(fixture)!==facing)throw Error('Placement refused');
     const people=scenario.people.map(id=>sim.characterAppearances().find(p=>p.sim===id));
     for(const person of people){const a=defaultAppearance(person.sim===1?'feminine':'masculine');a.body.height=person.sim===1?0:100;a.body.build=person.sim===1?100:0;
      if(!(await window.__terriStress.characters.edit(11000+person.sim, person.sim, {version:1,appearance:a}))||!(scenario.id==='wipe-counter'?sim.cleanChore(person.entity,2,fixture,true):sim.useObject(person.entity,fixture,scenario.interaction)))throw Error('Activity not queued');}
     sim.flushCommands();let matched=false;
     for(let tick=0;tick<400;tick++){sim.tick();matched=people.every(person=>{const row=Array.from(sim.ids()).indexOf(person.entity);return sim.visualActions()[row]===scenario.action&&(scenario.activity===undefined||sim.activities()[row]===scenario.activity)&& (scenario.id==='shower'?sim.soundSources()[row]===fixture:scenario.id==='shared-bed'?sim.sleepingBeds()[row]===fixture:scenario.id==='shared-sofa'?sim.seatedFurniture()[row]===fixture:sim.interactionTargets()[row]===fixture);});if(matched&&scenario.people.length>1){const places=people.map(p=>{const row=Array.from(sim.ids()).indexOf(p.entity);return scenario.id==='shared-bed'?sim.sleepingPlaces()[row]:sim.seatedPlaces()[row];});matched=new Set(places).size===people.length;}if(matched)break;}
     if(!matched)throw Error('Activity predicate failed '+JSON.stringify(people.map(p=>({sim:p.sim,queue:sim.actionQueueOf(p.entity)}))));
     return {tick:sim.clockTick(),fixture,spot,facing,people:people.map(p=>p.sim)};
    },{scenario,facing});
    await page.waitForFunction(({scenario,setup})=>setup.people.every(id=>window.__terriStress.characters.snapshot().actors.some(a=>a.sim===id&&a.clip===scenario.clip&&(scenario.id==='wipe-counter'||a.fixture===setup.fixture))),{scenario,setup});
    const before=await page.evaluate(()=>window.__terriStress.characters.snapshot());await page.screenshot({path:path.join(out,`${scenario.id}-${facing}.png`)});
    const roundTrip=await page.evaluate(async ()=>{const sim=window.__terriStress.sim,before=sim.characterAppearances(),bytes=sim.saveBytes(),hash=sim.worldHash();return (await window.__terriStress.characters.loadBytes(bytes))&&sim.worldHash()===hash&&JSON.stringify(sim.characterAppearances())===JSON.stringify(before);});assert.equal(roundTrip,true);
    rows.push({scenario:scenario.id,setup,scene:before,roundTrip});console.log('Captured '+scenario.id+' facing '+facing);
   }catch(error){await page.screenshot({path:path.join(out,`${scenario.id}-${facing}-failure.png`)}).catch(()=>{});throw error;}finally{await page.close();}
  }
  if(!process.env.CASE_FILTER)assert.equal(rows.length,20);assert.deepEqual(errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({rows,errors,expected:20},null,2));}
 console.log(JSON.stringify({captured:rows.length,errors}));
})().catch(error=>{console.error(error);process.exitCode=1});
