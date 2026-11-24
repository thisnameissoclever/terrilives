import { expect,it } from 'vitest';
import { SceneLayoutObserver,sceneFeedbackPosition } from '../src/ui/scene-feedback-layout.js';
import { sceneObserverHarness } from './helpers/scene-observers.js';
it('captures a nested action rail scroll to refresh its clipped child bounds', () => {
  let invalidate: (() => void) | undefined, capture = false, left = 220, reads = 0;
  const root = {hidden: false, ownerDocument: {}, getBoundingClientRect: () => ({left: 8, top: 294, right: 312, bottom: 379}),
    addEventListener: (name: string, callback: () => void, options: {capture?: boolean}) => {
      if (name === 'scroll') {invalidate = callback; capture = options.capture === true;}
    }};
  const rail = {getBoundingClientRect: () => ({left: 8, top: 294, right: 260, bottom: 365})};
  const child = {hidden: false, style: {position: 'relative'}, closest: () => rail,
    getBoundingClientRect: () => {reads++; return {left, top: 300, right: left + 136, bottom: 350};}};
  const observer = new SceneLayoutObserver(() => ({left: 0, top: 0, right: 320, bottom: 568}), [root as never], [], () => [child as never]);
  expect(observer.read().obstacles[1].right).toBe(260);
  const cached = observer.read(); expect(observer.read()).toBe(cached); expect(reads).toBe(1);
  left = 80;
  // Scroll does not bubble; only the root's capture subscription receives it.
  if (capture) invalidate?.();
  expect(observer.read().obstacles[1]).toEqual({left: 80, top: 300, right: 216, bottom: 350});
});
it('uses the painted portion of children in a scrolling menu and invalidates when that menu scrolls', () => {
  const events = new Map<string, () => void>();
  const clip = {hidden: false, ownerDocument: {}, addEventListener: (name: string, callback: () => void) => events.set(name, callback),
    getBoundingClientRect: () => ({left: 100, top: 100, right: 300, bottom: 200})};
  let top = 180;
  const child = {hidden: false, style: {position: 'absolute'}, closest: () => clip, getBoundingClientRect: () => ({left: 150, top, right: 350, bottom: top + 60})};
  const observer = new SceneLayoutObserver(() => ({left: 0, top: 0, right: 390, bottom: 844}), [clip as never], [], () => [child as never]);
  expect(observer.read().obstacles[1]).toEqual({left: 150, top: 180, right: 300, bottom: 200});
  top = 120; events.get('scroll')?.();
  expect(observer.read().obstacles[1].top).toBe(120);
  child.style.position = 'fixed'; observer.invalidate();
  expect(observer.read().obstacles[1]).toEqual({left: 150, top: 120, right: 350, bottom: 180});
});
it('measures and observes dynamic menu children even when their radial root has no area', () => {
  const observers = sceneObserverHarness();
  const menu = {hidden: false, ownerDocument: {}, getBoundingClientRect: () => ({left: 0, top: 0, right: 0, bottom: 0})};
  let right = 300, left = 100, reads = 0;
  const bubble = {hidden: false, ownerDocument: {}, getBoundingClientRect: () => {reads++; return {left, top: 110, right, bottom: 200};}};
  let children = [bubble];
  try {
    const observer = new SceneLayoutObserver(() => ({left: 0, top: 0, right: 390, bottom: 844}),
      [menu as never], [], () => children as never);
    expect(observer.read().obstacles).toEqual([{left: 100, top: 110, right: 300, bottom: 200}]);
    const unchanged = observer.read(); expect(observer.read()).toBe(unchanged); expect(reads).toBe(1);
    right = 350; observers.resize(bubble);
    expect(observer.read().obstacles[0].right).toBe(350);
    left = 170; observers.mutation(bubble);
    expect(observer.read().obstacles[0].left).toBe(170);
    bubble.hidden = true; observers.mutation(bubble);
    expect(observer.read().obstacles).toEqual([]);
    bubble.hidden = false; observers.mutation(bubble);
    expect(observer.read().obstacles).toHaveLength(1);
    right = 320; observers.resize(menu);
    expect(observer.read().obstacles[0].right).toBe(320);
    children = []; expect(observer.read().obstacles).toEqual([]);
    const closed = observer.read(); observers.mutation(bubble);
    expect(observer.read()).toBe(closed);
  } finally { observers.restore(); }
});
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
  const observer=new SceneLayoutObserver(()=>({left:0,top:0,right:390,bottom:844}),[element as unknown as HTMLElement]);
  const first=observer.read();expect(reads).toBe(1);expect(observer.read()).toBe(first);expect(reads).toBe(1);
  top=500;observer.invalidate();expect(observer.read().obstacles[0].top).toBe(500);expect(reads).toBe(2);
});

it('automatically observes measured obstacles across resize, hide and show without redundant measurements',()=>{
  const observers=sceneObserverHarness();let reads=0,top=770;
  const dock={hidden:false,ownerDocument:{},getBoundingClientRect:()=>{reads++;return {left:8,top,right:382,bottom:836};}};
  try{
    const observer=new SceneLayoutObserver(()=>({left:0,top:0,right:390,bottom:844}),[dock as unknown as HTMLElement]);
    expect(observer.read().obstacles[0].top).toBe(770);expect(reads).toBe(1);
    top=430;observers.resize(dock);const expanded=observer.read();expect(expanded.obstacles[0].top).toBe(430);
    expect(observer.read()).toBe(expanded);expect(reads).toBe(2);
    dock.hidden=true;observers.mutation(dock);expect(observer.read().obstacles).toEqual([]);expect(reads).toBe(2);
    top=600;dock.hidden=false;observers.mutation(dock);expect(observer.read().obstacles[0].top).toBe(600);expect(reads).toBe(3);
  }finally{observers.restore();}
});
