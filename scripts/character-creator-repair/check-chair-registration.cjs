const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'web/src/render/character/preview-fixture.ts');
const label=process.env.CHAIR_CHECK_RUN||'registration-01';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid run label');
const out=path.join(root,'docs/evidence/2026-10-14-visual-review',label),scratch=path.join(root,'.scratch',label);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const original=fs.readFileSync(source),results=[];
const inputs=['web/src/render/character/preview-fixture.ts','web/tests/preview-fixture.test.ts',
 'assets/models/living/owner-review-pending/armchair/candidate-03/proof.json',
 'assets/models/sims/character-creator/export/manifest.json','assets/models/sims/character-repair/fixture-depth/manifest.json'];
const hashes=()=>Object.fromEntries(inputs.map(file=>[file,sha(fs.readFileSync(path.join(root,file)))]));
const inputsBefore=hashes();
if(fs.existsSync(out)||fs.existsSync(scratch))throw Error('Choose a new label; existing evidence is preserved');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(scratch,{recursive:true});
const config=path.join(scratch,'vitest.config.mjs');
fs.writeFileSync(config,`import original from '../../web/vite.config.ts';
export default async function(env){const base=await original(env);return {...base,cacheDir:${JSON.stringify(path.join(scratch,'.cache'))},plugins:[...base.plugins,{name:'isolated-chair-registration-fault',enforce:'pre',transform(code,id){
 if(!process.env.CHAIR_REGISTRATION_FAULT||!id.replaceAll('\\\\','/').endsWith('/src/render/character/preview-fixture.ts'))return;
 const target='(anchor[1]-TILE_HALF_HEIGHT)*scale';if(!code.includes(target))throw Error('Expected chair registration expression missing');
 console.log('CHAIR_REGISTRATION_FAULT_APPLIED');return {code:code.replace(target,'anchor[1]*scale'),map:null};
 }}]};}
`);
function run(name,fault,expected){
 const args=['--max-old-space-size=4096',path.join(root,'web/node_modules/vitest/vitest.mjs'),'run','tests/preview-fixture.test.ts','--maxWorkers=1','--config',config];
 const env={...process.env};if(fault)env.CHAIR_REGISTRATION_FAULT='1';else delete env.CHAIR_REGISTRATION_FAULT;
 const result=spawnSync(process.execPath,args,{cwd:path.join(root,'web'),env,encoding:'utf8',timeout:120000});
 const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(path.join(out,name+'.log'),log);
 results.push({name,command:[process.execPath,...args],exitCode:result.status,expectedExitCode:expected,faultApplied:log.includes('CHAIR_REGISTRATION_FAULT_APPLIED')});
 if(result.status!==expected)throw Error(name+' returned '+result.status);
 if(fault&&(!log.includes('CHAIR_REGISTRATION_FAULT_APPLIED')||!log.includes('keeps each quarter turn on the source chair origin')))throw Error('Failure did not establish the intended registration regression');
}
try{run('baseline',false,0);run('old-anchor',true,1);run('restored',false,0);}
finally{const inputsAfter=hashes(),unchanged=original.equals(fs.readFileSync(source))&&JSON.stringify(inputsBefore)===JSON.stringify(inputsAfter);fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({results,sourceSha256:sha(original),inputsBefore,inputsAfter,productionUnchanged:unchanged,mechanism:'Fault exists only in an isolated Vitest transform; source and owner browser are never modified.'},null,2));if(!unchanged)throw Error('Verification inputs changed');}
console.log('Original chair offset rejected; unmodified production passes before and after.');
