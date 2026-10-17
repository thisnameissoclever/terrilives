import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GROUND_MARKER_COMMAND, HOUSEMATE_MARKER_RADIUS, MARKER_BLUE, MARKER_RED, MARKER_UNIFORM_FLOATS,
  MARKER_UNIFORM_HEADER_FLOATS, MARKER_UNIFORM_LAYOUT, MAX_GROUND_MARKERS, OFFSET_MARKER_SEMI_AXIS_X,
  OFFSET_MARKER_SEMI_AXIS_Y, PLACEMENT_MARKER_MARGIN, drawAroundMarkers, groundMarkerPipelineDescriptor,
  groundMarkerRows, groundSelectionShader, markerAxes, placementMarkerSemiAxis, writeHousemateMarker,
  writeMarkerUniform, writePlacementMarker,
} from '../src/render/ground-selection.js';
import { buildInstanceBatch, type RenderSource } from '../src/frame.js';
import { spriteIndex } from '../src/render/atlas.js';
import {
  ARCHITECTURE_DEPTH, ARCHITECTURE_FLOOR, FLOATS_PER_INSTANCE, FOOTPRINT_PROJECTION, MAX_ARCHITECTURE_FINISH_SLOT,
  OFFSET_SCREEN_X, OFFSET_SCREEN_Y, OFFSET_WALL_DEPTH_STEP, OFFSET_WALL_MASK, REGISTERED_SURFACE_DEPTH,
  SURFACE_DEPTH_PROJECTION, SURFACE_PLANE_PROJECTION, VERTICES_PER_QUAD, architectureMode, decodeArchitectureMode,
} from '../src/render/instances.js';
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH, screenX, screenY } from '../src/render/iso.js';
import { SCENE_SAMPLE_SCALE } from '../src/render/scene-sampling.js';
import { spritePipelineDescriptors } from '../src/render/sprite-pipelines.js';
import type { PlacementPreview } from '../src/bridge.js';

/** The uniform block of one marker row, in doubles so the geometry checks are not limited by storage precision. */
function uniform(row: Float32Array, scale: number): Float64Array {
  const out = new Float64Array(MARKER_UNIFORM_FLOATS);
  writeMarkerUniform(out, 0, row, 0, scale);
  return out;
}

const L = MARKER_UNIFORM_LAYOUT;

/** A screen offset from the marker center, mapped to the marker's unit circle. */
function unit(block: Float64Array, x: number, y: number): [number, number] {
  return [block[L.row0] * x + block[L.row0 + 1] * y, block[L.row1] * x + block[L.row1 + 1] * y];
}

/** The screen offset of a world offset (dx, dy) from the marker center. */
function screenOffset(dx: number, dy: number, scale: number): [number, number] {
  return [(dx - dy) * TILE_HALF_WIDTH * scale, (dx + dy) * TILE_HALF_HEIGHT * scale];
}

function placementRow(width: number, depth: number, valid = true, margin = PLACEMENT_MARKER_MARGIN): Float32Array {
  const row = new Float32Array(FLOATS_PER_INSTANCE);
  writePlacementMarker(row, 0, 40, 60, width, depth, valid);
  row[OFFSET_MARKER_SEMI_AXIS_X] = placementMarkerSemiAxis(width, margin);
  row[OFFSET_MARKER_SEMI_AXIS_Y] = placementMarkerSemiAxis(depth, margin);
  return row;
}

function housemateRow(): Float32Array {
  const row = new Float32Array(FLOATS_PER_INSTANCE);
  writeHousemateMarker(row, 0, 120, 80);
  return row;
}

