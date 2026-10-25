import { ATLAS_STORAGE } from './atlas-storage-metadata.js';
import { ATLAS_WIDTH, ATLAS_HEIGHT, ATLAS_PAGE_FILES, RIGGED_SIM_VARIANTS, SPRITES, SURFACE_LAYOUTS } from './atlas.js';
import { FIXTURE_ATLAS_PAGES } from './fixture-depth.js';
import { type BodyCoverage, installPackedBodyCoverage, validatePackedBodyCoverage } from './body-coverage.js';
import { setDishCoverage } from './dish-coverage.js';
import { installIndicatorCoverage, validateIndicatorCoverage } from './indicator-coverage.js';
import { SPRITE_STORAGE_BUFFER_COUNT } from './sprite-resource-limits.js';
import { countResponseBytes, type LoadProgress } from '../load-progress.js';
import { isGzip, unpackedBytes } from './gzip-file.js';

interface Binary { readonly file: string; readonly length: number; readonly sha256: string }
type Span = readonly [number, number];
export interface AtlasStorageManifest {
  readonly version: number; readonly virtualSize: number; readonly virtualLayers: number;
  readonly tileSize: number; readonly border: number; readonly physicalSize: number;
  readonly tilesPerRow: number; readonly uniqueTiles: number;
  readonly originalAtlasPages: readonly string[];
  readonly companions: readonly {folder: string; path: string; width: number; height: number; sha256: string}[];
  readonly sources: readonly {file: string; width: number; height: number; sha256: string}[];
  readonly pages: readonly {file: string; sha256: string}[];
  readonly lookup: Binary;
  readonly coverage: Binary & {
    readonly bodies: readonly {sprite: number; opaque: Span; partialPixels: Span; partialAlpha: Span}[];
    readonly dishes: readonly {sprite: number; alpha: Span}[];
    readonly indicators: readonly {sprite: number; bottomPixels: number}[];
  };
}
interface CoveragePacket {
  bodies: {sprite: number; mask: BodyCoverage}[];
  dishes: {sprite: number; alpha: Uint8Array}[];
  indicators: {sprite: number; bottomPixels: number}[];
}
const SHA256 = /^[a-f0-9]{64}$/;
// This source has a fixed filename; keep its independent receipt pinned and checked against disk in tests.
const GRIME_SHA256 = '9af5875db07be05d7b5999007483a120ab7c21f69e85367ff7e22d9c01e85a1f';
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
function requireValid(ok: boolean, message: string): asserts ok { if (!ok) throw new Error(message); }

