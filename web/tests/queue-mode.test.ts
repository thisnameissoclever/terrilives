import { describe, expect, it } from 'vitest';

import { QueueMode } from '../src/ui/queue-mode.js';
import { ClearOrdersAvailability, type ActionQueueRow } from '../src/ui/player-orders.js';

describe('QueueMode', () => {
  it('starts on and keeps its pressed state in sync through repeated taps', () => {
    const attributes = new Map<string, string>();
    const mode = new QueueMode({
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    });

    expect(mode.isActive()).toBe(true);
    expect(attributes.get('aria-pressed')).toBe('true');
    expect(mode.toggle()).toBe(false);
    expect(mode.isActive()).toBe(false);
    expect(attributes.get('aria-pressed')).toBe('false');
    expect(mode.toggle()).toBe(true);
    expect(mode.isActive()).toBe(true);
    expect(attributes.get('aria-pressed')).toBe('true');
  });
});

it('enables clearing only for the selected person\'s player orders', () => {
  const button = {disabled: true};
  const availability = new ClearOrdersAvailability(button, 100);
  let selected: number | null = 7;
  let waiting = 0;
  let rows: ActionQueueRow[] = [];
  const source = {selectedIndex: () => selected, queuedOrdersOf: () => waiting, actionQueueRowsOf: () => rows};
  const active: ActionQueueRow = {orderId: '19', label: 'Read', phase: 'running', role: 'initiator', counterpart: null, reason: null};

  availability.update(0, source);
  expect(button.disabled).toBe(true);
  rows = [{...active, orderId: null}];
  availability.update(100, source);
  expect(button.disabled).toBe(true);
  rows = [active];
  availability.update(200, source);
  expect(button.disabled).toBe(false);
  rows = [];
  waiting = 1;
  availability.update(300, source);
  expect(button.disabled).toBe(false);
  waiting = 0;
  availability.update(400, source);
  expect(button.disabled).toBe(true);
  rows = [active];
  availability.update(500, source);
  selected = null;
  availability.update(501, source);
  expect(button.disabled).toBe(true);
});
