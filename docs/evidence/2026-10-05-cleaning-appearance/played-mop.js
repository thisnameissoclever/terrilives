async(page)=>{
  const context=await page.context().browser().newContext({viewport:{width:1280,height:900}});
  const result={samples:[],warnings:[],failedRequests:[]};
  const base='D:/VIBES/.worktrees/a8a4/terrilives/.superpowers/sdd/cleaning-appearance/played/';
  try {
    const p=await context.newPage();
    p.on('console',m=>{if(['warning','error'].includes(m.type()))result.warnings.push(m.text());});
    p.on('response',r=>{if(r.status()>=400)result.failedRequests.push([r.status(),r.url()]);});
    await p.goto('http://127.0.0.1:5193/.tmp/chores-normal.html');
    await p.waitForFunction(()=>globalThis.__terriStress?.sim);
    if(await p.getByRole('button',{name:'Got it',exact:true}).isVisible())await p.getByRole('button',{name:'Got it',exact:true}).click();
    await p.locator('label[for="speed-0"]').click();
    result.start=await p.evaluate(async()=>{
      const h=globalThis.__terriStress,s=h.sim;
      if(!s.loadBytes(new Uint8Array(await(await fetch('/.tmp/grime-casey.sav')).arrayBuffer())))throw new Error('fixture rejected');
      const ids=Array.from(s.ids()),row=Array.from(s.simIds()).findIndex((id,i)=>id===2&&s.kinds()[i]===0);
      if(row<0)throw new Error('Casey not found');
      const actor=ids[row];
      if(s.visualActions()[row]!==14)throw new Error('Casey fixture must contain active floor work');
      h.step();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const x=s.positions()[row*2],y=s.positions()[row*2+1];
      return {actor,row,faceX:(x-y)*32+h.origin.x,faceY:(x+y)*21+h.origin.y-47,position:[x,y]};
    });
    for(const zoom of [1,2,4]) {
      if(zoom>1) {await p.mouse.move(result.start.faceX,result.start.faceY);await p.mouse.wheel(0,-Math.log(2)/.0012);}
      await p.evaluate(async()=>{globalThis.__terriStress.step();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
      await p.screenshot({path:base+`mop-zoom-${zoom}.png`});
    }
    result.paused=await p.evaluate(async()=>{const s=globalThis.__terriStress.sim,before=s.worldHash().toString();for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);return before===s.worldHash().toString();});
    for(let frame=0;frame<24;frame++) {
      const sample=await p.evaluate(async advance=>{const h=globalThis.__terriStress,s=h.sim;if(advance)s.tick();h.step();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const row=Array.from(s.simIds()).findIndex((id,i)=>id===2&&s.kinds()[i]===0);return {action:s.visualActions()[row],progress:s.choreProgress()[row],grime:Array.from(s.floorGrime())};},frame>0);
      result.samples.push(sample);
      await p.screenshot({path:base+`mop-${String(frame).padStart(2,'0')}.png`});
    }
    return result;
  } finally {await context.close();}
}
