import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  GROUND_MARKER_COMMAND, GROUND_MARKER_DEPTH, GroundSelectionRenderer, HOUSEMATE_MARKER_RADIUS, MARKER_BLUE, MARKER_RED, MARKER_UNIFORM_FLOATS,
  MARKER_UNIFORM_HEADER_FLOATS, MARKER_UNIFORM_LAYOUT, MAX_GROUND_MARKERS, OFFSET_MARKER_SEMI_AXIS_X,
  OFFSET_MARKER_SEMI_AXIS_Y, PLACEMENT_MARKER_MARGIN, drawAroundMarkers, groundMarkerPipelineDescriptor,
  groundMarkerRows, groundSelectionShader, MARKER_LOOK, markerAxes, placementMarkerSemiAxis, wgslFloat,
  writeHousemateMarker, writeMarkerUniform, writePlacementMarker, writeSegmentMarker, MARKER_SEGMENT,
  MARKER_SEGMENT_HOVER, OFFSET_MARKER_KIND, SEGMENT_MARKER_OVERHANG, SEGMENT_MARKER_RADIUS,
} from '../src/render/ground-selection.js';
import { buildInstanceBatch, type RenderSource } from '../src/frame.js';
import { spriteIndex } from '../src/render/atlas.js';
import {
  ARCHITECTURE_DEPTH, ARCHITECTURE_FLOOR, FLOATS_PER_INSTANCE, FOOTPRINT_PROJECTION, MAX_ARCHITECTURE_FINISH_SLOT,
  OFFSET_DEPTH, OFFSET_SCREEN_X, OFFSET_SCREEN_Y, OFFSET_WALL_DEPTH_STEP, OFFSET_WALL_MASK, REGISTERED_SURFACE_DEPTH,
  SURFACE_DEPTH_PROJECTION, SURFACE_PLANE_PROJECTION, VERTICES_PER_QUAD, architectureMode, decodeArchitectureMode,
} from '../src/render/instances.js';
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH, screenX, screenY } from '../src/render/iso.js';
import { SCENE_SAMPLE_SCALE } from '../src/render/scene-sampling.js';
import type { SceneTarget } from '../src/render/scene-target.js';
import { spritePipelineDescriptors } from '../src/render/sprite-pipelines.js';
import type { PlacementPreview } from '../src/bridge.js';

/** The uniform block of one marker row, in doubles so the geometry checks are not limited by storage precision. */
function uniform(row: Float32Array, scale: number): Float64Array {
  const out = new Float64Array(MARKER_UNIFORM_FLOATS);
  writeMarkerUniform(out, 0, row, 0, scale);
  return out;
}

const L = MARKER_UNIFORM_LAYOUT;

/** A screen offset from the marker center, mapped into the space where the marker's ellipse is the unit circle. */
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
      // How far one tile along each world axis reaches in the space where the ellipse is the unit circle:
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
  it.each([1, 2, 0.6])('keeps the housemate marker the 30 by 19.6875 pixel ellipse the game shipped, at scale %s', scale => {
    const row = housemateRow();
    expect(row[OFFSET_MARKER_SEMI_AXIS_X]).toBe(Math.fround(HOUSEMATE_MARKER_RADIUS));
    expect(row[OFFSET_MARKER_SEMI_AXIS_Y]).toBe(Math.fround(HOUSEMATE_MARKER_RADIUS));
    const block = uniform(row, scale);
    expect([block[L.center], block[L.center + 1]]).toEqual([120, 80]);
    // On the floor-decal plane: depth 0 would draw the marker over everything in front of it.
    expect(block[L.depth]).toBe(Math.fround(GROUND_MARKER_DEPTH));
    expect(block[L.extent]).toBeCloseTo(30 * scale, 5);
    expect(block[L.extent + 1]).toBeCloseTo(19.6875 * scale, 5);
    expect(Array.from(block.slice(L.color, L.color + 3))).toEqual(MARKER_BLUE.map(Math.fround));
    // The radius in that space equals the old length(local / radius) for every screen offset.
    for (const [x, y] of [[30, 0], [0, 19.6875], [12, -7], [-25, 11]]) {
      const [ox, oy] = [x * scale, y * scale];
      expect(Math.hypot(...unit(block, ox, oy))).toBeCloseTo(Math.hypot(ox / (30 * scale), oy / (19.6875 * scale)), 5);
    }
  });

  it('colors a placement marker by its validity, lays it on the floor-decal plane and writes the marker command', () => {
    const valid = uniform(placementRow(1, 2), 1), refused = uniform(placementRow(1, 2, false), 1);
    expect(Array.from(valid.slice(L.color, L.color + 3))).toEqual(MARKER_BLUE.map(Math.fround));
    expect(Array.from(refused.slice(L.color, L.color + 3))).toEqual(MARKER_RED.map(Math.fround));
    expect([valid[L.depth], refused[L.depth]]).toEqual([Math.fround(GROUND_MARKER_DEPTH), Math.fround(GROUND_MARKER_DEPTH)]);
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

  it('carries the row depth into the block', () => {
    const row = housemateRow();
    row[OFFSET_DEPTH] = 0.25;
    expect(uniform(row, 1)[L.depth]).toBe(0.25);
  });
});

