import { expect, it } from 'vitest';
import { createFloorSceneStatus } from '../src/ui/floor-scene-status.js';

interface ElementFixture {
  id: string; hidden: boolean; textContent: string; type: string; className: string;
  style: { visibility: string }; attributes: Record<string, string>;
  children: ElementFixture[]; listeners: Record<string, () => void>;
  setAttribute(name: string, value: string): void;
  append(...items: ElementFixture[]): void;
  addEventListener(name: string, fn: () => void): void;
}
function element(): ElementFixture {
  return { id: '', hidden: false, textContent: '', type: '', className: '', style: { visibility: '' },
    attributes: {} as Record<string, string>, children: [] as ReturnType<typeof element>[],
    listeners: {} as Record<string, () => void>,
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    append(...items: ReturnType<typeof element>[]) { this.children.push(...items); },
    addEventListener(name: string, fn: () => void) { this.listeners[name] = fn; } };
}

it('shows an explicit scene status and Retry while leaving other application controls in place', () => {
  const body = element(), options = element(), stage = element();
  body.append(options, stage);
  let retries = 0;
  const update = createFloorSceneStatus({ body, createElement: element } as never, stage as never, () => { retries++; });
  const panel = body.children[2], [text, retry] = panel.children;
  expect(panel.id).toBe('floor-scene-status');
  expect(panel.attributes.role).toBe('status');
  expect(panel.hidden).toBe(true);
  update(true, null);
  expect(stage.style.visibility).toBe('hidden');
  expect(panel.hidden).toBe(false);
  expect(text.textContent).toBe('Loading floor materials.');
  expect(retry.hidden).toBe(true);
  update(true, 'offline');
  expect(text.textContent).toBe('Floor materials could not load. Try again.');
  expect(retry.hidden).toBe(false);
  retry.listeners.click();
  expect(retries).toBe(1);
  expect(options.hidden).toBe(false);
  update(false, null);
  expect(stage.style.visibility).toBe('');
  expect(panel.hidden).toBe(true);
});
