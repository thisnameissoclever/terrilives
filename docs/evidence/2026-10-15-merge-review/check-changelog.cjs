const {chromium}=require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=process.cwd(),out=path.join(__dirname,'changelog-browser');
if(fs.existsSync(out))throw Error('Preserve earlier review evidence.');
fs.mkdirSync(out);
const server=spawn(process.execPath,[path.join(root,'web/node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','5194','--strictPort','--outDir','../.local-build/merge-20261015/web-container'],{cwd:path.join(root,'web'),windowsHide:true});
const report={checks:[],errors:[]};let browser;
(async()=>{
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Owned preview startup timed out.')),15000);
   server.stdout.on('data',data=>{if(data.toString().includes('http://127.0.0.1:5194/')){clearTimeout(timer);resolve();}});
   server.stderr.on('data',data=>report.errors.push(data.toString()));
   server.once('exit',code=>{clearTimeout(timer);reject(Error('Owned preview exited '+code));});
  });
  browser=await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>report.errors.push(String(error)));
  await page.goto('http://127.0.0.1:5194/changelog/');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  report.checks.push('Dark is the default in fresh storage.');
  const entry=page.locator('#update-2026-10-15');
  assert.equal(await entry.locator('h2').textContent(),'Create and customize your housemates');
  assert.ok((await entry.textContent()).includes('Dishes stay at the table setting where the meal was eaten.'));
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   for(const theme of ['dark','light']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-toggle').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await entry.screenshot({path:path.join(out,`${width}-${theme}.png`)});
    report.checks.push(`${width}px ${theme} displays the full release entry without horizontal overflow.`);
   }
  }
  assert.deepEqual(report.errors,[]);report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=String(error);process.exitCode=1;}
 finally{
  await browser?.close();server.kill();
  report.browserClosed=true;report.ownedPreviewStopped=true;
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
