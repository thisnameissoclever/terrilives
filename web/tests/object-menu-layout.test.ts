import { expect, it } from 'vitest';
import { actionPage, actionLayoutFits, chooseActionPlacement, layoutObjectActions, maximumActionSize } from '../src/ui/object-menu-layout.js';

it.each([0, 6, 10, 16])('budgets a measured %spx scrollbar at the shortest rail boundary', scrollbar => {
  const minimum = 44 + scrollbar;
  const place = (height: number) => chooseActionPlacement({x: 210, y: 140}, Array.from({length: 4}, () => ({width: 136, height: 50})),
    {width: 110, height: 44}, {width: 320, height: 568}, 50,
    [{left: 8, top: 8, right: 190, bottom: 285.578125}, {left: 8, top: 301.578125 + height, right: 312, bottom: 560}],
    150, {width: 304, height: 140}, scrollbar);
  const accepted = place(minimum);
  expect(accepted?.rail).toBe(true);
  const viewport = menuLayout.layoutActionRail(accepted!.region, accepted!.railHintHeight).viewport;
  expect(viewport.bottom - viewport.top - scrollbar).toBe(44);
  expect(accepted!.railHintHeight).toBe(0);
  expect(place(minimum - .125)).toBeNull();
  const hinted = place(minimum + 14)!;
  expect(hinted.railHintHeight).toBe(14);
  expect(menuLayout.layoutActionRail(hinted.region, hinted.railHintHeight).viewport.bottom - hinted.region.top - scrollbar).toBe(44);
});

it('opens a scrolling rail in the exact occupied 320x568 Bookcase state', () => {
  const viewport = {width: 320, height: 568};
  const obstacles = [{left: 8, top: 8, right: 190, bottom: 285.578125},
    {left: 8, top: 386.578125, right: 312, bottom: 560}];
  const placed = chooseActionPlacement({x: 210, y: 140}, Array.from({length: 4}, () => ({width: 136, height: 50})),
    {width: 110, height: 44}, viewport, 50, obstacles, 150, {width: 304, height: 140});
  expect(placed).not.toBeNull();
  expect(placed!.rail).toBe(true);
  expect(placed!.region).toEqual({left: 8, top: 293.578125, right: 312, bottom: 378.578125});
  expect(placed!.region.bottom - placed!.region.top).toBe(85);
  expect(placed!.capacity).toBe(3);
  const rail = menuLayout.layoutActionRail(placed!.region);
  expect(rail.viewport).toEqual({left: 8, top: 293.578125, right: 260, bottom: 364.578125});
  expect(rail.close).toEqual({x: 268, y: 307.078125});
  expect(rail.close.y + 44).toBeLessThanOrEqual(rail.viewport.bottom);
});

it('places the separate description around measured actions and keeps long text scrollable on short screens', () => {
  const obstacles = [{left: 8, top: 8, right: 180, bottom: 180}, {left: 8, top: 650, right: 382, bottom: 836},
    {left: 200, top: 350, right: 336, bottom: 394}];
  const viewport = {width: 390, height: 844};
  const placement = menuLayout.descriptionPlacement({x: 250, y: 320}, {width: 300, height: 130}, viewport, obstacles)!;
  expect(placement).not.toBeNull();
  expect(placement.height).toBe(130);
  for (const obstacle of obstacles) expect(placement.x + placement.width <= obstacle.left || placement.x >= obstacle.right
    || placement.y + placement.height <= obstacle.top || placement.y >= obstacle.bottom).toBe(true);
  const short = menuLayout.descriptionPlacement({x: 300, y: 220}, {width: 300, height: 500}, {width: 640, height: 400},
    [{left: 8, top: 8, right: 180, bottom: 380}])!;
  expect(short.height).toBeLessThan(500); expect(short.height).toBeGreaterThanOrEqual(44);
  expect(short.y + short.height).toBeLessThanOrEqual(392);
});

it.each([{width: 1280, height: 900}, {width: 390, height: 844}, {width: 320, height: 568}, {width: 640, height: 400}])(
  'keeps a separate description reachable beside the actual paginated menu in %s', viewport => {
    const obstacles = [{left: 8, top: 8, right: 190, bottom: 180},
      {left: 8, top: viewport.height - 140, right: viewport.width - 8, bottom: viewport.height - 8}];
    const anchor = {x: viewport.width / 2, y: viewport.height / 2};
    const sizes = Array.from({length: 6}, () => ({width: 136, height: 44}));
    const placement = chooseActionPlacement(anchor, sizes, {width: 100, height: 44}, viewport, 50, obstacles, 150,
      {width: Math.min(320, viewport.width - 16), height: 120})!;
    expect(placement).not.toBeNull();
    const page = actionPage(sizes.length, placement.capacity, 0);
    const visible = [...page.indices.map(index => sizes[index]), ...(page.more ? [{width: 100, height: 44}] : [])];
    const layout = layoutObjectActions(anchor, visible, viewport, placement.region.top, placement.region.bottom,
      placement.identityHeight, placement.region.left, placement.region.right, 150);
    const boxes = layout.positions.map((point, index) => ({left: point.x, top: point.y, right: point.x + visible[index].width, bottom: point.y + visible[index].height}));
    boxes.push({left: layout.identity.x, top: layout.identity.y, right: layout.identity.x + 150, bottom: layout.identity.y + placement.identityHeight},
      {left: layout.close.x, top: layout.close.y, right: layout.close.x + 44, bottom: layout.close.y + 44});
    const description = menuLayout.descriptionPlacement({x: layout.identity.x + 75, y: layout.identity.y},
      {width: Math.min(320, viewport.width - 16), height: 120}, viewport, [...obstacles, ...boxes]);
    expect(description).not.toBeNull();
  });

