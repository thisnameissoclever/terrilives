import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { baselineHtml, validatePlayerCoverage } from './player-coverage.mjs';

test('pool values describe swimming-only delivery and retain source-driven total duration', () => {
  const action = { id: 'object:pool/hop_in', object_id: 'pool', action_id: 'hop_in', label: 'Hop in',
    tags: ['pool_swimming'], duration_ticks: 200, need_deltas: { fun: 30, comfort: 10, energy: -5 } };
  const reference = { ticks_per_sim_hour: 120, objects: [{ id: 'pool', type: 'Pool', name: 'Backyard' }], actions: [action] };
  const html = baselineHtml(reference);
  assert.match(html, /<td>100<\/td>/);
  assert.match(html, /Fun \+30; Comfort \+10; Energy -5/);
  assert.match(html, /Only active swimming supplies these amounts. Entry and exit are included in the total time/);
  assert.doesNotMatch(html, /Paid as a rate while actively using it/);
  assert.match(baselineHtml({ ...reference, actions: [{ ...action, duration_ticks: 240 }] }), /<td>120<\/td>/);
  const basin = { ...action, object_id: 'pool_in_ground_5x7', id: 'object:pool_in_ground_5x7/hop_in', duration_ticks: 168 };
  const basinGuide = baselineHtml({ ...reference, ticks_per_sim_hour: 60,
    objects: [{ id: basin.object_id, type: 'Pool', name: 'Garden Basin' }], actions: [basin] });
  assert.match(basinGuide, /<td>168<\/td>/);
  assert.match(basinGuide, /Only active swimming supplies these amounts. Entry and exit are included in the total time/);
  assert.match(baselineHtml({ ...reference, actions: [{ ...action, tags: [], object_id: 'pond', id: 'object:pond/hop_in' }] }), /Paid as a rate while actively using it/);
});

test('removed activity mapping, new relationship cause and broken evidence each fail', () => {
  const root = mkdtempSync(join(tmpdir(), 'guide-coverage-'));
  try {
    mkdirSync(join(root, 'docs/player'), { recursive: true });
    mkdirSync(join(root, 'crates/terri-sim/src'), { recursive: true });
    const source = 'crates/terri-sim/src/relationship_effects.rs';
    writeFileSync(join(root, source), 'pub enum RelationshipCause {\n    Conversation,\n}\n');
    const reference = { actions: [{ id: 'social:chat' }] };
    const articles = new Map([['relationships', { ids: new Set(['chat']) }]]);
    const row = (id) => ({ id, article: 'relationships', section: 'chat', sources: [source], review: { basis: 'Actual completed chat.' } });
    const effects = { actions: [row('social:chat')], relationshipCauses: [row('Conversation')] };
    const put = () => writeFileSync(join(root, 'docs/player/effects.json'), JSON.stringify(effects));
    put(); validatePlayerCoverage(root, reference, articles);
    effects.actions = []; put();
    assert.throws(() => validatePlayerCoverage(root, reference, articles), /Unmapped action/);
    effects.actions = [row('social:chat')]; put();
    writeFileSync(join(root, source), 'pub enum RelationshipCause {\n    Conversation,\n    NewEffect2,\n}\n');
    assert.throws(() => validatePlayerCoverage(root, reference, articles), /Unmapped relationship cause: NewEffect2/);
    effects.relationshipCauses.push(row('NewEffect2')); effects.actions[0].section = 'missing'; put();
    assert.throws(() => validatePlayerCoverage(root, reference, articles), /Missing action explanation/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
