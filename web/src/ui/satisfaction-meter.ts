import { setTextIfChanged } from './set-text-if-changed.js';

export interface SatisfactionView {
  value: number;
  label: string;
}

export interface SatisfactionSurface {
  render(value: number | null): void;
}

/** Bands describe a life assessment; their boundaries do not change its score. */
export function describeSatisfaction(value: number | null): SatisfactionView | null {
  if (value === null || !Number.isFinite(value)) return null;
  const bounded = Math.min(100, Math.max(0, value));
  const label = bounded < 20 ? 'Very dissatisfied'
    : bounded < 40 ? 'Dissatisfied'
    : bounded < 60 ? 'Content'
    : bounded < 80 ? 'Satisfied' : 'Fulfilled';
  return { value: bounded, label };
}

export function createSatisfactionSurface(
  summary: HTMLElement,
  label: HTMLElement,
  meter: HTMLMeterElement,
): SatisfactionSurface {
  const attribute = (node: HTMLElement, name: string, value: string) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  return {
    render(value): void {
      const view = describeSatisfaction(value);
      setTextIfChanged(label, view?.label ?? 'Unavailable');
      if (meter.hidden !== (view === null)) meter.hidden = view === null;
      if (view) {
        if (meter.value !== view.value) meter.value = view.value;
        const description = `${view.label}, ${view.value.toFixed(1)} out of 100`;
        attribute(meter, 'aria-valuetext', description);
        attribute(summary, 'aria-label', `Life satisfaction: ${description}`);
        attribute(summary, 'title', `${view.value.toFixed(1)} / 100`);
      } else {
        if (meter.value !== 0) meter.value = 0;
        attribute(meter, 'aria-valuetext', 'Life satisfaction unavailable');
        attribute(summary, 'aria-label', 'Life satisfaction unavailable');
        attribute(summary, 'title', 'Life satisfaction unavailable');
      }
    },
  };
}
