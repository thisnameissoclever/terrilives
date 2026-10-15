import {expect,it} from 'vitest';
import {SupportSurface} from '../src/render/character/support-surface.js';
it('measures upper and lower surfaces rather than bounding-box height',()=>{
  const surface=new SupportSurface([[0,0,0],[1,0,0],[0,1,1],[0,0,2],[1,0,2],[0,1,3]],[[0,1,2],[3,4,5]]);
  expect(surface.height(.2,.3,'bottom')).toBeCloseTo(.3);
  expect(surface.height(.2,.3,'top')).toBeCloseTo(2.3);
  expect(surface.height(.8,.8,'top')).toBeUndefined();
});
