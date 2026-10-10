import { describe, expect, it } from 'vitest';
import {
  DESKTOP_SITE_DISMISSED_KEY, DESKTOP_SITE_TEXT, looksLikeDesktopSiteOnPhone, noticeScale, showDesktopSiteNotice,
} from '../src/ui/desktop-site-notice.js';

const phone = { coarse: true, screenWidth: 412, screenHeight: 915 };

describe('desktop mode on a phone', () => {
  it('is recognised when a touch phone is laid out at the desktop width', () => {
    expect(looksLikeDesktopSiteOnPhone({ ...phone, layoutWidth: 980 })).toBe(true);
  });

  it('is not flagged at the phone width, on a mouse, on a tablet or with no screen size', () => {
    expect(looksLikeDesktopSiteOnPhone({ ...phone, layoutWidth: 412 })).toBe(false);
    expect(looksLikeDesktopSiteOnPhone({ ...phone, coarse: false, layoutWidth: 980 })).toBe(false);
    expect(looksLikeDesktopSiteOnPhone({ coarse: true, screenWidth: 820, screenHeight: 1180, layoutWidth: 1280 })).toBe(false);
    expect(looksLikeDesktopSiteOnPhone({ coarse: true, screenWidth: 0, screenHeight: 0, layoutWidth: 980 })).toBe(false);
  });

  it('leaves a sideways phone alone, where the desktop width is barely wider than the screen', () => {
    expect(looksLikeDesktopSiteOnPhone({ coarse: true, screenWidth: 915, screenHeight: 412, layoutWidth: 980 })).toBe(false);
  });

  it('scales the notice up by as much as the page was shrunk, never down', () => {
    expect(noticeScale({ ...phone, layoutWidth: 980 })).toBeCloseTo(980 / 412);
    expect(noticeScale({ ...phone, layoutWidth: 300 })).toBe(1);
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
    innerWidth: layoutWidth, screen: { width: 412, height: 915 },
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
    const [panel] = appended as unknown as { id: string; removed: boolean; children: { textContent: string; listeners: Record<string, () => void> }[] }[];
    expect(panel.id).toBe('desktop-site-notice');
    expect(panel.children[0].textContent).toBe(DESKTOP_SITE_TEXT);
    expect(panel.children[1].textContent).toBe('Close');
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
