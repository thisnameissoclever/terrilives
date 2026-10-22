import { sceneFeedbackPosition, type SceneLayout, type ScenePoint } from './scene-feedback-layout.js';

/** An operation outcome, separate from selection instructions and translated status prose. */
export interface OperationFeedback {
  readonly operation: string;
  readonly state: 'pending' | 'success' | 'failure';
  readonly target: string;
  readonly message: string;
  readonly recovery?: 'retry' | 'move' | 'edit';
}

export function operationFeedback(operation: string, state: OperationFeedback['state'], target: string,
  message: string, recovery?: OperationFeedback['recovery']): OperationFeedback {
  return { operation, state, target, message, ...(recovery ? { recovery } : {}) };
}

/** A result appears once, even if its owning tool redraws on every frame. */
export class FeedbackLifetime {
  private previous: OperationFeedback | null = null;
  private since = 0;
  read(feedback: OperationFeedback | null, now = performance.now()): OperationFeedback | null {
    if (feedback !== this.previous) { this.previous = feedback; this.since = now; }
    return feedback?.state === 'success' && now - this.since >= 4000 ? null : feedback;
  }
}

export class PendingIndicator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly target: Pick<Element, 'setAttribute' | 'removeAttribute'>) {}
  start(expectedSlow = true): void {
    this.stop(); this.target.setAttribute('aria-busy', 'true');
    if (expectedSlow) this.target.setAttribute('data-pending', 'true');
    else this.timer = setTimeout(() => { this.timer = undefined; this.target.setAttribute('data-pending', 'true'); }, 1250);
  }
  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined; this.target.removeAttribute('data-pending'); this.target.removeAttribute('aria-busy');
  }
}

/** Scene messages share one readable surface; object-menu layout can supply its current anchor. */
export class SceneFeedback {
  private owner = '';
  private current: OperationFeedback | null = null;
  private readonly seen = new Map<string, WeakSet<OperationFeedback>>();
  private since = 0;
  private integrationAnchor: ScenePoint | null = null;
  private eventAnchor: ScenePoint | null | undefined;
  private placement: SceneLayout | null = null;
  private layoutKey = '';
  private placementDirty = true;
  private fits = true;
  /** Existing command producers write through this adapter; every text assignment identifies a new event. */
  readonly status: { textContent:string|null; setAttribute(name:string,value:string):void; removeAttribute(name:string):void; getAttribute(name:string):string|null };
  constructor(private readonly element: HTMLElement) {
    element.dataset.surface = 'scene';
    element.ownerDocument?.body.append(element);
    const self=this;
    this.status={
      get textContent(){return element.textContent;},
      set textContent(text:string|null){
        if(!text){self.owner='command';self.current=null;element.textContent='';self.syncBox();return;}
        self.present('command',operationFeedback('command','success','Scene',text));
      },
      setAttribute:(name,value)=>element.setAttribute(name,value),removeAttribute:name=>element.removeAttribute(name),
      getAttribute:name=>element.getAttribute(name),
    };
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{this.placementDirty=true;}).observe(element);
    this.syncBox();
  }
  /** Opacity removes the empty painted box without removing its live region. */
  private syncBox(): void { this.element.style.opacity = this.fits && this.element.textContent?.trim() ? '' : '0'; }
  /** Task 3 supplies a scene anchor here; an event may override it with its own point or explicit body fallback. */
  anchor(point: ScenePoint | null): void {
    if(point?.x===this.integrationAnchor?.x&&point?.y===this.integrationAnchor?.y)return;
    this.integrationAnchor=point;this.placementDirty=true;
  }
  layout(layout:SceneLayout):void {
    const key=JSON.stringify(layout);if(key===this.layoutKey)return;
    this.layoutKey=key;this.placement=layout;this.placementDirty=true;
    this.element.style.maxWidth=`${Math.max(0,Math.min(420,layout.viewport.right-layout.viewport.left-16))}px`;
  }
  /** Polling the same record never restarts its lifetime, including after expiry or cancellation. */
  present(owner:string,feedback:OperationFeedback,point?:ScenePoint|null,now=performance.now()):void {
    if(this.owner===owner&&this.current===feedback&&(point?.x!==this.eventAnchor?.x||point?.y!==this.eventAnchor?.y||(point===null)!==(this.eventAnchor===null))){
      this.eventAnchor=point;this.placementDirty=true;
    }
    const seen=this.seen.get(owner)??new WeakSet<OperationFeedback>();
    if(seen.has(feedback))return;
    seen.add(feedback);this.seen.set(owner,seen);this.owner=owner;this.current=feedback;this.eventAnchor=point;this.since=now;
    this.element.textContent=feedback.message;this.element.dataset.state=feedback.state;
    this.element.setAttribute('data-kind',feedback.state==='failure'?'error':'info');
    this.placementDirty=true;this.fits=true;this.syncBox();
  }
  clear(owner:string):void {
    if(this.owner!==owner)return;
    this.current=null;this.element.textContent='';this.syncBox();
  }
  frame(now = performance.now()): void {
    const state=this.owner==='command'&&this.element.getAttribute('data-kind')==='error'?'failure':this.current?.state;
    if(state==='success'&&now-this.since>=4000)this.element.textContent='';
    if(this.element.textContent&&this.placement&&this.placementDirty){
      this.placementDirty=false;
      const size=this.element.getBoundingClientRect();
      const point=sceneFeedbackPosition(size.width,size.height,this.placement,this.eventAnchor===undefined?this.integrationAnchor:this.eventAnchor);
      this.fits=point!==null;
      if(point){this.element.style.left=`${point.x}px`;this.element.style.top=`${point.y}px`;this.element.style.bottom='auto';this.element.style.transform='none';}
    }
    this.syncBox();
  }
}

/** Build receipts share the scene owner; current anchored eligibility remains with the action controls. */
export class BuildSceneFeedback {
  private tool: object | null = null;
  private lastAnchor: ScenePoint | null = null;
  private polled: OperationFeedback | null = null;
  constructor(private readonly scene:SceneFeedback) {}
  reset():void {this.scene.clear('build');this.tool=null;this.lastAnchor=null;this.polled=null;}
  frame(input:{ active:boolean; reviewing:boolean; tool:object; feedback:OperationFeedback|null; result?:OperationFeedback|null;
    contextual:boolean; anchor:ScenePoint|null },now:number):void {
    if(this.tool!==input.tool){this.scene.clear('build');this.tool=input.tool;this.lastAnchor=null;this.polled=null;}
    if(!input.active){this.reset();return;}
    if(input.anchor)this.lastAnchor=input.anchor;
    if(input.reviewing){this.scene.clear('build');return;}
    let feedback=input.result??input.feedback;
    // Pending/eligibility getters may return a fresh snapshot each frame. They are states, not new receipts.
    if(feedback&&feedback.state!=='success'){
      if(this.polled&&JSON.stringify(this.polled)===JSON.stringify(feedback))feedback=this.polled;
      else this.polled=feedback;
    }else this.polled=null;
    if(feedback&&(feedback.state==='success'||!input.contextual))this.scene.present('build',feedback,this.lastAnchor,now);
    else this.scene.clear('build');
  }
}