describe('placement marker geometry', () => {
  it('sizes each world semi-axis to pass through the footprint corners, plus the margin', () => {
    expect(PLACEMENT_MARKER_MARGIN).toBe(0.08);
    expect(placementMarkerSemiAxis(1)).toBeCloseTo(Math.SQRT1_2 + 0.08, 12);
    expect(placementMarkerSemiAxis(2)).toBeCloseTo(Math.SQRT2 + 0.08, 12);
    expect(placementMarkerSemiAxis(3, 0)).toBeCloseTo(3 / Math.SQRT2, 12);
  });

  it.each([
    [1, 1, 1], [2, 2, 1], [1, 2, 1], [2, 1, 1], [1, 2, 2], [2, 1, 2.5],
  ])('projects a %i by %i footprint at scale %s onto the two world axes', (width, depth, scale) => {
    const a = placementMarkerSemiAxis(width), b = placementMarkerSemiAxis(depth);
    const axes = new Float64Array(4);
    markerAxes(a, b, scale, axes);
    // World x runs down and right on screen, world y down and left.
    expect(Array.from(axes)).toEqual([32 * a * scale, 21 * a * scale, -32 * b * scale, 21 * b * scale]);
    const u = Math.hypot(axes[0], axes[1]), v = Math.hypot(axes[2], axes[3]);
    if (width === depth) expect(u).toBeCloseTo(v, 12);
    else expect(width > depth ? u > v : v > u).toBe(true);
  });

  it('turns a 1 by 2 marker with the object: its long axis follows the longer footprint side', () => {
    const along = (width: number, depth: number) => {
      const block = uniform(placementRow(width, depth), 1);
      // How far one tile along each world axis reaches in the marker's unit circle:
      // the longer the marker along that axis, the shorter the reach.
      const [xu, xv] = unit(block, 32, 21), [yu, yv] = unit(block, -32, 21);
      return { worldX: Math.hypot(xu, xv), worldY: Math.hypot(yu, yv) };
    };
    const lengthwiseY = along(1, 2), lengthwiseX = along(2, 1);
    expect(lengthwiseY.worldY).toBeLessThan(lengthwiseY.worldX);
    expect(lengthwiseX.worldX).toBeLessThan(lengthwiseX.worldY);
    expect(lengthwiseY.worldY).toBeCloseTo(lengthwiseX.worldX, 12);
  });

  it.each([[1, 1], [2, 2], [1, 2], [2, 1], [3, 1], [1, 3], [3, 2]])(
    'keeps every corner of a %i by %i footprint on the marker without margin and inside it with margin', (width, depth) => {
      for (const scale of [1, 1.75]) {
        for (const margin of [0, PLACEMENT_MARKER_MARGIN, 0.3]) {
          const block = uniform(placementRow(width, depth, true, margin), scale);
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const [ox, oy] = screenOffset(sx * width / 2, sy * depth / 2, scale);
            const radius = Math.hypot(...unit(block, ox, oy));
            // The row stores semi-axes as 32-bit floats, which limits the match to about 1e-7.
            if (margin === 0) expect(radius).toBeCloseTo(1, 6);
            else expect(radius).toBeLessThan(1);
          }
        }
      }
    });

  it('bounds the whole ellipse with its screen box', () => {
    for (const [width, depth] of [[1, 1], [1, 2], [2, 1], [3, 2]]) {
      const row = placementRow(width, depth), block = uniform(row, 1.5);
      const axes = new Float64Array(4);
      markerAxes(row[OFFSET_MARKER_SEMI_AXIS_X], row[OFFSET_MARKER_SEMI_AXIS_Y], 1.5, axes);
      let maxX = 0, maxY = 0;
      for (let step = 0; step < 7200; step++) {
        const t = step * Math.PI / 3600;
        maxX = Math.max(maxX, Math.abs(Math.cos(t) * axes[0] + Math.sin(t) * axes[2]));
        maxY = Math.max(maxY, Math.abs(Math.cos(t) * axes[1] + Math.sin(t) * axes[3]));
      }
      expect(block[L.extent]).toBeGreaterThanOrEqual(maxX - 1e-9);
      expect(block[L.extent + 1]).toBeGreaterThanOrEqual(maxY - 1e-9);
      expect(block[L.extent]).toBeCloseTo(maxX, 3);
      expect(block[L.extent + 1]).toBeCloseTo(maxY, 3);
    }
  });
});

