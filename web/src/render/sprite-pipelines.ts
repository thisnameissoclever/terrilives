import {SCENE_COLOR_FORMAT,sceneColorFunctions} from './scene-sampling.js';
import {BYTES_PER_INSTANCE,COLOURWAY_ATTRIBUTE_OFFSET,TINT_ATTRIBUTE_OFFSET,WALL_ATTRIBUTE_OFFSET,MAX_ARCHITECTURE_FINISH_SLOT} from './instances.js';
import shaderSource from './sprites.wgsl?raw';
import {architecturePatternShader} from './architecture-finishes.js';
import {atlasStorageShader} from './atlas-storage-shader.js';
import {ATLAS_STORAGE} from './atlas-storage-metadata.js';

/** The production shader, including every resident architecture texture binding. */
export function spriteShaderSource(patternCount:number):string {
  const jointBinding=11+patternCount;
  return (sceneColorFunctions+shaderSource).replace('// ATLAS_STORAGE_SAMPLING',atlasStorageShader(ATLAS_STORAGE)).replace(
      '// ARCHITECTURE_PATTERN_BINDINGS', architecturePatternShader(patternCount)).replace(
      '// JOINT_ALPHA_BINDING', `@group(0) @binding(${jointBinding}) var jointAlpha: texture_2d_array<f32>;
struct JointRegistration { records: array<vec4f> };
@group(0) @binding(${jointBinding + 1}) var<storage, read> jointRegistration: JointRegistration;
struct AtlasLookup { entries: array<u32> };
@group(0) @binding(${jointBinding + 2}) var<storage, read> atlasLookup: AtlasLookup;`);
}

export function spriteBindGroupLayoutEntries(patternCount:number):GPUBindGroupLayoutEntry[] {
  const jointBinding=11+patternCount;
  return [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 7, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ...Array.from({ length: patternCount }, (_, index): GPUBindGroupLayoutEntry => ({
        binding: 11 + index, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' },
      })),
      { binding: 9, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 10, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: jointBinding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: jointBinding + 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: jointBinding + 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ];
}

/** Shared with preflight so layout, constants, attributes and targets cannot drift. */
export function spritePipelineDescriptors(module:GPUShaderModule,layout:GPUPipelineLayout):Record<'opaque'|'lowWall'|'grime'|'annotation',GPURenderPipelineDescriptor> {
  const opaque: GPURenderPipelineDescriptor = {
      layout,
      vertex: {
        module,
        entryPoint: 'vs',
        constants: { maxArchitectureFinishSlot: MAX_ARCHITECTURE_FINISH_SLOT },
        buffers: [
          {
            arrayStride: BYTES_PER_INSTANCE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              // [ML-tint]. One buffer with interleaved attributes -
              // not a second vertex buffer. Both halves belong to the
              // same instance and are written together by
              // `writeInstance`, so splitting them across buffers would
              // mean two uploads and two chances for the counts to
              // disagree, for nothing.
              {
                shaderLocation: 1,
                offset: TINT_ATTRIBUTE_OFFSET,
                format: 'float32x4',
              },
              { shaderLocation: 2, offset: WALL_ATTRIBUTE_OFFSET, format: 'float32x4' },
              // [RC-render]: the colourway shift, all zero for the art as drawn.
              { shaderLocation: 3, offset: COLOURWAY_ATTRIBUTE_OFFSET, format: 'float32x4' },
            ],
          },
          {arrayStride:4,stepMode:'instance',attributes:[{shaderLocation:5,offset:0,format:'uint32'}]},
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        constants: { maxArchitectureFinishSlot: MAX_ARCHITECTURE_FINISH_SLOT },
        targets: [
          {
            format: SCENE_COLOR_FORMAT,
            // Scene color is linear and premultiplied. Opaque coverage is
            // resolved per scene sample; translucent walls and grime blend
            // without replacing the categorical surface depth or identity.
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
          {format:'r32float'}, {format:'r32uint'},
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    };
  return {opaque,annotation:{...opaque,depthStencil:undefined,
      fragment:{...opaque.fragment!,entryPoint:'fsAnnotation',targets:[Array.from(opaque.fragment!.targets)[0],{format:'r32uint'}]}},lowWall:{ ...opaque,
      fragment:{...opaque.fragment!,constants:{...opaque.fragment!.constants,sceneTranslucent:1},targets:[Array.from(opaque.fragment!.targets)[0],{format:'r32float',writeMask:0},{format:'r32uint',writeMask:0}]},
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    },grime:{ ...opaque,
      vertex: { ...opaque.vertex, entryPoint: 'vsGrime', buffers: [
        ...opaque.vertex.buffers!, {arrayStride:4,stepMode:'instance',attributes:[{shaderLocation:4,offset:0,format:'float32'}]}]},
      fragment: { ...opaque.fragment!, constants: { ...opaque.fragment!.constants, grimePass: 1 },targets:[Array.from(opaque.fragment!.targets)[0],{format:'r32float',writeMask:0},{format:'r32uint',writeMask:0}] },
      depthStencil: {format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'},
    }};
}