describe('the marker renderer', () => {
  it('uploads the logical canvas size and one block per marker, then draws one instance per marker', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8 });
    try {
      const module = { label: 'shader' }, layout = { label: 'layout' }, group = { label: 'group' };
      const pipeline = { getBindGroupLayout: (index: number) => { expect(index).toBe(0); return layout; } };
      let created: GPUBufferDescriptor | null = null, destroyed = false;
      const buffer = { destroy: () => { destroyed = true; } };
      const writes: { buffer: unknown; offset: number; data: number[]; dataOffset: number; size: number }[] = [];
      const device = {
        createShaderModule: (descriptor: GPUShaderModuleDescriptor) => {
          expect(descriptor.code).toBe(groundSelectionShader);
          return module;
        },
        createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
          expect(descriptor).toEqual(groundMarkerPipelineDescriptor(module as unknown as GPUShaderModule));
          return pipeline;
        },
        createBuffer: (descriptor: GPUBufferDescriptor) => { created = descriptor; return buffer; },
        createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
          expect(descriptor.layout).toBe(layout);
          expect(Array.from(descriptor.entries)).toEqual([{ binding: 0, resource: { buffer } }]);
          return group;
        },
        queue: {
          writeBuffer: (target: unknown, offset: number, data: Float32Array, dataOffset: number, size: number) => {
            writes.push({ buffer: target, offset, data: Array.from(data), dataOffset, size });
          },
        },
      };
      const renderer = new GroundSelectionRenderer(device as unknown as GPUDevice);
      expect(created).toEqual({ size: (MARKER_UNIFORM_HEADER_FLOATS + MAX_GROUND_MARKERS * MARKER_UNIFORM_FLOATS) * 4,
        usage: 64 | 8 });

      const instances = new Float32Array(5 * FLOATS_PER_INSTANCE);
      writeHousemateMarker(instances, 1, 120, 80);
      writePlacementMarker(instances, 3, 300, 200, 1, 2, false);
      const rows = Int32Array.from([1, 3, 0, 0]);
      const recorded: unknown[][] = [];
      const pass = {
        setPipeline: (value: unknown) => recorded.push(['setPipeline', value]),
        setBindGroup: (index: number, value: unknown) => recorded.push(['setBindGroup', index, value]),
        draw: (...args: number[]) => recorded.push(['draw', ...args]),
      };
      // The scene renders at twice the canvas resolution; the shader works in canvas pixels.
      const target = { logicalWidth: 640, logicalHeight: 480, width: 1280, height: 960 };
      renderer.draw(pass as unknown as GPURenderPassEncoder, target as unknown as SceneTarget, instances, rows, 2, 1.5);

      expect(writes).toHaveLength(1);
      const [write] = writes;
      expect([write.buffer, write.offset, write.dataOffset, write.size])
        .toEqual([buffer, 0, 0, MARKER_UNIFORM_HEADER_FLOATS + 2 * MARKER_UNIFORM_FLOATS]);
      expect(write.data.slice(0, 2)).toEqual([640, 480]);
      for (let marker = 0; marker < 2; marker++) {
        const expected = new Float32Array(MARKER_UNIFORM_FLOATS);
        writeMarkerUniform(expected, 0, instances, rows[marker], 1.5);
        const start = MARKER_UNIFORM_HEADER_FLOATS + marker * MARKER_UNIFORM_FLOATS;
        expect(write.data.slice(start, start + MARKER_UNIFORM_FLOATS)).toEqual(Array.from(expected));
      }
      expect(recorded).toEqual([['setPipeline', pipeline], ['setBindGroup', 0, group], ['draw', VERTICES_PER_QUAD, 2]]);

      renderer.draw(pass as unknown as GPURenderPassEncoder, target as unknown as SceneTarget, instances, rows, 0, 1.5);
      expect(writes).toHaveLength(1);
      expect(recorded).toHaveLength(3);
      renderer.destroy();
      expect(destroyed).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
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
/** The canvas the replayed vertex shader maps to clip space; the replay maps clip space back to it. */
const CANVAS: readonly [number, number] = [1000, 800];
/** fwidth differences across one scene sample, half a canvas pixel in the game. */
const GAME_STEP = 1 / SCENE_SAMPLE_SCALE;

