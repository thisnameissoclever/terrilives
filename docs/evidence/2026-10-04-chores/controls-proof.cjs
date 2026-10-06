async(page)=>{
 const browser=page.context().browser(),result={};const evidence='D:/VIBES/.worktrees/a8a4/terrilives/docs/evidence/2026-10-04-chores/';
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:1});
  const p=await context.newPage();try{
   await p.goto('http://127.0.0.1:5188/?stress=0&audio=0');await p.waitForFunction(()=>!!globalThis.__terriStress);
   await p.getByRole('button',{name:'Got it',exact:true}).click();await p.locator('label[for="speed-0"]').click();
   await p.evaluate(async()=>{const s=globalThis.__terriStress.sim;const r=await fetch('/.tmp/chores.sav');if(!r.ok||!s.loadBytes(new Uint8Array(await r.arrayBuffer())))throw Error('Invalid fixture');s.setSpeed(0);s.flushCommands();globalThis.__terriStress.step();});
   if(!mobile){
    const point=await p.evaluate(()=>{const h=globalThis.__terriStress;return {x:h.origin.x+(1-4)*32,y:h.origin.y+(1+4)*21};});
    await p.mouse.click(point.x,point.y,{button:'right'});await p.getByText('Clean floor',{exact:true}).waitFor();
    await p.screenshot({path:evidence+'floor-context-menu.png'});await p.getByText('Clean floor',{exact:true}).focus();await p.keyboard.press('Enter');
    result.keyboardFloor=await p.evaluate(()=>{const s=globalThis.__terriStress.sim;s.flushCommands();return s.actionQueueOf(s.selectedIndex());});
    if(!result.keyboardFloor.some(x=>x?.includes('Clean floor')))throw Error('Keyboard menu order missing');
   }
   await p.getByRole('button',{name:'Options',exact:true})[mobile?'tap':'click']();await p.getByRole('button',{name:'Chores',exact:true})[mobile?'tap':'click']();
   const responsibility=p.getByLabel('Responsibility',{exact:true});await responsibility.fill(mobile?'88':'84');
   if(mobile)await p.getByRole('button',{name:'Apply preferences',exact:true}).tap();else{await p.getByRole('button',{name:'Apply preferences',exact:true}).focus();await p.keyboard.press('Enter');}
   await p.evaluate(()=>globalThis.__terriStress.step());const profile=await p.evaluate(()=>[...globalThis.__terriStress.sim.choreProfileOf(globalThis.__terriStress.sim.selectedIndex())]);
   if(profile[0]!== (mobile?88:84))throw Error('Profile controls failed');
   const dialog=p.locator('#chores-dialog');await dialog.evaluate(e=>e.scrollTop=0);const box=await dialog.boundingBox();
   const dimensions=await dialog.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
   if(!box||box.x<0||box.x+box.width>(mobile?390:1280)||dimensions.scroll>dimensions.width)throw Error('Dialog clips horizontally');
   await p.screenshot({path:evidence+(mobile?'mobile-board':'keyboard-board')+'.png'});
   const row=p.locator('.chore-row').filter({hasText:'Empty bin:'});const button=row.getByRole('button',{name:'Do now',exact:true});
   if(mobile)await button.tap();else{await button.focus();await p.keyboard.press('Enter');}
   const orders=await p.evaluate(()=>{const s=globalThis.__terriStress.sim;s.flushCommands();return s.actionQueueOf(s.selectedIndex());});
   if(!orders.some(x=>x?.includes('Empty bin')))throw Error('Do now activation missing');
   result[mobile?'touch':'keyboard']={profile,orders,viewport:mobile?[390,844]:[1280,900],bounds:box,dimensions};
  }finally{await context.close();}
 }
 return result;
}
