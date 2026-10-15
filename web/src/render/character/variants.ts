import { validateAppearance, type CharacterAppearanceV1 } from '../../character/schema.js';
import type { Geometry, MeshPart } from './bundle.js';

export interface AppearanceContext {
  wear: 'clothed' | 'bare'; prop: string; fixture: string; eyes_closed: boolean;
  clip?: string; grip?: 'relaxed' | 'mop';
  stockMask?:number;heldSlot?:number;includeFixture?:boolean;
}
const defaults: Record<string, string | boolean> = {
  hairstyle: 'curl', bald: false, facial_hair: 'none', freckles: false, scar: 'none', top: 'overshirt',
  sleeves: 'rolled', bottoms: 'trousers', footwear: 'loafers', glasses: false, glasses_style: 'round',
  earrings: 'none', wear: 'clothed', prop: 'none', fixture: 'none', eyes_closed: false,
  clip: 'idle', grip: 'relaxed',
};
const cache = new WeakMap<Geometry, Map<string, Geometry>>();
type SelectorValue=string|number|boolean;
interface SelectionProgram {supported:Map<string,Set<SelectorValue>>;parts:{part:MeshPart;clauses:[string,ReadonlySet<SelectorValue>][][]}[]}
const programs=new WeakMap<Geometry,SelectionProgram>();
const noIgnoredSelectors:ReadonlySet<string>=new Set();
function selectionProgram(source:Geometry):SelectionProgram {
  const saved=programs.get(source);if(saved)return saved;
  const supported=new Map<string,Set<SelectorValue>>();
  const parts=source.description.parts.map(part=>({part,clauses:(part.conditions??[]).map(clause=>Object.entries(clause).map(([key,values]):[string,ReadonlySet<SelectorValue>]=>{
    if(!Object.hasOwn(defaults,key)||!Array.isArray(values)||!values.length)throw new Error(`Invalid mesh selector: ${key}`);
    const set=supported.get(key)??new Set();for(const value of values)set.add(value);supported.set(key,set);
    return [key,new Set(values)];
  }))}));
  const program={supported,parts};programs.set(source,program);return program;
}

/** Remove unused parts and their subdivision inputs before allocating graphics resources. */
export function selectParts(source: Geometry, appearance: CharacterAppearanceV1, context: AppearanceContext, ignore:ReadonlySet<string>=noIgnoredSelectors, validate=true): MeshPart[] {
  validateAppearance(appearance);
  const selectors: Record<string, string | boolean> = {};
  for (const key of Object.keys(defaults)) {
    const value = Object.hasOwn(context, key) ? context[key as keyof AppearanceContext]
      : Object.hasOwn(appearance, key) ? appearance[key as keyof CharacterAppearanceV1] : defaults[key];
    if (typeof value !== 'string' && typeof value !== 'boolean') throw new Error(`Invalid appearance selector: ${key}`);
    selectors[key] = value;
  }
  const program=selectionProgram(source),supported=program.supported;
  if(validate)for (const [key, value] of Object.entries(selectors)) {
    if(ignore.has(key))continue;
    if (key === 'bald' || key === 'freckles' || (key === 'hairstyle' && appearance.bald) || (key === 'glasses_style' && !appearance.glasses)) continue;
    if (key === 'grip' || key === 'clip' && source.manifest.actions[String(value)]) continue;
    if (context.wear === 'bare' && ['top', 'sleeves', 'bottoms', 'footwear'].includes(key)) continue;
    if (value === defaults[key] || value === 'none' || value === false) continue;
    if (!supported.get(key)?.has(value)) throw new Error(`Missing character asset for ${key}: ${value}`);
  }
  const selected = program.parts.filter(({part,clauses}) =>
    (!clauses.length || clauses.some(clause => clause.every(([key, values]) => ignore.has(key)||values.has(selectors[key]))))
    && (context.includeFixture!==false||part.region!==10&&part.region!==12)
    && (part.stockSlot===undefined||context.stockMask===undefined||part.stockSlot===context.heldSlot||!!(context.stockMask&(1<<part.stockSlot)))
    // Legacy freckle spheres are replaced by a continuously varying skin mask.
    && part.densityThreshold === undefined).map(entry=>entry.part);
  return selected;
}

