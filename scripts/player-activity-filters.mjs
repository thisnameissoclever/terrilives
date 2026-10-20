import { escapeHtml } from './player-markdown.mjs';

const needs = ['Hunger', 'Energy', 'Hygiene', 'Bladder', 'Social', 'Fun', 'Comfort'];

/** Explicit reviewed tags keep filtering independent of prose wording. */
export function addActivityFilters(html, entries) {
  const table = /<div class="table-scroll"[^>]*><table>[\s\S]*?<\/table><\/div>/.exec(html);
  if (!table) throw Error('Activities need their overview table');
  const remaining = new Map(entries.map(entry => [entry.label, entry]));
  if (remaining.size !== entries.length) throw Error('Duplicate activity filter label');
  const tagged = table[0].replace(/<tr><td>([\s\S]*?)<\/td>/g, (row, label) => {
    const entry = remaining.get(label);
    if (!entry) throw Error('Missing activity filter tags: ' + label);
    for (const field of ['helps', 'costs']) if (!Array.isArray(entry[field]) || entry[field].some(need => !needs.includes(need))) throw Error('Invalid activity filter needs: ' + label);
    if (typeof entry.harmsFeelings !== 'boolean') throw Error('Invalid activity outcome: ' + label);
    remaining.delete(label);
    return row.replace('<tr>', `<tr data-helps="${escapeHtml(entry.helps.join(' '))}" data-costs="${escapeHtml(entry.costs.join(' '))}" data-harms-feelings="${entry.harmsFeelings}">`);
  });
  if (remaining.size) throw Error('Activity filter tags have no table row: ' + [...remaining.keys()].join(', '));
  const controls = `<form class="activity-filters" hidden><fieldset><legend>Filter activities</legend><label>Need <select name="need"><option value="">All needs</option>${needs.map(need => `<option>${need}</option>`).join('')}</select></label><label>Outcome <select name="outcome"><option value="">All outcomes</option><option value="helps">Can refill a need</option><option value="costs">Can cost a need</option><option value="none">No direct need benefit</option><option value="feelings">Harms feelings or mood</option></select></label><button type="reset">Show all activities</button></fieldset><p>Filters include conditional benefits and costs. Read the row's requirements before choosing an activity. Ordinary need loss is separate.</p><p role="status" aria-live="polite"></p></form>`;
  return html.replace(table[0], controls + tagged.replace('<table>', '<table class="activity-overview">'));
}
