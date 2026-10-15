const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const ts=require(path.resolve('web/node_modules/typescript/lib/typescript.js'));
const original=Module._resolveFilename;Module._resolveFilename=function(request,parent,...rest){if(request.endsWith('.js')&&parent){const candidate=path.resolve(path.dirname(parent.filename),request.slice(0,-3)+'.ts');if(fs.existsSync(candidate))request=candidate;}return original.call(this,request,parent,...rest);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const root=path.resolve('web/src/render/character'),base=path.resolve('assets/models/sims/character-creator');
const {decodeGeometry,geometryBuffers}=require(path.join(root,'bundle.ts')),{combineClipFamily}=require(path.join(root,'clip-runtime.ts'));
const manifest=JSON.parse(fs.readFileSync(path.join(base,'export/manifest.json'),'utf8')),library=JSON.parse(fs.readFileSync(path.join(base,'clips/clips.json'),'utf8'));
function read(description,folder){const buffers=Object.fromEntries(geometryBuffers.map(key=>[key,Uint8Array.from(fs.readFileSync(path.join(base,folder,description[key]))).buffer]));return decodeGeometry({...manifest,runtime:description},'runtime',buffers);}
const geometry=read(manifest.runtime,'export');
function family(name){const parts=JSON.parse(fs.readFileSync(path.join(base,'clips',name,'parts.json'),'utf8'));return combineClipFamily(geometry,parts.geometry?read(parts.geometry,'clips/'+name):null,parts,library,name);}
module.exports={root,base,geometry,library,family,api:name=>require(path.join(root,name+'.ts')),schema:require(path.resolve('web/src/character/schema.ts'))};
