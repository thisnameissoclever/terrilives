async page => {
  const read=phase=>page.evaluate(async phase=>(await import('/.scratch/r8-play-observe.js')).observe(phase),phase);
  const receipts=[];await page.locator('#stage').focus();
  for(let n=0;n<3;n++)await page.keyboard.press('ArrowRight');
  for(let n=0;n<11;n++)await page.keyboard.press('ArrowUp');
  async function apply(y,state){await page.keyboard.press(state?'w':'Delete');await page.waitForFunction(({y,state})=>{const r=__terriStress.sim.lastWallEditResult();return r?.axis===0&&r.x===18&&r.y===y&&r.state===state&&r.reason===null;},{y,state});receipts.push(await page.evaluate(()=>__terriStress.sim.lastWallEditResult()));}
  for(let y=2;y<=7;y++){if(y>2)await page.keyboard.press('ArrowDown');await apply(y,1);}
  await page.locator('#build-batch-confirm').click();await page.waitForFunction(()=>!document.querySelector('#room-review').hidden);
  await page.locator('#room-review-body input').first().fill('Retained final name');await page.locator('#room-review-back').click();
  await page.locator('#stage').focus();for(let n=0;n<5;n++)await page.keyboard.press('ArrowUp');
  for(let y=2;y<=7;y++){if(y>2)await page.keyboard.press('ArrowDown');await apply(y,0);}
  const clean=await page.evaluate(()=>{const s=__terriStress.sim,b=s.saveBytes();return {nativeDirty:s.buildDirty(),baselineExact:b.length===__r8RoomBaseline.length&&b.every((v,i)=>v===__r8RoomBaseline[i])};});
  if(clean.nativeDirty||!clean.baselineExact)throw Error('Reversal not exact');
  await page.locator('#builder-exit').click();await page.locator('#build-exit-dialog').waitFor({state:'visible'});await page.screenshot({path:'.local-build/r8-retained-name-exit-prompt.png'});
  await page.locator('#build-exit-keep').click();if(!await page.evaluate(()=>__terriStress.sim.buildActive()))throw Error('Keep building left');
  await page.locator('#builder-exit').click();await page.locator('#build-exit-confirm').click();await page.waitForFunction(()=>!document.querySelector('#room-review').hidden);
  const review=await page.locator('#room-review').textContent(),names=await page.locator('#room-review-body input').evaluateAll(nodes=>nodes.map(n=>n.value));
  if(!names.includes('Retained final name'))throw Error('Retained name missing');await page.screenshot({path:'.local-build/r8-retained-name-refreshed-review.png'});
  const clicks=[];for(let n=0;n<2&&await page.evaluate(()=>__terriStress.sim.buildActive());n++){clicks.push(await page.locator('#room-review-confirm').textContent());await page.locator('#room-review-confirm').click();await page.waitForTimeout(150);}
  if(await page.evaluate(()=>__terriStress.sim.buildActive()))throw Error('Exit did not finish');
  const final=await read('retained-name-adopted-and-left');if(!final.rooms.value.rooms.some(r=>r.name==='Retained final name'))throw Error('Name not adopted');
  return {route:'Documented keyboard wall selection/apply controls; separate pointer observation retained',receipts,clean,review,names,clicks,final};
}
