import { describe, expect, it } from 'vitest';
import { SURFACE_LAYOUTS, spriteIndex } from '../src/render/atlas.js';
import { surfaceItemCount, surfaceItemSprite, surfacePointIndex } from '../src/render/surface-items.js';

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
