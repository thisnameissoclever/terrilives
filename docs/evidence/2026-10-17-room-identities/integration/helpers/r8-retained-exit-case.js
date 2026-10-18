async page => {
  const read=phase=>page.evaluate(async phase=>(await import('/.scratch/r8-play-observe.js')).observe(phase),phase);
  await page.locator('#build-toggle').click();
  await page.locator('#build-tool-room').click();await page.locator('#room-selection').selectOption('1');
  await page.locator('#room-name').fill('Workshop');await page.keyboard.press('Enter');
  await page.locator('#build-tool-walls').click();await page.locator('#build-tool-room').click();
  if(await page.locator('#room-name').inputValue()!=='Workshop')throw Error('Name lost across tool change');
  await page.locator('#build-batch-confirm').click();await page.waitForFunction(()=>!__terriStress.sim.buildDirty());
  await page.evaluate(()=>window.__r8RoomBaseline=__terriStress.sim.saveBytes());
  const baseline=await read('room-exit-baseline');
  await page.locator('#build-tool-walls').click();
  const receipts=[];
  async function wall(y,state){
    const clear=page.locator('#placement-actions').getByRole('button',{name:'Clear',exact:true});if(await clear.isVisible())await clear.click();
    const proof=await page.evaluate(async y=>(await import('/.scratch/r7-wall-helper.js')).wallPoint({axis:0,x:18,y}),y);
    await page.mouse.click(proof.point.x,proof.point.y);await page.keyboard.press(state?'w':'Delete');
    await page.waitForFunction(({y,state})=>{const r=__terriStress.sim.lastWallEditResult();return r?.axis===0&&r.x===18&&r.y===y&&r.state===state&&r.reason===null;},{y,state});
    receipts.push({proof,result:await page.evaluate(()=>__terriStress.sim.lastWallEditResult())});
  }
  for(let y=2;y<=7;y++)await wall(y,1);
  await page.locator('#build-batch-confirm').click();await page.waitForFunction(()=>!document.querySelector('#room-review').hidden);
  await page.locator('#room-review-body input').first().fill('Retained final name');
  await page.locator('#room-review-back').click();
  for(let y=2;y<=7;y++)await wall(y,0);
  const clean=await page.evaluate(()=>{const s=__terriStress.sim,b=s.saveBytes();return {nativeDirty:s.buildDirty(),baselineExact:b.length===__r8RoomBaseline.length&&b.every((v,i)=>v===__r8RoomBaseline[i])};});
  if(clean.nativeDirty||!clean.baselineExact)throw Error('Reversal is not exactly clean');
  await page.locator('#builder-exit').click();await page.locator('#build-exit-dialog').waitFor({state:'visible'});
  await page.screenshot({path:'.local-build/r8-retained-name-exit-prompt.png'});
  await page.locator('#build-exit-keep').click();
  if(!await page.evaluate(()=>__terriStress.sim.buildActive()))throw Error('Keep building left');
  await page.locator('#builder-exit').click();await page.locator('#build-exit-confirm').click();
  await page.waitForFunction(()=>!document.querySelector('#room-review').hidden);
  const review=await page.locator('#room-review').textContent(),names=await page.locator('#room-review-body input').evaluateAll(nodes=>nodes.map(n=>n.value));
  if(!names.includes('Retained final name'))throw Error('Retained review name missing');
  await page.screenshot({path:'.local-build/r8-retained-name-refreshed-review.png'});
  const clicks=[];
  for(let n=0;n<2&&await page.evaluate(()=>__terriStress.sim.buildActive());n++){
    clicks.push(await page.locator('#room-review-confirm').textContent());await page.locator('#room-review-confirm').click();
    await page.waitForTimeout(150);
  }
  if(await page.evaluate(()=>__terriStress.sim.buildActive()))throw Error('Reviewed exit did not finish');
  const final=await read('retained-name-adopted-and-left');
  if(!final.rooms.value.rooms.some(r=>r.name==='Retained final name'))throw Error('Name not adopted');
  return {baseline,receipts,clean,review,names,clicks,final};
}
