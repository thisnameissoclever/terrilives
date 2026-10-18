async page=>{
  const read=()=>page.evaluate(()=>({tick:__terriStress.sim.clockTick(),view:__terriStress.characters.snapshot().view,focus:document.activeElement?.id,buttons:[...document.querySelectorAll('#build-exit-dialog button')].map(b=>({id:b.id,text:b.textContent,enabled:!b.disabled,attributes:Object.fromEntries(b.getAttributeNames().sort().map(k=>[k,b.getAttribute(k)])),bg:getComputedStyle(b).backgroundColor,color:getComputedStyle(b).color,outline:getComputedStyle(b).outline,rect:b.getBoundingClientRect().toJSON()}))}));
  const before=await read(),roles=before.buttons.map(b=>({id:b.id,role:b.attributes['data-action-intent']}));
  try{
    await page.evaluate(()=>{for(const b of document.querySelectorAll('#build-exit-dialog button'))b.removeAttribute('data-action-intent');});
    await page.screenshot({path:'.local-build/r8-exit-proof-a.png'});const removed=await read();
    await page.evaluate(roles=>{for(const r of roles)document.getElementById(r.id).setAttribute('data-action-intent',r.role);},roles);
    await page.screenshot({path:'.local-build/r8-exit-proof-b.png'});const restored=await read();
    if(JSON.stringify(before)!==JSON.stringify(restored))throw Error('Restored attributes or visible state differs');
    return {before,removed,restored,exactAttributeAndVisibleStateRestoration:true,sourceMutation:false,conditionMap:{'r8-exit-proof-a.png':'only three shared roles removed','r8-exit-proof-b.png':'fixed source roles restored'},priorFailure:'The first helper compared outerHTML attribute ordering after remove/set. Values were restored; DOM attribute order changed. First captures and error remain separate.'};
  }finally{await page.evaluate(roles=>{for(const r of roles)document.getElementById(r.id).setAttribute('data-action-intent',r.role);},roles);}
}
