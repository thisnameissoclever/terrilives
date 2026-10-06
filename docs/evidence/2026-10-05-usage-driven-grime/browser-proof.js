async (page) => {
  const context = await page.context().browser().newContext({viewport:{width:1280,height:900}});
  const result={levels:[],cleaning:null,warnings:[],failedRequests:[]};
  try {
    const p=await context.newPage();
    p.on('console',m=>{if(['warning','error'].includes(m.type()))result.warnings.push(m.text());});
    p.on('response',r=>{if(r.status()>=400)result.failedRequests.push([r.status(),r.url()]);});
    await p.goto('http://127.0.0.1:5193/.tmp/chores-normal.html');
    await p.waitForFunction(()=>globalThis.__terriStress?.sim);
    if(await p.getByRole('button',{name:'Got it',exact:true}).isVisible())await p.getByRole('button',{name:'Got it',exact:true}).click();
    await p.locator('label[for="speed-0"]').click();
    const base='D:/VIBES/.worktrees/a8a4/terrilives/.superpowers/sdd/usage-driven-grime/';
    for(const amount of [100,500,1000]) {
      const state=await p.evaluate(async amount=>{
        const h=globalThis.__terriStress,s=h.sim;
        const bytes=new Uint8Array(await (await fetch(`/.tmp/grime-${amount}.sav`)).arrayBuffer());
        if(!s.loadBytes(bytes))throw new Error('fixture rejected');h.step();
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        return {amount,grime:Array.from(s.floorGrime()),needs:Array.from(s.needsOf(s.selectedIndex()))};
      },amount);
      result.levels.push(state);
      await p.screenshot({path:base+`opacity-${amount/10}.png`});
      await p.screenshot({path:base+`opacity-${amount/10}-detail.png`,clip:{x:400,y:150,width:500,height:450}});
    }
    await p.getByRole('button',{name:'Chores',exact:true}).click();
    await p.locator('.chore-row').filter({hasText:'Clean floor in Kitchen'}).getByRole('button',{name:'Do now'}).click();
    result.cleaning=await p.evaluate(async()=>{
      const h=globalThis.__terriStress,s=h.sim;
      const cells=[45,46,47,65,66,67,85,86,87];
      function amounts(){const rows=s.floorGrime(),map=new Map();for(let i=0;i<rows.length;i+=2)map.set(rows[i],rows[i+1]);return cells.map(c=>map.get(c)||0);}
      let travel=0;for(;travel<180;travel++){s.tick();if(amounts().every(n=>n>0&&n<1000))break;}
      if(travel===180)throw new Error('patch did not start together');const first=amounts();
      for(let i=0;i<11;i++)s.tick();
      const half=amounts(),hash=s.worldHash().toString(),bytes=s.saveBytes();
      const loaded=s.loadBytes(bytes),sameHash=hash===s.worldHash().toString();h.step();
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      return {travelTicks:travel,first,half,loaded,sameHash};
    });
    await p.screenshot({path:base+'patch-half.png'});
    await p.screenshot({path:base+'patch-half-detail.png',clip:{x:400,y:150,width:500,height:450}});
    result.cleaning.end=await p.evaluate(async()=>{
      const h=globalThis.__terriStress,s=h.sim;for(let i=0;i<12;i++)s.tick();h.step();
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const rows=Array.from(s.floorGrime());return {grime:rows,needs:Array.from(s.needsOf(s.selectedIndex()))};
    });
    await p.screenshot({path:base+'patch-clean.png'});
    await p.screenshot({path:base+'patch-clean-detail.png',clip:{x:400,y:150,width:500,height:450}});
    return result;
  } finally {await context.close();}
}
