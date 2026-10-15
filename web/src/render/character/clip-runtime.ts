import type { Bone, Bundle, Geometry, Material, MeshDescription } from './bundle.js';
import { identity } from './math.js';
import type {ClipContacts,ContactFrame} from './contact-types.js';
import type {CharacterBodyVariant} from './body-variants.js';

export interface ProductionClip {
  family: string; sourceAction: string | null; playback: 'loop' | 'progress' | 'static';
  stepSamples?:boolean;
  contacts:ClipContacts;
  samples: { basis: number[][]; bones: number[][]; rig: number[]; props: Record<string, { matrix: number[]; visible: boolean;owner?:string }>; eyesClosed: boolean; bookVisible: boolean;contacts:ContactFrame }[];
}
export interface ClipLibrary { version: 1; sources: Record<string, { path: string; sha256: string; parts: string; virtualBones: string[] }>; clips: Record<string, ProductionClip> }
export interface ClipParts {
  version: 1; geometry: MeshDescription | null; materials: Material[]; virtualBones: string[];
  parts: { name: string; source: string; owner: 'body' | 'fixture' | 'prop'; clips: string[]; weighted: boolean;stockSlot?:number|null }[];
}

function joined<T extends Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>>(a: T, b: T): T {
  const Constructor = a.constructor as { new(length: number): T }, out = new Constructor(a.length + b.length);
  out.set(a); out.set(b, a.length); return out;
}

export interface CharacterRig {base:Geometry;manifest:Bundle;supplemental:Geometry|null;family:string;bodyVariants?:readonly CharacterBodyVariant[]}

/** Clip tracks and supplemental meshes retain the shared body without copying its arrays. */
export function prepareClipFamily(base: Geometry, supplemental: Geometry | null, parts: ClipParts, library: ClipLibrary, family: string): CharacterRig {
  if (base.manifest.bones.length !== 17 || library.version !== 1 || parts.version !== 1 || !library.sources[family]) throw new Error('Unsupported production clip family.');
  const bones: Bone[] = [...base.manifest.bones, ...parts.virtualBones.map(name => ({ name, parent: -1,
    head: [0,0,0] as [number,number,number], tail: [0,1,0] as [number,number,number], rest: identity(), inverseRest: identity() }))];
  const actions: Bundle['actions'] = {}, basisActions: Bundle['basisActions'] = {}, clipMetadata: NonNullable<Bundle['clipMetadata']> = {};
  for (const name of Object.keys(base.manifest.actions)) {
    actions[name] = base.manifest.actions[name].map(frame => [...frame, ...parts.virtualBones.map(identity)]);
    basisActions[name] = base.manifest.basisActions[name].map(frame => [...frame, ...parts.virtualBones.map(identity)]);
  }
  for (const [name, clip] of Object.entries(library.clips)) if (clip.family === family) {
    if (!clip.samples.length || clip.samples.some(sample => sample.bones.length !== 17 || sample.basis.length !== 17)) throw new Error(`Invalid clip skeleton: ${name}`);
    const propSource = parts.virtualBones.map(bone => bone.slice(`prop:${family}:`.length));
    actions[name] = clip.samples.map(sample => [...sample.bones, ...propSource.map(source => {
      const prop = sample.props[source]; if (!prop) throw new Error(`Missing prop animation: ${source}`); return prop.matrix;
    })]);
    basisActions[name] = clip.samples.map(sample => [...sample.basis, ...parts.virtualBones.map(identity)]);
    clipMetadata[name] = { family, playback: clip.playback, rigs: clip.samples.map(sample => sample.rig),contacts:clip.contacts,contactFrames:clip.samples.map(sample=>sample.contacts),
      stepSamples:clip.stepSamples,fixtureOwners:clip.samples.map(sample=>propSource.map(source=>sample.props[source].owner==='fixture')),
      visibility: clip.samples.map(sample => propSource.map(source => sample.props[source].visible)) };
  }
  const manifest: Bundle = { ...base.manifest, bones, actions, basisActions, clipMetadata,
    materials: [...base.manifest.materials, ...parts.materials] };
  if(!supplemental)return {base,manifest,supplemental:null,family};
  const vertices=supplemental.vertices.slice();
  for(let i=14;i<vertices.length;i+=16)vertices[i]+=base.manifest.materials.length;
  const extraParts=supplemental.description.parts.map(part=>{
    const definition=parts.parts.find(row=>row.name===part.name);
    if(!definition)throw new Error(`Unknown clip mesh: ${part.name}`);
    return {...part,stockSlot:definition.stockSlot??undefined,conditions:[{clip:definition.clips}]};
  });
  return {base,manifest,family,supplemental:{...supplemental,manifest,vertices,description:{...supplemental.description,parts:extraParts}}};
}

/** Compatibility path for standalone proofs requiring one contiguous mesh. */
export function combineClipFamily(base: Geometry, supplemental: Geometry | null, parts: ClipParts, library: ClipLibrary, family: string): Geometry {
  const {manifest}=prepareClipFamily(base,null,parts,library,family);
  if (!supplemental) return { ...base, manifest };
  const vertexOffset = base.description.vertexCount, cageOffset = base.description.cageCount;
  const extraVertices = supplemental.vertices.slice(), extraCage = supplemental.cage.slice();
  for (let i = 14; i < extraVertices.length; i += 16) extraVertices[i] += base.manifest.materials.length;
  const extraIndices = supplemental.indices.map(index => index + vertexOffset);
  const extraRanges = supplemental.stencilRanges.slice();
  for (let i = 0; i < extraRanges.length; i += 4) {
    extraRanges[i] += base.description.coefficientCount;
    if (extraRanges[i + 3] === 1) extraRanges[i + 2] += cageOffset;
  }
  const extraWeights = new Uint32Array(supplemental.stencilWeights.slice(0));
  for (let i = 0; i < extraWeights.length; i += 2) extraWeights[i] += cageOffset;
  const weights = joined(new Uint32Array(base.stencilWeights), extraWeights);
  const normalRanges = supplemental.normalRanges.slice();
  for (let i = 0; i < normalRanges.length; i += 2) normalRanges[i] += base.normalTriangles.length;
  const triangles = supplemental.normalTriangles.map(index => index + base.description.indexCount / 3);
  const extraParts = supplemental.description.parts.map(part => {
    const definition = parts.parts.find(row => row.name === part.name);
    if (!definition) throw new Error(`Unknown clip mesh: ${part.name}`);
    return { ...part,stockSlot:definition.stockSlot??undefined,start: part.start + base.description.indexCount, conditions: [{ clip: definition.clips }] };
  });
  const relaxedHands = new Set(['Relaxed palm','Relaxed palm.001','Resting thumb','Resting thumb.001']);
  const baseParts = base.description.parts.map(part => family === 'cleaning' && relaxedHands.has(part.name)
    ? { ...part, conditions: [{ grip: ['relaxed'] }] } : part);
  return { manifest, description: { vertexCount: vertexOffset + supplemental.description.vertexCount,
    cageCount: cageOffset + supplemental.description.cageCount, coefficientCount: weights.length / 2,
    indexCount: base.description.indexCount + supplemental.description.indexCount, parts: [...baseParts, ...extraParts] },
    vertices: joined(base.vertices, extraVertices), cage: joined(base.cage, extraCage), indices: joined(base.indices, extraIndices),
    stencilRanges: joined(base.stencilRanges, extraRanges), stencilWeights: weights.buffer,
    normalRanges: joined(base.normalRanges, normalRanges), normalTriangles: joined(base.normalTriangles, triangles) };
}
