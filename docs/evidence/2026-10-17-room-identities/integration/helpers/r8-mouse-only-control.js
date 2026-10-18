async page=>{
  await page.locator('#build-tool-walls').click();await page.locator('#stage').focus();await page.waitForTimeout(150);
  const snap=()=>page.evaluate(()=>({view:__terriStress.characters.snapshot().view,origin:{...__terriStress.origin},graphics:__terriStress.graphicsGeneration,lot:__terriStress.sim.lotRevision(),selected:__terriStress.sim.selectedIndex(),walls:document.querySelector('#build-tool-walls').getAttribute('aria-pressed'),reviewHidden:document.querySelector('#room-review').hidden,status:document.querySelector('#wall-status').textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id)}));
  const before=await snap();if(before.view.scale!==1||before.view.originX!==before.origin.x||before.view.originY!==before.origin.y)throw Error('Camera/view not matched');
  const proof=await page.evaluate(async()=>(await import('/.scratch/r7-wall-helper.js')).wallPoint({axis:0,x:28,y:2}));
  await page.evaluate(()=>{window.__r8PointerEvents=[];window.__r8PointerObserver=e=>__r8PointerEvents.push({type:e.type,target:e.target.id,x:e.clientX,y:e.clientY,pointerId:e.pointerId,pointerType:e.pointerType,buttons:e.buttons,key:e.key,time:e.timeStamp,prevented:e.defaultPrevented});for(const type of ['pointerdown','pointerup','pointercancel','click','keydown'])document.addEventListener(type,__r8PointerObserver,true);});
  try{
    await page.mouse.click(proof.point.x,proof.point.y);
    let settled=true;try{await page.waitForFunction(()=>document.querySelector('#wall-status').textContent==='No wall on this line.',null,{timeout:5000});}catch{settled=false;}
    const after=await snap();await page.screenshot({path:'.local-build/r8-mouse-only-selection.png'});
    let native=null,pick=null;
    if(settled){await page.keyboard.press('w');await page.waitForFunction(()=>{const r=__terriStress.sim.lastWallEditResult();return r?.axis===0&&r.x===28&&r.y===2&&r.state===1&&r.reason===null;},null,{timeout:5000});native=await page.evaluate(()=>__terriStress.sim.lastWallEditResult());await page.locator('#build-batch-cancel').click();}
    else {const started=Date.now();pick=await page.evaluate(async point=>{const hit=await __terriStress.characters.pick(Math.floor(point.x),Math.floor(point.y));return {kind:hit===undefined?'undefined':hit===null?'null':'hit',hit};},proof.point);pick.elapsedMs=Date.now()-started;}
    return {before,proof,settled,after,native,pick,events:await page.evaluate(()=>__r8PointerEvents)};
  }finally{await page.evaluate(()=>{for(const type of ['pointerdown','pointerup','pointercancel','click','keydown'])document.removeEventListener(type,__r8PointerObserver,true);});}
}
