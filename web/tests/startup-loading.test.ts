import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STARTUP_FADE_MS, STARTUP_STEPS, afterPaint, loadedLine, startupLoading, startupStepLine,
} from '../src/ui/startup-loading.js';

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
    'startup-loading-bytes': element(),
  };
  elements['startup-loading-count'].hidden = true;
  elements['startup-loading-progress'].hidden = true;
  elements['startup-loading-bytes'].hidden = true;
  const scheduled: { fn: () => void; ms: number }[] = [];
  const loading = startupLoading(
    { getElementById: (id: string) => elements[id as keyof typeof elements] ?? null } as never,
    (fn, ms) => scheduled.push({ fn, ms }),
  );
  return { loading, scheduled, root: elements['startup-loading'], step: elements['startup-loading-step'],
    count: elements['startup-loading-count'], bar: elements['startup-loading-progress'],
    loaded: elements['startup-loading-bytes'] };
}

describe('startup loading cover', () => {
  it('numbers each step in startup order', () => {
    expect(startupStepLine('Downloading the game')).toBe('Step 1 of 10: Downloading the game');
    expect(startupStepLine('Drawing the house')).toBe('Step 10 of 10: Drawing the house');
    expect(new Set(STARTUP_STEPS).size).toBe(STARTUP_STEPS.length);
  });

  it('shows the first step in the page itself, before any script has run', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain(`>${startupStepLine(STARTUP_STEPS[0])}</p>`);
  });

  it('shows a file count only while the step that set it is running', () => {
    const f = fixture();
    f.loading.step('Loading furniture and people');
    expect(f.step.textContent).toBe('Step 7 of 10: Loading furniture and people');
    expect(f.count.hidden).toBe(true);
    f.loading.files(12, 42);
    expect(f.count.textContent).toBe('12 of 42 files');
    expect(f.count.hidden).toBe(false);
    expect(f.bar).toMatchObject({ hidden: false, value: 12, max: 42 });
    f.loading.step('Preparing graphics');
    expect(f.count.hidden).toBe(true);
    expect(f.bar.hidden).toBe(true);
    f.loading.note('Loading floor materials');
    expect(f.step.textContent).toBe('Loading floor materials');
  });

  it('clamps the file count and ignores an empty total', () => {
    const f = fixture();
    f.loading.files(50, 42);
    expect(f.count.textContent).toBe('42 of 42 files');
    f.loading.files(-1, 42);
    expect(f.count.textContent).toBe('0 of 42 files');
    f.loading.files(0, 0);
    expect(f.count.textContent).toBe('0 of 42 files');
  });

  it('keeps a running total of data loaded across steps', () => {
    const f = fixture();
    expect(f.loaded.hidden).toBe(true);
    f.loading.bytes(600_000);
    f.loading.step('Starting graphics');
    f.loading.bytes(1_000_000);
    f.loading.bytes(0);
    f.loading.bytes(Number.NaN);
    expect(f.loaded).toMatchObject({ hidden: false, textContent: '1.6 MB loaded' });
    expect(loadedLine(103_066_594)).toBe('103.1 MB loaded');
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
    f.loading.step('Drawing the house');
    f.loading.bytes(5);
    expect(f.step.textContent).toBe('');
    expect(f.loaded.textContent).toBe('');
  });

  it('does nothing, and never throws, when the markup is missing', () => {
    const loading = startupLoading({ getElementById: () => null } as never, () => {
      throw new Error('nothing to schedule');
    });
    expect(() => {
      loading.step('Starting graphics');
      loading.files(1, 2);
      loading.bytes(10);
      loading.finish();
    }).not.toThrow();
  });
});

describe('waiting for a paint', () => {
  const run = (fireFrame: boolean) => {
    const timers: { fn: () => void; ms: number }[] = [];
    let resolved = false;
    void afterPaint(fn => { if (fireFrame) fn(); }, (fn, ms) => timers.push({ fn, ms }))
      .then(() => { resolved = true; });
    return { timers, resolved: () => resolved };
  };

  it('resolves just after the next animation frame', async () => {
    const r = run(true);
    expect(r.timers.map(t => t.ms)).toEqual([0, 100]);
    r.timers[0].fn();
    r.timers[1].fn();
    await Promise.resolve();
    expect(r.resolved()).toBe(true);
  });

  it('still resolves in a background tab, where frames never come', async () => {
    const r = run(false);
    expect(r.timers.map(t => t.ms)).toEqual([100]);
    r.timers[0].fn();
    expect(r.timers.map(t => t.ms)).toEqual([100, 0]);
    r.timers[1].fn();
    await Promise.resolve();
    expect(r.resolved()).toBe(true);
  });
});
