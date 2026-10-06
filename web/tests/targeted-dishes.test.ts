import { describe, expect, it, vi } from 'vitest';
import { dispatchMenuAction, handleLeftClick, pickSprite, resolveRightClick, LongPressGesture, type MenuTarget } from '../src/input.js';
import { spriteIndex, SPRITE_CONTENT_BOUNDS, SPRITES } from '../src/render/atlas.js';
import { setDishCoverage } from '../src/render/dish-coverage.js';
import { surfaceLayout, surfaceItemSprite } from '../src/render/surface-items.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';
import { spriteHeight } from '../src/render/sprite-size.js';
import { TILE_HALF_HEIGHT } from '../src/render/iso.js';
import { setBodyCoverage } from '../src/render/body-coverage.js';
import { simBodySprite } from '../src/frame.js';

function fixture(suffix = '') {
  const sprite = spriteIndex(`offlineDiningTable${suffix}`);
  const source = {
    count: 1, positions: () => new Float32Array([0, 0]), kinds: () => new Uint32Array([1]),
    ids: () => new Uint32Array([50]), sprites: () => new Uint32Array([sprite]),
    activities: () => new Uint32Array([0]), dirtyDishes: () => new Uint32Array([3]),
    dirtySettings: () => new Uint32Array([1 | (2 << 8)]), mealPortions: () => new Uint32Array([0]),
    dishPiles: () => new Uint32Array([50, 0, 7, 50, 2, 8, 50, 2, 9]),
    selectedIndex: () => 2, select: vi.fn(() => true), useObject: vi.fn(() => true),
    useObjectFirst: vi.fn(() => true), cancelIntents: vi.fn(() => true),
    talkTo: vi.fn(() => true), talkToFirst: vi.fn(() => true),
    cleanDishes: vi.fn(() => true), cleanDishesFirst: vi.fn(() => true),
    interactionLabels: () => ['Sit'], entityName: () => 'Dining table', socialLabels: () => [],
  } satisfies MenuTarget;
  const layout = surfaceLayout(sprite)!;
  for (const prop of layout.props.slice(0, 4)) setDishCoverage(prop, new Uint8Array(SPRITES[prop].w * SPRITES[prop].h).fill(255));
  function point(slot: number, scale = 1) {
    const prop = surfaceItemSprite(layout, 3, slot === 0 ? 0 : 1, 1 | (2 << 8));
    const bounds = SPRITE_CONTENT_BOUNDS[prop];
    return {
      x: (layout.points[slot][0] + spriteDrawOffsetX(prop)) * scale,
      y: (layout.points[slot][1] + spriteDrawOffsetY(prop) + TILE_HALF_HEIGHT - spriteHeight(prop) + (bounds[1] + bounds[3]) / 2) * scale,
    };
  }
  return { source, point };
}

