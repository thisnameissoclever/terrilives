struct Posed { point: vec4f, normal: vec4f };
@group(0) @binding(0) var<storage,read> cage: array<f32>;
@group(0) @binding(1) var<storage,read_write> posed: array<Posed>;
@group(0) @binding(2) var<storage,read> bones: array<mat4x4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if(id.x>=arrayLength(&posed)){return;}
  let base=id.x*16u;
  let p=vec4f(cage[base],cage[base+1u],cage[base+2u],1);
  let n=vec4f(cage[base+3u],cage[base+4u],cage[base+5u],0);
  if(cage[base+15u]==10){posed[id.x].point=p;posed[id.x].normal=n;return;}
  var position=vec4f(0);var normal=vec4f(0);
  for(var i=0u;i<4u;i++) {
    let joint=u32(cage[base+6u+i]);let matrix=bones[joint];let weight=cage[base+10u+i];
    position+=matrix*p*weight;
    if (joint >= 17u) {
      let a=matrix[0].xyz;let b=matrix[1].xyz;let c=matrix[2].xyz;
      let cofactors=mat3x3f(cross(b,c),cross(c,a),cross(a,b));
      normal+=vec4f(cofactors*n.xyz/dot(a,cross(b,c)),0)*weight;
    } else { normal+=matrix*n*weight; }
  }
  posed[id.x].point=position;posed[id.x].normal=vec4f(normal.xyz*inverseSqrt(max(dot(normal.xyz,normal.xyz),1e-20)),0);
}
