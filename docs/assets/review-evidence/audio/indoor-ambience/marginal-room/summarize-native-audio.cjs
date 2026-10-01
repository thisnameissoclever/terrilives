const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, 'indoor-ambience', 'marginal-room-diagnostic-01');
const report = {diagnosticOnly: true, acceptanceClaimed: false, conditions: {}};
for (const label of ['room-25', 'room-0']) {
  const samples = {};
  for (const phase of ['baseline', 'final']) {
    const s = JSON.parse(fs.readFileSync(path.join(directory, `${label}-${phase}.heapsnapshot`)));
    const fields = s.snapshot.meta.node_fields, width = fields.length;
    const types = s.snapshot.meta.node_types[fields.indexOf('type')], groups = {};
    for (let offset = 0; offset < s.nodes.length; offset += width) {
      const type = types[s.nodes[offset + fields.indexOf('type')]];
      const name = s.strings[s.nodes[offset + fields.indexOf('name')]];
      if (type !== 'native' || !/^(Audio|GainNode|Oscillator|BiquadFilter|StereoPanner)/.test(name)) continue;
      const group = groups[name] ?? {count: 0, shallowBytes: 0, ids: []};
      group.count++;
      group.shallowBytes += s.nodes[offset + fields.indexOf('self_size')];
      group.ids.push(s.nodes[offset + fields.indexOf('id')]);
      groups[name] = group;
    }
    samples[phase] = groups;
  }
  const surviving = {};
  for (const name of new Set([...Object.keys(samples.baseline), ...Object.keys(samples.final)])) {
    const before = new Set(samples.baseline[name]?.ids ?? []), after = new Set(samples.final[name]?.ids ?? []);
    surviving[name] = {before: before.size, after: after.size,
      addedIds: [...after].filter(id => !before.has(id)), removedIds: [...before].filter(id => !after.has(id))};
  }
  report.conditions[label] = {samples, surviving};
}
fs.writeFileSync(path.join(directory, 'native-audio-identities.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
for (const [label, data] of Object.entries(report.conditions)) console.log(label, JSON.stringify(data.surviving));