/** Validate layout and source registrations before downloading or creating graphics resources. */
export function validateAtlasStorage(m: AtlasStorageManifest, device: GPUDevice): void {
  requireValid(m.version === 1 && m.virtualSize === 2048 && ATLAS_WIDTH === m.virtualSize
    && ATLAS_HEIGHT === m.virtualSize && m.tileSize === 8 && m.border === 1
    && m.physicalSize === 2048 && m.tilesPerRow === 204, 'Atlas storage layout is invalid');
  requireValid(m.originalAtlasPages.length === ATLAS_PAGE_FILES.length
    && m.originalAtlasPages.every((file,i) => file === ATLAS_PAGE_FILES[i]), 'Atlas source catalogue is stale');
  requireValid(m.companions.length === FIXTURE_ATLAS_PAGES.length && m.companions.every((row,i) => {
    const expected = FIXTURE_ATLAS_PAGES[i];
    return row.folder === expected.folder && row.path === expected.path && row.width === expected.width
      && row.height === expected.height && row.sha256 === expected.sha256;
  }), 'Atlas companion source catalogue is stale');
  const sources = [
    ...ATLAS_PAGE_FILES.map(file => ({file: `web/public/${file}`, width: ATLAS_WIDTH, height: ATLAS_HEIGHT,
      sha256: /^atlas-([a-f0-9]{64})\.png$/.exec(file)?.[1]})),
    {file: 'web/public/grime/household-stains.png', width: 1536, height: 1024, sha256: GRIME_SHA256},
    ...FIXTURE_ATLAS_PAGES.map(row => ({file: `assets/models/sims/character-repair/${row.folder}/${row.path}`,
      width: row.width, height: row.height, sha256: row.sha256})),
  ];
  requireValid(m.virtualLayers === sources.length && m.sources.length === sources.length
    && m.sources.every((row,i) => row.file === sources[i].file && row.width === sources[i].width
      && row.height === sources[i].height && row.sha256 === sources[i].sha256), 'Atlas source catalogue is stale');
  const capacity = m.tilesPerRow ** 2;
  requireValid(integer(m.uniqueTiles) && m.uniqueTiles > 0 && m.pages.length === Math.ceil(m.uniqueTiles / capacity)
    && m.uniqueTiles <= m.virtualLayers * 256 ** 2, 'Atlas physical layout capacity is invalid');
  requireValid(m.pages.every(row => SHA256.test(row.sha256)
    && row.file === `atlas-storage/page-${row.sha256}.png`), 'Atlas physical page identity is invalid');
  for (const [kind, row] of [['lookup', m.lookup], ['coverage', m.coverage]] as const) {
    requireValid(integer(row.length) && row.length >= 4 && SHA256.test(row.sha256)
      && new RegExp(`^atlas-storage/${kind}-[a-f0-9]{64}\\.bin\\.gz$`).test(row.file), 'Atlas payload descriptor is invalid');
  }
  const lookupSize = m.virtualLayers * 256 ** 2 * 4;
  requireValid(m.lookup.length === lookupSize + 4, 'Atlas lookup length is invalid');
  requireValid(m.pages.length * m.physicalSize ** 2 * 4 + lookupSize < 384 * 1024 ** 2, 'Atlas storage budget exceeded');
  requireValid(m.physicalSize <= device.limits.maxTextureDimension2D,
    `Atlas exceeds texture dimension limit ${device.limits.maxTextureDimension2D}`);
  requireValid(m.pages.length <= device.limits.maxTextureArrayLayers,
    `Atlas exceeds texture array layer limit ${device.limits.maxTextureArrayLayers}`);
  requireValid(lookupSize <= device.limits.maxStorageBufferBindingSize && lookupSize <= device.limits.maxBufferSize,
    'Atlas lookup exceeds storage buffer size limit');
  requireValid(device.limits.maxStorageBuffersPerShaderStage >= SPRITE_STORAGE_BUFFER_COUNT,
    'Atlas exceeds storage buffer binding limit');
}
async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
}
async function validateBinary(bytes: Uint8Array<ArrayBuffer>, row: Binary, magic: string): Promise<void> {
  requireValid(bytes.length === row.length, 'Atlas payload length differs from its descriptor');
  requireValid(await hash(bytes) === row.sha256, 'Atlas payload hash differs from its descriptor');
  requireValid(bytes[0] === magic.charCodeAt(0) && bytes[1] === magic.charCodeAt(1)
    && bytes[2] === magic.charCodeAt(2) && bytes[3] === magic.charCodeAt(3), 'Atlas payload header is invalid');
}
export async function decodeAtlasLookup(bytes: Uint8Array<ArrayBuffer>, m: AtlasStorageManifest): Promise<Uint32Array<ArrayBuffer>> {
  await validateBinary(bytes, m.lookup, 'ATL1');
  requireValid(bytes.length === 4 + m.virtualLayers * 256 ** 2 * 4, 'Atlas lookup length is invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Uint32Array((bytes.length - 4) / 4);
  for (let i = 0; i < entries.length; i++) {
    const value = view.getUint32(4 + i * 4, true);
    requireValid(value <= m.uniqueTiles, 'Atlas lookup references an invalid physical slot');
    entries[i] = value;
  }
  return entries;
}
function span(bytes: Uint8Array<ArrayBuffer>, range: Span, unit = 1): Uint8Array<ArrayBuffer> {
  const [offset, count] = range;
  requireValid(integer(offset) && integer(count) && offset >= 4 && (unit !== 4 || offset % 4 === 0)
    && count <= Math.floor((bytes.length - offset) / unit), 'Atlas coverage span is invalid');
  return bytes.subarray(offset, offset + count * unit);
}
function complete(records: readonly {sprite: number}[], expected: Set<number>): void {
  requireValid(records.length === expected.size, 'Atlas coverage catalogue is incomplete');
  const seen = new Set<number>();
  for (const row of records) {
    requireValid(expected.has(row.sprite) && !seen.has(row.sprite), 'Atlas coverage sprite is missing, duplicated or unexpected');
    seen.add(row.sprite);
  }
}
/** Validate every record before returning any views that can be installed. */
export async function decodeAtlasCoverage(bytes: Uint8Array<ArrayBuffer>, m: AtlasStorageManifest): Promise<CoveragePacket> {
  await validateBinary(bytes, m.coverage, 'ACV1');
  const bodies = new Set<number>(), dishes = new Set<number>();
  for (const variant of Object.values(RIGGED_SIM_VARIANTS)) for (const clip of Object.values(variant)) {
    for (const facing of clip.frames) for (const sprite of facing) bodies.add(sprite);
  }
  for (const layout of Object.values(SURFACE_LAYOUTS)) if (layout.kind !== 'stove') {
    for (const sprite of layout.props.slice(0,4)) dishes.add(sprite);
  }
  const indicators = new Set(SPRITES.flatMap((row,i) => /^(activity|conversation)/.test(row.name) ? [i] : []));
  complete(m.coverage.bodies,bodies); complete(m.coverage.dishes,dishes); complete(m.coverage.indicators,indicators);
  return {
    bodies: m.coverage.bodies.map(row => {
      const raw = span(bytes,row.partialPixels,4), view = new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
      const partialPixels = new Uint32Array(row.partialPixels[1]);
      for (let i = 0; i < partialPixels.length; i++) partialPixels[i] = view.getUint32(i*4,true);
      const mask = {opaque:span(bytes,row.opaque),partialPixels,partialAlpha:span(bytes,row.partialAlpha)};
      validatePackedBodyCoverage(row.sprite,mask);
      return {sprite:row.sprite,mask};
    }),
    dishes: m.coverage.dishes.map(row => {
      const alpha = span(bytes,row.alpha), rect = SPRITES[row.sprite];
      requireValid(alpha.length === rect.w * rect.h,'Atlas dish coverage length is invalid');
      return {sprite:row.sprite,alpha};
    }),
    indicators: m.coverage.indicators.map(row => {
      validateIndicatorCoverage(row.sprite,row.bottomPixels); return {...row};
    }),
  };
}
async function download(file: string, progress?: LoadProgress, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(`${import.meta.env.BASE_URL}${file}`, {signal});
  if (!response.ok) throw new Error(`Atlas resource ${file} returned ${response.status}`);
  return new Uint8Array(await countResponseBytes(response, progress?.bytes).arrayBuffer());
}
async function binary(row: Binary, progress?: LoadProgress): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = await download(row.file,progress);
  if (isGzip(encoded)) {
    const expected = /-([a-f0-9]{64})\.bin\.gz$/.exec(row.file)![1];
    requireValid(await hash(encoded) === expected,'Atlas compressed payload hash differs from its filename');
  }
  return unpackedBytes(encoded,row.length,'Atlas payload');
}
let installedCoverage: CoveragePacket | undefined;

