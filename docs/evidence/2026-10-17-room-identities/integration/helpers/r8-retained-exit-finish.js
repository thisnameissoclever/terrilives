async page=>{
  await page.locator('#stage').focus();await page.waitForTimeout(150);
  for(let n=0;n<5;n++)await page.keyboard.press('ArrowUp');
  const receipts=[];
  for(let y=2;y<=7;y++){
    if(y>2)await page.keyboard.press('ArrowDown');await page.keyboard.press('Delete');
    await page.waitForFunction(y=>{const r=__terriStress.sim.lastWallEditResult();return r?.axis===0&&r.x===18&&r.y===y&&r.state===0&&r.reason===null;},y);
    receipts.push(await page.evaluate(()=>__terriStress.sim.lastWallEditResult()));
  }
  const clean=await page.evaluate(()=>{const b=__terriStress.sim.saveBytes();return {nativeDirty:__terriStress.sim.buildDirty(),baselineExact:b.length===__r8RoomBaseline.length&&b.every((v,i)=>v===__r8RoomBaseline[i])};});
  if(clean.nativeDirty||!clean.baselineExact)throw Error('Reversal not exact');
  await page.locator('#builder-exit').click();await page.locator('#build-exit-dialog').waitFor({state:'visible'});await page.screenshot({path:'.local-build/r8-retained-name-exit-prompt.png'});
  await page.locator('#build-exit-keep').click();await page.waitForTimeout(100);
  if(!await page.evaluate(()=>__terriStress.sim.buildActive()))throw Error('Keep building left');
  await page.locator('#builder-exit').click();await page.locator('#build-exit-confirm').click();await page.waitForFunction(()=>!document.querySelector('#room-review').hidden);
  const names=await page.locator('#room-review-body input').evaluateAll(nodes=>nodes.map(n=>n.value));if(!names.includes('Retained final name'))throw Error('Name missing');
  await page.screenshot({path:'.local-build/r8-retained-name-refreshed-review.png'});
  const clicks=[];for(let n=0;n<2&&await page.evaluate(()=>__terriStress.sim.buildActive());n++){clicks.push(await page.locator('#room-review-confirm').textContent());await page.locator('#room-review-confirm').click();await page.waitForTimeout(150);}
  if(await page.evaluate(()=>__terriStress.sim.buildActive()))throw Error('Exit not complete');
  const final=await page.evaluate(async()=>(await import('/.scratch/r8-play-observe.js')).observe('retained-name-adopted-and-left'));
  if(!final.rooms.value.rooms.some(r=>r.name==='Retained final name'))throw Error('Name not adopted');return {receipts,clean,names,clicks,final};
}
