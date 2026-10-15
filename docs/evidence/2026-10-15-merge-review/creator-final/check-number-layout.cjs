const { chromium } = require('C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const metricsForRow = require('./number-layout-metrics.cjs');
const out = path.join(__dirname, process.env.NUMBER_LAYOUT_RUN || 'number-layout-01');
if (fs.existsSync(out)) throw Error('Use a fresh NUMBER_LAYOUT_RUN to preserve previous captures.');
fs.mkdirSync(out, { recursive: true });
const css = fs.readFileSync('web/src/ui/character-creator/creator.css', 'utf8');
const report = { checks: [], errors: [], status: 'RUNNING' };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    for (const width of [1440, 1051, 1050, 761, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const row = `<div class="creator-field"><label><strong>Low spirits severity</strong><span>Current condition severity.</span><span class="creator-range">0 to 100%</span></label><div class="creator-control"><input type="range" min="0" max="100" value="73.1235"><span class="creator-number"><input type="number" min="0" max="100" value="73.1235"><span class="creator-unit">%</span></span></div><button>Random</button><button class="creator-lock">Lock</button></div>`;
      await page.setContent(`<style>body{margin:0} ${css}</style><div class="creator-shell"><header class="creator-header"><h1>Edit housemate</h1></header><div class="creator-content"><nav class="creator-nav"><button>Personality</button></nav><section class="creator-editor">${row.repeat(16)}</section><aside class="creator-preview"></aside></div><footer class="creator-footer"><button>Cancel</button><button>Undo</button><button>Reset section</button></footer></div>`);
      for (const state of ['Lock', 'Locked']) {
        await page.locator('.creator-lock').evaluateAll((nodes, text) => nodes.forEach(node => { node.textContent = text; node.setAttribute('aria-pressed', String(text === 'Locked')); }), state);
        report.checks.push(await page.locator('.creator-field').first().evaluate(metricsForRow));
        await page.screenshot({ path: path.join(out, `width-${width}-${state.toLowerCase()}.png`) });
      }
    }
    for (const metrics of report.checks) {
      assert.ok(metrics.fits, `Complete percentage must fit at ${metrics.width}px/${metrics.lockText}`);
      assert.ok(!metrics.controlOverflow && !metrics.editorOverflow && !metrics.documentOverflow && !metrics.editorScrollOverflow && !metrics.overlaps.length && !metrics.uncontained.length && !metrics.clippedLabels.length, `Controls must fit at ${metrics.width}px/${metrics.lockText}`);
    }
    assert.ok(report.checks.some(row => row.width === 320 && row.contentScrollbar > 0), 'The 320px fixture must include the real content scrollbar');
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.errors.push(String(error)); throw error; }
  finally { await browser.close(); report.browserClosed = true; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
