export interface SceneRect { readonly left:number; readonly top:number; readonly right:number; readonly bottom:number }
export interface ScenePoint { readonly x:number; readonly y:number }
export interface SceneLayout { readonly viewport:SceneRect; readonly obstacles:readonly SceneRect[] }

/** Layout is read again only after an observed control move, resize, or visibility change. */
export class SceneLayoutObserver {
  private dirty=true;
  private cached:SceneLayout|null=null;
  constructor(private readonly viewport:()=>SceneRect,private readonly obstacles:()=>readonly HTMLElement[],elements:readonly HTMLElement[]){
    const invalidate=()=>this.invalidate();
    if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(invalidate);elements.forEach(element=>observer.observe(element));}
    if(typeof MutationObserver!=='undefined'){const observer=new MutationObserver(invalidate);elements.forEach(element=>observer.observe(element,{attributes:true,attributeFilter:['hidden','style','class']}));}
    const view=elements[0]?.ownerDocument.defaultView;
    view?.addEventListener('resize',invalidate);
    view?.visualViewport?.addEventListener('resize',invalidate);view?.visualViewport?.addEventListener('scroll',invalidate);
  }
  invalidate():void {this.dirty=true;}
  read():SceneLayout {
    if(!this.dirty&&this.cached)return this.cached;
    this.dirty=false;
    const viewport=this.viewport();
    const obstacles=this.obstacles().filter(element=>!element.hidden).map(element=>element.getBoundingClientRect())
      .filter(row=>row.right>row.left&&row.bottom>row.top).map(({left,top,right,bottom})=>({left,top,right,bottom}));
    this.cached={viewport,obstacles};return this.cached;
  }
}

/** Choose the nearest free scene position, including a body fallback when the original anchor is obstructed. */
export function sceneFeedbackPosition(width:number,height:number,layout:SceneLayout,anchor:ScenePoint|null):ScenePoint|null {
  const gap=8,{viewport,obstacles}=layout;
  const left=viewport.left+gap,right=viewport.right-width-gap,top=viewport.top+gap,bottom=viewport.bottom-height-gap;
  if(right<left||bottom<top)return null;
  const preferred={x:(anchor?.x??(viewport.left+viewport.right)/2)-width/2,
    y:anchor?anchor.y+12:viewport.top+(viewport.bottom-viewport.top-height)*0.55};
  const xs=[preferred.x,left,right,...obstacles.flatMap(row=>[row.left-width-gap,row.right+gap])];
  const ys=[preferred.y,top,bottom,...obstacles.flatMap(row=>[row.top-height-gap,row.bottom+gap])];
  let best:ScenePoint|null=null,distance=Infinity;
  for(const rawX of xs)for(const rawY of ys){
    const x=Math.max(left,Math.min(right,rawX)),y=Math.max(top,Math.min(bottom,rawY));
    if(obstacles.some(row=>x<row.right+gap&&x+width>row.left-gap&&y<row.bottom+gap&&y+height>row.top-gap))continue;
    const score=(x-preferred.x)**2+(y-preferred.y)**2;
    if(score<distance){best={x,y};distance=score;}
  }
  return best;
}
