async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1280,height:900}});
  const result={cases:[],warnings:[],failedRequests:[]};
  const base='D:/VIBES/.worktrees/a8a4/terrilives/.superpowers/sdd/cleaning-animations/motion/';
  try {
    const p=await context.newPage();
    p.on('console',m=>{if(['warning','error'].includes(m.type()))result.warnings.push(m.text());});
    p.on('response',r=>{if(r.status()>=400)result.failedRequests.push([r.status(),r.url()]);});
    await p.goto('http://127.0.0.1:5193/.tmp/chores-normal.html');
    await p.waitForFunction(()=>globalThis.__terriStress?.sim);
    if(await p.getByRole('button',{name:'Got it',exact:true}).isVisible())await p.getByRole('button',{name:'Got it',exact:true}).click();
    await p.locator('label[for="speed-0"]').click();
    await p.mouse.move(636,400);await p.mouse.wheel(0,-550);
    for(const name of ['counter','dining_table','trashcan'])for(let facing=1;facing<=4;facing++) {
      const initial=await p.evaluate(async({name,facing})=>{
        const h=globalThis.__terriStress,s=h.sim;
        const bytes=new Uint8Array(await(await fetch(`/.tmp/cleaning-${name}-${facing}.sav`)).arrayBuffer());
        if(!s.loadBytes(bytes))throw new Error('fixture rejected');
        const object=Array.from(s.ids()).find((_,i)=>s.kinds()[i]===1);
        if(!s.cleanChore(s.selectedIndex(),name==='trashcan'?3:2,object,true))throw new Error('order rejected');
        s.tick();h.step();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        return {actor:s.selectedIndex(),object,action:s.visualActions()[1],facing:s.facings()[1]};
      },{name,facing});
      const item={name,facing,initial,samples:[]};result.cases.push(item);
      const steps=name==='trashcan'?20:15;
      for(let i=0;i<steps;i++) {
        const state=await p.evaluate(async(advance)=>{
          const h=globalThis.__terriStress,s=h.sim;
          for(let j=0;j<advance;j++)s.tick();h.step();
          await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
          return {actions:Array.from(s.visualActions()),progress:Array.from(s.choreProgress()),positions:Array.from(s.positions()),grime:Array.from(s.surfaceGrime())};
        },i===0?0:3);
        item.samples.push(state);
        await p.screenshot({path:base+`${name}-${facing}-${String(i).padStart(2,'0')}.png`,clip:{x:425,y:170,width:440,height:440}});
        if(i===Math.floor(steps/2)) {
          item.roundTrip=await p.evaluate(()=>{const s=globalThis.__terriStress.sim,hash=s.worldHash().toString(),progress=Array.from(s.choreProgress()),save=s.saveBytes();s.tick();if(!s.loadBytes(save))throw new Error('work save rejected');return {sameHash:hash===s.worldHash().toString(),sameProgress:JSON.stringify(progress)===JSON.stringify(Array.from(s.choreProgress()))};});
        }
      }
      item.finished=await p.evaluate(async()=>{const h=globalThis.__terriStress,s=h.sim;for(let i=0;i<4;i++)s.tick();h.step();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return {actions:Array.from(s.visualActions()),progress:Array.from(s.choreProgress()),grime:Array.from(s.surfaceGrime())};});
      await p.screenshot({path:base+`${name}-${facing}-${String(steps).padStart(2,'0')}.png`,clip:{x:425,y:170,width:440,height:440}});
      await p.screenshot({path:base+`${name}-${facing}-full.png`});
    }
    return result;
  } finally {await context.close();}
}
