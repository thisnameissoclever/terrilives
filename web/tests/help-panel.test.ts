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
    const root = { hidden: false };
    const blocked: PreferenceStore = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const panel = new HelpPanel(root, blocked);

    panel.showOnFirstRun();
    expect(root.hidden).toBe(false);
    panel.close();
    expect(root.hidden).toBe(true);
  });
});
