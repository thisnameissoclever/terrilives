import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initSync, SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { BED_CATALOG, BED_COVERAGE, BED_LAYERS, SPRITES, SPRITE_ANCHORS, spriteIndex } from '../src/render/atlas.js';
import { bedSceneKey, packBedLayers, sampleBedCoverage } from '../src/render/bed-sprites.js';
import { InteractionSelection } from '../src/render/interaction-sprites.js';
import { buildInstanceBatch, simShirtVariant } from '../src/frame.js';
import { pickSprite } from '../src/input.js';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.js';
import { spriteDrawOffsetX, spriteDrawOffsetY } from '../src/render/sprite-anchors.js';
import { spriteWidth, spriteHeight } from '../src/render/sprite-size.js';

const none = 0xffffffff;
function source(facing = 'SE', order = [0, 1, 2]) {
  const ids = [91, 400, 13], kinds = [0, 1, 0], places = [0, none, 1];
  const sprites = [0, spriteIndex(`offlineDoubleBed${facing === 'SE' ? '' : facing}`), 0];
  const positions = new Float32Array(order.flatMap(() => [0, 0]));
  const beds = new Uint32Array(order.map((row) => kinds[row] === 0 ? 400 : none));
  const actions = new Uint32Array(order.map((row) => kinds[row] === 0 ? 9 : 0));
  const columns = {
    count: 3, ids: () => new Uint32Array(order.map((row) => ids[row])),
    kinds: () => new Uint32Array(order.map((row) => kinds[row])),
    sprites: () => new Uint32Array(order.map((row) => sprites[row])),
    positions: () => positions, prevPositions: () => positions,
    simIds: () => new Uint32Array(order.map((row) => row === 0 ? 0 : row === 2 ? 2 : none)),
    sleepingBeds: () => beds, sleepingPlaces: () => new Uint32Array(order.map((row) => places[row])),
    visualActions: () => actions, activities: () => new Uint32Array(order.map((row) => kinds[row] === 0 ? 5 : 0)),
    facings: () => new Uint32Array(3), carrying: () => new Uint32Array(3).fill(none),
    footprintWidths: () => new Uint32Array(order.map((row) => kinds[row] === 1 ? 2 : 0)),
    footprintDepths: () => new Uint32Array(order.map((row) => kinds[row] === 1 ? 2 : 0)),
    itemKinds: () => [] as string[], clockTick: () => 0,
  };
  return { ...columns, beds, actions };
}

