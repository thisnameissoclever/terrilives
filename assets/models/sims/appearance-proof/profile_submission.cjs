const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const output='docs/evidence/2026-10-12-character-appearance/accepted-followthrough';fs.mkdirSync(output,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}});
 await page.goto('http://127.0.0.1:5187/proofs/character-appearance.html?baseline');await page.waitForFunction(()=>window.appearanceProof,null,{timeout:60000});
 const result={browser:browser.version(),runs:[]};
 for(const mode of ['individual','combined']){
  console.log(`Measuring ${mode} outline draws for 60 seconds.`);
  const run=await page.evaluate(async mode=>{
   const p=window.appearanceProof,prototype=Object.getPrototypeOf(p.actor),render=prototype.render;
   const ranges=mode==='individual'?p.geometry.description.parts.filter(part=>part.outline):p.actor.outlineRanges;
   const combined=p.actor.outlineRanges,longTasks=[];
   const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({start:entry.startTime,duration:entry.duration});});
   observer.observe({type:'longtask',buffered:false});
   prototype.render=function(...args){this.outlineRanges=ranges;return render.apply(this,args);};
   try{return {mode,drawsPerActor:ranges.length,...await p.benchmark(60000),longTasks};}
   finally{prototype.render=render;p.actor.outlineRanges=combined;observer.disconnect();p.draw();}
  },mode);
  assert.deepEqual(run.errors,[]);result.runs.push(run);
  fs.writeFileSync(output+'/submission-profile.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({mode,p50:run.workP50Ms,p95:run.workP95Ms,max:run.workMaxMs,submissionP95:run.submissionP95Ms,completionWaitP95:run.completionWaitP95Ms,overBudget:run.overBudget}));
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