/** Legacy compact geometry used by standalone asset and physical proofs. */
export function selectGeometry(source: Geometry, appearance: CharacterAppearanceV1, context: AppearanceContext): Geometry {
  const selected=selectParts(source,appearance,context);
  if (!selected.length) throw new Error('Appearance has no renderable parts.');
  let entries = cache.get(source);
  if (!entries) { entries = new Map(); cache.set(source, entries); }
  const key = JSON.stringify(selected.map(part => part.start));
  const found = entries.get(key);
  if (found) return found;
  const result = compactGeometry(source, selected);
  if (entries.size >= 16) entries.delete(entries.keys().next().value!);
  entries.set(key, result);
  return result;
}

function lookup(map: Map<number, number>, index: number): number {
  const value = map.get(index);
  if (value === undefined) throw new Error(`Missing geometry index: ${index}`);
  return value;
}
function gather(source: Float32Array<ArrayBuffer>, ids: number[]): Float32Array<ArrayBuffer> {
  const output = new Float32Array(ids.length * 16);
  ids.forEach((id, i) => output.set(source.subarray(id * 16, id * 16 + 16), i * 16));
  return output;
}
export function compactGeometry(source: Geometry, selected: readonly MeshPart[]): Geometry {
  const vertexSet = new Set<number>();
  for (const part of selected) for (let i = part.start; i < part.start + part.count; i++) vertexSet.add(source.indices[i]);
  const vertices = [...vertexSet].sort((a, b) => a - b), vertexMap = new Map(vertices.map((id, i) => [id, i]));
  const sourceWeights = new Uint32Array(source.stencilWeights), cageSet = new Set<number>();
  let coefficientCount = 0;
  for (const vertex of vertices) {
    const offset = source.stencilRanges[vertex * 4], count = source.stencilRanges[vertex * 4 + 1];
    coefficientCount += count;
    for (let k = offset; k < offset + count; k++) cageSet.add(sourceWeights[k * 2]);
    if (source.stencilRanges[vertex * 4 + 3] === 1) cageSet.add(source.stencilRanges[vertex * 4 + 2]);
  }
  const cages = [...cageSet].sort((a, b) => a - b), cageMap = new Map(cages.map((id, i) => [id, i]));
  const stencilRanges = new Uint32Array(vertices.length * 4), stencilWeights = new ArrayBuffer(coefficientCount * 8);
  const weights = new Uint32Array(stencilWeights);
  let cursor = 0;
  vertices.forEach((vertex, i) => {
    const offset = source.stencilRanges[vertex * 4], count = source.stencilRanges[vertex * 4 + 1];
    const direct = source.stencilRanges[vertex * 4 + 3];
    stencilRanges.set([cursor, count, direct === 1 ? lookup(cageMap, source.stencilRanges[vertex * 4 + 2]) : 0, direct], i * 4);
    for (let k = offset; k < offset + count; k++, cursor++) {
      weights[cursor * 2] = lookup(cageMap, sourceWeights[k * 2]);
      weights[cursor * 2 + 1] = sourceWeights[k * 2 + 1];
    }
  });
  const indexCount = selected.reduce((sum, part) => sum + part.count, 0), indices = new Uint32Array(indexCount);
  cursor = 0;
  const parts = selected.map(part => {
    const start = cursor;
    for (let i = part.start; i < part.start + part.count; i++) indices[cursor++] = lookup(vertexMap, source.indices[i]);
    return { ...part, start };
  });
  const adjacency: number[][] = Array.from({ length: vertices.length }, () => []);
  for (let i = 0; i < indices.length; i++) adjacency[indices[i]].push(Math.floor(i / 3));
  const normalRanges = new Uint32Array(vertices.length * 2), normalTriangles = new Uint32Array(indices.length);
  cursor = 0;
  adjacency.forEach((triangles, i) => { normalRanges.set([cursor, triangles.length], i * 2); normalTriangles.set(triangles, cursor); cursor += triangles.length; });
  return { fixtureGeometry:source.fixtureGeometry??source, manifest: source.manifest, description: { vertexCount: vertices.length, cageCount: cages.length, indexCount, coefficientCount, parts },
    vertices: gather(source.vertices, vertices), cage: gather(source.cage, cages), indices, stencilRanges, stencilWeights, normalRanges, normalTriangles };
}
