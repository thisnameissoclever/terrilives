import type {BundledPoolArtifact} from './pool-bundled-artifact.js';
import {activePoolRelease} from './pool-active-release.js';
import {canonicalPoolValue} from './pool-contact-identity.js';
import {parseOwnedPoolFixture} from './pool-owned-fixture.js';
import type {PoolContactInputV1,PoolFixtureV1} from './pool-contact-types.js';
import type {PoolCycleSource} from './pool-cycle-source.js';
import type {PoolWaterCutout} from './pool-water-contact.js';
import type {SelectedPoolRoute} from './pool-selected-cycle.js';

export interface PoolRouteSelection {
  sourceText:string;
  select(input:PoolContactInputV1,source:PoolCycleSource):SelectedPoolRoute;
}
export interface PoolContactRelease {
  motion:unknown;
  motionText:string;
  fixture:unknown;
  fixtureText:string;
  selection?:PoolRouteSelection;
  bundled?:readonly BundledPoolArtifact[];
  family?:{sha256:string;url:string;byteLength:number};
}

/** The worker and renderer must use the same installed fixture and motion revision. */
export const poolContactRelease:PoolContactRelease=Object.freeze(activePoolRelease);

let installed:PoolFixtureV1|undefined;
export function poolContactFixture():PoolFixtureV1 {
  if(!installed){
    const expected=parseOwnedPoolFixture(poolContactRelease.fixtureText);
    if(canonicalPoolValue(expected)!==canonicalPoolValue(poolContactRelease.fixture))throw new Error('Pool fixture JSON differs from its revision input.');
    installed=expected;
  }
  return installed;
}

/** A cached legacy graph cannot stand in for a release that declares a separate climb-out. */
export function poolContactTakeoffPhase():number|null {
 const definition=poolContactRelease.motion as {clockUnits:number;forwardHop?:{takeoffUnit:number}};
 return definition.forwardHop?definition.forwardHop.takeoffUnit/definition.clockUnits:null;
}

/** The recessed ladder bay opens on the positive Y edge in pool-local space. */
export function poolWaterCutout():PoolWaterCutout|undefined {
  const definition=poolContactRelease.motion as {dryBay?:{water:PoolWaterCutout}};
  return definition.dryBay?.water;
}