/** Removes whitespace next to punctuation and collapses the rest, so only spaces between two words remain. */
function normalized(statement: string): string {
  return statement.replace(/\s+/g, ' ').replace(/\s*([^\w\s])\s*/g, '$1').trim();
}

/** The statements of the WGSL function `name`, comments removed and whitespace normalized. */
function functionStatements(source: string, name: string): string[] {
  const declaration = new RegExp(String.raw`\bfn\s+${name}\s*[(]`).exec(source);
  if (!declaration) throw new Error(`The shader has no function ${name}`);
  const body = source.indexOf('{', declaration.index);
  const statements: string[] = [];
  let depth = 1, current = '';
  for (let index = body + 1; index < source.length; index++) {
    const character = source[index];
    if (character === '/' && source[index + 1] === '/') { index = source.indexOf('\n', index); continue; }
    if (character === '{') depth++;
    if (character === '}' && --depth === 0) break;
    current += character;
    if ((character === ';' || character === '}') && depth === 1) {
      statements.push(normalized(current));
      current = '';
    }
  }
  if (current.trim()) statements.push(normalized(current));
  return statements;
}

/** One vertex invocation's values, named as the shader names them. */
interface VertexValue {
  i: number; q: [number, number]; offset: [number, number]; p: [number, number];
  position: [number, number, number, number]; unit: [number, number]; marker: number;
}
/** One WGSL statement of `vs` and the TypeScript that does the same. */
type VertexStatement = readonly [wgsl: string, run: (value: VertexValue, block: Float64Array) => void];
const CORNERS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];

/** The vertex shader `vs`, statement by statement, each beside the TypeScript the replay runs for it. */
const VERTEX: readonly VertexStatement[] = [
  ['let q=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[i];', value => {
    const [x, y] = CORNERS[value.i];
    value.q = [x, y];
  }],
  ['let m=u.items[marker];', () => {}],
  [`let offset=q*(m.extent+vec2f(${float(look.boxMargin)}));`, (value, block) => {
    value.offset = [value.q[0] * (block[L.extent] + look.boxMargin), value.q[1] * (block[L.extent + 1] + look.boxMargin)];
  }],
  ['var o:Vertex;', () => {}],
  ['let p=m.center+offset;', (value, block) => {
    value.p = [block[L.center] + value.offset[0], block[L.center + 1] + value.offset[1]];
  }],
  ['o.position=vec4f(p/u.canvas*vec2f(2,-2)+vec2f(-1,1),m.depth,1);', (value, block) => {
    value.position = [value.p[0] / CANVAS[0] * 2 - 1, value.p[1] / CANVAS[1] * -2 + 1, block[L.depth], 1];
  }],
  ['o.unit=vec2f(dot(m.row0,offset),dot(m.row1,offset));', (value, block) => {
    value.unit = [block[L.row0] * value.offset[0] + block[L.row0 + 1] * value.offset[1],
      block[L.row1] * value.offset[0] + block[L.row1 + 1] * value.offset[1]];
  }],
  ['o.marker=marker;', value => { value.marker = 0; }],
  ['return o;', () => {}],
];

/** The vertex output struct, whose default interpolation hands the fragment a linearly interpolated unit. */
const VERTEX_STRUCT = 'struct Vertex{@builtin(position)position:vec4f,@location(0)unit:vec2f,@location(1)@interpolate(flat)marker:u32};';

