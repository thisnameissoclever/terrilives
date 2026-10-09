import { describe, expect, it } from 'vitest';
import { STARTUP_FADE_MS, startupLoading } from '../src/ui/startup-loading.js';

function element() {
  return { hidden: false, textContent: '' as string | null, dataset: {} as Record<string, string>,
    value: 0, max: 1, removed: false, remove() { this.removed = true; } };
}

function fixture() {
  const elements = {
    'startup-loading': element(),
    'startup-loading-step': element(),
    'startup-loading-count': element(),
    'startup-loading-progress': element(),
  };
  elements['startup-loading-count'].hidden = true;
  elements['startup-loading-progress'].hidden = true;
  const scheduled: { fn: () => void; ms: number }[] = [];
  const loading = startupLoading(
    { getElementById: (id: string) => elements[id as keyof typeof elements] ?? null } as never,
    (fn, ms) => scheduled.push({ fn, ms }),
  );
  return { loading, scheduled, root: elements['startup-loading'], step: elements['startup-loading-step'],
    count: elements['startup-loading-count'], bar: elements['startup-loading-progress'] };
}

describe('startup loading cover', () => {
  it('names each step and shows a page count only while one is running', () => {
    const f = fixture();
    f.loading.step('Loading art');
    expect(f.step.textContent).toBe('Loading art');
    expect(f.count.hidden).toBe(true);
    f.loading.progress(12, 42);
    expect(f.count.textContent).toBe('12 of 42');
    expect(f.count.hidden).toBe(false);
    expect(f.bar).toMatchObject({ hidden: false, value: 12, max: 42 });
    f.loading.step('Getting ready');
    expect(f.count.hidden).toBe(true);
    expect(f.bar.hidden).toBe(true);
  });

  it('clamps the count and ignores an empty total', () => {
    const f = fixture();
    f.loading.progress(50, 42);
    expect(f.count.textContent).toBe('42 of 42');
    f.loading.progress(-1, 42);
    expect(f.count.textContent).toBe('0 of 42');
    f.loading.progress(0, 0);
    expect(f.count.textContent).toBe('0 of 42');
  });

  it('fades, then removes itself once, and ignores later updates', () => {
    const f = fixture();
    f.loading.finish();
    f.loading.finish();
    expect(f.root.dataset.done).toBe('true');
    expect(f.scheduled).toHaveLength(1);
    expect(f.scheduled[0].ms).toBe(STARTUP_FADE_MS);
    expect(f.root.removed).toBe(false);
    f.scheduled[0].fn();
    expect(f.root.removed).toBe(true);
    f.loading.step('Loading floor materials');
    expect(f.step.textContent).toBe('');
  });

  it('does nothing, and never throws, when the markup is missing', () => {
    const loading = startupLoading({ getElementById: () => null } as never, () => {
      throw new Error('nothing to schedule');
    });
    expect(() => {
      loading.step('Loading art');
      loading.progress(1, 2);
      loading.finish();
    }).not.toThrow();
  });
});
