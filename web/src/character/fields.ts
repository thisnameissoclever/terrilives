import { appearanceChoices, bodyFields, colorFields, faceSliders, floatBits, floatValue,
  neutralDraft, type CharacterDraftV1, type F32Bits, type Rgb } from './schema.js';
import type { CharacterCatalog, HouseholdChoice } from './catalog.js';
import { activityCategories, categoryAverage, categoryMembers, matchesRoute } from './activity-categories.js';

export type Section='identity'|'appearance'|'personality'|'needs'|'interests'|'household';
export type FieldValue=string|number|boolean|Rgb|null;
export interface FieldChoice {label:string;value:FieldValue}
export interface CharacterField {
  id:string;section:Section;group:string;label:string;description:string;
  kind:'text'|'number'|'float'|'choice'|'boolean'|'color';
  min?:number;max?:number;step?:number;display_scale?:number;choices?:readonly FieldChoice[];
  unit?:'%'|'hours'|'×';
  extraValues?:readonly FieldValue[];
  applicable?:(draft:CharacterDraftV1)=>boolean;
  get:(draft:CharacterDraftV1)=>FieldValue;
  set:(draft:CharacterDraftV1,value:FieldValue)=>void;
  restore?:(draft:CharacterDraftV1,initial:CharacterDraftV1)=>void;
}

const label=(id:string)=>id.replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
const options=(values:readonly string[]):FieldChoice[]=>values.map(value=>({label:({laceups:'Lace-up shoes',tshirt:'T-shirt'} as Record<string,string>)[value]??label(value),value}));
function pathField(path:string,section:Section,group:string,name:string,kind:CharacterField['kind'],description='',extra:Partial<CharacterField>={}):CharacterField {
  const keys=path.split('.');
  return {id:path,section,group,label:name,kind,description,...extra,
    get:draft=>keys.reduce((value,key)=>(value as Record<string,unknown>)[key],draft as unknown) as FieldValue,
    set:(draft,value)=>{
      const parent=keys.slice(0,-1).reduce((value,key)=>(value as Record<string,unknown>)[key],draft as unknown) as Record<string,unknown>;
      parent[keys.at(-1)!]=structuredClone(value);
    }};
}
function upsert<T>(rows:T[],match:(row:T)=>boolean,value:T):void {
  const index=rows.findIndex(match);if(index<0)rows.push(value);else rows[index]=value;
}
const scalarRange={min:0,max:100,step:1};
export const needLabels=['Hunger','Energy','Hygiene','Bladder','Social','Fun','Comfort'] as const;
const bodyLabels={height:'Height',build:'Build',shoulders:'Shoulder width',hips:'Hip width',torso:'Torso proportions'};
const faceLabels={cheeks:'Cheek fullness',jaw:'Jaw width',chin:'Chin length',eye_size:'Eye size',brow_thickness:'Eyebrow thickness',nose_width:'Nose width',mouth_fullness:'Mouth fullness',ears:'Ear size'};
const choiceLabels:Readonly<Record<string,string>>={'face.shape':'Face shape','face.eyes':'Eye shape','face.brows':'Eyebrow shape','face.nose':'Nose shape','face.mouth':'Mouth shape',undertone:'Skin undertone',hairstyle:'Hairstyle',footwear:'Shoes'};

