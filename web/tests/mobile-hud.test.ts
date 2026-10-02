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

const BUILD_CSS = readFileSync(new URL('../src/ui/build-controls.css', import.meta.url), 'utf8');
describe('the compact build layout', () => {
  it('uses its own 700px breakpoint without changing the Sim dock breakpoint', () => {
    expect(BUILD_CSS).toContain('@media (max-width: 700px), (max-height: 480px)');
    expect(DOCK_CSS).toContain('@media (max-width: 600px), (max-height: 480px)');
  });
  it('keeps all five tools, Exit build and shortcuts reachable', () => {
    for (const tool of ['furniture','walls','room','buy','floors']) expect(INDEX_HTML).toContain(`id="build-tool-${tool}"`);
    expect(INDEX_HTML).toContain('class="build-navigation"');
    expect(BUILD_CSS).toContain('overflow-y: auto');
    expect(BUILD_CSS).toContain('min-height: 44px');
    expect(INDEX_HTML).toContain('#builder-controls[hidden], .builder-tool[hidden] { display: none !important; }');
    for (const prefix of ['builder','wall','room','buy','floor']) {
      expect(INDEX_HTML).toContain(`<details id="${prefix}-keyboard-help" class="shortcuts builder-help">`);
    }
  });
  it('reserves a fixed outer desktop width including padding and scrollbars', () => {
    expect(BUILD_CSS).toContain("body[data-building='true'] #hud { width: 304px; }");
    expect(BUILD_CSS).toContain('scrollbar-gutter: stable');
    expect(BUILD_CSS).toContain('box-sizing: border-box');
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
