import { expect, it, vi } from 'vitest';
vi.mock('../src/ui/character-creator/preview.js',()=>({CreatorPreview:class {}}));
import { CreatorView, creatorPages } from '../src/ui/character-creator/view.js';
import { CharacterDraft } from '../src/character/draft.js';
import { floatBits, neutralDraft } from '../src/character/schema.js';
import type { CharacterCatalog } from '../src/character/catalog.js';

class Element {
  children:Element[]=[];dataset:Record<string,string>={};attributes:Record<string,string>={};
  disabled=false;checked=false;open=false;value='';id='';className='';type='';private text='';
  constructor(readonly tag:string){}
  get textContent():string {return this.text+this.children.map(child=>child.textContent).join(' ');}
  set textContent(value:string){this.text=value;this.children=[];}
  append(...children:Element[]):void {this.children.push(...children);}
  replaceChildren(...children:Element[]):void {this.children=children;}
  setAttribute(name:string,value:string):void {this.attributes[name]=value;}
  removeAttribute(name:string):void {delete this.attributes[name];}
  addEventListener():void {}
  contains():boolean {return false;}
  all():Element[] {return [this,...this.children.flatMap(child=>child.all())];}
  querySelectorAll(selector:string):Element[] {
    const key=selector.match(/\[data-([\w-]+)\]/)?.[1]?.replace(/-([a-z])/g,(_,letter:string)=>letter.toUpperCase());
    return this.all().slice(1).filter(node=>key?key in node.dataset:selector.includes('details')?node.tag==='details'&&(!selector.includes('[open]')||node.open):false);
  }
}
const catalog:CharacterCatalog={version:1,name_limit:24,max_traits:4,max_household:6,traits:[],affinities:[],hobbies:[],skills:[],activities:[],personalities:[]};

it.each([false,true])('opens with Walking selected and respects reduced motion (%s)',reducedMotion=>{
  const nodes=new Map<string,Element>();
  const node=(selector:string)=>{
    if(!nodes.has(selector))nodes.set(selector,new Element('div'));
    return nodes.get(selector)!;
  };
  Object.assign(node('.creator-preview'),{getClientRects:()=>[{}]});
  const requestAnimationFrame=vi.fn(()=>1);
  const window={matchMedia:()=>({matches:reducedMotion,addEventListener:vi.fn()}),addEventListener:vi.fn(),requestAnimationFrame};
  const document={hidden:false,defaultView:window,createElement:(tag:string)=>new Element(tag),addEventListener:vi.fn()};
  const root={ownerDocument:document,classList:{add:vi.fn()},dataset:{},innerHTML:'',querySelector:node,closest:()=>null,parentElement:null};
  const render=vi.spyOn(CreatorView.prototype,'render').mockImplementation(function(this:CreatorView){
    (this as unknown as {refreshAnimation():void}).refreshAnimation();
  });
  vi.stubGlobal('MutationObserver',class {observe():void {} });
  try{
    const view=new CreatorView(root as unknown as HTMLElement,{} as ConstructorParameters<typeof CreatorView>[1],{} as GPUDevice,'rgba8unorm',()=>{});
    expect((view as unknown as {action:string}).action).toBe('walk');
    expect(node('[data-action]').value).toBe('walk');
    expect(node('[data-play]').textContent).toBe(reducedMotion?'Play':'Pause');
    expect(node('[data-play]').attributes['aria-label']).toBe(reducedMotion?'Play animation':'Pause animation');
    expect(requestAnimationFrame).toHaveBeenCalledTimes(reducedMotion?0:1);
  }finally{render.mockRestore();vi.unstubAllGlobals();}
});

