/** Export one physically verified pool artifact. Run with --help for options. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {deserialize} from 'node:v8';
import {createServer} from 'vite';

const {values} = parseArgs({options:{
  help:{type:'boolean'},family:{type:'boolean'},'split-motion':{type:'string'},'split-fixture':{type:'string'},appearance:{type:'string'},input:{type:'string'},compiled:{type:'string'},
  'compiled-sha256':{type:'string'},'release-config':{type:'string'},'release-identity':{type:'string'},output:{type:'string'},
}});
if(values.help){
  console.log('package-pool-motion --output NEW_DIR (--appearance FILE | --input FILE) [--release-config VITE_CONFIG] [--release-identity FILE] [--compiled NODE_V8_FILE --compiled-sha256 HEX] [--family [--split-motion FILE --split-fixture FILE]]');
  process.exit(0);
}
if(!values.output||Boolean(values.appearance)===Boolean(values.input)||Boolean(values.compiled)!==Boolean(values['compiled-sha256'])||
  Boolean(values['split-motion'])!==Boolean(values['split-fixture'])||values['split-motion']&&!values.family)
  throw new Error('Supply a fresh output directory, one appearance or input, and both the retained artifact and its verified digest when reusing a compile.');
const web=fileURLToPath(new URL('../',import.meta.url)),repo=path.dirname(path.resolve(web));
const output=path.resolve(values.output),configFile=values['release-config']?path.resolve(values['release-config']):false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const elapsed=start=>performance.now()-start;
const originalFetch=globalThis.fetch,originalLocation=globalThis.location;
const origin='http://local-pool-packet.invalid';
globalThis.location={href:origin+'/'};
globalThis.fetch=async request=>{
  const url=new URL(request instanceof Request?request.url:request,globalThis.location.href);
  if(url.origin!==origin)throw new Error('A release asset must resolve inside the local checkout.');
  const name=decodeURIComponent(url.pathname);
  const file=path.resolve(name.startsWith('/@fs/')?name.slice(5):path.join(repo,name.slice(1)));
  const relative=path.relative(repo,file);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Release asset escapes the checkout.');
  try{return new Response(await readFile(file));}
  catch(error){if(error.code==='ENOENT')return new Response(null,{status:404});throw error;}
};
let server;
try{
  server=await createServer({root:web,configFile,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:{ignored:['**/*']}}});
  const load=name=>server.ssrLoadModule('/src/render/character/'+name+'.ts');
  const preparation=await load('pool-contact-preparation'),codec=await load('pool-bundled-artifact');
  const protocol=await load('pool-contact-protocol'),sampling=await load('pool-contact-sample'),release=await load('pool-contact-release');
  const input=values.input?await json(values.input):await preparation.createPoolContactInput(
    (await server.ssrLoadModule('/src/character/schema.ts')).validateAppearance(await json(values.appearance)));
  await protocol.verifyPoolContactInput(input);
  const stages=[],timing={},identity=values['release-identity']?await json(values['release-identity']):undefined;
  if(identity&&release.poolContactRelease.selection?.sourceText!==identity.bundleMarker)throw new Error('Loaded release does not match the supplied release identity.');
  let artifact;
  if(values.compiled){
    const original=await readFile(values.compiled);
    if(hash(original)!==values['compiled-sha256'].toLowerCase())throw new Error('Retained compiler output differs from its expected SHA-256.');
    artifact=deserialize(original);
  }else{
    const start=performance.now();
    artifact=await preparation.compilePoolContact(input,{stage:s=>stages.push(s)});
    timing.coldCompilerMs=elapsed(start);
  }
  protocol.validatePoolArtifactForInput(artifact,input);
  const {rig,geometry,shape,top,fixture,definition}=await preparation.loadPoolContactSources(input);
  const takeoff=release.poolContactTakeoffPhase();
  let start=performance.now();sampling.bindPoolContacts(artifact,geometry[0],shape,top,[geometry[1]],fixture,takeoff);
  timing.originalBindMs=elapsed(start);
  start=performance.now();const bytes=codec.packCompletePoolArtifact(input,artifact);timing.packMs=elapsed(start);
  const sha256=hash(bytes),file=sha256+'.pool',record={key:input.key,sha256,byteLength:bytes.byteLength,file};
  start=performance.now();
  const decoded=await codec.loadBundledPoolArtifact(input,[{...record,url:file}],async()=>new Response(bytes));
  if(!decoded)throw new Error('The freshly encoded complete artifact could not be read.');
  timing.packetReadValidateMs=elapsed(start);
  start=performance.now();sampling.bindPoolContacts(decoded,geometry[0],shape,top,[geometry[1]],fixture,takeoff);
  timing.packetBindMs=elapsed(start);
  const pose=(a,clip,frame)=>sampling.requirePoolPose(a,geometry[0],shape,top,clip,frame);
  const checks=[];
  for(const action of protocol.POOL_ACTIONS){
    const frames=rig.manifest.actions[action].length;
    for(const f of [0,(frames-1)/2,frames-1]){
      const original=pose(artifact,action,f),roundtrip=pose(decoded,action,f);
      if(original.byteLength!==roundtrip.byteLength||!Buffer.from(original.buffer,original.byteOffset,original.byteLength).equals(
        Buffer.from(roundtrip.buffer,roundtrip.byteOffset,roundtrip.byteLength)))throw new Error('Decoded skin matrices differ at '+action+' frame '+f);
      checks.push([action,f]);
    }
  }
  let family;
  if(values.family){
    const {PoolCycleSource,validatePoolCycleDefinition}=await load('pool-cycle-source'),{describeSharedPoolRoute,describeSplitPoolRoute}=await load('pool-shape-route');
    const source=new PoolCycleSource(rig.manifest,shape,top,geometry,fixture,definition);
    let template=describeSharedPoolRoute(source,artifact);
    if(values['split-motion']){
      const motionBytes=await readFile(values['split-motion']),split=JSON.parse(motionBytes);
      validatePoolCycleDefinition(split);
      const next=(await load('pool-owned-fixture')).parseOwnedPoolFixture(await readFile(values['split-fixture'],'utf8'));
      if(next.revisions.poseProducer!==hash(motionBytes))throw new Error('Split fixture and motion digests disagree.');
      template=describeSplitPoolRoute(template,fixture,split,next);
    }
    const controls=codec.encodePoolRoute(template),sha256=hash(controls);
    family={controls,index:{sha256,byteLength:controls.byteLength,file:sha256+'.poolroute'}};
  }
  await mkdir(output,{recursive:false});
  await writeFile(path.join(output,file),bytes,{flag:'wx'});
  if(family){
    await writeFile(path.join(output,family.index.file),family.controls,{flag:'wx'});
    await writeFile(path.join(output,'family.json'),JSON.stringify(family.index,null,2)+'\n',{flag:'wx'});
  }
  const report={source:values.compiled?'verified retained compiler result':'cold owned compiler',compiledSha256:values['compiled-sha256'],
    inputKey:input.key,appearanceKey:input.appearanceKey,revisions:input.revisions,shapeKey:artifact.shapeKey,partKeys:artifact.partKeys,
    coverage:artifact.coverage,timing,stages,replayedSamples:checks};
  await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(output,'index.json'),JSON.stringify({...record,bundleMarker:identity?.bundleMarker},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,...record,timing,replayedSamples:checks.length}));
}finally{
  try{await server?.close();}
  finally{globalThis.fetch=originalFetch;if(originalLocation===undefined)delete globalThis.location;else globalThis.location=originalLocation;}
}
