const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const captureStamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(process.env.SLEEVE_REVIEW_OUTPUT || path.join(root, 'docs/evidence/2026-10-14-long-sleeves', `capture-${captureStamp}`));
const before = path.resolve(process.env.SLEEVE_BEFORE_EXPORT || path.join(root, '.scratch/long-sleeve-repair/before-export'));
const current = path.join(root, 'assets/models/sims/character-creator/export');
const firstRepairCapture = process.env.SLEEVE_FIRST_REPAIR_CAPTURE;
const supplementOnly = process.env.SLEEVE_SUPPLEMENT_ONLY === '1';
const url = process.env.CREATOR_REVIEW_URL || 'http://127.0.0.1:5187/proofs/character-creator.html';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = { url, capturedAt: new Date().toISOString(), viewport: { width: 1440, height: 1100 }, source: {}, producerHashes: {}, rows: [], errors: [], restored: [], preserved: [], outlinePolicyProbes: [] };
const actions = [['idle', 0], ['walk', 3.5], ['read', 1.5], ['mop', 3.5]];

function cases(condition) {
  if (supplementOnly) {
    const rows = [];
    for (const presentation of ['masculine', 'feminine']) for (const top of ['tshirt', 'jacket']) {
      for (const [action, frame] of [actions[0], actions[2]]) for (const facing of [1, 3]) {
        rows.push({ presentation, top, action, frame, facing, body: 'default', sleeves: 'long', wear: 'clothed' });
      }
    }
    for (const presentation of ['masculine', 'feminine']) for (const [action, frame] of [actions[0], actions[2], actions[3]]) {
      for (const facing of [1, 3]) rows.push({ presentation, top: 'overshirt', action, frame, facing,
        body: presentation === 'masculine' ? 'broad-short' : 'narrow-tall', sleeves: 'long', wear: 'clothed' });
    }
    return rows;
  }
  const all = condition === 'current';
  const rows = [];
  for (const presentation of ['masculine', 'feminine']) for (const [action, frame] of all ? actions : actions.slice(0, 1)) {
    for (let facing = 0; facing < 4; facing++) rows.push({ presentation, action, frame, facing, body: 'default', sleeves: 'long' });
  }
  if (all) for (const presentation of ['masculine', 'feminine']) for (const [action, frame] of [actions[0], actions[2], actions[3]]) {
    for (const facing of [0, 2]) rows.push({ presentation, action, frame, facing, body: presentation === 'masculine' ? 'broad-short' : 'narrow-tall', sleeves: 'long' });
  }
  if (condition === 'before' || all) for (const presentation of ['masculine', 'feminine']) for (const sleeves of ['rolled', 'short']) {
    for (let facing = 0; facing < 4; facing++) rows.push({ presentation, action: 'idle', frame: 0, facing, body: 'default', sleeves });
  }
  if (condition === 'before' || all) for (const presentation of ['masculine', 'feminine']) {
    for (let facing = 0; facing < 4; facing++) rows.push({ presentation, action: 'shower', frame: 1.5, facing, body: 'default', sleeves: 'long', wear: 'bare' });
  }
  if (all) for (const presentation of ['masculine', 'feminine']) for (const top of ['tshirt', 'jacket']) {
    for (const [action, frame] of [actions[0], actions[2]]) for (const facing of [0, 2]) {
      rows.push({ presentation, action, frame, facing, body: 'default', sleeves: 'long', top });
    }
  }
  return rows.map(row => ({ top: 'overshirt', wear: 'clothed', ...row }));
}

