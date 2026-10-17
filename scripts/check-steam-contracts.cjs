const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const files=['web/src/render/character/shower-steam.ts','web/src/render/scene-target.ts',
 'web/src/render/scene-pipeline.ts','web/src/render/scene-sampling.ts','web/proofs/steam-contracts.ts','web/proofs/steam-contracts.html'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hashes=()=>Object.fromEntries(files.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
const replacements=[
 {name:'depth-write',from:'depthWriteEnabled:false',to:'depthWriteEnabled:true',failure:'wrote hardware depth'},
 {name:'retained-field',from:'begin():void{this.count=0;}',to:'begin():void{}',failure:'retained a visible field'},
 {name:'missing-draw',from:'if(!this.count||this.closed)return;',to:'if(true)return;',failure:'did not affect any exposed sample'},
 {name:'identity-write',from:'const pass=encoder.beginRenderPass({colorAttachments:',
  to:"const erase=encoder.beginRenderPass({colorAttachments:[{view:target.identity.createView(),loadOp:'clear',storeOp:'store',clearValue:[999,0,0,0]}]});erase.end();const pass=encoder.beginRenderPass({colorAttachments:",failure:'overwrote scene identity'},
 {name:'surface-write',from:'const pass=encoder.beginRenderPass({colorAttachments:',
  to:"const erase=encoder.beginRenderPass({colorAttachments:[{view:target.surface.createView(),loadOp:'clear',storeOp:'store',clearValue:[.25,0,0,0]}]});erase.end();const pass=encoder.beginRenderPass({colorAttachments:",failure:'overwrote physical surface depth'},
];
(async()=>{
 if(!process.env.PLAYWRIGHT_MODULE)throw new Error('Set PLAYWRIGHT_MODULE to an existing Playwright module. Nothing is installed by this check.');
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
 const {createServer}=await import(pathToFileURL(path.join(root,'web/node_modules/vite/dist/node/index.js')).href);
 const output=path.resolve(root,process.env.TERRI_STEAM_EVIDENCE||'.local-build/steam-contracts');
 fs.mkdirSync(output,{recursive:true});
 const before=hashes();
 const scratchRoot=path.resolve(os.tmpdir());
 const frozen=fs.mkdtempSync(path.join(scratchRoot,'terrilives-steam-contracts-'));
 const report={sourceHashes:before,harnessSha256:hash(fs.readFileSync(__filename)),frozenAt:new Date().toISOString(),cases:[]};
 let browser,server;
 try{
  for(const file of files){const destination=path.join(frozen,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,file),destination);
   if(hash(fs.readFileSync(destination))!==before[file])throw new Error('Source changed during freeze.');}
  const source=path.join(frozen,'web/src/render/character/shower-steam.ts'),original=fs.readFileSync(source,'utf8');
  server=await createServer({configFile:false,root:path.join(frozen,'web'),publicDir:false,logLevel:'error',cacheDir:path.join(frozen,'.vite'),
   server:{host:'127.0.0.1',port:0,strictPort:true,watch:null,fs:{allow:[frozen]}}});await server.listen();
  const address=server.httpServer.address();if(!address||typeof address==='string')throw new Error('Proof server has no port.');
  browser=await chromium.launch({headless:true,channel:'chrome'});
  report.browser=browser.version();
  for(const mutation of [null,...replacements]){
   if(mutation){if(original.split(mutation.from).length!==2)throw new Error('Mutation must identify exactly one production site.');fs.writeFileSync(source,original.replace(mutation.from,mutation.to));}
   else fs.writeFileSync(source,original);
   // Clear Vite's module cache after replacing copied source; the live checkout is never mutated.
   server.moduleGraph.invalidateAll();
   const context=await browser.newContext();
   try{const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${address.port}/proofs/steam-contracts.html`);
    await page.waitForFunction(()=>document.querySelector('#result')?.textContent!=='Running',{},{timeout:30000});
    const result=JSON.parse(await page.locator('#result').innerText());
    const accepted=mutation?result.status==='FAIL'&&result.error.includes(mutation.failure):result.status==='PASS';
    report.cases.push({name:mutation?.name??'production',expected:mutation?'REJECT':'PASS',accepted,result,errors});
    if(!accepted||errors.length)throw new Error(`Unexpected graphics result for ${mutation?.name??'production'}: ${JSON.stringify(result)} ${errors.join(';')}`);
   }finally{await context.close();}
  }
  if(JSON.stringify(before)!==JSON.stringify(hashes()))throw new Error('The live proof source changed while checking.');
  report.status='PASS';
 }catch(error){report.status='FAIL';report.error=String(error);throw error;}
 finally{
  report.cleanupErrors=[];
  const jobs=[['browser',()=>browser?.close()],['server',()=>server?.close()],['temporary copy',()=>{
   if(path.dirname(frozen)!==scratchRoot||!path.basename(frozen).startsWith('terrilives-steam-contracts-'))throw new Error('Temporary cleanup path is outside the owned directory.');
   fs.rmSync(frozen,{recursive:true,force:true});}]];
  for(const [name,close] of jobs)try{await close();}catch(error){report.cleanupErrors.push(`${name}: ${String(error)}`);}
  if(report.cleanupErrors.length)report.status='FAIL';
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  if(report.cleanupErrors.length)throw new Error(report.cleanupErrors.join('\n'));
 }
 console.log(JSON.stringify({status:report.status,output,cases:report.cases.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
