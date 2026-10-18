async page => {
 await page.waitForFunction(()=>window.__terriStress);
 if(await page.getByRole('button',{name:'Got it',exact:true}).isVisible())await page.getByRole('button',{name:'Got it',exact:true}).click();
 await page.getByRole('button',{name:'Build',exact:true}).click();await page.getByRole('button',{name:'Rooms',exact:true}).click();await page.getByLabel('Room',{exact:true}).selectOption('1');
 await page.evaluate(()=>{window.__r7FocusReplay={events:[]};let seq=0;const record=kind=>window.__r7FocusReplay.events.push({seq:++seq,kind,width:innerWidth,height:innerHeight,visualHeight:visualViewport.height,time:performance.now()});window.addEventListener('resize',()=>record('window'));visualViewport.addEventListener('resize',()=>record('visual'));});
 const resize=async height=>{const count=await page.evaluate(()=>window.__r7FocusReplay.events.length);await page.setViewportSize({width:390,height});await page.waitForFunction(({count,height})=>innerHeight===height&&window.__r7FocusReplay.events.slice(count).some(e=>e.height===height&&e.visualHeight===height),{count,height});};
 const sample=async()=>page.evaluate(async()=>{const {bounds}=await import('/.scratch/r7-focus-helper.js');const samples=[];for(let i=0;i<3;i++){await new Promise(resolve=>requestAnimationFrame(resolve));samples.push(bounds('#room-name','#room-tool'));}return {samples,style:{margin:getComputedStyle(document.querySelector('#room-name')).scrollMarginBlockStart,padding:getComputedStyle(document.querySelector('#room-tool')).padding},text:document.querySelector('#room-name').value};});
 const result={sourceCssSha256:'897f6c872f289145f2addad3d857dfae55b4568b4d9a72381518313b308c6038',steps:[]};let style;
 try {
  await resize(844);await page.getByLabel('Room name',{exact:true}).fill('Long duplicate name for this selected room');await resize(480);result.clean=await sample();
  style=await page.addStyleTag({content:'#room-name {scroll-margin-block:0px!important}'});
  await resize(844);await page.evaluate(()=>document.querySelector('#room-tool').scrollTop=0);await resize(480);result.fault=await sample();
  await style.evaluate(node=>node.remove());style=null;
  await resize(844);await page.getByLabel('Room',{exact:true}).focus();await page.keyboard.press('Tab');await resize(480);result.restored=await sample();
  result.beforeScreenshot=await page.evaluate(async()=>{const {bounds}=await import('/.scratch/r7-focus-helper.js');return bounds('#room-name','#room-tool')});
  await page.screenshot({path:'.local-build/r7-selection-restoration-v4.png',scale:'css'});
  result.afterScreenshot=await page.evaluate(async()=>{const {bounds}=await import('/.scratch/r7-focus-helper.js');return bounds('#room-name','#room-tool')});
  result.ok=result.clean.samples.every(s=>s.focused&&s.fits)&&!result.fault.samples.at(-1).fits&&result.restored.samples.every(s=>s.focused&&s.fits)&&JSON.stringify(result.beforeScreenshot)===JSON.stringify(result.afterScreenshot);
 }catch(error){result.error=String(error);result.ok=false;}
 finally {if(style)await style.evaluate(node=>node.remove());await page.evaluate(result=>{result.events=window.__r7FocusReplay.events;window.__r7FocusReplayResult=result;},result);}
}
