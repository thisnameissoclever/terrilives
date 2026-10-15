import {colourwayShader} from './shared-colourway.js';
import {SCENE_COLOR_FORMAT,SCENE_IDENTITY_FORMAT,SCENE_SURFACE_FORMAT,sceneColorFunctions} from '../scene-sampling.js';
import meshSource from './mesh.wgsl?raw';
import skinSource from './skin-cage.wgsl?raw';
import subdivisionSource from './subdivide.wgsl?raw';
import normalSource from './surface-normals.wgsl?raw';

export const characterShaderSource=sceneColorFunctions+colourwayShader+meshSource;
export function characterBindGroupLayoutEntries():GPUBindGroupLayoutEntry[] {return [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ];}
export function characterPipelineDescriptor(module:GPUShaderModule,layout:GPUPipelineLayout,outline:boolean,scene=false):GPURenderPipelineDescriptor {return {
      layout: layout,
      vertex: { module, entryPoint: 'vertex', constants: { outline: Number(outline) }, buffers: [{ arrayStride: 64, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x4' },
        { shaderLocation: 3, offset: 40, format: 'float32x4' },
        { shaderLocation: 4, offset: 56, format: 'float32' },
        { shaderLocation: 5, offset: 60, format: 'float32' },
      ] },{arrayStride:16,attributes:[{shaderLocation:6,offset:0,format:'float32x4'}]}] },
      fragment: { module, entryPoint: 'fragment', constants: { outline: Number(outline) }, targets: [
        { format: scene?SCENE_COLOR_FORMAT:'rgba8unorm' }, { format: 'r32float' }, { format: 'r32uint' },
      ] },
      primitive: { topology: 'triangle-list', cullMode: outline ? 'front' : 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    };}

export const subdivisionShaderSources={skin:skinSource,subdivision:subdivisionSource,normals:normalSource};
export function subdivisionPipelineDescriptor(module:GPUShaderModule):GPUComputePipelineDescriptor {
  return {layout:'auto',compute:{module,entryPoint:'main'}};
}

export const compositorShaderSource=`
      ${colourwayShader}
      ${sceneColorFunctions}
      struct View { rect: vec4f, viewport: vec4f, light:vec4f, colourway:vec4f };
      @group(0) @binding(0) var<uniform> view: View;
      @group(0) @binding(1) var picture: texture_2d<f32>;
      @group(0) @binding(2) var surface: texture_2d<f32>;
      @group(0) @binding(3) var identity: texture_2d<u32>;
      struct V { @builtin(position) position: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
        let corner=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1))[i];
        let screen=view.rect.xy+corner*view.rect.zw;
        var o:V; o.position=vec4f(screen.x/view.viewport.x*2-1,1-screen.y/view.viewport.y*2,0,1); o.uv=corner; return o;
      }
      struct F { @location(0) color:vec4f, @location(1) surface:f32, @location(2) identity:u32, @builtin(frag_depth) depth:f32 };
      @fragment fn fs(v:V)->F {
        let pixel=vec2i(clamp(v.uv,vec2f(0),vec2f(.999999))*vec2f(textureDimensions(picture)));
        let color=textureLoad(picture,pixel,0); if(!sceneCovered(color.a,v.position.xy)){discard;}
        var rgb=color.rgb;
        if(textureLoad(identity,pixel,0).r>=0x80000000u){rgb=recolour(rgb,view.colourway);}
        var o:F; o.color=vec4f(sceneLinear(rgb*view.light.rgb),1.);
        o.depth=clamp(view.viewport.z-textureLoad(surface,pixel,0).r*view.viewport.w,0.0,1.0); o.surface=o.depth;o.identity=textureLoad(identity,pixel,0).r;return o;
      }`;
export function compositorPipelineDescriptor(module:GPUShaderModule):GPURenderPipelineDescriptor {return { layout: 'auto', vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{format:SCENE_COLOR_FORMAT},{format:'r32float'},{format:'r32uint'}] }, primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } };}

