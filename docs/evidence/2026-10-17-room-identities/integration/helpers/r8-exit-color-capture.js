async page=>{
  await page.mouse.move(1100,450);await page.mouse.down();await page.mouse.move(1100,512.9997806549072,{steps:10});await page.mouse.up();
  await page.locator('#build-toggle').click();await page.locator('#build-tool-room').click();await page.locator('#room-selection').selectOption('0');await page.locator('#room-name').fill('Color proof');await page.locator('#builder-exit').click();await page.locator('#build-exit-dialog').waitFor({state:'visible'});
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  const read=()=>page.evaluate(()=>({tick:__terriStress.sim.clockTick(),view:__terriStress.characters.snapshot().view,focus:document.activeElement?.id,buttons:[...document.querySelectorAll('#build-exit-dialog button')].map(b=>({id:b.id,text:b.textContent,enabled:!b.disabled,role:b.dataset.actionIntent,bg:getComputedStyle(b).backgroundColor,color:getComputedStyle(b).color,outline:getComputedStyle(b).outline,rect:b.getBoundingClientRect().toJSON()}))}));
  const current=await read();if(current.tick!==838||current.view.originX!==336||Math.abs(current.view.originY+289)>.01||current.view.scale!==1)throw Error('Scene not matched');
  const originals=await page.evaluate(()=>[...document.querySelectorAll('#build-exit-dialog button')].map(b=>({id:b.id,role:b.dataset.actionIntent,html:b.outerHTML})));
  try{
    await page.evaluate(()=>{for(const b of document.querySelectorAll('#build-exit-dialog button'))b.removeAttribute('data-action-intent');});
    await page.screenshot({path:'.local-build/r8-exit-color-a.png'});const fault=await read();
    await page.evaluate(rows=>{for(const r of rows)document.getElementById(r.id).setAttribute('data-action-intent',r.role);},originals);
    await page.screenshot({path:'.local-build/r8-exit-color-b.png'});const restored=await read();
    const exact=await page.evaluate(rows=>rows.every(r=>document.getElementById(r.id).outerHTML===r.html),originals);if(!exact)throw Error('Attributes not exactly restored');
    return {current,fault,restored,exactRestoration:true,conditionMap:{'r8-exit-color-a.png':'isolated removal of three intent attributes','r8-exit-color-b.png':'current fixed-source attributes restored'}};
  }finally{await page.evaluate(rows=>{for(const r of rows)document.getElementById(r.id).setAttribute('data-action-intent',r.role);},originals);}
}