/** Load bounded physical artwork and publish CPU masks only after every upload succeeds. */
export async function loadAtlasStorage(device: GPUDevice, progress?: LoadProgress): Promise<{texture: GPUTexture; lookup: GPUBuffer}> {
  const m: AtlasStorageManifest = ATLAS_STORAGE;
  validateAtlasStorage(m,device);
  let done = 0;
  const total = m.pages.length + 2, advance = () => progress?.files?.(++done,total);
  progress?.files?.(0,total);
  const entries = await decodeAtlasLookup(await binary(m.lookup,progress),m); advance();
  const packet = installedCoverage ?? await decodeAtlasCoverage(await binary(m.coverage,progress),m); advance();
  let texture: GPUTexture | undefined, lookup: GPUBuffer | undefined;
  const abort = new AbortController();
  // Convert rejected prefetches into values immediately so later pages cannot reject unobserved.
  type Download = {bytes: Uint8Array<ArrayBuffer>} | {error: unknown};
  const pending = new Map<number,Promise<Download>>();
  const prefetch = (index: number) => pending.set(index, download(m.pages[index].file,progress,abort.signal)
    .then(bytes => ({bytes}), error => ({error})));
  let scopes = 0;
  const closeScopes = async (): Promise<void> => {
    const errors: GPUError[] = [];
    while (scopes > 0) {
      scopes--;
      const error = await device.popErrorScope();
      if (error) errors.push(error);
    }
    if (errors.length) throw new Error(`Atlas graphics upload failed: ${errors.map(error => error.message).join('; ')}`);
  };
  try {
    device.pushErrorScope('out-of-memory'); scopes++;
    device.pushErrorScope('validation'); scopes++;
    texture = device.createTexture({label:'Sparse artwork atlas',size:[m.physicalSize,m.physicalSize,m.pages.length],
      format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    lookup = device.createBuffer({label:'Artwork virtual block lookup',size:entries.byteLength,
      usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(lookup,0,entries);
    for (let i = 0; i < Math.min(4,m.pages.length); i++) prefetch(i);
    for (let layer = 0; layer < m.pages.length; layer++) {
      const result = await pending.get(layer)!; pending.delete(layer);
      if ('error' in result) throw result.error;
      requireValid(await hash(result.bytes) === m.pages[layer].sha256,'Atlas physical page hash differs from its descriptor');
      const bitmap = await createImageBitmap(new Blob([result.bytes],{type:'image/png'}),
        {premultiplyAlpha:'none',colorSpaceConversion:'none'});
      try {
        requireValid(bitmap.width === m.physicalSize && bitmap.height === m.physicalSize,'Atlas physical page dimensions are invalid');
        device.queue.copyExternalImageToTexture({source:bitmap},{texture,origin:[0,0,layer]},
          {width:m.physicalSize,height:m.physicalSize});
        await device.queue.onSubmittedWorkDone();
      } finally { bitmap.close(); }
      advance();
      if (layer + 4 < m.pages.length) prefetch(layer+4);
    }
    await closeScopes();
    if (!installedCoverage) {
      for (const row of packet.bodies) installPackedBodyCoverage(row.sprite,row.mask);
      for (const row of packet.dishes) setDishCoverage(row.sprite,row.alpha);
      for (const row of packet.indicators) installIndicatorCoverage(row.sprite,row.bottomPixels);
      installedCoverage = packet;
    }
    return {texture,lookup};
  } catch (error) {
    texture?.destroy(); lookup?.destroy();
    // Drain scopes after a synchronous failure while preserving its original error.
    try { await closeScopes(); } catch { /* The primary failure already describes this unsuccessful load. */ }
    throw error;
  } finally {
    abort.abort(); pending.clear();
  }
}
