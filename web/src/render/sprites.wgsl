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
// @location(3) colourway - [RC-render] in docs/specs/2026-09-22-colourways.md:
//   x = degrees the object's hues turn
//   y = its colour strength minus one
//   z = a lightness shift
//   All zero for the art as drawn, which returns every colour unchanged.
//   w = how shaded from the sky the instance is ([OS-daylight]), 0 outdoors.
//
// Not alpha for a mechanical reason as well as a naming one: the
// fragment shader alpha-TESTS at 0.5 and writes depth, so anything
// scaling alpha would move the discard threshold and erode every sprite
// edge as the light changed.
//
// One atlas serves both layers: opaque sprites first, translucent short
// walls second. Both draws share a bind group, render pass and submission.

struct Uniforms {
  viewport: vec2<f32>,
  // Where a sprite's bottom centre sits relative to the entity's screen
  // position. Half a tile down, so a sprite bottom-anchored in the atlas
  // stands on the south corner of its tile's diamond rather than
  // floating at the diamond's centre. In UNSCALED pixels; the shader
  // multiplies by the camera scale below, so this stays half a tile at
  // every zoom.
  anchor: vec2<f32>,
  // Camera zoom in x, shared architecture camera origin in yz, padding in w.
  // The scale sits at offset 16 and `ambient` at 32.
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
  // [OS-daylight] in docs/specs/2026-09-22-the-outside.md: in x, how much of
  // the day's light a fully shaded instance loses now, the tuned interior
  // shade times the sun's strength. Zero at night and in flat light, so the
  // night's legibility floor is untouched. yzw are padding.
  sky: vec4<f32>,
};

struct Sprite {
  // u0, v0, u1, v1 in [0, 1] texture coordinates.
  uv: vec4<f32>,
  // Logical width/height; z and w hold furniture/outline indices plus one.
  // Both are zero for an ordinary straight-alpha sprite.
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
@group(0) @binding(4) var architectureDepth: texture_2d<f32>;
@group(0) @binding(5) var architectureColor: texture_2d_array<f32>;
@group(0) @binding(6) var architectureRoles: texture_2d<u32>;
struct ArchitectureRegistration { entries: array<vec4f>, };
struct ArchitectureFinish { pattern: vec4f, palette: vec4f, };
struct ArchitectureFinishes { entries: array<ArchitectureFinish>, };
@group(0) @binding(7) var<storage, read> architectureRegistration: ArchitectureRegistration;
@group(0) @binding(8) var<storage, read> architectureFinishes: ArchitectureFinishes;
// ARCHITECTURE_PATTERN_BINDINGS

// ARCHITECTURE_MODE_HELPERS_BEGIN
override maxArchitectureFinishSlot: u32;
fn isArchitecture(mode: f32) -> bool {
  // Inspect finite bits before float operations, then guard every integer cast.
  if ((bitcast<u32>(mode) & 0x7f800000u) == 0x7f800000u) { return false; }
  if (mode > -2.0 || mode < -f32(4u * maxArchitectureFinishSlot + 3u)
    || floor(mode) != mode) { return false; }
  let kind = u32(-mode) % 4u;
  return kind == 2u || kind == 3u;
}
fn isArchitectureFloor(mode: f32) -> bool {
  if (!isArchitecture(mode)) { return false; }
  return u32(-mode) % 4u == 3u;
}
fn architectureFinishSlot(mode: f32) -> u32 {
  if (!isArchitecture(mode)) { return 0u; }
  return u32(-mode) / 4u;
}
// ARCHITECTURE_MODE_HELPERS_END

struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(2) @interpolate(flat) uvBounds: vec4<f32>,
  @location(3) corner: vec2<f32>,
  @location(4) @interpolate(flat) pair: vec2<u32>,
  // Passed straight through. Every vertex of one quad carries the same
  // value, so the interpolation across the triangle is a no-op and the
  // fragment reads exactly what the instance packed.
  @location(1) tint: vec4<f32>,
  @location(5) localPixel: vec2<f32>,
  @location(6) @interpolate(flat) wall: vec4<f32>,
  @location(7) @interpolate(flat) colourway: vec4<f32>,
  @location(8) @interpolate(flat) registration: vec4f,
  @location(9) @interpolate(flat) groundOrigin: vec2f,
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
  @location(2) wall: vec4<f32>,
  @location(3) colourway: vec4<f32>,
) -> VertexOut {
  let sprite = atlas.sprites[u32(instance.w)];
  let corner = CORNERS[vi];
  let size = sprite.size.xy;

  // Bottom centre anchoring: the quad hangs upward and leftward from the
  // anchor point, so sprites of very different heights - a floor tile, a
  // toilet, a wall - all stand on the same line. Everything drawn-sized
  // scales with the camera; the instance position already did on the CPU.
  let scale = u.scale.x;
  var registration = vec4f(size.x * 0.5, size.y - u.anchor.y, 1.0, 0.0);
  if (isArchitecture(wall.x)) {
    let registered = architectureRegistration.entries[u32(instance.w - u.sky.y)];
    if (registered.w > 0.0) { registration = registered; }
  }
  let topLeft = instance.xy - registration.xy * scale;
  var screen = topLeft + corner * size * scale;
  var textureCorner = corner;
  if (isArchitectureFloor(wall.x)) {
    // A canonical world corner is computed identically by both adjacent tiles.
    // The hardware triangle fill rule owns their shared edge; independent
    // fragment predicates from separately rounded centers cannot open a seam.
    let ground = wall.zw + corner - vec2f(0.5);
    screen = u.scale.yz + vec2f((ground.x-ground.y)*32.0,
      (ground.x+ground.y)*21.0) * scale;
    textureCorner = (screen-topLeft) / (size*scale);
  }

  // Screen pixels to clip space. Y is flipped because screen space
  // grows downward and clip space grows upward.
  let clipXy = vec2f(
    screen.x / u.viewport.x * 2.0 - 1.0,
    1.0 - screen.y / u.viewport.y * 2.0,
  );

  var out: VertexOut;
  out.clip = vec4f(clipXy, instance.z, 1.0);
  out.uv = mix(sprite.uv.xy, sprite.uv.zw, textureCorner);
  out.uvBounds = sprite.uv;
  out.corner = textureCorner;
  out.pair = vec2u(sprite.size.zw);
  out.tint = tint;
  out.localPixel = u.anchor - vec2f(size.x * 0.5, size.y) + textureCorner * size;
  out.wall = wall;
  out.colourway = colourway;
  out.registration = registration;
  let groundScreen = (instance.xy - u.scale.yz) / scale;
  out.groundOrigin = vec2f((groundScreen.y / 21.0 + groundScreen.x / 32.0) * 0.5,
    (groundScreen.y / 21.0 - groundScreen.x / 32.0) * 0.5);
  return out;
}

