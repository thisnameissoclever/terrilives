import { describe, expect, it } from 'vitest';
import {
  DESKTOP_SITE_DISMISSED_KEY, DESKTOP_SITE_TEXT, looksLikeDesktopSiteOnPhone, noticeScale, showDesktopSiteNotice,
} from '../src/ui/desktop-site-notice.js';

const phone = { coarse: true, screenWidth: 412, screenHeight: 915 };
// Portrait desktop mode lays the page out 980 wide, as tall as the screen allows.
const desktopPortrait = { ...phone, layoutWidth: 980, layoutHeight: 2176 };

describe('desktop mode on a phone', () => {
  it('is recognised when a touch phone is laid out at the desktop width', () => {
    expect(looksLikeDesktopSiteOnPhone(desktopPortrait)).toBe(true);
  });

  it('is not flagged at the phone width, on a mouse, on a tablet or with no screen size', () => {
    expect(looksLikeDesktopSiteOnPhone({ ...phone, layoutWidth: 412, layoutHeight: 915 })).toBe(false);
    expect(looksLikeDesktopSiteOnPhone({ ...desktopPortrait, coarse: false })).toBe(false);
    expect(looksLikeDesktopSiteOnPhone({ coarse: true, screenWidth: 820, screenHeight: 1180, layoutWidth: 1280, layoutHeight: 1842 })).toBe(false);
    expect(looksLikeDesktopSiteOnPhone({ coarse: true, screenWidth: 0, screenHeight: 0, layoutWidth: 980, layoutHeight: 2176 })).toBe(false);
  });

  it('leaves a sideways phone alone, where the desktop width is barely wider than the screen', () => {
    expect(looksLikeDesktopSiteOnPhone({ coarse: true, screenWidth: 915, screenHeight: 412, layoutWidth: 980, layoutHeight: 441 })).toBe(false);
  });

  it('leaves a sideways iPhone alone, though iOS reports its screen upright', () => {
    // iPhone 14 in landscape at the phone layout: 844 x 390 page, 390 x 844 screen.
    expect(looksLikeDesktopSiteOnPhone({ coarse: true, screenWidth: 390, screenHeight: 844, layoutWidth: 844, layoutHeight: 390 })).toBe(false);
  });

  it('scales the notice up by as much as the page was shrunk, never down', () => {
    expect(noticeScale(desktopPortrait)).toBeCloseTo(980 / 412);
    expect(noticeScale({ ...phone, layoutWidth: 300, layoutHeight: 800 })).toBe(1);
  });
});

function fakeDocument() {
  const appended: FakeElement[] = [];
  class FakeElement {
    id = ''; type = ''; textContent = ''; removed = false;
    style: Record<string, string> & { cssText?: string } = {};
    attributes: Record<string, string> = {};
    children: FakeElement[] = [];
    listeners: Record<string, () => void> = {};
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    append(...items: FakeElement[]) { this.children.push(...items); }
    addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; }
    remove() { this.removed = true; }
  }
  return { appended, document: { createElement: () => new FakeElement(), body: { append: (el: FakeElement) => appended.push(el) } } };
}

function fakeWindow(layoutWidth: number, stored: Record<string, string> = {}) {
  return {
    innerWidth: layoutWidth, innerHeight: layoutWidth * 915 / 412, screen: { width: 412, height: 915 },
    matchMedia: () => ({ matches: true }),
    localStorage: {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => { stored[key] = value; },
    } as unknown as Storage,
  };
}

describe('the desktop mode notice', () => {
  it('appears with plain instructions and a Close button that remembers the choice', () => {
    const stored: Record<string, string> = {};
    const { document, appended } = fakeDocument();
    expect(showDesktopSiteNotice(fakeWindow(980, stored), document as never)).toBe(true);
    const [panel] = appended as unknown as { id: string; removed: boolean; children: { textContent: string; listeners: Record<string, () => void>; attributes: Record<string,string> }[] }[];
    expect(panel.id).toBe('desktop-site-notice');
    expect(panel.children[0].textContent).toBe(DESKTOP_SITE_TEXT);
    expect(panel.children[1].textContent).toBe('Close');
    expect(panel.children[1].attributes['data-action-intent']).toBe('negative');
    panel.children[1].listeners.click();
    expect(panel.removed).toBe(true);
    expect(stored[DESKTOP_SITE_DISMISSED_KEY]).toBe('1');
  });

  it('stays away once closed, and on a normal phone layout', () => {
    const { document, appended } = fakeDocument();
    expect(showDesktopSiteNotice(fakeWindow(980, { [DESKTOP_SITE_DISMISSED_KEY]: '1' }), document as never)).toBe(false);
    expect(showDesktopSiteNotice(fakeWindow(412), document as never)).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it('still shows when browser storage throws', () => {
    const { document } = fakeDocument();
    const view = { ...fakeWindow(980), localStorage: { getItem() { throw new Error('denied'); } } as unknown as Storage };
    expect(showDesktopSiteNotice(view, document as never)).toBe(true);
  });
});
