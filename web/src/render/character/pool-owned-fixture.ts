import type {PoolFixtureV1} from './pool-contact-types.js';
import {validatePoolFixture} from './pool-contact-protocol.js';
import {canonicalPoolValue} from './pool-contact-identity.js';

type PhysicalFixture=Pick<PoolFixtureV1,'ground'|'solids'|'revisions'>;
const ownedKeys=new WeakMap<PhysicalFixture,string>();
const currentKey=(fixture:PhysicalFixture)=>canonicalPoolValue({ground:fixture.ground,solids:fixture.solids,revisions:fixture.revisions});

function freezeOwnedJson(value:unknown):void {
  if(value!==null&&typeof value==='object'){
    for(const child of Object.values(value))freezeOwnedJson(child);
    Object.freeze(value);
  }
}

/** Parse detached plain data; caller objects cannot acquire fixture ownership. */
export function parseOwnedPoolFixture(text:string):PoolFixtureV1 {
  if(typeof text!=='string')throw new TypeError('Owned pool fixture requires JSON text.');
  const fixture:unknown=JSON.parse(text);
  validatePoolFixture(fixture);freezeOwnedJson(fixture);ownedKeys.set(fixture,currentKey(fixture));return fixture;
}

/** Mutable and otherwise unowned callers retain the current physical value key. */
export function poolPhysicalFixtureKey(fixture:PhysicalFixture):string {
  return ownedKeys.get(fixture)??currentKey(fixture);
}
