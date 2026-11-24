import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect} from 'vitest';
import {validatePoolCycleDefinition} from '../src/render/character/pool-cycle-source.js';
import {parseOwnedPoolFixture} from '../src/render/character/pool-owned-fixture.js';

const creator = new URL('../../assets/models/sims/character-creator/', import.meta.url);
const pairs = {
  14: [3, '4bdcb5a0ee843b5737315f361b23b89a94a2908ab18b422b84e88be936b98eb9', 'c1240eac29709878ba6d4d7b39d92cb6385d8a7edec1ad35804f84e8762fc692'],
  15: [4, 'd1a04bb06df1e508394fd3970ed1f8f0db137b58e9f7d316669354b969350f18', 'fe3a9fadc2a1528fe86de2ec00ccddb5d7ed7865cc1da3aa4cce9a3a1e63c68f'],
  16: [5, 'cf92ebaf5a53bed4568be5c51bc5ffc068086836b089721a5916621b94f58142', '1094e67261e07e9e55fbabf2d1b955a492ac4d67d649e3bf001fb3c04a19f0af'],
} as const;

/** Exact motion and physical fixtures used for the historical crest observations. */
export function historicalCrestPair(version: keyof typeof pairs) {
  const [revision, motionHash, fixtureHash] = pairs[version];
  function read(name: string, digest: string) {
    const bytes = readFileSync(new URL(name, creator));
    expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(digest);
    return bytes.toString('utf8');
  }
  const definition: unknown = JSON.parse(read('pool_activity_motion_v'+version+'.json', motionHash));
  validatePoolCycleDefinition(definition);
  const fixture = parseOwnedPoolFixture(read('clips/pool/contacts-v'+revision+'.json', fixtureHash));
  return {definition, fixture};
}

// Keep every failing phase, construction error, contact identity, support result and
// clearance. Round physical measurements to a micrometer before comparing traces.
function canonical(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return Object.fromEntries(entries.map(([key, field]) => [key, canonical(field)]));
  }
  return value;
}

export function expectHistoricalPoolRejection(failures: readonly unknown[], count: number, digest: string) {
  expect(failures).toHaveLength(count);
  const trace = JSON.stringify(canonical(failures));
  expect(createHash('sha256').update(trace).digest('hex'), trace).toBe(digest);
}
