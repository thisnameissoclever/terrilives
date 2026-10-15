const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const source='web/src/render/character/measurement.ts',test='web/tests/character-measurement.test.ts';
const original=fs.readFileSync(source,'utf8'),digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const root=path.resolve('.scratch/measurement-v2-fault'),out=path.resolve('docs/evidence/2026-10-13-creator-repair/measurement-v2');
if(fs.existsSync(root))throw Error('Preserve the existing isolated fault workspace.');
fs.mkdirSync(path.join(root,'src/render/character'),{recursive:true});fs.mkdirSync(path.join(root,'tests'),{recursive:true});fs.mkdirSync(out,{recursive:true});
fs.symlinkSync(path.resolve('web/node_modules'),path.join(root,'node_modules'),'junction');
fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));
fs.writeFileSync(path.join(root,'vitest.config.mts'),"import {defineConfig} from 'vitest/config';export default defineConfig({cacheDir:'.cache',test:{maxWorkers:1}});\n");
fs.writeFileSync(path.join(root,'tests/character-measurement.test.ts'),fs.readFileSync(test));
const target=path.join(root,'src/render/character/measurement.ts');
const results=[];
function run(name,text,expected){
 fs.writeFileSync(target,text);
 const command=[ '--max-old-space-size=4096',path.resolve('web/node_modules/vitest/vitest.mjs'),'run','--maxWorkers=1'];
 const result=spawnSync(process.execPath,command,{cwd:root,encoding:'utf8',timeout:120000});
 fs.writeFileSync(path.join(out,name+'.log'),(result.stdout??'')+(result.stderr??''));
 results.push({name,command,exitCode:result.status,expectedExitCode:expected,sourceSha256:digest(text)});
 if(result.status!==expected)throw Error(name+' returned '+result.status);
}
try{
 run('baseline',original,0);
 const oldClock=original.replace('run.cpu[index]=cpuEnd-entered;','run.cpu[index]=cpuEnd-animationTime;');
 if(oldClock===original)throw Error('Clock fault did not apply');run('animation-stamp-as-execution',oldClock,1);
 const hiddenDelay=original.replace('callbackDelayMs:entries.map((value,i)=>value-animation[i])','callbackDelayMs:entries.map(()=>0)');
 if(hiddenDelay===original)throw Error('Delay fault did not apply');run('discarded-callback-delay',hiddenDelay,1);
 run('restored',original,0);
}finally{
 fs.writeFileSync(target,original);
 const unchanged=digest(fs.readFileSync(source,'utf8'))===digest(original);
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({results,productionUnchanged:unchanged,isolatedRestored:digest(fs.readFileSync(target,'utf8'))===digest(original)},null,2));
 if(!unchanged)throw Error('Production measurement source changed');
}
console.log('Two timing faults rejected; isolated source restored and production unchanged.');
