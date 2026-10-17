import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GROUND_MARKER_COMMAND, HOUSEMATE_MARKER_RADIUS, MARKER_BLUE, MARKER_RED, MARKER_UNIFORM_FLOATS,
  MARKER_UNIFORM_HEADER_FLOATS, MARKER_UNIFORM_LAYOUT, MAX_GROUND_MARKERS, OFFSET_MARKER_SEMI_AXIS_X,
  OFFSET_MARKER_SEMI_AXIS_Y, PLACEMENT_MARKER_MARGIN, drawAroundMarkers, groundMarkerPipelineDescriptor,
  groundMarkerRows, groundSelectionShader, MARKER_LOOK, markerAxes, placementMarkerSemiAxis, wgslFloat,
  writeHousemateMarker, writeMarkerUniform, writePlacementMarker,
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

const look = MARKER_LOOK, float = wgslFloat;
/** Scene samples are half a canvas pixel apart. */
const STEP = 1 / SCENE_SAMPLE_SCALE;

/** One fragment invocation's values, named as the shader names them. */
interface Fragment {
  block: Float64Array; unit: [number, number];
  r: number; f: number; n: [number, number]; slope: number; dist: number; aa: number;
  edge: number; fill: number; opacity: number; discarded: boolean; output: number[];
}
/** One WGSL statement and the TypeScript that does the same; `fwidth` differences a named value across the quad. */
type Statement = readonly [wgsl: string, run: (value: Fragment, fwidth: (name: 'f' | 'dist') => number) => void];

const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(Math.max((x - low) / (high - low), 0), 1);
  return t * t * (3 - 2 * t);
};
/** The length of n.x * row0 + n.y * row1. */
const gradient = (value: Fragment) => {
  const block = value.block, [nx, ny] = value.n;
  return Math.hypot(nx * block[L.row0] + ny * block[L.row1], nx * block[L.row0 + 1] + ny * block[L.row1 + 1]);
};

/** The one statement of the shader's `linear`, and the same conversion for one channel. */
const LINEAR: readonly [string, (channel: number) => number] = [
  'return select(pow((c+.055)/1.055,vec3f(2.4)),c/12.92,c<=vec3f(.04045));',
  channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
];

/**
 * The fragment shader `fs`, statement by statement, each beside the
 * TypeScript the replica runs for it. A test compares the WGSL column with
 * the shader, so an edit to the shader that this table does not share fails,
 * and the constants come from MARKER_LOOK on both sides.
 */
const FRAGMENT: readonly Statement[] = [
  ['let m=u.items[i.marker];', () => {}],
  ['let r=length(i.unit);', value => { value.r = Math.hypot(...value.unit); }],
  ['let f=r-1.;', value => { value.f = value.r - 1; }],
  [`let n=select(vec2f(1,0),i.unit/r,r>${float(look.centerRadius)});`, value => {
    value.n = value.r > look.centerRadius ? [value.unit[0] / value.r, value.unit[1] / value.r] : [1, 0];
  }],
  [`let slope=max(length(n.x*m.row0+n.y*m.row1),${float(look.minSlope)});`, value => {
    value.slope = Math.max(gradient(value), look.minSlope);
  }],
  ['let dist=f/slope;', value => { value.dist = value.f / value.slope; }],
  [`let aa=max(fwidth(f)/slope,${float(look.minSoftening)});`, (value, fwidth) => {
    value.aa = Math.max(fwidth('f') / value.slope, look.minSoftening);
  }],
  [`let edge=1.-smoothstep(${float(look.borderHalfWidth)}-aa,${float(look.borderHalfWidth)}+aa,abs(dist));`, value => {
    value.edge = 1 - smoothstep(look.borderHalfWidth - value.aa, look.borderHalfWidth + value.aa, Math.abs(value.dist));
  }],
  [`let fill=(1.-smoothstep(-aa,aa,dist))*${float(look.fillOpacity)};`, value => {
    value.fill = (1 - smoothstep(-value.aa, value.aa, value.dist)) * look.fillOpacity;
  }],
  [`let opacity=edge*${float(look.borderOpacity)}+(1.-edge)*fill;`, value => {
    value.opacity = value.edge * look.borderOpacity + (1 - value.edge) * value.fill;
  }],
  [`if(opacity<${float(look.discardOpacity)}){discard;}`, value => { value.discarded = value.opacity < look.discardOpacity; }],
  ['return vec4f(linear(m.color.rgb)*opacity,opacity);', value => {
    value.output = [0, 1, 2].map(channel => LINEAR[1](value.block[L.color + channel]) * value.opacity).concat(value.opacity);
  }],
];

