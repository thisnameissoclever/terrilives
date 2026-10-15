import { describe, expect, it } from 'vitest';
import { SURFACE_LAYOUTS, spriteIndex } from '../src/render/atlas.js';
import { surfaceItemCount, surfaceItemSprite, surfacePointIndex, surfaceItemDishIds } from '../src/render/surface-items.js';

describe('authored surface occupancy',()=>{
  it.each(['','NW','SW','NE'])('keeps counter prep and all three meals apart in facing %s',(facing)=>{
    const layout=SURFACE_LAYOUTS[spriteIndex('offlineCounter'+facing)];
    expect(surfaceItemCount(layout,3,3)).toBe(4);
    expect(new Set(Array.from({length:4},(_,i)=>surfacePointIndex(layout,3,i))).size).toBe(4);
    expect(surfacePointIndex(layout,0,0)).toBe(1);
    expect(surfaceItemSprite(layout,3,0)).toBe(spriteIndex('dirtyPrep'+facing));
    expect(surfaceItemSprite(layout,1,0)).toBe(spriteIndex('dirtyDishes'+facing));
    expect(surfaceItemSprite(layout,6,0)).toBe(spriteIndex('dirtyPrepLarge'+facing));
    for(let i=1;i<4;i++) expect(surfaceItemSprite(layout,3,i)).toBe(spriteIndex('mealPlate'+facing));
  });
  it('never creates a floating pile on unsupported furniture',()=>{
    expect(surfaceItemCount(SURFACE_LAYOUTS[spriteIndex('offlineSink')],4,0)).toBe(0);
  });
});

describe('exact meal settings and cooking support',()=>{
  it('matches counter prep slot four without selecting adjacent meals or other surfaces',()=>{
    const layout=SURFACE_LAYOUTS[spriteIndex('offlineCounter')],piles=new Uint32Array([90,4,701,90,1,702,91,4,703,90,4,704]);
    expect(surfaceItemDishIds(layout,90,3,0,piles)).toEqual([701,704]);
    expect(surfaceItemDishIds(layout,90,3,1,piles)).toEqual([]);
    expect(surfaceItemDishIds(layout,90,0,0,piles)).toEqual([]);
  });
  it('matches stable dish IDs to each visible table setting, including stacks',()=>{
    const layout=SURFACE_LAYOUTS[spriteIndex('offlineDiningTable')],piles=new Uint32Array([90,0,701,90,2,702,91,2,703,90,2,704,90,3,705]);
    const settings=1|(2<<8);
    expect(surfaceItemDishIds(layout,90,3,0,piles,settings)).toEqual([701]);
    expect(surfaceItemDishIds(layout,90,3,1,piles,settings)).toEqual([702,704]);
    expect(surfaceItemDishIds(SURFACE_LAYOUTS[spriteIndex('offlineStove')],90,3,0,piles)).toEqual([]);
  });
  it('draws only dirty settings, including a piled setting, and clears washed slots',()=>{
    const layout=SURFACE_LAYOUTS[spriteIndex('offlineDiningTable')];
    const packed=1 | (2<<8);
    expect(surfaceItemCount(layout,3,0,packed)).toBe(2);
    expect(surfacePointIndex(layout,3,0,packed)).toBe(0);
    expect(surfacePointIndex(layout,3,1,packed)).toBe(2);
    expect(surfaceItemSprite(layout,3,1,packed)).toBe(layout.props[1]);
    expect(surfaceItemCount(layout,1,0,1)).toBe(1);
    expect(surfaceItemCount(layout,0,0,0)).toBe(0);
  });
  it.each(['','NW','SW','NE'])('supports a pot at every exact cook-facing contact on stove %s',suffix=>{
    const layout=SURFACE_LAYOUTS[spriteIndex('offlineStove'+suffix)];
    expect(surfaceItemCount(layout,0,0,undefined,0)).toBe(0);
    for(let facing=1;facing<=4;facing++){
      expect(surfaceItemCount(layout,0,0,undefined,facing)).toBe(1);
      expect(surfacePointIndex(layout,0,0,undefined,facing)).toBe(facing-1);
      expect(surfaceItemSprite(layout,0,0,undefined,facing)).toBe(layout.props[facing-1]);
    }
  });
});