describe('marker uniform blocks', () => {
  it.each([1, 2, 0.6])('keeps the housemate marker the approved 30 by 19.6875 pixel ellipse at scale %s', scale => {
    const row = housemateRow();
    expect(row[OFFSET_MARKER_SEMI_AXIS_X]).toBe(Math.fround(HOUSEMATE_MARKER_RADIUS));
    expect(row[OFFSET_MARKER_SEMI_AXIS_Y]).toBe(Math.fround(HOUSEMATE_MARKER_RADIUS));
    const block = uniform(row, scale);
    expect([block[L.center], block[L.center + 1]]).toEqual([120, 80]);
    expect(block[L.extent]).toBeCloseTo(30 * scale, 5);
    expect(block[L.extent + 1]).toBeCloseTo(19.6875 * scale, 5);
    expect(Array.from(block.slice(L.color, L.color + 3))).toEqual(MARKER_BLUE.map(Math.fround));
    // The unit circle is the old length(local / radius) for every screen offset.
    for (const [x, y] of [[30, 0], [0, 19.6875], [12, -7], [-25, 11]]) {
      const [ox, oy] = [x * scale, y * scale];
      expect(Math.hypot(...unit(block, ox, oy))).toBeCloseTo(Math.hypot(ox / (30 * scale), oy / (19.6875 * scale)), 5);
    }
  });

  it('colors a placement marker by its validity and writes the marker command', () => {
    const valid = uniform(placementRow(1, 2), 1), refused = uniform(placementRow(1, 2, false), 1);
    expect(Array.from(valid.slice(L.color, L.color + 3))).toEqual(MARKER_BLUE.map(Math.fround));
    expect(Array.from(refused.slice(L.color, L.color + 3))).toEqual(MARKER_RED.map(Math.fround));
    const row = placementRow(2, 2);
    expect(row[OFFSET_WALL_MASK]).toBe(GROUND_MARKER_COMMAND);
    expect(row[OFFSET_WALL_DEPTH_STEP]).toBe(0);
  });

  it('refuses a marker without two positive semi-axes', () => {
    const row = new Float32Array(FLOATS_PER_INSTANCE);
    row[OFFSET_WALL_MASK] = GROUND_MARKER_COMMAND;
    expect(() => writeMarkerUniform(new Float32Array(MARKER_UNIFORM_FLOATS), 0, row, 0, 1)).toThrow(/positive semi-axes/);
  });

  it('stays inside its own block', () => {
    const out = new Float32Array(MARKER_UNIFORM_FLOATS * 3).fill(7);
    writeMarkerUniform(out, MARKER_UNIFORM_FLOATS, housemateRow(), 0, 1);
    expect(Array.from(out.slice(0, MARKER_UNIFORM_FLOATS))).toEqual(Array(MARKER_UNIFORM_FLOATS).fill(7));
    expect(Array.from(out.slice(2 * MARKER_UNIFORM_FLOATS))).toEqual(Array(MARKER_UNIFORM_FLOATS).fill(7));
  });
});

describe('the marker command', () => {
  it('lies outside every architecture mode and every other projection mode', () => {
    expect(Number.isInteger(GROUND_MARKER_COMMAND)).toBe(true);
    expect(Math.fround(GROUND_MARKER_COMMAND)).toBe(GROUND_MARKER_COMMAND);
    expect(decodeArchitectureMode(GROUND_MARKER_COMMAND)).toBeNull();
    expect(GROUND_MARKER_COMMAND).toBeLessThan(architectureMode(true, MAX_ARCHITECTURE_FINISH_SLOT));
    expect(GROUND_MARKER_COMMAND).toBeLessThan(architectureMode(false, MAX_ARCHITECTURE_FINISH_SLOT));
    expect([FOOTPRINT_PROJECTION, SURFACE_DEPTH_PROJECTION, SURFACE_PLANE_PROJECTION, ARCHITECTURE_DEPTH,
      ARCHITECTURE_FLOOR, REGISTERED_SURFACE_DEPTH]).not.toContain(GROUND_MARKER_COMMAND);
  });
});

