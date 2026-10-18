import type { CharacterCatalog } from './catalog.js';
import { floatBits, floatValue, type CharacterDraftV1 } from './schema.js';

type Route = readonly [object:string,action:string];
export interface ActivityCategory { id:string; label:string; routes:readonly Route[] }

/** Explicit model/action identities keep content changes from silently changing a category. */
export const activityCategories:readonly ActivityCategory[]=[
  {id:'eat',label:'Eat & cook',routes:[['fridge','grab_snack'],['fridge','cook_dinner'],['dining_table','sit_properly'],['dining_table','take_prepared_food']]},
  {id:'sleep',label:'Sleep',routes:[['bed','sleep'],['double_bed','sleep_properly']]},
  {id:'wash',label:'Wash & bathroom',routes:[['shower','take_shower'],['toilet','relieve_self'],['sink','wash_hands'],['kitchen_sink','wash_up'],['bathtub','soak']]},
  {id:'relax',label:'Relax',routes:[['sofa','lounge'],['chair','sit'],['long_sofa','stretch_out'],['long_sofa','sit'],['armchair','take_the_chair'],['desk_chair','sit'],['reading_chair','sit'],['pool_lounger','sit']]},
  {id:'read',label:'Read',routes:[['sofa','read'],['bookshelf','read'],['chair','read'],['long_sofa','read'],['armchair','read'],['desk_chair','read'],['reading_chair','settle_in']]},
  {id:'television',label:'Watch TV',routes:[['television','watch_tv']]},
  {id:'music',label:'Listen to music',routes:[['radio','listen']]},
  {id:'exercise',label:'Exercise',routes:[['moving_box','use_exercise_bike']]},
  {id:'letters',label:'Write letters',routes:[['desk','attend_correspondence']]},
  {id:'fish',label:'Watch fish',routes:[['reference_shelf','watch_fish']]},
];

export const hiddenActivityRoutes:readonly Route[]=[['kitchen_sink','clean_dishes']];
export const matchesRoute=(route:{object:string;action:string},[object,action]:Route):boolean=>route.object===object&&route.action===action;
export function categoryMembers(category:ActivityCategory,catalog:CharacterCatalog):CharacterCatalog['activities'] {
  return catalog.activities.filter(route=>category.routes.some(pair=>matchesRoute(route,pair)));
}
export function unsupportedActivityRoutes(catalog:CharacterCatalog):CharacterCatalog['activities'] {
  const mapped=[...activityCategories.flatMap(category=>category.routes),...hiddenActivityRoutes];
  return catalog.activities.filter(route=>!mapped.some(pair=>matchesRoute(route,pair)));
}
export function categoryAverage(draft:CharacterDraftV1,category:ActivityCategory,catalog:CharacterCatalog):number {
  const members=categoryMembers(category,catalog);
  if(!members.length)return 1;
  return members.reduce((sum,route)=>sum+floatValue(draft.behavior.dispositions.find(row=>matchesRoute(row,[route.object,route.action]))?.weight??floatBits(1)),0)/members.length;
}