/** Swatches are the randomization domain; saved custom colors remain exact. */
export const colorSwatches:Readonly<Record<string,readonly string[]>>={
  skin:['#efd4bc','#d7ae8d','#be8f6b','#a87552','#855a40','#69462f','#503522','#35241c'],
  hair:['#211b19','#65452e','#997146','#d1b777','#a95a36','#a6a09b','#dfded5','#54364d'],
  facial_hair:['#211b19','#65452e','#997146','#d1b777','#a95a36','#a6a09b','#dfded5','#54364d'],
  eyes:['#463020','#665b45','#42745e','#4e7f9f','#747d83','#816956'],
  shirt:['#6b9f9b','#456a99','#b37150','#b5954b','#b7b7ad','#78815f','#824d69','#ded4c3'],
  trousers:['#394650','#38465f','#55504b','#69665e','#443f42','#96714f'],
  shoes:['#4c4037','#242528','#716052','#a0907e','#d6d0c4','#524e68'],
};
const colorNames:Readonly<Record<string,readonly string[]>>={
  skin:['Light peach','Warm beige','Golden tan','Warm brown','Umber','Deep brown','Dark brown','Deep umber'],
  hair:['Near black','Chestnut','Honey brown','Blond','Copper','Grey','Silver','Plum'],
  facial_hair:['Near black','Chestnut','Honey brown','Blond','Copper','Grey','Silver','Plum'],
  eyes:['Brown','Hazel','Green','Blue','Grey','Amber'],
  shirt:['Sage','Blue','Terracotta','Ochre','Grey','Olive','Plum','Cream'],
  trousers:['Slate','Navy','Taupe','Stone','Charcoal','Tan'],
  shoes:['Brown','Black','Walnut','Sand','Ivory','Slate violet'],
};
export function rgb(hex:string):Rgb {
  if(!/^#[0-9a-f]{6}$/i.test(hex))throw new Error('Invalid color.');
  return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
}
export function hex(color:Rgb):string {return '#'+color.map(channel=>channel.toString(16).padStart(2,'0')).join('');}

export function characterFields(catalog:CharacterCatalog,household:readonly HouseholdChoice[],person?:number):CharacterField[] {
  const fields:CharacterField[]=[
    pathField('name','identity','Identity','Name','text','',{max:catalog.name_limit}),
  ];
  for(const [path,values] of Object.entries(appearanceChoices)){
    const group=path==='presentation'?'Body':path.startsWith('face.')?'Face':['scar','glasses_style','earrings'].includes(path)?'Details':path==='undertone'?'Colors':'Style';
    const field=pathField('appearance.'+path,'appearance',group,path==='presentation'?'Gender':choiceLabels[path]??label(path.replace('face.','')),'choice','',
      {choices:path==='presentation'?[{label:'Male',value:'masculine'},{label:'Female',value:'feminine'}]:options(values)});
    if(path==='hairstyle'){
      field.choices=[...options(values),{label:'Bald',value:'bald'}];
      field.get=draft=>draft.appearance.bald?'bald':draft.appearance.hairstyle;
      field.set=(draft,value)=>{draft.appearance.bald=value==='bald';if(value!=='bald')draft.appearance.hairstyle=String(value);};
      field.restore=(draft,initial)=>{draft.appearance.bald=initial.appearance.bald;draft.appearance.hairstyle=initial.appearance.hairstyle;};
    }
    fields.push(field);
  }
  for(const key of bodyFields)fields.push(pathField('appearance.body.'+key,'appearance','Body',bodyLabels[key],'number',
    key==='height'?'50 is average height; 0 and 100 are 15% shorter and taller.':
      key==='build'?'Torso fullness and limb thickness.':'Relative to the selected gender preset.',scalarRange));
  for(const key of faceSliders)fields.push(pathField('appearance.face.'+key,'appearance','Face',faceLabels[key],'number','',scalarRange));
  fields.push(pathField('appearance.freckles','appearance','Details','Freckles','boolean'));
  fields.push(pathField('appearance.freckle_density','appearance','Details','Freckle density','number','',{...scalarRange,step:5,applicable:draft=>draft.appearance.freckles}));
  fields.push(pathField('appearance.glasses','appearance','Details','Glasses','boolean'));
  for(const key of colorFields)fields.push(pathField('appearance.colors.'+key,'appearance',['shirt','trousers','shoes'].includes(key)?'Style':'Colors',
    ({shirt:'Top',trousers:'Bottoms',shoes:'Shoes'} as Record<string,string>)[key]?.concat(' color')??label(key)+' color','color','',
    {choices:colorSwatches[key].map((value,index)=>({label:colorNames[key][index],value:rgb(value)}))}));
  fields.push(
    pathField('behavior.shyness','personality','Temperament','Shyness','number','Sets privacy boundaries, avoidance of occupied bathrooms, and reactions to unwanted interruptions.',{min:1,max:100,step:1}),
    pathField('behavior.cleanliness','personality','Temperament','Cleanliness','float','Affects tolerance for mess and willingness to clean.',{min:0,max:1,step:.01,display_scale:100,unit:'%'}),
    pathField('behavior.self_preservation','personality','Temperament','Self-preservation','number','Affects survival-risk adjustments to autonomous choices.',scalarRange),
    pathField('behavior.chronotype_offset_ticks','needs','Sleep timing','Sleep timing','number','Earlier (-) or later (+) in the daily rhythm.',{min:-180,max:180,step:30,display_scale:1/60,unit:'hours'}),
  );
  for(const key of ['drain','recovery'] as const)for(let index=0;index<7;index++)fields.push(pathField(`behavior.${key}.${index}`,'needs','Advanced need rates',`${needLabels[index]} ${key}`,'float',
    key==='drain'?'Higher values make this need fall faster. 100% is ordinary.':'Higher values restore more of this need during an activity. 100% is ordinary.',{min:.5,max:1.5,step:.01,display_scale:100,unit:'%'}));
  for(const category of activityCategories){
    const members=categoryMembers(category,catalog);if(!members.length)continue;
    const matches=(row:{object:string;action:string})=>members.some(route=>matchesRoute(row,[route.object,route.action]));
    fields.push({id:'activity-category:'+category.id,section:'needs',group:'Activity preferences',label:category.label,kind:'number',min:0,max:2,step:.01,unit:'×',
      description:'',
      get:draft=>categoryAverage(draft,category,catalog),
      set:(draft,value)=>{for(const route of members)upsert(draft.behavior.dispositions,row=>matchesRoute(row,[route.object,route.action]),{object:route.object,action:route.action,weight:floatBits(Number(value))});},
      restore:(draft,initial)=>{
        draft.behavior.dispositions=draft.behavior.dispositions.filter(row=>!matches(row));
        initial.behavior.dispositions.forEach((row,index)=>{if(matches(row))draft.behavior.dispositions.splice(Math.min(index,draft.behavior.dispositions.length),0,structuredClone(row));});
      }});
  }
  for(const trait of catalog.traits) {
    fields.push({id:JSON.stringify(['trait',trait.id]),section:'personality',group:trait.kind==='condition'?'Conditions':'Traits',label:trait.label,description:trait.description,kind:'boolean',
      get:draft=>draft.traits.some(t=>t.id===trait.id),set:(draft,value)=>{
        if(value){if(!draft.traits.some(t=>t.id===trait.id))draft.traits.push({id:trait.id,state:trait.initial_state});}
        else draft.traits=draft.traits.filter(t=>t.id!==trait.id);
      }});
    if(trait.kind==='condition')fields.push({id:JSON.stringify(['severity',trait.id]),section:'personality',group:'Conditions',label:trait.label+' severity',description:'Current condition severity.',
      kind:'float',min:0,max:1,step:.01,display_scale:100,unit:'%',applicable:draft=>draft.traits.some(t=>t.id===trait.id),
      get:draft=>draft.traits.find(t=>t.id===trait.id)?.state??trait.initial_state,
      set:(draft,value)=>{const row=draft.traits.find(t=>t.id===trait.id);if(!row)throw new Error('Select the condition before setting its severity.');row.state=value as F32Bits;}});
  }
  for(const affinity of catalog.affinities)fields.push({id:JSON.stringify(['affinity',affinity.id]),section:'interests',group:'Surroundings',label:affinity.label,description:affinity.description+' -1 is strong dislike, 0 is neutral, 1 is strong liking.',
    kind:'float',min:-1,max:1,step:.01,get:draft=>draft.affinities.find(a=>a.id===affinity.id)?.value??floatBits(0),
    set:(draft,value)=>upsert(draft.affinities,a=>a.id===affinity.id,{id:affinity.id,value:value as F32Bits})});
  for(const hobby of catalog.hobbies)fields.push({id:JSON.stringify(['hobby',hobby.id]),section:'interests',group:'Hobbies',label:hobby.label,description:'',kind:'boolean',
    get:draft=>draft.hobbies.includes(hobby.id),set:(draft,value)=>{draft.hobbies=draft.hobbies.filter(id=>id!==hobby.id);if(value)draft.hobbies.push(hobby.id);}});
  for(const skill of catalog.skills)fields.push({id:JSON.stringify(['skill',skill.id]),section:'interests',group:'Skills',label:skill.label,description:skill.description,kind:'choice',
    choices:skill.thresholds.map((value,index)=>({label:index===0?'Unpracticed':`Level ${index}`,value})),
    get:draft=>draft.skills.find(s=>s.id===skill.id)?.practice??floatBits(0),
    set:(draft,value)=>upsert(draft.skills,s=>s.id===skill.id,{id:skill.id,practice:value as F32Bits})});
  for(const member of household)if(member.sim_id!==person)fields.push({id:JSON.stringify(['tie',member.sim_id]),section:'household',group:'Household',label:'Relationship to '+member.name,
    description:'The relationship is recorded for both people.',kind:'choice',choices:[{label:'None',value:null},...['Partner','Parent','Child','Sibling'].map((label,value)=>({label,value}))],
    get:draft=>draft.ties.find(([id])=>id===member.sim_id)?.[1]??null,
    set:(draft,value)=>{const row=draft.ties.find(t=>t[0]===member.sim_id);if(row)row[1]=value as number|null;else draft.ties.push([member.sim_id,value as number|null]);}});
  for(const field of fields)if(['personality','needs'].includes(field.section)&&!field.id.startsWith('activity-category:')&&field.min!==undefined&&field.max!==undefined&&field.step){
    const extras:FieldValue[]=[];
    for(const preset of catalog.personalities){
      const draft=neutralDraft('Preset');Object.assign(draft.behavior,preset.values);
      const value=field.get(draft),numeric=field.kind==='float'?floatValue(value as F32Bits):Number(value);
      const closest=field.min+Math.round((numeric-field.min)/field.step)*field.step;
      if((numeric<field.min||numeric>field.max||Math.abs(numeric-closest)>1e-6)&&!extras.includes(value))extras.push(value);
    }
    field.extraValues=extras;
  }
  return fields;
}

export function displayValue(field:CharacterField,value:FieldValue):FieldValue {
  const scalar=field.kind==='float'?floatValue(value as F32Bits):value;
  return typeof scalar==='number'&&field.display_scale?scalar*field.display_scale:scalar;
}
