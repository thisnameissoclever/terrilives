const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function totals(nodes) {
  return { count: nodes.length, bytes: nodes.reduce((sum, node) => sum + node.bytes, 0) };
}

function compare(previous, current) {
  const born = [...current.values()].filter(node => !previous.has(node.id));
  const dead = [...previous.values()].filter(node => !current.has(node.id));
  const survivors = [...current.values()].filter(node => previous.has(node.id));
  return { born: totals(born), dead: totals(dead), survivors: totals(survivors),
    survivorSizeChange: survivors.reduce((sum, node) => sum + node.bytes - previous.get(node.id).bytes, 0) };
}

function load(file) {
  const bytes = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const s = JSON.parse(bytes);
  const nf = s.snapshot.meta.node_fields, ns = nf.length;
  const ef = s.snapshot.meta.edge_fields, es = ef.length;
  const nt = s.snapshot.meta.node_types[nf.indexOf('type')];
  const et = s.snapshot.meta.edge_types[ef.indexOf('type')];
  const node = offset => ({ id: s.nodes[offset + nf.indexOf('id')], offset,
    type: nt[s.nodes[offset + nf.indexOf('type')]],
    name: s.strings[s.nodes[offset + nf.indexOf('name')]],
    bytes: s.nodes[offset + nf.indexOf('self_size')] });
  const all = new Map(), code = new Map(), incoming = new Map(), outgoing = new Map();
  let cursor = 0;
  for (let offset = 0; offset < s.nodes.length; offset += ns) {
    const value = node(offset);
    all.set(offset, value);
    if (value.type === 'code') code.set(value.id, value);
    const count = s.nodes[offset + nf.indexOf('edge_count')];
    for (let i = 0; i < count; i++, cursor += es) {
      const type = et[s.edges[cursor + ef.indexOf('type')]];
      if (type === 'weak') continue;
      const to = s.edges[cursor + ef.indexOf('to_node')];
      const raw = s.edges[cursor + ef.indexOf('name_or_index')];
      const label = type === 'element' || type === 'hidden' ? String(raw) : s.strings[raw];
      const edge = { from: offset, to, type, label };
      const parents = incoming.get(to) ?? [];
      parents.push(edge); incoming.set(to, parents);
      const children = outgoing.get(offset) ?? [];
      children.push(edge); outgoing.set(offset, children);
    }
  }
  function owners(target) {
    const queue = [{ offset: target.offset, depth: 0, edges: [] }], visited = new Set([target.offset]);
    const found = [];
    let nearestDepth = Infinity;
    for (let i = 0; i < queue.length && i < 5000; i++) {
      const current = queue[i], value = all.get(current.offset);
      if (current.depth > nearestDepth) continue;
      if (value.type === 'closure' || value.name.includes('SharedFunctionInfo')) {
        const shared = (outgoing.get(current.offset) ?? []).filter(edge =>
          all.get(edge.to).name.includes('SharedFunctionInfo')).map(edge => all.get(edge.to));
        found.push({ owner: value, shared, edges: current.edges });
        nearestDepth = current.depth;
        if (found.length === 12) break;
        continue;
      }
      if (current.depth === 5) continue;
      for (const edge of incoming.get(current.offset) ?? []) {
        if (visited.has(edge.from)) continue;
        visited.add(edge.from);
        queue.push({ offset: edge.from, depth: current.depth + 1,
          edges: [...current.edges, { parent: all.get(edge.from), type: edge.type, label: edge.label }] });
      }
    }
    return { found, searchTruncated: queue.length > 5000, maxDepth: 5 };
  }
  const sources = s.strings.filter(value => value.length > 10000 && value.includes('function Fr('));
  const sourceMappings = sources.map(source => ({
    sha256: crypto.createHash('sha256').update(source).digest('hex'),
    functions: ['Fr', 'Xs', 'Js', 'Kn'].map(name => {
      const start = source.indexOf(`function ${name}(`);
      return { name, offset: start, excerpt: start < 0 ? null : source.slice(start, start + 450) };
    }),
  }));
  return { file: path.basename(file), sha256, code, owners, sourceMappings };
}

