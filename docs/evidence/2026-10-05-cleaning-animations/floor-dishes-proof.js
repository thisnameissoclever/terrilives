async(page)=>{
  const context=await page.context().browser().newContext({viewport:{width:1280,height:900}});
  const result={floor:[],dishes:[],warnings:[]};
  const base='D:/VIBES/.worktrees/a8a4/terrilives/.superpowers/sdd/cleaning-animations/motion/';
  try {
    const p=await context.newPage();
    p.on('console',m=>{if(['warning','error'].includes(m.type()))result.warnings.push(m.text());});
    await p.goto('http://127.0.0.1:5193/.tmp/chores-normal.html');
    await p.waitForFunction(()=>globalThis.__terriStress?.sim);
    if(await p.getByRole('button',{name:'Got it',exact:true}).isVisible())await p.getByRole('button',{name:'Got it',exact:true}).click();
    await p.locator('label[for="speed-0"]').click();
    await p.evaluate(async()=>{const s=globalThis.__terriStress.sim;const bytes=new Uint8Array(await(await fetch('/.tmp/grime-1000.sav')).arrayBuffer());if(!s.loadBytes(bytes))throw new Error('floor fixture rejected');globalThis.__terriStress.step();});
    await p.getByRole('button',{name:'Chores',exact:true}).click();
    await p.locator('.chore-row').filter({hasText:'Clean floor in Kitchen'}).getByRole('button',{name:'Do now'}).click();
    await p.evaluate(()=>{const s=globalThis.__terriStress.sim;for(let i=0;i<180;i++){s.tick();if(s.visualActions().includes(14))return;}throw new Error('mop did not start');});
    for(let frame=0;frame<24;frame++) {
      result.floor.push(await p.evaluate(async advance=>{const h=globalThis.__terriStress,s=h.sim;if(advance)s.tick();h.step();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return {actions:Array.from(s.visualActions()),progress:Array.from(s.choreProgress()),grime:Array.from(s.floorGrime())};},frame>0));
      await p.screenshot({path:base+`floor-${String(frame).padStart(2,'0')}.png`,clip:{x:390,y:140,width:520,height:500}});
    }
    await p.evaluate(async()=>{const s=globalThis.__terriStress.sim;const bytes=new Uint8Array(await(await fetch('/.tmp/targeted-cleanup.sav')).arrayBuffer());if(!s.loadBytes(bytes))throw new Error('dish fixture rejected');const pile=s.dishPiles();if(!s.cleanDishesFirst(s.selectedIndex(),pile[0],null))throw new Error('dish order rejected');});
    let carry=0,wash=0;
    for(let i=0;i<1000 && wash<16;i++) {
      const state=await p.evaluate(async()=>{const h=globalThis.__terriStress,s=h.sim;s.tick();h.step();await new Promise(requestAnimationFrame);const row=Array.from(s.ids()).indexOf(s.selectedIndex());return {tick:s.clockTick(),action:s.visualActions()[row],carrying:s.carriedDishes()[row]};});
      const capture=(state.carrying>0&&state.action===5&&carry<8&&i%3===0)||(state.action===12&&i%2===0);
      if(!capture)continue;
      result.dishes.push(state);
      const name=state.action===12?`wash-${String(wash++).padStart(2,'0')}`:`carry-${String(carry++).padStart(2,'0')}`;
      await p.screenshot({path:base+name+'.png',clip:{x:340,y:80,width:620,height:580}});
    }
    if(carry===0||wash<4)throw new Error(`missing dish motion ${carry}/${wash}`);
    return result;
  } finally {await context.close();}
}
