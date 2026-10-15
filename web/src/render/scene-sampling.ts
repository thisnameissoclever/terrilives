export const SCENE_SAMPLE_SCALE=2;
export const SCENE_COLOR_FORMAT:GPUTextureFormat='rgba16float';
export const SCENE_SURFACE_FORMAT:GPUTextureFormat='r32float';
export const SCENE_IDENTITY_FORMAT:GPUTextureFormat='r32uint';

export function sceneFramebufferSize(width:number,height:number,ratio:number,textureLimit:number):readonly[number,number]{
  if(![width,height,ratio,textureLimit].every(Number.isFinite)||width<=0||height<=0||ratio<=0||textureLimit<2)throw new Error('Invalid scene viewport.');
  const limit=Math.floor(textureLimit/SCENE_SAMPLE_SCALE);
  const density=Math.min(ratio,limit/width,limit/height);
  return [Math.max(1,Math.floor(width*density)),Math.max(1,Math.floor(height*density))];
}

/** Ordered four-sample coverage. The shader uses the same fixed screen grid. */
export function coveredSubpixels(alpha:number):boolean[]{
  return [0,2,3,1].map(rank=>alpha>(rank+.5)/4);
}
export function resolveVisibleOwner(owners:readonly number[],depths:readonly number[]):number{
  let owner=0,depth=Infinity;
  for(let i=0;i<owners.length;i++)if(owners[i]!==0&&depths[i]<depth){owner=owners[i];depth=depths[i];}
  return owner;
}
/** Later annotation draws win even at a partially covered display pixel. */
export function resolveAnnotationOwner(samples:readonly number[],drawOrder:readonly number[]):number {
  let winner=0,priority=-1;
  for(const token of samples){
    if(token===0)continue;
    const index=drawOrder.lastIndexOf(token);
    if(index<0)throw new Error('Annotation pixel has no displayed owner.');
    if(index>priority){winner=token;priority=index;}
  }
  return winner;
}
/** Anchor coordinates include the sprite's transparent lower padding. */
export function bubbleAnchorY(headY:number,scale:number,anchorY:number,height:number,visibleBottom:number):number{
  return headY-(4+anchorY-height+visibleBottom)*scale;
}

export const sceneColorFunctions=`
fn sceneLinear(rgb:vec3f)->vec3f {
 return select(pow((max(rgb,vec3f(0))+.055)/1.055,vec3f(2.4)),rgb/12.92,rgb<=vec3f(.04045));
}
fn sceneEncoded(rgb:vec3f)->vec3f {
 return select(1.055*pow(max(rgb,vec3f(0)),vec3f(1.0/2.4))-.055,rgb*12.92,rgb<=vec3f(.0031308));
}
fn sceneCovered(alpha:f32,pixel:vec2f)->bool {
 let p=vec2u(pixel)%vec2u(2u);
 let rank=array<f32,4>(0.,2.,3.,1.)[p.y*2u+p.x];
 return alpha>(rank+.5)*.25;
}`;
