import { ARCHITECTURE } from '../render/architecture-data.js';
import { floorMaterial, relativeFloorLook } from '../render/floor-materials.js';
import type { FinishCatalogue, PatternResource } from '../render/architecture-finishes.js';

const linear = (value: number): number => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const srgb = (value: number): number => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** The renderer's OKLab transform, used only while building small UI samples. */
export function floorSwatchColour(rgb: readonly number[], shift: readonly number[]): number[] {
  if (shift[0] === 0 && shift[1] === 1 && shift[2] === 0) return [...rgb];
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const light = clamp(.2104542553 * l + .793617785 * m - .0040720468 * s + shift[2]);
  const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
  const bb = .0259040371 * l + .7827717662 * m - .808675766 * s;
  const turn = shift[0] * Math.PI / 180;
  const aa = (Math.cos(turn) * a - Math.sin(turn) * bb) * shift[1];
  const ab = (Math.sin(turn) * a + Math.cos(turn) * bb) * shift[1];
  const ll = (light + .3963377774 * aa + .2158037573 * ab) ** 3;
  const mm = (light - .1055613458 * aa - .0638541728 * ab) ** 3;
  const ss = (light - .0894841775 * aa - 1.291485548 * ab) ** 3;
  return [4.0767416621 * ll - 3.3077115913 * mm + .2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - .3413193965 * ss,
    -.0041960863 * ll - .7034186147 * mm + 1.707614701 * ss].map(value => srgb(clamp(value)));
}

/** Samples actual accepted art or the selected linear pattern/palette resource. */
export async function drawFloorSwatch(canvas: HTMLCanvasElement, covering: number,
  look?: ArrayLike<number>, catalogue: FinishCatalogue = ARCHITECTURE.catalogue,
  resources: Readonly<Record<string, PatternResource>> = ARCHITECTURE.patterns): Promise<void> {
  const material = floorMaterial(covering, 'house', 0, 0, catalogue);
  const file = material.accepted ? ARCHITECTURE.resources.color : resources[material.pattern.resource]?.url;
  if (!file) throw new Error(`Missing floor swatch resource: ${material.finishKey}`);
  const response = await fetch(new URL(file, new URL(import.meta.env.BASE_URL, location.href)));
  if (!response.ok) throw new Error(`Floor swatch returned ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Floor swatch canvas is unavailable');
    context.imageSmoothingEnabled = false;
    const { sprite } = material;
    if (material.accepted) context.drawImage(bitmap, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, canvas.width, canvas.height);
    else context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const shift = relativeFloorLook(look ?? material.authoredContentLook, material.authoredContentLook);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const rgb = [0, 1, 2].map(channel => {
        const value = pixels.data[index + channel] / 255;
        return material.accepted ? value : srgb(clamp(value * material.palette.multiply[channel]));
      });
      floorSwatchColour(rgb, shift).forEach((value, channel) => { pixels.data[index + channel] = Math.round(value * 255); });
    }
    context.putImageData(pixels, 0, 0);
  } finally { bitmap.close(); }
}
