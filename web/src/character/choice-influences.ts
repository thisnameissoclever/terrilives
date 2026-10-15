import {floatValue,type CharacterDraftV1} from './schema.js';
import type {CharacterCatalog} from './catalog.js';
import { activityCategories, categoryMembers } from './activity-categories.js';

export interface ChoiceInfluence {
  label:string;
  contributors:string[];
  traitMultiplier:number;
  activityWeight:number|null;
  combined:number;
}

/** Average each route's actual product; the product of two averages is different. */
export function categoryInfluence(draft:CharacterDraftV1,catalog:CharacterCatalog,id:string):ChoiceInfluence {
  const category=activityCategories.find(category=>category.id===id);
  if(!category)throw new Error('Unknown activity category.');
  const members=categoryMembers(category,catalog),selected=new Set(draft.traits.map(trait=>trait.id));
  const traits=catalog.traits.filter(trait=>trait.kind==='disposition'&&selected.has(trait.id));
  const contributors=new Set<string>();let totalWeight=0,totalMultiplier=0,totalCombined=0;
  for(const route of members){
    let multiplier=1;
    for(const trait of traits)for(const weight of trait.weights)if(route.tags.includes(weight.tag)){
      multiplier=Math.fround(multiplier*floatValue(weight.value));contributors.add(trait.label);
    }
    const stored=draft.behavior.dispositions.find(row=>row.object===route.object&&row.action===route.action);
    const weight=stored?floatValue(stored.weight):1;
    totalWeight+=weight;totalMultiplier+=multiplier;totalCombined+=Math.fround(weight*multiplier);
  }
  const count=members.length||1;
  return {label:category.label,contributors:[...contributors],activityWeight:totalWeight/count,traitMultiplier:totalMultiplier/count,combined:totalCombined/count};
}

/** Match native disposition multiplication; room preferences are a separate mechanism. */
export function choiceInfluences(draft:CharacterDraftV1,catalog:CharacterCatalog):ChoiceInfluence[]{
  const selected=new Set(draft.traits.map(trait=>trait.id));
  const traits=catalog.traits.filter(trait=>trait.kind==='disposition'&&selected.has(trait.id));
  const rows:ChoiceInfluence[]=[],represented=new Set<string>();
  for(const activity of catalog.activities){
    let multiplier=1;const contributors:string[]=[];
    for(const trait of traits)for(const weight of trait.weights)if(activity.tags.includes(weight.tag)){
      multiplier=Math.fround(multiplier*floatValue(weight.value));contributors.push(trait.label);represented.add(weight.tag);
    }
    if(!contributors.length)continue;
    const stored=draft.behavior.dispositions.find(row=>row.object===activity.object&&row.action===activity.action);
    const weight=stored?floatValue(stored.weight):1;
    rows.push({label:activity.label,contributors,traitMultiplier:multiplier,activityWeight:weight,combined:Math.fround(weight*multiplier)});
  }
  const otherTags=new Set(traits.flatMap(trait=>trait.weights.map(weight=>weight.tag)).filter(tag=>!represented.has(tag)));
  for(const tag of otherTags){
    let multiplier=1;const contributors:string[]=[];
    for(const trait of traits)for(const weight of trait.weights)if(weight.tag===tag){multiplier=Math.fround(multiplier*floatValue(weight.value));contributors.push(trait.label);}
    const label=catalog.hobbies.find(hobby=>hobby.id===tag)?.label??tag.replaceAll('_',' ');
    rows.push({label:label+' activities',contributors,traitMultiplier:multiplier,activityWeight:null,combined:multiplier});
  }
  return rows;
}