it('allocates the real expanded-description width and keeps it separate from actions', () => {
  const identityWidth = 210;
  for (const count of [3,5]) for (const viewport of [{width:1440,height:960}, {width:390,height:844}, {width:320,height:568}]) {
    const entries = Array.from({length:count},()=>({width:120,height:44}));
    const placed = chooseActionPlacement({x:viewport.width/2,y:240},entries,{width:120,height:44},viewport,145,[],identityWidth)!;
    expect(placed).not.toBeNull();
    expect(placed.scroll).toBe(false);
    expect(placed.identityHeight).toBe(145);
    const layout = layoutObjectActions({x:viewport.width/2,y:240},entries,viewport,placed.region.top,placed.region.bottom,placed.identityHeight,placed.region.left,placed.region.right,identityWidth);
    if (viewport.width === 1440) expect(layout.compact).toBe(false);
    if (!layout.compact) expect(layout.identity.x).toBeCloseTo(layout.center.x-identityWidth/2);
    const identity = {left:layout.identity.x,right:layout.identity.x+identityWidth,top:layout.identity.y,bottom:layout.identity.y+placed.identityHeight};
    expect(identity.left).toBeGreaterThanOrEqual(placed.region.left);
    expect(identity.right).toBeLessThanOrEqual(placed.region.right);
    for (const at of layout.positions) expect(at.x>=identity.right||at.x+120<=identity.left||at.y>=identity.bottom||at.y+44<=identity.top).toBe(true);
  }
});

it('places four independent buttons around the visible center', () => {
  const result = layoutObjectActions({ x: 600, y: 350 }, Array.from({ length: 4 }, () => ({ width: 120, height: 52 })), { width: 1280, height: 800 }, 8, 680);
  expect(result.positions[0].y).toBeLessThan(result.center.y);
  expect(result.positions[1].x).toBeGreaterThan(result.center.x);
  expect(result.positions[2].x).toBeLessThan(result.center.x);
  expect(result.positions[3].y).toBeGreaterThan(result.center.y);
});

it('keeps identity and Close visible for two actions at every edge', () => {
  for (const y of [0, 800]) {
    const result = layoutObjectActions({ x: 0, y }, [{ width: 120, height: 52 }, { width: 120, height: 52 }], { width: 1280, height: 800 });
    expect(result.identity.y).toBeGreaterThanOrEqual(8); expect(result.close.y + 44).toBeLessThanOrEqual(792);
  }
});

it('preserves action indices with Back and More on every middle page', () => {
  expect(actionPage(9, 6, 0)).toEqual({ page: 0, indices: [0, 1, 2, 3, 4], back: false, more: true });
  expect(actionPage(9, 4, 1)).toEqual({ page: 1, indices: [3, 4], back: true, more: true });
  expect(actionPage(9, 3, 4)).toEqual({ page: 4, indices: [5], back: true, more: true });
  expect(actionPage(9, 3, 8).more).toBe(false);
});

it('clamps the whole group and keeps every narrow-screen action visible', () => {
  const size = { width: 124, height: 56 };
  for (const anchor of [{ x: 0, y: 0 }, { x: 390, y: 844 }]) {
    const result = layoutObjectActions(anchor, Array.from({ length: 6 }, () => size), { width: 390, height: 844 }, 190, 660);
    for (const at of result.positions) {
      expect(at.x).toBeGreaterThanOrEqual(8); expect(at.x + size.width).toBeLessThanOrEqual(382);
      expect(at.y).toBeGreaterThanOrEqual(190); expect(at.y + size.height).toBeLessThanOrEqual(660);
    }
    result.positions.forEach((a, i) => result.positions.slice(i + 1).forEach(b => {
      expect(a.x + size.width <= b.x || b.x + size.width <= a.x || a.y + size.height <= b.y || b.y + size.height <= a.y).toBe(true);
    }));
  }
});

it('reserves separate identity and Close space after opening a long description', () => {
  const result = layoutObjectActions({ x: 900, y: 200 }, Array.from({ length: 4 }, () => ({width: 120, height: 52})), {width: 1280, height: 800}, 8, 680, 196);
  expect(result.identity.y + 196).toBeLessThanOrEqual(result.close.y);
  expect(result.identity.y).toBeGreaterThanOrEqual(8);
  expect(result.close.y + 44).toBeLessThanOrEqual(680);
});

