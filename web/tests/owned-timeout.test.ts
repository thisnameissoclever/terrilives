import { afterEach, expect, it, vi } from 'vitest';
import { acquireWithTimeout } from '../proofs/owned-timeout.js';

afterEach(() => vi.useRealTimers());

it.each(['GPU device', 'image bitmap'])('disposes a late %s exactly once after timeout', async kind => {
  vi.useFakeTimers();
  const resource = {device: {destroy: vi.fn()}, close: vi.fn()};
  let resolve!: (value: typeof resource) => void;
  const acquisition = new Promise<typeof resource>(done => { resolve = done; });
  const dispose = vi.fn((value: typeof resource) => kind === 'GPU device' ? value.device.destroy() : value.close());
  const outcome = acquireWithTimeout(acquisition, 10, dispose, 'acquisition').catch(error => error);
  await vi.advanceTimersByTimeAsync(10);
  expect(await outcome).toBeInstanceOf(Error);
  expect(dispose).not.toHaveBeenCalled();
  resolve(resource);
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledExactlyOnceWith(resource);
  await vi.runAllTimersAsync();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(kind === 'GPU device' ? resource.device.destroy : resource.close).toHaveBeenCalledTimes(1);
});

it('transfers a timely resource to its caller without disposing it', async () => {
  vi.useFakeTimers();
  const resource = {}, dispose = vi.fn();
  expect(await acquireWithTimeout(Promise.resolve(resource), 10, dispose, 'resource')).toBe(resource);
  await vi.runAllTimersAsync();
  expect(dispose).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('propagates acquisition rejection and clears its timer', async () => {
  vi.useFakeTimers();
  const error = new Error('acquisition failed'), dispose = vi.fn();
  await expect(acquireWithTimeout(Promise.reject(error), 10, dispose, 'resource')).rejects.toBe(error);
  expect(vi.getTimerCount()).toBe(0);
  expect(dispose).not.toHaveBeenCalled();
});
