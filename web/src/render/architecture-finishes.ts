import { ARCHITECTURE } from './architecture-data.js';
import { MAX_ARCHITECTURE_FINISH_SLOT } from './instances.js';

export interface FinishCatalogue {
  readonly patterns: Readonly<Record<string, { readonly role: 'wall' | 'floor';
    readonly period: readonly number[]; readonly resource: string }>>;
  readonly palettes: Readonly<Record<string, { readonly multiply: readonly number[] }>>;
  readonly finishes: Readonly<Record<string, { readonly patternKey: string; readonly paletteKey: string;
    readonly authoredContentLook?: readonly number[] }>>;
  readonly coverings: Readonly<Record<string, string>>;
}
export interface PatternResource { readonly url: string; readonly width: number; readonly height: number }
export interface ActiveFinishes {
  /** Slot zero uses accepted pixels; active finishes are one-based. */
  readonly keys: readonly string[];
  readonly resources: readonly string[];
  /** Two vec4s: pattern slot/role/period, followed by linear palette RGB/padding. */
  readonly table: Float32Array<ArrayBuffer>;
  readonly residentBytes: number;
}

/** Select first, then load. Catalogue growth never implies texture residency. */
export function prepareArchitectureFinishes(keys: readonly string[],
  limits: { maxSampledTexturesPerShaderStage: number; maxTextureDimension2D: number;
    maxTextureArrayLayers: number; maxStorageBufferBindingSize: number },
  catalogue: FinishCatalogue = ARCHITECTURE.catalogue,
  resources: Readonly<Record<string, PatternResource>> = ARCHITECTURE.patterns,
): ActiveFinishes {
  const unique = [...new Set(keys)];
  if (unique.length > MAX_ARCHITECTURE_FINISH_SLOT || Math.max(1, unique.length) * 32 > limits.maxStorageBufferBindingSize) {
    throw new Error('Active finish table exceeds device storage limits');
  }
  if (limits.maxTextureDimension2D < Math.max(ARCHITECTURE.width, ARCHITECTURE.height)
    || limits.maxTextureArrayLayers < (unique.length ? 2 : 1)) {
    throw new Error('Architecture textures exceed device dimensions or layer limits');
  }
  const activeResources: string[] = [];
  const table = new Float32Array(Math.max(1, unique.length) * 8);
  unique.forEach((key, index) => {
    const finish = catalogue.finishes[key];
    const pattern = finish && catalogue.patterns[finish.patternKey];
    const palette = finish && catalogue.palettes[finish.paletteKey];
    if (!pattern || !palette) throw new Error(`Unknown architecture finish: ${key}`);
    const resource = resources[pattern.resource];
    if (!resource || !resource.url || ![resource.width, resource.height].every(value =>
      Number.isInteger(value) && value > 0 && value <= limits.maxTextureDimension2D)) {
      throw new Error(`Invalid architecture pattern resource: ${pattern.resource}`);
    }
    if (!['wall', 'floor'].includes(pattern.role) || pattern.period.length !== 2
      || !pattern.period.every(value => Number.isFinite(value) && value > 0)
      || palette.multiply.length !== 3 || !palette.multiply.every(value => Number.isFinite(value) && value >= 0)) {
      throw new Error(`Invalid architecture finish parameters: ${key}`);
    }
    if (!activeResources.includes(pattern.resource)) activeResources.push(pattern.resource);
    table.set([activeResources.indexOf(pattern.resource), pattern.role === 'wall' ? 1 : 2,
      ...pattern.period, ...palette.multiply, 0], index * 8);
  });
  if (activeResources.length > Math.min(12, limits.maxSampledTexturesPerShaderStage - 4)) {
    throw new Error('Active architecture patterns exceed device sampled texture limits');
  }
  const pixels = ARCHITECTURE.width * ARCHITECTURE.height;
  const residentBytes = pixels * (unique.length ? 11 : 6)
    + activeResources.reduce((sum, key) => sum + resources[key].width * resources[key].height * 4, 0);
  if (residentBytes > 128 * 1024 * 1024) throw new Error('Architecture textures exceed the resident memory budget');
  return { keys: unique, resources: activeResources, table, residentBytes };
}

export function architectureFinishSlot(active: ActiveFinishes, key: string): number {
  const index = active.keys.indexOf(key);
  if (index < 0) throw new Error(`Architecture finish was not prepared: ${key}`);
  return index + 1;
}

/** The resource switch is generated per resident texture, never per finish. */
export function architecturePatternShader(count: number): string {
  if (!Number.isInteger(count) || count < 0 || count > 12) throw new Error('Invalid pattern binding count');
  const declarations = Array.from({ length: count }, (_, index) =>
    `@group(0) @binding(${11 + index}) var architecturePattern${index}: texture_2d<f32>;`).join('\n');
  const cases = Array.from({ length: count }, (_, index) =>
    `case ${index}u: { let size = textureDimensions(architecturePattern${index});
      return textureLoad(architecturePattern${index}, vec2i(fract(uv) * vec2f(size)), 0).rgb; }`).join('\n');
  return `${declarations}\nfn architecturePattern(slot: u32, uv: vec2f) -> vec3f {\n switch slot {\n${cases}\n default: { return vec3f(1.0); }\n }\n}`;
}

/** Registered texel centers retain the same physical coordinate after a crop. */
export function architectureLocalPoint(px: number, py: number, origin: readonly number[], density: number,
  localSum: number): readonly [number, number, number] {
  const sx = (px + .5) / density - origin[0], sy = (py + .5) / density - origin[1];
  return [(localSum + sx / 32) / 2, (localSum - sx / 32) / 2, (21 * localSum - sy) / 38];
}
