export function bounds(fieldSelector, scrollSelector) {
 const input=document.querySelector(fieldSelector),body=document.querySelector(scrollSelector),r=input.getBoundingClientRect(),b=body.getBoundingClientRect(),cs=getComputedStyle(input);
 const spread=parseFloat(cs.outlineWidth)+parseFloat(cs.outlineOffset),painted={left:r.left-spread,right:r.right+spread,top:r.top-spread,bottom:r.bottom+spread};
 const clip={left:b.left+body.clientLeft,right:b.left+body.clientLeft+body.clientWidth,top:b.top+body.clientTop,bottom:b.top+body.clientTop+body.clientHeight};
 return {fieldSelector,scrollSelector,focused:document.activeElement===input,viewport:{width:innerWidth,height:innerHeight,visualWidth:visualViewport.width,visualHeight:visualViewport.height},input:r.toJSON(),painted,clip,scrollTop:body.scrollTop,scrollLeft:body.scrollLeft,outline:cs.outline,outlineOffset:cs.outlineOffset,fits:r.height>0&&painted.left>=clip.left&&painted.right<=clip.right&&painted.top>=clip.top&&painted.bottom<=clip.bottom};
}
