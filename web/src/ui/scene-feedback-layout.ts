export interface SceneRect { readonly left:number; readonly top:number; readonly right:number; readonly bottom:number }
export interface ScenePoint { readonly x:number; readonly y:number }
export interface SceneLayout { readonly viewport:SceneRect; readonly obstacles:readonly SceneRect[] }

/** Layout is read again only after an observed control move, resize, or visibility change. */
export class SceneLayoutObserver {
  private dirty=true;
  private cached:SceneLayout|null=null;
  private readonly obstacles:readonly HTMLElement[];
  private dynamic: readonly HTMLElement[] = [];
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly mutationObserver: MutationObserver | undefined;
  private readonly extraGeometry: readonly HTMLElement[];
  /** Every obstacle is observed, even while hidden. Extra geometry owners may affect the viewport without being obstacles. */
  constructor(private readonly viewport:()=>SceneRect,obstacles:readonly HTMLElement[],extraGeometry:readonly HTMLElement[]=[],
    private readonly dynamicObstacles?: () => readonly HTMLElement[]){
    this.obstacles=[...obstacles]; this.extraGeometry = extraGeometry;
    const elements=[...new Set([...obstacles,...extraGeometry])];
    const invalidate=()=>this.invalidate();
    elements.forEach(element => element.addEventListener?.('scroll', invalidate, {passive: true}));
    if(typeof ResizeObserver!=='undefined'){this.resizeObserver=new ResizeObserver(invalidate);elements.forEach(element=>this.resizeObserver!.observe(element));}
    if(typeof MutationObserver!=='undefined'){this.mutationObserver=new MutationObserver(invalidate);elements.forEach(element=>this.observeMutation(element));}
    const view=elements[0]?.ownerDocument.defaultView;
    view?.addEventListener('resize',invalidate);
    view?.visualViewport?.addEventListener('resize',invalidate);view?.visualViewport?.addEventListener('scroll',invalidate);
  }
  private observeMutation(element: HTMLElement): void {
    this.mutationObserver?.observe(element, {attributes: true, attributeFilter: ['hidden', 'style', 'class', 'data-scene-clip']});
  }
  invalidate():void {this.dirty=true;}
  read():SceneLayout {
    const dynamic = this.dynamicObstacles?.() ?? [];
    if (dynamic.length !== this.dynamic.length || dynamic.some((element, index) => element !== this.dynamic[index])) {
      this.resizeObserver?.disconnect(); this.mutationObserver?.disconnect();
      this.dynamic = [...dynamic];
      for (const element of new Set([...this.obstacles, ...this.extraGeometry, ...dynamic])) {
        this.resizeObserver?.observe(element); this.observeMutation(element);
      }
      this.dirty = true;
    }
    if(!this.dirty&&this.cached)return this.cached;
    this.dirty=false;
    const viewport=this.viewport();
    const obstacles=[...this.obstacles, ...this.dynamic].filter(element=>!element.hidden).map(element => {
      const rect = element.getBoundingClientRect();
      const clip = element.style?.position === 'fixed' ? undefined : element.closest?.<HTMLElement>('[data-scene-clip="true"]')?.getBoundingClientRect();
      return clip ? {left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top),
        right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom)} : rect;
    })
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
