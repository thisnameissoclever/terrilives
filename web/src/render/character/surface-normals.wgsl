@group(0) @binding(0) var<storage,read_write> vertices: array<f32>;
@group(0) @binding(1) var<storage,read> indices: array<u32>;
@group(0) @binding(2) var<storage,read> ranges: array<vec2u>;
@group(0) @binding(3) var<storage,read> triangles: array<u32>;
@group(0) @binding(4) var<storage,read> stencils: array<vec4u>;
fn point(i:u32)->vec3f{return vec3f(vertices[i*16u],vertices[i*16u+1u],vertices[i*16u+2u]);}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u) {
  if(id.x>=arrayLength(&ranges)||stencils[id.x].w==1u){return;}
  let row=ranges[id.x];let a=point(id.x);var n=vec3f(0);
  for(var k=0u;k<row.y;k++) {
    let start=triangles[row.x+k]*3u;
    var corner=0u;if(indices[start+1u]==id.x){corner=1u;}else if(indices[start+2u]==id.x){corner=2u;}
    let b=point(indices[start+(corner+1u)%3u])-a;let c=point(indices[start+(corner+2u)%3u])-a;
    if(dot(b,b)>1e-16&&dot(c,c)>1e-16) {
      let face=cross(b,c);if(dot(face,face)>1e-20){n+=normalize(face)*acos(clamp(dot(normalize(b),normalize(c)),-1.0,1.0));}
    }
  }
  n=n*inverseSqrt(max(dot(n,n),1e-20));
  vertices[id.x*16u+3u]=n.x;vertices[id.x*16u+4u]=n.y;vertices[id.x*16u+5u]=n.z;
}
