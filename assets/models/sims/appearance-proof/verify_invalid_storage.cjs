const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const rows=[];try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html');await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
 for(const {invalid,query} of [{invalid:'',query:''},{invalid:'{"draftVersion":99}',query:''},{invalid:'',query:'?baseline&recovery-test=preserved'}]){
  await page.evaluate(value=>localStorage.setItem('natural-causes.appearance-proof.v1',value),invalid);await page.goto(`http://127.0.0.1:5187/proofs/character-appearance.html${query}`);
  await page.waitForFunction(()=>window.appearanceProof||document.querySelector('#status').classList.contains('bad'),null,{timeout:60000});
  const result=await page.evaluate(()=>({rendered:!!window.appearanceProof,stored:localStorage.getItem('natural-causes.appearance-proof.v1'),message:document.querySelector('#status').textContent}));
  assert.equal(result.rendered,false);assert.equal(result.stored,invalid);assert.match(result.message,/Saved appearance proof cannot load/);
  await page.locator('#new-draft').click();await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
  assert.equal(await page.evaluate(()=>window.appearanceProof.value.version),1);
  const recoveredUrl=new URL(page.url());assert.equal(recoveredUrl.searchParams.has('baseline'),false);
  if(query)assert.equal(recoveredUrl.searchParams.get('recovery-test'),'preserved');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('natural-causes.appearance-proof.v1')).sourceMaterials),[]);
  rows.push({...result,initialQuery:query,recoveredUrl:page.url(),recoveredByExplicitNewDraft:true});
 }
 fs.writeFileSync('docs/evidence/2026-10-12-character-appearance/invalid-storage-browser.json',JSON.stringify(rows,null,2));console.log('Invalid stored records remain intact and show an error; explicit new-draft recovery works.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
