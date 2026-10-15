import {sceneColorFunctions} from './scene-sampling.js';

export const sceneResolveShaderSource=`${sceneColorFunctions}
   @group(0) @binding(0) var picture:texture_2d<f32>;
   @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
    return vec4f(array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i],0,1);
   }
   @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f{
    let at=vec2i(p.xy)*2;var color=vec4f(0);
    for(var y=0;y<2;y++){for(var x=0;x<2;x++){color+=textureLoad(picture,at+vec2i(x,y),0)*.25;}}
    return vec4f(sceneEncoded(color.rgb),color.a);
   }`;
export function sceneResolvePipelineDescriptor(module:GPUShaderModule,format:GPUTextureFormat):GPURenderPipelineDescriptor {return {layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}};}
