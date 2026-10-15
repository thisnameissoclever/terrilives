/** Presents a dynamically rendered image without changing the static sprite atlas. */
export function createPresenter(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, image: GPUTexture): { draw(): void } {
  const module = device.createShaderModule({ code: `
    @group(0) @binding(0) var picture: texture_2d<f32>;
    struct V { @builtin(position) position: vec4f, @location(0) uv: vec2f };
    @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
      let p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i];
      var o: V; o.position=vec4f(p,0,1); o.uv=vec2f((p.x+1)*0.5,(1-p.y)*0.5); return o;
    }
    @fragment fn fs(v: V) -> @location(0) vec4f {
      let size=textureDimensions(picture);
      let c=textureLoad(picture,vec2i(clamp(v.uv,vec2f(0),vec2f(0.999999))*vec2f(size)),0);
      return vec4f(mix(vec3f(0.09,0.09,0.11),c.rgb,c.a),1);
    }` });
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: image.createView() }] });
  return { draw() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
    device.queue.submit([encoder.finish()]);
  } };
}
