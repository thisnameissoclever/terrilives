import type { AtlasSprite } from './atlas.js';
import { ARCHITECTURE } from './architecture-data.js';
import { prepareArchitectureFinishes, type ActiveFinishes, type FinishCatalogue,
  type PatternResource } from './architecture-finishes.js';

/** Separate opt-in atlas; historical sprite records and pixels stay fixed. */
export interface ArchitectureAtlas {
  readonly color: ImageBitmap;
  readonly width: number;
  readonly height: number;
  /** IEEE 754 binary16, local game X + Y, one value per color texel. */
  readonly depth: Uint16Array<ArrayBuffer>;
  readonly sprites: readonly AtlasSprite[];
  /** Present only for full-set physical-origin instances; prototype offsets stay valid. */
  readonly registration?: Float32Array<ArrayBuffer>;
  readonly finishes?: ActiveFinishes;
  readonly carrier?: ImageBitmap;
  readonly roles?: Uint8Array<ArrayBuffer>;
  readonly patterns?: readonly ImageBitmap[];
}

export function validateArchitectureAtlas(atlas: ArchitectureAtlas): void {
  const { width, height, color, depth, sprites } = atlas;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 8192 || height > 8192 || color.width !== width || color.height !== height ||
      depth.length !== width * height || sprites.length === 0) {
    throw new Error('Architecture color, depth and dimensions must agree');
  }
  const names = new Set<string>();
  if (atlas.registration && (atlas.registration.length !== sprites.length * 4
    || !atlas.registration.every(Number.isFinite))) throw new Error('Invalid architecture registration');
  for (let index = 0; index < (atlas.registration?.length ?? 0); index += 4) {
    if (atlas.registration![index + 2] <= 0 || atlas.registration![index + 3] !== 1) {
      throw new Error('Invalid architecture registration density or mode');
    }
  }
  if (atlas.finishes?.keys.length) {
    if (!atlas.carrier || atlas.carrier.width !== width || atlas.carrier.height !== height
      || !atlas.registration || atlas.roles?.length !== width * height
      || atlas.patterns?.length !== atlas.finishes.resources.length
      || atlas.finishes.table.length !== atlas.finishes.keys.length * 8
      || !atlas.finishes.table.every(Number.isFinite)) {
      throw new Error('Architecture finish resources must agree');
    }
  }
  for (const sprite of sprites) {
    const density = sprite.pixel_density ?? 1;
    if (names.has(sprite.name) || !sprite.name || !Number.isFinite(density) || density <= 0 ||
        ![sprite.x, sprite.y, sprite.w, sprite.h].every(Number.isInteger) ||
        sprite.x < 0 || sprite.y < 0 || sprite.w <= 0 || sprite.h <= 0 ||
        sprite.x + sprite.w > width || sprite.y + sprite.h > height) {
      throw new Error('Architecture sprite rectangle or name is invalid');
    }
    names.add(sprite.name);
  }
  // Reject NaN and infinity before they reach frag_depth. Signed finite values
  // are intentional: the back half of a centered wall has negative X + Y.
  for (const bits of depth) {
    if ((bits & 0x7c00) === 0x7c00) throw new Error('Architecture depth must be finite');
  }
}

