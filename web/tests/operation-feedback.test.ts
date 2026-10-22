import { expect, it, vi } from 'vitest';
import { FeedbackLifetime, PendingIndicator, SceneFeedback, operationFeedback } from '../src/ui/operation-feedback.js';
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

it('hides an empty scene box at startup and expiry while preserving its live region and later messages', () => {
  const attributes = new Map([['role', 'status'], ['aria-live', 'polite']]);
  const element = { textContent: '', dataset: {} as Record<string,string>, style: {} as Record<string,string>,
    getAttribute: (name:string) => attributes.get(name) ?? null };
  const feedback = new SceneFeedback(element as unknown as HTMLElement);
  expect(element.style.opacity).toBe('0'); expect(attributes.get('role')).toBe('status');
  element.textContent = 'Orders cleared'; feedback.frame(0);
  expect(element.style.opacity).toBe('');
  feedback.frame(4001); expect(element.textContent).toBe(''); expect(element.style.opacity).toBe('0');
  expect(attributes.get('aria-live')).toBe('polite');
  element.textContent = 'Orders cleared'; feedback.frame(5000);
  expect(element.style.opacity).toBe(''); expect(element.textContent).toBe('Orders cleared');
  expect(element).not.toHaveProperty('hidden');
});