export const worldPickingShaderSource=`
      struct View { rect:vec4f, viewport:vec4f, point:vec4f };
      @group(0) @binding(0) var<uniform> view:View;
      @group(0) @binding(1) var identity:texture_2d<u32>;
      @group(0) @binding(2) var surface:texture_2d<f32>;
      @group(0) @binding(3) var world:texture_depth_2d;
      @group(0) @binding(4) var<storage,read_write> result:array<u32>;
      @compute @workgroup_size(1) fn main(){
        result[0]=0u;
        let ratio=vec2f(textureDimensions(world))/view.viewport.xy;
        let first=vec2i(view.point.xy*ratio);var nearest=1.;
        for(var y=0;y<i32(ratio.y);y++){for(var x=0;x<i32(ratio.x);x++){
          let sample=first+vec2i(x,y);let logical=(vec2f(sample)+.5)/ratio;
          let uv=(logical-view.rect.xy)/view.rect.zw;
          if(any(uv<vec2f(0))||any(uv>=vec2f(1))){continue;}
          let texel=vec2i(uv*vec2f(textureDimensions(identity)));
          let id=textureLoad(identity,texel,0).r;if(id==0u){continue;}
          let depth=clamp(view.viewport.z-textureLoad(surface,texel,0).r*view.viewport.w,0.0,1.0);
          let visible=textureLoad(world,sample,0);
          if(depth<=visible+0.00000012&&depth<nearest){result[0]=id;nearest=depth;}
        }}
      }`;
export function worldPickingPipelineDescriptor(module:GPUShaderModule):GPUComputePipelineDescriptor {return {layout:'auto',compute:{module,entryPoint:'main'}};}

export const previewFixtureShaderSource=`${sceneColorFunctions}
struct View { scene:vec4f, rectangle:vec4f, settings:vec4f };
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var picture:texture_2d_array<f32>;
@group(0) @binding(2) var surface:texture_2d_array<f32>;
struct Vertex { @builtin(position) position:vec4f, @location(0) corner:vec2f };
@vertex fn vertex(@builtin(vertex_index) index:u32)->Vertex {
 let corner=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1))[index];
 let pixel=view.scene.zw+corner*view.rectangle.xy-view.rectangle.zw;
 var out:Vertex;out.position=vec4f(pixel.x/view.scene.x*2.-1.,1.-pixel.y/view.scene.y*2.,0.,1.);out.corner=corner;return out;
}
struct Fragment { @location(0) color:vec4f, @location(1) surface:f32, @location(2) identity:u32, @builtin(frag_depth) depth:f32 };
@fragment fn fragment(in:Vertex)->Fragment {
 let size=vec2i(textureDimensions(picture));
 let pixel=clamp(vec2i(in.corner*vec2f(size)),vec2i(0),size-vec2i(1));
 let color=textureLoad(picture,pixel,i32(view.settings.x),0);
 if(!sceneCovered(color.a,in.position.xy)){discard;}
 let sample=textureLoad(surface,pixel,i32(view.settings.x),0);
 let sum=dot(sample.rg,vec2f(65280.,255.))/65535.*4.-2.;
 let depth=clamp(view.settings.y-sum*view.settings.z,0.,1.);
 var out:Fragment;out.color=vec4f(sceneLinear(color.rgb),1.);out.surface=depth;out.identity=u32(view.settings.w);out.depth=depth;return out;
}`;
export function previewFixturePipelineDescriptor(module:GPUShaderModule):GPURenderPipelineDescriptor {return {layout:'auto',vertex:{module,entryPoint:'vertex'},
      fragment:{module,entryPoint:'fragment',targets:[{format:SCENE_COLOR_FORMAT},{format:SCENE_SURFACE_FORMAT},{format:SCENE_IDENTITY_FORMAT}]},
      primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less-equal'}};}