/**
 * A replica of the fragment shader `fs` in `groundSelectionShader`, sample
 * by sample. Scene samples are half a canvas pixel apart, and derivatives are
 * taken across each two by two quad of samples, as fine derivatives are.
 * `aaFrom: 'dist'` replays the earlier softening, taken from fwidth(dist),
 * so the tests can show they reject its bright center.
 */
function replica(block: Float64Array, aaFrom: 'f' | 'dist' = 'f') {
  const step = 1 / SCENE_SAMPLE_SCALE;
  const fields = (x: number, y: number) => {
    const [ux, uy] = unit(block, x, y);
    const r = Math.hypot(ux, uy), f = r - 1;
    let nx: number, ny: number;
    if (aaFrom === 'f') [nx, ny] = r > 1e-4 ? [ux / r, uy / r] : [1, 0];
    else [nx, ny] = [ux / Math.max(r, 1e-6), uy / Math.max(r, 1e-6)];
    const gx = nx * block[L.row0] + ny * block[L.row1], gy = nx * block[L.row0 + 1] + ny * block[L.row1 + 1];
    const slope = aaFrom === 'f' ? Math.max(Math.hypot(gx, gy), 1e-6) : Math.hypot(gx, gy);
    return { f, slope, dist: f / Math.max(slope, 1e-6) };
  };
  const smoothstep = (e0: number, e1: number, x: number) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  };
  /** Opacity at scene sample (px, py), where sample (0, 0) lies exactly on the marker's center. */
  return (px: number, py: number): number => {
    const qx = px - (((px % 2) + 2) % 2), qy = py - (((py % 2) + 2) % 2);
    const at = (sx: number, sy: number) => fields(sx * step, sy * step);
    const here = at(px, py);
    const key = aaFrom === 'f' ? 'f' : 'dist';
    const width = Math.abs(at(qx + 1, py)[key] - at(qx, py)[key]) + Math.abs(at(px, qy + 1)[key] - at(px, qy)[key]);
    const aa = Math.max(aaFrom === 'f' ? width / here.slope : width, 0.42);
    const edge = 1 - smoothstep(0.975 - aa, 0.975 + aa, Math.abs(here.dist));
    const fill = (1 - smoothstep(-aa, aa, here.dist)) * 0.105;
    return edge * 0.94 + (1 - edge) * fill;
  };
}

