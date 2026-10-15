import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { defaultAppearance } from '../src/character/schema.js';
import { decodeGeometry, geometryBuffers, type Bundle } from '../src/render/character/bundle.js';
import { selectParts } from '../src/render/character/variants.js';

const base = new URL('../../assets/models/sims/character-creator/export/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8')) as Bundle;
const buffers = Object.fromEntries(geometryBuffers.map(key =>
  [key, Uint8Array.from(readFileSync(new URL(manifest.runtime[key], base))).buffer]));
const geometry = decodeGeometry(manifest, 'runtime', buffers as Record<typeof geometryBuffers[number], ArrayBuffer>);
const context = { wear: 'clothed' as const, prop: 'none', fixture: 'none', eyes_closed: false };

it('selects exactly one shoulder-to-wrist garment per arm for long sleeves', () => {
  for (const presentation of ['masculine', 'feminine'] as const) {
    const appearance = { ...defaultAppearance(presentation), sleeves: 'long' as const };
    const names = selectParts(geometry, appearance, context).map(part => part.name);
    expect(names.filter(name => /sleeve|cuff/i.test(name))).toEqual(['Creator long sleeve L', 'Creator long sleeve R']);
    expect(names.some(name => name.startsWith('Forearm with elbow'))).toBe(false);
    expect(names.filter(name => name.startsWith('Relaxed palm'))).toHaveLength(2);
    for (const sleeves of ['rolled', 'short'] as const) {
      const alternatives = selectParts(geometry, { ...appearance, sleeves }, context).map(part => part.name);
      expect(alternatives.some(name => name.startsWith('Creator long sleeve'))).toBe(false);
      expect(alternatives.filter(name => name.startsWith(sleeves === 'rolled' ? 'Relaxed shirt sleeve' : 'Creator short sleeve'))).toHaveLength(2);
      expect(alternatives.filter(name => name.startsWith('Forearm with elbow'))).toHaveLength(2);
    }
    for (const sleeves of ['long', 'rolled', 'short'] as const) {
      const bare = selectParts(geometry, { ...appearance, sleeves }, { ...context, wear: 'bare' }).map(part => part.name);
      expect(bare.filter(name => name.startsWith('Forearm with elbow'))).toHaveLength(2);
      expect(bare.some(name => name.startsWith('Creator long sleeve'))).toBe(false);
      expect(bare.filter(name => name.startsWith('Relaxed palm'))).toHaveLength(2);
    }
  }
});

it('exports connected closed sleeves with no transverse elbow caps and blended elbow weights', () => {
  for (const side of ['L', 'R']) {
    const part = geometry.description.parts.find(part => part.name === `Creator long sleeve ${side}`)!;
    const indices = geometry.indices.slice(part.start, part.start + part.count);
    const ids = [...new Set(indices)];
    const point = (index: number) => Array.from(geometry.vertices.subarray(index * 16, index * 16 + 3));
    const heights = ids.map(index => point(index)[2]);
    expect(Math.min(...heights)).toBeLessThan(.83);
    expect(Math.max(...heights)).toBeGreaterThan(1.33);
    const edges = new Map<string, number>(), neighbours = new Map<number, Set<number>>();
    let volume = 0;
    for (let index = 0; index < indices.length; index += 3) {
      const triangle = Array.from(indices.subarray(index, index + 3));
      const [a, b, c] = triangle.map(point);
      const cross = [(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),
        (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),
        (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])];
      volume += (a[0]*cross[0]+a[1]*cross[1]+a[2]*cross[2])/6;
      if ([a, b, c].every(p => p[2] > .98 && p[2] < 1.10)) {
        expect(Math.abs(cross[2])/Math.hypot(...cross)).toBeLessThan(.8);
      }
      for (let edge = 0; edge < 3; edge++) {
        const from = triangle[edge], to = triangle[(edge+1)%3];
        const key = from < to ? `${from}:${to}` : `${to}:${from}`;
        edges.set(key, (edges.get(key) ?? 0)+1);
        const adjacent = neighbours.get(from) ?? new Set<number>();
        adjacent.add(to); neighbours.set(from, adjacent);
      }
    }
    expect(volume).toBeGreaterThan(0);
    expect([...edges.values()].every(count => count === 2)).toBe(true);
    expect(ids.length-edges.size+indices.length/3).toBe(2);
    const visited = new Set<number>(), pending = [ids[0]];
    while (pending.length) {
      const next = pending.pop()!;
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(...neighbours.get(next)!);
    }
    expect(visited.size).toBe(ids.length);
    const upper = manifest.bones.findIndex(bone => bone.name === `upper_arm.${side}`);
    const lower = manifest.bones.findIndex(bone => bone.name === `forearm.${side}`);
    const weight = (index: number, bone: number) => {
      let result = 0;
      for (let slot = 0; slot < 4; slot++) if (geometry.vertices[index*16+6+slot] === bone) result += geometry.vertices[index*16+10+slot];
      return result;
    };
    expect(ids.filter(index => weight(index, upper) > .1 && weight(index, lower) > .1).length).toBeGreaterThan(24);
  }
});