describe('targeted dish input', () => {
  it.each([.65,1,2])('keeps exposed table wood clickable beside a nearby selected Sim at zoom %s', scale => {
    const {source}=fixture();
    const body=simBodySprite(2,0,0,0,false,1,.5,0);
    const alpha=new Uint8Array(SPRITES[body].w*SPRITES[body].h).fill(255);
    // The published idle sprite has transparent pixels here beside its head.
    for(let y=46;y<=48;y++)for(let x=65;x<=67;x++)alpha[y*SPRITES[body].w+x]=0;
    setBodyCoverage(body,alpha);
    const overlapped={...source,count:2,
      positions:()=>new Float32Array([0,0,1,.5]),
      kinds:()=>new Uint32Array([1,0]),ids:()=>new Uint32Array([50,2]),
      sprites:()=>new Uint32Array([source.sprites()[0],spriteIndex('sim')]),
      activities:()=>new Uint32Array([0,0]),visualActions:()=>new Uint32Array([0,0]),
      facings:()=>new Uint32Array([0,0]),simIds:()=>new Uint32Array([0,0]),
    };
    try {
      const point={x:70+30*scale,y:40-24*scale};
      expect(resolveRightClick(source,point,70,40,scale)!.entries.map(e=>e.label)).toEqual(['Clean up','Nothing']);
      expect(resolveRightClick(overlapped,point,70,40,scale)!.entries.map(e=>e.label)).toEqual(['Clean up','Nothing']);
      expect(pickSprite(overlapped,70+16*scale,40-5*scale,70,40,scale)).toEqual({entity:2,isAgent:true});
    } finally {setBodyCoverage(body,new Uint8Array(alpha.length).fill(255));}
  });
  it('reads the copied pile projection before a boundary allocation can detach render views', () => {
    const { source, point } = fixture();
    let positions = new Float32Array([0, 0]);
    const growing = { ...source, positions: () => positions, dishPiles: () => {
      structuredClone(null, { transfer: [positions.buffer] });
      positions = new Float32Array([0, 0]);
      return source.dishPiles();
    } };
    const p = point(2);
    expect(pickSprite(growing, p.x, p.y, 0, 0)?.cleanup).toEqual({ surface: 50, dishes: [8, 9] });
  });
  it('opens the same exact pile action through the touch long-press controller', () => {
    const { source, point } = fixture();
    let fire: (() => void) | undefined;
    const open = vi.fn((x: number, y: number) => resolveRightClick(source, { x, y }, 0, 0));
    const gesture = new LongPressGesture(open, { after: (_delay, callback) => { fire = callback; return 1; }, cancel: vi.fn() });
    const p = point(2);
    gesture.begin(3, p.x, p.y);
    fire!();
    expect(open.mock.results[0].value.entries[0]).toEqual({ label: 'Do dishes', action: { kind: 'clean', surface: 50, dishes: [8, 9] } });
  });
  it('leaves transparent pixels inside a dish bounding box available to the furniture', () => {
    const { source } = fixture();
    const layout = surfaceLayout(source.sprites()[0])!;
    const prop = surfaceItemSprite(layout, 3, 0, 1 | (2 << 8));
    const alpha = new Uint8Array(SPRITES[prop].w * SPRITES[prop].h).fill(255);
    for (const y of [11, 12]) for (const x of [0, 1]) alpha[y * SPRITES[prop].w + x] = 0;
    setDishCoverage(prop, alpha);
    const x = layout.points[0][0] + spriteDrawOffsetX(prop) - SPRITES[prop].w / 4 + .5;
    const y = layout.points[0][1] + spriteDrawOffsetY(prop) + TILE_HALF_HEIGHT - spriteHeight(prop) + 6;
    expect(pickSprite(source, x, y, 0, 0)).toEqual({ entity: 50, isAgent: false });
  });
  it.each(['', 'NW', 'SW', 'NE'])('picks only the visible pile in facing %s at multiple zoom levels', suffix => {
    const { source, point } = fixture(suffix);
    for (const scale of [.65, 1, 2]) {
      const p = point(2, scale);
      expect(pickSprite(source, p.x, p.y, 0, 0, scale)?.cleanup).toEqual({ surface: 50, dishes: [8, 9] });
    }
  });
  it('left-clicks and modified clicks use the same exact pile with front/back placement', () => {
    const { source, point } = fixture();
    handleLeftClick(source, point(2), 0, 0, false);
    expect(source.cleanDishesFirst).toHaveBeenCalledWith(2, 50, [8, 9]);
    handleLeftClick(source, point(0), 0, 0, true);
    expect(source.cleanDishes).toHaveBeenCalledWith(2, 50, [7]);
    expect(source.useObjectFirst).not.toHaveBeenCalled();
  });
  it('offers Do dishes for a pile and dispatches the captured identities', () => {
    const { source, point } = fixture();
    const menu = resolveRightClick(source, point(2), 0, 0)!;
    expect(menu.entries.map(e => e.label)).toEqual(['Do dishes', 'Nothing']);
    dispatchMenuAction(source, menu.entries[0].action);
    expect(source.cleanDishesFirst).toHaveBeenCalledWith(2, 50, [8, 9]);
  });
  it('offers only Clean up on exposed dirty table wood and restores its usual action once clean', () => {
    const { source, point } = fixture();
    const dirty = resolveRightClick(source, point(1), 0, 0)!;
    expect(dirty.entries.map(e => e.label)).toEqual(['Clean up', 'Nothing']);
    dispatchMenuAction(source, dirty.entries[0].action, 'back');
    expect(source.cleanDishes).toHaveBeenCalledWith(2, 50, null);
    const clean = { ...source, dishPiles: () => new Uint32Array(), dirtyDishes: () => new Uint32Array([0]), dirtySettings: () => new Uint32Array([0]) };
    expect(resolveRightClick(clean, point(1), 0, 0)!.entries.map(e => e.label)).toEqual(['Sit', 'Nothing']);
    handleLeftClick(source, point(1), 0, 0, false);
    expect(source.useObjectFirst).toHaveBeenCalledWith(2, 50, 0);
  });
  it('does not issue a chore when no Sim is selected', () => {
    const { source, point } = fixture();
    const nobody = { ...source, selectedIndex: () => null };
    handleLeftClick(nobody, point(2), 0, 0, false);
    expect(source.cleanDishesFirst).not.toHaveBeenCalled();
    expect(resolveRightClick(nobody, point(2), 0, 0)).toBeNull();
  });
  it('picks a nearer Sim over dishes behind that Sim', () => {
    const { source, point } = fixture();
    const overlapped = { ...source, count: 2,
      positions: () => new Float32Array([0, 0, -.4, .6]), kinds: () => new Uint32Array([1, 0]),
      ids: () => new Uint32Array([50, 2]), sprites: () => new Uint32Array([source.sprites()[0], spriteIndex('sim')]),
      activities: () => new Uint32Array([0, 0]),
    };
    const p = point(2);
    expect(pickSprite(overlapped, p.x, p.y, 0, 0)).toEqual({ entity: 2, isAgent: true });
  });
});
