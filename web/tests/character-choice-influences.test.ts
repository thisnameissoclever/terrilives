import { creationInstinctBands } from './helpers/creation-instinct-bands.js';
import {expect,it} from 'vitest';
import {choiceInfluences} from '../src/character/choice-influences.js';
import {floatBits,neutralDraft} from '../src/character/schema.js';
import type {CharacterCatalog} from '../src/character/catalog.js';
const catalog:CharacterCatalog={version:1,name_limit:24,max_traits:4,max_household:6,self_preservation_bands:creationInstinctBands,affinities:[],skills:[],personalities:[],hobbies:[{id:'chat',label:'Conversation'}],
 traits:[{id:'keen',label:'Keen',description:'',kind:'disposition',initial_state:floatBits(0),weights:[{tag:'television',value:floatBits(1.5)}]},
 {id:'averse',label:'Averse',description:'',kind:'disposition',initial_state:floatBits(0),weights:[{tag:'television',value:floatBits(.5)}]},
 {id:'chatty',label:'Chatty',description:'',kind:'disposition',initial_state:floatBits(0),weights:[{tag:'chat',value:floatBits(1.25)}]}],
 activities:[{object:'tv',action:'watch',label:'Watch television',tags:['television']}]};
it('multiplies opposing traits and the explicit activity weight without changing the draft',()=>{
 const draft=neutralDraft('Custom');draft.traits=[{id:'averse',state:floatBits(0)},{id:'keen',state:floatBits(0)}];
 draft.behavior.dispositions=[{object:'tv',action:'watch',weight:floatBits(1.2)}];draft.affinities=[{id:'television',value:floatBits(-1)}];const before=structuredClone(draft);
 const [row]=choiceInfluences(draft,catalog);
 expect(row.traitMultiplier).toBe(.75);expect(row.activityWeight).toBe(Math.fround(1.2));expect(row.combined).toBe(Math.fround(Math.fround(1.2)*.75));
 expect(row.contributors).toEqual(['Keen','Averse']);expect(draft).toEqual(before);
});
it('keeps zero activity weights and shows traits affecting non-object activities',()=>{
 const draft=neutralDraft('Custom');draft.traits=catalog.traits.map(trait=>({id:trait.id,state:floatBits(0)}));draft.behavior.dispositions=[{object:'tv',action:'watch',weight:floatBits(0)}];
 const rows=choiceInfluences(draft,catalog);expect(rows[0].combined).toBe(0);expect(rows[1]).toMatchObject({label:'Conversation activities',activityWeight:null,combined:1.25});
});
