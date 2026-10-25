import type {ClipContacts,ContactFrame} from './contact-types.js';
import {readCharacterAsset} from './asset-download.js';
export interface Bone {
  name: string; parent: number; head: [number, number, number]; tail: [number, number, number];
  rest: number[]; inverseRest: number[];
}
export interface Material {
  name: string; group: number; unlit: boolean; colour: number[];
  interpolation: 'CONSTANT' | 'LINEAR' | 'EASE';
  ramp: { position: number; colour: number[] }[];
}
export interface MeshPart {
  name: string; start: number; count: number; region: number; outline: boolean;
  conditions?: Record<string, (string | number | boolean)[]>[]; densityThreshold?: number;
  stockSlot?:number;
}
export interface MeshDescription {
  vertices: string; indices: string; vertexCount: number; indexCount: number; parts: MeshPart[];
  verticesSha256: string; indicesSha256: string;
  cage: string; cageCount: number; cageSha256: string;
  stencilRanges: string; stencilRangesSha256: string;
  stencilWeights: string; stencilWeightsSha256: string; coefficientCount: number;
  normalRanges: string; normalRangesSha256: string;
  normalTriangles: string; normalTrianglesSha256: string;
}
export interface Bundle {
  version: 2 | 3; sourceSha256: string; bones: Bone[]; materials: Material[];
  actions: Record<string, number[][][]>; original: MeshDescription; runtime: MeshDescription;
  basisActions: Record<string, number[][][]>; fixtureBasis: number[]; fixtureModel: string;
  animationSpace: 'evaluated-parent-local-delta';
  clipMetadata?: Record<string, { playback: 'loop' | 'progress' | 'static'; family: string; rigs: number[][]; visibility: boolean[][];
    contacts:ClipContacts; contactFrames:ContactFrame[];stepSamples?:boolean;fixtureOwners?:boolean[][] }>;
}
export const geometryBuffers = ['vertices', 'indices', 'cage', 'stencilRanges', 'stencilWeights', 'normalRanges', 'normalTriangles'] as const;
export type RenderMeshDescription = Pick<MeshDescription, 'vertexCount' | 'indexCount' | 'parts' | 'cageCount' | 'coefficientCount'>;
export interface Geometry {
  /** Immutable furniture support survives selection of the visible character mesh. */
  fixtureGeometry?:Geometry;
  manifest: Bundle; description: RenderMeshDescription; vertices: Float32Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer>;
  cage: Float32Array<ArrayBuffer>; stencilRanges: Uint32Array<ArrayBuffer>; stencilWeights: ArrayBuffer;
  normalRanges: Uint32Array<ArrayBuffer>; normalTriangles: Uint32Array<ArrayBuffer>;
}

export function decodeGeometry(manifest: Bundle, quality: 'original' | 'runtime', buffers: Record<typeof geometryBuffers[number], ArrayBuffer>): Geometry {
  const d = manifest[quality];
  const lengths = [d.vertexCount*64, d.indexCount*4, d.cageCount*64, d.vertexCount*16, d.coefficientCount*8, d.vertexCount*8, d.indexCount*4];
  if (geometryBuffers.some((name, i) => buffers[name].byteLength !== lengths[i])) throw new Error('Character buffer length differs');
  const result: Geometry = { manifest, description: d, vertices: new Float32Array(buffers.vertices), indices: new Uint32Array(buffers.indices),
    cage: new Float32Array(buffers.cage), stencilRanges: new Uint32Array(buffers.stencilRanges), stencilWeights: buffers.stencilWeights,
    normalRanges: new Uint32Array(buffers.normalRanges), normalTriangles: new Uint32Array(buffers.normalTriangles) };
  if (result.vertices.some(n => !Number.isFinite(n)) || result.cage.some(n => !Number.isFinite(n)) || result.indices.some(n => n >= d.vertexCount)) throw new Error('Invalid character geometry');
  const ci = new Uint32Array(buffers.stencilWeights), cw = new Float32Array(buffers.stencilWeights);
  for (let i=0;i<d.coefficientCount;i++) if (ci[i*2]>=d.cageCount || !Number.isFinite(cw[i*2+1])) throw new Error('Invalid subdivision coefficient');
  for (let i=0;i<d.vertexCount;i++) {
    const offset=result.stencilRanges[i*4], count=result.stencilRanges[i*4+1];
    if (!count || count>256 || offset+count>d.coefficientCount || result.stencilRanges[i*4+2]>=d.cageCount) throw new Error('Invalid subdivision row');
    const normalStart=result.normalRanges[i*2], normalCount=result.normalRanges[i*2+1];
    if (!normalCount || normalCount>256 || normalStart+normalCount>result.normalTriangles.length) throw new Error('Invalid normal adjacency');
  }
  if(result.normalTriangles.some(n=>n>=d.indexCount/3))throw new Error('Invalid normal triangle');
  return result;
}

async function verified(url: URL, expected: string): Promise<ArrayBuffer> {
  const bytes = await readCharacterAsset(url);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== expected) throw new Error(`Character asset hash differs: ${url.pathname}`);
  return bytes;
}

export async function loadBundle(url: string, quality: 'original' | 'runtime' = 'runtime'): Promise<Geometry> {
  const absolute = new URL(url, location.href);
  const manifest = JSON.parse(new TextDecoder().decode(await readCharacterAsset(absolute))) as Bundle;
  if (![2, 3].includes(manifest.version) || manifest.animationSpace !== 'evaluated-parent-local-delta' || !manifest.bones || manifest.bones.length < 17 || manifest.bones.length > 512 || !manifest.actions?.idle?.length || !manifest.basisActions?.idle?.length) {
    throw new Error('Unsupported character bundle');
  }
  const description = manifest[quality];
  const entries = await Promise.all(geometryBuffers.map(async name => [name,
    await verified(new URL(description[name], absolute), description[`${name}Sha256`])] as const));
  return decodeGeometry(manifest, quality, Object.fromEntries(entries) as Record<typeof geometryBuffers[number], ArrayBuffer>);
}

/** Build-managed URLs keep manifest-relative binary names valid after asset fingerprinting. */
export async function loadGeometryAssets(manifest: Bundle, urls: Readonly<Record<string,string>>, quality: 'original'|'runtime' = 'runtime'): Promise<Geometry> {
  const description = manifest[quality];
  const entries = await Promise.all(geometryBuffers.map(async name => {
    const url = urls[description[name]];
    if (!url) throw new Error(`Missing bundled character asset: ${description[name]}`);
    return [name, await verified(new URL(url, location.href), description[`${name}Sha256`])] as const;
  }));
  return decodeGeometry(manifest, quality, Object.fromEntries(entries) as Record<typeof geometryBuffers[number],ArrayBuffer>);
}