/** One fragment invocation's values, named as the shader names them. */
interface Fragment {
  block: Float64Array; covered: boolean; unit: [number, number]; bar: number;
  r: number; f: number; n: [number, number]; slope: number; dist: number; aa: number;
  edge: number; fill: number; opacity: number; discarded: boolean; output: number[];
}
/** One WGSL statement of `fs` and the TypeScript that does the same; `fwidth` differences a named value across the quad. */
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
 * TypeScript the replay runs for it. The constants come from MARKER_LOOK on
 * both sides; a test checks that their WGSL text keeps their values.
 */
const FRAGMENT: readonly Statement[] = [
  ['let m=u.items[i.marker];', () => {}],
  // The bar's own statements are tied and replayed below, as SEGMENT.
  ['let bar=segment(i,m);', value => { value.bar = segmentAt(value.block, value.unit).result; }],
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
  [`let opacity=select(edge*${float(look.borderOpacity)}+(1.-edge)*fill,bar,m.kind>.5);`, value => {
    value.opacity = value.block[L.kind] > 0.5 ? value.bar : value.edge * look.borderOpacity + (1 - value.edge) * value.fill;
  }],
  [`if(opacity<${float(look.discardOpacity)}){discard;}`, value => { value.discarded = value.opacity < look.discardOpacity; }],
  ['return vec4f(linear(m.color.rgb)*opacity,opacity);', value => {
    value.output = [0, 1, 2].map(channel => LINEAR[1](value.block[L.color + channel]) * value.opacity).concat(value.opacity);
  }],
];

/** One invocation of the shader's `segment`, named as it names its values. */
interface SegmentValue {
  block: Float64Array; unit: [number, number]; p: [number, number]; radius: number; q: [number, number];
  dist: number; aa: number; edge: number; inside: number; hover: boolean; border: number; fill: number; result: number;
}
type SegmentStatement = readonly [wgsl: string, run: (value: SegmentValue, fwidth: (name: 'dist') => number) => void];

/** The bar function `segment`, statement by statement, each beside the TypeScript the replay runs for it. */
const SEGMENT: readonly SegmentStatement[] = [
  ['let p=abs(i.unit)*m.semi;', value => {
    value.p = [Math.abs(value.unit[0]) * value.block[L.semi], Math.abs(value.unit[1]) * value.block[L.semi + 1]];
  }],
  ['let radius=min(m.semi.x,m.semi.y);', value => { value.radius = Math.min(value.block[L.semi], value.block[L.semi + 1]); }],
  ['let q=p-m.semi+vec2f(radius);', value => {
    value.q = [value.p[0] - value.block[L.semi] + value.radius, value.p[1] - value.block[L.semi + 1] + value.radius];
  }],
  ['let dist=length(max(q,vec2f(0)))+min(max(q.x,q.y),0.)-radius;', value => {
    value.dist = Math.hypot(Math.max(value.q[0], 0), Math.max(value.q[1], 0))
      + Math.min(Math.max(value.q[0], value.q[1]), 0) - value.radius;
  }],
  [`let aa=max(fwidth(dist),${float(look.minSoftening)});`, (value, fwidth) => {
    value.aa = Math.max(fwidth('dist'), look.minSoftening);
  }],
  [`let edge=1.-smoothstep(${float(look.borderHalfWidth)}-aa,${float(look.borderHalfWidth)}+aa,abs(dist));`, value => {
    value.edge = 1 - smoothstep(look.borderHalfWidth - value.aa, look.borderHalfWidth + value.aa, Math.abs(value.dist));
  }],
  ['let inside=1.-smoothstep(-aa,aa,dist);', value => { value.inside = 1 - smoothstep(-value.aa, value.aa, value.dist); }],
  ['let hover=m.kind>1.5;', value => { value.hover = value.block[L.kind] > 1.5; }],
  [`let border=select(${float(look.borderOpacity)},${float(look.hoverBorderOpacity)},hover);`, value => {
    value.border = value.hover ? look.hoverBorderOpacity : look.borderOpacity;
  }],
  [`let fill=select(${float(look.segmentFillOpacity)},${float(look.hoverFillOpacity)},hover);`, value => {
    value.fill = value.hover ? look.hoverFillOpacity : look.segmentFillOpacity;
  }],
  ['return edge*border+(1.-edge)*inside*fill;', value => {
    value.result = value.edge * value.border + (1 - value.edge) * value.inside * value.fill;
  }],
];

/**
 * Runs `segment` at a unit-space point. fwidth differences `dist` one game
 * sample step to the right and down on the screen; the unit is linear in the
 * screen offset, so the neighbor's unit follows from the block's rows.
 */
