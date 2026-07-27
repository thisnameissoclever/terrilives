// Instanced quad shader. One instance per entity; the vertex shader
// expands each instance into two triangles.
//
// The instance attribute layout is a contract shared with
// web/src/render/instances.ts, which packs it, and with frame.ts, which
// fills it. Reordering the components here without reordering them there
// draws every entity at the wrong depth in the wrong colour, silently.
//   x = screen x in pixels
//   y = screen y in pixels
//   z = depth in [0, 1]
//   w = kind

struct Uniforms {
  viewport: vec2<f32>,
  tileSize: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec3<f32>,
};

// Two triangles forming a unit quad centred on the origin. The length of
// this array must equal VERTICES_PER_QUAD in instances.ts: an out-of-range
// index in WGSL is clamped rather than trapped, so a mismatch degenerates
// triangles instead of raising anything.
const CORNERS = array<vec2<f32>, 6>(
  vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
  vec2f(-0.5,  0.5), vec2f(0.5, -0.5), vec2f( 0.5, 0.5),
);

@vertex
fn vs(
  @builtin(vertex_index) vi: u32,
  @location(0) instance: vec4<f32>,
) -> VertexOut {
  let corner = CORNERS[vi] * u.tileSize;
  let screen = instance.xy + corner;

  // Screen pixels to clip space. Y is flipped because screen space
  // grows downward and clip space grows upward.
  let clipXy = vec2f(
    screen.x / u.viewport.x * 2.0 - 1.0,
    1.0 - screen.y / u.viewport.y * 2.0,
  );

  var out: VertexOut;
  out.clip = vec4f(clipXy, instance.z, 1.0);
  // kind 0 = agent (warm), kind 1 = smart object (cool).
  out.color = select(vec3f(0.95, 0.55, 0.35), vec3f(0.35, 0.65, 0.85), instance.w > 0.5);
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4f(in.color, 1.0);
}
