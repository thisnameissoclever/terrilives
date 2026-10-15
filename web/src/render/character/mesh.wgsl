struct View {
  canvas: vec4f,
  settings: vec4f,
  selections: vec4f,
  colors: array<vec4f, 8>,
  offset:vec4f,
  scene:vec4f,
  world:vec4f,
  light:vec4f,
  detail:vec4f,
  fixture:vec4f,
};
struct Material {
  color: vec4f,
  ramp: array<vec4f, 4>,
  stops: vec4f,
  flags: vec4f,
};
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(2) var<storage, read> materials: array<Material>;
override outline: bool = false;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) @interpolate(flat) material: u32,
  @location(2) sum: f32,
  @location(3) @interpolate(flat) owner: u32,
  @location(4) skin:vec4f,
  @location(5) @interpolate(flat) fixture:u32,
};

@vertex fn vertex(@location(0) p: vec3f, @location(1) n: vec3f,
                 @location(2) joints: vec4f, @location(3) weights: vec4f,
                 @location(4) material: f32, @location(5) region: f32,
                 @location(6) skin:vec4f) -> VertexOut {
  var normal = n*inverseSqrt(max(dot(n,n),1e-20));
  var point = p;
  let fixture = region == 10 || region == 12 || (region == 13 && bones[u32(joints.x)][3].w > 1.5);
  if (!fixture) { point += view.offset.xyz; }
  if (outline) { point += normal * view.settings.y; }
  let c = cos(view.settings.x); let s = sin(view.settings.x);
  point = vec3f(c * point.x - s * point.y, s * point.x + c * point.y, point.z);
  normal = vec3f(c * normal.x - s * normal.y, s * normal.x + c * normal.y, normal.z);
  // The accepted camera maps model X,Y to game X,-Y.
  let xy = vec2f((point.x + point.y) * 32, -(point.x - point.y) * 21 + point.z * sqrt(1166.0));
  let screen = vec2f(view.canvas.x * 0.5 + xy.x * view.canvas.z,
                    view.canvas.y * view.canvas.w - xy.y * view.canvas.z);
  var out: VertexOut;
  out.position = vec4f(screen.x / view.canvas.x * 2 - 1, 1 - screen.y / view.canvas.y * 2,
                      0.5 - (point.x - point.y) * 0.12, 1);
  if(view.world.w>0.5){
    let placed=view.scene.zw+vec2f(xy.x,-xy.y)*view.world.x;
    out.position=vec4f(placed.x/view.scene.x*2-1,1-placed.y/view.scene.y*2,
      clamp(view.world.y-(point.x-point.y)*view.world.z,0.,1.),1.);
  }
  if (view.selections.z < 0.5) {
    if (region == 7 && view.settings.w < 0.5) { out.position = vec4f(3, 3, 0, 1); }
    if ((region == 8 && view.selections.x > 0.5) || (region == 9 && view.selections.x < 0.5)
        || (region == 10 && view.selections.y < 0.5)) { out.position = vec4f(3, 3, 0, 1); }
  }
  out.normal = normal; out.material = u32(material); out.sum = point.x - point.y;
  out.skin=skin;
  if (bones[u32(joints.x)][3].w < 0) { out.position = vec4f(3, 3, 0, 1); }
  if (fixture && view.offset.w < 0.5) { out.position = vec4f(3, 3, 0, 1); }
  out.fixture=u32(fixture);
  out.owner = u32(view.settings.z);
  if (fixture) { out.owner = select(0x80000000u + u32(view.settings.z),u32(view.fixture.x),view.world.w>0.5); }
  return out;
}

struct FragmentOut {
  @location(0) color: vec4f,
  @location(1) sum: f32,
  @location(2) identity: u32,
};

fn freckleHash(cell:vec2f)->f32{return fract(sin(dot(cell,vec2f(127.1,311.7)))*43758.5453);}
fn freckles(skin:vec4f)->f32 {
  let p=skin.xyz;
  let front=smoothstep(.045,.11,-p.y);
  let sides=1.-smoothstep(.15,.195,abs(p.x));
  let cheeks=smoothstep(1.565,1.605,p.z)*(1.-smoothstep(1.653,1.683,p.z));
  let forehead=smoothstep(1.752,1.785,p.z)*(1.-smoothstep(1.845,1.875,p.z));
  let mask=skin.w*front*sides*max(cheeks,forehead*.70);
  let uv=vec2f(p.x+.23,p.z-1.42)/.017;
  let cell=floor(uv);
  let center=.2+.6*vec2f(freckleHash(cell),freckleHash(cell+vec2f(37.,19.)));
  let radius=.16+.12*freckleHash(cell+vec2f(73.,41.));
  let distance=length(fract(uv)-center);
  let edge=max(radius*.175,fwidth(distance)*.65);
  let spot=1.-smoothstep(radius-edge,radius+edge,distance);
  let start=freckleHash(cell+vec2f(11.,83.))*.82;
  let activation=smoothstep(start,start+.18,view.detail.x);
  return mask*spot*activation;
}

@fragment fn fragment(in: VertexOut) -> FragmentOut {
  let m = materials[in.material];
  var color = m.color.rgb;
  if (m.flags.y < 0.5) {
    let normal=in.normal*inverseSqrt(max(dot(in.normal,in.normal),1e-20));
    let diffuse = clamp(dot(normal, normalize(vec3f(-0.5, -0.7, 1.5))) * 0.65 + 0.35, 0.0, 1.0);
    color = m.ramp[0].rgb;
    for (var i = 1u; i < 4u; i++) {
      var t = clamp((diffuse - m.stops[i - 1]) / max(0.00001, m.stops[i] - m.stops[i - 1]), 0.0, 1.0);
      if (m.flags.z < .5) { t = select(0.0, 1.0, diffuse >= m.stops[i]); }
      if (m.flags.z > 1.5) { t = t * t * (3 - 2 * t); }
      color = mix(color, m.ramp[i].rgb, t);
    }
  }
  color *= view.colors[u32(m.flags.x)].rgb;
  let freckle=freckles(in.skin);
  // Dark pigment follows the selected skin; a small warm floor keeps very dark skin legible.
  let pigment=color*.28+vec3f(.007,.0028,.0012);
  color=mix(color,pigment,freckle*.86);
  if (outline) { color = vec3f(0.045, 0.029, 0.02); }
  var out: FragmentOut;
  out.color = vec4f(pow(max(color, vec3f(0)), vec3f(1.0 / 2.2)), 1);
  out.sum = in.sum;
  if(view.world.w>0.5){var encoded=sceneEncoded(color);if(in.fixture!=0u){encoded=recolour(encoded,vec4f(view.fixture.yzw,0.));}
    out.color=vec4f(sceneLinear(encoded*view.light.rgb),1.);out.sum=in.position.z;}
  out.identity = in.owner;
  return out;
}
