import { expect, it, vi } from 'vitest';
import { preventMenuSelection } from '../src/ui/menu-selection.js';

it.each(['selectstart', 'contextmenu'])('cancels native %s on the game menu', type => {
  const menu = new EventTarget();
  preventMenuSelection(menu);
  const event = new Event(type, { cancelable: true });
  expect(menu.dispatchEvent(event)).toBe(false);
  expect(event.defaultPrevented).toBe(true);
});

it.each(['pointerdown', 'pointerup', 'touchstart', 'touchmove', 'click', 'keydown'])(
  'preserves %s for menu activation, keyboard use and scrolling', type => {
    const menu = new EventTarget();
    preventMenuSelection(menu);
    const listener = vi.fn();
    menu.addEventListener(type, listener);
    const event = new Event(type, { cancelable: true });
    expect(menu.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  },
);

it('does not suppress selection or native menus on unrelated controls', () => {
  const menu = new EventTarget(), input = new EventTarget();
  preventMenuSelection(menu);
  for (const type of ['selectstart', 'contextmenu']) {
    expect(input.dispatchEvent(new Event(type, { cancelable: true }))).toBe(true);
  }
});
