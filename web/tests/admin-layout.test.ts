import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPACT_HUD_MEDIA_QUERY } from '../src/ui/compact-hud.js';

// The admin panel's layout ([AP-web-phone], [AP-tests-web] item 6 and [T14] in
// docs/specs/2026-11-20-admin-panel.md). The stylesheet is read as text and cut
// into rules, so each test names the declaration that makes the layout true.
// Whether the controls fit in a rendered phone is judged in the played pass.

const CSS = readFileSync(new URL('../src/ui/admin-panel.css', import.meta.url), 'utf8');

interface Rule { readonly media: string | null; readonly selectors: readonly string[]; readonly decls: Readonly<Record<string, string>> }

function parse(source: string, media: string | null = null): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    if (open < 0) break;
    const prelude = css.slice(at, open).trim();
    let depth = 1;
    let close = open + 1;
    for (; close < css.length && depth > 0; close += 1) {
      if (css[close] === '{') depth += 1;
      if (css[close] === '}') depth -= 1;
    }
    const body = css.slice(open + 1, close - 1);
    if (prelude.startsWith('@media')) rules.push(...parse(body, prelude.slice('@media'.length).trim()));
    else {
      const decls: Record<string, string> = {};
      for (const part of body.split(';')) {
        const colon = part.indexOf(':');
        if (colon > 0) decls[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
      }
      rules.push({ media, selectors: prelude.split(',').map(s => s.trim()), decls });
    }
    at = close;
  }
  return rules;
}

const RULES = parse(CSS);

/** The declarations the sheet gives `selector` (alone or in a list) inside `media`, later rules winning. */
function style(selector: string, media: string | null = null): Record<string, string> {
  return Object.assign({}, ...RULES.filter(rule => rule.media === media && rule.selectors.includes(selector)).map(rule => rule.decls));
}

/** The compact query as COMPACT_HUD_MEDIA_QUERY says it, in the range syntax the sheet uses. */
const COMPACT = COMPACT_HUD_MEDIA_QUERY
  .replace(/\(max-width: (\d+px)\)/, '(width <= $1)')
  .replace(/\(max-height: (\d+px)\)/, '(height <= $1)');
const TOUCH = `${COMPACT}, (any-pointer: coarse)`;

describe('the query', () => {
  it('is the one the compact HUD uses', () => {
    expect(COMPACT).toBe('(width <= 600px), (height <= 480px)');
    expect(RULES.some(rule => rule.media === COMPACT)).toBe(true);
  });
});

describe('the dialog on a desktop', () => {
  it('is bounded and centred inside the window with a margin', () => {
    const dialog = style('#admin-panel');
    expect(dialog.width).toBe('min(1240px, calc(100vw - 48px))');
    expect(dialog.height).toBe('min(820px, calc(100dvh - 48px))');
    expect(dialog.margin).toBe('auto');
    expect(dialog.overflow).toBe('hidden');
  });

  it('lets the header wrap and its identity and Undo shrink, so doubled text never pushes Close out', () => {
    expect(style('.admin-header')['flex-wrap']).toBe('wrap');
    expect(style('.admin-title')['flex-wrap']).toBe('wrap');
    expect(style('.admin-title')['min-width']).toBe('0');
    const undo = style('.admin-undo');
    expect(undo['max-width']).toBe('min(22em, 100%)');
    // "Undo" and ": {change}" are two spans: no flex gap may open between them, and the change ends in an ellipsis.
    expect(undo.gap).toBe('0');
    const detail = style('.admin-undo-detail');
    expect(detail.overflow).toBe('hidden');
    expect(detail['text-overflow']).toBe('ellipsis');
  });

  it('keeps the header and tab row fixed while the body scrolls', () => {
    expect(style('.admin-body')['overflow-y']).toBe('auto');
    expect(style('.admin-body')['min-height']).toBe('0');
  });
});

