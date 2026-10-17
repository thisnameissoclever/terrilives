// Use an existing Playwright installation; this verifier adds no project dependency.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const output = path.resolve(process.argv[2] || 'output/playwright/action-colors');
const gameUrl = new URL(process.env.GAME_URL || 'http://127.0.0.1:5174');
gameUrl.searchParams.set('stress', '0');
gameUrl.searchParams.set('audio', '0');
fs.mkdirSync(output, { recursive: true });
const report = {
  url: gameUrl.href, capturedAt: new Date().toISOString(),
  sourceSha256: Object.fromEntries(['web/index.html', 'web/src/ui/action-intent.css',
    'web/src/ui/character-creator/creator.css', 'web/src/ui/object-menu.ts', 'web/src/ui/placement-actions.ts',
    'scripts/verify-action-colors.cjs'].map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex')])),
  checks: [], fixtures: [], limits: [], errors: [], screenshots: [],
};
const palettes = {
  affirmative: { normal: 'rgb(38, 79, 61)', emphasized: 'rgb(48, 99, 72)' },
  negative: { normal: 'rgb(91, 45, 53)', emphasized: 'rgb(113, 59, 69)' },
  destructive: { normal: 'rgb(91, 45, 53)', emphasized: 'rgb(113, 59, 69)' },
};

function contrast(a, b) {
  const luminance = value => {
    const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => {
      n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
    });
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1',
    args: ['--enable-unsafe-webgpu', '--use-angle=d3d11', '--mute-audio'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.errors.push(error.message));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function capture(name) {
    await settle();
    await page.screenshot({ path: path.join(output, name + '.png') });
    report.screenshots.push({ name: name + '.png', viewport: page.viewportSize() });
  }
  async function appearance(locator) {
    return locator.evaluate(button => {
      const style = getComputedStyle(button), rect = button.getBoundingClientRect();
      return { label: button.textContent.trim(), id: button.id, intent: button.dataset.actionIntent,
        background: style.backgroundColor, text: style.color, border: style.borderTopColor,
        outline: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor,
        disabled: button.matches(':disabled'), focusVisible: button.matches(':focus-visible'), active: button.matches(':active'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, fontSize: style.fontSize };
    });
  }
  async function keyboardFocus(locator, name) {
    const routes = {
      'Build Confirm': ['#build-batch-cancel', 'Tab'],
      'Build Cancel': ['#build-batch-confirm', 'Shift+Tab'],
      'Exit build': ['#build-tool-furniture', 'Shift+Tab'],
      'Furniture Sell': ['[data-context-action="cancel"]', 'Shift+Tab'],
      'Furniture Buy': ['[data-context-action="left"]', 'Shift+Tab'],
      'Creator Continue': ['[data-reset]', 'Tab'],
      'Destructive Start over confirmation': ['#new-game-dialog button[value="cancel"]', 'Tab'],
      'Keep playing': ['#confirm-new-game', 'Shift+Tab'],
      'Component Buy book': ['#action-color-components .book-commerce button:nth-child(2)', 'Shift+Tab'],
      'Component Sell book': ['#action-color-components .book-commerce button:first-child', 'Tab'],
      'Component chore Do now': ['#action-color-components .chores-board input[type="checkbox"]', 'Tab'],
      'Component bed Assign': ['#action-color-bed select', 'Tab'],
    };
    if (name === 'Cancel-only Land dialog') {
      // Reopening restores native initial modal focus. ArrowDown establishes keyboard modality without leaving its only control.
      await page.locator('#land-dialog-cancel').click(); await page.locator('#land-buy').click();
      await page.keyboard.press('ArrowDown');
    } else if (name === 'Creator Cancel') {
      const next = await page.locator('[data-undo]').isEnabled() ? '[data-undo]' : '[data-reset]';
      await page.locator(next).focus(); await page.keyboard.press('Shift+Tab');
    } else if (name === 'Real radial Close') {
      await page.locator('#object-menu .menu-entry:not(:disabled)').first().focus(); await page.keyboard.press('Shift+Tab');
    } else if (/radial (More actions|Back)$/.test(name)) {
      // Explicit menu DOM contract: ordinary entries precede Back, then More actions.
      await page.locator('#object-menu .menu-entry[data-menu-index]:not(:disabled)').last().focus();
      await page.keyboard.press('Tab');
    } else {
      assert(routes[name], name + ' has an explicit keyboard route');
      const [from, key] = routes[name]; await page.locator(from).focus(); await page.keyboard.press(key);
    }
    assert(await locator.evaluate(button => document.activeElement === button), name + ' receives keyboard focus');
  }
  async function states(locator, role, name, fixture = false) {
    await locator.evaluate(button => button.blur());
    await page.locator('#stage').focus();
    await page.mouse.move(page.viewportSize().width - 1, page.viewportSize().height - 1);
    const normal = await appearance(locator);
    assert.equal(normal.intent, role, name + ' explicit intent');
    assert(!normal.disabled, name + ' enabled');
    await locator.hover();
    const hover = await appearance(locator);
    await page.mouse.down();
    let pressed;
    try {
      pressed = await appearance(locator);
      if (name === 'Build Confirm' || name === 'Build Cancel') await capture(name === 'Build Confirm' ? 'pressed-confirm' : 'pressed-cancel');
    } finally {
      // Release outside the button so a presentation check does not execute its action.
      await page.mouse.move(page.viewportSize().width - 1, page.viewportSize().height - 1);
      await page.mouse.up();
      await page.evaluate(() => getSelection()?.removeAllRanges());
    }
    await keyboardFocus(locator, name);
    const focus = await appearance(locator);
    assert(focus.focusVisible, name + ' keyboard focus');
    assert.notEqual(focus.outline, 'none', name + ' visible outline');
    assert.notEqual(focus.outlineWidth, '0px', name + ' nonzero outline');
    assert(pressed.active, name + ' actual pressed state');
    for (const [state, value] of Object.entries({ normal, hover, pressed, focus })) {
      assert.equal(value.background, state === 'normal' ? palettes[role].normal : palettes[role].emphasized, name + ' ' + state);
      value.contrast = contrast(value.background, value.text);
      assert(value.contrast >= 4.5, name + ' text contrast ' + state);
      assert.equal(value.rect.width, normal.rect.width, name + ' stable width');
      assert.equal(value.rect.height, normal.rect.height, name + ' stable height');
    }
    (fixture ? report.fixtures : report.checks).push({ name, role, normal, hover, pressed, focus });
  }
  async function disabled(locator, name, fixture = false) {
    const normal = await appearance(locator);
    assert(normal.disabled, name + ' native disabled state');
    await locator.hover();
    const hover = await appearance(locator);
    assert.equal(hover.background, normal.background, name + ' disabled hover');
    (fixture ? report.fixtures : report.checks).push({ name, normal, hover });
  }
  try {
    await page.goto(gameUrl.href);
    await page.waitForFunction(() => !document.getElementById('startup-loading') || document.querySelector('[data-role="startup-failure"]'), null, { timeout: 90000 });
    assert.equal(await page.locator('[data-role="startup-failure"]').count(), 0, 'No startup failure');
    assert.equal(await page.locator('#startup-loading').count(), 0, 'Startup cover detached');
    if (await page.locator('#close-help').isVisible()) await page.locator('#close-help').click();
    await page.locator('label[for="speed-0"]').click();
    await page.locator('#build-toggle').click();
    await page.waitForFunction(() => document.body.dataset.building === 'true');
    await states(page.locator('#build-batch-confirm'), 'affirmative', 'Build Confirm');
    await states(page.locator('#build-batch-cancel'), 'negative', 'Build Cancel');
    await states(page.locator('#builder-exit'), 'negative', 'Exit build');
    await capture('build-desktop');
    for (const [name, width, height] of [['build-phone', 390, 844], ['build-landscape', 844, 390]]) {
      await page.setViewportSize({ width, height }); await settle();
      const footer = await page.locator('#build-batch-actions button').evaluateAll(buttons => buttons.map(b => {
        const r = b.getBoundingClientRect(); return { label: b.textContent.trim(), x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }));
      assert.equal(footer.length, 2, name + ' footer controls');
      for (const b of footer) assert(b.x >= 0 && b.y >= 0 && b.right <= width && b.bottom <= height, name + ' footer fits');
      report.checks.push({ name, footer }); await capture(name);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      const elements = [...document.querySelectorAll('#builder-controls *')].filter(e => e.matches('button,select,input') || [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()));
      const sizes = elements.map(e => [e, getComputedStyle(e).fontSize]);
      window.__actionColorFontRestore = sizes.map(([e]) => [e, e.style.fontSize]);
      sizes.forEach(([e, size]) => { e.style.fontSize = `${parseFloat(size) * 2}px`; });
    });
    report.checks.push({ name: 'Build enlarged text', confirm: await appearance(page.locator('#build-batch-confirm')), method: 'Double computed font size for text and form controls in Build; test-only presentation override.' });
    await capture('build-enlarged-text');
    await page.evaluate(() => { window.__actionColorFontRestore.forEach(([e, value]) => { e.style.fontSize = value; }); delete window.__actionColorFontRestore; });
    await page.emulateMedia({ forcedColors: 'active' });
    await keyboardFocus(page.locator('#build-batch-confirm'), 'Build Confirm');
    const forced = await appearance(page.locator('#build-batch-confirm'));
    assert(forced.focusVisible && forced.outline !== 'none' && forced.outlineWidth !== '0px', 'Forced-colors focus visible');
    assert.notEqual(forced.border, forced.background, 'Forced-colors boundary');
    assert.notEqual(forced.text, forced.background, 'Forced-colors label');
    report.checks.push({ name: 'Build forced colors', ...forced }); await capture('build-forced-colors');
    await page.emulateMedia({ forcedColors: 'none' });
    await page.locator('#build-tool-land').click();
    await disabled(page.locator('#land-buy'), 'Land without selected side');
    await page.locator('#land-side-0').click(); await page.locator('#land-buy').click();
    await page.locator('#land-dialog[open]').waitFor();
    assert.equal(await page.locator('#land-dialog-confirm').isVisible(), false, 'Unaffordable land has no affirmative action');
    await states(page.locator('#land-dialog-cancel'), 'negative', 'Cancel-only Land dialog');
    report.checks.push({ name: 'Unaffordable Land', text: await page.locator('#land-dialog-text').textContent() });
    await capture('land-dialog'); await page.locator('#land-dialog-cancel').click();
    await page.locator('#build-tool-furniture').click();
    const objectIds = await page.locator('#builder-object option').evaluateAll(options => options.filter(o => o.value).map(o => o.value));
    let sold = false;
    for (const id of objectIds) {
      await page.locator('#builder-object').selectOption(id); await settle();
      const sell = page.locator('[data-context-action="sell"]');
      if (await sell.isVisible() && await sell.isEnabled()) {
        await states(sell, 'destructive', 'Furniture Sell'); await sell.click(); sold = true; break;
      }
    }
    assert(sold, 'Actual furniture sale available in disposable game');
    await page.locator('#build-tool-buy').click();
    const affordable = await page.locator('#buy-object option:not([disabled])').evaluateAll(options => options.find(o => o.value)?.value);
    assert(affordable, 'An affordable object after UI sale');
    await page.locator('#buy-object').selectOption(affordable); await settle();
    const purchase = page.locator('[data-context-action="confirm"]');
    report.checks.push({ name: 'Affordable furniture quote', controls: await page.locator('#placement-actions button').allTextContents() });
    if (await purchase.isVisible() && await purchase.isEnabled()) await states(purchase, 'affirmative', 'Furniture Buy');
    else report.limits.push('Affordable furniture catalogue was reached; current placement prevented an enabled Buy action.');
    await capture('buy-affordable');
    await page.locator('#build-batch-cancel').click();
    await page.locator('#builder-exit').click();
    await page.locator('#edit-housemate').click(); await page.locator('#housemate-dialog[open]').waitFor();
    await states(page.locator('[data-next]'), 'affirmative', 'Creator Continue');
    await states(page.locator('[data-cancel]'), 'negative', 'Creator Cancel');
    const randomIntent = await page.locator('[data-global-random]').getAttribute('data-action-intent');
    assert.equal(randomIntent, null, 'Randomize remains neutral');
    report.checks.push({ name: 'Creator neutral Randomize', intent: randomIntent });
    await capture('creator-desktop'); await page.locator('[data-next]').click();
    report.limits.push('Creator uses neutral section navigation rather than a dedicated Back control; Continue and Cancel were exercised.');
    await capture('creator-next'); await page.locator('[data-cancel]').click();
    await page.locator('#options-toggle').click(); await page.locator('#new-game').click();
    await page.locator('#new-game-dialog[open]').waitFor();
    await states(page.locator('#confirm-new-game'), 'affirmative', 'Destructive Start over confirmation');
    await states(page.locator('#new-game-dialog button[value="cancel"]'), 'negative', 'Keep playing');
    await capture('new-game-dialog'); await page.locator('#new-game-dialog button[value="cancel"]').click();
    if (await page.locator('#options-close').isVisible()) await page.locator('#options-close').click();
    await page.setViewportSize({ width: 320, height: 568 });
    let radialFound = false, paginationFound = false;
    const radialTargets = [];
    for (let index = 0; index < 24; index++) {
      await page.locator('#stage').focus();
      for (let step = 0; step <= index; step++) await page.keyboard.press('ArrowRight');
      radialTargets.push(await page.locator('#keyboard-target').textContent());
      await page.keyboard.press('Enter'); await settle();
      const menu = page.locator('#object-menu');
      if (await menu.locator('button').first().isVisible()) {
        if (!radialFound) { await states(menu.locator('.radial-close'), 'negative', 'Real radial Close'); await capture('radial-menu'); radialFound = true; }
        const more = menu.getByRole('button', { name: 'More actions', exact: true });
        if (await more.isVisible()) {
          await states(more, 'affirmative', 'Real radial More actions'); await capture('radial-more'); await more.click();
          await states(menu.getByRole('button', { name: 'Back', exact: true }), 'negative', 'Real radial Back');
          await capture('radial-back'); paginationFound = true; await page.keyboard.press('Escape'); break;
        }
        await page.keyboard.press('Escape');
      }
    }
    report.checks.push({ name: 'Real radial search', targets: radialTargets, paginationFound });
    assert(radialFound, 'Real radial menu reached');
    if (!paginationFound) report.limits.push('The bounded real object cycle did not require More actions/Back; component fixture covers pagination below.');
    await page.setViewportSize({ width: 1440, height: 900 });
    // Exercise exported components with controlled inputs only where live timing/data cannot guarantee a state.
    await page.evaluate(async () => {
      const { createMenuSurface, NOTHING } = await import('/src/ui/object-menu.ts');
      const root = document.querySelector('#object-menu');
      const surface = createMenuSurface(document, root);
      surface.show({ title: 'Controlled pagination fixture', entries: [
        ...Array.from({ length: 14 }, (_, i) => ({ label: `Ordinary action ${i + 1}`, action: { kind: 'use', object: 1, interaction: i } })), NOTHING,
      ] }, 720, 450, () => {});
      window.__actionColorFixture = { surface, root };
    });
    await states(page.locator('#object-menu').getByRole('button', { name: 'More actions', exact: true }), 'affirmative', 'Component radial More actions', true);
    await page.locator('#object-menu').getByRole('button', { name: 'More actions', exact: true }).click();
    await states(page.locator('#object-menu').getByRole('button', { name: 'Back', exact: true }), 'negative', 'Component radial Back', true);
    await capture('component-radial-back');
    await page.evaluate(() => { window.__actionColorFixture.surface.hide(); delete window.__actionColorFixture; });
    await page.evaluate(async () => {
      const { BookCommerce } = await import('/src/ui/book-commerce.ts');
      const { BookResults } = await import('/src/books/results.ts');
      const { ChoresBoard } = await import('/src/ui/chores-board.ts');
      const { createBedAssignmentSurface } = await import('/src/ui/bed-assignment.ts');
      const host = document.createElement('dialog'); host.id = 'action-color-components';
      host.style.cssText = 'width:600px;max-height:80vh;overflow:auto;background:var(--hud-bg);color:var(--hud-text);padding:24px';
      const heading = document.createElement('h2'); heading.textContent = 'Controlled component fixtures'; host.append(heading);
      document.body.append(host);
      let price = 12, pending = 0;
      const results = new BookResults({ takeBookResults: () => [], pendingBookCommands: () => pending });
      const source = { objectModel: () => ({ shelfCapacity: 4 }), bookPurchaseQuote: () => ({ quote: { price, wire: [] } }),
        bookPurchasePrice: () => price, bookSaleQuote: () => ({ quote: { price: 3, wire: [] } }),
        bookState: () => ({ copies: [] }), funds: () => 100, buyAutomaticBook: () => { pending = 1; return true; },
        sellBook: () => true, recoverBook: () => true };
      const commerce = new BookCommerce(source, results, document, () => {});
      const bookRoot = document.querySelector('#furniture-tool .book-commerce:last-child'); host.append(bookRoot); commerce.render(1);
      const chores = new ChoresBoard({ choreRows: () => new Uint32Array([1, 1, 0, 500, 0]), choreHistory: () => new Uint32Array(),
        selectedIndex: () => 0, choreProfileOf: () => new Int32Array([50, 50, 0, 0, 0, 0]), ids: () => new Uint32Array([0]),
        simIds: () => new Uint32Array([0]), kinds: () => new Uint32Array([0]), simName: () => 'Fixture person',
        clockTick: () => 0, dayTicks: () => 1440, choreBoardEnabled: () => false, choreLocation: () => 'Fixture room' }, document);
      host.append(chores.element()); chores.update();
      const bedHost = document.createElement('section'); bedHost.id = 'action-color-bed'; host.append(bedHost);
      const bed = createBedAssignmentSurface(document, bedHost, { choose: () => {}, assign: () => {}, clear: () => {} });
      bed({ agent: 0, places: [{ bed: 1, ordinal: 0, label: 'Fixture bed', assignee: null, assigneeName: null, occupantName: null }],
        choice: { bed: 1, ordinal: 0 }, pending: false, status: '' });
      window.__actionColorComponents = { host, commerce, results, setPrice(value) { price = value; commerce.render(1); } };
      host.showModal();
    });
    const fixture = page.locator('#action-color-components');
    await states(fixture.locator('.book-commerce button').nth(0), 'affirmative', 'Component Buy book', true);
    await states(fixture.locator('.book-commerce button').nth(1), 'destructive', 'Component Sell book', true);
    await page.evaluate(() => window.__actionColorComponents.setPrice(19));
    assert((await fixture.locator('.book-commerce button').first().textContent()).includes('19'), 'Dynamic book price updated');
    assert.equal(await fixture.locator('.book-commerce button').first().getAttribute('data-action-intent'), 'affirmative', 'Updated price retains intent');
    report.fixtures.push({ name: 'Dynamic book price', before: 12, after: 19, intent: 'affirmative' });
    await fixture.locator('.book-commerce').scrollIntoViewIfNeeded(); await capture('component-book-prices');
    await states(fixture.locator('.chore-do-now'), 'affirmative', 'Component chore Do now', true);
    await capture('component-chores');
    await states(fixture.locator('#action-color-bed button').first(), 'affirmative', 'Component bed Assign', true);
    await capture('component-bed');
    await fixture.locator('.book-commerce button').first().click();
    await page.evaluate(() => window.__actionColorComponents.commerce.render(1));
    assert(await page.evaluate(() => window.__actionColorComponents.results.pending), 'Actual BookResults request pending in fixture');
    await disabled(fixture.locator('.book-commerce button').first(), 'Component pending Buy book', true);
    await capture('component-pending-books');
    await page.evaluate(() => { window.__actionColorComponents.host.close(); window.__actionColorComponents.host.remove(); delete window.__actionColorComponents; });
    report.limits.push('No affordable Land purchase or transient live book pending state was fabricated. Book prices/pending, chore Do now, and bed Assign have controlled component evidence. Careers, recovery notices, and every catalogue item still rely on the dedicated component tests.');
    assert.equal(report.errors.length, 0, 'No browser page errors');
  } catch (error) {
    report.errors.push(String(error));
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    await context.close(); await browser.close();
  }
  process.stdout.write(JSON.stringify({ checks: report.checks.length, fixtures: report.fixtures.length, limits: report.limits, errors: report.errors }) + '\n');
})().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
