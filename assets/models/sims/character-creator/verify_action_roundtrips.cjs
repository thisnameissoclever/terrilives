require('./runtime_inspect.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const wasm=await import(require('node:url').pathToFileURL(path.resolve('web/src/wasm/terri_wasm.js')).href);const initialized=await wasm.default({module_or_path:fs.readFileSync('web/src/wasm/terri_wasm_bg.wasm')});const {SimBridge}=require(path.resolve('web/src/bridge.ts')),{defaultAppearance}=require(path.resolve('web/src/character/schema.ts'));
 const handle=wasm.SimHandle.from_lot(),sim=new SimBridge(handle,initialized.memory),rows=[];
 try{const person=sim.characterAppearances().find(row=>row.sim===1),chair=Array.from(sim.ids()).find(id=>sim.objectModel(id)?.id==='armchair'),book=sim.bookCopies()[0],appearance=defaultAppearance('feminine');appearance.body.height=0;appearance.body.build=100;
  assert(sim.editCharacter(27001,1,{version:1,appearance}));sim.flushCommands();assert(sim.readBook(person.entity,chair,'read',book.titleId,true));sim.flushCommands();assert(sim.takeBookResults().every(row=>row.refusal===null));
  const required=new Map([[5,'walking'],[6,'fetching'],[3,'reading'],[7,'shelving']]);
  for(let tick=0;tick<2500&&required.size;tick++){
   sim.tick();const index=Array.from(sim.ids()).indexOf(person.entity),stage=sim.readingStages()[index],action=sim.visualActions()[index];let key=stage===6||stage===7||stage===3?stage:action===5?5:0;if(!required.has(key))continue;
   const bytes=sim.saveBytes(),copyHandle=wasm.SimHandle.from_lot(),copy=new SimBridge(copyHandle,initialized.memory);
   try{assert(copy.loadBytes(bytes));assert.deepEqual(copy.characterSnapshot(1),sim.characterSnapshot(1));assert.equal(copy.worldHash(),sim.worldHash());assert.equal(copy.appearanceHash(),sim.appearanceHash());
    const originalHandle=wasm.SimHandle.from_lot(),original=new SimBridge(originalHandle,initialized.memory);try{assert(original.loadBytes(bytes));for(let i=0;i<30;i++){original.tick();copy.tick();assert.equal(copy.worldHash(),original.worldHash());assert.equal(copy.appearanceHash(),original.appearanceHash());assert.deepEqual(Array.from(copy.visualActions()),Array.from(original.visualActions()));}}finally{originalHandle.free();}
    rows.push({phase:required.get(key),tick:sim.clockTick(),stage,action,continuedTicks:30,bytes:bytes.length});required.delete(key);
   }finally{copyHandle.free();}
  }
  assert.equal(required.size,0,'Missing action save cases: '+[...required.values()]);const out=path.resolve('docs/evidence/2026-10-12-full-character-creator/full-flow/action-roundtrips.json');fs.writeFileSync(out,JSON.stringify({rows},null,2));console.log(JSON.stringify(rows));
 }finally{handle.free();}
})().catch(error=>{console.error(error);process.exitCode=1});

