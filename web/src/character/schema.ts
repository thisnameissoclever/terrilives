export type F32Bits = number & { readonly __f32: unique symbol };
export type Rgb = [number,number,number];
export type Presentation = 'masculine'|'feminine';

const numeric = new DataView(new ArrayBuffer(4));
export function floatBits(value:number):F32Bits {
  const rounded=Math.fround(value);
  if(!Number.isFinite(rounded))throw new Error('A finite numeric value is required.');
  numeric.setFloat32(0,rounded,true);return numeric.getUint32(0,true) as F32Bits;
}
export function floatValue(value:F32Bits):number {
  if(!Number.isInteger(value)||value<0||value>0xffffffff)throw new Error('Invalid stored numeric value.');
  numeric.setUint32(0,value,true);const result=numeric.getFloat32(0,true);
  if(!Number.isFinite(result))throw new Error('Invalid stored numeric value.');
  return result;
}

export interface CharacterAppearanceV1 {
  version:1;presentation:Presentation;
  body:{height:number;build:number;shoulders:number;hips:number;torso:number};
  face:{shape:string;cheeks:number;jaw:number;chin:number;eyes:string;eye_size:number;brows:string;brow_thickness:number;
    nose:string;nose_width:number;mouth:string;mouth_fullness:number;ears:number};
  colors:{skin:Rgb;hair:Rgb;facial_hair:Rgb;eyes:Rgb;shirt:Rgb;trousers:Rgb;shoes:Rgb};
  undertone:string;hairstyle:string;bald:boolean;facial_hair:string;freckles:boolean;freckle_density:number;
  scar:string;top:string;sleeves:string;bottoms:string;footwear:string;glasses:boolean;glasses_style:string;earrings:string;
}
export interface DispositionDraft {object:string;action:string;weight:F32Bits}
export interface TraitDraft {id:string;state:F32Bits}
export interface SkillDraft {id:string;practice:F32Bits}
export interface AffinityDraft {id:string;value:F32Bits}
export interface CharacterBehaviorDraft {
  shyness:number;cleanliness:F32Bits;self_preservation:number;chronotype_offset_ticks:number;
  drain:F32Bits[];recovery:F32Bits[];dispositions:DispositionDraft[];
}
export interface CharacterDraftV1 {
  version:1;name:string;pronouns:string;appearance:CharacterAppearanceV1;behavior:CharacterBehaviorDraft;
  traits:TraitDraft[];affinities:AffinityDraft[];hobbies:string[];skills:SkillDraft[];ties:[number,number|null][];
}
export type CharacterPatchV1 = {version:1}&Partial<Omit<CharacterDraftV1,'version'>>;

export const appearanceChoices:Readonly<Record<string,readonly string[]>>={
  presentation:['masculine','feminine'],'face.shape':['oval','round','angular'],'face.eyes':['almond','round','soft'],
  'face.brows':['soft','straight','arched'],'face.nose':['straight','button','broad'],'face.mouth':['neutral','upturned','full'],
  undertone:['neutral','warm','cool'],hairstyle:['curl','bob','wave','crop','quiff'],facial_hair:['none','stubble','moustache','beard'],
  scar:['none','brow','cheek'],top:['overshirt','tshirt','jacket'],sleeves:['rolled','long','short'],bottoms:['trousers','shorts'],
  footwear:['loafers','laceups','trainers'],glasses_style:['round','rectangular'],earrings:['none','studs','hoops'],
};
export const bodyFields=['height','build','shoulders','hips','torso'] as const;
export const faceSliders=['cheeks','jaw','chin','eye_size','brow_thickness','nose_width','mouth_fullness','ears'] as const;
export const colorFields=['skin','hair','facial_hair','eyes','shirt','trousers','shoes'] as const;
export const draftGroups=['name','pronouns','appearance','behavior','traits','affinities','hobbies','skills','ties'] as const;

export function defaultAppearance(presentation:Presentation='masculine'):CharacterAppearanceV1 {
  return {version:1,presentation,body:{height:50,build:50,shoulders:50,hips:50,torso:50},
    face:{shape:'oval',cheeks:50,jaw:50,chin:50,eyes:'almond',eye_size:50,brows:'soft',brow_thickness:50,
      nose:'straight',nose_width:50,mouth:'neutral',mouth_fullness:50,ears:50},
    colors:{skin:[190,143,107],hair:[101,69,46],facial_hair:[101,69,46],eyes:[102,91,69],shirt:[107,159,155],trousers:[57,70,80],shoes:[76,64,55]},
    undertone:'neutral',hairstyle:presentation==='feminine'?'bob':'curl',bald:false,facial_hair:'none',freckles:false,freckle_density:50,
    scar:'none',top:'overshirt',sleeves:'rolled',bottoms:'trousers',footwear:'loafers',glasses:false,glasses_style:'round',earrings:'none'};
}
export function neutralDraft(name:string):CharacterDraftV1 {
  return {version:1,name,pronouns:'',appearance:defaultAppearance(),
    behavior:{shyness:50,cleanliness:floatBits(.5),self_preservation:50,chronotype_offset_ticks:0,
      drain:Array.from({length:7},()=>floatBits(1)),recovery:Array.from({length:7},()=>floatBits(1)),dispositions:[]},
    traits:[],affinities:[],hobbies:[],skills:[],ties:[]};
}