async function capture(browser, condition) {
  const old = condition === 'before' || condition === 'before-without-sleeve-outline';
  const context = await browser.newContext({ viewport: report.viewport, serviceWorkers: 'block' });
  try {
    if (condition === 'before-without-sleeve-outline') await context.route(/\/character-creator\/surface-policy\.json/, async route => {
      const policy = JSON.parse(fs.readFileSync(path.join(root, 'assets/models/sims/character-creator/surface-policy.json'), 'utf8'));
      const parts = [];
      for (const owner of Object.values(policy.owners)) owner.parts = owner.parts.filter(name => {
        if (/sleeve/i.test(name)) { parts.push(name); return false; }
        return true;
      });
      policy.owners['isolated-sleeve-diagnostic'] = { outline: false, reason: 'Isolated browser diagnostic only.', parts };
      const json = JSON.stringify(policy), module = route.request().resourceType() === 'script';
      return route.fulfill({ contentType: module ? 'application/javascript' : 'application/json', body: module ? `export default ${json};` : json });
    });
    if (old) await context.route(/\/character-creator\/export\//, async route => {
      const request = route.request(), parsed = new URL(request.url());
      if (parsed.searchParams.has('url')) return route.continue();
      const name = path.basename(decodeURIComponent(parsed.pathname));
      if (name === 'manifest.json') {
        const manifest = JSON.parse(fs.readFileSync(path.join(before, name), 'utf8'));
        if (condition === 'before-without-sleeve-outline') for (const quality of ['original', 'runtime']) {
          for (const part of manifest[quality].parts) if (/sleeve/i.test(part.name)) part.outline = false;
        }
        const json = JSON.stringify(manifest), module = request.resourceType() === 'script';
        return route.fulfill({ contentType: module ? 'application/javascript' : 'application/json', body: module ? `export default ${json};` : json });
      }
      if (name.endsWith('.bin')) return route.fulfill({ contentType: 'application/octet-stream', body: fs.readFileSync(path.join(before, name)) });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({ condition, error: String(error) }));
    await page.goto(url);
    await page.waitForFunction(() => window.creatorHarness || window.creatorHarnessError, null, { timeout: 180000 });
    const error = await page.evaluate(() => window.creatorHarnessError);
    if (error) throw Error(error);
    await page.evaluate(condition => {
      document.title = condition === 'before' ? 'Deliberate old sleeve defect - diagnostic'
        : condition === 'before-without-sleeve-outline' ? 'Deliberate old sleeve defect - outlines disabled diagnostic'
        : condition === 'restored-current' ? 'Repaired sleeves - restoration check' : 'Repaired sleeves - visual review';
    }, condition);
    const probe = await page.evaluate(async () => {
      const { authoredOutline } = await import('/src/render/character/authored-surfaces.ts');
      return Object.fromEntries(['Creator long sleeve L', 'Creator long sleeve R', 'Relaxed shirt sleeve', 'Relaxed shirt sleeve.001'].map(name => [name, authoredOutline(name)]));
    });
    report.outlinePolicyProbes.push({ condition, parts: probe });
    if (Object.values(probe).some(value => value !== (condition !== 'before-without-sleeve-outline'))) throw Error(`Outline diagnostic did not reach the renderer: ${condition}`);
    for (const entry of cases(condition)) {
      const appearance = await page.evaluate(async entry => {
        const harness = window.creatorHarness, appearance = harness.defaultAppearance(entry.presentation);
        appearance.sleeves = entry.sleeves; appearance.top = entry.top; appearance.colors.shirt = [126, 63, 91];
        if (entry.sleeves !== 'long') { appearance.freckles = true; appearance.freckle_density = 75; }
        if (entry.body === 'broad-short') appearance.body = { height: 0, build: 100, shoulders: 100, hips: 100, torso: 100 };
        if (entry.body === 'narrow-tall') appearance.body = { height: 100, build: 0, shoulders: 0, hips: 0, torso: 0 };
        await harness.drawClip(appearance, entry.action, entry.frame, entry.facing*Math.PI/2);
        return appearance;
      }, entry);
      for (const [index, size] of ['large', 'normal'].entries()) {
        const key = `${entry.presentation}-${entry.top}-${entry.sleeves}-${entry.wear}-${entry.action}-${entry.body}-${entry.facing}-${size}`;
        const file = `${condition}-${key}.png`, target = path.join(output, file);
        await page.locator('#creator > canvas').nth(index).screenshot({ path: target });
        report.rows.push({ condition, key, file, ...entry, size, appearance, sha256: sha(fs.readFileSync(target)) });
      }
    }
    report.errors.push(...(await page.evaluate(() => window.creatorHarness.errors)).map(error => ({ condition, error })));
  } finally { await context.close(); }
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  report.scope = supplementOnly ? 'Only previously missing facings for top variants and extreme bodies; prior control receipts remain separate.' : 'Complete original/current/restored comparison with preserved appearance controls.';
  for (const file of ['scripts/character-creator-repair/capture-long-sleeves.cjs',
    'web/src/render/character/prepared-body.ts', 'web/src/render/character/prepared-character.ts',
    'web/src/render/character/renderer.ts', 'web/src/render/character/authored-surfaces.ts',
    'web/src/ui/character-creator/preview.ts', 'assets/models/sims/character-creator/surface-policy.json']) {
    report.producerHashes[file] = sha(fs.readFileSync(path.join(root, file)));
  }
  for (const [label, directory] of [['before', before], ['current', current]]) {
    const bytes = fs.readFileSync(path.join(directory, 'manifest.json'));
    report.source[label] = { manifestSha256: sha(bytes), sourceSha256: JSON.parse(bytes).sourceSha256 };
  }
  report.originalScreenshotSettings = 'The supplied screenshot has no appearance record or animation phase. These captures use declared default presentations, long sleeves and a purple shirt.';
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio'] });
  try {
    for (const condition of supplementOnly ? ['current'] : ['before', 'before-without-sleeve-outline', 'current', 'restored-current']) await capture(browser, condition);
    for (const row of report.rows.filter(row => row.condition === 'restored-current')) {
      const reference = report.rows.find(other => other.condition === 'current' && other.key === row.key);
      const identical = reference?.sha256 === row.sha256;
      report.restored.push({ key: row.key, identical });
      if (!identical) throw Error(`Restored current output differs: ${row.key}`);
    }
    for (const row of report.rows.filter(row => row.condition === 'before' && (row.sleeves !== 'long' || row.wear === 'bare'))) {
      const reference = report.rows.find(other => other.condition === 'current' && other.key === row.key);
      const identical = reference?.sha256 === row.sha256;
      report.preserved.push({ key: row.key, identical });
      if (!identical) throw Error(`Retained sleeve output differs: ${row.key}`);
    }
    for (const [file, digest] of Object.entries(report.producerHashes)) {
      if (sha(fs.readFileSync(path.join(root, file))) !== digest) throw Error(`Capture source changed during review: ${file}`);
    }
    if (sha(fs.readFileSync(path.join(current, 'manifest.json'))) !== report.source.current.manifestSha256) throw Error('Current geometry changed during review');
    if (report.errors.length) throw Error('Browser or graphics errors occurred');
    const labels = crypto.randomInt(2) ? ['sample-a', 'sample-b'] : ['sample-b', 'sample-a'];
    report.blindMapping = { before: labels[0], current: labels[1] };
    const blind = path.join(output, 'blind-comparison');
    fs.mkdirSync(blind, { recursive: true });
    for (const row of report.rows.filter(row => ['before', 'current'].includes(row.condition)
      && row.action === 'idle' && row.sleeves === 'long' && row.top === 'overshirt' && row.body === 'default')) {
      fs.copyFileSync(path.join(output, row.file), path.join(blind, `${report.blindMapping[row.condition]}-${row.key}.png`));
    }
    if (firstRepairCapture && !supplementOnly) {
      const previousDirectory = path.resolve(firstRepairCapture), previousBytes = fs.readFileSync(path.join(previousDirectory, 'capture-report.json'));
      const previous = JSON.parse(previousBytes);
      const labels = crypto.randomInt(2) ? ['sample-c', 'sample-d'] : ['sample-d', 'sample-c'];
      report.blindBentMapping = { firstRepair: labels[0], current: labels[1] };
      report.firstRepairReceipt = { directory: previousDirectory, sha256: sha(previousBytes) };
      const directory = path.join(output, 'blind-bent-comparison');
      fs.mkdirSync(directory, { recursive: true });
      for (const row of report.rows.filter(row => row.condition === 'current' && ['read', 'mop'].includes(row.action)
        && row.sleeves === 'long' && row.top === 'overshirt' && row.body === 'default')) {
        const original = previous.rows.find(other => other.condition === 'current' && other.action === row.action
          && other.presentation === row.presentation && other.facing === row.facing && other.size === row.size
          && other.sleeves === row.sleeves && other.top === row.top && other.body === row.body);
        if (!original || JSON.stringify(original.appearance) !== JSON.stringify(row.appearance)) throw Error(`First repair comparison settings differ: ${row.key}`);
        fs.copyFileSync(path.join(previousDirectory, original.file), path.join(directory, `${labels[0]}-${row.key}.png`));
        fs.copyFileSync(path.join(output, row.file), path.join(directory, `${labels[1]}-${row.key}.png`));
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'capture-report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ output, captures: report.rows.length, restored: report.restored.length, errors: report.errors.length }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