function segmentAt(block: Float64Array, at: [number, number], limit = SEGMENT.length): SegmentValue {
  const value: SegmentValue = { block, unit: at, p: [0, 0], radius: 0, q: [0, 0], dist: 0, aa: 0, edge: 0, inside: 0,
    hover: false, border: 0, fill: 0, result: 0 };
  const step = GAME_STEP, right = unit(block, step, 0), down = unit(block, 0, step);
  for (let index = 0; index < limit; index++) {
    SEGMENT[index][1](value, name => {
      const here = segmentAt(block, at, index)[name];
      return Math.abs(segmentAt(block, [at[0] + right[0], at[1] + right[1]], index)[name] - here)
        + Math.abs(segmentAt(block, [at[0] + down[0], at[1] + down[1]], index)[name] - here);
    });
  }
  return value;
}

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

/** One marker's quad as the replayed vertex shader leaves it, and the fragment statements to run over it. */
interface Replay {
  block: Float64Array; step: number; statements: readonly Statement[];
  vertices: { screen: [number, number]; unit: [number, number] }[];
}

/** Runs the vertex statements for all six corners and maps each clip position back to canvas pixels. */
function replay(block: Float64Array, step = GAME_STEP, statements: readonly Statement[] = FRAGMENT): Replay {
  const vertices = CORNERS.map((_, i) => {
    const value: VertexValue = { i, q: [0, 0], offset: [0, 0], p: [0, 0], position: [0, 0, 0, 0], unit: [0, 0], marker: -1 };
    for (const [, run] of VERTEX) run(value, block);
    const screen: [number, number] = [(value.position[0] + 1) / 2 * CANVAS[0], (1 - value.position[1]) / 2 * CANVAS[1]];
    return { screen, unit: value.unit };
  });
  return { block, step, statements, vertices };
}