describe('covered double-bed scenes and owner coverage', () => {
  it('retains all 64 facing, occupancy and joint shirt combinations with registered layers', () => {
    let count = 0;
    for (const facing of ['SE', 'NW', 'SW', 'NE']) {
      const catalog = BED_CATALOG[spriteIndex('offlineDoubleBed' + (facing === 'SE' ? '' : facing))];
      expect(Object.keys(catalog)).toHaveLength(16);
      for (let mask = 0; mask < 4; mask++) {
        for (let a = 0; a < (mask & 1 ? 3 : 1); a++) for (let b = 0; b < (mask & 2 ? 3 : 1); b++) {
          const scene = catalog[bedSceneKey(mask, a, b)];
          expect(scene).toBeDefined();
          expect(scene.owners.map((owner) => owner !== null)).toEqual([Boolean(mask & 1), Boolean(mask & 2)]);
          for (const index of BED_LAYERS[scene.sprite].filter((index) => index >= 0)) {
            expect([SPRITES[index].w, SPRITES[index].h, SPRITES[index].pixel_density]).toEqual([232, 218, 2]);
            expect(SPRITE_ANCHORS[index]).toEqual(SPRITE_ANCHORS[scene.sprite]);
          }
          count++;
        }
      }
    }
    expect(count).toBe(64);
    const table = packBedLayers(SPRITES.length, BED_LAYERS);
    expect(Array.from(table.slice(0, 1700 * 4)).every((value) => value === 0)).toBe(true);
    expect(() => packBedLayers(2, { 1: [0, -1, 9, 0] })).toThrow(/range/);
  });

  it('samples gray values, zero background and fractional edges using texel centers', () => {
    const payload = Uint8Array.of(9, 9, 9, 0, 255, 0, 0);
    const record = { size: [2, 2] as const, box: [0, 0, 2, 2] as const, offset: 3 };
    expect(sampleBedCoverage(record, 0, 0, payload)).toBe(0);
    expect(sampleBedCoverage(record, 1, 0, payload)).toBe(1);
    expect(sampleBedCoverage(record, 0.5, 0, payload)).toBe(0.5);
    expect(sampleBedCoverage(record, -20, 0, payload)).toBe(0);
    expect(sampleBedCoverage(record, 20, 0, payload)).toBe(1);
  });

  it('filters the actual additive scene alpha before clamping its output', () => {
    const scene = BED_CATALOG[spriteIndex('offlineDoubleBedNE')][0];
    expect(BED_COVERAGE[scene.alpha].bitDepth).toBe(16);
    const alpha = sampleBedCoverage(BED_COVERAGE[scene.alpha], 118, 41 + 0.12628133445158884);
    expect(alpha).toBeCloseTo(0.5002484555466022, 10);
    expect(alpha).toBeGreaterThan(0.5);
  });

  it('keeps both owners through row reorder, static sampling and one departure without ordinary target columns', () => {
    const selection = new InteractionSelection({}, simShirtVariant, BED_CATALOG);
    for (const order of [[0, 1, 2], [2, 0, 1]]) {
      const rows = source('SE', order);
      selection.updateSource(rows, 0, false);
      const target = order.indexOf(1), a = order.indexOf(0), b = order.indexOf(2);
      const scene = selection.bedScenes[a]!;
      expect(selection.bedScenes[b]).toBe(scene);
      expect(selection.bedScenes[target]).toBe(scene);
      expect([selection.bedPlaces[a], selection.bedPlaces[b]]).toEqual([0, 1]);
      expect([selection.drawSuppressed[a], selection.drawSuppressed[b], selection.suppressed[target]]).toEqual([0, 1, 1]);
      expect(scene.owners[0]!.marker).not.toEqual(scene.owners[1]!.marker);
      selection.updateSource(rows, 123456, true);
      expect(selection.bedScenes[a]).toBe(scene);
      rows.beds[a] = none;
      selection.updateSource(rows, 0, false);
      expect(selection.bedScenes[a]).toBeUndefined();
      expect(selection.drawSuppressed[b]).toBe(0);
      expect(selection.bedScenes[b]!.owners.map((owner) => owner !== null)).toEqual([false, true]);
    }
  });

  it('does not override independent authored visuals or invent sleeping from an assignment', () => {
    const rows = source();
    rows.actions[0] = 6;
    rows.beds[2] = none;
    const selection = new InteractionSelection({}, simShirtVariant, BED_CATALOG);
    selection.updateSource(rows, 0, false);
    expect(selection.bedScenes[0]).toBeUndefined();
    expect(selection.bedScenes[2]).toBeUndefined();
    expect(selection.bedScenes[1]!.owners).toEqual([null, null]);
    rows.actions[0] = 9;
    rows.sleepingPlaces = () => new Uint32Array([0, none, 0]);
    rows.beds[2] = 400;
    expect(() => selection.updateSource(rows, 0, false)).toThrow(/duplicate/);
  });

  it('picks both visible owners and furniture at fractional zoom independently of Sim row order', () => {
    for (const facing of ['SE', 'NW', 'SW', 'NE']) for (const scale of [0.73, 1.37]) {
      for (const order of [[0, 1, 2], [2, 1, 0]]) {
        const rows = source(facing, order);
        const selection = new InteractionSelection({}, simShirtVariant, BED_CATALOG);
        selection.updateSource(rows, 0, false);
        const scene = selection.bedScenes[order.indexOf(1)]!;
        const sprite = scene.sprite;
        const left = 200 + (spriteDrawOffsetX(sprite) - spriteWidth(sprite) / 2) * scale;
        const top = 180 + (21 + spriteDrawOffsetY(sprite) - spriteHeight(sprite)) * scale;
        const seen = new Set<number>();
        for (let y = 0; y < 218; y += 2) for (let x = 0; x < 232; x += 2) {
          if (sampleBedCoverage(BED_COVERAGE[scene.alpha], x, y) < 0.5) continue;
          const a = sampleBedCoverage(BED_COVERAGE[scene.owners[0]!.coverage], x, y);
          const b = sampleBedCoverage(BED_COVERAGE[scene.owners[1]!.coverage], x, y);
          const expected = a <= 0 && b <= 0 ? 400 : a >= b ? 91 : 13;
          if (seen.has(expected)) continue;
          const pick = pickSprite(rows, left + (x + 0.5) / 2 * scale,
            top + (y + 0.5) / 2 * scale, 200, 180, scale, false, selection);
          expect(pick).toEqual({ entity: expected, isAgent: expected !== 400 });
          seen.add(expected);
        }
        expect([...seen].sort()).toEqual([13, 400, 91]);
        expect(pickSprite(rows, left - 1, top - 1, 200, 180, scale, false, selection)).toBeNull();
      }
    }
  });

  it('draws one scene and retains distinct bubbles and visible owner rings', () => {
    const rows = source();
    const selection = new InteractionSelection({}, simShirtVariant, BED_CATALOG);
    const batch = buildInstanceBatch(rows, 1, 200, 180, 32, 13, 1, false, 0, null, selection);
    const data = batch.instances;
    expect(data[FLOATS_PER_INSTANCE]).toBe(-1e6);
    expect(data[2 * FLOATS_PER_INSTANCE]).toBe(-1e6);
    expect(data[3 * FLOATS_PER_INSTANCE]).not.toBe(data[4 * FLOATS_PER_INSTANCE]);
    const ring = (batch.count - 1) * FLOATS_PER_INSTANCE;
    const marker = selection.bedScenes[2]!.owners[1]!.marker;
    expect(data[ring + 1]).toBeCloseTo(180 + marker[1] + 21, 4);
    expect(data[ring + 2]).toBeLessThan(data[2]);
    const first = Array.from(data.slice(ring, ring + 3));
    const other = buildInstanceBatch(rows, 1, 200, 180, 32, 91, 1, false, 0, null, selection);
    expect(Array.from(other.instances.slice(ring, ring + 2))).not.toEqual(first.slice(0, 2));
  });

  it('uses the actual shared draw row and layer against an unrelated equal-depth Sim', () => {
    for (const early of [true, false]) {
      const rows = source('SE', early ? [0, 1, 2] : [1, 0, 2]);
      const ids = new Uint32Array(4), kinds = new Uint32Array(4), sprites = new Uint32Array(4);
      const beds = new Uint32Array(4).fill(none), places = new Uint32Array(4).fill(none), actions = new Uint32Array(4);
      const insertion = early ? 3 : 1;
      const expanded = [0,1,2]; expanded.splice(insertion,0,-1);
      for (const [row, old] of expanded.entries()) {
        ids[row] = old < 0 ? 900 : rows.ids()[old]; kinds[row] = old < 0 ? 0 : rows.kinds()[old];
        sprites[row] = old < 0 ? spriteIndex('floor') : rows.sprites()[old];
        if (old >= 0) { beds[row] = rows.sleepingBeds()[old]; places[row] = rows.sleepingPlaces()[old]; actions[row] = rows.visualActions()[old]; }
      }
      const mixed = { ...rows, count:4, ids:()=>ids, kinds:()=>kinds, sprites:()=>sprites,
        positions:()=>new Float32Array(8), activities:()=>new Uint32Array(4),
        visualActions:()=>actions, sleepingBeds:()=>beds, sleepingPlaces:()=>places,
        facings:undefined };
      const selection = new InteractionSelection({},simShirtVariant,BED_CATALOG);
      const scene = BED_CATALOG[spriteIndex('offlineDoubleBed')][bedSceneKey(3,0,0)];
      const sprite=scene.sprite;
      const left=200+spriteDrawOffsetX(sprite)-spriteWidth(sprite)/2;
      const top=180+21+spriteDrawOffsetY(sprite)-spriteHeight(sprite);
      let witnessed=false;
      for(let y=181;y<201 && !witnessed;y++) for(let x=171;x<229 && !witnessed;x++) {
        const sx=(x-left)*2-.5,sy=(y-top)*2-.5;
        if(sampleBedCoverage(BED_COVERAGE[scene.alpha],sx,sy)<.5) continue;
        if(scene.owners.some(owner=>sampleBedCoverage(BED_COVERAGE[owner!.coverage],sx,sy)>0)) continue;
        expect(pickSprite(mixed,x,y,200,180,1,false,selection)).toEqual({entity:early?400:900,isAgent:!early});
        witnessed=true;
      }
      expect(witnessed).toBe(true);
    }
  });

  it('renders real authored double-bed sleepers across rotation, immediate Load and memory growth', () => {
    const {memory}=initSync({module:readFileSync('src/wasm/terri_wasm_bg.wasm')});
    for (let facing=0;facing<4;facing++) {
      const handle=SimHandle.from_lot_with_seed(2301,0);
      try {
        const sim=new SimBridge(handle,memory);
        const people=Array.from(sim.ids()).filter((_,row)=>sim.kinds()[row]===0);
        const places=sim.bedPlacesOf(people[0])!;
        const bed=places.find(place=>place.ordinal===1)!.bed;
        // The open yard supports every authored approach after rotation.
        expect(sim.placementPreview(bed,17,8,facing).reason).toBeNull();
        expect(sim.placeObject(bed,17,8,facing)).toBe(true);
        sim.flushCommands(); expect(sim.lastPlacementResult()?.reason).toBeNull();
        expect(handle.object_facing(bed)).toBe(facing);
        for(const [ordinal,person] of people.slice(0,2).entries()) {
          expect(sim.setBedAssignment(person,{bed,ordinal})).toBe(true);
          expect(sim.useObjectFirst(person,bed,0)).toBe(true);
        }
        sim.flushCommands();
        let sleeping=false;
        for(let tick=0;tick<1600;tick++) {
          sim.tick();
          sleeping=people.slice(0,2).every(person=>sim.sleepingBeds()[Array.from(sim.ids()).indexOf(person)]===bed);
          if(sleeping) break;
        }
        expect(sleeping).toBe(true);
        const selection=new InteractionSelection({},simShirtVariant,BED_CATALOG);
        const check=()=>{
          selection.updateSource(sim,sim.clockTick(),false);
          const rows=people.slice(0,2).map(person=>Array.from(sim.ids()).indexOf(person));
          expect(rows.map(row=>sim.visualActions()[row])).toEqual([9,9]);
          expect(selection.bedScenes[rows[0]]?.owners.every(owner=>owner!==null)).toBe(true);
          expect(selection.bedScenes[rows[1]]).toBe(selection.bedScenes[rows[0]]);
          expect(rows.map(row=>selection.bedPlaces[row]).sort()).toEqual([0,1]);
        };
        check();const saved=sim.saveBytes();
        expect(sim.loadBytes(saved)).toBe(true);check();
        memory.grow(1);check();
        expect(sim.saveBytes()).toEqual(saved);
        const first=people[0];
        expect(sim.cancelIntents(first)).toBe(true);sim.flushCommands();
        selection.updateSource(sim,sim.clockTick(),false);
        expect(selection.bedScenes[Array.from(sim.ids()).indexOf(first)]).toBeUndefined();
        const second=Array.from(sim.ids()).indexOf(people[1]);
        expect(selection.bedScenes[second]?.owners.filter(owner=>owner!==null)).toHaveLength(1);
        expect(selection.drawSuppressed[second]).toBe(0);
      } finally {handle.free();}
    }
  });
});
