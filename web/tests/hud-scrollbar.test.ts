import { expect, it, vi } from 'vitest';
import { observeHudScrollbar } from '../src/ui/hud-scrollbar.js';

it('preserves usable sidebar width as its scrollbar appears and disappears', () => {
  let resized = () => {};
  const disconnect = vi.fn();
  const listeners = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal('window', listeners);
  const properties = new Map<string, string>();
  const style = { getPropertyValue: (key: string) => properties.get(key) ?? '',
    setProperty: (key: string, value: string) => properties.set(key, value) };
  const root = { offsetWidth: 244, clientWidth: 220, style, children: [],
    querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 84.2 }) }),
    ownerDocument: { documentElement: { style } } };
  try {
    const cleanup = observeHudScrollbar(root as unknown as HTMLElement);
    expect(properties.get('--hud-scrollbar-width')).toBe('24px');
    expect(properties.get('--hud-summary-bottom')).toBe('93px');
    root.offsetWidth = 220; resized();
    expect(properties.get('--hud-scrollbar-width')).toBe('0px');
    root.offsetWidth = 235; resized();
    expect(properties.get('--hud-scrollbar-width')).toBe('15px');
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(listeners.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  } finally { vi.unstubAllGlobals(); }
});
