import {afterEach,expect,it,vi} from 'vitest';
import {SPRITES} from '../src/render/atlas.js';
import {loadIndicatorCoverage,indicatorAnchorY} from '../src/render/indicator-coverage.js';

afterEach(()=>vi.unstubAllGlobals());

it('loads visible-bottom coverage for every activity and conversation annotation',()=>{
 vi.stubGlobal('OffscreenCanvas',class {
  constructor(public width:number,public height:number){}
  getContext(){return {drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(this.width*this.height*4).fill(255)})};}
 });
 const indicators=SPRITES.map((sprite,index)=>({sprite,index})).filter(({sprite})=>/^(activity|conversation)/.test(sprite.name));
 expect(indicators.filter(({sprite})=>sprite.name.startsWith('conversation')).length).toBeGreaterThan(20);
 for(const page of new Set(indicators.map(({sprite})=>sprite.page??0)))loadIndicatorCoverage({} as ImageBitmap,page);
 for(const {index} of indicators)for(const scale of [.75,1,2.5])expect(indicatorAnchorY(index,100,scale)).toBeCloseTo(100-25*scale);
});