describe('the marker shader math, replayed on the CPU', () => {
  const blocks: [string, Float64Array][] = [
    ['housemate', uniform(housemateRow(), 1)],
    ['1 by 1 placement', uniform(placementRow(1, 1), 1)],
    ['2 by 2 placement', uniform(placementRow(2, 2), 1)],
    ['1 by 3 placement', uniform(placementRow(1, 3), 1)],
  ];

  it('ties the replica to the shader source', () => {
    expect(groundSelectionShader).toContain('let n=select(vec2f(1,0),i.unit/r,r>1e-4);');
    expect(groundSelectionShader).toContain('let slope=max(length(n.x*m.row0+n.y*m.row1),1e-6);');
    expect(groundSelectionShader).toContain('let dist=f/slope;');
    expect(groundSelectionShader).toContain('let aa=max(fwidth(f)/slope,.42);');
    expect(groundSelectionShader).not.toContain('fwidth(dist)');
  });

  it.each(blocks)('keeps the %s marker center at the plain fill, with no bright dot', (_, block) => {
    const opacity = replica(block);
    for (let py = -4; py <= 4; py++) {
      for (let px = -4; px <= 4; px++) expect(opacity(px, py)).toBeCloseTo(0.105, 6);
    }
  });

  it('rejects the earlier softening, which lit the samples around an exact center', () => {
    for (const [, block] of blocks.slice(1)) {
      const opacity = replica(block, 'dist');
      expect(Math.max(opacity(0, 0), opacity(1, 0), opacity(0, 1), opacity(1, 1))).toBeGreaterThan(0.3);
    }
  });

  it.each(blocks)('gives the %s marker a 1.95 pixel border all the way round', (_, block) => {
    const fields = (x: number, y: number) => {
      const [ux, uy] = unit(block, x, y), r = Math.hypot(ux, uy);
      const gx = (ux / r) * block[L.row0] + (uy / r) * block[L.row1];
      const gy = (ux / r) * block[L.row0 + 1] + (uy / r) * block[L.row1 + 1];
      return { dist: (r - 1) / Math.hypot(gx, gy), gx, gy };
    };
    const axes = new Float64Array(4);
    // Points on the ellipse: the inverse of the uniform's map applied to the unit circle.
    const det = block[L.row0] * block[L.row1 + 1] - block[L.row0 + 1] * block[L.row1];
    axes[0] = block[L.row1 + 1] / det; axes[1] = -block[L.row1] / det;
    axes[2] = -block[L.row0 + 1] / det; axes[3] = block[L.row0] / det;
    for (let k = 0; k < 16; k++) {
      const t = k * Math.PI / 8;
      const px = Math.cos(t) * axes[0] + Math.sin(t) * axes[2], py = Math.cos(t) * axes[1] + Math.sin(t) * axes[3];
      const { gx, gy } = fields(px, py), length = Math.hypot(gx, gy);
      // Walk across the edge along its screen normal and measure where the border is at least half strength.
      let inside = 0;
      for (let s = -3; s <= 3; s += 0.001) {
        if (Math.abs(fields(px + s * gx / length, py + s * gy / length).dist) <= 0.975) inside += 0.001;
      }
      expect(inside).toBeCloseTo(1.95, 1);
    }
  });
});

