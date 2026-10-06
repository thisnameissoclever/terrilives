const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright-core'));
const root=path.resolve(__dirname,'../../../../../..'),out=path.join(root,'docs/assets/review-evidence/object-models/2026-10-06/resume-browser');fs.mkdirSync(out,{recursive:true});
const bytes=Array.from(fs.readFileSync(path.join(root,'web/tests/fixtures/owned-reading-dropped.sav')));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});const cases=[];
try{for(const touch of [false,true]){const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:900},hasTouch:touch});
try{const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5198/?stress=0&audio=0');await page.waitForFunction(()=>globalThis.__terriStress?.sim&&document.querySelector('#book-title')?.options.length===25);
await page.evaluate(()=>{globalThis.recoveryGestures=[];document.addEventListener('click',e=>globalThis.recoveryGestures.push({id:e.target.id,trusted:e.isTrusted,detail:e.detail}));});if(await page.locator('#close-help').isVisible())await page.locator('#close-help').click();await page.locator('#time-controls label[for="speed-0"]').click();
const state=await page.evaluate(data=>{const sim=globalThis.__terriStress.sim;if(!sim.loadBytes(Uint8Array.from(data)))throw Error('Dropped fixture load failed');sim.setSpeed(0);sim.flushCommands();const copy=sim.bookCopies()[0];return {copy:copy.id,title:copy.titleId,home:Number(copy.home.shelf),funds:sim.funds()};},bytes);
await page.waitForTimeout(80); if(touch){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y:410}]});for(let x=310;x>=50;x-=20)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:410}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await page.waitForTimeout(100);}
const point=await page.evaluate(async()=>{
 const a=await import('/src/render/atlas.ts'),{sampleBedCoverage}=await import('/src/render/bed-sprites.ts'),{spriteDrawOffsetX,spriteDrawOffsetY}=await import('/src/render/sprite-anchors.ts'),{spriteWidth,spriteHeight}=await import('/src/render/sprite-size.ts'),{pickSprite}=await import('/src/input.ts');
 const s=globalThis.__terriStress.sim,o=globalThis.__terriStress.origin,ids=s.droppedBookIds(),pos=s.droppedBookPositions(),r=a.DROPPED_BOOK_SPRITES[ids[0]%4],canvas=document.querySelector('#stage'),rect=canvas.getBoundingClientRect();
 const left=o.x+(pos[0]-pos[1])*32+spriteDrawOffsetX(r.sprite)-spriteWidth(r.sprite)/2,top=o.y+(pos[0]+pos[1])*21+21+spriteDrawOffsetY(r.sprite)-spriteHeight(r.sprite),mask=a.BED_COVERAGE[r.alpha];
 const hit=(x,y)=>pickSprite(s,(x-rect.left)*canvas.width/rect.width,(y-rect.top)*canvas.height/rect.height,o.x,o.y)?.bookCopy===ids[0];
 const candidates=new Map();
 for(let sy=mask.box[1];sy<mask.box[3];sy++)for(let sx=mask.box[0];sx<mask.box[2];sx++){
  if(sampleBedCoverage(mask,sx,sy)<.99)continue;
  const x=Math.round(rect.left+(left+(sx+.5)/2)/canvas.width*rect.width),y=Math.round(rect.top+(top+(sy+.5)/2)/canvas.height*rect.height);
  if(x<0||y<0||x>=rect.right||y>=rect.bottom||!hit(x,y))continue;
  let margin=0;
  for(let radius=1;radius<=4;radius++){
   let inside=true;for(let dx=-radius;dx<=radius;dx++)for(let dy=-radius;dy<=radius;dy++)if(!hit(x+dx,y+dy))inside=false;
   if(!inside)break;margin=radius;
  }
  candidates.set(`${x},${y}`,{x,y,margin});
 }
 const chosen=[...candidates.values()].sort((a,b)=>b.margin-a.margin)[0];
 if(!chosen||chosen.margin<1)throw Error('No opaque dropped-copy interior with a CSS pixel margin');
 return {...chosen,copy:ids[0],origin:{x:o.x,y:o.y},bookPosition:Array.from(pos)};
});
assert.equal(point.copy,state.copy);console.log(JSON.stringify({touch,point,state,hit:await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,point)}));await page.screenshot({path:path.join(out,(touch?'touch':'desktop')+'-before-click.png')});if(touch)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
await page.waitForTimeout(100);console.log(JSON.stringify(await page.evaluate(()=>({focus:document.activeElement?.id,panelHidden:document.querySelector('#book-tool').hidden,owned:document.querySelector('#book-owned').innerText,build:document.querySelector('#build-toggle').outerHTML,status:document.querySelector('#book-status').textContent}))));await page.screenshot({path:path.join(out,(touch?'touch':'desktop')+'-after-click.png')});await page.waitForFunction(id=>document.activeElement?.id===`book-copy-transfer-${id}`,state.copy);const button=page.locator(`#book-copy-transfer-${state.copy}`);assert.equal(await button.textContent(),'Recover copy');await page.screenshot({path:path.join(out,(touch?'touch':'desktop')+'-picked.png')});
await page.locator(`#book-copy-destination-${state.copy}`).selectOption(String(state.home));await button.focus();if(touch)await button.tap();else await page.keyboard.press('Enter');
await page.waitForFunction(id=>globalThis.__terriStress.sim.bookCopies().find(copy=>copy.id===id)?.location.kind==='shelf',state.copy);
const recovered=await page.evaluate(()=>{const s=globalThis.__terriStress.sim;return {copies:s.bookCopies().map(copy=>({id:copy.id,titleId:copy.titleId,kind:copy.location.kind})),funds:s.funds(),dropped:s.droppedBookCount};});assert.equal(recovered.copies.length,1);assert.equal(recovered.copies[0].id,state.copy);assert.equal(recovered.copies[0].titleId,state.title);assert.equal(recovered.funds,state.funds);assert.equal(recovered.dropped,0);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,(touch?'touch':'desktop')+'-recovered.png')});const gestures=await page.evaluate(()=>globalThis.recoveryGestures);assert(gestures.some(e=>e.id===('book-copy-transfer-'+state.copy)&&e.trusted));cases.push({touch,state,point,recovered,gestures,keyboard:!touch,touchPan:touch,pass:true});
}finally{await context.close();}}}finally{await browser.close();fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify({wasmSHA256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'web/src/wasm/terri_wasm_bg.wasm'))).digest('hex'),pass:cases.length===2,cases,browserClosed:true},null,2));}console.log(JSON.stringify({pass:cases.length===2,cases:cases.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});






