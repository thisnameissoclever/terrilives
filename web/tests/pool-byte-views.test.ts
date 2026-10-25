import {expect,it} from 'vitest';
import {poolByteViewsEqual} from '../src/render/character/pool-contact-identity.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';

const previous=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&!a.some((v,i)=>v!==b[i]);
function check(a:Uint8Array,b:Uint8Array,expected:boolean){expect(poolByteViewsEqual(a,b)).toBe(expected);expect(poolByteViewsEqual(a,b)).toBe(previous(a,b));}

it('compares every word byte, tail length and offset residue within the supplied ranges',()=>{
  for(let length=0;length<=17;length++)for(let leftOffset=0;leftOffset<4;leftOffset++)for(let rightOffset=0;rightOffset<4;rightOffset++){
    const left=new Uint8Array(length+12).fill(0xa5),right=new Uint8Array(length+12).fill(0x5a),a=left.subarray(leftOffset,leftOffset+length),b=right.subarray(rightOffset,rightOffset+length);
    for(let i=0;i<length;i++)a[i]=b[i]=(i*73+19)%256;
    check(a,b,true);check(a,new Uint8Array(length+1),false);
    for(let i=0;i<length;i++){b[i]^=0x80;check(a,b,false);b[i]^=0x80;}
  }
});

it('ignores unequal backing-buffer sentinels outside nonzero aligned view ranges',()=>{
  const a=new Uint8Array(48).fill(0xa3),b=new Uint8Array(64).fill(0x71);
  a.set([1,2,3,4,5,6,7],8);b.set([1,2,3,4,5,6,7],20);
  check(a.subarray(8,15),b.subarray(20,27),true);b[26]^=1;check(a.subarray(8,15),b.subarray(20,27),false);
});

it('compares distinct and overlapping subviews without extending either range',()=>{
  const data=new Uint8Array(64).fill(0x37);
  for(const [aStart,bStart,length] of [[4,8,12],[5,7,11],[8,12,3],[9,10,2]]){
    const a=data.subarray(aStart,aStart+length),b=data.subarray(bStart,bStart+length);check(a,b,true);
    data[bStart+length-1]^=0x80;check(a,b,false);data[bStart+length-1]^=0x80;
  }
});

it('preserves signed-zero and NaN payload bits rather than comparing floating values',()=>{
  for(const words of [[0,0x80000000],[0x7fc00001,0x7fc00002],[0x7fa00001,0x7fa00002]]){
    const a=new Uint32Array([words[0]]),b=new Uint32Array([words[0]]);check(new Uint8Array(a.buffer),new Uint8Array(b.buffer),true);
    b[0]=words[1];check(new Uint8Array(a.buffer),new Uint8Array(b.buffer),false);
  }
  const a=new Uint32Array([0,0x7ff80000]),b=new Uint32Array([0,0x7ff80000]);check(new Uint8Array(a.buffer),new Uint8Array(b.buffer),true);
  b[0]=1;check(new Uint8Array(a.buffer),new Uint8Array(b.buffer),false);
  const positive=new Uint32Array([0,0]),negative=new Uint32Array([0,0x80000000]);check(new Uint8Array(positive.buffer),new Uint8Array(negative.buffer),false);
});

it('does not turn detached-buffer errors into identity or empty-view equality',()=>{
  const buffer=new ArrayBuffer(8),view=new Uint8Array(buffer);structuredClone(buffer,{transfer:[buffer]});
  expect(()=>poolByteViewsEqual(view,view)).toThrow(TypeError);
});

it('preserves equal scans and first/middle/last differences on actual body and two-piece view sizes',()=>{
  const appearance=defaultAppearance('feminine'),selected=new PreparedBody(poolBase,appearance).select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const views=[selected.body,selected.extra!].flatMap(g=>[g.cage,g.indices,g.stencilRanges,new Uint8Array(g.stencilWeights)]);
  for(const value of views){const a=new Uint8Array(value.buffer,value.byteOffset,value.byteLength),b=a.slice();check(a,b,true);
    for(const index of [0,Math.floor(a.length/2),a.length-1]){b[index]^=0x80;check(a,b,false);b[index]^=0x80;}
  }
});
