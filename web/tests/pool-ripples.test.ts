import {describe,expect,it} from 'vitest';
import {collectPoolWaterContacts,PoolLandingRipples,type PoolWaterFootprint} from '../src/render/character/pool-water-contact.js';
import {poolRipplePipelineDescriptor} from '../src/render/character/pool-ripples.js';

const water:PoolWaterFootprint={minimum:[-.85,-.85],maximum:[.85,.85],height:.82};
const names=['hips','forearm.L','forearm.R','foot.R'];
const pose=()=>Float32Array.from(names.flatMap(()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));
function point(x:number,y:number,z:number,bone:number):number[]{
  return [x,y,z,0,0,0,bone,0,0,0,1,0,0,0,0,3];
}

describe('pool water contacts',()=>{
  it('follows the actual posed torso and left hand on the installed water plane',()=>{
    const cage=Float32Array.from([
      ...point(0,0,.78,0),...point(0,0,.86,0),
      ...point(-.35,-.15,.78,1),...point(-.35,-.15,.87,1),
      ...point(.3,0,.99,2),...point(.3,0,1.05,2),
      ...point(.1,.1,.78,3),
    ]);
    const body={cage,manifest:{bones:names.map(name=>({name}))}};
    const matrix=pose();
    matrix[16+12]=-.18;
    const contacts=collectPoolWaterContacts(body,cage,matrix,water,[.05,0,0]);
    expect(contacts.ripples).toHaveLength(2);
    expect(contacts.ripples[0].x).toBeCloseTo(.05);
    expect(contacts.ripples[1].x).toBeCloseTo(-.48);
    expect(contacts.touchdown?.[0]).toBeCloseTo(.15);
    expect(contacts.touchdown?.[1]).toBeCloseTo(.1);
  });

  it('rejects an airborne pose and feet at water height outside the basin',()=>{
    const cage=Float32Array.from([...point(0,0,1,0),...point(0,0,1.2,0),...point(0,.98,.82,3)]);
    const body={cage,manifest:{bones:names.map(name=>({name}))}};
    expect(collectPoolWaterContacts(body,cage,pose(),water,[0,0,0])).toEqual({ripples:[],touchdown:null});
  });
});

describe('pool landing disturbance',()=>{
  it('follows the first actual water contact, pauses with the clock and fades into paddling',()=>{
    const tracker=new PoolLandingRipples();
    const frame=(tick:number,entry:boolean,contact:readonly[number,number]|null)=>{
      tracker.begin(tick);
      return tracker.observe(1,2,entry,contact);
    };
    expect(frame(10,false,null)).toBeNull();
    expect(frame(12,true,null)).toBeNull();
    const landed=frame(15,true,[.1,-.2]);
    expect(landed).toMatchObject({x:.1,y:-.2});
    expect(frame(15,false,[.2,-.2])).toEqual(landed);
    const fading=frame(17,false,[.2,-.2]);
    expect(fading!.radius).toBeGreaterThan(landed!.radius);
    expect(fading!.strength).toBeLessThan(landed!.strength);
    expect(frame(22,false,[.2,-.2])).toBeNull();
  });

  it('does not invent an earlier splash on load, retreat, or another fixture',()=>{
    const tracker=new PoolLandingRipples();
    tracker.begin(18);
    expect(tracker.observe(1,2,false,[0,0])).toBeNull();
    tracker.begin(19);
    expect(tracker.observe(1,2,false,null)).toBeNull();
    tracker.begin(20);
    expect(tracker.observe(1,3,true,[0,0])).toBeNull();
  });
});

it('blends into scene color using opaque depth without changing scene ownership or depth',()=>{
  const descriptor=poolRipplePipelineDescriptor({} as GPUShaderModule);
  expect(descriptor.fragment?.targets).toHaveLength(1);
  expect(descriptor.depthStencil).toMatchObject({
    format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal',
  });
});
