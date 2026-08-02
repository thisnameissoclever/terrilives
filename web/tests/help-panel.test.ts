import { describe, expect, it } from 'vitest';

import {
  HelpPanel,
  shouldShowHelp,
  type PreferenceStore,
} from '../src/ui/help-panel.js';

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
      scrollTop: 99,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
    let focused = 0;
    const blocked: PreferenceStore = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const panel = new HelpPanel(root, { focus: () => focused++ }, blocked);

    expect(panel.showOnFirstRun()).toBe(true);
    expect(root.open).toBe(true);
    expect(root.scrollTop).toBe(0);
    expect(focused).toBe(1);
    expect(panel.close()).toBe(true);
    expect(root.open).toBe(false);
  });

  it('does not open or move focus after dismissal', () => {
    const root = {
      open: false,
      scrollTop: 23,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
    let focused = 0;
    const panel = new HelpPanel(
      root,
      { focus: () => focused++ },
      store('1'),
    );

    expect(panel.showOnFirstRun()).toBe(false);
    expect(root.open).toBe(false);
    expect(root.scrollTop).toBe(23);
    expect(focused).toBe(0);
  });

  it('does not reopen an already open dialog', () => {
    const root = {
      open: true,
      scrollTop: 0,
      showModal() {
        throw new Error('showModal must not run twice');
      },
      close() {
        this.open = false;
      },
    };
    const panel = new HelpPanel(root, { focus() {} }, null);

    expect(panel.open()).toBe(false);
  });
});
