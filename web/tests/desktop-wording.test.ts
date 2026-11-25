import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DESKTOP_EXPORT_NOTE, applyDesktopLinkWording, applyDesktopWording } from '../src/ui/desktop-wording.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** Just enough of an anchor element for the wording pass. */
class FakeLink {
  readonly children: unknown[] = [];
  private readonly attributes: Map<string, string>;
  constructor(attributes: Record<string, string>, public textContent: string | null) {
    this.attributes = new Map(Object.entries(attributes));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

/** A root whose `a[target="_blank"]` query returns the new-window links, as the browser would. */
function rootWith(links: FakeLink[]): ParentNode {
  return {
    querySelectorAll: (selector: string) => {
      expect(selector).toBe('a[target="_blank"]');
      return links.filter((link) => link.getAttribute('target') === '_blank');
    },
  } as unknown as ParentNode;
}

/** The game page's anchors, with their attributes and plain text. */
function indexLinks(): FakeLink[] {
  return [...INDEX_HTML.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map(([, attributes, text]) => new FakeLink(
    Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value])),
    text,
  ));
}

describe('installed game link wording', () => {
  it('says the guide and changelog open in a new window', () => {
    const guide = new FakeLink({ href: './guide/', target: '_blank', 'aria-label': 'Player guide (opens in a new tab)', title: 'Opens in a new tab.' }, 'Player guide');
    const changelog = new FakeLink({ href: './changelog/', target: '_blank', 'aria-label': 'Changelog (opens in a new tab)' }, 'Changelog');
    applyDesktopLinkWording(rootWith([guide, changelog]));
    expect(guide.getAttribute('aria-label')).toBe('Player guide (opens in a new window)');
    expect(guide.getAttribute('title')).toBe('Opens in a new window.');
    expect(guide.textContent).toBe('Player guide');
    expect(changelog.getAttribute('aria-label')).toBe('Changelog (opens in a new window)');
  });

  it('says a website link opens in the web browser, in its visible text too', () => {
    const link = new FakeLink(
      { href: 'https://thisnameissoclever.github.io/natural-causes-old-save/', target: '_blank' },
      'Move your Natural Causes save (opens in a new tab)',
    );
    applyDesktopLinkWording(rootWith([link]));
    expect(link.textContent).toBe('Move your Natural Causes save (opens in your web browser)');
  });

  it('leaves the visible text of a link with child elements alone', () => {
    const link = new FakeLink({ href: './guide/', target: '_blank' }, 'Guide (opens in a new tab)');
    link.children.push({});
    applyDesktopLinkWording(rootWith([link]));
    expect(link.textContent).toBe('Guide (opens in a new tab)');
  });

  it('names the app in the Export save note and leaves the website wording in the page', () => {
    const note = /<p id="save-transfer-export">([^<]*)<\/p>/.exec(INDEX_HTML);
    expect(note?.[1]).toBe("Export save downloads the game at this website. Use the recovery page above for the old website's save.");
    const element = { textContent: note![1] };
    const root = { querySelectorAll: () => [], getElementById: (id: string) => (id === 'save-transfer-export' ? element : null) };
    applyDesktopWording(root as unknown as Document);
    expect(element.textContent).toBe(DESKTOP_EXPORT_NOTE);
    expect(DESKTOP_EXPORT_NOTE).not.toMatch(/this website|download/);
  });

  it('rewords every new-tab label in the real game page', () => {
    const links = indexLinks();
    const mentions = (list: FakeLink[]) => list.filter((link) =>
      [link.getAttribute('aria-label'), link.getAttribute('title'), link.textContent].some((value) => /opens in a new tab/i.test(value ?? '')));
    // The page must still contain the links this pass exists for.
    expect(mentions(links).length).toBeGreaterThanOrEqual(4);
    applyDesktopLinkWording(rootWith(links));
    expect(mentions(links)).toEqual([]);
  });
});
