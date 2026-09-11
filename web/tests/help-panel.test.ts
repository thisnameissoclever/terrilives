import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  HelpPanel,
  shouldShowHelp,
  type PreferenceStore,
} from '../src/ui/help-panel.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** The declarations of one CSS rule, so a check reads one block not the file. */
function cssBlock(selector: string): string {
  const start = INDEX_HTML.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no CSS rule for ${selector}`);
  const open = INDEX_HTML.indexOf('{', start);
  const close = INDEX_HTML.indexOf('}', open);
  return INDEX_HTML.slice(open + 1, close);
}

function store(value: string | null): PreferenceStore {
  return {
    getItem: () => value,
    setItem() {},
  };
}

describe('first-run help', () => {
  it('shows until the versioned guide has been dismissed', () => {
    expect(shouldShowHelp(store(null))).toBe(true);
    expect(shouldShowHelp(store('1'))).toBe(false);
    expect(shouldShowHelp(null)).toBe(true);
  });

  it('closes even when browser preference storage is blocked', () => {
    const root = {
      open: false,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
    const body = { scrollTop: 99 };
    let focused = 0;
    const blocked: PreferenceStore = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const panel = new HelpPanel(root, body, { focus: () => focused++ }, blocked);

    expect(panel.showOnFirstRun()).toBe(true);
    expect(root.open).toBe(true);
    expect(body.scrollTop).toBe(0);
    expect(focused).toBe(1);
    expect(panel.close()).toBe(true);
    expect(root.open).toBe(false);
  });

  it('does not open or move focus after dismissal', () => {
    const root = {
      open: false,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
    const body = { scrollTop: 23 };
    let focused = 0;
    const panel = new HelpPanel(
      root,
      body,
      { focus: () => focused++ },
      store('1'),
    );

    expect(panel.showOnFirstRun()).toBe(false);
    expect(root.open).toBe(false);
    expect(body.scrollTop).toBe(23);
    expect(focused).toBe(0);
  });

  it('does not reopen an already open dialog', () => {
    const root = {
      open: true,
      showModal() {
        throw new Error('showModal must not run twice');
      },
      close() {
        this.open = false;
      },
    };
    const panel = new HelpPanel(root, { scrollTop: 0 }, { focus() {} }, null);

    expect(panel.open()).toBe(false);
  });

  it('reopens the guide at the first instruction, not where it was left', () => {
    const root = {
      open: false,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
    const body = { scrollTop: 250 };
    const panel = new HelpPanel(root, body, { focus() {} }, store(null));

    expect(panel.open()).toBe(true);
    expect(body.scrollTop).toBe(0);
  });
});

describe('first-run help layout', () => {
  it('centres the dialog instead of pinning it to a screen corner', () => {
    const panel = cssBlock('#help-panel');
    expect(panel).toMatch(/inset:\s*0;/);
    expect(panel).toMatch(/margin:\s*auto;/);
    // `inset: auto <right> <bottom> auto` is what parked it bottom-right.
    expect(panel).not.toMatch(/inset:\s*\n?\s*auto/);
  });

  it('gives the guide room to read rather than a narrow column', () => {
    const width = /width:\s*min\((\d+)px/.exec(cssBlock('#help-panel'));
    expect(width).not.toBeNull();
    expect(Number(width?.[1])).toBeGreaterThanOrEqual(600);
  });

  it('scrolls the instructions inside the dialog, never the dialog itself', () => {
    // A scrolling dialog is what carried the button off the bottom of the
    // screen, so the dialog clips and the instructions own the scrollbar.
    expect(cssBlock('#help-panel')).toMatch(/overflow:\s*hidden;/);
    expect(cssBlock('#help-body')).toMatch(/overflow-y:\s*auto;/);
  });

  it('keeps the confirmation button outside the scrolling region', () => {
    const dialog = INDEX_HTML.slice(
      INDEX_HTML.indexOf('id="help-panel"'),
      INDEX_HTML.indexOf('id="new-game-dialog"'),
    );
    expect(dialog).toContain('id="help-body"');
    const bodyEnd = dialog.indexOf('</div>', dialog.indexOf('id="help-body"'));
    const button = dialog.indexOf('id="close-help"');
    expect(bodyEnd).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(bodyEnd);
  });
});
