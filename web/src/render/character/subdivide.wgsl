struct Posed { point: vec4f, normal: vec4f };
struct Coefficient { source: u32, weight: f32 };
@group(0) @binding(0) var<storage,read> cage: array<Posed>;
@group(0) @binding(1) var<storage,read> ranges: array<vec4u>;
@group(0) @binding(2) var<storage,read> coefficients: array<Coefficient>;
@group(0) @binding(3) var<storage,read_write> vertices: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if(id.x>=arrayLength(&ranges)){return;}
  let row=ranges[id.x];var p=vec3f(0);
  for(var i=0u;i<row.y;i++) {
    let coefficient=coefficients[row.x+i];p+=cage[coefficient.source].point.xyz*coefficient.weight;
  }
  let base=id.x*16u;vertices[base]=p.x;vertices[base+1u]=p.y;vertices[base+2u]=p.z;
  if(row.w==1u){let n=cage[row.z].normal.xyz;vertices[base+3u]=n.x;vertices[base+4u]=n.y;vertices[base+5u]=n.z;}
}