describe('the dialog on a phone', () => {
  it('fills the screen with no border or radius, inside the safe area', () => {
    const dialog = style('#admin-panel', COMPACT);
    expect(dialog.width).toBe('100vw');
    expect(dialog.height).toBe('100dvh');
    expect(dialog['max-width']).toBe('100vw');
    expect(dialog['max-height']).toBe('100dvh');
    expect(dialog.border).toBe('0');
    expect(dialog['border-radius']).toBe('0');
    expect(style('.admin-body', COMPACT).padding).toBe('12px max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))');
  });

  it('wraps the pill under the title, with Undo and Close at the right', () => {
    const header = style('.admin-header', COMPACT);
    expect(header.display).toBe('grid');
    expect(header['grid-template-columns']).toBe('minmax(0, 1fr) auto auto');
    expect(style('.admin-title', COMPACT)['grid-column']).toBe('1');
    expect(style('.admin-undo', COMPACT)['grid-column']).toBe('2');
    expect(style('.admin-close', COMPACT)['grid-column']).toBe('3');
    const pill = style('.admin-pill', COMPACT);
    expect(pill['grid-column']).toBe('1 / -1');
    expect(pill['grid-row']).toBe('2');
    expect(pill['justify-self']).toBe('start');
  });

  it('shows only the word Undo, and drops the key hint a phone cannot use', () => {
    expect(style('.admin-undo-detail', COMPACT).display).toBe('none');
    expect(style('.admin-header .admin-hint', COMPACT).display).toBe('none');
    // Row hints such as a pay range or "2 earns a promotion" stay on a phone; only the header's key hint goes.
    expect(style('.admin-hint', COMPACT).display).toBeUndefined();
    expect(style('.admin-spacer', COMPACT).display).toBe('none');
    // The full label stays the button's name and title; that is markup, tested with the shell.
  });

  it('spans the width with the tabs and the picker', () => {
    const tabs = style('.admin-tabs', COMPACT);
    expect(tabs.display).toBe('grid');
    expect(tabs['grid-template-columns']).toBe('repeat(3, minmax(0, 1fr))');
    const picker = style('.admin-picker', COMPACT);
    expect(picker.display).toBe('grid');
    expect(picker['grid-template-columns']).toBe('repeat(auto-fit, minmax(6rem, 1fr))');
    expect(style('.admin-bar', COMPACT)['align-items']).toBe('stretch');
    // A long name or a doubled label wraps in its button instead of leaving the screen.
    expect(style('.admin-tab', COMPACT)['overflow-wrap']).toBe('anywhere');
    expect(style('.admin-person', COMPACT)['overflow-wrap']).toBe('anywhere');
  });

  it('stacks every section in one column', () => {
    expect(style('.admin-columns', '(width <= 900px)')['grid-template-columns']).toBe('minmax(0, 1fr)');
    expect(style('.admin-household', '(width <= 900px)')['grid-template-columns']).toBe('minmax(0, 1fr)');
  });

  it('puts each slider under its label with the number box at the right', () => {
    const row = style('.admin-slider-row', COMPACT);
    expect(row.display).toBe('grid');
    expect(row['grid-template-columns']).toBe('minmax(0, 1fr) auto');
    expect(style('.admin-slider-row > .admin-row-label', COMPACT)).toMatchObject({ 'grid-column': '1', 'grid-row': '1' });
    expect(style('.admin-slider-row > .admin-number', COMPACT)).toMatchObject({ 'grid-column': '2', 'grid-row': '1' });
    expect(style('.admin-slider-row > .admin-slider', COMPACT)).toMatchObject({ 'grid-column': '1 / -1', 'grid-row': '2' });
  });

  it('turns the bill table into one card per bill, actions in a row under the fields', () => {
    for (const selector of ['.admin-bill-table', '.admin-bill-table tbody']) expect(style(selector, COMPACT).display).toBe('block');
    expect(style('.admin-bill-table thead', COMPACT).display).toBe('none');
    const card = style('.admin-bill-row', COMPACT);
    expect(card.display).toBe('grid');
    expect(card['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    expect(style('.admin-bill-name', COMPACT)['grid-column']).toBe('1');
    expect(style('.admin-bill-status', COMPACT)).toMatchObject({ 'grid-column': '2', 'text-align': 'right' });
    expect(style('.admin-bill-new .admin-bill-name', COMPACT)['grid-column']).toBe('1 / -1');
    expect(style('.admin-bill-due', COMPACT)['grid-column']).toBe('1 / -1');
    expect(style('.admin-bill-row > .admin-bill-actions', COMPACT)).toMatchObject({ 'grid-column': '1 / -1', 'grid-row': '4' });
    expect(style('.admin-bill-status:empty', COMPACT).display).toBe('none');
    // Each field names itself above the box, from the cell's data-label.
    expect(style('.admin-bill-row > td[data-label]::before', COMPACT).content).toBe('attr(data-label)');
    expect(style('.admin-bill-money', COMPACT).display).toBe('flex');
    // Cells of a card have no table borders left over.
    expect(style('.admin-bill-row > td', COMPACT).border).toBe('0');
  });
});

describe('touch targets', () => {
  const buttons = ['.admin-undo', '.admin-close', '.admin-tab', '.admin-person', '.admin-action', '.admin-number', '.admin-select'];

  it.each(buttons)('make %s at least 44 px tall on a phone or any touch screen', selector => {
    expect(style(selector, TOUCH)['min-height']).toBe('44px');
  });

  it('give a slider a 44 px track and a check box a 44 px row', () => {
    expect(style('.admin-slider', TOUCH).height).toBe('44px');
    expect(style('.admin-check-row', TOUCH)['min-height']).toBe('44px');
    expect(style('.admin-check', TOUCH)).toMatchObject({ width: '28px', height: '28px' });
  });

  it('lets a number box keep its width but not shrink under 44 px wide', () => {
    expect(style('.admin-number', TOUCH)['min-width']).toBe('44px');
  });

  it('keeps the touch rule and the layout query in step with the HUD', () => {
    expect(TOUCH).toBe('(width <= 600px), (height <= 480px), (any-pointer: coarse)');
  });
});

describe('focus and status colours', () => {
  it('draws no ring around the title when the shell focuses it for screen readers', () => {
    // The heading takes focus from script after showModal; a keyboard open makes that focus-visible.
    expect(style('.admin-title:focus')).toMatchObject({ outline: 'none' });
    expect(RULES.filter(rule => rule.selectors.includes('.admin-title:focus-visible'))).toEqual([]);
  });

  it('gives Overdue, the grace status and Paid each their own colour, Overdue the strongest', () => {
    const overdue = style('.admin-bill-overdue');
    const grace = style('.admin-bill-grace');
    const paid = style('.admin-bill-paid');
    expect(overdue.color).toContain('--hud-danger');
    expect(paid.color).toContain('--career-up');
    expect(grace.color).toContain('--admin-warn');
    expect(new Set([overdue.color, grace.color, paid.color]).size).toBe(3);
    expect(overdue['font-weight']).toBe('700');
    expect(paid['font-weight']).toBe('400');
  });

  it('stacks the Housemate tab in the mockup order on a phone: Mood before Repetition', () => {
    expect(style('.admin-housemate > .admin-column', COMPACT)).toMatchObject({ display: 'contents' });
    const order = (selector: string) => Number(style(selector, COMPACT).order);
    const mood = order('.admin-housemate > .admin-column:nth-child(2) > :first-child');
    const repetition = order('.admin-housemate > .admin-column:nth-child(1) > .admin-section-fold');
    const likes = order('.admin-housemate > .admin-column:nth-child(2) > :nth-child(2)');
    const rest = order('.admin-housemate > .admin-column:nth-child(3) > *');
    expect([mood, repetition, likes, rest]).toEqual([1, 2, 3, 4]);
  });

  it('folds the six housemate sections only under the compact query', () => {
    expect(style('.admin-section-summary')).toMatchObject({ display: 'none' });
    expect(style('.admin-section-fold > .admin-section-head', COMPACT)).toMatchObject({ cursor: 'pointer' });
    expect(style('.admin-section-fold:not([open]) .admin-range', COMPACT)).toMatchObject({ display: 'none' });
  });
});
