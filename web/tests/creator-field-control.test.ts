import { expect, it } from 'vitest';
import {creationInstinctBands} from './helpers/creation-instinct-bands.js';
import { CharacterDraft } from '../src/character/draft.js';
import { floatBits, neutralDraft } from '../src/character/schema.js';
import type { CharacterCatalog } from '../src/character/catalog.js';
import { fieldControl } from '../src/ui/character-creator/field.js';

class Element {
  children:Element[]=[];dataset:Record<string,string>={};attributes:Record<string,string>={};listeners=new Map<string,()=>void>();
  disabled=false;checked=false;value='';textContent='';id='';className='';type='';
  constructor(readonly tag:string){}
  append(...children:Element[]):void {this.children.push(...children);}
  setAttribute(name:string,value:string):void {this.attributes[name]=value;}
  addEventListener(event:string,handler:()=>void):void {this.listeners.set(event,handler);}
  fire(event:string):void {this.listeners.get(event)?.();}
}
const document={createElement:(tag:string)=>new Element(tag)} as unknown as Document;
const catalog:CharacterCatalog={version:2,self_preservation_bands:creationInstinctBands,name_limit:24,max_traits:1,max_household:6,
  traits:['one','two'].map(id=>({id,label:id,description:'A useful description.',kind:'disposition',initial_state:floatBits(0),weights:[]})),
  affinities:[],hobbies:[],skills:[],activities:[{object:'bookshelf',action:'read',label:'Read',tags:['reading']}],personalities:[]};
function control(draft:CharacterDraft,id:string):Element {
  return fieldControl(document,draft.fields.find(field=>field.id===id)!,draft,0,()=>{},error=>{throw error;}) as unknown as Element;
}

it('disables field Random while locked and restores it when unlocked',()=>{
  const draft=CharacterDraft.edit(neutralDraft('Name'),7,catalog,[]),row=control(draft,'name');
  const random=row.children[2],lock=row.children[3];expect(random.disabled).toBe(false);
  lock.fire('click');expect(random.disabled).toBe(true);expect(draft.locks.has('name')).toBe(true);
  lock.fire('click');expect(random.disabled).toBe(false);
});

it('keeps selected traits removable at the cap while disabling unchecked extras',()=>{
  const source=neutralDraft('Name');source.traits=[{id:'one',state:floatBits(0)}];
  const draft=CharacterDraft.edit(source,7,catalog,[]);
  const selected=control(draft,JSON.stringify(['trait','one'])),extra=control(draft,JSON.stringify(['trait','two']));
  expect(selected.children[1].children[0].disabled).toBe(false);
  expect(extra.children[1].children[0].disabled).toBe(true);expect(extra.children[2].disabled).toBe(true);
  expect(extra.children[0].children[1].textContent).toBe('A useful description.');
  expect(extra.children[1].children[0].attributes['aria-describedby']).toContain('creator-trait-limit');
  const checkbox=selected.children[1].children[0];checkbox.checked=false;checkbox.fire('change');expect(draft.value.traits).toEqual([]);
});

it('shows numeric units and the editable range without changing the stored value',()=>{
  const source=neutralDraft('Name');source.behavior.cleanliness=floatBits(.78);source.behavior.chronotype_offset_ticks=-90;
  const draft=CharacterDraft.edit(source,7,catalog,[]);
  for(const [id,unit,range] of [['behavior.cleanliness','%','0 to 100%'],['behavior.chronotype_offset_ticks','h','-3 to 3 hours'],['behavior.drain.0','%','50 to 150%'],['activity-category:read','×','0 to 2×']]){
    const row=control(draft,id),limits=row.children[0].children.find(node=>node.className==='creator-range');
    expect(limits?.textContent).toBe(range);
    expect(row.children[1].children[1].children[1]?.textContent).toBe(unit);
  }
  expect(draft.value).toEqual(source);
});

function numberBox(row:Element):Element {
  const inputs:Element[]=[];const walk=(node:Element)=>{if(node.tag==='input'&&node.type==='number')inputs.push(node);node.children.forEach(walk);};walk(row);
  expect(inputs).toHaveLength(1);return inputs[0];
}

it('shows the value box and its tooltip through one formatter, never a widened float',()=>{
  // 0.29 widens to 28.999999165534973%; a spawned 0.123456 is off the 1% step.
  for(const [stored,shown] of [[.29,'29'],[.123456,'12.35']] as const){
    const source=neutralDraft('Name');source.behavior.cleanliness=floatBits(stored);
    const draft=CharacterDraft.edit(source,7,catalog,[]),box=numberBox(control(draft,'behavior.cleanliness'));
    expect(box.value).toBe(shown);
    expect((box as unknown as {title?:string}).title).toBe(shown);
    expect(draft.value).toEqual(source);
  }
  // A tiny spawned preference keeps two significant digits in both places
  // rather than reading as 0 in the box and 0.0031 in the tooltip.
  const withPlants:CharacterCatalog={...catalog,affinities:[{id:'plants',label:'Plants',description:'Potted plants around the house.'}]};
  const source=neutralDraft('Name');source.affinities=[{id:'plants',value:floatBits(.0031)}];
  const draft=CharacterDraft.edit(source,7,withPlants,[]),box=numberBox(control(draft,JSON.stringify(['affinity','plants'])));
  expect(box.value).toBe('0.0031');
  expect((box as unknown as {title?:string}).title).toBe('0.0031');
});

it('refreshes the value box tooltip after an edit',()=>{
  const source=neutralDraft('Name');source.behavior.cleanliness=floatBits(.29);
  const draft=CharacterDraft.edit(source,7,catalog,[]),box=numberBox(control(draft,'behavior.cleanliness'));
  (box as unknown as {valueAsNumber:number}).valueAsNumber=41;box.fire('change');
  expect(box.value).toBe('41');
  expect((box as unknown as {title?:string}).title).toBe('41');
});
