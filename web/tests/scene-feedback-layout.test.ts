import { expect,it } from 'vitest';
import { SceneLayoutObserver,sceneFeedbackPosition } from '../src/ui/scene-feedback-layout.js';
it('moves a scene receipt out of the sidebar and phone review/dock without covering controls',()=>{
  const desktop=sceneFeedbackPosition(360,60,{viewport:{left:0,top:0,right:1280,bottom:720},obstacles:[{left:8,top:8,right:312,bottom:690}]},{x:100,y:450})!;
  expect(desktop.x).toBeGreaterThanOrEqual(320);
  const phone=sceneFeedbackPosition(358,100,{viewport:{left:0,top:0,right:390,bottom:500},obstacles:[{left:8,top:8,right:262,bottom:108},{left:272,top:8,right:382,bottom:100}]},{x:195,y:650})!;
  expect(phone.y).toBeGreaterThanOrEqual(116);expect(phone.y+100).toBeLessThanOrEqual(492);
});
it('uses the body fallback around contextual actions and enlarged text, or hides when no free area exists',()=>{
  const layout={viewport:{left:0,top:0,right:390,bottom:620},obstacles:[{left:8,top:8,right:382,bottom:110},{left:35,top:350,right:355,bottom:530}]};
  const point=sceneFeedbackPosition(358,140,layout,{x:195,y:440})!;
  expect(point).not.toBeNull();expect(point.y).toBeGreaterThanOrEqual(118);expect(point.y+140).toBeLessThanOrEqual(342);
  expect(sceneFeedbackPosition(358,700,layout,null)).toBeNull();
});
it('reuses measured bounds until geometry is invalidated',()=>{
  let reads=0,top=600;
  const element={hidden:false,ownerDocument:{},getBoundingClientRect:()=>{reads++;return {left:0,top,right:390,bottom:844};}};
  const observer=new SceneLayoutObserver(()=>({left:0,top:0,right:390,bottom:844}),()=>[element as unknown as HTMLElement],[]);
  const first=observer.read();expect(reads).toBe(1);expect(observer.read()).toBe(first);expect(reads).toBe(1);
  top=500;observer.invalidate();expect(observer.read().obstacles[0].top).toBe(500);expect(reads).toBe(2);
});
