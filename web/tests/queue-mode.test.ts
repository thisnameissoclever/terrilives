import { describe, expect, it } from 'vitest';

import { QueueMode } from '../src/ui/queue-mode.js';

describe('QueueMode', () => {
  it('starts off and keeps its pressed state in sync through repeated taps', () => {
    const attributes = new Map<string, string>();
    const mode = new QueueMode({
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    });

    expect(mode.isActive()).toBe(false);
    expect(attributes.get('aria-pressed')).toBe('false');
    expect(mode.toggle()).toBe(true);
    expect(mode.isActive()).toBe(true);
    expect(attributes.get('aria-pressed')).toBe('true');
    expect(mode.toggle()).toBe(false);
    expect(mode.isActive()).toBe(false);
    expect(attributes.get('aria-pressed')).toBe('false');
  });
});
