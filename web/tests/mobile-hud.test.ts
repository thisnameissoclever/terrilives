import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const DOCK_CSS = readFileSync(new URL('../src/ui/compact-hud.css', import.meta.url), 'utf8');
const ALL_STYLES = INDEX_HTML + DOCK_CSS;

/** The rules of the first `@media` block whose condition matches `condition`. */
function mediaBlock(condition: RegExp, source = INDEX_HTML): string {
  const start = source.search(condition);
  if (start < 0) return '';
  let depth = 0;
  for (let at = source.indexOf('{', start); at < source.length; at += 1) {
    if (source[at] === '{') depth += 1;
    if (source[at] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, at);
  }
  return '';
}

// [B-phone-build-dock] in docs/FEATURES.md: each Build tool holds a region of
// choices and a footer of its status and the buttons that act on it. On a
// phone at least 481 pixels tall only the choices scroll, so the footer is
// always in view and nothing ever sits behind it.
describe('the phone Build dock', () => {
  /** The markup of the `<div class="{kind}">` holding `#id`, or '' when none does. */
  function groupOf(kind: string, id: string): string {
    const at = INDEX_HTML.indexOf(`id="${id}"`);
    const matches = [...INDEX_HTML.slice(0, at).matchAll(new RegExp(`<div\\b[^>]*class="${kind}"[^>]*>`, 'g'))];
    const open = matches.at(-1)?.index ?? -1;
    if (at < 0 || open < 0) return '';
    const tags = /<\/?div\b/g;
    tags.lastIndex = open;
    let depth = 0;
    for (let tag = tags.exec(INDEX_HTML); tag; tag = tags.exec(INDEX_HTML)) {
      depth += tag[0] === '<div' ? 1 : -1;
      if (depth === 0) return at < tag.index ? INDEX_HTML.slice(open, tag.index) : '';
    }
    return '';
  }

  const COMPACT = /@media\s*\(max-width:\s*600px\)\s*,\s*\(max-height:\s*480px\)/;
  const TALL = /@media\s*\(max-width:\s*600px\)\s*and\s*\(min-height:\s*481px\)/;
  const NARROW = /@media\s*\(max-width:\s*300px\)/;

  it.each([
    ['builder-status', ['builder-confirm', 'builder-cancel', 'builder-sell', 'builder-sale-note']],
    ['wall-status', ['wall-build', 'wall-doorway', 'wall-window', 'wall-remove']],
    ['window-status', ['window-fit', 'window-remove']],
    ['room-status', ['room-build', 'room-cancel']],
    ['buy-status', ['buy-confirm', 'buy-cancel']],
  ])('puts %s in one footer with the buttons that act on it', (status, buttons) => {
    const footer = groupOf('builder-actions', status);
    expect(footer).toContain(`id="${status}"`);
    for (const button of buttons) expect(footer).toContain(`id="${button}"`);
  });

  it.each([
    ['builder-object', ['builder-rotate', 'builder-rotation-note', 'builder-keyboard-help', 'builder-touch-help']],
    ['buy-object', ['buy-filter', 'buy-rotate', 'buy-price', 'buy-serves', 'buy-keyboard-help', 'buy-touch-help']],
    ['wall-keyboard-help', ['wall-touch-help']],
    ['window-models', ['window-keyboard-help', 'window-touch-help', 'window-back']],
    ['room-keyboard-help', ['room-touch-help']],
  ])('puts %s in the choices above that footer', (first, rest) => {
    const choices = groupOf('builder-choices', first);
    for (const id of [first, ...rest]) expect(choices).toContain(`id="${id}"`);
    expect(choices).not.toContain('builder-actions');
  });

  it('trims the panel on every compact screen', () => {
    const compact = mediaBlock(COMPACT);
    // The whole panel, border included, stays at 45% of the screen.
    expect(compact).toMatch(/#builder-dock #builder-controls\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-height:\s*45dvh;[^}]*overflow-y:\s*auto/);
    // The heading and the paused note leave the view but not the page.
    expect(compact).toMatch(/#builder-dock #builder-name,\s*#builder-dock #builder-paused\s*\{[^}]*position:\s*absolute;[^}]*clip-path:\s*inset\(50%\)/);
    // The four tools share one row, their side padding trimmed so the
    // longest label fits at 320 wide.
    expect(compact).toMatch(/#builder-dock #build-tools\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(compact).toMatch(/#builder-dock #build-tools \.hud-button\s*\{\s*padding-inline:\s*2px;/);
    // Each list's label sits beside it.
    expect(compact).toMatch(/#builder-dock \.builder-choices\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);/);
    expect(compact).toMatch(/#builder-dock \.builder-choices > :not\(label\):not\(select\)\s*\{\s*grid-column:\s*1 \/ -1;/);
    // Sell joins Confirm and Cancel.
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions\s*\{\s*grid-template-columns:\s*repeat\(3,/);
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions > \.builder-row\s*\{\s*display:\s*contents;/);
    expect(compact).toMatch(/#builder-dock #furniture-tool \.builder-actions > p\s*\{\s*grid-column:\s*1 \/ -1;/);
  });

  it('scrolls only the choices where the panel is tall enough', () => {
    const tall = mediaBlock(TALL);
    // The panel scrolls whole only when the footer and the choices' floor
    // do not fit, as on a 320 by 481 screen with a long status.
    expect(tall).toMatch(/#builder-dock #builder-controls:not\(\[hidden\]\)\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow-y:\s*auto;/);
    expect(tall).toMatch(/#builder-dock #builder-controls > \.builder-tool:not\(\[hidden\]\)\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
    expect(tall).toMatch(/#builder-dock \.builder-choices\s*\{[^}]*box-sizing:\s*border-box;[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
    // Where a tool has a list, its choices never shrink below one whole list
    // row and its outline, including Walls when its Windows chooser is open.
    expect(tall).toMatch(/#builder-dock #furniture-tool \.builder-choices,\s*#builder-dock #buy-tool \.builder-choices,\s*#builder-dock #wall-tool\.window-editing \.builder-choices\s*\{\s*min-height:\s*52px;\s*\}/);
    expect(tall).toMatch(/#builder-dock \.builder-actions\s*\{[^}]*flex:\s*none;/);
    // Nothing is pinned over content anywhere, so focus is never hidden.
    expect(INDEX_HTML).not.toContain('sticky');
  });

  // Below 481 pixels of height the panel can be 144 pixels tall, too short
  // for a fixed footer and a region above it, so the whole panel scrolls.
  // The person and How they feel toggles share this block and are flex
  // boxes by design, so their rules are set aside before the check.
  it('leaves the short panel to scroll whole', () => {
    const matches = [...ALL_STYLES.matchAll(new RegExp(COMPACT.source, 'g'))];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const match of matches) {
      const block = mediaBlock(COMPACT, ALL_STYLES.slice(match.index));
      const withoutToggles = block.replace(/\.needs-caption[^{}]*\{[^}]*\}/g, '');
      expect(withoutToggles).not.toMatch(/display:\s*flex/);
    }
  });

  // On a desktop the choices join the tool's own grid and the help lines
  // follow the footer, so the side panel reads as it did before.
  it('keeps the desktop order: choices, footer, then help', () => {
    expect(INDEX_HTML).toMatch(/\n      \.builder-choices\s*\{\s*display:\s*contents;\s*\}/);
    expect(INDEX_HTML).toMatch(/\n      \.builder-help\s*\{\s*order:\s*1;\s*\}/);
    for (const id of ['builder-keyboard-help', 'builder-touch-help', 'buy-keyboard-help', 'buy-touch-help',
      'wall-keyboard-help', 'wall-touch-help', 'room-keyboard-help', 'room-touch-help']) {
      expect(INDEX_HTML).toMatch(new RegExp(`id="${id}" class="builder-note builder-help"`));
    }
  });

  // The phone layout gives the panel and the tools displays with selectors
  // that could outrank a plain hiding rule, which once showed the Build panel
  // outside Build. Hiding is marked important, so only another important
  // display could show a hidden panel or tool, and there is none.
  it('never shows the panel or a tool the game has hidden', () => {
    expect(INDEX_HTML).toContain('#builder-controls[hidden], .builder-tool[hidden] { display: none !important; }');
    for (const tool of ['furniture', 'wall', 'room', 'buy']) {
      expect(INDEX_HTML).toContain(`<div id="${tool}-tool" class="builder-tool"`);
    }
    const uncommented = ALL_STYLES.replace(/\/\*[\s\S]*?\*\//g, '');
    const important = [...uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /display:[^;}]*!important/.test(body))
      .map(([, selector]) => selector.trim());
    expect(important).toEqual(['#builder-controls[hidden], .builder-tool[hidden]', '#sim-dock [hidden], #sim-dock[hidden]']);
  });

  it('puts the tools back two by two below 301 pixels wide', () => {
    expect(mediaBlock(NARROW)).toMatch(/#builder-dock #build-tools\s*\{\s*grid-template-columns:\s*1fr 1fr;/);
  });
});

// On every compact screen the Needs and People toggles are flex boxes, so a
// caption that wraps, such as "How Ann feels", stays one 44-pixel target with
// its text centred. A flex summary loses the browser's open and closed
// triangle, so the compact layout draws its own.
describe('the compact Needs and People toggles', () => {
  const COMPACT = /@media\s*\(max-width:\s*600px\)\s*,\s*\(max-height:\s*480px\)/;
  const PHONE = /@media\s*\(max-width:\s*600px\)\s*\{/;
  const SIDEWAYS = /@media\s*\(max-height:\s*480px\)\s*and\s*\(min-width:\s*361px\)/;

  it('stay one centred 44-pixel target however the caption wraps', () => {
    const compact = mediaBlock(COMPACT);
    expect(compact).toMatch(/\n        \.needs-caption\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*44px;[^}]*align-items:\s*center;/);
    expect(compact).not.toMatch(/\.needs-caption\s*\{[^}]*line-height:\s*44px/);
  });

  it('draw a triangle that points right when closed and down when open', () => {
    const compact = mediaBlock(COMPACT);
    // A border shape with no text, so a screen reader hears only the caption.
    expect(compact).toMatch(/\n        \.needs-caption::before\s*\{[^}]*content:\s*'';[^}]*flex:\s*none;[^}]*border-block:\s*5px solid transparent;[^}]*border-left:\s*6px solid currentColor;/);
    expect(compact).toMatch(/\n        details\[open\] > \.needs-caption::before\s*\{\s*transform:\s*rotate\(90deg\);\s*\}/);
    // Safari draws its own marker inside a flex summary; one triangle only.
    expect(compact).toMatch(/\n        \.needs-caption::-webkit-details-marker\s*\{\s*display:\s*none;\s*\}/);
  });

  // High Contrast paints every border in the system text colour, the
  // transparent ones too, which turns the triangle into a solid bar.
  it('keep the triangle a triangle under forced colours', () => {
    expect(mediaBlock(COMPACT)).toMatch(/@media\s*\(forced-colors:\s*active\)\s*\{\s*\.needs-caption::before\s*\{\s*forced-color-adjust:\s*none;\s*border-left-color:\s*CanvasText;\s*\}/);
  });

  // A phone held sideways, 812 by 375 say, is wider than 600 pixels, so it
  // matches only the blocks for every compact screen and for short wide
  // screens. The toggle rules live in the first of those and nowhere else,
  // so that phone gets the same 44-pixel toggles and never a second triangle.
  it('are styled once, where a sideways phone reads them too', () => {
    expect(mediaBlock(PHONE)).not.toContain('.needs-caption');
    expect(mediaBlock(SIDEWAYS)).not.toContain('.needs-caption');
    expect(INDEX_HTML.match(/\.needs-caption::before\s*\{[^}]*content:/g) ?? []).toHaveLength(1);
    expect(INDEX_HTML.match(/\.needs-caption::-webkit-details-marker/g) ?? []).toHaveLength(1);
  });

  it('keeps the People disclosure keyboard reachable', () => {
    expect(INDEX_HTML).toContain('<summary id="people-caption" class="needs-caption">');
  });
});
