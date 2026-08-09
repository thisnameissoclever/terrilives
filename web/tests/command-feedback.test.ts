import { describe, expect, it } from 'vitest';

import {
  advanceFrameWithCommandFeedback,
  clearCommandFeedback,
  ORDER_QUEUE_FULL_MESSAGE,
  reportCommandFeedback,
  type CommandFeedbackStatus,
} from '../src/ui/command-feedback.js';

function status(initial = 'Game saved'): CommandFeedbackStatus & {
  readonly attributes: Map<string, string>;
} {
  const attributes = new Map<string, string>();
  return {
    textContent: initial,
    attributes,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
}

describe('command feedback', () => {
  it('reports simulation-authored capacity rejection as an error', () => {
    const target = status();

    expect(
      reportCommandFeedback(
        { takeIntentCapacityRejections: () => 2 },
        target,
      ),
    ).toBe(2);
    expect(target.textContent).toBe(ORDER_QUEUE_FULL_MESSAGE);
    expect(target.attributes.get('data-kind')).toBe('error');
  });

  it('does not overwrite status when every drained order was accepted', () => {
    const target = status('');

    expect(
      reportCommandFeedback(
        { takeIntentCapacityRejections: () => 0 },
        target,
      ),
    ).toBe(0);
    expect(target.textContent).toBe('');
    expect(target.attributes.size).toBe(0);
  });

  it('clears a stale rejection when a later replacement is attempted and accepted', () => {
    const target = status(ORDER_QUEUE_FULL_MESSAGE);
    target.setAttribute('data-kind', 'error');

    clearCommandFeedback(target);
    expect(reportCommandFeedback(
      { takeIntentCapacityRejections: () => 0 },
      target,
    )).toBe(0);

    expect(target.textContent).toBe('');
    expect(target.attributes.has('data-kind')).toBe(false);
  });

  it('orders day-boundary autosave before rejection without sharing its status', () => {
    const order: string[] = [];
    const saveTarget = status('Game saved');
    const commandTarget = status('');

    const alpha = advanceFrameWithCommandFeedback(
      () => {
        order.push('advance');
        return 0.25;
      },
      () => {
        order.push('autosave');
        saveTarget.textContent = 'Autosaved';
      },
      {
        takeIntentCapacityRejections: () => {
          order.push('feedback');
          return 1;
        },
      },
      commandTarget,
    );

    expect(alpha).toBe(0.25);
    expect(order).toEqual(['advance', 'autosave', 'feedback']);
    expect(saveTarget.textContent).toBe('Autosaved');
    expect(commandTarget.textContent).toBe(ORDER_QUEUE_FULL_MESSAGE);
  });

  it('creates a clear transition between two identical rejections', () => {
    const target = status('');
    const transitions: Array<string | null> = [];
    let text: string | null = '';
    Object.defineProperty(target, 'textContent', {
      get: () => text,
      set: (value: string | null) => {
        text = value;
        transitions.push(value);
      },
    });

    reportCommandFeedback({ takeIntentCapacityRejections: () => 1 }, target);
    clearCommandFeedback(target);
    reportCommandFeedback({ takeIntentCapacityRejections: () => 1 }, target);

    expect(transitions).toEqual([
      ORDER_QUEUE_FULL_MESSAGE,
      '',
      ORDER_QUEUE_FULL_MESSAGE,
    ]);
  });
});