function viewFixture(definitions:CharacterCatalog=catalog){
  const editor=new Element('section'),fixed=new Map<string,Element>([['.creator-editor',editor]]);
  for(const selector of ['h1','.creator-subtitle','[data-next]','[data-reset]','.creator-status','[data-undo]','[data-global-random]','[data-cancel]','[data-name]'])fixed.set(selector,new Element('div'));
  const root=new Element('root');root.append(...fixed.values());
  const document={activeElement:null,createElement:(tag:string)=>new Element(tag),getElementById:()=>null};
  const draft=CharacterDraft.edit(neutralDraft('Name'),42,definitions,[]);
  const drawPreview=vi.fn(),refreshAnimation=vi.fn();
  const view=Object.assign(Object.create(CreatorView.prototype),{root,document,session:{draft,pending:false,error:'',sim:1},
    page:'appearance',renderedPage:null,openGroups:new Map(),destroyed:false,previewReady:true,appearanceReady:true,previewError:'',lastAppearance:'',
    element:(selector:string)=>fixed.get(selector)!,drawPreview,refreshAnimation}) as {
      page:string;render():void;drawPreview:typeof drawPreview;refreshAnimation:typeof refreshAnimation;
    };
  return {view,editor,draft,drawPreview,fixed};
}

it('allows Review submission after preparation without requiring a visible preview draw',()=>{
  const {view,fixed}=viewFixture();view.page='review';Reflect.set(view,'previewReady',false);view.render();
  expect(fixed.get('[data-next]')!.disabled).toBe(false);
  Reflect.set(view,'appearanceReady',false);view.render();expect(fixed.get('[data-next]')!.disabled).toBe(true);
  Reflect.set(view,'appearanceReady',true);Reflect.set(view,'previewError','Graphics failed');view.render();
  expect(fixed.get('[data-next]')!.disabled).toBe(true);
});

it('uses the seven approved pages and preserves independent disclosure state per page',()=>{
  expect(creatorPages.map(([,label])=>label)).toEqual(['Identity','Appearance','Personality','Needs & habits','Interests & skills','Household','Review']);
  const {view,editor}=viewFixture({...catalog,activities:[{object:'bookshelf',action:'read',label:'Read',tags:['reading']}]});view.render();
  let details=editor.querySelectorAll('details');expect(details.map(node=>node.dataset.group)).toEqual(['Colors','Body','Style','Face','Details']);
  expect(details.every(node=>!node.open)).toBe(true);details[0].open=true;
  view.page='needs';view.render();
  const needGroups=editor.querySelectorAll('details');
  expect(needGroups.filter(node=>node.dataset.group!=='Activity preferences').every(node=>!node.open)).toBe(true);
  const activities=needGroups.find(node=>node.dataset.group==='Activity preferences')!;
  expect(activities.open).toBe(true);activities.open=false;
  expect(editor.all().filter(node=>node.tag==='summary'&&node.textContent==='Activity preferences')).toHaveLength(1);
  expect(editor.all().filter(node=>node.tag==='legend'&&node.textContent==='Activity preferences')).toHaveLength(0);
  view.page='appearance';view.render();details=editor.querySelectorAll('details');
  expect(details.map(node=>node.open)).toEqual([true,false,false,false,false]);
  view.page='needs';view.render();expect(editor.querySelectorAll('details').find(node=>node.dataset.group==='Activity preferences')!.open).toBe(false);
});

it('has a single shared trait-cap notice only after the limit is reached',()=>{
  const definitions={...catalog,traits:Array.from({length:5},(_,index)=>({id:'trait'+index,label:'Trait '+index,description:'An individual description.',kind:'disposition' as const,initial_state:floatBits(0),weights:[]}))};
  const {view,editor,draft}=viewFixture(definitions);view.page='personality';
  for(let count=0;count<=4;count++){
    if(count)draft.set(JSON.stringify(['trait','trait'+(count-1)]),true);view.render();
    expect(editor.all().filter(node=>node.id==='creator-trait-limit')).toHaveLength(count===4?1:0);
    expect(editor.textContent.match(/Remove a selected trait to make room\./g)?.length??0).toBe(count===4?1:0);
    for(const label of editor.all().filter(node=>node.tag==='label'))expect(label.textContent).not.toContain('Remove a selected trait');
  }
});