// [RC-shift]: turns a straight-alpha colour's hue and scales its colour
// strength in OKLab, a perceptual space, and shifts its lightness. The
// atlas holds sRGB-encoded values, so the colour goes to linear light and
// back. A near-grey pixel has almost no colour to turn, so ink, metal and
// white stay as drawn while coloured materials change; lightness is kept,
// so the art's shading is too.
fn recolour(rgb: vec3<f32>, shift: vec4<f32>) -> vec3<f32> {
  if (all(shift.xyz == vec3f(0.0))) {
    return rgb;
  }
  let linear = select(pow((rgb + 0.055) / 1.055, vec3f(2.4)), rgb / 12.92, rgb <= vec3f(0.04045));
  let lms = pow(mat3x3f(
    0.4122214708, 0.2119034982, 0.0883024619,
    0.5363325363, 0.6806995451, 0.2817188376,
    0.0514459929, 0.1073969566, 0.6299787005,
  ) * linear, vec3f(1.0 / 3.0));
  let lab = mat3x3f(
    0.2104542553, 1.9779984951, 0.0259040371,
    0.7936177850, -2.4285922050, 0.7827717662,
    -0.0040720468, 0.4505937099, -0.8086757660,
  ) * lms;
  let turn = radians(shift.x);
  let ab = mat2x2f(cos(turn), sin(turn), -sin(turn), cos(turn)) * lab.yz * (1.0 + shift.y);
  let shifted = vec3f(clamp(lab.x + shift.z, 0.0, 1.0), ab);
  let lmsBack = mat3x3f(
    1.0, 1.0, 1.0,
    0.3963377774, -0.1055613458, -0.0894841775,
    0.2158037573, -0.0638541728, -1.2914855480,
  ) * shifted;
  let back = clamp(mat3x3f(
    4.0767416621, -1.2684380046, -0.0041960863,
    -3.3077115913, 2.6097574011, -0.7034186147,
    0.2309699292, -0.3413193965, 1.7076147010,
  ) * (lmsBack * lmsBack * lmsBack), vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(back, vec3f(1.0 / 2.4)) - 0.055, back * 12.92, back <= vec3f(0.0031308));
}