it('keeps mixed-height pages on a stable capacity derived from all actions', () => {
  const all = [{width: 120, height: 88}, ...Array.from({length: 8}, () => ({width: 120, height: 44}))];
  const maximum = maximumActionSize(all);
  expect(maximum.height).toBe(88);
  const capacity = chooseActionPlacement({x:400,y:100},all,{width:120,height:44},{width:640,height:400},48,[{left:0,top:258,right:640,bottom:400}])!.capacity;
  expect(capacity).toBe(4);
  const visited: number[] = [];
  for (let page = 0; ; page++) {
    const current = actionPage(all.length, capacity, page); visited.push(...current.indices);
    if (!current.more) break;
  }
  expect(visited).toEqual([0,1,2,3,4,5,6,7,8]);
});

it('keeps a short-screen group in the free area beside the HUD', () => {
  const size = {width: 125, height: 44};
  const result = layoutObjectActions({x: 260, y: 100}, Array.from({length: 4}, () => size), {width: 640, height: 400}, 8, 250, 48, 198, 632);
  for (const at of result.positions) {
    expect(at.x).toBeGreaterThanOrEqual(198); expect(at.x + size.width).toBeLessThanOrEqual(632);
    expect(at.y).toBeGreaterThanOrEqual(8); expect(at.y + size.height).toBeLessThanOrEqual(250);
  }
});


it.each([
  {viewport:{width:390,height:844},anchor:{x:800,y:-100},hud:{left:8,top:8,right:190,bottom:220},dock:{left:8,top:700,right:382,bottom:836},identity:160},
  {viewport:{width:640,height:400},anchor:{x:260,y:100},hud:{left:8,top:8,right:190,bottom:220},dock:{left:200,top:268,right:632,bottom:392},identity:160},
  {viewport:{width:844,height:390},anchor:{x:-100,y:500},hud:{left:8,top:8,right:190,bottom:220},dock:{left:200,top:258,right:836,bottom:382},identity:48},
])('places every page outside measured HUD/dock obstacles after clamping ($viewport.width)', ({viewport,anchor,hud,dock,identity}) => {
  const size={width:136,height:64}, entries=Array.from({length:9},()=>size), obstacles=[hud,dock];
  const placement=chooseActionPlacement(anchor,entries,{width:136,height:72},viewport,identity,obstacles)!;
  expect(placement).not.toBeNull(); expect(placement.scroll).toBe(false);
  const uniform={width:136,height:72};
  for(let page=0;page<9;page++) {
    const part=actionPage(entries.length,placement.capacity,page);
    const sizes=Array.from({length:part.indices.length+Number(part.back)+Number(part.more)},()=>uniform);
    const r=placement.region, layout=layoutObjectActions(anchor,sizes,viewport,r.top,r.bottom,placement.identityHeight,r.left,r.right);
    expect(actionLayoutFits(layout,sizes,placement.identityHeight,r)).toBe(true);
    const boxes=[...layout.positions.map(at=>({left:at.x,top:at.y,right:at.x+uniform.width,bottom:at.y+uniform.height})),
      {left:layout.identity.x,top:layout.identity.y,right:layout.identity.x+88,bottom:layout.identity.y+placement.identityHeight},
      {left:layout.close.x,top:layout.close.y,right:layout.close.x+44,bottom:layout.close.y+44}];
    for(const box of boxes) for(const obstacle of obstacles) expect(box.right<=obstacle.left || box.left>=obstacle.right || box.bottom<=obstacle.top || box.top>=obstacle.bottom).toBe(true);
    if(!part.more)break;
  }
});

it('recomputes safe placement when paused status text enlarges the HUD', () => {
  const viewport={width:390,height:844},size={width:136,height:64},anchor={x:800,y:100};
  const place=(bottom:number)=>chooseActionPlacement(anchor,Array.from({length:4},()=>size),size,viewport,48,[{left:8,top:8,right:190,bottom}])!;
  const before=place(120), after=place(260);
  expect(before).not.toBeNull(); expect(after).not.toBeNull();
  expect(after.region.top>=268 || after.region.left>=198).toBe(true);
});

it('uses a fitting circle before a closer compact column', () => {
  const viewport={width:390,height:844},size={width:136,height:64},anchor={x:800,y:50};
  const placement=chooseActionPlacement(anchor,Array.from({length:5},()=>size),size,viewport,160,[{left:8,top:8,right:190,bottom:220},{left:8,top:700,right:382,bottom:836}])!;
  const r=placement.region;
  const layout=layoutObjectActions(anchor,Array.from({length:5},()=>size),viewport,r.top,r.bottom,placement.identityHeight,r.left,r.right);
  expect(layout.compact).toBe(false);
});
import * as menuLayout from '../src/ui/object-menu-layout.js';
