import { describe, expect, it } from 'vitest';
import { createSatisfactionSurface, describeSatisfaction } from '../src/ui/satisfaction-meter.js';

describe('life satisfaction bands', () => {
  it.each([
    [0, 'Very dissatisfied'], [19.99, 'Very dissatisfied'], [20, 'Dissatisfied'],
    [39.99, 'Dissatisfied'], [40, 'Content'], [59.99, 'Content'],
    [60, 'Satisfied'], [79.99, 'Satisfied'], [80, 'Fulfilled'], [100, 'Fulfilled'],
  ])('describes %s as %s', (value, label) => {
    expect(describeSatisfaction(value)).toEqual({ value, label });
  });
  it('bounds finite projections and rejects missing or nonfinite scores', () => {
    expect(describeSatisfaction(-2)?.value).toBe(0);
    expect(describeSatisfaction(1000)?.value).toBe(100);
    for (const value of [null, NaN, Infinity, -Infinity]) expect(describeSatisfaction(value)).toBeNull();
  });
});

it('updates the native meter and exact hover/focus description without redundant writes', () => {
  const node = () => {
    const attributes = new Map<string, string>();
    let writes = 0;
    return { textContent: '', hidden: false, value: 0, attributes,
      getAttribute: (name: string) => attributes.get(name),
      setAttribute: (name: string, value: string) => { writes++; attributes.set(name, value); },
      writes: () => writes };
  };
  const summary = node(), label = node(), meter = node();
  const surface = createSatisfactionSurface(summary as unknown as HTMLElement,
    label as unknown as HTMLElement, meter as unknown as HTMLMeterElement);
  surface.render(81.15);
  expect(label.textContent).toBe('Fulfilled');
  expect(meter.value).toBe(81.15);
  expect(meter.hidden).toBe(false);
  expect(summary.attributes.get('title')).toBe('81.2 / 100');
  expect(summary.attributes.get('aria-label')).toBe('Life satisfaction: Fulfilled, 81.2 out of 100');
  expect(meter.attributes.get('aria-valuetext')).toBe('Fulfilled, 81.2 out of 100');
  const writes = summary.writes() + meter.writes();
  surface.render(81.15);
  expect(summary.writes() + meter.writes()).toBe(writes);
  surface.render(39);
  expect(label.textContent).toBe('Dissatisfied');
  expect(meter.value).toBe(39);
  surface.render(null);
  expect(meter.hidden).toBe(true);
  expect(meter.value).toBe(0);
  expect(label.textContent).toBe('Unavailable');
  expect(summary.attributes.get('title')).toBe('Life satisfaction unavailable');
});
