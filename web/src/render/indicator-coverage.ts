import {SPRITES} from './atlas.js';
import {bubbleAnchorY} from './scene-sampling.js';

const visibleBottoms=new Map<number,number>();
/** Read the actual indicator coverage once, alongside the atlas upload. */
export function loadIndicatorCoverage(atlas:ImageBitmap,page:number):void {
 const canvas=new OffscreenCanvas(1,1),context=canvas.getContext('2d',{willReadFrequently:true});
 if(!context)throw new Error('Activity indicator coverage requires a canvas reader.');
 for(const [index,sprite] of SPRITES.entries()){
  if((sprite.page??0)!==page||!(/^(activity|conversation)/.test(sprite.name)))continue;
  canvas.width=sprite.w;canvas.height=sprite.h;
  context.drawImage(atlas,sprite.x,sprite.y,sprite.w,sprite.h,0,0,sprite.w,sprite.h);
  const data=context.getImageData(0,0,sprite.w,sprite.h).data;let bottom=0;
  for(let y=0;y<sprite.h;y++)for(let x=0;x<sprite.w;x++)if(data[(y*sprite.w+x)*4+3]>=32)bottom=y+1;
  if(bottom===0)throw new Error('Activity indicator has no visible coverage.');
  visibleBottoms.set(index,bottom/(sprite.pixel_density??1));
 }
}
export function indicatorAnchorY(sprite:number,headScreenY:number,scale:number):number{
 const bottom=visibleBottoms.get(sprite);
 if(bottom===undefined)throw new Error('Activity indicator coverage has not loaded.');
 const rect=SPRITES[sprite];
 return bubbleAnchorY(headScreenY,scale,21,rect.h/(rect.pixel_density??1),bottom);
}