struct FragmentOut {
  @location(0) colour: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

// Raster contract: full walls are 76px tall; short walls pass their raster
// height in wall.w. For short walls only, wall.z is the current opacity.
// North/east project right; south/west project left. A join can expose a
// far arm ABOVE its near arm, so horizontal position alone is insufficient.
fn wallSumOffset(pixel: vec2<f32>, mask: u32, height: f32) -> f32 {
  // emit() includes the final anchor row. Recover source raster coordinates,
  // not the centre of the filtered screen pixel, before choosing its face.
  let raster = vec2f(floor(pixel.x), floor(pixel.y) + 1.0);
  let distance = abs(raster.x) / 32.0;
  let nearBit = select(4u, 2u, raster.x >= 0.0);
  let farBit = select(8u, 1u, raster.x >= 0.0);
  // The half-panel endpoint rasterizes 21/2 to 10 pixels of rise over 16
  // columns. Match that inclusive line, including its rounded outline.
  let nearTop = floor(distance * 2.0 * floor(21.0 / 2.0) + 0.5) - height;
  let nearPresent = (mask & nearBit) != 0u;
  let farPresent = (mask & farBit) != 0u;
  if (nearPresent && (!farPresent || raster.y >= nearTop)) {
    return distance;
  }
  return -distance;
}

@fragment
fn fs(in: VertexOut) -> FragmentOut {
  // Linear filtering must stay inside this sprite's edge texels. Sampling
  // the transparent atlas gutter darkens every panel seam at fractional zoom.
  let halfTexel = vec2f(0.5) / vec2f(textureDimensions(atlasTexture));
  let uv = clamp(in.uv, in.uvBounds.xy + halfTexel, in.uvBounds.zw - halfTexel);
  var colour = textureSample(atlasTexture, atlasSampler, uv);
  let architectureFloor = isArchitectureFloor(in.wall.x);
  let architecture = isArchitecture(in.wall.x);
  var architecturePixel = vec2i(0);
  if (architecture) {
    let architectureSize = vec2f(textureDimensions(architectureColor));
    let architectureUv = clamp(in.uv, in.uvBounds.xy + vec2f(0.5) / architectureSize,
      in.uvBounds.zw - vec2f(0.5) / architectureSize);
    architecturePixel = vec2i(floor(architectureUv * architectureSize));
    // Color coverage and depth have the same nearest-texel owner, including
    // antialiased and silhouette pixels. No filtered depth crosses a reveal.
    colour = textureLoad(architectureColor, architecturePixel, 0, 0);
    let finishSlot = architectureFinishSlot(in.wall.x);
    if (finishSlot > 0u) {
      let finish = architectureFinishes.entries[finishSlot - 1u];
      let role = textureLoad(architectureRoles, architecturePixel, 0).r;
      if (role == u32(finish.pattern.y)) {
        let localSum = textureLoad(architectureDepth, architecturePixel, 0).r;
        let localPixel = (vec2f(architecturePixel) + vec2f(0.5)
          - in.uvBounds.xy * architectureSize) / in.registration.z - in.registration.xy;
        let height = (21.0 * localSum - localPixel.y) / 38.0;
        var coordinates = vec2f(in.groundOrigin.x + in.groundOrigin.y + localSum, height);
        if (architectureFloor) {
          let groundScreen = (in.clip.xy - u.scale.yz) / u.scale.x;
          coordinates = vec2f((groundScreen.y / 21.0 + groundScreen.x / 32.0) * 0.5,
            (groundScreen.y / 21.0 - groundScreen.x / 32.0) * 0.5) + vec2f(0.5);
        }
        let pattern = architecturePattern(u32(finish.pattern.x), coordinates / finish.pattern.zw);
        let carrier = textureLoad(architectureColor, architecturePixel, 1, 0).rgb;
        let linear = select(pow((carrier + 0.055) / 1.055, vec3f(2.4)), carrier / 12.92,
          carrier <= vec3f(0.04045));
        let result = linear * pattern * finish.palette.rgb;
        let encoded = select(1.055 * pow(result, vec3f(1.0 / 2.4)) - 0.055,
          result * 12.92, result <= vec3f(0.0031308));
        colour = vec4f(encoded, colour.a);
      }
    }
    if (architectureFloor) {
      // The vertex stage already supplies exact physical coverage. The material
      // apron protects sampling at the silhouette without expanding geometry.
      colour.a = 1.0;
    }
  }
  if (in.pair.x > 0u) {
    let furniture = atlas.sprites[in.pair.x - 1u];
    let outline = atlas.sprites[in.pair.y - 1u];
    let furnitureUv = clamp(mix(furniture.uv.xy, furniture.uv.zw, in.corner),
      furniture.uv.xy + halfTexel, furniture.uv.zw - halfTexel);
    let outlineUv = clamp(mix(outline.uv.xy, outline.uv.zw, in.corner),
      outline.uv.xy + halfTexel, outline.uv.zw - halfTexel);
    // Explicit LOD avoids derivative-uniformity restrictions in this branch.
    // The furniture layer is premultiplied; only it takes the colourway of
    // the object the sim is using, never the sim or the ink over it.
    let layer = textureSampleLevel(atlasTexture, atlasSampler, furnitureUv, 0.0);
    var prop = layer;
    if (layer.a > 0.0 && any(in.colourway.xyz != vec3f(0.0))) {
      prop = vec4f(recolour(layer.rgb / layer.a, in.colourway) * layer.a, layer.a);
    }
    let ink = textureSampleLevel(atlasTexture, atlasSampler, outlineUv, 0.0);
    let sum = colour + prop;
    colour = ink + sum * (1.0 - ink.a);
  }
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
  if (in.pair.x > 0u) {
    colour = vec4f(colour.rgb / colour.a, colour.a);
  } else {
    // An object's own picture takes its colourway; everything else carries
    // the all-zero shift, which returns the colour unchanged.
    colour = vec4f(recolour(colour.rgb, in.colourway), colour.a);
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
  //
  // [OS-daylight]: the day's light reaches an instance only as far as the
  // sky does. Its shade rides in the colourway attribute's spare w, and a
  // lamp's lift toward white is applied after, so a lamp still lights a
  // shaded room.
  let daylight = u.ambient.rgb * (1.0 - u.sky.x * in.colourway.w);
  let lit = mix(daylight, vec3f(1.0), in.tint.w);
  var out: FragmentOut;
  out.colour = vec4f(colour.rgb * in.tint.rgb * lit, colour.a);
  out.depth = in.clip.z;
  if (architecture) {
    let localSum = textureLoad(architectureDepth, architecturePixel, 0).r;
    out.depth = clamp(in.clip.z - localSum * in.wall.y, 0.0, 1.0);
    if (!architectureFloor && in.wall.w > 0.0) { out.colour.a *= in.wall.z; }
  } else if (in.wall.x > 0.0) {
    let short = in.wall.w > 0.0;
    let height = select(76.0, in.wall.w, short);
    out.depth = clamp(in.clip.z - wallSumOffset(in.localPixel, u32(in.wall.x), height) * in.wall.y, 0.0, 1.0);
    // Coverage was tested above. Short walls blend after opaque geometry
    // without claiming depth, including when their current opacity is one.
    if (short) { out.colour.a *= in.wall.z; }
  } else if (in.wall.x < 0.0) {
    // Intersect the view column x-y=t with the centered rectangular
    // footprint. Its interval midpoint in x+y is this clamped slope.
    // Disjoint footprints and wall planes therefore retain their physical
    // ordering across a wide sprite instead of cutting it at center depth.
    // This is a 2.5D footprint proxy, not an inferred per-pixel 3D model.
    let t = (in.localPixel.x + in.wall.w) / 32.0;
    let span = in.wall.z;
    let offset = sign(span) * clamp(t, -abs(span), abs(span));
    out.depth = clamp(in.clip.z - offset * in.wall.y, 0.0, 1.0);
  }
  return out;
}