function object(value:unknown,keys:readonly string[],path:string):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Invalid ${path}.`);
  const row=value as Record<string,unknown>;
  for(const key of Object.keys(row))if(!keys.includes(key))throw new Error(`Unknown ${path}.${key}.`);
  for(const key of keys)if(!Object.hasOwn(row,key))throw new Error(`Missing ${path}.${key}.`);
  return row;
}
function integer(value:unknown,low:number,high:number,path:string):void {
  if(typeof value!=='number'||!Number.isInteger(value)||value<low||value>high)throw new Error(`Invalid ${path}.`);
}
function text(value:unknown,path:string,max=256,empty=false):asserts value is string {
  if(typeof value!=='string'||(!empty&&!value.trim())||Array.from(value).length>max)throw new Error(`Invalid ${path}.`);
}
function bits(value:unknown,path:string,low=0,high=3.4028234663852886e38):void {
  integer(value,0,0xffffffff,path);
  let n:number;try{n=floatValue(value as F32Bits);}catch{throw new Error(`Invalid ${path}.`);}
  if(n<low||n>high)throw new Error(`Invalid ${path}.`);
}
function list(value:unknown,path:string,maximum=4096):unknown[] {
  if(!Array.isArray(value)||value.length>maximum)throw new Error(`Invalid ${path}.`);return value;
}

export function validateAppearance(value:unknown):CharacterAppearanceV1 {
  const defaults=defaultAppearance(),row=object(value,Object.keys(defaults),'appearance');
  if(row.version!==1)throw new Error('Invalid appearance.version.');
  const body=object(row.body,bodyFields,'appearance.body');
  for(const key of bodyFields)integer(body[key],0,100,`appearance.body.${key}`);
  const face=object(row.face,Object.keys(defaults.face),'appearance.face');
  for(const key of faceSliders)integer(face[key],0,100,`appearance.face.${key}`);
  const colors=object(row.colors,colorFields,'appearance.colors');
  for(const key of colorFields){const rgb=list(colors[key],`appearance.colors.${key}`,3);if(rgb.length!==3)throw new Error(`Invalid appearance.colors.${key}.`);for(const channel of rgb)integer(channel,0,255,`appearance.colors.${key}`);}
  for(const [path,choices] of Object.entries(appearanceChoices)){
    const value=path.startsWith('face.')?face[path.slice(5)]:row[path];
    if(typeof value!=='string'||!choices.includes(value))throw new Error(`Invalid appearance.${path}.`);
  }
  for(const key of ['bald','freckles','glasses'])if(typeof row[key]!=='boolean')throw new Error(`Invalid appearance.${key}.`);
  integer(row.freckle_density,0,100,'appearance.freckle_density');
  return value as CharacterAppearanceV1;
}

export function validateDraftStructure(value:unknown):CharacterDraftV1 {
  const row=object(value,['version',...draftGroups],'draft');
  if(row.version!==1)throw new Error('Invalid draft.version.');
  text(row.name,'name');text(row.pronouns,'pronouns',64,true);validateAppearance(row.appearance);
  const behavior=object(row.behavior,Object.keys(neutralDraft('validation').behavior),'behavior');
  integer(behavior.shyness,1,100,'behavior.shyness');integer(behavior.self_preservation,0,100,'behavior.self_preservation');
  integer(behavior.chronotype_offset_ticks,-2147483648,2147483647,'behavior.chronotype_offset_ticks');
  bits(behavior.cleanliness,'behavior.cleanliness',0,1);
  for(const key of ['drain','recovery']) {
    const values=list(behavior[key],`behavior.${key}`,7);if(values.length!==7)throw new Error(`Invalid behavior.${key}.`);
    for(const v of values){bits(v,`behavior.${key}`);if(key==='recovery'&&floatValue(v as F32Bits)<=0)throw new Error('Invalid behavior.recovery.');}
  }
  const routes=new Set<string>();
  for(const v of list(behavior.dispositions,'behavior.dispositions')) {
    const route=object(v,['object','action','weight'],'behavior.dispositions');
    text(route.object,'behavior.dispositions.object');text(route.action,'behavior.dispositions.action');bits(route.weight,'behavior.dispositions.weight');
    const key=JSON.stringify([route.object,route.action]);if(routes.has(key))throw new Error('Duplicate behavior.dispositions.');routes.add(key);
  }
  for(const [group,field,low,high] of [['traits','state',0,3.4028234663852886e38],['skills','practice',0,3.4028234663852886e38],['affinities','value',-1,1]] as const) {
    const keys=new Set<string>();
    for(const v of list(row[group],group)) {
      const item=object(v,['id',field],group);text(item.id,group);bits(item[field],group,low,high);
      if(keys.has(item.id))throw new Error(`Duplicate ${group}.`);keys.add(item.id);
    }
  }
  const hobbies=list(row.hobbies,'hobbies');for(const hobby of hobbies)text(hobby,'hobbies');
  if(new Set(hobbies).size!==hobbies.length)throw new Error('Duplicate hobbies.');
  const relatives=new Set<number>();
  for(const item of list(row.ties,'ties',1024)) {
    const tie=list(item,'ties',2);if(tie.length!==2)throw new Error('Invalid ties.');
    integer(tie[0],0,0xffffffff,'ties.person');if(tie[1]!==null)integer(tie[1],0,3,'ties.relation');
    if(relatives.has(tie[0] as number))throw new Error('Duplicate ties.');relatives.add(tie[0] as number);
  }
  return value as CharacterDraftV1;
}

export function makePatch(original:CharacterDraftV1,changed:CharacterDraftV1):CharacterPatchV1 {
  validateDraftStructure(changed);
  const patch:CharacterPatchV1={version:1};
  for(const group of draftGroups)if(JSON.stringify(original[group])!==JSON.stringify(changed[group]))
    Object.assign(patch,{[group]:structuredClone(changed[group])});
  return patch;
}