/** Barycentric weights of `point` in the triangle of vertices a, b and c; one is negative outside it. */
function weights(a: [number, number], b: [number, number], c: [number, number], point: [number, number]): number[] {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  const wb = ((point[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (point[1] - a[1])) / area;
  const wc = ((b[0] - a[0]) * (point[1] - a[1]) - (point[0] - a[0]) * (b[1] - a[1])) / area;
  return [1 - wb - wc, wb, wc];
}

/**
 * What the rasterizer hands a fragment at canvas point `point`: whether
 * either triangle covers it, and the unit interpolated from the vertex
 * outputs. The unit is linear across the quad, so the first triangle's
 * plane gives it everywhere, as helper invocations extend it past an edge.
 */
function rasterize(quad: Replay, point: [number, number]): { covered: boolean; unit: [number, number] } {
  const v = quad.vertices;
  const first = weights(v[0].screen, v[1].screen, v[2].screen, point);
  const second = weights(v[3].screen, v[4].screen, v[5].screen, point);
  const covered = first.every(weight => weight >= -1e-9) || second.every(weight => weight >= -1e-9);
  const unit: [number, number] = [0, 1].map(axis =>
    first[0] * v[0].unit[axis] + first[1] * v[1].unit[axis] + first[2] * v[2].unit[axis]) as [number, number];
  return { covered, unit };
}

/**
 * Runs the fragment statements at canvas-pixel offset (x, y) from the marker
 * center. fwidth differences a value across the two by two quad of samples
 * whose first sample is (quadX, quadY), as fine derivatives do.
 */
function fragment(quad: Replay, x: number, y: number, quadX = x, quadY = y, limit = quad.statements.length): Fragment {
  const raster = rasterize(quad, [quad.block[L.center] + x, quad.block[L.center + 1] + y]);
  const value: Fragment = { block: quad.block, covered: raster.covered, unit: raster.unit, bar: 0, r: 0, f: 0, n: [0, 0],
    slope: 0, dist: 0, aa: 0, edge: 0, fill: 0, opacity: 0, discarded: false, output: [] };
  for (let index = 0; index < limit; index++) {
    quad.statements[index][1](value, name => {
      const at = (sx: number, sy: number) => fragment(quad, sx, sy, sx, sy, index)[name];
      return Math.abs(at(quadX + quad.step, y) - at(quadX, y)) + Math.abs(at(x, quadY + quad.step) - at(x, quadY));
    });
  }
  return value;
}

/** The fragment at sample (px, py) of the quad's sample grid; sample (0, 0) lies exactly on the marker center. */
function sample(quad: Replay, px: number, py: number): Fragment {
  const corner = (p: number) => (p - (((p % 2) + 2) % 2)) * quad.step;
  return fragment(quad, px * quad.step, py * quad.step, corner(px), corner(py));
}

/** The point at angle t on the marker's edge, and the unit screen direction straight out of the ellipse there. */
function edgePoint(block: Float64Array, t: number): { point: [number, number]; normal: [number, number] } {
  const [a, b, c, d] = [block[L.row0], block[L.row0 + 1], block[L.row1], block[L.row1 + 1]];
  const det = a * d - b * c, cos = Math.cos(t), sin = Math.sin(t);
  // The inverse map takes the unit circle back to the marker's ellipse on the screen.
  const point: [number, number] = [(d * cos - b * sin) / det, (-c * cos + a * sin) / det];
  const nx = a * cos + c * sin, ny = b * cos + d * sin, length = Math.hypot(nx, ny);
  return { point, normal: [nx / length, ny / length] };
}

/** Where smoothstep(0, 1, t) reaches `target`, by bisection. */
function smoothstepAt(target: number): number {
  let low = 0, high = 1;
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (smoothstep(0, 1, middle) < target) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

/** The distance along the outward normal over which the border fades from 0.9 to 0.1 of full strength. */
function outerSoftening(quad: Replay, point: [number, number], normal: [number, number]): number {
  let strong = Number.NaN, faint = Number.NaN;
  for (let s = 0; s <= 3; s += 0.0005) {
    const edge = fragment(quad, point[0] + s * normal[0], point[1] + s * normal[1]).edge;
    if (Number.isNaN(strong) && edge <= 0.9) strong = s;
    if (Number.isNaN(faint) && edge <= 0.1) { faint = s; break; }
  }
  return faint - strong;
}

/** WGSL's decimal floating-point literal without a suffix. */
const WGSL_FLOAT = /^(?:\d*\.\d+(?:[eE][+-]?\d+)?|\d+\.\d*(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)$/;

describe('the marker shader, replayed on the CPU', () => {
  const blocks: [string, Float64Array][] = [
    ['housemate', uniform(housemateRow(), 1)],
    ['1 by 1 placement', uniform(placementRow(1, 1), 1)],
    ['2 by 2 placement', uniform(placementRow(2, 2), 1)],
    ['1 by 3 placement', uniform(placementRow(1, 3), 1)],
    ['zoomed 1 by 2 placement', uniform(placementRow(1, 2), 2.5)],
  ];

  it('ties every vertex, fragment and color-conversion statement and the vertex struct to the replay', () => {
    expect(functionStatements(groundSelectionShader, 'vs')).toEqual(VERTEX.map(([wgsl]) => normalized(wgsl)));
    expect(functionStatements(groundSelectionShader, 'fs')).toEqual(FRAGMENT.map(([wgsl]) => normalized(wgsl)));
    expect(functionStatements(groundSelectionShader, 'linear')).toEqual([normalized(LINEAR[0])]);
    expect(functionStatements(groundSelectionShader, 'segment')).toEqual(SEGMENT.map(([wgsl]) => normalized(wgsl)));
    const struct = /struct Vertex \{[^}]*\};/.exec(groundSelectionShader);
    expect(struct && normalized(struct[0])).toBe(VERTEX_STRUCT);
  });

  it('keeps the tie through a formatting pass, but not through a real edit', () => {
    const format = (source: string) => source.replaceAll('=', ' = ').replaceAll(',', ', ')
      .replace('let slope=max(', 'let slope = max(\n    ');
    const formatted = format(groundSelectionShader);
    expect(formatted).not.toBe(groundSelectionShader);
    expect(functionStatements(formatted, 'fs')).toEqual(FRAGMENT.map(([wgsl]) => normalized(wgsl)));
    expect(functionStatements(formatted, 'vs')).toEqual(VERTEX.map(([wgsl]) => normalized(wgsl)));
    const edited = format(groundSelectionShader.replace('let f=r-1.;', 'let f=r*r-1.;'));
    expect(functionStatements(edited, 'fs')).not.toEqual(FRAGMENT.map(([wgsl]) => normalized(wgsl)));
  });

  it.each(Object.entries(look))('writes MARKER_LOOK.%s into the shader as a WGSL float with the same value', (_, value) => {
    const text = float(value);
    expect(text).toMatch(WGSL_FLOAT);
    expect(Number(text)).toBe(value);
  });

  it('formats whole numbers, decimals and tiny numbers as WGSL floats', () => {
    expect([float(4), float(0.975), float(1e-4), float(1e-7)]).toEqual(['4.0', '0.975', '0.0001', '1e-7']);
  });

  it.each(blocks)('keeps the %s marker center a visible plain 0.105 fill, with no bright dot', (_, block) => {
    const quad = replay(block);
    for (let py = -4; py <= 4; py++) {
      for (let px = -4; px <= 4; px++) {
        const value = sample(quad, px, py);
        expect(value.covered).toBe(true);
        expect(value.discarded).toBe(false);
        expect(value.opacity).toBeCloseTo(0.105, 6);
        expect(value.output[3]).toBeCloseTo(0.105, 6);
        for (let channel = 0; channel < 3; channel++) {
          expect(value.output[channel]).toBeCloseTo(LINEAR[1](block[L.color + channel]) * 0.105, 6);
        }
      }
    }
  });

  it('rejects the earlier softening, which lit the samples around an exact center', () => {
    for (const [, block] of blocks.slice(1)) {
      const quad = replay(block, GAME_STEP, EARLIER_SOFTENING);
      const brightest = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([px, py]) => sample(quad, px, py).opacity));
      expect(brightest).toBeGreaterThan(0.3);
    }
  });

  it.each(blocks)('gives the %s marker a 1.95 pixel border all the way around', (_, block) => {
    const quad = replay(block);
    for (let k = 0; k < 16; k++) {
      const { point, normal } = edgePoint(block, k * Math.PI / 8);
      // Walk across the edge along its screen normal and measure where the border is at least half strength.
      let width = 0;
      for (let s = -1.5; s <= 1.5; s += 0.001) {
        if (fragment(quad, point[0] + s * normal[0], point[1] + s * normal[1]).edge >= 0.5) width += 0.001;
      }
      expect(width).toBeCloseTo(1.95, 1);
    }
  });

  it.each(blocks)('draws the %s marker edge at 0.94 opacity in the marker color, premultiplied', (_, block) => {
    const quad = replay(block);
    for (let k = 0; k < 8; k++) {
      const { point } = edgePoint(block, k * Math.PI / 4);
      const value = fragment(quad, point[0], point[1]);
      expect(value.covered).toBe(true);
      expect(value.discarded).toBe(false);
      expect(value.output[3]).toBeCloseTo(0.94, 6);
      for (let channel = 0; channel < 3; channel++) {
        expect(value.output[channel]).toBeCloseTo(LINEAR[1](block[L.color + channel]) * 0.94, 6);
      }
    }
  });

  // The current softening is the distance one scene sample's step covers
  // across the edge, half a pixel per screen axis in the game, and never less
  // than 0.42 pixels. Between 0.9 and 0.1 of full strength, smoothstep spans
  // 2 * (t(0.9) - t(0.1)) of that softening. The 10% allowance covers the
  // distance estimate's error at the tightly curved ends of a long marker.
  const span = 2 * (smoothstepAt(0.9) - smoothstepAt(0.1));
  const expectSoftening = (measured: number, softening: number) =>
    expect(Math.abs(measured - span * softening)).toBeLessThan(0.1 * span * softening);

  it.each(blocks)('fades the %s marker border out over the current softening width', (_, block) => {
    const quad = replay(block);
    for (let k = 0; k < 16; k++) {
      const { point, normal } = edgePoint(block, k * Math.PI / 8);
      expectSoftening(outerSoftening(quad, point, normal),
        Math.max(0.5 * (Math.abs(normal[0]) + Math.abs(normal[1])), 0.42));
    }
  });

  it.each(blocks)('never softens the %s marker border below 0.42 pixels, even at four samples per pixel', (_, block) => {
    const quad = replay(block, 0.25);
    for (let k = 0; k < 16; k++) {
      const { point, normal } = edgePoint(block, k * Math.PI / 8);
      expectSoftening(outerSoftening(quad, point, normal), 0.42);
    }
  });

  it.each(blocks)('keeps every visible fragment of the %s marker inside its quad', (_, block) => {
    const quad = replay(block);
    for (let k = 0; k < 32; k++) {
      const { point, normal } = edgePoint(block, k * Math.PI / 16);
      let reach = 0;
      for (let s = 0; s <= look.boxMargin + 2; s += 0.01) {
        const value = fragment(quad, point[0] + s * normal[0], point[1] + s * normal[1]);
        // 0.001 is the current discard threshold: anything stronger must lie on the drawn quad.
        if (value.opacity >= 0.001) {
          expect(value.covered).toBe(true);
          reach = s;
        }
      }
      expect(reach).toBeGreaterThan(1);
    }
  });
});

describe('the bar along a chosen wall line', () => {
  function segmentRow(axis: 0 | 1, length: number, valid = true, hover = false): Float32Array {
    const row = new Float32Array(FLOATS_PER_INSTANCE);
    writeSegmentMarker(row, 0, 300, 200, axis, length, valid, hover);
    return row;
  }
  /** The bar's opacity a world offset (dx, dy) from its centre. */
  const opacityAt = (block: Float64Array, dx: number, dy: number, scale: number) =>
    segmentAt(block, unit(block, ...screenOffset(dx, dy, scale))).result;

  it('lies along its line, a little longer than the lines it covers and thin across them', () => {
    const row = segmentRow(1, 3);
    expect(row[OFFSET_MARKER_KIND]).toBe(MARKER_SEGMENT);
    expect(row[OFFSET_MARKER_SEMI_AXIS_X]).toBeCloseTo(1.5 + SEGMENT_MARKER_OVERHANG, 6);
    expect(row[OFFSET_MARKER_SEMI_AXIS_Y]).toBeCloseTo(SEGMENT_MARKER_RADIUS, 6);
    const vertical = segmentRow(0, 2);
    expect(vertical[OFFSET_MARKER_SEMI_AXIS_X]).toBeCloseTo(SEGMENT_MARKER_RADIUS, 6);
    expect(vertical[OFFSET_MARKER_SEMI_AXIS_Y]).toBeCloseTo(1 + SEGMENT_MARKER_OVERHANG, 6);
    expect(Array.from(segmentRow(1, 1, false).slice(4, 7))).toEqual(Array.from(Float32Array.from(MARKER_RED)));
    expect(segmentRow(1, 1, true, true)[OFFSET_MARKER_KIND]).toBe(MARKER_SEGMENT_HOVER);
  });

  it.each([1, 2.5])('draws a firm body along the line and nothing beside or past it at scale %s', scale => {
    const block = uniform(segmentRow(1, 3), scale);
    expect(block[L.kind]).toBe(MARKER_SEGMENT);
    for (const along of [0, 0.7, 1.3]) expect(opacityAt(block, along, 0, scale)).toBeCloseTo(look.segmentFillOpacity, 2);
    expect(opacityAt(block, 0, 0.4, scale)).toBe(0);
    expect(opacityAt(block, 1.9, 0, scale)).toBe(0);
    // Its outline is the ellipse markers' border.
    const edge = Math.max(...Array.from({ length: 200 }, (_, i) => opacityAt(block, 0, i * 0.001, scale)));
    expect(edge).toBeCloseTo(look.borderOpacity, 1);
  });

  it('draws the line under the pointer fainter than a chosen one', () => {
    const chosen = uniform(segmentRow(0, 1), 1), hover = uniform(segmentRow(0, 1, true, true), 1);
    expect(opacityAt(hover, 0, 0, 1)).toBeCloseTo(look.hoverFillOpacity, 2);
    expect(opacityAt(hover, 0, 0, 1)).toBeLessThan(opacityAt(chosen, 0, 0, 1));
  });

  it('bounds the whole bar, square ends included, with its screen box', () => {
    for (const axis of [0, 1] as const) {
      const block = uniform(segmentRow(axis, 3), 1.5);
      for (const [dx, dy] of [[1.54, 0.09], [-1.54, -0.09], [0.09, 1.54], [-0.09, -1.54]]) {
        const [x, y] = screenOffset(dx, dy, 1.5);
        if (opacityAt(block, dx, dy, 1.5) === 0) continue;
        expect(Math.abs(x)).toBeLessThanOrEqual(block[L.extent] + look.boxMargin);
        expect(Math.abs(y)).toBeLessThanOrEqual(block[L.extent + 1] + look.boxMargin);
      }
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