function selfTest() {
  const a = new Map([[1, {id: 1, bytes: 10}], [2, {id: 2, bytes: 20}]]);
  const b = new Map([[2, {id: 2, bytes: 24}], [3, {id: 3, bytes: 8}]]);
  assert.deepEqual(compare(a, b), { born: {count: 1, bytes: 8}, dead: {count: 1, bytes: 10},
    survivors: {count: 1, bytes: 24}, survivorSizeChange: 4 });
  assert.deepEqual(compare(a, a), { born: {count: 0, bytes: 0}, dead: {count: 0, bytes: 0},
    survivors: {count: 2, bytes: 30}, survivorSizeChange: 0 });
}

function main() {
  selfTest();
  const directory = path.join(__dirname, 'indoor-ambience', 'lifecycle-identity-diagnostic-01');
  const output = path.join(directory, process.argv[2] ?? 'compiled-code-identity.json');
  if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing forensic report');
  const endpoints = [60, 600, 1140, 1680];
  const report = { diagnosticOnly: true, acceptanceClaimed: false, generatedAt: new Date().toISOString(),
    caveats: ['Historical pre-ECS-fix snapshots, not the latest acceptance build.',
      'Snapshot IDs are compared only within a single browser context.',
      'Presence means sampled reachability, not permanent retention or an engine leak.',
      'Owner searches omit weak edges and are bounded; absence is not proof of no owner.',
      'Sizes are shallow self sizes, not exclusive retained sizes.'], endpoints, modes: {} };
  for (const mode of ['enabled', 'disabled']) {
    const samples = [], instructionOwners = [];
    let sourceMappings;
    for (const tick of endpoints) {
      const parsed = load(path.join(directory, `${mode}-${String(tick).padStart(4, '0')}.heapsnapshot`));
      sourceMappings = parsed.sourceMappings;
      const previous = samples.at(-1)?.code ?? new Map();
      if (samples.length) {
        const targets = [...parsed.code.values()].filter(node => node.name === 'system / InstructionStream' &&
          !previous.has(node.id)).sort((a, b) => b.bytes - a.bytes).slice(0, 12);
        instructionOwners.push({tick, targets: targets.map(target => ({target, owners: parsed.owners(target)}))});
      }
      samples.push({ tick, file: parsed.file, sha256: parsed.sha256, code: parsed.code });
    }
    const categories = [...new Set(samples.flatMap(sample => [...sample.code.values()].map(node => node.name)))];
    const groups = categories.map(name => ({ name, samples: samples.map(sample => ({ tick: sample.tick,
      ...totals([...sample.code.values()].filter(node => node.name === name)) })) }));
    const intervals = samples.slice(1).map((sample, i) => {
      const delta = compare(samples[i].code, sample.code);
      assert.equal(delta.born.bytes - delta.dead.bytes + delta.survivorSizeChange,
        totals([...sample.code.values()]).bytes - totals([...samples[i].code.values()]).bytes);
      return { fromTick: samples[i].tick, toTick: sample.tick, ...delta };
    });
    const cohorts = samples.slice(1).map((sample, i) => {
      const bornIds = [...sample.code.keys()].filter(id => !samples[i].code.has(id));
      return { firstObservedTick: sample.tick, survivingAt: samples.slice(i + 1).map(later => {
        const nodes = bornIds.filter(id => later.code.has(id)).map(id => later.code.get(id));
        return { tick: later.tick, ...totals(nodes), instructionStreams: totals(nodes.filter(node =>
          node.name === 'system / InstructionStream')) };
      }) };
    });
    for (const epoch of instructionOwners) for (const item of epoch.targets) {
      item.presence = samples.map(sample => ({tick: sample.tick,
        bytes: sample.code.get(item.target.id)?.bytes ?? null}));
    }
    report.modes[mode] = { sourceMappings, samples: samples.map(sample => ({tick: sample.tick, file: sample.file,
      sha256: sample.sha256, ...totals([...sample.code.values()])})), intervals, cohorts,
      categories: groups.filter(group => group.samples.some(sample => sample.bytes >= 1000)), instructionOwners };
  }
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  for (const [mode, data] of Object.entries(report.modes)) console.log(mode, JSON.stringify({
    samples: data.samples, intervals: data.intervals, cohorts: data.cohorts,
    owners: data.instructionOwners.map(epoch => ({tick: epoch.tick, targets: epoch.targets.map(item => ({
      bytes: item.target.bytes, id: item.target.id, owners: item.owners.found.map(owner => owner.owner.name)}))})) }));
}

if (require.main === module) main();
module.exports = { compare, selfTest };
