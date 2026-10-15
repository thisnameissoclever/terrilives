import { floatBits, floatValue, validateDraftStructure, type CharacterDraftV1, type F32Bits } from './schema.js';
import type { CharacterCatalog, HouseholdChoice } from './catalog.js';

/** New choices use editor domains; untouched valid historical values remain exact. */
export function validateDraft(value:unknown,catalog:CharacterCatalog,original?:CharacterDraftV1,
  household?:readonly HouseholdChoice[],person?:number):CharacterDraftV1 {
  const draft=validateDraftStructure(value);
  if(Array.from(draft.name.trim()).length>catalog.name_limit&&draft.name!==original?.name)throw new Error(`Name must fit within ${catalog.name_limit} characters.`);
  const bounded=(value:F32Bits,low:number,high:number,old:F32Bits|undefined,path:string,authored:readonly F32Bits[]=[])=>{
    const number=floatValue(value);if((number<low||number>high)&&value!==old&&!authored.includes(value))throw new Error(`Invalid ${path}.`);
  };
  for(let i=0;i<7;i++){
    bounded(draft.behavior.drain[i],.5,1.5,original?.behavior.drain[i],`behavior.drain.${i}`,catalog.personalities.map(p=>p.values.drain[i]));
    bounded(draft.behavior.recovery[i],.5,1.5,original?.behavior.recovery[i],`behavior.recovery.${i}`,catalog.personalities.map(p=>p.values.recovery[i]));
  }
  const offset=draft.behavior.chronotype_offset_ticks;
  if((offset < -180||offset>180||offset%30!==0)&&offset!==original?.behavior.chronotype_offset_ticks&&!catalog.personalities.some(p=>p.values.chronotype_offset_ticks===offset))throw new Error('Invalid sleep timing.');
  for(const route of draft.behavior.dispositions){
    if(!catalog.activities.some(a=>a.object===route.object&&a.action===route.action))throw new Error('Unknown activity inclination.');
    bounded(route.weight,0,2,original?.behavior.dispositions.find(a=>a.object===route.object&&a.action===route.action)?.weight,'activity inclination',
      catalog.personalities.flatMap(p=>p.values.dispositions.filter(a=>a.object===route.object&&a.action===route.action).map(a=>a.weight)));
  }
  if(draft.traits.length>catalog.max_traits&&!draft.traits.every(trait=>original?.traits.some(old=>old.id===trait.id)))throw new Error(`Choose at most ${catalog.max_traits} traits.`);
  for(const trait of draft.traits){
    const definition=catalog.traits.find(t=>t.id===trait.id);if(!definition)throw new Error(`Unknown trait: ${trait.id}.`);
    if(!Number.isFinite(floatValue(trait.state))||floatValue(trait.state)<0||floatValue(trait.state)>1
      ||definition.kind==='disposition'&&floatValue(trait.state)!==0)throw new Error(`Invalid trait state: ${trait.id}.`);
  }
  if(draft.affinities.length!==catalog.affinities.length||draft.affinities.some(a=>!catalog.affinities.some(d=>d.id===a.id)))throw new Error('Unknown or missing environmental preference.');
  if(draft.hobbies.some(id=>!catalog.hobbies.some(h=>h.id===id)&&!original?.hobbies.includes(id)))throw new Error('Unknown hobby.');
  for(const skill of draft.skills){
    const definition=catalog.skills.find(s=>s.id===skill.id);if(!definition)throw new Error(`Unknown skill: ${skill.id}.`);
    bounded(skill.practice,0,floatValue(definition.thresholds.at(-1)??floatBits(0)),original?.skills.find(s=>s.id===skill.id)?.practice,'skill practice');
    if(skill.practice!==original?.skills.find(s=>s.id===skill.id)?.practice&&!definition.thresholds.includes(skill.practice))throw new Error('Choose a content-defined skill level.');
  }
  if(household)for(const [id] of draft.ties)if(id===person||!household.some(member=>member.sim_id===id))throw new Error('Unknown relative or self relationship.');
  return draft;
}
