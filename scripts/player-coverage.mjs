import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Compare enumerated gameplay IDs with reviewed explanatory destinations. */
export function validatePlayerCoverage(root, reference, articles) {
  if (!reference.actions) return;
  const file = join(root, 'docs/player/effects.json');
  if (!existsSync(file)) throw Error('Missing player effect coverage map');
  const effects = JSON.parse(readFileSync(file, 'utf8'));
  function check(rows, ids, name) {
    if (!Array.isArray(rows)) throw Error(`Missing ${name} coverage`);
    const mapped = new Set();
    for (const row of rows) {
      if (!ids.has(row.id) || mapped.has(row.id)) throw Error(`Unknown or duplicate ${name} mapping ${row.id}`);
      mapped.add(row.id);
      if (!articles.get(row.article)?.ids.has(row.section)) throw Error(`Missing ${name} explanation ${row.article}/#${row.section}`);
      if (!Array.isArray(row.sources) || !row.sources.length || row.sources.some((path) => !existsSync(join(root, path)))) throw Error(`Missing ${name} source evidence ${row.id}`);
      if (!row.review?.basis) throw Error(`Missing ${name} review basis ${row.id}`);
    }
    for (const id of ids) if (!mapped.has(id)) throw Error(`Unmapped ${name}: ${id}`);
  }
  check(effects.actions, new Set(reference.actions.map((a) => a.id)), 'action');
  const source = readFileSync(join(root, 'crates/terri-sim/src/relationship_effects.rs'), 'utf8');
  const body = /pub enum RelationshipCause\s*\{([\s\S]*?)\}/.exec(source)?.[1];
  if (!body) throw Error('Cannot enumerate relationship causes');
  const causes = new Set();
  for (const line of body.split('\n')) {
    const code = line.replace(/\/\/.*$/, '').trim();
    if (!code || code.startsWith('#[')) continue;
    const variant = /^([A-Za-z_][A-Za-z0-9_]*),?$/.exec(code);
    if (!variant) throw Error('Cannot enumerate relationship cause line: ' + code);
    causes.add(variant[1]);
  }
  check(effects.relationshipCauses, causes, 'relationship cause');
  if (reference.traits) check(effects.conditions, new Set(reference.traits.filter((trait) => trait.kind.Condition).map((trait) => trait.id)), 'condition');
}

export function baselineHtml(reference) {
  if (!reference.actions) return '';
  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const number = (n) => Number(n.toPrecision(5));
  const objects = new Map(reference.objects.map((o) => [o.id, o]));
  const rows = reference.actions.filter((a) => !a.id.startsWith('chain:')).map((action) => {
    const obj = objects.get(action.object_id), identity = obj ? `${obj.type}${obj.name !== obj.type ? ': ' + obj.name : ''}` : 'Person';
    const deltas = Object.entries(action.need_deltas).map(([name, value]) => `${name[0].toUpperCase() + name.slice(1)} ${value >= 0 ? '+' : ''}${number(value)}`).join('; ') || 'No direct need benefit';
    let delivery = 'Paid as a rate while actively using it';
    if (action.book_reading) delivery = 'Reading rate; real time depends on book and reading speed';
    if (action.recipe || action.chain_id) delivery = 'Food only after eating; Social only with eligible seated company';
    if (action.action_id === 'take_prepared_food') delivery = 'Starts collecting and eating a real portion; see food requirements';
    if (action.id === 'social:fight') delivery = 'No need benefit; completed fights harm both participants';
    const conditional = action.need_deltas.social && action.object_id !== 'desk' && action.id !== 'social:chat' ? '; Social requires actual company' : '';
    return `<tr><td>${esc(identity)}<br>${esc(action.label)}</td><td>${esc(number(action.duration_ticks * 60 / reference.ticks_per_sim_hour))}</td><td>${esc(deltas + conditional)}</td><td>${esc(delivery)}</td></tr>`;
  });
  return `<h2 id="baseline-values" tabindex="-1">Numbers and reference durations <a class="heading-link" href="#baseline-values" aria-label="Link to reference values">#</a></h2><p>These baseline amounts describe a reference period of active use. Ordinary need loss still applies. Personal refill rates, ceilings, actual time, failed attempts and the requirements described above change the result. They are not guaranteed changes to a meter. Walking and waiting add time without the listed benefit.</p><details class="numbers"><summary>Show current baseline values by object and action</summary><div><div class="table-scroll" tabindex="0" role="region" aria-label="Baseline action values"><table><thead><tr><th scope="col">Object and action</th><th scope="col">Reference game minutes</th><th scope="col">Baseline needs</th><th scope="col">When it applies</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p>Food values are completion rewards; company and chairs supply separate effects while eligible. Reading uses its own reference duration and actual book progress. A plain seat action does not also receive a second chair reward. Some furniture actions prepare a longer activity; their preparation does not grant the final activity's benefit.</p></div></details>`;
}