/** The earlier softening, taken from fwidth(dist), which jumps at an exact center. */
const EARLIER: Record<string, Statement> = {
  n: ['let n=i.unit/max(r,1e-6);', value => {
    value.n = [value.unit[0] / Math.max(value.r, 1e-6), value.unit[1] / Math.max(value.r, 1e-6)];
  }],
  slope: ['let slope=length(n.x*m.row0+n.y*m.row1);', value => { value.slope = gradient(value); }],
  dist: ['let dist=f/max(slope,1e-6);', value => { value.dist = value.f / Math.max(value.slope, 1e-6); }],
  aa: ['let aa=max(fwidth(dist),.42);', (value, fwidth) => { value.aa = Math.max(fwidth('dist'), 0.42); }],
};
const EARLIER_SOFTENING: readonly Statement[] = FRAGMENT.map(statement => {
  const name = statement[0].startsWith('let ') ? statement[0].slice(4, statement[0].indexOf('=')) : '';
  return EARLIER[name] ?? statement;
});

/**
 * Runs `statements` for one fragment at canvas-pixel offset (x, y) from the
 * marker center. fwidth differences a value across the two by two quad of
 * scene samples whose first sample is (quadX, quadY), as fine derivatives do.
 */
function fragment(block: Float64Array, x: number, y: number, statements: readonly Statement[] = FRAGMENT,
  quadX = x, quadY = y, limit = statements.length): Fragment {
  const value: Fragment = { block, unit: unit(block, x, y), r: 0, f: 0, n: [0, 0], slope: 0, dist: 0, aa: 0,
    edge: 0, fill: 0, opacity: 0, discarded: false, output: [] };
  for (let index = 0; index < limit; index++) {
    statements[index][1](value, name => {
      const at = (sx: number, sy: number) => fragment(block, sx, sy, statements, sx, sy, index)[name];
      return Math.abs(at(quadX + STEP, y) - at(quadX, y)) + Math.abs(at(x, quadY + STEP) - at(x, quadY));
    });
  }
  return value;
}

/** The fragment at scene sample (px, py); sample (0, 0) lies exactly on the marker center. */
function sample(block: Float64Array, px: number, py: number, statements: readonly Statement[] = FRAGMENT): Fragment {
  const quad = (p: number) => (p - (((p % 2) + 2) % 2)) * STEP;
  return fragment(block, px * STEP, py * STEP, statements, quad(px), quad(py));
}

/** The point at angle t on the marker's edge, and the unit screen direction straight out of the ellipse there. */
function edgePoint(block: Float64Array, t: number): { point: [number, number]; normal: [number, number] } {
  const [a, b, c, d] = [block[L.row0], block[L.row0 + 1], block[L.row1], block[L.row1 + 1]];
  const det = a * d - b * c, cos = Math.cos(t), sin = Math.sin(t);
  // The inverse of the screen-to-unit-circle map takes the unit circle back to the screen.
  const point: [number, number] = [(d * cos - b * sin) / det, (-c * cos + a * sin) / det];
  const nx = a * cos + c * sin, ny = b * cos + d * sin, length = Math.hypot(nx, ny);
  return { point, normal: [nx / length, ny / length] };
}

