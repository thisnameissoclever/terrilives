import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BuildExit } from '../src/ui/build-exit.js';
import { BuildToolSwitch } from '../src/ui/build-tools.js';

class Element {
  open = false; returnValue = ''; disabled = false; isConnected = true;
  listeners = new Map<string, (() => void)[]>();
  constructor(readonly doc: Page) {}
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]); }
  click() { this.listeners.get('click')?.forEach(fn => fn()); }
  focus() { this.doc.activeElement = this; }
  showModal() { this.open = true; }
  close(value: string) { this.open = false; this.returnValue = value; this.listeners.get('close')?.forEach(fn => fn()); }
  setAttribute() {} querySelectorAll() { return []; }
}
class Page {
  nodes = new Map<string, Element>(); activeElement: Element | null = null; body = new Element(this);
  querySelector(id: string) { if (!this.nodes.has(id)) this.nodes.set(id, new Element(this)); return this.nodes.get(id)!; }
  addEventListener() {}
}
function fixture() {
  const doc = new Page(); let dirty = true, active = true;
  const actions: string[] = [];
  const confirm = vi.fn((): boolean | Promise<boolean> => { actions.push('confirm'); dirty = false; return true; });
  const discard = vi.fn(() => { actions.push('end'); dirty = false; return true; });
  let exit: BuildExit;
  const leave = vi.fn(() => { if (!exit.gate()) return false; active = false; actions.push('leave'); return true; });
  exit = new BuildExit(doc as unknown as Document, {
    hasUnconfirmedChanges: () => dirty, confirm, discard, leave,
    focusView() {}, escapeAllowed: () => active, escapeBuild() {},
  });
  const destination = vi.fn(() => { actions.push('begin', 'land'); return true; });
  return { doc, exit, actions, confirm, discard, leave, destination, clean: () => { dirty = false; },
    dialog: doc.querySelector('#build-exit-dialog'), active: () => active };
}
describe('Build completion and Land destination', () => {
  it('footer Confirm adopts once and leaves', () => {
    const f = fixture(); f.doc.querySelector('#build-batch-confirm').click();
    expect(f.actions).toEqual(['confirm', 'end', 'leave']); expect(f.active()).toBe(false);
  });
  it('footer Cancel restores once and leaves', () => {
    const f = fixture(); f.doc.querySelector('#build-batch-cancel').click();
    expect(f.actions).toEqual(['end', 'leave']); expect(f.active()).toBe(false);
  });
  it.each(['confirm', 'discard', 'keep'])('pending Land shares the exit decision: %s', async answer => {
    const f = fixture(); expect(f.exit.requestDestination(f.destination)).toBe(false);
    expect(f.dialog.open).toBe(true); expect(f.actions).toEqual([]);
    f.dialog.close(answer); await Promise.resolve();
    expect(f.actions).toEqual(answer === 'confirm' ? ['confirm', 'end', 'begin', 'land']
      : answer === 'discard' ? ['end', 'begin', 'land'] : []);
    expect(f.active()).toBe(true); expect(f.leave).not.toHaveBeenCalled();
  });
  it('clean Land ends and begins directly without resuming gameplay', () => {
    const f = fixture(); f.clean(); expect(f.exit.requestDestination(f.destination)).toBe(true);
    expect(f.actions).toEqual(['end', 'begin', 'land']); expect(f.dialog.open).toBe(false);
  });
  it.each(['back', 'load', 'graphics'])('invalidates asynchronous Land intent on %s', async () => {
    const f = fixture(); let resolve!: (value: boolean) => void;
    f.confirm.mockImplementation(() => new Promise(done => { resolve = done; }));
    f.exit.requestDestination(f.destination); f.dialog.close('confirm');
    f.exit.clearExitIntent(); resolve(true); await Promise.resolve();
    expect(f.destination).not.toHaveBeenCalled(); expect(f.discard).not.toHaveBeenCalled();
  });
  it('rejects duplicate confirmation and destination while review is pending', async () => {
    const f = fixture(); let resolve!: (value: boolean) => void;
    f.confirm.mockImplementation(() => new Promise(done => { resolve = done; }));
    f.exit.requestDestination(f.destination); f.dialog.close('confirm');
    f.doc.querySelector('#build-batch-confirm').click();
    expect(f.exit.requestDestination(f.destination)).toBe(false); expect(f.confirm).toHaveBeenCalledOnce();
    resolve(true); await Promise.resolve(); expect(f.destination).toHaveBeenCalledOnce();
  });
  it('clears refused rollback destination so a later exit cannot open Land', () => {
    const f = fixture(); f.discard.mockReturnValueOnce(false);
    f.exit.requestDestination(f.destination); f.dialog.close('discard');
    expect(f.destination).not.toHaveBeenCalled(); f.clean(); f.leave();
    expect(f.destination).not.toHaveBeenCalled(); expect(f.active()).toBe(false);
  });
  it('gates mouse and programmatic tool selection before changing any preview', () => {
    const doc = new Page(); let active = false;
    const tool = { get active() { return active; }, enter: vi.fn(() => { active = true; }), exit: vi.fn(), handleKey: () => false };
    const leaveFurniture = vi.fn(() => true), focusView = vi.fn();
    let resume!: () => boolean;
    const beforeSelect = vi.fn((_button: string, activate: () => boolean) => { resume = activate; return false; });
    const tools = new BuildToolSwitch(doc as unknown as Document, [{ tool, button: 'build-tool-land', panel: 'land-tool' }],
      { leaveFurniture, focusView, beforeSelect });
    doc.querySelector('#build-tool-land').click(); expect(beforeSelect).toHaveBeenCalledOnce();
    expect(leaveFurniture).not.toHaveBeenCalled(); expect(tool.enter).not.toHaveBeenCalled();
    tools.select('build-tool-land'); expect(beforeSelect).toHaveBeenCalledTimes(2);
    expect(resume()).toBe(true); expect(tool.enter).toHaveBeenCalledOnce();
  });
});
it('actual exit markup has neutral safe focus, Discard then bottom Confirm', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dialog = html.match(/<dialog id="build-exit-dialog"[\s\S]*?<\/dialog>/)![0];
  const buttons = [...dialog.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)];
  expect(buttons.map(row => row[2])).toEqual(['Keep building', 'Discard changes', 'Confirm changes']);
  expect(buttons[0][1]).toContain('autofocus'); expect(buttons[0][1]).not.toContain('data-action-intent="negative"');
});
it('actual zoom markup has an encoding-safe minus icon', () => {
  const html = readFileSync(process.env.BUILD_ICON_HTML ?? new URL('../index.html', import.meta.url), 'utf8');
  const zoom = html.match(/<button id="build-zoom-out"[\s\S]*?<\/button>/)![0];
  expect(zoom).toContain('aria-label="Zoom out"'); expect(zoom).toContain('<svg');
  expect(zoom).toContain('aria-hidden="true"'); expect(zoom).toContain('M4 12h16');
  expect(zoom).not.toMatch(/[^\x00-\x7f]/);
});
it('Land omits redundant choice instructions beside its literal side buttons', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  expect(html).toContain('<p id="land-status" role="status" aria-live="polite"></p>');
  expect(html).not.toContain('Choose a strip beside the lot, read its price, then use Buy land.');
});
