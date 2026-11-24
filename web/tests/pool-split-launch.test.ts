import {expect,it} from 'vitest';
import motion from '../../assets/models/sims/character-creator/pool_activity_motion_v18.json';
import contacts from '../../assets/models/sims/character-creator/clips/pool/contacts-v7.json?raw';
import {validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';
import {openingPolicy,type OpeningFlight} from '../src/render/character/pool-opening-flight.js';

it('retains both installed soles where the outside climb becomes a split-level jump',()=>{
 const def:unknown=structuredClone(motion);validatePoolCycleDefinition(def);
 if(def.version!==16||def.forwardHop?.launchFromUnit!==42000)throw new Error('Expected the split-level source.');
 const fixture=parseOwnedPoolFixture(contacts),step:OpeningFlight={kind:'crest-landing-step',limb:'footR',from:'outside2',to:'crest',startUnit:32000,endUnit:42000};
 expect(()=>openingPolicy(step,fixture,def,.42)).not.toThrow();
 const claimed=structuredClone(def);
 claimed.forwardHop!.footTransitions.find(t=>t.limb==='footL'&&t.from==='outside3')!.startUnit=42000;
 expect(()=>openingPolicy(step,fixture,claimed,.42)).toThrow('lost its installed supporting foot');
});
