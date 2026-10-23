import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { validatePlayerCoverage } from './player-coverage.mjs';

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
