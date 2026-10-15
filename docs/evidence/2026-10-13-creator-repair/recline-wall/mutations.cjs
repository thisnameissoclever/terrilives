const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../../..'),isolated=path.join(root,'.scratch/creator-repair-validation');
const files=['web/src/render/character/recline-fit.ts','web/src/render/character/interaction-pose.ts','web/src/render/character/authored-surfaces.ts','web/src/render/character/renderer.ts','web/src/render/character/head-envelope.ts','web/tests/character-recline-fit.test.ts','web/tests/recline-measurement.ts'];
for(const directory of ['web/src','web/src/render/character','web/tests'])if(fs.lstatSync(path.join(isolated,directory)).isSymbolicLink())throw Error('Mutation directory is linked: '+directory);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before=Object.fromEntries(files.map(file=>[file,hash(path.join(root,file))]));
for(const file of files)fs.copyFileSync(path.join(root,file),path.join(isolated,file));
const mutations=[
  ['omit-fit','web/src/render/character/interaction-pose.ts','    fitRecliningPose(context.geometry,appearance,top,matrices,rest,rig,source);','    void context.geometry;'],
  ['omit-head-turn','web/src/render/character/recline-fit.ts','  world[head]=multiply(turn,world[head]);','  void turn;'],
  ['omit-torso-support','web/src/render/character/recline-fit.ts','const dz=supportShift(torso,seat,0,dy)','const dz=0'],
  ['omit-heel-placement','web/src/render/character/recline-fit.ts','    world[foot].splice(12,3,...end);','    void end;'],
  ['restrict-neck-search','web/src/render/character/recline-fit.ts','degree<=60','degree<=35','facial features'],
];
const env={...process.env,NODE_OPTIONS:'--max-old-space-size=4096'};delete env.RECLINE_EVIDENCE;
const run=(label,pattern='supports both presentations')=>{
  const result=cp.spawnSync(process.execPath,[path.join(isolated,'web/node_modules/vitest/vitest.mjs'),'run','tests/character-recline-fit.test.ts','-t',pattern,'--maxWorkers=1'],{cwd:path.join(isolated,'web'),env,encoding:'utf8',timeout:90000,windowsHide:true});
  fs.writeFileSync(path.join(__dirname,label+'.log'),result.stdout+'\n'+result.stderr);
  return {label,exitCode:result.status,error:result.error?.message};
};
const results=[];
for(const [label,file,needle,replacement,pattern] of mutations){
  const target=path.join(isolated,file),original=fs.readFileSync(target),text=original.toString('utf8');
  if(text.split(needle).length!==2)throw Error('Mutation target is ambiguous: '+label);
  try{fs.writeFileSync(target,text.replace(needle,replacement));const result=run(label,pattern);result.detected=result.exitCode===1;results.push(result);console.log(JSON.stringify(result));}
  finally{fs.writeFileSync(target,original);if(!fs.readFileSync(target).equals(original))throw Error('Isolated restoration failed: '+label);}
}
const restored=run('restored');results.push(restored);
const after=Object.fromEntries(files.map(file=>[file,hash(path.join(root,file))]));
const receipt={root,isolated,before,after,liveUnchanged:JSON.stringify(before)===JSON.stringify(after),results,isolatedRestored:files.every(file=>hash(path.join(root,file))===hash(path.join(isolated,file)))};
receipt.status=receipt.liveUnchanged&&receipt.isolatedRestored&&results.slice(0,mutations.length).every(r=>r.detected)&&restored.exitCode===0?'PASS':'FAIL';
fs.writeFileSync(path.join(__dirname,'mutations.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:receipt.status,liveUnchanged:receipt.liveUnchanged,isolatedRestored:receipt.isolatedRestored}));if(receipt.status!=='PASS')process.exitCode=1;
