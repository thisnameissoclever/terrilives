import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {CharacterContactRoster} from '../src/render/character/contact-admission.js';
import {creatorClips,loadBaseWorldRigs,prepareWorldPoolRigs} from '../src/render/character/creator-assets.js';
import {CharacterWorld} from '../src/render/character/world.js';
import {PreparedBuildCommit} from '../src/ui/prepared-build-commit.js';
import {AdmissionTestService} from './fixtures/contact-admission-service.js';

// Geometry downloads, decoding and roster staging are real. No GPU commands are needed here.
vi.mock('../src/render/character/shower-steam.js',()=>({ShowerSteam:class {begin(){} destroy(){}}}));

it('starts a household without pool files, then gates and retries pool placement on the same world',async()=>{
  const missing='/clips/pool/runtime.vertices.bin',requests:string[]=[];
  let missingPool=true;
  vi.stubGlobal('location',new URL('http://world.test/'));
  vi.stubGlobal('fetch',async(url:URL)=>{
    const path=decodeURIComponent(url.pathname);
    const start=path.indexOf('/assets/models/');
    if(start<0)throw new Error('Unexpected character asset path: '+path);
    const relative=path.slice(start+1);
    requests.push(relative);
    if(missingPool&&path.endsWith(missing))return new Response('pool binary missing',{status:404});
    return new Response(await readFile(new URL('../../'+relative,import.meta.url)));
  });
  const service=new AdmissionTestService(),roster=new CharacterContactRoster(service,undefined,prepareWorldPoolRigs);
  const appearance=defaultAppearance(),rows=[{entity:1,appearance}];
  let world:CharacterWorld|undefined;
  try{
    world=await CharacterWorld.create({} as GPUDevice,'rgba8unorm',()=>{throw new Error('No draw expected');},roster);
    const base=roster.prepareCurrent(rows,'base');
    service.finish(appearance,'base');
    await base;
    const rigs=await loadBaseWorldRigs();
    expect(rigs.get('idle')?.manifest.actions.idle.length).toBeGreaterThan(0);
    expect(rigs.has('pool_enter')).toBe(false);
    expect(requests.some(path=>path.includes('/clips/pool/'))).toBe(false);

    const stage=roster.stage([],[],{current:'base',afterCommands:'pool-required'});
    const adopt=vi.fn(()=>true);
    try{
      await expect(stage.ready).rejects.toMatchObject({assetFailure:{status:404,path:expect.stringContaining(missing),body:'pool binary missing'}});
      expect(()=>stage.commit(adopt)).toThrow('Pool character geometry must be ready');
      expect(adopt).not.toHaveBeenCalled();
      expect(roster.mode).toBe('base');
      expect(rigs.has('pool_enter')).toBe(false);
    }finally{stage.release();}
    missingPool=false;
    const placement=new PreparedBuildCommit(roster,{poolRequired:()=>({ok:true,value:true}),appearances:()=>rows,pending:()=>{}});
    const placed=placement.run({session:1n,revision:2n,preparation:3n},()=>({ok:true,value:undefined}));
    service.finish(appearance,'pool-required');
    await expect(placed).resolves.toMatchObject({ok:true});
    expect(roster.mode).toBe('pool-required');
    expect(requests.filter(path=>path.endsWith(missing))).toHaveLength(2);
    for(const [action,clip] of Object.entries(creatorClips.clips)){
      if(clip.family==='pool')expect(rigs.get(action)?.manifest.actions[action].length,action).toBeGreaterThan(0);
    }
    const count=requests.length;
    await prepareWorldPoolRigs();
    expect(await loadBaseWorldRigs()).toBe(rigs);
    expect(requests).toHaveLength(count);
  }finally{world?.destroy();roster.dispose();vi.unstubAllGlobals();}
},60_000);
