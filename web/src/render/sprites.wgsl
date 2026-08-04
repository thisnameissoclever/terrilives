// Instanced textured-quad shader. One instance per thing on screen -
// floor tile, wall, smart object or sim - and the vertex shader expands
// each into two triangles cut from one atlas.
//
// The instance attribute layout is a contract shared with
// web/src/render/instances.ts, which packs it, with frame.ts, which
// fills it every frame, and with tiles.ts, which fills it once at load.
// Reordering the components here without reordering them there draws
// every entity at the wrong depth as the wrong sprite, silently.
//
// @location(0) instance:
//   x = screen x in pixels
//   y = screen y in pixels
//   z = depth in [0, 1]
//   w = index into the sprite table below
//
// @location(1) tint - [ML-tint]:
//   xyz = a colour every fragment of this instance is multiplied by
//   w   = EMISSIVE, and it is not alpha. How far this instance ignores
//         the time of day: 0 is fully lit by u.ambient, 1 resists it
//         completely. A lamp that dimmed as night fell would be exactly
//         backwards, and that is what this component is for.
//
// Not alpha for a mechanical reason as well as a naming one: the
// fragment shader alpha-TESTS at 0.5 and writes depth, so anything
// scaling alpha would move the discard threshold and erode every sprite
// edge as the light changed.
//
// One atlas is what keeps [D10]'s single instanced draw call: every
// sprite in the game is the same texture and the same pipeline, so the
// whole frame is one `draw`. Splitting the art across two textures would
// cost a second draw and a second submit.

struct Uniforms {
  viewport: vec2<f32>,
  // Where a sprite's bottom centre sits relative to the entity's screen
  // position. Half a tile down, so a sprite bottom-anchored in the atlas
  // stands on the south corner of its tile's diamond rather than
  // floating at the diamond's centre. In UNSCALED pixels; the shader
  // multiplies by the camera scale below, so this stays half a tile at
  // every zoom.
  anchor: vec2<f32>,
  // The camera zoom in x; yzw are padding to the 16-byte uniform
  // stride, so the scale sits at offset 16 and `ambient` at 32.
  //
  // Instance POSITIONS arrive already scaled - `screenX`/`screenY` bake
  // the zoom into the world term on the CPU, for statics and entities
  // alike - so the shader's share is the sprite's SIZE and the anchor.
  // Scaling positions here as well would zoom twice.
  scale: vec4<f32>,
  // The hour of day, as a colour every fragment is multiplied by. See
  // web/src/render/daylight.ts and [ML-ambient].
  //
  // A whole day/night cycle for one uniform and one multiply: no second
  // pass, no per-instance data, and [D10]'s one draw and one submit per
  // frame are untouched. The obvious alternative - a screen-space grade
  // over an offscreen texture - costs a second render pass and would
  // make every number in docs/gpu-verification.md need re-measuring.
  ambient: vec4<f32>,
};

struct Sprite {
  // u0, v0, u1, v1 in [0, 1] texture coordinates.
  uv: vec4<f32>,
  // Width and height in screen pixels, which are also the sprite's size
  // in texels: the atlas is drawn one texel to one pixel, so nothing is
  // minified and no mip chain is needed. z and w are padding to the
  // 16-byte uniform array stride.
  size: vec4<f32>,
};

// A RUNTIME-SIZED array in a storage buffer, not a fixed-size uniform one.
//
// The uniform version carried a hard 128-entry cap that lived in two
// files at once - here and in instances.ts - kept equal by a test that
// read this file as text. That cap was a silent failure waiting to
// happen: WGSL CLAMPS an out-of-range index rather than trapping, so the
// first sprite past the end would have drawn as the last one in the
// table with no error from anywhere, and four facings per object is
// enough to reach it.
//
// A storage buffer is sized by what is actually in it, so the cap and
// the duplicated constant are both simply gone. The cost is a storage
// binding rather than a uniform one, which on this read-only path is
// nothing: same bind group, same pipeline, same single draw call.
struct Atlas {
  sprites: array<Sprite>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> atlas: Atlas;
@group(0) @binding(2) var atlasSampler: sampler;
@group(0) @binding(3) var atlasTexture: texture_2d<f32>;

struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  // Passed straight through. Every vertex of one quad carries the same
  // value, so the interpolation across the triangle is a no-op and the
  // fragment reads exactly what the instance packed.
  @location(1) tint: vec4<f32>,
};

// Two triangles forming a unit quad with its origin at the top left. The
// length of this array must equal VERTICES_PER_QUAD in instances.ts: an
// out-of-range index in WGSL is clamped rather than trapped, so a
// mismatch degenerates triangles instead of raising anything.
const CORNERS = array<vec2<f32>, 6>(
  vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(
  @builtin(vertex_index) vi: u32,
  @location(0) instance: vec4<f32>,
  @location(1) tint: vec4<f32>,
) -> VertexOut {
  let sprite = atlas.sprites[u32(instance.w)];
  let corner = CORNERS[vi];
  let size = sprite.size.xy;

  // Bottom centre anchoring: the quad hangs upward and leftward from the
  // anchor point, so sprites of very different heights - a floor tile, a
  // toilet, a wall - all stand on the same line. Everything drawn-sized
  // scales with the camera; the instance position already did on the CPU.
  let scale = u.scale.x;
  let topLeft = instance.xy + (u.anchor - vec2f(size.x * 0.5, size.y)) * scale;
  let screen = topLeft + corner * size * scale;

  // Screen pixels to clip space. Y is flipped because screen space
  // grows downward and clip space grows upward.
  let clipXy = vec2f(
    screen.x / u.viewport.x * 2.0 - 1.0,
    1.0 - screen.y / u.viewport.y * 2.0,
  );

  var out: VertexOut;
  out.clip = vec4f(clipXy, instance.z, 1.0);
  out.uv = mix(sprite.uv.xy, sprite.uv.zw, corner);
  out.tint = tint;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let colour = textureSample(atlasTexture, atlasSampler, in.uv);
  // An alpha TEST, and it is load-bearing rather than a tidy-up.
  //
  // The pipeline writes depth, so a fragment that survives to the blend
  // stage claims its pixel for everything drawn afterwards. Without this
  // discard, every sprite's transparent bounding box would claim depth
  // too, and a bed would occlude a strip of floor and any sim behind it
  // in a rectangle nothing is drawn in. A discarded fragment writes no
  // depth, which is what makes the alpha genuinely see-through.
  //
  // 0.5 rather than 0: keeping the partially-covered edge texels means
  // they blend against whatever is behind, which is what the alpha blend
  // configured in sprites.ts is for.
  if (colour.a < 0.5) {
    discard;
  }
  // AFTER the alpha test, deliberately. Tinting before it would scale
  // alpha along with the colour and make the discard threshold move with
  // the time of day, so sprite edges would erode as night fell.
  //
  // The instance's emissive lifts THIS instance's share of the ambient
  // back toward white, so a lamp at midnight keeps its own colour while
  // the wall behind it goes blue. One `mix` and one multiply, on
  // per-instance data the vertex stage already carries: no second pass,
  // no second pipeline, and [D10]'s one draw and one submit per frame
  // are untouched.
  let lit = mix(u.ambient.rgb, vec3f(1.0), in.tint.w);
  return vec4f(colour.rgb * in.tint.rgb * lit, colour.a);
}
