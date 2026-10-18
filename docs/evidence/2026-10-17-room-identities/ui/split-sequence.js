async page => {
 await page.getByRole('button',{name:'Options',exact:true}).click();await page.getByRole('button',{name:'Load',exact:true}).click();await page.getByRole('button',{name:'Load game',exact:true}).click();
 await page.waitForFunction(()=>{const e=Array.from(__terriStress.sim.wallEdges());return !e.some((v,i)=>i%4===0&&v===0&&e[i+1]===18&&e[i+2]===2);});
 await page.getByRole('button',{name:'Walls',exact:true}).click();
 await page.evaluate(()=>{window.__r7FinalSplitReceipts=[]});
 for(let y=2;y<=7;y++) {
  if(y>2)await page.keyboard.press('Escape');
  const proof=await page.evaluate(async y=>{const {wallPoint}=await import('/.scratch/r7-wall-helper.js?v=2');return wallPoint({axis:0,x:18,y},1)},y);
  await page.mouse.click(proof.point.x,proof.point.y);
  await page.waitForFunction(()=>document.querySelector('#wall-status').textContent==='No wall on this line.');
  await page.keyboard.press('w');
  await page.waitForFunction(y=>{const sim=__terriStress.sim,r=sim.lastWallEditResult(),e=Array.from(sim.wallEdges());return r?.axis===0&&r.x===18&&r.y===y&&r.state===1&&r.reason===null&&e.some((v,i)=>i%4===0&&v===0&&e[i+1]===18&&e[i+2]===y);},y);
  await page.evaluate(proof=>window.__r7FinalSplitReceipts.push({proof,result:__terriStress.sim.lastWallEditResult()}),proof);
 }
 await page.locator('#build-batch-confirm').click();await page.getByLabel('Resulting room name',{exact:true}).nth(1).fill('<b>Hall</b>');
}
