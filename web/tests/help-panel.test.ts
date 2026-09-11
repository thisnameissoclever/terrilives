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

/**
 * Every style rule in the page whose selector would match the help dialog
 * while it is CLOSED, from anywhere in the stylesheet including inside a media
 * query. A rule carrying `[open]`, `:open`, or `:not(...)` is excluded: those
 * do not apply to the closed dialog, which is the state at issue.
 *
 * This is a text model of the cascade, not a cascade. It is here because the
 * one rule it guards is worth guarding cheaply in CI; a browser-driven check
 * is what actually proves the dialog hides.
 */
function rulesMatchingClosedHelpDialog(): { selector: string; declarations: string }[] {
  const rules: { selector: string; declarations: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(INDEX_HTML)) !== null) {
    const selectorText = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (selectorText.length === 0 || selectorText.startsWith('@')) continue;
    for (const selector of selectorText.split(',').map((part) => part.trim())) {
      // Only rules that target the dialog element itself, not its descendants.
      if (!/(^|[\s>+~])(dialog|#help-panel)[^\s>+~]*$/.test(selector)) continue;
      if (/\[open\]|:open|:not\(/.test(selector)) continue;
      rules.push({ selector, declarations: match[2] });
    }
  }
  return rules;
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

  it('keeps the three declarations that actually hold the button on screen', () => {
    // These are the load-bearing ones, and the easiest to mistake for noise.
    // The dialog clips its overflow, so if the column stops being a flex
    // column, or the body stops being allowed to shrink under its content,
    // the footer is not pushed below the fold - it is clipped away entirely,
    // with no scrollbar anywhere and no way to reach "Got it".
    const open = cssBlock('#help-panel[open]');
    expect(open).toMatch(/display:\s*flex;/);
    expect(open).toMatch(/flex-direction:\s*column;/);
    expect(cssBlock('#help-body')).toMatch(/min-height:\s*0;/);
    expect(cssBlock('#help-actions')).toMatch(/flex:\s*0 0 auto;/);
  });

  it('lets the browser hide the dialog once it is closed', () => {
    // The browser hides a closed dialog with its own
    // `dialog:not([open]) { display: none }`. Any unconditional `display` in
    // an author rule outranks that, so the dialog would stay on screen after
    // "Got it" and reappear on every later load despite being dismissed.
    //
    // Checking only the base `#help-panel` rule is not enough: the same
    // element is matched by a bare `dialog` selector and by `#help-panel`
    // inside the compact-screen media query, and a `display` in either brings
    // the bug straight back - on phones specifically, for the media query.
    // So this sweeps every rule that can match this dialog while it is
    // closed, wherever in the stylesheet it sits.
    const offenders = rulesMatchingClosedHelpDialog().filter((rule) =>
      /(^|[;{\s])display\s*:/.test(rule.declarations),
    );
    expect(offenders.map((rule) => rule.selector)).toEqual([]);
  });

  it('clears the phone system bars on every edge it can be pushed against', () => {
    // Centring dropped the bottom inset the old corner-pinned rule carried,
    // which put the button under an Android navigation bar in landscape.
    const panel = cssBlock('#help-panel');
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect({
        edge,
        safe: new RegExp(
          `padding-${edge}:\\s*max\\([^)]*env\\(safe-area-inset-${edge}\\)`,
        ).test(panel),
      }).toEqual({ edge, safe: true });
    }
    // Order is load-bearing, and silently so. The `padding` shorthand resets
    // all four sides, so moving it below the longhands - which reads like
    // harmless tidying, since it looks like it belongs with them - collapses
    // every inset above back to a flat 16px and puts the button under the
    // system bar again, with all four assertions still green.
    const shorthand = panel.indexOf('padding: 16px');
    expect(shorthand).toBeGreaterThan(-1);
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect({
        edge,
        shorthandFirst: shorthand < panel.indexOf(`padding-${edge}:`),
      }).toEqual({ edge, shorthandFirst: true });
    }
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
