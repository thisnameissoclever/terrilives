async page => {
 const s=await page.context().newCDPSession(page), result={phase:'setup',errors:[]};
 const original=await s.send('Browser.getWindowForTarget');
 if(original.windowId!==742959663)throw Error('Unexpected task window');
 const inventory=await page.evaluate(()=>window.__r7Ownership);
 if(inventory.length!==2||inventory.some(row=>row.window.windowId!==original.windowId||row.target.targetInfo.browserContextId!=='8A480153BEBBC41B446E44F3FDCA61F6'))throw Error('Window ownership mismatch');
 result.window=original;result.inventory=inventory;
 try {
  await page.bringToFront();
  await s.send('Emulation.setFocusEmulationEnabled',{enabled:false});
  await page.waitForFunction(()=>document.visibilityState==='visible'&&document.querySelector('#save-status').textContent!=='Saving',undefined,{polling:100,timeout:10000});
  const initial=await page.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden,status:document.querySelector('#save-status').textContent,active:__terriStress.sim.buildActive(),dirty:__terriStress.sim.buildDirty(),review:!document.querySelector('#room-review').hidden}));
  result.initial=initial;
  if(initial.status==='Game saved'||!initial.active||!initial.dirty||!initial.review)throw Error('Control baseline is not the required idle dirty review');
  await page.evaluate(()=>{
   const probe=window.__r7NaturalVisibility={baseline:Array.from(__terriStress.sim.saveBytes()),events:[],statuses:[],actionAt:performance.now()};
   probe.listener=event=>probe.events.push({state:document.visibilityState,isTrusted:event.isTrusted,time:performance.now()});
   document.addEventListener('visibilitychange',probe.listener);
   probe.observer=new MutationObserver(()=>probe.statuses.push({text:document.querySelector('#save-status').textContent,time:performance.now()}));
   probe.observer.observe(document.querySelector('#save-status'),{subtree:true,childList:true,characterData:true});
  });
  result.phase='minimize';
  try {
   await s.send('Browser.setWindowBounds',{windowId:original.windowId,bounds:{windowState:'minimized'}});
   await page.waitForFunction(()=>{const p=window.__r7NaturalVisibility;const hide=p.events.find(e=>e.state==='hidden'&&e.isTrusted&&e.time>=p.actionAt),saving=p.statuses.find(e=>e.text==='Saving'&&e.time>=p.actionAt),saved=p.statuses.find(e=>e.text==='Game saved'&&saving&&e.time>=saving.time);return document.hidden&&hide&&saving&&saved},undefined,{polling:100,timeout:10000});
   result.hidden=await page.evaluate(async()=>{
    const p=window.__r7NaturalVisibility,root=await navigator.storage.getDirectory(),file=await root.getFileHandle('terri-save-1.bin'),bytes=new Uint8Array(await(await file.getFile()).arrayBuffer());
    return {visibility:document.visibilityState,hidden:document.hidden,bytes:bytes.length,header:Array.from(bytes.slice(8,10)),same:bytes.length===p.baseline.length&&bytes.every((v,i)=>v===p.baseline[i]),active:__terriStress.sim.buildActive(),dirty:__terriStress.sim.buildDirty(),review:!document.querySelector('#room-review').hidden,events:p.events,statuses:p.statuses};
   });
  } finally {
   result.phase='restore';
   await s.send('Browser.setWindowBounds',{windowId:original.windowId,bounds:{windowState:'normal'}});
   const {left,top,width,height,windowState}=original.bounds;
   await s.send('Browser.setWindowBounds',{windowId:original.windowId,bounds:{left,top,width,height}});
   if(windowState!=='normal')await s.send('Browser.setWindowBounds',{windowId:original.windowId,bounds:{windowState}});
  }
  await page.waitForFunction(()=>document.visibilityState==='visible'&&window.__r7NaturalVisibility.events.some(e=>e.state==='visible'&&e.isTrusted),undefined,{polling:100,timeout:10000});
  result.returned=await page.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden,events:window.__r7NaturalVisibility.events,active:__terriStress.sim.buildActive(),dirty:__terriStress.sim.buildDirty(),review:!document.querySelector('#room-review').hidden}));
  result.restoredWindow=await s.send('Browser.getWindowForTarget');result.phase='complete';
 } catch(error) {result.errors.push(String(error));}
 finally {
  try {await s.send('Emulation.setFocusEmulationEnabled',{enabled:true});result.focusEmulationRestored=true;}catch(error){result.errors.push(String(error));}
  await s.detach();
  await page.evaluate(result=>{const p=window.__r7NaturalVisibility;if(p){p.observer.disconnect();document.removeEventListener('visibilitychange',p.listener);result.observed={events:p.events,statuses:p.statuses};}window.__r7NaturalVisibilityResult=result;},result);
 }
}
