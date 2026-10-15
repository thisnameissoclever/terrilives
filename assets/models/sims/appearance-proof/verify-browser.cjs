const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertCaptureSweep } = require('./capture-contract.cjs');
const output = path.resolve(process.argv.find(argument=>argument.startsWith('--output='))?.slice('--output='.length)
  || 'docs/evidence/2026-10-12-character-appearance');
const capture = path.join(output,'captures');fs.mkdirSync(capture,{recursive:true});
async function run() {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const result={browserVersion:browser.version(),viewport:[1600,1100],checks:[],cases:[],errors:[]};
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1100}});
    page.on('pageerror',e=>result.errors.push(String(e)));
    const ready=async()=>{
      await page.waitForFunction(()=>window.appearanceProof||document.querySelector('#status').classList.contains('bad'),null,{timeout:60000});
      const state=await page.evaluate(()=>({ready:!!window.appearanceProof,status:document.querySelector('#status').textContent}));
      assert.ok(state.ready,state.status);
    };
    await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline');await ready();
    const initial=await page.evaluate(()=>window.appearanceProof.value);
    result.adapter=JSON.parse(await page.locator('#facts').textContent()).adapter;
    const simHash=await page.evaluate(()=>window.appearanceProof.simulation.worldHash().toString());
    await page.locator('#lock-height').check();await page.locator('#lock-skin').check();
    await page.locator('#randomize').click();
    const random=await page.evaluate(()=>window.appearanceProof.value);
    assert.equal(random.height,initial.height);assert.equal(random.skin,initial.skin);assert.notDeepEqual(random,initial);
    await page.locator('#undo').click();assert.deepEqual(await page.evaluate(()=>window.appearanceProof.value),initial);
    result.checks.push('UI randomization preserves height/skin locks and undo restores exact record');
    await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html');await ready();
    assert.deepEqual(await page.evaluate(()=>window.appearanceProof.value),initial);
    assert.equal(await page.evaluate(()=>window.appearanceProof.simulation.worldHash().toString()),simHash);
    result.checks.push('Reload preserves saved record; simulation hash unchanged');
    assert.equal(await page.locator('#lock-height').isChecked(),true);
    assert.equal(await page.locator('#lock-skin').isChecked(),true);
    const savedDraft=await page.evaluate(()=>localStorage.getItem('natural-causes.appearance-proof.v1'));
    await page.locator('#randomize').click();
    const nextDraw=await page.evaluate(()=>window.appearanceProof.value);
    await page.evaluate(value=>localStorage.setItem('natural-causes.appearance-proof.v1',value),savedDraft);
    await page.reload();await ready();await page.locator('#randomize').click();
    assert.deepEqual(await page.evaluate(()=>window.appearanceProof.value),nextDraw);
    await page.locator('#baseline').click();
    await page.locator('#field-skin').fill('#a87552');
    const sourceFields=await page.evaluate(()=>JSON.parse(localStorage.getItem('natural-causes.appearance-proof.v1')).sourceMaterials);
    assert.deepEqual(sourceFields,['hair','shirt','trousers','shoes']);
    await page.locator('#value-height').fill('101');await page.locator('#value-height').dispatchEvent('change');
    assert.match(await page.locator('#status').textContent(),/Invalid appearance record/);
    result.expectedInputErrors=await page.evaluate(()=>[...window.appearanceProof.errors]);
    assert.equal(result.expectedInputErrors.length,1);
    await page.locator('#undo').click();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('natural-causes.appearance-proof.v1')).sourceMaterials),['skin','hair','shirt','trousers','shoes']);
    await page.reload();await ready();
    await page.locator('#action').selectOption('walk');
    await page.locator('#advance').click();
    const paused=await page.evaluate(()=>window.appearanceProof.time);
    await page.evaluate(()=>new Promise(resolve=>{let frames=0;function tick(){if(++frames===4)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
    assert.equal(await page.evaluate(()=>window.appearanceProof.time),paused);
    await page.locator('#play').click();
    await page.waitForFunction(t=>window.appearanceProof.time>t,paused);
    await page.locator('#play').click();
    await page.locator('#action').selectOption('idle');
    result.checks.push('Reload preserves locks and next random draw; source color changes remain region-specific; pause and resume use one clock');

    const male={...initial,presentation:'masculine',hairstyle:'curl',height:50,build:50};
    const heights=[];
    for(const height of [0,100]) {
      await page.evaluate(a=>window.appearanceProof.set(a),{...male,height});
      heights.push(await page.evaluate(()=>window.appearanceProof.bounds()));
    }
    assert.ok((heights[1].maxY-heights[1].minY)/(heights[0].maxY-heights[0].minY)>1.2,'GPU must apply height to rendered geometry');
    result.heightBounds=heights;
    await page.evaluate(a=>window.appearanceProof.set(a),male);
    result.depth=await page.evaluate(()=>window.appearanceProof.depthProof());
    result.color=await page.evaluate(()=>window.appearanceProof.colorProof());
    result.surface=[];
    for(const action of ['idle','walk','read']) {
      await page.locator('#action').selectOption(action);
      await page.locator('#advance').click();
      result.surface.push({action,...await page.evaluate(()=>window.appearanceProof.surfaceProof())});
    }
    await page.locator('#action').selectOption('idle');
    result.checks.push('Actual rendered height changes; per-pixel compositor depth matches independent texture oracle');
    result.checks.push('GPU surface agrees with the CPU skinned-subdivision evaluation in idle, walking and reading');
    if(!process.argv.includes('--quick')) {
      for(const presentation of ['masculine','feminine'])for(const height of [0,50,100])for(const build of [0,50,100]) {
        const a={...male,presentation,height,build,hairstyle:presentation==='feminine'?'bob':'curl'};
        await page.evaluate(a=>window.appearanceProof.set(a),a);
        for(const action of ['idle','walk','read']) {
          await page.locator('#action').selectOption(action);
          for(let facing=0;facing<4;facing++) {
            const values=['0','1.5707963267948966','3.141592653589793','4.71238898038469'];
            await page.locator('#facing').selectOption(values[facing]);
            const label=`${presentation}-${height}-${build}-${action}-${facing}`;
            try {
              const bounds=await page.evaluate(()=>window.appearanceProof.bounds());
              await page.locator('#preview').screenshot({path:path.join(capture,label+'.png')});
              result.cases.push({label,bounds});
            } catch(error) {result.cases.push({label,error:String(error)});}
          }
        }
        console.log(`Captured ${presentation} height ${height} build ${build}`);
      }
      assertCaptureSweep(result.cases);
      await page.evaluate(a=>window.appearanceProof.set(a),{...male,presentation:'feminine',hairstyle:'bob'});
      await page.locator('#facing').selectOption('0');await page.locator('#action').selectOption('read');
      await page.screenshot({path:path.join(output,'proof-interface.png'),fullPage:true});
      await page.locator('#world').screenshot({path:path.join(output,'world-reading.png')});
      await page.locator('#wall').check();await page.locator('#world').screenshot({path:path.join(output,'world-wall.png')});
      await page.locator('#wall').uncheck();
      if(!process.argv.includes('--skip-benchmark')) result.benchmark=await page.evaluate(()=>window.appearanceProof.benchmark(60000));
    }
    result.gpuErrors=await page.evaluate(()=>window.appearanceProof.errors);
    assert.equal(result.gpuErrors.length,0);assert.equal(result.errors.length,0);
    fs.writeFileSync(path.join(output,process.argv.includes('--quick')?'browser-quick.json':'browser.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({checks:result.checks,depth:result.depth,cases:result.cases.length,failed:result.cases.filter(c=>c.error).length,benchmark:result.benchmark?{p95:result.benchmark.workP95Ms,samples:result.benchmark.samples}:null},null,2));
  }catch(error){result.failure=String(error);fs.writeFileSync(path.join(output,'browser-failure.json'),JSON.stringify(result,null,2));throw error;}
  finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
