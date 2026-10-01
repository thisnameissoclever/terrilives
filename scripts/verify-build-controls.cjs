// Use an existing Playwright installation; this verifier adds no project dependency.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');
const output = path.resolve(process.argv[2] || 'output/playwright/build-controls');
fs.mkdirSync(output, {recursive:true});
const assert = require('assert/strict');
const evidence = {viewports: [], checks: [], errors: []};
const sizes = [[1440,900],[1280,800],[701,800],[700,800],[390,844],[320,568],[844,390]];
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:process.env.HEADED !== '1',args:['--enable-unsafe-webgpu','--use-angle=d3d11','--mute-audio']});
 try {
  let page=await browser.newPage({viewport:{width:1440,height:900}});
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>evidence.errors.push(e.message));
  await page.goto((process.env.GAME_URL || 'http://127.0.0.1:5174')+'?stress=0&audio=0');
  await page.waitForFunction(()=>document.querySelector('#buy-object').options.length>1);
  assert(await page.locator('#help-panel').isVisible());
  await page.locator('#close-help').click();
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  await page.locator('#build-toggle').click();
  await page.waitForFunction(()=>document.body.dataset.building==='true');
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  async function select(tool) {
   await page.locator('#build-tool-'+tool).click();
   assert.equal(await page.locator('#build-tool-'+tool).getAttribute('aria-pressed'),'true');
   await page.locator('canvas').focus();
   if(tool==='walls') await page.keyboard.press('ArrowRight');
   if(tool==='furniture') {
     const id=await page.locator('#builder-object option').evaluateAll(a=>(a.find(o=>o.value==='7')??a.find(o=>o.value))?.value);
     await page.locator('#builder-object').selectOption(id);
   }
   if(tool==='buy') {
    const id=await page.locator('#buy-object option').nth(1).getAttribute('value');
    // Native disabled options remain unavailable to the player; select the first affordable item if one exists.
    const available=await page.locator('#buy-object option:not([disabled])').evaluateAll(a=>a.find(o=>o.value)?.value);
    if(available) await page.locator('#buy-object').selectOption(available);
   }
   if(tool==='room') { await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); }
   if(tool==='floors') {
    for(const y of [0.52,0.4,0.6]) {
      await page.mouse.click((await page.viewportSize()).width/2,(await page.viewportSize()).height*y);
      await settle(); if(await page.locator('#placement-actions').isVisible()) break;
    }
   }
   await settle();
  }
  async function bounds(tag) {
   const result=await page.evaluate(()=>{
    const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const actions=document.querySelector('#placement-actions');
    const panel=document.querySelector('#builder-controls');
    const topButtons=[...actions.querySelectorAll('.context-top button')].map(box);
    const bottomButtons=[...actions.querySelectorAll('.context-bottom button')].map(box);
    const leftButton=actions.querySelector('.context-left button'),rightButton=actions.querySelector('.context-right button');
    const actionBox=box(actions);
    const gapLeft=leftButton?box(leftButton).right+8:actionBox.x+8;
    const gapRight=rightButton?box(rightButton).x-8:actionBox.right-8;
    const gapTop=Math.max(...topButtons.map(r=>r.bottom))+8;
    const gapBottom=Math.min(...bottomButtons.map(r=>r.y))-8;
    return {tool:actions.dataset.tool,compact:actions.dataset.compact,panel:box(panel),hud:box(document.querySelector('#hud')),
      zoom:box(document.querySelector('#build-camera')),action:box(actions),scroll:actions.scrollHeight,actions:[...actions.querySelectorAll('button')].map(b=>({label:b.ariaLabel,disabled:b.disabled,rect:box(b),alignment:(()=>{
        const r=box(b),content=[...b.children].filter(e=>getComputedStyle(e).display!=='none'&&getComputedStyle(e).position!=='absolute').map(box);
        return{x:Math.abs((Math.min(...content.map(c=>c.x))+Math.max(...content.map(c=>c.right)))/2-(r.x+r.width/2)),
          y:Math.abs((Math.min(...content.map(c=>c.y))+Math.max(...content.map(c=>c.bottom)))/2-(r.y+r.height/2))};
      })(),hit:(()=>{const r=b.getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===b||b.contains(e);})()})),
      free:document.body.dataset.buildRows==='true'?box(document.querySelector('#build-free-space')):null,
      selectionSpace:actions.dataset.compact==='false'?{width:gapRight-gapLeft,height:gapBottom-gapTop}:null,
      toolHeight:document.querySelector('.builder-tool:not([hidden])').getBoundingClientRect().height,
      nav:[...document.querySelectorAll('.build-navigation button')].map(b=>({label:b.textContent,rect:box(b)}))};
   });
   const size=page.viewportSize(); const overlaps=(a,b)=>a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1;
   evidence.viewports.push({tag,size,...result});
   for(const a of result.actions) {
    assert(a.rect.width>=43.9&&a.rect.height>=43.9,tag+' target '+a.label);
    assert(a.alignment.x<0.6&&a.alignment.y<0.6,tag+' centered content '+a.label);
    assert(a.rect.x>=-0.1&&a.rect.y>=-0.1&&a.rect.right<=size.width+0.1&&a.rect.bottom<=size.height+0.1,tag+' viewport '+a.label);
    assert(!overlaps(a.rect,result.panel),tag+' panel '+a.label);
    assert(!overlaps(a.rect,result.hud),tag+' hud '+a.label);
    assert(!overlaps(a.rect,result.zoom),tag+' zoom '+a.label);
    assert(a.hit,tag+' hit '+a.label);
   }
   assert(result.scroll<=result.action.height+1,tag+' hidden contextual actions');
   assert(result.toolHeight>=43.9,tag+' scrollable tool area');
   if(result.free) assert(result.free.height>=23.9,tag+' unobstructed game area');
   if(result.selectionSpace) assert(result.selectionSpace.width>=43.9&&result.selectionSpace.height>=23.9,tag+' selection space between controls');
   for(const n of result.nav) assert(n.rect.bottom<=result.panel.bottom+0.1&&n.rect.y>=result.panel.y-0.1,tag+' navigation '+n.label);
   return result;
  }
  // Sell a real chair to make the catalogue affordable in this disposable game.
  await select('furniture');
  for(const id of await page.locator('#builder-object option').evaluateAll(a=>a.filter(o=>o.value).map(o=>o.value))) {
   await page.locator('#builder-object').selectOption(id);await settle();
   if(await page.locator('[data-context-action="sell"]').isEnabled()) break;
  }
  await page.locator('[data-context-action="sell"]').click(); await settle();
  evidence.checks.push('Actual furniture sale completed through the game UI');
  await select('floors');
  const floorBefore=await page.evaluate(()=>Array.from(__terriStress.sim.floorTiles()));
  await page.locator('[data-context-action="floor-1"]').click();await settle();
  const floorAfter=await page.evaluate(()=>Array.from(__terriStress.sim.floorTiles()));
  assert.notDeepEqual(floorBefore,floorAfter);
  await page.locator('[data-context-action="clear"]').click();await settle();
  assert.equal(await page.locator('#placement-actions').isVisible(),false);
  const floorPoint=await page.evaluate(async()=>{
   const {screenX,screenY}=await import('/src/render/iso.ts');
   const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),o=__terriStress.origin;
   return{x:r.x+screenX(4,4,o.x,1)*r.width/c.width,y:r.y+screenY(4,4,o.y,1)*r.height/c.height};
  });
  await page.mouse.click(floorPoint.x,floorPoint.y);await settle();
  assert.deepEqual(await page.evaluate(()=>Array.from(__terriStress.sim.floorTiles())),floorAfter);
  evidence.checks.push('Floor button applies a real covering; Clear and selecting another tile do not paint');
  for(const [width,height] of sizes) {
   await page.setViewportSize({width,height}); await settle();
   for(const tool of ['furniture','walls','room','buy','floors']) {
    await select(tool);
    const result=await bounds(`${width}x${height}-${tool}`);
    if(tool==='buy'&&width===1440) {
     await page.locator('[data-context-action="choose"]').click();
     assert.equal(await page.evaluate(()=>document.activeElement.id),'buy-object');
    }
    if(tool==='furniture'&&width===1440) {
     await page.evaluate(()=>{
      const option=document.querySelector('#builder-object').selectedOptions[0],status=document.querySelector('#builder-status');
      option.dataset.proofText=option.textContent;status.dataset.proofText=status.textContent;
      option.textContent='Dining table with an unusually long model name for layout verification';
      status.textContent='This position would leave nearby furniture and the doorway unreachable. Choose another destination before confirming.';
     });await settle();
     assert.equal((await bounds('1440x900-long-name-and-refusal')).panel.width,304);
     await page.evaluate(()=>document.querySelectorAll('[data-proof-text]').forEach(e=>{e.textContent=e.dataset.proofText;delete e.dataset.proofText;}));
    }
    if(width===1440 || width===390) await page.screenshot({path:output+`/implemented-${tool}-${width}x${height}.png`});
    if(width>700&&height>480) assert.equal(result.panel.width,304);
   }
   await select('walls');
   await page.screenshot({path:output+`/implemented-${width}x${height}.png`});
   const prefix='wall'; await page.locator(`#${prefix}-keyboard-help summary`).click(); await settle();
   await bounds(`${width}x${height}-expanded-shortcuts`);
   assert.equal(await page.locator('#wall-keyboard-help').getAttribute('open'),'');
   await page.locator('canvas').focus(); await page.keyboard.press('ArrowLeft'); await settle();
   assert.equal(await page.locator('#wall-keyboard-help').getAttribute('open'),'');
   await select('room'); assert.equal(await page.locator('#room-keyboard-help').getAttribute('open'),null);
  }
  // DOM boundary tests use the shipped surface with an isolated presentation model.
  const dom=await page.evaluate(async()=>{
   const {createContextSurface}=await import('/src/ui/placement-actions.ts');
   const root=document.createElement('div');root.id='placement-proof';root.style.cssText='position:fixed;left:350px;top:80px;pointer-events:none';document.body.append(root);
   const canvas=document.querySelector('canvas');let calls=0,escaped=0;
   const onPointer=()=>escaped++;document.addEventListener('pointerdown',onPointer);
   const surface=createContextSurface(document,root,canvas,()=>({width:innerWidth,bottom:innerHeight,keepOut:{left:0,gearLeft:Infinity,gearBottom:0}}),()=>{});
   const model={tool:'walls',x:2,y:2,actions:[{id:'proof',label:'Proof',slot:'top',enabled:true,invoke:()=>calls++}]};
   surface.render(model);const button=root.querySelector('button');button.style.pointerEvents='auto';
   button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));button.click();
   button.focus();surface.render({...model,actions:[{...model.actions[0],enabled:false}]});const disabledFocus=document.activeElement===canvas;
   button.click();surface.render(model);button.focus();surface.render(null);const hiddenFocus=document.activeElement===canvas;
   const hidden=root.hidden;document.removeEventListener('pointerdown',onPointer);root.remove();
   return{calls,escaped,disabledFocus,hiddenFocus,hidden};
  });
  assert.deepEqual(dom,{calls:1,escaped:0,disabledFocus:true,hiddenFocus:true,hidden:true}); evidence.checks.push(dom);
  await page.setViewportSize({width:390,height:844});await select('walls');
  await page.locator('#options-toggle').click();await page.locator('#show-help').click();await settle();
  await page.waitForFunction(()=>document.querySelector('#help-panel').open && document.querySelector('#placement-actions').hidden);
  assert.equal(await page.locator('#placement-actions').isVisible(),false);
  await page.locator('#help-panel .help-topic').first().locator('summary').click();
  await page.screenshot({path:output+'/implemented-help.png'});
  await page.locator('#help-shortcuts summary').click();
  await page.screenshot({path:output+'/implemented-help-shortcuts.png'});
  await page.locator('#close-help').click();
  await select('walls');
  const before=await page.locator('#placement-actions').boundingBox();
  await page.locator('#build-zoom-in').click();await settle();
  const after=await page.locator('#placement-actions').boundingBox(); assert.notDeepEqual(before,after);
  await page.locator('#build-zoom-out').click();await settle();
  evidence.checks.push('Zoom updates contextual placement; Help suspends actions');
  await page.setViewportSize({width:1440,height:900});await select('walls');
  const zoomBefore=await page.evaluate(()=>{
   const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),h=document.querySelector('#hud').getBoundingClientRect();
   return{x:__terriStress.origin.x,y:__terriStress.origin.y,
    anchorX:((h.right+r.right)/2-r.left)*c.width/r.width,anchorY:r.height/2*c.height/r.height};
  });
  await page.locator('#build-zoom-in').click();await settle();
  const zoomAfter=await page.evaluate(()=>({x:__terriStress.origin.x,y:__terriStress.origin.y}));
  assert(Math.abs(zoomAfter.x-(zoomBefore.anchorX+(zoomBefore.x-zoomBefore.anchorX)*1.12))<0.01);
  assert(Math.abs(zoomAfter.y-(zoomBefore.anchorY+(zoomBefore.y-zoomBefore.anchorY)*1.12))<0.01);
  await page.locator('#build-zoom-out').click();await settle();
  evidence.checks.push('Zoom factor 1.12 uses the center of desktop game space beside the panel');
  const panBefore=await page.locator('#placement-actions').boundingBox();
  await page.mouse.move(1100,180);await page.mouse.down({button:'middle'});
  await page.mouse.move(1160,210,{steps:4});await page.mouse.up({button:'middle'});await settle();
  assert.notDeepEqual(await page.locator('#placement-actions').boundingBox(),panBefore);
  await page.evaluate(()=>new Promise(resolve=>{let n=10;function tick(){if(--n)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);}));
  const idle=await page.evaluate(async()=>{
   const root=document.querySelector('#placement-actions');let writes=0,reads=0;
   const observer=new MutationObserver(records=>writes+=records.length);observer.observe(root,{subtree:true,attributes:true,childList:true,characterData:true});
   const elements=['hud','builder-controls','builder-dock','build-camera'].map(id=>document.getElementById(id));
   const methods=elements.map(e=>e.getBoundingClientRect);
   elements.forEach((e,i)=>e.getBoundingClientRect=function(){reads++;return methods[i].call(e);});
   try {await new Promise(resolve=>{let n=20;function tick(){if(--n)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});}
   finally {observer.disconnect();elements.forEach((e,i)=>e.getBoundingClientRect=methods[i]);}
   return{writes,reads};
  });
  assert.deepEqual(idle,{writes:0,reads:0});evidence.checks.push({steadyFrames:20,...idle});
  for(const size of [[390,844],[320,568],[844,390]]) {
   await page.setViewportSize({width:size[0],height:size[1]});await select('walls');
   await page.evaluate(()=>{
    const fields=[...document.querySelectorAll('#hud *,#builder-controls *,#placement-actions *,#build-camera *')];
    const sizes=fields.map(e=>parseFloat(getComputedStyle(e).fontSize));
    fields.forEach((e,i)=>{e.dataset.proofFont=e.style.fontSize;e.style.fontSize=sizes[i]*2+'px';});
    document.querySelector('#wall-status').textContent="A wall here would block someone's way. Choose another edge to keep the doorway and all nearby furniture reachable.";
   });await settle();
   await bounds(`${size.join('x')}-double-text-long-refusal`);
   await page.screenshot({path:output+`/implemented-large-text-${size.join('x')}.png`});
   await page.locator('#wall-keyboard-help summary').click();await settle();
   await bounds(`${size.join('x')}-double-text-shortcuts`);
   if(size[0]===320) {
    await page.locator('#options-toggle').focus();await page.keyboard.press('Enter');await settle();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'options-toggle');
    await page.locator('#options-close').click();await settle();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'options-toggle');
    await page.locator('#build-zoom-in').focus();
    await page.setViewportSize({width:1440,height:900});await settle();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'build-zoom-in');
    await page.setViewportSize({width:size[0],height:size[1]});await settle();
    evidence.checks.push('Keyboard focus survives row entry, row exit, Options closure and resize');
   }
   await page.evaluate(()=>document.querySelectorAll('[data-proof-font]').forEach(e=>{e.style.fontSize=e.dataset.proofFont;delete e.dataset.proofFont;}));
   await settle();
  }
  // Review the other panels through their real controls.
  await page.setViewportSize({width:320,height:568});await page.locator('#builder-exit').click();await settle();
  await page.locator('#sim-details').click();
  for(const name of ['overview','queue','people','traits']) {
   await page.locator(`#sim-sheet [data-open-sim-panel="${name}"]`).click();await settle();
   const close=await page.locator('#sim-sheet-close').boundingBox();assert(close.x+close.width<=320&&close.y+close.height<=568);
   await page.screenshot({path:output+`/panel-sim-${name}.png`});
  }
  await page.locator('#sim-sheet-close').click();
  await page.locator('canvas').focus();
  for(let attempt=0;attempt<20;attempt++) {
   await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await settle();
   if(await page.locator('#object-menu').isVisible()) break;
  }
  assert.equal(await page.locator('#object-menu').isVisible(),true);
  const menuBox=await page.locator('#object-menu').boundingBox();
  assert(menuBox.x>=0&&menuBox.x+menuBox.width<=320&&menuBox.y>=0&&menuBox.y+menuBox.height<=568);
  await page.screenshot({path:output+'/panel-object-menu.png'});
  await page.keyboard.press('Escape');
  await page.locator('#options-toggle').click();await settle();
  await page.screenshot({path:output+'/panel-options.png'});
  await page.locator('#new-housemate').click();await settle();
  await page.screenshot({path:output+'/panel-housemate.png'});
  await page.locator('#housemate-name').fill('Layout verification');
  await page.locator('#housemate-next').click();await settle();
  await page.screenshot({path:output+'/panel-housemate-traits.png'});
  await page.locator('#housemate-back').click();
  await page.locator('#housemate-cancel').click();
  await page.locator('#options-toggle').click();await page.locator('#new-game').click();await settle();
  await page.screenshot({path:output+'/panel-confirmation.png'});
  await page.locator('#new-game-dialog button[value="cancel"]').click();
  evidence.checks.push('Options, all Sim detail tabs, object menus, household creation and confirmation reviewed at 320x568');
  const originalPage=page;
  for(const ratio of [2,3]) {
   page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:ratio,hasTouch:true});
   try {
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5174');
    await page.waitForFunction(()=>document.querySelector('#buy-object').options.length>1);
    await page.locator('#close-help').click();await page.locator('#build-toggle').click();
    await select('walls');await bounds(`390x844-device-pixel-ratio-${ratio}`);
    const turn=await page.locator('[data-context-action="right"]').boundingBox();
    await page.touchscreen.tap(turn.x+turn.width/2,turn.y+turn.height/2);await settle();
    await page.screenshot({path:output+`/implemented-dpr-${ratio}.png`});
   } finally {await page.close();}
  }
  page=originalPage;
  assert.deepEqual(evidence.errors,[]);
 } finally {await browser.close();fs.writeFileSync(output+'/game-layout-evidence.json',JSON.stringify(evidence,null,2));}
})().then(()=>console.log('PASS',evidence.viewports.length,'layout states',evidence.checks)).catch(e=>{console.error(e);process.exitCode=1;});