describe('the marker pipeline and its place in the scene pass', () => {
  it('blends into scene color and leaves the surface, identity and depth targets as the short walls do', () => {
    const marker = groundMarkerPipelineDescriptor({} as GPUShaderModule);
    const shortWall = spritePipelineDescriptors({} as GPUShaderModule, {} as GPUPipelineLayout).lowWall;
    const targets = Array.from(marker.fragment!.targets) as GPUColorTargetState[];
    const wallTargets = Array.from(shortWall.fragment!.targets) as GPUColorTargetState[];
    expect(targets.map(target => target.format)).toEqual(wallTargets.map(target => target.format));
    expect(targets[0].blend).toEqual(wallTargets[0].blend);
    expect(targets[0].writeMask).toBeUndefined();
    expect(targets.slice(1).map(target => target.writeMask)).toEqual([0, 0]);
    expect(marker.depthStencil).toEqual({ format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' });
    expect(marker.depthStencil).toEqual(shortWall.depthStencil);
  });

  it('draws the markers inside the scene pass after grime and before the short walls', () => {
    const source = readFileSync(new URL('../src/render/sprites.ts', import.meta.url), 'utf8');
    const begin = source.indexOf('this.sceneTarget!.begin(encoder)');
    const grime = source.indexOf('pass.setPipeline(this.grimePipeline)', begin);
    const markers = source.indexOf('this.groundSelection.draw(pass,', begin);
    const shortWalls = source.indexOf('pass.setPipeline(this.lowWallPipeline)', begin);
    const restore = source.indexOf('pass.setBindGroup(0, this.bindGroup)', shortWalls);
    const shortWallDraw = source.indexOf('pass.draw(VERTICES_PER_QUAD, this.lowWallCount', begin);
    const end = source.indexOf('pass.end();', begin);
    expect(begin).toBeGreaterThan(0);
    expect([grime, markers, shortWalls, restore, shortWallDraw, end].every(index => index > begin)).toBe(true);
    expect(grime).toBeLessThan(markers);
    expect(markers).toBeLessThan(shortWalls);
    // The marker draw replaces bind group 0, so the short walls restore the sprite group first.
    expect(restore).toBeLessThan(shortWallDraw);
    expect(shortWallDraw).toBeLessThan(end);
  });
});

/** Members of a WGSL struct in order, splitting only on commas outside angle brackets. */
function structMembers(source: string, name: string): { name: string; type: string }[] {
  const body = new RegExp(`struct ${name} \\{([^}]*)\\}`).exec(source)![1];
  const parts: string[] = [];
  let depth = 0, current = '';
  for (const character of body) {
    if (character === '<') depth++;
    if (character === '>') depth--;
    if (character === ',' && depth === 0) { parts.push(current); current = ''; } else current += character;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean).map(part => {
    const colon = part.indexOf(':');
    return { name: part.slice(0, colon).trim(), type: part.slice(colon + 1).trim() };
  });
}

/** Byte offsets and size of a WGSL struct under the uniform layout rules for the types the marker uses. */
function layout(source: string, name: string): { offsets: Record<string, number>; size: number; align: number } {
  const offsets: Record<string, number> = {};
  let offset = 0, align = 0;
  for (const member of structMembers(source, name)) {
    let size: number, memberAlign: number;
    const array = /^array<(\w+),(\d+)>$/.exec(member.type);
    if (member.type === 'f32') [size, memberAlign] = [4, 4];
    else if (member.type === 'vec2f') [size, memberAlign] = [8, 8];
    else if (member.type === 'vec4f') [size, memberAlign] = [16, 16];
    else if (array) {
      const element = layout(source, array[1]);
      [size, memberAlign] = [element.size * Number(array[2]), Math.max(element.align, 16)];
    } else throw new Error(`Unexpected WGSL type ${member.type}`);
    offset = Math.ceil(offset / memberAlign) * memberAlign;
    offsets[member.name] = offset;
    offset += size;
    align = Math.max(align, memberAlign);
  }
  return { offsets, size: Math.ceil(offset / align) * align, align };
}

describe('the marker uniform layout', () => {
  it('matches the WGSL structs member for member', () => {
    const marker = layout(groundSelectionShader, 'Marker');
    expect(Object.keys(marker.offsets)).toEqual(Object.keys(L));
    for (const [member, floats] of Object.entries(L)) expect(marker.offsets[member]).toBe(floats * 4);
    expect(marker.size).toBe(MARKER_UNIFORM_FLOATS * 4);
    const header = layout(groundSelectionShader, 'Markers');
    expect(header.offsets.canvas).toBe(0);
    expect(header.offsets.items).toBe(MARKER_UNIFORM_HEADER_FLOATS * 4);
    expect(structMembers(groundSelectionShader, 'Markers').at(-1)!.type).toBe(`array<Marker,${MAX_GROUND_MARKERS}>`);
  });
});

describe('finding and skipping marker rows', () => {
  const none = 0xffffffff, box = spriteIndex('cardboardBoxOpen');

  function household(eating = false): RenderSource {
    const positions = new Float32Array([2, 3]), ids = new Uint32Array([100]);
    return {
      count: 1, positions: () => positions, prevPositions: () => positions,
      ids: () => ids, kinds: () => new Uint32Array([0]), sprites: () => new Uint32Array([box]),
      activities: () => new Uint32Array([eating ? 3 : 0]), visualActions: () => new Uint32Array([eating ? 2 : 0]),
      facings: () => new Uint32Array([1]), carrying: () => new Uint32Array([none]),
      foregroundSprites: () => new Uint32Array([none]), interactionTargets: () => new Uint32Array([none]),
      itemKinds: () => [],
    };
  }
  const purchase: PlacementPreview = { valid: false, reason: 'blocked', x: 6, y: 5,
    width: 2, depth: 1, facing: 0, sprite: box, foreground: null };

  it('finds both the selected housemate marker and a purchase marker in one frame', () => {
    const batch = buildInstanceBatch(household(), 1, 100, 50, 16, 100, 2, true, 0, null, undefined, purchase,
      { tiles: [[7, 8], [8, 8]], valid: true });
    const rows = new Int32Array(MAX_GROUND_MARKERS);
    expect(groundMarkerRows(batch.instances, batch.count, rows)).toBe(2);
    const field = (index: number, offset: number) => batch.instances[rows[index] * FLOATS_PER_INSTANCE + offset];
    expect(field(0, OFFSET_MARKER_SEMI_AXIS_X)).toBe(Math.fround(HOUSEMATE_MARKER_RADIUS));
    expect([field(0, OFFSET_SCREEN_X), field(0, OFFSET_SCREEN_Y)]).toEqual([screenX(2, 3, 100, 2), screenY(2, 3, 50, 2)]);
    expect(field(1, OFFSET_MARKER_SEMI_AXIS_X)).toBe(Math.fround(placementMarkerSemiAxis(2)));
    expect(field(1, OFFSET_MARKER_SEMI_AXIS_Y)).toBe(Math.fround(placementMarkerSemiAxis(1)));
    expect([field(1, OFFSET_SCREEN_X), field(1, OFFSET_SCREEN_Y)]).toEqual([screenX(6.5, 5, 100, 2), screenY(6.5, 5, 50, 2)]);
    expect(batch.owners[rows[0]]).toBe(0);
    expect(batch.owners[rows[1]]).toBe(0);
  });

  it('writes every marker row after the activity bubbles, which the annotation pass draws', () => {
    const batch = buildInstanceBatch(household(true), 1, 100, 50, 16, 100, 2, true, 0, null, undefined, purchase);
    expect(batch.annotations.count).toBeGreaterThan(0);
    const rows = new Int32Array(MAX_GROUND_MARKERS);
    const found = groundMarkerRows(batch.instances, batch.count, rows);
    expect(found).toBe(2);
    for (let index = 0; index < found; index++) {
      expect(rows[index]).toBeGreaterThanOrEqual(batch.annotations.start + batch.annotations.count);
    }
  });

  it('refuses more markers than the marker draw holds rather than leaving one for the sprite draws', () => {
    const data = new Float32Array((MAX_GROUND_MARKERS + 1) * FLOATS_PER_INSTANCE);
    for (let index = 0; index <= MAX_GROUND_MARKERS; index++) writeHousemateMarker(data, index, 0, 0);
    expect(groundMarkerRows(data, MAX_GROUND_MARKERS, new Int32Array(MAX_GROUND_MARKERS))).toBe(MAX_GROUND_MARKERS);
    expect(() => groundMarkerRows(data, MAX_GROUND_MARKERS + 1, new Int32Array(MAX_GROUND_MARKERS))).toThrow(/more floor markers/);
  });

  function draws(start: number, count: number, slots: number[]): number[][] {
    const calls: number[][] = [];
    drawAroundMarkers({ draw: (...args: number[]) => { calls.push(args); } } as Pick<GPURenderPassEncoder, 'draw'>,
      start, count, Int32Array.from(slots), slots.length);
    return calls;
  }

  it('draws every sprite row except each marker slot', () => {
    expect(draws(10, 5, [])).toEqual([[VERTICES_PER_QUAD, 5, 0, 10]]);
    expect(draws(10, 10, [14, 15])).toEqual([[VERTICES_PER_QUAD, 4, 0, 10], [VERTICES_PER_QUAD, 4, 0, 16]]);
    expect(draws(10, 10, [12, 17])).toEqual([
      [VERTICES_PER_QUAD, 2, 0, 10], [VERTICES_PER_QUAD, 4, 0, 13], [VERTICES_PER_QUAD, 2, 0, 18]]);
    expect(draws(10, 5, [10, 14])).toEqual([[VERTICES_PER_QUAD, 3, 0, 11]]);
    expect(draws(10, 5, [3, 20])).toEqual([[VERTICES_PER_QUAD, 5, 0, 10]]);
    expect(draws(10, 1, [10])).toEqual([]);
    expect(draws(10, 0, [])).toEqual([]);
  });
});
