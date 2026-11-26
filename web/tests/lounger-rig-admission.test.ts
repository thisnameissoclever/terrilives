import {expect,it,vi} from 'vitest';
import type {SimBridge} from '../src/bridge.js';
import type {CharacterRig,ClipLibrary} from '../src/render/character/clip-runtime.js';
import type {Geometry} from '../src/render/character/bundle.js';

const mocked=vi.hoisted(()=>({families:[] as string[],base:{manifest:{actions:{idle:[[]]}}} as unknown as Geometry}));
vi.mock('../src/render/character/bundle.js',()=>({loadGeometryAssets:async()=>mocked.base}));
vi.mock('../src/render/character/asset-download.js',()=>({readCharacterAsset:async()=>new TextEncoder().encode('{"geometry":null}').buffer}));
vi.mock('../src/render/character/body-variants.js',()=>({withBodyVariants:(rig:CharacterRig)=>rig,prepareMopHandVariant:()=>({})}));
vi.mock('../src/render/character/clip-runtime.js',()=>({
  prepareClipFamily(base:Geometry,_supplemental:unknown,_parts:unknown,library:ClipLibrary,family:string):CharacterRig {
    mocked.families.push(family);
    const actions=Object.fromEntries(Object.entries(library.clips).filter(([,clip])=>clip.family===family).map(([action])=>[action,[[]]]));
    return {base,manifest:{...base.manifest,actions},family,supplemental:null};
  },
  withLoungerRecline:(rig:CharacterRig)=>rig,
}));

import {loadBaseWorldRigs,prepareWorldLoungerRig} from '../src/render/character/creator-assets.js';

it('loads no pool assets for a Sunstrip-free lot and shares admission when a lot needs the pose',async()=>{
  function lot(model:string):Pick<SimBridge,'ids'|'kinds'|'objectModel'> {
    return {ids:()=>new Uint32Array([10,20]),kinds:()=>new Uint32Array([0,1]),
      objectModel:()=>({id:model}) as ReturnType<SimBridge['objectModel']>};
  }
  vi.stubGlobal('location',{href:'http://example.test/'});
  try{
    expect(prepareWorldLoungerRig(lot('chair'))).toBeUndefined();
    const rigs=await loadBaseWorldRigs();
    expect(rigs.has('lounger_recline')).toBe(false);
    expect(mocked.families).not.toContain('pool');
    const pending=prepareWorldLoungerRig(lot('pool_lounger'));
    expect(pending).toBeDefined();
    expect(prepareWorldLoungerRig(lot('pool_lounger'))).toBe(pending);
    expect(prepareWorldLoungerRig(lot('chair'))).toBeUndefined();
    await pending;
    expect(rigs.has('lounger_recline')).toBe(true);
    expect(mocked.families.filter(family=>family==='pool')).toEqual(['pool']);
    expect(prepareWorldLoungerRig(lot('pool_lounger'))).toBeUndefined();
  }finally{vi.unstubAllGlobals();}
});
