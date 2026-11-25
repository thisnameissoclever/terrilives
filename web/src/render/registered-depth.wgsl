fn registeredFixtureDepth(sample: vec4f, allowExtendedRange: bool) -> f32 {
  // Unfiltered byte 128 denotes three tiles. Each subsequent byte adds a tile.
  let tag = round(sample.b * 255.0);
  let limit = select(2.0, 3.0 + tag - 128.0, allowExtendedRange && tag >= 128.0);
  return dot(sample.rg, vec2f(65280.0, 255.0)) / 65535.0 * (2.0 * limit) - limit;
}
