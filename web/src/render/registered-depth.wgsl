fn registeredFixtureDepth(sample: vec4f, allowExtendedRange: bool) -> f32 {
  // The high bit of blue selects the wider range for registered fixtures.
  let limit = select(2.0, 3.0, allowExtendedRange && sample.b > 0.5);
  return dot(sample.rg, vec2f(65280.0, 255.0)) / 65535.0 * (2.0 * limit) - limit;
}
