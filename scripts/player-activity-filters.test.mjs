import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addActivityFilters } from './player-activity-filters.mjs';
import { buildPlayerGuide } from './build-player-guide.mjs';

test('all authored activity rows have reviewed need and outcome tags', () => {
  const files = buildPlayerGuide();
  const html = files.get('guide/activities/index.html');
  assert.match(html, /data-helps="Hygiene" data-costs="Energy"/);
  assert.match(html, /data-harms-feelings="true"><td>Person: Fight/);
  assert.match(html, /class="activity-overview"/);
  assert.match(files.get('guide/index.html'), /ui-elements\/#new-housemate/);
});

test('edited rows and invalid need tags require an explicit filter review', () => {
  const html = '<div class="table-scroll"><table><tbody><tr><td>Shower</td></tr></tbody></table></div>';
  const entry = { label:'Shower', helps:['Hygiene'], costs:['Energy'], harmsFeelings:false };
  assert.throws(() => addActivityFilters(html, []), /Missing activity filter tags/);
  assert.throws(() => addActivityFilters(html, [{...entry, helps:['Money']}]), /Invalid activity filter needs/);
  assert.throws(() => addActivityFilters(html, [entry, entry]), /Duplicate/);
  assert.throws(() => addActivityFilters(html, [entry, {...entry, label:'Removed action'}]), /no table row/);
});
