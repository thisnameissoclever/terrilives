/** Translate logical artwork coordinates without changing source pixels or filtering. */
export function atlasStorageShader(layout: {
  readonly virtualSize: number;
  readonly virtualLayers: number;
  readonly tileSize: number;
  readonly border: number;
  readonly tilesPerRow: number;
}): string {
  const {virtualSize,virtualLayers,tileSize,border,tilesPerRow}=layout;
  if (![virtualSize,virtualLayers,tileSize,border,tilesPerRow].every(value=>Number.isInteger(value)&&value>0)
    || virtualSize%tileSize!==0) throw new Error('Invalid atlas sampling layout');
  return `
const atlasVirtualSize = ${virtualSize}u;
const atlasVirtualLayers = ${virtualLayers}u;
const atlasTileSize = ${tileSize}u;
const atlasBorder = ${border}u;
const atlasTilesPerRow = ${tilesPerRow}u;
const atlasBlocksPerRow = atlasVirtualSize / atlasTileSize;
const atlasSlotsPerLayer = atlasTilesPerRow * atlasTilesPerRow;
const atlasCellSize = atlasTileSize + 2u * atlasBorder;

fn atlasSlot(block: vec2u, page: i32) -> u32 {
  return atlasLookup.entries[u32(page) * atlasBlocksPerRow * atlasBlocksPerRow
    + block.y * atlasBlocksPerRow + block.x];
}

fn atlasPhysicalCell(slot: u32) -> vec2u {
  let within = slot % atlasSlotsPerLayer;
  return vec2u(within % atlasTilesPerRow, within / atlasTilesPerRow) * atlasCellSize;
}

fn atlasLoad(pixel: vec2i, page: i32) -> vec4f {
  if (page < 0 || page >= i32(atlasVirtualLayers) || any(pixel < vec2i(0))
    || any(pixel >= vec2i(i32(atlasVirtualSize)))) { return vec4f(0.); }
  let block = vec2u(pixel) / atlasTileSize;
  let reference = atlasSlot(block, page);
  if (reference == 0u) { return vec4f(0.); }
  let slot = reference - 1u;
  let local = vec2u(pixel) % atlasTileSize;
  let physical = atlasPhysicalCell(slot) + vec2u(atlasBorder) + local;
  return textureLoad(atlasTexture, vec2i(physical), i32(slot / atlasSlotsPerLayer), 0);
}

fn atlasSample(uv: vec2f, page: i32) -> vec4f {
  if (page < 0 || page >= i32(atlasVirtualLayers)) { return vec4f(0.); }
  let size = f32(atlasVirtualSize);
  let at = clamp(uv * size, vec2f(.5), vec2f(size - .5));
  let block = vec2u(floor(at / f32(atlasTileSize)));
  let reference = atlasSlot(block, page);
  if (reference == 0u) { return vec4f(0.); }
  let slot = reference - 1u;
  let local = at - vec2f(block * atlasTileSize);
  let physical = vec2f(atlasPhysicalCell(slot) + vec2u(atlasBorder)) + local;
  return textureSampleLevel(atlasTexture, atlasSampler,
    physical / vec2f(textureDimensions(atlasTexture)), i32(slot / atlasSlotsPerLayer), 0.);
}
`;
}
