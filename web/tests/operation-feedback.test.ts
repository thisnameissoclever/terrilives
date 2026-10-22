import { expect, it, vi } from 'vitest';
import { FeedbackLifetime, PendingIndicator, operationFeedback } from '../src/ui/operation-feedback.js';
it('expires useful success while keeping failures until superseded', () => {
  const lifetime = new FeedbackLifetime(); const success = operationFeedback('place', 'success', 'Chair', 'Chair placed.');
  expect(lifetime.read(success, 0)).toBe(success); expect(lifetime.read(success, 4001)).toBeNull();
  const failure = operationFeedback('place', 'failure', 'Chair', 'Occupied.', 'move');
  expect(lifetime.read(failure, 4002)).toBe(failure); expect(lifetime.read(failure, 99000)).toBe(failure);
  expect(lifetime.read(null, 99001)).toBeNull();
});
it('shows known waits immediately and unknown waits by 1.25 seconds, clearing on supersession', () => {
  vi.useFakeTimers();
  try {
    const attributes = new Map<string,string>(); const element = { setAttribute: (k:string,v:string) => attributes.set(k,v), removeAttribute: (k:string) => attributes.delete(k) };
    const pending = new PendingIndicator(element); pending.start(false);
    expect(attributes.has('data-pending')).toBe(false); vi.advanceTimersByTime(1250);
    expect(attributes.get('data-pending')).toBe('true'); pending.stop(); expect(attributes.has('data-pending')).toBe(false);
    pending.start(false); pending.start(true); expect(attributes.get('data-pending')).toBe('true');
    pending.stop(); vi.advanceTimersByTime(2000); expect(attributes.has('data-pending')).toBe(false);
  } finally { vi.useRealTimers(); }
});
