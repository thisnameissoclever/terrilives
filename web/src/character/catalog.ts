import type { CharacterBehaviorDraft, F32Bits } from './schema.js';

export interface CharacterCatalog {
  version:1;
  name_limit:number;
  max_traits:number;
  max_household:number;
  traits:{id:string;label:string;description:string;kind:'disposition'|'capability'|'condition';initial_state:F32Bits;weights:{tag:string;value:F32Bits}[]}[];
  affinities:{id:string;label:string;description:string}[];
  skills:{id:string;label:string;description:string;thresholds:F32Bits[]}[];
  hobbies:{id:string;label:string}[];
  activities:{object:string;action:string;label:string;tags:string[]}[];
  personalities:{id:string;label:string;description:string;values:Pick<CharacterBehaviorDraft,'cleanliness'|'chronotype_offset_ticks'|'drain'|'recovery'|'dispositions'>}[];
}
export interface HouseholdChoice {sim_id:number;name:string}
