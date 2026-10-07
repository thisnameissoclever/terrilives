// Select real references that exercise distinct production composition paths.
function orderWithPreflight(cases) {
  const specifications = [
    ['contact-selected-green', 'SW', 6, 0, 0, 0, 'actual_reachable_selected_only_beauty'],
    ['contact-selected-blue', 'SW', 6, 0, 0, 1, 'actual_reachable_selected_only_beauty'],
    ['contact-full-green', 'SW', 6, 0, 0, 0, 'actual_full_stock_green_beauty'],
    ['clear-empty-red', 'SW', 6, 23, 2, 2, 'actual_empty_stock_beauty'],
    ['clear-full-green', 'SW', 6, 23, 2, 0, 'actual_full_stock_green_beauty'],
    ['carry-empty-green', 'NW', 6, 0, 3, 0, 'actual_empty_stock_beauty'],
    ['carry-full-green', 'NW', 6, 0, 3, 0, 'actual_full_stock_green_beauty'],
    ['return-stationary-green', 'SE', 7, 0, 3, 0, 'actual_full_stock_green_beauty'],
    ['return-carry-green', 'NE', 7, 0, 0, 0, 'actual_full_stock_green_beauty'],
  ];
  const keys = new Set();
  for (const row of cases) {
    if (keys.has(row.key)) throw Error('Duplicate prepared reference key: ' + row.key);
    keys.add(row.key);
  }
  const chosen = new Set();
  const preflight = specifications.map(([label, facing, stage, slot, phase, palette, kind]) => {
    const matches = cases.filter(row => row.facing === facing && row.stage === stage && row.slot === slot
      && row.phase === phase && row.palette === palette && row.kind === kind);
    if (matches.length !== 1 || chosen.has(matches[0].key)) throw Error('Missing or ambiguous preflight reference: ' + label);
    chosen.add(matches[0].key);
    return { ...matches[0], preflightLabel: label };
  });
  return { cases: [...preflight, ...cases.filter(row => !chosen.has(row.key))],
    preflightKeys: preflight.map(row => row.key), preflightLabels: preflight.map(row => row.preflightLabel) };
}

module.exports = { orderWithPreflight };
