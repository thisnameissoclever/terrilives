import { expect, it } from 'vitest';
import { ActionQueue, actionCards } from '../src/ui/action-queue.js';

it('keeps repeated actions in order and distinguishes a waiting first order', () => {
  expect(actionCards(['Read', 'Chat', 'Chat'])).toEqual([
    { label: 'Read', phase: 'Now' }, { label: 'Chat', phase: 'Next' }, { label: 'Chat', phase: 'Queued' },
  ]);
  expect(actionCards(['', 'Chat'])).toEqual([{ label: 'Chat', phase: 'Next' }]);
  expect(actionCards([])).toEqual([]);
});

it('clears on deselection and refreshes immediately on a different person', () => {
  const doc = { createElement: () => ({ append() {}, textContent: '', className: '' }),
    createTextNode: (text: string) => text };
  let count = 0;
  const root = { ownerDocument: doc, clientHeight: 400, hidden: true,
    replaceChildren() { count = 0; }, append() { count += 1; } };
  const queue = new ActionQueue(root as unknown as HTMLElement, 100);
  let selected: number | null = 1;
  const source = { selectedIndex: () => selected, actionQueueOf: () => ['Read', 'Chat'] };
  queue.update(0, source);
  expect(root.hidden).toBe(false); expect(count).toBe(2);
  selected = null; queue.update(1, source);
  expect(root.hidden).toBe(true); expect(count).toBe(0);
  selected = 2; queue.update(2, source);
  expect(root.hidden).toBe(false); expect(count).toBe(2);
});

it('renders only the visible queue window without limiting stored orders', () => {
  const actions = Array.from({ length: 200_000 }, (_, index) => `Order ${index}`);
  const rows: unknown[] = [];
  const doc = { createElement: () => ({ append() {}, textContent: '', className: '' }),
    createTextNode: (text: string) => text };
  const root = { ownerDocument: doc, clientHeight: 400, hidden: true,
    replaceChildren() { rows.length = 0; }, append(row: unknown) { rows.push(row); } };
  const queue = new ActionQueue(root as unknown as HTMLElement, 100);
  let requested = 0;
  const source = { selectedIndex: () => 1, actionQueueOf: (_entity: number, maxRows?: number) => {
    requested = maxRows ?? 0;
    return actions;
  } };
  expect(() => queue.update(0, source)).not.toThrow();
  expect(rows).toHaveLength(11);
  expect(requested).toBe(12);
  expect(actions).toHaveLength(200_000);
  expect(actions.at(-1)).toBe('Order 199999');
  root.clientHeight = 200; queue.update(100, source);
  expect(rows).toHaveLength(6);
  expect(requested).toBe(7);
  root.clientHeight = 600; queue.update(200, source);
  expect(rows).toHaveLength(16);
  expect(requested).toBe(17);
});

it('bridge exposes queue labels without mutating saved state and rejects invalid identities', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: init, SimHandle } = await import('../src/wasm/terri_wasm.js');
  const { SimBridge } = await import('../src/bridge.js');
  const { memory } = await init({module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm')});
  const handle = SimHandle.from_lot();
  try {
    const source = new SimBridge(handle, memory);
    const selected = source.ids()[source.kinds().findIndex(kind => kind === 0)];
    expect(selected).toBeDefined();
    const saved = source.saveBytes();
    expect(source.actionQueueOf(selected)).toEqual(['']);
    expect(source.actionQueueOf(-1)).toEqual([]);
    expect(source.actionQueueOf(4294967295)).toEqual([]);
    expect(source.saveBytes()).toEqual(saved);
  } finally { handle.free(); }
});

it('recomputes the bounded preview immediately when its hidden panel opens', () => {
  let requested = 0;
  const doc = { createElement: () => ({ append() {}, textContent: '', className: '' }), createTextNode: (text: string) => text };
  const root = { ownerDocument: doc, clientHeight: 0, hidden: false, replaceChildren() {}, append() {} };
  const queue = new ActionQueue(root as unknown as HTMLElement, 100);
  const source = { selectedIndex: () => 1, actionQueueOf: (_id: number, limit = 0) => { requested = limit; return ['Read']; } };
  queue.update(0, source);
  expect(requested).toBe(2);
  root.clientHeight = 220;
  queue.invalidate(); queue.update(1, source);
  expect(requested).toBe(8);
});