/** The statements of the WGSL function that begins with `header`, comments removed and whitespace collapsed. */
function functionStatements(source: string, header: string): string[] {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`The shader has no function ${header}`);
  const statements: string[] = [];
  let depth = 1, current = '';
  for (let index = start + header.length; index < source.length; index++) {
    const character = source[index];
    if (character === '/' && source[index + 1] === '/') { index = source.indexOf('\n', index); continue; }
    if (character === '{') depth++;
    if (character === '}' && --depth === 0) break;
    current += character;
    if ((character === ';' || character === '}') && depth === 1) {
      statements.push(current.trim().replace(/\s+/g, ' '));
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

describe('the marker shader math, replayed on the CPU', () => {
  const blocks: [string, Float64Array][] = [
    ['housemate', uniform(housemateRow(), 1)],
    ['1 by 1 placement', uniform(placementRow(1, 1), 1)],
    ['2 by 2 placement', uniform(placementRow(2, 2), 1)],
    ['1 by 3 placement', uniform(placementRow(1, 3), 1)],
    ['zoomed 1 by 2 placement', uniform(placementRow(1, 2), 2.5)],
  ];

  it('ties every statement of the fragment shader and its color conversion to the replica', () => {
    expect(functionStatements(groundSelectionShader, '@fragment fn fs(i:Vertex)->@location(0) vec4f {'))
      .toEqual(FRAGMENT.map(([wgsl]) => wgsl));
    expect(functionStatements(groundSelectionShader, 'fn linear(c:vec3f)->vec3f {')).toEqual([LINEAR[0]]);
    expect(groundSelectionShader).toContain(`let offset=q*(m.extent+vec2f(${float(look.boxMargin)}));`);
  });

  it.each(blocks)('keeps the %s marker center at the plain 0.105 fill, with no bright dot', (_, block) => {
    for (let py = -4; py <= 4; py++) {
      for (let px = -4; px <= 4; px++) expect(sample(block, px, py).opacity).toBeCloseTo(0.105, 6);
    }
  });

  it('rejects the earlier softening, which lit the samples around an exact center', () => {
    for (const [, block] of blocks.slice(1)) {
      const brightest = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([px, py]) =>
        sample(block, px, py, EARLIER_SOFTENING).opacity));
      expect(brightest).toBeGreaterThan(0.3);
    }
  });

  it.each(blocks)('gives the %s marker a 1.95 pixel border all the way round', (_, block) => {
    for (let k = 0; k < 16; k++) {
      const { point, normal } = edgePoint(block, k * Math.PI / 8);
      // Walk across the edge along its screen normal and measure where the border is at least half strength.
      let width = 0;
      for (let s = -1.5; s <= 1.5; s += 0.001) {
        if (fragment(block, point[0] + s * normal[0], point[1] + s * normal[1]).edge >= 0.5) width += 0.001;
      }
      expect(width).toBeCloseTo(1.95, 1);
    }
  });

  it.each(blocks)('draws the %s marker edge at 0.94 opacity in the marker color, premultiplied', (_, block) => {
    for (let k = 0; k < 8; k++) {
      const { point } = edgePoint(block, k * Math.PI / 4);
      const value = fragment(block, point[0], point[1]);
      expect(value.discarded).toBe(false);
      expect(value.output[3]).toBeCloseTo(0.94, 6);
      for (let channel = 0; channel < 3; channel++) {
        expect(value.output[channel]).toBeCloseTo(LINEAR[1](block[L.color + channel]) * 0.94, 6);
      }
    }
  });

  it.each(blocks)('keeps every visible fragment of the %s marker inside the box margin', (_, block) => {
    for (let k = 0; k < 32; k++) {
      const { point, normal } = edgePoint(block, k * Math.PI / 16);
      let reach = 0;
      for (let s = 0; s <= look.boxMargin + 2; s += 0.01) {
        if (!fragment(block, point[0] + s * normal[0], point[1] + s * normal[1]).discarded) reach = s;
      }
      // Every point this close to the ellipse lies inside the widened screen box, so nothing visible is clipped.
      expect(reach).toBeGreaterThan(1);
      expect(reach).toBeLessThan(look.boxMargin);
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
    const markers = source.indexOf('this.groundSelection.draw(', begin);
    const shortWalls = source.indexOf('pass.setPipeline(this.lowWallPipeline)', begin);
    const restore = source.indexOf('pass.setBindGroup(0, this.bindGroup)', shortWalls);
    const shortWallDraw = source.indexOf('pass.draw(VERTICES_PER_QUAD, this.lowWallCount', begin);
    const end = source.indexOf('pass.end();', begin);
    expect(begin, 'the scene pass begins').toBeGreaterThan(0);
    expect(grime, 'the scene pass draws grime').toBeGreaterThan(begin);
    expect(markers, 'the floor markers are drawn after grime').toBeGreaterThan(grime);
    expect(markers, 'the floor markers are drawn before the short walls').toBeLessThan(shortWalls);
    expect(markers, 'the floor markers are drawn inside the scene pass').toBeLessThan(end);
    // The marker draw replaces bind group 0, so the short walls restore the sprite group first.
    expect(restore, 'the short walls restore the sprite bind group').toBeGreaterThan(shortWalls);
    expect(restore, 'the sprite bind group is restored before the short-wall draw').toBeLessThan(shortWallDraw);
    expect(shortWallDraw, 'the short walls are drawn inside the scene pass').toBeLessThan(end);
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
