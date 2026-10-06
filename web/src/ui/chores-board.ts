import {CHORE_LABELS} from './object-menu.js';

export interface ChoresSource {
  choreLocation(kind:number,target:number):string;choreRows():Uint32Array;choreHistory():Uint32Array;choreProfileOf(person:number):Int32Array;
  choreBoardEnabled():boolean;setChoreBoard(enabled:boolean):boolean;
  setChoreProfile(person:number,responsibility:number,preferences:readonly number[]):boolean;
  cleanChore(person:number,kind:number,target:number,first:boolean):boolean;
  selectedIndex():number|null;ids():Uint32Array;simIds():Uint32Array;kinds():Uint32Array;positions():Float32Array;
  simName(person:number):string;entityName(entity:number):string;clockTick():number;dayTicks():number;lotWidth():number;
}
export const DUTY_LABELS=['Pending','No work needed','Plans to do it','Skipped today','Done','Covered by a housemate','Missed','Unavailable'] as const;

export function decodeChoreRows(rows:Uint32Array){
  if(rows.length%5!==0)throw new Error('Chore board rows are incomplete');
  const out=[];for(let i=0;i<rows.length;i+=5){if(rows[i]>5||rows[i+3]>1000||rows[i+4]>=DUTY_LABELS.length)throw new Error('Chore board row is invalid');out.push({kind:rows[i],target:rows[i+1],owner:rows[i+2],dirt:rows[i+3],outcome:rows[i+4]});}return out;
}

export function decodeChoreHistory(rows:Uint32Array){
  if(rows.length%8!==0)throw new Error('Chore history rows are incomplete');
  const out=[];for(let i=0;i<rows.length;i+=8){const day=rows[i]+rows[i+1]*4294967296;
    if(!Number.isSafeInteger(day)||rows[i+2]>5||rows[i+6]>=DUTY_LABELS.length||rows[i+7]>1)throw new Error('Chore history row is invalid');
    out.push({day,kind:rows[i+2],target:rows[i+3],owner:rows[i+4],performer:rows[i+5],outcome:rows[i+6],settled:rows[i+7]===1});
  }return out;
}