it('shows each simple heading once and explains preferences without route or tag vocabulary',()=>{
  const definitions={...catalog,hobbies:[{id:'reading',label:'Reading'}],activities:[{object:'bookshelf',action:'read',label:'Read',tags:['reading']}]};
  const {view,editor}=viewFixture(definitions);view.page='identity';view.render();
  expect(editor.all().filter(node=>['h2','legend'].includes(node.tag)&&node.textContent==='Identity')).toHaveLength(1);
  view.page='needs';view.render();
  expect(editor.all().filter(node=>node.tag==='legend'&&node.textContent==='Sleep timing')).toHaveLength(0);
  expect(editor.textContent).not.toContain('routes');expect(editor.textContent).toContain('urgent needs');
  view.page='interests';view.render();expect(editor.textContent).not.toContain('this tag');expect(editor.textContent).toContain('life satisfaction');
});

it('does not redraw appearance for names, personality edits, or page navigation',()=>{
  const {view,draft,drawPreview}=viewFixture();view.render();expect(drawPreview).toHaveBeenCalledTimes(1);
  draft.set('name','Changed');view.page='identity';view.render();
  draft.set('behavior.shyness',75);view.page='personality';view.render();expect(drawPreview).toHaveBeenCalledTimes(1);
  draft.set('appearance.body.height',75);view.render();expect(drawPreview).toHaveBeenCalledTimes(2);
});

it('places clothing colors beside their garment and shows freckle density only when enabled',()=>{
  const {view,draft,editor}=viewFixture();view.render();
  const fields=()=>editor.all().filter(node=>node.dataset.field).map(node=>node.dataset.field);
  const initial=fields();expect(initial.indexOf('appearance.colors.shirt')).toBe(initial.indexOf('appearance.top')+1);
  expect(initial.indexOf('appearance.colors.trousers')).toBe(initial.indexOf('appearance.bottoms')+1);
  expect(initial.indexOf('appearance.colors.shoes')).toBe(initial.indexOf('appearance.footwear')+1);
  expect(initial).not.toContain('appearance.freckle_density');
  draft.set('appearance.freckles',true);view.render();const visible=fields();
  expect(visible.indexOf('appearance.freckle_density')).toBe(visible.indexOf('appearance.freckles')+1);
});

it('serializes preview work and defers queued draws while hidden or destroyed',async()=>{
  let finish:()=>void=()=>{};const pending=new Promise<void>(resolve=>{finish=resolve;});
  const draw=vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined),visible=vi.fn(()=>true);
  const draft=CharacterDraft.edit(neutralDraft('Name'),42,catalog,[]);
  const view=Object.assign(Object.create(CreatorView.prototype),{session:{draft},destroyed:false,previewInFlight:false,queuedDraw:false,
    previewKey:'',previewError:'',previewReady:false,appearanceReady:false,preparationKey:'',preparationGeneration:0,frame:0,action:'walk',facing:0,preview:{draw,prepare:()=>Promise.resolve(undefined)},visible,
    element:()=>new Element('span'),syncStatus:vi.fn(),refreshAnimation:vi.fn()}) as {
      frame:number;destroyed:boolean;queuedDraw:boolean;drawPreview():Promise<void>;
    };
  const first=view.drawPreview();view.frame=2;await view.drawPreview();expect(draw).toHaveBeenCalledTimes(1);
  visible.mockReturnValue(false);finish();await first;expect(draw).toHaveBeenCalledTimes(1);expect(view.queuedDraw).toBe(true);
  visible.mockReturnValue(true);await view.drawPreview();expect(draw).toHaveBeenCalledTimes(2);expect(draw.mock.calls[1][3]).toBe(2);
  view.destroyed=true;await view.drawPreview();expect(draw).toHaveBeenCalledTimes(2);
});

it('keeps explicit forward and cancel intent through page, label and pending changes',()=>{
  const {view,fixed}=viewFixture();
  for(const [page,sim,label,pending] of [['appearance',1,'Continue',false],['review',1,'Apply changes',false],['review',null,'Move in',true]] as const){
    view.page=page;Object.assign(Reflect.get(view,'session'),{sim,pending});view.render();
    expect(fixed.get('[data-next]')!.textContent).toBe(label);
    expect(fixed.get('[data-next]')!.attributes['data-action-intent']).toBe('affirmative');
    expect(fixed.get('[data-cancel]')!.attributes['data-action-intent']).toBe('negative');
    expect(fixed.get('[data-global-random]')!.attributes['data-action-intent']).toBeUndefined();
    expect(fixed.get('[data-next]')!.disabled).toBe(pending);
  }
});
