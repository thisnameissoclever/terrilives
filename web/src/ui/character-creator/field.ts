import { displayValue, hex, rgb, type CharacterField, type FieldValue } from '../../character/fields.js';
import { floatBits, type Rgb } from '../../character/schema.js';
import type { CharacterDraft } from '../../character/draft.js';
import { reviewValue } from '../../character/presentation.js';

export const traitLimitDescriptionId='creator-trait-limit';

export function fieldControl(document:Document, field:CharacterField, draft:CharacterDraft, index:number, changed:(rebuild:boolean)=>void, fail:(error:unknown)=>void):HTMLElement {
  const row=document.createElement('div');row.className='creator-field';row.dataset.field=field.id;
  const label=document.createElement('label'),name=document.createElement('strong'),description=document.createElement('span');
  const id=`creator-field-${index}`;label.htmlFor=id;name.textContent=field.label;description.textContent=field.description;
  description.id=id+'-description';label.append(name,description);row.append(label);
  const controls=document.createElement('div');controls.className='creator-control';row.append(controls);
  const value=field.get(draft.value),applicable=field.applicable?.(draft.value)??true;
  const trait=draft.catalog.traits.find(trait=>field.id===JSON.stringify(['trait',trait.id]));
  const capped=!!trait&&value!==true&&draft.value.traits.length>=draft.catalog.max_traits;
  const severityLocked=!!trait&&draft.locks.has(JSON.stringify(['severity',trait.id]));
  const describedBy=description.id+(capped?' '+traitLimitDescriptionId:'');
  const commit=(value:FieldValue)=>{try{draft.set(field.id,value);changed(field.kind!=='number'&&field.kind!=='float'&&field.kind!=='text');}catch(error){changed(true);fail(error);}};
  const decorate=<T extends HTMLInputElement|HTMLSelectElement>(input:T):T=>{
    input.id=id;input.setAttribute('aria-describedby',describedBy);input.disabled=!applicable||capped;return input;
  };
  if(field.kind==='number'||field.kind==='float') {
    const scale=field.display_scale??1,min=(field.min??0)*scale,max=(field.max??100)*scale,step=(field.step??1)*scale;
    const range=decorate(document.createElement('input')),number=document.createElement('input');range.type='range';number.type='number';number.setAttribute('aria-label',field.label+' value');
    const limits=document.createElement('span');limits.className='creator-range';limits.id=id+'-range';
    limits.textContent=`${min} to ${max}${field.unit==='hours'?' hours':field.unit??''}`;label.append(limits);
    for(const input of [range,number])input.setAttribute('aria-describedby',describedBy+' '+limits.id);
    number.disabled=!applicable;
    const formatted=(value:FieldValue)=>{const n=Number(displayValue(field,value)),rounded=Math.round(n/step)*step;return String(Math.abs(n-rounded)<Math.max(1,Math.abs(n))*1e-6?Number(rounded.toFixed(8)):Number(n.toFixed(4)));};
    for(const input of [range,number]){input.min=String(min);input.max=String(max);input.step=String(step);input.value=formatted(value);}
    number.title=String(displayValue(field,value));
    const update=(input:HTMLInputElement)=>{
      const raw=input.valueAsNumber/scale;
      commit(field.kind==='float'?floatBits(raw):raw);
      const current=formatted(field.get(draft.value));range.value=number.value=current;
    };
    range.addEventListener('input',()=>{try{update(range);}catch(error){fail(error);}});
    number.addEventListener('change',()=>{try{update(number);}catch(error){fail(error);}});
    if(field.unit){
      const valueGroup=document.createElement('span'),unit=document.createElement('span');valueGroup.className='creator-number';unit.className='creator-unit';
      unit.textContent=field.unit==='hours'?'h':field.unit;unit.setAttribute('aria-hidden','true');valueGroup.append(number,unit);controls.append(range,valueGroup);
    }else controls.append(range,number);
    const current=displayValue(field,value);
    if(typeof current==='number'&&(current<min||current>max))description.textContent+=' Outside the slider range; preserved until edited.';
  }else if(field.kind==='boolean') {
    const input=decorate(document.createElement('input'));input.type='checkbox';input.checked=value===true;
    input.addEventListener('change',()=>commit(input.checked));controls.append(input);
  }else if(field.kind==='choice') {
    const input=decorate(document.createElement('select')),choices=[...(field.choices??[])];
    if(!choices.some(choice=>JSON.stringify(choice.value)===JSON.stringify(value)))choices.unshift({label:reviewValue(field,draft.value,draft.catalog),value});
    choices.forEach((choice,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=choice.label;option.selected=JSON.stringify(choice.value)===JSON.stringify(value);input.append(option);});
    input.addEventListener('change',()=>commit(choices[Number(input.value)].value));controls.append(input);
  }else if(field.kind==='color') {
    const input=decorate(document.createElement('input'));input.type='color';input.value=hex(value as Rgb);
    input.addEventListener('input',()=>commit(rgb(input.value)));controls.append(input);
    const select=document.createElement('select');select.id=id+'-swatch';select.setAttribute('aria-label',field.label+' swatch');
    const choices=[...(field.choices??[])];if(!choices.some(choice=>JSON.stringify(choice.value)===JSON.stringify(value)))choices.unshift({label:'Custom color',value});
    choices.forEach((choice,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=choice.label;option.selected=JSON.stringify(choice.value)===JSON.stringify(value);select.append(option);});
    select.addEventListener('change',()=>{const color=choices[Number(select.value)].value as Rgb;input.value=hex(color);commit(color);});controls.append(select);
  }else {
    const input=decorate(document.createElement('input'));input.type='text';input.value=String(value);if(field.max)input.maxLength=field.max;
    input.addEventListener('change',()=>commit(input.value));controls.append(input);
  }
  const random=document.createElement('button');random.id=id+'-random';random.type='button';random.textContent='Random';random.disabled=!applicable||capped||severityLocked||draft.locks.has(field.id);random.setAttribute('aria-label',field.label+': randomize');
  if(capped)random.setAttribute('aria-describedby',traitLimitDescriptionId);
  random.addEventListener('click',()=>{try{draft.randomize(field.id);changed(true);}catch(error){fail(error);}});
  const lock=document.createElement('button');lock.id=id+'-lock';lock.type='button';lock.className='creator-lock';lock.textContent=draft.locks.has(field.id)?'Locked':'Lock';
  lock.setAttribute('aria-pressed',String(draft.locks.has(field.id)));lock.setAttribute('aria-label',field.label+': protect from randomization');
  lock.addEventListener('click',()=>{draft.lock(field.id,!draft.locks.has(field.id));lock.textContent=draft.locks.has(field.id)?'Locked':'Lock';lock.setAttribute('aria-pressed',String(draft.locks.has(field.id)));random.disabled=!applicable||capped||severityLocked||draft.locks.has(field.id);changed(true);});
  row.append(random,lock);return row;
}