/** Direct callers and browser fixtures obey the same device boundary as the loader. */
export function validateArchitectureDevice(atlas: ArchitectureAtlas, limits: Pick<GPUDevice['limits'],
  'maxTextureDimension2D' | 'maxTextureArrayLayers' | 'maxSampledTexturesPerShaderStage' | 'maxStorageBufferBindingSize' | 'maxStorageBuffersPerShaderStage'>,
  historicalSpriteCount: number): void {
  const images = [atlas.color, ...(atlas.carrier ? [atlas.carrier] : []), ...(atlas.patterns ?? [])];
  if (images.some(image => image.width > Math.min(8192, limits.maxTextureDimension2D)
    || image.height > Math.min(8192, limits.maxTextureDimension2D))
    || (atlas.carrier ? 2 : 1) > limits.maxTextureArrayLayers) {
    throw new Error('Architecture resources exceed device dimensions or layer limits');
  }
  if ((atlas.patterns?.length ?? 0) + 4 > limits.maxSampledTexturesPerShaderStage) {
    throw new Error('Architecture resources exceed device sampled texture limits');
  }
  if (limits.maxStorageBuffersPerShaderStage < 4) {
    throw new Error('Architecture tables exceed device storage buffer counts');
  }
  if (Math.max((historicalSpriteCount + atlas.sprites.length) * 32,
    atlas.registration?.byteLength ?? 16, atlas.finishes?.table.byteLength ?? 32) > limits.maxStorageBufferBindingSize) {
    throw new Error('Architecture tables exceed device storage limits');
  }
}

export interface ArchitectureLoadOptions {
  readonly finishKeys?: readonly string[];
  readonly catalogue?: FinishCatalogue;
  readonly patternResources?: Readonly<Record<string, PatternResource>>;
  readonly baseUrl?: string;
}

/** Call before emitting rows with finish slots. The returned selection owns their indices. */
export async function loadArchitectureAtlas(limits: GPUDevice['limits'],
  options: ArchitectureLoadOptions = {}): Promise<ArchitectureAtlas> {
  const resources: Readonly<Record<string, PatternResource>> = options.patternResources ?? ARCHITECTURE.patterns;
  const finishes = prepareArchitectureFinishes(options.finishKeys ?? [], limits, options.catalogue, resources);
  const base = options.baseUrl ?? import.meta.env.BASE_URL;
  const bitmaps: ImageBitmap[] = [];
  const fetchResource = async (file: string): Promise<Response> => {
    const response = await fetch(new URL(file, new URL(base, location.href)));
    if (!response.ok) throw new Error(`Architecture resource ${file} returned ${response.status}`);
    return response;
  };
  const bitmap = async (file: string): Promise<ImageBitmap> => {
    const image = await createImageBitmap(await (await fetchResource(file)).blob(),
      { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    bitmaps.push(image);
    return image;
  };
  try {
    const color = await bitmap(ARCHITECTURE.resources.color);
    const depth = new Uint16Array(await (await fetchResource(ARCHITECTURE.resources.depth)).arrayBuffer());
    let carrier: ImageBitmap | undefined, roles: Uint8Array<ArrayBuffer> | undefined;
    const patterns: ImageBitmap[] = [];
    if (finishes.keys.length) {
      carrier = await bitmap(ARCHITECTURE.resources.carrier);
      roles = new Uint8Array(await (await fetchResource(ARCHITECTURE.resources.roles)).arrayBuffer());
      for (const key of finishes.resources) {
        const image = await bitmap(resources[key].url);
        if (image.width !== resources[key].width || image.height !== resources[key].height) {
          throw new Error(`Architecture pattern dimensions differ: ${key}`);
        }
        patterns.push(image);
      }
    }
    const registration = Float32Array.from(ARCHITECTURE.sprites.flatMap(sprite =>
      [sprite.origin[0], sprite.origin[1], sprite.pixel_density, 1]));
    const atlas: ArchitectureAtlas = { width: ARCHITECTURE.width, height: ARCHITECTURE.height,
      sprites: ARCHITECTURE.sprites, color, depth, registration, finishes, carrier, roles, patterns };
    validateArchitectureAtlas(atlas);
    return atlas;
  } catch (error) {
    for (const image of bitmaps) image.close();
    throw error;
  }
}

/** The renderer uploads synchronously during create; release decoded CPU images afterward. */
export function closeArchitectureAtlas(atlas: ArchitectureAtlas): void {
  atlas.color.close(); atlas.carrier?.close();
  for (const pattern of atlas.patterns ?? []) pattern.close();
}
