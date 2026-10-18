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
    ownerDocument: { documentElement: { style }, querySelector: () => null } };
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

it('bounds overlays above the measured dock after expansion, viewport resize and hiding', () => {
  let resized = () => {};
  let windowResized = () => {};
  const observed: unknown[] = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe(node: unknown) { observed.push(node); }
    disconnect() {}
  });
  vi.stubGlobal('window', {
    addEventListener: (_event: string, callback: () => void) => { windowResized = callback; },
    removeEventListener() {},
  });
  const properties = new Map<string, string>();
  const style = {getPropertyValue: (key: string) => properties.get(key) ?? '',
    setProperty: (key: string, value: string) => properties.set(key, value),
    removeProperty: (key: string) => properties.delete(key)};
  let dockBounds = {top:675.6,width:374,height:160};
  const dock = {getBoundingClientRect: () => dockBounds};
  const root = {offsetWidth:182,clientWidth:182,style,children:[],querySelector:()=>null,
    ownerDocument:{documentElement:{style},querySelector:()=>dock}};
  try {
    const cleanup = observeHudScrollbar(root as unknown as HTMLElement);
    expect(observed).toContain(dock);
    expect(properties.get('--sim-dock-top')).toBe('675px');
    dockBounds = {top:510.2,width:374,height:326}; resized();
    expect(properties.get('--sim-dock-top')).toBe('510px');
    dockBounds = {top:290.8,width:634,height:92}; windowResized();
    expect(properties.get('--sim-dock-top')).toBe('290px');
    dockBounds = {top:0,width:0,height:0}; resized();
    expect(properties.has('--sim-dock-top')).toBe(false);
    cleanup();
  } finally { vi.unstubAllGlobals(); }
});
