import { describe, expect, it } from 'vitest';

import {
  advanceFrameWithCommandFeedback,
  clearCommandFeedback,
  ORDER_DISPLACED_MESSAGE,
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
    const reported: number[] = [];

    expect(
      reportCommandFeedback(
        { takeIntentCapacityRejections: () => 2, takeIntentDisplacements: () => 0 },
        target,
        (count) => reported.push(count),
      ),
    ).toBe(2);
    expect(target.textContent).toBe(ORDER_QUEUE_FULL_MESSAGE);
    expect(target.attributes.get('data-kind')).toBe('error');
    expect(reported).toEqual([2]);
  });

  /**
   * A front placement onto a full queue is ACCEPTED and an older order
   * falls off; telling the player their order was refused would be the
   * opposite of what happened. The two counters carry different sentences,
   * and when a drain produced both, the refusal wins because it is the one
   * the player has to act on.
   */
  it('reports a displaced waiting order as a drop, not as a refusal', () => {
    const target = status();
    const reported: number[] = [];

    expect(
      reportCommandFeedback(
        { takeIntentCapacityRejections: () => 0, takeIntentDisplacements: () => 1 },
        target,
        (count) => reported.push(count),
      ),
    ).toBe(1);
    expect(target.textContent).toBe(ORDER_DISPLACED_MESSAGE);
    expect(target.attributes.get('data-kind')).toBe('error');
    expect(reported).toEqual([1]);

    const both = status();
    expect(
      reportCommandFeedback(
        { takeIntentCapacityRejections: () => 1, takeIntentDisplacements: () => 1 },
        both,
      ),
    ).toBe(2);
    expect(both.textContent, 'a refusal outranks a drop').toBe(ORDER_QUEUE_FULL_MESSAGE);
  });

  it('does not overwrite status when every drained order was accepted', () => {
    const target = status('');
    const reported: number[] = [];

    expect(
      reportCommandFeedback(
        { takeIntentCapacityRejections: () => 0, takeIntentDisplacements: () => 0 },
        target,
        (count) => reported.push(count),
      ),
    ).toBe(0);
    expect(target.textContent).toBe('');
    expect(target.attributes.size).toBe(0);
    expect(reported).toEqual([]);
  });

  it('clears a stale rejection when a later replacement is attempted and accepted', () => {
    const target = status(ORDER_QUEUE_FULL_MESSAGE);
    target.setAttribute('data-kind', 'error');

    clearCommandFeedback(target);
    expect(reportCommandFeedback(
      { takeIntentCapacityRejections: () => 0, takeIntentDisplacements: () => 0 },
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
        takeIntentDisplacements: () => 0,
      },
      commandTarget,
      (count) => order.push(`audio rejection ${count}`),
    );

    expect(alpha).toBe(0.25);
    expect(order).toEqual([
      'advance',
      'autosave',
      'feedback',
      'audio rejection 1',
    ]);
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

    reportCommandFeedback({ takeIntentCapacityRejections: () => 1, takeIntentDisplacements: () => 0 }, target);
    clearCommandFeedback(target);
    reportCommandFeedback({ takeIntentCapacityRejections: () => 1, takeIntentDisplacements: () => 0 }, target);

    expect(transitions).toEqual([
      ORDER_QUEUE_FULL_MESSAGE,
      '',
      ORDER_QUEUE_FULL_MESSAGE,
    ]);
  });
});
