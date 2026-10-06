import {expect,it} from 'vitest';
import {cleaningFrame} from '../src/render/cleaning-animation.js';
import {simBodySprite, cleaningBinSprite} from '../src/frame.js';
import {RIGGED_SIM_VARIANTS, SPRITE_DINING_SUPPORT, SPRITE_CONTENT_BOUNDS, SPRITE_ANCHORS, spriteIndex} from '../src/render/atlas.js';
import {pickSprite} from '../src/input.js';

it('moves through a complete mopping cycle during one floor patch',()=>{
  expect([0,125,250,500,875].map(p=>cleaningFrame(14,p,8,false))).toEqual([0,1,2,4,7]);
});
it('wipes repeatedly but plays bin emptying once without restarting the lift',()=>{
  expect(cleaningFrame(15,334,6,false)).toBe(0);
  expect(cleaningFrame(16,500,6,false)).toBe(3);
  expect(cleaningFrame(17,500,8,false)).toBe(4);
  expect(cleaningFrame(17,1000,8,false)).toBe(7);
});
it('holds a useful middle pose for reduced motion',()=>{
  expect(cleaningFrame(14,125,8,true)).toBe(4);
  expect(cleaningFrame(17,10,8,true)).toBe(4);
});

it('uses every cleaning frame and palette in every direction without a wall clock',()=>{
  for (const [action,name,count] of [[14,'mop',8],[15,'wipe_counter',6],[16,'wipe_table',6],[17,'empty_bin',8]] as const) {
    for (const [simId,variant] of [[0,'blue'],[1,'green'],[2,'red']] as const) {
      for(let facing=1;facing<=4;facing++) {
        const seen=new Set<number>();
        const frames=RIGGED_SIM_VARIANTS[variant][name].frames[facing-1];
        expect(new Set(frames).size).toBe(count);
        for(let progress=0;progress<1000;progress+=10) {
          const body=simBodySprite(40,action,facing,0,false,0,0,simId,0,false,progress);
          expect(simBodySprite(40,action,facing,99999,false,0,0,simId,0,false,progress)).toBe(body);
          seen.add(body);
          if(action!==14) expect(SPRITE_DINING_SUPPORT[body]).toBeDefined();
          expect(simBodySprite(40,action,facing,0,true,0,0,simId,0,false,progress)).toBe(frames[Math.floor(count/2)]);
        }
        expect([...seen].sort()).toEqual([...frames].sort());
      }
    }
  }
});

it('opens and closes the bin lid in the same progress interval as the bag lift',()=>{
  for(const facing of ['SE','NW','SW','NE']) {
    const empty=spriteIndex('offlineTrashcan'+(facing==='SE'?'':facing));
    expect(cleaningBinSprite(empty,0,false)).toBe(empty);
    expect(cleaningBinSprite(empty,500,false)).toBe(spriteIndex(`cleaningBin${facing}4`));
    expect(cleaningBinSprite(empty,999,false)).toBe(spriteIndex(`cleaningBin${facing}7`));
    expect(cleaningBinSprite(empty,1,true)).toBe(spriteIndex(`cleaningBin${facing}4`));
  }
});

it('picks the raised lid using its displayed frame in every facing and zoom',()=>{
  for(const facing of ['SE','NW','SW','NE'])for(const scale of [.65,1,2]) {
    const empty=spriteIndex('offlineTrashcan'+(facing==='SE'?'':facing));
    const open=cleaningBinSprite(empty,500,false);
    const [left,top,right]=SPRITE_CONTENT_BOUNDS[open];
    const [ax,ay]=SPRITE_ANCHORS[open];
    const source={count:1,positions:()=>new Float32Array([0,0]),ids:()=>new Uint32Array([7]),
      kinds:()=>new Uint32Array([1]),sprites:()=>new Uint32Array([empty]),activities:()=>new Uint32Array([0]),
      choreProgress:()=>new Uint32Array([500])};
    const x=((left+right)/2-ax)*scale,y=(21+top+1-ay)*scale;
    expect(pickSprite(source,x,y,0,0,scale)).toEqual({entity:7,isAgent:false});
    expect(pickSprite({...source,choreProgress:()=>new Uint32Array([0])},x,y,0,0,scale)).toBeNull();
  }
});