export class ChoresBoard {
  private readonly root:HTMLElement;private readonly table:HTMLElement;private readonly week:HTMLElement;
  private readonly enabled:HTMLInputElement;private readonly person:HTMLElement;private readonly inputs:HTMLInputElement[];
  private readonly status:HTMLElement;private readonly history:HTMLElement;
  private readonly outcomes:HTMLElement;
  private selected:number|null=null;private draft=false;private signature='';
  constructor(private readonly source:ChoresSource,doc:Document,private readonly afterOrder:()=>void=()=>{}){
    this.root=doc.createElement('section');this.root.className='chores-board';
    this.week=doc.createElement('p');this.table=doc.createElement('div');this.table.className='chore-rows';
    const label=doc.createElement('label');this.enabled=doc.createElement('input');this.enabled.type='checkbox';
    label.append(this.enabled,doc.createTextNode(' Automatic weekly assignments'));this.enabled.addEventListener('change',()=>{this.source.setChoreBoard(this.enabled.checked);this.signature='';});
    this.person=doc.createElement('h3');this.history=doc.createElement('p');this.status=doc.createElement('p');this.status.setAttribute('role','status');
    const note=doc.createElement('p');note.textContent='Select a Sim to edit responsibility and chore preferences. Positive preferences mean enjoyment; negative preferences mean dislike. Changes affect future daily decisions.';
    const fields=doc.createElement('fieldset');this.inputs=[];
    for(const [i,name] of ['Responsibility','Dishes preference','Floor cleaning preference','Surface wiping preference','Bin emptying preference'].entries()){
      const label=doc.createElement('label');label.textContent=name;const input=doc.createElement('input');input.type='number';input.min=i===0?'0':'-100';input.max='100';input.step='1';input.setAttribute('aria-label',name);input.addEventListener('input',()=>{this.draft=true;});label.append(input);fields.append(label);this.inputs.push(input);
    }
    const apply=doc.createElement('button');apply.type='button';apply.className='hud-button';apply.textContent='Apply preferences';apply.addEventListener('click',()=>{
      const selected=this.source.selectedIndex();if(selected===null)return;const values=this.inputs.map(i=>Number(i.value));
      if(values.some((v,i)=>!Number.isInteger(v)||v>(100)||v<(i===0?0:-100))){this.status.textContent='Use whole numbers within the displayed ranges.';return;}
      const accepted=this.source.setChoreProfile(selected,values[0],values.slice(1));this.status.textContent=accepted?'Preference changes queued.':'Those changes could not be sent.';if(accepted)this.draft=false;
    });fields.append(apply);
    const past=doc.createElement('details');const summary=doc.createElement('summary');summary.textContent='Recent daily outcomes';
    this.outcomes=doc.createElement('div');past.append(summary,this.outcomes);
    this.root.append(this.week,label,this.table,past,this.person,note,this.history,fields,this.status);
  }
  element(){return this.root;}
  update(){
    const rows=decodeChoreRows(this.source.choreRows());const episodes=decodeChoreHistory(this.source.choreHistory());const selected=this.source.selectedIndex();const profile=selected===null?new Int32Array():this.source.choreProfileOf(selected);
    const ids=Array.from(this.source.ids()),simIds=Array.from(this.source.simIds()),kinds=Array.from(this.source.kinds());
    const names=new Map<number,string>();for(let i=0;i<ids.length;i++)if(kinds[i]===0)names.set(simIds[i],this.source.simName(ids[i]));
    this.week.textContent=`Week ${Math.floor(this.source.clockTick()/this.source.dayTicks()/7)+1} · Game time is paused while this panel is open.`;this.enabled.checked=this.source.choreBoardEnabled();
    if(selected!==this.selected){this.draft=false;this.selected=selected;}
    this.person.textContent=selected===null?'Select a Sim':this.source.simName(selected);
    this.history.textContent=profile.length===6?`Commitment history score: ${profile[1]}/100 (starts at 50)`:'Chore profile unavailable';
    if(!this.draft&&profile.length===6){this.inputs[0].value=String(profile[0]);for(let i=1;i<5;i++)this.inputs[i].value=String(profile[i+1]);}
    this.inputs.forEach(i=>{i.disabled=selected===null;});
    const signature=JSON.stringify([rows,episodes,[...names],selected]);if(signature===this.signature)return;this.signature=signature;this.table.replaceChildren();
    this.outcomes.replaceChildren();for(const e of episodes){
      const line=this.root.ownerDocument.createElement('p');line.textContent=`Day ${e.day+1}: ${CHORE_LABELS[e.kind]} · ${names.get(e.owner)??'Former housemate'} · ${DUTY_LABELS[e.outcome]}${e.performer===4294967295?'':` · Performed by ${names.get(e.performer)??'Former housemate'}`}`;
      this.outcomes.append(line);
    }
    for(const row of rows){
      const line=this.root.ownerDocument.createElement('div');line.className='chore-row';const title=this.root.ownerDocument.createElement('strong');
      const location=this.source.choreLocation(row.kind,row.target);
      title.textContent=`${CHORE_LABELS[row.kind]}${row.kind===0?"":` in ${location}`}`;const detail=this.root.ownerDocument.createElement('span');detail.textContent=`${names.get(row.owner)??'Unassigned'} · ${DUTY_LABELS[row.outcome]} · ${row.kind===0?'Dirty dishes':row.kind===3?'Bin fill':'Grime'}: ${Math.round(row.dirt/10)}%`;
      const button=this.root.ownerDocument.createElement('button');button.type='button';button.className='hud-button chore-do-now';button.textContent='Do now';button.disabled=selected===null||row.dirt===0;button.addEventListener('click',()=>{const actor=this.source.selectedIndex();if(actor!==null&&this.source.cleanChore(actor,row.kind,row.target,true))this.afterOrder();});line.append(title,detail,button);this.table.append(line);
    }
  }
}
